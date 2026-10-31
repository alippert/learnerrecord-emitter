// The emitter's delivery rules: batching, order, retries with backoff and Retry-After, a refused batch
// split until the refused statement is found, a refused sensor stopping delivery, the queue limit,
// and the outcome and alignment callbacks. fetch and sleep are injected; nothing leaves the process.
import { describe, expect, it } from "vitest";
import { createEmitter, createStatements, QueueFullError, type Statement } from "../src/index.ts";

const S = createStatements({ homePage: "https://lms.test" });
const target = (n: number) => ({ learner: `s-${n % 3}`, object: { id: `https://lms.test/items/${n}` } });
const statement = (n: number) => S.itemAnswered(target(n), { success: n % 2 === 0 });

type Call = { body: Statement[] };
function fakeService(behaviour: (batch: Statement[], call: number) => { status: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const batch = JSON.parse(String(init.body)) as Statement[];
    calls.push({ body: batch });
    const r = behaviour(batch, calls.length);
    const outcomes = r.status === 200 ? batch.map((s) => ({ id: s.id, status: "sealed", event_id: `e-${s.id}`, mapped_to: "assessment.response.v1" })) : undefined;
    return new Response(JSON.stringify(r.body ?? batch.map((s) => s.id)), { status: r.status, headers: { ...(outcomes ? { "x-lpai-outcomes": JSON.stringify(outcomes) } : {}), ...(r.headers ?? {}) } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const sleeps: number[] = [];
const sleep = async (ms: number) => { sleeps.push(ms); };

describe("batching and order", () => {
  it("sends full batches at once and the remainder on flush, in the order emitted", async () => {
    const svc = fakeService(() => ({ status: 200 }));
    const em = createEmitter({ endpoint: "https://lpai.test/functions/v1/lpai-v1/", sensorToken: "t", batchSize: 4, flushIntervalMs: 0, fetch: svc.fetchImpl, sleep });
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await em.emit(statement(i)));
    const r = await em.close();
    expect(svc.calls.map((c) => c.body.length)).toEqual([4, 4, 2]);
    expect(svc.calls.flatMap((c) => c.body.map((s) => s.id))).toEqual(ids);
    expect(r.pending).toBe(0);
    expect(await em.pending()).toBe(0);
  });
  it("concurrent flushes share one run, so nothing is sent twice", async () => {
    const svc = fakeService(() => ({ status: 200 }));
    const em = createEmitter({ endpoint: "https://lpai.test", sensorToken: "t", batchSize: 50, flushIntervalMs: 0, fetch: svc.fetchImpl, sleep });
    for (let i = 0; i < 5; i++) await em.emit(statement(i));
    await Promise.all([em.flush(), em.flush(), em.flush()]);
    expect(svc.calls.flatMap((c) => c.body).length).toBe(5);
  });
  it("refuses a statement LPAI would refuse before queueing it, and a full queue", async () => {
    const em = createEmitter({ endpoint: "https://lpai.test", sensorToken: "t", maxQueue: 2, batchSize: 50, flushIntervalMs: 0, fetch: fakeService(() => ({ status: 200 })).fetchImpl, sleep });
    await expect(em.emit({ ...statement(1), id: "not-a-uuid" })).rejects.toThrow(/UUID/);
    await em.emit(statement(1)); await em.emit(statement(2));
    await expect(em.emit(statement(3))).rejects.toBeInstanceOf(QueueFullError);
  });
});

describe("retries", () => {
  it("retries a 503 and a dropped connection with backoff, and honours Retry-After on a 429", async () => {
    sleeps.length = 0;
    let n = 0;
    const svc = fakeService(() => { n++; return n === 1 ? { status: 503 } : n === 2 ? { status: 429, headers: { "retry-after": "7" } } : { status: 200 }; });
    let dropped = false;
    const flaky = (async (u: string, i: RequestInit) => { if (!dropped) { dropped = true; throw new TypeError("fetch failed"); } return svc.fetchImpl(u, i); }) as unknown as typeof fetch;
    const em = createEmitter({ endpoint: "https://lpai.test", sensorToken: "t", flushIntervalMs: 0, fetch: flaky, sleep, retry: { baseMs: 100 } });
    await em.emit(statement(1));
    const r = await em.flush();
    expect(r.sent).toBe(1);
    expect(sleeps.length).toBe(3);
    expect(sleeps[2]).toBe(7000);
  });
  it("keeps the batch queued when the service stays unavailable", async () => {
    const em = createEmitter({ endpoint: "https://lpai.test", sensorToken: "t", flushIntervalMs: 0, fetch: fakeService(() => ({ status: 503 })).fetchImpl, sleep, retry: { maxAttempts: 3 } });
    await em.emit(statement(1));
    await expect(em.flush()).rejects.toThrow(/after 3 attempts/);
    expect(await em.pending()).toBe(1);
  });
  it("splits a refused batch until the refused statement is found, reports it, and sends the rest", async () => {
    const bad = statement(5);
    const svc = fakeService((batch) => (batch.some((s) => s.id === bad.id) ? { status: 400, body: { error: { code: "invalid_statement", message: "verb.id must be an IRI" } } } : { status: 200 }));
    const rejected: string[] = [];
    const em = createEmitter({ endpoint: "https://lpai.test", sensorToken: "t", batchSize: 8, flushIntervalMs: 0, fetch: svc.fetchImpl, sleep, onRejected: (r) => rejected.push(...r.map((x) => `${x.statement.id}:${x.code}`)) });
    const all = [statement(1), statement(2), statement(3), bad, statement(6), statement(7)];
    for (const s of all) await em.emit(s);
    const r = await em.flush();
    expect(rejected).toEqual([`${bad.id}:invalid_statement`]);
    expect(r.outcomes.map((o) => o.id)).toEqual(all.filter((s) => s !== bad).map((s) => s.id));
  });
  it("stops on a refused sensor and keeps the queue", async () => {
    const em = createEmitter({ endpoint: "https://lpai.test", sensorToken: "t", flushIntervalMs: 0, fetch: fakeService(() => ({ status: 401, body: { error: { code: "unauthenticated", message: "unknown or revoked sensor" } } })).fetchImpl, sleep });
    await em.emit(statement(1));
    await expect(em.flush()).rejects.toThrow(/refused the sensor/);
    expect(await em.pending()).toBe(1);
  });
});

describe("callbacks", () => {
  it("reports outcomes, and each alignment status once per content version and etag", async () => {
    const status = { content_ref: "https://lms.test/items/1", content_version: "v1", mapping_status: "provisional", mapping_version: 1, alignment_type: "model_embedding", authority: 0.3, authority_required: {}, usable_for: ["engagement"], skills: [], etag: "W/\"1\"" };
    const svc = fakeService(() => ({ status: 200, headers: { "x-lpai-alignment": JSON.stringify({ [status.content_ref]: status }) } }));
    const seen: string[] = []; const outcomes: string[] = [];
    const em = createEmitter({ endpoint: "https://lpai.test", sensorToken: "t", batchSize: 1, flushIntervalMs: 0, fetch: svc.fetchImpl, sleep, onAlignment: (a) => seen.push(...a.map((x) => x.etag)), onOutcomes: (o) => outcomes.push(...o.map((x) => x.status)) });
    await em.emit(statement(1)); await em.flush();
    await em.emit(statement(2)); await em.flush();
    expect(seen).toEqual(['W/"1"']);
    expect(outcomes).toEqual(["sealed", "sealed"]);
  });
});

describe("batch boundaries under a slow service", () => {
  it("a batch filled by emit() leaves full, even when statements keep arriving while it is in flight", async () => {
    const calls: number[] = [];
    let release: () => void = () => {};
    const slow = (async (_u: string, init: RequestInit) => {
      const batch = JSON.parse(String(init.body)) as { id: string }[]; calls.push(batch.length);
      await new Promise<void>((r) => { release = r; setTimeout(r, 5); });
      return new Response(JSON.stringify(batch.map((s) => s.id)), { status: 200, headers: { "x-lpai-outcomes": JSON.stringify(batch.map((s) => ({ id: s.id, status: "sealed" }))) } });
    }) as unknown as typeof fetch;
    const em = createEmitter({ endpoint: "https://lpai.test", sensorToken: "t", batchSize: 4, flushIntervalMs: 0, fetch: slow, sleep });
    for (let i = 0; i < 10; i++) await em.emit(statement(i));
    release();
    await em.close();
    expect(calls).toEqual([4, 4, 2]);
  });
});

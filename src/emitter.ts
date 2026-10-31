// The LPAI emitter: queue xAPI statements, send them to LPAI's xAPI pack in batches, and report what
// became of each. Meant to run server-side, in a relay that holds the sensor token: a sensor token in
// a browser can be read and used to send evidence in your institution's name.
//
// Delivery is at least once and in order. Each statement has an id it keeps across retries, so a
// resend is a duplicate the service recognises, never a second event. A batch that fails for the
// service's or the network's sake (429, 5xx, a dropped connection) is retried with backoff, honouring
// Retry-After. A batch the service refuses (400, 409, 413, 422) is split until the statement it refuses
// is found; that one is reported through onRejected and dropped, and the rest are sent.
import { tenantAssertion, type TenantKey } from "./jws.js";
import type { AlignmentStatus, FlushResult, Outcome, QueueStore, Rejected, Statement } from "./types.js";

export interface EmitterOptions {
  /** LPAI's base URL, the lpai-v1 function: https://<project>.supabase.co/functions/v1/lpai-v1 */
  endpoint: string;
  /** The sensor token LPAI issued for your xAPI sensor. */
  sensorToken: string;
  batchSize?: number; // statements per request, 1 to 100 (default 50)
  flushIntervalMs?: number; // send a partial batch after this long (default 2000; 0 = only on flush())
  maxQueue?: number; // statements held before emit() refuses (default 10000)
  store?: QueueStore; // where the queue lives (default: memory)
  retry?: { maxAttempts?: number; baseMs?: number; maxMs?: number };
  headers?: Record<string, string>; // extra request headers (for example x-region)
  /** For native events (emitEvent): the tenant's registered key. */
  tenant?: TenantKey;
  onOutcomes?: (outcomes: Outcome[]) => void;
  onAlignment?: (status: AlignmentStatus[]) => void;
  onRejected?: (rejected: Rejected[]) => void;
  onError?: (error: Error) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class QueueFullError extends Error { constructor(max: number) { super(`the emitter queue holds ${max} statements; flush or raise maxQueue`); } }
class SendError extends Error { constructor(public status: number, public code: string, message: string, public retryAfterMs: number | null) { super(message); } }

const PERMANENT = new Set([400, 401, 403, 404, 409, 413, 422]);
const memoryStore = (): QueueStore => { let q: Statement[] = []; return { load: async () => q, save: async (next) => { q = next; } }; };

export function createEmitter(o: EmitterOptions) {
  const endpoint = o.endpoint.replace(/\/+$/, "");
  const batchSize = Math.max(1, Math.min(100, o.batchSize ?? 50));
  const maxQueue = o.maxQueue ?? 10_000;
  const store = o.store ?? memoryStore();
  const maxAttempts = o.retry?.maxAttempts ?? 8, baseMs = o.retry?.baseMs ?? 500, maxMs = o.retry?.maxMs ?? 60_000;
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let queue: Statement[] | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<unknown> = Promise.resolve(); // flush runs, one after another
  const alignmentSeen = new Map<string, string>(); // content_ref@version -> etag

  async function q(): Promise<Statement[]> { if (!queue) queue = [...(await store.load())]; return queue; }
  function schedule() {
    const ms = o.flushIntervalMs ?? 2000;
    if (timer || ms <= 0) return;
    timer = setTimeout(() => { timer = null; run(true).catch((e) => o.onError?.(e as Error)); }, ms);
  }

  async function post(batch: Statement[]): Promise<Outcome[]> {
    let res: Response;
    try {
      res = await doFetch(`${endpoint}/v1/packs/xapi/statements`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${o.sensorToken}`, "x-experience-api-version": "1.0.3", ...(o.headers ?? {}) }, body: JSON.stringify(batch) });
    } catch (e) { throw new SendError(0, "network", (e as Error).message, null); }
    const text = await res.text();
    if (!res.ok) {
      let code = "error", message = text.slice(0, 300);
      try { const j = JSON.parse(text) as { error?: { code?: string; message?: string } }; code = j.error?.code ?? code; message = j.error?.message ?? message; } catch { /* not JSON */ }
      const ra = res.headers.get("retry-after");
      throw new SendError(res.status, code, message, ra ? (Number.isFinite(Number(ra)) ? Number(ra) * 1000 : Math.max(0, Date.parse(ra) - Date.now())) : null);
    }
    const outcomes = JSON.parse(res.headers.get("x-lpai-outcomes") ?? "[]") as Outcome[];
    const alignment = res.headers.get("x-lpai-alignment");
    if (alignment && o.onAlignment) {
      try {
        const all = Object.values(JSON.parse(alignment) as Record<string, AlignmentStatus>);
        const fresh = all.filter((a) => { const k = `${a.content_ref}@${a.content_version ?? ""}`; const seen = alignmentSeen.get(k) === a.etag; alignmentSeen.set(k, a.etag); return !seen; });
        if (fresh.length) o.onAlignment(fresh);
      } catch { /* a malformed header never stops delivery */ }
    }
    return outcomes;
  }

  // Send one batch, retrying transient failures; split a refused batch to find what was refused.
  async function deliver(batch: Statement[], out: { outcomes: Outcome[]; rejected: Rejected[] }): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try { out.outcomes.push(...(await post(batch))); return; }
      catch (e) {
        if (!(e instanceof SendError)) throw e;
        // A refused sensor refuses everything: stop, and keep the queue.
        if (e.status === 401 || e.status === 403) throw new Error(`LPAI refused the sensor (${e.status} ${e.code}): ${e.message}`);
        if (PERMANENT.has(e.status)) {
          if (batch.length === 1) { out.rejected.push({ statement: batch[0]!, status: e.status, code: e.code, message: e.message }); return; }
          const mid = Math.ceil(batch.length / 2);
          await deliver(batch.slice(0, mid), out); await deliver(batch.slice(mid), out); return;
        }
        if (attempt >= maxAttempts) throw new Error(`LPAI unavailable after ${attempt} attempts (${e.status || "network"} ${e.code}): ${e.message}`);
        const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
        await sleep(e.retryAfterMs ?? Math.round(backoff / 2 + Math.random() * backoff / 2));
      }
    }
  }

  // all: send everything queued (flush(), the interval); otherwise only full batches (a batch filled by emit()).
  async function flushNow(all: boolean): Promise<FlushResult> {
    const list = await q();
    const out = { outcomes: [] as Outcome[], rejected: [] as Rejected[] };
    let sent = 0;
    while (list.length && (all || list.length >= batchSize)) {
      const batch = list.slice(0, batchSize);
      await deliver(batch, out); // throws on exhaustion: the batch stays queued
      list.splice(0, batch.length); sent += batch.length;
      await store.save(list);
    }
    if (out.outcomes.length) o.onOutcomes?.(out.outcomes);
    if (out.rejected.length) o.onRejected?.(out.rejected);
    return { sent, outcomes: out.outcomes, rejected: out.rejected, pending: list.length };
  }
  // Runs are queued one after another, so a statement is sent once and batches leave in order.
  function run(all: boolean): Promise<FlushResult> {
    const p = chain.then(() => flushNow(all));
    chain = p.catch(() => undefined);
    return p;
  }
  /** Send everything queued, after any run already under way. */
  function flush(): Promise<FlushResult> {
    if (timer) { clearTimeout(timer); timer = null; }
    return run(true);
  }

  return {
    /** Queue a statement; returns its id. Sends at once when a batch is full, otherwise on the interval. */
    async emit(s: Statement): Promise<string> {
      const problems = validate(s);
      if (problems.length) throw new Error(`not a statement LPAI accepts: ${problems.join("; ")}`);
      const list = await q();
      if (list.length >= maxQueue) throw new QueueFullError(maxQueue);
      list.push(s); await store.save(list);
      if (list.length >= batchSize) void run(false).catch((e) => o.onError?.(e as Error)); else schedule();
      return s.id;
    },
    flush,
    /** Statements waiting to be sent. */
    async pending(): Promise<number> { return (await q()).length; },
    /** Flush and stop the interval timer. */
    async close(): Promise<FlushResult> { const r = await flush(); if (timer) { clearTimeout(timer); timer = null; } return r; },
    /** A native LPAI event (not xAPI), signed as the tenant: for example an assignment (item 13). */
    async emitEvent(e: { event_type: string; learner_id: string; occurred_at?: string; idempotency_key: string; origin_tool_class?: string; payload: Record<string, unknown> }, purpose = "instruction"): Promise<unknown> {
      if (!o.tenant) throw new Error("emitEvent needs the tenant's key (options.tenant)");
      const res = await doFetch(`${endpoint}/v1/events`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await tenantAssertion(o.tenant, purpose)}`, "x-lpai-purpose": purpose, ...(o.headers ?? {}) }, body: JSON.stringify({ origin_tool_class: "connector", occurred_at: new Date().toISOString(), ...e }) });
      const text = await res.text();
      if (!res.ok) throw new Error(`LPAI refused the event (${res.status}): ${text.slice(0, 300)}`);
      return JSON.parse(text);
    },
  };
}
export type Emitter = ReturnType<typeof createEmitter>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, IRI = /^[a-z][a-z0-9+.-]*:/i;
/** The checks LPAI's pack makes on a statement, made before it is queued. */
export function validate(s: Statement): string[] {
  const e: string[] = [];
  if (!s || typeof s !== "object") return ["not an object"];
  if (!UUID.test(String(s.id))) e.push("id must be a UUID");
  if (Number.isNaN(Date.parse(String(s.timestamp)))) e.push("timestamp is not a date");
  if (!s.actor?.account?.name || !s.actor.account.homePage) e.push("actor needs account.homePage and account.name");
  if (!s.verb || !IRI.test(String(s.verb.id))) e.push("verb.id must be an IRI");
  if (!s.object?.id) e.push("object.id is required");
  return e;
}

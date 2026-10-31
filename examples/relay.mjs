// A minimal relay: your course player POSTs its events here; the relay holds the sensor token,
// builds statements, and lets the emitter batch and deliver them. Node 20+, no dependencies.
//
//   LPAI_ENDPOINT=https://<project>.supabase.co/functions/v1/lpai-v1 LPAI_SENSOR_TOKEN=… \
//   LMS_HOME_PAGE=https://lms.example.org node examples/relay.mjs
//
// Authenticate your player's requests in your own way before trusting `learner`: the relay vouches
// for every statement it sends in your institution's name.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createEmitter, createStatements } from "@learnerrecord/emitter";

const QUEUE_FILE = process.env.QUEUE_FILE ?? "./lpai-queue.json";
const store = {
  load: async () => { try { return JSON.parse(await readFile(QUEUE_FILE, "utf8")); } catch { return []; } },
  save: async (q) => { await writeFile(QUEUE_FILE, JSON.stringify(q)); },
};
const emitter = createEmitter({
  endpoint: process.env.LPAI_ENDPOINT, sensorToken: process.env.LPAI_SENSOR_TOKEN, store,
  onRejected: (r) => console.warn("refused by LPAI", r.map((x) => `${x.code}: ${x.message}`)),
  onAlignment: (a) => console.info("alignment", a.map((x) => `${x.content_ref} ${x.alignment_type ?? "none"}`)),
  onError: (e) => console.error(e.message),
});
const S = createStatements({ homePage: process.env.LMS_HOME_PAGE });

// One route per component event. The body carries the learner, the object and its hierarchy, the
// session (registration) and the content version, plus the event's own fields.
const build = {
  "page-viewed": (b) => S.pageViewed(b, b.durationMs),
  "video-played": (b) => S.video.played(b, b.at),
  "video-paused": (b) => S.video.paused(b, b.at, b.progress),
  "video-seeked": (b) => S.video.seeked(b, b.from, b.to),
  "video-completed": (b) => S.video.completed(b, b.durationMs),
  "card-flipped": (b) => S.flipCard.flipped(b),
  "card-self-check": (b) => S.flipCard.selfCheck(b, b.knewIt),
  "reacted": (b) => S.reacted(b, b.value),
  "favourited": (b) => S.favourited(b),
  "item-answered": (b) => S.itemAnswered(b, b),
};
createServer(async (req, res) => {
  const kind = req.url?.replace(/^\/events\//, "");
  if (req.method !== "POST" || !build[kind]) { res.writeHead(404).end(); return; }
  let body = ""; for await (const c of req) body += c;
  try { const id = await emitter.emit(build[kind](JSON.parse(body))); res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ id })); }
  catch (e) { res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message })); }
}).listen(process.env.PORT ?? 8787);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await emitter.close().catch(() => {}); process.exit(0); });

# @learnerrecord/emitter

Send a learning platform's activity to **LPAI**, the Learning Logbook, as xAPI statements. LPAI keeps one learner-owned record per learner across every institution and tool they use.

This package is the reference client. The integration contract itself doesn't depend on any language, so any xAPI client works:

| Part of the contract | Where it lives |
|---|---|
| The LPAI xAPI profile | `https://id.learnerrecord.org/xapi/profile` |
| JSON Schemas | `https://id.learnerrecord.org/schemas/` |
| OpenAPI description | `https://id.learnerrecord.org/openapi/v1.json` |

The identifiers are permanent, and each address serves its document.

> **Pre-release (0.x).** The API may still change; see the [CHANGELOG](CHANGELOG.md). Install from the `next` tag.

```sh
npm install @learnerrecord/emitter@next
```

## Run it server-side

The emitter holds your **sensor token**. Anyone with the token can send evidence in your institution's name, so the emitter belongs in your backend: a small relay your course player posts to.

**Never put the token in a browser.** See `examples/relay.mjs`.

## Quick start

```js
import { createEmitter, createStatements } from "@learnerrecord/emitter";

const emitter = createEmitter({
  endpoint: process.env.LPAI_ENDPOINT,      // https://<project>.supabase.co/functions/v1/lpai-v1
  sensorToken: process.env.LPAI_SENSOR_TOKEN,
  onRejected: (r) => console.warn("LPAI refused", r),
  onError: (e) => console.error(e),
});
const S = createStatements({ homePage: "https://lms.example.org" }); // your identifier namespace

const where = {
  learner: "student-42",                                  // the learner's account name in your system
  object: { id: "https://lms.example.org/c/1/u/2/video/7", name: "Ratios: an introduction" },
  hierarchy: { course: "https://lms.example.org/c/1", unit: "https://lms.example.org/c/1/u/2" },
  registration: sessionId,                                // the same for every statement of one sitting
  contentVersion: "sha256:3f9a…",                         // what the learner actually saw
};

await emitter.emit(S.video.played(where, 0));
await emitter.emit(S.video.seeked(where, 95, 40));
await emitter.emit(S.video.paused(where, 130, 0.55));
await emitter.emit(S.itemAnswered({ ...where, object: { id: "https://lms.example.org/items/q9" } },
  { success: true, score: 0.8, durationMs: 41_000, attempt: 1, hintsUsed: 0, assistance: "none" }));
await emitter.close(); // flush on shutdown
```

## What each builder sends, and what LPAI makes of it

| Builder | xAPI verb | In LPAI |
|---|---|---|
| `itemAnswered` | `answered` | An `assessment.response.v1` event: evidence for the skills the item addresses. Attempt, hints and assistance are recorded too. |
| `pageViewed`, `documentViewed`, `flipCard.flipped`, `assistantExchange` | `experienced`, `interacted` | Session activity on that resource type. |
| `video.played`, `video.paused`, `video.seeked` | ADL video profile | Session activity with progress, plays and seeks back. |
| `video.completed` | `completed` (no score) | Closes the session at full completion. |
| `started`, `ended` | `initialized`, `terminated` | Open and close a session. |
| `flipCard.selfCheck` | LPAI `self-checked` | An organic `sense_check`: the learner's own "I knew it". |
| `reacted`, `favourited` | LPAI `reacted` | An organic `reaction`. |

A session is identified by `registration`. Its content node is the nearest container in `hierarchy`. When the session closes, LPAI writes one rollup per session: engaged time, resource type, completion, rewatch ratio and revisits. It never stores individual clicks.

## Identity: your namespace

Your `homePage` is your **identifier namespace**. An LPAI engineer registers it for your institution, and the learners you provision are bound within it. Two institutions can both have a "student-42" without colliding.

The same person at two institutions can link both accounts to their one LPAI record. That linking is done by the learner, never by matching personal data.

## Delivery

Statements are sent in order, at least once.

- **Duplicates are harmless.** Every statement keeps its id across retries, so LPAI treats a resend as a duplicate, never a second event.
- **Transient failures are retried.** On a 429, a 5xx or a dropped connection, the emitter retries with exponential backoff and honours `Retry-After`. After `retry.maxAttempts` the batch stays queued and `flush()` throws.
- **Refused statements are isolated.** If LPAI refuses a batch (400, 404, 409, 413 or 422), the emitter splits it until it finds the refused statement. That statement goes to `onRejected` and the rest are sent.
- **A refused sensor stops delivery.** On a 401 or 403, the queue is kept.

The default queue lives in memory. A relay should pass a `store` with `load()` and `save()`, backed by a file, Redis or your database, so a restart loses nothing.

## Outcomes and alignment

`onOutcomes` receives each statement's outcome from the `x-lpai-outcomes` response header: `sealed`, `held` (the learner is not yet bound in your namespace), `unmapped` (stored, but the verb is not yet mapped) or `duplicate`. `flush()` returns them too.

`onAlignment` receives the `x-lpai-alignment` response header: how the content your statements named is mapped to skills in LPAI's content registry, at what authority, and what that authority serves (engagement, proficiency, readiness, gating, credentials). LPAI sends a content version's status once per sensor and again whenever it changes (a new ETag); the emitter also de-duplicates by ETag. A status block lists `mapping_status` (`none`, `provisional`, `inferred`, `effective`), `alignment_type`, `authority`, `usable_for` and the skills with their roles and weights. When the header would pass 8 KB, LPAI sends part of it and `x-lpai-alignment-truncated: 1`; read the rest with `POST /v1/content/alignment/lookup`. An authoring tool registers content and declares its skills itself (the integrator guide, section 6).

## Native events

`emitEvent` sends a native LPAI event (not xAPI), signed with your tenant's registered Ed25519 key (`options.tenant`, see `importTenantKey`).

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

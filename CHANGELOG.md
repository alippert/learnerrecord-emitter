# Changelog

## 0.5.0 (2026-10-30), pre-release

First release, published under the `next` tag. It tracks LPAI contract 0.5.0.

- `createEmitter`:
  - batching (1 to 100 statements a request);
  - delivery in order, at least once;
  - retries with backoff and `Retry-After`;
  - a refused batch is split until the refused statement is found;
  - a refused sensor stops delivery and keeps the queue;
  - a pluggable queue store;
  - outcome and alignment callbacks.
- `createStatements`: builders for pages, documents, video (the ADL video profile), flip cards, self-checks, reactions, favourites, scored answers (with attempt, hints and assistance), sessions, and assistant exchanges. The content hierarchy and the content version travel as context.
- `emitEvent` and `tenantAssertion`: native LPAI events signed with the tenant's Ed25519 key.
- LPAI's permanent identifiers under `https://id.learnerrecord.org`.

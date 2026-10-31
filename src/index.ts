// @learnerrecord/emitter: send a learning platform's activity to LPAI (the Learning Logbook) as
// xAPI statements. See README.md.
export { createEmitter, validate, QueueFullError, type Emitter, type EmitterOptions } from "./emitter.js";
export { createStatements, isoDuration, type StatementTarget, type Statements } from "./statements.js";
export { tenantAssertion, importTenantKey, type TenantKey } from "./jws.js";
export * from "./ids.js";
export type * from "./types.js";

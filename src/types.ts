// The shapes the emitter sends and receives. A Statement is an xAPI 1.0.3 statement; the pack's
// outcome and alignment headers are LPAI's.
export interface Statement {
  id: string;
  timestamp: string;
  actor: { objectType?: "Agent"; account: { homePage: string; name: string } };
  verb: { id: string; display?: Record<string, string> };
  object: { objectType?: "Activity"; id: string; definition?: { type?: string; name?: Record<string, string>; extensions?: Record<string, unknown> } };
  result?: { score?: { scaled?: number; raw?: number; min?: number; max?: number }; success?: boolean; completion?: boolean; response?: string; duration?: string; extensions?: Record<string, unknown> };
  context?: { registration?: string; contextActivities?: { parent?: { id: string }[]; grouping?: { id: string }[]; category?: { id: string }[]; other?: { id: string }[] }; extensions?: Record<string, unknown> };
}
/** What the pack did with one statement (the x-lpai-outcomes header). */
export interface Outcome { id: string; status: "sealed" | "held" | "unmapped" | "duplicate"; event_id?: string; mapped_to?: string | null }
/** The registered mapping's status for one content version (the x-lpai-alignment header; plan item 2). */
export interface AlignmentStatus {
  content_ref: string; content_version: string | null;
  mapping_status: "none" | "provisional" | "inferred" | "effective"; mapping_version: number;
  alignment_type: string | null; authority: number; authority_required: Record<string, string>; usable_for: string[];
  skills: { kc_id: string; role: string; weight: number }[]; etag: string;
}
/** A statement the service would not take, with the reason, after the batch it was in was split to find it. */
export interface Rejected { statement: Statement; status: number; code: string; message: string }
export interface FlushResult { sent: number; outcomes: Outcome[]; rejected: Rejected[]; pending: number }

/** Where queued statements wait. The default keeps them in memory; a relay should persist them. */
export interface QueueStore {
  load(): Promise<Statement[]>;
  save(queue: Statement[]): Promise<void>;
}
/** The content hierarchy a statement sits in, outermost first. Any level may be omitted. */
export interface Hierarchy { course?: string; unit?: string; lesson?: string; section?: string; module?: string; activity?: string; page?: string }

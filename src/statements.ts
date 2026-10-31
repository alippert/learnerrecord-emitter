// Statement builders for a course player's components. Each returns an xAPI statement in the shape
// LPAI's pack maps: the verb the crosswalk knows, the activity type the resource type vocabulary
// knows, the hierarchy as context (parent: the nearest container, the session's content node;
// grouping: the containers above it), and the content version as a context extension.
import { ADL, ASSISTANCE_KINDS, XAPI_EXTENSIONS, XAPI_VERBS, activityTypeOf, type AssistanceKind, type ResourceType } from "./ids.js";
import type { Hierarchy, Statement } from "./types.js";

export interface StatementTarget {
  /** The learner's identifier in your system: the account name under your homePage. */
  learner: string;
  /** The activity: its stable IRI, and optionally a display name. */
  object: { id: string; name?: string };
  /** Where the object sits in your content hierarchy. */
  hierarchy?: Hierarchy;
  /** The session (an xAPI registration): every statement of one sitting carries the same value. */
  registration?: string;
  /** The content version (a hash or a version label) of the object as the learner saw it. */
  contentVersion?: string;
  /** Skills the object addresses, if your system knows them (LPAI's registry maps content otherwise). */
  kcRefs?: { ref: string; confidence: number }[];
  /** When it happened; now by default. */
  at?: Date;
}

const LEVELS: (keyof Hierarchy)[] = ["course", "unit", "lesson", "section", "module", "activity", "page"];
/** ISO 8601 duration from milliseconds ("PT1M30.5S"). */
export function isoDuration(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = Math.round((total % 60) * 1000) / 1000;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}

export function createStatements(opts: { homePage: string; uuid?: () => string; now?: () => Date }) {
  const uuid = opts.uuid ?? (() => crypto.randomUUID());
  const now = opts.now ?? (() => new Date());

  function base(t: StatementTarget, verb: string, type: string, extra: Partial<Statement> = {}): Statement {
    const containers = LEVELS.map((l) => t.hierarchy?.[l]).filter((x): x is string => !!x && x !== t.object.id);
    const parent = containers.at(-1);
    const grouping = containers.slice(0, -1);
    const extensions: Record<string, unknown> = { ...(extra.context?.extensions ?? {}) };
    if (t.contentVersion) extensions[XAPI_EXTENSIONS.content_version] = t.contentVersion;
    const definition: NonNullable<Statement["object"]["definition"]> = { type, ...(t.object.name ? { name: { en: t.object.name } } : {}) };
    if (t.kcRefs?.length) definition.extensions = { [XAPI_EXTENSIONS.kc_refs]: t.kcRefs };
    const s: Statement = {
      id: uuid(), timestamp: (t.at ?? now()).toISOString(),
      actor: { objectType: "Agent", account: { homePage: opts.homePage, name: t.learner } },
      verb: { id: verb, display: { en: verb.split("/").at(-1) ?? verb } },
      object: { objectType: "Activity", id: t.object.id, definition },
      ...(extra.result ? { result: extra.result } : {}),
    };
    const context: NonNullable<Statement["context"]> = {};
    if (t.registration) context.registration = t.registration;
    if (parent) context.contextActivities = { parent: [{ id: parent }], ...(grouping.length ? { grouping: grouping.map((id) => ({ id })) } : {}) };
    if (Object.keys(extensions).length) context.extensions = extensions;
    if (Object.keys(context).length) s.context = context;
    return s;
  }
  const v = (name: string) => `${ADL.verbs}${name}`;
  const typed = (rt: ResourceType) => activityTypeOf(rt);

  return {
    /** A session begins on a resource (opens it). */
    started: (t: StatementTarget, resource: ResourceType = "page") => base(t, v("initialized"), typed(resource)),
    /** The session ends; duration is engaged time if you know it. */
    ended: (t: StatementTarget, resource: ResourceType = "page", durationMs?: number) => base(t, v("terminated"), typed(resource), durationMs !== undefined ? { result: { duration: isoDuration(durationMs) } } : {}),
    pageViewed: (t: StatementTarget, durationMs?: number) => base(t, v("experienced"), typed("page"), durationMs !== undefined ? { result: { duration: isoDuration(durationMs) } } : {}),
    documentViewed: (t: StatementTarget, durationMs?: number) => base(t, v("experienced"), typed("document"), durationMs !== undefined ? { result: { duration: isoDuration(durationMs) } } : {}),
    video: {
      played: (t: StatementTarget, atSeconds: number) => base(t, ADL.video.played, ADL.video.activity_type, { result: { extensions: { [ADL.video.time]: atSeconds } } }),
      paused: (t: StatementTarget, atSeconds: number, progress?: number) => base(t, ADL.video.paused, ADL.video.activity_type, { result: { extensions: { [ADL.video.time]: atSeconds, ...(progress !== undefined ? { [ADL.video.progress]: clamp01(progress) } : {}) } } }),
      seeked: (t: StatementTarget, fromSeconds: number, toSeconds: number) => base(t, ADL.video.seeked, ADL.video.activity_type, { result: { extensions: { [ADL.video.time_from]: fromSeconds, [ADL.video.time_to]: toSeconds } } }),
      /** Watched to the end (or as far as counts as complete for you); closes the session. */
      completed: (t: StatementTarget, durationMs?: number) => base(t, v("completed"), ADL.video.activity_type, { result: { completion: true, extensions: { [ADL.video.progress]: 1 }, ...(durationMs !== undefined ? { duration: isoDuration(durationMs) } : {}) } }),
    },
    flipCard: {
      flipped: (t: StatementTarget) => base(t, v("interacted"), typed("flip_card")),
      /** The learner's own "I knew it" (true) or "I didn't" (false). */
      selfCheck: (t: StatementTarget, knewIt: boolean) => base(t, XAPI_VERBS.self_checked, typed("flip_card"), { result: { success: knewIt } }),
    },
    reacted: (t: StatementTarget, value: "up" | "down", resource: ResourceType = "page") => base(t, XAPI_VERBS.reacted, typed(resource), { result: { response: value } }),
    favourited: (t: StatementTarget, resource: ResourceType = "page") => base(t, XAPI_VERBS.reacted, typed(resource), { result: { response: "favourite" } }),
    /** A scored answer: the assessment evidence. Attempt, hints and assistance say how it was reached. */
    itemAnswered: (t: StatementTarget, a: { success?: boolean; score?: number; response?: string; durationMs?: number; attempt?: number; hintsUsed?: number; assistance?: AssistanceKind }) => {
      if (a.success === undefined && a.score === undefined) throw new Error("itemAnswered needs success or score");
      if (a.assistance !== undefined && !(ASSISTANCE_KINDS as readonly string[]).includes(a.assistance)) throw new Error(`assistance must be one of ${ASSISTANCE_KINDS.join(", ")}`);
      const ext: Record<string, unknown> = {};
      if (a.attempt !== undefined) ext[XAPI_EXTENSIONS.attempt] = a.attempt;
      if (a.hintsUsed !== undefined) ext[XAPI_EXTENSIONS.hints_used] = a.hintsUsed;
      if (a.assistance !== undefined) ext[XAPI_EXTENSIONS.assistance] = a.assistance;
      return base(t, v("answered"), typed("assessment_item"), { result: {
        ...(a.success !== undefined ? { success: a.success } : {}), ...(a.score !== undefined ? { score: { scaled: clamp01(a.score) } } : {}),
        ...(a.response !== undefined ? { response: a.response } : {}), ...(a.durationMs !== undefined ? { duration: isoDuration(a.durationMs) } : {}),
        ...(Object.keys(ext).length ? { extensions: ext } : {}) } });
    },
    /** A turn with an AI assistant (Sage): session activity on an assistant resource until item 12 maps exchanges as evidence. */
    assistantExchange: (t: StatementTarget, durationMs?: number) => base(t, v("interacted"), typed("assistant"), durationMs !== undefined ? { result: { duration: isoDuration(durationMs) } } : {}),
  };
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export type Statements = ReturnType<typeof createStatements>;

// LPAI's permanent identifiers (https://id.learnerrecord.org), as the service's contract defines them.
// Copied here so the package has no dependencies; test/ids.test.ts keeps the two in step.
export const ID_BASE = "https://id.learnerrecord.org";
export const XAPI_PROFILE_ID = `${ID_BASE}/xapi/profile`;
export const XAPI_EXTENSIONS = {
  kc_refs: `${ID_BASE}/xapi/extensions/kc-refs`,
  content_version: `${ID_BASE}/xapi/extensions/content-version`,
  attempt: `${ID_BASE}/xapi/extensions/attempt`,
  hints_used: `${ID_BASE}/xapi/extensions/hints-used`,
  assistance: `${ID_BASE}/xapi/extensions/assistance`,
  resource_type: `${ID_BASE}/xapi/extensions/resource-type`,
} as const;
export const XAPI_VERBS = {
  reacted: `${ID_BASE}/xapi/verbs/reacted`,
  self_checked: `${ID_BASE}/xapi/verbs/self-checked`,
} as const;
export const XAPI_ACTIVITY_TYPE_BASE = `${ID_BASE}/xapi/activity-types/`;
/** ADL's verbs and the ADL video profile (https://w3id.org/xapi/video). */
export const ADL = {
  verbs: "http://adlnet.gov/expapi/verbs/",
  video: {
    played: "https://w3id.org/xapi/video/verbs/played",
    paused: "https://w3id.org/xapi/video/verbs/paused",
    seeked: "https://w3id.org/xapi/video/verbs/seeked",
    activity_type: "https://w3id.org/xapi/video/activity-type/video",
    time: "https://w3id.org/xapi/video/extensions/time",
    time_from: "https://w3id.org/xapi/video/extensions/time-from",
    time_to: "https://w3id.org/xapi/video/extensions/time-to",
    progress: "https://w3id.org/xapi/video/extensions/progress",
    length: "https://w3id.org/xapi/video/extensions/length",
  },
} as const;
export const RESOURCE_TYPES = ["page", "video", "audio", "document", "flip_card", "interactive", "simulation", "assessment_item", "assistant", "discussion", "external_link", "other"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export const ASSISTANCE_KINDS = ["none", "hint", "worked_solution", "assistant"] as const;
export type AssistanceKind = (typeof ASSISTANCE_KINDS)[number];
/** The activity type IRI LPAI's profile defines for a resource type. */
export const activityTypeOf = (t: ResourceType): string => `${XAPI_ACTIVITY_TYPE_BASE}${t.replace(/_/g, "-")}`;

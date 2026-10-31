// The statements' own shape. That every builder's statement passes the service's checks and maps
// through its crosswalk is checked in the service repository, against this package as published.
import { describe, expect, it } from "vitest";
import { createStatements, isoDuration } from "../src/index.ts";

const S = createStatements({ homePage: "https://lms.test", now: () => new Date("2026-10-30T10:00:00Z") });
const t = { learner: "s-1", object: { id: "https://lms.test/c/1/u/2/l/3/video/7", name: "Ratios intro" }, hierarchy: { course: "https://lms.test/c/1", unit: "https://lms.test/c/1/u/2", lesson: "https://lms.test/c/1/u/2/l/3" }, registration: "reg-1", contentVersion: "sha256:abc", kcRefs: [{ ref: "math.6.ratios", confidence: 0.9 }] };

describe("statements", () => {
  it("context: the nearest container is the parent, the rest grouping, plus the content version", () => {
    expect(S.pageViewed(t, 45_000).context).toEqual({ registration: "reg-1", contextActivities: { parent: [{ id: "https://lms.test/c/1/u/2/l/3" }], grouping: [{ id: "https://lms.test/c/1" }, { id: "https://lms.test/c/1/u/2" }] }, extensions: { "https://id.learnerrecord.org/xapi/extensions/content-version": "sha256:abc" } });
  });
  it("an answer needs a score or a success", () => {
    expect(() => S.itemAnswered(t, {})).toThrow();
  });
  it("ISO 8601 durations", () => {
    expect(isoDuration(0)).toBe("PT0S"); expect(isoDuration(90_500)).toBe("PT1M30.5S"); expect(isoDuration(3_600_000)).toBe("PT1H");
  });
});

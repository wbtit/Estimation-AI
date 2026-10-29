import { describe, expect, it } from "vitest";
import { NO_SESSION_TEXT, pingDue, sessionText, timingCsvUrl } from "./session";

describe("work session header", () => {
  it("shows the actor and short id, or the no-session state", () => {
    expect(sessionText(null)).toBe("No session: actions count as owner");
    expect(NO_SESSION_TEXT).toContain("owner");
    const s = {
      id: "a1b2c3d4-0000-0000-0000-000000000000",
      short_id: "a1b2c3d4",
      actor: "estimator" as const,
      started_at: "2026-10-29T10:00:00Z",
      ended_at: null,
    };
    expect(sessionText(s)).toBe("Estimator session · a1b2c3d4");
    expect(sessionText({ ...s, actor: "owner" })).toBe(
      "Owner session · a1b2c3d4",
    );
    expect(timingCsvUrl(s.id)).toBe(`/api/sessions/${s.id}/timing.csv`);
  });

  it("pings only after input and at most every 30 s", () => {
    expect(pingDue(40_000, 35_000, 0)).toBe(true);
    expect(pingDue(20_000, 15_000, 0)).toBe(false); // too soon
    expect(pingDue(90_000, 0, 10)).toBe(false); // no input since the last ping
  });
});

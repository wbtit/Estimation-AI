// @vitest-environment jsdom
// Phase 14f: a page with no lines gets them prepared on open (one POST), polled until ready.
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSheetLines } from "./useSheetLines";

afterEach(() => vi.unstubAllGlobals());

const LINES = {
  version: "v",
  classes: ["k"],
  n_lines: 1,
  lines: [[0, 0, 1, 0, 0, 1]],
};
const BASE = "/api/projects/p1/sheets/s1";

/** fetch: GET lines is 404 until `readyAfter` GETs, prepare answers queued. */
function stub(readyAfter: number, prepareOk = true) {
  const calls: string[] = [];
  let gets = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const m = init?.method ?? "GET";
      calls.push(`${m} ${url}`);
      let status = 404;
      let body: unknown = {
        error: "the lines of this sheet are not extracted yet",
      };
      if (m === "GET" && url === `${BASE}/lines`) {
        gets += 1;
        if (gets > readyAfter) {
          status = 200;
          body = LINES;
        }
      } else if (m === "POST" && url === `${BASE}/lines/prepare`) {
        status = prepareOk ? 202 : 409;
        body = prepareOk
          ? { status: "queued", job_id: "j" }
          : { error: "the PDF scan is not finished" };
      }
      return {
        ok: status < 400,
        status,
        statusText: "",
        text: async () => JSON.stringify(body),
      };
    }),
  );
  return calls;
}

describe("useSheetLines", () => {
  it("loads the lines of a page that has them, without preparing", async () => {
    const calls = stub(0);
    const { result } = renderHook(() =>
      useSheetLines("p1", "s1", { intervalMs: 1 }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.lines?.lines).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  it("prepares once and polls until the lines are there", async () => {
    const calls = stub(3);
    const seen: string[] = [];
    const { result } = renderHook(() => {
      const r = useSheetLines("p1", "s1", { intervalMs: 1 });
      if (seen.at(-1) !== r.status) seen.push(r.status);
      return r;
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(seen).toContain("preparing"); // "Preparing lines…" was shown
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([
      `POST ${BASE}/lines/prepare`,
    ]);
    expect(result.current.lines?.version).toBe("v");
  });

  it("gives up after the polls (Retry prepares again) and never prepares a raster page", async () => {
    const calls = stub(1000);
    const { result } = renderHook(() =>
      useSheetLines("p1", "s1", { intervalMs: 1, maxTries: 3 }),
    );
    await waitFor(() => expect(result.current.status).toBe("failed"));
    void result.current.prepare();
    await waitFor(() =>
      expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(2),
    );
    vi.unstubAllGlobals();
    const raster = stub(1000);
    const r = renderHook(() =>
      useSheetLines("p1", "s1", { vector: false, intervalMs: 1 }),
    );
    await waitFor(() => expect(r.result.current.status).toBe("idle"));
    expect(raster.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  it("a prepare the API refuses shows failed", async () => {
    stub(1000, false);
    const { result } = renderHook(() =>
      useSheetLines("p1", "s1", { intervalMs: 1 }),
    );
    await waitFor(() => expect(result.current.status).toBe("failed"));
  });
});

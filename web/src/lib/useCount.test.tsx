// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCount } from "./useCount";

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let responses: Record<string, unknown[]> = {};

beforeEach(() => {
  calls = [];
  responses = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const key = `${method} ${url}`;
      const queue = responses[key] ?? [{}];
      const body = queue.length > 1 ? queue.shift() : queue[0];
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const P = "p1";
const S = "s1";
function setup() {
  const onError = vi.fn();
  const afterChange = vi.fn(async () => undefined);
  const hook = renderHook(() =>
    useCount(P, S, " alice ", onError, afterChange),
  );
  return { hook, onError, afterChange };
}

describe("useCount", () => {
  it("loads the settings and sends a click with the kind, the point and the radii", async () => {
    responses[`GET /api/projects/${P}/count`] = [
      { count_mode: true, snap_radius_pt: 30, label_radius_pt: 90 },
    ];
    responses[`POST /api/projects/${P}/count/click`] = [
      { member: { id: "m1" }, snap: {}, size: {} },
    ];
    const { hook, afterChange } = setup();
    await waitFor(() =>
      expect(hook.result.current.settings.snap_radius_pt).toBe(30),
    );
    let id = "";
    await act(async () => {
      const r = await hook.result.current.place("Beams", 120.5, 300);
      id = r?.member.id ?? "";
    });
    expect(id).toBe("m1");
    const click = calls.find((c) => c.url.endsWith("/count/click"));
    expect(click?.body).toEqual({
      who: "alice",
      sheet_id: S,
      kind: "Beams",
      x: 120.5,
      y: 300,
      radius: 30,
      label_radius: 90,
    });
    expect(afterChange).toHaveBeenCalled();
  });

  it("accept, reject and redo go to the right routes and refresh the screen", async () => {
    const { hook, afterChange } = setup();
    await act(async () => {
      await hook.result.current.decide("m1", "accept");
      await hook.result.current.decide("m2", "reject");
      await hook.result.current.redo();
    });
    const urls = calls
      .filter((c) => c.method === "POST")
      .map((c) => `${c.url} ${JSON.stringify(c.body)}`);
    expect(urls).toContain(
      `/api/projects/${P}/members/m1/count-decision {"who":"alice","decision":"accept"}`,
    );
    expect(urls).toContain(
      `/api/projects/${P}/members/m2/count-decision {"who":"alice","decision":"reject"}`,
    );
    expect(urls).toContain(`/api/projects/${P}/redo {"who":"alice"}`);
    expect(afterChange).toHaveBeenCalledTimes(3);
  });

  it("asks for the sheet's lines until they are ready, then loads them once and keeps them", async () => {
    responses[`POST /api/projects/${P}/sheets/${S}/lines/prepare`] = [
      { status: "queued" },
      { status: "ready" },
    ];
    responses[`GET /api/projects/${P}/sheets/${S}/lines`] = [
      { version: "v1", lines: [[0, 0, 10, 0, 0, 1]] },
    ];
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const { hook } = setup();
      let p: Promise<void>;
      act(() => {
        p = hook.result.current.ensureLines();
      });
      expect(hook.result.current.linesState).toBe("preparing");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
        await p;
      });
      expect(hook.result.current.linesState).toBe("ready");
      expect(hook.result.current.lines).toHaveLength(1);
      const before = calls.length;
      await act(async () => {
        await hook.result.current.ensureLines(); // cached: no new request
      });
      expect(calls.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("measure preview and save send the raw clicks; attach sends the measurement id", async () => {
    responses[`POST /api/projects/${P}/measure`] = [
      { length_mm: 10, length_ft_in: "0'-0\"" },
    ];
    responses[`POST /api/projects/${P}/measurements`] = [
      { id: "meas1", length_mm: 10, length_ft_in: "x" },
    ];
    const { hook } = setup();
    const a = { x: 1, y: 2 };
    const b = { x: 3, y: 4 };
    await act(async () => {
      await hook.result.current.preview(a, b);
      const saved = await hook.result.current.saveMeasurement(a, b);
      expect(saved?.id).toBe("meas1");
      await hook.result.current.attach("m1", "meas1");
    });
    expect(calls.find((c) => c.url.endsWith("/measure"))?.body).toEqual({
      sheet_id: S,
      a,
      b,
    });
    expect(calls.find((c) => c.url.endsWith("/measurements"))?.body).toEqual({
      who: "alice",
      sheet_id: S,
      a,
      b,
    });
    expect(
      calls.find((c) => c.url.endsWith("/attach-measurement"))?.body,
    ).toEqual({ who: "alice", measurement_id: "meas1" });
  });

  it("an error is reported and nothing else happens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "no" }), { status: 409 }),
      ),
    );
    const { hook, onError, afterChange } = setup();
    await act(async () => {
      expect(await hook.result.current.place("Beams", 1, 1)).toBeNull();
    });
    expect(onError).toHaveBeenCalled();
    expect(afterChange).not.toHaveBeenCalled();
  });
});

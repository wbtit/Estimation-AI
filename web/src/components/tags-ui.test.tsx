// @vitest-environment jsdom
// Phase 14f: Renumber tags and the check before an Excel export; duplicate tags shown red (SYNTHETIC).
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TAG_GAPS_ASK,
  tagAskText,
  tagsNeedRenumber,
  type Piece,
} from "../lib/lf";
import { PieceMark } from "./Canvas";
import { useTagRenumber } from "./TagRenumber";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const key = `${init?.method ?? "GET"} ${url}`;
      const hit = Object.keys(routes).find((k) => key.startsWith(k));
      return {
        ok: hit !== undefined,
        status: hit === undefined ? 404 : 200,
        statusText: "",
        text: async () => JSON.stringify(hit === undefined ? {} : routes[hit]),
      };
    }),
  );
  return calls;
}

const URL = "/api/projects/p1/tags/renumber";
const HREF = "/api/projects/p1/line-first/bom.xlsx?who=t";

const Harness: React.FC<{ go: (h: string) => void; refresh?: () => void }> = ({
  go,
  refresh = () => undefined,
}) => {
  const { startExport, askRenumber, dialog } = useTagRenumber({
    projectId: "p1",
    who: "t",
    say: () => undefined,
    fail: () => undefined,
    refresh,
    go,
  });
  return (
    <div>
      <button onClick={() => void startExport(HREF)}>export</button>
      <button onClick={() => void askRenumber()}>renumber menu</button>
      {dialog}
    </div>
  );
};

describe("renumber text", () => {
  it("asks only when a tag would change or is a duplicate", () => {
    const none = { changes: 0, by_prefix: {}, duplicates: 0 };
    expect(tagsNeedRenumber(none)).toBe(false);
    expect(tagsNeedRenumber({ ...none, duplicates: 2 })).toBe(true);
    expect(
      tagAskText({ changes: 13, by_prefix: { C: 13 }, duplicates: 2 }),
    ).toBe(
      "13 tags would change; 2 pieces have a duplicate tag. Renumbering is one action: Undo puts every tag back. Tags a person typed are not changed.",
    );
  });
});

describe("export with the tag check", () => {
  it("exports at once when the tags have no gaps", async () => {
    stubFetch({ [`GET ${URL}`]: { changes: 0, by_prefix: {}, duplicates: 0 } });
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("export"));
    await waitFor(() => expect(go).toHaveBeenCalledWith(HREF));
    expect(screen.queryByTestId("tag-ask")).toBeNull();
  });

  it("asks first; Renumber and export renumbers as the person, refreshes, then exports", async () => {
    const calls = stubFetch({
      [`GET ${URL}`]: { changes: 13, by_prefix: { C: 13 }, duplicates: 0 },
      [`POST ${URL}`]: { action_id: "x", changed: 13 },
    });
    const go = vi.fn();
    const refresh = vi.fn();
    render(<Harness go={go} refresh={refresh} />);
    fireEvent.click(screen.getByText("export"));
    const ask = await screen.findByTestId("tag-ask");
    expect(ask.textContent).toContain(TAG_GAPS_ASK);
    expect(go).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Renumber and export"));
    await waitFor(() => expect(go).toHaveBeenCalledWith(HREF));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ who: "t" });
    expect(refresh).toHaveBeenCalled();
  });

  it("Export as is skips the renumber; Cancel does nothing", async () => {
    const calls = stubFetch({
      [`GET ${URL}`]: { changes: 0, by_prefix: {}, duplicates: 2 },
    });
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("export"));
    fireEvent.click(await screen.findByText("Cancel"));
    expect(screen.queryByTestId("tag-ask")).toBeNull();
    fireEvent.click(screen.getByText("export"));
    fireEvent.click(await screen.findByText("Export as is"));
    expect(go).toHaveBeenCalledWith(HREF);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("the menu item renumbers without exporting", async () => {
    stubFetch({
      [`GET ${URL}`]: { changes: 3, by_prefix: { C: 3 }, duplicates: 0 },
      [`POST ${URL}`]: { action_id: "x", changed: 3 },
    });
    const go = vi.fn();
    render(<Harness go={go} />);
    fireEvent.click(screen.getByText("renumber menu"));
    fireEvent.click(await screen.findByText("Renumber"));
    await waitFor(() => expect(screen.queryByTestId("tag-ask")).toBeNull());
    expect(go).not.toHaveBeenCalled();
  });
});

describe("duplicate tags on the canvas", () => {
  const column = (over: Partial<Piece>): Piece =>
    ({
      id: "c",
      member_id: "LF-C-1",
      sheet_id: "s1",
      type: "column",
      kind: "Column",
      tag: "CO7",
      quantity: 1,
      profile: null,
      profile_raw: null,
      studs: null,
      camber_raw: null,
      ignored: false,
      approved: false,
      deleted: false,
      added: false,
      edited: false,
      a: [100, 100],
      b: null,
      ends_moved: false,
      length_mm: null,
      build_state: "found",
      size_state: "sized",
      support_state: null,
      scale_ratio: 96,
      evidence: null,
      ...over,
    }) as Piece;

  it("draws a duplicate tag red with the tooltip 'duplicate tag'", () => {
    const { container } = render(
      <svg>
        <PieceMark
          p={column({ duplicate_tag: true })}
          px={0.5}
          on={false}
          labels
          allSizes
        />
        <PieceMark
          p={column({ id: "d", tag: "CO8" })}
          px={0.5}
          on={false}
          labels
          allSizes
        />
      </svg>,
    );
    const texts = [...container.querySelectorAll("text")];
    const dup = texts.find((t) => t.textContent?.includes("CO7"))!;
    const ok = texts.find((t) => t.textContent?.includes("CO8"))!;
    expect(dup.getAttribute("fill")).toBe("var(--attention)");
    expect(dup.querySelector("title")?.textContent).toBe("duplicate tag");
    expect(ok.getAttribute("fill")).toBe("var(--column-id)");
    expect(ok.querySelector("title")).toBeNull();
  });
});

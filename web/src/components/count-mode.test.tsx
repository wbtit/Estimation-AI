// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CountLayer } from "./CountLayer";
import { CountPanel } from "./CountPanel";
import { SymbolOverlay } from "./SymbolOverlay";
import { DEFAULT_SETTINGS } from "../lib/count";
import type { KindInfo, MemberView } from "../lib/types";

afterEach(cleanup);

// SYNTHETIC members, only the fields the count components read
function piece(id: string, over: Record<string, unknown> = {}): MemberView {
  return {
    id,
    origin: "extracted",
    deleted: false,
    merged_into: null,
    not_member: null,
    existing: false,
    type: "beam",
    profile_raw: "W12x26",
    profile: "W12X26",
    quantity: 1,
    bbox: { x0: 100, y0: 90, x1: 140, y1: 100 },
    link: {
      source: "rule",
      confidence: "high",
      margin: 1,
      line: { p: [0, 120], q: [400, 120] },
      chosen_rank: 1,
      candidates: [],
    },
    status: { color: "green", confirmed: false, reasons: [] },
    human: "unreviewed",
    kind: { name: "Beams", scope: "main", state: "confirmed" },
    tag: { prefix: "B", number: 1, text: "B1", provisional: true },
    symbol_group: "linear",
    symbol_color: "green",
    counting: "counted",
    shared_line: null,
    length_ft_in: null,
    length_source: null,
    count: {
      state: "suggested",
      source: null,
      click: null,
      snapped: null,
      snapped_line: null,
      snapped_distance_pt: null,
      size_source: null,
      size_evidence: null,
    },
    ...over,
  } as unknown as MemberView;
}
const withCount = (state: string, extra: Record<string, unknown> = {}) => ({
  count: {
    state,
    source: state === "confirmed" ? "human_click" : null,
    click: null,
    snapped: true,
    snapped_line: null,
    snapped_distance_pt: 3,
    size_source: null,
    size_evidence: null,
    ...extra,
  },
});

const KINDS: KindInfo[] = [
  {
    kind: "Beams",
    scope: "main",
    symbol_group: "linear",
    prefix: "B",
    provisional: true,
    sort: 2,
  },
  {
    kind: "Column",
    scope: "main",
    symbol_group: "column",
    prefix: "C",
    provisional: true,
    sort: 1,
  },
  {
    kind: "Stair",
    scope: "misc",
    symbol_group: "other",
    prefix: "S",
    provisional: true,
    sort: 5,
  },
];

function panel(members: MemberView[], over: Record<string, unknown> = {}) {
  const calls = {
    onDecide: vi.fn(),
    onDelete: vi.fn(),
    onPatch: vi.fn(),
    onTool: vi.fn(),
    onKind: vi.fn(),
    onMode: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onAttach: vi.fn(),
    onSaveMeasure: vi.fn(),
    onSelect: vi.fn(),
    onRadius: vi.fn(),
    onScope: vi.fn(),
    onTypical: vi.fn(),
  };
  render(
    <CountPanel
      members={members}
      kinds={KINDS}
      settings={DEFAULT_SETTINGS}
      tool={null}
      kind="Beams"
      linesState="ready"
      selectedId={null}
      measure={{ text: null, saved: null }}
      who="alice"
      {...calls}
      {...over}
    />,
  );
  return calls;
}

describe("CountPanel", () => {
  it("shows confirmed pieces, undecided suggestions and rejected ones apart, with the running count", () => {
    panel([
      piece("c1", withCount("confirmed")),
      piece("c2", withCount("confirmed", { source: "suggestion_accepted" })),
      piece("s1", withCount("suggested")),
      piece("r1", withCount("rejected")),
    ]);
    expect(screen.getByTestId("count-summary").textContent).toContain(
      "2 confirmed",
    );
    expect(screen.getByTestId("count-summary").textContent).toContain(
      "1 suggested",
    );
    expect(
      within(screen.getByTestId("confirmed-list")).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(
      within(screen.getByTestId("suggested-list")).getAllByRole("listitem"),
    ).toHaveLength(1);
    expect(screen.getByTestId("by-size").textContent).toContain("W12X26: 2");
    // the rejected list is folded away until asked for
    expect(screen.queryByTestId("rejected-list")).toBeNull();
    fireEvent.click(screen.getByText(/Rejected \(1\)/));
    expect(screen.getByTestId("rejected-list")).toBeTruthy();
  });

  it("accept and reject are one click each on a suggestion", () => {
    const c = panel([piece("s1", withCount("suggested"))]);
    fireEvent.click(screen.getByTestId("accept"));
    expect(c.onDecide).toHaveBeenCalledWith("s1", "accept");
    fireEvent.click(screen.getByTestId("reject"));
    expect(c.onDecide).toHaveBeenCalledWith("s1", "reject");
  });

  it("a rejected suggestion can be restored", () => {
    const c = panel([piece("r1", withCount("rejected"))]);
    fireEvent.click(screen.getByText(/Rejected/));
    fireEvent.click(screen.getByText("Restore"));
    expect(c.onDecide).toHaveBeenCalledWith("r1", "reset");
  });

  it("says which rule filled the size and flags a blank size in amber; a typed size is sent as an edit", () => {
    const c = panel([
      piece(
        "a",
        withCount("confirmed", {
          size_source: "nearest_label",
          size_evidence: { member_id: "x", distance_pt: 46 },
        }),
      ),
      piece("b", {
        profile: null,
        profile_raw: null,
        tag: { text: "B2" },
        ...withCount("confirmed", { size_source: "none" }),
      }),
    ]);
    const notes = screen.getAllByTestId("size-note").map((n) => n.textContent);
    expect(notes[0]).toContain("nearest label (46 pt away)");
    expect(notes[1]).toContain("blank");
    const blank = screen.getByLabelText("size of B2") as HTMLInputElement;
    expect(blank.className).toContain("amber");
    fireEvent.change(blank, { target: { value: "W10x12" } });
    fireEvent.blur(blank);
    expect(c.onPatch).toHaveBeenCalledWith("b", { profile_text: "W10x12" });
  });

  it("the tag is editable and delete is a soft delete call", () => {
    const c = panel([piece("a", withCount("confirmed"))]);
    const tag = screen.getByLabelText("tag of B1") as HTMLInputElement;
    fireEvent.change(tag, { target: { value: "B9" } });
    fireEvent.blur(tag);
    expect(c.onPatch).toHaveBeenCalledWith("a", { tag_text: "B9" });
    fireEvent.click(screen.getByText("delete"));
    expect(c.onDelete).toHaveBeenCalledWith("a");
  });

  it("tools: count and measure toggles, kind choice with main kinds first, undo and redo", () => {
    const c = panel([]);
    fireEvent.click(screen.getByTestId("tool-count"));
    expect(c.onTool).toHaveBeenCalledWith("count");
    fireEvent.click(screen.getByTestId("tool-measure"));
    expect(c.onTool).toHaveBeenCalledWith("measure");
    const options = Array.from(
      (screen.getByLabelText("kind to count") as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).toEqual(["Column", "Beams", "Stair"]);
    fireEvent.change(screen.getByLabelText("kind to count"), {
      target: { value: "Column" },
    });
    expect(c.onKind).toHaveBeenCalledWith("Column");
    fireEvent.click(screen.getByText("Undo"));
    fireEvent.click(screen.getByText("Redo"));
    expect(c.onUndo).toHaveBeenCalled();
    expect(c.onRedo).toHaveBeenCalled();
  });

  it("the tools need a name; count mode is a checkbox that says what it changes", () => {
    const c = panel([], { who: "" });
    expect(
      (screen.getByTestId("tool-count") as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(c.onMode).toHaveBeenCalledWith(true);
    expect(screen.getByText(/confirmed pieces only/)).toBeTruthy();
  });

  it("the measure card saves, then attaches to the selected piece (never to a column)", () => {
    const beam = piece("a", withCount("confirmed"));
    const col = piece("col", { type: "column", ...withCount("confirmed") });
    const c = panel([beam, col], {
      measure: {
        text: "33'-4\" (10160 mm)",
        saved: { id: "m1", text: "33'-4\", 10160 mm" },
      },
      selectedId: "a",
    });
    fireEvent.click(screen.getByText("Save measurement"));
    expect(c.onSaveMeasure).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("attach"));
    expect(c.onAttach).toHaveBeenCalledWith("a");
    cleanup();
    panel([beam, col], {
      measure: { text: "x", saved: { id: "m1", text: "x" } },
      selectedId: "col",
    });
    expect((screen.getByTestId("attach") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("SymbolOverlay in count mode", () => {
  const render1 = (
    members: MemberView[],
    extra: Record<string, unknown> = {},
  ) =>
    render(
      <svg>
        <SymbolOverlay
          members={members}
          selectedId={null}
          zoom={1}
          highlight={null}
          onSelect={() => undefined}
          countMode
          {...extra}
        />
      </svg>,
    );

  it("undecided suggestions are dashed, confirmed pieces solid with a ring, rejected ones are not drawn", () => {
    render1([
      piece("s", withCount("suggested")),
      piece("c", withCount("confirmed")),
      piece("r", withCount("rejected")),
    ]);
    const symbols = screen.getAllByTestId("count-symbol");
    expect(symbols.map((s) => s.getAttribute("data-state")).sort()).toEqual([
      "confirmed",
      "suggested",
    ]);
    const suggested = symbols.find(
      (s) => s.getAttribute("data-state") === "suggested",
    ) as Element;
    expect(suggested.querySelector("[stroke-dasharray]")).not.toBeNull();
    const confirmed = symbols.find(
      (s) => s.getAttribute("data-state") === "confirmed",
    ) as Element;
    expect(confirmed.querySelector("[stroke-dasharray]")).toBeNull();
    expect(
      confirmed.querySelector('[data-testid="reviewed-ring"]'),
    ).not.toBeNull();
  });

  it("a clicked piece is drawn at the click, not in the middle of its line", () => {
    render1([
      piece("c", {
        ...withCount("confirmed", { click: { x: 55, y: 66, at: "t" } }),
      }),
    ]);
    expect(screen.getByTestId("count-symbol").getAttribute("transform")).toBe(
      "translate(55 66)",
    );
  });

  it("a click on a symbol goes to the count handler with the member", () => {
    const onSymbolClick = vi.fn();
    render1([piece("s", withCount("suggested"))], { onSymbolClick });
    fireEvent.click(screen.getByTestId("count-symbol"));
    expect(onSymbolClick).toHaveBeenCalledTimes(1);
    expect(onSymbolClick.mock.calls[0]?.[0].id).toBe("s");
  });
});

describe("CountLayer", () => {
  const measure = { a: null, b: null, aSnap: null, bSnap: null, text: null };

  it("draws nothing without a tool", () => {
    const { container } = render(
      <svg>
        <CountLayer
          tool={null}
          zoom={1}
          hover={null}
          hoverLine={null}
          hoverSnap={null}
          radiusPt={24}
          measure={measure}
        />
      </svg>,
    );
    expect(container.querySelector(".count-layer")).toBeNull();
  });

  it("count tool: highlights the line the click would snap to", () => {
    render(
      <svg>
        <CountLayer
          tool="count"
          zoom={1}
          hover={{ x: 10, y: 10 }}
          hoverLine={[0, 0, 100, 0, 0, 1]}
          hoverSnap={null}
          radiusPt={24}
          measure={measure}
        />
      </svg>,
    );
    expect(screen.getByTestId("snap-line").getAttribute("x2")).toBe("100");
  });

  it("measure tool: shows the snap marker BEFORE the click is confirmed (end point square, intersection cross), then the length", () => {
    const { rerender } = render(
      <svg>
        <CountLayer
          tool="measure"
          zoom={1}
          hover={{ x: 1, y: 1 }}
          hoverLine={null}
          hoverSnap={{ x: 0, y: 0, kind: "endpoint", distance: 1 }}
          radiusPt={12}
          measure={measure}
        />
      </svg>,
    );
    expect(screen.getByTestId("snap-endpoint")).toBeTruthy();
    rerender(
      <svg>
        <CountLayer
          tool="measure"
          zoom={1}
          hover={{ x: 1, y: 1 }}
          hoverLine={null}
          hoverSnap={{ x: 0, y: 0, kind: "intersection", distance: 1 }}
          radiusPt={12}
          measure={measure}
        />
      </svg>,
    );
    expect(screen.getByTestId("snap-intersection")).toBeTruthy();
    rerender(
      <svg>
        <CountLayer
          tool="measure"
          zoom={1}
          hover={null}
          hoverLine={null}
          hoverSnap={null}
          radiusPt={12}
          measure={{
            a: { x: 0, y: 0 },
            b: { x: 100, y: 0 },
            aSnap: { x: 0, y: 0, kind: "endpoint", distance: 0 },
            bSnap: null,
            text: "33'-4\"",
          }}
        />
      </svg>,
    );
    expect(screen.getByTestId("measure-text").textContent).toBe("33'-4\"");
  });
});

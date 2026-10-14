// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CountLayer } from "./CountLayer";
import { CountPanel } from "./CountPanel";
import { PilotSwitch } from "./PilotSwitch";
import { SheetNumber } from "./SheetNumber";
import { SymbolOverlay } from "./SymbolOverlay";
import {
  DEFAULT_SETTINGS,
  isUnlinkedSuggestion,
  pieceLists,
} from "../lib/count";
import type { KindInfo, MemberView } from "../lib/types";

afterEach(cleanup);

// SYNTHETIC members, only the fields the components read
function label(id: string, over: Record<string, unknown> = {}): MemberView {
  return {
    id,
    origin: "extracted",
    deleted: false,
    merged_into: null,
    not_member: null,
    existing: false,
    type: "beam",
    profile_raw: "W8x10",
    profile: "W8X10",
    quantity: 1,
    bbox: { x0: 100, y0: 90, x1: 140, y1: 100 },
    link: {
      source: "none",
      confidence: null,
      margin: null,
      line: null,
      chosen_rank: null,
      candidates: [],
    },
    status: {
      color: "unlinked",
      confirmed: false,
      reasons: ["no candidate line"],
    },
    human: "unreviewed",
    kind: { name: null, scope: "main", state: "missing" },
    tag: { prefix: null, number: null, text: "", provisional: true },
    symbol_group: "none",
    symbol_color: "grey",
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

const KINDS: KindInfo[] = [
  {
    kind: "Beams",
    scope: "main",
    symbol_group: "linear",
    prefix: "B",
    provisional: true,
    sort: 1,
  },
];

describe("unlinked size labels are amber suggestions in count mode", () => {
  it("only a live, undecided, extracted label with a parsed size counts as one", () => {
    expect(isUnlinkedSuggestion(label("a"))).toBe(true);
    expect(isUnlinkedSuggestion(label("b", { profile: null }))).toBe(false);
    expect(isUnlinkedSuggestion(label("c", { deleted: true }))).toBe(false);
    expect(
      isUnlinkedSuggestion(
        label("d", { count: { ...label("d").count, state: "rejected" } }),
      ),
    ).toBe(false);
    expect(isUnlinkedSuggestion(label("e", { origin: "manual" }))).toBe(false);
  });

  it("the lists keep them as suggestions in count mode and as unlinked labels otherwise", () => {
    const ms = [label("a"), label("b", { profile: null })];
    const on = pieceLists(ms, true);
    expect(on.suggested.map((m) => m.id)).toEqual(["a"]);
    expect(on.unlinked.map((m) => m.id)).toEqual(["b"]); // nothing is dropped
    const off = pieceLists(ms, false);
    expect(off.suggested).toEqual([]);
    expect(off.unlinked).toHaveLength(2);
  });

  it("is drawn as a dashed amber square, and a click decides it", () => {
    const onSymbolClick = vi.fn();
    const m = label("a");
    render(
      <svg>
        <SymbolOverlay
          members={[m]}
          selectedId={null}
          zoom={1}
          highlight={null}
          onSelect={() => undefined}
          countMode
          onSymbolClick={onSymbolClick}
        />
      </svg>,
    );
    const sq = screen.getByTestId("unlinked-suggestion");
    expect(sq.getAttribute("stroke-dasharray")).toBe("3 2");
    expect(sq.getAttribute("stroke")).toBe("#f0a30a");
    fireEvent.click(sq);
    expect(onSymbolClick).toHaveBeenCalledWith(m, expect.anything());
  });

  it("outside count mode it stays the red unlinked square", () => {
    render(
      <svg>
        <SymbolOverlay
          members={[label("a")]}
          selectedId={null}
          zoom={1}
          highlight={null}
          onSelect={() => undefined}
        />
      </svg>,
    );
    expect(screen.queryByTestId("unlinked-suggestion")).toBeNull();
    expect(screen.getByTestId("unlinked-square")).toBeTruthy();
  });

  it("the panel lists it among the suggestions with a no-line badge and Accept / Reject", () => {
    const onDecide = vi.fn();
    render(
      <CountPanel
        members={[label("a"), label("b", { profile: null })]}
        kinds={KINDS}
        settings={{ ...DEFAULT_SETTINGS, count_mode: true }}
        tool={null}
        kind="Beams"
        linesState="ready"
        selectedId={null}
        measure={{ text: null, saved: null }}
        who="alice"
        onMode={vi.fn()}
        onRadius={vi.fn()}
        onScope={vi.fn()}
        onTool={vi.fn()}
        onKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onSelect={vi.fn()}
        onDecide={onDecide}
        onDelete={vi.fn()}
        onPatch={vi.fn()}
        onSaveMeasure={vi.fn()}
        onAttach={vi.fn()}
        onTypical={vi.fn()}
      />,
    );
    expect(screen.getByTestId("no-line-badge")).toBeTruthy();
    expect(screen.getByTestId("count-summary").textContent).toContain(
      "1 suggested",
    );
    expect(screen.getByTestId("count-summary").textContent).toContain(
      "1 labels with no line",
    );
    fireEvent.click(screen.getByTestId("accept"));
    expect(onDecide).toHaveBeenCalledWith("a", "accept");
  });
});

describe("tag numbering setting and the Tab hint", () => {
  const props = (over: Record<string, unknown> = {}) => ({
    members: [] as MemberView[],
    kinds: KINDS,
    settings: { ...DEFAULT_SETTINGS, count_mode: true },
    tool: "count" as const,
    kind: "Beams",
    linesState: "ready" as const,
    selectedId: null,
    measure: { text: null, saved: null },
    who: "alice",
    onMode: vi.fn(),
    onRadius: vi.fn(),
    onScope: vi.fn(),
    onTool: vi.fn(),
    onKind: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSelect: vi.fn(),
    onDecide: vi.fn(),
    onDelete: vi.fn(),
    onPatch: vi.fn(),
    onSaveMeasure: vi.fn(),
    onAttach: vi.fn(),
    onTypical: vi.fn(),
    ...over,
  });

  it("the scope is a project setting: across the job by default, changeable to per sheet", () => {
    const p = props();
    render(<CountPanel {...p} />);
    const sel = screen.getByLabelText("tag numbering") as HTMLSelectElement;
    expect(sel.value).toBe("job");
    fireEvent.change(sel, { target: { value: "sheet" } });
    expect(p.onScope).toHaveBeenCalledWith("sheet");
  });

  it("the panel tells how to walk to the next line while counting", () => {
    render(<CountPanel {...props()} />);
    expect(screen.getByTestId("count-summary").textContent).toContain("Tab");
  });

  it("the layer says which of the lines under the pointer is shown", () => {
    render(
      <svg>
        <CountLayer
          tool="count"
          zoom={1}
          hover={{ x: 50, y: 50 }}
          hoverLine={[0, 50, 100, 50]}
          hoverSnap={null}
          radiusPt={24}
          measure={{ a: null, b: null, aSnap: null, bSnap: null, text: null }}
          candidate={{ index: 1, total: 3 }}
        />
      </svg>,
    );
    expect(screen.getByTestId("snap-candidate-hint").textContent).toContain(
      "line 2 of 3",
    );
  });

  it("no hint when there is only one line to snap to", () => {
    render(
      <svg>
        <CountLayer
          tool="count"
          zoom={1}
          hover={{ x: 50, y: 50 }}
          hoverLine={[0, 50, 100, 50]}
          hoverSnap={null}
          radiusPt={24}
          measure={{ a: null, b: null, aSnap: null, bSnap: null, text: null }}
          candidate={{ index: 0, total: 1 }}
        />
      </svg>,
    );
    expect(screen.queryByTestId("snap-candidate-hint")).toBeNull();
  });
});

describe("the pilot switch", () => {
  it("is off by default and asks for a change; it needs a name", () => {
    const onChange = vi.fn();
    const { rerender } = render(<PilotSwitch on={false} onChange={onChange} />);
    const sw = screen.getByRole("switch", {
      name: /pilot/,
    }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    expect(screen.getByText(/pilot off/)).toBeTruthy();
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<PilotSwitch on onChange={onChange} />);
    expect(screen.getByText(/pilot on/)).toBeTruthy();
    rerender(<PilotSwitch on={false} disabled onChange={onChange} />);
    expect((screen.getByRole("switch") as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it("DEFAULT_SETTINGS keep the pilot off", () => {
    expect(DEFAULT_SETTINGS.count_mode).toBe(false);
    expect(DEFAULT_SETTINGS.tag_scope).toBe("job");
  });
});

describe("the sheet number in the sheet list", () => {
  it("shows a title-block number plainly, with the earlier reading in the tooltip", () => {
    render(<SheetNumber value="S4-01" flag="title_block" earlier="S4" />);
    const el = screen.getByTestId("sheet-number");
    expect(el.textContent).toContain("S4-01");
    expect(el.getAttribute("title")).toContain("earlier reading was S4");
  });

  it("flags the earlier reading shown as a fallback", () => {
    render(<SheetNumber value="S101" flag="fallback_old" />);
    const el = screen.getByTestId("sheet-number-fallback");
    expect(el.textContent).toContain("earlier reading");
    expect(el.getAttribute("title")).toContain("No title-block sheet number");
  });

  it("says so when there is no number", () => {
    render(<SheetNumber value={null} />);
    expect(screen.getByText("no sheet number")).toBeTruthy();
  });
});

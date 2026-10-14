// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CountPanel } from "./CountPanel";
import { DEFAULT_SETTINGS } from "../lib/count";
import type { MemberView } from "../lib/types";

afterEach(cleanup);

// a SYNTHETIC counted piece, only the fields the panel reads
function piece(over: Record<string, unknown> = {}): MemberView {
  return {
    id: "p1",
    origin: "manual",
    deleted: false,
    merged_into: null,
    not_member: null,
    existing: false,
    type: "beam",
    profile_raw: "W12x26",
    profile: "W12X26",
    quantity: 1,
    bbox: null,
    link: {
      source: "person",
      confidence: null,
      margin: null,
      line: null,
      chosen_rank: null,
      candidates: [],
    },
    status: { color: "amber", confirmed: true, reasons: [] },
    human: "edited",
    kind: { name: "Beams", scope: "main", state: "confirmed" },
    tag: { prefix: "BE", number: 1, text: "BE1", provisional: true },
    symbol_group: "linear",
    symbol_color: "amber",
    counting: "counted",
    shared_line: null,
    length_ft_in: null,
    length_source: null,
    typical: null,
    count: {
      state: "confirmed",
      source: "human_click",
      click: { x: 1, y: 1, at: "" },
      snapped: true,
      snapped_line: null,
      snapped_distance_pt: 1,
      size_source: "manual",
      size_evidence: null,
    },
    ...over,
  } as unknown as MemberView;
}

function panel(members: MemberView[], onTypical = vi.fn()) {
  render(
    <CountPanel
      members={members}
      kinds={[]}
      settings={{ ...DEFAULT_SETTINGS, count_mode: true }}
      tool={null}
      kind="Beams"
      linesState="ready"
      selectedId="p1"
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
      onDecide={vi.fn()}
      onDelete={vi.fn()}
      onPatch={vi.fn()}
      onSaveMeasure={vi.fn()}
      onAttach={vi.fn()}
      onTypical={onTypical}
    />,
  );
  return onTypical;
}

describe("typical x N on a counted piece", () => {
  it("needs N of 2 or more and a note before it can be saved", () => {
    const onTypical = panel([piece()]);
    const save = screen.getByTestId("typical-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("typical multiplier"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("typical note"), {
      target: { value: "bays" },
    });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("typical multiplier"), {
      target: { value: "6" },
    });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onTypical).toHaveBeenCalledWith("p1", 6, "bays");
  });

  it("shows the badge with the note, and Remove sends null", () => {
    const onTypical = panel([
      piece({
        quantity: 6,
        typical: { n: 6, note: "six bays", base_quantity: 1 },
      }),
    ]);
    const badge = screen.getByTestId("typical-badge");
    expect(badge.textContent).toBe("typical x6");
    expect(badge.getAttribute("title")).toBe("six bays");
    fireEvent.click(screen.getByTestId("typical-remove"));
    expect(onTypical).toHaveBeenCalledWith("p1", null, "");
  });

  it("is not offered for a suggestion nobody decided", () => {
    panel([piece({ origin: "extracted", count: { state: "suggested" } })]);
    expect(screen.queryByTestId("typical-editor")).toBeNull();
  });
});

describe("pieces without length in the table totals (owner decision 127)", () => {
  it("the totals line gives the weight and how many pieces have no length", async () => {
    const { weightText } = await import("./TablesPanel");
    expect(
      weightText({
        total_w: 1234.5,
        pieces_without_length: 7,
        pieces_without_unit_w: 0,
      }),
    ).toBe("Total W 1,234.5 lb · 7 pieces without length");
    expect(
      weightText({
        total_w: 0,
        pieces_without_length: 0,
        pieces_without_unit_w: 2,
      }),
    ).toBe(
      "Total W 0 lb · 0 pieces without length · 2 with a length but no Unit W",
    );
  });
});

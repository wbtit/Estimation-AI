import { describe, expect, it } from "vitest";
import {
  clickAnchor,
  confirmedBySize,
  countStateOf,
  isSuggestion,
  kindOptions,
  pieceLists,
  sizeNote,
} from "./count";
import type { KindInfo, MemberView } from "./types";

function m(id: string, over: Record<string, unknown> = {}): MemberView {
  return {
    id,
    origin: "extracted",
    deleted: false,
    merged_into: null,
    not_member: null,
    existing: false,
    status: { color: "green", confirmed: false, reasons: [] },
    counting: "counted",
    shared_line: null,
    profile: "W12X26",
    profile_raw: "W12x26",
    quantity: 1,
    ...over,
  } as unknown as MemberView;
}
const count = (state: string, extra: Record<string, unknown> = {}) => ({
  count: {
    state,
    source: null,
    click: null,
    snapped: null,
    snapped_line: null,
    snapped_distance_pt: null,
    size_source: null,
    size_evidence: null,
    ...extra,
  },
});

describe("count helpers", () => {
  it("a member without count data is an undecided suggestion (older payloads)", () => {
    expect(countStateOf(m("a"))).toBe("suggested");
    expect(isSuggestion(m("a"))).toBe(true);
  });

  it("sorts members into confirmed, suggested, rejected and unlinked", () => {
    const list = [
      m("c1", count("confirmed", { source: "human_click" })),
      m("c2", count("confirmed", { source: "suggestion_accepted" })),
      m("s1", count("suggested")),
      m("r1", count("rejected")),
      m("u1", { status: { color: "unlinked", confirmed: false, reasons: [] } }),
      m("gone", { deleted: true, ...count("confirmed") }),
      m("ex", { existing: true }),
    ];
    const l = pieceLists(list);
    expect(l.confirmed.map((x) => x.id)).toEqual(["c1", "c2"]);
    expect(l.suggested.map((x) => x.id)).toEqual(["s1"]);
    expect(l.rejected.map((x) => x.id)).toEqual(["r1"]);
    expect(l.unlinked.map((x) => x.id)).toEqual(["u1"]);
  });

  it("a label that shares a line it does not carry is not a suggestion; the one that carries it is", () => {
    const shared = (carries: boolean) => ({
      shared_line: { group: "g", size: 2, best: !carries, line_piece: carries },
    });
    expect(isSuggestion(m("a", shared(true)))).toBe(true);
    expect(isSuggestion(m("b", shared(false)))).toBe(false);
  });

  it("a misc kind is not offered as a suggestion", () => {
    expect(isSuggestion(m("a", { counting: "misc_reserved" }))).toBe(false);
  });

  it("a clicked piece is drawn at the click", () => {
    const piece = m(
      "p",
      count("confirmed", { click: { x: 5, y: 7, at: "t" } }),
    );
    expect(clickAnchor(piece)).toEqual({ x: 5, y: 7 });
    expect(clickAnchor(m("q"))).toBeNull();
  });

  it("says which rule filled the size, and amber when a person must look", () => {
    expect(
      sizeNote(m("a", count("confirmed", { size_source: "linked_label" })))
        .tone,
    ).toBe("ok");
    const near = sizeNote(
      m(
        "b",
        count("confirmed", {
          size_source: "nearest_label",
          size_evidence: { member_id: "x", distance_pt: 12.5 },
        }),
      ),
    );
    expect(near.tone).toBe("amber");
    expect(near.text).toContain("12.5 pt");
    expect(
      sizeNote(
        m("c", {
          profile: null,
          profile_raw: null,
          ...count("confirmed", { size_source: "none" }),
        }),
      ).tone,
    ).toBe("amber");
    expect(
      sizeNote(m("d", count("confirmed", { size_source: "manual" }))).text,
    ).toContain("typed");
  });

  it("main kinds come first in the kind choice", () => {
    const k = (kind: string, scope: KindInfo["scope"], sort: number) =>
      ({
        kind,
        scope,
        sort,
        symbol_group: "linear",
        prefix: "X",
        provisional: true,
      }) as KindInfo;
    const out = kindOptions([
      k("Stair", "misc", 1),
      k("Joist", "excluded", 2),
      k("Beams", "main", 9),
      k("Column", "main", 3),
    ]);
    expect(out.map((x) => x.kind)).toEqual([
      "Column",
      "Beams",
      "Stair",
      "Joist",
    ]);
  });

  it("sums confirmed pieces by size", () => {
    const out = confirmedBySize([
      m("a", count("confirmed")),
      m("b", count("confirmed", {})),
      m("c", { profile: "HSS6X6X1/4", ...count("confirmed") }),
      m("d", count("suggested")),
      m("e", { deleted: true, ...count("confirmed") }),
      m("f", { profile: null, profile_raw: null, ...count("confirmed") }),
    ]);
    expect(out).toEqual([
      { size: "W12X26", pieces: 2 },
      { size: "(no size)", pieces: 1 },
      { size: "HSS6X6X1/4", pieces: 1 },
    ]);
  });
});

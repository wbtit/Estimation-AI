// @vitest-environment jsdom
// Phase 14b/14c: the Draw column palette, the Find similar bar and the column markers (SYNTHETIC).
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaletteChoice } from "../lib/columns";
import type { Piece } from "../lib/lf";
import { PieceMark } from "./Canvas";
import { ColumnPalette } from "./ColumnPalette";
import {
  ColumnHint,
  FindSimilarBar,
  previewMatches,
  type SimilarPreview,
} from "./FindSimilarBar";
import { SimilarMatches } from "./SimilarMatches";
import { shownAt, STRICTNESS_DEFAULT, toggle } from "../lib/similar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(routes: Record<string, unknown>) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      return {
        ok: key !== undefined,
        status: key === undefined ? 404 : 200,
        statusText: "",
        text: async () => JSON.stringify(key === undefined ? {} : routes[key]),
      };
    }),
  );
  return calls;
}

const Harness: React.FC<{ onChoice?: (c: PaletteChoice) => void }> = ({
  onChoice,
}) => {
  const [choice, setChoice] = useState<PaletteChoice>({
    family: "w_shape",
    stud: false,
  });
  const [size, setSize] = useState("");
  return (
    <ColumnPalette
      choice={choice}
      onChoice={(c) => {
        setChoice(c);
        onChoice?.(c);
      }}
      size={size}
      onSize={setSize}
      rotation={90}
    />
  );
};

describe("column palette", () => {
  it("shows the five column types, picks one, and Stud/Post", () => {
    const got: PaletteChoice[] = [];
    render(<Harness onChoice={(c) => got.push(c)} />);
    const p = screen.getByTestId("column-palette");
    const buttons = [...p.querySelectorAll(".group button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "W-shape",
      "W with cover plates",
      "Square HSS",
      "Rectangular HSS",
      "Round HSS / pipe",
    ]);
    expect(p.textContent).toContain("Stud/Post");
    expect(p.textContent).toContain("90° (R)");
    fireEvent.click(screen.getByLabelText("Rectangular HSS"));
    expect(
      screen.getByLabelText("Rectangular HSS").getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByLabelText("stud or post"));
    expect(got.at(-1)).toEqual({ family: "hss_rect", stud: true });
  });

  it("typing a size picks its symbol", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("column size"), {
      target: { value: "HSS12X12X3/8" },
    });
    expect(
      screen.getByLabelText("Square HSS").getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.change(screen.getByLabelText("column size"), {
      target: { value: "W14X90 W/ PL3/4X16" },
    });
    expect(
      screen.getByLabelText("W with cover plates").getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.change(screen.getByLabelText("column size"), {
      target: { value: "PIPE6STD" },
    });
    expect(
      screen.getByLabelText("Round HSS / pipe").getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

/** The bar as the workspace holds it: preview, strictness and unticked state, and the canvas
 * overlay of the shown matches. */
const Bar: React.FC<{ onDone?: (n: number) => void; onClose?: () => void }> = ({
  onDone = () => undefined,
  onClose = () => undefined,
}) => {
  const [preview, setPreview] = useState<SimilarPreview | null>(null);
  const [strictness, setStrictness] = useState(STRICTNESS_DEFAULT);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  return (
    <>
      <FindSimilarBar
        projectId="p1"
        memberId="m1"
        who="ann"
        preview={preview}
        onPreview={(p) => {
          setPreview(p);
          setStrictness(p.strictness_default ?? STRICTNESS_DEFAULT);
        }}
        strictness={strictness}
        onStrictness={setStrictness}
        unticked={unticked}
        onDone={onDone}
        onClose={onClose}
        onError={() => undefined}
      />
      {preview && (
        <svg>
          <SimilarMatches
            px={1}
            overlay={{
              matches: shownAt(previewMatches(preview), strictness),
              unticked,
              onToggle: (k) => setUnticked((u) => toggle(u, k)),
            }}
          />
        </svg>
      )}
    </>
  );
};

describe("find similar bar", () => {
  const url = "/api/projects/p1/line-first/pieces/m1/find-similar";
  const vectorOnly = {
    example: { family: "hss_square", real_in: [12, 12] },
    count: 3,
    points: [
      [10, 10],
      [20, 10],
      [30, 10],
    ],
    accepted: false,
  };
  const image = {
    example: { family: "drawn_symbol", real_in: [12, 12] },
    count: 4,
    points: [],
    accepted: false,
    image: true,
    run_id: "11111111-1111-1111-1111-111111111111",
    strictness_default: 0.8,
    matches: [
      { centre: [100, 100], source: "vector", score: null },
      { centre: [200, 100], source: "image", score: 0.95 },
      { centre: [300, 100], source: "image", score: 0.82 },
      { centre: [400, 100], source: "image", score: 0.7 },
    ],
  };

  it("vector only: previews the count, then accepts as one action", async () => {
    const calls = stubFetch({ [url]: vectorOnly });
    const done = vi.fn();
    render(<Bar onDone={done} />);
    fireEvent.click(screen.getByText("Find similar"));
    await waitFor(() =>
      expect(screen.getByTestId("similar-count").textContent).toBe(
        "3 of 3 ticked (hss square, 12 × 12 in)",
      ),
    );
    expect(screen.queryByLabelText("strictness")).toBeNull(); // no scores: no slider
    expect(calls[0]!.body).toEqual({ who: "ann", accept: false });
    stubFetch({ [url]: { ...vectorOnly, accepted: true } });
    fireEvent.click(screen.getByText("Accept 3"));
    await waitFor(() => expect(done).toHaveBeenCalledWith(3));
  });

  it("a spinner while searching; the slider filters live; a click unticks; Accept sends the ticked ones (14e)", async () => {
    let release: (v: unknown) => void = () => undefined;
    const calls: { body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init!.body));
        calls.push({ body });
        if (!body.accept) await new Promise((r) => (release = r));
        const res = body.accept
          ? { ...image, accepted: true, count: 2 }
          : image;
        return {
          ok: true,
          status: 200,
          statusText: "",
          text: async () => JSON.stringify(res),
        };
      }),
    );
    const done = vi.fn();
    render(<Bar onDone={done} />);
    fireEvent.click(screen.getByText("Find similar"));
    await waitFor(() => screen.getByTestId("similar-spinner"));
    release(null);
    await waitFor(() => screen.getByTestId("similar-count"));
    expect(screen.queryByTestId("similar-spinner")).toBeNull();
    // default strictness 0.8: the vector match and the 0.95 and 0.82 image matches
    expect(screen.getByTestId("strictness-value").textContent).toBe("0.80");
    expect(screen.getAllByTestId("similar-match")).toHaveLength(3);
    expect(screen.getByTestId("similar-count").textContent).toMatch(
      /^3 of 3 ticked/,
    );
    expect(screen.getByText("shape")).toBeTruthy(); // the vector match's label
    expect(screen.getByText("0.95")).toBeTruthy();
    // the slider: no new search
    fireEvent.change(screen.getByLabelText("strictness"), {
      target: { value: "0.6" },
    });
    expect(screen.getAllByTestId("similar-match")).toHaveLength(4);
    fireEvent.change(screen.getByLabelText("strictness"), {
      target: { value: "0.9" },
    });
    expect(screen.getAllByTestId("similar-match")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("strictness"), {
      target: { value: "0.8" },
    });
    expect(calls).toHaveLength(1);
    // untick the 0.82 match on the canvas, tick and untick again
    const m = () =>
      screen
        .getAllByTestId("similar-match")
        .find((e) => e.getAttribute("data-key") === "300,100")!;
    fireEvent.click(m());
    expect(m().getAttribute("data-ticked")).toBe("0");
    expect(screen.getByTestId("similar-count").textContent).toMatch(
      /^2 of 3 ticked/,
    );
    fireEvent.click(screen.getByText("Accept 2"));
    await waitFor(() => expect(done).toHaveBeenCalledWith(2));
    expect(calls[1]!.body).toEqual({
      who: "ann",
      accept: true,
      run_id: "11111111-1111-1111-1111-111111111111",
      strictness: 0.8,
      unticked: [[300, 100]],
      // Phase 0-column-capture: the time of the search that was previewed is logged with the accept
      timing: { find_similar_ms: expect.any(Number) },
    });
  });

  it("the click-first hint", () => {
    render(<ColumnHint text="Click one column (C) → Find similar" />);
    expect(screen.getByTestId("column-hint").textContent).toBe(
      "Click one column (C) → Find similar",
    );
  });

  it("cancel (or Esc) closes without accepting", async () => {
    const calls = stubFetch({ [url]: { ...vectorOnly, count: 0, points: [] } });
    const close = vi.fn();
    render(<Bar onClose={close} />);
    fireEvent.click(screen.getByText("Find similar"));
    await waitFor(() => screen.getByText("No similar symbols found"));
    expect(screen.queryByText(/^Accept/)).toBeNull();
    fireEvent.click(screen.getByText("Cancel"));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(1);
  });
});

const column = (over: Partial<Piece>): Piece =>
  ({
    id: "c",
    member_id: "LF-C-1",
    sheet_id: "s1",
    type: "column",
    kind: "Column",
    tag: "CO1",
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

describe("column markers", () => {
  const mark = (p: Piece) => {
    render(
      <svg>
        <PieceMark p={p} px={0.5} on={false} labels={false} />
      </svg>,
    );
    return screen.getAllByTestId("column-symbol").at(-1)!;
  };

  it("draws the profile's symbol, rotated like the drawing", () => {
    const el = mark(
      column({
        profile: "HSS12X12X3/8",
        rotation_deg: 90,
        section_in: [12, 12],
      }),
    );
    expect(el.getAttribute("data-symbol")).toBe("hss_square");
    expect(el.getAttribute("transform")).toBe("translate(100 100) rotate(90)");
  });

  it("falls back to the drawn family, else a neutral unknown marker", () => {
    expect(
      mark(column({ symbol: "hss_round" })).getAttribute("data-symbol"),
    ).toBe("hss_round");
    cleanup();
    expect(
      mark(column({ symbol: "welded_box" })).getAttribute("data-symbol"),
    ).toBe("unknown"); // a 14b family that is not one of the five
    cleanup();
    expect(mark(column({ symbol: null })).getAttribute("data-symbol")).toBe(
      "unknown",
    );
  });
});

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
import { FindSimilarBar } from "./FindSimilarBar";

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

describe("find similar bar", () => {
  const url = "/api/projects/p1/line-first/pieces/m1/find-similar";
  const preview = {
    example: { family: "hss_square", real_in: [12, 12] },
    count: 3,
    points: [],
    accepted: false,
  };

  it("previews the count, then accepts as one action", async () => {
    const calls = stubFetch({ [url]: preview });
    const done = vi.fn();
    render(
      <FindSimilarBar
        projectId="p1"
        memberId="m1"
        who="ann"
        onDone={done}
        onClose={() => undefined}
        onError={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText("Find similar"));
    await waitFor(() =>
      expect(screen.getByTestId("similar-count").textContent).toBe(
        "3 similar (hss square, 12 × 12 in)",
      ),
    );
    expect(calls[0]!.body).toEqual({ who: "ann", accept: false });
    stubFetch({ [url]: { ...preview, accepted: true } });
    fireEvent.click(screen.getByText("Accept"));
    await waitFor(() => expect(done).toHaveBeenCalledWith(3));
  });

  it("cancel closes without accepting", async () => {
    const calls = stubFetch({ [url]: { ...preview, count: 0 } });
    const close = vi.fn();
    render(
      <FindSimilarBar
        projectId="p1"
        memberId="m1"
        who="ann"
        onDone={() => undefined}
        onClose={close}
        onError={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText("Find similar"));
    await waitFor(() => screen.getByText("No similar symbols found"));
    expect(screen.queryByText("Accept")).toBeNull();
    fireEvent.click(screen.getByText("Cancel"));
    expect(close).toHaveBeenCalled();
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

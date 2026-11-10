// @vitest-environment jsdom
// Phase 0-14g: the example box on the canvas and the Find similar request (SYNTHETIC).
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColumnCounts, countColumns } from "./ColumnCounts";
import { FindSimilarBar } from "./FindSimilarBar";
import type { Piece } from "../lib/lf";
import { SimilarMatches } from "./SimilarMatches";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rect: [number, number][] = [
  [10, 10],
  [20, 10],
  [20, 20],
  [10, 20],
];

describe("the example box", () => {
  it("is drawn from the example's corners, labelled by where it came from", () => {
    const { container, rerender } = render(
      <svg>
        <SimilarMatches
          px={1}
          overlay={{
            matches: [],
            unticked: new Set(),
            onToggle: () => undefined,
            example: { rect, source: "ink" },
          }}
        />
      </svg>,
    );
    const box = container.querySelector(
      '[data-testid="similar-example"] polygon',
    );
    expect(box?.getAttribute("points")).toBe("10,10 20,10 20,20 10,20");
    expect(screen.getByText("example (ink)")).toBeTruthy();
    rerender(
      <svg>
        <SimilarMatches
          px={1}
          overlay={{
            matches: [],
            unticked: new Set(),
            onToggle: () => undefined,
            example: null,
          }}
        />
      </svg>,
    );
    expect(
      container.querySelector('[data-testid="similar-example"]'),
    ).toBeNull();
  });
});

describe("Find similar request", () => {
  const props = {
    projectId: "p1",
    memberId: "m1",
    who: "tester",
    preview: null,
    strictness: 0.8,
    onStrictness: () => undefined,
    unticked: new Set<string>(),
    onDone: () => undefined,
    onClose: () => undefined,
    onError: () => undefined,
  };
  const stub = (order: string[]) => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        order.push("post");
        calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return {
          ok: true,
          status: 200,
          statusText: "",
          text: async () =>
            JSON.stringify({
              example: { family: "x", real_in: [1, 1] },
              count: 0,
              points: [],
              accepted: false,
            }),
        };
      }),
    );
    return calls;
  };

  it("sends snap:false for a Shift placement or a nudged column, nothing otherwise", async () => {
    const calls = stub([]);
    const onPreview = vi.fn();
    const { rerender } = render(
      <FindSimilarBar {...props} snap={false} onPreview={onPreview} />,
    );
    fireEvent.click(screen.getByText("Find similar"));
    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1));
    expect(calls[0]!.body).toMatchObject({
      who: "tester",
      accept: false,
      snap: false,
    });
    rerender(<FindSimilarBar {...props} snap onPreview={onPreview} />);
    fireEvent.click(screen.getByText("Find similar"));
    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(2));
    expect(calls[1]!.body).not.toHaveProperty("snap");
  });

  it("sends the pending nudges before it searches", async () => {
    const order: string[] = [];
    stub(order);
    const onPreview = vi.fn();
    const before = vi.fn(async () => {
      order.push("nudges");
    });
    render(
      <FindSimilarBar {...props} beforeSearch={before} onPreview={onPreview} />,
    );
    fireEvent.click(screen.getByText("Find similar"));
    await waitFor(() => expect(onPreview).toHaveBeenCalled());
    expect(order).toEqual(["nudges", "post"]);
  });
});

describe("the unchecked-ink message", () => {
  const preview = (warning: string | null) => ({
    example: { family: "drawn_symbol", real_in: [30, 30] as [number, number] },
    count: 1,
    points: [[1, 1]] as [number, number][],
    accepted: false,
    warning,
    matches: [
      {
        centre: [1, 1] as [number, number],
        source: "image" as const,
        score: 0.9,
      },
    ],
  });
  const props = {
    projectId: "p1",
    memberId: "m1",
    who: "tester",
    strictness: 0.8,
    onStrictness: () => undefined,
    unticked: new Set<string>(),
    onDone: () => undefined,
    onClose: () => undefined,
    onError: () => undefined,
    onPreview: () => undefined,
  };
  it("says where the example came from, in the estimators' words, only for an ink read", () => {
    const { rerender } = render(
      <FindSimilarBar {...props} preview={preview("unchecked_ink")} />,
    );
    expect(screen.getByTestId("similar-warning").textContent).toBe(
      "Example taken from the drawing — check the orange box.",
    );
    rerender(<FindSimilarBar {...props} preview={preview(null)} />);
    expect(screen.queryByTestId("similar-warning")).toBeNull();
  });
});

describe("Phase 0 column capture: keyboard flow, accept above a score, the box, orientation ticks, counts", () => {
  const call: { body: Record<string, unknown> }[] = [];
  const answer = {
    example: { family: "drawn_symbol", real_in: [10, 12] as [number, number] },
    count: 2,
    points: [
      [1, 1],
      [2, 2],
    ] as [number, number][],
    accepted: false,
    run_id: "11111111-1111-1111-1111-111111111111",
    matches: [
      {
        centre: [1, 1] as [number, number],
        source: "image" as const,
        score: 0.95,
        orientation_deg: 90,
        orientation_state: "clear" as const,
      },
      {
        centre: [2, 2] as [number, number],
        source: "image" as const,
        score: 0.7,
        orientation_deg: 0,
        orientation_state: "unsure" as const,
      },
    ],
  };
  const stub = () => {
    call.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        call.push({ body: JSON.parse(String(init?.body ?? "{}")) });
        return {
          ok: true,
          status: 200,
          statusText: "",
          text: async () =>
            JSON.stringify({
              ...answer,
              accepted: !!JSON.parse(String(init?.body ?? "{}")).accept,
            }),
        };
      }),
    );
  };
  const props = {
    projectId: "p1",
    memberId: "m1",
    who: "tester",
    strictness: 0.6,
    onStrictness: () => undefined,
    unticked: new Set<string>(),
    onDone: vi.fn(),
    onClose: vi.fn(),
    onError: () => undefined,
    onPreview: vi.fn(),
  };

  it("Enter runs Find similar and sends the box the person changed; A accepts; Esc cancels", async () => {
    stub();
    const onPreview = vi.fn();
    const onDone = vi.fn();
    const onClose = vi.fn();
    const box: [number, number, number, number] = [10, 10, 20, 24];
    const { rerender } = render(
      <FindSimilarBar
        {...props}
        preview={null}
        box={box}
        onPreview={onPreview}
      />,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1));
    expect(call[0]!.body).toMatchObject({ accept: false, box });
    rerender(
      <FindSimilarBar
        {...props}
        preview={answer}
        box={box}
        onPreview={onPreview}
        onDone={onDone}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(call[1]!.body).toMatchObject({
      accept: true,
      run_id: answer.run_id,
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Accept all above a score sends that strictness and no unticks, with the search time", async () => {
    stub();
    const onPreview = vi.fn();
    const onDone = vi.fn();
    const { rerender } = render(
      <FindSimilarBar {...props} preview={null} onPreview={onPreview} />,
    );
    fireEvent.click(screen.getByText("Find similar"));
    await waitFor(() => expect(onPreview).toHaveBeenCalled());
    rerender(
      <FindSimilarBar
        {...props}
        preview={answer}
        unticked={new Set(["1,1"])}
        onPreview={onPreview}
        onDone={onDone}
      />,
    );
    fireEvent.change(screen.getByLabelText("accept above score"), {
      target: { value: "0.9" },
    });
    fireEvent.click(screen.getByText("Accept all ≥"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(call.at(-1)!.body).toMatchObject({
      accept: true,
      strictness: 0.9,
      unticked: [],
    });
    expect(call.at(-1)!.body.timing).toEqual({
      find_similar_ms: expect.any(Number),
    });
  });

  it("each match shows its OWN web direction, green when clear and amber when unsure", () => {
    const { container } = render(
      <svg>
        <SimilarMatches
          px={1}
          overlay={{
            matches: answer.matches,
            unticked: new Set(),
            onToggle: () => undefined,
          }}
        />
      </svg>,
    );
    const ticks = [
      ...container.querySelectorAll('[data-testid="match-orientation"]'),
    ];
    expect(ticks.map((t) => t.getAttribute("data-state"))).toEqual([
      "clear",
      "unsure",
    ]);
    const [t1, t2] = ticks as SVGLineElement[];
    // a web at 90 degrees runs up and down; at 0 degrees it runs left to right
    expect(
      Math.abs(Number(t1!.getAttribute("x2")) - Number(t1!.getAttribute("x1"))),
    ).toBeLessThan(1e-6);
    expect(
      Math.abs(Number(t2!.getAttribute("y2")) - Number(t2!.getAttribute("y1"))),
    ).toBeLessThan(1e-6);
  });

  it("counts the columns of the page per profile and the ones still to check", () => {
    const col = (over: Partial<Piece>): Piece =>
      ({
        id: Math.random().toString(),
        type: "column",
        deleted: false,
        kind: "Column",
        symbol: "w_shape",
        ...over,
      }) as Piece;
    const pieces = [
      col({ profile: "W12X53", orientation_state: "clear" }),
      col({ profile: "W12X53", orientation_state: "manual" }),
      col({ profile: "W12X53", orientation_state: "unsure" }),
      col({ profile: null }),
      col({ profile: "HSS8X8X1/2", symbol: "hss_round" }),
      col({ profile: "W12X53", deleted: true }),
      { id: "b", type: "beam" } as Piece,
    ];
    expect(countColumns(pieces)).toEqual({
      total: 5,
      amber: 2, // the unsure one and the one with no orientation yet (a round HSS has none)
      byProfile: [
        ["W12X53", 3],
        ["HSS8X8X1/2", 1],
        ["no size", 1],
      ],
    });
    const { container } = render(<ColumnCounts pieces={pieces} />);
    expect(container.textContent).toContain("5 columns on this page");
    expect(screen.getByTestId("column-counts-amber").textContent).toBe(
      "2 to check (orientation)",
    );
  });
});

describe("Phase 0: Find similar on any page says the real reason", () => {
  const base = {
    projectId: "p1",
    memberId: "m1",
    who: "tester",
    strictness: 0.8,
    onStrictness: () => undefined,
    unticked: new Set<string>(),
    onDone: () => undefined,
    onClose: () => undefined,
    onPreview: () => undefined,
  };
  it("a missing page scale offers one click: Set the page scale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        statusText: "Conflict",
        text: async () =>
          JSON.stringify({
            error: "the page has no scale yet: set the page scale",
            code: "no_scale",
          }),
      })),
    );
    const onError = vi.fn();
    render(<FindSimilarBar {...base} preview={null} onError={onError} />);
    expect(screen.queryByTestId("set-scale")).toBeNull();
    fireEvent.click(screen.getByText("Find similar"));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect((onError.mock.calls[0]![0] as Error).message).toContain("no scale");
    expect(await screen.findByTestId("set-scale")).toBeTruthy();
  });

  it("with no column symbols stored for the page, the preview says the example is read from the drawing", () => {
    const preview = {
      example: {
        family: "drawn_symbol",
        real_in: [10, 12] as [number, number],
      },
      count: 0,
      points: [],
      accepted: false,
      symbols_stored: false,
    };
    const { rerender } = render(
      <FindSimilarBar {...base} preview={preview} onError={() => undefined} />,
    );
    expect(screen.getByTestId("similar-no-symbols").textContent).toContain(
      "read from the drawing",
    );
    rerender(
      <FindSimilarBar
        {...base}
        preview={{ ...preview, symbols_stored: true }}
        onError={() => undefined}
      />,
    );
    expect(screen.queryByTestId("similar-no-symbols")).toBeNull();
  });
});

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
import { FindSimilarBar } from "./FindSimilarBar";
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

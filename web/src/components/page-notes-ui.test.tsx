// @vitest-environment jsdom
// Page notes: the notes box on a page card, autosave, the saved indicator, the note icon, and the
// warning when somebody saved over you (SYNTHETIC; fetch is a stub of the notes route).
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Canvas } from "./Canvas";
import { PageCard, type PageActions } from "./PageCard";
import { PageNotesBox } from "./PageNotes";
import type { Page } from "../lib/lf";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface Stored {
  note: string;
  version: number;
  updated_by: string | null;
  updated_at: string | null;
}
let server: Stored;
let puts: {
  note: string;
  base_version: number;
  force?: boolean;
  who: string;
}[];

beforeEach(() => {
  server = { note: "", version: 0, updated_by: null, updated_at: null };
  puts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET")
        return {
          ok: true,
          status: 200,
          statusText: "",
          text: async () => JSON.stringify(server),
        };
      const b = JSON.parse(String(init!.body));
      puts.push(b);
      if (!b.force && b.base_version !== server.version)
        return {
          ok: false,
          status: 409,
          statusText: "Conflict",
          text: async () =>
            JSON.stringify({ error: "changed", current: server }),
        };
      server = {
        note: b.note,
        version: server.version + 1,
        updated_by: b.who,
        updated_at: new Date().toISOString(),
      };
      return {
        ok: true,
        status: 200,
        statusText: "",
        text: async () => JSON.stringify(server),
      };
    }),
  );
});

const box = (props: Partial<React.ComponentProps<typeof PageNotesBox>> = {}) =>
  render(
    <PageNotesBox
      projectId="p"
      sheetId="s"
      who="ann"
      debounceMs={1000}
      {...props}
    />,
  );
const area = () => screen.getByLabelText("page notes") as HTMLTextAreaElement;

describe("the notes box", () => {
  it("autosaves about 1 s after typing stops, with a saved indicator", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onHas = vi.fn();
    box({ onHasNotes: onHas });
    await waitFor(() => expect(area().disabled).toBe(false));
    fireEvent.change(area(), { target: { value: "check the roof opening" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(puts).toHaveLength(0); // still typing: nothing yet
    fireEvent.change(area(), {
      target: { value: "check the roof opening, bay 2" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(puts).toHaveLength(0); // the timer restarted
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await waitFor(() =>
      expect(screen.getByTestId("notes-status").textContent).toContain("saved"),
    );
    expect(puts).toEqual([
      { who: "ann", note: "check the roof opening, bay 2", base_version: 0 },
    ]);
    expect(onHas).toHaveBeenLastCalledWith(true);
    // the next save carries the version the last one returned
    fireEvent.change(area(), { target: { value: "more" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]!.base_version).toBe(1);
  });

  it("loads the existing note and an emptied note says it has none", async () => {
    server = {
      note: "old",
      version: 3,
      updated_by: "bob",
      updated_at: "2026-11-12T10:00:00Z",
    };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onHas = vi.fn();
    box({ onHasNotes: onHas });
    await waitFor(() => expect(area().value).toBe("old"));
    fireEvent.change(area(), { target: { value: "" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(onHas).toHaveBeenLastCalledWith(false);
  });

  it("closing the box saves a change that was not yet saved", async () => {
    const onHas = vi.fn();
    const { unmount } = box({ onHasNotes: onHas });
    await waitFor(() => expect(area().disabled).toBe(false));
    fireEvent.change(area(), {
      target: { value: "typed just before closing" },
    });
    unmount();
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.note).toBe("typed just before closing");
  });

  it("warns when the note changed since you opened it: nothing is overwritten until you choose", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server = {
      note: "start",
      version: 1,
      updated_by: "ann",
      updated_at: "2026-11-12T10:00:00Z",
    };
    box();
    await waitFor(() => expect(area().value).toBe("start"));
    // bob saves while ann has the box open
    server = {
      note: "bob's text",
      version: 2,
      updated_by: "bob",
      updated_at: "2026-11-12T10:05:00Z",
    };
    fireEvent.change(area(), { target: { value: "ann's text" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    const warn = await screen.findByTestId("notes-conflict");
    expect(warn.textContent).toContain("changed by bob");
    expect(server.note).toBe("bob's text"); // not overwritten
    // autosave is paused: more typing does not retry
    fireEvent.change(area(), { target: { value: "ann's text, more" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(puts).toHaveLength(1);
    // Keep mine: last save wins
    fireEvent.click(screen.getByText("Keep mine"));
    await waitFor(() => expect(server.note).toBe("ann's text, more"));
    expect(puts[1]).toMatchObject({ force: true });
    expect(screen.queryByTestId("notes-conflict")).toBeNull();
  });

  it("Load theirs takes the newer note and drops yours", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server = { note: "start", version: 1, updated_by: "ann", updated_at: null };
    box();
    await waitFor(() => expect(area().value).toBe("start"));
    server = {
      note: "bob's text",
      version: 2,
      updated_by: "bob",
      updated_at: "2026-11-12T10:05:00Z",
    };
    fireEvent.change(area(), { target: { value: "ann's text" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    await screen.findByTestId("notes-conflict");
    fireEvent.click(screen.getByText("Load theirs"));
    expect(area().value).toBe("bob's text");
    expect(screen.queryByTestId("notes-conflict")).toBeNull();
    expect(server.note).toBe("bob's text");
  });
});

describe("notes on the page card", () => {
  const actions = (): PageActions =>
    ({
      build: vi.fn(),
      setRole: vi.fn(),
      setColumnPlan: vi.fn(),
      setTos: vi.fn(),
      setScale: vi.fn(),
      noBeams: vi.fn(),
      addView: vi.fn(),
    }) as unknown as PageActions;
  const pg = (over: Partial<Page> = {}): Page => ({
    id: "s1",
    page_index: 4,
    page_number: 5,
    sheet_number: "S-201",
    title: null,
    page_type: "framing_plan",
    page_kind: "vector",
    width_pt: 1000,
    height_pt: 800,
    rotation: 0,
    thumbnail_url: null,
    badge: "Not confirmed",
    reasons: [],
    notes: [],
    system_values: [],
    setup: {
      role: "framing",
      crop: null,
      pen_class: null,
      pen_class_source: null,
      scale_ratio: 96,
      scale_text: null,
      tos_mm: null,
      tos_raw: null,
      column_plan_sheet_id: null,
    },
    scales_found: [],
    built_at: null,
    reviewed_by: null,
    reviewed_at: null,
    pending_edits: 0,
    counts: {
      pieces: 0,
      beams: 0,
      columns: 0,
      braces: 0,
      found: 0,
      needs_review: 0,
      attention: 0,
    },
    ...over,
  });
  const card = (page: Page, notes = { projectId: "p", who: "ann" }) =>
    render(
      <PageCard
        page={page}
        columnPlans={[]}
        selected={false}
        onSelect={() => undefined}
        actions={actions()}
        notes={notes}
      />,
    );

  it("has a small 'Add notes' action and the box is closed by default", () => {
    card(pg());
    expect(screen.getByTestId("notes-add").textContent).toBe("Add notes");
    expect(screen.queryByTestId("page-notes")).toBeNull();
    expect(screen.queryByTestId("notes-icon")).toBeNull();
  });

  it("Add notes opens the box; once saved the card shows the note icon; the icon reopens it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    card(pg());
    fireEvent.click(screen.getByTestId("notes-add"));
    await waitFor(() => expect(area().disabled).toBe(false));
    fireEvent.change(area(), { target: { value: "ask the architect" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    await waitFor(() => screen.getByTestId("notes-icon"));
    fireEvent.click(screen.getByLabelText("close notes"));
    expect(screen.queryByTestId("page-notes")).toBeNull();
    expect(screen.getByTestId("notes-icon")).toBeTruthy(); // the icon stays
    fireEvent.click(screen.getByTestId("notes-icon"));
    await waitFor(() => expect(area().value).toBe("ask the architect"));
  });

  it("a page that already has notes shows the icon, not Add notes", () => {
    card(pg({ has_notes: true }));
    expect(screen.getByTestId("notes-icon")).toBeTruthy();
    expect(screen.queryByTestId("notes-add")).toBeNull();
  });

  it("without the notes prop the card has no notes action", () => {
    render(
      <PageCard
        page={pg()}
        columnPlans={[]}
        selected={false}
        onSelect={() => undefined}
        actions={actions()}
      />,
    );
    expect(screen.queryByTestId("notes-add")).toBeNull();
  });
});

describe("status legend lives in the help popover", () => {
  it("is not on the canvas; the ? help shows it", () => {
    const noop = () => undefined;
    render(
      <Canvas
        pdf={null}
        page={
          {
            id: "s1",
            page_index: 0,
            page_number: 1,
            width_pt: 1000,
            height_pt: 800,
            setup: { crop: null, scale_ratio: 96, pen_class: null },
            views: [],
            counts: {
              found: 0,
              needs_review: 0,
              attention: 0,
              approved: 0,
              pieces: 0,
            },
          } as unknown as Page
        }
        data={null}
        lines={null}
        layers={
          { plan: true, grids: true, beams: true, columns: true } as never
        }
        onLayers={noop}
        selected={new Set()}
        onSelect={noop}
        pendingEdits={0}
        onCrop={noop}
        onPick={noop}
        onDraw={noop}
        onEnds={noop}
        onUndo={noop}
        onDeleteSelected={noop}
      />,
    );
    expect(screen.queryByTestId("status-legend")).toBeNull();
    fireEvent.click(screen.getByLabelText("keyboard shortcuts"));
    const pop = screen.getByTestId("shortcuts");
    expect(pop.querySelector('[data-testid="status-legend"]')).toBeTruthy();
    expect(pop.textContent).toContain("approved");
    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByTestId("status-legend")).toBeNull();
  });
});

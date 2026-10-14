// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PilotReport, type PilotReportRow } from "./PilotReport";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row = (over: Partial<PilotReportRow>): PilotReportRow => ({
  sheet_id: "s1",
  page_number: 3,
  sheet_number: "S-3",
  who: "ann",
  first: "",
  last: "",
  actions: 4,
  active_seconds: 90,
  idle_gaps: 1,
  idle_seconds: 400,
  created: 2,
  accepted: 1,
  rejected: 1,
  edited: 0,
  deleted: 0,
  undo: 1,
  redo: 0,
  measured: 0,
  typical_changes: 1,
  pieces: 3,
  typical_pieces: 1,
  pieces_without_length: 2,
  ...over,
});

function serve(rows: PilotReportRow[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ idle_seconds: 300, rows }), {
          status: 200,
        }),
    ),
  );
}

describe("the pilot timing report page", () => {
  it("lists sheets and people with active minutes, long gaps apart, and a total", async () => {
    serve([
      row({}),
      row({
        sheet_id: "s2",
        page_number: 4,
        who: "bob",
        active_seconds: 30,
        idle_gaps: 0,
      }),
      row({ sheet_id: null, who: "ann" }),
    ]);
    render(<PilotReport projectId="p" version={1} onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByLabelText("pilot report")).toBeTruthy(),
    );
    expect(screen.getAllByRole("row")).toHaveLength(1 + 2 + 1); // head, two sheet rows (not the project-level one), total
    const total = screen.getByTestId("pilot-report-total").textContent ?? "";
    expect(total).toContain("All sheets");
    expect(total).toContain("2.0"); // 90 s + 30 s = 2.0 min
    expect(screen.getByTestId("pilot-report-csv").getAttribute("href")).toBe(
      "/api/projects/p/pilot-report.csv",
    );
  });

  it("says when there is nothing yet", async () => {
    serve([]);
    render(<PilotReport projectId="p" version={1} onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByTestId("pilot-report-empty")).toBeTruthy(),
    );
  });
});

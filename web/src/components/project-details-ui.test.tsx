// @vitest-environment jsdom
// Phase 0 cover details: the project details panel and the index check (SYNTHETIC).
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flagText,
  sourceText,
  type ProjectDetails,
} from "../lib/project-details";
import { ProjectDetailsPanel } from "./ProjectDetails";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const field = (f: string, over: Record<string, unknown> = {}) => ({
  field: f,
  value: null,
  read_value: null,
  edited: false,
  edited_by: null,
  page_index: null,
  box: null,
  rule: null,
  confidence: null,
  flags: [],
  alternatives: [],
  agreement: null,
  ...over,
});
const data = (over: Partial<ProjectDetails> = {}): ProjectDetails =>
  ({
    status: "read",
    project: { name: "P", number: null },
    read: {
      read_at: "x",
      cover_pages: [0],
      no_text_pages: [],
      pages: 5,
      seconds: 0.4,
    },
    fields: [
      field("project_name", {
        value: "Riverside Warehouse",
        page_index: 0,
        box: [60, 80, 300, 95],
        rule: "same_line",
        confidence: "high",
        alternatives: [
          {
            value: "Other Name",
            page_index: 2,
            box: [1, 2, 3, 4],
            rule: "x",
            confidence: "low",
          },
        ],
      }),
      field("owner", {
        value: "Acme",
        page_index: 0,
        box: [1, 2, 3, 4],
        rule: "below",
        confidence: "medium",
        flags: ["conflict"],
      }),
      field("architect", {
        value: "Hidden Architect",
        page_index: 0,
        box: [1, 2, 3, 4],
        rule: "below",
        confidence: "high",
      }),
      field("location"),
      field("building_type", {
        value: "Warehouse",
        page_index: 0,
        box: [60, 80, 300, 95],
        rule: "keyword_in_project_name",
        confidence: "low",
      }),
    ],
    index: {
      rows: [],
      flags: [
        {
          id: "f1",
          kind: "name_mismatch",
          number: "S101",
          title: "FOUNDATION PLAN",
          detail: { index: "A", page: "B" },
          sheet_id: "s1",
          page_index: 3,
          index_page: 0,
        },
        {
          id: "f2",
          kind: "missing_from_pdf",
          number: "S999",
          title: "GONE",
          detail: {},
          sheet_id: null,
          page_index: 0,
          index_page: 0,
        },
      ],
      summary: { rows: 4, matched: 3, percent: 75 },
    },
    ...over,
  }) as ProjectDetails;

describe("project details helpers", () => {
  it("source chip text and flag lines", () => {
    expect(sourceText({ page_index: 2, rule: "below" })).toBe(
      "page 3 · label, text below",
    );
    expect(sourceText({ page_index: null, rule: null })).toBe("");
    expect(
      flagText({
        id: "x",
        kind: "role_disagreement",
        number: "S101",
        title: "t",
        detail: { index_says: "foundation_plan", role: "Framing plan" },
        sheet_id: null,
        page_index: 1,
        index_page: 0,
      }),
    ).toBe("S101: index says foundation plan, role is Framing plan");
  });
});

describe("project details panel", () => {
  const calls: {
    url: string;
    method: string;
    body: Record<string, unknown>;
  }[] = [];
  let payload: ProjectDetails;
  beforeEach(() => {
    calls.length = 0;
    payload = data();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method ?? "GET",
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        const body = (init?.method ?? "GET") === "GET" ? payload : { ok: true };
        return {
          ok: true,
          status: 200,
          statusText: "",
          text: async () => JSON.stringify(body),
        };
      }),
    );
  });
  const mount = () => {
    const onJump = vi.fn();
    const onChanged = vi.fn();
    render(
      <ProjectDetailsPanel
        projectId="p"
        who="t"
        onJump={onJump}
        onClose={vi.fn()}
        onChanged={onChanged}
        onError={vi.fn()}
      />,
    );
    return { onJump, onChanged };
  };

  it("each field shows its value, source chip, confidence; a missing one says not found", async () => {
    mount();
    await waitFor(() => screen.getByTestId("field-project_name"));
    expect(screen.getByTestId("field-project_name").textContent).toContain(
      "Riverside Warehouse",
    );
    expect(screen.getByTestId("source-project_name").textContent).toBe(
      "page 1 · label, same line",
    );
    expect(screen.getByTestId("confidence-project_name").className).toContain(
      "green",
    );
    expect(screen.getByTestId("confidence-owner").className).toContain("amber");
    expect(screen.getByTestId("conflict-owner")).toBeTruthy();
    expect(screen.getByTestId("field-location").textContent).toContain(
      "not found",
    );
    // only the four fields are shown; the architect is read but hidden
    expect(screen.queryByTestId("field-architect")).toBeNull();
    // the building type is a suggestion, shown amber
    const bt = screen.getByTestId("confidence-building_type");
    expect(bt.textContent).toBe("suggested");
    expect(bt.className).toContain("amber");
  });

  it("a click on the source chip jumps to the page and its box", async () => {
    const { onJump } = mount();
    await waitFor(() => screen.getByTestId("source-project_name"));
    fireEvent.click(screen.getByTestId("source-project_name"));
    expect(onJump).toHaveBeenCalledWith(0, [60, 80, 300, 95]);
  });

  it("an edit is saved on Enter, an alternative and Use as project name are one click each", async () => {
    const { onChanged } = mount();
    await waitFor(() => screen.getByTestId("field-owner"));
    fireEvent.click(screen.getByText("Acme"));
    const input = screen.getByLabelText("edit owner");
    fireEvent.change(input, { target: { value: "Acme Co" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "PUT" && c.url.endsWith("/owner")),
      ).toBe(true),
    );
    expect(calls.find((c) => c.method === "PUT")!.body).toMatchObject({
      value: "Acme Co",
      who: "t",
    });
    expect(onChanged).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("alt-project_name-0"));
    await waitFor(() =>
      expect(calls.some((c) => c.body.from_alternative === true)).toBe(true),
    );
    fireEvent.click(screen.getByTestId("use-project_name"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/project_name/use-as-project")),
      ).toBe(true),
    );
  });

  it("the index check lists the flags with a jump to the page (or to the index)", async () => {
    const { onJump } = mount();
    await waitFor(() => screen.getByTestId("index-summary"));
    expect(screen.getByTestId("index-summary").textContent).toContain(
      "3 of 4 index rows matched",
    );
    expect(screen.getByTestId("flag-name_mismatch").textContent).toContain(
      'index "A" · page "B"',
    );
    fireEvent.click(screen.getByTestId("jump-name_mismatch"));
    expect(onJump).toHaveBeenCalledWith(3, null, "s1");
    expect(screen.getByTestId("jump-missing_from_pdf").textContent).toContain(
      "go to the index",
    );
  });

  it("not read and no text say so", async () => {
    payload = data({ status: "not_read", read: null });
    mount();
    await waitFor(() => screen.getByTestId("details-not-read"));
    cleanup();
    payload = data({ status: "no_text" });
    mount();
    await waitFor(() => screen.getByTestId("details-no-text"));
    expect(screen.getByTestId("details-no-text").textContent).toContain(
      "No text on the cover page",
    );
  });
});

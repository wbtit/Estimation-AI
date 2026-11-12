// @vitest-environment jsdom
// Phase 0 project intake: the Project details step after an upload / "Edit details", and the card
// marker (SYNTHETIC).
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detailsNotSet, intakePayload, type Project } from "../lib/lf";
import { ProjectIntake } from "./ProjectIntake";
import { ProcessingPanel, ProjectCard } from "./ProjectsScreen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface Answer {
  status: "not_read" | "no_text" | "read";
  reading: boolean;
  fields: { field: string; read_value: string | null; edited: boolean }[];
}
const sug = (over: Record<string, string | null> = {}) => ({
  project_name: "Riverside Warehouse",
  owner: "Acme Holdings",
  location: "Portland, OR",
  building_type: null,
  ...over,
});
const answer = (
  s: Record<string, string | null>,
  edited: string[] = [],
  over: Partial<Answer> = {},
): Answer => ({
  status: "read",
  reading: false,
  fields: Object.entries(s).map(([field, read_value]) => ({
    field,
    read_value,
    edited: edited.includes(field),
  })),
  ...over,
});
const project = (over: Partial<Project> = {}): Project =>
  ({
    id: "p1",
    name: "drawing-file-name",
    number: null,
    status: "created",
    stage: "Estimating",
    archived: false,
    created_at: "x",
    document: null,
    client: null,
    location: null,
    building_type: null,
    ...over,
  }) as Project;

describe("the Project details step", () => {
  const calls: {
    url: string;
    method: string;
    body: Record<string, unknown>;
  }[] = [];
  let details: Answer;
  let proj: Project;
  beforeEach(() => {
    calls.length = 0;
    details = answer(sug());
    proj = project();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({
          url,
          method,
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        const body = url.endsWith("/project-details")
          ? details
          : url.endsWith("/details")
            ? { saved: ["name"], name_kept: false, project: {} }
            : url.endsWith("/read")
              ? { queued: true }
              : proj;
        return {
          ok: true,
          status: 200,
          statusText: "",
          text: async () => JSON.stringify(body),
        };
      }),
    );
  });
  const mount = (mode: "new" | "edit" = "new") => {
    const onClose = vi.fn();
    render(<ProjectIntake projectId="p1" mode={mode} onClose={onClose} />);
    return onClose;
  };
  const input = (label: string) =>
    screen.getByLabelText(label) as HTMLInputElement;
  const put = () => calls.find((c) => c.method === "PUT");

  it("has exactly four fields; a suggestion is grey placeholder text, never a typed value", async () => {
    mount();
    await waitFor(() =>
      expect(input("client").placeholder).toBe("Acme Holdings"),
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
    expect(input("project name").placeholder).toBe("Riverside Warehouse");
    expect(input("project name").value).toBe("");
    expect(input("client").value).toBe("");
    expect(input("location").placeholder).toBe("Portland, OR");
    // no suggestion: empty for the person to type
    expect(input("building type").placeholder).toBe("");
    expect(input("building type").value).toBe("");
  });

  it("Save with nothing touched stores the suggestions (and only those)", async () => {
    mount();
    await waitFor(() =>
      expect(input("client").placeholder).toBe("Acme Holdings"),
    );
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(put()).toBeTruthy());
    expect(put()!.body).toMatchObject({
      name: "Riverside Warehouse",
      client: "Acme Holdings",
      location: "Portland, OR",
    });
    expect(put()!.body).not.toHaveProperty("building_type"); // no suggestion, nothing typed
    expect(put()!.body.who).toBeDefined();
  });

  it("typed text wins over the suggestion; a cleared field is sent empty", async () => {
    mount();
    await waitFor(() =>
      expect(input("client").placeholder).toBe("Acme Holdings"),
    );
    fireEvent.change(input("client"), { target: { value: "Bravo Foods" } });
    fireEvent.change(input("location"), { target: { value: "x" } });
    fireEvent.change(input("location"), { target: { value: "" } }); // typed, then cleared
    fireEvent.change(input("building type"), {
      target: { value: "Industrial" },
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(put()).toBeTruthy());
    expect(put()!.body).toMatchObject({
      name: "Riverside Warehouse",
      client: "Bravo Foods",
      location: "", // explicitly cleared stays empty (the suggestion is NOT stored)
      building_type: "Industrial",
    });
  });

  it("Skip saves nothing and closes", async () => {
    const onClose = mount();
    await waitFor(() =>
      expect(input("client").placeholder).toBe("Acme Holdings"),
    );
    fireEvent.click(screen.getByText("Skip"));
    expect(onClose).toHaveBeenCalledWith();
    expect(put()).toBeUndefined();
  });

  it("says reading… while the reader runs, fills the suggestions when ready, and typing survives", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    details = answer(
      sug({ project_name: null, owner: null, location: null }),
      [],
      {
        status: "not_read",
        reading: true,
      },
    );
    mount();
    await waitFor(() => screen.getByTestId("intake-reading"));
    // the person types the client while it reads
    fireEvent.change(input("client"), { target: { value: "My Client" } });
    details = answer(sug());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    await waitFor(() =>
      expect(input("location").placeholder).toBe("Portland, OR"),
    );
    expect(screen.queryByTestId("intake-reading")).toBeNull();
    expect(input("client").value).toBe("My Client"); // not overwritten
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(put()).toBeTruthy());
    expect(put()!.body).toMatchObject({
      client: "My Client",
      location: "Portland, OR",
    });
  });

  it("can be saved while it is still reading: untouched fields send nothing", async () => {
    details = answer({}, [], { status: "not_read", reading: true });
    mount();
    await waitFor(() => screen.getByTestId("intake-reading"));
    fireEvent.change(input("location"), { target: { value: "Austin, TX" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(put()).toBeTruthy());
    expect(put()!.body).toMatchObject({ location: "Austin, TX" });
    expect(put()!.body).not.toHaveProperty("name");
    expect(put()!.body).not.toHaveProperty("client");
  });

  it("queues a read when none ran, once", async () => {
    details = answer({}, [], { status: "not_read", reading: false });
    mount();
    await waitFor(() =>
      expect(
        calls.filter((c) => c.url.endsWith("/project-details/read")),
      ).toHaveLength(1),
    );
  });

  it("edit mode: saved values are values; a field a person cleared stays empty with no suggestion", async () => {
    proj = project({
      name: "Real Name",
      client: "Saved Client",
      location: null,
    });
    details = answer(sug(), ["location"]); // location was edited (cleared) before
    mount("edit");
    await waitFor(() => expect(input("client").value).toBe("Saved Client"));
    expect(input("project name").value).toBe("Real Name");
    expect(input("location").value).toBe("");
    expect(input("location").placeholder).toBe(""); // cleared by a person: no suggestion
    expect(input("building type").value).toBe(""); // never set, no suggestion either
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(put()).toBeTruthy());
    // untouched fields that already hold a value (or were cleared by a person) are not sent
    expect(Object.keys(put()!.body)).toEqual(["who"]);
  });

  it("a server refusal (the name is taken) is shown and the step stays open", async () => {
    const real = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        init?.method === "PUT"
          ? {
              ok: false,
              status: 409,
              statusText: "Conflict",
              text: async () =>
                JSON.stringify({
                  error: "a project with that name already exists",
                }),
            }
          : real(url, init),
      ),
    );
    const onClose = mount();
    await waitFor(() =>
      expect(input("client").placeholder).toBe("Acme Holdings"),
    );
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => screen.getByRole("alert"));
    expect(screen.getByRole("alert").textContent).toContain("already exists");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("what a save sends", () => {
  it("typed beats suggestion; untouched without a suggestion is not sent", () => {
    expect(
      intakePayload(
        { client: " X " },
        { name: "N", client: "C", location: null },
      ),
    ).toEqual({ name: "N", client: "X" });
    expect(intakePayload({ location: "" }, { location: "L" })).toEqual({
      location: "",
    });
    expect(intakePayload({}, {})).toEqual({});
  });
});

describe("the project card", () => {
  const card = (p: Project, onAction = vi.fn()) =>
    render(<ProjectCard p={p} onOpen={vi.fn()} onAction={onAction} />);

  it("shows a muted 'details not set' marker when the details are empty, and no popup", () => {
    expect(detailsNotSet(project())).toBe(true);
    card(project());
    expect(screen.getByTestId("details-not-set").textContent).toBe(
      "details not set",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the details instead once one is set", () => {
    const p = project({ client: "Acme", building_type: "Warehouse" });
    expect(detailsNotSet(p)).toBe(false);
    card(p);
    expect(screen.queryByTestId("details-not-set")).toBeNull();
    expect(screen.getByTestId("details-line").textContent).toBe(
      "Acme · Warehouse",
    );
  });

  it("the ⋮ menu has Edit details", () => {
    const onAction = vi.fn();
    card(project(), onAction);
    fireEvent.click(screen.getByLabelText("actions for drawing-file-name"));
    fireEvent.click(screen.getByText("Edit details"));
    expect(onAction).toHaveBeenCalledWith("details");
  });
});

describe("the step opens once, after the scan", () => {
  const stub = (
    scan: { status: string; pages: number; pages_done: number } | null,
  ) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "",
        text: async () =>
          JSON.stringify({ scan, pipeline: null, auto_build: null }),
      })),
    );

  it("onScanned fires when the Scan step is done, and only once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stub({ status: "done", pages: 3, pages_done: 3 });
    const onScanned = vi.fn();
    render(
      <ProcessingPanel
        projectId="p1"
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onScanned={onScanned}
      />,
    );
    await waitFor(() => expect(onScanned).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000); // more polls
    });
    expect(onScanned).toHaveBeenCalledTimes(1);
  });

  it("does not fire while the scan is still running", async () => {
    stub({ status: "running", pages: 3, pages_done: 1 });
    const onScanned = vi.fn();
    render(
      <ProcessingPanel
        projectId="p1"
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onScanned={onScanned}
      />,
    );
    await waitFor(() => screen.getByText(/Scan/));
    expect(onScanned).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
// Phase 0 profile from callout: the source chip, the search panel (live counts, Mark all preview,
// accept, proposals for existing members) and the highlights (SYNTHETIC).
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Piece } from "../lib/lf";
import { NO_TEXT_NOTE, noText, sourceChip } from "../lib/profile-callout";
import { ProfileMarks } from "./ProfileMarks";
import { ProfilePanel, type ProfileOverlay } from "./ProfilePanel";
import { ProfileSourceChip } from "./PropertiesPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("source chip", () => {
  it("green from its own label, amber from typical / example, grey typed, nothing without one", () => {
    expect(
      sourceChip({ profile_source: "label", profile_link: { reason: "r" } }),
    ).toMatchObject({ text: "from label", tone: "green", title: "r" });
    expect(
      sourceChip({
        profile_source: "label",
        profile_link: { confidence: "low", reason: "x" },
      }),
    ).toMatchObject({ tone: "amber", text: "from label (unsure)" });
    expect(sourceChip({ profile_source: "typical" })).toMatchObject({
      tone: "amber",
    });
    expect(
      sourceChip({
        profile_source: "example",
        profile_link: { note: "label W12X65, example W12X53" },
      })!.title,
    ).toContain("label W12X65, example W12X53");
    expect(sourceChip({ profile_source: "person" })).toMatchObject({
      tone: "grey",
    });
    expect(sourceChip({ profile_source: null })).toBeNull();
  });

  it("the properties panel shows the chip and an (E) existing mark", () => {
    render(
      <ProfileSourceChip
        piece={{ profile_source: "typical", existing: true } as Piece}
      />,
    );
    expect(screen.getByTestId("profile-source").className).toContain("amber");
    expect(screen.getByTestId("existing-chip").textContent).toBe("existing");
  });

  it("a page with no text layer says so", () => {
    expect(noText({ labels_read: true, labels_text_lines: 0 })).toBe(true);
    expect(noText({ labels_read: false, labels_text_lines: 0 })).toBe(false);
    expect(noText({ labels_read: true, labels_text_lines: 12 })).toBe(false);
    expect(NO_TEXT_NOTE).toContain("Find similar");
  });
});

describe("highlights", () => {
  it("occurrences are highlighted (grey when not in the catalog); a proposed member is dashed and a click unticks it", () => {
    const onToggle = vi.fn();
    render(
      <svg>
        <ProfileMarks
          px={1}
          occurrences={[
            {
              label_id: "a",
              sheet_id: "s",
              view_id: "v",
              text: "W12X26",
              raw: "W12X26",
              canonical: "W12X26",
              valid: true,
              flags: [],
              box: [0, 0, 20, 8],
            },
            {
              label_id: "b",
              sheet_id: "s",
              view_id: "v",
              text: "W12X999",
              raw: "W12X999",
              canonical: "W12X999",
              valid: false,
              flags: [],
              box: [30, 0, 50, 8],
            },
          ]}
          proposals={[
            {
              kind: "new",
              label_id: "a",
              text: "W12X26",
              proposed: "W12X26",
              at: [5, 5],
              position: "leader end",
              can_create: true,
              ticked: true,
              reason: "",
            },
          ]}
          unticked={new Set()}
          onToggle={onToggle}
        />
      </svg>,
    );
    const occ = screen.getAllByTestId("profile-occurrence");
    expect(occ.map((o) => o.getAttribute("data-valid"))).toEqual(["1", "0"]);
    const prop = screen.getByTestId("profile-proposed-member");
    expect(
      prop.querySelector("circle")!.getAttribute("stroke-dasharray"),
    ).toBeTruthy();
    fireEvent.click(prop);
    expect(onToggle).toHaveBeenCalledWith("a");
  });
});

describe("profile panel", () => {
  const calls: {
    url: string;
    method: string;
    body: Record<string, unknown>;
  }[] = [];
  const reply = (url: string): unknown => {
    if (url.includes("/profile-search?"))
      return {
        query: "w12x26",
        canonical: "W12X26",
        total: 5,
        per_sheet: [
          { sheet_id: "s1", page_number: 3, sheet_number: "S1.1", count: 2 },
          { sheet_id: "s2", page_number: 4, sheet_number: null, count: 3 },
        ],
        occurrences: [
          {
            label_id: "a",
            sheet_id: "s1",
            view_id: "v",
            text: "W12X26",
            raw: "W12X26",
            canonical: "W12X26",
            valid: true,
            flags: [],
            box: [0, 0, 20, 8],
          },
          {
            label_id: "b",
            sheet_id: "s1",
            view_id: "v",
            text: "W12X26",
            raw: "W12X26",
            canonical: "W12X26",
            valid: true,
            flags: [],
            box: [0, 20, 20, 28],
          },
        ],
        labels: { sheets: 2, read: 2, no_text: 0 },
        ms: 3,
      };
    if (url.includes("/profile-counts"))
      return {
        profiles: [
          { profile: "W12X26", project: 5, sheet: 2, valid: true, existing: 1 },
        ],
        joists: { project: 4, sheet: 1 },
        labels: { sheets: 2, read: 1, no_text: 0 },
      };
    if (url.includes("/profile-proposals"))
      return {
        proposals: [
          {
            member_id: "m1",
            tag: "C1",
            current: "W12X53",
            proposed: "W12X65",
            confidence: "high",
            reason: "nearest label",
            set_existing: false,
          },
        ],
      };
    if (url.endsWith("/profile-search/mark"))
      return {
        query: "w12x26",
        canonical: "W12X26",
        occurrences: 2,
        accepted: false,
        created: 0,
        updated: 0,
        proposals: [
          {
            kind: "set",
            label_id: "a",
            member_id: "m1",
            tag: "C1",
            current: "W12X53",
            proposed: "W12X26",
            change: true,
            confidence: "high",
            reason: "nearest",
            ticked: true,
          },
          {
            kind: "new",
            label_id: "b",
            text: "W12X26",
            proposed: "W12X26",
            at: [1, 2],
            position: "leader end",
            can_create: true,
            ticked: true,
            reason: "no column linked",
          },
        ],
      };
    return { applied: 1, queued: true };
  };
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method ?? "GET",
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        const body = reply(url);
        return {
          ok: true,
          status: 200,
          statusText: "",
          text: async () => JSON.stringify(body),
        };
      }),
    );
  });
  const mount = (
    over: Partial<React.ComponentProps<typeof ProfilePanel>> = {},
  ) => {
    const overlays: (ProfileOverlay | null)[] = [];
    const onChanged = vi.fn();
    render(
      <ProfilePanel
        projectId="p"
        sheetId="s1"
        who="t"
        noText={false}
        version={0}
        onOverlay={(o) => overlays.push(o)}
        onChanged={onChanged}
        onError={vi.fn()}
        {...over}
      />,
    );
    fireEvent.click(screen.getByText(/Profile search/));
    return { overlays, onChanged };
  };

  it("typing a profile shows the counts on the sheet and in the project, per sheet, and highlights", async () => {
    const { overlays } = mount();
    fireEvent.change(screen.getByLabelText("profile search"), {
      target: { value: "w12x26" },
    });
    await waitFor(() => screen.getByTestId("profile-counts"));
    expect(screen.getByTestId("profile-counts").textContent).toContain(
      "2 on this sheet, 5 in the project (2 sheets)",
    );
    expect(screen.getByText("Page 3 (S1.1): 2")).toBeTruthy();
    expect(overlays.at(-1)!.occurrences).toHaveLength(2);
    expect(
      calls.find((c) => c.url.includes("/profile-search?"))!.url,
    ).toContain("sheet_id=s1");
  });

  it("Mark all previews first (nothing sent to accept), unticking is shown, Accept sends the unticked list", async () => {
    const { overlays, onChanged } = mount();
    fireEvent.change(screen.getByLabelText("profile search"), {
      target: { value: "w12x26" },
    });
    await waitFor(() => screen.getByTestId("mark-all"));
    fireEvent.click(screen.getByTestId("mark-all"));
    await waitFor(() => screen.getByTestId("mark-preview"));
    expect(screen.getByTestId("mark-preview").textContent).toContain(
      "nothing is counted until you accept",
    );
    expect(screen.getByTestId("mark-set").textContent).toContain(
      "C1: W12X53 → W12X26",
    );
    expect(screen.getByTestId("mark-new").textContent).toContain(
      "New member W12X26 (leader end)",
    );
    expect(overlays.at(-1)!.proposals).toHaveLength(2);
    expect(
      calls
        .filter((c) => c.url.endsWith("/mark"))
        .every((c) => c.body.accept === undefined),
    ).toBe(true);
    fireEvent.click(screen.getByTestId("mark-new").querySelector("input")!); // untick the new one
    fireEvent.click(screen.getByTestId("mark-accept"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const acc = calls.filter((c) => c.url.endsWith("/mark")).at(-1)!;
    expect(acc.body).toMatchObject({ accept: true, unticked: ["b"] });
  });

  it("existing members that disagree with their label are listed, and Apply is one call", async () => {
    mount();
    await waitFor(() => screen.getByTestId("profile-proposals"));
    expect(screen.getByTestId("profile-proposals").textContent).toContain(
      "C1: W12X53 → W12X65",
    );
    expect(screen.getByTestId("profile-proposal-count").textContent).toBe("1");
    await act(async () => {
      fireEvent.click(screen.getByTestId("apply-proposals"));
    });
    expect(
      calls.filter((c) => c.url.endsWith("/profile-proposals/apply")),
    ).toHaveLength(1);
  });

  it("joists are a separate count; unread sheets can be read; no-text pages say so", async () => {
    mount({ noText: true });
    await waitFor(() => screen.getByTestId("joist-count"));
    expect(screen.getByTestId("joist-count").textContent).toContain(
      "1 on this sheet, 4 in the project",
    );
    expect(screen.getByTestId("no-text-note").textContent).toBe(NO_TEXT_NOTE);
    fireEvent.click(screen.getByText("Read this sheet"));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/profile-labels/read"))).toBe(
        true,
      ),
    );
  });
});

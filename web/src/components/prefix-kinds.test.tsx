// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrefixKinds } from "./PrefixKinds";
import type { KindInfo } from "../lib/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const KINDS: KindInfo[] = [
  {
    kind: "Beams",
    scope: "main",
    symbol_group: "linear",
    prefix: "BE",
    provisional: true,
    sort: 1,
  },
  {
    kind: "Column",
    scope: "main",
    symbol_group: "column",
    prefix: "CO",
    provisional: true,
    sort: 2,
  },
];

function fakeApi() {
  let rows: { prefix: string; kind: string; set_by: string; set_at: string }[] =
    [];
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, url, body });
      let out: unknown = { rows };
      if (method === "PUT") {
        rows = rows.filter((r) => r.prefix !== body.prefix);
        if (body.kind)
          rows.push({
            prefix: body.prefix,
            kind: body.kind,
            set_by: body.who,
            set_at: "2026-10-14T00:00:00Z",
          });
        out = { rows };
      } else if (url.endsWith("/import")) {
        out = {
          applied: !!body.apply,
          rows: 1,
          problems: [],
          changes: [{ prefix: "C", before: null, after: "Column" }],
        };
      }
      return new Response(JSON.stringify(out), { status: 200 });
    }),
  );
  return calls;
}

describe("the estimator mark prefix setting", () => {
  it("starts empty and says so", async () => {
    fakeApi();
    render(
      <PrefixKinds projectId="p" kinds={KINDS} who="alice" onError={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("prefix-kinds-empty")).toBeTruthy(),
    );
  });

  it("sets a prefix with a kind of the list", async () => {
    const calls = fakeApi();
    render(
      <PrefixKinds projectId="p" kinds={KINDS} who="alice" onError={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("mark prefix"), {
      target: { value: "b" },
    });
    fireEvent.change(screen.getByLabelText("kind of the prefix"), {
      target: { value: "Beams" },
    });
    fireEvent.click(screen.getByTestId("prefix-add"));
    await waitFor(() =>
      expect(screen.getByText("Beams", { selector: ".kind" })).toBeTruthy(),
    );
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({ who: "alice", prefix: "B", kind: "Beams" });
  });

  it("a file is previewed first; Apply only after a clean preview", async () => {
    const calls = fakeApi();
    render(
      <PrefixKinds projectId="p" kinds={KINDS} who="alice" onError={vi.fn()} />,
    );
    const apply = screen.getByTestId("prefix-apply") as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("prefix file"), {
      target: { value: "prefix,kind\nC,Column\n" },
    });
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("prefix-preview"));
    await waitFor(() =>
      expect(screen.getByTestId("prefix-import-result").textContent).toContain(
        "preview: 1 rows, 1 changes",
      ),
    );
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.endsWith("/import") && (c.body as { apply: boolean }).apply,
        ),
      ).toBe(true),
    );
  });
});

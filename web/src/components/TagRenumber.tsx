// Phase 14f: "Renumber tags" (project level, one recorded action; Undo puts every tag back) and the
// check before an Excel export: when tags have gaps or duplicates the person is asked to renumber
// first, export as is, or cancel.
import { useState } from "react";
import { api, send } from "../lib/api";
import {
  TAG_GAPS_ASK,
  tagAskText,
  tagsNeedRenumber,
  type TagPreview,
} from "../lib/lf";

type Ask = TagPreview & { href: string | null };

export interface TagRenumberOptions {
  projectId: string;
  who: string;
  say: (msg: string) => void;
  fail: (e: unknown) => void;
  refresh: () => unknown;
  /** Where an export goes (window.location.assign; replaced in tests). */
  go?: (href: string) => void;
}

/** startExport(href): check the tags, then export or ask; askRenumber(): the menu item; dialog: the
 * element to render. */
export function useTagRenumber(o: TagRenumberOptions) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const go = o.go ?? ((href: string) => window.location.assign(href));
  const preview = () =>
    api<TagPreview>(`/api/projects/${o.projectId}/tags/renumber`);

  const startExport = async (href: string) => {
    let p: TagPreview | null = null;
    try {
      p = await preview();
    } catch {
      p = null; // the check failed: export as it is
    }
    if (p && tagsNeedRenumber(p)) setAsk({ ...p, href });
    else go(href);
  };

  const askRenumber = async () => {
    try {
      setAsk({ ...(await preview()), href: null });
    } catch (e) {
      o.fail(e);
    }
  };

  const renumber = async (then: string | null) => {
    setAsk(null);
    try {
      const r = await send<{ changed: number }>(
        "POST",
        `/api/projects/${o.projectId}/tags/renumber`,
        { who: o.who },
      );
      o.say(
        r.changed
          ? `${r.changed} tags renumbered (Undo puts them back)`
          : "Tags already in order",
      );
      await o.refresh();
      if (then) go(then);
    } catch (e) {
      o.fail(e);
    }
  };

  const dialog = ask && (
    <div className="modal-back" onClick={() => setAsk(null)}>
      <div
        className="modal"
        role="dialog"
        aria-label="renumber tags"
        data-testid="tag-ask"
        onClick={(e) => e.stopPropagation()}
      >
        <b>
          {ask.href
            ? TAG_GAPS_ASK
            : tagsNeedRenumber(ask)
              ? "Renumber tags"
              : "Tags are in order"}
        </b>
        <span className="muted">{tagAskText(ask)}</span>
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button onClick={() => setAsk(null)}>Cancel</button>
          {ask.href && (
            <button
              onClick={() => {
                const href = ask.href!;
                setAsk(null);
                go(href);
              }}
            >
              Export as is
            </button>
          )}
          {tagsNeedRenumber(ask) && (
            <button className="primary" onClick={() => void renumber(ask.href)}>
              {ask.href ? "Renumber and export" : "Renumber"}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return { startExport, askRenumber, dialog };
}

import React, { useEffect, useRef, useState } from "react";
import { ApiError, send } from "../lib/api";
import {
  shownAt,
  STRICTNESS_MAX,
  STRICTNESS_MIN,
  STRICTNESS_STEP,
  ticked,
  untickedShown,
  type SimilarMatch,
} from "../lib/similar";

/** Phase 0-14g: shown when the example is the ink under the click, not a stored symbol. */
export const EXAMPLE_FROM_DRAWING =
  "Example taken from the drawing — check the orange box.";

export interface SimilarPreview {
  example: {
    family: string;
    real_in: [number, number];
    /** Phase 0-14g: where the example came from, its box corners (page points), its own turn */
    source?: "vector" | "ink";
    box?: [number, number, number, number] | null;
    centre?: [number, number] | null;
    angle?: number;
    rect?: [number, number][] | null;
  };
  /** Phase 0-14g: how the example was found; `moved` = the column went onto the ink's centre */
  snap?: {
    source: "symbol" | "ink";
    distance: number;
    moved: boolean;
    centre: [number, number];
  } | null;
  angles?: number[];
  /** Phase 0-14g: 'unchecked_ink' = no symbol was found; the example is the ink under the click */
  warning?: string | null;
  /** Phase 0: false = no column symbols are stored for this page; the example is read from the ink */
  symbols_stored?: boolean;
  count: number;
  points: [number, number][];
  accepted: boolean;
  /** Phase 14d: the image search (FIND_SIMILAR_IMAGE): its run, sources and runtime */
  image?: boolean;
  run_id?: string | null;
  sources?: ("vector" | "image")[];
  runtime_s?: number | null;
  /** Phase 14e: every match with its score (null: a vector match) */
  matches?: SimilarMatch[];
  strictness_default?: number;
}

/** The matches of a preview (older answers without `matches`: the points, as vector matches). */
export const previewMatches = (p: SimilarPreview): SimilarMatch[] =>
  p.matches ??
  p.points.map((c, k) => ({
    centre: c,
    source: p.sources?.[k] ?? "vector",
    score: null,
  }));

/** Phase 14b/14d/14e: after a column is placed, "Find similar" previews the matches of the drawing
 * (a spinner while the search runs). The matches show on the canvas with their scores; the
 * strictness slider filters the image matches live (no new search); a click on a match unticks
 * it. Accept adds only the ticked ones as one undoable action (the strictness and the untick list
 * are logged for training data); Cancel leaves the page as it is. Enter accepts, Esc cancels. */
export const FindSimilarBar: React.FC<{
  projectId: string;
  memberId: string;
  who: string;
  preview: SimilarPreview | null;
  /** Phase 0-14g: false = leave the column where it is (placed with Shift, or nudged) */
  snap?: boolean;
  /** awaited before a search starts (pending nudges are sent first) */
  beforeSearch?: () => Promise<void>;
  /** Phase 0-column-capture: the capture box a person changed [x0, y0, x1, y1]; Find similar searches
   * exactly it. Undefined: the default tight box (as main). */
  box?: [number, number, number, number] | null;
  onPreview: (p: SimilarPreview) => void;
  strictness: number;
  onStrictness: (v: number) => void;
  unticked: ReadonlySet<string>;
  onDone: (created: number) => void;
  onClose: () => void;
  onError: (e: unknown) => void;
}> = ({
  projectId,
  memberId,
  who,
  preview,
  snap = true,
  beforeSearch,
  box,
  onPreview,
  strictness,
  onStrictness,
  unticked,
  onDone,
  onClose,
  onError,
}) => {
  const [busy, setBusy] = useState(false);
  const [above, setAbove] = useState(0.85);
  // the one-click action offered when the reason is a missing page scale
  const [needScale, setNeedScale] = useState(false);
  // the time of the last search, logged with the accept (Phase 0-column-capture)
  const lastMs = useRef<number | null>(null);
  const url = `/api/projects/${projectId}/line-first/pieces/${memberId}/find-similar`;
  const all = preview ? previewMatches(preview) : [];
  const shown = shownAt(all, strictness);
  const chosen = ticked(all, strictness, unticked);
  const hasScores = all.some((m) => m.score !== null);
  // accept = false: a preview; accept = true: the ticked matches at the strictness; `atScore`: every
  // match scoring at least that (the unticks are not applied: accept all above score X)
  const run = (accept: boolean, atScore?: number) => {
    setBusy(true);
    const body: Record<string, unknown> = { who, accept };
    if (!snap) body.snap = false;
    if (box) body.box = box; // the box searched (logged with the accept; the job already has it)
    if (accept) {
      if (preview?.run_id) body.run_id = preview.run_id;
      body.strictness = atScore ?? strictness;
      body.unticked =
        atScore === undefined ? untickedShown(all, strictness, unticked) : [];
      if (lastMs.current !== null)
        body.timing = { find_similar_ms: lastMs.current };
    }
    const t0 = performance.now();
    (beforeSearch ? beforeSearch() : Promise.resolve())
      .then(() => send<SimilarPreview>("POST", url, body))
      .then(
        (r) => {
          if (accept) onDone(r.accepted ? r.count : 0);
          else {
            lastMs.current = Math.round(performance.now() - t0);
            onPreview(r);
          }
        },
        (e) => {
          setNeedScale(e instanceof ApiError && e.code === "no_scale");
          onError(e);
        },
      )
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    // Phase 0-column-capture keyboard flow: Enter = Find similar (then accept), A = accept, Esc = cancel
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" && (e.target as HTMLInputElement).type !== "range")
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter" && !busy) {
        if (preview && chosen.length > 0) {
          e.preventDefault();
          run(true);
        } else if (!preview) {
          e.preventDefault();
          run(false);
        }
      } else if (
        (e.key === "a" || e.key === "A") &&
        preview &&
        chosen.length > 0 &&
        !busy
      ) {
        e.preventDefault();
        run(true);
      } else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const size = preview
    ? preview.example.real_in.map((v) => Math.round(v * 10) / 10).join(" × ")
    : "";
  return (
    <div className="find-similar" data-testid="find-similar">
      {busy && (
        <span className="spinner" data-testid="similar-spinner" role="status">
          <span className="spin" aria-hidden />
          Searching…
        </span>
      )}
      {!preview ? (
        <>
          {!busy && <span>Column placed.</span>}
          {needScale && (
            <button
              data-testid="set-scale"
              onClick={() => {
                const el = document.querySelector<HTMLInputElement>(
                  '[aria-label="scale"]',
                );
                el?.scrollIntoView?.({ block: "center" });
                el?.focus();
              }}
            >
              Set the page scale
            </button>
          )}
          <button disabled={busy} onClick={() => run(false)}>
            Find similar
          </button>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </>
      ) : (
        <>
          {preview.symbols_stored === false && (
            <span className="similar-note" data-testid="similar-no-symbols">
              No column symbols are stored for this page: the example is read
              from the drawing.
            </span>
          )}
          {preview.warning === "unchecked_ink" && (
            <span className="similar-warning" data-testid="similar-warning">
              {EXAMPLE_FROM_DRAWING}
            </span>
          )}
          <span data-testid="similar-count">
            {all.length === 0
              ? "No similar symbols found"
              : `${chosen.length} of ${shown.length} ticked (${preview.example.family.replace(/_/g, " ")}, ${size} in)`}
          </span>
          {hasScores && (
            <label
              className="strictness"
              title="Image matches scoring at least this are shown"
            >
              Strictness
              <input
                type="range"
                aria-label="strictness"
                min={STRICTNESS_MIN}
                max={STRICTNESS_MAX}
                step={STRICTNESS_STEP}
                value={strictness}
                onChange={(e) => onStrictness(Number(e.target.value))}
              />
              <b data-testid="strictness-value">{strictness.toFixed(2)}</b>
            </label>
          )}
          {all.length > 0 && (
            <button
              disabled={busy || chosen.length === 0}
              onClick={() => run(true)}
            >
              Accept {chosen.length}
            </button>
          )}
          {hasScores && (
            <span className="accept-above">
              <button
                disabled={
                  busy || all.every((m) => m.score === null || m.score < above)
                }
                onClick={() => run(true, above)}
                title="Accept every match scoring at least this, untick or not"
              >
                Accept all ≥
              </button>
              <input
                type="number"
                aria-label="accept above score"
                min={0.6}
                max={1}
                step={0.01}
                value={above}
                onChange={(e) => setAbove(Number(e.target.value))}
                style={{ width: 56 }}
              />
            </span>
          )}
          <button className="link" onClick={onClose}>
            Cancel
          </button>
        </>
      )}
    </div>
  );
};

/** Phase 14d: on a built column-plan page with no columns, the click-first hint. */
export const ColumnHint: React.FC<{ text: string }> = ({ text }) => (
  <div className="find-similar column-hint" data-testid="column-hint">
    {text}
  </div>
);

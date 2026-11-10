import React, { useEffect, useState } from "react";
import { send } from "../lib/api";
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
  onPreview,
  strictness,
  onStrictness,
  unticked,
  onDone,
  onClose,
  onError,
}) => {
  const [busy, setBusy] = useState(false);
  const url = `/api/projects/${projectId}/line-first/pieces/${memberId}/find-similar`;
  const all = preview ? previewMatches(preview) : [];
  const shown = shownAt(all, strictness);
  const chosen = ticked(all, strictness, unticked);
  const hasScores = all.some((m) => m.score !== null);
  const run = (accept: boolean) => {
    setBusy(true);
    const body: Record<string, unknown> = { who, accept };
    if (!snap) body.snap = false;
    if (accept) {
      if (preview?.run_id) body.run_id = preview.run_id;
      body.strictness = strictness;
      body.unticked = untickedShown(all, strictness, unticked);
    }
    (beforeSearch ? beforeSearch() : Promise.resolve())
      .then(() => send<SimilarPreview>("POST", url, body))
      .then((r) => {
        if (accept) onDone(r.accepted ? r.count : 0);
        else onPreview(r);
      }, onError)
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    if (!preview) return;
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" && (e.target as HTMLInputElement).type !== "range")
        return;
      if (e.key === "Enter" && chosen.length > 0 && !busy) {
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
          <button disabled={busy} onClick={() => run(false)}>
            Find similar
          </button>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </>
      ) : (
        <>
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

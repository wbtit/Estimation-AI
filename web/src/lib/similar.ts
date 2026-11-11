// Phase 14e: the Find similar preview the estimator corrects before Accept (pure). Every match
// with its source and score (null: a vector match); the strictness slider filters the image
// matches (score >= strictness; vector matches always) without a new search; a click on a match
// unticks it. The same filter as the API's `atStrictness` (api/src/review/image-similar.ts).

export interface SimilarMatch {
  centre: [number, number];
  source: "vector" | "image";
  score: number | null;
  /** Phase 0-column-capture: this match's OWN web direction (ccw from +X) and its state */
  orientation_deg?: number | null;
  orientation_state?: "clear" | "unsure" | "none" | null;
}

export const STRICTNESS_DEFAULT = 0.8;
export const STRICTNESS_MIN = 0.6;
export const STRICTNESS_MAX = 0.9;
export const STRICTNESS_STEP = 0.01;

export const matchKey = (m: { centre: [number, number] }) =>
  `${m.centre[0]},${m.centre[1]}`;

export function shownAt(
  ms: readonly SimilarMatch[],
  strictness: number,
): SimilarMatch[] {
  return ms.filter((m) => m.score === null || m.score >= strictness - 1e-9);
}

/** The matches Accept would add: shown at the strictness and not unticked. */
export function ticked(
  ms: readonly SimilarMatch[],
  strictness: number,
  unticked: ReadonlySet<string>,
): SimilarMatch[] {
  return shownAt(ms, strictness).filter((m) => !unticked.has(matchKey(m)));
}

/** The unticked points that are still shown (sent with Accept; hidden ones need no untick). */
export function untickedShown(
  ms: readonly SimilarMatch[],
  strictness: number,
  unticked: ReadonlySet<string>,
): [number, number][] {
  return shownAt(ms, strictness)
    .filter((m) => unticked.has(matchKey(m)))
    .map((m) => m.centre);
}

export function toggle(set: ReadonlySet<string>, key: string): Set<string> {
  const n = new Set(set);
  if (n.has(key)) n.delete(key);
  else n.add(key);
  return n;
}

/** The label beside a match on the canvas. */
export const scoreLabel = (m: SimilarMatch) =>
  m.score === null ? "shape" : m.score.toFixed(2);

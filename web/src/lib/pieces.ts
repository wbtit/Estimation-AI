// Count basis of the display: one piece per linked line (owner decision, Phase 7). A label on a line
// that already has its piece adds nothing; the label count is shown beside it so nothing is hidden.

/** "N pieces" with the label count when the two differ. */
export function piecesText(pieces: number, labels: number): string {
  if (labels === pieces) return `${pieces} pieces`;
  return `${pieces} pieces (one per linked line; ${labels} labels, those on a shared line add no extra piece)`;
}

/** The small note beside a row's quantity; empty when the row has no label on a shared line. */
export function rowLabelsNote(quantity: number, labels: number): string {
  return labels === quantity
    ? ""
    : `(${labels} label${labels === 1 ? "" : "s"})`;
}

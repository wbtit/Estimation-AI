import React from "react";
import { COLOUR_HEX } from "../lib/status";
import { boxOfLine } from "../lib/symbols";
import type { HistoryEdit, MemberView, Sheet, SheetView } from "../lib/types";
import type { Highlight } from "./SymbolOverlay";
import type { LegendRow } from "./MemberActions";

function when(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

function show(v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("reset" in o) return "the system's guess";
    if ("prefix" in o) return `${o.prefix ?? "?"}${o.number ?? ""}`;
    if ("line" in o) return "a line";
    return JSON.stringify(v);
  }
  return String(v);
}

const FIELD_WORD: Record<string, string> = {
  kind: "kind",
  kind_confirmed: "kind confirmed",
  tag: "tag",
  profile_raw: "size text",
  profile: "size",
  mark: "mark",
  review_status: "review",
  link: "line",
  type: "type",
  existing: "existing steel",
  not_member: "not a member",
  merged_into: "merged",
  shared_line: "shared line",
  mark_ref: "legend row",
  quantity: "quantity",
  level: "level",
};

/** One line of the evidence list; `onJump` is the clickable link to the evidence on the page. */
const Row: React.FC<{
  label: string;
  children: React.ReactNode;
  onJump?: () => void;
  jumpText?: string;
  grey?: boolean;
}> = ({ label, children, onJump, jumpText = "jump", grey }) => (
  <tr className={grey ? "ev grey" : "ev"}>
    <td className="ev-label">{label}</td>
    <td>
      {children}
      {onJump && (
        <>
          {" "}
          <button className="jump" onClick={onJump}>
            {jumpText}
          </button>
        </>
      )}
    </td>
  </tr>
);

export interface ExplanationProps {
  member: MemberView;
  sheet: Sheet | null;
  view: SheetView | null;
  legend: LegendRow[];
  history: HistoryEdit[];
  /** Page numbers by id, to write "jump to sheet N" for a schedule row. */
  onJump: (h: Highlight | null) => void;
  onGotoPage: (pageNumber: number) => void;
  actions: React.ReactNode;
}

/**
 * Why the system marked this piece the way it did: every item is shown with where it came from and
 * a link that jumps the page to it. Anything not found is written as "not found".
 */
export const ExplanationPanel: React.FC<ExplanationProps> = ({
  member: m,
  sheet,
  view,
  legend,
  history,
  onJump,
  onGotoPage,
  actions,
}) => {
  const labelJump = m.bbox
    ? () => onJump({ box: m.bbox!, kind: "label" })
    : undefined;
  const chosen = m.link.candidates.find((c) => c.rank === m.link.chosen_rank);
  const row = legend.find((r) => r.id === m.mark_ref.legend_row_id);
  const pt = sheet?.page_type;
  const missing: string[] = [];
  if (!m.profile) missing.push("size not parsed");
  if (m.kind.name === null) missing.push("kind");
  if (m.catalog && !m.catalog.found)
    missing.push("Unit W: profile not in the catalog");
  if (!m.link.line) missing.push("line");
  if (!view || view.scale.ratio === null)
    missing.push("scale (lengths come in Stage 2)");
  return (
    <div className="explain" data-testid="explanation">
      <h4>
        <span
          className="dot"
          style={{ background: COLOUR_HEX[m.status.color] }}
        />{" "}
        {m.tag.text || "(no tag)"} {m.kind.name ?? "no kind"}{" "}
        <b>{m.status.color}</b>
        {m.status.confirmed ? " (confirmed by a person)" : ""}
      </h4>
      {m.status.reasons.length > 0 && (
        <div className="warn">{m.status.reasons.join("; ")}</div>
      )}
      {m.system && m.system.color !== m.status.color && (
        <div className="hint">
          the system alone said {m.system.color}
          {m.system.reasons.length > 0
            ? ` (${m.system.reasons.join("; ")})`
            : ""}
        </div>
      )}
      <table className="kv evidence">
        <tbody>
          <Row label="Label text" onJump={labelJump}>
            {m.profile_raw ?? m.mark ?? "not found"}
            {m.mark && m.profile_raw ? ` (mark ${m.mark})` : ""}
          </Row>
          <Row
            label="Size"
            onJump={
              row && row.bbox && row.page_number === sheet?.page_number
                ? () => onJump({ box: row.bbox!, kind: "label" })
                : row
                  ? () => onGotoPage(row.page_number)
                  : undefined
            }
            jumpText={row ? `jump to sheet ${row.page_number}` : "jump"}
          >
            {m.profile ?? "not parsed"}
            {row
              ? `, from the schedule or legend row "${row.designation_raw}" (mark ${row.mark}, page ${row.page_number})`
              : m.mark
                ? ", mark not found in any schedule"
                : ", from the plan label only"}
          </Row>
          <Row label="Catalog">
            {m.catalog === null
              ? "not looked up"
              : m.catalog.found
                ? `${m.catalog.shape_name} (SHAPE ${m.catalog.shape}), Unit W ${m.catalog.unit_w_lb_ft} lb/ft` +
                  (m.catalog.via === "numeric"
                    ? ", matched by equal numbers"
                    : "")
                : `not in the catalog (${m.catalog.reason}): Unit W stays empty`}
          </Row>
          <Row label="Kind" onJump={labelJump}>
            {m.kind.name ?? "not found"}
            {m.kind.state === "missing" &&
              " (no kind word near the label: choose it)"}
            {m.kind.state === "ambiguous" &&
              ` (ambiguous word "${m.kind.evidence?.keyword}": ${m.kind.evidence?.candidates.join(", ")})`}
            {m.kind.state === "guessed" &&
              ` (guessed from the word "${m.kind.evidence?.keyword}" in the ${(m.kind.evidence?.where ?? "").replace("_", " ")}; source ${m.kind.source})`}
            {m.kind.state === "confirmed" && " (confirmed by a person)"}
          </Row>
          <Row label="Page type">
            {pt
              ? `${(pt.effective ?? "other").replace("_", " ")}${pt.overridden ? " (set by a person)" : " (guess)"}${pt.reason ? `: ${pt.reason}` : ""}`
              : "not found"}
          </Row>
          <Row
            label="Link"
            onJump={
              chosen
                ? () =>
                    onJump({ line: [...chosen.p, ...chosen.q], kind: "line" })
                : undefined
            }
            jumpText="show the line"
          >
            {chosen
              ? `label to line #${chosen.rank} of ${m.link.candidates.length} candidates, ${chosen.dist.toFixed(1)} pt away, ${chosen.rel_angle.toFixed(0)} deg off the text, score ${chosen.score.toFixed(1)}`
              : m.link.line
                ? "a line chosen by a person"
                : "no line found within reach"}
          </Row>
          <Row label="Rule">
            {m.link.confidence
              ? `confidence ${m.link.confidence}${m.link.margin !== null ? `, margin ${m.link.margin.toFixed(1)} pt` : ""} (frozen rule)`
              : "not found (added by a person)"}
          </Row>
          {m.link.candidates.length > 1 && (
            <Row label="Candidates">
              {m.link.candidates.map((c) => (
                <button
                  key={c.rank}
                  className="jump"
                  onClick={() =>
                    onJump({ line: [...c.p, ...c.q], kind: "candidate" })
                  }
                >
                  #{c.rank} ({c.dist.toFixed(0)} pt)
                </button>
              ))}
            </Row>
          )}
          <Row label="Scale of the view">
            {view && view.scale.ratio !== null
              ? `${view.scale.text ?? `1:${view.scale.ratio}`} (${view.scale.confirmed ? "confirmed" : "guessed, not confirmed"})`
              : "not found (scale needed; lengths come in Stage 2)"}
          </Row>
          <Row
            label="Shared line"
            onJump={
              m.link.line
                ? () =>
                    onJump({
                      line: [...m.link.line!.p, ...m.link.line!.q],
                      kind: "line",
                    })
                : undefined
            }
          >
            {m.shared_line
              ? `${m.shared_line.size} labels share this line${m.shared_line.resolved ? " (you said: separate)" : ""}`
              : "no"}
          </Row>
          <Row label="Linked line" grey>
            {chosen && chosen.length_mm !== null
              ? `about ${Math.round(chosen.length_mm)} mm (a hint only: never in a table or a total; lengths are added in Stage 2)`
              : "not found (lengths are added in Stage 2)"}
          </Row>
          <Row label="Missing">
            {missing.length ? missing.join("; ") : "nothing"}
          </Row>
        </tbody>
      </table>
      {m.flags.length > 0 && (
        <ul className="flag-list">
          {m.flags.map((f) => (
            <li key={f.code} className={`flag ${f.severity}`}>
              {f.text}
            </li>
          ))}
        </ul>
      )}
      {actions}
      <div className="history">
        <b>History</b>
        {history.length === 0 ? (
          <div className="hint">nobody has changed this piece</div>
        ) : (
          <ul>
            {history.map((h, i) => (
              <li key={i}>
                changed by {h.who}, {when(h.at)}:{" "}
                {FIELD_WORD[h.field] ?? h.field} from {show(h.before)} to{" "}
                {show(h.after)}
                {h.is_undo ? " (undo)" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export { boxOfLine };

import React from "react";
import type { Sheet, SheetFlags } from "../lib/types";

const TYPE_LABEL: Record<string, string> = {
  framing_plan: "framing plan",
  foundation_plan: "foundation plan",
  elevation: "elevation",
  detail: "detail",
  schedule_legend: "schedule / legend",
  general_notes: "general notes",
  other: "other",
  plan: "plan",
  schedule: "schedule",
  notes: "notes",
};

export function pageTypeLabel(sheet: Sheet): string {
  const t = sheet.page_type?.effective ?? sheet.kind;
  return TYPE_LABEL[t] ?? t;
}

export const PageList: React.FC<{
  sheets: Sheet[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Unconfirmed guesses per sheet; a sheet with none is confirmed. */
  flags?: Map<string, SheetFlags>;
}> = ({ sheets, selectedId, onSelect, flags }) => (
  <ul className="page-list" aria-label="pages">
    {sheets.map((s) => (
      <li key={s.id}>
        <button
          className={s.id === selectedId ? "page-item selected" : "page-item"}
          onClick={() => onSelect(s.id)}
          title={s.review_reasons.join(", ")}
        >
          {s.thumbnail_url ? (
            <img
              src={s.thumbnail_url}
              alt=""
              className="thumb"
              loading="lazy"
            />
          ) : (
            <div className="thumb empty" />
          )}
          <span className="page-meta">
            <b>{s.page_number}</b> {s.sheet_number ?? ""}
            <br />
            <small>
              {pageTypeLabel(s)}
              {s.page_type && !s.page_type.overridden ? " (guess)" : ""}
            </small>
            {s.takeoff?.decision === "include" && (
              <span className="dot green" title="in the takeoff" />
            )}
            {s.takeoff?.decision === "exclude" && (
              <span
                className="dot unlinked"
                title="excluded from the takeoff"
              />
            )}
            {s.takeoff?.decision === "undecided" && (
              <span
                className={s.takeoff.included ? "dot green" : "dot unlinked"}
                title={
                  s.takeoff.included
                    ? "in the takeoff by default (guess)"
                    : "out of the takeoff by default (guess)"
                }
              />
            )}
            {flags?.get(s.id) && (
              <small className="piece-count" title="pieces on this page">
                {" "}
                {flags.get(s.id)?.piece_count} pcs
              </small>
            )}
            {flags?.get(s.id)?.likely_not_framing && (
              <span
                className="flag-badge not-framing"
                title="likely not a framing sheet (page type guess): exclude it if it is not"
              >
                ?
              </span>
            )}
            {(flags?.get(s.id)?.flags.length ?? 0) > 0 && (
              <span
                className="flag-badge"
                title={flags
                  ?.get(s.id)
                  ?.flags.map((f) => f.text)
                  .join("; ")}
              >
                {flags?.get(s.id)?.flags.length}?
              </span>
            )}
            {s.needs_review && (
              <span className="dot amber" title="needs review" />
            )}
          </span>
        </button>
      </li>
    ))}
  </ul>
);

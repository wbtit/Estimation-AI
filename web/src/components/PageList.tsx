import React from "react";
import type { Sheet } from "../lib/types";

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
}> = ({ sheets, selectedId, onSelect }) => (
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
                className="dot amber"
                title="not decided yet: not in the takeoff"
              />
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

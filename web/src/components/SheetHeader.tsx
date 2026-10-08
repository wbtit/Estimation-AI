import React, { useEffect, useState } from "react";
import type { Sheet } from "../lib/types";

export const PAGE_TYPE_OPTIONS: [string, string][] = [
  ["framing_plan", "framing plan"],
  ["foundation_plan", "foundation plan"],
  ["elevation", "elevation"],
  ["detail", "detail"],
  ["schedule_legend", "schedule / legend"],
  ["general_notes", "general notes"],
  ["other", "other"],
];

export const SheetHeader: React.FC<{
  sheet: Sheet;
  onPageType: (value: string | null) => void;
  onLevel: (value: string | null) => void;
}> = ({ sheet, onPageType, onLevel }) => {
  const level = sheet.level?.effective ?? "";
  const [text, setText] = useState(level);
  useEffect(() => setText(level), [level, sheet.id]);
  const type = sheet.page_type;
  return (
    <div className="sheet-header">
      <span>
        Page <b>{sheet.page_number}</b> {sheet.sheet_number ?? ""}
      </span>
      <label>
        type{" "}
        <select
          value={type?.effective ?? "other"}
          onChange={(e) => onPageType(e.target.value)}
          aria-label="page type"
        >
          {PAGE_TYPE_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {type && !type.overridden && (
        <span className="hint" title={type.reason ?? ""}>
          guess: {type.reason ?? "no reason recorded"}
        </span>
      )}
      {type?.overridden && (
        <button
          onClick={() => onPageType(null)}
          title={`guess was ${type.guess}`}
        >
          reset to guess
        </button>
      )}
      <label>
        level{" "}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() =>
            text.trim() !== level &&
            onLevel(text.trim() === "" ? null : text.trim())
          }
          onKeyDown={(e) =>
            e.key === "Enter" && (e.target as HTMLInputElement).blur()
          }
          placeholder="level name"
          aria-label="level name"
        />
      </label>
      {sheet.level && !sheet.level.overridden && sheet.level.guess && (
        <span className="hint">(suggested)</span>
      )}
    </div>
  );
};

import React, { useEffect, useState } from "react";
import { formatFtIn } from "../lib/ftin";
import { common, MIXED, type Piece } from "../lib/lf";
import {
  HEIGHT_SOURCE_LABEL,
  parseHeightText,
  type ColumnHeightApi,
  type ColumnHeightPatch,
} from "../lib/column-height";

const text = (v: unknown): string =>
  v === null || v === undefined || v === MIXED ? "" : formatFtIn(Number(v));

/** One feet-inches field: commits on blur or Enter; junk is refused (nothing sent); empty clears. */
const HeightField: React.FC<{
  label: string;
  aria: string;
  value: unknown;
  kind: "height" | "elevation";
  mixed?: boolean;
  onCommit: (mm: number | null) => void;
}> = ({ label, aria, value, kind, mixed, onCommit }) => {
  const [t, setT] = useState(text(value));
  const [bad, setBad] = useState(false);
  const key = text(value);
  useEffect(() => setT(key), [key]);
  const commit = () => {
    const v = parseHeightText(t, kind);
    if (v === undefined) {
      setBad(true);
      return;
    }
    setBad(false);
    // unchanged (including a mixed selection left blank): nothing to send
    if (v === (value === MIXED || value === undefined ? undefined : value))
      return;
    if (mixed && t.trim() === "") return;
    onCommit(v);
  };
  return (
    <label className="fld">
      <span className="fld-label">{label}</span>
      <input
        aria-label={aria}
        aria-invalid={bad}
        placeholder={mixed ? MIXED : "—"}
        value={t}
        onChange={(e) => setT(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
};

/** Column height (its BOM length): the project default, this column's (or these columns') own
 * height and the optional top / base elevations. Several selected columns are set at once (one
 * recorded action, one Undo). The source of the height is shown; none set is shown amber. */
export const ColumnHeightSection: React.FC<{
  selected: readonly Piece[];
  api: ColumnHeightApi;
}> = ({ selected, api }) => {
  const ids = selected.map((p) => p.id);
  const own = common(selected.map((p) => p.column_height_mm ?? null));
  const top = common(selected.map((p) => p.column_top_mm ?? null));
  const base = common(selected.map((p) => p.column_base_mm ?? null));
  const height = common(selected.map((p) => p.height_mm ?? null));
  const source = common(selected.map((p) => p.height_source ?? null));
  const set = (patch: ColumnHeightPatch) => api.onSet(ids, patch);
  const multi = selected.length > 1;
  const anyNone = selected.some((p) => !p.height_mm);
  return (
    <div className="section" data-testid="column-height">
      <div className="sec-bar">
        <span className="sec-title">Column height</span>
        {multi && <span className="muted">{selected.length} selected</span>}
      </div>
      <div className="sec-body">
        <div className="fld-box" data-testid="height-result">
          <span className="fld-label">BOM length</span>
          {height === MIXED ? (
            <b>{MIXED}</b>
          ) : height === null ? (
            <b className="amber" data-testid="no-height">
              No height
            </b>
          ) : (
            <b>{formatFtIn(Number(height))}</b>
          )}
          {source !== MIXED && source !== null && (
            <span className="muted"> ({HEIGHT_SOURCE_LABEL[source]})</span>
          )}
          {height === MIXED && anyNone && (
            <span className="amber"> some have no height</span>
          )}
        </div>
        <HeightField
          label={multi ? "Height of all selected" : "Height of this column"}
          aria="column height"
          value={own}
          kind="height"
          mixed={own === MIXED}
          onCommit={(mm) => set({ height_mm: mm })}
        />
        <div className="two">
          <HeightField
            label="Top elevation (optional)"
            aria="column top elevation"
            value={top}
            kind="elevation"
            mixed={top === MIXED}
            onCommit={(mm) => set({ top_mm: mm })}
          />
          <HeightField
            label="Base elevation (optional)"
            aria="column base elevation"
            value={base}
            kind="elevation"
            mixed={base === MIXED}
            onCommit={(mm) => set({ base_mm: mm })}
          />
        </div>
        <HeightField
          label="Project default column height"
          aria="default column height"
          value={api.defaultMm}
          kind="height"
          onCommit={(mm) => api.onSetDefault(mm)}
        />
      </div>
    </div>
  );
};

import React from "react";
import {
  CATEGORY_COLOURS,
  CATEGORY_NAMES,
  type LabelCategory,
} from "../lib/labels";

export const LabelsPanel: React.FC<{
  counts: Record<LabelCategory, number>;
  visible: Set<LabelCategory>;
  onToggle: (c: LabelCategory) => void;
  textSource: string | null;
}> = ({ counts, visible, onToggle, textSource }) => (
  <div className="panel">
    <h3>Labels found on this sheet</h3>
    <p className="hint">
      Read from the PDF text layer ({textSource ?? "not read yet"}). A mark is
      only a candidate: it is not a claim that something is a member.
    </p>
    {(Object.keys(CATEGORY_NAMES) as LabelCategory[]).map((c) => (
      <label key={c} className="toggle">
        <input
          type="checkbox"
          checked={visible.has(c)}
          onChange={() => onToggle(c)}
        />{" "}
        <span className="swatch" style={{ background: CATEGORY_COLOURS[c] }} />{" "}
        {CATEGORY_NAMES[c]} <b>{counts[c]}</b>
      </label>
    ))}
  </div>
);

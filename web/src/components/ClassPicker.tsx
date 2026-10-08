import React, { useEffect, useState } from "react";
import { swatch } from "../lib/status";
import type { SheetView } from "../lib/types";

/** The stroke classes found inside a view; the user confirms which hold the member lines. */
export const ClassPicker: React.FC<{
  view: SheetView;
  busy: boolean;
  onFind: () => void;
  onUse: (classes: string[]) => void;
}> = ({ view, busy, onFind, onUse }) => {
  const [chosen, setChosen] = useState<string[]>(view.structural_classes);
  useEffect(
    () => setChosen(view.structural_classes),
    [view.id, view.structural_classes],
  );
  const table = view.class_table;
  return (
    <div className="class-picker">
      <h4>Member lines</h4>
      <button
        className="primary"
        disabled={busy || !view.scale.confirmed}
        onClick={onFind}
      >
        {busy
          ? "Finding members..."
          : table
            ? "Find members again"
            : "Find members in this view"}
      </button>
      {!view.scale.confirmed && (
        <div className="hint">Confirm the scale first.</div>
      )}
      {table && (
        <>
          <p className="hint">
            Line styles inside the box (width, color, solid or dashed). Tick the
            style the beams are drawn in.{" "}
            {view.classes_confirmed
              ? "Confirmed by a person."
              : "Suggested by the rule; not confirmed yet."}
          </p>
          <ul className="class-list">
            {table.slice(0, 12).map((c, i) => (
              <li key={c.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.includes(c.key)}
                    onChange={() =>
                      setChosen((cur) =>
                        cur.includes(c.key)
                          ? cur.filter((k) => k !== c.key)
                          : [...cur, c.key],
                      )
                    }
                  />{" "}
                  <span className="swatch" style={{ background: swatch(i) }} />{" "}
                  {c.key}{" "}
                  <small>
                    {c.lines} lines, {Math.round(c.length_pt)} pt
                  </small>
                </label>
              </li>
            ))}
          </ul>
          <button
            disabled={busy || chosen.length === 0}
            onClick={() => onUse(chosen)}
          >
            Use these and find members again
          </button>
        </>
      )}
    </div>
  );
};

import React, { useEffect, useState } from "react";
import { swatch } from "../lib/status";
import type { SheetView } from "../lib/types";

/**
 * Step by step: show the line classes of the view (the worker suggests one), tick the ones the beams
 * are drawn in (the suggestion is preselected) and confirm. Members are found only after that: the
 * link job refuses to run on a view whose classes nobody confirmed.
 */
export const ClassPicker: React.FC<{
  view: SheetView;
  busy: boolean;
  onShow: () => void;
  onConfirm: (classes: string[]) => void;
  onFind: () => void;
}> = ({ view, busy, onShow, onConfirm, onFind }) => {
  const [chosen, setChosen] = useState<string[]>(view.structural_classes);
  useEffect(
    () => setChosen(view.structural_classes),
    [view.id, view.structural_classes],
  );
  const table = view.class_table;
  const confirmed = view.classes_confirmed;
  const changed =
    chosen.length !== view.structural_classes.length ||
    chosen.some((k) => !view.structural_classes.includes(k));
  return (
    <div className="class-picker">
      <h4>Member lines</h4>
      {!table && (
        <>
          <p className="hint">
            Step 1: look at the line styles inside this box. Members are found
            only after you confirm which style the beams are drawn in.
          </p>
          <button className="primary" disabled={busy} onClick={onShow}>
            {busy ? "Reading the lines..." : "Show the line classes"}
          </button>
        </>
      )}
      {table && (
        <>
          <p className="hint">
            Line styles inside the box (width, color, solid or dashed). Tick the
            style the beams are drawn in.{" "}
            {confirmed
              ? "Confirmed by a person."
              : "The rule's suggestion is ticked; it is NOT confirmed yet."}
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
          {(!confirmed || changed) && (
            <button
              className="primary"
              disabled={busy || chosen.length === 0}
              onClick={() => onConfirm(chosen)}
            >
              {confirmed
                ? "Confirm the changed classes"
                : "Confirm the line classes"}
            </button>
          )}
          {confirmed && !changed && (
            <button
              className="primary"
              disabled={busy || !view.scale.confirmed}
              onClick={onFind}
            >
              {busy ? "Finding members..." : "Find members in this view"}
            </button>
          )}
          {confirmed && !view.scale.confirmed && (
            <div className="hint">Confirm the scale first.</div>
          )}
        </>
      )}
    </div>
  );
};

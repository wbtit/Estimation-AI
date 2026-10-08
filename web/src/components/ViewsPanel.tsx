import React, { useState } from "react";
import { mmToFeetInches, realMm, boxWidth, boxHeight } from "../lib/geometry";
import type { SheetView } from "../lib/types";

export const ViewsPanel: React.FC<{
  views: SheetView[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  drawing: boolean;
  onDrawToggle: () => void;
  /** One click view of the whole sheet, offered only when the sheet has exactly one scale. */
  wholeSheet?: { available: boolean; scaleText: string | null };
  onWholeSheet?: () => void;
  onConfirmSuggestion: (id: string) => void;
  onSetScale: (id: string, text: string) => void;
  onClearScale: (id: string) => void;
  onDelete: (id: string) => void;
  extra?: (view: SheetView) => React.ReactNode;
}> = ({
  views,
  selectedId,
  onSelect,
  drawing,
  onDrawToggle,
  wholeSheet,
  onWholeSheet,
  onConfirmSuggestion,
  onSetScale,
  onClearScale,
  onDelete,
  extra,
}) => {
  const [typed, setTyped] = useState("");
  const selected = views.find((v) => v.id === selectedId) ?? null;

  return (
    <div className="panel">
      <h3>Views and scale</h3>
      <p className="hint">
        A view is a box on the sheet with its own scale. Members are measured
        only after the scale of their view is confirmed.
      </p>
      <button
        className={drawing ? "primary active" : "primary"}
        onClick={onDrawToggle}
      >
        {drawing
          ? "Drawing: drag a box on the sheet (Esc to cancel)"
          : "Draw a view (V)"}
      </button>
      {wholeSheet?.available ? (
        <button onClick={onWholeSheet}>
          Whole sheet (one scale found: {wholeSheet.scaleText})
        </button>
      ) : (
        <p className="hint">
          This sheet has no scale or several scales: draw a box for each plan
          area.
        </p>
      )}
      <ul className="view-list">
        {views.map((v) => (
          <li key={v.id}>
            <button
              className={
                v.id === selectedId ? "view-item selected" : "view-item"
              }
              onClick={() => onSelect(v.id === selectedId ? null : v.id)}
            >
              <span className={`dot ${v.scale.confirmed ? "green" : "red"}`} />{" "}
              {v.name ?? "view"}{" "}
              {v.scale.confirmed ? `1:${v.scale.ratio}` : "scale not confirmed"}
            </button>
          </li>
        ))}
        {views.length === 0 && (
          <li className="hint">No views on this sheet yet.</li>
        )}
      </ul>

      {selected && (
        <div className="view-detail">
          <h4>{selected.name ?? "View"}</h4>
          <div className="hint">
            {Math.round(boxWidth(selected.box))} x{" "}
            {Math.round(boxHeight(selected.box))} pt on the page
            {selected.scale.confirmed && selected.scale.ratio
              ? `; box width is ${mmToFeetInches(realMm(boxWidth(selected.box), selected.scale.ratio))} real`
              : ""}
          </div>
          {selected.scale.confirmed ? (
            <div>
              Scale <b>{selected.scale.text}</b> (ratio {selected.scale.ratio}),
              source{" "}
              <b>
                {selected.scale.source === "detected_text"
                  ? "detected text"
                  : "you confirmed"}
              </b>
              . <button onClick={() => onClearScale(selected.id)}>Clear</button>
            </div>
          ) : selected.suggestion ? (
            <div className="suggestion">
              Suggested from{" "}
              {selected.suggestion.where === "sheet"
                ? "the only scale found on this sheet"
                : `scale text ${selected.suggestion.where === "inside" ? "inside the box" : "near the box"}`}
              : <b>{selected.suggestion.raw}</b> (ratio{" "}
              {selected.suggestion.ratio})
              {selected.suggestion.ambiguous && (
                <div className="warn">
                  Another scale is just as close
                  {selected.suggestion.alternatives.length > 0
                    ? `: ${selected.suggestion.alternatives.map((a) => a.raw).join("; ")}`
                    : ""}
                  . Check it before confirming.
                </div>
              )}
              <div>
                <button
                  className="primary"
                  onClick={() => onConfirmSuggestion(selected.id)}
                >
                  Confirm this scale
                </button>
              </div>
            </div>
          ) : (
            <div className="warn">
              No scale text found in or near this box. Type the scale.
            </div>
          )}
          {!selected.scale.confirmed && (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) onSetScale(selected.id, typed.trim());
                setTyped("");
              }}
            >
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={'1/8" = 1\'-0"  or  1:96'}
                aria-label="type the scale"
              />
              <button type="submit">Set</button>
            </form>
          )}
          {extra?.(selected)}
          <div className="row">
            <button onClick={() => onDelete(selected.id)}>Delete view</button>
          </div>
        </div>
      )}
    </div>
  );
};

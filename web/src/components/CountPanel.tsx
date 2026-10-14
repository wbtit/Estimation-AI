import React, { useState } from "react";
import {
  confirmedBySize,
  countStateOf,
  kindOptions,
  pieceLists,
  sizeNote,
  type CountSettings,
  type TagScope,
  isUnlinkedSuggestion,
} from "../lib/count";
import type { LinesState } from "../lib/useCount";
import type { KindInfo, MemberView } from "../lib/types";

export interface MeasureCard {
  text: string | null;
  saved: { id: string; text: string } | null;
}

/** The "count" tab: tools, settings, this page's pieces (confirmed, suggested, rejected) and the measure card. */
export const CountPanel: React.FC<{
  members: MemberView[];
  kinds: KindInfo[];
  settings: CountSettings;
  tool: "count" | "measure" | null;
  kind: string;
  linesState: LinesState;
  selectedId: string | null;
  measure: MeasureCard;
  who: string;
  onMode: (on: boolean) => void;
  onRadius: (snap: number, label: number) => void;
  onScope: (scope: TagScope) => void;
  onTool: (t: "count" | "measure" | null) => void;
  onKind: (k: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelect: (id: string) => void;
  onDecide: (id: string, d: "accept" | "reject" | "reset") => void;
  onDelete: (id: string) => void;
  onPatch: (
    id: string,
    patch: { profile_text?: string; tag_text?: string },
  ) => void;
  onSaveMeasure: () => void;
  /** Phase 10: "x N typical" on a counted piece (n null removes it). */
  onTypical: (id: string, n: number | null, note: string) => void;
  onAttach: (memberId: string) => void;
}> = (p) => {
  const lists = pieceLists(p.members, p.settings.count_mode);
  const bySize = confirmedBySize(p.members);
  const [showRejected, setShowRejected] = useState(false);
  const selected = p.members.find((m) => m.id === p.selectedId) ?? null;
  const total = bySize.reduce((n, s) => n + s.pieces, 0);
  return (
    <div className="count-panel" data-testid="count-panel">
      <label className="count-mode">
        <input
          type="checkbox"
          checked={p.settings.count_mode}
          onChange={(e) => p.onMode(e.target.checked)}
        />{" "}
        <b>Count mode</b>: totals, tables and the Excel use{" "}
        <b>confirmed pieces only</b> (a click or an accepted suggestion).
      </label>
      <div className="row">
        <button
          className={p.tool === "count" ? "primary active" : ""}
          onClick={() => p.onTool(p.tool === "count" ? null : "count")}
          disabled={!p.who.trim()}
          data-testid="tool-count"
        >
          {p.tool === "count"
            ? "Counting: click the drawing (Esc)"
            : "Count (K)"}
        </button>
        <select
          value={p.kind}
          onChange={(e) => p.onKind(e.target.value)}
          aria-label="kind to count"
        >
          {kindOptions(p.kinds).map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.kind} ({k.prefix})
            </option>
          ))}
        </select>
        <button
          className={p.tool === "measure" ? "primary active" : ""}
          onClick={() => p.onTool(p.tool === "measure" ? null : "measure")}
          disabled={!p.who.trim()}
          data-testid="tool-measure"
        >
          {p.tool === "measure" ? "Measuring: two clicks (Esc)" : "Measure (M)"}
        </button>
        <button onClick={p.onUndo} disabled={!p.who.trim()}>
          Undo
        </button>
        <button onClick={p.onRedo} disabled={!p.who.trim()}>
          Redo
        </button>
      </div>
      <div className="row small">
        <label>
          snap radius{" "}
          <input
            type="number"
            min={1}
            max={200}
            value={p.settings.snap_radius_pt}
            onChange={(e) =>
              p.onRadius(
                Number(e.target.value) || 24,
                p.settings.label_radius_pt,
              )
            }
            aria-label="snap radius in points"
          />{" "}
          pt
        </label>
        <label>
          label radius{" "}
          <input
            type="number"
            min={1}
            max={500}
            value={p.settings.label_radius_pt}
            onChange={(e) =>
              p.onRadius(
                p.settings.snap_radius_pt,
                Number(e.target.value) || 80,
              )
            }
            aria-label="label radius in points"
          />{" "}
          pt
        </label>
        <label>
          tag numbers{" "}
          <select
            value={p.settings.tag_scope}
            onChange={(e) => p.onScope(e.target.value as TagScope)}
            aria-label="tag numbering"
          >
            <option value="job">run on across the job</option>
            <option value="sheet">restart on each sheet</option>
          </select>
        </label>
        <span className="hint" data-testid="lines-state">
          {p.linesState === "preparing"
            ? "extracting the page's lines..."
            : p.linesState === "ready"
              ? "lines ready: clicks snap"
              : p.linesState === "error"
                ? "lines not available: clicks are kept but not snapped"
                : "lines load when you start counting"}
        </span>
      </div>

      <h4>This page</h4>
      <p data-testid="count-summary">
        <b>{total}</b> confirmed · <b>{lists.suggested.length}</b> suggested
        (dashed, in no total) · {lists.rejected.length} rejected ·{" "}
        {lists.unlinked.length} labels with no line
        {p.tool === "count" && (
          <>
            {" "}
            · <small>Tab: next line under the pointer</small>
          </>
        )}
      </p>
      {bySize.length > 0 && (
        <ul className="by-size" data-testid="by-size">
          {bySize.map((s) => (
            <li key={s.size}>
              {s.size}: <b>{s.pieces}</b>
            </li>
          ))}
        </ul>
      )}

      {p.measure.text && (
        <div className="measure-card" data-testid="measure-card">
          <b>{p.measure.text}</b>{" "}
          <button onClick={p.onSaveMeasure}>Save measurement</button>
          {p.measure.saved && (
            <>
              {" "}
              <span className="hint">saved ({p.measure.saved.text})</span>{" "}
              <button
                onClick={() => selected && p.onAttach(selected.id)}
                disabled={!selected || selected.type === "column"}
                title={
                  selected
                    ? "the length of the selected piece becomes this measurement"
                    : "select a piece first"
                }
                data-testid="attach"
              >
                Attach to the selected piece
              </button>
            </>
          )}
        </div>
      )}

      <h4>Confirmed pieces ({lists.confirmed.length})</h4>
      <ul className="piece-list" data-testid="confirmed-list">
        {lists.confirmed.map((m) => {
          const note = sizeNote(m);
          return (
            <li
              key={m.id}
              className={m.id === p.selectedId ? "sel" : ""}
              onClick={() => p.onSelect(m.id)}
            >
              <input
                className="tag"
                defaultValue={m.tag.text}
                key={`tag-${m.id}-${m.tag.text}`}
                aria-label={`tag of ${m.tag.text}`}
                onBlur={(e) =>
                  e.target.value !== m.tag.text &&
                  p.onPatch(m.id, { tag_text: e.target.value })
                }
              />
              <span className="kind">{m.kind.name ?? "no kind"}</span>
              <input
                className={`size ${note.tone === "amber" ? "amber" : ""}`}
                defaultValue={m.profile_raw ?? ""}
                key={`size-${m.id}-${m.profile_raw ?? ""}`}
                placeholder="size"
                aria-label={`size of ${m.tag.text}`}
                onBlur={(e) =>
                  e.target.value !== (m.profile_raw ?? "") &&
                  p.onPatch(m.id, { profile_text: e.target.value })
                }
              />
              <span className="badge">
                {m.count?.source === "human_click" ? "click" : "accepted"}
              </span>
              {m.typical && (
                <span
                  className="badge amber"
                  data-testid="typical-badge"
                  title={m.typical.note}
                >
                  typical x{m.typical.n}
                </span>
              )}
              {m.length_ft_in && (
                <span className="length" title={m.length_source ?? ""}>
                  {m.length_ft_in}
                </span>
              )}
              <button
                onClick={() => p.onDelete(m.id)}
                title="soft delete (undo brings it back)"
              >
                delete
              </button>
              {note.text && (
                <div className={`note ${note.tone}`} data-testid="size-note">
                  {note.text}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {selected &&
        countStateOf(selected) === "confirmed" &&
        !selected.deleted && (
          <TypicalEditor
            key={`${selected.id}-${selected.typical?.n ?? 0}`}
            piece={selected}
            onSave={(n, note) => p.onTypical(selected.id, n, note)}
          />
        )}

      <h4>Suggested, not decided ({lists.suggested.length})</h4>
      <ul className="piece-list" data-testid="suggested-list">
        {lists.suggested.map((m) => (
          <li
            key={m.id}
            className={m.id === p.selectedId ? "sel" : ""}
            onClick={() => p.onSelect(m.id)}
          >
            <span className="tag">{m.tag.text || "?"}</span>
            <span className="kind">{m.kind.name ?? "no kind"}</span>
            <span className="size-text">{m.profile_raw ?? "no size"}</span>
            {isUnlinkedSuggestion(m) && (
              <span
                className="badge amber"
                data-testid="no-line-badge"
                title="A size label with no line near it: counting it adds a piece with no length until a line is given."
              >
                no line
              </span>
            )}
            <button
              onClick={() => p.onDecide(m.id, "accept")}
              data-testid="accept"
            >
              Accept
            </button>
            <button
              onClick={() => p.onDecide(m.id, "reject")}
              data-testid="reject"
            >
              Reject
            </button>
          </li>
        ))}
      </ul>

      <h4>
        <button className="link" onClick={() => setShowRejected((v) => !v)}>
          Rejected ({lists.rejected.length}) {showRejected ? "▾" : "▸"}
        </button>
      </h4>
      {showRejected && (
        <ul className="piece-list" data-testid="rejected-list">
          {lists.rejected.map((m) => (
            <li key={m.id}>
              <span className="tag">{m.tag.text || "?"}</span>
              <span className="size-text">{m.profile_raw ?? "no size"}</span>
              <span className="badge">{countStateOf(m)}</span>
              <button onClick={() => p.onDecide(m.id, "reset")}>Restore</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** "x N typical" on the selected counted piece: N of 2 or more and a note (where N comes from). */
const TypicalEditor: React.FC<{
  piece: MemberView;
  onSave: (n: number | null, note: string) => void;
}> = ({ piece, onSave }) => {
  const [n, setN] = useState(String(piece.typical?.n ?? ""));
  const [note, setNote] = useState(piece.typical?.note ?? "");
  const value = Number(n);
  const ok = Number.isInteger(value) && value >= 2 && note.trim() !== "";
  return (
    <div className="typical-editor" data-testid="typical-editor">
      <b>{piece.tag.text || "selected piece"}</b>: typical x{" "}
      <input
        type="number"
        min={2}
        step={1}
        value={n}
        onChange={(e) => setN(e.target.value)}
        aria-label="typical multiplier"
      />{" "}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="note: where the N comes from (required)"
        aria-label="typical note"
      />{" "}
      <button
        disabled={!ok}
        onClick={() => onSave(value, note.trim())}
        data-testid="typical-save"
      >
        Save
      </button>
      {piece.typical && (
        <button onClick={() => onSave(null, "")} data-testid="typical-remove">
          Remove
        </button>
      )}
      <div className="hint">
        The piece then counts N in every total, table and export (amber).
      </div>
    </div>
  );
};

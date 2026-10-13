import React from "react";
import { SYMBOL_HEX } from "../lib/status";
import {
  applyFilters,
  isFiltering,
  listedApart,
  NO_FILTERS,
  type Filters,
} from "../lib/symbols";
import type { KindInfo, MemberView, SymbolColor } from "../lib/types";

export function memberTitle(m: MemberView): string {
  return `${m.tag.text ? `${m.tag.text} ` : ""}${m.profile_raw ?? "(no profile)"}`;
}

const COLOURS: SymbolColor[] = ["green", "amber", "red", "grey", "unlinked"];

/** Members of the open page: counts by colour, filters, the list, and the pieces listed apart. */
export const MembersPanel: React.FC<{
  members: MemberView[];
  kinds: KindInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  addingColumn: boolean;
  onAddColumn: () => void;
  filters: Filters;
  onFilters: (f: Filters) => void;
  lastRunStart: string | null;
  /** The explanation panel (with actions) of the selected piece. */
  detail?: (m: MemberView) => React.ReactNode;
}> = ({
  members,
  kinds,
  selectedId,
  onSelect,
  addingColumn,
  onAddColumn,
  filters,
  onFilters,
  lastRunStart,
  detail,
}) => {
  const visible = members
    .filter((m) => !m.deleted && !m.not_member)
    .map((m, i) => ({ m, i }))
    .sort(
      (a, b) =>
        (a.m.shared_line?.group ?? "").localeCompare(
          b.m.shared_line?.group ?? "",
        ) ||
        Number(b.m.shared_line?.best) - Number(a.m.shared_line?.best) ||
        a.i - b.i,
    )
    .map((x) => x.m);
  const counts: Record<SymbolColor, number> = {
    green: 0,
    amber: 0,
    red: 0,
    grey: 0,
    unlinked: 0,
  };
  for (const m of visible)
    if (!m.merged_into && m.counting === "counted") counts[m.symbol_color] += 1;
  const apart = listedApart(visible);
  const passed = applyFilters(visible, filters, lastRunStart);
  const linked = passed.filter(
    (m) => m.status.color !== "unlinked" && m.counting === "counted",
  );
  const unlinked = passed.filter((m) => m.status.color === "unlinked");
  const selected = visible.find((m) => m.id === selectedId) ?? null;
  const toggleColour = (c: SymbolColor) => {
    const next = new Set(filters.colours);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    onFilters({ ...filters, colours: next });
  };
  return (
    <div className="panel">
      <h3>Pieces on this page</h3>
      <div className="counts" data-testid="colour-counts">
        {COLOURS.map((c) => (
          <button
            key={c}
            className={filters.colours.has(c) ? "chip on" : "chip"}
            onClick={() => toggleColour(c)}
            aria-pressed={filters.colours.has(c)}
            title={`show only ${c}`}
          >
            <span className="dot" style={{ background: SYMBOL_HEX[c] }} />{" "}
            {counts[c]}{" "}
            {c === "grey" ? "no kind" : c === "unlinked" ? "unlinked" : ""}
          </button>
        ))}
      </div>
      <div className="row filters">
        <select
          value={filters.kind}
          onChange={(e) => onFilters({ ...filters, kind: e.target.value })}
          aria-label="filter by kind"
        >
          <option value="">all kinds</option>
          <option value="(none)">no kind</option>
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.kind}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={filters.onlyUnreviewed}
            onChange={(e) =>
              onFilters({ ...filters, onlyUnreviewed: e.target.checked })
            }
          />{" "}
          only unreviewed
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.onlyChanged}
            disabled={lastRunStart === null}
            onChange={(e) =>
              onFilters({ ...filters, onlyChanged: e.target.checked })
            }
          />{" "}
          only changed since the last run
        </label>
        {isFiltering(filters) && (
          <button onClick={() => onFilters(NO_FILTERS)}>clear filters</button>
        )}
      </div>
      <div className="hint" data-testid="stage-note">
        Lengths are added in Stage 2. Colour here means how sure the system is
        about size, line and kind.
      </div>
      <button
        className={addingColumn ? "primary active" : "primary"}
        onClick={onAddColumn}
      >
        {addingColumn
          ? "Click the column on the plan (Esc to cancel)"
          : "Add a column (C)"}
      </button>
      <ul className="member-list">
        {linked.map((m) => (
          <li key={m.id}>
            <button
              className={
                m.id === selectedId ? "member-item selected" : "member-item"
              }
              onClick={() => onSelect(m.id)}
            >
              <span
                className="dot"
                style={{ background: SYMBOL_HEX[m.symbol_color] }}
              />{" "}
              <b>{memberTitle(m)}</b> <small>{m.kind.name ?? "no kind"}</small>
              {m.human === "confirmed" || m.human === "edited" ? " ✓" : ""}
              {m.merged_into && " (merged)"}
              {m.existing && " (existing, not counted)"}
              {m.shared_line && !m.shared_line.resolved && (
                <span
                  className="shared-tag"
                  title="shares its line with other members"
                >
                  {" "}
                  ⇄{m.shared_line.size}
                  {m.shared_line.duplicate_of ? " possible duplicate" : ""}
                </span>
              )}
            </button>
          </li>
        ))}
        {linked.length === 0 && (
          <li className="hint">
            {isFiltering(filters)
              ? "No pieces match the filters."
              : "No pieces yet. The pipeline marks them after the upload; if the page is not in the takeoff, include it first."}
          </li>
        )}
      </ul>
      {unlinked.length > 0 && (
        <div className="unlinked-list">
          <h4>Unlinked labels ({unlinked.length})</h4>
          <p className="hint">
            No line was found near these labels (small red squares on the page).
            They are not pieces and are in no total. Select one and click a line
            (L).
          </p>
          <ul className="member-list">
            {unlinked.map((m) => (
              <li key={m.id}>
                <button
                  className={
                    m.id === selectedId ? "member-item selected" : "member-item"
                  }
                  onClick={() => onSelect(m.id)}
                >
                  <span
                    className="dot"
                    style={{ background: SYMBOL_HEX.unlinked }}
                  />{" "}
                  <b>{memberTitle(m)}</b>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {apart.notCounted.length > 0 && (
        <div className="apart" data-testid="not-counted">
          <h4>Not counted ({apart.notCounted.length})</h4>
          <p className="hint">
            Kinds outside the takeoff (joist, wall, other trades): listed, with
            no count symbol.
          </p>
          <ul className="member-list">
            {apart.notCounted.map((m) => (
              <li key={m.id}>
                <button
                  className={
                    m.id === selectedId ? "member-item selected" : "member-item"
                  }
                  onClick={() => onSelect(m.id)}
                >
                  <b>{m.profile_raw ?? m.mark ?? "label"}</b>{" "}
                  <small>{m.kind.name}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {apart.misc.length > 0 && (
        <div className="apart" data-testid="misc-reserved">
          <h4>Misc steel, reserved ({apart.misc.length})</h4>
          <p className="hint">Not computed in this version.</p>
          <ul className="member-list">
            {apart.misc.map((m) => (
              <li key={m.id}>
                <button
                  className={
                    m.id === selectedId ? "member-item selected" : "member-item"
                  }
                  onClick={() => onSelect(m.id)}
                >
                  <b>{m.profile_raw ?? m.mark ?? "label"}</b>{" "}
                  <small>{m.kind.name}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {selected && detail?.(selected)}
    </div>
  );
};

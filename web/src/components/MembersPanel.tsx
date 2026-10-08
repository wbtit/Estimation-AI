import React from "react";
import { COLOUR_HEX } from "../lib/status";
import type { MemberView } from "../lib/types";

export function memberTitle(m: MemberView): string {
  return `${m.mark ? `${m.mark} ` : ""}${m.profile_raw ?? "(no profile)"}`;
}

export const MembersPanel: React.FC<{
  members: MemberView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  addingColumn: boolean;
  onAddColumn: () => void;
  extra?: (m: MemberView) => React.ReactNode;
}> = ({ members, selectedId, onSelect, addingColumn, onAddColumn, extra }) => {
  const visible = members
    .filter((m) => !m.deleted)
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
  const counts = { green: 0, amber: 0, red: 0 };
  for (const m of visible) if (!m.merged_into) counts[m.status.color] += 1;
  const selected = visible.find((m) => m.id === selectedId) ?? null;
  return (
    <div className="panel">
      <h3>Members on this sheet</h3>
      <div className="counts">
        <span className="dot green" /> {counts.green}{" "}
        <span className="dot amber" /> {counts.amber}{" "}
        <span className="dot red" /> {counts.red}
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
        {visible.map((m) => (
          <li key={m.id}>
            <button
              className={
                m.id === selectedId ? "member-item selected" : "member-item"
              }
              onClick={() => onSelect(m.id)}
            >
              <span
                className="dot"
                style={{ background: COLOUR_HEX[m.status.color] }}
              />{" "}
              <b>{memberTitle(m)}</b> {m.length_ft_in ?? "no length"}
              {m.status.confirmed && " ✓"}
              {m.merged_into && " (merged)"}
              {m.shared_line && !m.shared_line.resolved && (
                <span
                  className="shared-tag"
                  title="shares its line with other members"
                >
                  {" "}
                  ⇄{m.shared_line.size}
                  {m.shared_line.best ? "" : " possible duplicate"}
                </span>
              )}
            </button>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="hint">
            No members yet. Confirm a view scale and find members.
          </li>
        )}
      </ul>
      {selected && (
        <div className="member-detail">
          <h4>{memberTitle(selected)}</h4>
          <div>
            <span
              className="dot"
              style={{ background: COLOUR_HEX[selected.status.color] }}
            />{" "}
            <b>{selected.status.color}</b>
            {selected.status.confirmed ? " (confirmed by a person)" : ""}
            {selected.status.reasons.length > 0 && (
              <div className="warn">{selected.status.reasons.join("; ")}</div>
            )}
          </div>
          {extra?.(selected)}
          <table className="kv">
            <tbody>
              <tr>
                <td>profile</td>
                <td>{selected.profile ?? "not parsed"}</td>
              </tr>
              <tr>
                <td>mark</td>
                <td>
                  {selected.mark ?? "-"}{" "}
                  {selected.mark_ref.status
                    ? `(${selected.mark_ref.status})`
                    : ""}
                </td>
              </tr>
              <tr>
                <td>type</td>
                <td>{selected.type}</td>
              </tr>
              <tr>
                <td>level</td>
                <td>{selected.level ?? "-"}</td>
              </tr>
              <tr>
                <td>length</td>
                <td>
                  {selected.length_ft_in ?? "-"}{" "}
                  {selected.length_mm !== null
                    ? `(${Math.round(selected.length_mm)} mm)`
                    : ""}
                </td>
              </tr>
              <tr>
                <td>link</td>
                <td>
                  {selected.link.source}, rule confidence{" "}
                  {selected.link.confidence ?? "-"}
                </td>
              </tr>
            </tbody>
          </table>
          {selected.link.candidates.length > 0 && (
            <div>
              <b>Candidate lines</b>
              <ol className="cands">
                {selected.link.candidates.map((c) => (
                  <li
                    key={c.rank}
                    className={
                      c.rank === selected.link.chosen_rank ? "chosen" : ""
                    }
                  >
                    #{c.rank} score {c.score.toFixed(1)}, {c.dist.toFixed(1)} pt
                    away, {c.rel_angle.toFixed(0)} deg off the text, length{" "}
                    {c.length_mm === null ? "-" : Math.round(c.length_mm)} mm
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { COLOUR_HEX } from "../lib/status";
import type { TakeoffData, TakeoffRow, TakeoffTotals } from "../lib/types";

const totalsLine = (t: TakeoffTotals) =>
  `${t.pieces} pieces, ${t.total_length_ft_in} (${Math.round(t.total_length_mm)} mm)${
    t.unmeasured ? `, ${t.unmeasured} without length` : ""
  }`;

/** The takeoff table of the whole project. Click a row to jump to its first member on the sheet. */
export const TakeoffPanel: React.FC<{
  projectId: string;
  /** Changes whenever members change, so the table reloads. */
  version: unknown;
  onJump: (row: TakeoffRow) => void;
  onError: (err: unknown) => void;
}> = ({ projectId, version, onJump, onError }) => {
  const [data, setData] = useState<TakeoffData | null>(null);
  useEffect(() => {
    api<TakeoffData>(`/api/projects/${projectId}/takeoff`)
      .then(setData)
      .catch(onError);
  }, [projectId, version, onError]);

  if (!data) return <p className="hint">Loading...</p>;
  const included = data.rows.filter((r) => !r.excluded);
  const excluded = data.rows.filter((r) => r.kind === "red");
  const duplicates = data.rows.filter((r) => r.kind === "duplicate");
  const rowView = (r: TakeoffRow) => (
    <tr
      key={r.key}
      className={r.excluded ? "excluded" : ""}
      onClick={() => onJump(r)}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onJump(r)}
      title={r.reasons.join("; ")}
    >
      <td>{r.mark ?? ""}</td>
      <td>{r.profile_raw ?? ""}</td>
      <td>{r.profile ?? "?"}</td>
      <td className="num">{r.quantity}</td>
      <td className="num">
        {r.total_length_ft_in ?? "-"}
        {r.total_length_mm !== null && (
          <small> ({Math.round(r.total_length_mm)} mm)</small>
        )}
      </td>
      <td>{r.level ?? ""}</td>
      <td>{r.sheets.join(", ")}</td>
      <td>
        <span className="dot" style={{ background: COLOUR_HEX[r.color] }} />
        {r.confirmed && " ✓"}
      </td>
    </tr>
  );
  return (
    <div className="panel takeoff">
      <h3>Takeoff</h3>
      {data.unlinked_labels.count > 0 && (
        <p className="warn">
          {data.unlinked_labels.count} unlinked labels on reviewed sheets (pages{" "}
          {data.unlinked_labels.by_sheet
            .map((s) => `${s.page_number ?? "?"}: ${s.count}`)
            .join(", ")}
          ). They are not members and are in no total.
        </p>
      )}
      <div className="row">
        <a href={`/api/projects/${projectId}/takeoff.xlsx`} download>
          Download Excel
        </a>
      </div>
      <table className="takeoff-table">
        <thead>
          <tr>
            <th>mark</th>
            <th>as read</th>
            <th>profile</th>
            <th>qty</th>
            <th>length</th>
            <th>level</th>
            <th>sheet</th>
            <th>color</th>
          </tr>
        </thead>
        <tbody>
          {included.map(rowView)}
          {included.length === 0 && (
            <tr>
              <td colSpan={8} className="hint">
                No members in the totals yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <h4>Totals</h4>
      <ul className="totals">
        {data.by_level.map((l) => (
          <li key={l.level ?? "none"}>
            <b>{l.level ?? "(no level)"}</b>: {totalsLine(l.totals)}
          </li>
        ))}
        <li>
          <b>All levels</b>: {totalsLine(data.totals)}
        </li>
      </ul>
      <h4>Excluded (red), not in the totals</h4>
      <p>{totalsLine(data.excluded_red)}</p>
      {excluded.length > 0 && (
        <table className="takeoff-table">
          <tbody>{excluded.map(rowView)}</tbody>
        </table>
      )}
      <h4>Possible duplicates (shared line), not in the totals</h4>
      <p>{totalsLine(data.possible_duplicates)}</p>
      {duplicates.length > 0 && (
        <table className="takeoff-table">
          <tbody>{duplicates.map(rowView)}</tbody>
        </table>
      )}
    </div>
  );
};

import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

export interface PilotReportRow {
  sheet_id: string | null;
  page_number: number | null;
  sheet_number: string | null;
  who: string;
  first: string;
  last: string;
  actions: number;
  active_seconds: number;
  idle_gaps: number;
  idle_seconds: number;
  created: number;
  accepted: number;
  rejected: number;
  edited: number;
  deleted: number;
  undo: number;
  redo: number;
  measured: number;
  typical_changes: number;
  pieces: number;
  typical_pieces: number;
  pieces_without_length: number;
}

const minutes = (s: number) => (Math.round((s / 60) * 10) / 10).toFixed(1);

/**
 * The pilot timing report (read-only), from the action log: per sheet and person, active time
 * (gaps over 5 minutes are not counted and are shown apart), what was done, and the pieces as they
 * are now (typical, without length). The CSV has the same lines.
 */
export const PilotReport: React.FC<{
  projectId: string;
  version: unknown;
  onError: (err: unknown) => void;
}> = ({ projectId, version, onError }) => {
  const [data, setData] = useState<{
    idle_seconds: number;
    rows: PilotReportRow[];
  } | null>(null);
  useEffect(() => {
    api<{ idle_seconds: number; rows: PilotReportRow[] }>(
      `/api/projects/${projectId}/pilot-report`,
    )
      .then(setData)
      .catch(onError);
  }, [projectId, version, onError]);
  if (!data) return <p className="hint">Loading the report...</p>;
  const rows = data.rows.filter((r) => r.sheet_id !== null);
  const sum = (k: keyof PilotReportRow) =>
    rows.reduce((n, r) => n + (r[k] as number), 0);
  return (
    <div className="pilot-report" data-testid="pilot-report">
      <p className="hint">
        Read-only, from the action log. Active time leaves out gaps over{" "}
        {data.idle_seconds / 60} minutes (shown apart). Pieces are the counted
        pieces as they are now.{" "}
        <a
          href={`/api/projects/${projectId}/pilot-report.csv`}
          download
          data-testid="pilot-report-csv"
        >
          Download CSV
        </a>
      </p>
      {rows.length === 0 ? (
        <p className="hint" data-testid="pilot-report-empty">
          No counting actions yet.
        </p>
      ) : (
        <table className="grid-table" aria-label="pilot report">
          <thead>
            <tr>
              {[
                "Page",
                "Who",
                "Active min",
                "Gaps > 5 min",
                "Created",
                "Accepted",
                "Rejected",
                "Edited",
                "Deleted",
                "Undo",
                "Pieces",
                "Typical",
                "No length",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.sheet_id}|${r.who}`}>
                <td>
                  {r.page_number ?? "?"} {r.sheet_number ?? ""}
                </td>
                <td>{r.who}</td>
                <td className="num">{minutes(r.active_seconds)}</td>
                <td
                  className="num"
                  title={`${minutes(r.idle_seconds)} min left out`}
                >
                  {r.idle_gaps}
                </td>
                <td className="num">{r.created}</td>
                <td className="num">{r.accepted}</td>
                <td className="num">{r.rejected}</td>
                <td className="num">{r.edited}</td>
                <td className="num">{r.deleted}</td>
                <td className="num">{r.undo}</td>
                <td className="num">{r.pieces}</td>
                <td className="num">{r.typical_pieces}</td>
                <td className="num">{r.pieces_without_length}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total" data-testid="pilot-report-total">
              <td colSpan={2}>All sheets</td>
              <td className="num">{minutes(sum("active_seconds"))}</td>
              <td className="num">{sum("idle_gaps")}</td>
              <td className="num">{sum("created")}</td>
              <td className="num">{sum("accepted")}</td>
              <td className="num">{sum("rejected")}</td>
              <td className="num">{sum("edited")}</td>
              <td className="num">{sum("deleted")}</td>
              <td className="num">{sum("undo")}</td>
              <td className="num">{sum("pieces")}</td>
              <td className="num">{sum("typical_pieces")}</td>
              <td className="num">{sum("pieces_without_length")}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
};

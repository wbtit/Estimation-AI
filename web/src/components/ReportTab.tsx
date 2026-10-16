import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatFtIn } from "../lib/ftin";

interface PageReport {
  sheet_id: string;
  page_index: number;
  sheet_number: string | null;
  reviewed_by: string | null;
  system_pieces: number;
  final_pieces: number;
  kept_unchanged: number;
  size_changed: number;
  length_changed: number;
  deleted_by_person: number;
  ignored: number;
  removed_by_rebuild: number;
  added_by_person: number;
  added_by_rebuild: number;
  setup_changed: string[];
  minutes: number;
}

export interface Report {
  pages: PageReport[];
  total: Omit<
    PageReport,
    "sheet_id" | "page_index" | "sheet_number" | "reviewed_by" | "setup_changed"
  > & {
    pages_with_setup_changes: number;
    pages_reviewed: number;
  };
  sizes: {
    size: string;
    system_count: number;
    system_length_mm: number;
    final_count: number;
    final_length_mm: number;
  }[];
}

const COLS: [keyof PageReport, string][] = [
  ["system_pieces", "System"],
  ["final_pieces", "Final"],
  ["kept_unchanged", "Kept"],
  ["size_changed", "Size changed"],
  ["length_changed", "Length changed"],
  ["deleted_by_person", "Deleted"],
  ["ignored", "Ignored"],
  ["removed_by_rebuild", "Removed by rebuild"],
  ["added_by_person", "Added by person"],
  ["added_by_rebuild", "Added by rebuild"],
];

/** Report: SYSTEM VERSION vs SAVED FINAL, per page and in total, and per size. */
export const ReportTab: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Report>(`/api/projects/${projectId}/report`).then(setR, (e: unknown) =>
      setError(e instanceof Error ? e.message : "could not load"),
    );
  }, [projectId]);
  if (error) return <div className="empty">{error}</div>;
  if (!r) return <div className="empty">Loading…</div>;
  return (
    <div className="table-wrap">
      <div className="row" style={{ marginBottom: 10 }}>
        <h3>System vs final</h3>
        <span className="grow" />
        <a href={`/api/projects/${projectId}/answer-key.json`}>
          <button>Answer key</button>
        </a>
        <a href={`/api/projects/${projectId}/report.xlsx`}>
          <button className="primary">Export to Excel</button>
        </a>
      </div>
      <table className="grid" data-testid="report-pages">
        <thead>
          <tr>
            <th>Page</th>
            <th>Sheet</th>
            {COLS.map(([, h]) => (
              <th key={h} className="num">
                {h}
              </th>
            ))}
            <th>Setup changed</th>
            <th className="num">Minutes</th>
            <th>Saved by</th>
          </tr>
        </thead>
        <tbody>
          {r.pages.map((p) => (
            <tr key={p.sheet_id}>
              <td>{p.page_index + 1}</td>
              <td>{p.sheet_number ?? "—"}</td>
              {COLS.map(([k]) => (
                <td key={k} className="num">
                  {p[k] as number}
                </td>
              ))}
              <td>{p.setup_changed.join(", ") || "—"}</td>
              <td className="num">{p.minutes}</td>
              <td>{p.reviewed_by ?? "—"}</td>
            </tr>
          ))}
          <tr className="total">
            <td colSpan={2}>Total</td>
            {COLS.map(([k]) => (
              <td key={k} className="num">
                {(r.total as unknown as Record<string, number>)[k]}
              </td>
            ))}
            <td>{r.total.pages_with_setup_changes} pages</td>
            <td className="num">{r.total.minutes}</td>
            <td>{r.total.pages_reviewed} saved</td>
          </tr>
        </tbody>
      </table>
      <h3 style={{ margin: "18px 0 8px" }}>Per size</h3>
      <table className="grid" data-testid="report-sizes">
        <thead>
          <tr>
            <th>Size</th>
            <th className="num">System count</th>
            <th className="num">Final count</th>
            <th className="num">System length</th>
            <th className="num">Final length</th>
          </tr>
        </thead>
        <tbody>
          {r.sizes.map((s) => (
            <tr key={s.size}>
              <td>{s.size}</td>
              <td className="num">{s.system_count}</td>
              <td className="num">{s.final_count}</td>
              <td className="num">{formatFtIn(s.system_length_mm)}</td>
              <td className="num">{formatFtIn(s.final_length_mm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

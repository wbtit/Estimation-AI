import React, { useMemo, useState } from "react";
import { Download, Filter, PanelRight } from "lucide-react";
import { formatFtIn } from "../lib/ftin";
import { bomOrder, type Bom } from "../lib/lf";
import { SummaryList } from "./PropertiesPanel";

const lb = (v: number | null) =>
  v === null ? "—" : `${Math.round(v).toLocaleString()} lbs`;

const STATUS_TEXT: Record<string, string> = {
  found: "Found",
  needs_review: "Needs review",
  attention: "Attention: not in the total (no size or no support)",
};

const STATUS_NAME: Record<string, string> = {
  found: "Found",
  needs_review: "Needs review",
  attention: "Attention",
};

/** BOM: a Filters panel (category, section, status), the table (Status, Main, Category, Piecemark,
 * Qty, Section Type, Section, Length, Grade, Weight) sorted by Category, then Section, then
 * Piecemark, and the project summary. */
export const BomTab: React.FC<{
  bom: Bom | null;
  projectId: string;
  who?: string;
}> = ({ bom, projectId, who = "" }) => {
  const [category, setCategory] = useState("");
  const [section, setSection] = useState("");
  const [status, setStatus] = useState("");
  const all = useMemo(() => bom?.rows ?? [], [bom]);
  const rows = useMemo(
    () =>
      all
        .filter(
          (r) =>
            (category === "" || r.category === category) &&
            (section === "" || r.section === section) &&
            (status === "" || r.build_state === status),
        )
        .sort(bomOrder),
    [all, category, section, status],
  );
  const cats = [...new Set(all.map((r) => r.category ?? ""))].sort();
  const secs = [
    ...new Set(
      all
        .filter((r) => category === "" || r.category === category)
        .map((r) => r.section ?? ""),
    ),
  ].sort();
  const main = rows.filter((r) => r.in_main_total);
  const total = {
    qty: main.reduce((a, r) => a + r.qty, 0),
    lb: main.reduce((a, r) => a + (r.weight_lb ?? 0), 0),
  };
  if (!bom) return <div className="empty">Loading…</div>;
  return (
    <div className="ws-body">
      <div className="left dark">
        <div className="panel-head">
          <Filter size={16} /> Filters
        </div>
        <div className="filters">
          <label>
            Category
            <select
              aria-label="category filter"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Select category</option>
              {cats.map((c) => (
                <option key={c} value={c}>
                  {c || "—"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Section
            <select
              aria-label="section filter"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              <option value="">Select section</option>
              {secs.map((s) => (
                <option key={s} value={s}>
                  {s || "—"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              aria-label="status filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Select status</option>
              {Object.entries(STATUS_NAME).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="table-wrap">
        <div className="table-card">
          <div className="table-head">
            <h3>Bill of Materials</h3>
            <span className="count-pill">{rows.length}</span>
            <span className="grow" />
            <a
              href={`/api/projects/${projectId}/line-first/bom.xlsx?who=${encodeURIComponent(who)}`}
            >
              <button className="row" style={{ gap: 6 }}>
                <Download size={15} /> Export to Excel
              </button>
            </a>
          </div>
          <div className="table-scroll">
            <table className="grid bom" data-testid="bom">
              <thead>
                <tr>
                  <th title="Found / needs review / attention">Status</th>
                  <th>Main</th>
                  <th>Category</th>
                  <th>Piecemark</th>
                  <th>Qty</th>
                  <th>Section Type</th>
                  <th>Section</th>
                  <th>Length</th>
                  <th>Grade</th>
                  <th>Weight</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.member}>
                    <td title={STATUS_TEXT[r.build_state ?? ""] ?? "—"}>
                      <span
                        className={`dot ${r.build_state ?? "none"}`}
                        data-testid="status-dot"
                      />
                    </td>
                    <td>{r.main}</td>
                    <td>{r.category ?? "—"}</td>
                    <td>{r.piecemark ?? "—"}</td>
                    <td>{r.qty}</td>
                    <td>{r.section_type ?? "—"}</td>
                    <td>{r.section ?? "—"}</td>
                    <td>{formatFtIn(r.length_mm)}</td>
                    <td>{r.grade ?? "—"}</td>
                    <td>{lb(r.weight_lb)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={4}>Total (found and needs review)</td>
                  <td>{total.qty}</td>
                  <td colSpan={4} />
                  <td>{lb(total.lb)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="props dark">
        <div className="panel-head">
          <PanelRight size={16} /> Properties
        </div>
        <div className="section">
          <div className="sec-bar">
            <span className="sec-title">Project Summary</span>
          </div>
          <div className="sec-body">
            <SummaryList rows={all} />
          </div>
        </div>
      </div>
    </div>
  );
};

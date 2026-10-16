import React, { useMemo, useState } from "react";
import { formatFtIn } from "../lib/ftin";
import type { Bom } from "../lib/lf";

const lb = (v: number | null) =>
  v === null ? "—" : Math.round(v).toLocaleString();

/** BOM: Main, Category, Piecemark, Qty, Section Type, Section, Length, Grade, Weight (lb). */
export const BomTab: React.FC<{ bom: Bom | null; projectId: string }> = ({
  bom,
  projectId,
}) => {
  const [category, setCategory] = useState("");
  const [section, setSection] = useState("");
  const rows = useMemo(
    () =>
      (bom?.rows ?? []).filter(
        (r) =>
          (category === "" || r.category === category) &&
          (section === "" || r.section === section),
      ),
    [bom, category, section],
  );
  const cats = [
    ...new Set((bom?.rows ?? []).map((r) => r.category ?? "")),
  ].sort();
  const secs = [
    ...new Set(
      (bom?.rows ?? [])
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
    <div className="table-wrap">
      <div className="row" style={{ marginBottom: 10 }}>
        <select
          aria-label="category filter"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c || "—"}
            </option>
          ))}
        </select>
        <select
          aria-label="section filter"
          value={section}
          onChange={(e) => setSection(e.target.value)}
        >
          <option value="">All sections</option>
          {secs.map((s) => (
            <option key={s} value={s}>
              {s || "—"}
            </option>
          ))}
        </select>
        <span className="grow" />
        <a href={`/api/projects/${projectId}/line-first/bom.xlsx`}>
          <button className="primary">Export to Excel</button>
        </a>
      </div>
      <table className="grid" data-testid="bom">
        <thead>
          <tr>
            <th>Main</th>
            <th>Category</th>
            <th>Piecemark</th>
            <th className="num">Qty</th>
            <th>Section Type</th>
            <th>Section</th>
            <th className="num">Length</th>
            <th>Grade</th>
            <th className="num">Weight (lb)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.member}
              className={r.in_main_total ? "" : "att"}
              title={
                r.in_main_total ? "" : "Not in the total: no size or no support"
              }
            >
              <td>{r.main}</td>
              <td>{r.category ?? "—"}</td>
              <td>{r.piecemark ?? "—"}</td>
              <td className="num">{r.qty}</td>
              <td>{r.section_type ?? "—"}</td>
              <td>{r.section ?? "—"}</td>
              <td className="num">{formatFtIn(r.length_mm)}</td>
              <td>{r.grade ?? "—"}</td>
              <td className="num">{lb(r.weight_lb)}</td>
            </tr>
          ))}
          <tr className="total">
            <td colSpan={3}>Total</td>
            <td className="num">{total.qty}</td>
            <td colSpan={4} />
            <td className="num">{lb(total.lb)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

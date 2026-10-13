import React, { useCallback, useEffect, useState } from "react";
import { api, send } from "../lib/api";
import { SYMBOL_HEX } from "../lib/status";
import type { Apart, KindInfo, TableRowS1, TablesResponse } from "../lib/types";

const COLOUR: Record<TableRowS1["colour"], string> = {
  green: SYMBOL_HEX.green,
  amber: SYMBOL_HEX.amber,
  grey: SYMBOL_HEX.grey,
};

const ApartLine: React.FC<{ label: string; a: Apart; red?: boolean }> = ({
  label,
  a,
  red,
}) =>
  a.pieces === 0 ? null : (
    <tr className={red ? "apart-row red" : "apart-row"}>
      <td colSpan={2}>{label}</td>
      <td className="num">{a.pieces}</td>
      <td colSpan={9}>
        {a.by_kind.map((k) => `${k.kind ?? "no kind"}: ${k.pieces}`).join(", ")}
      </td>
    </tr>
  );

/** One table (page or job): the estimator's columns with Kind first; a row click selects its symbols. */
const Table: React.FC<{
  rows: TableRowS1[];
  quantity: number;
  kinds: KindInfo[];
  selectedKeys: ReadonlySet<string>;
  onRow: (row: TableRowS1) => void;
  onKind: (row: TableRowS1, kind: string | null) => void;
  onName: (row: TableRowS1, name: string) => void;
  footer: React.ReactNode;
  label: string;
}> = ({
  rows,
  quantity,
  kinds,
  selectedKeys,
  onRow,
  onKind,
  onName,
  footer,
  label,
}) => (
  <table className="grid-table" aria-label={label}>
    <thead>
      <tr>
        {[
          "Kind",
          "Reference Dwg No.",
          "Quantity",
          "SHAPE",
          "Size",
          "Name",
          "Length ft",
          "Length In",
          "Unit W",
          "Total W",
          "Grade",
        ].map((h) => (
          <th key={h}>{h}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((r) => (
        <tr
          key={r.key}
          className={selectedKeys.has(r.key) ? "sel" : ""}
          onClick={() => onRow(r)}
          data-testid="table-row"
        >
          <td>
            <span className="dot" style={{ background: COLOUR[r.colour] }} />{" "}
            <select
              value={r.kind ?? ""}
              aria-label={`kind of ${r.size ?? "row"}`}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onKind(r, e.target.value || null)}
            >
              <option value="">(no kind)</option>
              {kinds.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.kind}
                </option>
              ))}
            </select>
          </td>
          <td>{r.reference}</td>
          <td className="num">{r.quantity}</td>
          <td>{r.shape ?? ""}</td>
          <td>{r.size ?? ""}</td>
          <td>
            <input
              defaultValue={r.name}
              aria-label={`name of ${r.size ?? "row"}`}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) =>
                e.target.value.trim() !== r.name && onName(r, e.target.value)
              }
              onKeyDown={(e) =>
                e.key === "Enter" && (e.target as HTMLInputElement).blur()
              }
              className={r.name_is_system ? "system-wording" : ""}
              title={
                r.name_is_system
                  ? "system wording: edit to use your own"
                  : "your wording"
              }
            />
          </td>
          <td />
          <td />
          <td className="num">{r.unit_w ?? ""}</td>
          <td />
          <td
            title={
              r.grade_suggestion
                ? `suggested ${r.grade_suggestion}, not applied`
                : ""
            }
          >
            {r.grade ?? (r.grade_suggestion ? `(${r.grade_suggestion}?)` : "")}
          </td>
          {r.flags.length > 0 && (
            <td className="row-flags" title={r.flags.join("; ")}>
              {r.flags.includes("not in catalog")
                ? "not in catalog"
                : r.flags[0]}
            </td>
          )}
        </tr>
      ))}
      {rows.length === 0 && (
        <tr>
          <td colSpan={11} className="hint">
            No pieces yet.
          </td>
        </tr>
      )}
    </tbody>
    <tfoot>
      <tr className="total">
        <td colSpan={2}>TOTAL</td>
        <td className="num">{quantity}</td>
        <td colSpan={8}>lengths and Total W are added in Stage 2</td>
      </tr>
      {footer}
    </tfoot>
  </table>
);

/** Page table, overall table and summary by kind, all computed by the API from the members. */
export const TablesPanel: React.FC<{
  projectId: string;
  pageNumber: number | null;
  /** Changes whenever a member changed, to reload the tables. */
  version: unknown;
  kinds: KindInfo[];
  who: string;
  onError: (err: unknown) => void;
  onSelectRow: (row: TableRowS1, pageNumber: number | null) => void;
  selectedKeys: ReadonlySet<string>;
  onChanged: () => void;
}> = ({
  projectId,
  pageNumber,
  version,
  kinds,
  who,
  onError,
  onSelectRow,
  selectedKeys,
  onChanged,
}) => {
  const [data, setData] = useState<TablesResponse | null>(null);
  const load = useCallback(async () => {
    setData(await api<TablesResponse>(`/api/projects/${projectId}/tables`));
  }, [projectId]);
  useEffect(() => {
    load().catch(onError);
  }, [load, onError, version]);
  if (!data) return <p className="hint">Loading tables...</p>;
  const page = data.pages.find((p) => p.page_number === pageNumber) ?? null;
  const act = async (path: string, body: object) => {
    if (who.trim() === "")
      return onError(new Error("Type your name at the top first."));
    try {
      await send("POST", `/api/projects/${projectId}/rows/${path}`, {
        ...body,
        who: who.trim(),
      });
      onChanged();
      await load();
    } catch (err) {
      onError(err);
    }
  };
  const handlers = {
    kinds,
    selectedKeys,
    onKind: (r: TableRowS1, kind: string | null) =>
      void act("kind", { member_ids: r.member_ids, kind }),
    onName: (r: TableRowS1, name: string) =>
      void act("name", { member_ids: r.member_ids, name }),
  };
  const footerOf = (
    red: Apart,
    existing: Apart,
    notCounted: Apart,
    misc: Apart,
    unlinked: number,
  ) => (
    <>
      <ApartLine label="Red, not counted" a={red} red />
      <ApartLine label="Existing, not counted" a={existing} />
      <ApartLine label="Not counted (excluded kinds)" a={notCounted} />
      <ApartLine label="Not computed (misc)" a={misc} />
      {unlinked > 0 && (
        <tr className="apart-row">
          <td colSpan={2}>Unlinked labels (in no total)</td>
          <td className="num">{unlinked}</td>
          <td colSpan={9} />
        </tr>
      )}
    </>
  );
  return (
    <div className="panel tables-panel">
      <h3>Tables</h3>
      <div className="row">
        <b
          className={data.draft.reviewed ? "draft ok" : "draft"}
          data-testid="tables-draft"
        >
          {data.draft.label}
        </b>
        <button
          title="Sets the suggested grade (HSS A500, W A992) for each shape family of this job that has none. Nothing is filled in until you press this."
          onClick={() => {
            if (who.trim() === "")
              return onError(new Error("Type your name at the top first."));
            send("POST", `/api/projects/${projectId}/grades/apply-suggested`, {
              who: who.trim(),
            })
              .then(() => load())
              .catch(onError);
          }}
        >
          Apply suggested grades
        </button>
        <a href={`/api/projects/${projectId}/tables.xlsx`} download>
          Export Excel{data.draft.reviewed ? "" : " (draft)"}
        </a>
      </div>
      <div className="hint">{data.stage_note}</div>
      <h4>Summary by kind</h4>
      <table className="grid-table" aria-label="summary by kind">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Quantity</th>
            <th>Groups</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {data.job.summary.map((s) => (
            <tr
              key={`${s.scope}-${s.kind}`}
              className={
                s.scope === "main" || s.scope === null ? "" : "apart-row"
              }
            >
              <td>
                {s.kind ?? "(no kind)"}
                {s.note && s.scope !== "main" ? (
                  <small> - {s.note}</small>
                ) : null}
              </td>
              <td className="num">{s.quantity}</td>
              <td className="num">
                {s.scope === "main" || s.scope === null ? s.groups : ""}
              </td>
              <td />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="total">
            <td>Main total</td>
            <td className="num">{data.job.quantity}</td>
            <td colSpan={2}>weight is added in Stage 2</td>
          </tr>
          {data.job.red.pieces > 0 && (
            <tr className="apart-row red">
              <td>Red, not counted</td>
              <td className="num">{data.job.red.pieces}</td>
              <td colSpan={2}>not in the main total</td>
            </tr>
          )}
        </tfoot>
      </table>
      <h4>This page{page ? ` (page ${page.page_number})` : ""}</h4>
      {page ? (
        <Table
          {...handlers}
          label="page table"
          rows={page.rows}
          quantity={page.quantity}
          onRow={(r) => onSelectRow(r, page.page_number)}
          footer={footerOf(
            page.red,
            page.existing,
            page.not_counted,
            page.misc,
            page.unlinked,
          )}
        />
      ) : (
        <p className="hint">
          No pieces on this page (it may be out of the takeoff).
        </p>
      )}
      <h4>Whole job</h4>
      <Table
        {...handlers}
        label="job table"
        rows={data.job.rows}
        quantity={data.job.quantity}
        onRow={(r) => onSelectRow(r, r.sheets[0] ?? null)}
        footer={
          <>
            {footerOf(
              data.job.red,
              data.job.existing,
              data.job.not_counted,
              data.job.misc,
              data.job.unlinked,
            )}
            {data.job.sheets_excluded.length > 0 && (
              <tr className="apart-row">
                <td colSpan={11}>
                  {data.job.sheets_excluded.length} sheets excluded: pages{" "}
                  {data.job.sheets_excluded.join(", ")}
                </td>
              </tr>
            )}
            <tr>
              <td
                colSpan={11}
                className={data.draft.reviewed ? "draft ok" : "draft"}
              >
                {data.draft.label}
              </td>
            </tr>
          </>
        }
      />
    </div>
  );
};

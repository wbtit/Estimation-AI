import React, { useEffect, useState } from "react";
import { api, send } from "../lib/api";
import { COLOUR_HEX } from "../lib/status";
import type {
  TakeoffData,
  TakeoffRow,
  TakeoffSection,
  TakeoffTotals,
} from "../lib/types";

const totalsLine = (t: TakeoffTotals) =>
  `${t.pieces} pieces, trusted length ${t.total_length_ft_in} (${Math.round(t.total_length_mm)} mm)${
    t.unmeasured ? `, ${t.unmeasured} without length` : ""
  }${
    t.length_shared_pieces
      ? `, ${t.length_shared_pieces} pieces on a shared line: counted, length NOT in this total`
      : ""
  }`;

/** The rows and totals of one takeoff section (steel, or joists). */
const Section: React.FC<{
  title: string;
  section: TakeoffSection;
  nameHeader: string;
  onJump: (row: TakeoffRow) => void;
}> = ({ title, section, nameHeader, onJump }) => {
  const included = section.rows.filter((r) => !r.excluded);
  const excluded = section.rows.filter((r) => r.kind === "red");
  const duplicates = section.rows.filter((r) => r.kind === "duplicate");
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
        {r.total_length_ft_in ?? (r.length_shared_pieces ? "not trusted" : "-")}
        {r.total_length_mm !== null && (
          <small> ({Math.round(r.total_length_mm)} mm)</small>
        )}
        {r.length_shared_pieces > 0 && r.total_length_mm !== null && (
          <small title="pieces on a shared line: counted, their length is not in this number">
            {" "}
            +{r.length_shared_pieces} shared
          </small>
        )}
      </td>
      <td>{r.grade}</td>
      <td>{r.level ?? ""}</td>
      <td>{r.sheets.join(", ")}</td>
      <td>
        <span className="dot" style={{ background: COLOUR_HEX[r.color] }} />
        {r.confirmed && " ✓"}
      </td>
    </tr>
  );
  return (
    <section>
      <h4>{title}</h4>
      <table className="takeoff-table">
        <thead>
          <tr>
            <th>mark</th>
            <th>as read</th>
            <th>{nameHeader}</th>
            <th>qty</th>
            <th>length</th>
            <th>grade (user-set)</th>
            <th>level</th>
            <th>sheet</th>
            <th>color</th>
          </tr>
        </thead>
        <tbody>
          {included.map(rowView)}
          {included.length === 0 && (
            <tr>
              <td colSpan={9} className="hint">
                Nothing in the totals yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <ul className="totals">
        {section.by_level.map((l) => (
          <li key={l.level ?? "none"}>
            <b>{l.level ?? "(no level)"}</b>: {totalsLine(l.totals)}
          </li>
        ))}
        <li>
          <b>All levels</b>: {totalsLine(section.totals)}
        </li>
      </ul>
      <p>
        <b>Excluded (red), not in the totals</b>:{" "}
        {totalsLine(section.excluded_red)}
      </p>
      {excluded.length > 0 && (
        <table className="takeoff-table">
          <tbody>{excluded.map(rowView)}</tbody>
        </table>
      )}
      <p>
        <b>
          Possible duplicates (same line, same profile, labels at one spot), not
          in the totals
        </b>
        : {totalsLine(section.possible_duplicates)}
      </p>
      {duplicates.length > 0 && (
        <table className="takeoff-table">
          <tbody>{duplicates.map(rowView)}</tbody>
        </table>
      )}
    </section>
  );
};

/** The takeoff table of the whole project. Click a row to jump to its first member on the sheet. */
export const TakeoffPanel: React.FC<{
  projectId: string;
  /** Changes whenever members change, so the table reloads. */
  version: unknown;
  onJump: (row: TakeoffRow) => void;
  onError: (err: unknown) => void;
  who: string;
}> = ({ projectId, version, onJump, onError, who }) => {
  const [data, setData] = useState<TakeoffData | null>(null);
  useEffect(() => {
    api<TakeoffData>(`/api/projects/${projectId}/takeoff`)
      .then(setData)
      .catch(onError);
  }, [projectId, version, onError]);

  const families = data
    ? [
        ...new Set(
          [...data.rows, ...data.joists.rows]
            .map((r) => r.family)
            .filter((f): f is string => !!f),
        ),
      ].sort()
    : [];
  const saveGrade = (family: string, grade: string) => {
    if (who.trim() === "")
      return onError(new Error("Type your name at the top first."));
    send("PUT", `/api/projects/${projectId}/grades/${family}`, {
      grade: grade.trim() === "" ? null : grade.trim(),
      who: who.trim(),
    })
      .then(() => api<TakeoffData>(`/api/projects/${projectId}/takeoff`))
      .then(setData)
      .catch(onError);
  };

  if (!data) return <p className="hint">Loading...</p>;
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
      {data.sheets && (
        <details>
          <summary>
            Sheets in the takeoff:{" "}
            {data.sheets.filter((s) => s.included).length} of{" "}
            {data.sheets.length} (only framing plans by default)
          </summary>
          <ul className="sheet-inclusion">
            {data.sheets.map((s) => (
              <li key={s.sheet_id}>
                page {s.page_number} {s.sheet_number ?? ""} (
                {s.page_type ?? "no type"}): <b>{s.included ? "in" : "out"}</b>
                {s.source === "person" ? " (set by a person)" : ""}
                {s.members_not_counted > 0
                  ? `, ${s.members_not_counted} members stored but not counted`
                  : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {families.length > 0 && (
        <details>
          <summary>
            Grade by shape family (typed by you; never filled in)
          </summary>
          {families.map((f) => (
            <label className="field" key={f}>
              {f}
              <input
                key={`${f}-${data.grades?.find((g) => g.family === f)?.grade ?? ""}`}
                defaultValue={
                  data.grades?.find((g) => g.family === f)?.grade ?? ""
                }
                placeholder="not set"
                onBlur={(e) => {
                  const was =
                    data.grades?.find((g) => g.family === f)?.grade ?? "";
                  if (e.target.value.trim() !== was)
                    saveGrade(f, e.target.value);
                }}
                onKeyDown={(e) =>
                  e.key === "Enter" && (e.target as HTMLInputElement).blur()
                }
                aria-label={`grade for ${f}`}
              />
            </label>
          ))}
        </details>
      )}
      <div className="review-tables">
        <table className="takeoff-table">
          <caption>
            The system's own result (rule, before any human action)
          </caption>
          <tbody>
            <tr>
              <td>green</td>
              <td className="num">{data.review.system.green}</td>
            </tr>
            <tr>
              <td>amber</td>
              <td className="num">{data.review.system.amber}</td>
            </tr>
            <tr>
              <td>red</td>
              <td className="num">{data.review.system.red}</td>
            </tr>
            <tr>
              <td>unlinked label</td>
              <td className="num">{data.review.system.unlinked}</td>
            </tr>
            <tr>
              <td>added by a person</td>
              <td className="num">{data.review.system.added_by_person}</td>
            </tr>
          </tbody>
        </table>
        <table className="takeoff-table">
          <caption>What a person did</caption>
          <tbody>
            <tr>
              <td>unreviewed</td>
              <td className="num">{data.review.human.unreviewed}</td>
            </tr>
            <tr>
              <td>confirmed</td>
              <td className="num">{data.review.human.confirmed}</td>
            </tr>
            <tr>
              <td>edited or added</td>
              <td className="num">{data.review.human.edited}</td>
            </tr>
            <tr>
              <td>not a member</td>
              <td className="num">{data.review.human.not_member}</td>
            </tr>
            <tr>
              <td>deleted</td>
              <td className="num">{data.review.human.deleted}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="warn">
        Unreviewed system output in the main total:{" "}
        <b>
          {data.review.main_total_unreviewed.pieces} of{" "}
          {data.review.main_total_unreviewed.of_pieces} pieces,{" "}
          {data.review.main_total_unreviewed.total_length_ft_in} of{" "}
          {data.review.main_total_unreviewed.of_length_ft_in}
        </b>
        .
      </p>
      <Section
        title="Steel shapes"
        section={data}
        nameHeader="profile"
        onJump={onJump}
      />
      <Section
        title="Joists (K, LH, DLH; not matched to AISC)"
        section={data.joists}
        nameHeader="designation"
        onJump={onJump}
      />
    </div>
  );
};

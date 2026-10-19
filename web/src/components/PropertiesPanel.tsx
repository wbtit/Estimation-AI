import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Lock,
  PanelRight,
  Trash2,
  Undo2,
} from "lucide-react";
import { formatFtIn } from "../lib/ftin";
import {
  common,
  MIXED,
  sizeGroups,
  summary,
  type BomRow,
  type Box,
  type Piece,
} from "../lib/lf";
import { SectionSearch } from "./SectionSearch";

export interface Kind {
  kind: string;
  scope: string;
  symbol_group: string;
}

export interface PieceEdit {
  profile_text?: string | null;
  kind?: string;
  studs?: number | null;
  camber?: string | null;
  ignored?: boolean;
  approved?: boolean;
}

const show = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v);

/** A section of the panel: a title bar that opens and closes it. */
const Section: React.FC<{
  title: string;
  extra?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}> = ({ title, extra, testId, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="section" data-testid={testId}>
      <div className="sec-bar">
        <button
          className="sec-head"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {title}
          <span className="grow" />
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        {extra}
      </div>
      {open && <div className="sec-body">{children}</div>}
    </div>
  );
};

/** Label / value rows of a summary. */
export const SummaryList: React.FC<{
  rows: readonly BomRow[];
  sheetId?: string | null;
}> = ({ rows, sheetId }) => {
  const s = summary(rows, sheetId);
  return (
    <div className="sum-list">
      <span>Column:</span>
      <b>{s.columns}</b>
      <span>Beam:</span>
      <b>{s.beams}</b>
      <span>Brace:</span>
      <b>{s.braces}</b>
      {s.piles > 0 && (
        <>
          <span>Piles:</span>
          <b>{s.piles}</b>
        </>
      )}
      {s.joists > 0 && (
        <>
          <span title="Not in the steel total">Joists:</span>
          <b>{s.joists}</b>
        </>
      )}
      <span title="US short tons (2000 lb) of found and needs review pieces">
        Total Weight (tons):
      </span>
      <b>{s.tons.toFixed(2)}</b>
    </div>
  );
};

/** Properties: a Summary tab (sheet and project summary, crop) and a Member tab (the selection).
 * Selecting a member opens the Member tab; clearing the selection goes back to Summary. */
export const PropertiesPanel: React.FC<{
  bomRows: BomRow[];
  sheetId: string | null;
  selected: Piece[];
  kinds: Kind[];
  crop: Box | null;
  onEdit: (e: PieceEdit) => void;
  onDelete: () => void;
  onCropTool: () => void;
  /** The pieces of the active view (for "Set size for all …"), and its name when the page has
   * several views. */
  viewPieces?: Piece[];
  viewName?: string | null;
  onSetSizeAll?: (ids: string[], profile: string) => void;
  /** Members by size: select the members of a size on this page, or open a page with them. */
  onSelectPieces?: (ids: string[]) => void;
  onOpenPage?: (sheetId: string, ids: string[]) => void;
  pageName?: (sheetId: string) => string;
}> = ({
  bomRows,
  sheetId,
  selected,
  kinds,
  crop,
  onEdit,
  onDelete,
  onCropTool,
  viewPieces = [],
  viewName = null,
  onSetSizeAll,
  onSelectPieces,
  onOpenPage,
  pageName = (id) => id,
}) => {
  const [tab, setTab] = useState<"summary" | "member">(
    selected.length ? "member" : "summary",
  );
  const had = useRef(selected.length > 0);
  useEffect(() => {
    const has = selected.length > 0;
    if (has !== had.current) setTab(has ? "member" : "summary");
    had.current = has;
  }, [selected.length]);
  return (
    <div className="props dark">
      <div className="panel-head">
        <PanelRight size={16} /> Properties
      </div>
      <div className="seg">
        <button
          className={tab === "summary" ? "on" : ""}
          onClick={() => setTab("summary")}
        >
          Summary
        </button>
        <button
          className={tab === "member" ? "on" : ""}
          onClick={() => setTab("member")}
        >
          Member
        </button>
      </div>
      <div className="scroll">
        {tab === "summary" ? (
          <>
            <Section title="Sheet Summary" testId="summary">
              <SummaryList rows={bomRows} sheetId={sheetId} />
              {onSetSizeAll && (
                <SetSizeAll
                  pieces={viewPieces}
                  viewName={viewName}
                  onSet={onSetSizeAll}
                />
              )}
            </Section>
            <Section title="Members by size" testId="by-size">
              <MembersBySize
                rows={bomRows}
                sheetId={sheetId}
                onSelectPieces={onSelectPieces}
                onOpenPage={onOpenPage}
                pageName={pageName}
              />
            </Section>
            <Section title="Project Summary" testId="project-summary">
              <SummaryList rows={bomRows} />
            </Section>
            <Section
              title={viewName ? `Crop · ${viewName}` : "Crop"}
              extra={<button onClick={onCropTool}>Redraw</button>}
            >
              {crop ? (
                <div className="sum-list">
                  <span>Left, top:</span>
                  <b>
                    {crop.x0.toFixed(0)}, {crop.y0.toFixed(0)} pt
                  </b>
                  <span>Right, bottom:</span>
                  <b>
                    {crop.x1.toFixed(0)}, {crop.y1.toFixed(0)} pt
                  </b>
                </div>
              ) : (
                <span className="muted">No crop</span>
              )}
            </Section>
          </>
        ) : selected.length > 0 ? (
          <MemberSection
            selected={selected}
            kinds={kinds}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ) : (
          <Section title="Member Properties">
            <span className="muted">Click a member</span>
          </Section>
        )}
      </div>
    </div>
  );
};

const lbs = (n: number) => Math.round(n).toLocaleString("en-US");
/** A total length in whole feet (the panel is narrow); the exact ft-in is its tooltip. */
const feet = (mm: number) =>
  mm > 0 ? `${Math.round(mm / 304.8).toLocaleString("en-US")}'` : "—";

/** Members by size (Sheet = this page, all its views; Project = every page): per kind, one row per
 * section with Qty, total length, weight (lb) and approved / pieces, a "No size" row, a total per
 * kind. From the BOM rows, so the numbers are the BOM's. Sheet: a row click selects those members
 * on the page. Project: a row click lists the pages with that size; a page click opens it with
 * them selected. */
export const MembersBySize: React.FC<{
  rows: readonly BomRow[];
  sheetId: string | null;
  onSelectPieces?: (ids: string[]) => void;
  onOpenPage?: (sheetId: string, ids: string[]) => void;
  pageName: (sheetId: string) => string;
}> = ({ rows, sheetId, onSelectPieces, onOpenPage, pageName }) => {
  const [scope, setScope] = useState<"sheet" | "project">("sheet");
  const [open, setOpen] = useState<string | null>(null);
  const groups = sizeGroups(rows, scope === "sheet" ? sheetId : undefined);
  useEffect(() => setOpen(null), [scope, sheetId]);
  return (
    <div className="by-size">
      <div className="seg light small" role="tablist">
        {(["sheet", "project"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={scope === k}
            className={scope === k ? "on" : ""}
            onClick={() => setScope(k)}
          >
            {k === "sheet" ? "Sheet" : "Project"}
          </button>
        ))}
      </div>
      {groups.length === 0 && <span className="muted">No members</span>}
      <table className="size-table" data-testid={`by-size-${scope}`}>
        <thead>
          <tr>
            <th>Section</th>
            <th>Qty</th>
            <th>Length</th>
            <th>lbs</th>
            <th title="approved / pieces">✓</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.kind}>
            <tr className="kind">
              <td colSpan={5}>{g.kind}</td>
            </tr>
            {g.rows.map((r) => {
              const key = `${g.kind}|${r.section ?? ""}`;
              return (
                <React.Fragment key={key}>
                  <tr
                    className={`size-row${open === key ? " on" : ""}`}
                    data-testid="size-row"
                    onClick={() => {
                      setOpen(open === key && scope === "project" ? null : key);
                      if (scope === "sheet") onSelectPieces?.(r.piece_ids);
                    }}
                  >
                    <td className={r.section ? "" : "no-size"}>
                      {r.section ?? "No size"}
                    </td>
                    <td>{r.qty}</td>
                    <td title={r.length_mm > 0 ? formatFtIn(r.length_mm) : ""}>
                      {feet(r.length_mm)}
                    </td>
                    <td
                      title={
                        r.no_weight ? `${r.no_weight} without a weight` : ""
                      }
                    >
                      {r.weight_lb > 0 ? lbs(r.weight_lb) : "—"}
                    </td>
                    <td className={r.approved === r.qty ? "all-ok" : ""}>
                      {r.approved}/{r.qty}
                    </td>
                  </tr>
                  {scope === "project" && open === key && (
                    <tr className="pages">
                      <td colSpan={5}>
                        {r.sheets.map((sh) => (
                          <button
                            key={sh.sheet_id}
                            className="link"
                            onClick={() =>
                              onOpenPage?.(sh.sheet_id, sh.piece_ids)
                            }
                          >
                            {pageName(sh.sheet_id)} · {sh.qty}
                          </button>
                        ))}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            <tr className="total">
              <td>Total</td>
              <td>{g.total.qty}</td>
              <td
                title={
                  g.total.length_mm > 0 ? formatFtIn(g.total.length_mm) : ""
                }
              >
                {feet(g.total.length_mm)}
              </td>
              <td>{g.total.weight_lb > 0 ? lbs(g.total.weight_lb) : "—"}</td>
              <td>
                {g.total.approved}/{g.total.qty}
              </td>
            </tr>
          </tbody>
        ))}
      </table>
    </div>
  );
};

/** The pieces "Set size for all" applies to: undefined beams, and columns without a size (shown
 * ones, not ignored or deleted). */
export function withoutSize(pieces: readonly Piece[]): {
  beams: Piece[];
  columns: Piece[];
} {
  const open = pieces.filter((p) => !p.ignored && !p.deleted && !p.profile);
  return {
    beams: open.filter((p) => p.type !== "column"),
    columns: open.filter((p) => p.type === "column"),
  };
}

/** "Set size for all undefined beams" / "… columns without a size": the AISC search, then one
 * edit of all of them (one logged action; Undo puts them back). */
const SetSizeAll: React.FC<{
  pieces: Piece[];
  viewName: string | null;
  onSet: (ids: string[], profile: string) => void;
}> = ({ pieces, viewName, onSet }) => {
  const [open, setOpen] = useState<"beams" | "columns" | null>(null);
  const { beams, columns } = withoutSize(pieces);
  const where = viewName ? ` in ${viewName}` : "";
  const target = open === "beams" ? beams : open === "columns" ? columns : [];
  return (
    <div className="set-size" data-testid="set-size-all">
      {beams.length > 0 && (
        <button
          className={open === "beams" ? "on" : ""}
          onClick={() => setOpen(open === "beams" ? null : "beams")}
        >
          Set size for all undefined beams{where} ({beams.length})
        </button>
      )}
      {columns.length > 0 && (
        <button
          className={open === "columns" ? "on" : ""}
          onClick={() => setOpen(open === "columns" ? null : "columns")}
        >
          Set size for all columns without a size{where} ({columns.length})
        </button>
      )}
      {open && target.length > 0 && (
        <div className="fld">
          <span className="fld-label">
            Size for {target.length} {open === "beams" ? "beams" : "columns"}
          </span>
          <SectionSearch
            value=""
            onPick={(name) => {
              onSet(
                target.map((p) => p.id),
                name,
              );
              setOpen(null);
            }}
          />
        </div>
      )}
    </div>
  );
};

/** One field: its label above the value. */
const Field: React.FC<{
  label: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <div className="fld">
    <span className="fld-label">{label}</span>
    {children}
  </div>
);

const MemberSection: React.FC<{
  selected: Piece[];
  kinds: Kind[];
  onEdit: (e: PieceEdit) => void;
  onDelete: () => void;
}> = ({ selected, kinds, onEdit, onDelete }) => {
  const tag = common(selected.map((p) => p.tag));
  const kind = common(selected.map((p) => p.kind));
  const size = common(selected.map((p) => p.profile ?? p.profile_raw));
  const length = common(
    selected.map((p) =>
      p.length_mm === null ? null : formatFtIn(p.length_mm),
    ),
  );
  const studs = common(selected.map((p) => p.studs));
  const camber = common(selected.map((p) => p.camber_raw));
  const elev = common(
    selected.map((p) =>
      p.elevation_mm === null ? null : formatFtIn(p.elevation_mm),
    ),
  );
  const ignored = common(selected.map((p) => p.ignored));
  const shown = selected.filter((p) => !p.deleted);
  const nApproved = shown.filter((p) => p.approved).length;
  const [studsText, setStudsText] = useState(show(studs));
  const [camberText, setCamberText] = useState(show(camber));
  useEffect(() => setStudsText(show(studs)), [studs]);
  useEffect(() => setCamberText(show(camber)), [camber]);
  const kindList = kinds.filter(
    (k) =>
      k.scope === "main" &&
      (k.symbol_group === "linear" || k.symbol_group === "column"),
  );

  return (
    <Section
      title="Member Properties"
      testId="member"
      extra={
        selected.length > 1 && (
          <span className="muted">{selected.length} selected</span>
        )
      }
    >
      <div className="approve-bar" data-testid="approve-bar">
        {nApproved < shown.length && (
          <button
            className="approve"
            title="Confirm as built (A)"
            onClick={() => onEdit({ approved: true })}
          >
            <Check size={15} strokeWidth={3} /> Approve
            {shown.length > 1 ? ` ${shown.length - nApproved}` : ""}
          </button>
        )}
        {nApproved > 0 && (
          <button
            className="unapprove"
            title="Take the approval back"
            onClick={() => onEdit({ approved: false })}
          >
            <Undo2 size={14} /> Unapprove
            {shown.length > 1 ? ` ${nApproved}` : ""}
          </button>
        )}
        {nApproved === shown.length && shown.length > 0 && (
          <span className="approved-note">
            <Check size={13} strokeWidth={3} /> Approved
          </span>
        )}
      </div>
      <div className="fld-box">
        <span className="fld-label">Piecemark</span>
        <b>{show(tag) || "—"}</b>
      </div>
      <div className="fld-box">
        <span className="fld-label">Length</span>
        <b>{show(length) || "—"}</b>
      </div>
      <Field label="Member Type">
        <select
          aria-label="member type"
          value={kind === MIXED ? MIXED : show(kind)}
          onChange={(e) =>
            e.target.value !== MIXED && onEdit({ kind: e.target.value })
          }
        >
          {kind === MIXED && <option value={MIXED}>{MIXED}</option>}
          {kind === null && <option value="">—</option>}
          {kindList.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.kind}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Section Size">
        <SectionSearch
          value={show(size)}
          onPick={(name) => onEdit({ profile_text: name })}
        />
      </Field>
      <div className="two">
        <Field label="Camber">
          <input
            aria-label="camber"
            placeholder="Enter camber"
            value={camberText}
            onChange={(e) => setCamberText(e.target.value)}
            onBlur={() => {
              const t = camberText.trim();
              if (t !== show(camber)) onEdit({ camber: t === "" ? null : t });
            }}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.target as HTMLInputElement).blur()
            }
          />
        </Field>
        <Field label="Studs">
          <input
            aria-label="studs"
            value={studsText}
            placeholder="0"
            inputMode="numeric"
            onChange={(e) => setStudsText(e.target.value)}
            onBlur={() => {
              const t = studsText.trim();
              if (t === show(studs)) return;
              if (t === "") onEdit({ studs: null });
              else if (/^\d+$/.test(t)) onEdit({ studs: Number(t) });
              else setStudsText(show(studs));
            }}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.target as HTMLInputElement).blur()
            }
          />
        </Field>
      </div>
      <div className="two">
        <Field
          label={
            <span className="row" style={{ gap: 4 }}>
              Left End <Lock size={11} />
            </span>
          }
        >
          <span className="locked" title="Top of Steel of the page (locked)">
            {show(elev) || "—"}
          </span>
        </Field>
        <Field
          label={
            <span className="row" style={{ gap: 4 }}>
              Right End <Lock size={11} />
            </span>
          }
        >
          <span className="locked" title="Top of Steel of the page (locked)">
            {show(elev) || "—"}
          </span>
        </Field>
      </div>
      <label className="check">
        <input
          type="checkbox"
          aria-label="ignore"
          checked={ignored === true}
          ref={(el) => {
            if (el) el.indeterminate = ignored === MIXED;
          }}
          onChange={(e) => onEdit({ ignored: e.target.checked })}
        />
        Ignore (not ours)
      </label>
      <button
        className="danger row"
        style={{ justifyContent: "center", gap: 6 }}
        onClick={onDelete}
      >
        <Trash2 size={15} /> Delete
      </button>
    </Section>
  );
};

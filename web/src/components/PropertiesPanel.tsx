import React, { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Lock,
  PanelRight,
  Trash2,
} from "lucide-react";
import { formatFtIn } from "../lib/ftin";
import {
  common,
  MIXED,
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
}> = ({
  bomRows,
  sheetId,
  selected,
  kinds,
  crop,
  onEdit,
  onDelete,
  onCropTool,
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
            </Section>
            <Section title="Project Summary" testId="project-summary">
              <SummaryList rows={bomRows} />
            </Section>
            <Section
              title="Crop"
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

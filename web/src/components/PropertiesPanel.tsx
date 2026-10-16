import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Lock, Trash2 } from "lucide-react";
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

/** A section of the panel that opens and closes on its title. */
const Section: React.FC<{
  title: string;
  extra?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}> = ({ title, extra, testId, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="section" data-testid={testId}>
      <div className="row" style={{ paddingRight: 12 }}>
        <button
          className="sec-head"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {title}
        </button>
        {extra}
      </div>
      {open && <div className="sec-body">{children}</div>}
    </div>
  );
};

/** Properties: Summary (project or sheet), Member (one or several pieces), Crop. */
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
  const [scope, setScope] = useState<"project" | "sheet">("sheet");
  const s = summary(bomRows, scope === "sheet" ? sheetId : undefined);
  return (
    <div className="props dark">
      <div className="panel-head">Properties</div>
      <div className="scroll">
        <Section
          title="Summary"
          extra={
            <div className="seg" style={{ margin: 0, flex: "none" }}>
              <button
                className={scope === "project" ? "on" : ""}
                onClick={() => setScope("project")}
              >
                Project
              </button>
              <button
                className={scope === "sheet" ? "on" : ""}
                onClick={() => setScope("sheet")}
              >
                Sheet
              </button>
            </div>
          }
        >
          <div className="stats" data-testid="summary">
            <div title="Pieces drawn, every state">
              <b>{s.columns}</b>Column
            </div>
            <div title="Pieces drawn, every state">
              <b>{s.beams}</b>Beam
            </div>
            <div title="Pieces drawn, every state">
              <b>{s.braces}</b>Brace
            </div>
            <div title="US short tons (2000 lb) of found and needs review pieces">
              <b>{s.tons.toFixed(2)}</b>tons
            </div>
          </div>
        </Section>
        {selected.length > 0 ? (
          <MemberSection
            selected={selected}
            kinds={kinds}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ) : (
          <Section title="Member">
            <span className="muted">Click a member</span>
          </Section>
        )}
        <Section
          title="Crop"
          extra={<button onClick={onCropTool}>Redraw</button>}
        >
          {crop ? (
            <div className="kv">
              <span>Left, top</span>
              <span>
                {crop.x0.toFixed(0)}, {crop.y0.toFixed(0)} pt
              </span>
              <span>Right, bottom</span>
              <span>
                {crop.x1.toFixed(0)}, {crop.y1.toFixed(0)} pt
              </span>
            </div>
          ) : (
            <span className="muted">No crop</span>
          )}
        </Section>
      </div>
    </div>
  );
};

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
      title="Member"
      testId="member"
      extra={
        selected.length > 1 && (
          <span className="muted">{selected.length} selected</span>
        )
      }
    >
      <div className="kv">
        <span>Piecemark</span>
        <span>{show(tag) || "—"}</span>
        <span>Member Type</span>
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
        <span>Section Size</span>
        <SectionSearch
          value={show(size)}
          onPick={(name) => onEdit({ profile_text: name })}
        />
        <span>Length</span>
        <span>{show(length) || "—"}</span>
        <span>Studs</span>
        <input
          aria-label="studs"
          value={studsText}
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
        <span>Camber</span>
        <input
          aria-label="camber"
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
        <span>Left end elev.</span>
        <span title="Top of Steel of the page (locked)" className="row">
          <Lock size={12} /> {show(elev) || "—"}
        </span>
        <span>Right end elev.</span>
        <span title="Top of Steel of the page (locked)" className="row">
          <Lock size={12} /> {show(elev) || "—"}
        </span>
        <span>Ignore</span>
        <span>
          <input
            type="checkbox"
            aria-label="ignore"
            checked={ignored === true}
            ref={(el) => {
              if (el) el.indeterminate = ignored === MIXED;
            }}
            onChange={(e) => onEdit({ ignored: e.target.checked })}
          />
        </span>
      </div>
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

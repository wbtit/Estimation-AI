import React, { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { formatFtIn } from "../lib/ftin";
import { common, MIXED, type Piece } from "../lib/lf";
import {
  anglesOf,
  angleGroups,
  angleLabel,
  bentLbPerFt,
  bentName,
  bentValid,
  canAddAngle,
  formatInches,
  parseAngleLength,
  parseBent,
  parseInches,
  startProfile,
  type AngleForm,
  type AngleOptions,
  type AnglePatch,
  type Bent,
} from "../lib/perimeter-angle";

/** What the Properties panel needs for perimeter angles (Workspace wires it to the API). */
export interface PerimeterApi {
  options: AngleOptions | null;
  /** Every piece of the page: the angles of a beam are found among them. */
  pieces: readonly Piece[];
  onAdd: (beamIds: string[], form: AngleForm) => void;
  onEdit: (ids: string[], patch: AnglePatch) => void;
  /** A person's action: the project's grade for angles and bent plates (null = the A36 default). */
  onSetGrade: (grade: string | null) => void;
  onSelect: (ids: string[]) => void;
  onRemove: (ids: string[]) => void;
}

const Opts: React.FC<{ options: AngleOptions }> = ({ options }) => {
  const g = angleGroups(options.angles);
  return (
    <>
      <optgroup label="Common">
        {g.common.map((a) => (
          <option key={a.name} value={a.name}>
            {angleLabel(a)}
          </option>
        ))}
      </optgroup>
      <optgroup label="All L shapes (AISC)">
        {g.rest.map((a) => (
          <option key={a.name} value={a.name}>
            {angleLabel(a)}
          </option>
        ))}
      </optgroup>
    </>
  );
};

/** The project's grade for angles and bent plates: A36 by default (confirmed by the estimator),
 * editable per project; any text is a grade (the list stays open); empty = back to the default. */
const GradeField: React.FC<{ api: PerimeterApi }> = ({ api }) => {
  const o = api.options;
  const [text, setText] = useState("");
  const grade = o?.grade ?? "";
  useEffect(() => setText(grade), [grade]);
  if (!o) return null;
  const commit = () => {
    const t = text.trim();
    if (t === o.grade) return;
    if (t === "" && o.grade_is_default) return setText(grade);
    api.onSetGrade(t === "" ? null : t);
  };
  return (
    <label className="fld" data-testid="angle-grade">
      <span className="fld-label">
        Grade (this project){o.grade_is_default ? " · default" : ""}
      </span>
      <input
        aria-label="angle grade"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
};

/** Three inch fields (thickness, leg 1, leg 2; fractions like 3/8 allowed) and the name / weight
 * they make. `value` is the typed text; `onChange` gets it back. */
interface BentText {
  t: string;
  l1: string;
  l2: string;
}
const bentOf = (v: BentText): Bent | null => {
  const [t, l1, l2] = [parseInches(v.t), parseInches(v.l1), parseInches(v.l2)];
  if (t === null || l1 === null || l2 === null) return null;
  const b = { thickness_in: t, leg1_in: l1, leg2_in: l2 };
  return bentValid(b) ? b : null;
};
const BentFields: React.FC<{
  value: BentText;
  onChange: (v: BentText) => void;
  onCommit?: () => void;
  invalid: boolean;
}> = ({ value, onChange, onCommit, invalid }) => {
  const b = bentOf(value);
  const field = (k: keyof BentText, label: string, aria: string) => (
    <label className="fld">
      <span className="fld-label">{label}</span>
      <input
        aria-label={aria}
        placeholder={k === "t" ? "3/8" : k === "l1" ? "6" : "4"}
        value={value[k]}
        aria-invalid={invalid}
        onChange={(e) => onChange({ ...value, [k]: e.target.value })}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onCommit) {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
  return (
    <>
      <div className="two">
        {field("t", "Thickness (in)", "bent thickness")}
        {field("l1", "Leg 1 (in)", "bent leg 1")}
        {field("l2", "Leg 2 (in)", "bent leg 2")}
      </div>
      <div className="muted" data-testid="bent-preview">
        {b ? `${bentName(b)} · ${bentLbPerFt(b).toFixed(1)} lb/ft` : "—"}
      </div>
      {invalid && (
        <div className="angle-bad" role="alert">
          Type the thickness and both legs in inches (like 3/8, 6, 4); each leg
          is longer than the thickness.
        </div>
      )}
    </>
  );
};

/** "Add perimeter angle" on the selected beam(s): pick the profile (the last one is ready), Enter. */
export const PerimeterAdd: React.FC<{
  selected: readonly Piece[];
  api: PerimeterApi;
}> = ({ selected, api }) => {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState("");
  const [length, setLength] = useState("");
  const [side, setSide] = useState<"" | "left" | "right">("");
  const [leg, setLeg] = useState<"" | "long" | "short">("");
  const [bad, setBad] = useState(false);
  const [kind, setKind] = useState<"angle" | "bent">("angle");
  const [bt, setBt] = useState<BentText>({ t: "", l1: "", l2: "" });
  const [badBent, setBadBent] = useState(false);
  const o = api.options;
  useEffect(() => {
    if (!o || profile !== "") return;
    setProfile(startProfile(o));
    const last = parseBent(o.last_profile);
    if (last) {
      setKind("bent");
      setBt({
        t: formatInches(last.thickness_in),
        l1: formatInches(last.leg1_in),
        l2: formatInches(last.leg2_in),
      });
    }
  }, [o, profile]);
  if (!canAddAngle(selected)) return null;
  const n = selected.length;
  const submit = () => {
    const len = parseAngleLength(length);
    if (len === undefined) {
      setBad(true);
      return;
    }
    const bent = kind === "bent" ? bentOf(bt) : null;
    if (kind === "bent" && !bent) {
      setBadBent(true);
      return;
    }
    if (kind === "angle" && !profile) return;
    setBad(false);
    setBadBent(false);
    api.onAdd(
      selected.map((p) => p.id),
      {
        ...(bent ? { bent } : { profile_text: profile }),
        ...(len !== null && { length_mm: len }),
        ...(side && { slab_edge_side: side }),
        ...(leg && { vertical_leg: leg }),
      },
    );
    setOpen(false);
    setLength("");
  };
  return (
    <div className="section" data-testid="perimeter-add">
      <div className="sec-bar">
        <span className="sec-title">Perimeter angle</span>
      </div>
      <div className="sec-body">
        {!open ? (
          <button
            className="row"
            style={{ gap: 6 }}
            data-testid="add-angle"
            disabled={!o}
            title="An L-section on the top flange of the beam (edge angle / pour stop / deck support angle)"
            onClick={() => setOpen(true)}
          >
            <Plus size={15} /> Add perimeter angle{n > 1 ? ` (${n} beams)` : ""}
          </button>
        ) : (
          o && (
            <div
              className="angle-form"
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !(e.target instanceof HTMLButtonElement)
                ) {
                  e.preventDefault();
                  submit();
                }
                if (e.key === "Escape") setOpen(false);
              }}
            >
              <label className="fld">
                <span className="fld-label">Type</span>
                <select
                  aria-label="perimeter type"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as "angle" | "bent")}
                >
                  <option value="angle">Angle (AISC L shape)</option>
                  <option value="bent">Bent plate (custom made)</option>
                </select>
              </label>
              {kind === "angle" ? (
                <label className="fld">
                  <span className="fld-label">Profile</span>
                  <select
                    aria-label="angle profile"
                    autoFocus
                    value={profile}
                    onChange={(e) => setProfile(e.target.value)}
                  >
                    <Opts options={o} />
                  </select>
                </label>
              ) : (
                <BentFields value={bt} onChange={setBt} invalid={badBent} />
              )}
              <label className="fld">
                <span className="fld-label">Length</span>
                <input
                  aria-label="angle length"
                  placeholder="Whole beam"
                  value={length}
                  aria-invalid={bad}
                  onChange={(e) => setLength(e.target.value)}
                />
              </label>
              {bad && (
                <div className="angle-bad" role="alert">
                  Type a length like 12&apos;-6&quot; or 3000 mm, or leave it
                  empty for the whole beam.
                </div>
              )}
              <div className="two">
                <label className="fld">
                  <span className="fld-label">Slab edge</span>
                  <select
                    aria-label="slab edge side"
                    value={side}
                    onChange={(e) =>
                      setSide(e.target.value as "" | "left" | "right")
                    }
                  >
                    <option value="">—</option>
                    <option value="left">Left of beam</option>
                    <option value="right">Right of beam</option>
                  </select>
                </label>
                <label className="fld">
                  <span className="fld-label">Vertical leg</span>
                  <select
                    aria-label="vertical leg"
                    value={leg}
                    onChange={(e) =>
                      setLeg(e.target.value as "" | "long" | "short")
                    }
                  >
                    <option value="">—</option>
                    <option value="long">Long leg</option>
                    <option value="short">Short leg</option>
                  </select>
                </label>
              </div>
              <GradeField api={api} />
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="approve"
                  data-testid="confirm-add-angle"
                  onClick={submit}
                >
                  Add{n > 1 ? ` to ${n} beams` : ""}
                </button>
                <button onClick={() => setOpen(false)}>Cancel</button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
};

/** The angles of ONE selected beam, listed under it: select, change the profile, remove. */
export const AngleList: React.FC<{
  beam: Piece;
  api: PerimeterApi;
}> = ({ beam, api }) => {
  const list = anglesOf(api.pieces, beam.id);
  if (list.length === 0) return null;
  return (
    <div className="section" data-testid="angle-list">
      <div className="sec-bar">
        <span className="sec-title">
          Perimeter angles on {beam.tag ?? "this beam"}
        </span>
      </div>
      <div className="sec-body">
        {list.map((a) => (
          <div className="angle-row row" data-testid="angle-row" key={a.id}>
            <button
              className="linklike"
              title="Select this angle"
              onClick={() => api.onSelect([a.id])}
            >
              {a.tag ?? "—"}
            </button>
            <span>{a.profile ?? "no size"}</span>
            <span className="muted">{formatFtIn(a.length_mm)}</span>
            <span className="grow" />
            <button
              aria-label={`remove angle ${a.tag ?? ""}`}
              title="Remove (Undo puts it back)"
              onClick={() => api.onRemove([a.id])}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const show = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** The Member panel of selected perimeter angles: profile, length, start offset, the optional 3D
 * hints, grade, remove. A blank length follows the whole beam. */
export const AngleSection: React.FC<{
  selected: readonly Piece[];
  api: PerimeterApi;
}> = ({ selected, api }) => {
  const ids = selected.map((p) => p.id);
  const tag = common(selected.map((p) => p.tag));
  const parent = common(selected.map((p) => p.parent_tag));
  const profile = common(selected.map((p) => p.profile));
  const typed = common(selected.map((p) => p.angle_length_mm ?? null));
  const offset = common(selected.map((p) => p.angle_start_offset_mm ?? null));
  const length = common(selected.map((p) => p.length_mm));
  const side = common(selected.map((p) => p.slab_edge_side ?? null));
  const leg = common(selected.map((p) => p.vertical_leg ?? null));
  const o = api.options;
  const allBent = selected.every((p) => parseBent(p.profile) !== null);
  const bentKey = allBent ? String(profile) : "";
  const [bentText, setBentText] = useState<BentText>({ t: "", l1: "", l2: "" });
  const [badBent, setBadBent] = useState(false);
  useEffect(() => {
    const b = parseBent(bentKey);
    setBentText(
      b
        ? {
            t: formatInches(b.thickness_in),
            l1: formatInches(b.leg1_in),
            l2: formatInches(b.leg2_in),
          }
        : { t: "", l1: "", l2: "" },
    );
    setBadBent(false);
  }, [bentKey]);
  const commitBent = () => {
    const b = bentOf(bentText);
    if (!b) return setBadBent(true);
    setBadBent(false);
    if (bentName(b) !== profile) api.onEdit(ids, { bent: b });
  };
  const [lenText, setLenText] = useState("");
  const [offText, setOffText] = useState("");
  const [bad, setBad] = useState(false);
  const typedKey = show(typed);
  const offKey = show(offset);
  useEffect(
    () =>
      setLenText(
        typed === null || typed === MIXED ? "" : formatFtIn(Number(typed)),
      ),
    [typedKey],
  );
  useEffect(
    () =>
      setOffText(
        offset === null || offset === MIXED ? "" : formatFtIn(Number(offset)),
      ),
    [offKey],
  );
  const commit = (
    text: string,
    current: unknown,
    send: (mm: number | null) => void,
  ) => {
    const v = parseAngleLength(text);
    if (v === undefined) {
      setBad(true);
      return;
    }
    setBad(false);
    if (v === (current === MIXED ? undefined : (current as number | null)))
      return;
    send(v);
  };
  return (
    <div className="section" data-testid="angle-member">
      <div className="sec-bar">
        <span className="sec-title">Perimeter angle</span>
        {selected.length > 1 && (
          <span className="muted">{selected.length} selected</span>
        )}
      </div>
      <div className="sec-body">
        <div className="fld-box">
          <span className="fld-label">Piecemark</span>
          <b>{show(tag) || "—"}</b>
        </div>
        <div className="fld-box">
          <span className="fld-label">On beam</span>
          <b>{show(parent) || "—"}</b>
        </div>
        <div className="fld-box">
          <span className="fld-label">Length</span>
          <b>
            {length === MIXED ? MIXED : formatFtIn(length as number | null)}
          </b>
          <span className="muted">{typed === null ? " (whole beam)" : ""}</span>
        </div>
        {allBent && profile !== MIXED && (
          <BentFields
            value={bentText}
            onChange={setBentText}
            onCommit={commitBent}
            invalid={badBent}
          />
        )}
        {o && !(allBent && profile !== MIXED) && (
          <label className="fld">
            <span className="fld-label">Profile</span>
            <select
              aria-label="angle profile"
              value={profile === MIXED ? MIXED : show(profile)}
              onChange={(e) =>
                e.target.value !== MIXED &&
                api.onEdit(ids, { profile_text: e.target.value })
              }
            >
              {profile === MIXED && <option value={MIXED}>{MIXED}</option>}
              {!o.angles.some((a) => a.name === profile) &&
                profile !== MIXED && (
                  <option value={show(profile)}>{show(profile) || "—"}</option>
                )}
              <Opts options={o} />
            </select>
          </label>
        )}
        <div className="two">
          <label className="fld">
            <span className="fld-label">Length (blank = whole beam)</span>
            <input
              aria-label="angle length"
              placeholder="Whole beam"
              value={lenText}
              aria-invalid={bad}
              onChange={(e) => setLenText(e.target.value)}
              onBlur={() =>
                commit(lenText, typed, (mm) =>
                  api.onEdit(ids, { length_mm: mm }),
                )
              }
              onKeyDown={(e) =>
                e.key === "Enter" && (e.target as HTMLInputElement).blur()
              }
            />
          </label>
          <label className="fld">
            <span className="fld-label">Start offset</span>
            <input
              aria-label="angle start offset"
              placeholder="0"
              value={offText}
              onChange={(e) => setOffText(e.target.value)}
              onBlur={() =>
                commit(offText, offset, (mm) =>
                  api.onEdit(ids, { start_offset_mm: mm }),
                )
              }
              onKeyDown={(e) =>
                e.key === "Enter" && (e.target as HTMLInputElement).blur()
              }
            />
          </label>
        </div>
        {bad && (
          <div className="angle-bad" role="alert">
            Type a length like 12&apos;-6&quot; or 3000 mm.
          </div>
        )}
        <div className="two">
          <label className="fld">
            <span className="fld-label">Slab edge</span>
            <select
              aria-label="slab edge side"
              value={side === MIXED ? MIXED : show(side)}
              onChange={(e) =>
                e.target.value !== MIXED &&
                api.onEdit(ids, {
                  slab_edge_side: (e.target.value || null) as
                    "left" | "right" | null,
                })
              }
            >
              {side === MIXED && <option value={MIXED}>{MIXED}</option>}
              <option value="">—</option>
              <option value="left">Left of beam</option>
              <option value="right">Right of beam</option>
            </select>
          </label>
          <label className="fld">
            <span className="fld-label">Vertical leg</span>
            <select
              aria-label="vertical leg"
              value={leg === MIXED ? MIXED : show(leg)}
              onChange={(e) =>
                e.target.value !== MIXED &&
                api.onEdit(ids, {
                  vertical_leg: (e.target.value || null) as
                    "long" | "short" | null,
                })
              }
            >
              {leg === MIXED && <option value={MIXED}>{MIXED}</option>}
              <option value="">—</option>
              <option value="long">Long leg</option>
              <option value="short">Short leg</option>
            </select>
          </label>
        </div>
        <GradeField api={api} />
        <button
          className="danger row"
          style={{ justifyContent: "center", gap: 6 }}
          data-testid="remove-angle"
          onClick={() => api.onRemove(ids)}
        >
          <Trash2 size={15} /> Remove
        </button>
      </div>
    </div>
  );
};

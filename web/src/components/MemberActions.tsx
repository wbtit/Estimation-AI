import React, { useEffect, useState } from "react";
import type { KindInfo, MemberView } from "../lib/types";

export interface LegendRow {
  id: string;
  mark: string;
  designation_raw: string;
  profile: string | null;
  remarks_raw: string | null;
  page_number: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number } | null;
}

const TYPES = ["beam", "column", "brace", "joist", "other"];

/** The fixing controls of the selected member. Each button is one saved action (before and after). */
export const MemberActions: React.FC<{
  member: MemberView;
  legend: LegendRow[];
  relinking: boolean;
  onConfirm: () => void;
  onDelete: () => void;
  onPick: (rank: number) => void;
  onRelink: () => void;
  onPatch: (patch: {
    profile_text?: string | null;
    mark?: string | null;
    level?: string | null;
    type?: string;
    length?: string | null;
    all_same_tag?: boolean;
  }) => void;
  /** The 36 kinds for the dropdown (main first, then misc, then not counted). */
  kinds: KindInfo[];
  onKind: (kind: string | null, allSameTag: boolean) => void;
  onConfirmKind: () => void;
  /** How many OTHER pieces share this piece's tag (mark), shown before the apply-to-all click. */
  sameTagCount: number;
  onLegend: (rowId: string) => void;
  onSharedLine: (resolution: "separate" | "merge") => void;
  onNotMember: (reason: string) => void;
  onExisting: (value: boolean) => void;
}> = ({
  member,
  legend,
  relinking,
  onConfirm,
  onDelete,
  onPick,
  onRelink,
  onPatch,
  onLegend,
  onSharedLine,
  onNotMember,
  onExisting,
  kinds,
  onKind,
  onConfirmKind,
  sameTagCount,
}) => {
  const [profile, setProfile] = useState(member.profile_raw ?? "");
  const [mark, setMark] = useState(member.mark ?? "");
  const [level, setLevel] = useState(member.level ?? "");
  useEffect(() => {
    setProfile(member.profile_raw ?? "");
    setMark(member.mark ?? "");
    setLevel(member.level ?? "");
  }, [member.id, member.profile_raw, member.mark, member.level]);

  const save = (
    field: "profile_text" | "mark" | "level",
    value: string,
    current: string | null,
  ) => {
    if (value.trim() !== (current ?? ""))
      onPatch({ [field]: value.trim() === "" ? null : value.trim() });
  };
  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    commit: () => void,
  ) => (
    <label className="field">
      {label}
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) =>
          e.key === "Enter" && (e.target as HTMLInputElement).blur()
        }
        aria-label={label}
      />
    </label>
  );

  return (
    <div className="actions">
      <div className="row">
        <button
          className="primary"
          onClick={onConfirm}
          disabled={member.status.confirmed}
        >
          Looks right (Enter)
        </button>
        <button onClick={onDelete}>Delete (Del)</button>
      </div>
      <div className="kind-box">
        <label className="field">
          kind
          <select
            value={member.kind.name ?? ""}
            onChange={(e) => onKind(e.target.value || null, false)}
            aria-label="kind"
          >
            <option value="">(no kind)</option>
            {(["main", "misc", "excluded"] as const).map((scope) => (
              <optgroup
                key={scope}
                label={
                  scope === "main"
                    ? "main steel"
                    : scope === "misc"
                      ? "misc (reserved, not computed)"
                      : "not counted"
                }
              >
                {kinds
                  .filter((k) => k.scope === scope)
                  .map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.kind}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="row">
          {member.kind.state === "guessed" && (
            <button onClick={onConfirmKind}>Kind is right</button>
          )}
          {sameTagCount > 0 && member.kind.name && (
            <button
              onClick={() => onKind(member.kind.name, true)}
              title="Sets this kind on this piece and on the other pieces with the same tag (mark) on this sheet, as one action"
            >
              Apply kind to all {sameTagCount + 1} pieces with this tag
            </button>
          )}
        </div>
      </div>
      {member.joist_series && (
        <div className="hint">
          Joist, {member.joist_series.series} series (kept as written, never
          matched to the AISC catalog).
        </div>
      )}
      {member.shared_line && (
        <div
          className={
            member.shared_line.resolved ? "shared-box" : "shared-box warn"
          }
        >
          {member.shared_line.size} members share this line
          {member.shared_line.resolved
            ? " (you said: separate members)"
            : ", probably different beams on one long line"}
          . Their pieces count. Lengths are added in Stage 2 (a shared line is
          the whole line, so its length will not be trusted).
          {member.shared_line.duplicate_of && (
            <div>
              This label looks like a duplicate of another label on the same
              line (same profile, labels at one spot). It is held out of the
              total until you decide.
            </div>
          )}
          {!member.shared_line.resolved && (
            <div className="row">
              <button onClick={() => onSharedLine("separate")}>
                Separate members
              </button>
              {member.shared_line.duplicate_of && (
                <button onClick={() => onSharedLine("merge")}>
                  Merge into the other label
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {member.type !== "column" && (
        <div className="row">
          {member.link.candidates.map((c) => (
            <button
              key={c.rank}
              className={c.rank === member.link.chosen_rank ? "chosen" : ""}
              onClick={() => onPick(c.rank)}
              title={`score ${c.score.toFixed(1)}`}
            >
              Line {c.rank}
            </button>
          ))}
          <button
            className={relinking ? "primary active" : ""}
            onClick={onRelink}
          >
            {relinking ? "Click the right line..." : "Other line (L)"}
          </button>
        </div>
      )}
      {field("profile text", profile, setProfile, () =>
        save("profile_text", profile, member.profile_raw),
      )}
      {sameTagCount > 0 && profile.trim() !== "" && (
        <button
          onClick={() =>
            onPatch({ profile_text: profile.trim(), all_same_tag: true })
          }
          title="Sets this size on this piece and on the other pieces with the same tag (mark) on this sheet, as one action"
        >
          Apply size to all {sameTagCount + 1} pieces with this tag
        </button>
      )}
      {field("mark", mark, setMark, () => save("mark", mark, member.mark))}
      {field("level", level, setLevel, () =>
        save("level", level, member.level),
      )}
      <button
        onClick={() => onExisting(!member.existing)}
        title="A real member that is already there: listed with its profile and length, not counted"
      >
        {member.existing
          ? "Not existing after all (undo)"
          : "Existing steel (listed, not counted)"}
      </button>
      <label className="field">
        not a member
        <select
          value=""
          onChange={(e) => e.target.value && onNotMember(e.target.value)}
          aria-label="not a member"
        >
          <option value="">choose a reason...</option>
          <option value="existing">existing steel</option>
          <option value="misc_steel">misc steel</option>
          <option value="detail">detail, not this plan</option>
          <option value="other">other</option>
        </select>
      </label>
      <label className="field">
        type
        <select
          value={member.type}
          onChange={(e) => onPatch({ type: e.target.value })}
          aria-label="member type"
        >
          {TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      {legend.length > 0 && (
        <div>
          <b>Legend rows for mark {member.mark}</b>
          <ul className="legend-rows">
            {legend.map((r) => (
              <li key={r.id}>
                <button
                  className={
                    member.mark_ref.legend_row_id === r.id ? "chosen" : ""
                  }
                  onClick={() => onLegend(r.id)}
                >
                  {r.designation_raw}
                  {r.remarks_raw ? ` (${r.remarks_raw})` : ""}{" "}
                  <small>page {r.page_number}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

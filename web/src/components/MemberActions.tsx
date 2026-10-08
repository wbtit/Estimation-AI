import React, { useEffect, useState } from "react";
import type { MemberView } from "../lib/types";

export interface LegendRow {
  id: string;
  mark: string;
  designation_raw: string;
  profile: string | null;
  remarks_raw: string | null;
  page_number: number;
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
  }) => void;
  onLegend: (rowId: string) => void;
  onSharedLine: (resolution: "separate" | "merge") => void;
  onNotMember: (reason: string) => void;
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
}) => {
  const [profile, setProfile] = useState(member.profile_raw ?? "");
  const [mark, setMark] = useState(member.mark ?? "");
  const [level, setLevel] = useState(member.level ?? "");
  const [length, setLength] = useState("");
  useEffect(() => {
    setProfile(member.profile_raw ?? "");
    setMark(member.mark ?? "");
    setLevel(member.level ?? "");
    setLength(
      member.length_source === "manual" ? (member.length_ft_in ?? "") : "",
    );
  }, [
    member.id,
    member.profile_raw,
    member.mark,
    member.level,
    member.length_source,
    member.length_ft_in,
  ]);

  const save = (
    field: "profile_text" | "mark" | "level" | "length",
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
          . Their pieces count; the length of this member is <b>not trusted</b>{" "}
          (it is the whole line)
          {member.length_shared ? "" : " (a typed length is trusted)"}.
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
      {field("mark", mark, setMark, () => save("mark", mark, member.mark))}
      {field("level", level, setLevel, () =>
        save("level", level, member.level),
      )}
      {member.type !== "column" &&
        field("typed length (e.g. 12'-6\")", length, setLength, () =>
          save(
            "length",
            length,
            member.length_source === "manual" ? member.length_ft_in : null,
          ),
        )}
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

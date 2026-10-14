import React, { useEffect, useState } from "react";
import { SheetNumber } from "./SheetNumber";
import type { Sheet, SheetFlags } from "../lib/types";

export const PAGE_TYPE_OPTIONS: [string, string][] = [
  ["framing_plan", "framing plan"],
  ["foundation_plan", "foundation plan"],
  ["elevation", "elevation"],
  ["detail", "detail"],
  ["schedule_legend", "schedule / legend"],
  ["general_notes", "general notes"],
  ["other", "other"],
];

export const SheetHeader: React.FC<{
  sheet: Sheet;
  onPageType: (value: string | null) => void;
  onLevel: (value: string | null) => void;
  unlinkedCount?: number;
  /** The unconfirmed guesses of this sheet (flags); one click confirms them all. */
  flags?: SheetFlags | null;
  onConfirmGuesses?: () => void;
  onTakeoff?: (value: "include" | "exclude" | null) => void;
  onTakeoffUndo?: () => void;
}> = ({
  sheet,
  onPageType,
  onLevel,
  unlinkedCount = 0,
  flags = null,
  onConfirmGuesses,
  onTakeoff,
  onTakeoffUndo,
}) => {
  const level = sheet.level?.effective ?? "";
  const [text, setText] = useState(level);
  useEffect(() => setText(level), [level, sheet.id]);
  const type = sheet.page_type;
  return (
    <div className="sheet-header">
      <span>
        Page <b>{sheet.page_number}</b>{" "}
        <SheetNumber
          value={sheet.sheet_number}
          flag={sheet.sheet_number_flag}
          earlier={sheet.sheet_number_old}
        />
      </span>
      <label>
        type{" "}
        <select
          value={type?.effective ?? "other"}
          onChange={(e) => onPageType(e.target.value)}
          aria-label="page type"
        >
          {PAGE_TYPE_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {type && !type.overridden && (
        <span className="hint" title={type.reason ?? ""}>
          guess: {type.reason ?? "no reason recorded"}
        </span>
      )}
      {type?.overridden && (
        <button
          onClick={() => onPageType(null)}
          title={`guess was ${type.guess}`}
        >
          reset to guess
        </button>
      )}
      <label>
        level{" "}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() =>
            text.trim() !== level &&
            onLevel(text.trim() === "" ? null : text.trim())
          }
          onKeyDown={(e) =>
            e.key === "Enter" && (e.target as HTMLInputElement).blur()
          }
          placeholder="level name"
          aria-label="level name"
        />
      </label>
      {sheet.level && !sheet.level.overridden && sheet.level.guess && (
        <span className="hint">(suggested)</span>
      )}
      {sheet.takeoff && onTakeoff && (
        <TakeoffDecision
          key={sheet.id}
          takeoff={sheet.takeoff}
          onDecide={onTakeoff}
          onUndo={onTakeoffUndo}
        />
      )}
      {flags && flags.flags.length > 0 && (
        <span className="decision warn" data-testid="sheet-flags">
          <b>Guesses:</b> {flags.flags.map((f) => f.text).join("; ")}{" "}
          {onConfirmGuesses && (
            <button className="primary" onClick={onConfirmGuesses}>
              These guesses are right
            </button>
          )}
        </span>
      )}
      {flags && flags.flags.length === 0 && flags.confirmed_by && (
        <span className="hint" data-testid="sheet-confirmed">
          guesses confirmed by {flags.confirmed_by}
        </span>
      )}
      {unlinkedCount > 0 && (
        <span className="warn" title="profile labels with no line near them">
          {unlinkedCount} unlinked labels on this sheet
        </span>
      )}
    </div>
  );
};

/**
 * The explicit decision of a sheet: include it in the takeoff or exclude it. The page type guess is
 * preselected as a GUESS, nothing counts until a person presses the button.
 */
const TakeoffDecision: React.FC<{
  takeoff: NonNullable<Sheet["takeoff"]>;
  onDecide: (value: "include" | "exclude" | null) => void;
  onUndo?: () => void;
}> = ({ takeoff, onDecide, onUndo }) => {
  const [choice, setChoice] = useState<"include" | "exclude">(
    takeoff.decision === "undecided" ? takeoff.suggestion : takeoff.decision,
  );
  const undecided = takeoff.decision === "undecided";
  return (
    <span className={undecided ? "decision warn" : "decision"}>
      <label>
        in the takeoff?{" "}
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value as "include" | "exclude")}
          aria-label="takeoff decision"
        >
          <option value="include">include</option>
          <option value="exclude">exclude</option>
        </select>
      </label>{" "}
      {undecided && (
        <small className="hint">
          no person decided: this sheet is{" "}
          {takeoff.included ? "in the totals" : "out of the totals"} by default
          ({takeoff.suggestion} is a guess from the page type)
        </small>
      )}
      {(undecided || choice !== takeoff.decision) && (
        <button className="primary" onClick={() => onDecide(choice)}>
          Decide: {choice}
        </button>
      )}
      {!undecided && choice === takeoff.decision && (
        <small>
          {takeoff.decision === "include" ? "in the takeoff" : "excluded"} (
          {takeoff.decided_by}
          {takeoff.decided_at
            ? `, ${takeoff.decided_at.slice(0, 16).replace("T", " ")}`
            : ""}
          )
        </small>
      )}
      {!undecided && onUndo && (
        <button onClick={onUndo} title="go back to the previous decision">
          Undo the decision
        </button>
      )}
    </span>
  );
};

import React from "react";
import type { FlagsResponse } from "../lib/types";

/** The state of the automatic pipeline and the draft label of the totals. */
export const PipelineBar: React.FC<{
  flags: FlagsResponse | null;
  running: boolean;
  onRerun: () => void;
  onConfirmExcluded: () => void;
}> = ({ flags, running, onRerun, onConfirmExcluded }) => {
  if (!flags && !running) return null;
  const d = flags?.draft;
  return (
    <div className="pipeline-bar" data-testid="pipeline-bar">
      {running && (
        <span className="pipeline-running" role="status">
          The system is reading the drawing and marking members...
        </span>
      )}
      {d && (
        <span
          className={d.reviewed ? "draft ok" : "draft"}
          data-testid="draft-label"
        >
          {d.label}
        </span>
      )}
      {d && !d.reviewed && (
        <small className="hint">
          {d.unconfirmed_included} included, {d.unconfirmed_excluded_by_default}{" "}
          excluded by default
        </small>
      )}
      {d && d.unconfirmed_excluded_by_default > 0 && (
        <button
          onClick={onConfirmExcluded}
          title="Say that every sheet the page type guess left out is really out of the takeoff"
        >
          Confirm all {d.unconfirmed_excluded_by_default} excluded sheets
        </button>
      )}
      <button onClick={onRerun} disabled={running}>
        Run again
      </button>
      {flags?.last_run?.status === "failed" && (
        <span className="error">
          the last run failed: {flags.last_run.error}
        </span>
      )}
    </div>
  );
};

import React, { useState } from "react";
import { send } from "../lib/api";

export interface SimilarPreview {
  example: { family: string; real_in: [number, number] };
  count: number;
  points: [number, number][];
  accepted: boolean;
  /** Phase 14d: the image search (FIND_SIMILAR_IMAGE): its run, sources and runtime */
  image?: boolean;
  run_id?: string | null;
  sources?: ("vector" | "image")[];
  runtime_s?: number | null;
}

/** Phase 14b/14d: after a column is placed, "Find similar" previews the symbols of the drawing with
 * the same shape and real size (a count first; a spinner while the search runs), then Accept adds
 * exactly the previewed ones as one undoable action (logged for training data) or Cancel leaves
 * the page as it is. */
export const FindSimilarBar: React.FC<{
  projectId: string;
  memberId: string;
  who: string;
  onDone: (created: number) => void;
  onClose: () => void;
  onError: (e: unknown) => void;
}> = ({ projectId, memberId, who, onDone, onClose, onError }) => {
  const [preview, setPreview] = useState<SimilarPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/projects/${projectId}/line-first/pieces/${memberId}/find-similar`;
  const run = (accept: boolean) => {
    setBusy(true);
    const body: Record<string, unknown> = { who, accept };
    if (accept && preview?.run_id) body.run_id = preview.run_id;
    send<SimilarPreview>("POST", url, body)
      .then((r) => {
        if (accept) onDone(r.accepted ? r.count : 0);
        else setPreview(r);
      }, onError)
      .finally(() => setBusy(false));
  };
  const size = preview
    ? preview.example.real_in.map((v) => Math.round(v * 10) / 10).join(" × ")
    : "";
  const byImage = preview?.sources?.filter((s) => s === "image").length ?? 0;
  return (
    <div className="find-similar" data-testid="find-similar">
      {busy && (
        <span className="spinner" data-testid="similar-spinner" role="status">
          <span className="spin" aria-hidden />
          Searching…
        </span>
      )}
      {!preview ? (
        <>
          {!busy && <span>Column placed.</span>}
          <button disabled={busy} onClick={() => run(false)}>
            Find similar
          </button>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </>
      ) : (
        <>
          <span data-testid="similar-count">
            {preview.count === 0
              ? "No similar symbols found"
              : `${preview.count} similar (${preview.example.family.replace(/_/g, " ")}, ${size} in)`}
            {preview.image && preview.count > 0 ? ` · ${byImage} by image` : ""}
          </span>
          {preview.count > 0 && (
            <button disabled={busy} onClick={() => run(true)}>
              Accept
            </button>
          )}
          <button className="link" onClick={onClose}>
            Cancel
          </button>
        </>
      )}
    </div>
  );
};

/** Phase 14d: on a built column-plan page with no columns, the click-first hint. */
export const ColumnHint: React.FC<{ text: string }> = ({ text }) => (
  <div className="find-similar column-hint" data-testid="column-hint">
    {text}
  </div>
);

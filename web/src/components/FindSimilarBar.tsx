import React, { useState } from "react";
import { send } from "../lib/api";

export interface SimilarPreview {
  example: { family: string; real_in: [number, number] };
  count: number;
  points: [number, number][];
  accepted: boolean;
}

/** Phase 14b: after a column is placed, "Find similar" previews the symbols of the drawing with
 * the same family and real size (a count first), then Accept adds them as one undoable action
 * (logged for training data) or Cancel leaves the page as it is. */
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
    send<SimilarPreview>("POST", url, { who, accept })
      .then((r) => {
        if (accept) onDone(r.accepted ? r.count : 0);
        else setPreview(r);
      }, onError)
      .finally(() => setBusy(false));
  };
  const size = preview
    ? preview.example.real_in.map((v) => Math.round(v * 10) / 10).join(" × ")
    : "";
  return (
    <div className="find-similar" data-testid="find-similar">
      {!preview ? (
        <>
          <span>Column placed.</span>
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

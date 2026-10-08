import React, { useState } from "react";
import type { ColumnInput } from "../lib/useMembers";

export const ColumnForm: React.FC<{
  viewId: string;
  point: { x: number; y: number };
  onSubmit: (input: ColumnInput) => Promise<void>;
  onCancel: () => void;
}> = ({ viewId, point, onSubmit, onCancel }) => {
  const [mark, setMark] = useState("");
  const [profile, setProfile] = useState("");
  const [base, setBase] = useState("");
  const [top, setTop] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="column-form panel"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        onSubmit({
          view_id: viewId,
          point,
          mark,
          profile_text: profile,
          base_elevation: base,
          top_elevation: top,
        })
          .then(onCancel)
          .catch(() => setBusy(false));
      }}
    >
      <h4>New column at the clicked point</h4>
      <label>
        mark{" "}
        <input
          value={mark}
          onChange={(e) => setMark(e.target.value)}
          autoFocus
          aria-label="column mark"
        />
      </label>
      <label>
        profile{" "}
        <input
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          placeholder="HSS6x6x3/8"
          aria-label="column profile"
        />
      </label>
      <label>
        base elevation{" "}
        <input
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder={`0'-0" or 0 mm`}
          aria-label="base elevation"
        />
      </label>
      <label>
        top elevation{" "}
        <input
          value={top}
          onChange={(e) => setTop(e.target.value)}
          placeholder={`12'-6"`}
          aria-label="top elevation"
        />
      </label>
      <p className="hint">
        Without both elevations the column has no length and stays red.
      </p>
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          Add column
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
};

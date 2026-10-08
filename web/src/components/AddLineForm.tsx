import React, { useEffect, useRef, useState } from "react";

export const AddLineForm: React.FC<{
  onSubmit: (input: {
    mark: string;
    profile_text: string;
    type: string;
  }) => Promise<void>;
  onCancel: () => void;
}> = ({ onSubmit, onCancel }) => {
  const [mark, setMark] = useState("");
  const [profile, setProfile] = useState("");
  const [type, setType] = useState("beam");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => first.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);
  return (
    <form
      className="column-form panel"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        onSubmit({ mark, profile_text: profile, type })
          .then(onCancel)
          .catch(() => setBusy(false));
      }}
    >
      <h4>New member on the clicked line</h4>
      <label>
        type{" "}
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="new member type"
        >
          {["beam", "brace", "joist", "other"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        profile{" "}
        <input
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          placeholder="W12x26"
          ref={first}
          autoFocus
          aria-label="new member profile"
        />
      </label>
      <label>
        mark{" "}
        <input
          value={mark}
          onChange={(e) => setMark(e.target.value)}
          aria-label="new member mark"
        />
      </label>
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          Add member
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
};

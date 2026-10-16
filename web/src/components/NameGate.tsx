import React, { useState } from "react";

/**
 * Asked once when the review screen opens (no password; there is no authentication yet). The name
 * is saved in this browser and sent with every change, which the server stores with the edit.
 */
export const NameGate: React.FC<{ onSubmit: (name: string) => void }> = ({
  onSubmit,
}) => {
  const [text, setText] = useState("");
  const ok = text.trim() !== "";
  return (
    <div className="name-gate" role="dialog" aria-label="who is reviewing">
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSubmit(text.trim());
        }}
      >
        <h3>Who is reviewing?</h3>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="your name"
          aria-label="enter your name to start"
        />{" "}
        <button type="submit" className="primary" disabled={!ok}>
          Start
        </button>
      </form>
    </div>
  );
};

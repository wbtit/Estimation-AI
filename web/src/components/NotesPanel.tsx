import React, { useMemo, useState } from "react";
import { highlight, searchLines } from "../lib/notes";
import type { NotesSheet } from "../lib/types";

export const NotesPanel: React.FC<{ sheets: NotesSheet[] }> = ({ sheets }) => {
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () =>
      sheets
        .map((s) => ({ ...s, lines: searchLines(s.lines, query) }))
        .filter((s) => s.lines.length > 0),
    [sheets, query],
  );
  return (
    <div className="panel">
      <h3>General notes</h3>
      <p className="hint">
        Text of the pages typed as general notes. Highlighted: steel grades,
        finishes, bolts. You read it; nothing is parsed into fields.
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="search the notes"
        aria-label="search the notes"
        className="wide"
      />
      {sheets.length === 0 && (
        <p className="hint">No page is typed as general notes.</p>
      )}
      {shown.map((s) => (
        <section key={s.sheet_id}>
          <h4>
            Page {s.page_number} {s.sheet_number ?? ""}
          </h4>
          {s.lines.map((l, i) => (
            <div key={i} className="note-line">
              {highlight(l.text).map((p, j) =>
                p.hit ? (
                  <mark key={j}>{p.text}</mark>
                ) : (
                  <React.Fragment key={j}>{p.text}</React.Fragment>
                ),
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
};

import React, { useCallback, useEffect, useState } from "react";
import { api, send } from "../lib/api";
import {
  FIELD_LABEL,
  FLAG_LABEL,
  SHOWN_FIELDS,
  flagText,
  sourceText,
  type DetailField,
  type ProjectDetails,
} from "../lib/project-details";

type Box4 = [number, number, number, number];

/** Phase 0 cover details: the project details of the cover page and title blocks, each with its
 * source (a click jumps to the box on the page), a confidence, an edit, and the drawing index check
 * (suggestions only). */
export const ProjectDetailsPanel: React.FC<{
  projectId: string;
  who: string;
  onJump: (
    pageIndex: number,
    box: Box4 | null,
    sheetId?: string | null,
  ) => void;
  onClose?: () => void;
  onChanged?: (msg: string) => void;
  onError: (e: unknown) => void;
}> = ({ projectId, who, onJump, onChanged, onError }) => {
  const [data, setData] = useState<ProjectDetails | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const base = `/api/projects/${projectId}/project-details`;

  const load = useCallback(
    () => void api<ProjectDetails>(base).then(setData).catch(onError),
    [base, onError],
  );
  useEffect(() => {
    load();
  }, [load]);

  const act = (p: Promise<unknown>, msg: string) =>
    void p
      .then(() => {
        onChanged?.(msg);
        load();
      })
      .catch(onError);

  const save = (f: DetailField) => {
    const v = text.trim();
    setEditing(null);
    if (v !== (f.value ?? ""))
      act(
        send("PUT", `${base}/${f.field}`, { value: v === "" ? null : v, who }),
        `${FIELD_LABEL[f.field]} saved (undo in the panel)`,
      );
  };

  if (!data)
    return <div className="details-panel" data-testid="details-panel" />;
  const shown = data.fields.filter((f) =>
    (SHOWN_FIELDS as readonly string[]).includes(f.field),
  );
  const found = shown.filter((f) => f.value !== null);
  return (
    <div className="details-panel" data-testid="details-panel">
      <div className="details-head">
        <span className="grow" />
        <button
          data-testid="details-reread"
          onClick={() =>
            act(
              send("POST", `${base}/read`, { who }),
              "Reading the cover and title blocks…",
            )
          }
        >
          {data.status === "not_read" ? "Read" : "Re-read"}
        </button>
        <button
          onClick={() => act(send("POST", `${base}/undo`, { who }), "Undone")}
        >
          Undo
        </button>
      </div>
      {data.status === "not_read" && (
        <div className="details-note" data-testid="details-not-read">
          Not read yet. Read takes the cover page (page 1, or the pages with the
          role "Cover / Title page") and the title blocks.
        </div>
      )}
      {data.status === "no_text" && (
        <div className="details-note" data-testid="details-no-text">
          No text on the cover page: the fields stay empty (outlined text cannot
          be read).
        </div>
      )}
      {data.read && (
        <div className="details-note">
          {found.length} fields found · cover page
          {data.read.cover_pages.length === 1 ? "" : "s"}{" "}
          {data.read.cover_pages.map((p) => p + 1).join(", ") || "—"}
        </div>
      )}
      <ul className="details-fields">
        {shown.map((f) => (
          <li key={f.field} data-testid={`field-${f.field}`}>
            <span className="details-label">{FIELD_LABEL[f.field]}</span>
            {editing === f.field ? (
              <input
                autoFocus
                aria-label={`edit ${f.field}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => save(f)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save(f);
                  if (e.key === "Escape") {
                    e.stopPropagation(); // cancels the edit; the drawer stays
                    setEditing(null);
                  }
                }}
              />
            ) : (
              <button
                className="details-value"
                title="Edit"
                onClick={() => {
                  setEditing(f.field);
                  setText(f.value ?? "");
                }}
              >
                {f.value ?? <span className="muted">— (not found)</span>}
              </button>
            )}
            {f.value !== null &&
              f.page_index !== null &&
              f.box &&
              !f.edited && (
                <button
                  className="chip grey"
                  data-testid={`source-${f.field}`}
                  title="Show the text on the page"
                  onClick={() => onJump(f.page_index!, f.box)}
                >
                  {sourceText(f)}
                </button>
              )}
            {f.edited && (
              <span className="chip grey" data-testid={`edited-${f.field}`}>
                edited by {f.edited_by}
              </span>
            )}
            {f.confidence && !f.edited && f.value !== null && (
              <span
                className={`chip ${f.confidence === "high" ? "green" : "amber"}`}
                data-testid={`confidence-${f.field}`}
                title={
                  f.field === "building_type"
                    ? "Suggested from words in the project name or cover text. Click the value to confirm or change it."
                    : undefined
                }
              >
                {f.field === "building_type" ? "suggested" : f.confidence}
              </span>
            )}
            {f.flags.includes("conflict") && (
              <span className="chip amber" data-testid={`conflict-${f.field}`}>
                conflict
              </span>
            )}
            {(f.field === "project_name" || f.field === "project_number") &&
              f.value && (
                <button
                  data-testid={`use-${f.field}`}
                  title={`Write this as the project ${f.field === "project_name" ? "name" : "number"}`}
                  onClick={() =>
                    act(
                      send("POST", `${base}/${f.field}/use-as-project`, {
                        who,
                      }),
                      `Used as the project ${f.field === "project_name" ? "name" : "number"}`,
                    )
                  }
                >
                  Use as project{" "}
                  {f.field === "project_name" ? "name" : "number"}
                </button>
              )}
            {(f.alternatives.length > 0 || f.agreement?.differ.length) && (
              <details>
                <summary>
                  {f.alternatives.length} other value
                  {f.alternatives.length === 1 ? "" : "s"}
                </summary>
                <ul>
                  {f.agreement?.differ.map((d, i) => (
                    <li key={`d${i}`}>
                      {d.value}{" "}
                      <span className="muted">· page {d.page_index + 1}</span>
                    </li>
                  ))}
                  {f.alternatives.map((a, i) => (
                    <li key={i}>
                      <button
                        className="link"
                        data-testid={`alt-${f.field}-${i}`}
                        onClick={() =>
                          act(
                            send("PUT", `${base}/${f.field}`, {
                              value: a.value,
                              who,
                              from_alternative: true,
                            }),
                            `${FIELD_LABEL[f.field]}: other value used`,
                          )
                        }
                      >
                        Use "{a.value}"
                      </button>{" "}
                      <button
                        className="link"
                        onClick={() => onJump(a.page_index, a.box)}
                      >
                        page {a.page_index + 1}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
      <div className="details-head">
        <b>Drawing index check</b>
        <span className="grow" />
        <button
          data-testid="index-recheck"
          onClick={() =>
            act(send("POST", `${base}/recheck`, { who }), "Checking the index…")
          }
        >
          Re-check
        </button>
      </div>
      {data.index.summary.rows === 0 ? (
        <div className="details-note" data-testid="index-none">
          No drawing index found on the cover or index pages.
        </div>
      ) : (
        <div className="details-note" data-testid="index-summary">
          {data.index.summary.matched} of {data.index.summary.rows} index rows
          matched to a page ({data.index.summary.percent}%). Suggestions only;
          nothing is changed.
        </div>
      )}
      <ul className="details-flags">
        {data.index.flags.map((fl) => (
          <li key={fl.id} data-testid={`flag-${fl.kind}`}>
            <b>{FLAG_LABEL[fl.kind] ?? fl.kind}</b> · {flagText(fl)}{" "}
            {fl.page_index !== null && (
              <button
                className="link"
                data-testid={`jump-${fl.kind}`}
                onClick={() => onJump(fl.page_index!, null, fl.sheet_id)}
              >
                {fl.sheet_id ? "go to page" : "go to the index"}{" "}
                {fl.page_index + 1}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

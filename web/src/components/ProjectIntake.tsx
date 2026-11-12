import React, { useEffect, useRef, useState } from "react";
import { api, ApiError, getWho, send } from "../lib/api";
import {
  INTAKE_FIELDS,
  intakePayload,
  type IntakeKey,
  type Project,
} from "../lib/lf";

/** What the details answer holds that the step needs: the reader's value of each field, whether a
 * person edited it before, and whether a read is still running. */
interface DetailsAnswer {
  status: "not_read" | "no_text" | "read";
  reading: boolean;
  fields: { field: string; read_value: string | null; edited: boolean }[];
}

const POLL_MS = 1500;
const POLL_MAX = 80; // ~2 minutes, then it stops waiting

/** The Project details step: exactly four fields (name, client, location, building type), outside the
 * workspace. The reader's suggestion is grey text in the field (never a typed value); a field with
 * none is empty. Save stores what is shown (suggestion where untouched, typed where typed, empty
 * where cleared) as person edits; Skip saves nothing. While the reader runs it says "reading…" and
 * fills the suggestions in when they are ready; typing and saving work meanwhile.
 *   mode "new":  right after an upload (the project name is the file's name until saved)
 *   mode "edit": from the project card (the saved values show as values) */
export const ProjectIntake: React.FC<{
  projectId: string;
  mode: "new" | "edit";
  onClose: (message?: string) => void;
}> = ({ projectId, mode, onClose }) => {
  const who = getWho();
  const [project, setProject] = useState<Project | null>(null);
  const [answer, setAnswer] = useState<DetailsAnswer | null>(null);
  // typed[key] === undefined: untouched; a string (maybe ""): the person typed or cleared it
  const [typed, setTyped] = useState<Partial<Record<IntakeKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);
  const [gaveUp, setGaveUp] = useState(false);

  // the project, then the reader: queue a read if none ran or runs, and poll until it is done
  useEffect(() => {
    let alive = true;
    let n = 0;
    const tick = async () => {
      try {
        const a = await api<DetailsAnswer>(
          `/api/projects/${projectId}/project-details`,
        );
        if (!alive) return;
        setAnswer(a);
        if (first.current) {
          first.current = false;
          if (a.status === "not_read" && !a.reading)
            await send(
              "POST",
              `/api/projects/${projectId}/project-details/read`,
              {
                who,
              },
            ).catch(() => undefined);
        }
        const waiting = a.reading || a.status === "not_read";
        if (waiting && alive) {
          if (++n < POLL_MAX) window.setTimeout(() => void tick(), POLL_MS);
          else setGaveUp(true); // the reader did not answer: stop saying "reading…"
        }
      } catch {
        if (alive && ++n < POLL_MAX)
          window.setTimeout(() => void tick(), POLL_MS);
      }
    };
    void api<Project>(`/api/projects/${projectId}`).then(
      (p) => alive && setProject(p),
      () => undefined,
    );
    void tick();
    return () => {
      alive = false;
    };
  }, [projectId]);

  const reading =
    !gaveUp && (!answer || answer.reading || answer.status === "not_read");
  const readValue = (read: string): string | null =>
    answer?.fields.find((f) => f.field === read)?.read_value ?? null;
  const editedBefore = (read: string) =>
    !!answer?.fields.find((f) => f.field === read)?.edited;
  const saved = (key: IntakeKey): string =>
    (key === "name" ? project?.name : project?.[key]) ?? "";

  // what each field shows: typed text; else (edit mode, or a field a person set before) the saved
  // value; else empty with the suggestion as grey text
  const suggestion = (key: IntakeKey, read: string): string | null => {
    if (mode === "edit" && (saved(key) || editedBefore(read))) return null;
    return readValue(read);
  };
  const shown = (key: IntakeKey, read: string): string => {
    if (typed[key] !== undefined) return typed[key]!;
    if (mode === "edit" && (saved(key) || editedBefore(read)))
      return saved(key);
    return "";
  };

  const save = async () => {
    const sug: Partial<Record<IntakeKey, string | null>> = {};
    const t: Partial<Record<IntakeKey, string>> = { ...typed };
    for (const f of INTAKE_FIELDS) {
      sug[f.key] = suggestion(f.key, f.read);
    }
    const body = intakePayload(t, sug);
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ saved: string[]; name_kept: boolean }>(
        "PUT",
        `/api/projects/${projectId}/details`,
        { who, ...body },
      );
      onClose(
        r.saved.length
          ? "Project details saved"
          : "Project details: nothing changed",
      );
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "could not save the details",
      );
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" role="dialog" aria-label="project details">
      <div className="modal intake" data-testid="intake">
        <h3>Project details</h3>
        <span className="muted">
          {mode === "new"
            ? "Grey text is a suggestion read from the drawings: Save keeps it, typing replaces it."
            : "Change what is saved; grey text is a suggestion for an empty field."}
        </span>
        {reading && (
          <span className="muted intake-reading" data-testid="intake-reading">
            reading…
          </span>
        )}
        {INTAKE_FIELDS.map((f) => {
          const sug = suggestion(f.key, f.read);
          return (
            <label key={f.key}>
              {f.label}
              <input
                aria-label={f.label.toLowerCase()}
                value={shown(f.key, f.read)}
                placeholder={sug ?? ""}
                data-suggested={sug ? "1" : undefined}
                onChange={(e) =>
                  setTyped((t) => ({ ...t, [f.key]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Escape") e.stopPropagation();
                }}
              />
              {f.key === "name" && mode === "new" && project && (
                <span className="muted intake-hint">
                  Now: {project.name}. Left empty, this name stays.
                </span>
              )}
            </label>
          );
        })}
        {error && (
          <div className="intake-error" role="alert">
            {error}
          </div>
        )}
        <div className="row">
          <span className="grow" />
          <button onClick={() => onClose()} disabled={busy}>
            {mode === "new" ? "Skip" : "Cancel"}
          </button>
          <button
            className="primary"
            onClick={() => void save()}
            disabled={busy}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

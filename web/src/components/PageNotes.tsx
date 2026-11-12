import React, { useEffect, useRef, useState } from "react";
import { api, ApiError, send } from "../lib/api";

export interface NoteState {
  note: string;
  version: number;
  updated_by: string | null;
  updated_at: string | null;
}

export const NOTE_DEBOUNCE_MS = 1000;

/** The notes box of one page: plain text, autosaved about 1 s after typing stops ("saving…" then
 * "saved"). Each save carries the version this person opened; if somebody saved a newer note in
 * between, nothing is overwritten: the box says who changed it and when, autosave pauses, and the
 * person chooses Keep mine (saves over it: last save wins) or Load theirs. */
export const PageNotesBox: React.FC<{
  projectId: string;
  sheetId: string;
  who: string;
  onHasNotes?: (has: boolean) => void;
  onClose?: () => void;
  debounceMs?: number;
}> = ({
  projectId,
  sheetId,
  who,
  onHasNotes,
  onClose,
  debounceMs = NOTE_DEBOUNCE_MS,
}) => {
  const url = `/api/projects/${projectId}/sheets/${sheetId}/notes`;
  const [text, setText] = useState("");
  const [status, setStatus] = useState<
    "loading" | "idle" | "saving" | "saved" | "conflict" | "error"
  >("loading");
  const [theirs, setTheirs] = useState<NoteState | null>(null);
  const textRef = useRef("");
  const version = useRef(0);
  const dirty = useRef(false);
  const paused = useRef(false); // a conflict is open: no autosave until the person chooses
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  const onHas = useRef(onHasNotes);
  onHas.current = onHasNotes;

  useEffect(() => {
    let alive = true;
    api<NoteState>(url).then(
      (r) => {
        if (!alive) return;
        version.current = r.version;
        textRef.current = r.note;
        setText(r.note);
        setStatus("idle");
      },
      () => alive && setStatus("error"),
    );
    return () => {
      alive = false;
    };
  }, [url]);

  const save = async (force = false) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current || (paused.current && !force)) return;
    const sent = textRef.current;
    inFlight.current = true;
    setStatus("saving");
    try {
      const r = await send<NoteState>("PUT", url, {
        who,
        note: sent,
        base_version: version.current,
        ...(force ? { force: true } : {}),
      });
      version.current = r.version;
      paused.current = false;
      setTheirs(null);
      onHas.current?.(r.note.trim() !== "");
      if (textRef.current === sent) {
        dirty.current = false;
        setStatus("saved");
      } else {
        // typed more while saving: save that too
        inFlight.current = false;
        schedule();
        return;
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        paused.current = true;
        try {
          setTheirs(await api<NoteState>(url));
        } catch {
          setTheirs(null);
        }
        setStatus("conflict");
      } else setStatus("error");
    }
    inFlight.current = false;
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const schedule = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveRef.current(), debounceMs);
  };

  // closing the box with a change not yet saved saves it now
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (dirty.current && !paused.current) void saveRef.current();
    },
    [],
  );

  return (
    <div className="page-notes" data-testid="page-notes">
      <textarea
        aria-label="page notes"
        rows={4}
        value={text}
        disabled={status === "loading"}
        placeholder="Notes for this page"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          textRef.current = e.target.value;
          setText(e.target.value);
          dirty.current = true;
          if (!paused.current) {
            setStatus("idle");
            schedule();
          }
        }}
      />
      <div
        className="notes-status muted"
        data-testid="notes-status"
        role="status"
      >
        {status === "saving" && "saving…"}
        {status === "saved" && "saved"}
        {status === "error" && "not saved: could not reach the server"}
        <span className="grow" />
        {onClose && (
          <button className="link" onClick={onClose} aria-label="close notes">
            Close
          </button>
        )}
      </div>
      {status === "conflict" && (
        <div
          className="notes-conflict"
          role="alert"
          data-testid="notes-conflict"
        >
          <span>
            This note was changed
            {theirs?.updated_by ? ` by ${theirs.updated_by}` : ""}
            {theirs?.updated_at
              ? ` at ${new Date(theirs.updated_at).toLocaleString()}`
              : ""}{" "}
            since you opened it.
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button onClick={() => void save(true)}>Keep mine</button>
            <button
              onClick={() => {
                if (!theirs) return;
                version.current = theirs.version;
                textRef.current = theirs.note;
                setText(theirs.note);
                dirty.current = false;
                paused.current = false;
                setTheirs(null);
                setStatus("saved");
                onHas.current?.(theirs.note.trim() !== "");
              }}
            >
              Load theirs
            </button>
          </span>
        </div>
      )}
    </div>
  );
};

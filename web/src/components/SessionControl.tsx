import React, { useCallback, useEffect, useState } from "react";
import { api, ApiError, send } from "../lib/api";
import {
  sessionText,
  timingCsvUrl,
  type Actor,
  type WorkSession,
} from "../lib/session";

/**
 * The header "Session" control: the current actor and short session id are always visible, or the
 * "No session: actions count as owner" state. Start asks owner or estimator; End closes it. Every
 * action row written while a session is open carries its actor and id (the database fills them).
 */
export const SessionControl: React.FC<{
  projectId: string;
  who: string;
  onError: (e: unknown) => void;
}> = ({ projectId, who, onError }) => {
  const [session, setSession] = useState<WorkSession | null>(null);
  const [all, setAll] = useState<WorkSession[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([
        api<{ session: WorkSession | null }>(
          `/api/projects/${projectId}/session`,
        ),
        api<{ sessions: WorkSession[] }>(`/api/projects/${projectId}/sessions`),
      ]).then(([s, l]) => {
        setSession(s.session);
        setAll(l.sessions);
      }, onError),
    [projectId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const start = (actor: Actor) =>
    send("POST", `/api/projects/${projectId}/session/start`, { actor, who })
      .then(load, (e: unknown) => {
        onError(e instanceof ApiError ? e : new Error("could not start"));
        return load();
      })
      .finally(() => setOpen(false));
  const end = () => {
    if (!window.confirm("End this session? Later actions count as owner."))
      return;
    void send("POST", `/api/projects/${projectId}/session/end`, { who })
      .then(load, onError)
      .finally(() => setOpen(false));
  };

  return (
    <span style={{ position: "relative" }}>
      <button
        className={`session-chip ${session ? `on ${session.actor}` : "off"}`}
        onClick={() => setOpen(!open)}
        aria-label="session"
        title={session ? `Session ${session.id}` : "Start a session"}
      >
        <span className="dot" aria-hidden />
        {sessionText(session)}
      </button>
      {open && (
        <div className="menu session-menu">
          {session ? (
            <>
              <a href={timingCsvUrl(session.id)}>
                <button>Timing (CSV)</button>
              </a>
              <button onClick={end}>End session</button>
            </>
          ) : (
            <>
              <button onClick={() => void start("estimator")}>
                Start estimator session
              </button>
              <button onClick={() => void start("owner")}>
                Start owner session
              </button>
            </>
          )}
          {all
            .filter((s) => s.ended_at)
            .slice(-5)
            .reverse()
            .map((s) => (
              <a key={s.id} href={timingCsvUrl(s.id)}>
                <button>
                  Timing CSV: {s.actor} · {s.short_id}
                </button>
              </a>
            ))}
        </div>
      )}
    </span>
  );
};

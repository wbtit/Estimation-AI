// Work sessions (migration 027): the header shows who the actions count for, and the workspace
// sends activity pings for the time per page.

export type Actor = "owner" | "estimator";

export interface WorkSession {
  id: string;
  short_id: string;
  actor: Actor;
  started_at: string;
  ended_at: string | null;
}

export const NO_SESSION_TEXT = "No session: actions count as owner";

/** The header text for the open session (or the no-session state). */
export function sessionText(s: WorkSession | null): string {
  if (!s) return NO_SESSION_TEXT;
  const who = s.actor === "estimator" ? "Estimator" : "Owner";
  return `${who} session · ${s.short_id}`;
}

export const PING_EVERY_MS = 30_000;

/** An 'active' ping is due when there was input since the last ping and 30 s have passed. */
export function pingDue(
  now: number,
  lastInput: number,
  lastPing: number,
  every = PING_EVERY_MS,
): boolean {
  return lastInput > lastPing && now - lastPing >= every;
}

export const timingCsvUrl = (sessionId: string) =>
  `/api/sessions/${sessionId}/timing.csv`;

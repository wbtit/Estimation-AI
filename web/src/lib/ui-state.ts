// Open / closed state of the panels, remembered per person in localStorage. Every read and write is
// wrapped: storage can be blocked (private window); the page then works with the defaults.
import { useCallback, useState } from "react";
import { getWho } from "./api";

const key = (name: string, who: string = getWho()): string =>
  `ui.${who || "anon"}.${name}`;

export function loadFlag(name: string, def: boolean, who?: string): boolean {
  try {
    const v = localStorage.getItem(key(name, who));
    return v === null ? def : v === "1";
  } catch {
    return def;
  }
}

export function saveFlag(name: string, value: boolean, who?: string): void {
  try {
    localStorage.setItem(key(name, who), value ? "1" : "0");
  } catch {
    // the state is then only kept while the page is open
  }
}

/** A boolean that is remembered per person: [value, set]. */
export function usePersistentFlag(
  name: string,
  def: boolean,
  who?: string,
): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => loadFlag(name, def, who));
  const set = useCallback(
    (next: boolean) => {
      setV(next);
      saveFlag(name, next, who);
    },
    [name, who],
  );
  return [v, set];
}

/** Which drawer is open (or none), remembered per person. */
export type DrawerName = "profile" | null;
export function loadDrawer(who?: string): DrawerName {
  try {
    const v = localStorage.getItem(key("drawer", who));
    return v === "profile" ? v : null;
  } catch {
    return null;
  }
}
export function saveDrawer(d: DrawerName, who?: string): void {
  try {
    localStorage.setItem(key("drawer", who), d ?? "");
  } catch {
    // not remembered
  }
}

/** The one side panel that is open next to the rail (or none), remembered per person. */
export type PanelName = "pages" | "members" | "profile" | null;
const PANELS = ["pages", "members", "profile"] as const; // (a stored "details" panel is gone: closed)
export function loadPanel(who?: string): PanelName {
  try {
    const v = localStorage.getItem(key("panel", who));
    if (v === null) {
      // before the rail: the old two-flag state ("left" open by default, and a drawer)
      const d = loadDrawer(who);
      return d ?? (loadFlag("left", true, who) ? "pages" : null);
    }
    return (PANELS as readonly string[]).includes(v) ? (v as PanelName) : null;
  } catch {
    return "pages";
  }
}
export function savePanel(p: PanelName, who?: string): void {
  try {
    localStorage.setItem(key("panel", who), p ?? "");
  } catch {
    // not remembered
  }
}

/** A small JSON value remembered per person (the floating inspector's position). */
export function loadJson<T>(name: string, def: T, who?: string): T {
  try {
    const v = localStorage.getItem(key(name, who));
    return v === null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
}
export function saveJson(name: string, value: unknown, who?: string): void {
  try {
    localStorage.setItem(key(name, who), JSON.stringify(value));
  } catch {
    // not remembered
  }
}

/** Where the floating inspector sits: pixels from the right and the top of the canvas area. */
export interface InspectorPos {
  right: number;
  top: number;
}
export const INSPECTOR_POS: InspectorPos = { right: 14, top: 60 };

// ---- resizable side panels -------------------------------------------------------------------
/** The narrowest a side panel gets (page cards and the inspector need this much) and the widest, as
 * a share of the window. */
export const PANEL_MIN = 280;
export const PANEL_MAX_FRAC = 0.45;
export const LEFT_DEFAULT = 320;
export const INSPECTOR_DEFAULT = 320;

/** The width a panel really gets in a window of `win` px: between PANEL_MIN and 45% of the window
 * (a window so small that 45% is under the minimum still gets the minimum). */
export function clampPanelWidth(w: number, win: number): number {
  const max = Math.max(PANEL_MIN, Math.floor(win * PANEL_MAX_FRAC));
  return Math.round(
    Math.min(Math.max(Number.isFinite(w) ? w : PANEL_MIN, PANEL_MIN), max),
  );
}
export const panelMax = (win: number): number =>
  Math.max(PANEL_MIN, Math.floor(win * PANEL_MAX_FRAC));

/** The remembered width of a panel (a number), else the default; a bad value is the default. */
export function loadWidth(name: string, def: number, who?: string): number {
  const v = loadJson<unknown>(name, def, who);
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}
export const saveWidth = (name: string, w: number, who?: string): void =>
  saveJson(name, Math.round(w), who);

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
export type DrawerName = "details" | "profile" | null;
export function loadDrawer(who?: string): DrawerName {
  try {
    const v = localStorage.getItem(key("drawer", who));
    return v === "details" || v === "profile" ? v : null;
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

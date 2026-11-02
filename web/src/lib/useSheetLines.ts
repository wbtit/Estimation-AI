// Phase 14f: the lines of a page (Pick beam, snapping). When a page has none yet (a project made
// before auto mode made them), the app asks the API to prepare them (one sheet_lines job; the API
// wakes the worker), shows "Preparing lines…" and polls until they are there. A raster page has no
// lines to prepare.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, send } from "./api";
import type { SheetLines } from "./lf";

export type LinesStatus = "idle" | "loading" | "preparing" | "ready" | "failed";

export const LINES_NOT_READY = "the lines of this page are not ready yet";
export const PREPARING_LINES = "Preparing lines…";

export interface SheetLinesOptions {
  /** Only vector pages have lines. */
  vector?: boolean;
  intervalMs?: number;
  /** Polls before giving up (then Retry). */
  maxTries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useSheetLines(
  projectId: string,
  sheetId: string | null,
  { vector = true, intervalMs = 2000, maxTries = 90 }: SheetLinesOptions = {},
) {
  const [lines, setLines] = useState<SheetLines | null>(null);
  const [status, setStatus] = useState<LinesStatus>("idle");
  const gen = useRef(0);

  const load = useCallback(
    async (prepare: boolean) => {
      const g = ++gen.current;
      const live = () => g === gen.current;
      setLines(null);
      if (!sheetId) {
        setStatus("idle");
        return;
      }
      const base = `/api/projects/${projectId}/sheets/${sheetId}`;
      const fetchLines = async (): Promise<SheetLines | null> => {
        try {
          return await api<SheetLines>(`${base}/lines`);
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }
      };
      setStatus("loading");
      try {
        const have = await fetchLines();
        if (!live()) return;
        if (have) {
          setLines(have);
          setStatus("ready");
          return;
        }
        if (!vector || !prepare) {
          setStatus("idle");
          return;
        }
        setStatus("preparing");
        await send("POST", `${base}/lines/prepare`);
        for (let i = 0; i < maxTries; i++) {
          const l = await fetchLines();
          if (!live()) return;
          if (l) {
            setLines(l);
            setStatus("ready");
            return;
          }
          await sleep(intervalMs);
          if (!live()) return;
        }
        setStatus("failed");
      } catch {
        if (live()) setStatus("failed");
      }
    },
    [projectId, sheetId, vector, intervalMs, maxTries],
  );

  useEffect(() => {
    void load(true);
    return () => {
      gen.current++; // a later answer for this page is ignored
    };
  }, [load]);

  /** Prepare (again) and poll: Retry, or a pick that found no lines. */
  const prepare = useCallback(() => load(true), [load]);

  return { lines, status, prepare };
}

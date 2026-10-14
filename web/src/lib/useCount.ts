import { useCallback, useEffect, useRef, useState } from "react";
import { api, send } from "./api";
import { DEFAULT_SETTINGS, type CountSettings } from "./count";
import type { LineRow, SnappedPoint } from "./snap";
import type { MemberView } from "./types";

export type LinesState = "idle" | "preparing" | "ready" | "error";

export interface ClickResult {
  member: MemberView;
  snap: {
    snapped: boolean;
    line: {
      id: number;
      p: [number, number];
      q: [number, number];
      class: string | null;
    } | null;
    distance_pt: number | null;
    radius_pt: number;
    lines_ready: boolean;
  };
  size: {
    profile_text: string | null;
    source: "linked_label" | "nearest_label" | "none";
  };
}

export interface MeasureResult {
  id?: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
  a_snap: SnappedPoint | null;
  b_snap: SnappedPoint | null;
  scale_ratio: number;
  length_mm: number;
  length_ft_in: string;
}

interface SheetLines {
  version: string;
  classes: string[];
  lines: LineRow[];
}

/** Count mode: settings, the sheet's lines (snap targets), clicks, decisions, redo and measurements. */
export function useCount(
  projectId: string | null,
  sheetId: string | null,
  who: string,
  onError: (err: unknown) => void,
  afterChange: () => Promise<void>,
) {
  const [settings, setSettings] = useState<CountSettings>(DEFAULT_SETTINGS);
  const [linesState, setLinesState] = useState<LinesState>("idle");
  const [lines, setLines] = useState<LineRow[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const cache = useRef(new Map<string, SheetLines>());
  const [last, setLast] = useState<ClickResult | null>(null);

  useEffect(() => {
    if (!projectId) return setSettings(DEFAULT_SETTINGS);
    api<CountSettings>(`/api/projects/${projectId}/count`)
      .then(setSettings)
      .catch(onError);
  }, [projectId, onError]);

  useEffect(() => {
    setLines([]);
    setClasses([]);
    setVersion(null);
    setLinesState("idle");
    setLast(null);
  }, [sheetId]);

  /** Ask the worker for the sheet's lines if needed and wait for them (up to about two minutes). */
  const ensureLines = useCallback(async () => {
    if (!projectId || !sheetId) return;
    const hit = cache.current.get(sheetId);
    if (hit) {
      setLines(hit.lines);
      setClasses(hit.classes);
      setVersion(hit.version);
      setLinesState("ready");
      return;
    }
    setLinesState("preparing");
    try {
      for (let i = 0; i < 120; i += 1) {
        const r = await send<{ status: string }>(
          "POST",
          `/api/projects/${projectId}/sheets/${sheetId}/lines/prepare`,
        );
        if (r.status === "ready") break;
        if (i === 119) throw new Error("the sheet's lines are not ready yet");
        await new Promise((res) => setTimeout(res, 1000));
      }
      const l = await api<SheetLines>(
        `/api/projects/${projectId}/sheets/${sheetId}/lines`,
      );
      cache.current.set(sheetId, l);
      setLines(l.lines);
      setClasses(l.classes);
      setVersion(l.version);
      setLinesState("ready");
    } catch (err) {
      setLinesState("error");
      onError(err);
    }
  }, [projectId, sheetId, onError]);

  const update = useCallback(
    async (body: Partial<CountSettings>) => {
      if (!projectId) return;
      try {
        setSettings(
          await send<CountSettings>("PUT", `/api/projects/${projectId}/count`, {
            who: who.trim(),
            ...body,
          }),
        );
        await afterChange();
      } catch (err) {
        onError(err);
      }
    },
    [projectId, who, onError, afterChange],
  );

  const place = useCallback(
    async (kind: string, x: number, y: number, snapLineId?: number) => {
      if (!projectId || !sheetId) return null;
      try {
        const r = await send<ClickResult>(
          "POST",
          `/api/projects/${projectId}/count/click`,
          {
            who: who.trim(),
            sheet_id: sheetId,
            kind,
            x,
            y,
            radius: settings.snap_radius_pt,
            label_radius: settings.label_radius_pt,
            // the line Tab walked to (the server checks it is among the ranked candidates)
            ...(snapLineId !== undefined && version
              ? { snap_choice: { line_id: snapLineId, version } }
              : {}),
          },
        );
        setLast(r);
        await afterChange();
        return r;
      } catch (err) {
        onError(err);
        return null;
      }
    },
    [projectId, sheetId, who, settings, version, onError, afterChange],
  );

  const decide = useCallback(
    async (memberId: string, decision: "accept" | "reject" | "reset") => {
      if (!projectId) return;
      try {
        await send(
          "POST",
          `/api/projects/${projectId}/members/${memberId}/count-decision`,
          { who: who.trim(), decision },
        );
        await afterChange();
      } catch (err) {
        onError(err);
      }
    },
    [projectId, who, onError, afterChange],
  );

  const redo = useCallback(async () => {
    if (!projectId) return;
    try {
      await send("POST", `/api/projects/${projectId}/redo`, {
        who: who.trim(),
      });
      await afterChange();
    } catch (err) {
      onError(err);
    }
  }, [projectId, who, onError, afterChange]);

  const preview = useCallback(
    async (a: { x: number; y: number }, b: { x: number; y: number }) => {
      if (!projectId || !sheetId) return null;
      try {
        return await send<MeasureResult>(
          "POST",
          `/api/projects/${projectId}/measure`,
          { sheet_id: sheetId, a, b },
        );
      } catch (err) {
        onError(err);
        return null;
      }
    },
    [projectId, sheetId, onError],
  );

  const saveMeasurement = useCallback(
    async (a: { x: number; y: number }, b: { x: number; y: number }) => {
      if (!projectId || !sheetId) return null;
      try {
        return await send<MeasureResult>(
          "POST",
          `/api/projects/${projectId}/measurements`,
          { who: who.trim(), sheet_id: sheetId, a, b },
        );
      } catch (err) {
        onError(err);
        return null;
      }
    },
    [projectId, sheetId, who, onError],
  );

  const attach = useCallback(
    async (memberId: string, measurementId: string) => {
      if (!projectId) return;
      try {
        await send(
          "POST",
          `/api/projects/${projectId}/members/${memberId}/attach-measurement`,
          { who: who.trim(), measurement_id: measurementId },
        );
        await afterChange();
      } catch (err) {
        onError(err);
      }
    },
    [projectId, who, onError, afterChange],
  );

  return {
    settings,
    update,
    linesState,
    lines,
    classes,
    ensureLines,
    place,
    decide,
    redo,
    preview,
    saveMeasurement,
    attach,
    last,
  };
}

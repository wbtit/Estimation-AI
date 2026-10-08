import { useCallback, useEffect, useState } from "react";
import { api, send } from "./api";
import type { MemberView } from "./types";

interface LinkStatus {
  job: {
    id: string;
    status: string;
    error: string | null;
    result: Record<string, number> | null;
  } | null;
}

export interface ColumnInput {
  view_id: string;
  point: { x: number; y: number };
  mark: string;
  profile_text: string;
  base_elevation: string;
  top_elevation: string;
}

/** Members of the open sheet with their colors; finds members for a view and adds columns. */
export function useMembers(
  projectId: string | null,
  sheetId: string | null,
  who: string,
  onError: (err: unknown) => void,
  onViewsChanged: () => Promise<void>,
) {
  const [members, setMembers] = useState<MemberView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyView, setBusyView] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !sheetId) return setMembers([]);
    const r = await api<{ members: MemberView[] }>(
      `/api/projects/${projectId}/members?sheet_id=${sheetId}`,
    );
    setMembers(r.members);
  }, [projectId, sheetId]);

  useEffect(() => {
    setSelectedId(null);
    load().catch(onError);
  }, [load, onError]);

  /** Queue the link job for a view and wait for it (the worker runs it in the background). */
  const find = useCallback(
    async (viewId: string, classes?: string[]) => {
      if (!projectId) return;
      setBusyView(viewId);
      try {
        if (classes) {
          await send("PATCH", `/api/projects/${projectId}/views/${viewId}`, {
            who: who.trim(),
            structural_classes: classes,
          });
        }
        await send("POST", `/api/projects/${projectId}/views/${viewId}/link`);
        for (let i = 0; i < 180; i += 1) {
          await new Promise((r) => setTimeout(r, 1000));
          const s = await api<LinkStatus>(
            `/api/projects/${projectId}/views/${viewId}/link-status`,
          );
          if (s.job?.status === "done" || s.job?.status === "completed") break;
          if (s.job?.status === "failed")
            throw new Error(s.job.error ?? "finding members failed");
        }
        await onViewsChanged();
        await load();
      } catch (err) {
        onError(err);
      } finally {
        setBusyView(null);
      }
    },
    [projectId, who, load, onError, onViewsChanged],
  );

  const addColumn = useCallback(
    async (input: ColumnInput) => {
      if (!projectId) return;
      try {
        const m = await send<MemberView>(
          "POST",
          `/api/projects/${projectId}/members`,
          {
            view_id: input.view_id,
            type: "column",
            point: input.point,
            mark: input.mark.trim() || null,
            profile_text: input.profile_text.trim() || null,
            base_elevation: input.base_elevation.trim() || null,
            top_elevation: input.top_elevation.trim() || null,
            who: who.trim(),
          },
        );
        await load();
        setSelectedId(m.id);
      } catch (err) {
        onError(err);
        throw err;
      }
    },
    [projectId, who, load, onError],
  );

  return {
    members,
    selectedId,
    setSelectedId,
    busyView,
    find,
    addColumn,
    reload: load,
  };
}

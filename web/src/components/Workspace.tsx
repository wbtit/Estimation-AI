import {
  ColumnHint,
  FindSimilarBar,
  previewMatches,
  type SimilarPreview,
} from "./FindSimilarBar";
import { shownAt, STRICTNESS_DEFAULT, toggle } from "../lib/similar";
import type { ColumnSymbols } from "../lib/column-snap";
import { toArray, type CaptureBox } from "../lib/capture";
import { ColumnCounts } from "./ColumnCounts";
import { COLUMN_HINT, showColumnHint } from "../lib/columns";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Download, House, PanelLeft, Save } from "lucide-react";
import { api, ApiError, send } from "../lib/api";
import { formatFtIn } from "../lib/ftin";
import { fullPageBox } from "../lib/tools";
import {
  activeView,
  ALL_LAYERS,
  loadDrawing,
  remainingIssues,
  saveDrawing,
  type Bom,
  type Box,
  type Layers,
  type LineFirstPage,
  type Page,
  type Piece,
  type Project,
  type Pt2,
  type RoleName,
  type Route,
} from "../lib/lf";
import { usePdf } from "../lib/usePdf";
import {
  LINES_NOT_READY,
  PREPARING_LINES,
  useSheetLines,
} from "../lib/useSheetLines";
import { BomTab } from "./BomTab";
import { Canvas, type PickMode, type Tool } from "./Canvas";
import { PageCard, type PageActions } from "./PageCard";
import { PropertiesPanel, type Kind, type PieceEdit } from "./PropertiesPanel";
import { ReportTab } from "./ReportTab";
import type { PerimeterApi } from "./PerimeterAngle";
import type { AngleOptions } from "../lib/perimeter-angle";
import type { ColumnHeightApi } from "../lib/column-height";
import { SessionControl } from "./SessionControl";
import { useTagRenumber } from "./TagRenumber";
import { pingDue } from "../lib/session";

type WsRoute = Extract<Route, { view: "workspace" }>;

/** What POST /undo says when it undid a view change. */
interface UndoneView {
  kind: "add" | "delete" | "box";
  applied: boolean;
  pieces_restored: number;
  pieces_removed: number;
}

/** The toast after undoing a view change. */
export function undoneViewText(v: UndoneView): string {
  if (!v.applied) return "Undone (the view had already changed)";
  if (v.kind === "add")
    return `View add undone${v.pieces_removed ? ` · ${v.pieces_removed} pieces removed` : ""}`;
  if (v.kind === "delete")
    return `View restored${v.pieces_restored ? ` with ${v.pieces_restored} pieces` : ""}`;
  return "View box put back";
}

/** "Jane Doe" -> "JD" (the avatar in the top bar). */
export const initials = (who: string): string =>
  who
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export const Workspace: React.FC<{
  who: string;
  route: WsRoute;
  go: (r: Route) => void;
}> = ({ who, route, go }) => {
  const { projectId, tab } = route;
  const { pdf } = usePdf(projectId);
  const [project, setProject] = useState<Project | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [data, setData] = useState<LineFirstPage | null>(null);
  const [bom, setBom] = useState<Bom | null>(null);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [angleOptions, setAngleOptions] = useState<AngleOptions | null>(null);
  const [defaultColumnHeight, setDefaultColumnHeight] = useState<number | null>(
    null,
  );
  const [roles, setRoles] = useState<RoleName[]>([]);
  const loadRoles = useCallback(
    () =>
      api<{ roles: RoleName[] }>("/api/role-names").then(
        (r) => setRoles(r.roles),
        () => undefined,
      ),
    [],
  );
  const [layers, setLayers] = useState<Layers>(ALL_LAYERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [left, setLeft] = useState<"pages" | "members">("pages");
  const [toast, setToast] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [memberFilter, setMemberFilter] = useState("");
  const [toolAsk, setToolAsk] = useState<
    { tool: Tool; n: number } | undefined
  >();
  const askTool = (tool: Tool) =>
    setToolAsk((t) => ({ tool, n: (t?.n ?? 0) + 1 }));
  const [viewId, setViewId] = useState<string | null>(null);
  // Phase 14b: the column just placed (the Find similar bar)
  const [lastColumn, setLastColumnRaw] = useState<string | null>(null);
  const lastColumnRef = useRef<string | null>(null);
  lastColumnRef.current = lastColumn;
  // Phase 14e: the Find similar preview the person corrects (strictness, unticked matches)
  const [simPreview, setSimPreview] = useState<SimilarPreview | null>(null);
  const [strictness, setStrictness] = useState(STRICTNESS_DEFAULT);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  // Phase 0-14g: how the last column was placed (Shift = no snap) and its pending arrow-key nudges
  const [placedNoSnap, setPlacedNoSnap] = useState(false);
  const [nudged, setNudged] = useState(0);
  const [nudgeOffset, setNudgeOffset] = useState<{
    dx: number;
    dy: number;
  } | null>(null);
  // Phase 0-column-capture: the capture box shown after a column is clicked (edited = a person moved it)
  const [capture, setCapture] = useState<{
    box: CaptureBox;
    edited: boolean;
  } | null>(null);
  const nudgeAcc = useRef<{ dx: number; dy: number; n: number } | null>(null);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setLastColumn = (id: string | null) => {
    setLastColumnRaw(id);
    setSimPreview(null);
    setStrictness(STRICTNESS_DEFAULT);
    setUnticked(new Set());
    nudgeAcc.current = null;
    setNudgeOffset(null);
    setNudged(0);
    if (id === null) setCapture(null);
  };

  const sheetId =
    route.sheetId ??
    pages.find((p) => p.setup.role !== null)?.id ??
    pages[0]?.id ??
    null;
  const page = pages.find((p) => p.id === sheetId) ?? null;
  // Phase 14f: the page's lines, prepared on open when the page has none yet
  const {
    lines,
    status: linesStatus,
    prepare: prepareLines,
  } = useSheetLines(projectId, sheetId ?? null, {
    vector: (page?.page_kind ?? "vector") === "vector",
  });
  // Phase 0-14g: the page's column symbols (the Draw column snap targets) and THE snap radius
  const [colSymbols, setColSymbols] = useState<ColumnSymbols | null>(null);
  const [symbolsTick, setSymbolsTick] = useState(0);
  const refreshSymbols = useCallback(() => setSymbolsTick((t) => t + 1), []);
  useEffect(() => {
    setColSymbols(null);
    if (!sheetId || (page?.page_kind ?? "vector") !== "vector") return;
    let live = true;
    api<ColumnSymbols>(
      `/api/projects/${projectId}/sheets/${sheetId}/column-symbols`,
    ).then(
      (r) => live && setColSymbols(r),
      () => undefined, // no symbols: the line snap stays
    );
    return () => {
      live = false;
    };
  }, [projectId, sheetId, symbolsTick, page?.page_kind]);
  // a pick that found no lines waits for them, then is sent again
  const pendingPickPt = React.useRef<{ p: Pt2; mode: PickMode } | null>(null);
  // Phase 14a: the drawing visibility is remembered per person and page
  const [drawing, setDrawingState] = useState(() => loadDrawing(who, sheetId));
  useEffect(() => setDrawingState(loadDrawing(who, sheetId)), [who, sheetId]);
  const setDrawing = (v: number) => {
    setDrawingState(v);
    saveDrawing(who, sheetId, v);
  };

  const say = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  };
  const fail = (e: unknown) =>
    say(e instanceof ApiError || e instanceof Error ? e.message : "failed");

  const loadPages = useCallback(
    () =>
      api<{ pages: Page[] }>(`/api/projects/${projectId}/pages`).then(
        (r) => setPages(r.pages),
        fail,
      ),
    [projectId],
  );
  const loadData = useCallback(() => {
    if (!sheetId) return Promise.resolve();
    return api<LineFirstPage>(
      `/api/projects/${projectId}/sheets/${sheetId}/line-first`,
    ).then(setData, fail);
  }, [projectId, sheetId]);
  const loadBom = useCallback(
    () =>
      api<Bom>(`/api/projects/${projectId}/line-first/bom`).then(
        setBom,
        () => undefined,
      ),
    [projectId],
  );
  const refresh = useCallback(
    () =>
      Promise.all([loadPages(), loadData(), loadBom()]).then(() => undefined),
    [loadPages, loadData, loadBom],
  );

  useEffect(() => {
    api<Project>(`/api/projects/${projectId}`).then(setProject, fail);
    api<{ kinds: Kind[] }>("/api/member-kinds").then(
      (r) => setKinds(r.kinds),
      () => undefined,
    );
    void loadPages();
    void loadBom();
    void loadRoles();
    api<AngleOptions>(
      `/api/projects/${projectId}/perimeter-angles/options`,
    ).then(setAngleOptions, () => undefined);
    api<{ default_height_mm: number | null }>(
      `/api/projects/${projectId}/column-height`,
    ).then(
      (r) => setDefaultColumnHeight(r.default_height_mm),
      () => undefined,
    );
  }, [projectId]);

  const pickPen = (p: Pt2, mode: PickMode) => {
    if (!page) return Promise.resolve();
    return send<{ pen_class: string }>(
      "POST",
      sheetUrl(page, "build-setup/pick-pen"),
      { x: p[0], y: p[1], mode, ...(view ? { view_id: view.id } : {}), who },
    ).then(
      () => {
        say(mode === "add" ? "Beam pen added" : "Beam pen picked");
        return refresh();
      },
      (e: unknown) => {
        // Phase 14f: no lines yet: prepare them and pick again when they are there
        if (e instanceof ApiError && e.message === LINES_NOT_READY) {
          pendingPickPt.current = { p, mode };
          say(PREPARING_LINES);
          if (linesStatus !== "preparing") void prepareLines();
          return;
        }
        fail(e);
      },
    );
  };
  useEffect(() => {
    if (linesStatus !== "ready" || !pendingPickPt.current) return;
    const { p, mode } = pendingPickPt.current;
    pendingPickPt.current = null;
    void pickPen(p, mode);
  }, [linesStatus]);

  // Phase 14f: "Pick a beam pen" from a page card: once the page is open, its view and the tool
  const pendingPick = React.useRef<{
    sheetId: string;
    viewId: string | null;
  } | null>(null);
  const applyPendingPick = () => {
    const want = pendingPick.current;
    if (!want) return;
    pendingPick.current = null;
    if (want.viewId) setViewId(want.viewId);
    askTool("pick");
  };
  useEffect(() => {
    if (pendingPick.current && data?.sheet_id === pendingPick.current.sheetId)
      applyPendingPick();
  }, [data]);

  // a page opened from Members by size: select its members once its pieces are in
  useEffect(() => {
    const want = pendingSelect.current;
    if (want && data?.sheet_id === want.sheetId) {
      setSelected(new Set(want.ids));
      pendingSelect.current = null;
    }
  }, [data]);

  useEffect(() => {
    setSelected(new Set());
    setData(null);
    setViewId(null);
    if (!sheetId) return;
    void loadData();
    void send("POST", `/api/projects/${projectId}/sheets/${sheetId}/view`, {
      who,
    }).catch(() => undefined);
  }, [projectId, sheetId, who, loadData]);

  // time per page (migration 027): 'active' pings while there is input on the page, 'leave' when
  // the page is left or the tab hidden; the open is the 'view' row above
  useEffect(() => {
    if (!sheetId) return;
    const url = `/api/projects/${projectId}/sheets/${sheetId}/page-event`;
    const ping = (kind: "active" | "leave") =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, who }),
        keepalive: true,
      }).catch(() => undefined);
    let lastInput = 0;
    let lastPing = Date.now(); // the open was just logged
    const input = () => {
      lastInput = Date.now();
    };
    const tick = window.setInterval(() => {
      const now = Date.now();
      if (pingDue(now, lastInput, lastPing)) {
        lastPing = now;
        void ping("active");
      }
    }, 5000);
    const hidden = () => {
      if (document.visibilityState === "hidden") void ping("leave");
      else input();
    };
    const kinds = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
    kinds.forEach((k) => window.addEventListener(k, input, { passive: true }));
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.clearInterval(tick);
      kinds.forEach((k) => window.removeEventListener(k, input));
      document.removeEventListener("visibilitychange", hidden);
      void ping("leave");
    };
  }, [projectId, sheetId, who]);

  // while a page builds, look again every two seconds
  const building = pages.some((p) => p.badge === "Building");
  useEffect(() => {
    if (!building) return;
    const t = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(t);
  }, [building, refresh]);

  const sheetUrl = (p: Page, rest: string) =>
    `/api/projects/${projectId}/sheets/${p.id}/${rest}`;
  const act = (promise: Promise<unknown>, done?: string) =>
    promise.then(() => {
      if (done) say(done);
      return refresh();
    }, fail);

  // Phase 0-14g: arrow keys nudge the column just placed (1 pt, Shift 5 pt) before Find similar.
  // The marker moves at once; the moves are summed and sent as ONE edit (with the count of
  // nudges, logged) after a short pause or when Find similar starts.
  const dataRef = useRef(data);
  dataRef.current = data;
  const flushNudges = useCallback(async (): Promise<void> => {
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = null;
    const acc = nudgeAcc.current;
    const id = lastColumnRef.current;
    nudgeAcc.current = null;
    if (!acc || !id) return;
    const base = dataRef.current?.pieces.find((p) => p.id === id)?.a;
    if (!base) {
      setNudgeOffset(null);
      return;
    }
    try {
      await send(
        "POST",
        `/api/projects/${projectId}/line-first/pieces/${id}/ends`,
        {
          who,
          a: [base[0] + acc.dx, base[1] + acc.dy],
          b: null,
          nudges: acc.n,
        },
      );
      setNudged((n) => n + acc.n);
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setNudgeOffset(null);
    }
  }, [projectId, who, refresh]);
  const nudgeColumn = (id: string, dx: number, dy: number) => {
    if (id !== lastColumnRef.current) return;
    const a = nudgeAcc.current ?? { dx: 0, dy: 0, n: 0 };
    a.dx += dx;
    a.dy += dy;
    a.n += 1;
    nudgeAcc.current = a;
    setNudgeOffset({ dx: a.dx, dy: a.dy });
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(() => void flushNudges(), 400);
  };
  // the marker shown with the pending nudge applied
  const shownData = useMemo(
    () =>
      data && nudgeOffset && lastColumn
        ? {
            ...data,
            pieces: data.pieces.map((p) =>
              p.id === lastColumn && p.a
                ? {
                    ...p,
                    a: [p.a[0] + nudgeOffset.dx, p.a[1] + nudgeOffset.dy] as [
                      number,
                      number,
                    ],
                  }
                : p,
            ),
          }
        : data,
    [data, nudgeOffset, lastColumn],
  );

  // Phase 14f: Renumber tags (one recorded action) and the check before an Excel export
  const bomXlsx = `/api/projects/${projectId}/line-first/bom.xlsx?who=${encodeURIComponent(who)}`;
  const reportXlsx = `/api/projects/${projectId}/report.xlsx?who=${encodeURIComponent(who)}`;
  const {
    startExport,
    askRenumber,
    dialog: tagDialog,
  } = useTagRenumber({
    projectId,
    who,
    say,
    fail,
    refresh,
  });

  const withView = (viewId: string | null) =>
    viewId ? { view_id: viewId } : {};
  /** "Reset crop to full page": the view's crop becomes the whole displayed page. The system's
   * suggested crop is only a starting point; Undo puts the old box back. */
  const resetFullPage = (p: Page, viewId: string | null) =>
    void act(
      send("POST", sheetUrl(p, "build-setup/crop"), {
        box: fullPageBox({ w: p.width_pt ?? 0, h: p.height_pt ?? 0 }),
        ...withView(viewId),
        who,
      }),
      "Crop reset to the full page (Undo puts it back)",
    );
  const actions: PageActions = {
    build: (p) =>
      act(
        send("POST", sheetUrl(p, "build"), { who, allow_system_values: true }),
        "Building…",
      ),
    setRole: (p, viewId, roleName) =>
      act(
        send("POST", sheetUrl(p, "build-setup/role"), {
          role_name: roleName,
          ...withView(viewId),
          who,
        }),
      ),
    createRole: (name, behaviour, p, viewId) =>
      act(
        send("POST", "/api/role-names", {
          name,
          behaviour,
          who,
          project_id: projectId,
          sheet_id: p.id,
        }).then(() =>
          send("POST", sheetUrl(p, "build-setup/role"), {
            role_name: name,
            ...withView(viewId),
            who,
          }),
        ),
        `Role "${name}" saved for every project`,
      ).then(loadRoles),
    editRole: (name, change) =>
      act(
        send("PATCH", `/api/role-names/${encodeURIComponent(name)}`, {
          ...change,
          who,
          project_id: projectId,
          ...(sheetId ? { sheet_id: sheetId } : {}),
        }),
      ).then(loadRoles),
    addView: () => askTool("view"),
    deleteView: (p, viewId) => {
      const v = p.views?.find((x) => x.id === viewId);
      const built = v?.counts.pieces ?? 0;
      if (built > 0) {
        const edited = pieces.filter(
          (x) => x.build_view_id === viewId && (x.edited || x.added),
        ).length;
        const msg =
          `Delete ${v?.name ?? "this view"}? Its ${built - edited} untouched built piece${built - edited === 1 ? "" : "s"} go with it` +
          (edited
            ? `; ${edited} piece${edited === 1 ? "" : "s"} you edited move to View 1.`
            : ".") +
          " Undo puts it all back.";
        if (!window.confirm(msg)) return;
      }
      void send<{ pieces_removed: number; pieces_kept: number }>(
        "DELETE",
        `/api/projects/${projectId}/sheets/${p.id}/build-views/${viewId}`,
        { who },
      )
        .then((r) => {
          say(
            `${v?.name ?? "View"} deleted · ${r.pieces_removed} piece${r.pieces_removed === 1 ? "" : "s"} removed` +
              (r.pieces_kept
                ? ` · ${r.pieces_kept} edited kept on View 1`
                : "") +
              " (Undo puts it back)",
          );
          setViewId(null);
          return refresh();
        })
        .catch(fail);
    },
    renameView: (p, viewId, name) =>
      act(
        send(
          "PATCH",
          `/api/projects/${projectId}/sheets/${p.id}/build-views/${viewId}`,
          { name, who },
        ),
      ),
    resetFullPage: (p, viewId) => resetFullPage(p, viewId),
    setNames: (p, change) =>
      act(send("PATCH", sheetUrl(p, "names"), { ...change, who }), "Saved"),
    editBox: (_p, viewId) => {
      setViewId(viewId);
      askTool("editBox");
    },
    resetBox: (p, viewId) => {
      const box = p.page_crop ?? {
        x0: 0,
        y0: 0,
        x1: p.width_pt ?? 0,
        y1: p.height_pt ?? 0,
      };
      void act(
        send("POST", sheetUrl(p, "build-setup/crop"), {
          box,
          view_id: viewId,
          who,
        }),
        "Box reset to the page crop (Undo puts it back)",
      );
    },
    setColumnPlan: (p, viewId, id) =>
      act(
        send("POST", sheetUrl(p, "build-setup/column-plan"), {
          sheet_id: id,
          ...withView(viewId),
          who,
        }),
      ),
    setTos: (p, viewId, mm, raw) =>
      act(
        send("POST", sheetUrl(p, "build-setup/tos"), {
          tos_mm: mm,
          raw,
          source: "typed",
          ...withView(viewId),
          who,
        }),
      ),
    noBeams: (p, viewId) =>
      act(
        send("POST", sheetUrl(p, "build-setup/no-beams"), {
          ...withView(viewId),
          who,
        }),
        "No beams: press ▶ to rebuild",
      ),
    // Phase 14f: from the red Pen chip: open the page (and view) with the Pick beam tool
    pickPen: (p, viewId) => {
      pendingPick.current = { sheetId: p.id, viewId };
      if (p.id !== sheetId) selectSheet(p.id);
      else if (data?.sheet_id === p.id) applyPendingPick();
    },
    setScale: (p, viewId, v) =>
      act(
        send("POST", sheetUrl(p, "build-setup/scale"), {
          ...v,
          ...withView(viewId),
          who,
        }).catch((e: unknown) => {
          // a scale as printed may carry more words than the parser reads: keep its ratio
          if (v.scale_text && e instanceof ApiError && e.status === 400) {
            const found = p.scales_found.find((s) => s.raw === v.scale_text);
            if (found?.ratio)
              return send("POST", sheetUrl(p, "build-setup/scale"), {
                ratio: found.ratio,
                ...withView(viewId),
                who,
              });
          }
          throw e;
        }),
      ),
  };

  const view = activeView(data?.views, viewId);
  const viewBody = view ? { view_id: view.id } : {};
  const viewUrl = (rest: string) =>
    `/api/projects/${projectId}/sheets/${sheetId}/build-views/${view?.id}/${rest}`;

  const pieces = data?.pieces ?? [];
  const selectedPieces = pieces.filter((p) => selected.has(p.id));
  const editSelected = (e: PieceEdit) =>
    act(
      send("POST", `/api/projects/${projectId}/line-first/pieces/edit`, {
        who,
        member_ids: [...selected],
        ...e,
      }),
      e.approved === true
        ? `${selected.size} approved (Undo takes it back)`
        : e.approved === false
          ? `${selected.size} unapproved`
          : undefined,
    );
  // Review 3 item 4: a column's height (its BOM length); one or many columns = one undoable action
  const columnHeight: ColumnHeightApi = {
    defaultMm: defaultColumnHeight,
    onSet: (ids, patch) =>
      void act(
        send("POST", `/api/projects/${projectId}/line-first/columns/height`, {
          who,
          member_ids: ids,
          ...patch,
        }),
        ids.length > 1
          ? `Height set on ${ids.length} columns (Undo takes it back)`
          : "Column height set (Undo takes it back)",
      ),
    onSetDefault: (mm) =>
      void send("POST", `/api/projects/${projectId}/column-height-default`, {
        who,
        height_mm: mm,
      }).then((r) => {
        setDefaultColumnHeight(
          (r as { default_height_mm: number | null }).default_height_mm,
        );
        say(
          mm === null
            ? "Default column height cleared"
            : "Default column height set",
        );
        return loadBom();
      }, fail),
  };
  // Phase 0 perimeter angle: every add / edit / remove is one recorded, undoable action
  const loadAngleOptions = () =>
    api<AngleOptions>(
      `/api/projects/${projectId}/perimeter-angles/options`,
    ).then(setAngleOptions, () => undefined);
  const perimeter: PerimeterApi = {
    options: angleOptions,
    pieces,
    onAdd: (beamIds, form) =>
      void act(
        send("POST", `/api/projects/${projectId}/line-first/perimeter-angles`, {
          who,
          beam_ids: beamIds,
          ...form,
        }).then(loadAngleOptions),
        `${beamIds.length} perimeter angle${beamIds.length === 1 ? "" : "s"} added (Undo takes ${beamIds.length === 1 ? "it" : "them"} back)`,
      ),
    onEdit: (ids, patch) =>
      void act(
        send(
          "POST",
          `/api/projects/${projectId}/line-first/perimeter-angles/edit`,
          { who, member_ids: ids, ...patch },
        ).then(loadAngleOptions),
      ),
    onSetGrade: (grade) =>
      void send("POST", `/api/projects/${projectId}/perimeter-angles/grade`, {
        who,
        grade,
      }).then(() => {
        say(
          grade === null
            ? "Grade of angles and bent plates back to the default (A36)"
            : `Grade of angles and bent plates set to ${grade}`,
        );
        return Promise.all([loadAngleOptions(), loadBom()]);
      }, fail),
    onSelect: (ids) => setSelected(new Set(ids)),
    onRemove: (ids) =>
      void act(
        send("POST", `/api/projects/${projectId}/line-first/pieces/delete`, {
          who,
          member_ids: ids,
        }),
        `${ids.length} removed (Undo puts ${ids.length === 1 ? "it" : "them"} back)`,
      ),
  };
  /** Save page; with red or orange members left, ask first (Approve all and save / Save only). */
  const [saveAsk, setSaveAsk] = useState<ReturnType<
    typeof remainingIssues
  > | null>(null);
  const savePage = (p: Page, approveIds: string[] = []) => {
    const approve = approveIds.length
      ? send("POST", `/api/projects/${projectId}/line-first/pieces/edit`, {
          who,
          member_ids: approveIds,
          approved: true,
        })
      : Promise.resolve();
    const left = approveIds.length ? 0 : remainingIssues(pieces).ids.length;
    setSaveAsk(null);
    void act(
      approve.then(() => send("POST", sheetUrl(p, "save-page"), { who })),
      `Page ${p.page_number} saved · ` +
        (approveIds.length ? `${approveIds.length} approved · ` : "") +
        `${left} issue${left === 1 ? "" : "s"} left`,
    );
  };
  /** Members by size, Project: open a page with the members of a size selected. */
  const pendingSelect = React.useRef<{ sheetId: string; ids: string[] } | null>(
    null,
  );
  const deleteSelected = () => {
    if (selected.size === 0) return;
    void act(
      send("POST", `/api/projects/${projectId}/line-first/pieces/delete`, {
        who,
        member_ids: [...selected],
      }),
      `${selected.size} deleted`,
    );
    setSelected(new Set());
  };

  const selectSheet = (id: string) =>
    go({ view: "workspace", projectId, tab: "plans", sheetId: id });
  const memberList = useMemo(() => {
    const t = memberFilter.trim().toUpperCase();
    return pieces
      .filter(
        (p) =>
          t === "" ||
          `${p.tag ?? ""} ${p.profile ?? ""}`.toUpperCase().includes(t),
      )
      .sort((a, b) =>
        (a.tag ?? "").localeCompare(b.tag ?? "", undefined, { numeric: true }),
      );
  }, [pieces, memberFilter]);

  return (
    <div className="workspace">
      <div className="topbar dark">
        <div className="side">
          <button
            className="icon"
            onClick={() => go({ view: "projects" })}
            aria-label="home"
            title="Projects"
          >
            <House size={18} />
          </button>
          <span className="project">
            <small>Project</small>
            <span className="brand">{project?.name ?? ""}</span>
          </span>
        </div>
        <div className="tabs">
          {(["plans", "bom", "report"] as const).map((t) => (
            <button
              key={t}
              className={tab === t ? "on" : ""}
              onClick={() =>
                go({
                  view: "workspace",
                  projectId,
                  tab: t,
                  sheetId: t === "plans" ? sheetId : null,
                })
              }
            >
              {t === "plans" ? "Plans" : t === "bom" ? "BOM" : "Report"}
            </button>
          ))}
        </div>
        <div className="side right">
          {tab === "plans" && page && linesStatus === "preparing" && (
            <span className="muted lines-status" data-testid="lines-status">
              {PREPARING_LINES}
            </span>
          )}
          {tab === "plans" && page && linesStatus === "failed" && (
            <span className="lines-status" data-testid="lines-status">
              Lines not ready{" "}
              <button className="link" onClick={() => void prepareLines()}>
                Retry
              </button>
            </span>
          )}
          {tab === "plans" && page && (
            <button
              className="primary row"
              style={{ gap: 6 }}
              onClick={() => {
                const left = remainingIssues(pieces);
                if (left.ids.length) setSaveAsk(left);
                else savePage(page);
              }}
            >
              <Save size={16} /> Save page
            </button>
          )}
          <span style={{ position: "relative" }}>
            <button
              className="icon"
              aria-label="export"
              title="Export"
              onClick={() => setExportOpen(!exportOpen)}
            >
              <Download size={18} />
            </button>
            {exportOpen && (
              <div className="menu" onClick={() => setExportOpen(false)}>
                <button onClick={() => void startExport(bomXlsx)}>
                  BOM (Excel)
                </button>
                <button onClick={() => void startExport(reportXlsx)}>
                  Report (Excel)
                </button>
                <button onClick={() => void askRenumber()}>
                  Renumber tags…
                </button>
                <a href={`/api/projects/${projectId}/answer-key.json`}>
                  <button>Answer key</button>
                </a>
              </div>
            )}
          </span>
          <SessionControl projectId={projectId} who={who} onError={fail} />
          <span className="avatar" title={who}>
            {initials(who)}
          </span>
        </div>
      </div>
      {tab === "bom" && (
        <BomTab
          bom={bom}
          projectId={projectId}
          who={who}
          onExport={() => void startExport(bomXlsx)}
        />
      )}
      {tab === "report" && <ReportTab projectId={projectId} who={who} />}
      {tab === "plans" && (
        <div className="ws-body">
          <div className="left dark">
            <div className="panel-head">
              <PanelLeft size={16} /> Navigation
            </div>
            <div className="seg">
              <button
                className={left === "pages" ? "on" : ""}
                onClick={() => setLeft("pages")}
              >
                Pages
              </button>
              <button
                className={left === "members" ? "on" : ""}
                onClick={() => setLeft("members")}
              >
                Members
              </button>
            </div>
            <div className="scroll">
              {left === "pages" && (
                <div className="page-list">
                  {pages.map((p) => (
                    <PageCard
                      key={p.id}
                      page={p}
                      columnPlans={pages.filter(
                        (c) => c.setup.role === "column_plan",
                      )}
                      selected={p.id === sheetId}
                      onSelect={() => selectSheet(p.id)}
                      actions={actions}
                      roles={roles}
                      activeViewId={
                        p.id === sheetId ? (view?.id ?? null) : null
                      }
                      onActiveView={setViewId}
                    />
                  ))}
                </div>
              )}
              {left === "members" && (
                <>
                  <div style={{ padding: "4px 12px 8px" }}>
                    <input
                      aria-label="filter members"
                      placeholder="Filter"
                      style={{ width: "100%" }}
                      value={memberFilter}
                      onChange={(e) => setMemberFilter(e.target.value)}
                    />
                  </div>
                  {memberList.map((p) => (
                    <div
                      key={p.id}
                      className={`member-row${selected.has(p.id) ? " on" : ""}`}
                      onClick={(e) =>
                        setSelected((s) => {
                          const n = new Set(e.shiftKey ? s : []);
                          n.add(p.id);
                          return n;
                        })
                      }
                    >
                      <b>{p.tag ?? "—"}</b>
                      <span
                        style={{
                          color: p.ignored ? "var(--muted)" : undefined,
                        }}
                      >
                        {p.profile ?? <i className="muted">no size</i>}
                      </span>
                      <span className="muted">{formatFtIn(p.length_mm)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
          {showColumnHint(page, pieces, !!lastColumn) && (
            <ColumnHint text={COLUMN_HINT} />
          )}
          {page && <ColumnCounts pieces={pieces} />}
          {page && lastColumn && (
            <FindSimilarBar
              key={lastColumn}
              projectId={projectId}
              memberId={lastColumn}
              who={who}
              preview={simPreview}
              snap={!(placedNoSnap || nudged > 0 || nudgeOffset !== null)}
              beforeSearch={flushNudges}
              box={capture?.edited ? toArray(capture.box) : null}
              onPreview={(p) => {
                // the column may have moved onto the ink's centre
                if (p.snap?.moved) void refresh();
                setSimPreview(p);
                setStrictness(p.strictness_default ?? STRICTNESS_DEFAULT);
              }}
              strictness={strictness}
              onStrictness={setStrictness}
              unticked={unticked}
              onDone={(n) => {
                setLastColumn(null);
                say(
                  n
                    ? `${n} similar columns added (Ctrl+Z undoes)`
                    : "Nothing added",
                );
                void refresh();
              }}
              onClose={() => setLastColumn(null)}
              onError={fail}
            />
          )}
          {page ? (
            <Canvas
              who={who}
              symbols={colSymbols}
              nudgeId={lastColumn}
              onNudge={nudgeColumn}
              onColumnTool={refreshSymbols}
              lastColumn={lastColumn}
              capture={capture}
              onCapture={(box, edited) => setCapture({ box, edited })}
              onRotate={(ids, by) =>
                void act(
                  send(
                    "POST",
                    `/api/projects/${projectId}/line-first/pieces/edit`,
                    {
                      who,
                      member_ids: ids,
                      ...by,
                    },
                  ),
                  ids.length === 1
                    ? "Rotated (Ctrl+Z undoes)"
                    : `${ids.length} columns rotated (Ctrl+Z undoes)`,
                )
              }
              similar={
                simPreview
                  ? {
                      matches: shownAt(previewMatches(simPreview), strictness),
                      unticked,
                      onToggle: (k) => setUnticked((u) => toggle(u, k)),
                      example: simPreview.example.rect
                        ? {
                            rect: simPreview.example.rect,
                            source: simPreview.example.source ?? "vector",
                          }
                        : null,
                    }
                  : null
              }
              pdf={pdf}
              page={page}
              data={shownData}
              lines={lines}
              layers={layers}
              onLayers={setLayers}
              selected={selected}
              onSelect={(ids, add) =>
                setSelected((s) => {
                  const n = new Set(add ? s : []);
                  for (const id of ids) {
                    if (add && n.has(id) && ids.length === 1) n.delete(id);
                    else n.add(id);
                  }
                  return n;
                })
              }
              pendingEdits={page.pending_edits}
              onCrop={(box: Box) =>
                void act(
                  send("POST", sheetUrl(page, "build-setup/crop"), {
                    box,
                    ...viewBody,
                    who,
                  }),
                )
              }
              onPick={(p: Pt2, mode: PickMode) => void pickPen(p, mode)}
              penNeedsConfirm={
                page?.views
                  ?.find((v) => v.id === view?.id)
                  ?.system_values.includes("pen_class") ?? false
              }
              onConfirmPen={() =>
                act(
                  send("POST", sheetUrl(page, "build-setup/confirm-pen"), {
                    ...(view ? { view_id: view.id } : {}),
                    who,
                  }),
                  "Beam pen confirmed",
                )
              }
              drawing={drawing}
              onDrawing={setDrawing}
              activeViewId={view?.id ?? null}
              onActiveView={setViewId}
              onRemovePen={(pen) =>
                void act(
                  send("POST", sheetUrl(page, "build-setup/remove-pen"), {
                    pen_class: pen,
                    ...viewBody,
                    who,
                  }),
                )
              }
              onToggleDeselect={(line, index) =>
                void act(
                  send("POST", viewUrl("deselections/toggle"), {
                    line,
                    line_index: index,
                    who,
                  }),
                )
              }
              onBoxDeselect={(ls) =>
                void act(
                  send("POST", viewUrl("deselections/box"), {
                    lines: ls.map((l) => ({
                      line: l.line,
                      line_index: l.index,
                    })),
                    who,
                  }),
                  `${ls.length} lines deselected`,
                )
              }
              onResetDeselect={() =>
                void act(send("POST", viewUrl("deselections/reset"), { who }))
              }
              onExclude={(box) =>
                void act(send("POST", viewUrl("exclusions"), { box, who }))
              }
              onDeleteExclusion={(id) =>
                void act(send("DELETE", viewUrl(`exclusions/${id}`), { who }))
              }
              onAcceptExclusions={(ids) =>
                void act(
                  send(
                    "POST",
                    viewUrl("exclusions/accept"),
                    ids === "all" ? { all: true, who } : { ids, who },
                  ),
                )
              }
              onSuggestExcludes={() =>
                void act(
                  send<{ suggested: number }>(
                    "POST",
                    viewUrl("exclusions/suggest"),
                    { who },
                  ).then((r) => {
                    say(
                      r.suggested
                        ? `${r.suggested} suggested: accept all or one by one`
                        : "Nothing to suggest",
                    );
                  }),
                )
              }
              onAddView={(box) =>
                void act(
                  send<{ id: string }>(
                    "POST",
                    `/api/projects/${projectId}/sheets/${page.id}/build-views`,
                    { box, who },
                  ).then((v) => setViewId(v.id)),
                  "View added: set its role and scale",
                )
              }
              onDraw={(kind, a, b, opts) =>
                void act(
                  send<Piece>("POST", sheetUrl(page, "line-first/pieces"), {
                    who,
                    kind,
                    a,
                    b,
                    ...(opts ?? {}),
                  }).then((pc) => {
                    // Phase 14b: a placed column offers Find similar
                    setLastColumn(pc.type === "column" ? pc.id : null);
                    // Phase 0-14g: a Shift placement stays where it was put
                    setPlacedNoSnap(opts?.snap?.source === "shift_off");
                  }),
                )
              }
              onEnds={(pc: Piece, a, b) =>
                void act(
                  send(
                    "POST",
                    `/api/projects/${projectId}/line-first/pieces/${pc.id}/ends`,
                    { who, a, b },
                  ),
                )
              }
              onUndo={() =>
                void send<{ view?: UndoneView }>(
                  "POST",
                  `/api/projects/${projectId}/undo`,
                  { who },
                )
                  .then((r) => {
                    say(r.view ? undoneViewText(r.view) : "Undone");
                    return refresh();
                  })
                  .catch(fail)
              }
              building={(page.views ?? []).some((v) => v.badge === "Building")}
              onApprove={() => void editSelected({ approved: true })}
              onDeleteSelected={deleteSelected}
              toolAsk={toolAsk}
            />
          ) : (
            <div className="center">
              <div className="empty">No pages yet</div>
            </div>
          )}
          <PropertiesPanel
            bomRows={bom?.rows ?? []}
            sheetId={sheetId}
            selected={selectedPieces}
            kinds={kinds}
            crop={view ? view.box : (data?.crop ?? page?.setup.crop ?? null)}
            onEdit={(e) => void editSelected(e)}
            onDelete={deleteSelected}
            perimeter={perimeter}
            columnHeight={columnHeight}
            onCropTool={() => askTool("crop")}
            onResetCrop={
              page ? () => resetFullPage(page, view?.id ?? null) : undefined
            }
            viewPieces={pieces.filter(
              (p) =>
                (p.build_view_id ?? data?.views?.[0]?.id ?? null) ===
                (view?.id ?? null),
            )}
            viewName={
              (data?.views?.length ?? 0) > 1 ? (view?.name ?? null) : null
            }
            onSelectPieces={(ids) => setSelected(new Set(ids))}
            onOpenPage={(id, ids) => {
              if (id === sheetId) {
                setSelected(new Set(ids));
                return;
              }
              pendingSelect.current = { sheetId: id, ids };
              selectSheet(id);
            }}
            pageName={(id) => {
              const pg = pages.find((x) => x.id === id);
              return pg
                ? `Page ${pg.page_number}${pg.sheet_number ? ` · ${pg.sheet_number}` : ""}`
                : "Page";
            }}
            onSetSizeAll={(ids, profile) =>
              void act(
                send(
                  "POST",
                  `/api/projects/${projectId}/line-first/pieces/edit`,
                  {
                    who,
                    member_ids: ids,
                    profile_text: profile,
                  },
                ),
                `${profile} set on ${ids.length} pieces (Undo puts them back)`,
              )
            }
          />
        </div>
      )}
      {saveAsk && page && (
        <div className="modal-back" onClick={() => setSaveAsk(null)}>
          <div
            className="modal"
            role="dialog"
            aria-label="save page"
            data-testid="save-ask"
            onClick={(e) => e.stopPropagation()}
          >
            <b>
              {saveAsk.red} red and {saveAsk.orange} orange left
            </b>
            <span className="muted">
              Approve them all as they are, or save the page with them left.
            </span>
            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setSaveAsk(null)}>Cancel</button>
              <button onClick={() => savePage(page)}>Save only</button>
              <button
                className="primary"
                onClick={() => savePage(page, saveAsk.ids)}
              >
                Approve all and save
              </button>
            </div>
          </div>
        </div>
      )}
      {tagDialog}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};

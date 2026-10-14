import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PageList } from "./components/PageList";
import { PageView } from "./components/PageView";
import { AddLineForm } from "./components/AddLineForm";
import { ClassPicker } from "./components/ClassPicker";
import { ColumnForm } from "./components/ColumnForm";
import { CountLayer, type MeasureDraft } from "./components/CountLayer";
import { CountPanel } from "./components/CountPanel";
import { PilotSwitch } from "./components/PilotSwitch";
import { PrefixKinds } from "./components/PrefixKinds";
import { LabelsPanel } from "./components/LabelsPanel";
import { MemberActions, type LegendRow } from "./components/MemberActions";
import { NameGate } from "./components/NameGate";
import { NewJob } from "./components/NewJob";
import { SymbolOverlay, type Highlight } from "./components/SymbolOverlay";
import { ExplanationPanel } from "./components/ExplanationPanel";
import { PipelineBar } from "./components/PipelineBar";
import { TablesPanel } from "./components/TablesPanel";
import { MembersPanel } from "./components/MembersPanel";
import { NotesPanel } from "./components/NotesPanel";
import { SheetHeader } from "./components/SheetHeader";
import { TakeoffPanel } from "./components/TakeoffPanel";
import { ViewsPanel } from "./components/ViewsPanel";
import { api, getWho, send, setWho } from "./lib/api";
import { fitZoom, normaliseBox, type Box, type Pt } from "./lib/geometry";
import {
  CATEGORY_COLOURS,
  countByCategory,
  labelsOf,
  type LabelCategory,
} from "./lib/labels";
import type {
  MemberView as MemberViewT,
  FlagsResponse,
  HistoryEdit,
  KindInfo,
  NotesSheet,
  Project,
  Sheet,
  SheetFlags,
  SheetView,
  TextItem,
} from "./lib/types";
import { applyFilters, NO_FILTERS, type Filters } from "./lib/symbols";
import { nearestLine, nextToReview, type Seg } from "./lib/pick";
import { useMembers } from "./lib/useMembers";
import { useCount } from "./lib/useCount";
import { countStateOf, kindOptions } from "./lib/count";
import {
  sameCandidates,
  snapCandidates,
  snapPoint,
  type LineRow,
  type SnapCandidate,
  type SnappedPoint,
} from "./lib/snap";
import { usePdf } from "./lib/usePdf";

const MIN_BOX_PT = 20;

/** Deep link: #p=<project id>&s=<page number> opens a project and page directly. */
function readHash(): { p: string | null; s: number | null } {
  const q = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const s = Number(q.get("s"));
  return { p: q.get("p"), s: Number.isInteger(s) && s > 0 ? s : null };
}

export const App: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const initial = useMemo(readHash, []);
  const [projectId, setProjectId] = useState<string | null>(initial.p);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [views, setViews] = useState<SheetView[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null);
  const [zoom, setZoom] = useState(0.4);
  const [who, setWhoState] = useState(getWho());
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<
    "views" | "members" | "tables" | "labels" | "notes" | "takeoff" | "count"
  >("members");
  const [rowIds, setRowIds] = useState<ReadonlySet<string>>(new Set());
  const [rowKeys, setRowKeys] = useState<ReadonlySet<string>>(new Set());
  const [addingColumn, setAddingColumn] = useState(false);
  const [addingBeam, setAddingBeam] = useState(false);
  const [pendingBeam, setPendingBeam] = useState<{
    viewId: string;
    point: Pt;
    line: Seg;
  } | null>(null);
  const [linkMode, setLinkMode] = useState<{
    memberId: string;
    lines: Seg[];
  } | null>(null);
  const [pickLines, setPickLines] = useState<Seg[]>([]);
  const [legend, setLegend] = useState<LegendRow[]>([]);
  // a pick click must not also select the member or view under it (pointerdown ends the mode before the click event)
  const pickedClick = useRef(false);
  // a takeoff row jump: open the sheet, then select the member once its sheet has loaded
  const jumpTo = useRef<string | null>(null);
  const [pendingColumn, setPendingColumn] = useState<{
    viewId: string;
    point: Pt;
  } | null>(null);
  const [items, setItems] = useState<TextItem[]>([]);
  const [visible, setVisible] = useState<Set<LabelCategory>>(
    new Set(["profile"]),
  );
  const [notes, setNotes] = useState<NotesSheet[]>([]);
  const { pdf, error: pdfError } = usePdf(projectId);
  const [kinds, setKinds] = useState<KindInfo[]>([]);
  const [flags, setFlags] = useState<FlagsResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [history, setHistory] = useState<HistoryEdit[]>([]);
  const [sameTag, setSameTag] = useState(0);
  const centerRef = useRef<HTMLElement>(null);
  // Phase 8: the counting copilot
  const [tool, setTool] = useState<"count" | "measure" | null>(null);
  const [countKind, setCountKind] = useState("");
  const [hover, setHover] = useState<Pt | null>(null);
  // the ranked snap candidates under the pointer and the one Tab has walked to (Phase 9)
  const [hoverCands, setHoverCands] = useState<SnapCandidate[]>([]);
  const [candIdx, setCandIdx] = useState(0);
  const hoverCandsRef = useRef<SnapCandidate[]>([]);
  const candIdxRef = useRef(0);
  const setCands = (c: SnapCandidate[], idx: number) => {
    hoverCandsRef.current = c;
    candIdxRef.current = idx;
    setHoverCands(c);
    setCandIdx(idx);
  };

  const [hoverSnap, setHoverSnap] = useState<SnappedPoint | null>(null);
  const [measure, setMeasure] = useState<MeasureDraft>({
    a: null,
    b: null,
    aSnap: null,
    bSnap: null,
    text: null,
  });
  const rawClicks = useRef<{ a: Pt | null; b: Pt | null }>({
    a: null,
    b: null,
  });
  const [savedMeasure, setSavedMeasure] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const hoverFrame = useRef<number | null>(null);

  const sheet = useMemo(
    () => sheets.find((s) => s.id === sheetId) ?? null,
    [sheets, sheetId],
  );
  const fail = useCallback(
    (err: unknown) =>
      setMessage(err instanceof Error ? err.message : String(err)),
    [],
  );

  useEffect(() => {
    api<{ projects: Project[] }>("/api/projects")
      .then((r) => setProjects(r.projects))
      .catch(fail);
  }, [fail]);

  useEffect(() => {
    api<{ kinds: KindInfo[] }>("/api/member-kinds")
      .then((r) => setKinds(r.kinds))
      .catch(fail);
  }, [fail]);

  useEffect(() => {
    setSheets([]);
    setSheetId(null);
    if (!projectId) return;
    api<{ sheets: Sheet[] }>(`/api/projects/${projectId}/sheets`)
      .then((r) => {
        setSheets(r.sheets);
        const wanted = initial.s
          ? r.sheets.find((x) => x.page_number === initial.s)
          : null;
        setSheetId((wanted ?? r.sheets[0])?.id ?? null);
      })
      .catch(fail);
  }, [projectId, fail, initial.s]);

  useEffect(() => {
    if (projectId && sheet) {
      window.history.replaceState(
        null,
        "",
        `#p=${projectId}&s=${sheet.page_number}`,
      );
    }
  }, [projectId, sheet]);

  const loadItems = useCallback(async () => {
    if (!projectId || !sheetId) return setItems([]);
    const r = await api<{ items: TextItem[] }>(
      `/api/projects/${projectId}/sheets/${sheetId}/text-items`,
    );
    setItems(r.items);
  }, [projectId, sheetId]);

  useEffect(() => {
    loadItems().catch(fail);
  }, [loadItems, fail]);

  const loadNotes = useCallback(async () => {
    if (!projectId) return setNotes([]);
    const r = await api<{ sheets: NotesSheet[] }>(
      `/api/projects/${projectId}/notes`,
    );
    setNotes(r.sheets);
  }, [projectId]);

  useEffect(() => {
    loadNotes().catch(fail);
  }, [loadNotes, fail, sheets]);

  const reloadSheets = useCallback(async () => {
    if (!projectId) return;
    const r = await api<{ sheets: Sheet[] }>(
      `/api/projects/${projectId}/sheets`,
    );
    setSheets(r.sheets);
  }, [projectId]);

  const override = async (
    field: "page-type" | "level" | "takeoff",
    value: string | null,
  ) => {
    const w = who.trim();
    if (!w)
      return setMessage(
        "Type your name at the top first (it is saved with every change).",
      );
    try {
      await send(
        "PATCH",
        `/api/projects/${projectId}/sheets/${sheetId}/${field}`,
        { value, editor: w },
      );
      await reloadSheets();
      setMessage(null);
    } catch (err) {
      fail(err);
    }
  };

  const undoTakeoff = async () => {
    const w = who.trim();
    if (!w) return setMessage("Type your name at the top first.");
    try {
      await send(
        "POST",
        `/api/projects/${projectId}/sheets/${sheetId}/takeoff/undo`,
        { editor: w },
      );
      await reloadSheets();
      setMessage(null);
    } catch (err) {
      fail(err);
    }
  };

  const labels = useMemo(() => labelsOf(items), [items]);
  const counts = useMemo(() => countByCategory(labels), [labels]);

  const loadViews = useCallback(async () => {
    if (!projectId || !sheetId) return setViews([]);
    const r = await api<{ views: SheetView[] }>(
      `/api/projects/${projectId}/sheets/${sheetId}/views`,
    );
    setViews(r.views);
  }, [projectId, sheetId]);

  useEffect(() => {
    setViewId(null);
    setDrawing(false);
    loadViews().catch(fail);
  }, [loadViews, fail]);

  // fit the page width the first time a sheet opens
  useEffect(() => {
    if (sheet?.page.width_pt)
      setZoom(
        fitZoom(sheet.page.width_pt, Math.max(600, window.innerWidth - 640)),
      );
  }, [sheet?.id, sheet?.page.width_pt]);

  const {
    members,
    selectedId: memberId,
    setSelectedId: setMemberId,
    busyView,
    find,
    showClasses,
    confirmClasses,
    addColumn,
    addOnLine,
    act,
    undo,
    reload: reloadMembers,
  } = useMembers(projectId, sheetId, who, fail, loadViews);

  // The pipeline runs by itself after the upload (flags, not gates): poll until it is finished,
  // then reload what it wrote.
  const loadFlags = useCallback(async () => {
    if (!projectId) return setFlags(null);
    setFlags(await api<FlagsResponse>(`/api/projects/${projectId}/flags`));
  }, [projectId]);
  const count = useCount(projectId, sheetId, who, fail, async () => {
    await Promise.all([reloadMembers(), loadFlags()]);
  });
  const hoverLine: LineRow | null =
    tool === "count" && hoverCands[candIdx]
      ? (count.lines[hoverCands[candIdx].index] as LineRow)
      : null;
  const project = projects.find((p) => p.id === projectId) ?? null;
  const scanning =
    !!project?.document && project.document.scan_status !== "done";
  const running =
    scanning ||
    flags?.last_run?.status === "pending" ||
    flags?.last_run?.status === "processing";
  useEffect(() => {
    loadFlags().catch(fail);
  }, [loadFlags, fail, sheets]);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!projectId || !running) {
      if (wasRunning.current) {
        wasRunning.current = false;
        void Promise.all([reloadSheets(), loadViews(), reloadMembers()]).catch(
          fail,
        );
      }
      return;
    }
    wasRunning.current = true;
    const t = window.setInterval(() => {
      api<{ projects: Project[] }>("/api/projects")
        .then((r) => setProjects(r.projects))
        .catch(fail);
      loadFlags().catch(fail);
    }, 3000);
    return () => window.clearInterval(t);
  }, [
    projectId,
    running,
    loadFlags,
    reloadSheets,
    loadViews,
    reloadMembers,
    fail,
  ]);

  const refreshAfterConfirm = async () => {
    await Promise.all([
      loadFlags(),
      reloadSheets(),
      loadViews(),
      reloadMembers(),
    ]);
  };
  const confirmGuesses = async () => {
    const w = requireWho();
    if (!w || !projectId || !sheetId) return;
    try {
      await send(
        "POST",
        `/api/projects/${projectId}/sheets/${sheetId}/confirm-guesses`,
        { who: w },
      );
      await refreshAfterConfirm();
      setMessage(null);
    } catch (err) {
      fail(err);
    }
  };
  const confirmExcluded = async () => {
    const w = requireWho();
    if (!w || !projectId) return;
    try {
      await send(
        "POST",
        `/api/projects/${projectId}/confirm-excluded-defaults`,
        { who: w },
      );
      await refreshAfterConfirm();
      setMessage(null);
    } catch (err) {
      fail(err);
    }
  };
  const rerun = async () => {
    if (!projectId) return;
    try {
      await send("POST", `/api/projects/${projectId}/auto-run`);
      await loadFlags();
    } catch (err) {
      fail(err);
    }
  };
  const flagsBySheet = useMemo(
    () =>
      new Map<string, SheetFlags>(
        (flags?.sheets ?? []).map((f) => [f.sheet_id, f]),
      ),
    [flags],
  );

  // what the explanation panel shows besides the member itself
  useEffect(() => {
    setHighlight(null);
    setHistory([]);
    setSameTag(0);
    if (!projectId || !memberId) return;
    api<{ edits: HistoryEdit[] }>(
      `/api/projects/${projectId}/members/${memberId}/history`,
    )
      .then((r) => setHistory(r.edits))
      .catch(() => setHistory([]));
    api<{ count: number }>(
      `/api/projects/${projectId}/members/${memberId}/same-tag`,
    )
      .then((r) => setSameTag(r.count))
      .catch(() => setSameTag(0));
  }, [projectId, memberId, members]);

  const jump = (h: Highlight | null) => {
    setHighlight(h);
    const el = centerRef.current;
    if (!h || !el) return;
    const b =
      h.box ??
      (h.line
        ? {
            x0: Math.min(h.line[0], h.line[2]),
            y0: Math.min(h.line[1], h.line[3]),
            x1: Math.max(h.line[0], h.line[2]),
            y1: Math.max(h.line[1], h.line[3]),
          }
        : null);
    if (!b) return;
    el.scrollTo?.({
      left: ((b.x0 + b.x1) / 2) * zoom - el.clientWidth / 2,
      top: ((b.y0 + b.y1) / 2) * zoom - el.clientHeight / 2,
      behavior: "smooth",
    });
  };
  const gotoPage = (pageNumber: number) => {
    const target = sheets.find((x) => x.page_number === pageNumber);
    if (target) setSheetId(target.id);
  };
  const shownMembers = useMemo(
    () => applyFilters(members, filters, flags?.last_run?.started_at ?? null),
    [members, filters, flags],
  );

  useEffect(() => {
    const id = jumpTo.current;
    if (id && members.some((m) => m.id === id)) {
      jumpTo.current = null;
      setMemberId(id);
    }
  }, [members, setMemberId]);

  const selectedMember =
    members.find((m) => m.id === memberId && !m.deleted) ?? null;

  useEffect(() => {
    if (!projectId || !selectedMember?.mark) {
      setLegend([]);
      return;
    }
    api<{ rows: LegendRow[] }>(
      `/api/projects/${projectId}/legend?mark=${encodeURIComponent(selectedMember.mark)}`,
    )
      .then((r) => setLegend(r.rows))
      .catch(() => setLegend([]));
  }, [projectId, selectedMember?.mark, selectedMember?.id]);

  const loadLines = useCallback(
    async (id: string): Promise<Seg[]> => {
      const r = await api<{ lines: Seg[] }>(
        `/api/projects/${projectId}/views/${id}/lines`,
      );
      return r.lines;
    },
    [projectId],
  );

  const startRelink = useCallback(async () => {
    if (!selectedMember?.view_id) return;
    if (linkMode) return setLinkMode(null);
    try {
      const lines = await loadLines(selectedMember.view_id);
      setPickLines(lines);
      setLinkMode({ memberId: selectedMember.id, lines });
      setAddingBeam(false);
      setAddingColumn(false);
      setDrawing(false);
    } catch (err) {
      fail(err);
    }
  }, [selectedMember, linkMode, loadLines, fail]);

  const requireWho = (): string | null => {
    if (who.trim() === "") {
      setMessage(
        "Type your name at the top first (it is saved with every change).",
      );
      return null;
    }
    return who.trim();
  };

  // ---- Phase 8: count and measure tools -----------------------------------------------------
  const resetMeasure = useCallback(() => {
    setMeasure({ a: null, b: null, aSnap: null, bSnap: null, text: null });
    rawClicks.current = { a: null, b: null };
    setSavedMeasure(null);
  }, []);

  // the pilot switch: the counting copilot is on or off per project (default off)
  const pilot = count.settings.count_mode;
  useEffect(() => {
    if (tab === "count" && !pilot) setTab("members");
  }, [tab, pilot]);
  const setPilot = (on: boolean) => {
    if (!requireWho()) return;
    if (
      on &&
      !window.confirm(
        "Turn the counting copilot on for this project? Totals, tables and the Excel will then count confirmed pieces only (a click or an accepted suggestion). You can turn it off again.",
      )
    ) {
      return;
    }
    if (!on) {
      setTool(null);
      setCands([], 0);
      setHover(null);
      setHoverSnap(null);
      if (tab === "count") setTab("members");
    }
    void count.update({ count_mode: on });
  };

  const selectTool = (t: "count" | "measure" | null) => {
    if (t && !pilot) {
      setMessage("Turn the pilot on (top bar) to use the counting tools.");
      return;
    }
    if (t && !requireWho()) return;
    setTool(t);
    setHover(null);
    setCands([], 0);
    setHoverSnap(null);
    resetMeasure();
    if (t) {
      setDrawing(false);
      setAddingColumn(false);
      setAddingBeam(false);
      setLinkMode(null);
      setTab("count");
      void count.ensureLines();
    }
  };

  // the kind to count: the first main kind of the list until a person chooses another
  useEffect(() => {
    if (!countKind && kinds.length > 0) {
      const first =
        kindOptions(kinds).find((k) => k.kind === "Beams") ??
        kindOptions(kinds)[0];
      if (first) setCountKind(first.kind);
    }
  }, [kinds, countKind]);

  const updateHover = (p: Pt) => {
    if (!tool) return;
    if (hoverFrame.current !== null) return;
    hoverFrame.current = window.requestAnimationFrame(() => {
      hoverFrame.current = null;
      setHover(p);
      if (tool === "count") {
        const cands = snapCandidates(
          count.lines,
          count.classes,
          p.x,
          p.y,
          count.settings.snap_radius_pt,
        );
        // the same candidates as a moment ago keep the line Tab walked to; new ones start at the best
        setCands(
          cands,
          sameCandidates(cands, hoverCandsRef.current) ? candIdxRef.current : 0,
        );
      } else {
        setHoverSnap(snapPoint(count.lines, p.x, p.y, 12));
      }
    });
  };

  const measureClick = async (p: Pt) => {
    if (rawClicks.current.a && !rawClicks.current.b) {
      rawClicks.current.b = p;
      const r = await count.preview(rawClicks.current.a, p);
      if (!r) return resetMeasure();
      setMeasure({
        a: r.a,
        b: r.b,
        aSnap: r.a_snap,
        bSnap: r.b_snap,
        text: `${r.length_ft_in} (${Math.round(r.length_mm)} mm)`,
      });
      return;
    }
    // first click (or a new measurement after a finished one)
    resetMeasure();
    rawClicks.current = { a: p, b: null };
    const sn = snapPoint(count.lines, p.x, p.y, 12);
    setMeasure({
      a: sn ? { x: sn.x, y: sn.y } : p,
      b: null,
      aSnap: sn,
      bSnap: null,
      text: null,
    });
  };

  const saveMeasure = async () => {
    const { a, b } = rawClicks.current;
    if (!a || !b) return;
    const r = await count.saveMeasurement(a, b);
    if (r?.id)
      setSavedMeasure({
        id: r.id,
        text: `${r.length_ft_in}, ${Math.round(r.length_mm)} mm`,
      });
  };

  const symbolClick = (m: MemberViewT, e: React.MouseEvent) => {
    if (
      tool === "count" &&
      m.origin === "extracted" &&
      countStateOf(m) === "suggested"
    ) {
      e.stopPropagation();
      if (!requireWho()) return;
      void count.decide(m.id, e.shiftKey ? "reject" : "accept");
      return;
    }
    if (pickedClick.current) return;
    setMemberId(m.id);
    setTab(tool ? "count" : "members");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const w = who.trim();
      const needName = () => {
        setMessage(
          "Type your name at the top first (it is saved with every change).",
        );
      };
      if (e.key === "Escape") {
        setTool(null);
        setHover(null);
        setCands([], 0);
        setHoverSnap(null);
        resetMeasure();
        setDrawing(false);
        setAddingColumn(false);
        setAddingBeam(false);
        setPendingColumn(null);
        setPendingBeam(null);
        setLinkMode(null);
        setPickLines([]);
        setDrag(null);
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" ||
          (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        e.preventDefault();
        if (!w) return needName();
        void count.redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (!w) return needName();
        void undo();
        return;
      }
      if (
        e.key === "Tab" &&
        tool === "count" &&
        hoverCandsRef.current.length > 1
      ) {
        // walk to the next (Shift+Tab: previous) snap candidate before the click is confirmed
        e.preventDefault();
        const n = hoverCandsRef.current.length;
        setCands(
          hoverCandsRef.current,
          (candIdxRef.current + (e.shiftKey ? n - 1 : 1)) % n,
        );
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "k") {
        selectTool(tool === "count" ? null : "count");
      } else if (e.key === "m") {
        selectTool(tool === "measure" ? null : "measure");
      } else if (e.key === "v") {
        setAddingColumn(false);
        setAddingBeam(false);
        setLinkMode(null);
        setDrawing((d) => !d);
      } else if (e.key === "c") {
        setDrawing(false);
        setAddingBeam(false);
        setLinkMode(null);
        setTab("members");
        setAddingColumn((a) => !a);
      } else if (e.key === "b") {
        const v = views.find((x) => x.id === viewId) ?? views[0];
        if (!v) return setMessage("Draw a view first.");
        setDrawing(false);
        setAddingColumn(false);
        setLinkMode(null);
        setTab("members");
        loadLines(v.id)
          .then((lines) => {
            setPickLines(lines);
            setAddingBeam((a) => !a);
          })
          .catch(fail);
      } else if (e.key === "u") {
        if (!w) return needName();
        void undo();
      } else if (e.key === "n") {
        setTab("members");
        setMemberId(nextToReview(members, memberId));
      } else if (selectedMember) {
        if (!w) {
          if (["Enter", "Delete", "1", "2", "3", "l"].includes(e.key))
            needName();
          return;
        }
        if (e.key === "Enter") {
          if (!selectedMember.status.confirmed)
            void act(selectedMember.id, "/confirm", "POST");
        } else if (e.key === "Delete" || e.key === "Backspace") {
          void act(selectedMember.id, "/delete", "POST");
        } else if (["1", "2", "3"].includes(e.key)) {
          const rank = Number(e.key);
          if (selectedMember.link.candidates.some((c) => c.rank === rank))
            void act(selectedMember.id, "/link", "POST", { rank });
        } else if (e.key === "l") {
          void startRelink();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    who,
    views,
    viewId,
    members,
    memberId,
    selectedMember,
    act,
    undo,
    startRelink,
    loadLines,
    fail,
    setMemberId,
    tool,
    count,
    resetMeasure,
  ]);

  const createView = async (box: Box) => {
    const w = requireWho();
    if (!w || !projectId || !sheetId) return;
    try {
      const v = await send<SheetView>(
        "POST",
        `/api/projects/${projectId}/sheets/${sheetId}/views`,
        {
          box,
          who: w,
        },
      );
      await loadViews();
      setViewId(v.id);
      setMessage(null);
    } catch (err) {
      fail(err);
    }
  };

  const createWholeSheet = async () => {
    const w = requireWho();
    if (!w || !projectId || !sheetId) return;
    try {
      const v = await send<SheetView>(
        "POST",
        `/api/projects/${projectId}/sheets/${sheetId}/views`,
        { whole_sheet: true, who: w },
      );
      await loadViews();
      setViewId(v.id);
      setMessage(null);
    } catch (err) {
      fail(err);
    }
  };

  const patchView = async (id: string, body: object) => {
    const w = requireWho();
    if (!w || !projectId) return;
    try {
      await send("PATCH", `/api/projects/${projectId}/views/${id}`, {
        who: w,
        ...body,
      });
      await loadViews();
      setMessage(null);
    } catch (err) {
      fail(err);
    }
  };

  const onPointerDown = (p: Pt, e?: React.PointerEvent): boolean => {
    pickedClick.current = !!(linkMode || addingBeam || addingColumn);
    if (tool === "count") {
      // a click on a count symbol decides that suggestion (the symbol's own handler); elsewhere it counts
      const onSymbol = (e?.target as Element | undefined)?.closest?.(
        '[data-testid="count-symbol"], [data-testid="unlinked-suggestion"]',
      );
      if (onSymbol) return false;
      if (!requireWho()) return false;
      if (!countKind) {
        setMessage("Choose the kind to count first.");
        return false;
      }
      // the line Tab walked to, if the candidates under the click are the ones that were shown
      const cands = snapCandidates(
        count.lines,
        count.classes,
        p.x,
        p.y,
        count.settings.snap_radius_pt,
      );
      const walked =
        sameCandidates(cands, hoverCandsRef.current) && candIdxRef.current > 0
          ? cands[candIdxRef.current]
          : undefined;
      void count.place(countKind, p.x, p.y, walked?.index).then((r) => {
        if (r) setMemberId(r.member.id);
        setCands([], 0);
      });
      return false;
    }
    if (tool === "measure") {
      void measureClick(p);
      return false;
    }
    if (linkMode) {
      const line = nearestLine(
        p.x,
        p.y,
        linkMode.lines,
        10 / Math.max(zoom, 0.05),
      );
      if (!line) {
        setMessage(
          "No structural line near that click. Click closer to the line.",
        );
        return false;
      }
      if (!requireWho()) return false;
      void act(linkMode.memberId, "/link", "POST", {
        line: { p: [line[0], line[1]], q: [line[2], line[3]] },
      });
      setLinkMode(null);
      setPickLines([]);
      return false;
    }
    if (addingBeam) {
      const inside = views.find(
        (v) =>
          p.x >= v.box.x0 &&
          p.x <= v.box.x1 &&
          p.y >= v.box.y0 &&
          p.y <= v.box.y1,
      );
      if (!inside) {
        setMessage("Click a line inside a view.");
        return false;
      }
      const line = nearestLine(p.x, p.y, pickLines, 10 / Math.max(zoom, 0.05));
      if (!line) {
        setMessage(
          "No structural line near that click. Find members for the view first, or click closer.",
        );
        return false;
      }
      if (!requireWho()) return false;
      setPendingBeam({ viewId: inside.id, point: p, line });
      setAddingBeam(false);
      return false;
    }
    if (addingColumn) {
      const inside = views.find(
        (v) =>
          p.x >= v.box.x0 &&
          p.x <= v.box.x1 &&
          p.y >= v.box.y0 &&
          p.y <= v.box.y1,
      );
      if (!inside) {
        setMessage(
          "Draw a view around this part of the sheet first; a column is added inside a view.",
        );
        return false;
      }
      if (!requireWho()) return false;
      setPendingColumn({ viewId: inside.id, point: p });
      setAddingColumn(false);
      return false;
    }
    if (!drawing) return false;
    setDrag({ a: p, b: p });
    return true;
  };
  const onPointerMove = (p: Pt) => {
    if (drag) setDrag({ a: drag.a, b: p });
    updateHover(p);
  };
  const onPointerUp = (p: Pt) => {
    if (!drag) return;
    const box = normaliseBox(drag.a, p);
    setDrag(null);
    if (box.x1 - box.x0 >= MIN_BOX_PT && box.y1 - box.y0 >= MIN_BOX_PT) {
      setDrawing(false);
      void createView(box);
    }
  };

  const widthPt = sheet?.page.width_pt ?? 0;
  const heightPt = sheet?.page.height_pt ?? 0;

  return (
    <div className="app">
      {who.trim() === "" && (
        <NameGate
          onSubmit={(name) => {
            setWhoState(name);
            setWho(name);
          }}
        />
      )}
      <header className="top">
        <b>Estimation AI: review</b>
        <select
          value={projectId ?? ""}
          onChange={(e) => setProjectId(e.target.value || null)}
          aria-label="project"
        >
          <option value="">choose a project</option>
          {projects
            .filter((p) => p.document)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.document?.page_count ?? "?"} pages)
              </option>
            ))}
        </select>
        <NewJob
          onError={fail}
          onCreated={(p) => {
            setProjects((list) => [p, ...list.filter((x) => x.id !== p.id)]);
            setProjectId(p.id);
          }}
        />
        {projectId && (
          <PilotSwitch
            on={count.settings.count_mode}
            disabled={!who.trim()}
            onChange={(on) => setPilot(on)}
          />
        )}
        <label>
          you:{" "}
          <input
            value={who}
            onChange={(e) => {
              setWhoState(e.target.value);
              setWho(e.target.value);
            }}
            placeholder="your name"
            aria-label="your name"
          />
        </label>
        <label>
          zoom{" "}
          <input
            type="range"
            min={0.1}
            max={2}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        {message && (
          <span className="error" role="alert" onClick={() => setMessage(null)}>
            {message}
          </span>
        )}
      </header>
      <PipelineBar
        flags={flags}
        running={running}
        onRerun={() => void rerun()}
        onConfirmExcluded={() => void confirmExcluded()}
      />
      {sheet && (
        <SheetHeader
          sheet={sheet}
          onPageType={(v) => void override("page-type", v)}
          onLevel={(v) => void override("level", v)}
          onTakeoff={(v) => void override("takeoff", v)}
          onTakeoffUndo={() => void undoTakeoff()}
          flags={flagsBySheet.get(sheet.id) ?? null}
          onConfirmGuesses={() => void confirmGuesses()}
          unlinkedCount={
            members.filter((m) => !m.deleted && m.status.color === "unlinked")
              .length
          }
        />
      )}
      <div className="layout">
        <nav className="left">
          <PageList
            sheets={sheets}
            selectedId={sheetId}
            onSelect={setSheetId}
            flags={flagsBySheet}
          />
        </nav>
        <main className="center" ref={centerRef}>
          {pdfError && <div className="error">{pdfError}</div>}
          {pdf && sheet && widthPt > 0 ? (
            <PageView
              pdf={pdf}
              pageIndex={sheet.page_index}
              widthPt={widthPt}
              heightPt={heightPt}
              zoom={zoom}
              cursor={
                drawing || addingColumn || addingBeam || linkMode || tool
                  ? "crosshair"
                  : "default"
              }
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {views.map((v) => (
                <g
                  key={v.id}
                  onClick={() => !pickedClick.current && setViewId(v.id)}
                >
                  <rect
                    x={v.box.x0}
                    y={v.box.y0}
                    width={v.box.x1 - v.box.x0}
                    height={v.box.y1 - v.box.y0}
                    className={`view-box ${v.scale.confirmed ? "ok" : "unconfirmed"} ${v.id === viewId ? "sel" : ""}`}
                  />
                  <text
                    x={v.box.x0 + 6}
                    y={v.box.y0 + 16}
                    className="view-label"
                  >
                    {v.name ?? "view"}{" "}
                    {v.scale.confirmed ? `1:${v.scale.ratio}` : "(scale?)"}
                    {v.classes_confirmed ? "" : " (confirm line classes)"}
                  </text>
                </g>
              ))}
              {labels
                .filter((l) => visible.has(l.category))
                .map((l) => (
                  <rect
                    key={l.key}
                    x={l.bbox.x0 - 1}
                    y={l.bbox.y0 - 1}
                    width={l.bbox.x1 - l.bbox.x0 + 2}
                    height={l.bbox.y1 - l.bbox.y0 + 2}
                    fill="none"
                    stroke={CATEGORY_COLOURS[l.category]}
                    strokeWidth={1.5}
                    className="label-box"
                  >
                    <title>{l.title}</title>
                  </rect>
                ))}
              <SymbolOverlay
                members={shownMembers}
                selectedId={memberId}
                zoom={zoom}
                highlight={highlight}
                markedIds={rowIds}
                countMode={count.settings.count_mode}
                onSymbolClick={symbolClick}
                onSelect={(id) => {
                  if (pickedClick.current) return;
                  setMemberId(id);
                  setTab("members");
                }}
              />
              <CountLayer
                tool={tool}
                zoom={zoom}
                hover={hover}
                hoverLine={hoverLine}
                hoverSnap={hoverSnap}
                radiusPt={
                  tool === "measure" ? 12 : count.settings.snap_radius_pt
                }
                measure={measure}
                candidate={
                  tool === "count" && hoverCands.length > 0
                    ? { index: candIdx, total: hoverCands.length }
                    : null
                }
              />
              {(linkMode || addingBeam) &&
                pickLines.map((l, i) => (
                  <line
                    key={i}
                    x1={l[0]}
                    y1={l[1]}
                    x2={l[2]}
                    y2={l[3]}
                    stroke="#1768c4"
                    strokeOpacity={0.35}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                ))}
              {pendingBeam && (
                <line
                  x1={pendingBeam.line[0]}
                  y1={pendingBeam.line[1]}
                  x2={pendingBeam.line[2]}
                  y2={pendingBeam.line[3]}
                  stroke="#8a3fc4"
                  strokeWidth={4}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {pendingColumn && (
                <circle
                  cx={pendingColumn.point.x}
                  cy={pendingColumn.point.y}
                  r={8}
                  fill="none"
                  stroke="#8a3fc4"
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {drag && (
                <rect
                  className="view-box drawing"
                  x={Math.min(drag.a.x, drag.b.x)}
                  y={Math.min(drag.a.y, drag.b.y)}
                  width={Math.abs(drag.b.x - drag.a.x)}
                  height={Math.abs(drag.b.y - drag.a.y)}
                />
              )}
            </PageView>
          ) : (
            <p className="hint">
              {projectId
                ? "Loading..."
                : "Choose a project with an uploaded PDF."}
            </p>
          )}
        </main>
        <aside className="right">
          <div className="tabs" role="tablist">
            {(
              [
                "members",
                "tables",
                "views",
                "labels",
                "notes",
                "takeoff",
                ...(pilot ? (["count"] as const) : []),
              ] as const
            ).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "tab on" : "tab"}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "labels" && (
            <LabelsPanel
              counts={counts}
              visible={visible}
              onToggle={(c) =>
                setVisible((v) => {
                  const n = new Set(v);
                  if (n.has(c)) n.delete(c);
                  else n.add(c);
                  return n;
                })
              }
              textSource={sheet?.page_type ? "PDF text layer" : null}
            />
          )}
          {tab === "notes" && <NotesPanel sheets={notes} />}
          {tab === "count" && pilot && projectId && (
            <PrefixKinds
              projectId={projectId}
              kinds={kinds}
              who={who}
              onError={fail}
            />
          )}
          {tab === "count" && pilot && (
            <CountPanel
              members={members}
              kinds={kinds}
              settings={count.settings}
              tool={tool}
              kind={countKind}
              linesState={count.linesState}
              selectedId={memberId}
              measure={{ text: measure.text, saved: savedMeasure }}
              who={who}
              onMode={(on) => {
                if (requireWho()) void count.update({ count_mode: on });
              }}
              onScope={(tag_scope) => void count.update({ tag_scope })}
              onRadius={(snap, label) =>
                void count.update({
                  snap_radius_pt: snap,
                  label_radius_pt: label,
                })
              }
              onTool={selectTool}
              onKind={setCountKind}
              onUndo={() => void undo()}
              onRedo={() => void count.redo()}
              onSelect={setMemberId}
              onDecide={(id, d) => void count.decide(id, d)}
              onTypical={(id, n, note) => void count.typical(id, n, note)}
              onDelete={(id) => void act(id, "/delete", "POST")}
              onPatch={(id, patch) => void act(id, "", "PATCH", patch)}
              onSaveMeasure={() => void saveMeasure()}
              onAttach={(id) =>
                savedMeasure && void count.attach(id, savedMeasure.id)
              }
            />
          )}
          {tab === "takeoff" && projectId && (
            <TakeoffPanel
              projectId={projectId}
              version={members}
              onError={fail}
              who={who}
              onJump={(row) => {
                if (!row.source.sheet_id) return;
                if (row.source.sheet_id === sheetId) {
                  setMemberId(row.source.member_id);
                } else {
                  jumpTo.current = row.source.member_id;
                  setSheetId(row.source.sheet_id);
                }
                setTab("members");
              }}
            />
          )}
          {tab === "tables" && projectId && (
            <TablesPanel
              projectId={projectId}
              pageNumber={sheet?.page_number ?? null}
              version={members}
              kinds={kinds}
              who={who}
              onError={fail}
              selectedKeys={rowKeys}
              onChanged={() => void reloadMembers()}
              onSelectRow={(row, page) => {
                setRowKeys(new Set([row.key]));
                setRowIds(new Set(row.member_ids));
                if (page !== null && page !== sheet?.page_number) {
                  jumpTo.current = row.member_ids[0] ?? null;
                  gotoPage(page);
                } else if (row.member_ids[0]) {
                  setMemberId(row.member_ids[0]);
                }
              }}
            />
          )}
          {tab === "members" && (
            <>
              {pendingColumn && (
                <ColumnForm
                  viewId={pendingColumn.viewId}
                  point={pendingColumn.point}
                  onSubmit={addColumn}
                  onCancel={() => setPendingColumn(null)}
                />
              )}
              {pendingBeam && (
                <AddLineForm
                  onSubmit={(f) =>
                    addOnLine({
                      view_id: pendingBeam.viewId,
                      point: pendingBeam.point,
                      line: {
                        p: [pendingBeam.line[0], pendingBeam.line[1]],
                        q: [pendingBeam.line[2], pendingBeam.line[3]],
                      },
                      ...f,
                    })
                  }
                  onCancel={() => {
                    setPendingBeam(null);
                    setPickLines([]);
                  }}
                />
              )}
              <div className="row">
                <button onClick={() => void undo()} disabled={!who.trim()}>
                  Undo (U)
                </button>
                <button
                  className={addingBeam ? "primary active" : ""}
                  onClick={() => {
                    const v = views.find((x) => x.id === viewId) ?? views[0];
                    if (!v) return setMessage("Draw a view first.");
                    setDrawing(false);
                    setAddingColumn(false);
                    setLinkMode(null);
                    loadLines(v.id)
                      .then((lines) => {
                        setPickLines(lines);
                        setAddingBeam((a) => !a);
                      })
                      .catch(fail);
                  }}
                >
                  {addingBeam
                    ? "Click a line (Esc to cancel)"
                    : "Add a beam (B)"}
                </button>
                <button
                  onClick={() => {
                    const w = who.trim();
                    if (!w)
                      return setMessage("Type your name at the top first.");
                    const n = nextToReview(members, memberId);
                    if (n) setMemberId(n);
                  }}
                >
                  Next to review (N)
                </button>
                {projectId && (
                  <a
                    href={`/api/projects/${projectId}/corrections.jsonl`}
                    download
                  >
                    Export corrections
                  </a>
                )}
              </div>
              <MembersPanel
                members={members}
                kinds={kinds}
                selectedId={memberId}
                onSelect={setMemberId}
                addingColumn={addingColumn}
                onAddColumn={() => {
                  setDrawing(false);
                  setAddingColumn((a) => !a);
                }}
                filters={filters}
                onFilters={setFilters}
                lastRunStart={flags?.last_run?.started_at ?? null}
                detail={(m) => (
                  <ExplanationPanel
                    member={m}
                    sheet={sheet}
                    view={views.find((v) => v.id === m.view_id) ?? null}
                    legend={legend}
                    history={history}
                    onJump={jump}
                    onGotoPage={gotoPage}
                    actions={
                      <MemberActions
                        member={m}
                        legend={legend}
                        kinds={kinds}
                        sameTagCount={sameTag}
                        relinking={linkMode?.memberId === m.id}
                        onConfirm={() => void act(m.id, "/confirm", "POST")}
                        onDelete={() => void act(m.id, "/delete", "POST")}
                        onPick={(rank) =>
                          void act(m.id, "/link", "POST", { rank })
                        }
                        onRelink={() => void startRelink()}
                        onPatch={(patch) => void act(m.id, "", "PATCH", patch)}
                        onKind={(kind, allSameTag) =>
                          void act(m.id, "/kind", "POST", {
                            kind,
                            all_same_tag: allSameTag,
                          })
                        }
                        onConfirmKind={() =>
                          void act(m.id, "/kind", "POST", { confirm: true })
                        }
                        onExisting={(value) =>
                          void act(m.id, "/existing", "POST", { value })
                        }
                        onNotMember={(reason) =>
                          void act(m.id, "/not-member", "POST", { reason })
                        }
                        onSharedLine={(resolution) =>
                          void act(m.id, "/shared-line", "POST", { resolution })
                        }
                        onLegend={(rowId) =>
                          void act(m.id, "/mark-ref", "POST", {
                            legend_row_id: rowId,
                          })
                        }
                      />
                    }
                  />
                )}
              />
            </>
          )}
          {tab === "views" && (
            <ViewsPanel
              views={views}
              selectedId={viewId}
              onSelect={setViewId}
              drawing={drawing}
              onDrawToggle={() => setDrawing((d) => !d)}
              wholeSheet={{
                available: sheet?.whole_sheet?.available ?? false,
                scaleText: sheet?.whole_sheet?.scale?.raw ?? null,
              }}
              onWholeSheet={() => void createWholeSheet()}
              onConfirmSuggestion={(id) =>
                void patchView(id, { scale: { action: "confirm_suggestion" } })
              }
              onSetScale={(id, text) =>
                void patchView(id, { scale: { action: "set", text } })
              }
              onClearScale={(id) =>
                void patchView(id, { scale: { action: "clear" } })
              }
              extra={(v) => (
                <ClassPicker
                  view={v}
                  busy={busyView === v.id}
                  onShow={() => void showClasses(v.id)}
                  onConfirm={(classes) => void confirmClasses(v.id, classes)}
                  onFind={() => void find(v.id)}
                />
              )}
              onDelete={(id) => {
                const w = requireWho();
                if (!w || !projectId) return;
                send(
                  "DELETE",
                  `/api/projects/${projectId}/views/${id}?who=${encodeURIComponent(w)}`,
                )
                  .then(() => {
                    setViewId(null);
                    return loadViews();
                  })
                  .catch(fail);
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
};

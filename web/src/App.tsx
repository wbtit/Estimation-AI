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
import { LabelsPanel } from "./components/LabelsPanel";
import { MemberActions, type LegendRow } from "./components/MemberActions";
import { MemberOverlay } from "./components/MemberOverlay";
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
  NotesSheet,
  Project,
  Sheet,
  SheetView,
  TextItem,
} from "./lib/types";
import { nearestLine, nextToReview, type Seg } from "./lib/pick";
import { useMembers } from "./lib/useMembers";
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
    "views" | "members" | "labels" | "notes" | "takeoff"
  >("views");
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
    field: "page-type" | "level",
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
    addColumn,
    addOnLine,
    act,
    undo,
  } = useMembers(projectId, sheetId, who, fail, loadViews);

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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (!w) return needName();
        void undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "v") {
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

  const onPointerDown = (p: Pt): boolean => {
    pickedClick.current = !!(linkMode || addingBeam || addingColumn);
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
      {sheet && (
        <SheetHeader
          sheet={sheet}
          onPageType={(v) => void override("page-type", v)}
          onLevel={(v) => void override("level", v)}
        />
      )}
      <div className="layout">
        <nav className="left">
          <PageList
            sheets={sheets}
            selectedId={sheetId}
            onSelect={setSheetId}
          />
        </nav>
        <main className="center">
          {pdfError && <div className="error">{pdfError}</div>}
          {pdf && sheet && widthPt > 0 ? (
            <PageView
              pdf={pdf}
              pageIndex={sheet.page_index}
              widthPt={widthPt}
              heightPt={heightPt}
              zoom={zoom}
              cursor={
                drawing || addingColumn || addingBeam || linkMode
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
              <MemberOverlay
                members={members}
                selectedId={memberId}
                onSelect={(id) => {
                  if (pickedClick.current) return;
                  setMemberId(id);
                  setTab("members");
                }}
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
            {(["views", "members", "labels", "notes", "takeoff"] as const).map(
              (t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  className={tab === t ? "tab on" : "tab"}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ),
            )}
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
          {tab === "takeoff" && projectId && (
            <TakeoffPanel
              projectId={projectId}
              version={members}
              onError={fail}
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
                selectedId={memberId}
                onSelect={setMemberId}
                addingColumn={addingColumn}
                onAddColumn={() => {
                  setDrawing(false);
                  setAddingColumn((a) => !a);
                }}
                extra={(m) => (
                  <MemberActions
                    member={m}
                    legend={legend}
                    relinking={linkMode?.memberId === m.id}
                    onConfirm={() => void act(m.id, "/confirm", "POST")}
                    onDelete={() => void act(m.id, "/delete", "POST")}
                    onPick={(rank) => void act(m.id, "/link", "POST", { rank })}
                    onRelink={() => void startRelink()}
                    onPatch={(patch) => void act(m.id, "", "PATCH", patch)}
                    onSharedLine={(resolution) =>
                      void act(m.id, "/shared-line", "POST", { resolution })
                    }
                    onLegend={(rowId) =>
                      void act(m.id, "/mark-ref", "POST", {
                        legend_row_id: rowId,
                      })
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
                  onFind={() => void find(v.id)}
                  onUse={(classes) => void find(v.id, classes)}
                />
              )}
              onDelete={(id) => {
                const w = requireWho();
                if (!w || !projectId) return;
                send("DELETE", `/api/projects/${projectId}/views/${id}`)
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

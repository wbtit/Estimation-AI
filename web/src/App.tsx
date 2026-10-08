import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PageList } from "./components/PageList";
import { PageView } from "./components/PageView";
import { LabelsPanel } from "./components/LabelsPanel";
import { NotesPanel } from "./components/NotesPanel";
import { SheetHeader } from "./components/SheetHeader";
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
  const [tab, setTab] = useState<"views" | "labels" | "notes">("views");
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "v") setDrawing((d) => !d);
      if (e.key === "Escape") {
        setDrawing(false);
        setDrag(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const requireWho = (): string | null => {
    if (who.trim() === "") {
      setMessage(
        "Type your name at the top first (it is saved with every change).",
      );
      return null;
    }
    return who.trim();
  };

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
              cursor={drawing ? "crosshair" : "default"}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {views.map((v) => (
                <g key={v.id} onClick={() => setViewId(v.id)}>
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
            {(["views", "labels", "notes"] as const).map((t) => (
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

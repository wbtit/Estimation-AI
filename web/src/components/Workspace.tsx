import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, send } from "../lib/api";
import { formatFtIn } from "../lib/ftin";
import {
  ALL_LAYERS,
  type Bom,
  type Box,
  type Layers,
  type LineFirstPage,
  type Page,
  type Piece,
  type Project,
  type Pt2,
  type Role,
  type Route,
  type SheetLines,
} from "../lib/lf";
import { usePdf } from "../lib/usePdf";
import { BomTab } from "./BomTab";
import { Canvas } from "./Canvas";
import { PageCard, type PageActions } from "./PageCard";
import { PropertiesPanel, type Kind, type PieceEdit } from "./PropertiesPanel";
import { ReportTab } from "./ReportTab";

type WsRoute = Extract<Route, { view: "workspace" }>;

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
  const [lines, setLines] = useState<SheetLines | null>(null);
  const [bom, setBom] = useState<Bom | null>(null);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [layers, setLayers] = useState<Layers>(ALL_LAYERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [left, setLeft] = useState<"pages" | "members">("pages");
  const [toast, setToast] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [memberFilter, setMemberFilter] = useState("");
  const [cropAsk, setCropAsk] = useState(0);

  const sheetId =
    route.sheetId ??
    pages.find((p) => p.setup.role !== null)?.id ??
    pages[0]?.id ??
    null;
  const page = pages.find((p) => p.id === sheetId) ?? null;

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
  }, [projectId]);

  useEffect(() => {
    setSelected(new Set());
    setData(null);
    setLines(null);
    if (!sheetId) return;
    void loadData();
    api<SheetLines>(`/api/projects/${projectId}/sheets/${sheetId}/lines`).then(
      setLines,
      () => setLines(null),
    );
    void send("POST", `/api/projects/${projectId}/sheets/${sheetId}/view`, {
      who,
    }).catch(() => undefined);
  }, [projectId, sheetId, who, loadData]);

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

  const actions: PageActions = {
    build: (p) =>
      act(
        send("POST", sheetUrl(p, "build"), { who, allow_system_values: true }),
        "Building…",
      ),
    setRole: (p, role: Role) =>
      act(send("POST", sheetUrl(p, "build-setup/role"), { role, who })),
    setColumnPlan: (p, id) =>
      act(
        send("POST", sheetUrl(p, "build-setup/column-plan"), {
          sheet_id: id,
          who,
        }),
      ),
    setTos: (p, mm, raw) =>
      act(
        send("POST", sheetUrl(p, "build-setup/tos"), {
          tos_mm: mm,
          raw,
          source: "typed",
          who,
        }),
      ),
    setScale: (p, v) =>
      act(
        send("POST", sheetUrl(p, "build-setup/scale"), { ...v, who }).catch(
          (e: unknown) => {
            // a scale as printed may carry more words than the parser reads: keep its ratio
            if (v.scale_text && e instanceof ApiError && e.status === 400) {
              const found = p.scales_found.find((s) => s.raw === v.scale_text);
              if (found?.ratio)
                return send("POST", sheetUrl(p, "build-setup/scale"), {
                  ratio: found.ratio,
                  who,
                });
            }
            throw e;
          },
        ),
      ),
  };

  const pieces = data?.pieces ?? [];
  const selectedPieces = pieces.filter((p) => selected.has(p.id));
  const editSelected = (e: PieceEdit) =>
    act(
      send("POST", `/api/projects/${projectId}/line-first/pieces/edit`, {
        who,
        member_ids: [...selected],
        ...e,
      }),
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
      <div className="topbar">
        <button onClick={() => go({ view: "projects" })} aria-label="home">
          ⌂ Home
        </button>
        <span className="brand">{project?.name ?? ""}</span>
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
        <span className="grow" />
        <span style={{ position: "relative" }}>
          <button
            aria-label="export"
            title="Export"
            onClick={() => setExportOpen(!exportOpen)}
          >
            ⇩
          </button>
          {exportOpen && (
            <div className="menu" onClick={() => setExportOpen(false)}>
              <a href={`/api/projects/${projectId}/line-first/bom.xlsx`}>
                <button>BOM (Excel)</button>
              </a>
              <a href={`/api/projects/${projectId}/report.xlsx`}>
                <button>Report (Excel)</button>
              </a>
              <a href={`/api/projects/${projectId}/answer-key.json`}>
                <button>Answer key</button>
              </a>
            </div>
          )}
        </span>
        <span className="muted" style={{ color: "#b8c0d6" }}>
          {who}
        </span>
      </div>
      {tab === "bom" && <BomTab bom={bom} projectId={projectId} />}
      {tab === "report" && <ReportTab projectId={projectId} />}
      {tab === "plans" && (
        <div className="ws-body">
          <div className="left">
            <div className="switch">
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
              {left === "pages" &&
                pages.map((p) => (
                  <PageCard
                    key={p.id}
                    page={p}
                    columnPlans={pages.filter(
                      (c) => c.setup.role === "column_plan",
                    )}
                    selected={p.id === sheetId}
                    onSelect={() => selectSheet(p.id)}
                    actions={actions}
                  />
                ))}
              {left === "members" && (
                <>
                  <div style={{ padding: 8 }}>
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
          {page ? (
            <Canvas
              pdf={pdf}
              page={page}
              data={data}
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
                    who,
                  }),
                )
              }
              onPick={(p: Pt2) =>
                void act(
                  send<{ pen_class: string }>(
                    "POST",
                    sheetUrl(page, "build-setup/pick-pen"),
                    {
                      x: p[0],
                      y: p[1],
                      who,
                    },
                  ),
                  "Beam pen picked",
                )
              }
              onDraw={(kind, a, b) =>
                void act(
                  send("POST", sheetUrl(page, "line-first/pieces"), {
                    who,
                    kind,
                    a,
                    b,
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
                void act(
                  send("POST", `/api/projects/${projectId}/undo`, { who }),
                  "Undone",
                )
              }
              onSave={() =>
                void act(
                  send("POST", sheetUrl(page, "save-page"), { who }),
                  "Page saved",
                )
              }
              onDeleteSelected={deleteSelected}
              cropAsk={cropAsk}
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
            crop={data?.crop ?? page?.setup.crop ?? null}
            onEdit={(e) => void editSelected(e)}
            onDelete={deleteSelected}
            onCropTool={() => setCropAsk((n) => n + 1)}
          />
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};

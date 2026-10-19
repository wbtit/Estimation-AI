import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, House, PanelLeft, Save } from "lucide-react";
import { api, ApiError, send } from "../lib/api";
import { formatFtIn } from "../lib/ftin";
import {
  activeView,
  ALL_LAYERS,
  loadFade,
  saveFade,
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
  type SheetLines,
} from "../lib/lf";
import { usePdf } from "../lib/usePdf";
import { BomTab } from "./BomTab";
import { Canvas, type PickMode, type Tool } from "./Canvas";
import { PageCard, type PageActions } from "./PageCard";
import { PropertiesPanel, type Kind, type PieceEdit } from "./PropertiesPanel";
import { ReportTab } from "./ReportTab";

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
  const [lines, setLines] = useState<SheetLines | null>(null);
  const [bom, setBom] = useState<Bom | null>(null);
  const [kinds, setKinds] = useState<Kind[]>([]);
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
  const [fade, setFadeState] = useState(() => loadFade(who));
  const setFade = (f: number) => {
    setFadeState(f);
    saveFade(who, f);
  };
  const [viewId, setViewId] = useState<string | null>(null);

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
    void loadRoles();
  }, [projectId]);

  useEffect(() => {
    setSelected(new Set());
    setData(null);
    setLines(null);
    setViewId(null);
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

  const withView = (viewId: string | null) =>
    viewId ? { view_id: viewId } : {};
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
          {tab === "plans" && page && (
            <button
              className="primary row"
              style={{ gap: 6 }}
              onClick={() => {
                // saving does not change any member's state: the issues left are the page's now
                const left = page.counts.attention + page.counts.needs_review;
                void act(
                  send("POST", sheetUrl(page, "save-page"), { who }),
                  `Page ${page.page_number} saved · ${left} issue${left === 1 ? "" : "s"} left`,
                );
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
          <span className="avatar" title={who}>
            {initials(who)}
          </span>
        </div>
      </div>
      {tab === "bom" && <BomTab bom={bom} projectId={projectId} />}
      {tab === "report" && <ReportTab projectId={projectId} />}
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
                    ...viewBody,
                    who,
                  }),
                )
              }
              onPick={(p: Pt2, mode: PickMode) =>
                void act(
                  send<{ pen_class: string }>(
                    "POST",
                    sheetUrl(page, "build-setup/pick-pen"),
                    { x: p[0], y: p[1], mode, ...viewBody, who },
                  ),
                  mode === "add" ? "Beam pen added" : "Beam pen picked",
                )
              }
              fade={fade}
              onFade={setFade}
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
            onCropTool={() => askTool("crop")}
            viewPieces={pieces.filter(
              (p) =>
                (p.build_view_id ?? data?.views?.[0]?.id ?? null) ===
                (view?.id ?? null),
            )}
            viewName={
              (data?.views?.length ?? 0) > 1 ? (view?.name ?? null) : null
            }
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
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};

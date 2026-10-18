import React, { useEffect, useRef, useState } from "react";
import { Bell, Check, EllipsisVertical, Play, Plus, X } from "lucide-react";
import { formatFtIn, parseFtIn } from "../lib/ftin";
import {
  activeView,
  PAGE_TYPE_SHORT,
  type Behaviour,
  type Page,
  type PageViewInfo,
  type RoleName,
} from "../lib/lf";
import { RoleSelect } from "./RoleSelect";

/** What a page card asks for. Setup changes are for one view of the page (the first by default). */
export interface PageActions {
  build: (p: Page) => void;
  setRole: (p: Page, viewId: string | null, roleName: string) => void;
  setColumnPlan: (
    p: Page,
    viewId: string | null,
    sheetId: string | null,
  ) => void;
  setTos: (p: Page, viewId: string | null, mm: number, raw: string) => void;
  setScale: (
    p: Page,
    viewId: string | null,
    v: { ratio?: number; scale_text?: string },
  ) => void;
  /** "No beams": beam pen = none (a person's choice); the next build makes no beams. */
  noBeams: (p: Page, viewId: string | null) => void;
  createRole?: (
    name: string,
    behaviour: Behaviour,
    p: Page,
    viewId: string | null,
  ) => void;
  editRole?: (
    name: string,
    change: { name?: string; behaviour?: Behaviour },
  ) => void;
  addView?: (p: Page) => void;
  deleteView?: (p: Page, viewId: string) => void;
}

/** A view of the page as the card shows it: the page's views, or one made of the page's setup. */
function viewsOf(page: Page): PageViewInfo[] {
  if (page.views && page.views.length) return page.views;
  return [
    {
      id: "",
      position: 1,
      name: "View 1",
      box: page.setup.crop,
      role_name: null,
      behaviour: page.setup.role,
      scale_ratio: page.setup.scale_ratio,
      scale_text: page.setup.scale_text,
      tos_mm: page.setup.tos_mm,
      tos_raw: page.setup.tos_raw,
      pens: page.setup.pen_class
        ? [
            {
              pen_class: page.setup.pen_class,
              position: 1,
              source: page.setup.pen_class_source ?? "",
            },
          ]
        : [],
      no_beams:
        page.setup.pen_class === null &&
        page.setup.pen_class_source === "person",
      column_plan_view_id: null,
      column_plan_sheet_id: page.setup.column_plan_sheet_id,
      exclusions: [],
      deselections: [],
      setup_changed_at: null,
      built_at: page.built_at,
      badge: page.badge,
      reasons: page.reasons,
      system_values: page.system_values,
      counts: page.counts,
    },
  ];
}

/** "No beams" is set on a view. */
export const hasNoBeams = (v: Pick<PageViewInfo, "no_beams">): boolean =>
  v.no_beams;

const badgeClass = (b: string) => b.replace(/\s+/g, "-");
const builds = (b: Behaviour | null) => b === "column_plan" || b === "framing";

/** Setup values in the estimator's words. */
const VALUE_WORDS: Record<string, string> = {
  role: "role",
  crop: "crop",
  scale: "scale",
  pen_class: "beam pen",
  tos: "Top of Steel",
  column_plan: "column plan",
};

function scaleLabel(text: string | null, ratio: number | null): string {
  if (ratio === null) return "—";
  return text ? `${text} (${ratio})` : `1:${ratio}`;
}

/** One page in Navigation: "Page N | Role", the sheet number, ▶ and ⋮, a thumbnail with the build
 * badge, Estimating/Skip and the red / orange issue counts on it. The selected card lists the
 * page's views (+ Add view) and the fields of the active view: Role, Top of Steel, Scale, Status. */
export const PageCard: React.FC<{
  page: Page;
  columnPlans: Page[];
  selected: boolean;
  onSelect: () => void;
  actions: PageActions;
  roles?: RoleName[];
  activeViewId?: string | null;
  onActiveView?: (id: string) => void;
}> = ({
  page,
  columnPlans,
  selected,
  onSelect,
  actions,
  roles = [],
  activeViewId = null,
  onActiveView,
}) => {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const views = viewsOf(page);
  const view = activeView(views, activeViewId)!;
  const vid = view.id || null;
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  const [tos, setTos] = useState(
    view.tos_mm === null ? "" : formatFtIn(view.tos_mm),
  );
  const [tosBad, setTosBad] = useState(false);
  const [typing, setTyping] = useState(false);
  const [scaleText, setScaleText] = useState("");
  useEffect(() => {
    setTos(view.tos_mm === null ? "" : formatFtIn(view.tos_mm));
    setTosBad(false);
  }, [view.tos_mm, view.id]);

  const first = views[0]!;
  const pageBuilds = views.some((v) => builds(v.behaviour));
  const behaviour = view.behaviour;
  const commitTos = () => {
    const text = tos.trim();
    if (
      text === "" ||
      (view.tos_mm !== null && text === formatFtIn(view.tos_mm))
    )
      return;
    const mm = parseFtIn(text);
    if (mm === null) {
      setTosBad(true);
      return;
    }
    setTosBad(false);
    actions.setTos(page, vid, mm, text);
  };

  const ratios = new Map<number, string>();
  for (const s of page.scales_found)
    if (s.ratio !== null && !ratios.has(s.ratio)) ratios.set(s.ratio, s.raw);
  if (view.scale_ratio !== null && !ratios.has(view.scale_ratio))
    ratios.set(view.scale_ratio, view.scale_text ?? "");

  const status =
    view.badge === "Not built" && view.reasons.length
      ? view.reasons.join("; ")
      : page.reviewed_by && page.badge === "Reviewed"
        ? `Saved by ${page.reviewed_by}, ${new Date(page.reviewed_at as string).toLocaleString()}`
        : view.system_values.length && builds(behaviour)
          ? `Not confirmed: ${view.system_values.map((v) => VALUE_WORDS[v] ?? v).join(", ")}`
          : `${view.counts.pieces} pieces`;

  const second = pageBuilds ? "Estimating" : "Skip";
  const title =
    views.length > 1
      ? `${views.length} views`
      : (first.role_name ??
        (first.behaviour === "column_plan"
          ? "Column plan"
          : first.behaviour === "framing"
            ? "Framing"
            : (PAGE_TYPE_SHORT[page.page_type ?? "other"] ?? "Other")));
  return (
    <div
      ref={ref}
      className={`page-card${selected ? " on" : ""}`}
      onClick={onSelect}
      data-testid={`page-card-${page.page_number}`}
    >
      <div className="head">
        <span className="title">
          Page {page.page_number} | {title}
        </span>
        <span className="grow" />
        <button
          className={`play${page.badge === "Requesting Build" ? " ask" : ""}`}
          title="Build"
          aria-label="build page"
          disabled={!pageBuilds || page.badge === "Building"}
          onClick={(e) => {
            e.stopPropagation();
            actions.build(page);
          }}
        >
          <Play size={11} fill="currentColor" />
        </button>
        <span style={{ position: "relative" }}>
          <button
            className="more"
            aria-label="page menu"
            title="Page menu"
            onClick={(e) => {
              e.stopPropagation();
              setMenu(!menu);
            }}
          >
            <EllipsisVertical size={14} />
          </button>
          {menu && (
            <div className="menu" onClick={(e) => e.stopPropagation()}>
              {views.length > 1 && <span className="label">{view.name}</span>}
              {builds(behaviour) ? (
                <button
                  className={hasNoBeams(view) ? "on" : ""}
                  title="Beam pen = none; ▶ then removes the beams you did not edit"
                  onClick={() => {
                    setMenu(false);
                    actions.noBeams(page, vid);
                  }}
                >
                  No beams
                </button>
              ) : (
                <span className="muted" style={{ padding: "4px 10px" }}>
                  Set a role that builds first
                </span>
              )}
              {behaviour === "framing" && (
                <>
                  <hr />
                  <span className="label">Column plan</span>
                  {[...columnPlans.filter((c) => c.id !== page.id), null].map(
                    (c) => (
                      <button
                        key={c?.id ?? "none"}
                        className={
                          view.column_plan_sheet_id === (c?.id ?? null)
                            ? "on"
                            : ""
                        }
                        onClick={() => {
                          setMenu(false);
                          actions.setColumnPlan(page, vid, c?.id ?? null);
                        }}
                      >
                        {c
                          ? `Page ${c.page_number}${c.sheet_number ? ` · ${c.sheet_number}` : ""}`
                          : "None"}
                      </button>
                    ),
                  )}
                </>
              )}
            </div>
          )}
        </span>
      </div>
      <div className="sheet-no">Sheet {page.sheet_number ?? "—"}</div>
      <div className="thumb">
        {page.thumbnail_url ? (
          <img src={page.thumbnail_url} alt="" loading="lazy" />
        ) : null}
        {page.badge !== "Skip" && (
          <span
            className={`tag top ${badgeClass(page.badge)}`}
            title={page.reasons.join("; ")}
          >
            {page.badge === "Requesting Build" && <Bell size={11} />}
            {(page.badge === "Built" || page.badge === "Reviewed") && (
              <Check size={11} />
            )}
            {page.badge}
          </span>
        )}
        <span className={`tag bottom ${second}`}>{second}</span>
        {(page.counts.attention > 0 || page.counts.needs_review > 0) && (
          <span className="issue-counts" data-testid="issue-counts">
            {page.counts.attention > 0 && (
              <b className="n-attention" title="need attention">
                {page.counts.attention}
              </b>
            )}
            {page.counts.needs_review > 0 && (
              <b className="n-review" title="to review">
                {page.counts.needs_review}
              </b>
            )}
          </span>
        )}
      </div>
      {selected && (
        <div onClick={(e) => e.stopPropagation()}>
          <div className="views" data-testid="views">
            <span className="views-label">Views</span>
            {views.map((v) => (
              <span
                key={v.id || "first"}
                className={`view-chip${v.id === view.id ? " on" : ""}`}
              >
                <button
                  onClick={() => v.id && onActiveView?.(v.id)}
                  title={v.role_name ?? ""}
                >
                  {v.name}
                  {v.badge === "Requesting Build" && <Bell size={10} />}
                </button>
                {v.position > 1 && actions.deleteView && (
                  <button
                    className="x"
                    aria-label={`delete ${v.name}`}
                    title={`Delete ${v.name}`}
                    onClick={() => actions.deleteView!(page, v.id)}
                  >
                    <X size={11} />
                  </button>
                )}
              </span>
            ))}
            {actions.addView && (
              <button
                className="add-view"
                title="Draw the box of a new view on the page"
                onClick={() => actions.addView!(page)}
              >
                <Plus size={12} /> Add view
              </button>
            )}
          </div>
          <div className="field">
            <span>Role</span>
            <RoleSelect
              value={view.role_name}
              roles={roles}
              onPick={(name) => actions.setRole(page, vid, name)}
              onCreate={(name, b) => actions.createRole?.(name, b, page, vid)}
              onEdit={actions.editRole}
            />
          </div>
          {builds(behaviour) && (
            <>
              <div className="field">
                <span>Top of Steel</span>
                <input
                  aria-label="top of steel"
                  className={tosBad ? "bad" : ""}
                  title={
                    tosBad
                      ? `Use feet-inches, e.g. 13'-3 1/2"`
                      : (view.tos_raw ?? "")
                  }
                  placeholder="—"
                  value={tos}
                  onChange={(e) => setTos(e.target.value)}
                  onBlur={commitTos}
                  onKeyDown={(e) =>
                    e.key === "Enter" && (e.target as HTMLInputElement).blur()
                  }
                />
              </div>
              <div className="field">
                <span>Scale</span>
                {typing ? (
                  <input
                    autoFocus
                    aria-label="type a scale"
                    placeholder={`1/8" = 1'-0"`}
                    value={scaleText}
                    onChange={(e) => setScaleText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setTyping(false);
                      if (e.key === "Enter" && scaleText.trim()) {
                        actions.setScale(page, vid, {
                          scale_text: scaleText.trim(),
                        });
                        setTyping(false);
                      }
                    }}
                    onBlur={() => setTyping(false)}
                  />
                ) : (
                  <select
                    aria-label="scale"
                    value={view.scale_ratio ?? ""}
                    onChange={(e) => {
                      if (e.target.value === "type") {
                        setTyping(true);
                        return;
                      }
                      const ratio = Number(e.target.value);
                      const text = ratios.get(ratio);
                      actions.setScale(
                        page,
                        vid,
                        text ? { scale_text: text } : { ratio },
                      );
                    }}
                  >
                    {view.scale_ratio === null && <option value="">—</option>}
                    {[...ratios.entries()].map(([r, t]) => (
                      <option key={r} value={r}>
                        {scaleLabel(t, r)}
                      </option>
                    ))}
                    <option value="type">Type…</option>
                  </select>
                )}
              </div>
            </>
          )}
          <div className="field">
            <span>Status</span>
            <span className="status">{status}</span>
          </div>
        </div>
      )}
    </div>
  );
};

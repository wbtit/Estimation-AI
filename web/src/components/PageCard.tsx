import React, { useEffect, useRef, useState } from "react";
import { Bell, Check, EllipsisVertical, Play } from "lucide-react";
import { formatFtIn, parseFtIn } from "../lib/ftin";
import { PAGE_TYPE_SHORT, ROLE_LABEL, type Page, type Role } from "../lib/lf";

export interface PageActions {
  build: (p: Page) => void;
  setRole: (p: Page, role: Role) => void;
  setColumnPlan: (p: Page, sheetId: string | null) => void;
  setTos: (p: Page, mm: number, raw: string) => void;
  setScale: (p: Page, v: { ratio?: number; scale_text?: string }) => void;
  /** "No beams": beam pen = none (a person's choice); the next build makes no beams. */
  noBeams: (p: Page) => void;
}

/** "No beams" is set: no pen class, chosen by a person. */
export const hasNoBeams = (p: Page): boolean =>
  p.setup.pen_class === null && p.setup.pen_class_source === "person";

const badgeClass = (b: string) => b.replace(/\s+/g, "-");

/** Setup values in the estimator's words. */
const VALUE_WORDS: Record<string, string> = {
  role: "page type",
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

/** One page in Navigation: "Page N | Type", the sheet number, ▶ and ⋮, a thumbnail with the build
 * badge and Estimating/Skip on it; Top of Steel, Scale and Status only on the selected card. */
export const PageCard: React.FC<{
  page: Page;
  columnPlans: Page[];
  selected: boolean;
  onSelect: () => void;
  actions: PageActions;
}> = ({ page, columnPlans, selected, onSelect, actions }) => {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  const [tos, setTos] = useState(
    page.setup.tos_mm === null ? "" : formatFtIn(page.setup.tos_mm),
  );
  const [tosBad, setTosBad] = useState(false);
  const [typing, setTyping] = useState(false);
  const [scaleText, setScaleText] = useState("");
  useEffect(() => {
    setTos(page.setup.tos_mm === null ? "" : formatFtIn(page.setup.tos_mm));
    setTosBad(false);
  }, [page.setup.tos_mm]);

  const role = page.setup.role;
  const commitTos = () => {
    const text = tos.trim();
    if (
      text === "" ||
      (page.setup.tos_mm !== null && text === formatFtIn(page.setup.tos_mm))
    )
      return;
    const mm = parseFtIn(text);
    if (mm === null) {
      setTosBad(true);
      return;
    }
    setTosBad(false);
    actions.setTos(page, mm, text);
  };

  const ratios = new Map<number, string>();
  for (const s of page.scales_found)
    if (s.ratio !== null && !ratios.has(s.ratio)) ratios.set(s.ratio, s.raw);
  if (page.setup.scale_ratio !== null && !ratios.has(page.setup.scale_ratio))
    ratios.set(page.setup.scale_ratio, page.setup.scale_text ?? "");

  const status =
    page.badge === "Not built" && page.reasons.length
      ? page.reasons.join("; ")
      : page.reviewed_by && page.badge === "Reviewed"
        ? `Saved by ${page.reviewed_by}, ${new Date(page.reviewed_at as string).toLocaleString()}`
        : page.system_values.length && role
          ? `Not confirmed: ${page.system_values.map((v) => VALUE_WORDS[v] ?? v).join(", ")}`
          : `${page.counts.pieces} pieces`;

  const second = role ? "Estimating" : "Skip";
  return (
    <div
      ref={ref}
      className={`page-card${selected ? " on" : ""}`}
      onClick={onSelect}
      data-testid={`page-card-${page.page_number}`}
    >
      <div className="head">
        <span className="title">
          Page {page.page_number} |{" "}
          {role
            ? ROLE_LABEL[role]
            : (PAGE_TYPE_SHORT[page.page_type ?? "other"] ?? "Other")}
        </span>
        <span className="grow" />
        <button
          className={`play${page.badge === "Requesting Build" ? " ask" : ""}`}
          title="Build"
          aria-label="build page"
          disabled={!role || page.badge === "Building"}
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
              <span className="label">Page type</span>
              {(["column_plan", "framing", null] as Role[]).map((r) => (
                <button
                  key={String(r)}
                  className={role === r ? "on" : ""}
                  onClick={() => {
                    setMenu(false);
                    actions.setRole(page, r);
                  }}
                >
                  {ROLE_LABEL[r ?? "skip"]}
                </button>
              ))}
              {role && (
                <>
                  <hr />
                  <button
                    className={hasNoBeams(page) ? "on" : ""}
                    title="Beam pen = none; ▶ then removes the beams you did not edit"
                    onClick={() => {
                      setMenu(false);
                      actions.noBeams(page);
                    }}
                  >
                    No beams
                  </button>
                </>
              )}
              {role === "framing" && (
                <>
                  <hr />
                  <span className="label">Column plan</span>
                  {[...columnPlans.filter((c) => c.id !== page.id), null].map(
                    (c) => (
                      <button
                        key={c?.id ?? "none"}
                        className={
                          page.setup.column_plan_sheet_id === (c?.id ?? null)
                            ? "on"
                            : ""
                        }
                        onClick={() => {
                          setMenu(false);
                          actions.setColumnPlan(page, c?.id ?? null);
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
      {selected && role && (
        <>
          <div className="field" onClick={(e) => e.stopPropagation()}>
            <span>Top of Steel</span>
            <input
              aria-label="top of steel"
              className={tosBad ? "bad" : ""}
              title={
                tosBad
                  ? `Use feet-inches, e.g. 13'-3 1/2"`
                  : (page.setup.tos_raw ?? "")
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
          <div className="field" onClick={(e) => e.stopPropagation()}>
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
                    actions.setScale(page, { scale_text: scaleText.trim() });
                    setTyping(false);
                  }
                }}
                onBlur={() => setTyping(false)}
              />
            ) : (
              <select
                aria-label="scale"
                value={page.setup.scale_ratio ?? ""}
                onChange={(e) => {
                  if (e.target.value === "type") {
                    setTyping(true);
                    return;
                  }
                  const ratio = Number(e.target.value);
                  const text = ratios.get(ratio);
                  actions.setScale(
                    page,
                    text ? { scale_text: text } : { ratio },
                  );
                }}
              >
                {page.setup.scale_ratio === null && <option value="">—</option>}
                {[...ratios.entries()].map(([r, t]) => (
                  <option key={r} value={r}>
                    {scaleLabel(t, r)}
                  </option>
                ))}
                <option value="type">Type…</option>
              </select>
            )}
          </div>
          <div className="field">
            <span>Status</span>
            <span className="status">{status}</span>
          </div>
        </>
      )}
      {selected && !role && <div className="status">{status}</div>}
    </div>
  );
};

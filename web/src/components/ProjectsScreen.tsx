import React, { useEffect, useMemo, useState } from "react";
import { MoreVertical, Plus, Search } from "lucide-react";
import { api, ApiError, getWho, send, setWho } from "../lib/api";
import {
  chipCounts,
  DEFAULT_CHIPS,
  nameFromFile,
  PROJECT_CHIPS,
  projectsShown,
  purposeOf,
  STAGES,
  type Project,
  type ProjectChip,
  type Purpose,
} from "../lib/lf";

/** The projects screen: filter chips (Real · Demo · Evaluation · Archived; Real and Demo by
 * default, so measurement copies never crowd it), search, "Add new project" first, then a card per
 * project sorted by last opened. Each card has a ⋮ menu: Rename, Change purpose,
 * Archive/Unarchive, Duplicate as demo (each asks who and is logged by the API). */
export const ProjectsScreen: React.FC<{ onOpen: (id: string) => void }> = ({
  onOpen,
}) => {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [chips, setChips] = useState<Set<ProjectChip>>(
    () => new Set(DEFAULT_CHIPS),
  );
  const [creating, setCreating] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [action, setAction] = useState<{
    kind: ActionKind;
    project: Project;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    api<{ projects: Project[] }>("/api/projects").then(
      (r) => setProjects(r.projects),
      (e: unknown) =>
        setError(e instanceof Error ? e.message : "could not load"),
    );
  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(
    () => projectsShown(projects ?? [], chips, q),
    [projects, q, chips],
  );
  const counts = useMemo(() => chipCounts(projects ?? []), [projects]);
  const toggle = (k: ProjectChip) =>
    setChips((c) => {
      const n = new Set(c);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const open = (p: Project) => {
    if (p.document && p.document.scan_status !== "done") {
      setProcessing(p.id);
      return;
    }
    // last opened (no log row); opening never waits for it
    void send("POST", `/api/projects/${p.id}/opened`).catch(() => undefined);
    onOpen(p.id);
  };

  return (
    <div>
      <div className="topbar dark">
        <div className="side">
          <span className="brand">Estimation</span>
        </div>
      </div>
      <div className="projects dark">
        <div className="head">
          <h2>Projects</h2>
          <div className="chips" role="group" aria-label="filters">
            {PROJECT_CHIPS.map((c) => (
              <button
                key={c.key}
                className={`chip${chips.has(c.key) ? " on" : ""}`}
                aria-pressed={chips.has(c.key)}
                onClick={() => toggle(c.key)}
              >
                {c.label} <span className="count">{counts[c.key]}</span>
              </button>
            ))}
          </div>
          <span className="grow" />
          <span className="row" style={{ position: "relative" }}>
            <Search
              size={15}
              style={{
                position: "absolute",
                left: 9,
                color: "var(--shell-muted)",
              }}
            />
            <input
              aria-label="search projects"
              placeholder="Search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: 240, paddingLeft: 30 }}
            />
          </span>
        </div>
        {error && <div className="muted">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
        <div className="cards">
          <div
            className="card add"
            role="button"
            tabIndex={0}
            onClick={() => setCreating(true)}
            onKeyDown={(e) => e.key === "Enter" && setCreating(true)}
          >
            <span className="row" style={{ gap: 6 }}>
              <Plus size={18} /> Add new project
            </span>
          </div>
          {shown.map((p) => (
            <ProjectCard
              key={p.id}
              p={p}
              onOpen={() => open(p)}
              onAction={(kind) => setAction({ kind, project: p })}
            />
          ))}
        </div>
      </div>
      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setProcessing(id);
            void load();
          }}
        />
      )}
      {processing && (
        <ProcessingPanel
          projectId={processing}
          onClose={() => {
            setProcessing(null);
            void load();
          }}
          onOpen={() => onOpen(processing)}
        />
      )}
      {action && (
        <ProjectActionDialog
          kind={action.kind}
          project={action.project}
          onClose={() => setAction(null)}
          onDone={(msg) => {
            setAction(null);
            setNotice(msg);
            void load();
          }}
        />
      )}
    </div>
  );
};

export const PURPOSE_LABEL: Record<Purpose, string> = {
  real: "Real",
  demo: "Demo",
  evaluation: "Evaluation",
};

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString() : null;

type ActionKind = "rename" | "purpose" | "archive" | "duplicate";

export const ProjectCard: React.FC<{
  p: Project;
  onOpen: () => void;
  onAction: (kind: ActionKind) => void;
}> = ({ p, onOpen, onAction }) => {
  const [menu, setMenu] = useState(false);
  const purpose = purposeOf(p);
  const pages = p.pages;
  const opened = fmtDate(p.last_opened_at);
  const pick = (k: ActionKind) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenu(false);
    onAction(k);
  };
  return (
    <div
      className={`card${p.archived ? " archived" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
    >
      <div className="thumb">
        {p.thumbnail_url ? (
          <img src={p.thumbnail_url} alt="" />
        ) : (
          <span className="muted">No drawing</span>
        )}
      </div>
      <div className="body">
        <div className="row">
          {purpose !== "real" && (
            <span className={`badge purpose-${purpose}`}>
              {PURPOSE_LABEL[purpose]}
            </span>
          )}
          {p.archived && <span className="badge Archived">Archived</span>}
          <span className={`badge ${p.stage}`}>{p.stage}</span>
          <span className="grow" />
          <span style={{ position: "relative" }}>
            <button
              className="icon-btn"
              aria-label={`actions for ${p.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setMenu((m) => !m);
              }}
            >
              <MoreVertical size={16} />
            </button>
            {menu && (
              <div
                className="menu"
                role="menu"
                onClick={(e) => e.stopPropagation()}
              >
                <button role="menuitem" onClick={pick("rename")}>
                  Rename
                </button>
                <button role="menuitem" onClick={pick("purpose")}>
                  Change purpose
                </button>
                <button role="menuitem" onClick={pick("archive")}>
                  {p.archived ? "Unarchive" : "Archive"}
                </button>
                <hr />
                <button role="menuitem" onClick={pick("duplicate")}>
                  Duplicate as demo
                </button>
              </div>
            )}
          </span>
        </div>
        <div className="name" title={p.name}>
          {p.name}
        </div>
        {p.number && <div className="muted">#{p.number}</div>}
        {pages && (
          <div className="card-stats">
            <span>
              built {pages.built} / plans {pages.plans}
            </span>
            <span>
              reviewed {pages.reviewed} of {pages.built} pages
            </span>
          </div>
        )}
        <div className="muted" style={{ fontSize: 11 }}>
          {opened ? `Opened ${opened}` : "Never opened"}
        </div>
      </div>
    </div>
  );
};

/** Rename, Change purpose, Archive/Unarchive, Duplicate as demo: one small dialog that asks for
 * the value (if any) and the person's name, then calls the API (which logs the change). */
export const ProjectActionDialog: React.FC<{
  kind: ActionKind;
  project: Project;
  onClose: () => void;
  onDone: (message: string) => void;
}> = ({ kind, project, onClose, onDone }) => {
  const [who, setWhoField] = useState(getWho());
  const [name, setName] = useState(
    kind === "duplicate" ? `${project.name} (demo)` : project.name,
  );
  const [purpose, setPurpose] = useState<Purpose>(purposeOf(project));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title =
    kind === "rename"
      ? "Rename project"
      : kind === "purpose"
        ? "Change purpose"
        : kind === "archive"
          ? project.archived
            ? "Unarchive project"
            : "Archive project"
          : "Duplicate as demo";
  const go = async () => {
    if (who.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const url = `/api/projects/${project.id}`;
      let msg: string;
      if (kind === "duplicate") {
        const r = await send<{ name: string }>("POST", `${url}/duplicate`, {
          who: who.trim(),
          name: name.trim(),
        });
        msg = `Copying as demo: "${r.name}" appears when the copy finishes.`;
      } else {
        const body =
          kind === "rename"
            ? { name: name.trim() }
            : kind === "purpose"
              ? { purpose }
              : { archived: !project.archived };
        await send("PATCH", url, { ...body, who: who.trim() });
        msg = "Saved.";
      }
      setWho(who.trim());
      onDone(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save");
      setBusy(false);
    }
  };
  return (
    <div className="modal-back" role="dialog" aria-label={title}>
      <div className="modal">
        <h3>{title}</h3>
        {(kind === "rename" || kind === "duplicate") && (
          <label>
            {kind === "duplicate" ? "Name of the copy" : "Name"}
            <input
              aria-label="new name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {kind === "purpose" && (
          <label>
            Purpose
            <select
              aria-label="purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as Purpose)}
            >
              {(Object.keys(PURPOSE_LABEL) as Purpose[]).map((k) => (
                <option key={k} value={k}>
                  {PURPOSE_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "archive" && (
          <div className="muted">
            {project.archived
              ? "The project comes back to its purpose's list."
              : "The project moves under Archived. Nothing is deleted."}
          </div>
        )}
        <label>
          Your name
          <input
            aria-label="your name"
            value={who}
            onChange={(e) => setWhoField(e.target.value)}
          />
        </label>
        {error && <div style={{ color: "var(--red)" }}>{error}</div>}
        <div className="row">
          <span className="grow" />
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={go}
            disabled={
              busy ||
              who.trim() === "" ||
              ((kind === "rename" || kind === "duplicate") &&
                name.trim() === "")
            }
          >
            {kind === "archive"
              ? project.archived
                ? "Unarchive"
                : "Archive"
              : kind === "duplicate"
                ? "Duplicate"
                : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Create dialog: File, Name (from the file name), Project Number, Status. */
export const CreateDialog: React.FC<{
  onClose: () => void;
  onCreated: (id: string) => void;
  upload?: (projectId: string, file: File) => Promise<void>;
}> = ({ onClose, onCreated, upload = uploadPdf }) => {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [number, setNumber] = useState("");
  const [stage, setStage] = useState<(typeof STAGES)[number]>("Estimating");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!file || name.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const p = await send<Project>("POST", "/api/projects", {
        name: name.trim(),
        number: number.trim() || null,
        stage,
      });
      await upload(p.id, file);
      onCreated(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not create the project");
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" role="dialog" aria-label="new project">
      <div className="modal">
        <h3>New project</h3>
        <label>
          File
          <input
            type="file"
            accept="application/pdf,.pdf"
            aria-label="drawing file"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !nameTouched) setName(nameFromFile(f.name));
            }}
          />
        </label>
        <label>
          Name
          <input
            aria-label="project name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
          />
        </label>
        <label>
          Project Number
          <input
            aria-label="project number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>
        <label>
          Status
          <select
            aria-label="project status"
            value={stage}
            onChange={(e) => setStage(e.target.value as never)}
          >
            {STAGES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        {error && <div style={{ color: "var(--red)" }}>{error}</div>}
        <div className="row">
          <span className="grow" />
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={create}
            disabled={busy || !file || name.trim() === ""}
          >
            {busy ? "Uploading…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
};

export async function uploadPdf(projectId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(`/api/projects/${projectId}/pdf`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, msg);
  }
}

export interface Processing {
  scan: { status: string; pages: number | null; pages_done: number } | null;
  pipeline: { status: string; error: string | null } | null;
  auto_build: {
    status: string;
    pages: number;
    pages_done: number;
    error: string | null;
  } | null;
}

type StepState = "waiting" | "running" | "done" | "failed";

export function processingSteps(
  p: Processing | null,
): { name: string; state: StepState; detail: string; share: number }[] {
  const scan = p?.scan;
  const scanState: StepState = !scan
    ? "waiting"
    : scan.status === "done"
      ? "done"
      : scan.status === "failed"
        ? "failed"
        : "running";
  const pipe = p?.pipeline;
  const pipeState: StepState = !pipe
    ? scanState === "done"
      ? "running"
      : "waiting"
    : pipe.status === "completed"
      ? "done"
      : pipe.status === "failed"
        ? "failed"
        : "running";
  const auto = p?.auto_build;
  const autoState: StepState = !auto
    ? pipeState === "done"
      ? "running"
      : "waiting"
    : auto.status === "done"
      ? "done"
      : auto.status === "failed" || auto.status === "refused"
        ? "failed"
        : "running";
  const frac = (done: number, total: number | null) =>
    total ? Math.min(1, done / total) : 0;
  return [
    { name: "Upload", state: "done", detail: "", share: 1 },
    {
      name: "Scan",
      state: scanState,
      detail: scan?.pages ? `${scan.pages_done}/${scan.pages}` : "",
      share:
        scanState === "done"
          ? 1
          : frac(scan?.pages_done ?? 0, scan?.pages ?? null),
    },
    {
      name: "Read text",
      state: pipeState,
      detail: "",
      share: pipeState === "done" ? 1 : 0,
    },
    {
      name: "Auto build",
      state: autoState,
      detail: auto?.pages ? `${auto.pages_done}/${auto.pages}` : "",
      share:
        autoState === "done"
          ? 1
          : frac(auto?.pages_done ?? 0, auto?.pages ?? null),
    },
  ];
}

/** Processing panel: the steps after an upload, with a progress bar; "Open" when done. */
export const ProcessingPanel: React.FC<{
  projectId: string;
  onClose: () => void;
  onOpen: () => void;
}> = ({ projectId, onClose, onOpen }) => {
  const [state, setState] = useState<Processing | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api<Processing>(`/api/projects/${projectId}/processing`).then(
        (r) => alive && setState(r),
        () => undefined,
      );
    void tick();
    const t = window.setInterval(tick, 1500);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [projectId]);
  const steps = processingSteps(state);
  const share = steps.reduce((a, s) => a + s.share, 0) / steps.length;
  const finished =
    steps[3]!.state === "done" || steps.some((s) => s.state === "failed");
  return (
    <div className="modal-back" role="dialog" aria-label="processing">
      <div className="modal">
        <h3>Processing</h3>
        <div className="steps">
          {steps.map((s) => (
            <div key={s.name} className={`step ${s.state}`}>
              <span>
                {s.state === "done"
                  ? "✓"
                  : s.state === "failed"
                    ? "✕"
                    : s.state === "running"
                      ? "…"
                      : "·"}{" "}
                {s.name}
              </span>
              <span className="muted">{s.detail}</span>
            </div>
          ))}
        </div>
        <div className="bar" aria-label="progress">
          <div style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
        <div className="row">
          <span className="grow" />
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={onOpen} disabled={!finished}>
            Open
          </button>
        </div>
      </div>
    </div>
  );
};

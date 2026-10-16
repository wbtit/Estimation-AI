import React, { useEffect, useMemo, useState } from "react";
import { api, ApiError, send } from "../lib/api";
import { nameFromFile, STAGES, type Project } from "../lib/lf";

/** The projects screen: search, a card per project, "Add new project". */
export const ProjectsScreen: React.FC<{ onOpen: (id: string) => void }> = ({
  onOpen,
}) => {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const load = () =>
    api<{ projects: Project[] }>("/api/projects").then(
      (r) => setProjects(r.projects),
      (e: unknown) =>
        setError(e instanceof Error ? e.message : "could not load"),
    );
  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (projects ?? []).filter(
      (p) =>
        t === "" ||
        p.name.toLowerCase().includes(t) ||
        (p.number ?? "").toLowerCase().includes(t),
    );
  }, [projects, q]);

  return (
    <div>
      <div className="topbar">
        <span className="brand">Estimation</span>
      </div>
      <div className="projects">
        <div className="head">
          <h2>Projects</h2>
          <span className="grow" />
          <input
            aria-label="search projects"
            placeholder="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 240 }}
          />
        </div>
        {error && <div className="muted">{error}</div>}
        <div className="cards">
          <div
            className="card add"
            role="button"
            tabIndex={0}
            onClick={() => setCreating(true)}
            onKeyDown={(e) => e.key === "Enter" && setCreating(true)}
          >
            + Add new project
          </div>
          {shown.map((p) => (
            <ProjectCard
              key={p.id}
              p={p}
              onOpen={() =>
                p.document && p.document.scan_status !== "done"
                  ? setProcessing(p.id)
                  : onOpen(p.id)
              }
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
    </div>
  );
};

const ProjectCard: React.FC<{ p: Project; onOpen: () => void }> = ({
  p,
  onOpen,
}) => (
  <div
    className="card"
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
        <span className="muted" style={{ fontSize: 11 }}>
          {new Date(p.created_at).toLocaleDateString()}
        </span>
        <span className="grow" />
        <span className={`badge ${p.stage}`}>{p.stage}</span>
      </div>
      <div style={{ fontWeight: 600 }}>{p.name}</div>
      {p.number && <div className="muted">#{p.number}</div>}
    </div>
  </div>
);

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

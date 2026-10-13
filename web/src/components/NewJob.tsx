import React, { useRef, useState } from "react";
import type { Project } from "../lib/types";

/** Upload an estimation PDF: creates a job named after the file and starts the automatic pipeline. */
export const NewJob: React.FC<{
  onCreated: (project: Project) => void;
  onError: (err: unknown) => void;
}> = ({ onCreated, onError }) => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const name = file.name.replace(/\.pdf$/i, "").slice(0, 100) || "job";
      const created = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!created.ok)
        throw new Error(`could not create the job (${created.status})`);
      const project = (await created.json()) as Project;
      const form = new FormData();
      form.append("file", file);
      const sent = await fetch(`/api/projects/${project.id}/pdf`, {
        method: "POST",
        body: form,
      });
      if (!sent.ok) {
        const body = (await sent.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `upload failed (${sent.status})`);
      }
      onCreated((await sent.json()) as Project);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <label className="new-job">
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "Uploading..." : "Upload a PDF"}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="upload a PDF"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
    </label>
  );
};

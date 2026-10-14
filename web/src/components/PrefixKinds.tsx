import React, { useCallback, useEffect, useState } from "react";
import { api, send } from "../lib/api";
import { kindOptions } from "../lib/count";
import type { KindInfo } from "../lib/types";

export interface PrefixKind {
  prefix: string;
  kind: string;
  set_by: string;
  set_at: string;
}

interface ImportResult {
  applied: boolean;
  rows: number;
  problems: { line: number; prefix: string; problem: string }[];
  changes: { prefix: string; before: string | null; after: string }[];
}

/**
 * Project setting (Phase 10, owner decision 124): the estimators' mark prefix -> kind. Empty until a
 * person fills it or loads the owner's file. A mapped kind's new count pieces take that prefix as
 * their tag, and imported estimator markups take their kind from it. Every change is logged.
 */
export const PrefixKinds: React.FC<{
  projectId: string;
  kinds: KindInfo[];
  who: string;
  onError: (err: unknown) => void;
}> = ({ projectId, kinds, who, onError }) => {
  const [rows, setRows] = useState<PrefixKind[]>([]);
  const [prefix, setPrefix] = useState("");
  const [kind, setKind] = useState("");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const base = `/api/projects/${projectId}/prefix-kinds`;

  const load = useCallback(async () => {
    try {
      setRows((await api<{ rows: PrefixKind[] }>(base)).rows);
    } catch (err) {
      onError(err);
    }
  }, [base, onError]);
  useEffect(() => {
    void load();
  }, [load]);

  const set = async (p: string, k: string | null) => {
    try {
      const r = await send<{ rows: PrefixKind[] }>("PUT", base, {
        who: who.trim(),
        prefix: p,
        kind: k,
      });
      setRows(r.rows);
    } catch (err) {
      onError(err);
    }
  };

  const runImport = async (apply: boolean) => {
    try {
      const r = await send<ImportResult>("POST", `${base}/import`, {
        who: who.trim(),
        csv,
        apply,
      });
      setPreview(r);
      if (apply) {
        setCsv("");
        await load();
      }
    } catch (err) {
      onError(err);
    }
  };

  return (
    <details className="prefix-kinds" data-testid="prefix-kinds">
      <summary>Estimator mark prefixes ({rows.length})</summary>
      {rows.length === 0 && (
        <p className="hint" data-testid="prefix-kinds-empty">
          No prefix is mapped yet: new pieces use the kind list&apos;s own
          prefix.
        </p>
      )}
      <ul className="piece-list">
        {rows.map((r) => (
          <li key={r.prefix}>
            <b>{r.prefix}</b> <span className="kind">{r.kind}</span>{" "}
            <small>
              ({r.set_by}, {r.set_at.slice(0, 10)})
            </small>{" "}
            <button
              onClick={() => void set(r.prefix, null)}
              disabled={!who.trim()}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input
          value={prefix}
          onChange={(e) => setPrefix(e.target.value.toUpperCase())}
          placeholder="prefix"
          aria-label="mark prefix"
          maxLength={6}
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="kind of the prefix"
        >
          <option value="">kind...</option>
          {kindOptions(kinds).map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.kind}
            </option>
          ))}
        </select>
        <button
          disabled={!who.trim() || !/^[A-Z]{1,6}$/.test(prefix) || !kind}
          onClick={() => {
            void set(prefix, kind).then(() => setPrefix(""));
          }}
          data-testid="prefix-add"
        >
          Set
        </button>
      </div>
      <div className="row">
        <textarea
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
          }}
          placeholder={"prefix,kind\n..."}
          aria-label="prefix file"
          rows={3}
        />
        <button
          disabled={!who.trim() || !csv.trim()}
          onClick={() => void runImport(false)}
          data-testid="prefix-preview"
        >
          Preview file
        </button>
        <button
          disabled={
            !who.trim() ||
            !preview ||
            preview.applied ||
            preview.problems.length > 0 ||
            preview.changes.length === 0
          }
          onClick={() => void runImport(true)}
          data-testid="prefix-apply"
        >
          Apply
        </button>
      </div>
      {preview && (
        <p className="hint" data-testid="prefix-import-result">
          {preview.applied ? "applied: " : "preview: "}
          {preview.rows} rows, {preview.changes.length} changes,{" "}
          {preview.problems.length} problems
          {preview.problems.length > 0 &&
            ` (${preview.problems
              .map((p) => `line ${p.line}: ${p.problem}`)
              .join("; ")})`}
        </p>
      )}
    </details>
  );
};

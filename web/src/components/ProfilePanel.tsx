import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, send, ApiError } from "../lib/api";
import {
  NO_TEXT_NOTE,
  type MarkPreview,
  type MarkProposal,
  type Occurrence,
  type ProfileCounts,
  type ProfileProposal,
  type SearchResult,
} from "../lib/profile-callout";

export interface ProfileOverlay {
  occurrences: Occurrence[];
  proposals: MarkProposal[];
  unticked: ReadonlySet<string>;
  onToggle: (labelId: string) => void;
  pickable?: {
    label_id: string;
    canonical: string | null;
    box: [number, number, number, number];
  }[];
  onPick?: (canonical: string) => void;
}

/** Phase 0 profile from callout: the profile search (type a profile or click a label: every
 * occurrence is highlighted, with counts per sheet and per project), Mark all (proposed members,
 * dashed, nothing counted until accepted), the profiles on the sheet with live counts, and the
 * proposals for members that already exist (one undoable Apply). */
export const ProfilePanel: React.FC<{
  projectId: string;
  sheetId: string;
  who: string;
  noText: boolean;
  /** bumped when members or labels changed elsewhere, to reload the counts */
  version: number;
  onOverlay: (o: ProfileOverlay | null) => void;
  onChanged: (message: string) => void;
  onError: (e: unknown) => void;
}> = ({
  projectId,
  sheetId,
  who,
  noText,
  version,
  onOverlay,
  onChanged,
  onError,
}) => {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mark, setMark] = useState<MarkPreview | null>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<ProfileCounts | null>(null);
  const [proposals, setProposals] = useState<ProfileProposal[]>([]);
  const [picking, setPicking] = useState(false);
  const [labels, setLabels] = useState<NonNullable<ProfileOverlay["pickable"]>>(
    [],
  );
  const [reading, setReading] = useState(false);
  const seq = useRef(0);
  const base = `/api/projects/${projectId}`;
  const sheetBase = `${base}/sheets/${sheetId}`;

  const reload = useCallback(() => {
    void api<ProfileCounts>(`${base}/profile-counts?sheet_id=${sheetId}`)
      .then(setCounts)
      .catch(onError);
    void api<{ proposals: ProfileProposal[] }>(`${sheetBase}/profile-proposals`)
      .then((r) => setProposals(r.proposals))
      .catch(onError);
  }, [base, sheetBase, sheetId, onError]);

  useEffect(() => {
    reload();
  }, [reload, version]);

  const search = useCallback(
    (text: string) => {
      const t = text.trim();
      const mine = ++seq.current;
      setMark(null);
      setUnticked(new Set());
      if (!t) {
        setResult(null);
        setProblem(null);
        return;
      }
      void api<SearchResult>(
        `${base}/profile-search?q=${encodeURIComponent(t)}&sheet_id=${sheetId}`,
      )
        .then((r) => {
          if (mine !== seq.current) return;
          setResult(r);
          setProblem(null);
        })
        .catch((e: unknown) => {
          if (mine !== seq.current) return;
          setResult(null);
          setProblem(
            e instanceof ApiError && e.code === "not_a_profile"
              ? e.message
              : "Search failed",
          );
        });
    },
    [base, sheetId],
  );

  // live: search as the text is typed
  useEffect(() => {
    const id = setTimeout(() => search(q), 200);
    return () => clearTimeout(id);
  }, [q, search]);

  useEffect(() => {
    if (!picking) return;
    void api<{ labels: ((typeof labels)[number] & { text: string })[] }>(
      `${sheetBase}/profile-labels`,
    )
      .then((r) => setLabels(r.labels))
      .catch(onError);
  }, [picking, sheetBase, onError]);

  const toggle = useCallback((id: string) => {
    setUnticked((prev) => {
      const n = new Set(prev);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  }, []);

  useEffect(() => {
    if (!result && !picking) {
      onOverlay(null);
      return;
    }
    onOverlay({
      occurrences: result?.occurrences ?? [],
      proposals: mark?.proposals ?? [],
      unticked,
      onToggle: toggle,
      pickable: picking ? labels : undefined,
      onPick: (c) => {
        setQ(c);
        setPicking(false);
      },
    });
  }, [result, mark, unticked, picking, labels]);

  useEffect(() => () => onOverlay(null), []);

  const markAll = () =>
    void send<MarkPreview>("POST", `${sheetBase}/profile-search/mark`, {
      q,
      who,
    })
      .then((m) => {
        setMark(m);
        setUnticked(new Set());
      })
      .catch(onError);

  const accept = () =>
    void send<MarkPreview>("POST", `${sheetBase}/profile-search/mark`, {
      q,
      who,
      accept: true,
      unticked: [...unticked],
    })
      .then((m) => {
        setMark(null);
        onChanged(
          `${m.updated} members set, ${m.created} added from "${m.canonical}" (Ctrl+Z undoes)`,
        );
        search(q);
        reload();
      })
      .catch(onError);

  const apply = () =>
    void send<{ applied: number }>(
      "POST",
      `${sheetBase}/profile-proposals/apply`,
      { who },
    )
      .then((r) => {
        onChanged(`${r.applied} profiles changed (Ctrl+Z undoes all)`);
        reload();
      })
      .catch(onError);

  const readLabels = () => {
    setReading(true);
    void send("POST", `${sheetBase}/profile-labels/read`, { who })
      .then(() => onChanged("Reading the size labels of this sheet…"))
      .catch(onError)
      .finally(() => setReading(false));
  };

  const here = result?.occurrences.length ?? 0;
  const unread = counts ? counts.labels.sheets - counts.labels.read : 0;
  return (
    <div className="profile-panel" data-testid="profile-panel">
      {
        <div className="profile-body">
          {noText && (
            <div className="profile-note" data-testid="no-text-note">
              {NO_TEXT_NOTE}
            </div>
          )}
          <div className="profile-row">
            <input
              aria-label="profile search"
              placeholder="W12X26, HSS12X12X3/8, L3X3X1/4…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button
              aria-pressed={picking}
              title="Click a size label on the page"
              onClick={() => setPicking(!picking)}
            >
              Pick label
            </button>
          </div>
          {problem && (
            <div className="profile-problem" data-testid="profile-problem">
              {problem}
            </div>
          )}
          {result && (
            <div data-testid="profile-result">
              <div data-testid="profile-counts">
                <b>{result.canonical}</b>: {here} on this sheet, {result.total}{" "}
                in the project ({result.per_sheet.length} sheets)
              </div>
              <ul className="profile-sheets">
                {result.per_sheet.map((s) => (
                  <li key={s.sheet_id}>
                    Page {s.page_number}
                    {s.sheet_number ? ` (${s.sheet_number})` : ""}: {s.count}
                  </li>
                ))}
              </ul>
              {result.occurrences.some((o) => !o.valid) && (
                <div className="profile-note">
                  Grey = not in the AISC catalog: shown, never marked.
                </div>
              )}
              {!mark && here > 0 && (
                <button data-testid="mark-all" onClick={markAll}>
                  Mark all ({here})
                </button>
              )}
            </div>
          )}
          {mark && (
            <div data-testid="mark-preview">
              <div>
                {
                  mark.proposals.filter((p) => p.ticked && p.kind !== "invalid")
                    .length
                }{" "}
                of {mark.occurrences} ticked. Proposed members are dashed;
                nothing is counted until you accept.
              </div>
              <ul className="profile-proposals">
                {mark.proposals.map((p, i) => (
                  <li
                    key={`${p.label_id}-${i}`}
                    data-testid={`mark-${p.kind}`}
                    className={unticked.has(p.label_id) ? "off" : ""}
                  >
                    <label>
                      <input
                        type="checkbox"
                        disabled={
                          p.kind === "invalid" ||
                          (p.kind === "new" && !p.can_create)
                        }
                        checked={p.ticked && !unticked.has(p.label_id)}
                        onChange={() => toggle(p.label_id)}
                      />{" "}
                      {p.kind === "set" &&
                        (p.change
                          ? `${p.tag ?? "column"}: ${p.current ?? "—"} → ${p.proposed}`
                          : `${p.tag ?? "column"}: already ${p.proposed}`)}
                      {p.kind === "new" &&
                        `New member ${p.proposed} (${p.position})`}
                      {p.kind === "invalid" && `${p.text}: ${p.reason}`}
                    </label>
                    {p.kind !== "invalid" && (
                      <span className="muted"> {p.reason}</span>
                    )}
                  </li>
                ))}
              </ul>
              <button data-testid="mark-accept" onClick={accept}>
                Accept
              </button>{" "}
              <button onClick={() => setMark(null)}>Cancel</button>
            </div>
          )}
          {counts && counts.profiles.length > 0 && (
            <div data-testid="profile-list">
              <div className="profile-head">
                Profiles on this sheet / in the project
              </div>
              <ul>
                {counts.profiles
                  .filter((p) => p.sheet > 0)
                  .map((p) => (
                    <li key={p.profile}>
                      <button className="link" onClick={() => setQ(p.profile)}>
                        {p.profile}
                      </button>
                      : {p.sheet} / {p.project}
                      {!p.valid && " (not in catalog)"}
                      {p.existing > 0 && ` · ${p.existing} (E)`}
                    </li>
                  ))}
              </ul>
              {counts.joists.project > 0 && (
                <div data-testid="joist-count">
                  Joists (kept out of steel beams): {counts.joists.sheet} on
                  this sheet, {counts.joists.project} in the project
                </div>
              )}
            </div>
          )}
          {unread > 0 && (
            <div className="profile-note" data-testid="labels-unread">
              Size labels of {unread} sheet{unread === 1 ? "" : "s"} are not
              read yet (a Build reads them).{" "}
              <button disabled={reading} onClick={readLabels}>
                Read this sheet
              </button>
            </div>
          )}
          {proposals.length > 0 && (
            <div data-testid="profile-proposals">
              <div className="profile-head">
                {proposals.length} existing member
                {proposals.length === 1 ? "" : "s"} disagree with their own
                label
              </div>
              <ul className="profile-proposals">
                {proposals.map((p) => (
                  <li key={p.member_id}>
                    {p.tag ?? "column"}: {p.current ?? "—"} → {p.proposed}
                    {p.set_existing ? " · (E) existing" : ""}
                    <span className="muted"> {p.reason}</span>
                  </li>
                ))}
              </ul>
              <button data-testid="apply-proposals" onClick={apply}>
                Apply all (one action, Ctrl+Z undoes)
              </button>
            </div>
          )}
        </div>
      }
    </div>
  );
};

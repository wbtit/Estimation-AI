// Report of one work session from its FROZEN export (review/session-report.ts has the rules).
//   npm run session:report -- --dir fixtures/private/sessions/<session id> [--md <file>]
// Reads only the export directory (never the database). Prints the report as JSON (ids, page
// numbers, counts and times only); --md also writes the summary tables as Markdown.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  EXPORT_FILES,
  GROUPS,
  sessionReport,
  type GroupCounts,
  type SessionExport,
  type SessionReport,
} from '../review/session-report.js';

function load(dir: string): SessionExport {
  const read = (name: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
  const out: Record<string, unknown> = { manifest: read('manifest') };
  for (const k of EXPORT_FILES) out[k] = read(k);
  return out as unknown as SessionExport;
}

const pct = (v: number | null) => (v === null ? '-' : `${Math.round(v * 1000) / 10}%`);
const table = (head: string[], rows: (string | number | null)[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map((c) => (c === null ? '-' : String(c))).join(' | ')} |`),
  ].join('\n');
const kinds = (k: Record<string, number>) =>
  Object.entries(k)
    .map(([a, n]) => `${a} ${n}`)
    .join(', ') || '-';
const CLASS_COLS: [string, keyof GroupCounts][] = [
  ['system', 'system'],
  ['final', 'final'],
  ['kept', 'kept'],
  ['unchanged', 'unchanged'],
  ['of which approved', 'approved_unchanged'],
  ['deleted (FP)', 'deleted'],
  ['drawn (miss)', 'drawn'],
  ['size chg', 'size_changed'],
  ['length chg', 'length_changed'],
  ['kind chg', 'kind_changed'],
  ['ends moved', 'ends_moved'],
  ['drawn then deleted', 'drawn_then_deleted'],
  ['ignored', 'ignored'],
];

function markdown(r: SessionReport): string {
  const out: string[] = [];
  out.push('### Sessions\n');
  out.push(
    table(
      ['session', 'actor', 'project', 'start (UTC)', 'end', 'min', 'opened', 'built', 'saved'],
      r.sessions.map((s) => [
        s.session_id,
        s.actor,
        s.project_id.slice(0, 8),
        s.started_at,
        s.ended_at ?? 'OPEN',
        s.duration_min,
        s.pages_opened,
        s.pages_built,
        s.pages_saved,
      ]),
    ),
  );
  out.push(
    `\nRows with no session on the project that day (actor:action): ${kinds(r.no_session_actions)}\n`,
  );
  out.push('### Integrity\n');
  out.push(
    table(
      ['check', 'result', 'detail'],
      r.checks.map((c) => [
        c.id,
        c.pass ? 'PASS' : 'FAIL',
        JSON.stringify(c.detail).slice(0, 400).replace(/\|/g, '/'),
      ]),
    ),
  );
  for (const g of GROUPS) {
    out.push(`\n### ${g}: per built page\n`);
    out.push(
      table(
        ['page', ...CLASS_COLS.map((c) => c[0]), 'precision', 'recall'],
        r.built_pages
          .filter((p) => p.groups[g].system + p.groups[g].final + p.groups[g].drawn > 0)
          .map((p) => [
            p.page,
            ...CLASS_COLS.map((c) => p.groups[g][c[1]]),
            pct(p.groups[g].system ? p.groups[g].kept / p.groups[g].system : null),
            pct(p.groups[g].final ? p.groups[g].kept / p.groups[g].final : null),
          ])
          .concat([
            [
              'total',
              ...CLASS_COLS.map((c) => r.totals[g][c[1]]),
              pct(r.rates[g].precision),
              pct(r.rates[g].recall),
            ],
          ]),
      ),
    );
  }
  out.push('\n### Rates\n');
  out.push(
    table(
      ['group', 'precision', 'recall', 'precision (unchanged only)', 'recall (unchanged only)'],
      (['beams', 'columns', 'all'] as const).map((g) => [
        g,
        pct(r.rates[g].precision),
        pct(r.rates[g].recall),
        pct(r.rates[g].precision_strict),
        pct(r.rates[g].recall_strict),
      ]),
    ),
  );
  out.push('\n### Kinds per built page (system version -> final)\n');
  out.push(
    table(
      ['page', 'system', 'final', 'saved', 'notes'],
      r.built_pages.map((p) => [
        p.page,
        kinds(p.system_kinds),
        kinds(p.final_kinds),
        p.saved ? 'yes' : 'NO',
        p.notes.join('; ') || '-',
      ]),
    ),
  );
  const list = (xs: { page: number; role: string }[]) =>
    xs.map((p) => `${p.page} (${p.role})`).join(', ') || 'none';
  out.push(`\nPages opened but not built: ${list(r.pages_opened_not_built)}`);
  out.push(`\nPages built but not saved: ${list(r.pages_built_not_saved)}`);
  out.push(`\nPages saved without a Build: ${list(r.pages_saved_not_built)}\n`);
  out.push('### Timing per page\n');
  out.push(
    table(
      [
        'page',
        'opens',
        'actions',
        'open->first save (s)',
        'open->last action (s)',
        'active to save (s)',
        'active total (s)',
      ],
      r.timing.map((p) => [
        p.page,
        p.opens,
        p.actions,
        p.wall_to_save_s,
        p.wall_to_last_action_s,
        p.active_to_save_s,
        p.active_total_s,
      ]),
    ),
  );
  out.push(`\nTotals: ${JSON.stringify(r.timing_totals)}`);
  out.push(`\nGaps over 10 min with no row: ${JSON.stringify(r.idle_gaps_over_10_min)}\n`);
  out.push('### Labels (training data)\n');
  out.push(
    table(
      ['page', 'beams +', 'beams -', 'columns +', 'columns -', 'reliability notes'],
      r.built_pages
        .map((p) => [
          p.page,
          p.groups.beams.positives,
          p.groups.beams.negatives,
          p.groups.columns.positives,
          p.groups.columns.negatives,
          p.notes.join('; ') || '-',
        ])
        .concat([
          [
            'total',
            r.totals.beams.positives,
            r.totals.beams.negatives,
            r.totals.columns.positives,
            r.totals.columns.negatives,
            '',
          ],
        ]),
    ),
  );
  return out.join('\n') + '\n';
}

function main(): number {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, md: { type: 'string' } } });
  if (!values.dir) {
    console.error('usage: npm run session:report -- --dir <export dir> [--md <file>]');
    return 1;
  }
  const r = sessionReport(load(values.dir));
  if (values.md) fs.writeFileSync(values.md, markdown(r));
  console.log(JSON.stringify(r, null, 1));
  return 0;
}

process.exit(main());

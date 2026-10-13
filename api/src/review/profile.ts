// Steel profile text -> canonical form, for profiles a person types in the review screen.
// A port of worker/src/text_layer/parsers/profile.py (the source of truth) for the same families:
// W M S HP C MC L WT MT ST HSS PIPE PL ROD. Canonical form: uppercase, no spaces, "X" separator,
// fractions as written (1/4), decimals as decimals (0.25), mixed numbers with a hyphen (3-1/2).
// Parity with the Python parser is enforced by fixtures/synthetic/profile-cases.json, which both
// test suites read. No catalog is involved: the result is unvalidated until the AISC file arrives.
import { normalizeScaleText } from '../scale/index.js';

const X = String.raw`\s*[xX\u00d7\u2715\u2716]\s*`;
const DEC = String.raw`\d+(?:\.\d+)?`;
const START = String.raw`(?<![A-Za-z0-9])`;
const END = String.raw`(?![0-9/]|\.\d)`;
const INCH = String.raw`\s*(?:"|IN\b\.?)?\s*`;
const NUM = String.raw`(?:\d+\s+\d+\s*/\s*\d+|\d+\s*-\s*\d+\s*/\s*\d+|\d+\s*/\s*\d+|\d*\.\d+|\d+)`;

const RE_SIMPLE = new RegExp(
  `${START}(?<fam>WT|MT|ST|HP|MC|WF|W|M|S|C)\\s*(?<a>${DEC})${X}(?<b>${DEC})${END}`,
  'gi',
);
const RE_L = new RegExp(
  `${START}(?<fam>L)\\s*(?<a>${NUM})${X}(?<b>${NUM})${X}(?<c>${NUM})${END}`,
  'gi',
);
const RE_HSS = new RegExp(
  `${START}HSS\\s*(?<a>${NUM})${X}(?<b>${NUM})(?:${X}(?<c>${NUM}))?${END}`,
  'gi',
);
const RE_PIPE = new RegExp(
  `${START}PIPE\\s*(?<a>${NUM})${INCH}(?<cls>XXS|XXH|STD|XS|XH|SCH\\s*\\d+)?(?![A-Za-z0-9])`,
  'gi',
);
const RE_PL = new RegExp(
  `${START}PL\\s*(?<a>${NUM})${INCH}${X}(?<b>${NUM})${INCH}` +
    `(?:${X}(?<c>\\d+\\s*'(?:\\s*-?\\s*${NUM}\\s*")?|${NUM}"?))?${END}`,
  'gi',
);
const RE_ROD_PREFIX = new RegExp(`${START}ROD\\s*(?<a>${NUM})${END}`, 'gi');
const RE_ROD_SUFFIX = new RegExp(
  `(?<![0-9/.])(?<a>${NUM})${INCH}(?:\\u00d8|\\u00f8|\\u2205|DIA(?:METER)?\\.?)?\\s*` +
    `(?:THREADED\\s+|ALL[\\s-]?THREAD(?:ED)?\\s+|TIE\\s+|HIGH[\\s-]STRENGTH\\s+)?ROD(?![A-Za-z0-9])`,
  'gi',
);

const MIXED = /^(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)$/;
const FRAC = /^(\d+)\s*\/\s*(\d+)$/;

/** Value of a number written in the grammar above, or null (zero denominator, zero). */
export function numberValue(text: string): number | null {
  const t = text.trim();
  let m = MIXED.exec(t);
  if (m) return Number(m[3]) === 0 ? null : Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = FRAC.exec(t);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function canonicalNumber(text: string): string {
  const t = text.trim();
  let m = MIXED.exec(t);
  if (m) return `${m[1]}-${m[2]}/${m[3]}`;
  m = FRAC.exec(t);
  if (m) return `${m[1]}/${m[2]}`;
  return t.startsWith('.') ? `0${t}` : t;
}

export interface ParsedProfile {
  raw: string;
  family: string;
  canonical: string;
}

interface Found extends ParsedProfile {
  start: number;
  end: number;
}

function clean(text: string): string {
  return normalizeScaleText(text).replace(/\s+/g, ' ').trim();
}

function dims(...parts: (string | undefined)[]): string[] | null {
  const out: string[] = [];
  for (const p of parts) {
    if (p === undefined) continue;
    const v = numberValue(p);
    if (v === null || v <= 0) return null;
    out.push(canonicalNumber(p));
  }
  return out;
}

function collect(
  re: RegExp,
  text: string,
  build: (g: Record<string, string | undefined>) => { family: string; parts: string[] } | null,
): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(re)) {
    const built = build(m.groups ?? {});
    if (!built) continue;
    out.push({
      raw: m[0].replace(/\s+/g, ' ').trim(),
      family: built.family,
      canonical: built.family + built.parts.join('X'),
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    });
  }
  return out;
}

function findInternal(input: string): { text: string; found: Found[] } {
  const text = clean(input);
  const found: Found[] = [];
  found.push(
    ...collect(RE_HSS, text, (g) => {
      const d = dims(g.a, g.b, g.c);
      return d ? { family: 'HSS', parts: d } : null;
    }),
    ...collect(RE_L, text, (g) => {
      const d = dims(g.a, g.b, g.c);
      return d ? { family: 'L', parts: d } : null;
    }),
    ...collect(RE_SIMPLE, text, (g) => {
      const d = dims(g.a, g.b);
      if (!d) return null;
      const fam = (g.fam as string).toUpperCase();
      return { family: fam === 'WF' ? 'W' : fam, parts: d };
    }),
    ...collect(RE_PIPE, text, (g) => {
      const d = dims(g.a);
      if (!d) return null;
      const cls = (g.cls ?? '').toUpperCase().replace(/\s+/g, '');
      return { family: 'PIPE', parts: [d[0] + cls] };
    }),
    ...collect(RE_PL, text, (g) => {
      const d = dims(g.a, g.b);
      return d ? { family: 'PL', parts: d } : null;
    }),
  );
  for (const re of [RE_ROD_PREFIX, RE_ROD_SUFFIX]) {
    found.push(
      ...collect(re, text, (g) => {
        const d = dims(g.a);
        return d ? { family: 'ROD', parts: d } : null;
      }),
    );
  }
  found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Found[] = [];
  for (const f of found) {
    if (kept.length > 0 && f.start < kept[kept.length - 1].end) continue;
    kept.push(f);
  }
  return { text, found: kept };
}

export function findProfiles(input: string): ParsedProfile[] {
  return findInternal(input).found.map(({ raw, family, canonical }) => ({
    raw,
    family,
    canonical,
  }));
}

/** The profile if the whole text is exactly one profile expression, else null. */
export function parseProfile(input: string): ParsedProfile | null {
  const { text, found } = findInternal(input);
  if (found.length !== 1 || found[0].start !== 0 || found[0].end !== text.length) return null;
  const { raw, family, canonical } = found[0];
  return { raw, family, canonical };
}

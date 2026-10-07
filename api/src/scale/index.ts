// Drawing scale parsing for manual overrides: the whole text must be one scale expression.
// ratio = real length / drawn length, so 1/8" = 1'-0" is 96, 1" = 20' is 240, 1:50 is 50, and
// "not to scale" has no ratio. Mirrors worker/src/pdf_scan/scale.py (the extractor); both are
// tested against fixtures/synthetic/scale-cases.json.

export interface ParsedScale {
  /** The text with whitespace collapsed and typographic quotes/dashes as ASCII. */
  raw: string;
  kind: 'ratio' | 'nts';
  ratio: number | null;
}

// Typographic characters seen in CAD text, mapped to ASCII (written as code points, source stays ASCII).
const TRANSLATION = new Map<number, string>([
  [0x201d, '"'],
  [0x201c, '"'],
  [0x2033, '"'],
  [0x02ba, '"'],
  [0x2019, "'"],
  [0x2018, "'"],
  [0x2032, "'"],
  [0x02b9, "'"],
  [0x2013, '-'],
  [0x2014, '-'],
  [0x2212, '-'],
  [0x00a0, ' '],
]);

export function normalizeScaleText(text: string): string {
  let out = '';
  for (const ch of text) out += TRANSLATION.get(ch.codePointAt(0) ?? -1) ?? ch;
  return out.replace(/\s+/g, ' ').trim();
}

const NUM = String.raw`\d+(?:\.\d+)?`;
const FRAC = String.raw`\d+\s*/\s*\d+`;
const MIXED = String.raw`\d+\s+\d+\s*/\s*\d+`;
const VALUE = `(?:${MIXED}|${FRAC}|${NUM})`;
const INCH = String.raw`(?:"|IN(?:CH(?:ES)?)?\.?)`;
const FOOT = String.raw`(?:'|FT\.?|FEET|FOOT)`;

const IMPERIAL =
  String.raw`(?<left>${VALUE})\s*${INCH}\s*=\s*(?<feet>${NUM})\s*${FOOT}` +
  String.raw`(?:\s*-\s*(?<inches>${VALUE})\s*(?:${INCH})?)?`;
const RATIO = String.raw`1\s*:\s*(?<n>${NUM})`;
const NTS = String.raw`(?:N\.?\s?T\.?\s?S\.?|NOT\s+TO\s+SCALE)`;
const PREFIX = String.raw`(?:SCALE\s*:?\s*)?`;

const EXACT = new RegExp(
  `^${PREFIX}(?:(?<imperial>${IMPERIAL})|(?<ratio>${RATIO})|(?<nts>${NTS}))$`,
  'i',
);

/** "1 1/2", "3/4" or "1.5" as a number; null for a zero denominator. */
function value(text: string): number | null {
  const compact = text.trim();
  const parts = compact.split(/\s+/);
  const fraction = (s: string): number | null => {
    const [n, d] = s.split('/').map((x) => Number(x.trim()));
    return d === 0 ? null : (n as number) / (d as number);
  };
  if (parts.length === 2) {
    const frac = fraction((parts[1] as string).replace(/\s+/g, ''));
    return frac === null ? null : Number(parts[0]) + frac;
  }
  return compact.includes('/') ? fraction(compact.replace(/\s+/g, '')) : Number(compact);
}

/** Parses text that is entirely one scale expression (optional "SCALE:" prefix). Null otherwise. */
export function parseScaleExact(text: string): ParsedScale | null {
  const clean = normalizeScaleText(text);
  const m = EXACT.exec(clean);
  if (!m?.groups) return null;
  const g = m.groups;
  if (g.nts) return { raw: clean, kind: 'nts', ratio: null };
  if (g.ratio) {
    const n = Number(g.n);
    return n > 0 ? { raw: clean, kind: 'ratio', ratio: n } : null;
  }
  const left = value(g.left as string);
  const feet = value(g.feet as string);
  const inches = g.inches ? value(g.inches) : 0;
  if (left === null || feet === null || inches === null) return null;
  const real = feet * 12 + inches;
  return left > 0 && real > 0 ? { raw: clean, kind: 'ratio', ratio: real / left } : null;
}

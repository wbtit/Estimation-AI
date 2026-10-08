// Steel joist designations (K, LH and DLH series), the TypeScript twin of
// worker/src/text_layer/parsers/joist.py. Parity is enforced by fixtures/synthetic/joist-cases.json.
// A joist is NEVER matched to the AISC shape catalog: this only says the text has the form of a
// joist designation. Depths and series numbers are not checked (no table is invented here).

export interface Joist {
  raw: string;
  canonical: string;
  series: 'K' | 'LH' | 'DLH';
  depth: string;
  number: string;
}

const BODY = '(?<depth>\\d{1,3})[\\s-]*(?<series>DLH|LH|K)[\\s-]*(?<number>\\d{1,2})';
const WHOLE = new RegExp(`^\\s*${BODY}\\s*$`, 'i');
const FIND = new RegExp(`(?<![A-Za-z0-9./-])${BODY}(?![A-Za-z0-9])`, 'gi');

function make(m: RegExpMatchArray): Joist {
  const g = m.groups as { depth: string; series: string; number: string };
  const series = g.series.toUpperCase() as Joist['series'];
  return {
    raw: m[0].trim(),
    canonical: `${g.depth}${series}${g.number}`,
    series,
    depth: g.depth,
    number: g.number,
  };
}

export function parseJoist(text: string): Joist | null {
  const m = WHOLE.exec(text);
  return m ? make(m) : null;
}

export function findJoists(text: string): Joist[] {
  return [...text.matchAll(FIND)].map(make);
}

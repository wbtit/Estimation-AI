// Plain highlighting of words an estimator looks for in the general notes. No parsing into fields.

export const NOTE_TERMS = [
  "A992",
  "A36",
  "A500",
  "A572",
  "A53",
  "A325",
  "A490",
  "A307",
  "F1852",
  "galvaniz",
  "primer",
  "shop paint",
  "bolt",
];

export interface Piece {
  text: string;
  hit: boolean;
}

/** Splits text into pieces; pieces with hit=true match one of the terms (case-insensitive, "A36" not inside "A365"). */
export function highlight(text: string, terms: string[] = NOTE_TERMS): Piece[] {
  const parts = terms
    .filter((t) => t.trim() !== "")
    .map((t) => {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return /^[A-Za-z]\d+$/.test(t) ? `${esc}(?!\\d)` : esc;
    });
  if (parts.length === 0) return [{ text, hit: false }];
  const rx = new RegExp(`(${parts.join("|")})`, "gi");
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(rx)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start), hit: false });
    out.push({ text: m[0], hit: true });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length > 0 ? out : [{ text, hit: false }];
}

/** Lines that contain the search text (case-insensitive); an empty search keeps all. */
export function searchLines<T extends { text: string }>(
  lines: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  return q === ""
    ? lines
    : lines.filter((l) => l.text.toLowerCase().includes(q));
}

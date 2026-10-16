// Imperial input and display (Phase 11b, owner addition A): elevations and lengths are typed and
// shown in feet-inches and stored in mm. Accepted forms:
//   13'-3 1/2"   13'-3-1/2"   13'-3.5"   13' 3"   13'3"   13'   13.29'   3 1/2"   3.5"   1/2"
// with an optional leading minus sign, typographic quotes (’ ′ ” ″), and '' for inches. A bare
// number has no unit and is refused (null), as is anything else. Display is to 1/16".
import { mmToFeetInches } from "./geometry";

const MM_PER_INCH = 25.4;

function normalise(text: string): string {
  return text
    .trim()
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/''/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ");
}

/** Inches as written: "3", "3.5", "1/2", "3 1/2", "3-1/2". */
function inchValue(text: string): number | null {
  const t = text.trim();
  let m = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  m = /^(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m)
    return Number(m[3]) === 0
      ? null
      : Number(m[1]) + Number(m[2]) / Number(m[3]);
  return null;
}

/** Millimetres of a feet-inches text, or null when it is not one. */
export function parseFtIn(input: string): number | null {
  let t = normalise(input);
  if (t === "") return null;
  let sign = 1;
  if (t.startsWith("-")) {
    sign = -1;
    t = t.slice(1).trim();
  } else if (t.startsWith("+")) t = t.slice(1).trim();
  // feet with inches: 13'-3 1/2"  13' 3"  13'3"  (inch mark optional after a foot mark)
  let m = /^(\d+(?:\.\d+)?)\s*'\s*-?\s*(.+?)\s*"?$/.exec(t);
  if (m && m[2] !== undefined && m[2] !== "") {
    const inches = inchValue(m[2]);
    if (inches === null || inches >= 12) return null;
    return sign * (Number(m[1]) * 12 + inches) * MM_PER_INCH;
  }
  m = /^(\d+(?:\.\d+)?)\s*'$/.exec(t); // feet only, decimal allowed
  if (m) return sign * Number(m[1]) * 12 * MM_PER_INCH;
  m = /^(.+?)\s*"$/.exec(t); // inches only
  if (m && m[1] !== undefined) {
    const inches = inchValue(m[1]);
    return inches === null ? null : sign * inches * MM_PER_INCH;
  }
  return null;
}

/** Millimetres as feet-inches to 1/16": 4051.3 -> 13'-3 1/2". */
export function formatFtIn(mm: number | null | undefined): string {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return "—";
  return mmToFeetInches(mm, 16);
}

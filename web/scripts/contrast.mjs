// WCAG contrast check of the design tokens (src/styles.css :root), Option B "Graphite".
//   node scripts/contrast.mjs [--json]      exit 1 when a pair fails
// Text needs 4.5:1, icons / control borders / marks 3:1. A live-DOM audit of the rendered app is a
// separate step (see the README, "Workspace layout"); this one checks every colour the CSS is made of.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/styles.css"),
  "utf8",
);
const root = css.slice(
  css.indexOf(":root {"),
  css.indexOf("}", css.indexOf(":root {")),
);
const raw = {};
for (const m of root.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g))
  raw[m[1]] = m[2].trim();
const tok = (n, seen = 0) => {
  const v = raw[n];
  if (v === undefined) throw new Error(`token --${n} not found`);
  const ref = v.match(/^var\(--([a-z0-9-]+)\)$/);
  return ref && seen < 5 ? tok(ref[1], seen + 1) : v;
};
const hex = (n) => {
  const v = n.startsWith("#") ? n : tok(n);
  if (!/^#[0-9a-f]{6}$/i.test(v))
    throw new Error(`--${n} is not a #rrggbb colour (${v})`);
  return v;
};
const lum = (h) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const TEXT = 4.5;
const GRAPHIC = 3;
const surfaces = ["shell", "card", "shell-input", "shell-3", "canvas"];
const checks = [];
const add = (group, name, fg, bg, need) =>
  checks.push({ group, name, fg, bg, need });
for (const s of surfaces) {
  add("text", "text", "text", s, TEXT);
  add("text", "muted text", "muted", s, TEXT);
  add("text", "link / accent text", "accent", s, TEXT);
  add("status text", "approved / done (green)", "ok-text", s, TEXT);
  add("status text", "check (amber)", "warn-text", s, TEXT);
  add("status text", "problem (red)", "bad-text", s, TEXT);
}
add("text", "shell text", "shell-text", "shell", TEXT);
add("text", "shell muted text", "shell-muted", "shell", TEXT);
add("text", "text on accent button / active rail", "on-accent", "accent", TEXT);
for (const s of ["shell", "card", "shell-input", "shell-3", "canvas"]) {
  add("controls", "control border", "control-border", s, GRAPHIC);
  add("controls", "icon", "icon", s, GRAPHIC);
}
add("controls", "focus ring / active icon", "accent", "shell", GRAPHIC);
add("controls", "focus ring on canvas", "accent", "canvas", GRAPHIC);
// marks sit on the drawing (white, a faded white, or a grey scan): the core colour against white
// and the grey, plus the casing and the halo that carry them on anything
const drawing = "#ffffff";
const scan = "#c9ced6";
for (const k of [
  "beam",
  "column",
  "review",
  "attention",
  "approved",
  "stud",
  "angle",
  "find",
  "capture",
]) {
  add("marks on white", k, k, drawing, GRAPHIC);
}
for (const k of [
  "beam",
  "column",
  "review",
  "attention",
  "approved",
  "stud",
  "angle",
  "find",
  "capture",
]) {
  add("marks on a grey scan", k, k, scan, GRAPHIC);
}
add(
  "marks (casing)",
  "casing against the white halo",
  "casing",
  drawing,
  GRAPHIC,
);
add(
  "marks (casing)",
  "selection yellow against its casing",
  "select",
  "casing",
  GRAPHIC,
);

// white text on the page-card status tags (theme.css / styles.css)
for (const [name, bg] of [
  ["Built / Reviewed", "#136b2e"],
  ["Scale needed / Requesting build / Not built", "orange"],
  ["Not confirmed", "#7c3aed"],
  ["Building", "#2563eb"],
  ["Failed", "#c62828"],
  ["Estimating / Skip", "slate"],
])
  add("status tags", name, "#ffffff", bg, TEXT);

const rows = checks.map((c) => {
  const r = ratio(c.fg, c.bg);
  return { ...c, ratio: Math.round(r * 100) / 100, pass: r >= c.need };
});
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  let g = "";
  for (const r of rows) {
    if (r.group !== g) console.log(`\n${(g = r.group).toUpperCase()}`);
    const fg = r.fg.startsWith("#") ? r.fg : hex(r.fg);
    const bg = r.bg.startsWith("#") ? r.bg : hex(r.bg);
    console.log(
      `  ${r.pass ? "PASS" : "FAIL"}  ${r.ratio.toFixed(2).padStart(5)}:1 (need ${r.need})  ${r.name.padEnd(38)} ${fg} on ${r.bg} ${bg}`,
    );
  }
  const fails = rows.filter((r) => !r.pass);
  const min = (grp) =>
    Math.min(...rows.filter((r) => grp.includes(r.group)).map((r) => r.ratio));
  console.log(
    `\n${rows.length} pairs, ${fails.length} failing. Lowest: text ${min(["text", "status text"])}:1, controls ${min(["controls"])}:1, marks ${min(["marks on white", "marks on a grey scan", "marks (casing)"])}:1`,
  );
  process.exitCode = fails.length ? 1 : 0;
}

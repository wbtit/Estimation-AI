// Phase 0 column orientation: the shared synthetic cases (fixtures/synthetic/orientation-cases.json) run
// by this copy and by the API's copy of the algorithm.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  glyphCentre,
  ownSymbolSize,
  refineCentre,
  snapOrientation,
  markerRotation,
  orientationFromRotation,
  readOrientation,
  rotated,
  type LineRow,
} from '../review/orientation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const spec = JSON.parse(
  fs.readFileSync(path.join(root, 'fixtures/synthetic/orientation-cases.json'), 'utf8'),
) as {
  ratio: number;
  cases: {
    name: string;
    kind: string;
    orientation: number;
    diamond?: boolean;
    diamondSide?: number;
    centrelines?: boolean;
    neighbour?: boolean;
    grid?: number[];
    expect: { deg: number | null; state: string };
  }[];
};
const K = 72 / spec.ratio; // points per real inch
const CX = 400;
const CY = 300;

type P = [number, number];
const row = (a: P, b: P): LineRow => [a[0], a[1], b[0], b[1], 1, 0.5, 1, 0];
function loop(pts: P[]): LineRow[] {
  return pts.map((p, i) => row(p, pts[(i + 1) % pts.length]!));
}
/** Points in inches, centred, web vertical, turned clockwise on screen by `r` degrees. */
function turn(pts: P[], r: number): P[] {
  const c = Math.cos((r * Math.PI) / 180);
  const s = Math.sin((r * Math.PI) / 180);
  return pts.map(([x, y]) => [CX + (x * c - y * s) * K, CY + (x * s + y * c) * K] as P);
}
const iShape = (d: number, bf: number, tf: number, tw: number): P[] => [
  [-bf / 2, -d / 2],
  [bf / 2, -d / 2],
  [bf / 2, -d / 2 + tf],
  [tw / 2, -d / 2 + tf],
  [tw / 2, d / 2 - tf],
  [bf / 2, d / 2 - tf],
  [bf / 2, d / 2],
  [-bf / 2, d / 2],
  [-bf / 2, d / 2 - tf],
  [-tw / 2, d / 2 - tf],
  [-tw / 2, -d / 2 + tf],
  [-bf / 2, -d / 2 + tf],
];
const rectPts = (w: number, h: number): P[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

/** The lines of a case: a column (and a diamond around it) turned so its web / long side has the
 * case's counter-clockwise orientation. */
function linesOf(c: (typeof spec.cases)[number]): LineRow[] {
  const r = (((90 - c.orientation) % 180) + 180) % 180; // marker rotation: web vertical at 0
  let out: LineRow[] = [];
  if (c.kind === 'w') out = loop(turn(iShape(12.1, 10, 0.576, 0.345), r));
  else if (c.kind === 'w3s') {
    // a W8 (8 x 8 in) as three strokes
    const [f1, f2, web] = [
      turn(
        [
          [-4, -4],
          [4, -4],
        ],
        r,
      ),
      turn(
        [
          [-4, 4],
          [4, 4],
        ],
        r,
      ),
      turn(
        [
          [0, -4],
          [0, 4],
        ],
        r,
      ),
    ];
    out = [row(f1[0]!, f1[1]!), row(f2[0]!, f2[1]!), row(web[0]!, web[1]!)];
  } else if (c.kind === 'w3') {
    // three strokes joined T-fashion: two flanges and a web that ends on their middles
    const [f1, f2, web] = [
      turn(
        [
          [-5, -6.05],
          [5, -6.05],
        ],
        r,
      ),
      turn(
        [
          [-5, 6.05],
          [5, 6.05],
        ],
        r,
      ),
      turn(
        [
          [0, -6.05],
          [0, 6.05],
        ],
        r,
      ),
    ];
    out = [row(f1[0]!, f1[1]!), row(f2[0]!, f2[1]!), row(web[0]!, web[1]!)];
  } else if (c.kind === 'wcp') {
    out = loop(turn(iShape(12.1, 10, 0.576, 0.345), r));
    out.push(
      ...loop(
        turn(
          rectPts(14, 0.75).map(([x, y]) => [x, y - 6.45] as P),
          r,
        ),
      ),
    );
    out.push(
      ...loop(
        turn(
          rectPts(14, 0.75).map(([x, y]) => [x, y + 6.45] as P),
          r,
        ),
      ),
    );
  } else if (c.kind === 'hss_rect') {
    out = [...loop(turn(rectPts(4, 8), r)), ...loop(turn(rectPts(3.4, 7.4), r))];
  } else if (c.kind === 'hss_sq') {
    const sr = ((-c.orientation % 90) + 90) % 90;
    out = [...loop(turn(rectPts(6, 6), sr)), ...loop(turn(rectPts(5.4, 5.4), sr))];
  } else {
    const ring = (rad: number) =>
      Array.from(
        { length: 24 },
        (_, i) => [rad * Math.cos((i * Math.PI) / 12), rad * Math.sin((i * Math.PI) / 12)] as P,
      );
    out = [...loop(turn(ring(4), 0)), ...loop(turn(ring(3.5), 0))];
  }
  if (c.diamond) out.push(...loop(turn(rectPts(c.diamondSide ?? 30, c.diamondSide ?? 30), 45)));
  if (c.neighbour) {
    // a two-line HSS pair beside the column, partly inside its reading window
    out.push(
      row([CX + 0.8, CY - 4.0], [CX + 4.2, CY - 4.0]),
      row([CX + 0.8, CY - 2.9], [CX + 4.2, CY - 2.9]),
    );
  }
  if (c.centrelines) {
    // long lines along the page axes through the centre, drawn over the web (54 pt = 144 in at 1/16")
    out.push(row([CX - 27, CY], [CX + 27, CY]), row([CX, CY - 27], [CX, CY + 27]));
  }
  return out;
}
function boxOf(lines: LineRow[], c: (typeof spec.cases)[number]): [number, number, number, number] {
  if (c.diamond) {
    // the diamond is the capture box when there is one: a square turned 45 degrees, half-width s / sqrt 2
    const h = ((c.diamondSide ?? 30) / Math.SQRT2) * K;
    return [CX - h, CY - h, CX + h, CY + h];
  }
  const use = c.centrelines ? lines.slice(0, -2) : c.neighbour ? lines.slice(0, -2) : lines;
  const xs = use.flatMap((l) => [l[0]!, l[2]!]);
  const ys = use.flatMap((l) => [l[1]!, l[3]!]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
const FAMILY: Record<string, string> = {
  w: 'w_shape',
  w3: 'w_shape',
  w3s: 'w_shape',
  wcp: 'w_cover_plates',
  hss_rect: 'hss_rect',
  hss_sq: 'hss_square',
  hss_round: 'hss_round',
};

describe('shared orientation cases', () => {
  for (const c of spec.cases) {
    it(c.name, () => {
      const lines = linesOf(c);
      const got = readOrientation({
        lines,
        box: boxOf(lines, c),
        family: FAMILY[c.kind]!,
        ratio: spec.ratio,
        grid: c.grid,
      });
      expect(got.state).toBe(c.expect.state);
      if (c.expect.deg === null) expect(got.deg).toBeNull();
      else {
        const period = c.kind === 'hss_sq' ? 90 : 180;
        const diff = Math.abs(
          ((got.deg! - c.expect.deg + period / 2 + period) % period) - period / 2,
        );
        expect(diff).toBeLessThanOrEqual(0.6);
      }
    });
  }
});

describe('the diamond never outvotes the column (the fix)', () => {
  it('reads the W, not the diamond, even when the diamond is the whole capture box', () => {
    for (const orientation of [0, 90]) {
      const c = {
        name: 'x',
        kind: 'w',
        orientation,
        diamond: true,
        expect: { deg: orientation, state: 'clear' },
      };
      const lines = linesOf(c);
      const withDiamond = readOrientation({
        lines,
        box: boxOf(lines, c),
        family: 'w_shape',
        ratio: spec.ratio,
      });
      expect(withDiamond.deg).toBeCloseTo(orientation, 0);
      // the diamond's own direction (45 / 135) is never the answer
      expect([45, 135]).not.toContain(Math.round(withDiamond.deg ?? -1));
    }
  });
  it('a known section size narrows the window without changing the answer', () => {
    const c = {
      name: 'x',
      kind: 'w',
      orientation: 0,
      diamond: true,
      expect: { deg: 0, state: 'clear' },
    };
    const lines = linesOf(c);
    const got = readOrientation({
      lines,
      box: boxOf(lines, c),
      family: 'w_shape',
      ratio: spec.ratio,
      sizeIn: [10, 12.1],
    });
    expect(got).toMatchObject({ deg: 0, state: 'clear' });
  });
});

describe('no lines, conventions and manual steps', () => {
  it('without lines the box gives an amber guess', () => {
    const g = readOrientation({
      lines: [],
      box: [0, 0, 4, 6],
      family: 'w_shape',
      ratio: 192,
    });
    expect(g).toMatchObject({ deg: 90, state: 'unsure', reason: 'no_lines' });
    const sq = readOrientation({
      lines: [],
      box: [0, 0, 5, 5],
      family: 'w_shape',
      ratio: 192,
    });
    expect(sq.deg).toBeNull();
  });
  it('the marker rotation is (90 - orientation) mod 180 and back', () => {
    expect(markerRotation(90)).toBe(0);
    expect(markerRotation(0)).toBe(90);
    expect(markerRotation(120)).toBe(150);
    expect(orientationFromRotation(markerRotation(37))).toBeCloseTo(37);
  });
  it("R turns 90 degrees, Shift+R 15, within the symbol's symmetry", () => {
    expect(rotated(90, 'w_shape', 90)).toBe(0);
    expect(rotated(0, 'w_shape', 90)).toBe(90);
    expect(rotated(0, 'w_shape', 15)).toBe(165);
    expect(rotated(0, 'hss_square', 90)).toBe(0); // 90 degree symmetric
    expect(rotated(0, 'hss_square', 15)).toBe(75);
  });
});

describe('Phase 0 fixes: own-symbol size hint, rotate snap, centre refinement', () => {
  const sym = (family: string, cx: number, real: number[]) => ({
    family,
    centre: [cx, 100],
    real_in: real,
  });
  it("a size hint comes only from the column's OWN symbol: its family, within 5 in", () => {
    const at: [number, number] = [100, 100];
    // 5 in = 2.8 pt at 1/8 inch scale (ratio 128)
    expect(ownSymbolSize([sym('w_shape', 101.5, [10, 12])], at, 'w_shape', 128)).toEqual([10, 12]);
    expect(ownSymbolSize([sym('w_shape', 104, [10, 12])], at, 'w_shape', 128)).toBeNull(); // 7 in away
    expect(ownSymbolSize([sym('hss_rect', 103, [4, 8])], at, 'w_shape', 128)).toBeNull(); // a neighbour
    expect(ownSymbolSize([sym('hss_rect', 100.5, [4, 8])], at, 'w_shape', 128)).toBeNull(); // not its family
    const near = [sym('w_shape', 102, [12, 14]), sym('w_shape', 101, [10, 12.1])];
    expect(ownSymbolSize(near, at, 'w_shape', 128)).toEqual([10, 12.1]); // the nearest
  });
  it('the handle snaps to 0, 90, 45 and the grid within 3 degrees; otherwise it keeps the angle', () => {
    expect(snapOrientation(178, 'w_shape')).toBe(0);
    expect(snapOrientation(179, 'w_shape')).toBe(0);
    expect(snapOrientation(87, 'w_shape')).toBe(90);
    expect(snapOrientation(89, 'w_shape')).toBe(90);
    expect(snapOrientation(43, 'w_shape')).toBe(45);
    expect(snapOrientation(40, 'w_shape')).toBe(40);
    expect(snapOrientation(31, 'w_shape', [33, 123])).toBe(33);
    expect(snapOrientation(88, 'hss_square')).toBe(0); // 90 degree symmetric: 88 is 2 degrees from 90 = 0
    expect(snapOrientation(47, 'hss_square')).toBe(45);
    expect(snapOrientation(60.4, 'w_shape')).toBe(60);
  });
  it("a centre is refined to the symbol's own centre only 2.5 to 5 in away; never otherwise", () => {
    const ratio = 128; // 1 pt = 1.78 in
    const g: [number, number] = [100, 100];
    expect(refineCentre([101, 100], g, ratio).moved).toBe(false); // 1.8 in: already right
    expect(refineCentre([102, 100], g, ratio)).toMatchObject({
      moved: true,
      centre: g,
    }); // 3.6 in
    expect(refineCentre([102.8, 100], g, ratio).moved).toBe(true); // 5.0 in
    expect(refineCentre([104, 100], g, ratio).moved).toBe(false); // 7 in: a different object
    expect(refineCentre([102, 100], null, ratio)).toMatchObject({
      moved: false,
      centre: [102, 100],
    });
    expect(
      glyphCentre({
        deg: 0,
        state: 'clear',
        reason: 'x',
        box: [10, 20, 14, 30],
      }),
    ).toEqual([12, 25]);
  });
});

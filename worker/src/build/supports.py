"""Step 7: support nodes, the support order (columns, then girders, then beams) and the pieces.

Support nodes come from, in this order (owner decision, Phase 11):
  a. column glyphs on the page inside the crop: a glyph is a support when it sits at a grid
     crossing or when at least GLYPH_MIN_LINES beam lines touch it; on a column plan page every
     column found there is a support (Phase 12a, rule "column_plan_supports": the page has no
     beams, so its columns are projected to the framing pages whatever touches them);
  b. columns projected from the column plan through the grid registration (skipped when the page
     has no registration); a projected column within NODE_MERGE_PT of a glyph node is that node;
  c. beam-to-beam intersections, found while the order below is worked out.
Grids are never required: a page without grid or registration is built from (a) and (c).

Order (the Alberta order): a beam line that meets at least two columns is a girder (level 1).
Then, round by round, a line that meets at least two supports among the columns and the lines of
earlier rounds gets the next level (a line of the same round never supports another). A beam line
is split only at its supports of an earlier level (a girder at columns; a beam at columns, girders
and earlier beams), never by members that frame into it. The pieces between supports are B_1, B_2
... along the line from its first end. A line end that is not at a support makes an unsupported end:
that piece is kept and flagged, never dropped. An overhang shorter than END_TRIM_PT past the last
support is drawing slack, not a piece (the trimmed length is kept as evidence).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from src.build.beam_lines import BeamLine
from src.build.columns import Glyph
from src.build.geom import Pt, angle_deg, angle_diff, box_dist, point_at, project, seg_intersection

GLYPH_PAD_PT = 4.0  # a line passing within half the glyph diagonal + this goes through it
SNAP_COLUMN_PT = 12.0  # a line end this close to a column glyph box (or projected point) meets it
GLYPH_MIN_LINES = 2
NODE_MERGE_PT = 12.0
SNAP_BEAM_PT = 12.0  # a line end reaches a supporting line within this extension
SUPPORT_EXT_PT = 2.0  # the supporting line itself is extended only this much
MIN_CROSS_ANGLE_DEG = 10.0
HIT_MERGE_PT = 6.0
END_TRIM_PT = 12.0
MAX_ROUNDS = 20


@dataclass
class Node:
    id: int
    point: Pt
    source: str  # glyph, projected, beam_intersection
    radius: float = 0.0
    glyph: int | None = None
    evidence: dict = field(default_factory=dict)


@dataclass
class Hit:
    s: float  # along the line from p0, pt
    node: int
    kind: str  # column or beam


@dataclass
class Piece:
    line: int
    index: int
    a: Pt
    b: Pt
    start_node: int | None
    end_node: int | None
    trimmed_pt: float = 0.0

    @property
    def support_state(self) -> str:
        n = (self.start_node is not None) + (self.end_node is not None)
        return ("none", "one", "both")[n]

    @property
    def length_pt(self) -> float:
        return math.dist(self.a, self.b)


@dataclass
class SupportResult:
    nodes: list[Node]
    lines: list[BeamLine]
    pieces: list[Piece]
    counts: dict[str, int]


class _LineIndex:
    CELL = 100.0

    def __init__(self, lines: list[BeamLine], pad: float):
        self.cells: dict[tuple[int, int], list[int]] = {}
        for ln in lines:
            for key in self._keys(ln.p0, ln.p1, pad):
                self.cells.setdefault(key, []).append(ln.id)

    def _keys(self, a: Pt, b: Pt, pad: float):
        x0, x1 = sorted((a[0], b[0]))
        y0, y1 = sorted((a[1], b[1]))
        for gx in range(int((x0 - pad) // self.CELL), int((x1 + pad) // self.CELL) + 1):
            for gy in range(int((y0 - pad) // self.CELL), int((y1 + pad) // self.CELL) + 1):
                yield (gx, gy)

    def near(self, a: Pt, b: Pt, pad: float) -> list[int]:
        out: set[int] = set()
        for key in self._keys(a, b, pad):
            out.update(self.cells.get(key, ()))
        return sorted(out)


def _glyph_hit(ln: BeamLine, g: Glyph) -> float | None:
    """Position along the line where it meets the glyph, or None."""
    along, perp = project(g.centre, ln.p0, ln.p1)
    if perp <= g.half_diag + GLYPH_PAD_PT and -g.half_diag <= along <= ln.length + g.half_diag:
        return min(max(along, 0.0), ln.length)
    if box_dist(ln.p0, g.box) <= SNAP_COLUMN_PT:
        return 0.0
    if box_dist(ln.p1, g.box) <= SNAP_COLUMN_PT:
        return ln.length
    return None


def _point_hit(ln: BeamLine, p: Pt) -> float | None:
    along, perp = project(p, ln.p0, ln.p1)
    if perp <= SNAP_COLUMN_PT and -SNAP_COLUMN_PT <= along <= ln.length + SNAP_COLUMN_PT:
        return min(max(along, 0.0), ln.length)
    return None


def column_nodes(
    lines: list[BeamLine],
    glyphs: list[Glyph],
    projected: list[tuple[Pt, dict]],
    all_columns: bool = False,
) -> list[Node]:
    """Rules (a) and (b): the column support nodes of the page."""
    nodes: list[Node] = []
    idx = _LineIndex(lines, SNAP_COLUMN_PT + 30.0)
    for gi, g in enumerate(glyphs):
        touching = [
            j
            for j in idx.near(g.centre, g.centre, g.half_diag + SNAP_COLUMN_PT)
            if _glyph_hit(lines[j], g) is not None
        ]
        if all_columns or g.at_grid or len(touching) >= GLYPH_MIN_LINES:
            rule = (
                "at_grid"
                if g.at_grid
                else "lines_meet"
                if len(touching) >= GLYPH_MIN_LINES
                else "column_plan"
            )
            ev = {"rule": rule, "lines": len(touching)}
            if g.grid is not None:
                ev["grid"] = [g.grid.n_label, g.grid.a_label]
            nodes.append(Node(len(nodes), g.centre, "glyph", g.half_diag, gi, ev))
    for p, ev in projected:
        near = [n for n in nodes if n.source == "glyph" and math.dist(n.point, p) <= NODE_MERGE_PT]
        if near:
            near[0].evidence["also_projected"] = True
            continue
        nodes.append(Node(len(nodes), p, "projected", 0.0, None, dict(ev)))
    return nodes


def _column_hits(ln: BeamLine, nodes: list[Node], glyphs: list[Glyph]) -> list[Hit]:
    out = []
    for n in nodes:
        if n.source == "glyph":
            assert n.glyph is not None
            s = _glyph_hit(ln, glyphs[n.glyph])
        elif n.source == "projected":
            s = _point_hit(ln, n.point)
        else:
            continue
        if s is not None:
            out.append(Hit(s, n.id, "column"))
    return out


def _beam_hit(ln: BeamLine, other: BeamLine) -> float | None:
    if angle_diff(angle_deg(ln.p0, ln.p1), angle_deg(other.p0, other.p1)) < MIN_CROSS_ANGLE_DEG:
        return None
    hit = seg_intersection(ln.p0, ln.p1, other.p0, other.p1, SNAP_BEAM_PT, SUPPORT_EXT_PT)
    if hit is None:
        return None
    return min(max(hit[0], 0.0), ln.length)


def _merge_hits(hits: list[Hit]) -> list[Hit]:
    """Hits closer than HIT_MERGE_PT are one support; a column wins over a beam."""
    hits = sorted(hits, key=lambda h: (h.s, 0 if h.kind == "column" else 1, h.node))
    out: list[Hit] = []
    for h in hits:
        if out and h.s - out[-1].s < HIT_MERGE_PT:
            if out[-1].kind != "column" and h.kind == "column":
                out[-1] = h
            continue
        out.append(h)
    return out


def build(
    lines: list[BeamLine],
    glyphs: list[Glyph],
    projected: list[tuple[Pt, dict]],
    all_columns: bool = False,
) -> SupportResult:
    nodes = column_nodes(lines, glyphs, projected, all_columns)
    col_idx: dict[int, list[Hit]] = {}
    pad = max([g.half_diag for g in glyphs] + [0.0]) + SNAP_COLUMN_PT
    node_cells: dict[tuple[int, int], list[Node]] = {}
    cell = 100.0
    for n in nodes:
        node_cells.setdefault((int(n.point[0] // cell), int(n.point[1] // cell)), []).append(n)
    for ln in lines:
        x0, x1 = sorted((ln.p0[0], ln.p1[0]))
        y0, y1 = sorted((ln.p0[1], ln.p1[1]))
        near = [
            n
            for gx in range(int((x0 - pad) // cell), int((x1 + pad) // cell) + 1)
            for gy in range(int((y0 - pad) // cell), int((y1 + pad) // cell) + 1)
            for n in node_cells.get((gx, gy), ())
        ]
        col_idx[ln.id] = _merge_hits(_column_hits(ln, sorted(near, key=lambda n: n.id), glyphs))

    beam_hits: dict[int, list[tuple[float, int]]] = {ln.id: [] for ln in lines}  # (s, line)
    index = _LineIndex(lines, SNAP_BEAM_PT)
    for ln in lines:
        if len({h.node for h in col_idx[ln.id]}) >= 2:
            ln.level, ln.role = 1, "girder"
    level = 1
    while level < MAX_ROUNDS:
        assigned = {ln.id for ln in lines if ln.level is not None and ln.level <= level}
        newly = []
        for ln in lines:
            if ln.level is not None:
                continue
            found = []
            for j in index.near(ln.p0, ln.p1, SNAP_BEAM_PT):
                if j in assigned and j != ln.id:
                    s = _beam_hit(ln, lines[j])
                    if s is not None:
                        found.append((s, j))
            col = [Hit(h.s, h.node, "column") for h in col_idx[ln.id]]
            beam = [Hit(s, -1 - j, "beam") for s, j in found]
            if len(_merge_hits(col + beam)) >= 2:
                newly.append((ln, found))
        if not newly:
            break
        level += 1
        for ln, found in newly:
            ln.level = level
            beam_hits[ln.id] = found
    assigned = {ln.id for ln in lines if ln.level is not None}
    for ln in lines:  # never supported twice: whatever supports it has, from any assigned line
        if ln.level is None:
            beam_hits[ln.id] = [
                (s, j)
                for j in index.near(ln.p0, ln.p1, SNAP_BEAM_PT)
                if j in assigned and j != ln.id
                for s in [_beam_hit(ln, lines[j])]
                if s is not None
            ]

    node_at: dict[tuple[int, int], int] = {}

    def beam_node(p: Pt, carrier: int) -> int:
        key = (round(p[0]), round(p[1]))
        if key not in node_at:
            node_at[key] = len(nodes)
            nodes.append(Node(len(nodes), p, "beam_intersection", 0.0, None, {"line": carrier}))
        return node_at[key]

    pieces: list[Piece] = []
    for ln in lines:
        hits = list(col_idx[ln.id])
        for s, j in sorted(beam_hits[ln.id]):
            hits.append(Hit(s, beam_node(point_at(ln.p0, ln.p1, s), j), "beam"))
        hits = _merge_hits(hits)
        ln.supports = [(h.s, h.node, h.kind) for h in hits]
        pieces.extend(_split(ln, hits))
    counts = {
        "nodes_glyph": sum(n.source == "glyph" for n in nodes),
        "nodes_projected": sum(n.source == "projected" for n in nodes),
        "nodes_beam_intersection": sum(n.source == "beam_intersection" for n in nodes),
        "girders": sum(ln.role == "girder" for ln in lines),
        "lines_never_supported_twice": sum(ln.level is None for ln in lines),
        "pieces": len(pieces),
        "pieces_both": sum(p.support_state == "both" for p in pieces),
        "pieces_one": sum(p.support_state == "one" for p in pieces),
        "pieces_none": sum(p.support_state == "none" for p in pieces),
    }
    return SupportResult(nodes, lines, pieces, counts)


def _split(ln: BeamLine, hits: list[Hit]) -> list[Piece]:
    L = ln.length
    if not hits:
        return [Piece(ln.id, 1, ln.p0, ln.p1, None, None)]
    cuts: list[tuple[float, int | None]] = []
    trimmed = 0.0
    first, last = hits[0], hits[-1]
    if first.s > END_TRIM_PT:
        cuts.append((0.0, None))
    else:
        trimmed += first.s
    cuts.extend((h.s, h.node) for h in hits)
    if L - last.s > END_TRIM_PT:
        cuts.append((L, None))
    else:
        trimmed += L - last.s
    out: list[Piece] = []
    for (sa, na), (sb, nb) in zip(cuts, cuts[1:], strict=False):
        if sb - sa < HIT_MERGE_PT:
            continue
        out.append(
            Piece(
                ln.id,
                len(out) + 1,
                point_at(ln.p0, ln.p1, sa),
                point_at(ln.p0, ln.p1, sb),
                na,
                nb,
            )
        )
    if len(cuts) == 1:  # one support near the middle of a short line: kept whole, one end held
        h = hits[0]
        near_start = h.s <= L / 2
        return [
            Piece(
                ln.id,
                1,
                ln.p0,
                ln.p1,
                h.node if near_start else None,
                None if near_start else h.node,
            )
        ]
    if out:
        out[0].trimmed_pt = round(trimmed, 2)
    return out

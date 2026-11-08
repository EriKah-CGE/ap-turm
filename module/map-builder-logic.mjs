/**
 * Map Builder: pure logic without any Foundry dependency (tested in Node).
 *
 * Coordinates are grid cells (x = column, y = row) and grid points (the corners between cells). A wall segment is
 * one unit edge between two neighbouring grid points; its key is the same no matter which tile created it, so
 * segments on a shared edge merge into one.
 *
 * Tile definitions (set.json): { id, name, file, category, w, h, walls, door?, doorState?, wallType?, layer?, tags }
 * - walls: "none" | "box" (all four sides) | "door" (a door in the middle of the edge `door`, default "n") |
 *   ["n","e","s","w"] (those sides; with `door` set, that side gets the door in its middle)
 * - wallType: "wall" (default) | "transparent" (blocks movement only: portcullis, bars)
 * - doorState: "closed" (default) | "open"
 * - layer: "floor" | "object"; default "floor" for the category "floor", else "object"
 * Rotation is clockwise in quarter turns; a mirrored tile is flipped left/right before it is rotated (the same order
 * in which Foundry draws a tile with texture.scaleX = -1 and a rotation).
 */

export const EDGES = ["n", "e", "s", "w"];
const ROT_CW = { n: "e", e: "s", s: "w", w: "n" };
const FLIP = { n: "n", s: "s", e: "w", w: "e" };
export const WALL_KINDS = ["wall", "transparent", "door", "door-open"];
/** Which kind wins when two tiles put a segment on the same edge: an opening beats a wall, a wall beats bars. */
export const KIND_PRIORITY = { transparent: 1, wall: 2, door: 3, "door-open": 3 };
export const HISTORY_LIMIT = 50;

/* ---------- rotation / mirroring ---------- */

/** Degrees -> 0 | 90 | 180 | 270 */
export function normalizeRot(deg) { return ((Math.round((Number(deg) || 0) / 90) * 90) % 360 + 360) % 360; }
export function rotateEdge(edge, deg) { let e = edge; for (let i = 0; i < normalizeRot(deg) / 90; i++) e = ROT_CW[e]; return e; }
export function flipEdge(edge) { return FLIP[edge]; }
/** Edges of a tile after mirroring (first) and rotating; order is kept. */
export function transformEdges(edges, { rot = 0, flip = false } = {}) {
  return (edges ?? []).filter(e => EDGES.includes(e)).map(e => rotateEdge(flip ? flipEdge(e) : e, rot));
}
/** Footprint in cells after rotation: 90 / 270 swap width and height. */
export function footprint(w, h, rot = 0) { const r = normalizeRot(rot); return r === 90 || r === 270 ? { w: h, h: w } : { w, h }; }

/* ---------- walls of a tile ---------- */

/** The walls field of a tile definition as { walls: edges, door: edge|null }. Unknown values: no walls. */
export function wallSpec(tile) {
  const v = tile?.walls;
  const doorEdge = EDGES.includes(tile?.door) ? tile.door : null;
  if (v === "box") return { walls: [...EDGES], door: doorEdge };
  if (v === "door") return { walls: [], door: doorEdge ?? "n" };
  if (Array.isArray(v)) return { walls: [...new Set(v.filter(e => EDGES.includes(e)))], door: doorEdge };
  return { walls: [], door: null };
}
export function isValidWalls(v) { return v === "none" || v === "box" || v === "door" || (Array.isArray(v) && v.every(e => EDGES.includes(e))); }

/** Unit segments along one side of a w x h block whose top-left cell is (x, y), in grid points, in order. */
export function sideSegments(x, y, w, h, edge) {
  const out = [];
  if (edge === "n" || edge === "s") { const yy = edge === "n" ? y : y + h; for (let i = 0; i < w; i++) out.push([x + i, yy, x + i + 1, yy]); }
  else if (edge === "w" || edge === "e") { const xx = edge === "w" ? x : x + w; for (let i = 0; i < h; i++) out.push([xx, y + i, xx, y + i + 1]); }
  return out;
}
/** Same edge, same key: "x1,y1,x2,y2" with the smaller point first. */
export function segKey(c) {
  const [x1, y1, x2, y2] = c;
  return (x1 < x2 || (x1 === x2 && y1 <= y2)) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
}
/** Middle segments of a side for a door: the centre one (odd length) or the two centre ones (even length). */
export function doorIndices(len) { return len % 2 ? [(len - 1) / 2] : [len / 2 - 1, len / 2]; }

/**
 * Wall segments of a placed tile, in grid points.
 * @param {object} tile       tile definition
 * @param {object} place      { x, y, rot, flip } x/y = top-left cell of the footprint;
 *                            optional `edges`: [{x, y, edge}] cell edges in scene orientation instead of the tile's walls
 * @returns {{key:string, c:number[], kind:string}[]}
 */
export function tileWallSegments(tile, place) {
  const out = [];
  const add = (c, kind) => out.push({ key: segKey(c), c, kind });
  const baseKind = tile?.wallType === "transparent" ? "transparent" : "wall";
  if (Array.isArray(place.edges)) {
    for (const e of place.edges) for (const c of sideSegments(e.x, e.y, 1, 1, e.edge)) add(c, e.kind ?? baseKind);
    return mergeSegments(out);
  }
  const { w, h } = footprint(tile.w, tile.h, place.rot);
  const spec = wallSpec(tile);
  const walls = transformEdges(spec.walls, place);
  const door = spec.door ? transformEdges([spec.door], place)[0] : null;
  const doorKind = tile?.doorState === "open" ? "door-open" : "door";
  for (const edge of EDGES) {
    const segs = sideSegments(place.x, place.y, w, h, edge);
    const di = edge === door ? doorIndices(segs.length) : [];
    segs.forEach((c, i) => {
      if (di.includes(i)) add(c, doorKind);
      else if (walls.includes(edge)) add(c, baseKind);
    });
  }
  return out;
}

/** The kind that wins among several (see KIND_PRIORITY). */
export function resolveKind(kinds) {
  let best = null;
  for (const k of kinds) if (best === null || (KIND_PRIORITY[k] ?? 0) > (KIND_PRIORITY[best] ?? 0)) best = k;
  return best;
}
/** One segment per edge; on a shared edge the stronger kind wins. Order of first appearance is kept. */
export function mergeSegments(list) {
  const map = new Map();
  for (const s of list) {
    const prev = map.get(s.key);
    if (!prev) map.set(s.key, { ...s });
    else prev.kind = resolveKind([prev.kind, s.kind]);
  }
  return [...map.values()];
}
/** All segments of several placements ({tile, x, y, rot, flip, edges?}), merged. */
export function placementsSegments(placements) {
  return mergeSegments(placements.flatMap(p => tileWallSegments(p.tile, p)));
}

/* ---------- placing ---------- */

/** Top-left cell of a footprint so that the pointer cell is its centre (rounded up-left). */
export function anchorCell(cell, w, h, rot = 0) {
  const f = footprint(w, h, rot);
  return { x: cell.x - Math.floor((f.w - 1) / 2), y: cell.y - Math.floor((f.h - 1) / 2) };
}
/** Cell under a canvas point. */
export function cellFromPoint(px, py, size) { return { x: Math.floor(px / size), y: Math.floor(py / size) }; }
/**
 * Tile document rectangle for a placement: Foundry rotates a tile around its centre, so the unrotated rectangle is
 * centred on the rotated footprint.
 * @returns {{x:number, y:number, width:number, height:number, rotation:number}}
 */
export function tileRect(place, w, h, size) {
  const rot = normalizeRot(place.rot);
  const f = footprint(w, h, rot);
  const width = w * size, height = h * size;
  const cx = (place.x + f.w / 2) * size, cy = (place.y + f.h / 2) * size;
  return { x: Math.round(cx - width / 2), y: Math.round(cy - height / 2), width, height, rotation: rot };
}
/** Cells covered by a placement. */
export function coveredCells(place, w, h) {
  const f = footprint(w, h, place.rot); const out = [];
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) out.push({ x: place.x + i, y: place.y + j });
  return out;
}
/** Is the tile drawn on the floor layer? */
export function isFloor(tile) { return tile?.layer ? tile.layer === "floor" : tile?.category === "floor"; }

/* ---------- room ---------- */

/** Rectangle of cells spanned by two corner cells (both included). */
export function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}
/** Rotation that turns a wall tile's north face towards the room, per side of the ring. */
const FACE_IN = { n: 180, s: 0, w: 90, e: 270 };

/**
 * Room: floor cells inside the rectangle, a ring of wall tiles around it (sides face the room, corners carry no
 * walls), optionally a door tile in the middle of one side instead of the wall tile.
 * @param {{x:number,y:number,w:number,h:number}} rect  the floor area
 * @param {{door?: "n"|"e"|"s"|"w"|null}} [opts]
 * @returns {{floors:{x,y}[], ring:{x,y,rot,role:"side"|"corner"|"door",side:string|null}[]}}
 */
export function roomLayout(rect, { door = null } = {}) {
  const { x, y, w, h } = rect;
  const floors = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) floors.push({ x: x + i, y: y + j });
  const ring = [];
  const side = (s, cells) => {
    const di = s === door ? Math.floor((cells.length - 1) / 2) : -1;
    cells.forEach((c, i) => ring.push({ ...c, rot: FACE_IN[s], role: i === di ? "door" : "side", side: s }));
  };
  side("n", Array.from({ length: w }, (_, i) => ({ x: x + i, y: y - 1 })));
  side("e", Array.from({ length: h }, (_, j) => ({ x: x + w, y: y + j })));
  side("s", Array.from({ length: w }, (_, i) => ({ x: x + i, y: y + h })));
  side("w", Array.from({ length: h }, (_, j) => ({ x: x - 1, y: y + j })));
  for (const c of [{ x: x - 1, y: y - 1 }, { x: x + w, y: y - 1 }, { x: x + w, y: y + h }, { x: x - 1, y: y + h }]) ring.push({ ...c, rot: 0, role: "corner", side: null });
  return { floors, ring };
}
/** Placements of a room: floor tile on every floor cell, wall tile on the ring (corners without walls), door tile. */
export function roomPlacements(rect, { floor, wall, door = null, doorTile = null }) {
  const { floors, ring } = roomLayout(rect, { door });
  return [
    ...floors.map(c => ({ tile: floor, x: c.x, y: c.y, rot: 0, flip: false })),
    ...ring.map(c => {
      if (c.role === "door" && doorTile) return { tile: doorTile, x: c.x, y: c.y, rot: c.rot, flip: false };
      // no door tile: the wall tile stays, its edge towards the room becomes a door
      if (c.role === "door") return { tile: wall, x: c.x, y: c.y, rot: c.rot, flip: false, edges: [{ x: c.x, y: c.y, edge: rotateEdge("n", c.rot), kind: "door" }] };
      return { tile: wall, x: c.x, y: c.y, rot: c.rot, flip: false, ...(c.role === "corner" ? { edges: [] } : {}) };
    })
  ];
}

/* ---------- corridor ---------- */

/**
 * Cells of a corridor from p1 to p2, `width` cells wide (extending right / down from the line). Straight when the
 * points share a row or column, otherwise an L: horizontal from p1, then vertical to p2. Sorted by row, then column.
 */
export function corridorCells(p1, p2, width = 1) {
  const wd = Math.max(1, Math.floor(width) || 1);
  const set = new Map();
  const box = (x0, x1, y0, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set.set(`${x},${y}`, { x, y }); };
  const [xa, xb] = [Math.min(p1.x, p2.x), Math.max(p1.x, p2.x)], [ya, yb] = [Math.min(p1.y, p2.y), Math.max(p1.y, p2.y)];
  if (p1.y === p2.y) box(xa, xb, p1.y, p1.y + wd - 1);
  else if (p1.x === p2.x) box(p1.x, p1.x + wd - 1, ya, yb);
  else {
    box(xa, xb, p1.y, p1.y + wd - 1);                   // horizontal leg from p1
    box(p2.x, p2.x + wd - 1, ya, yb);                   // vertical leg to p2
    box(p2.x, p2.x + wd - 1, p1.y, p1.y + wd - 1);      // corner block
  }
  return [...set.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}
/**
 * Corridor cells with the walls along their long sides: every outer edge except the two open ends.
 * @returns {{x,y,edges:string[]}[]}  per cell the edges that get a wall
 */
export function corridorLayout(p1, p2, width = 1) {
  const wd = Math.max(1, Math.floor(width) || 1);
  const cells = corridorCells(p1, p2, wd);
  const has = new Set(cells.map(c => `${c.x},${c.y}`));
  const nb = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
  // open ends: the side of the first leg at p1 and the side of the last leg at p2
  const caps = new Set();
  const cap = (x0, y0, dx, dy, edge) => { for (let k = 0; k < wd; k++) caps.add(`${x0 + dx * k},${y0 + dy * k},${edge}`); };
  if (p1.y === p2.y && p1.x === p2.x) { /* a single block: closed on all sides */ }
  else if (p1.y === p2.y) { cap(p1.x, p1.y, 0, 1, p1.x < p2.x ? "w" : "e"); cap(p2.x, p2.y, 0, 1, p2.x > p1.x ? "e" : "w"); }
  else if (p1.x === p2.x) { cap(p1.x, p1.y, 1, 0, p1.y < p2.y ? "n" : "s"); cap(p2.x, p2.y, 1, 0, p2.y > p1.y ? "s" : "n"); }
  else { cap(p1.x, p1.y, 0, 1, p1.x < p2.x ? "w" : "e"); cap(p2.x, p2.y, 1, 0, p2.y > p1.y ? "s" : "n"); }
  return cells.map(c => ({
    x: c.x, y: c.y,
    edges: EDGES.filter(e => !has.has(`${c.x + nb[e][0]},${c.y + nb[e][1]}`) && !caps.has(`${c.x},${c.y},${e}`))
  }));
}
/** Placements of a corridor: the floor tile on every cell; the walls belong to the cell they border. */
export function corridorPlacements(p1, p2, width, floor) {
  return corridorLayout(p1, p2, width).map(c => ({ tile: floor, x: c.x, y: c.y, rot: 0, flip: false, edges: c.edges.map(edge => ({ x: c.x, y: c.y, edge })) }));
}

/* ---------- tile sets ---------- */

const str = (v) => typeof v === "string" && v.trim() ? v.trim() : null;
const posInt = (v, d) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : d; };
/** File path of a tile: relative to the set folder unless it is already a full path or URL. */
export function resolveFile(folder, file) {
  if (/^(https?:|data:|\/|systems\/|modules\/|worlds\/)/.test(file)) return file;
  return `${String(folder).replace(/\/+$/, "")}/${file.replace(/^\.\//, "")}`;
}
/**
 * Check and normalize a parsed set.json. Broken tiles are dropped (with an error each); a set without id, name,
 * grid size or any valid tile is rejected.
 * @returns {{set: object|null, errors: string[]}}
 */
export function validateSet(json, folder) {
  const errors = [];
  if (!json || typeof json !== "object" || Array.isArray(json)) return { set: null, errors: ["not a JSON object"] };
  const id = str(json.id), name = str(json.name), gridSize = posInt(json.gridSize, null);
  if (!id) errors.push("missing id");
  if (!name) errors.push("missing name");
  if (!gridSize) errors.push("gridSize must be a positive whole number");
  const categories = (Array.isArray(json.categories) ? json.categories : [])
    .filter(c => str(c?.id) && str(c?.name)).map(c => ({ id: c.id.trim(), name: c.name.trim() }));
  if (!categories.length) errors.push("no categories");
  const catIds = new Set(categories.map(c => c.id));
  const seen = new Set();
  const tiles = [];
  (Array.isArray(json.tiles) ? json.tiles : []).forEach((t, i) => {
    const tid = str(t?.id), tname = str(t?.name), file = str(t?.file);
    const bad = [];
    if (!tid) bad.push("id"); else if (seen.has(tid)) bad.push("duplicate id");
    if (!tname) bad.push("name");
    if (!file) bad.push("file");
    if (!catIds.has(t?.category)) bad.push("category");
    if (t?.walls !== undefined && !isValidWalls(t.walls)) bad.push("walls");
    if (t?.door !== undefined && !EDGES.includes(t.door)) bad.push("door");
    if (bad.length) { errors.push(`tile ${tid ?? "#" + (i + 1)}: invalid ${bad.join(", ")}`); return; }
    seen.add(tid);
    tiles.push({
      id: tid, name: tname, file: resolveFile(folder, file), category: t.category,
      w: posInt(t.w, 1), h: posInt(t.h, 1), walls: t.walls ?? "none",
      ...(t.door ? { door: t.door } : {}),
      ...(t.doorState === "open" ? { doorState: "open" } : {}),
      ...(t.wallType === "transparent" ? { wallType: "transparent" } : {}),
      ...(t.layer === "floor" || t.layer === "object" ? { layer: t.layer } : {}),
      tags: (Array.isArray(t.tags) ? t.tags : []).map(String)
    });
  });
  if (!tiles.length) errors.push("no valid tiles");
  const fatal = !id || !name || !gridSize || !categories.length || !tiles.length;
  return { set: fatal ? null : { id, name, gridSize, categories, tiles, folder }, errors };
}
/** Tiles of a category matching a search over name and tags (case-insensitive, all words must match). */
export function filterTiles(set, { category = null, query = "" } = {}) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return (set?.tiles ?? []).filter(t => (!category || t.category === category)
    && words.every(w => t.name.toLowerCase().includes(w) || t.tags.some(g => g.toLowerCase().includes(w))));
}

/* ---------- undo ---------- */

/** Push an undo step, keeping the last `limit` steps. Returns the stack. */
export function pushHistory(stack, entry, limit = HISTORY_LIMIT) {
  stack.push(entry);
  while (stack.length > limit) stack.shift();
  return stack;
}

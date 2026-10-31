/**
 * "Place copies" of an NPC: the pure part (tested in Node) - token names and the grid placement.
 */

export const MAX_COPIES = 20;

/** Copies wanted, clamped to 1..MAX_COPIES (null when the input is not a number). */
export function copyCount(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(MAX_COPIES, n));
}

/**
 * Names of the copies.
 * @param {object} o  {name: token name, displayName: what players see ("" = none), count, numbered}
 * @returns {{name:string, displayName:string}[]}  displayName "" when the NPC has none
 */
export function spawnNames({ name = "", displayName = "", count = 1, numbered = true } = {}) {
  const base = String(name).trim() || "NPC";
  const shown = String(displayName ?? "").trim();
  return Array.from({ length: count }, (_, i) => ({
    name: numbered ? `${base} ${i + 1}` : base,
    displayName: shown ? (numbered ? `${shown} ${i + 1}` : shown) : ""
  }));
}

/**
 * Grid cells for `count` tokens around a centre: rings of cells around the centre cell (nearest first, rows
 * before columns inside a ring), free cells first; occupied cells are only used when there are not enough
 * free ones within the search radius.
 * @param {object} o
 * @param {{x:number, y:number}} o.center      point in scene pixels
 * @param {number} o.count
 * @param {number} o.gridSize                   pixels per grid cell
 * @param {number} [o.size]                     token size in cells (1 = medium, 2 = large ...)
 * @param {{x:number, y:number, w:number, h:number}[]} [o.occupied]   rectangles in pixels (existing tokens)
 * @param {{width:number, height:number}} [o.bounds]  scene size in pixels (cells outside are skipped)
 * @returns {{x:number, y:number}[]}            top-left corners in pixels
 */
export function planPositions({ center, count, gridSize, size = 1, occupied = [], bounds = null, maxRing = 12 }) {
  const g = Number(gridSize) || 100;
  const step = Math.max(1, Math.round(Number(size) || 1));
  // the cell whose top-left puts the token's middle nearest to the centre
  const cx = Math.round((center.x - (step * g) / 2) / g);
  const cy = Math.round((center.y - (step * g) / 2) / g);
  const overlaps = (x, y) => occupied.some(o => x < o.x + o.w && x + step * g > o.x && y < o.y + o.h && y + step * g > o.y);
  const inside = (x, y) => !bounds || (x >= 0 && y >= 0 && x + step * g <= bounds.width && y + step * g <= bounds.height);
  const free = [], taken = [];
  const used = [];
  const clash = (x, y) => used.some(u => x < u.x + step * g && x + step * g > u.x && y < u.y + step * g && y + step * g > u.y);
  for (let r = 0; r <= maxRing && free.length < count; r++) {
    const ring = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      ring.push({ x: (cx + dx * step) * g, y: (cy + dy * step) * g, d: dx * dx + dy * dy, dx, dy });
    }
    ring.sort((a, b) => a.d - b.d || a.dy - b.dy || a.dx - b.dx);
    for (const c of ring) {
      if (!inside(c.x, c.y) || clash(c.x, c.y)) continue;
      if (overlaps(c.x, c.y)) { taken.push(c); continue; }
      if (free.length < count) { free.push(c); used.push(c); }
    }
  }
  const out = free.map(({ x, y }) => ({ x, y }));
  for (const c of taken) { if (out.length >= count) break; out.push({ x: c.x, y: c.y }); }
  return out.slice(0, count);
}

/**
 * Reach ring: the pure part (tested in Node) - which reach a token has and how big the ring is.
 *
 * - Character: the equipped weapon's reach (weapon field "reach", 5 ft by default); several equipped weapons:
 *   the longest; none equipped: 5 ft.
 * - NPC: the longest reach of its entries with an attack bonus (toHit set). The statblock parser keeps
 *   "reach 10 ft." as "10 ft" and ranges as "80/320 ft"; a melee-or-ranged entry is "5 ft / 20/60 ft". Only the
 *   single-number parts are reaches. No such entry: 5 ft.
 */

export const DEFAULT_REACH = 5;

/** Reach in ft of one NPC range text ("10 ft", "5 ft / 20/60 ft"), or null when it has none. */
export function reachFromRange(range) {
  let best = null;
  for (const part of String(range ?? "").split(/\s+\/\s+/)) {
    const m = /^\s*(\d+)\s*(?:ft\.?|feet)?\s*$/i.exec(part);
    if (m) best = Math.max(best ?? 0, Number(m[1]));
  }
  return best;
}

/** Character: longest reach of the equipped weapons (5 ft when none is equipped or none has a reach). */
export function characterReach(items) {
  let best = null;
  for (const i of items || []) {
    if (i?.type !== "weapon" || !i.system?.equipped) continue;
    const r = Number(i.system.reach);
    const v = Number.isFinite(r) && r > 0 ? r : DEFAULT_REACH;
    best = Math.max(best ?? 0, v);
  }
  return best ?? DEFAULT_REACH;
}

/** NPC: longest reach of the entries with an attack bonus. */
export function npcReach(entries) {
  let best = null;
  for (const e of entries || []) {
    if (e?.toHit === null || e?.toHit === undefined) continue;
    const r = reachFromRange(e.range);
    if (r !== null) best = Math.max(best ?? 0, r);
  }
  return best ?? DEFAULT_REACH;
}

/** Reach of an actor-like object {type, items, system:{entries}}; null for other types (no ring). */
export function reachOf(actor) {
  if (actor?.type === "character") return characterReach(actor.items);
  if (actor?.type === "npc") return npcReach(actor.system?.entries);
  return null;
}

/**
 * Ring size in pixels: the token's edge plus the reach (grid distance).
 * @param {object} o  {width, height: token size in px, reach: ft, gridSize: px per cell, gridDistance: ft per cell}
 * @returns {{rx:number, ry:number}}  radii of the ellipse around the token centre
 */
export function ringRadius({ width, height, reach, gridSize, gridDistance }) {
  const px = (Number(reach) || 0) / (Number(gridDistance) || 5) * (Number(gridSize) || 100);
  return { rx: width / 2 + px, ry: height / 2 + px };
}

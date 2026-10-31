/**
 * Areas of effect of NPC actions: reading the shape out of the statblock text, the geometry that decides
 * which token an area catches, and the Foundry side that places a MeasuredTemplate and targets what it covers.
 *
 * Pure part (tested in Node): parseArea() turns "60-foot cone", "20-foot-radius sphere", "90-foot-long,
 * 5-foot-wide line" or "15-foot cube" into {shape, size}; pointInArea() answers whether a point lies in
 * such an area. Shapes Foundry cannot draw as a template (emanation, aura) are ignored on purpose - those
 * actions keep their save button and nothing else.
 *
 * Foundry part: placeEntryTemplate() runs the normal preview flow (template hangs on the mouse, click
 * places it, right-click / Escape cancels), then targets every token whose centre lies inside and, when
 * the entry carries a save DC, sends the existing save request card to exactly those targets.
 */
import { requestSave } from "./chat.mjs";

const SYSTEM_ID = "ap-turm";

/* ============================================================
   Pure logic
   ============================================================ */

/** Shape words of a statblock and the template type they become (null = no template for this word). */
export const SHAPE_WORDS = {
  cone: "cone", line: "ray", radius: "circle", sphere: "circle", cylinder: "circle",
  cube: "rect", square: "rect", emanation: null, aura: null
};

/** Label of a shape for the sheet button. */
export const SHAPE_LABELS = { cone: "Cone", ray: "Line", circle: "Radius", rect: "Cube" };

/** Is this a shape the system can place? */
export const isAreaShape = (shape) => shape === "cone" || shape === "ray" || shape === "circle" || shape === "rect";

const MEAS_RE = /(\d+)[-\s]*(?:foot|feet|ft\.?)(?:[-\s]*(long|wide|high|tall|deep|radius|square|diameter))?/gi;
const SHAPE_RE = /\b(cone|line|radius|sphere|cylinder|cube|square|emanation|aura)\b/gi;
const NEAR = 30;   // characters a measurement may stand before its shape word

/**
 * The area an entry text names, or null.
 * @param {string} text
 * @returns {{shape:"cone"|"ray"|"circle"|"rect", size:number}|null}
 */
export function parseArea(text) {
  const t = String(text ?? "");
  if (!t) return null;
  const meas = [];
  for (const m of t.matchAll(MEAS_RE)) {
    meas.push({ size: parseInt(m[1], 10), qual: (m[2] || "").toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  if (!meas.length) return null;
  // the measurement carries the shape itself: "20-foot-radius", "15-foot square"
  for (const m of meas) {
    const shape = SHAPE_WORDS[m.qual];
    if (shape && m.size > 0) return { shape, size: m.size };
  }
  // otherwise: the first shape word with the measurement standing closest in front of it
  for (const m of t.matchAll(SHAPE_RE)) {
    const shape = SHAPE_WORDS[m[0].toLowerCase()];
    if (!shape) continue;                                   // emanation / aura: no template, on purpose
    const before = meas.filter(x => x.end <= m.index && (m.index - x.end) <= NEAR);
    if (!before.length) continue;
    const wanted = m[0].toLowerCase() === "line" ? "long" : "";
    const pick = before.find(x => x.qual === wanted) ?? before[before.length - 1];
    if (pick.size > 0) return { shape, size: pick.size };
  }
  return null;
}

const norm = (deg) => ((Number(deg) || 0) % 360 + 360) % 360;
const degOf = (dx, dy) => norm(Math.atan2(dy, dx) * 180 / Math.PI);

/** Smallest angle between two directions, in degrees (0..180). */
export function angleBetween(a, b) {
  const d = Math.abs(norm(a) - norm(b));
  return d > 180 ? 360 - d : d;
}

/** Point in a circle around the origin (radius = size). */
export function pointInCircle(p, o, size) {
  return Math.hypot(p.x - o.x, p.y - o.y) <= size;
}

/** Point in a cone starting at the origin: inside the radius and inside the opening angle. */
export function pointInCone(p, o, size, direction, angle) {
  const dx = p.x - o.x, dy = p.y - o.y;
  const d = Math.hypot(dx, dy);
  if (d > size) return false;
  if (d === 0) return true;
  return angleBetween(degOf(dx, dy), direction) <= (Number(angle) || 0) / 2;
}

/** Point in a line starting at the origin: along the direction within the length, across within half the width. */
export function pointInRay(p, o, size, direction, width) {
  const rad = norm(direction) * Math.PI / 180;
  const ux = Math.cos(rad), uy = Math.sin(rad);
  const dx = p.x - o.x, dy = p.y - o.y;
  const along = dx * ux + dy * uy;
  const off = Math.abs(dy * ux - dx * uy);
  return along >= 0 && along <= size && off <= (Number(width) || 0) / 2;
}

/** Point in a square whose corner is the origin, reaching `size` to the right and down (Foundry's rect template). */
export function pointInRect(p, o, size) {
  return p.x >= o.x && p.x <= o.x + size && p.y >= o.y && p.y <= o.y + size;
}

/**
 * Does the point lie in this area? All lengths in the same unit (feet), angles in degrees, y downwards
 * like on the Foundry canvas.
 * @param {{x:number, y:number}} p
 * @param {{shape:string, size:number, x:number, y:number, direction?:number, angle?:number, width?:number}} area
 */
export function pointInArea(p, area) {
  if (!p || !area || !(area.size > 0)) return false;
  const o = { x: area.x, y: area.y };
  switch (area.shape) {
    case "circle": return pointInCircle(p, o, area.size);
    case "cone": return pointInCone(p, o, area.size, area.direction ?? 0, area.angle ?? 53.13);
    case "ray": return pointInRay(p, o, area.size, area.direction ?? 0, area.width ?? 5);
    case "rect": return pointInRect(p, o, area.size);
    default: return false;
  }
}

/**
 * Indices of the points the area catches (token centres).
 * @param {{x:number, y:number}[]} points
 * @param {object} area
 * @returns {number[]}
 */
export function tokensInArea(points, area) {
  const out = [];
  (points || []).forEach((p, i) => { if (pointInArea(p, area)) out.push(i); });
  return out;
}

/** The area of an entry, but only when it is one the system can place. */
export function entryArea(entry) {
  const shape = entry?.areaShape, size = Number(entry?.areaSize) || 0;
  return isAreaShape(shape) && size > 0 ? { shape, size } : null;
}

/* ============================================================
   Foundry side
   ============================================================ */

/** Feet per pixel on the current scene. */
function unitsPerPixel() {
  const grid = canvas?.scene?.grid;
  return grid?.size ? grid.distance / grid.size : 0;
}

/** The token an area starts from: the NPC's own token on this scene. */
function originToken(actor) {
  return actor?.token?.object ?? actor?.getActiveTokens?.(false, false)?.[0] ?? null;
}

/**
 * Document data for a template of this area.
 * Cone and line start at the token and only turn with the mouse; circle and cube follow it.
 */
function templateData(area, origin) {
  const distance = area.shape === "rect" ? Math.hypot(area.size, area.size) : area.size;
  const data = {
    t: area.shape, user: game.user.id, distance, direction: 0,
    x: origin.x, y: origin.y, fillColor: game.user.color?.css ?? game.user.color ?? "#FF0000",
    flags: { [SYSTEM_ID]: { area: true } }
  };
  if (area.shape === "cone") data.angle = CONFIG.MeasuredTemplate.defaults.angle;
  if (area.shape === "ray") data.width = canvas.scene.grid.distance;
  if (area.shape === "rect") data.direction = 45;
  return data;
}

/** The placed template as an area in feet, for the geometry above. */
export function areaOfTemplate(doc) {
  const upp = unitsPerPixel();
  const shape = doc.t;
  return {
    shape, size: shape === "rect" ? doc.distance / Math.SQRT2 : doc.distance,
    x: doc.x * upp, y: doc.y * upp, direction: doc.direction, angle: doc.angle, width: doc.width
  };
}

/**
 * Target every token whose centre lies in the area; returns the targeted tokens.
 * @param {MeasuredTemplateDocument} doc
 * @param {object} [opts]  {exclude: a token that is never targeted - the one the area starts from}
 */
export function targetTokensInArea(doc, { exclude = null } = {}) {
  const area = areaOfTemplate(doc);
  const upp = unitsPerPixel();
  const tokens = canvas.tokens.placeables.filter(t => t.visible !== false && t !== exclude);
  const hits = tokensInArea(tokens.map(t => ({ x: t.center.x * upp, y: t.center.y * upp })), area).map(i => tokens[i]);
  game.user.targets.forEach(t => t.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true }));
  hits.forEach(t => t.setTarget(true, { user: game.user, releaseOthers: false, groupSelection: true }));
  game.user.broadcastActivity({ targets: game.user.targets.ids });
  return hits;
}

/**
 * Place the template of an entry with the normal preview (mouse moves it, click places it, right-click or
 * Escape cancels), then target what it covers and send the save request when the entry has a save DC.
 * @param {Actor} actor
 * @param {number} index  entry index
 * @returns {Promise<MeasuredTemplateDocument|null>}
 */
export async function placeEntryTemplate(actor, index) {
  const entry = actor?.system?.entries?.[index];
  const area = entryArea(entry);
  if (!area) { ui.notifications.warn("This entry has no area the system can place."); return null; }
  if (!canvas?.scene) { ui.notifications.warn("No scene is active."); return null; }
  if (!game.user.can("TEMPLATE_CREATE")) { ui.notifications.warn("You may not create templates."); return null; }
  const token = originToken(actor);
  const origin = token?.center ?? { x: canvas.scene.dimensions.width / 2, y: canvas.scene.dimensions.height / 2 };
  const fixed = area.shape === "cone" || area.shape === "ray";   // these start at the token
  if (fixed && !token) ui.notifications.info(`${actor.name} has no token on this scene - the ${SHAPE_LABELS[area.shape]} starts where you click.`);

  const doc = new CONFIG.MeasuredTemplate.documentClass(templateData(area, origin), { parent: canvas.scene });
  const preview = new CONFIG.MeasuredTemplate.objectClass(doc);
  doc._object = preview;
  const placed = await previewTemplate(preview, { fixed: fixed && !!token, origin });
  if (!placed) return null;
  const [created] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [placed]);
  if (!created) return null;
  // the NPC's own token is not a target of its own area
  const hits = targetTokensInArea(created, { exclude: token });
  ui.notifications.info(`${entry.name || "Area"}: ${hits.length} token${hits.length === 1 ? "" : "s"} in the ${SHAPE_LABELS[area.shape].toLowerCase()}.`);
  if (entry.saveDc !== null) await requestSave(actor, index);
  return created;
}

/**
 * Run the preview: returns the template data to create, or null when the placement was cancelled.
 * With `fixed` the origin stays on the token and the mouse only turns the template.
 */
function previewTemplate(preview, { fixed = false, origin } = {}) {
  const layer = canvas.templates;
  layer.activate();
  layer.preview.addChild(preview);
  preview.draw();

  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onDown);
      canvas.app.view.oncontextmenu = null;
      window.removeEventListener("keydown", onKey, true);
      preview.destroy({ children: true });
      resolve(result);
    };
    const point = (event) => {
      const p = event?.getLocalPosition?.(canvas.stage) ?? canvas.mousePosition;
      return { x: p.x, y: p.y };
    };
    const onMove = (event) => {
      const p = point(event);
      // updateSource, not a plain assignment: only that reaches _source, and toObject() reads _source
      if (fixed) {
        preview.document.updateSource({ direction: Math.normalizeDegrees(Math.toDegrees(Math.atan2(p.y - origin.y, p.x - origin.x))) });
      } else {
        const snapped = event?.shiftKey ? p : layer.getSnappedPoint(p);
        preview.document.updateSource({ x: snapped.x, y: snapped.y });
      }
      preview.renderFlags.set({ refreshShape: true });
    };
    const onDown = (event) => {
      if ((event?.data?.button ?? event?.button ?? 0) !== 0) return;
      event?.stopPropagation?.();
      finish(preview.document.toObject());
    };
    const onKey = (event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(null); } };
    canvas.stage.on("pointermove", onMove);
    canvas.stage.on("pointerdown", onDown);
    canvas.app.view.oncontextmenu = (event) => { event.preventDefault(); finish(null); return false; };
    window.addEventListener("keydown", onKey, true);
  });
}

export const area = { parseArea, pointInArea, tokensInArea, entryArea, placeEntryTemplate, targetTokensInArea, SHAPE_WORDS, SHAPE_LABELS };

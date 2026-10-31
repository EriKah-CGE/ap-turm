/**
 * Hit feedback (built in, no module needed): a floating number above the token that took the hit, and a short
 * flash + shake (damage) or a soft green pulse (healing) on the token itself.
 *
 * - Number: rises and fades (~1.5 s). Colour = element colour of the damage type in Turm mode, neutral in AP
 *   mode or for an unassigned type. Crits bigger and bold, healing green with a plus, temp HP loss grey.
 *   Several damage parts arrive as one total (the card total), so there is one number per pool.
 * - Every client shows it: the client that applied the change plays it and broadcasts it over the system
 *   socket (a broadcast needs no GM online). Hidden tokens only show for the GM.
 * - World setting "Show hit feedback" (default on).
 */
import { ELEMENTS } from "./config.mjs";

const SYSTEM_ID = "ap-turm";
export const HIT_FEEDBACK_SETTING = "hitFeedback";
export const HIT_FX_ACTION = "hitFx";

/* ============================================================
   Pure logic
   ============================================================ */

export const FEEDBACK_COLORS = { neutral: "#ffffff", heal: "#5fd35f", temp: "#a8a8a8" };
export const FEEDBACK_SIZE = { base: 30, crit: 44 };

/** Element colour of a damage type in Turm mode, otherwise null (AP mode, D&D type, empty). */
export function elementColor(dtype, mode) {
  if (mode !== "turm") return null;
  const k = String(dtype ?? "").trim().toLowerCase();
  return ELEMENTS[k]?.c ?? null;
}

/**
 * Style of one floating number.
 * @param {object} o
 * @param {"damage"|"heal"|"temp"} o.kind   damage to HP, healing, or damage absorbed by temp HP
 * @param {number} o.amount
 * @param {string} [o.dtype]   damage type (element key in Turm mode)
 * @param {string} [o.mode]    mode of the target ("turm" | "ap")
 * @param {boolean} [o.crit]
 * @returns {{text:string, color:string, fontSize:number, fontWeight:string}}
 */
export function feedbackStyle({ kind, amount, dtype = "", mode = "ap", crit = false }) {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const big = !!crit && kind !== "heal";
  const size = big ? FEEDBACK_SIZE.crit : FEEDBACK_SIZE.base;
  const weight = big ? "bold" : "normal";
  if (kind === "heal") return { text: `+${n}`, color: FEEDBACK_COLORS.heal, fontSize: size, fontWeight: weight };
  if (kind === "temp") return { text: `-${n}`, color: FEEDBACK_COLORS.temp, fontSize: size, fontWeight: weight };
  return { text: `-${n}`, color: elementColor(dtype, mode) ?? FEEDBACK_COLORS.neutral, fontSize: size, fontWeight: weight };
}

/**
 * The numbers one HP change shows: HP damage in the type colour, the part temp HP absorbed in grey, or healing.
 * An immune hit (0 damage) still shows "-0" so the table sees the hit landed.
 * @param {object} o  {taken, fromTemp, healed, dtype, mode, crit}
 * @returns {{text:string, color:string, fontSize:number, fontWeight:string}[]}
 */
export function feedbackParts({ taken = 0, fromTemp = 0, healed = 0, dtype = "", mode = "ap", crit = false } = {}) {
  const out = [];
  if (healed > 0) { out.push(feedbackStyle({ kind: "heal", amount: healed })); return out; }
  const temp = Math.max(0, Math.floor(Number(fromTemp) || 0));
  const hp = Math.max(0, Math.floor(Number(taken) || 0) - temp);
  if (hp > 0 || temp === 0) out.push(feedbackStyle({ kind: "damage", amount: hp, dtype, mode, crit }));
  if (temp > 0) out.push(feedbackStyle({ kind: "temp", amount: temp, crit: crit && hp === 0 }));
  return out;
}

/** Which token animation goes with the change: "hit" (flash + shake), "heal" (green pulse) or null. */
export function feedbackMotion({ taken = 0, healed = 0 } = {}) {
  if (healed > 0) return "heal";
  if (taken > 0) return "hit";
  return null;
}

/* ============================================================
   Foundry side
   ============================================================ */

export function registerHitFeedbackSetting() {
  game.settings.register(SYSTEM_ID, HIT_FEEDBACK_SETTING, {
    name: "Show hit feedback",
    hint: "Floating damage / healing numbers above the token and a short flash or pulse on it. Shown to everyone.",
    scope: "world", config: true, type: Boolean, default: true
  });
}

const enabled = () => { try { return game.settings.get(SYSTEM_ID, HIT_FEEDBACK_SETTING) !== false; } catch { return true; } };

/** The placed token a feedback payload is about (a token uuid, or an actor uuid -> its first active token). */
function resolveToken(uuid) {
  if (!uuid || !canvas?.ready) return null;
  let doc = null;
  try { doc = fromUuidSync(uuid); } catch { return null; }
  if (doc?.documentName === "Token") return doc.parent?.id === canvas.scene?.id ? doc.object : null;
  if (doc?.documentName === "Actor") return doc.getActiveTokens?.(true, false)?.find(t => t.scene?.id === canvas.scene?.id) ?? null;
  return null;
}

/** Floating number: rises about one token height and fades out. */
function floatText(token, style, index) {
  const { PreciseText } = foundry.canvas.containers;
  const s = canvas.dimensions.uiScale ?? 1;
  const text = new PreciseText(style.text, PreciseText.getTextStyle({
    fontSize: style.fontSize, fill: style.color, fontWeight: style.fontWeight,
    stroke: 0x000000, strokeThickness: style.fontWeight === "bold" ? 6 : 4
  }));
  text.anchor.set(0.5, 1);
  text.scale.set(s);
  const x = token.center.x + (index ? token.w * 0.28 : 0);
  const y0 = token.y + (index ? token.h * 0.15 : 0);
  const rise = token.h * 0.7;
  text.position.set(x, y0);
  canvas.interface.addChild(text);
  const duration = 1500;
  const start = performance.now();   // wall clock: a throttled ticker (background tab) must not stretch it
  const tick = () => {
    const p = Math.min(1, (performance.now() - start) / duration);
    text.position.y = y0 - rise * (1 - Math.pow(1 - p, 2));
    text.alpha = p < 0.15 ? p / 0.15 : p > 0.6 ? 1 - (p - 0.6) / 0.4 : 1;
    if (p >= 1) { canvas.app.ticker.remove(tick); text.destroy(); }
  };
  canvas.app.ticker.add(tick);
}

/** Flash + shake (hit) or green pulse (heal) on the token mesh; the mesh is restored by a refresh at the end. */
function animateToken(token, motion) {
  const mesh = token.mesh;
  if (!mesh || !motion) return;
  const ColorMatrix = PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
  const filter = ColorMatrix ? new ColorMatrix() : null;
  if (filter) mesh.filters = [...(mesh.filters ?? []), filter];
  const baseX = mesh.position.x;
  const duration = motion === "hit" ? 450 : 1000;
  const start = performance.now();
  const done = () => {
    canvas.app.ticker.remove(tick);
    if (filter && mesh.filters) mesh.filters = mesh.filters.filter(f => f !== filter);
    if (!mesh.destroyed) mesh.position.x = baseX;
    token.renderFlags?.set({ refreshMesh: true, refreshPosition: true });
  };
  const tick = () => {
    if (mesh.destroyed) { canvas.app.ticker.remove(tick); return; }
    const p = Math.min(1, (performance.now() - start) / duration);
    if (motion === "hit") {
      mesh.position.x = baseX + Math.sin(p * Math.PI * 8) * token.w * 0.05 * (1 - p);
      if (filter) { filter.reset(); filter.brightness(1 + 0.9 * (1 - p), false); filter.tint?.(0xff5040, true); }
    } else if (filter) {
      const pulse = Math.sin(p * Math.PI * 2) ** 2;   // two soft pulses
      filter.reset();
      filter.matrix = [1 - 0.35 * pulse, 0, 0, 0, 0, 0, 1 + 0.25 * pulse, 0, 0, 0.12 * pulse, 0, 0, 1 - 0.35 * pulse, 0, 0, 0, 0, 0, 1, 0];
    }
    if (p >= 1) done();
  };
  canvas.app.ticker.add(tick);
}

/** Play a feedback payload on this client (setting, scene and visibility checked here). */
export function playHitFeedback(data) {
  try {
    if (!enabled()) return;
    const token = resolveToken(data?.uuid);
    if (!token || !token.visible) return;
    const parts = feedbackParts(data);
    parts.forEach((style, i) => floatText(token, style, i));
    animateToken(token, feedbackMotion(data));
  } catch (err) {
    console.error(`${SYSTEM_ID} | hit feedback`, err);
  }
}

/**
 * Show a HP change on every client: here directly, everywhere else through the socket broadcast.
 * @param {object} o  {tokenDoc|actor, taken, fromTemp, healed, dtype, mode, crit}
 */
export function showHitFeedback({ tokenDoc = null, actor = null, taken = 0, fromTemp = 0, healed = 0, dtype = "", mode = "ap", crit = false } = {}) {
  try {
    if (!enabled()) return;
    const uuid = tokenDoc?.uuid ?? actor?.uuid;
    if (!uuid) return;
    const data = { action: HIT_FX_ACTION, uuid, taken, fromTemp, healed, dtype, mode, crit: !!crit };
    playHitFeedback(data);
    game.socket.emit(`system.${SYSTEM_ID}`, data);
  } catch (err) {
    console.error(`${SYSTEM_ID} | hit feedback`, err);
  }
}

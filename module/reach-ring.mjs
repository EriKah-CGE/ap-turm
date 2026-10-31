/**
 * Reach ring: a faint line around the selected token at the reach of its weapon (character: equipped weapon,
 * NPC: longest reach of its attacks, 5 ft by default), measured from the token's edge. Only the most recently
 * selected token draws a ring - one PIXI graphic for the whole canvas, moved along while the token moves.
 * Players see it for the tokens they can select (their own), the GM for every token. Client setting
 * "Show reach ring" (default on).
 */
import { reachOf, ringRadius } from "./reach-logic.mjs";

const SYSTEM_ID = "ap-turm";
export const REACH_RING_SETTING = "reachRing";
const COLOR = 0xc9a86a;          // the system's gold

let ring = null;                 // PIXI.Graphics
let ringToken = null;            // Token the ring belongs to
let ringKey = "";                // what the ring was drawn for (size + reach), to redraw only on a change

export function registerReachRingSetting() {
  game.settings.register(SYSTEM_ID, REACH_RING_SETTING, {
    name: "Show reach ring", hint: "A faint ring around the selected token at the reach of its weapon (NPC: its longest melee reach).",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => refreshReachRing()
  });
}

function clearRing() {
  ringToken = null;
  ringKey = "";
  if (ring) { ring.clear(); ring.visible = false; }
}

/** The token that gets the ring: the last selected one. */
function selectedToken() {
  const list = canvas?.tokens?.controlled ?? [];
  return list.length ? list[list.length - 1] : null;
}

/** Draw (or hide) the ring for the current selection. */
export function refreshReachRing() {
  try {
    if (!canvas?.ready || !game.settings.get(SYSTEM_ID, REACH_RING_SETTING)) return clearRing();
    const token = selectedToken();
    const reach = token ? reachOf(token.actor) : null;
    if (!token || reach === null) return clearRing();
    if (!ring || ring.destroyed) {
      ring = new PIXI.Graphics();
      ring.eventMode = "none";
      canvas.controls.addChild(ring);
    }
    const { rx, ry } = ringRadius({ width: token.w, height: token.h, reach, gridSize: canvas.grid.size, gridDistance: canvas.grid.distance });
    const key = `${token.id}:${rx}:${ry}`;
    if (key !== ringKey) {
      ring.clear();
      ring.lineStyle({ width: 4, color: COLOR, alpha: 0.65, alignment: 0.5 });
      ring.drawEllipse(0, 0, rx, ry);
      ringKey = key;
    }
    ringToken = token;
    placeRing();
    ring.visible = true;
  } catch (err) { console.error(`${SYSTEM_ID} | reach ring`, err); }
}

/** Follow the token (called on every token refresh, so only a position update). */
function placeRing() {
  if (!ring || !ringToken || ringToken.destroyed) return;
  const c = ringToken.center;
  ring.position.set(c.x, c.y);
}

export function registerReachRing() {
  Hooks.on("controlToken", () => refreshReachRing());
  Hooks.on("refreshToken", (token) => { if (token === ringToken) placeRing(); });
  // the reach changes with the equipped weapon / its reach field, or an NPC's entries
  // an unlinked token has its own (synthetic) actor with the same id as the sidebar actor it follows
  const touches = (actor) => !!ringToken?.actor && actor?.documentName === "Actor" && ringToken.actor.id === actor.id;
  // a little later: an unlinked token's actor takes the change over from the sidebar actor after these hooks
  const later = foundry.utils.debounce(() => refreshReachRing(), 50);
  for (const h of ["createItem", "updateItem", "deleteItem"]) Hooks.on(h, (item) => { if (touches(item.parent)) later(); });
  Hooks.on("updateActor", (actor) => { if (touches(actor)) later(); });
  Hooks.on("updateToken", (doc) => { if (ringToken?.document === doc) later(); });
  Hooks.on("canvasTearDown", () => { clearRing(); ring = null; });
}

/** For tests in the browser: what the ring shows right now. */
export function reachRingState() {
  return { visible: !!ring?.visible, token: ringToken?.name ?? null, key: ringKey, x: ring?.position.x, y: ring?.position.y };
}

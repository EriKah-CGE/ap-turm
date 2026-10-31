/**
 * "Place copies" (GM): N tokens of one NPC around the middle of the current view, unlinked (every token keeps
 * its own HP), optionally numbered ("Gnoll 1..N"; an NPC display name becomes "Hyena 1..N" for the players)
 * and, while a combat runs, added to it without initiative (the "Roll NPC initiative" button picks them up).
 * Entry points: right-click on an NPC in the Actors sidebar, header button of the NPC sheet.
 */
import { copyCount, spawnNames, planPositions, MAX_COPIES } from "./spawn-logic.mjs";

const SYSTEM_ID = "ap-turm";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Rectangles (px) of the tokens already on the scene. */
function occupiedCells() {
  const g = canvas.grid.size;
  return (canvas.tokens?.placeables ?? []).map(t => ({ x: t.document.x, y: t.document.y, w: t.document.width * g, h: t.document.height * g }));
}

/**
 * Place the copies.
 * @param {Actor} actor  an NPC
 * @param {object} o     {count, numbered, combat: add to the running combat, center: {x, y} in scene px}
 * @returns {Promise<TokenDocument[]>}
 */
export async function placeCopies(actor, { count = 1, numbered = true, combat = false, center = null } = {}) {
  if (!game.user.isGM || actor?.type !== "npc" || !canvas.scene) return [];
  if (actor.isToken) actor = game.actors.get(actor.id) ?? actor;      // copies come from the sidebar actor
  const n = copyCount(count) ?? 1;
  const proto = actor.prototypeToken;
  const names = spawnNames({ name: proto.name || actor.name, displayName: actor.system.displayName, count: n, numbered });
  const mid = center ?? { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };
  const cells = planPositions({
    center: mid, count: n, gridSize: canvas.grid.size, size: Math.max(proto.width, proto.height),
    occupied: occupiedCells(), bounds: { width: canvas.dimensions.width, height: canvas.dimensions.height }
  });
  const data = [];
  for (let i = 0; i < cells.length; i++) {
    const doc = await actor.getTokenDocument({ x: cells[i].x, y: cells[i].y, name: names[i].name, actorLink: false });
    const obj = doc.toObject();
    // the player-facing name lives on the token's own actor data (the delta), so every copy has its own
    if (names[i].displayName) foundry.utils.setProperty(obj, "delta.system.displayName", names[i].displayName);
    data.push(obj);
  }
  const tokens = await canvas.scene.createEmbeddedDocuments("Token", data);
  if (combat && game.combat && tokens.length) {
    await game.combat.createEmbeddedDocuments("Combatant", tokens.map(t => ({ tokenId: t.id, sceneId: t.parent.id, actorId: actor.id, hidden: t.hidden })));
  }
  ui.notifications.info(`${tokens.length} × ${actor.name} placed${combat && game.combat ? " and added to the combat" : ""}.`);
  return tokens;
}

/** Dialog: how many, numbered, add to combat (only while one runs). */
export async function placeCopiesDialog(actor) {
  if (!game.user.isGM) return null;
  if (actor?.type !== "npc") { ui.notifications.warn("Place copies works for NPCs."); return null; }
  if (!canvas.scene) { ui.notifications.warn("Open a scene first."); return null; }
  const combat = game.combat;
  const res = await foundry.applications.api.DialogV2.prompt({
    window: { title: `Place copies: ${actor.name}`, icon: "fa-solid fa-clone" },
    content: `<div class="apt-spawn-dialog">
      <div class="form-group"><label>Copies</label><div class="form-fields"><input type="number" name="count" value="4" min="1" max="${MAX_COPIES}" step="1" autofocus></div></div>
      <div class="form-group"><label>Number the tokens</label><div class="form-fields"><input type="checkbox" name="numbered" checked></div></div>
      ${combat ? `<div class="form-group"><label>Add to combat</label><div class="form-fields"><input type="checkbox" name="combat" checked></div></div>` : ""}
      <p class="hint">The tokens are placed in a grid around the middle of the view, free cells first. Each has its own HP.${actor.system.displayName ? ` Players see "${esc(actor.system.displayName)} 1…N".` : ""}</p>
    </div>`,
    rejectClose: false,
    ok: {
      label: "Place", icon: "fa-solid fa-clone",
      callback: (e, b) => ({ count: copyCount(b.form.elements.count.value), numbered: !!b.form.elements.numbered.checked, combat: !!b.form.elements.combat?.checked })
    }
  });
  if (!res?.count) return null;
  return placeCopies(actor, res);
}

export function registerSpawn() {
  // right-click on an NPC in the Actors sidebar
  Hooks.on("getActorContextOptions", (app, options) => {
    options.push({
      name: "Place copies", icon: '<i class="fa-solid fa-clone"></i>',
      condition: (li) => game.user.isGM && !!canvas.scene && game.actors.get(li.closest("[data-entry-id]")?.dataset.entryId)?.type === "npc",
      callback: (li) => placeCopiesDialog(game.actors.get(li.closest("[data-entry-id]")?.dataset.entryId))
        .catch(err => console.error(`${SYSTEM_ID} | place copies`, err))
    });
  });
}

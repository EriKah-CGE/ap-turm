/**
 * Macros, hotbar drops and the token HUD buttons.
 *
 * - hotbarDrop: a weapon / spell / skill / save dragged from the sheet becomes a macro that rolls for the
 *   selected token (canvas.tokens.controlled, fallback: the user's character).
 * - System macros (folder "AP-Turm", created once by the GM in the ready hook): "Attack" (equipped weapon of
 *   the selected token vs. every targeted token, one card each), "Apply Damage" (last damage card onto the
 *   current targets), "Target Under Mouse" (target / untarget the hovered token), "Award AP" and
 *   "Grant Turmwissen" (award.mjs) and "Request Roll" (request-roll.mjs); a player running them gets a
 *   notice instead. Macros from
 *   an older, German-named version are renamed in place (RENAMED) instead of being created a second time.
 * - Token HUD: "Damage" / "Heal" buttons (dialog for N) so the GM adjusts enemies without opening the sheet.
 */
import { ABILITIES, SKILLS } from "./config.mjs";
import { rollAttack, castSpell, rollCheck, applyDamageFromMessage, applyHpDelta, d20Options, rollNpcAttack } from "./chat.mjs";

const SYSTEM_ID = "ap-turm";
const FOLDER_NAME = "AP-Turm";
const { DialogV2 } = foundry.applications.api;

/* ---------- actor resolution ---------- */

/** Actors of the controlled tokens (owned only); fallback: the user's assigned character. */
export function selectedActors() {
  const fromTokens = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(a => a?.isOwner);
  if (fromTokens.length) return [...new Set(fromTokens)];
  return game.user.character ? [game.user.character] : [];
}

function requireActor() {
  const actors = selectedActors();
  if (!actors.length) { ui.notifications.warn("Select a token (or assign a character to your user) first."); return null; }
  return actors[0];
}

/* ---------- macro entry points (game.apturm.macros.*) ---------- */

/** Roll a weapon attack or cast a spell by item name for the selected token. */
export async function rollItem(name, { event = null } = {}) {
  const actor = requireActor(); if (!actor) return null;
  const item = actor.items.find(i => i.name === name && ["weapon", "spell"].includes(i.type))
    ?? actor.items.find(i => i.name.toLowerCase() === String(name).toLowerCase());
  if (!item) { ui.notifications.warn(`${actor.name} has no item named "${name}".`); return null; }
  if (item.type === "weapon") return rollAttack(actor, item, { event });
  if (item.type === "spell") return castSpell(actor, item);
  ui.notifications.warn(`"${name}" is neither a weapon nor a spell.`);
  return null;
}

/** Roll a save / skill / ability check for the selected token. */
export async function rollCheckMacro(kind, key, { event = null } = {}) {
  const actor = requireActor(); if (!actor) return null;
  if (actor.type !== "character") { ui.notifications.warn("Checks are only available for characters."); return null; }
  return rollCheck(actor, { kind, key }, { event });
}

/** "Attack": equipped weapon of the selected token against every targeted token, one card per target. */
export async function attackAllTargets({ event = null } = {}) {
  const actor = requireActor(); if (!actor) return null;
  const targets = [...game.user.targets];
  if (actor.type === "npc") {
    const index = actor.system.entries.findIndex(e => e.toHit !== null);
    const atk = actor.system.entries[index];
    if (!atk) { ui.notifications.warn(`${actor.name} has no attacks.`); return null; }
    if (!targets.length) return rollNpcAttack(actor, index, { event });
    const opts = await d20Options(event, { title: `Attack: ${atk.name} (${targets.length} targets)` });
    if (!opts) return null;
    let last = null;
    for (const t of targets) last = await rollNpcAttack(actor, index, { target: t, opts });
    return last;
  }
  const weapons = actor.items.filter(i => i.type === "weapon");
  const weapon = weapons.find(w => w.system.equipped) ?? weapons[0];
  if (!weapon) { ui.notifications.warn(`${actor.name} has no weapon.`); return null; }
  if (!targets.length) return rollAttack(actor, weapon, { event });
  // one set of roll options (modifier keys or a single dialog) for the whole volley
  const opts = await d20Options(event, { title: `Attack: ${weapon.name} (${targets.length} targets)` });
  if (!opts) return null;
  let last = null;
  for (const t of targets) last = await rollAttack(actor, weapon, { target: t, opts });
  return last;
}

/** "Apply Damage": the newest damage card in the chat onto every current target. */
export async function applyLastDamage() {
  const msgs = game.messages.contents;
  let message = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].flags?.[SYSTEM_ID]?.type === "damage") { message = msgs[i]; break; }
  }
  if (!message) { ui.notifications.warn("No damage card in the chat."); return null; }
  const targets = [...game.user.targets];
  if (!targets.length) { ui.notifications.warn("No target selected. Target a token first."); return null; }
  for (const t of targets) await applyDamageFromMessage(message, { token: t });
  return message;
}

/** "Target Under Mouse": toggle targeting of the token under the mouse cursor (complements the T key). */
export function targetUnderMouse() {
  const token = canvas?.tokens?.hover;
  if (!token) { ui.notifications.info("No token under the mouse."); return null; }
  token.setTarget(!token.isTargeted, { releaseOthers: false });
  return token;
}

/* ---------- system macros (folder "AP-Turm") ---------- */

const SYSTEM_MACROS = [
  { name: "Attack", img: "icons/svg/sword.svg", command: "await game.apturm.macros.attackAllTargets({ event });" },
  { name: "Apply Damage", img: "icons/svg/blood.svg", command: "await game.apturm.macros.applyLastDamage();" },
  { name: "Target Under Mouse", img: "icons/svg/target.svg", command: "game.apturm.macros.targetUnderMouse();" },
  { name: "Award AP", img: "icons/svg/upgrade.svg", command: "await game.apturm.award.awardApDialog();" },
  { name: "Grant Turmwissen", img: "icons/svg/book.svg", command: "await game.apturm.award.awardTurmwissenDialog();" },
  { name: "Request Roll", img: "icons/svg/d20.svg", command: "await game.apturm.requestRoll.requestRollDialog();" },
  { name: "Combat Overview", img: "icons/svg/combat.svg", command: "await game.apturm.openCombatOverview();" },
  { name: "Jukebox", img: "icons/svg/sound.svg", command: "game.apturm.jukebox.open();" }
];

/** German names of earlier versions -> current name, so a world keeps one macro instead of two. */
const RENAMED = {
  "Angriff": "Attack",
  "Schaden anwenden": "Apply Damage",
  "Ziel unter Maus": "Target Under Mouse",
  "AP vergeben": "Award AP",
  "Turmwissen vergeben": "Grant Turmwissen"
};

/** Create the macro folder and the system macros once (GM only, missing ones only). */
export async function ensureSystemMacros() {
  if (!game.user.isGM) return;
  let folder = game.folders.find(f => f.type === "Macro" && f.name === FOLDER_NAME);
  if (!folder) folder = await Folder.implementation.create({ name: FOLDER_NAME, type: "Macro" });
  // rename the macros of an older, German-named version (hotbar slots keep working, they hold ids)
  const renames = game.macros.filter(m => m.folder?.id === folder.id && RENAMED[m.name] && !game.macros.some(x => x.name === RENAMED[m.name] && x.folder?.id === folder.id))
    .map(m => ({ _id: m.id, name: RENAMED[m.name] }));
  if (renames.length) await Macro.implementation.updateDocuments(renames);
  const missing = SYSTEM_MACROS.filter(m => !game.macros.some(x => x.name === m.name && x.folder?.id === folder.id));
  if (!missing.length) return;
  await Macro.implementation.create(missing.map(m => ({
    name: m.name, type: CONST.MACRO_TYPES.SCRIPT, img: m.img, command: m.command, folder: folder.id,
    flags: { [SYSTEM_ID]: { system: true } }
  })));
}

/* ---------- hotbar drops ---------- */

const ICONS = { weapon: "icons/svg/sword.svg", spell: "icons/svg/aura.svg", save: "icons/svg/shield.svg", skill: "icons/svg/d20.svg", ability: "icons/svg/d20.svg" };

async function findOrCreateMacro(data) {
  const existing = game.macros.find(m => m.name === data.name && m.command === data.command && m.isAuthor);
  return existing ?? Macro.implementation.create({ type: CONST.MACRO_TYPES.SCRIPT, ...data });
}

/** hotbarDrop: Item (weapon/spell) or {type:"ap-turm-roll", kind, key} from the sheet -> macro on the bar. */
async function onHotbarDrop(bar, data, slot) {
  let macro = null;
  if (data.type === "ap-turm-roll" && data.kind && data.key) {
    const label = data.kind === "skill" ? `${SKILLS[data.key]?.l ?? data.key} Check` : `${ABILITIES[data.key] ?? data.key} ${data.kind === "save" ? "Save" : "Check"}`;
    macro = await findOrCreateMacro({
      name: label, img: ICONS[data.kind] ?? ICONS.skill,
      command: `await game.apturm.macros.rollCheck(${JSON.stringify(data.kind)}, ${JSON.stringify(data.key)}, { event });`
    });
  } else if (data.type === "Item" && data.uuid) {
    const item = await fromUuid(data.uuid);
    if (!item || !["weapon", "spell"].includes(item.type)) return true;
    macro = await findOrCreateMacro({
      name: item.name, img: item.img && item.img !== "icons/svg/item-bag.svg" ? item.img : ICONS[item.type],
      command: `await game.apturm.macros.rollItem(${JSON.stringify(item.name)}, { event });`
    });
  } else return true;
  if (macro) await game.user.assignHotbarMacro(macro, slot);
  return false;
}

/* ---------- token HUD ---------- */

async function promptAmount(title, label) {
  const res = await DialogV2.prompt({
    window: { title }, rejectClose: false,
    content: `<div class="form-group"><label>${label}</label><div class="form-fields"><input type="number" name="n" value="1" min="1" step="1" autofocus></div></div>`,
    ok: { label, callback: (ev, button) => parseInt(button.form.elements.n.value) || 0 }
  });
  return res ?? null;
}

function onRenderTokenHUD(hud, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const token = hud.object;
  const actor = token?.actor;
  if (!root || !actor?.isOwner || !["character", "npc"].includes(actor.type)) return;
  const col = root.querySelector(".col.left") ?? root;
  if (col.querySelector(".ap-turm-hud")) return;
  const mk = (cls, icon, title, sign) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = `control-icon ap-turm-hud ${cls}`; b.dataset.tooltip = title;
    b.innerHTML = `<i class="fa-solid ${icon}" inert></i>`;
    b.addEventListener("click", async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const n = await promptAmount(`${title}: ${token.name}`, title);
      if (!n) return;
      await applyHpDelta(actor, sign * n, { chat: true, name: token.name, token: token.document });
    });
    return b;
  };
  col.append(mk("dmg", "fa-heart-crack", "Damage", -1), mk("heal", "fa-heart-pulse", "Heal", +1));
}

/* ---------- registration ---------- */

export const macros = { rollItem, rollCheck: rollCheckMacro, attackAllTargets, applyLastDamage, targetUnderMouse, selectedActors };

export function registerMacroHooks() {
  Hooks.on("hotbarDrop", (bar, data, slot) => {
    const isRoll = data?.type === "ap-turm-roll";
    // Items: decide synchronously (the hook cannot await) whether this is ours; other items go to core
    const item = !isRoll && data?.type === "Item" && data.uuid ? fromUuidSync(data.uuid) : null;
    if (!isRoll && !(item && ["weapon", "spell"].includes(item.type))) return;
    onHotbarDrop(bar, data, slot).catch(err => console.error(`${SYSTEM_ID} | hotbarDrop`, err));
    return false;
  });
  Hooks.on("renderTokenHUD", onRenderTokenHUD);
}

/**
 * Table UI (QoL package): turn banner, token tooltip, NPC names in the combat tracker, "Roll NPC initiative".
 *
 * - Turn change: the owner of the active token gets a banner "Your turn — Gades" and (world setting
 *   "Turn sound") Foundry's notification sound; the owner of the next token a small "Next: schmock". The GM
 *   gets neither. Every client decides for itself (combatTurnChange runs everywhere).
 * - Token tooltip (world setting "Token tooltips"): after a short hover a compact card. GM and users who may
 *   observe the actor: HP/temp, AC, conditions, element, legendary counters and recharge state. Everyone else:
 *   the display name and the condition icons only.
 * - Combatants of an NPC with a display name are created under that name; the GM's tracker shows the real one.
 * - Tracker header (GM): "Roll NPC initiative" rolls every NPC combatant without initiative in one go.
 */
import { ELEMENTS } from "./config.mjs";
import { turnNotice, nextTurnIndex, tooltipLevel, nameFor } from "./qol.mjs";

const SYSTEM_ID = "ap-turm";
export const TURN_SOUND_SETTING = "turnSound";
export const TOOLTIP_SETTING = "tokenTooltips";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const setting = (key) => { try { return game.settings.get(SYSTEM_ID, key) !== false; } catch { return true; } };

export function registerTableUiSettings() {
  game.settings.register(SYSTEM_ID, TURN_SOUND_SETTING, {
    name: "Turn sound", hint: "A short sound for the player whose turn it is (together with the \"Your turn\" banner).",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(SYSTEM_ID, TOOLTIP_SETTING, {
    name: "Token tooltips", hint: "Hovering a token shows a compact card. Players see values only for tokens they may observe, otherwise the name and conditions.",
    scope: "world", config: true, type: Boolean, default: true
  });
}

const displayName = (actor) => (actor?.type === "npc" ? String(actor.system?.displayName ?? "").trim() : "");
/** Name one viewer gets for a token / combatant (GM: real, players: an NPC's display name). */
function viewerName(actor, realName) {
  return nameFor({ type: actor?.type, name: realName || actor?.name || "", displayName: displayName(actor) }, { isGM: game.user.isGM });
}

/* ============================================================
   Turn notice
   ============================================================ */

function showBanner(text, { small = false } = {}) {
  const el = document.createElement("div");
  el.className = `apt-turn-banner${small ? " small" : ""}`;
  el.innerHTML = small ? `<i class="fa-solid fa-hourglass-half"></i> ${esc(text)}` : `<i class="fa-solid fa-dice-d20"></i> ${esc(text)}`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 600); }, small ? 3500 : 4200);
}

function onTurnChange(combat) {
  try {
    if (!combat?.started || game.user.isGM) return;
    const turns = combat.turns ?? [];
    const cur = combat.combatant;
    const ni = nextTurnIndex(turns.map(c => ({ defeated: c.isDefeated ?? c.defeated })), combat.turn);
    const next = ni === null ? null : turns[ni];
    const owns = (c) => !!c?.actor?.isOwner;
    const notice = turnNotice({ isGM: false, ownsCurrent: owns(cur), ownsNext: owns(next) && next !== cur });
    if (notice.banner) {
      showBanner(`Your turn — ${viewerName(cur.actor, cur.name)}`);
      if (setting(TURN_SOUND_SETTING)) foundry.audio.AudioHelper.play({ src: CONFIG.sounds.notification, volume: 0.6, autoplay: true, loop: false }, false);
    }
    if (notice.next) showBanner(`Next: ${viewerName(next.actor, next.name)}`, { small: true });
  } catch (err) { console.error(`${SYSTEM_ID} | turn notice`, err); }
}

/* ============================================================
   Token tooltip
   ============================================================ */

let tipTimer = null;
function tipEl() {
  let el = document.getElementById("apt-token-tip");
  if (!el) { el = document.createElement("div"); el.id = "apt-token-tip"; document.body.append(el); }
  return el;
}
function hideTip() {
  clearTimeout(tipTimer); tipTimer = null;
  document.getElementById("apt-token-tip")?.classList.remove("show");
}

/** Card HTML for a token at the given level. */
function tipContent(token, level) {
  const actor = token.actor;
  const sys = actor.system;
  const name = viewerName(actor, token.name);
  const statuses = CONFIG.statusEffects.filter(e => actor.statuses?.has(e.id));
  const icons = statuses.map(s => `<img src="${esc(s.img)}" title="${esc(game.i18n.localize(s.name))}" alt="">`).join("");
  if (level !== "full") return `<div class="n">${esc(name)}</div>${icons ? `<div class="icons">${icons}</div>` : ""}`;
  const hp = sys.hp ?? {};
  const max = hp.max ?? sys.derived?.hpMax ?? 0;
  const val = hp.value ?? max;
  const rows = [`<div class="r"><span>HP</span><b>${val} / ${max}${hp.temp ? ` <small>+${hp.temp} temp</small>` : ""}</b></div>`,
    `<div class="r"><span>AC</span><b>${sys.ac ?? "—"}</b></div>`];
  if (actor.type === "npc" && sys.element && ELEMENTS[sys.element]) {
    rows.push(`<div class="r"><span>Element</span><b style="color:${ELEMENTS[sys.element].c}">${esc(ELEMENTS[sys.element].l)}</b></div>`);
  }
  if (actor.type === "npc") {
    const la = sys.legendary?.actions, lr = sys.legendary?.resist;
    if (la?.max) rows.push(`<div class="r"><span>Legendary actions</span><b>${la.value}/${la.max}</b></div>`);
    if (lr?.max) rows.push(`<div class="r"><span>Legendary resist.</span><b>${lr.value}/${lr.max}</b></div>`);
    const rech = (sys.entries ?? []).filter(e => e.recharge);
    for (const e of rech) rows.push(`<div class="r"><span>${esc(e.name)} <small>(${esc(e.recharge)})</small></span><b class="${e.rechargeUsed ? "used" : "ready"}">${e.rechargeUsed ? "used" : "ready"}</b></div>`);
  }
  const conds = statuses.map(s => esc(game.i18n.localize(s.name))).join(", ");
  return `<div class="n">${esc(name)}</div>${rows.join("")}${conds ? `<div class="conds">${icons}<span>${conds}</span></div>` : ""}`;
}

function showTip(token) {
  if (!token?.actor || !token.visible) return;
  const level = tooltipLevel({ isGM: game.user.isGM, canObserve: token.actor.testUserPermission(game.user, "OBSERVER") });
  const el = tipEl();
  el.innerHTML = tipContent(token, level);
  el.className = level;
  const p = canvas.clientCoordinatesFromCanvas({ x: token.x + token.w, y: token.y });
  el.style.left = `${Math.round(p.x + 8)}px`;
  el.style.top = `${Math.round(p.y)}px`;
  el.classList.add("show");
  // keep it inside the window
  const r = el.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) el.style.left = `${Math.round(canvas.clientCoordinatesFromCanvas({ x: token.x, y: token.y }).x - r.width - 8)}px`;
  if (r.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - r.height - 8)}px`;
}

function onHoverToken(token, hovered) {
  try {
    clearTimeout(tipTimer);
    if (!hovered || !setting(TOOLTIP_SETTING) || !["character", "npc"].includes(token.actor?.type)) { hideTip(); return; }
    tipTimer = setTimeout(() => { try { showTip(token); } catch (err) { console.error(`${SYSTEM_ID} | token tooltip`, err); } }, 450);
  } catch (err) { console.error(`${SYSTEM_ID} | token tooltip`, err); }
}

/* ============================================================
   Combat tracker
   ============================================================ */

/** Roll initiative for every NPC combatant that has none yet (characters stay untouched). */
export async function rollNpcInitiative(combat = game.combat) {
  if (!game.user.isGM) return null;
  if (!combat) { ui.notifications.warn("No combat."); return null; }
  const ids = combat.combatants.filter(c => c.actor?.type === "npc" && (c.initiative === null || c.initiative === undefined)).map(c => c.id);
  if (!ids.length) { ui.notifications.info("Every NPC already has an initiative."); return null; }
  return combat.rollInitiative(ids);
}

function onRenderTracker(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || !game.user.isGM) return;
  const combat = app.viewed ?? game.combat;
  // real names for the GM where a combatant was created under an NPC's display name
  root.querySelectorAll("li.combatant[data-combatant-id]").forEach(li => {
    const c = combat?.combatants.get(li.dataset.combatantId);
    if (!c || !displayName(c.actor)) return;
    const real = c.token?.name || c.actor?.name;
    const n = li.querySelector(".token-name .name");
    if (n && real && n.textContent !== real) { n.textContent = real; n.title = `Players see: ${c.name}`; }
  });
  const bar = root.querySelector(".encounter-controls .control-buttons.left");
  if (bar && !bar.querySelector(".apt-npc-init")) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "inline-control combat-control icon fa-solid fa-dragon apt-npc-init";
    b.dataset.tooltip = "Roll NPC initiative";
    b.setAttribute("aria-label", "Roll NPC initiative");
    if (!combat?.turns?.length) b.disabled = true;
    b.addEventListener("click", (ev) => { ev.preventDefault(); rollNpcInitiative(combat).catch(err => console.error(`${SYSTEM_ID} | NPC initiative`, err)); });
    bar.append(b);
  }
}

/* ============================================================
   Registration
   ============================================================ */

export function registerTableUi() {
  Hooks.on("combatTurnChange", (combat) => onTurnChange(combat));
  Hooks.on("hoverToken", onHoverToken);
  for (const h of ["canvasPan", "deleteToken", "controlToken", "canvasTearDown"]) Hooks.on(h, hideTip);
  Hooks.on("renderCombatTracker", onRenderTracker);
  // an NPC with a display name joins the tracker under that name
  Hooks.on("preCreateCombatant", (combatant) => {
    const d = displayName(combatant.actor);
    if (d && !combatant._source.name) combatant.updateSource({ name: d });
  });
}

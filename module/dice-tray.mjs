/**
 * Dice tray: a narrow bar directly below the chat input (#chat-message). Foundry v13 moves that input between the
 * sidebar chat log, the chat popout and the notification area (sidebar collapsed or another tab active) and fires
 * "renderChatInput" every time; the tray is one persistent element that follows the input on that hook, so its
 * state survives tab switches, collapsing and popping out.
 *
 * Left click on a die adds it to the formula, right click removes one, Shift+click rolls just that die. Adv/Dis
 * turn the d20 into 2d20kh1/2d20kl1, "Reroll 1s" adds rr1 (dice-tray-logic.mjs). The formula field is editable;
 * Enter rolls it. The rolled formula stays until Clear. Rolls are real Roll objects via Roll#toMessage, so the roll
 * mode follows the chat's roll-mode selection and Dice So Nice picks them up.
 *
 * Also exports rollPlainD20(actor, event) for the "Roll d20" button in the sheet headers.
 */
import { TRAY_DICE, emptyTray, addDie, removeDie, toggleAdv, toggleReroll, setMod, trayFormula, singleDieFormula, plainD20Formula } from "./dice-tray-logic.mjs";
import { rollModeFromEvent } from "./rolls.mjs";
import { displayNameOf } from "./chat.mjs";

const SYSTEM_ID = "ap-turm";
export const TRAY_SHOW = "diceTrayShow";
const TEMPLATE = "systems/ap-turm/templates/dice-tray.hbs";

let state = emptyTray();
let element = null;
let creating = null;

const L = (key) => game.i18n.localize(`AP_TURM.DiceTray.${key}`);

/* ---------- speaker and roll ---------- */

/** NPCs with a display name speak under that name (players never see the real one). */
function withDisplayName(speaker, actor) {
  const d = displayNameOf(actor);
  if (d) speaker.alias = d;
  return speaker;
}

/** Tray: the selected token, else the user's character, else the user. */
function traySpeaker() {
  const CM = ChatMessage.implementation;
  const speaker = CM.getSpeaker();
  let actor = null;
  try { actor = CM.getSpeakerActor(speaker); } catch { actor = null; }
  return withDisplayName(speaker, actor);
}

async function rollFormula(formula, { speaker, flavor } = {}) {
  const f = String(formula ?? "").trim();
  if (!f) { ui.notifications.warn(L("Empty")); return null; }
  if (!Roll.validate(f)) { ui.notifications.warn(game.i18n.format("AP_TURM.DiceTray.Invalid", { formula: f })); return null; }
  try {
    // no rollMode passed: Roll#toMessage uses the roll mode currently selected in the chat
    return await new Roll(f).toMessage({ speaker: speaker ?? traySpeaker(), flavor });
  } catch (err) {
    console.error(`${SYSTEM_ID} | dice tray`, err);
    ui.notifications.warn(game.i18n.format("AP_TURM.DiceTray.Invalid", { formula: f }));
    return null;
  }
}

/** "Roll d20" in the sheet header: plain d20, Shift = advantage, Ctrl/Alt = disadvantage, speaker = this actor. */
export function rollPlainD20(actor, event) {
  const { mode } = rollModeFromEvent({ shiftKey: event?.shiftKey, ctrlKey: event?.ctrlKey, altKey: event?.altKey, metaKey: event?.metaKey });
  const speaker = withDisplayName(ChatMessage.implementation.getSpeaker({ actor }), actor);
  const label = { advantage: L("Advantage"), disadvantage: L("Disadvantage") }[mode];
  return rollFormula(plainD20Formula(mode), { speaker, flavor: label ? `${L("RollD20")} · ${label}` : L("RollD20") });
}

/* ---------- tray state <-> DOM ---------- */

function sync({ formula = true } = {}) {
  if (!element) return;
  for (const btn of element.querySelectorAll('[data-dt="die"]')) {
    const n = state.counts[btn.dataset.faces] || 0;
    const badge = btn.querySelector(".apt-dt-count");
    badge.hidden = !n;
    badge.textContent = n ? `×${n}` : "";
    btn.classList.toggle("active", n > 0);
  }
  for (const btn of element.querySelectorAll('[data-dt="adv"]')) btn.ariaPressed = String(state.adv === btn.dataset.mode);
  element.querySelector('[data-dt="reroll"]').ariaPressed = String(state.reroll);
  if (formula) element.querySelector('[data-dt="formula"]').value = trayFormula(state);
}

function clear() {
  state = emptyTray();
  element.querySelector('[data-dt="mod"]').value = "";
  sync();
}

function rollCurrent() {
  return rollFormula(element.querySelector('[data-dt="formula"]').value, { flavor: L("Label") });
}

function onClick(event) {
  const btn = event.target.closest("[data-dt]");
  if (!btn || btn.tagName !== "BUTTON") return;
  event.preventDefault();
  switch (btn.dataset.dt) {
    case "die": {
      const faces = Number(btn.dataset.faces);
      if (event.shiftKey) { rollFormula(singleDieFormula(faces), { flavor: L("Label") }); return; }
      state = addDie(state, faces);
      break;
    }
    case "adv": state = toggleAdv(state, btn.dataset.mode); break;
    case "reroll": state = toggleReroll(state); break;
    case "roll": rollCurrent(); return;
    case "clear": clear(); return;
    default: return;
  }
  sync();
}

function onContextMenu(event) {
  const btn = event.target.closest('[data-dt="die"]');
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  state = removeDie(state, Number(btn.dataset.faces));
  sync();
}

function onInput(event) {
  if (event.target.dataset.dt !== "mod") return;
  state = setMod(state, event.target.value);
  sync();
}

function onKeyDown(event) {
  const dt = event.target.dataset?.dt;
  if (event.key !== "Enter" || (dt !== "formula" && dt !== "mod")) return;
  event.preventDefault();
  event.stopPropagation();
  rollCurrent();
}

async function createElement() {
  const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    dice: TRAY_DICE.map(faces => ({
      faces,
      percentile: faces === 100,
      tooltip: game.i18n.format("AP_TURM.DiceTray.DieTooltip", { faces })
    }))
  });
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  const el = tpl.content.firstElementChild;
  el.addEventListener("click", onClick);
  el.addEventListener("contextmenu", onContextMenu);
  el.addEventListener("input", onInput);
  el.addEventListener("keydown", onKeyDown);
  return el;
}

/* ---------- placement ---------- */

const shown = () => game.settings.get(SYSTEM_ID, TRAY_SHOW) !== false;

/** Put the tray directly after the chat input, wherever Foundry currently has it; remove it when switched off. */
export async function placeDiceTray(input = document.getElementById("chat-message")) {
  if (!shown()) { element?.remove(); return; }
  if (!input) return;
  if (!element) {
    creating ??= createElement();
    element = await creating;
    sync();
  }
  if (input.nextElementSibling !== element) input.after(element);
}

export function registerDiceTraySetting() {
  game.settings.register(SYSTEM_ID, TRAY_SHOW, {
    name: "AP_TURM.DiceTray.Setting",
    hint: "AP_TURM.DiceTray.SettingHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => placeDiceTray().catch(err => console.error(`${SYSTEM_ID} | dice tray`, err))
  });
}

export function registerDiceTray() {
  const place = (input) => placeDiceTray(input).catch(err => console.error(`${SYSTEM_ID} | dice tray`, err));
  Hooks.on("renderChatInput", (_app, elements) => place(elements?.["#chat-message"]));
  Hooks.on("renderChatLog", () => place());
  Hooks.once("ready", () => place());
}

export const diceTray = {
  get state() { return structuredClone(state); },
  formula: () => trayFormula(state),
  place: placeDiceTray,
  rollPlainD20
};

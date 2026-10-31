/**
 * Condition quick bar: a narrow, always visible AppV2 window docked above the hotbar (draggable, position
 * remembered in a client setting). One icon per condition, exhaustion as a single icon with its level.
 * Click toggles the condition on the controlled tokens, else on the targeted ones; the exhaustion icon
 * steps up on click and down on right-click. Icons mark the state of the primary selected token.
 */
import { CONDITIONS, CHIP_ORDER, conditionChips, toggleTargets } from "./conditions.mjs";
import { toggleCondition, currentExhaustion } from "./chat.mjs";

const SYSTEM_ID = "ap-turm";
export const BAR_SHOW = "conditionBarShow";      // client: bar visible
export const BAR_POS = "conditionBarPos";        // client: {left, top} or null
export const BAR_GM_ONLY = "conditionBarGmOnly"; // world: only GMs see the bar

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class ConditionBar extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "ap-turm-condition-bar",
    classes: ["ap-turm", "apt-condbar"],
    window: { frame: false, positioned: true },
    position: { width: "auto", height: "auto" },
    actions: {
      toggleCondition: { handler: ConditionBar.#onToggle, buttons: [0, 2] },
      closeBar: ConditionBar.#onClose
    }
  };

  static PARTS = { bar: { template: "systems/ap-turm/templates/hud/condition-bar.hbs" } };

  /** The token whose state the icons show: the first controlled token, else the first target. */
  static primaryToken() {
    return canvas?.tokens?.controlled?.[0] ?? [...(game.user?.targets ?? [])][0] ?? null;
  }

  async _prepareContext() {
    const token = ConditionBar.primaryToken();
    const actor = token?.actor ?? null;
    const statuses = actor?.statuses ?? [];
    const lvl = actor ? currentExhaustion(actor) : 0;
    const chips = conditionChips(statuses, lvl);
    return {
      token: token?.name ?? "",
      chips: chips.map(c => ({
        ...c,
        tooltip: c.exhaustion
          ? `Exhaustion${lvl ? ` ${lvl}` : ""} — click: +1, right-click: -1`
          : `${c.name} — click: toggle`
      }))
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const grip = this.element.querySelector(".apt-condbar-grip");
    if (grip) grip.addEventListener("pointerdown", (ev) => this.#startDrag(ev));
  }

  /** Drag the bar by its grip; the position is remembered per client. */
  #startDrag(ev) {
    ev.preventDefault();
    const rect = this.element.getBoundingClientRect();
    const dx = ev.clientX - rect.left, dy = ev.clientY - rect.top;
    const move = (e) => this.setPosition({ left: e.clientX - dx, top: e.clientY - dy });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      game.settings.set(SYSTEM_ID, BAR_POS, { left: Math.round(this.position.left), top: Math.round(this.position.top) })
        .catch(err => console.error(`${SYSTEM_ID} | condition bar position`, err));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Place the bar above the hotbar on the first render unless a stored position exists. */
  _updatePosition(position) {
    if (position.left === undefined || position.left === null) {
      const stored = game.settings.get(SYSTEM_ID, BAR_POS);
      if (stored && Number.isFinite(stored.left)) Object.assign(position, stored);
      else {
        const bottom = document.getElementById("ui-bottom")?.getBoundingClientRect();
        position.left = Math.round(bottom ? bottom.left : window.innerWidth / 2 - 200);
        position.top = Math.round((bottom ? bottom.top : window.innerHeight - 120) - 46);
      }
    }
    return super._updatePosition(position);
  }

  /* ---------- actions ---------- */

  /** Click / right-click on an icon: toggle it on every token of the current selection. */
  static async #onToggle(event, target) {
    const id = target.dataset.id;
    const right = event.button === 2 || event.type === "contextmenu";
    if (right) event.preventDefault();
    const { tokens, source } = toggleTargets({ controlled: canvas?.tokens?.controlled ?? [], targets: game.user?.targets ?? [] });
    if (!tokens.length) { ui.notifications.warn("No token selected or targeted."); return; }
    for (const t of tokens) {
      const actor = t.actor;
      if (!actor) continue;
      if (id === "exhaustion") await toggleCondition(actor, "exhaustion", { delta: right ? -1 : 1 });
      else await toggleCondition(actor, id);
    }
    if (source === "targets") ui.notifications.info(`Condition applied to ${tokens.length} target${tokens.length === 1 ? "" : "s"}.`);
    this.render();
  }

  static #onClose() { return game.settings.set(SYSTEM_ID, BAR_SHOW, false); }
}

/** The one bar instance (created on demand). */
export const conditionBar = { app: null };

/** Is the bar allowed and switched on for this user? */
export function barVisible() {
  if (!game.settings.get(SYSTEM_ID, BAR_SHOW)) return false;
  if (game.settings.get(SYSTEM_ID, BAR_GM_ONLY) && !game.user.isGM) return false;
  return true;
}

/** Show / hide / re-render the bar according to the settings. */
export async function refreshConditionBar({ force = false } = {}) {
  const want = barVisible();
  if (!want) { await conditionBar.app?.close(); conditionBar.app = null; return null; }
  conditionBar.app ??= new ConditionBar();
  if (!conditionBar.app.rendered || force) return conditionBar.app.render({ force: true });
  return conditionBar.app.render();
}

export function registerConditionBarSettings() {
  game.settings.register(SYSTEM_ID, BAR_SHOW, {
    name: "AP_TURM.Settings.ConditionBar.Name", hint: "AP_TURM.Settings.ConditionBar.Hint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => refreshConditionBar({ force: true })
  });
  game.settings.register(SYSTEM_ID, BAR_POS, { scope: "client", config: false, type: Object, default: null });
  game.settings.register(SYSTEM_ID, BAR_GM_ONLY, {
    name: "AP_TURM.Settings.ConditionBarGm.Name", hint: "AP_TURM.Settings.ConditionBarGm.Hint",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => refreshConditionBar({ force: true })
  });
}

/** Scene control toggle (token group) plus the hooks that keep the bar in sync. */
export function registerConditionBarHooks() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const tokens = controls.tokens ?? controls.token;
    if (!tokens?.tools) return;
    tokens.tools.apturmConditions = {
      name: "apturmConditions",
      order: Object.keys(tokens.tools).length + 10,
      title: "AP_TURM.Settings.ConditionBar.Name",
      icon: "fa-solid fa-hand-sparkles",
      toggle: true,
      visible: !game.settings.get(SYSTEM_ID, BAR_GM_ONLY) || game.user.isGM,
      active: game.settings.get(SYSTEM_ID, BAR_SHOW),
      onChange: (event, toggled) => game.settings.set(SYSTEM_ID, BAR_SHOW, toggled)
    };
  });
  // the icons mirror the primary token, so re-render whenever the selection, the targets or effects change
  for (const hook of ["controlToken", "targetToken", "canvasReady"]) Hooks.on(hook, () => conditionBar.app?.rendered && conditionBar.app.render());
  for (const hook of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"]) {
    Hooks.on(hook, (effect) => {
      if (!conditionBar.app?.rendered) return;
      if (effect.parent?.uuid === ConditionBar.primaryToken()?.actor?.uuid) conditionBar.app.render();
    });
  }
  // a character's exhaustion lives on the sheet, so an actor update alone can change what the bar shows
  Hooks.on("updateActor", (actor) => {
    if (!conditionBar.app?.rendered) return;
    if (actor.uuid === ConditionBar.primaryToken()?.actor?.uuid) conditionBar.app.render();
  });
}

/** Condition list for the "+" menu on the sheets. */
export function conditionMenu() {
  return CHIP_ORDER.map(id => ({ id, name: CONDITIONS[id].name, img: CONDITIONS[id].img }))
    .concat([{ id: "exhaustion", name: "Exhaustion +1", img: "systems/ap-turm/icons/exhaustion-1.svg" }]);
}

/**
 * GM combat overview (Paket C.1): one window with every participant of the running combat as a compact row -
 * name, hit points as an editable field with a bar, temporary hit points, AC, the active conditions as small
 * icons, and for NPCs the legendary counters and the recharge abilities with their state.
 *
 * Without a running combat the window lists the tokens of the current scene in the same row format, so it is
 * useful before the first initiative roll as well.
 *
 * Everything is written through the same paths the sheets and the token HUD use (applyHpDelta / actor.update
 * for hit points, toggleCondition for conditions, the NPC data model for legendary counters and recharges),
 * so the downed status sync runs exactly as everywhere else.
 *
 * Live updates replace single rows instead of re-rendering the whole window, so nothing flickers and a field
 * the GM is typing in keeps its focus; changes that reorder the list (combat, tokens) do a full render.
 */
import { applyHpDelta, toggleCondition, currentExhaustion } from "./chat.mjs";
import { activeChips } from "./conditions.mjs";
import { SheetSizeMixin } from "./sheets/sizing.mjs";

const SYSTEM_ID = "ap-turm";
const TPL = "systems/ap-turm/templates/hud/";
const ROW_TPL = TPL + "combat-overview-row.hbs";
const render = (path, data) => foundry.applications.handlebars.renderTemplate(path, data);
const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/* ============================================================
   Pure logic
   ============================================================ */

/**
 * New hit point value from what the GM typed. A leading + or - is a change, a plain number is the new value.
 * @param {string} raw     field content
 * @param {number} current current hit points
 * @param {number} max
 * @returns {{delta:number}|{value:number}|null}  null = nothing usable typed
 */
export function hpInput(raw, current, max) {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const rel = /^([+-])\s*(\d+)$/.exec(t);
  if (rel) {
    const n = parseInt(rel[2], 10);
    return n ? { delta: rel[1] === "-" ? -n : n } : null;
  }
  if (!/^\d+$/.test(t)) return null;
  const m = Number(max) || 0;
  const n = parseInt(t, 10);
  const v = m > 0 ? Math.max(0, Math.min(m, n)) : Math.max(0, n);
  return v === current ? null : { value: v };
}

/** Percentage for the hit point bar. */
export function hpPercent(value, max) {
  const m = Number(max) || 0;
  if (m <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(100 * (Number(value) || 0) / m)));
}

/* ============================================================
   Foundry side
   ============================================================ */

/** Row data for one token / actor pair. */
function rowFor(tokenDoc, actor, { current = false, initiative = null } = {}) {
  if (!actor) return null;
  const sys = actor.system;
  const isNpc = actor.type === "npc";
  const hp = { value: sys.hp?.value ?? 0, max: sys.hp?.max ?? 0, temp: sys.hp?.temp ?? 0 };
  const row = {
    id: tokenDoc?.uuid ?? actor.uuid,
    actorUuid: actor.uuid,
    tokenUuid: tokenDoc?.uuid ?? "",
    name: tokenDoc?.name || actor.name,
    img: tokenDoc?.texture?.src || actor.img,
    isNpc, current, downed: hp.value <= 0,
    init: initiative === null || initiative === undefined ? "" : String(initiative),
    ac: sys.ac ?? 10,
    hp, pct: hpPercent(hp.value, hp.max),
    chips: activeChips(actor.statuses ?? [], currentExhaustion(actor)).map(c => ({ id: c.id, name: c.name, img: c.img, level: c.level, exhaustion: c.exhaustion })),
    legendary: [], recharges: []
  };
  if (isNpc) {
    const pips = (c) => Array.from({ length: c.max }, (_, i) => ({ i: i + 1, used: i >= c.value }));
    for (const [kind, label] of [["resist", "Legendary Resistances"], ["actions", "Legendary Actions"]]) {
      const c = sys.legendary?.[kind];
      if (c?.max > 0) row.legendary.push({ kind, label, value: c.value, max: c.max, pips: pips(c) });
    }
    (sys.entries ?? []).forEach((e, index) => {
      if (!e.recharge || e.parent) return;
      row.recharges.push({ index, name: e.name || "(unnamed)", recharge: e.recharge, used: !!e.rechargeUsed });
    });
  }
  return row;
}

export class CombatOverview extends SheetSizeMixin(HandlebarsApplicationMixin(ApplicationV2), "combatOverview") {

  static DEFAULT_OPTIONS = {
    id: "ap-turm-combat-overview",
    classes: ["ap-turm", "apt-overview"],
    window: { title: "AP_TURM.Overview.Title", icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 520, height: 620 },
    actions: {
      overviewCondition: { handler: CombatOverview.#onCondition, buttons: [0, 2] },
      overviewLegendary: CombatOverview.#onLegendary,
      overviewRecharge: CombatOverview.#onRecharge,
      overviewPan: CombatOverview.#onPan,
      overviewSheet: CombatOverview.#onSheet
    }
  };

  static PARTS = {
    list: { template: TPL + "combat-overview.hbs", templates: [ROW_TPL], scrollable: [""] }
  };

  /* ---------- context ---------- */

  /** Every participant of the running combat in initiative order, else the tokens of the current scene. */
  rows() {
    const combat = game.combat;
    if (combat?.turns?.length) {
      return combat.turns
        .map((c, i) => rowFor(c.token, c.actor, { current: combat.turn === i, initiative: c.initiative }))
        .filter(Boolean);
    }
    const tokens = canvas?.tokens?.placeables ?? [];
    return tokens.map(t => rowFor(t.document, t.actor, {})).filter(Boolean);
  }

  async _prepareContext(options) {
    const combat = game.combat;
    const inCombat = !!combat?.turns?.length;
    return {
      ...(await super._prepareContext(options)),
      rows: this.rows(), inCombat,
      subtitle: inCombat
        ? `Round ${combat.round || 0} · ${combat.turns.length} participant${combat.turns.length === 1 ? "" : "s"}`
        : (canvas?.scene?.name ? `${canvas.scene.name} · no combat running` : "No scene")
    };
  }

  /* ---------- listeners ---------- */

  /** Delegated: the hit point fields are replaced with their rows, the listener stays on the window. */
  #onChange = (event) => {
    const input = event.target.closest?.("input.hp");
    if (!input) return;
    this.#onHp(input).catch(err => console.error(`${SYSTEM_ID} | overview hp`, err));
  };

  /** Enter in a hit point field commits it (blur fires the change). */
  #onKeyDown = (event) => {
    if (event.key === "Enter" && event.target.classList?.contains("hp")) event.target.blur();
  };

  // re-attached on every render (removing first keeps it at one listener, whatever the render rebuilt)
  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    if (!el) return;
    for (const [type, fn] of [["change", this.#onChange], ["keydown", this.#onKeyDown]]) {
      el.removeEventListener(type, fn);
      el.addEventListener(type, fn);
    }
  }

  /* ---------- row helpers ---------- */

  #row(target) {
    const el = target.closest("[data-row]");
    return el ? { el, id: el.dataset.row, actorUuid: el.dataset.actor } : null;
  }

  #actorOf(target) {
    const row = this.#row(target);
    if (!row) return null;
    const doc = fromUuidSync(row.id);
    return doc?.documentName === "Token" ? doc.actor : (doc?.documentName === "Actor" ? doc : fromUuidSync(row.actorUuid));
  }

  #tokenOf(target) {
    const row = this.#row(target);
    const doc = row ? fromUuidSync(row.id) : null;
    return doc?.documentName === "Token" ? doc : null;
  }

  /* ---------- actions ---------- */

  /** Hit point field: "12" sets the value, "+5" / "-3" change it (the token HUD's path). */
  async #onHp(input) {
    const actor = this.#actorOf(input);
    if (!actor) return;
    const sys = actor.system;
    const cmd = hpInput(input.value, sys.hp.value, sys.hp.max);
    if (!cmd) { input.value = sys.hp.value; return; }
    const tokenDoc = this.#tokenOf(input);
    if (cmd.delta !== undefined) await applyHpDelta(actor, cmd.delta, { name: tokenDoc?.name ?? actor.name, token: tokenDoc });
    else await actor.update({ "system.hp.value": cmd.value });
  }

  /** Click on a condition icon removes it (exhaustion steps one level down, right-click one up). */
  static #onCondition(event, target) {
    const actor = this.#actorOf(target);
    if (!actor) return null;
    const id = target.dataset.id;
    const right = event.button === 2 || event.type === "contextmenu";
    if (right) event.preventDefault();
    if (id === "exhaustion") return toggleCondition(actor, "exhaustion", { delta: right ? 1 : -1 });
    return toggleCondition(actor, id, { active: false });
  }

  static #onLegendary(event, target) {
    const actor = this.#actorOf(target);
    if (actor?.type !== "npc") return null;
    return actor.system.setLegendary(target.dataset.kind, Number(target.dataset.i));
  }

  static #onRecharge(event, target) {
    const actor = this.#actorOf(target);
    if (actor?.type !== "npc") return null;
    const index = Number(target.dataset.index);
    return actor.system.setEntryRecharge(index, !actor.system.entries[index]?.rechargeUsed);
  }

  static #onPan(event, target) {
    const tokenDoc = this.#tokenOf(target);
    const token = tokenDoc?.object;
    if (!token) { ui.notifications.info("This participant has no token on the current scene."); return; }
    token.control({ releaseOthers: true });
    return canvas.animatePan({ x: token.center.x, y: token.center.y });
  }

  static #onSheet(event, target) {
    const actor = this.#actorOf(target);
    return actor?.sheet?.render({ force: true });
  }

  /* ---------- live updates ---------- */

  /** Replace the rows of one actor in place (a row whose field has the focus is left alone). */
  async refreshActor(actorUuid) {
    if (!this.rendered || !actorUuid) return;
    const rows = this.rows().filter(r => r.actorUuid === actorUuid);
    for (const row of rows) {
      const el = this.element.querySelector(`[data-row="${CSS.escape(row.id)}"]`);
      if (!el || el.contains(document.activeElement)) continue;
      el.outerHTML = await render(ROW_TPL, row);
    }
  }
}

/** The one overview instance (created on demand). */
export const combatOverview = { app: null };

/** Open (or focus) the overview; GM only. */
export async function openCombatOverview() {
  if (!game.user.isGM) { ui.notifications.warn("The combat overview is for the GM."); return null; }
  combatOverview.app ??= new CombatOverview();
  if (combatOverview.app.rendered) { combatOverview.app.bringToFront?.(); return combatOverview.app; }
  return combatOverview.app.render({ force: true });
}

/** Hooks: button in the combat tracker header plus the live updates of the open window. */
export function registerCombatOverviewHooks() {
  Hooks.on("renderCombatTracker", (app, html) => {
    if (!game.user.isGM) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const bar = root?.querySelector(".encounter-controls .control-buttons.left") ?? root?.querySelector(".encounter-controls");
    if (!bar || bar.querySelector(".ap-turm-overview-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "inline-control combat-control icon fa-solid fa-list-check ap-turm-overview-btn";
    btn.dataset.tooltip = "AP-Turm: Combat Overview";
    btn.setAttribute("aria-label", "AP-Turm: Combat Overview");
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openCombatOverview().catch(err => console.error(`${SYSTEM_ID} | combat overview`, err));
    });
    bar.prepend(btn);
  });

  const app = () => (combatOverview.app?.rendered ? combatOverview.app : null);
  const full = foundry.utils.debounce(() => app()?.render(), 50);
  const row = (uuid) => app()?.refreshActor(uuid).catch(err => console.error(`${SYSTEM_ID} | overview row`, err));

  Hooks.on("updateActor", (actor) => row(actor.uuid));
  for (const hook of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"]) {
    Hooks.on(hook, (effect) => { if (effect.parent?.documentName === "Actor") row(effect.parent.uuid); });
  }
  // anything that changes who is listed or in which order: full render
  for (const hook of ["updateCombat", "createCombatant", "deleteCombatant", "updateCombatant", "deleteCombat", "createCombat",
    "createToken", "deleteToken", "updateToken", "canvasReady"]) Hooks.on(hook, () => full());
}

export const overview = { CombatOverview, openCombatOverview, combatOverview, hpInput, hpPercent };

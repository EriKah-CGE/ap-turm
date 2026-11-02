/**
 * Tower tracker: level, element, quakes and time of the current tower run.
 *
 * State: one world setting (towerRun, see tower-tracker-logic.mjs). Only the GM writes it, every client reads it;
 * the setting's onChange re-renders the GM window and the players' HUD on every client.
 *
 * - GM window "Tower Tracker" (button next to the AP-Turm button in the Actors tab): enter / leave the tower,
 *   level, element (d20 roll or override), time booking (interval quakes), quakes, collapse + uncontrolled
 *   landing (RollTable "Uncontrolled Landing", created on first use), log with "Undo last".
 * - Every action is logged in the run (time stamp = time inside) and as a line in the run's journal
 *   "Tower Log <date>".
 * - HUD for everybody (client setting "Show tower HUD"): compact bar right below the scene control buttons.
 * - Third quake and collapse: chat card with a flag; every client shows a banner when such a card is created.
 */
import { ELEMENTS } from "./config.mjs";
import * as L from "./tower-tracker-logic.mjs";

const SYSTEM_ID = "ap-turm";
export const TOWER_RUN = "towerRun";
export const TOWER_HUD = "towerHud";
const TPL = "systems/ap-turm/templates/";
export const LANDING_TABLE = "Uncontrolled Landing";
const LANDING_RESULTS = ["Trap", "Fight – bad position", "Fight – surrounded", "Lucky – quiet spot"];

const { HandlebarsApplicationMixin, ApplicationV2, DialogV2 } = foundry.applications.api;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const T = (key, data) => data ? game.i18n.format(`AP_TURM.Tower.${key}`, data) : game.i18n.localize(`AP_TURM.Tower.${key}`);
const elLabel = (k) => ELEMENTS[k]?.l ?? "";

/* ============================================================
   State
   ============================================================ */

export function getRun() {
  try { return L.normalizeRun(game.settings.get(SYSTEM_ID, TOWER_RUN)); } catch { return L.emptyRun(); }
}

/* Actions run one after another: each reads the state the previous one saved (fast double clicks). */
let queue = Promise.resolve();
function act(fn) {
  const p = queue.then(fn).catch(err => {
    console.error(`${SYSTEM_ID} | tower tracker`, err);
    ui.notifications.error("Tower tracker: action failed, see the console.");
  });
  queue = p;
  return p;
}

async function saveRun(run) {
  if (!game.user.isGM) return;
  await game.settings.set(SYSTEM_ID, TOWER_RUN, run);
}

/** Save `after` with log entries for one action and write the same lines into the run's journal. */
async function commit(before, after, entries, opts) {
  const run = L.withLog(before, after, entries, opts);
  await saveRun(run);
  await journalLines(run, run.log.slice(run.log.length - entries.length));
  return run;
}

/* ============================================================
   Journal
   ============================================================ */

const stamp = (e) => `L${e.level} · ${L.formatDuration(e.ts)}`;

async function createJournal() {
  const date = new Date().toLocaleDateString("en-CA");
  let name = `Tower Log ${date}`;
  if (game.journal.getName(name)) name += ` ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  const j = await JournalEntry.implementation.create({
    name,
    pages: [{ name: "Log", type: "text", text: { content: "", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } }]
  });
  return j?.id ?? "";
}

async function appendJournal(run, html) {
  const page = game.journal.get(run.journalId)?.pages?.contents?.[0];
  if (!page) return;
  await page.update({ "text.content": (page.text?.content ?? "") + html });
}

function journalLines(run, entries) {
  if (!entries.length) return null;
  return appendJournal(run, entries.map(e => `<p><strong>[${esc(stamp(e))}]</strong> ${esc(e.text)}</p>`).join(""));
}

/* ============================================================
   Chat
   ============================================================ */

const ICONS = { level: "fa-stairs", quake: "fa-house-crack", collapse: "fa-person-falling", summary: "fa-door-open", start: "fa-tower-observation" };

/** Tower card for everybody. `banner` text is shown on every client when the card is created. */
function postCard(kind, title, body = "", { banner = "" } = {}) {
  const content = `<div class="apt-tower-card ${kind}"><div class="apt-tower-card-title"><i class="fa-solid ${ICONS[kind] ?? "fa-tower-observation"}" inert></i> ${esc(title)}</div>${body}</div>`;
  return ChatMessage.implementation.create({
    content,
    speaker: { alias: T("Speaker") },
    flags: { [SYSTEM_ID]: { tower: { kind, banner } } }
  });
}

function showTowerBanner(text, kind) {
  const el = document.createElement("div");
  el.className = `apt-turn-banner apt-tower-banner ${kind}`;
  el.innerHTML = `<i class="fa-solid ${ICONS[kind] ?? "fa-house-crack"}" inert></i> ${esc(text)}`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 600); }, 4200);
}

/* ============================================================
   Actions (GM)
   ============================================================ */

function worldTimeText() {
  try { return game.time.calendar.format(game.time.worldTime); } catch { return ""; }
}

export function enterTower(level = 1) {
  return act(async () => {
    const old = getRun();
    const journalId = await createJournal();
    const fresh = L.startRun({ level, startedAt: worldTimeText(), journalId, quakeIntervalMinutes: old.quakeIntervalMinutes });
    await commit(fresh, fresh, [{ type: "start", text: T("Entry.Enter", { level: fresh.level, time: fresh.startedAt || "-" }) }]);
    await postCard("level", T("Card.Level", { level: fresh.level }), `<p>${esc(T("Card.Entered"))}</p>`);
  });
}

export function leaveTower() {
  return act(async () => {
    const run = getRun();
    if (!run.active) return;
    const s = L.summary(run);
    const text = T("Entry.Leave", { level: s.levelsReached, inside: s.inside, outside: s.outsideHours });
    const done = await commit(run, { ...run, active: false }, [{ type: "leave", text }]);
    await appendJournal(done, `<h3>${esc(T("Summary.Title"))}</h3><ul>`
      + `<li>${esc(T("Summary.Reached", { level: s.levelsReached }))}</li>`
      + `<li>${esc(T("Summary.Inside", { inside: s.inside }))}</li>`
      + `<li>${esc(T("Summary.Outside", { outside: s.outsideHours }))}</li></ul>`);
    await postCard("summary", T("Summary.Title"), `<ul>`
      + `<li>${esc(T("Summary.Reached", { level: s.levelsReached }))}</li>`
      + `<li>${esc(T("Summary.Inside", { inside: s.inside }))}</li>`
      + `<li>${esc(T("Summary.Outside", { outside: s.outsideHours }))}</li></ul>`);
  });
}

/** Change level (manual): chat "Level N" for everybody. Not undoable. */
export function changeLevel(level) {
  return act(async () => {
    const run = getRun();
    if (!run.active) return;
    const next = L.setLevel(run, level);
    if (next === run) return;
    await commit(run, next, [{ type: "level", text: T("Entry.Level", { level: next.level }) }]);
    await postCard("level", T("Card.Level", { level: next.level }));
  });
}

/** Roll the element of the current level on a d20 (public roll in chat). */
export function rollElement() {
  return act(async () => {
    const run = getRun();
    if (!run.active) return;
    const roll = await new Roll("1d20").evaluate();
    const key = L.elementForD20(roll.total);
    await roll.toMessage({
      speaker: { alias: T("Speaker") },
      flavor: T("Card.ElementRoll", { level: run.level, element: elLabel(key) })
    }, { rollMode: CONST.DICE_ROLL_MODES.PUBLIC });
    await commit(run, L.setElement(run, key), [{ type: "element", text: T("Entry.ElementRolled", { roll: roll.total, element: elLabel(key) }) }], { undoable: true });
  });
}

/** GM override of the element (dropdown). */
export function overrideElement(key) {
  return act(async () => {
    const run = getRun();
    if (!run.active) return;
    const next = L.setElement(run, key);
    if (next.element === run.element) return;
    await commit(run, next, [{ type: "element", text: T("Entry.ElementSet", { element: elLabel(next.element) || "-" }) }], { undoable: true });
  });
}

async function quakeCards(run, numbers) {
  for (const n of numbers) {
    const third = n >= L.MAX_QUAKES;
    const title = T("Card.Quake", { n, max: L.MAX_QUAKES, level: run.level });
    await postCard("quake", title, third ? `<p>${esc(T("Card.QuakeThird"))}</p>` : "", { banner: third ? title : "" });
  }
  if (numbers.at(-1) >= L.MAX_QUAKES) collapseDialog();
}

/** Book minutes; the quake interval may cause quakes (each with its own card). Undoable. */
export function bookTime(minutes) {
  return act(async () => {
    const run = getRun();
    const m = Math.max(0, Math.trunc(Number(minutes) || 0));
    if (!run.active || !m) return;
    const res = L.bookTime(run, m);
    const entries = [{ type: "time", text: T("Entry.Time", { time: L.formatDuration(m), level: L.formatDuration(res.run.timeOnLevelMinutes) }) }];
    for (const n of res.quakes) entries.push({ type: "quake", text: T("Entry.Quake", { n, max: L.MAX_QUAKES }) });
    await commit(run, res.run, entries, { undoable: true });
    await quakeCards(res.run, res.quakes);
  });
}

/** Manual quake. Undoable. */
export function quake() {
  return act(async () => {
    const run = getRun();
    if (!run.active || L.collapsed(run)) return;
    const next = L.addQuake(run);
    await commit(run, next, [{ type: "quake", text: T("Entry.Quake", { n: next.quakes, max: L.MAX_QUAKES }) }], { undoable: true });
    await quakeCards(next, [next.quakes]);
  });
}

/** Undo the last group (time, quake, element); never across a level change. */
export function undoLast() {
  return act(async () => {
    const run = getRun();
    const { run: back, removed } = L.undoLast(run);
    if (!removed.length) return;
    await saveRun(back);
    await appendJournal(back, removed.map(e => `<p><em>[${esc(stamp(e))}] ${esc(T("Entry.Undone", { text: e.text }))}</em></p>`).join(""));
  });
}

/** Set quake interval or outside offset (not logged). */
export function setOption(key, value) {
  return act(async () => {
    const run = getRun();
    if (key === "interval") run.quakeIntervalMinutes = Math.max(0, Math.trunc(Number(value) || 0));
    else if (key === "offset") run.outsideOffsetHours = Number(value) || 0;
    else return;
    await saveRun(run);
  });
}

/** The "Uncontrolled Landing" table; created with four editable text results if it does not exist. */
export async function ensureLandingTable() {
  const existing = game.tables.getName(LANDING_TABLE);
  if (existing) return existing;
  return RollTable.implementation.create({
    name: LANDING_TABLE,
    formula: `1d${LANDING_RESULTS.length}`,
    replacement: true,
    displayRoll: true,
    results: LANDING_RESULTS.map((name, i) => ({ type: CONST.TABLE_RESULT_TYPES.TEXT, name, description: "", range: [i + 1, i + 1], weight: 1, drawn: false }))
  });
}

/** Collapse: card + banner, draw on the landing table, then level + 1 (quakes 0, time on level 0). */
export function rollLanding() {
  return act(async () => {
    const run = getRun();
    if (!run.active || !L.collapsed(run)) return;
    const collapseText = T("Card.Collapse", { level: run.level });
    await postCard("collapse", collapseText, `<p>${esc(T("Card.CollapseBody"))}</p>`, { banner: collapseText });
    const table = await ensureLandingTable();
    const draw = await table.draw({ rollMode: CONST.DICE_ROLL_MODES.PUBLIC });
    const r = draw?.results?.[0];
    const result = r ? (r.name || foundry.utils.cleanHTML?.(r.description ?? "") || r.description || "-") : "-";
    const next = L.setLevel(run, run.level + 1);
    await commit(run, next, [
      { type: "collapse", level: run.level, text: T("Entry.Collapse", { level: run.level }) },
      { type: "landing", text: T("Entry.Landing", { result: String(result).replace(/<[^>]*>/g, "") }) },
      { type: "level", text: T("Entry.Level", { level: next.level }) }
    ]);
    await postCard("level", T("Card.Level", { level: next.level }));
  });
}

function collapseDialog() {
  if (!game.user.isGM) return;
  const run = getRun();
  DialogV2.wait({
    window: { title: T("Collapse.Title"), icon: "fa-solid fa-person-falling" },
    content: `<p>${esc(T("Collapse.Text", { level: run.level }))}</p>`,
    buttons: [
      { action: "roll", label: T("Collapse.Roll"), icon: "fa-solid fa-dice", default: true, callback: () => { rollLanding(); } },
      { action: "later", label: T("Collapse.Later") }
    ],
    rejectClose: false
  }).catch(() => null);
}

/* ============================================================
   GM window
   ============================================================ */

function elementChoices(selected) {
  return [{ key: "", label: "–", selected: !selected }, ...L.ELEMENT_ORDER.map((k, i) => ({ key: k, label: `${i + 1}. ${ELEMENTS[k].l}`, selected: k === selected }))];
}

export function chip(key) {
  return key ? { label: ELEMENTS[key].l, color: ELEMENTS[key].c } : { label: T("UnknownElement"), color: "", unknown: true };
}

export class TowerTracker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ap-turm-tower-tracker",
    classes: ["ap-turm", "apt-tower"],
    window: { title: "AP_TURM.Tower.Title", icon: "fa-solid fa-tower-observation", resizable: true },
    position: { width: 440, height: "auto" },
    actions: {
      towerEnter: TowerTracker.#onEnter,
      towerLeave: TowerTracker.#onLeave,
      towerLevel: TowerTracker.#onLevelStep,
      towerRollElement: () => rollElement(),
      towerTime: TowerTracker.#onTime,
      towerTimeCustom: TowerTracker.#onTimeCustom,
      towerQuake: () => quake(),
      towerLanding: () => rollLanding(),
      towerUndo: () => undoLast(),
      towerTable: async () => (await ensureLandingTable())?.sheet?.render(true)
    }
  };

  static PARTS = { main: { template: TPL + "tower-tracker.hbs" } };

  async _prepareContext(options) {
    const run = getRun();
    const s = L.summary(run);
    return {
      ...(await super._prepareContext(options)),
      run,
      maxLevel: L.TOWER_LEVELS,
      chip: chip(run.element),
      elements: elementChoices(run.element),
      onLevel: L.formatDuration(run.timeOnLevelMinutes),
      inside: s.inside,
      outside: s.outsideHours,
      offset: run.outsideOffsetHours,
      pips: L.quakePips(run.quakes),
      maxQuakes: L.MAX_QUAKES,
      collapsed: L.collapsed(run),
      canUndo: L.canUndo(run),
      undoText: L.canUndo(run) ? L.lastGroup(run).map(e => e.text).join(" · ") : "",
      log: run.log.slice(-15).reverse().map(e => ({ ...e, stamp: stamp(e) })),
      journal: game.journal.get(run.journalId)?.name ?? ""
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    el.querySelector('[name="level"]')?.addEventListener("change", ev => changeLevel(ev.target.value));
    el.querySelector('[name="element"]')?.addEventListener("change", ev => overrideElement(ev.target.value));
    el.querySelector('[name="interval"]')?.addEventListener("change", ev => setOption("interval", ev.target.value));
    el.querySelector('[name="offset"]')?.addEventListener("change", ev => setOption("offset", ev.target.value));
    el.querySelector('[name="minutes"]')?.addEventListener("keydown", ev => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      bookTime(ev.target.value);
    });
    el.querySelector('[data-action="towerJournal"]')?.addEventListener("click", () => game.journal.get(getRun().journalId)?.sheet?.render(true));
  }

  static #onEnter() {
    const lv = this.element.querySelector('[name="startLevel"]')?.value ?? 1;
    enterTower(lv);
  }

  static async #onLeave() {
    const ok = await DialogV2.confirm({
      window: { title: T("Leave") },
      content: `<p>${esc(T("LeaveConfirm"))}</p>`,
      rejectClose: false
    });
    if (ok) leaveTower();
  }

  static #onLevelStep(event, target) {
    changeLevel(getRun().level + Number(target.dataset.step || 0));
  }

  static #onTime(event, target) {
    bookTime(target.dataset.minutes);
  }

  static #onTimeCustom() {
    bookTime(this.element.querySelector('[name="minutes"]')?.value);
  }
}

let tracker = null;
export function openTowerTracker() {
  if (!game.user.isGM) return null;
  tracker ??= new TowerTracker();
  tracker.render({ force: true });
  return tracker;
}

/** Button "Tower" next to the AP-Turm button in the Actors directory header (GM only). */
export function installTowerButton(root) {
  if (!game.user.isGM) return;
  const row = root?.querySelector(".ap-turm-import-row");
  if (!row || row.querySelector(".apt-tower-btn")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ap-turm-sidebar-btn apt-tower-btn";
  b.dataset.tooltip = T("Title");
  b.innerHTML = `<i class="fa-solid fa-stairs" inert></i><span>${esc(T("Button"))}</span>`;
  b.addEventListener("click", () => openTowerTracker());
  row.append(b);
}

/* ============================================================
   HUD (everybody)
   ============================================================ */

const hudShown = () => { try { return game.settings.get(SYSTEM_ID, TOWER_HUD) !== false; } catch { return true; } };

export async function refreshTowerHud() {
  const run = getRun();
  if (!run.active || !hudShown()) { document.getElementById("ap-turm-tower-hud")?.remove(); return; }
  if (!document.getElementById("scene-controls")) return;
  const s = L.summary(run);
  const html = await foundry.applications.handlebars.renderTemplate(TPL + "tower-hud.hbs", {
    level: run.level, chip: chip(run.element), pips: L.quakePips(run.quakes), inside: s.inside, outside: s.outsideHours
  });
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  const el = tpl.content.firstElementChild;
  document.getElementById("ap-turm-tower-hud")?.remove();   // a parallel refresh may have inserted one meanwhile
  document.body.append(el);
  placeHud();
}

/** Fixed position right below the lowest scene control button (the controls element itself fills the column). */
function placeHud() {
  const el = document.getElementById("ap-turm-tower-hud");
  const controls = document.getElementById("scene-controls");
  if (!el || !controls) return;
  const buttons = [...controls.querySelectorAll("li, button")].map(b => b.getBoundingClientRect()).filter(r => r.height > 0);
  const left = Math.min(...buttons.map(r => r.left), controls.getBoundingClientRect().left);
  const bottom = Math.max(...buttons.map(r => r.bottom), controls.getBoundingClientRect().top);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(bottom + 10)}px`;
}

/* ============================================================
   Registration
   ============================================================ */

export function registerTowerSettings() {
  game.settings.register(SYSTEM_ID, TOWER_RUN, {
    scope: "world", config: false, type: Object, default: L.emptyRun(),
    onChange: () => {
      refreshTowerHud().catch(err => console.error(`${SYSTEM_ID} | tower HUD`, err));
      if (tracker?.rendered) tracker.render();
    }
  });
  game.settings.register(SYSTEM_ID, TOWER_HUD, {
    name: "AP_TURM.Tower.HudSetting", hint: "AP_TURM.Tower.HudSettingHint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => refreshTowerHud().catch(err => console.error(`${SYSTEM_ID} | tower HUD`, err))
  });
}

export function registerTowerHooks() {
  const refresh = () => refreshTowerHud().catch(err => console.error(`${SYSTEM_ID} | tower HUD`, err));
  Hooks.once("ready", refresh);
  Hooks.on("renderSceneControls", refresh);
  window.addEventListener("resize", () => placeHud());
  Hooks.on("createChatMessage", (msg) => {
    const t = msg.flags?.[SYSTEM_ID]?.tower;
    if (t?.banner) showTowerBanner(t.banner, t.kind);
  });
}

export const towerTracker = {
  open: openTowerTracker, getRun, enterTower, leaveTower, changeLevel, rollElement, overrideElement, bookTime, quake,
  undoLast, rollLanding, ensureLandingTable, refreshHud: refreshTowerHud, logic: L
};

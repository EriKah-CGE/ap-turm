/**
 * Shop editor (GM): the world's own point-buy entries. They live in the world setting "customShop" and are laid
 * over the built-in shop by custom-shop.mjs; a change is installed on every client (setting onChange) and every
 * open character sheet re-renders. Built-in entries are shown for reference only and cannot be edited.
 * Entry points: "Shop editor" on the shop tab (GM) and the AP-Turm sidebar menu.
 */
import {
  CUSTOM_PREFIX, CHOICE_TYPES, EFFECT_TYPES, BONUS_TARGETS, BUILTIN_CATEGORIES, validateEntry, installCustomShop,
  exportCustomShop, importCustomShop, buyersOf, parseFormula, customEntries, effectLabel
} from "./custom-shop.mjs";
import { SHOP_DATA, ABILITIES, SKILLS, ARMOR_WEAPON_PROFS, findShopItem } from "./config.mjs";
import { scheduleRulesRebuild } from "./rules-journal.mjs";

const SYSTEM_ID = "ap-turm";
export const CUSTOM_SHOP_SETTING = "customShop";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const { HandlebarsApplicationMixin, ApplicationV2, DialogV2 } = foundry.applications.api;

/* ============================================================
   Setting, install, re-render
   ============================================================ */

/** The editor's buyer lines follow purchases (a buy / sell changes an actor, not the setting). */
const rerenderEditor = foundry.utils.debounce(() => { if (editor?.rendered) editor.render(); }, 250);

export function registerCustomShopSetting() {
  Hooks.on("updateActor", (actor, changes) => { if (actor.type === "character" && foundry.utils.hasProperty(changes, "system.bought")) rerenderEditor(); });
  game.settings.register(SYSTEM_ID, CUSTOM_SHOP_SETTING, {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => { installFromSetting({ notify: game.user.isGM }); refreshSheets(); scheduleRulesRebuild(); }
  });
}

const stored = () => { try { return foundry.utils.deepClone(game.settings.get(SYSTEM_ID, CUSTOM_SHOP_SETTING) ?? []); } catch { return []; } };

/** Install the stored custom entries; a defective one is skipped and reported (console, GM notification). */
export function installFromSetting({ notify = false } = {}) {
  try {
    const o = installCustomShop(stored());
    for (const s of o.skipped) console.warn(`${SYSTEM_ID} | custom shop entry "${s.name || s.id}" skipped: ${s.errors.join("; ")}`);
    if (notify && o.skipped.length) ui.notifications?.warn(`AP-Turm: ${o.skipped.length} custom shop entr${o.skipped.length === 1 ? "y was" : "ies were"} skipped (see the console).`);
    return o;
  } catch (err) {
    console.error(`${SYSTEM_ID} | custom shop could not be installed`, err);
    return null;
  }
}

/** Recompute characters and re-render their open sheets and the editor. */
export function refreshSheets() {
  for (const a of game.actors ?? []) if (a.type === "character") a.reset();
  for (const app of foundry.applications.instances.values()) {
    if (!app.rendered) continue;
    if (app.document?.type === "character" || app instanceof ShopEditor) app.render();
  }
}

const save = (list) => game.settings.set(SYSTEM_ID, CUSTOM_SHOP_SETTING, list);

/* ============================================================
   Editor window
   ============================================================ */

let editor = null;

export class ShopEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ap-turm-shop-editor",
    classes: ["ap-turm", "apt-shop-editor"],
    window: { title: "AP-Turm Shop Editor", icon: "fa-solid fa-screwdriver-wrench", resizable: true },
    position: { width: 620, height: 560 },
    actions: {
      add: ShopEditor.#onAdd, edit: ShopEditor.#onEdit, remove: ShopEditor.#onRemove,
      exportList: ShopEditor.#onExport, importList: ShopEditor.#onImport
    }
  };
  static PARTS = { main: { template: "systems/ap-turm/templates/apps/shop-editor.hbs", scrollable: [".apt-se-list"] } };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const valid = new Set(customEntries().map(e => e.id));
    const list = stored().map(e => {
      const buyers = buyersOf(e.id, game.actors.filter(a => a.type === "character").map(a => ({ name: a.name, bought: a.system.bought })));
      return {
        id: e.id, name: e.name || "(no name)", category: e.category || "Custom", ok: valid.has(e.id),
        costs: Array.isArray(e.costs) ? e.costs.join(", ") : String(e.costs ?? ""), mult: e.mult ?? 2, maxRanks: e.maxRanks ?? "",
        effects: (e.effects || []).map(effectLabel).join(" · ") || "no effect", buyers: buyers.join(", ")
      };
    });
    return Object.assign(ctx, { list });
  }

  _onClose(options) { editor = null; return super._onClose(options); }

  static async #onAdd() {
    const entry = await entryDialog(null);
    if (!entry) return;
    await save([...stored(), entry]);
    ui.notifications.info(`Shop entry "${entry.name}" created.`);
  }

  static async #onEdit(ev, target) {
    const id = target.closest("[data-id]")?.dataset.id;
    const cur = stored().find(e => e.id === id);
    if (!cur) return;
    const entry = await entryDialog(cur);
    if (!entry) return;
    await save(stored().map(e => (e.id === id ? entry : e)));
  }

  static async #onRemove(ev, target) {
    const id = target.closest("[data-id]")?.dataset.id;
    const cur = stored().find(e => e.id === id);
    if (!cur) return;
    const buyers = buyersOf(id, game.actors.filter(a => a.type === "character").map(a => ({ name: a.name, bought: a.system.bought })));
    const warn = buyers.length
      ? `<p class="apt-se-warn"><i class="fa-solid fa-triangle-exclamation"></i> Bought by: <b>${esc(buyers.join(", "))}</b>. Their purchase stays in their data but does nothing any more, and its AP count as free again.</p>` : "";
    const ok = await DialogV2.confirm({ window: { title: "Delete shop entry" }, content: `<p>Delete <b>${esc(cur.name)}</b>?</p>${warn}`, rejectClose: false });
    if (ok) await save(stored().filter(e => e.id !== id));
  }

  static #onExport() {
    const data = exportCustomShop(stored());
    foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", `ap-turm-custom-shop-${game.world.id}.json`);
  }

  static async #onImport() {
    const text = await pickJsonFile();
    if (text === null) return;
    let data;
    try { data = JSON.parse(text); } catch { ui.notifications.error("This file is not valid JSON."); return; }
    const res = importCustomShop(data, stored());
    if (res.error) { ui.notifications.error(res.error); return; }
    await save(res.entries);
    const skipped = res.skipped.length ? ` ${res.skipped.length} broken entr${res.skipped.length === 1 ? "y" : "ies"} skipped (see the console).` : "";
    for (const s of res.skipped) console.warn(`${SYSTEM_ID} | import: "${s.name || s.id}" skipped: ${s.errors.join("; ")}`);
    ui.notifications.info(`Custom shop imported: ${res.added} new, ${res.replaced} replaced.${skipped}`);
  }
}

/** Open (or bring to front) the editor. GM only. */
export function openShopEditor() {
  if (!game.user.isGM) { ui.notifications.warn("The shop editor is for the GM."); return null; }
  editor ??= new ShopEditor();
  if (editor.rendered) editor.bringToFront?.();
  else editor.render({ force: true }).catch(err => console.error(`${SYSTEM_ID} | shop editor`, err));
  return editor;
}

/** Let the user pick a JSON file; resolves with its text or null. */
function pickJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      resolve(f ? await f.text() : null);
    }, { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/* ============================================================
   Labels
   ============================================================ */

export { effectLabel };

/* ============================================================
   Entry dialog
   ============================================================ */

const opt = (map, sel) => Object.entries(map).map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
const ABILITY_OPTS = (sel) => `<option value="chosen" ${sel === "chosen" ? "selected" : ""}>chosen at purchase</option>${opt(ABILITIES, sel)}`;
const SKILL_OPTS = (sel) => `<option value="chosen" ${sel === "chosen" ? "selected" : ""}>chosen at purchase</option>${opt(Object.fromEntries(Object.entries(SKILLS).map(([k, s]) => [k, s.l])), sel)}`;
const GEAR_OPTS = (sel) => opt(Object.fromEntries(ARMOR_WEAPON_PROFS.map(p => [p.id, p.name])), sel);

/** Form row for one effect. All fields are there; CSS shows the ones of the chosen type / target. */
function effectRow(e = { type: "bonus", target: "ability", key: "chosen", value: 1 }) {
  const t = e.type || "bonus";
  const target = e.target || (t === "prof" ? "skill" : t === "advantage" ? "skill" : "ability");
  return `<div class="apt-se-effect" data-type="${esc(t)}" data-target="${esc(target)}">
    <select class="f-type">${opt(EFFECT_TYPES, t)}</select>
    <select class="f-target t-bonus">${opt(BONUS_TARGETS, t === "bonus" ? target : "ability")}</select>
    <select class="f-target t-advantage">${opt({ skill: "Skill (chosen)", save: "Save (chosen)" }, t === "advantage" ? target : "skill")}</select>
    <select class="f-target t-prof">${opt({ skill: "Skill (chosen)", save: "Save (chosen)", gear: "Armor / weapon group" }, t === "prof" ? target : "skill")}</select>
    <select class="f-key k-ability">${ABILITY_OPTS(["ability", "save"].includes(target) ? e.key : "chosen")}</select>
    <select class="f-key k-skill">${SKILL_OPTS(target === "skill" ? e.key : "chosen")}</select>
    <select class="f-key k-gear">${GEAR_OPTS(target === "gear" ? e.key : "lgt")}</select>
    <input class="f-value" type="number" step="1" value="${esc(e.value ?? 1)}" title="per rank">
    <select class="f-rank">${[6, 7, 8, 9].map(r => `<option value="${r}" ${Number(e.rank) === r ? "selected" : ""}>rank ${r}</option>`).join("")}</select>
    <input class="f-name" type="text" value="${esc(e.name ?? "")}" placeholder="pool name">
    <input class="f-max" type="text" value="${esc(e.max ?? "")}" placeholder="max: 3 or earned/5" title="number or formula with earned, level, + - * / ( ), floor()">
    <select class="f-reset">${opt({ long: "long rest", short: "short rest" }, e.reset || "long")}</select>
    <input class="f-text" type="text" value="${esc(e.text ?? "")}" placeholder="feature text">
    <a class="f-del" title="Remove this effect"><i class="fa-solid fa-xmark"></i></a>
  </div>`;
}

/** Read one effect row back into an effect object. */
function readEffect(row) {
  const q = (s) => row.querySelector(s);
  const type = q(".f-type").value;
  const target = type === "bonus" ? q(".t-bonus").value : type === "advantage" ? q(".t-advantage").value : type === "prof" ? q(".t-prof").value : "";
  const key = target === "skill" ? q(".k-skill").value : target === "gear" ? q(".k-gear").value : ["ability", "save"].includes(target) ? q(".k-ability").value : "";
  const e = { type };
  if (["bonus", "advantage", "prof"].includes(type)) Object.assign(e, { target, key });
  if (["bonus", "sp", "casts", "dice"].includes(type)) e.value = Number(q(".f-value").value);
  if (type === "casts") e.rank = Number(q(".f-rank").value);
  if (type === "pool") Object.assign(e, { name: q(".f-name").value.trim(), max: q(".f-max").value.trim(), reset: q(".f-reset").value });
  if (type === "text") e.text = q(".f-text").value.trim();
  return e;
}

/**
 * Create / edit an entry. Validates before closing (empty name, cost ladder, formulas, choice / effect fit) and
 * keeps the dialog open with the reasons while something is wrong.
 * @returns {Promise<object|null>} the validated entry
 */
async function entryDialog(cur) {
  const id = cur?.id ?? `${CUSTOM_PREFIX}${foundry.utils.randomID(10)}`;
  const e = cur ?? { name: "", category: "Custom", desc: "", costs: [10], mult: 2, maxRanks: null, prereqs: [], choice: "none", effects: [] };
  const cats = [...new Set([...BUILTIN_CATEGORIES, ...Object.keys(SHOP_DATA)])];
  const allItems = Object.entries(SHOP_DATA).flatMap(([cat, list]) => list.map(it => ({ id: it.id, name: it.name, cat }))).filter(x => x.id !== id);
  const prereqSel = new Set(e.prereqs ?? []);
  const content = `<div class="apt-se-dialog">
    <div class="form-group"><label>Name</label><div class="form-fields"><input type="text" name="name" value="${esc(e.name)}" placeholder="e.g. Eisenherz"></div></div>
    <div class="form-group"><label>Category</label><div class="form-fields">
      <select name="catSel">${cats.map(c => `<option value="${esc(c)}" ${c === e.category ? "selected" : ""}>${esc(c)}</option>`).join("")}<option value="__new__" ${cats.includes(e.category) ? "" : "selected"}>New category…</option></select>
      <input type="text" name="catNew" value="${cats.includes(e.category) ? "" : esc(e.category)}" placeholder="new category name"></div></div>
    <div class="form-group stacked"><label>Description</label><textarea name="desc" rows="2">${esc(e.desc)}</textarea></div>
    <div class="form-group"><label>Cost ladder</label><div class="form-fields"><input type="text" name="costs" value="${esc((e.costs || []).join(", "))}" placeholder="10, 20, 30"></div></div>
    <div class="form-group"><label>Further ranks ×</label><div class="form-fields"><input type="number" name="mult" value="${esc(e.mult ?? 2)}" min="0.1" step="0.1"><label class="sub">Max ranks <input type="number" name="maxRanks" value="${esc(e.maxRanks ?? "")}" min="1" step="1" placeholder="—"></label></div></div>
    <p class="hint">Rank k costs the k-th number; after the list the last cost × the multiplier. Max ranks empty: a single cost with multiplier ≠ 1 means one rank (like the built-in entries), otherwise unlimited.</p>
    <div class="form-group"><label>Choice at purchase</label><div class="form-fields"><select name="choice">${opt(CHOICE_TYPES, e.choice || "none")}</select></div></div>
    <div class="form-group stacked"><label>Prerequisites <small>(all of them must be bought)</small></label>
      <select name="prereqs" multiple size="6">${allItems.map(it => `<option value="${esc(it.id)}" ${prereqSel.has(it.id) ? "selected" : ""}>${esc(it.cat)} · ${esc(it.name)}</option>`).join("")}</select></div>
    <div class="form-group stacked"><label>Effects <small>(values per rank)</small></label>
      <div class="apt-se-effects">${(e.effects || []).map(effectRow).join("")}</div>
      <button type="button" class="apt-add apt-se-addeff"><i class="fa-solid fa-plus"></i> Add effect</button></div>
    <p class="apt-se-errors" hidden></p>
  </div>`;
  let result = null;
  await DialogV2.wait({
    window: { title: cur ? `Edit: ${cur.name}` : "New shop entry", icon: "fa-solid fa-store" },
    position: { width: 640 },
    content,
    buttons: [
      // the entry is checked on click (render below); the callback only hands the valid result back
      { action: "save", label: cur ? "Save" : "Create", icon: "fa-solid fa-check", default: true, callback: () => "save" },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false,
    render: (event, dlg) => {
      const root = dlg.element;
      const form = root.querySelector("form") ?? root;
      const collect = () => {
          const f = form;
          const raw = {
            id, name: f.elements.name.value.trim(),
            category: f.elements.catSel.value === "__new__" ? (f.elements.catNew.value.trim() || "Custom") : f.elements.catSel.value,
            desc: f.elements.desc.value.trim(), costs: f.elements.costs.value, mult: f.elements.mult.value,
            maxRanks: f.elements.maxRanks.value, choice: f.elements.choice.value,
            prereqs: [...f.elements.prereqs.selectedOptions].map(o => o.value),
            effects: [...f.querySelectorAll(".apt-se-effect")].map(readEffect)
          };
          return validateEntry(raw);
      };
      // invalid: show why and keep the dialog open (the click never reaches the dialog's submit)
      root.querySelector('button[data-action="save"]')?.addEventListener("click", (ev) => {
        const v = collect();
        const box = root.querySelector(".apt-se-errors");
        if (v.ok) { result = v.entry; box.hidden = true; return; }
        ev.preventDefault(); ev.stopImmediatePropagation();
        box.hidden = false;
        box.innerHTML = v.errors.map(esc).join("<br>");
      }, { capture: true });
      // Enter in a field does not submit (it would skip the check)
      root.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.tagName === "INPUT") ev.preventDefault(); });
      const list = root.querySelector(".apt-se-effects");
      const sync = (row) => {
        const type = row.querySelector(".f-type").value;
        row.dataset.type = type;
        row.dataset.target = type === "bonus" ? row.querySelector(".t-bonus").value : type === "advantage" ? row.querySelector(".t-advantage").value : type === "prof" ? row.querySelector(".t-prof").value : "";
      };
      const wire = (row) => {
        sync(row);
        row.addEventListener("change", () => sync(row));
        row.querySelector(".f-del").addEventListener("click", () => row.remove());
      };
      list.querySelectorAll(".apt-se-effect").forEach(wire);
      root.querySelector(".apt-se-addeff").addEventListener("click", () => {
        list.insertAdjacentHTML("beforeend", effectRow());
        wire(list.lastElementChild);
      });
      const catSel = root.querySelector("select[name=catSel]"), catNew = root.querySelector("input[name=catNew]");
      const syncCat = () => { catNew.hidden = catSel.value !== "__new__"; };
      catSel.addEventListener("change", syncCat); syncCat();
      // live check of a pool formula
      root.addEventListener("input", (ev) => {
        if (!ev.target.classList?.contains("f-max")) return;
        const p = parseFormula(ev.target.value);
        ev.target.classList.toggle("bad", !!ev.target.value.trim() && !p.ok);
        ev.target.title = p.ok ? "ok" : p.error;
      });
    }
  });
  return result;
}

/** Shop entry name for an id (built-in or custom), for messages. */
export const shopName = (id) => findShopItem(id)?.name ?? id;

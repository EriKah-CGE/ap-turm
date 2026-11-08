/**
 * Importer: AP app JSON export  ->  Foundry Actor (character) with embedded Items.
 *
 * `normalizeAppExport` and `convertAppExport` are pure (no Foundry globals) and tested in Node
 * against the app's own load()/migrate*() functions. `importAppJSON` is the Foundry UI entry.
 */
import { ARMORS, WEAPONS } from "./config.mjs";
import { DATA_VERSION, convertSpellPurchases, spellRuleNotice, needsSpellRule, expandEffects, derived } from "./rules.mjs";
import { isNpcExport, validateNpcExport, createNpcFromExport, importNpcIntoActor, NPC_FORMAT } from "./npc-transfer.mjs";

/* ---------- App defaults + migrations (ported 1:1 from ap-character-sheet.html) ---------- */

export const APP_DEFAULTS = () => ({ v: DATA_VERSION, notices: [], theme: "celestial", mode: "ap", name: "", startAp: 50, earnedAp: 0, spUsed: 0, layUsed: 0, crystals: [], turmwissen: [],
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  bought: {}, choices: {}, selectedSkills: [], selectedProfs: [], customProfs: [], hpRolls: [], milestones: {},
  identity: { species: "", klasse: "Weapon Bearer", background: "", alignment: "", exp: "" },
  play: { hpCurrent: null, tempHp: 0, spentHitDice: 0, deathSucc: 0, deathFail: 0, inspiration: 0, inspMax: 5, exhaustion: 0 },
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, equipment: "", notes: "",
  weapons: [], spells: [], slotsUsed: {}, feats: [], items: [], armor: { id: "none", shield: false } });

let _seq = 0;
const uid = (p) => p + Date.now().toString(36) + (_seq++).toString(36);
const newWeapon = (name) => ({ id: uid("w"), name: name || "New Weapon", abil: "str", dice: "1d8", dtype: "slashing", bonus: 0, prof: true, equipped: false, notes: "" });
const newFeat = (name) => ({ id: uid("f"), name: name || "New Feat", desc: "", src: "", bon: {} });
const newItem = (name) => ({ id: uid("i"), name: name || "New Item", qty: 1, notes: "", attuned: false, charges: 0, used: 0, recharge: "long", origin: "city" });

function migrateCrystals(S) { S.crystals = (S.crystals || []).map(c => typeof c === "string" ? { name: c, elem: "" } : (c || { name: "", elem: "" })); S.crystals.forEach(c => { if (c.elem === "macht") c.elem = "arch"; }); (S.spells || []).forEach(s => { if (s && s.elem === "macht") s.elem = "arch"; }); }
function migrateItems(S) { if (S._itemMigrated) return; const txt = (S.equipment || "").trim(); if (txt) { txt.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean).forEach(n => { const m = n.match(/^(.*?)\s*[x×]\s*(\d+)$/i); S.items.push(Object.assign(newItem(m ? m[1].trim() : n), { qty: m ? parseInt(m[2]) : 1 })); }); } S._itemMigrated = true; }
function migrateInsp(S) { if (typeof S.play.inspiration === "boolean") S.play.inspiration = S.play.inspiration ? 1 : 0; S.play.inspiration = Math.max(0, parseInt(S.play.inspiration) || 0); if (!S.play.inspMax) S.play.inspMax = 5; if (S.play.inspiration > S.play.inspMax) S.play.inspMax = S.play.inspiration; }
function migrateFeats(S) { if (S._featMigrated) return; for (const i in (S.milestones || {})) { const m = S.milestones[i]; if (m && m.type === "feat" && m.name && !S.feats.some(f => f.name === m.name)) S.feats.push(Object.assign(newFeat(m.name), { src: "Milestone #" + i })); } S._featMigrated = true; }
function migrateWeapons(S) { if (S._wepMigrated) return; const picks = (S.choices && S.choices.wepMastery) || []; picks.forEach(w => { const nm = WEAPONS[w] || w; if (!S.weapons.some(x => x.name === nm)) S.weapons.push(newWeapon(nm)); }); if (S.weapons.length) S.weapons[0].equipped = true; S._wepMigrated = true; }

/* ---------- validation (nothing is created before a file passed this) ---------- */

const ABIL_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
/** Fields only an AP app export has; at least one must be present. */
export const APP_SIGNATURE = ["abilities", "bought", "startAp", "earnedAp", "selectedSkills", "hpRolls", "armor", "milestones"];
/** Fields that must be arrays if present; a wrong type is reported instead of silently dropped. */
const ARRAY_FIELDS = ["weapons", "spells", "feats", "items", "crystals", "turmwissen", "selectedSkills", "selectedProfs", "customProfs", "hpRolls"];

/**
 * Decide whether a parsed JSON file is an AP character export, and say why not when it is not.
 * Pure (no Foundry globals); every UI path calls this before a document is touched.
 * @param {*} data  Parsed JSON
 * @returns {{ok:boolean, reason?:string, warnings:string[]}}
 */
export function validateAppExport(data) {
  const warn = [];
  if (data === null || data === undefined) return { ok: false, reason: "The file contains no data.", warnings: warn };
  if (Array.isArray(data)) return { ok: false, reason: "The file contains a JSON list, a single character sheet is expected.", warnings: warn };
  if (typeof data !== "object") return { ok: false, reason: `The file contains ${typeof data === "string" ? "plain text" : "no character sheet"} (JSON ${typeof data}).`, warnings: warn };
  if (data.format === NPC_FORMAT) return { ok: false, reason: "This is an AP-Turm NPC export, not a character sheet. Create an NPC and import it there.", warnings: warn };
  if (data._id && data.type && data.system) return { ok: false, reason: `This is a Foundry document export (type "${data.type}"), not a sheet of the AP app. Foundry actors are taken over by drag & drop or via "Import Data" in the actor context menu.`, warnings: warn };
  const found = APP_SIGNATURE.filter(k => data[k] !== undefined);
  if (!found.length) {
    const keys = Object.keys(data).slice(0, 6);
    return { ok: false, reason: `Not an AP character sheet: none of the expected fields (${APP_SIGNATURE.slice(0, 4).join(", ")}, …) is present${keys.length ? `, found ${keys.join(", ")}` : ", the file is an empty object"}.`, warnings: warn };
  }
  const ab = data.abilities;
  if (ab === undefined) return { ok: false, reason: 'The sheet is incomplete: the field "abilities" is missing (truncated file?).', warnings: warn };
  if (!ab || typeof ab !== "object" || Array.isArray(ab)) return { ok: false, reason: 'The field "abilities" is not an object.', warnings: warn };
  const missing = ABIL_KEYS.filter(k => !Number.isFinite(Number(ab[k])));
  if (missing.length === ABIL_KEYS.length) return { ok: false, reason: 'The field "abilities" contains no ability scores (expected str, dex, con, int, wis, cha).', warnings: warn };
  if (missing.length) warn.push(`Abilities without a value, set to 10: ${missing.join(", ")}.`);
  for (const k of ARRAY_FIELDS) if (data[k] !== undefined && !Array.isArray(data[k])) warn.push(`Field "${k}" is not a list and is ignored.`);
  for (const k of ["bought", "choices", "milestones", "identity", "play", "currency", "slotsUsed"]) {
    if (data[k] !== undefined && (typeof data[k] !== "object" || data[k] === null || Array.isArray(data[k]))) warn.push(`Field "${k}" has the wrong type and is replaced by the default.`);
  }
  if (data.v !== undefined && Number(data.v) > DATA_VERSION) warn.push(`The sheet comes from a newer app version (v${data.v}); unknown fields are lost.`);
  return { ok: true, warnings: warn };
}

/**
 * Parse the text of a picked file into an app export, with a readable cause on failure.
 * @param {string} text
 * @returns {{ok:boolean, data?:object, reason?:string, warnings:string[]}}
 */
export function parseAppExportText(text) {
  const clean = String(text ?? "").replace(/^﻿/, "").trim();
  if (!clean) return { ok: false, reason: "The file is empty.", warnings: [] };
  let data;
  try { data = JSON.parse(clean); }
  catch (err) {
    const pos = /position (\d+)/.exec(err.message)?.[1];
    const where = pos ? ` (character ${pos} of ${clean.length}${Number(pos) >= clean.length - 2 ? ", the file breaks off in the middle of the JSON" : ""})` : "";
    return { ok: false, reason: `The file is not valid JSON${where}: ${err.message}`, warnings: [] };
  }
  const check = validateAppExport(data);
  return check.ok ? { ok: true, data, warnings: check.warnings } : { ok: false, reason: check.reason, warnings: check.warnings };
}

/**
 * Same normalization the app applies when a file is imported (fileInput.onchange in the HTML).
 * @param {object} data  Parsed JSON export
 * @returns {object}     App state S
 */
export function normalizeAppExport(data) {
  const D = APP_DEFAULTS();
  const S = Object.assign(D, foundry_deepClone(data));
  // fields of the wrong type are replaced by the default instead of merging garbage (validateAppExport warns about them)
  const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
  for (const k of ["identity", "play", "currency", "bought", "choices", "milestones", "slotsUsed", "armor"]) if (!plain(S[k])) S[k] = APP_DEFAULTS()[k];
  S.identity = Object.assign(APP_DEFAULTS().identity, S.identity || {});
  S.play = Object.assign(APP_DEFAULTS().play, S.play || {});
  S.currency = Object.assign(APP_DEFAULTS().currency, S.currency || {});
  if (!Array.isArray(S.weapons)) S.weapons = [];
  if (!Array.isArray(S.spells)) S.spells = [];
  if (!S.slotsUsed) S.slotsUsed = {};
  if (!Array.isArray(S.feats)) S.feats = [];
  if (!Array.isArray(S.items)) S.items = [];
  if (!Array.isArray(S.crystals)) S.crystals = [];
  if (!Array.isArray(S.turmwissen)) S.turmwissen = [];
  if (!S.mode) S.mode = "ap";
  if (!S.armor || !ARMORS[S.armor.id]) S.armor = { id: "none", shield: false };
  migrateWeapons(S); migrateFeats(S); migrateInsp(S); migrateItems(S); migrateCrystals(S);
  if (!Array.isArray(S.notices)) S.notices = [];
  // app migrateSpellRule(): sheets below v5 (or with old-rule purchases, hasPreV5Spells) convert the first "learn" purchase of each rank into a spellslot purchase
  S._spellNotice = "";
  if (needsSpellRule(data?.v, S.bought)) {
    const r = convertSpellPurchases(S.bought);
    if (r.converted.length) {
      S.bought = r.bought;
      S._spellNotice = spellRuleNotice(r.delta);
      S.notices.push({ date: new Date().toISOString().slice(0, 10), text: S._spellNotice });
    }
  }
  S.v = DATA_VERSION;
  // app migrateSpellPoints(): used spell points stay within the pool of the spell point table
  const spTotal = derived(S).spTotal;
  if ((parseInt(S.spUsed) || 0) > spTotal) S.spUsed = spTotal;
  S._spCostTable = true;
  return S;
}

// structuredClone is available in Node >= 17 and all browsers Foundry v13 supports
function foundry_deepClone(o) { return structuredClone(o); }

/* ---------- App state -> Foundry document data ---------- */

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const i = (v, d = 0) => Math.trunc(n(v, d));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const textToHtml = (t) => { const s = String(t ?? "").trim(); return s ? s.split(/\r?\n/).map(l => `<p>${esc(l)}</p>`).join("") : ""; };
const cleanObj = (o) => { const r = {}; for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null) r[k] = v; return r; };

const CURRENCY_KEYS = ["cp", "sp", "ep", "gp", "pp", "ku", "br", "si", "go", "ed"];
const ABIL = ["str", "dex", "con", "int", "wis", "cha"];
const FEAT_BON = [...ABIL, "ac", "speed", "hp", "init"];

/**
 * Convert an app export (raw JSON) into Actor creation data with embedded items.
 * @param {object} data   Raw parsed JSON from the app
 * @returns {{name:string, type:"character", system:object, items:object[]}}
 */
export function convertAppExport(data) {
  const S = normalizeAppExport(data);
  const system = {
    mode: S.mode === "turm" ? "turm" : "ap",
    theme: String(S.theme || "celestial"),
    ap: { start: Math.max(0, i(S.startAp, 50)), earned: Math.max(0, i(S.earnedAp)) },
    abilities: Object.fromEntries(ABIL.map(k => [k, Math.max(6, Math.min(18, i(S.abilities?.[k], 10)))])),
    bought: Object.fromEntries(Object.entries(S.bought || {}).filter(([, v]) => i(v) > 0).map(([k, v]) => [k, i(v)])),
    choices: Object.fromEntries(Object.entries(S.choices || {}).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, [...v]])),
    milestones: Object.fromEntries(Object.entries(S.milestones || {}).filter(([, m]) => m && typeof m === "object").map(([k, m]) => [k, structuredClone(m)])),
    skills: [...(S.selectedSkills || [])],
    profs: [...(S.selectedProfs || [])],
    customProfs: [...(S.customProfs || [])].map(String).filter(Boolean),
    hp: {
      rolls: (S.hpRolls || []).map(r => Math.max(0, i(r))),
      value: S.play.hpCurrent == null ? null : i(S.play.hpCurrent),
      temp: Math.max(0, i(S.play.tempHp))
    },
    play: {
      spentHitDice: Math.max(0, i(S.play.spentHitDice)),
      deathSucc: Math.max(0, Math.min(3, i(S.play.deathSucc))),
      deathFail: Math.max(0, Math.min(3, i(S.play.deathFail))),
      inspiration: Math.max(0, i(S.play.inspiration)),
      inspMax: Math.max(1, i(S.play.inspMax, 5)),
      exhaustion: Math.max(0, Math.min(6, i(S.play.exhaustion)))
    },
    resources: {
      spUsed: Math.max(0, i(S.spUsed)),
      layUsed: Math.max(0, i(S.layUsed)),
      slotsUsed: Object.fromEntries(Object.entries(S.slotsUsed || {}).map(([k, v]) => [k, Math.max(0, i(v))]))
    },
    armor: { id: ARMORS[S.armor?.id] ? S.armor.id : "none", shield: !!S.armor?.shield },
    currency: Object.fromEntries(CURRENCY_KEYS.map(k => [k, i(S.currency?.[k])])),
    crystals: (S.crystals || []).map(c => ({ name: String(c?.name ?? ""), elem: String(c?.elem ?? "") })),
    turmwissen: (S.turmwissen || []).map(t => ({ trigger: String(t?.trigger ?? "") })),
    identity: {
      species: String(S.identity.species ?? ""),
      klasse: String(S.identity.klasse ?? "Weapon Bearer"),
      background: String(S.identity.background ?? ""),
      alignment: String(S.identity.alignment ?? ""),
      exp: String(S.identity.exp ?? "")
    },
    notes: textToHtml(S.notes),
    notices: (S.notices || []).filter(x => x && typeof x === "object").map(x => ({ date: String(x.date ?? ""), text: String(x.text ?? "") }))
  };

  const flag = (src) => ({ "ap-turm": cleanObj({ appId: src.id }) });
  const items = [];
  for (const w of S.weapons) items.push({
    name: String(w.name || "Weapon"), type: "weapon", flags: flag(w),
    system: {
      abil: ["str", "dex", "fin", "con", "int", "wis", "cha"].includes(w.abil) ? w.abil : "str",
      dice: String(w.dice ?? "1d8"), dtype: w.dtype === "macht" ? "arch" : String(w.dtype ?? "slashing"),
      dice2: String(w.dice2 ?? ""), type2: w.type2 === "macht" ? "arch" : String(w.type2 ?? ""),
      bonus: i(w.bonus), prof: w.prof !== false, equipped: !!w.equipped, notes: String(w.notes ?? ""),
      reach: Number(w.reach) > 0 ? i(w.reach) : 5
    }
  });
  for (const s of S.spells) items.push({
    name: String(s.name || "Spell"), type: "spell", flags: flag(s),
    system: { lvl: Math.max(0, Math.min(9, i(s.lvl))), elem: s.elem === "macht" ? "arch" : String(s.elem ?? ""), notes: String(s.notes ?? ""), prepared: s.prepared !== false }
  });
  for (const f of S.feats) items.push({
    name: String(f.name || "Feat"), type: "feat", flags: flag(f),
    system: { desc: String(f.desc ?? ""), src: String(f.src ?? ""), bon: Object.fromEntries(FEAT_BON.map(k => [k, i(f.bon?.[k])])) }
  });
  for (const g of S.items) items.push({
    name: String(g.name || "Item"), type: "gear", flags: flag(g),
    system: {
      qty: Math.max(1, i(g.qty, 1)), notes: String(g.notes ?? ""), attuned: !!g.attuned,
      charges: Math.max(0, Math.min(20, i(g.charges))), used: Math.max(0, i(g.used)),
      recharge: ["long", "short", "dawn", "none"].includes(g.recharge) ? g.recharge : "long",
      origin: g.origin === "tower" ? "tower" : "city",
      equipped: !!g.equipped, attunement: !!g.attunement, effects: expandEffects(g.effects)
    }
  });

  // notice: the spell rule conversion that just happened (not stored on the actor; the import posts it to the GM)
  return { name: String(S.name || "").trim() || "Imported Character", type: "character", system, items,
    flags: { "ap-turm": { dataVersion: DATA_VERSION } }, notice: S._spellNotice };
}

/* ---------- Foundry UI ---------- */

/** Chat message to the GMs only: "<actor>: <notice>" (spell rule conversion). */
export function whisperGmNotice(name, text) {
  const e = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  return ChatMessage.implementation.create({
    speaker: { alias: "AP-Turm" },
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    content: `<div class="apt-gm-notice"><b>${e(name)}</b>: ${e(text)}</div>`
  });
}

/** Error dialog: what went wrong and why, instead of a notification that scrolls away. */
async function reportImportError(reason, { title = "Import failed", file = "" } = {}) {
  const e = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  ui.notifications.error(`${title}: ${reason}`, { console: false });
  return foundry.applications.api.DialogV2.prompt({
    window: { title, icon: "fa-solid fa-triangle-exclamation" },
    content: `<div class="apt-import-error"><p><b>${e(file || "The selected file")}</b> was not imported.</p><p>${e(reason)}</p>
      <p class="hint">Nothing was created and nothing was overwritten.</p></div>`,
    ok: { label: "Understood", icon: "fa-solid fa-check" },
    rejectClose: false
  });
}

/** Show the warnings a file passed with (missing abilities, fields of the wrong type). */
function reportImportWarnings(warnings, file = "") {
  if (warnings?.length) ui.notifications.warn(`${file ? file + ": " : ""}${warnings.join(" ")}`);
}

/** The file dialog itself; resolves with the picked File or null. */
async function promptForFile({ title, hint }) {
  const L = (k, d) => game.i18n.format(k, d);
  const content = `<p>${hint ?? L("AP_TURM.Import.Hint")}</p>
    <div class="form-group"><input type="file" name="file" accept=".json,application/json" required></div>`;
  let file = null;
  try {
    file = await foundry.applications.api.DialogV2.prompt({
      window: { title: title ?? L("AP_TURM.Import.Title"), icon: "fa-solid fa-file-import" },
      content,
      ok: {
        label: L("AP_TURM.Import.Confirm"), icon: "fa-solid fa-file-import",
        callback: (event, button) => button.form.elements.file.files[0] ?? null
      },
      rejectClose: false
    });
  } catch (err) {
    return null;
  }
  if (!file) { ui.notifications.warn(L("AP_TURM.Import.NoFile")); return null; }
  return file;
}

/** Read a picked file as JSON; reports the cause and resolves null when that fails. */
async function readJsonFile(file) {
  let text;
  try { text = await file.text(); }
  catch (err) { await reportImportError(`The file could not be read: ${err.message}`, { file: file.name }); return null; }
  const clean = String(text).replace(/^﻿/, "").trim();
  if (!clean) { await reportImportError("The file is empty.", { file: file.name }); return null; }
  try { return JSON.parse(clean); }
  catch (err) {
    const pos = /position (\d+)/.exec(err.message)?.[1];
    const cut = pos && Number(pos) >= clean.length - 2 ? ", the file breaks off in the middle of the JSON" : "";
    await reportImportError(`The file is not valid JSON${pos ? ` (character ${pos} of ${clean.length}${cut})` : ""}: ${err.message}`, { file: file.name });
    return null;
  }
}

/**
 * Open a file dialog and return the picked file's parsed, validated JSON. Every failure (no file,
 * unreadable, invalid JSON, wrong format) is reported here and resolves to null; nothing is created.
 * @param {object} [opts]
 * @param {string} [opts.title]  Dialog title
 * @param {string} [opts.hint]   Hint shown above the file input
 * @param {boolean} [opts.npc]   Expect an NPC export instead of a character sheet
 * @returns {Promise<object|null>}
 */
export async function pickAppExportFile({ title, hint, npc = false } = {}) {
  const file = await promptForFile({ title, hint });
  if (!file) return null;
  const data = await readJsonFile(file);
  if (data === null) return null;
  const check = npc ? validateNpcExport(data) : validateAppExport(data);
  if (!check.ok) { await reportImportError(check.reason, { file: file.name }); return null; }
  reportImportWarnings(check.warnings, file.name);
  return data;
}

/**
 * Sidebar entry (GM only): choose a file and create a new Actor from it. A character export becomes a
 * character, an NPC export an NPC.
 * @returns {Promise<Actor|null>}
 */
export async function importAppJSON() {
  if (!game.user.isGM) { ui.notifications.warn("Only the GM can import here. Open your own sheet and use \"Import JSON\" there."); return null; }
  const file = await promptForFile({});
  if (!file) return null;
  const data = await readJsonFile(file);
  if (data === null) return null;
  const isNpc = isNpcExport(data);
  const check = isNpc ? validateNpcExport(data) : validateAppExport(data);
  if (!check.ok) { await reportImportError(check.reason, { file: file.name }); return null; }
  reportImportWarnings(check.warnings, file.name);
  try { return isNpc ? await createNpcFromExport(data) : await createActorFromAppExport(data); }
  catch (err) { await reportImportError(err.message, { file: file.name }); return null; }
}

/**
 * Sheet entry: choose a file and replace the given Actor's data with it (character or NPC).
 * @param {Actor} actor
 * @returns {Promise<Actor|null>}
 */
export async function importAppJSONIntoActor(actor) {
  if (!actor.isOwner) { ui.notifications.warn(`You do not own ${actor.name}.`); return null; }
  const npc = actor.type === "npc";
  const data = await pickAppExportFile({
    npc,
    title: npc ? `Import NPC JSON into ${actor.name}` : game.i18n.format("AP_TURM.Import.SheetTitle", { name: actor.name }),
    hint: npc
      ? `Select a JSON file from "Export NPC JSON". This replaces all values and entries of ${actor.name}.`
      : game.i18n.format("AP_TURM.Import.SheetHint", { name: actor.name })
  });
  if (!data) return null;
  try { return npc ? await importNpcIntoActor(actor, data) : await importAppExportIntoActor(actor, data); }
  catch (err) { await reportImportError(err.message); return null; }
}

/**
 * Create the Actor document from raw app JSON. Throws with the cause when the data is not an app export.
 * @param {object} data
 * @returns {Promise<Actor>}
 */
export async function createActorFromAppExport(data) {
  const check = validateAppExport(data);
  if (!check.ok) throw new Error(check.reason);
  const { notice, ...createData } = convertAppExport(data);
  const actor = await Actor.implementation.create(createData);
  if (notice) await whisperGmNotice(actor.name, notice);
  ui.notifications.info(game.i18n.format("AP_TURM.Import.Done", { name: actor.name, items: createData.items.length }));
  return actor;
}

/**
 * Replace name, system data and all embedded items of an existing Actor with the app export.
 * The order matters: validating, converting and updating come first, so a rejected file or a failed
 * update never leaves the actor without its items.
 * @param {Actor} actor
 * @param {object} data
 * @returns {Promise<Actor>}
 */
/**
 * Copy the description of spells the actor already has onto the matching re-imported spells (same name, case and
 * spaces ignored, and the same level). Mutates and returns `newItems`.
 * @param {object[]} newItems   item create data from the app export
 * @param {object[]} oldItems   the actor's current items (plain data)
 */
export function keepSpellDescriptions(newItems, oldItems) {
  const key = (i) => `${String(i.name ?? "").trim().toLowerCase().replace(/\s+/g, " ")}|${Number(i.system?.lvl) || 0}`;
  const byKey = new Map();
  for (const o of oldItems ?? []) if (o?.type === "spell" && o.system?.description) byKey.set(key(o), o.system.description);
  for (const n of newItems ?? []) {
    if (n?.type !== "spell" || n.system?.description) continue;
    const d = byKey.get(key(n));
    if (d) n.system = { ...n.system, description: d };
  }
  return newItems;
}

export async function importAppExportIntoActor(actor, data) {
  if (actor.type !== "character") throw new Error("Import target must be a character actor");
  const check = validateAppExport(data);
  if (!check.ok) throw new Error(check.reason);
  const { notice, ...createData } = convertAppExport(data);
  // current data version; an unsettled in-memory conversion of the old data is replaced by this import
  await actor.update({ "flags.ap-turm.dataVersion": DATA_VERSION, "flags.ap-turm.-=spellRulePending": null });
  if (notice) await whisperGmNotice(actor.name, notice);
  // recursive:false replaces the whole system object so stale keys in bought/choices/milestones disappear
  await actor.update({ name: createData.name, system: createData.system }, { recursive: false });
  // Foundry-only text of spells (Spell Library) is not in the app JSON: carry it over to the re-imported spells
  keepSpellDescriptions(createData.items, actor.items.map(i => i.toObject()));
  const oldItems = actor.items.map(i => i.id);
  if (oldItems.length) await actor.deleteEmbeddedDocuments("Item", oldItems);
  if (createData.items.length) await actor.createEmbeddedDocuments("Item", createData.items);
  ui.notifications.info(game.i18n.format("AP_TURM.Import.Done", { name: actor.name, items: createData.items.length }));
  return actor;
}

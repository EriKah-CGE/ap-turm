/**
 * Exporter: Foundry Actor (character) -> AP app JSON export. Inverse of importer.convertAppExport().
 *
 * `exportAppData` is pure (no Foundry globals): it takes the actor's *source* system data
 * (`actor.system.toObject()`), plain item data (`item.toObject()`) and the name. Tested in Node
 * for a lossless round trip app -> Foundry -> app.
 */
import { compactEffects } from "./rules.mjs";

const ABIL = ["str", "dex", "con", "int", "wis", "cha"];
const FEAT_BON = [...ABIL, "ac", "speed", "hp", "init"];
const CURRENCY_KEYS = ["cp", "sp", "ep", "gp", "pp", "ku", "br", "si", "go", "ed"];

const unesc = (s) => String(s ?? "").replace(/&(amp|lt|gt|quot|#39);/g, (m, c) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[c]));
/** Inverse of the importer's textToHtml(): paragraphs and <br> become lines, other tags are stripped. */
export function htmlToText(html) {
  let s = String(html ?? "");
  if (!s.trim()) return "";
  s = s.replace(/\r?\n/g, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>\s*<p[^>]*>/gi, "\n");
  s = s.replace(/<\/?p[^>]*>/gi, "");
  s = s.replace(/<\/(div|li|h[1-6])>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  return unesc(s).replace(/\n+$/, "");
}

let _seq = 0;
function appId(item, prefix) {
  const fromFlag = item.flags?.["ap-turm"]?.appId;
  if (fromFlag) return String(fromFlag);
  const base = item._id ?? item.id ?? (Date.now().toString(36) + (_seq++).toString(36));
  return prefix + String(base).toLowerCase();
}
const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

/**
 * @param {object} args
 * @param {string} args.name       Actor name
 * @param {object} args.system     Source system data (plain object)
 * @param {object[]} args.items    Plain item data: {_id?, id?, name, type, flags?, system}
 * @returns {object}               App export (DEFAULTS() shape, v4)
 */
export function exportAppData({ name, system: sys, items, dataVersion = 5 }) {
  const list = [...(items || [])];
  const pick = (t) => list.filter(i => i.type === t);
  const out = {
    // an actor the world migration has not converted yet is exported as v4, so the app converts it on load
    v: Number(dataVersion) >= 5 ? 5 : 4,
    theme: sys.theme || "celestial",
    mode: sys.mode === "turm" ? "turm" : "ap",
    name: String(name ?? ""),
    startAp: n(sys.ap?.start, 50),
    earnedAp: n(sys.ap?.earned),
    spUsed: n(sys.resources?.spUsed),
    layUsed: n(sys.resources?.layUsed),
    crystals: (sys.crystals || []).map(c => ({ name: String(c?.name ?? ""), elem: String(c?.elem ?? "") })),
    turmwissen: (sys.turmwissen || []).map(t => ({ trigger: String(t?.trigger ?? "") })),
    abilities: Object.fromEntries(ABIL.map(k => [k, n(sys.abilities?.[k], 10)])),
    bought: Object.fromEntries(Object.entries(sys.bought || {}).filter(([, v]) => n(v) > 0).map(([k, v]) => [k, n(v)])),
    choices: Object.fromEntries(Object.entries(sys.choices || {}).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, [...v]])),
    selectedSkills: [...(sys.skills || [])],
    selectedProfs: [...(sys.profs || [])],
    customProfs: [...(sys.customProfs || [])],
    hpRolls: [...(sys.hp?.rolls || [])].map(r => n(r)),
    milestones: structuredClone(sys.milestones || {}),
    identity: {
      species: String(sys.identity?.species ?? ""),
      klasse: String(sys.identity?.klasse ?? "Weapon Bearer"),
      background: String(sys.identity?.background ?? ""),
      alignment: String(sys.identity?.alignment ?? ""),
      exp: String(sys.identity?.exp ?? "")
    },
    play: {
      hpCurrent: sys.hp?.value == null ? null : n(sys.hp.value),
      tempHp: n(sys.hp?.temp),
      spentHitDice: n(sys.play?.spentHitDice),
      deathSucc: n(sys.play?.deathSucc),
      deathFail: n(sys.play?.deathFail),
      inspiration: n(sys.play?.inspiration),
      inspMax: n(sys.play?.inspMax, 5),
      exhaustion: n(sys.play?.exhaustion)
    },
    currency: Object.fromEntries(CURRENCY_KEYS.map(k => [k, n(sys.currency?.[k])])),
    equipment: "",
    notes: htmlToText(sys.notes),
    weapons: pick("weapon").map(w => ({
      id: appId(w, "w"), name: w.name, abil: w.system.abil, dice: w.system.dice, dtype: w.system.dtype,
      bonus: n(w.system.bonus), prof: !!w.system.prof, equipped: !!w.system.equipped, notes: w.system.notes ?? "",
      // Foundry only (the app ignores it): a reach other than the default 5 ft survives the round trip
      ...(n(w.system.reach, 5) !== 5 ? { reach: n(w.system.reach) } : {}),
      // optional second damage line: only written when set (the app treats a missing field as "none")
      ...(String(w.system.dice2 ?? "").trim() ? { dice2: String(w.system.dice2).trim(), type2: String(w.system.type2 ?? "") } : {})
    })),
    spells: pick("spell").map(s => ({
      id: appId(s, "s"), lvl: n(s.system.lvl), name: s.name, notes: s.system.notes ?? "", prepared: !!s.system.prepared, elem: s.system.elem ?? ""
    })),
    slotsUsed: Object.fromEntries(Object.entries(sys.resources?.slotsUsed || {}).map(([k, v]) => [k, n(v)])),
    feats: pick("feat").map(f => {
      const bon = {};
      for (const k of FEAT_BON) { const v = n(f.system.bon?.[k]); if (v) bon[k] = v; }
      return { id: appId(f, "f"), name: f.name, desc: f.system.desc ?? "", src: f.system.src ?? "", bon };
    }),
    items: pick("gear").map(g => ({
      id: appId(g, "i"), name: g.name, qty: n(g.system.qty, 1), notes: g.system.notes ?? "", attuned: !!g.system.attuned,
      charges: n(g.system.charges), used: n(g.system.used), recharge: g.system.recharge ?? "long", origin: g.system.origin ?? "city",
      // items with effects: only what is set (the app reads a missing field as "off" / "none")
      ...(g.system.equipped ? { equipped: true } : {}), ...(g.system.attunement ? { attunement: true } : {}),
      ...(compactEffects(g.system.effects) ? { effects: compactEffects(g.system.effects) } : {})
    })),
    armor: { id: sys.armor?.id || "none", shield: !!sys.armor?.shield },
    notices: (sys.notices || []).map(x => ({ date: String(x?.date ?? ""), text: String(x?.text ?? "") })),
    _wepMigrated: true,
    _featMigrated: true,
    _itemMigrated: true,
    _spCostTable: true
  };
  return out;
}

/** File name the app would use: ap_<name>.json */
export function exportFileName(name) {
  const safe = (name || "character").replace(/[^\w\-]+/g, "_").toLowerCase();
  return `ap_${safe}.json`;
}

/* ---------- Foundry UI ---------- */

/**
 * Build the export for a live Actor.
 * @param {Actor} actor
 * @returns {object}
 */
export function exportActor(actor) {
  return exportAppData({
    name: actor.name,
    dataVersion: actor.getFlag("ap-turm", "dataVersion") ?? 4,
    system: actor.system.toObject(),
    items: actor.items.map(i => i.toObject())
  });
}

/**
 * Download the app JSON for an Actor.
 * @param {Actor} actor
 */
export function downloadActorExport(actor) {
  const data = exportActor(actor);
  foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", exportFileName(actor.name));
  ui.notifications.info(game.i18n.format("AP_TURM.Export.Done", { name: actor.name }));
}

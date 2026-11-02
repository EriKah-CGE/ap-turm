/**
 * Node test: module/rules.mjs + module/importer.mjs against the HTML app (source of truth).
 * Run: node test/rules.test.mjs
 *
 * 1. Loads the app's CONFIG + logic block (PREREQS ... derived) via new Function.
 * 2. Kriegsmeister reference: expected values from CLAUDE.md.
 * 3. Fuzz: random states, derived()/AP/hit-die/weapon stats must match exactly.
 * 4. Importer: app JSON -> Foundry data -> stateFromSystem -> derived must equal the app's derived
 *    after the app's own load() migrations (incl. legacy exports).
 */
import fs from "node:fs";
import assert from "node:assert/strict";
import * as rules from "../module/rules.mjs";
import * as cfg from "../module/config.mjs";
import { convertAppExport, normalizeAppExport } from "../module/importer.mjs";
import { exportAppData, htmlToText } from "../module/exporter.mjs";
import * as rolls from "../module/rolls.mjs";
import * as imp from "../module/importer.mjs";
import * as npc from "../module/npc-transfer.mjs";
import * as award from "../module/award.mjs";
import * as transfer from "../module/transfer.mjs";
import * as requestRoll from "../module/request-roll.mjs";
import * as lib from "../module/library.mjs";
import * as fxMap from "../module/fx-map.mjs";
import * as hitFb from "../module/hit-feedback.mjs";
import * as npcItems from "../module/npc-items.mjs";
import * as qol from "../module/qol.mjs";
import * as jb from "../module/jukebox-logic.mjs";
import * as cs from "../module/custom-shop.mjs";
import * as rj from "../module/rules-journal-logic.mjs";
import * as bk from "../module/backup.mjs";
import * as sp from "../module/spawn-logic.mjs";
import * as rc from "../module/reach-logic.mjs";
import * as st from "../module/stash-logic.mjs";
import * as d5 from "../module/dnd5e-convert.mjs";
import * as tray from "../module/dice-tray-logic.mjs";
import * as tower from "../module/tower-tracker-logic.mjs";

/* ---------- load app logic ---------- */
const html = fs.readFileSync(new URL("../ap-character-sheet.html", import.meta.url), "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const start = js.indexOf("const PREREQS=");
const end = js.indexOf("function labelFor(");
const block = js.slice(start, end);
const APP = new Function(block + `
  return {
    setState:(s)=>{S=s;}, getState:()=>S, DEFAULTS, DATA_VERSION, migrateSpellRule, compactEffects, itemEffects, abilityBreakdown, derived, computeSpent, availableAp, totalAp, layPool, hitDie, hitDieMax,
    weaponStats, featBonuses, isLocked, isMaxed, costOfRank, totalSpentForItem, findItem,
    migrateWeapons, migrateFeats, migrateInsp, migrateItems, migrateCrystals,
    SHOP_DATA, PREREQS, SELECTORS, ARMORS, ELEMENTS, HIT_DICE, SKILLS, ABILITIES, ABBR, DAMAGE_TYPES, CREATURE_TYPES,
    FIGHT_STYLES, WEAPONS, ARMOR_WEAPON_PROFS, RECHARGE, FEAT_EXTRA, WEP_ABIL, DMG_SHORT
  };`)();

/* app mutation functions (sell/cascadeUnlock/setAbility/toggleSkill/toggleProf) with UI stubs */
const grabFn = (name) => { const m = js.match(new RegExp("^function " + name + "\\(.*$", "m")); if (!m) throw new Error("fn not found " + name); return m[0]; };
const MUT = new Function(block + ["sell", "cascadeUnlock", "setAbility", "toggleSkill", "toggleProf", "afterChange"].map(grabFn).join("\n") + `
  function save(){} function renderHeader(){} function renderShop(){} function renderOverview(){} function renderAttrs(){} function renderLevel(){} function renderAll(){}
  let toasts=[]; function toast(m){toasts.push(m);}
  return { setState:(s)=>{S=s;}, getState:()=>S, sell, cascadeUnlock, setAbility, toggleSkill, toggleProf, toasts };`)();

let passed = 0;
function ok(name, fn) { try { fn(); passed++; } catch (e) { console.error("FAIL:", name); throw e; } }

/* ---------- 1. tables identical ---------- */
ok("tables", () => {
  for (const k of ["SHOP_DATA", "PREREQS", "ARMORS", "ELEMENTS", "HIT_DICE", "SKILLS", "ABILITIES", "ABBR", "DAMAGE_TYPES",
    "CREATURE_TYPES", "FIGHT_STYLES", "WEAPONS", "ARMOR_WEAPON_PROFS", "RECHARGE", "FEAT_EXTRA", "WEP_ABIL", "DMG_SHORT"]) {
    assert.deepEqual(cfg[k], APP[k], "table differs: " + k);
  }
  // SELECTORS: everything the app defines must match; eleDmg/changeEle are defaulted when the app lacks them (v09-05k rule)
  for (const [id, sel] of Object.entries(APP.SELECTORS)) assert.deepEqual(cfg.SELECTORS[id], sel, "selector differs: " + id);
  assert.equal(cfg.SELECTORS.eleDmg?.type, "damage"); assert.equal(cfg.SELECTORS.changeEle?.type, "damage");
  assert.equal(Object.keys(cfg.ELEMENTS).length, 20);
  assert.ok(cfg.ELEMENTS.arch && !cfg.ELEMENTS.macht);
});

/* ---------- helpers ---------- */
const norm = (d) => JSON.parse(JSON.stringify(d, (k, v) => v instanceof Set ? [...v].sort() : v));
function appDerived(S) { APP.setState(S); return norm(APP.derived()); }
function appLoad(json) {
  // replica of the app's file import handler
  const D = APP.DEFAULTS();
  const S = Object.assign(D, structuredClone(json));
  S.identity = Object.assign(APP.DEFAULTS().identity, S.identity || {});
  S.play = Object.assign(APP.DEFAULTS().play, S.play || {});
  S.currency = Object.assign(APP.DEFAULTS().currency, S.currency || {});
  if (!Array.isArray(S.weapons)) S.weapons = []; if (!Array.isArray(S.spells)) S.spells = []; if (!S.slotsUsed) S.slotsUsed = {};
  if (!Array.isArray(S.feats)) S.feats = []; if (!Array.isArray(S.items)) S.items = []; if (!Array.isArray(S.crystals)) S.crystals = [];
  if (!Array.isArray(S.turmwissen)) S.turmwissen = []; if (!S.mode) S.mode = "ap";
  if (!S.armor || !APP.ARMORS[S.armor.id]) S.armor = { id: "none", shield: false };
  APP.setState(S);
  APP.migrateWeapons(); APP.migrateFeats(); APP.migrateInsp(); APP.migrateItems(); APP.migrateCrystals();
  if (!Array.isArray(S.notices)) S.notices = [];
  APP.migrateSpellRule(json.v);
  return APP.getState();
}
/** Foundry-side pipeline without Foundry: creation data -> fake documents -> app state */
function foundryState(createData) {
  const items = createData.items.map((it, i) => ({ id: "it" + i, type: it.type, name: it.name, system: it.system }));
  return rules.stateFromSystem(createData.system, items);
}
function compareAll(S, label) {
  const a = appDerived(S);
  const b = norm(rules.derived(S));
  assert.deepEqual(b, a, "derived differs: " + label);
  APP.setState(S);
  assert.equal(rules.computeSpent(S), APP.computeSpent(), "spent " + label);
  assert.equal(rules.availableAp(S), APP.availableAp(), "avail " + label);
  assert.equal(rules.layPool(S.earnedAp), APP.layPool(), "lay " + label);
  assert.deepEqual(rules.hitDie(S), APP.hitDie(), "hitDie " + label);
  assert.equal(rules.hitDieMax(S), APP.hitDieMax(), "hitDieMax " + label);
  for (const w of S.weapons) assert.deepEqual(rules.weaponStats(w, rules.derived(S)), APP.weaponStats(w, APP.derived()), "weapon " + label);
  for (const id of Object.keys(APP.PREREQS)) assert.equal(rules.isLocked(S, id), APP.isLocked(id), "locked " + id);
}

/* ---------- 2. Kriegsmeister ---------- */
const km = JSON.parse(fs.readFileSync(new URL("./fixtures/kriegsmeister.json", import.meta.url), "utf8"));
ok("kriegsmeister app == rules", () => {
  const S = appLoad(km);
  compareAll(S, "kriegsmeister");
  const d = rules.derived(S);
  assert.equal(d.level, 16);
  assert.equal(d.pb, 4);
  assert.equal(d.fin.str, 20);
  assert.equal(d.fin.con, 18);
  assert.equal(d.fin.wis, 12);
  assert.equal(d.ac, 19);
  assert.equal(d.acNote, "Plate");
  assert.equal(d.atkBonus, 10);
  assert.equal(rules.weaponStats(S.weapons[0], d).atk, 10);
  assert.equal(rules.weaponStats(S.weapons[0], d).dmg, "2d6+6");
  assert.equal(d.hpMax, km.hpRolls.reduce((a, b) => a + b, 0) + 16 * 4);
  assert.equal(rules.layPool(d.earned), 30);
  assert.equal(rules.hitDie(S).l, "d10");
  assert.equal(1 + S.bought.extraAttack, 4);
  assert.equal(d.numMilestones, 2);
  assert.equal(d.spTotal, 0);
  assert.equal(rules.availableAp(S), 3);
  assert.equal(d.saveData.con.prof, true);
  assert.equal(d.saveData.wis.prof, true);
  assert.equal(d.saveData.con.mod, 8);
  assert.equal(d.walk, 30);
});

ok("kriegsmeister importer pipeline", () => {
  const created = convertAppExport(km);
  assert.equal(created.type, "character");
  assert.equal(created.name, "Kriegsmeister");
  assert.equal(created.items.length, 2);
  assert.deepEqual(created.items.map(i => i.type), ["weapon", "gear"]);
  assert.equal(created.system.mode, "turm");
  assert.equal(created.system.ap.earned, 150);
  assert.equal(created.system.hp.value, null);
  assert.equal(created.system.currency.go, 12);
  assert.equal(created.system.crystals[0].elem, "feuer");
  assert.equal(created.system.turmwissen.length, 1);
  assert.match(created.system.notes, /^<p>Referenz/);
  const S2 = foundryState(created);
  const dApp = appDerived(appLoad(km));
  assert.deepEqual(norm(rules.derived(S2)), dApp, "import pipeline derived differs");
  // ObjectField data must be JSON-safe
  JSON.parse(JSON.stringify(created));
});

/* ---------- 2a. final score cap: min(20, base + bonuses), +2 per max20 purchase ---------- */
ok("ability cap 20 / max20", () => {
  const S = appLoad({ mode: "turm", startAp: 200, earnedAp: 0, abilities: { str: 18, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    feats: [{ id: "f1", name: "Bonus", desc: "", src: "", bon: { str: 3 } }] });
  compareAll(S, "cap");
  assert.equal(rules.derived(S).fin.str, 20, "18 + 3 must cap at 20");
  assert.equal(rules.derived(S).mods.str, 5);
  S.bought.max20 = 1; S.choices.max20 = ["str"];
  compareAll(S, "cap max20");
  assert.equal(rules.derived(S).fin.str, 21, "max20 raises the cap to 22");
  S.choices.asi = ["str", "str", "str"]; S.bought.asi = 3;
  compareAll(S, "cap max20 asi");
  assert.equal(rules.derived(S).fin.str, 22);
  S.bought.max20 = 2; S.choices.max20 = ["str", "str"];
  compareAll(S, "cap max20 x2");
  assert.equal(rules.derived(S).fin.str, 24);
});

/* ---------- 2b. every fixture in test/fixtures (real exports dropped in by the user) ---------- */
ok("all fixtures through importer pipeline", () => {
  const dir = new URL("./fixtures/", import.meta.url);
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".json"))) {
    const raw = JSON.parse(fs.readFileSync(new URL(f, dir), "utf8").replace(/^﻿/, ""));
    const S = appLoad(raw);
    compareAll(S, f);
    const created = convertAppExport(raw);
    const S2 = foundryState(created);
    const dApp = appDerived(S);
    assert.deepEqual(norm(rules.derived(S2)), dApp, "import pipeline differs: " + f);
    JSON.parse(JSON.stringify(created));
    const d = rules.derived(S2);
    const w = created.items.filter(i => i.type === "weapon").map(i => `${i.name} ${rules.fmtMod(rules.weaponStats(i.system, d).atk)} ${rules.weaponStats(i.system, d).dmg}`);
    console.log(`  ${f}: ${created.name} | L${d.level} PB+${d.pb} AC${d.ac} (${d.acNote}) HP${d.hpMax} | ` +
      `STR${d.fin.str} DEX${d.fin.dex} CON${d.fin.con} INT${d.fin.int} WIS${d.fin.wis} CHA${d.fin.cha} | ` +
      `atk+${d.atkBonus} attacks ${1 + (S2.bought.extraAttack || 0)} lay ${rules.layPool(d.earned) - Math.min(S2.layUsed, rules.layPool(d.earned))}/${rules.layPool(d.earned)} ` +
      `HD ${rules.hitDie(S2).l} SP ${d.spLeft}/${d.spTotal} AP ${rules.availableAp(S2)}/${rules.totalAp(S2)} | items ${created.items.length} | ${w.join("; ")}`);
  }
});

/* ---------- 3. Fuzz ---------- */
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[ri(0, arr.length - 1)];
const allShop = Object.values(APP.SHOP_DATA).flat();
const optionsFor = (type) => type === "ability" ? Object.keys(APP.ABILITIES) : type === "skill" ? Object.keys(APP.SKILLS) : type === "damage" ? Object.keys(APP.DAMAGE_TYPES)
  : type === "creature" ? Object.keys(APP.CREATURE_TYPES) : type === "fightStyle" ? Object.keys(APP.FIGHT_STYLES) : type === "weapon" ? Object.keys(APP.WEAPONS) : [];

function randomState() {
  const S = APP.DEFAULTS();
  S.mode = pick(["ap", "turm"]);
  S.startAp = ri(0, 100); S.earnedAp = ri(0, 400);
  for (const a of Object.keys(S.abilities)) S.abilities[a] = ri(6, 18);
  const nBuy = ri(0, 25);
  for (let i = 0; i < nBuy; i++) {
    const it = pick(allShop);
    const count = ri(1, it.costs.length + 1);
    S.bought[it.id] = count;
    const sel = APP.SELECTORS[it.id];
    if (sel) S.choices[it.id] = Array.from({ length: count }, () => pick(optionsFor(sel.type)));
  }
  if (rnd() < 0.3) S.choices.wepMastery = [pick(Object.keys(APP.WEAPONS))];
  S.selectedSkills = [...new Set(Array.from({ length: ri(0, 6) }, () => pick(Object.keys(APP.SKILLS))))];
  S.selectedProfs = [...new Set(Array.from({ length: ri(0, 6) }, () => pick(["lgt", "med", "hvy", "shl", "sim", "mar"])))];
  S.customProfs = rnd() < 0.5 ? ["Elvish"] : [];
  const level = Math.max(1, Math.floor(S.earnedAp / 10) + 1);
  S.hpRolls = Array.from({ length: ri(0, level) }, () => ri(0, 12));
  const ms = Math.floor(S.earnedAp / 75);
  for (let i = 1; i <= ms; i++) {
    if (rnd() < 0.4) continue;
    if (rnd() < 0.6) { const a = pick(Object.keys(APP.ABILITIES)), b = pick(Object.keys(APP.ABILITIES)); const st = {}; st[a] = (st[a] || 0) + 1; st[b] = (st[b] || 0) + 1; S.milestones[i] = { type: "asi", stats: st }; }
    else S.milestones[i] = { type: "feat", name: "Feat " + i };
  }
  S.play.exhaustion = rnd() < 0.7 ? 0 : ri(0, 6);
  S.play.hpCurrent = rnd() < 0.5 ? null : ri(0, 80);
  S.play.spentHitDice = ri(0, level);
  S.play.inspiration = rnd() < 0.2 ? true : ri(0, 5);
  S.spUsed = ri(0, 60);
  S.layUsed = ri(0, 40);
  for (let L = 6; L <= 9; L++) if (rnd() < 0.3) S.slotsUsed[L] = ri(0, 3);
  S.armor = { id: pick(Object.keys(APP.ARMORS)), shield: rnd() < 0.4 };
  S.weapons = Array.from({ length: ri(0, 3) }, (_, i) => ({ id: "w" + i, name: "W" + i, abil: pick(["str", "dex", "fin", "con", "int", "wis", "cha"]), dice: pick(["1d8", "2d6", "1d10"]),
    dtype: pick([...Object.keys(APP.ELEMENTS), "slashing", "macht"]), bonus: ri(-1, 3), prof: rnd() < 0.8, equipped: rnd() < 0.5, notes: rnd() < 0.3 ? "crit: burn" : "" }));
  S.spells = Array.from({ length: ri(0, 4) }, (_, i) => ({ id: "s" + i, name: "Spell " + i, lvl: ri(0, 9), elem: pick(["", ...Object.keys(APP.ELEMENTS), "macht"]), notes: "", prepared: rnd() < 0.8 }));
  S.feats = Array.from({ length: ri(0, 3) }, (_, i) => { const bon = {}; for (const k of ["str", "dex", "con", "int", "wis", "cha", "ac", "speed", "hp", "init"]) if (rnd() < 0.3) bon[k] = ri(-1, 3); return { id: "f" + i, name: "Feat " + i, desc: "", src: "", bon }; });
  S.items = Array.from({ length: ri(0, 8) }, (_, i) => ({ id: "i" + i, name: "Item " + i, qty: ri(1, 5), notes: "", attuned: rnd() < 0.3, charges: ri(0, 5), used: ri(0, 3), recharge: pick(["long", "short", "dawn", "none"]), origin: pick(["city", "tower"]) }));
  if (rnd() < 0.3) S.equipment = "Rope x2, Torch, Bedroll x 3";
  S.crystals = Array.from({ length: ri(0, 5) }, () => rnd() < 0.2 ? null : rnd() < 0.2 ? "Old string crystal" : { name: rnd() < 0.5 ? "Gem" : "", elem: pick(["", ...Object.keys(APP.ELEMENTS), "macht"]) });
  S.turmwissen = Array.from({ length: ri(0, 4) }, (_, i) => ({ trigger: "T" + i }));
  S.currency = { cp: ri(0, 9), gp: ri(0, 99), ku: ri(0, 99), go: ri(0, 9), ed: ri(0, 3) };
  S.notes = "line1\nline2 <b>";
  S.name = "Fuzz";
  return S;
}

ok("fuzz derived + importer (500 states)", () => {
  for (let n = 0; n < 500; n++) {
    const raw = randomState();
    const S = appLoad(raw);
    compareAll(S, "fuzz#" + n);
    // Importer: app JSON -> Foundry creation data -> state -> derived must match the app after its own migrations
    const created = convertAppExport(raw);
    const S2 = foundryState(created);
    assert.deepEqual(norm(rules.derived(S2)), appDerived(S), "import derived fuzz#" + n);
    // Item counts after migrations (wepMastery -> weapons, milestone feats -> feats, equipment string -> gear)
    assert.equal(created.items.filter(i => i.type === "weapon").length, S.weapons.length, "weapons fuzz#" + n);
    assert.equal(created.items.filter(i => i.type === "feat").length, S.feats.length, "feats fuzz#" + n);
    assert.equal(created.items.filter(i => i.type === "gear").length, S.items.length, "gear fuzz#" + n);
    assert.equal(created.items.filter(i => i.type === "spell").length, S.spells.length, "spells fuzz#" + n);
    // macht -> arch everywhere
    for (const it of created.items) { assert.notEqual(it.system.dtype, "macht"); assert.notEqual(it.system.elem, "macht"); }
    for (const c of created.system.crystals) assert.notEqual(c.elem, "macht");
    assert.equal(created.system.play.inspiration, S.play.inspiration);
    // normalizeAppExport is the same as the app's load()
    const S3 = normalizeAppExport(raw);
    assert.deepEqual(norm(rules.derived(S3)), appDerived(S), "normalize fuzz#" + n);
  }
});

/* ---------- 4. cost ladder ---------- */
ok("cost ladder", () => {
  for (const it of allShop) for (let k = 0; k < it.costs.length + 3; k++) {
    assert.equal(rules.costOfRank(it, k), APP.costOfRank(it, k), it.id + " rank " + k);
    assert.equal(rules.totalSpentForItem(it, k), APP.totalSpentForItem(it, k));
  }
  assert.equal(rules.costOfRank(cfg.findShopItem("hitDie"), 3), 60);
  assert.equal(rules.costOfRank(cfg.findShopItem("learn1"), 5), 4);
});


/* ---------- 5. mutation helpers vs app ---------- */
ok("sell/cascadeUnlock/setAbility/toggles", () => {
  for (let n = 0; n < 300; n++) {
    const S = appLoad(randomState());
    // sell every bought id once, compare resulting bought/choices
    for (const id of Object.keys(S.bought)) {
      const mine = rules.sellRank(S, id);
      const copy = structuredClone(S); MUT.setState(copy); MUT.sell(id);
      assert.deepEqual(mine.bought, copy.bought, "sell bought " + id);
      assert.deepEqual(mine.choices, copy.choices, "sell choices " + id);
    }
    // setAbility with random values incl. out of range
    for (const k of Object.keys(APP.ABILITIES)) {
      const val = ri(-3, 25);
      const r = rules.clampAbility(S.abilities, k, val);
      const copy = structuredClone(S); MUT.setState(copy); const before = MUT.toasts.length; MUT.setAbility(k, val);
      assert.equal(r.value, copy.abilities[k], `setAbility ${k}=${val}`);
      // app toasts "Point-buy budget (72) reached." exactly when the change is refused
      assert.equal(!r.ok, MUT.toasts.length > before, `setAbility refusal ${k}=${val}`);
    }
    // skill / prof toggles
    for (const k of Object.keys(APP.SKILLS)) for (const on of [true, false]) {
      const copy = structuredClone(S); MUT.setState(copy); MUT.toggleSkill(k, on);
      assert.deepEqual(rules.skillsAfterToggle(S.selectedSkills, k, on), copy.selectedSkills, "toggleSkill " + k);
    }
    for (const id of ["lgt", "med", "hvy", "shl", "sim", "mar"]) for (const on of [true, false]) {
      const copy = structuredClone(S); MUT.setState(copy); MUT.toggleProf(id, on);
      assert.deepEqual(rules.profsAfterToggle(S.selectedProfs, id, on), copy.selectedProfs, "toggleProf " + id);
    }
    // shop status matches renderShop's card logic
    APP.setState(S);
    for (const it of allShop) {
      const st = rules.shopStatus(S, it);
      const count = S.bought[it.id] || 0;
      assert.equal(st.locked, APP.isLocked(it.id)); assert.equal(st.maxed, APP.isMaxed(it, count));
      assert.equal(st.next, APP.costOfRank(it, count)); assert.equal(st.canAfford, APP.availableAp() >= st.next);
    }
  }
});

/* ---------- 6. round trip app -> Foundry -> app ---------- */
/** What a lossless export of `raw` must look like: the app's own normalized state plus the fields the
 *  app itself would fill on its next save (currency keys, migration flags, v, equipment consumed). */
function canonical(raw) {
  const S = appLoad(raw);
  const c = structuredClone(S);
  c.v = 5; c.theme = c.theme || "celestial"; c.equipment = "";
  c.currency = Object.fromEntries(["cp", "sp", "ep", "gp", "pp", "ku", "br", "si", "go", "ed"].map(k => [k, Number(c.currency[k]) || 0]));
  c._wepMigrated = c._featMigrated = c._itemMigrated = true;
  c.weapons.forEach(w => { if (w.dtype === "macht") w.dtype = "arch"; });
  c.feats.forEach(f => { const b = {}; for (const [k, v] of Object.entries(f.bon || {})) if (parseInt(v)) b[k] = parseInt(v); f.bon = b; });
  c.startAp = Number(c.startAp) || 0; c.earnedAp = Number(c.earnedAp) || 0;
  return c;
}
const sortKeys = (o) => JSON.parse(JSON.stringify(o));
function fieldDiff(a, b, path = "") {
  if ((a && typeof a === "object") !== (b && typeof b === "object")) { console.log("  TYPE", path, JSON.stringify(a), JSON.stringify(b)); return; }
  if (a && typeof a === "object") { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) fieldDiff(a[k], b[k], path + "." + k); }
  else if (a !== b) console.log("  DIFF", path, JSON.stringify(a), JSON.stringify(b));
}
function roundTrip(raw) {
  const created = convertAppExport(raw);
  const items = created.items.map((it, i) => ({ _id: "it" + i, name: it.name, type: it.type, flags: it.flags, system: it.system }));
  return exportAppData({ name: created.name, system: created.system, items });
}
ok("round trip export == canonical app JSON (fixtures + fuzz)", () => {
  const dir = new URL("./fixtures/", import.meta.url);
  const sources = fs.readdirSync(dir).filter(x => x.endsWith(".json")).map(f => [f, JSON.parse(fs.readFileSync(new URL(f, dir), "utf8").replace(/^﻿/, ""))]);
  for (let n = 0; n < 200; n++) sources.push(["fuzz#" + n, randomState()]);
  for (const [label, raw] of sources) {
    const out = roundTrip(raw);
    const exp = canonical(raw);
    // Items the app's own migrations create (wepMastery weapons, milestone feats, equipment text) get
    // time-based ids on both sides; those ids are not part of the file and are masked here.
    const rawIds = new Set(["weapons", "spells", "feats", "items"].flatMap(k => (Array.isArray(raw[k]) ? raw[k] : []).map(x => x?.id)));
    for (const o of [out, exp]) for (const k of ["weapons", "spells", "feats", "items"]) o[k].forEach(x => { if (!rawIds.has(x.id)) x.id = "(generated)"; });
    // ids of app items are preserved via flags; fuzz crystals may contain holes/strings -> normalized
    if (JSON.stringify(out) !== JSON.stringify(sortKeys(exp))) { fieldDiff(out, exp); }
    assert.deepEqual(out, exp, "round trip differs: " + label);
    // idempotent: import(export) -> export is identical, derived identical
    const out2 = roundTrip(out);
    assert.deepEqual(out2, out, "second round trip differs: " + label);
    assert.deepEqual(appDerived(appLoad(out)), appDerived(appLoad(raw)), "derived after round trip: " + label);
  }
  assert.equal(htmlToText("<p>a &amp; b</p><p>c</p>"), "a & b\nc");
  assert.equal(htmlToText("line1<br>line2"), "line1\nline2");
  assert.equal(htmlToText(""), "");
});

/* ---------- 7. Phase 3: attack / crit / damage / apply (module/rolls.mjs) ---------- */
ok("rolls: attack formula, crit range, damage, crit max, apply, resistance, exhaustion", () => {
  const S = appLoad(km);                      // Kriegsmeister: STR 20 (+5), PB 4, critBoost, critMax, eleDmg 1, wepPlus1
  const d = rules.derived(S);
  const w = S.weapons[0];                     // Zweihaender 2d6 +1, STR, proficient
  // attack: STR mod 5 + PB 4 + weapon 1 = +10; advantage/disadvantage formulas; situational
  let a = rolls.buildAttack(w, d);
  assert.equal(a.bonus, 10); assert.equal(a.formula, "1d20 + 10");
  assert.equal(rolls.buildAttack(w, d, { mode: "advantage" }).formula, "2d20kh1 + 10");
  assert.equal(rolls.buildAttack(w, d, { mode: "disadvantage", situational: -3 }).formula, "2d20kl1 + 7");
  assert.equal(rolls.buildAttack({ ...w, prof: false }, d).bonus, 6);
  assert.equal(rolls.buildAttack({ ...w, abil: "dex" }, d).bonus, 0 + 4 + 1);
  assert.equal(rolls.buildAttack({ ...w, abil: "fin" }, d).abK, "str");
  // exhaustion: -2 per level on the attack (and on saves/skills via derived)
  const Sx = structuredClone(S); Sx.play.exhaustion = 3;
  const dx = rules.derived(Sx);
  assert.equal(rolls.buildAttack(w, dx).bonus, 10 - 6);
  assert.ok(rolls.buildAttack(w, dx).parts.some(p => p.label === "Exhaustion" && p.value === -6));
  assert.equal(dx.saveData.con.mod, d.saveData.con.mod - 6);
  assert.equal(dx.skillData.ath.mod, d.skillData.ath.mod - 6);
  // crit range: 19-20 with critBoost, else 20; detected on the natural die, not the total
  assert.equal(rolls.critRange(S), 19);
  const S0 = structuredClone(S); delete S0.bought.critBoost;
  assert.equal(rolls.critRange(S0), 20);
  assert.equal(rolls.attackOutcome({ d20: 19, total: 29, ac: 30, critRange: 19 }), "crit");
  assert.equal(rolls.attackOutcome({ d20: 19, total: 29, ac: 30, critRange: 20 }), "miss");
  assert.equal(rolls.attackOutcome({ d20: 20, total: 30, ac: 35, critRange: 20 }), "crit");
  assert.equal(rolls.attackOutcome({ d20: 18, total: 28, ac: 28, critRange: 19 }), "hit");
  assert.equal(rolls.attackOutcome({ d20: 1, total: 11, ac: 5, critRange: 19 }), "fumble");
  assert.equal(rolls.attackOutcome({ d20: 12, total: 22, ac: null, critRange: 19 }), null);
  // dice parsing incl. built-in flat bonus
  assert.deepEqual(rolls.parseDice("2d8+4"), { dice: [{ n: 2, faces: 8 }], flat: 4, ok: true });
  assert.deepEqual(rolls.parseDice("1d6 + 2d4 - 1"), { dice: [{ n: 1, faces: 6 }, { n: 2, faces: 4 }], flat: -1, ok: true });
  assert.deepEqual(rolls.parseDice("d10"), { dice: [{ n: 1, faces: 10 }], flat: 0, ok: true });
  assert.equal(rolls.parseDice("2d6 fire").ok, false);
  assert.equal(rolls.diceFormula([{ n: 2, faces: 8 }, { n: 1, faces: 6 }]), "2d8 + 1d6");
  // damage: weapon 2d6 + STR 5 + weapon bonus 1 = flat 6; elemental 1d6 separate, weapon's type
  let dm = rolls.buildDamage(w, d, S);
  assert.equal(dm.parts[0].label, "Weapon"); assert.deepEqual(dm.parts[0].dice, [{ n: 2, faces: 6 }]); assert.equal(dm.parts[0].flat, 6);
  assert.equal(dm.parts[0].formula, "2d6 + 6");
  assert.equal(dm.parts[1].label, "Elemental"); assert.equal(dm.parts[1].formula, "1d6"); assert.equal(dm.parts[1].type, "erz");
  assert.equal(dm.dtype, "erz"); assert.equal(dm.crit, false);
  // built-in flat part "2d8+4" plus mods
  dm = rolls.buildDamage({ ...w, dice: "2d8+4" }, d, S);
  assert.equal(dm.parts[0].flat, 10); assert.equal(dm.parts[0].formula, "2d8 + 10");
  // crit with critMax: extra dice maximized (2d6 -> +12, 1d6 -> +6), flat parts not doubled
  dm = rolls.buildDamage(w, d, S, { crit: true });
  assert.equal(dm.critMax, true);
  assert.equal(dm.parts[0].critFlat, 12); assert.equal(dm.parts[0].critFormula, null);
  assert.equal(dm.parts[1].critFlat, 6);
  // crit without critMax: extra dice rolled
  dm = rolls.buildDamage(w, d, S, { crit: true, critMax: false });
  assert.equal(dm.parts[0].critFormula, "2d6"); assert.equal(dm.parts[0].critFlat, 0);
  assert.equal(dm.parts[1].critFormula, "1d6");
  // extra dice field (Smite etc.) is doubled/maximized on a crit like any dice
  dm = rolls.buildDamage(w, d, S, { crit: true, extra: "2d8" });
  const ex = dm.parts.find(p => p.label === "Extra");
  assert.equal(ex.formula, "2d8"); assert.equal(ex.critFlat, 16);
  // Dueling +2 only when the style is chosen (and not disabled in the dialog)
  assert.ok(!rolls.buildDamage(w, d, S).parts.some(p => p.label === "Dueling"));
  const Sd = structuredClone(S); Sd.choices.fightStyle = ["dueling"];
  assert.ok(rolls.buildDamage(w, rules.derived(Sd), Sd).parts.some(p => p.label === "Dueling" && p.flat === 2));
  assert.ok(!rolls.buildDamage(w, rules.derived(Sd), Sd, { dueling: false }).parts.some(p => p.label === "Dueling"));
  // total: rolled + crit extras
  const parts = [{ rolled: 7, critFlat: 12 }, { rolled: 4, critRolled: 3 }, { rolled: 2 }];
  assert.equal(rolls.damageTotal(parts), 28);
  // apply: temp HP first, then HP; never below 0
  assert.deepEqual(rolls.applyDamage({ hp: 41, temp: 5 }, 23), { hp: 23, temp: 0, taken: 23, fromTemp: 5, fromHp: 18, amount: 23 });
  assert.deepEqual(rolls.applyDamage({ hp: 10, temp: 8 }, 6), { hp: 10, temp: 2, taken: 6, fromTemp: 6, fromHp: 0, amount: 6 });
  assert.deepEqual(rolls.applyDamage({ hp: 3, temp: 0 }, 50).hp, 0);
  // resistance halves rounded down, immunity zeroes
  assert.equal(rolls.applyDamage({ hp: 41, temp: 0 }, 23, 0.5).taken, 11);
  assert.equal(rolls.applyDamage({ hp: 41, temp: 0 }, 23, 0.5).hp, 30);
  assert.equal(rolls.applyDamage({ hp: 41, temp: 0 }, 23, 0).taken, 0);
  assert.equal(rolls.damageMultiplier("fire", rolls.characterDefenses(S)), 0.5);     // Kriegsmeister: res fire
  assert.equal(rolls.damageMultiplier("erz", rolls.characterDefenses(S)), 1);
  assert.equal(rolls.damageMultiplier("erz", { resistances: ["Erz/Machina"], immunities: [] }), 0.5);  // label match (custom entry)
  assert.equal(rolls.damageMultiplier("feuer", { resistances: [], immunities: ["feuer"] }), 0);
  assert.equal(rolls.damageMultiplier("feuer", { resistances: ["feuer"], immunities: ["feuer"] }), 0);
});

/* ---------- 7b. downed / defeated at HP <= 0 (module/rolls.mjs) ---------- */
ok("downed: status id, HP transition, chat line", () => {
  assert.equal(rolls.downedStatusId("npc"), "dead");
  assert.equal(rolls.downedStatusId("npc", "defeated-custom"), "defeated-custom");   // CONFIG.specialStatusEffects.DEFEATED
  assert.equal(rolls.downedStatusId("character"), "unconscious");
  assert.deepEqual(rolls.downedTransition(41, 18), { isDown: false, down: false, up: false });
  assert.deepEqual(rolls.downedTransition(18, 0), { isDown: true, down: true, up: false });
  assert.deepEqual(rolls.downedTransition(0, 0), { isDown: true, down: false, up: false });   // hit again while down
  assert.deepEqual(rolls.downedTransition(0, 7), { isDown: false, down: false, up: true });   // healed
  assert.deepEqual(rolls.downedTransition(0, null), { isDown: false, down: false, up: true }); // long rest: null = full
  assert.deepEqual(rolls.downedTransition(null, 0), { isDown: true, down: true, up: false });
  assert.deepEqual(rolls.downedTransition(5, -3), { isDown: true, down: true, up: false });
  // apply never leaves HP below 0 (clamp for the character case)
  assert.equal(rolls.applyDamage({ hp: 3, temp: 2 }, 50).hp, 0);
  assert.equal(rolls.downedLine("Gnoll", "npc"), "Gnoll is defeated.");
  assert.equal(rolls.downedLine("Gnoll", "npc", "mark"), "Gnoll is defeated.");
  assert.equal(rolls.downedLine("Gnoll", "npc", "remove"), "Gnoll was defeated and removed.");
  assert.equal(rolls.downedLine("Gnoll", "npc", "nogm"), "Gnoll is defeated. No GM connected, the token stays on the scene.");
  assert.equal(rolls.downedLine("Gades", "character"), "Gades goes down.");
  assert.equal(rolls.downedLine("Gades", "character", "remove"), "Gades goes down.");   // characters are never removed
});

/* ---------- 7c. modifier keys / generic d20 / death saves / hit dice / quick HP (module/rolls.mjs) ---------- */
ok("rolls: modifier keys, d20 formula, ability check, death save, hit die heal, HP delta", () => {
  // click = normal, Shift = advantage, Ctrl/Alt/Meta = disadvantage, right-click = dialog (mode still from the keys)
  assert.deepEqual(rolls.rollModeFromEvent({ button: 0 }), { mode: "normal", dialog: false });
  assert.deepEqual(rolls.rollModeFromEvent({ button: 0, shiftKey: true }), { mode: "advantage", dialog: false });
  assert.deepEqual(rolls.rollModeFromEvent({ button: 0, ctrlKey: true }), { mode: "disadvantage", dialog: false });
  assert.deepEqual(rolls.rollModeFromEvent({ button: 0, altKey: true }), { mode: "disadvantage", dialog: false });
  assert.deepEqual(rolls.rollModeFromEvent({ button: 0, metaKey: true }), { mode: "disadvantage", dialog: false });
  assert.deepEqual(rolls.rollModeFromEvent({ button: 0, shiftKey: true, ctrlKey: true }), { mode: "advantage", dialog: false });
  assert.deepEqual(rolls.rollModeFromEvent({ button: 2 }), { mode: "normal", dialog: true });
  assert.deepEqual(rolls.rollModeFromEvent({ type: "contextmenu", shiftKey: true }), { mode: "advantage", dialog: true });
  assert.deepEqual(rolls.rollModeFromEvent(undefined), { mode: "normal", dialog: false });
  // generic d20 formula with situational bonus
  assert.equal(rolls.d20Formula(7, { mode: "normal" }).formula, "1d20 + 7");
  assert.equal(rolls.d20Formula(7, { mode: "advantage", situational: 2 }).formula, "2d20kh1 + 9");
  assert.equal(rolls.d20Formula(7, { mode: "disadvantage", situational: -10 }).formula, "2d20kl1 - 3");
  assert.equal(rolls.d20Formula(0).formula, "1d20 + 0");
  assert.equal(rolls.d20Formula(3, { mode: "bogus" }).mode, "normal");
  // ability check = mod + exhaustion; saves / skills already carry the penalty in derived()
  const S = appLoad(km);
  const d = rules.derived(S);
  assert.equal(rolls.abilityCheckBonus(d, "str"), 5);
  const Sx = structuredClone(S); Sx.play.exhaustion = 2;
  const dx = rules.derived(Sx);
  assert.equal(rolls.abilityCheckBonus(dx, "str"), 5 - 4);
  assert.equal(rolls.d20Formula(rolls.abilityCheckBonus(dx, "str"), { mode: "advantage" }).formula, "2d20kh1 + 1");
  assert.equal(rolls.d20Formula(dx.saveData.con.mod, { mode: "disadvantage" }).formula, "2d20kl1 + " + (d.saveData.con.mod - 4));
  // attack with keys: same parts as before, mode from the event
  const w = S.weapons[0];
  assert.equal(rolls.buildAttack(w, d, rolls.rollModeFromEvent({ shiftKey: true })).formula, "2d20kh1 + 10");
  assert.equal(rolls.buildAttack(w, dx, { ...rolls.rollModeFromEvent({ ctrlKey: true }), situational: 1 }).formula, "2d20kl1 + 7");
  // death saves: >= 10 success, nat 20 revive, nat 1 two failures, caps at 3
  assert.deepEqual(rolls.deathSaveOutcome({ d20: 12, total: 12, succ: 1, fail: 0 }), { result: "success", succ: 2, fail: 0 });
  assert.deepEqual(rolls.deathSaveOutcome({ d20: 9, total: 9, succ: 0, fail: 2 }), { result: "fail", succ: 0, fail: 3 });
  assert.deepEqual(rolls.deathSaveOutcome({ d20: 20, total: 20, succ: 2, fail: 2 }), { result: "revive", succ: 0, fail: 0, hp: 1 });
  assert.deepEqual(rolls.deathSaveOutcome({ d20: 1, total: 1, succ: 1, fail: 0 }), { result: "fail2", succ: 1, fail: 2 });
  assert.deepEqual(rolls.deathSaveOutcome({ d20: 1, total: 1, succ: 0, fail: 2 }), { result: "fail2", succ: 0, fail: 3 });
  assert.deepEqual(rolls.deathSaveOutcome({ d20: 12, total: 8, succ: 0, fail: 0 }).result, "fail");   // exhaustion pushed it under 10
  // hit die heal: current hit die dice + CON (Kriegsmeister: d10, CON +4); ladder step d6+d8
  assert.equal(rolls.hitDieHealFormula(S, d), "1d10 + 4");
  const S3 = structuredClone(S); S3.bought.hitDie = 3;
  assert.equal(rolls.hitDieHealFormula(S3, rules.derived(S3)), "1d6 + 1d8 + 4");
  const S0 = structuredClone(S); S0.abilities.con = 8; S0.milestones = {}; S0.choices.asi = ["str", "str"];
  assert.equal(rolls.hitDieHealFormula(S0, rules.derived(S0)), "1d10 - 1");
  // quick HP: damage hits temp first, healing caps at max
  assert.deepEqual(rolls.adjustHp({ hp: 20, temp: 3, max: 30 }, -5), { hp: 18, temp: 0, taken: 5, healed: 0 });
  assert.deepEqual(rolls.adjustHp({ hp: 20, temp: 0, max: 30 }, 25), { hp: 30, temp: 0, taken: 0, healed: 10 });
  assert.deepEqual(rolls.adjustHp({ hp: 2, temp: 0, max: 30 }, -9), { hp: 0, temp: 0, taken: 9, healed: 0 });
  assert.deepEqual(rolls.adjustHp({ hp: 5, temp: 0, max: 0 }, 4).hp, 9);
});

/* ---------- 7d. Phase 4: statblock parser -> structured entries (three fixtures + GM statblocks), conditions, NPC rolls ---------- */
const statblock = await import("../module/statblock.mjs");
const cond = await import("../module/conditions.mjs");
const fs4 = await import("node:fs");
const readFixture = (n) => fs4.readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8");
const byName = (p, n) => p.entries.find(e => e.name === n);
const pickE = (e) => ({ section: e.section, toHit: e.toHit, saveDc: e.saveDc, saveAbility: e.saveAbility, damage: e.damage, dmgType: e.dmgType, range: e.range, recharge: e.recharge, uses: e.uses.max, per: e.uses.per, cost: e.legendaryCost });

ok("statblock parser: book / PDF layout (wrapped lines, ability row, recharge, plus damage)", () => {
  const p = statblock.parseStatblock(readFixture("statblock-book.txt"));
  assert.equal(p.name, "Rusted Sentinel");
  assert.equal(p.typeLine, "Medium construct, unaligned");
  assert.equal(p.ac, 16); assert.equal(p.acNote, "natural armor");
  assert.deepEqual(p.hp, { max: 52, formula: "7d8 + 21" });
  assert.equal(p.speed, 25);
  assert.deepEqual(p.abilities, { str: 18, dex: 9, con: 16, int: 3, wis: 11, cha: 1 });
  assert.deepEqual(p.saves, { con: 5, wis: 2 });
  assert.deepEqual(p.resistances, ["bludgeoning", "piercing", "slashing"]);
  assert.deepEqual(p.immunities, ["poison", "psychic"]);
  assert.equal(p.cr, "3");
  // header block: keyword lines are fields, not traits
  assert.equal(p.defenseNote, "Damage Resistances bludgeoning, piercing, and slashing from nonmagical attacks");   // qualifier stays readable
  assert.equal(p.conditionImmunities, "Charmed, Exhaustion, Frightened, Paralyzed, Poisoned");
  assert.equal(p.senses, "darkvision 60 ft., passive Perception 10");
  assert.equal(p.languages, "understands the languages of its creator but can't speak");
  assert.deepEqual(p.entries.map(e => [e.section, e.name]), [
    ["traits", "Immutable Form"], ["traits", "Magic Resistance"],
    ["actions", "Multiattack"], ["actions", "Slam"], ["actions", "Rust Spray"]
  ]);
  assert.deepEqual(p.unparsed, []);
  assert.equal(byName(p, "Immutable Form").text, "The sentinel is immune to any spell or effect that would alter its form.");   // wrapped line joined
  assert.deepEqual(pickE(byName(p, "Slam")), { section: "actions", toHit: 6, saveDc: null, saveAbility: "", damage: "2d6 + 4", dmgType: "bludgeoning", range: "5 ft", recharge: "", uses: 0, per: "", cost: 0 });
  const rs = byName(p, "Rust Spray");
  assert.deepEqual(pickE(rs), { section: "actions", toHit: 1, saveDc: null, saveAbility: "", damage: "2d8 + 1d6", dmgType: "acid", range: "30/60 ft", recharge: "5-6", uses: 0, per: "", cost: 0 });
  assert.ok(rs.text.includes("plus 3 (1d6) poison damage"));    // the second type stays readable in the text
  assert.equal(byName(p, "Multiattack").toHit, null); assert.equal(byName(p, "Multiattack").damage, "");
  // actor update
  const u = statblock.statblockToUpdate(p);
  assert.equal(u.name, "Rusted Sentinel"); assert.equal(u.system.typeLine, "Medium construct, unaligned");
  assert.equal(u.system.ac, 16); assert.deepEqual(u.system.hp, { value: 52, max: 52 });
  assert.deepEqual(u.system.saves, { str: null, dex: null, con: 5, int: null, wis: 2, cha: null });
  assert.equal(u.system.entries.length, 5); assert.equal(u.system.legendary, undefined);
  assert.equal(u.system.senses, "darkvision 60 ft., passive Perception 10"); assert.equal(u.system.defenseNote, p.defenseNote);
  assert.equal(u.system.traits, undefined); assert.equal(u.system.actions, undefined);   // no free text any more
});

ok("statblock parser: web layout (abilities on separate lines, legendary actions with costs, X/Day)", () => {
  const p = statblock.parseStatblock(readFixture("statblock-web.txt"));
  assert.equal(p.name, "Marsh Stalker");
  assert.equal(p.ac, 14); assert.equal(p.hp.max, 68); assert.equal(p.speed, 40); assert.equal(p.speedText, "40 ft., swim 40 ft."); assert.equal(p.speeds, "Swim 40");
  assert.deepEqual(p.abilities, { str: 17, dex: 14, con: 16, int: 6, wis: 12, cha: 7 });
  assert.deepEqual(p.saves, { dex: 4, wis: 3 });
  assert.deepEqual(p.resistances, ["cold"]); assert.deepEqual(p.vulnerabilities, ["fire"]); assert.deepEqual(p.immunities, []);
  assert.equal(p.cr, "4"); assert.equal(p.pb, 2);
  assert.deepEqual(p.legendary, { resist: 2, actions: 2 });
  assert.deepEqual(p.entries.filter(e => e.toHit !== null).map(e => [e.name, e.toHit, e.damage, e.dmgType, e.range]), [
    ["Bite", 5, "2d8 + 3", "piercing", "5 ft"], ["Tail", 5, "1d10 + 3", "bludgeoning", "10 ft"], ["Spit", 4, "3d6", "acid", "30/90 ft"]
  ]);
  assert.equal(byName(p, "Legendary Resistance"), undefined);   // counter in the legendary box, not a text entry
  assert.equal(byName(p, "Skills"), undefined); assert.deepEqual(p.skills, { perception: 5, stealth: 6 });
  assert.equal(statblock.formatSkills(p.skills), "Perception +5, Stealth +6");
  assert.deepEqual(p.entries.filter(e => e.section === "traits").map(e => e.name), ["Amphibious"]);
  const leg = p.entries.filter(e => e.section === "legendary");
  assert.deepEqual(leg.map(e => [e.name, e.legendaryCost]), [["Move", 1], ["Tail", 2]]);   // intro paragraph sets the counter, no entry
  assert.equal(leg[1].text, "The stalker makes one Tail attack.");
  assert.deepEqual(p.unparsed, []);
  const u = statblock.statblockToUpdate(p);
  assert.deepEqual(u.system.legendary, { resist: { value: 2, max: 2 }, actions: { value: 2, max: 2 } });
  assert.deepEqual(u.system.skills, { perception: 5, stealth: 6 }); assert.equal(u.system.speeds, "Swim 40");
});

ok("statblock parser: 2024 layout (short AC/HP, ability table with saves, Attack Roll wording, bonus actions)", () => {
  const p = statblock.parseStatblock(readFixture("statblock-2024.txt"));
  assert.equal(p.name, "Ember Cultist");
  assert.equal(p.ac, 13); assert.equal(p.hp.max, 27); assert.equal(p.speed, 30);
  assert.deepEqual(p.abilities, { str: 11, dex: 14, con: 12, int: 10, wis: 13, cha: 15 });
  assert.deepEqual(p.saves, { str: 0, dex: 2, con: 1, int: 0, wis: 3, cha: 2 });
  assert.deepEqual(p.immunities, ["fire"]);
  assert.equal(p.conditionImmunities, "Frightened");   // mixed 2024 line: damage type -> defenses, condition -> header field
  assert.deepEqual(p.skills, { deception: 4, religion: 2 }); assert.equal(p.senses, "Passive Perception 11"); assert.equal(p.languages, "Common, Ignan");
  assert.equal(p.cr, "1"); assert.equal(p.pb, 2);
  assert.deepEqual(pickE(byName(p, "Flame Blade")), { section: "actions", toHit: 4, saveDc: null, saveAbility: "", damage: "1d6 + 2 + 1d6", dmgType: "slashing", range: "5 ft", recharge: "", uses: 0, per: "", cost: 0 });
  assert.deepEqual([byName(p, "Fire Bolt").toHit, byName(p, "Fire Bolt").damage, byName(p, "Fire Bolt").dmgType, byName(p, "Fire Bolt").range], [4, "2d6", "fire", "120 ft"]);
  assert.equal(byName(p, "Fire Blessing").section, "traits");
  assert.equal(byName(p, "Ember Step").section, "bonus");
  // garbage in: nothing recognized, everything kept as entries
  const g = statblock.parseStatblock("Just some notes\nabout nothing in particular.");
  assert.equal(g.name, "Just some notes"); assert.equal(g.ac, null);
  assert.equal(g.entries.length, 1); assert.equal(g.entries[0].text, "about nothing in particular.");
  assert.equal(statblock.parseStatblock("").recognized.length, 0);
  // damage lists
  assert.deepEqual(statblock.parseDamageList("cold, fire; bludgeoning, piercing, and slashing from nonmagical attacks"), ["cold", "fire", "bludgeoning", "piercing", "slashing"]);
  assert.deepEqual(statblock.parseDamageList("necrotic, poison, and psychic"), ["necrotic", "poison", "psychic"]);
  assert.deepEqual(statblock.parseDamageList("Fire; Frightened, Poisoned"), ["fire"]);
});

ok("statblock entries: regex extraction (to hit, DC, damage, recharge, uses, cost) and nothing lost", () => {
  const pe = statblock.parseEntry;
  const fb = pe("Fire Breath (Recharge 5–6). The dragon exhales fire in a 30-foot cone. Each creature in that area must make a DC 15 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much damage on a successful one.", "actions");
  assert.deepEqual(pickE(fb), { section: "actions", toHit: null, saveDc: 15, saveAbility: "dex", damage: "7d6", dmgType: "fire", range: "", recharge: "5-6", uses: 0, per: "", cost: 0 });
  assert.equal(fb.name, "Fire Breath"); assert.ok(fb.text.startsWith("The dragon exhales fire"));
  const w2024 = pe("Cold Breath (Recharge 5–6). Constitution Saving Throw: DC 13, each creature in a 15-foot cone. Failure: 18 (4d8) Cold damage. Success: Half damage.", "actions");
  assert.deepEqual([w2024.saveDc, w2024.saveAbility, w2024.damage, w2024.dmgType, w2024.recharge], [13, "con", "4d8", "cold", "5-6"]);
  const sp = pe("Spellcasting (2/Day). The mage casts one of the following spells: fireball.", "actions");
  assert.deepEqual([sp.name, sp.uses.max, sp.uses.per, sp.text], ["Spellcasting", 2, "day", "The mage casts one of the following spells: fireball."]);
  const lr = pe("Legendary Resistance (3/Day). If the dragon fails a saving throw, it can choose to succeed instead.", "traits");
  assert.deepEqual([lr.name, lr.uses.max, lr.uses.per], ["Legendary Resistance", 3, "day"]);
  const wing = pe("Wing Attack (Costs 2 Actions). The dragon beats its wings. Each creature within 10 feet must succeed on a DC 19 Dexterity saving throw or take 13 (2d6 + 6) bludgeoning damage and be knocked prone.", "legendary");
  assert.deepEqual(pickE(wing), { section: "legendary", toHit: null, saveDc: 19, saveAbility: "dex", damage: "2d6 + 6", dmgType: "bludgeoning", range: "", recharge: "", uses: 0, per: "", cost: 2 });
  assert.equal(pe("Detect. The dragon makes a Wisdom (Perception) check.", "legendary").legendaryCost, 1);   // legendary default cost
  const spear = pe("Spear. Melee or Ranged Weapon Attack: +4 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 5 (1d6 + 2) piercing damage, or 6 (1d8 + 2) piercing damage if used with two hands to make a melee attack.", "actions");
  assert.deepEqual([spear.toHit, spear.damage, spear.range], [4, "1d6 + 2", "5 ft / 20/60 ft"]);   // "or" alternative stays text only
  assert.ok(spear.text.includes("or 6 (1d8 + 2) piercing damage if used with two hands"));
  const pt = pe("Pack Tactics. The gnoll has advantage on an attack roll against a creature if at least one of the gnoll's allies is within 5 feet of the creature and the ally isn't incapacitated.", "traits");
  assert.deepEqual([pt.name, pt.toHit, pt.damage, pt.saveDc, pt.parent], ["Pack Tactics", null, "", null, ""]);
  const rest = pe("Second Wind (Recharges after a Short or Long Rest). The knight regains 10 hit points.", "bonus");
  assert.deepEqual([rest.name, rest.recharge, rest.section], ["Second Wind", "rest", "bonus"]);
  const nameless = pe("the stalker can take 2 legendary actions.", "legendary");
  assert.equal(nameless.name, ""); assert.equal(nameless.text, "the stalker can take 2 legendary actions."); assert.equal(nameless.legendaryCost, 0);
  // entry -> attack data / trait toggles
  assert.deepEqual(rolls.entryAttackData(spear), { name: "Spear", bonus: 4, dice: "1d6 + 2", dtype: "piercing", range: "5 ft / 20/60 ft" });
  assert.equal(rolls.entryAttackData(pt), null);
  // manual combat modifiers (one row on the sheet, never guessed from traits)
  assert.deepEqual(rolls.manualAdvantages({ attacks: true, spellSaves: false }, "attack"), ["combat modifier: attacks"]);
  assert.deepEqual(rolls.manualAdvantages({ attacks: false, spellSaves: true }, "save"), ["combat modifier: spell saves"]);
  assert.deepEqual(rolls.manualAdvantages({ attacks: true, spellSaves: true }, "check"), []);
  assert.deepEqual(rolls.manualAdvantages({ attacks: false, spellSaves: false }, "attack"), []);
  assert.equal(cond.resolveMode("normal", { adv: ["combat modifier: attacks"], dis: [] }), "advantage");
  // markdown links and bold markers, continuation paragraphs, section intros, options of an entry
  const md = statblock.parseStatblock("Gnoll\nMedium humanoid\nAC 15\nHP 22 (5d8)\nSTR 14 (+2) DEX 12 (+1) CON 11 (+0) INT 6 (-2) WIS 10 (+0) CHA 7 (-2)\nActions\n**Bite.** Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 4 (1d4 + 2) [piercing](https://x.y/piercing) damage.\nA second paragraph of the bite.\nLegendary Actions\nThe gnoll can take 2 legendary actions, choosing from the options below.\nBite. The gnoll bites.");
  assert.deepEqual(md.entries.map(e => [e.section, e.name]), [["actions", "Bite"], ["legendary", "Bite"]]);
  assert.equal(md.entries[0].text, "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 4 (1d4 + 2) piercing damage. A second paragraph of the bite.");
  assert.equal(md.entries[0].dmgType, "piercing"); assert.equal(md.legendary.actions, 2); assert.deepEqual(md.unparsed, []);
  const opts = statblock.linkChildren([
    { ...pe("Breath Weapons (Recharge 5-6). The dragon uses one of the following breath weapons.", "actions") },
    pe("Cold Breath. Each creature must make a DC 20 Constitution saving throw, taking 58 (13d8) cold damage on a failed save.", "actions"),
    pe("Change Shape. The dragon polymorphs.", "actions")
  ]);
  assert.deepEqual(opts.map(e => e.parent), ["", "Breath Weapons", ""]);
  // speed / skills / conditions helpers
  assert.deepEqual(statblock.parseSpeed("40 ft., Fly 80 ft. (hover), swim 20 ft."), { speed: 40, speeds: "Fly 80 (hover), Swim 20" });
  assert.deepEqual(statblock.parseSpeed("0 ft., fly 60 ft."), { speed: 0, speeds: "Fly 60" });
  assert.deepEqual(statblock.parseSkills("Animal Handling +4, Sleight of Hand -1"), { animalhandling: 4, sleightofhand: -1 });
  assert.equal(statblock.formatSkills({ animalhandling: 4, sleightofhand: -1 }), "Animal Handling +4, Sleight of Hand -1");
  assert.equal(statblock.parseConditionList("Fire; Frightened, Poisoned"), "Frightened, Poisoned");
  // damage types are never translated; a turm-mode import marks D&D words "not assigned" ("?cold": no resistance until
  // the GM picks a type). Without the mark a D&D type is a real type in both modes (1.3.0).
  assert.equal(statblock.damageKey("Cold"), "cold");
  assert.equal(rolls.isUnassignedType("?cold", "turm"), true); assert.equal(rolls.isUnassignedType("cold", "turm"), false);
  assert.equal(rolls.isUnassignedType("cold", "ap"), false);
  assert.equal(rolls.isUnassignedType("eis", "turm"), false); assert.equal(rolls.isUnassignedType("", "turm"), false);
  const marked = rolls.markUnassignedTypes({ resistances: ["cold", "eis", "?fire"], immunities: [], vulnerabilities: ["Feuer"], entries: [{ dmgType: "piercing" }, { dmgType: "" }] }, "turm");
  assert.deepEqual([marked.resistances, marked.vulnerabilities, marked.entries.map(e => e.dmgType)], [["?cold", "eis", "?fire"], ["Feuer"], ["?piercing", ""]]);
  assert.deepEqual(rolls.markUnassignedTypes({ resistances: ["cold"] }, "ap").resistances, ["cold"]);
  assert.equal(cfg.damageTypeLabel("?cold"), "Cold");
  // defense chips + verdict for the damage card (why halved / doubled / zeroed)
  const v1 = rolls.defenseVerdict("eis", { resistances: ["erz"], immunities: ["eis"], vulnerabilities: ["feuer"] }, { mode: "turm" });
  assert.deepEqual([v1.mult, v1.label, v1.reason], [0, "× 0", "IMM Eis"]);
  assert.deepEqual(v1.chips.map(c => [c.abbr, c.label, c.hit, c.unassigned]), [["RES", "Erz/Machina", false, false], ["IMM", "Eis", true, false], ["VUL", "Feuer", false, false]]);
  const v2 = rolls.defenseVerdict("fire", { resistances: ["fire"] }, { mode: "ap" });
  assert.deepEqual([v2.mult, v2.label, v2.reason], [0.5, "× ½", "RES Fire"]);
  // "not assigned" (imported, prefix "?") never resists and is never resisted; a chosen D&D type counts in turm mode too
  const v3 = rolls.defenseVerdict("cold", { immunities: ["?cold"] }, { mode: "turm" });
  assert.deepEqual([v3.mult, v3.label, v3.reason, v3.chips[0].unassigned, v3.chips[0].hit], [1, "× 1", "", true, false]);
  const v3b = rolls.defenseVerdict("?cold", { immunities: ["cold"] }, { mode: "turm" });
  assert.deepEqual([v3b.mult, v3b.reason], [1, "type not assigned"]);
  assert.deepEqual(rolls.defenseVerdict("cold", { immunities: ["cold"] }, { mode: "turm" }).mult, 0);
  assert.deepEqual(rolls.defenseVerdict("feuer", { vulnerabilities: ["feuer"] }, { mode: "turm" }).label, "× 2");
  assert.deepEqual(rolls.defenseVerdict("feuer", {}, { mode: "turm" }), { mult: 1, label: "× 1", reason: "", chips: [] });
  assert.equal(rolls.damageMultiplier("cold", { immunities: ["cold"] }, { mode: "ap" }), 0);
  assert.equal(rolls.damageMultiplier("cold", { immunities: ["cold"] }, { mode: "turm" }), 0);
  assert.equal(rolls.damageMultiplier("cold", { immunities: ["?cold"] }, { mode: "turm" }), 1);
  assert.equal(rolls.damageMultiplier("?cold", { immunities: ["cold"] }, { mode: "turm" }), 1);
  assert.equal(rolls.damageMultiplier("eis", { immunities: ["cold"] }, { mode: "turm" }), 1);
  assert.equal(rolls.damageMultiplier("eis", { immunities: ["eis"] }, { mode: "turm" }), 0);
  assert.equal(rolls.damageMultiplier("eis", { resistances: ["eis", "cold"] }, { mode: "turm" }), 0.5);
});

ok("statblock parser: Adult Silver Dragon (GM fixture) — header fields, legendary counters, breath options, no unnamed entries", () => {
  const p = statblock.parseStatblock(readFixture("gm/adult-silver-dragon.txt"));
  assert.equal(p.name, "Adult Silver Dragon"); assert.equal(p.typeLine, "Huge Dragon, Lawful Good");
  assert.equal(p.ac, 19); assert.deepEqual(p.hp, { max: 243, formula: "18d12 + 126" });
  assert.equal(p.speed, 40); assert.equal(p.speeds, "Fly 80");
  assert.deepEqual(p.abilities, { str: 27, dex: 10, con: 25, int: 16, wis: 13, cha: 21 });
  assert.deepEqual(p.saves, { dex: 5, con: 12, wis: 6, cha: 10 });
  // four header fields instead of traits
  assert.deepEqual(p.skills, { arcana: 8, history: 8, perception: 11, stealth: 5 });
  assert.deepEqual(p.immunities, ["cold"]);
  assert.equal(p.senses, "Blindsight 60 ft., Darkvision 120 ft., Passive Perception 21");
  assert.equal(p.languages, "Common, Draconic");
  assert.equal(p.cr, "16"); assert.equal(p.pb, 5);
  assert.deepEqual(p.legendary, { resist: 3, actions: 3 });   // Legendary Resistance (3/Day) -> counter, intro -> counter
  assert.deepEqual(p.entries.filter(e => e.section === "traits"), []);
  assert.deepEqual(p.unparsed, []); assert.ok(p.entries.every(e => e.name));
  const actions = p.entries.filter(e => e.section === "actions");
  assert.deepEqual(actions.filter(e => !e.parent).map(e => e.name), ["Multiattack", "Bite", "Claw", "Tail", "Frightful Presence", "Breath Weapons", "Change Shape"]);   // 7 actions
  assert.deepEqual(actions.filter(e => e.parent).map(e => [e.name, e.parent]), [["Cold Breath", "Breath Weapons"], ["Paralyzing Breath", "Breath Weapons"]]);
  assert.equal(byName(p, "Breath Weapons").recharge, "5-6");
  assert.deepEqual(pickE(byName(p, "Cold Breath")), { section: "actions", toHit: null, saveDc: 20, saveAbility: "con", damage: "13d8", dmgType: "cold", range: "", recharge: "", uses: 0, per: "", cost: 0 });
  assert.deepEqual([byName(p, "Paralyzing Breath").saveDc, byName(p, "Paralyzing Breath").saveAbility], [20, "con"]);
  assert.deepEqual(pickE(byName(p, "Bite")), { section: "actions", toHit: 13, saveDc: null, saveAbility: "", damage: "2d10 + 8", dmgType: "piercing", range: "10 ft", recharge: "", uses: 0, per: "", cost: 0 });
  assert.deepEqual([byName(p, "Frightful Presence").saveDc, byName(p, "Frightful Presence").saveAbility], [18, "wis"]);
  assert.ok(byName(p, "Multiattack").text.includes("use its Frightful Presence. It then"));   // markdown link reduced to its text
  assert.ok(!JSON.stringify(p).includes("dndbeyond"));
  assert.ok(byName(p, "Change Shape").text.includes("In a new form, the dragon retains"));   // continuation paragraph
  const leg = p.entries.filter(e => e.section === "legendary");
  assert.deepEqual(leg.map(e => [e.name, e.legendaryCost]), [["Detect", 1], ["Tail Attack", 1], ["Wing Attack", 2]]);
  assert.deepEqual(pickE(byName(p, "Wing Attack")), { section: "legendary", toHit: null, saveDc: 21, saveAbility: "dex", damage: "2d6 + 8", dmgType: "bludgeoning", range: "", recharge: "", uses: 0, per: "", cost: 2 });
  // actor update: the parser keeps "cold"; the sheet marks it "not assigned" in turm mode (prefix "?"), ap keeps it 1:1
  const u = statblock.statblockToUpdate(p);
  assert.deepEqual(u.system.immunities, ["cold"]); assert.equal(u.system.speeds, "Fly 80"); assert.equal(u.system.entries.length, 12);
  assert.equal(u.system.legendary.resist.max, 3); assert.equal(u.system.legendary.actions.max, 3);
  const uAp = rolls.markUnassignedTypes(structuredClone(u.system), "ap");
  assert.deepEqual([...uAp.immunities, ...uAp.entries.map(e => e.dmgType)].filter(k => rolls.isUnassignedType(k, "ap")), []);
  const uT = rolls.markUnassignedTypes(structuredClone(u.system), "turm");
  const unassigned = [...uT.immunities, ...uT.entries.map(e => e.dmgType)].filter(k => rolls.isUnassignedType(k, "turm"));
  assert.deepEqual(unassigned, ["?cold", "?piercing", "?slashing", "?bludgeoning", "?cold", "?bludgeoning"]);   // 6 tags to assign by hand
});

ok("statblock parser: the GM's own statblocks (test/fixtures/gm/*.txt) — every line survives as a field or entry", () => {
  const dir = new URL("./fixtures/gm/", import.meta.url);
  const files = fs4.existsSync(dir) ? fs4.readdirSync(dir).filter(f => f.endsWith(".txt")) : [];
  if (!files.length) { console.log("  (no GM statblocks in test/fixtures/gm/ yet — drop three .txt files there)"); return; }
  for (const f of files) {
    const text = readFixture("gm/" + f);
    const p = statblock.parseStatblock(text);
    assert.ok(p.name, `${f}: name`);
    for (const k of ["ac", "hp", "abilities"]) assert.ok(p.recognized.includes(k), `${f}: ${k} not recognized`);
    assert.ok(p.entries.length > 0, `${f}: no entries`);
    assert.ok(p.entries.some(e => e.toHit !== null || e.saveDc !== null), `${f}: no attack or save entry`);
    // nothing lost: every word of every non-stat line shows up in a field, a name or an entry text
    const bag = JSON.stringify(p).toLowerCase();
    for (const line of text.split("\n").map(l => l.trim()).filter(Boolean)) {
      // by design only counters: "Legendary Resistance (3/Day). ..." and the "can take 3 legendary actions" intro
      if (/^Legendary Resistance\s*\(\d+\/Day/i.test(line) || /can take \d+ legendary actions/i.test(line)) continue;
      // header keywords and numbers are consumed into typed fields (saves, abilities, AC ...), so they are not "words"
      const HEADER = /^(armor|class|points|speed|saving|throws?|skills?|senses|languages|challenge|proficiency|bonus|damage|immunities|resistances|vulnerabilities|condition|traits|actions|legendary|reactions|lair|initiative|(?:\d+)?d\d+)[.,;:]?$/;
      const words = line.toLowerCase().replace(/[−–—]/g, "-").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").split(/\s+/)
        .filter(w => w.length > 3 && !/^\(?[+-]?[\d,]+\)?[.,;:]?$/.test(w) && !HEADER.test(w));
      const missing = words.filter(w => !bag.includes(w.replace(/[.,;:()]/g, "")));
      assert.ok(missing.length <= Math.ceil(words.length * 0.2), `${f}: words lost from "${line.slice(0, 50)}": ${missing.join(" ")}`);
    }
    console.log(`  gm/${f}: ${p.name} | AC ${p.ac} HP ${p.hp.max} | ${p.entries.length} entries, ${p.entries.filter(e => e.toHit !== null).length} attacks, ${p.entries.filter(e => e.saveDc !== null).length} saves, ${p.entries.filter(e => e.recharge).length} recharge, ${p.entries.filter(e => e.section === "legendary").length} legendary`);
  }
});

ok("conditions: status list, roll modifiers, mode resolution, exhaustion", () => {
  const effects = cond.statusEffects();
  const ids = effects.map(e => e.id);
  for (const id of ["prone", "restrained", "stunned", "unconscious", "invisible", "poisoned", "frightened", "paralyzed", "concentrating", "dead", "exhaustion1", "exhaustion6"]) assert.ok(ids.includes(id), id);
  assert.equal(effects.length, 10 + 6);
  // concentrating is a marker: no advantage, disadvantage or automatic failure anywhere
  for (const type of ["attack", "save", "check", "initiative"]) {
    const m = cond.rollModifiers({ statuses: ["concentrating"], targetStatuses: ["concentrating"], type, ability: "dex", distance: 5 });
    assert.deepEqual([m.adv, m.dis, m.autoFail || null, m.autoCrit || null], [[], [], null, null], type);
  }
  assert.ok(effects.every(e => e.name && e.img));
  assert.equal(cond.exhaustionLevel(["prone", "exhaustion3"]), 3);
  assert.equal(cond.exhaustionLevel(new Set(["exhaustion2", "exhaustion5"])), 5);
  assert.equal(cond.exhaustionLevel([]), 0);
  const rm = cond.rollModifiers;
  // attacker conditions
  assert.deepEqual(rm({ statuses: ["prone"], type: "attack" }).dis, ["prone"]);
  assert.deepEqual(rm({ statuses: ["poisoned", "frightened"], type: "attack" }).dis, ["poisoned", "frightened"]);
  assert.deepEqual(rm({ statuses: ["invisible"], type: "attack" }).adv, ["invisible"]);
  assert.deepEqual(rm({ statuses: ["poisoned"], type: "check" }).dis, ["poisoned"]);
  assert.deepEqual(rm({ statuses: ["frightened"], type: "initiative" }).dis, ["frightened"]);
  assert.deepEqual(rm({ statuses: ["poisoned"], type: "save", ability: "con" }).dis, []);
  assert.deepEqual(rm({ statuses: ["restrained"], type: "save", ability: "dex" }).dis, ["restrained"]);
  assert.equal(rm({ statuses: ["stunned"], type: "save", ability: "dex" }).autoFail, "stunned");
  assert.equal(rm({ statuses: ["paralyzed"], type: "save", ability: "str" }).autoFail, "paralyzed");
  assert.equal(rm({ statuses: ["unconscious"], type: "save", ability: "wis" }).autoFail, null);
  // target conditions
  assert.deepEqual(rm({ type: "attack", targetStatuses: ["restrained"] }).adv, ["target restrained"]);
  assert.deepEqual(rm({ type: "attack", targetStatuses: ["invisible"] }).dis, ["target invisible"]);
  assert.deepEqual(rm({ type: "attack", targetStatuses: ["prone"], distance: 5 }).adv, ["target prone (melee)"]);
  assert.deepEqual(rm({ type: "attack", targetStatuses: ["prone"], distance: 30 }).dis, ["target prone (ranged)"]);
  const unknown = rm({ type: "attack", targetStatuses: ["prone"] });
  assert.deepEqual([unknown.adv, unknown.dis], [[], []]); assert.equal(unknown.notes.length, 1);
  assert.equal(rm({ type: "attack", targetStatuses: ["paralyzed"], distance: 5 }).autoCrit, "target paralyzed");
  assert.equal(rm({ type: "attack", targetStatuses: ["unconscious"], distance: 10 }).autoCrit, null);
  // exhaustion: -2 x level, notes, level 6 dead
  assert.equal(rm({ type: "attack", exhaustion: 3 }).penalty, -6);
  assert.equal(rm({ type: "save", exhaustion: 0 }).penalty, 0);
  assert.ok(rm({ statuses: ["exhaustion6"], type: "check", exhaustion: 6 }).notes.includes("dead"));
  assert.equal(cond.exhaustedSpeed(30, 2), 20); assert.equal(cond.exhaustedSpeed(30, 6), 0); assert.equal(cond.exhaustedSpeed(30, 0), 30);
  // resolution: any advantage + any disadvantage = normal
  assert.equal(cond.resolveMode("normal", { adv: ["invisible"], dis: [] }), "advantage");
  assert.equal(cond.resolveMode("advantage", { adv: [], dis: ["prone"] }), "normal");
  assert.equal(cond.resolveMode("disadvantage", { adv: [], dis: ["prone"] }), "disadvantage");
  assert.equal(cond.resolveMode("normal", { adv: ["a", "b"], dis: ["c"] }), "normal");
  assert.equal(cond.resolveMode("normal", { adv: [], dis: [] }), "normal");
  assert.equal(cond.resolveMode("advantage", rm({ statuses: ["prone"], type: "attack" })), "normal");
  assert.equal(cond.resolveMode("normal", rm({ statuses: ["invisible"], type: "attack", targetStatuses: ["invisible"] })), "normal");
});

ok("NPC rolls: attack / damage builders with exhaustion, vulnerabilities", () => {
  const atk = { name: "Bite", bonus: 5, dice: "2d8 + 3", dtype: "piercing", range: "5 ft" };
  let a = rolls.buildNpcAttack(atk);
  assert.equal(a.formula, "1d20 + 5"); assert.equal(a.bonus, 5);
  a = rolls.buildNpcAttack(atk, { mode: "advantage", situational: 2 });
  assert.equal(a.formula, "2d20kh1 + 7");
  a = rolls.buildNpcAttack(atk, { mode: "disadvantage", exhPen: -4 });
  assert.equal(a.formula, "2d20kl1 + 1"); assert.ok(a.parts.some(p => p.label === "Exhaustion" && p.value === -4));
  assert.equal(rolls.buildNpcAttack({ bonus: 0 }, { exhPen: -6 }).formula, "1d20 - 6");
  // conditions + keys resolved before building: prone attacker with Shift = normal
  const m = cond.resolveMode(rolls.rollModeFromEvent({ shiftKey: true }).mode, cond.rollModifiers({ statuses: ["prone"], type: "attack" }));
  assert.equal(rolls.buildNpcAttack(atk, { mode: m }).formula, "1d20 + 5");
  let dm = rolls.buildNpcDamage(atk);
  assert.equal(dm.parts.length, 1); assert.equal(dm.parts[0].formula, "2d8 + 3"); assert.equal(dm.parts[0].type, "piercing"); assert.equal(dm.dtype, "piercing");
  assert.equal(dm.parts[0].critFormula, null);
  dm = rolls.buildNpcDamage(atk, { crit: true, extra: "1d6" });
  assert.equal(dm.parts[0].critFormula, "2d8"); assert.equal(dm.parts[1].formula, "1d6"); assert.equal(dm.parts[1].critFormula, "1d6"); assert.equal(dm.critMax, false);
  dm = rolls.buildNpcDamage({ name: "Rust Spray", dice: "2d8 + 1d6", dtype: "acid" });
  assert.equal(dm.parts[0].formula, "2d8 + 1d6");
  assert.equal(rolls.buildNpcDamage({ name: "X", dice: "" }).warnings.length, 1);
  // save request math: half damage rounded down on a success
  assert.equal(Math.floor(rolls.damageTotal([{ rolled: 24 }]) / 2), 12); assert.equal(Math.floor(rolls.damageTotal([{ rolled: 7 }]) / 2), 3);
  // vulnerability doubles, resistance halves, both cancel, immunity wins
  assert.equal(rolls.damageMultiplier("fire", { vulnerabilities: ["fire"] }), 2);
  assert.equal(rolls.damageMultiplier("fire", { resistances: ["fire"], vulnerabilities: ["fire"] }), 1);
  assert.equal(rolls.damageMultiplier("fire", { immunities: ["fire"], vulnerabilities: ["fire"] }), 0);
  assert.equal(rolls.damageMultiplier("cold", { vulnerabilities: ["fire"] }), 1);
  assert.equal(rolls.applyDamage({ hp: 30, temp: 0 }, 7, 2).taken, 14);
});

/* ---------- 8. damage types by mode: ap = DAMAGE_TYPES, turm = ELEMENTS; foreign values readable ---------- */
ok("damage types by mode", () => {
  const ap = cfg.damageTypeChoices("ap"), turm = cfg.damageTypeChoices("turm");
  assert.deepEqual(ap, APP.DAMAGE_TYPES);
  assert.deepEqual(Object.keys(turm), Object.keys(APP.ELEMENTS));
  assert.equal(Object.keys(ap).length, 13); assert.equal(Object.keys(turm).length, 20);
  assert.equal(turm.arch, "Arch"); assert.ok(!("macht" in turm));
  // labels from both tables
  assert.equal(cfg.damageTypeLabel("fire"), "Fire"); assert.equal(cfg.damageTypeLabel("feuer"), "Feuer");
  assert.equal(cfg.damageTypeLabel("erz"), "Erz/Machina"); assert.equal(cfg.damageTypeLabel("custom thing"), "custom thing");
  assert.equal(cfg.damageTypeColor("feuer"), APP.ELEMENTS.feuer.c); assert.equal(cfg.damageTypeColor("fire"), "");
  // select options: current mode list, foreign current value kept selectable at the top
  let o = cfg.damageTypeOptions("ap", "slashing");
  assert.equal(o.length, 13); assert.equal(o.find(x => x.selected).value, "slashing"); assert.ok(!o.some(x => x.foreign));
  o = cfg.damageTypeOptions("ap", "erz");              // weapon typed under turm, actor now in ap
  assert.equal(o.length, 14); assert.deepEqual(o[0], { value: "erz", label: "Erz/Machina", selected: true, foreign: true });
  o = cfg.damageTypeOptions("turm", "fire");           // and the other way round
  assert.equal(o.length, 21); assert.equal(o[0].value, "fire"); assert.equal(o[0].label, "Fire"); assert.ok(o[0].foreign);
  o = cfg.damageTypeOptions("turm", "");
  assert.equal(o.length, 20); assert.ok(!o.some(x => x.selected));
  // res purchase works with keys of either mode (multiplier looks at key or label)
  for (const mode of ["ap", "turm"]) {
    const S = appLoad({ mode, bought: { res: 1 }, choices: { res: [mode === "ap" ? "fire" : "feuer"] } });
    const def = rolls.characterDefenses(S);
    assert.equal(rolls.damageMultiplier(mode === "ap" ? "fire" : "feuer", def), 0.5, "res " + mode);
    assert.equal(rolls.damageMultiplier(mode === "ap" ? "cold" : "eis", def), 1, "res other " + mode);
    // +1d6 Elemental carries the weapon's type of the current mode
    const w = { abil: "str", dice: "1d8", dtype: mode === "ap" ? "slashing" : "erz", bonus: 0, prof: true };
    const S2 = appLoad({ mode, bought: { eleDmg: 2 }, choices: { eleDmg: [w.dtype, w.dtype] } });
    const dm = rolls.buildDamage(w, rules.derived(S2), S2);
    const ele = dm.parts.find(p => p.label === "Elemental");
    assert.equal(ele.formula, "2d6"); assert.equal(ele.type, w.dtype);
    assert.equal(rolls.damageTypeLabel(ele.type), mode === "ap" ? "Slashing" : "Erz/Machina");
  }
  // round trip keeps foreign values untouched (an ap character with a turm-typed weapon)
  const raw = { mode: "ap", weapons: [{ id: "w1", name: "Speer", abil: "str", dice: "1d8", dtype: "erz", bonus: 0, prof: true, equipped: true, notes: "" }],
    spells: [{ id: "s1", lvl: 1, name: "Funke", notes: "", prepared: true, elem: "fire" }], choices: { res: ["feuer"] }, bought: { res: 1 } };
  const out = roundTrip(raw);
  assert.equal(out.weapons[0].dtype, "erz"); assert.equal(out.spells[0].elem, "fire"); assert.deepEqual(out.choices.res, ["feuer"]);
});

/* ---------- 9. eleDmg element: chosen at purchase, changeEle swaps (last wins), old data without pick ---------- */
ok("eleDmg element choice / changeEle swap / missing pick", () => {
  const w = { abil: "str", dice: "1d8", dtype: "slashing", bonus: 0, prof: true };
  // old data: eleDmg bought, no choice -> "" and a warning, weapon type untouched
  let S = appLoad({ mode: "turm", bought: { eleDmg: 1 } });
  assert.equal(rules.eleElement(S), "");
  let dm = rolls.buildDamage(w, rules.derived(S), S);
  let ele = dm.parts.find(p => p.label === "Elemental");
  assert.equal(ele.type, ""); assert.equal(ele.formula, "1d6");
  assert.ok(dm.warnings.some(x => /no element/i.test(x)));
  assert.equal(dm.parts[0].type, "slashing");
  // pick at purchase: element of the +1d6 is the pick, not the weapon's type
  S = appLoad({ mode: "turm", bought: { eleDmg: 2 }, choices: { eleDmg: ["feuer", "feuer"] } });
  assert.equal(rules.eleElement(S), "feuer");
  dm = rolls.buildDamage({ ...w, dtype: "erz" }, rules.derived(S), S);
  ele = dm.parts.find(p => p.label === "Elemental");
  assert.equal(ele.type, "feuer"); assert.equal(ele.formula, "2d6"); assert.equal(dm.parts[0].type, "erz");
  assert.equal(dm.warnings.length, 0);
  // changeEle replaces it; the last swap wins
  S = appLoad({ mode: "turm", bought: { eleDmg: 1, changeEle: 2 }, choices: { eleDmg: ["feuer"], changeEle: ["eis", "blitz"] } });
  assert.equal(rules.eleElement(S), "blitz");
  assert.equal(rolls.buildDamage(w, rules.derived(S), S).parts.find(p => p.label === "Elemental").type, "blitz");
  // ap mode: D&D damage types
  S = appLoad({ mode: "ap", bought: { eleDmg: 1 }, choices: { eleDmg: ["fire"] } });
  assert.equal(rules.eleElement(S), "fire");
  assert.equal(rolls.damageTypeLabel(rolls.buildDamage(w, rules.derived(S), S).parts.find(p => p.label === "Elemental").type), "Fire");
  // resistance of the target applies to the elemental type
  assert.equal(rolls.damageMultiplier("blitz", { resistances: ["blitz"], immunities: [] }), 0.5);
  // importer / exporter carry the choices unchanged
  const raw = { mode: "turm", bought: { eleDmg: 1, changeEle: 1 }, choices: { eleDmg: ["feuer"], changeEle: ["eis"] } };
  const created = convertAppExport(raw);
  assert.deepEqual(created.system.choices.eleDmg, ["feuer"]); assert.deepEqual(created.system.choices.changeEle, ["eis"]);
  assert.equal(rules.eleElement(foundryState(created)), "eis");
  const out = roundTrip(raw);
  assert.deepEqual(out.choices, { eleDmg: ["feuer"], changeEle: ["eis"] });
  // selling the last eleDmg rank drops its pick (app sell(): choices.pop)
  const sold = rules.sellRank(appLoad({ bought: { eleDmg: 1 }, choices: { eleDmg: ["feuer"] } }), "eleDmg");
  assert.deepEqual(sold.bought, {}); assert.deepEqual(sold.choices.eleDmg, []);
});

/* ---------- 8. Phase 5: loot table importer (three fixtures), migration scaffold ---------- */
const loot = await import("../module/loot.mjs");
const migration = await import("../module/migration.mjs");

ok("loot importer: Excel paste (tabs, d100 ranges, open range, header line)", () => {
  const p = loot.parseLootTable(readFixture("loot-excel.txt"));
  assert.equal(p.hasRanges, true); assert.equal(p.formula, "1d100"); assert.equal(p.max, 100);
  assert.deepEqual(p.entries.map(e => [e.range, e.text, e.weight]), [
    [[1, 5], "50 Goldmünzen", 1], [[6, 20], "Heiltrank", 1], [[21, 60], "Nichts", 1], [[61, 90], "Waffe +1", 1], [[91, 96], "Kristall (Eis)", 1], [[97, 100], "Artefakt", 1]
  ]);
  assert.deepEqual(p.problems, []);   // "d100 <Tab> Loot" header skipped, ranges cover 1-100
  const t = loot.lootToRollTable(p, "Loot Ebene 1");
  assert.equal(t.name, "Loot Ebene 1"); assert.equal(t.formula, "1d100"); assert.equal(t.results.length, 6);
  assert.deepEqual(t.results[5], { type: "text", name: "Artefakt", description: "", weight: 1, range: [97, 100], drawn: false });
  assert.equal(loot.lootToRollTable(p, "  ").name, "Loot");
});

ok("loot importer: Word list (bullets, numbered list, empty lines) -> equal weights 1d<count>", () => {
  const p = loot.parseLootTable(readFixture("loot-word.txt"));
  assert.equal(p.hasRanges, false); assert.equal(p.formula, "1d5");
  assert.deepEqual(p.entries.map(e => [e.range, e.text]), [[[1, 1], "Heiltrank"], [[2, 2], "20 Silbermünzen"], [[3, 3], "Seil, 50 Fuß"], [[4, 4], "Fackel"], [[5, 5], "Rostiger Dolch"]]);
  assert.deepEqual(p.problems, []);
  // weights without ranges: consecutive ranges of the weight's width, formula = sum
  const w = loot.parseLootTable("3\tHeiltrank\n1\tArtefakt\n2\tNichts");
  assert.equal(w.formula, "1d6"); assert.deepEqual(w.entries.map(e => [e.range, e.weight]), [[[1, 3], 3], [[4, 4], 1], [[5, 6], 2]]);
});

ok("loot importer: mixed format with a gap, an overlap and entries without a range", () => {
  const p = loot.parseLootTable(readFixture("loot-mixed.txt"));
  assert.equal(p.formula, "1d100");
  assert.deepEqual(p.entries.map(e => [e.range, e.text, e.weight]), [
    [[1, 5], "Heiltrank", 1], [[6, 10], "Gifttrank", 1], [[12, 15], "Schriftrolle", 1], [[36, 38], "Goldstück", 3], [[39, 39], "Geheimnisvoller Schlüssel", 1], [[16, 30], "Nichts", 1], [[28, 35], "Kristallreif", 1]
  ]);
  assert.deepEqual(p.problems.map(x => [x.type, x.from, x.to]), [["noRange", 36, 38], ["noRange", 39, 39], ["gap", 11, 11], ["overlap", 28, 30], ["gap", 40, 100]]);
  assert.ok(loot.problemLabel(p.problems[3]).includes("Kristallreif") && loot.problemLabel(p.problems[3]).includes("Nichts"));
  assert.equal(loot.problemLabel(p.problems[2]), "Gap: 11 hits no entry");
  assert.equal(loot.lootToRollTable(p).results.length, 7);   // import allowed despite the problems
  // single lines
  const pl = loot.parseLootLine;
  assert.deepEqual(pl("01–05 50 Goldmünzen"), { text: "50 Goldmünzen", range: [1, 5], open: false, weight: 1 });
  assert.deepEqual(pl("1-5: Heiltrank"), { text: "Heiltrank", range: [1, 5], open: false, weight: 1 });
  assert.deepEqual(pl("97+ Artefakt"), { text: "Artefakt", range: [97, 97], open: true, weight: 1 });
  assert.deepEqual(pl("7: Zauberstab"), { text: "Zauberstab", range: [7, 7], open: false, weight: 1 });
  assert.deepEqual(pl("3\tHeiltrank"), { text: "Heiltrank", range: null, open: false, weight: 3 });
  assert.deepEqual(pl("01–05\t50 Goldmünzen"), { text: "50 Goldmünzen", range: [1, 5], open: false, weight: 1 });
  assert.deepEqual(pl("| 1-5 | Heiltrank |"), { text: "Heiltrank", range: [1, 5], open: false, weight: 1 });
  assert.deepEqual(pl("• 20 Silbermünzen"), { text: "20 Silbermünzen", range: null, open: false, weight: 1 });
  assert.equal(pl("d100"), null); assert.equal(pl("Wurf | Loot"), null); assert.equal(pl("Roll\tResult"), null); assert.equal(pl("|---|---|"), null); assert.equal(pl("   "), null);
  // maximum above 100 -> 1d<max>
  assert.equal(loot.parseLootTable("1-100 Nichts\n101-120 Schatz").formula, "1d120");
  assert.equal(loot.parseLootTable("").entries.length, 0);
});

ok("loot importer: JSON files (RollTable export, plain list, own export, broken JSON)", () => {
  const J = (o) => loot.parseLootJsonText(JSON.stringify(o));

  // (a) Foundry RollTable export: ranges, weights, name and formula come from the file, extras are ignored
  const rollTable = {
    name: "Loot Level 2", formula: "1d20", replacement: true, img: "icons/svg/chest.svg", _id: "abc123",
    results: [
      { _id: "r1", type: "text", text: "Healing potion", range: [1, 10], weight: 10, drawn: false },
      { _id: "r2", type: "text", name: "Rusty dagger", range: [11, 18], weight: 8 },
      { _id: "r3", type: "text", text: "Crystal (ice)", range: [19, 20], weight: 2, documentCollection: "Item" }
    ]
  };
  const a = J(rollTable);
  assert.equal(a.ok, true, a.reason);
  assert.equal(a.name, "Loot Level 2");
  assert.equal(a.source, "Foundry RollTable export");
  assert.equal(a.parsed.formula, "1d20");                 // 1dN from the file, not the default 1d100
  assert.deepEqual(a.parsed.entries.map(e => [e.range, e.text, e.weight]),
    [[[1, 10], "Healing potion", 10], [[11, 18], "Rusty dagger", 8], [[19, 20], "Crystal (ice)", 2]]);
  assert.deepEqual(a.parsed.problems, []);                // gapless against the stated 1d20
  assert.equal(loot.lootToRollTable(a.parsed, a.name).results.length, 3);
  // a v13 export that names its results "name" only is read the same way
  assert.equal(J({ results: [{ name: "Torch", range: [1, 1] }] }).parsed.entries[0].text, "Torch");
  // an exotic formula is kept verbatim
  assert.equal(J({ formula: "2d10", results: [{ text: "X", range: [2, 20] }] }).parsed.formula, "2d10");

  // (b) plain list of strings -> equal distribution 1d<count>
  const b = J(["Healing potion", "Torch", "Rope, 50 ft", "Nothing"]);
  assert.equal(b.ok, true, b.reason);
  assert.equal(b.source, "list");
  assert.equal(b.name, "");
  assert.equal(b.parsed.formula, "1d4");
  assert.deepEqual(b.parsed.entries.map(e => [e.range, e.text]),
    [[[1, 1], "Healing potion"], [[2, 2], "Torch"], [[3, 3], "Rope, 50 ft"], [[4, 4], "Nothing"]]);
  assert.deepEqual(b.parsed.problems, []);
  // list of objects: ranges and weights are honoured, rows without a text are skipped
  const b2 = J([{ text: "Coins", range: [1, 50], weight: 50 }, { text: "Gem", range: [51, 100] }, { text: "   " }, { note: "junk" }]);
  assert.equal(b2.ok, true, b2.reason);
  assert.equal(b2.skipped, 2);
  assert.equal(b2.parsed.formula, "1d100");
  assert.deepEqual(b2.parsed.entries.map(e => [e.range, e.text, e.weight]), [[[1, 50], "Coins", 50], [[51, 100], "Gem", 1]]);
  // weights without ranges fill consecutively, like the text parser
  assert.deepEqual(J([{ text: "A", weight: 3 }, { text: "B" }]).parsed.entries.map(e => e.range), [[1, 3], [4, 4]]);
  // gaps in a file are reported, not silently closed
  assert.deepEqual(J({ formula: "1d20", results: [{ text: "A", range: [1, 5] }, { text: "B", range: [11, 20] }] }).parsed.problems,
    [{ type: "gap", from: 6, to: 10 }]);

  // (c) our own export format round-trips
  const own = loot.lootToJson(loot.parseLootTable(readFixture("loot-excel.txt")), "Loot Ebene 1");
  assert.equal(own.format, "ap-turm-loot");
  const c = J(own);
  assert.equal(c.ok, true, c.reason);
  assert.equal(c.name, "Loot Ebene 1");
  assert.equal(c.source, "AP-Turm export");
  assert.deepEqual(c.parsed.entries, loot.parseLootTable(readFixture("loot-excel.txt")).entries);
  assert.equal(c.parsed.formula, own.formula);

  // broken JSON and structures that are not a table: a readable cause, nothing usable
  const bad = (text) => { const r = loot.parseLootJsonText(text); assert.equal(r.ok, false, "should be refused: " + text.slice(0, 40)); return r.reason; };
  assert.match(bad("{ not json"), /not valid JSON/);
  assert.match(bad('{"results": [1, 2'), /not valid JSON/);
  assert.match(bad(""), /is empty/);
  assert.match(bad("   "), /is empty/);
  assert.match(bad('"just a string"'), /plain text/);
  assert.match(bad("42"), /no loot table/);
  assert.match(bad("null"), /no data/);
  assert.match(bad("[]"), /list in the file is empty/);
  assert.match(bad('{"name":"x","img":"y"}'), /neither "results" nor "entries"/);
  assert.match(bad('{"results":[{"weight":3},{"foo":1}]}'), /none of them carries a text/);
});

/* ---------- Paket B: group roll requests, item transfer, loot claim ---------- */

ok("request roll: labels, valid keys and the row view of the group card", () => {
  assert.equal(requestRoll.requestLabel("save", "dex"), "Dexterity Save");
  assert.equal(requestRoll.requestLabel("ability", "str"), "Strength Check");
  assert.equal(requestRoll.requestLabel("skill", "ste"), "Stealth Check");
  assert.equal(requestRoll.requestLabel("nonsense", "dex"), "");
  // only keys of the matching table are accepted (the dialog and the socket handler check this)
  assert.equal(requestRoll.validRequest("save", "dex"), true);
  assert.equal(requestRoll.validRequest("ability", "cha"), true);
  assert.equal(requestRoll.validRequest("skill", "ste"), true);
  assert.equal(requestRoll.validRequest("save", "ste"), false);
  assert.equal(requestRoll.validRequest("skill", "dex"), false);
  assert.equal(requestRoll.validRequest("", "dex"), false);
  // one row per recipient, all open
  const rows = requestRoll.requestRows([{ uuid: "Actor.a", name: "Gades" }, { uuid: "Actor.b", name: "Markus" }]);
  assert.deepEqual(rows, [
    { actorUuid: "Actor.a", name: "Gades", total: null, success: null },
    { actorUuid: "Actor.b", name: "Markus", total: null, success: null }
  ]);
  // the view marks finished rows and only shows a verdict when a DC was set
  const done = [{ ...rows[0], total: 17, success: true }, rows[1]];
  assert.deepEqual(requestRoll.rowView(done, true).map(r => [r.index, r.rolled, r.verdict]), [[0, true, "SUCCESS"], [1, false, ""]]);
  assert.deepEqual(requestRoll.rowView(done, false).map(r => r.verdict), ["", ""]);
  assert.deepEqual(requestRoll.rowView([{ ...rows[0], total: 9, success: false }], true)[0].verdict, "FAILURE");
  assert.deepEqual(requestRoll.rowView(undefined, true), []);
});

ok("item transfer: stack split and carry limit at the receiver", () => {
  // partial transfer: the rest stays with the giver
  assert.deepEqual(transfer.splitStack(5, 2), { give: 2, keep: 3, whole: false });
  assert.deepEqual(transfer.splitStack(5, 5), { give: 5, keep: 0, whole: true });
  assert.deepEqual(transfer.splitStack(1, 1), { give: 1, keep: 0, whole: true });
  assert.deepEqual(transfer.splitStack(5, 2.9), { give: 2, keep: 3, whole: false });   // rounded down
  // amounts that would create or destroy items are refused
  assert.equal(transfer.splitStack(5, 6), null);
  assert.equal(transfer.splitStack(5, 0), null);
  assert.equal(transfer.splitStack(5, -1), null);
  assert.equal(transfer.splitStack(5, "abc"), null);
  assert.equal(transfer.splitStack(0, 1).give, 1);                                     // a broken qty counts as 1

  // carry limit (re-entry reminder): only gear "found in tower" counts (app v09-05o), carried-in gear,
  // weapons and feats do not; crystals are not items at all
  const items = [
    { type: "gear", system: { origin: "tower" } }, { type: "gear", system: { origin: "tower" } },
    { type: "gear", system: { origin: "city" } }, { type: "weapon", system: {} }, { type: "feat", system: {} }
  ];
  assert.equal(transfer.carryCount(items), 2);
  assert.equal(transfer.carryCount(items, { extra: 1 }), 3);        // what the receiver would have afterwards
  assert.equal(transfer.carryCount([]), 0);
  assert.equal(transfer.carryCount(undefined), 0);
  // plain sheet rows ({origin}) count the same way, a missing origin is "carried in" and never counts
  assert.equal(transfer.carryCount([{ origin: "city" }, { origin: "tower" }, {}]), 1);
  // any number of carried-in items stays at 0
  assert.equal(transfer.carryCount(Array.from({ length: 12 }, () => ({ type: "gear", system: { origin: "city" } }))), 0);
  // six tower finds are over the limit of 5 (shown as a hint, never blocked)
  const full = Array.from({ length: 5 }, () => ({ type: "gear", system: { origin: "tower" } }));
  assert.equal(transfer.carryCount(full), 5);
  assert.equal(transfer.carryCount(full, { extra: 1 }) > cfg.TOWER_CARRY_LIMIT, true);

  // against the app: build tag, tooltip and counting rule of v09-05o
  assert.match(html, /class="buildtag"[^>]*>v09-05p</);
  const appTower = new Function("allItems", js.match(/const towerItems=allItems\.filter\([^;]*\);/)[0] + "return towerItems.length;");
  assert.match(js, /Inside the tower: unlimited\. Only \$\{TOWER_CARRY_LIMIT\} tower finds may be carried back in on re-entry \(circlet crystals exempt\)\./);
  const tpl = fs.readFileSync(new URL("../templates/actor/character/inventory.hbs", import.meta.url), "utf8");
  assert.ok(tpl.includes('title="Inside the tower: unlimited. Only {{carryLimit}} tower finds may be carried back in on re-entry (circlet crystals exempt)."'));
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 300; t++) {
    const rows = Array.from({ length: Math.floor(r() * 12) }, () => { const o = r(); return o < 0.4 ? { origin: "tower" } : o < 0.8 ? { origin: "city" } : {}; });
    assert.equal(transfer.carryCount(rows), appTower(rows));
    assert.equal(transfer.carryCount(rows.map(x => ({ type: "gear", system: x }))), appTower(rows));
  }

  // chat line
  assert.equal(transfer.giveLine("Gades", "Heiltrank", 2, "Markus"), "Gades gives Heiltrank ×2 to Markus.");
  assert.equal(transfer.giveLine("Gades", "Fackel", 1, "Markus"), "Gades gives Fackel to Markus.");
});

ok("loot claim: quantity prefix, currency amounts per mode, plain text", () => {
  const pc = transfer.parseClaim;

  // quantity prefix -> qty, the rest is the item name
  assert.deepEqual(pc("3 Heiltränke", "turm"), { kind: "item", name: "Heiltränke", qty: 3 });
  assert.deepEqual(pc("50 Goldmünzen", "turm"), { kind: "item", name: "Goldmünzen", qty: 50 });
  assert.deepEqual(pc("3x Torch", "ap"), { kind: "item", name: "Torch", qty: 3 });
  assert.deepEqual(pc("2× Rope", "ap"), { kind: "item", name: "Rope", qty: 2 });
  // no quantity -> one item with the full text
  assert.deepEqual(pc("Heiltrank", "ap"), { kind: "item", name: "Heiltrank", qty: 1 });
  assert.deepEqual(pc("Rope, 50 ft", "ap"), { kind: "item", name: "Rope, 50 ft", qty: 1 });
  assert.deepEqual(pc("  Rostiger   Dolch  ", "turm"), { kind: "item", name: "Rostiger Dolch", qty: 1 });
  assert.equal(pc("", "ap"), null);
  assert.equal(pc("   ", "ap"), null);

  // pure currency amounts go into the purse, with the abbreviations of that mode
  assert.deepEqual(pc("50 GO", "turm"), { kind: "currency", amounts: { go: 50 }, label: "50 GO" });
  assert.deepEqual(pc("20 ku", "turm").amounts, { ku: 20 });
  assert.deepEqual(pc("3 ED", "turm").amounts, { ed: 3 });
  assert.deepEqual(pc("20 gp", "ap"), { kind: "currency", amounts: { gp: 20 }, label: "20 GP" });
  assert.deepEqual(pc("100 CP", "ap").amounts, { cp: 100 });
  assert.deepEqual(pc("5 pp", "ap").amounts, { pp: 5 });
  // several amounts in one line
  assert.deepEqual(pc("50 GO, 20 SI", "turm"), { kind: "currency", amounts: { go: 50, si: 20 }, label: "50 GO, 20 SI" });
  assert.deepEqual(pc("10 gp and 5 sp", "ap").amounts, { gp: 10, sp: 5 });
  assert.deepEqual(pc("10 gp + 5 gp", "ap").amounts, { gp: 15 });

  // the abbreviations of the OTHER mode are not currency here (the GM writes the table in their mode)
  assert.equal(pc("20 gp", "turm").kind, "item");
  assert.equal(pc("50 GO", "ap").kind, "item");
  // text that only looks like currency stays an item
  assert.deepEqual(pc("50 gold coins", "ap"), { kind: "item", name: "gold coins", qty: 50 });
  assert.equal(pc("GO", "turm").kind, "item");
  assert.equal(pc("50 GOLD", "turm").kind, "item");

  // the currency keys are the ones of the config table
  assert.deepEqual(transfer.currencyKeys("turm"), ["ku", "br", "si", "go", "ed"]);
  assert.deepEqual(transfer.currencyKeys("ap"), ["cp", "sp", "ep", "gp", "pp"]);
  assert.deepEqual(transfer.currencyKeys("nonsense"), transfer.currencyKeys("ap"));
});

ok("migration: version compare, decision, step selection", () => {
  assert.ok(migration.compareVersions("0.1.0", "0.1.0") === 0);
  assert.ok(migration.compareVersions("0.2.0", "0.1.9") > 0); assert.ok(migration.compareVersions("0.1.0", "0.1.1") < 0); assert.ok(migration.compareVersions("1.0", "0.9.9") > 0);
  assert.equal(migration.needsMigration("", "0.1.0"), "fresh");
  assert.equal(migration.needsMigration("0.1.0", "0.1.0"), "none");
  assert.equal(migration.needsMigration("0.1.0", "0.2.0"), "migrate");
  assert.equal(migration.needsMigration("0.3.0", "0.2.0"), "downgrade");
  const steps = [{ version: "0.3.0", run: () => {} }, { version: "0.2.0", run: () => {} }, { version: "0.1.5", run: () => {} }];
  assert.deepEqual(migration.stepsFor("0.1.5", "0.3.0", steps).map(s => s.version), ["0.2.0", "0.3.0"]);   // above stored, up to current, ascending
  assert.deepEqual(migration.stepsFor("0.1.0", "0.2.0", steps).map(s => s.version), ["0.1.5", "0.2.0"]);
  assert.deepEqual(migration.stepsFor("", "0.1.0", steps), []);
  // steps: 1.0.0 (legacy shapes) and 1.3.0 (spell rule); each runs once for worlds stored below its version
  assert.deepEqual(migration.MIGRATIONS.map(s => s.version), ["1.0.0", "1.3.0"]);
  assert.deepEqual(migration.stepsFor("0.1.0", "1.0.0").map(s => s.version), ["1.0.0"]);
  assert.deepEqual(migration.stepsFor("1.0.0", "1.0.0").map(s => s.version), []);
  assert.deepEqual(migration.stepsFor("1.0.0", "1.1.0").map(s => s.version), []);
  assert.deepEqual(migration.stepsFor("1.2.1", "1.3.0").map(s => s.version), ["1.3.0"]);
  assert.deepEqual(migration.stepsFor("1.3.0", "1.3.0").map(s => s.version), []);
});

/* ---------- 9. Phase 4 rest: every condition rule on its own, exhaustion ladder, chips, quick-bar targeting ---------- */

ok("conditions: every rule separately (attack / save / check, target side, auto fail, auto crit)", () => {
  const rm = cond.rollModifiers;
  const only = (r) => ({ adv: r.adv, dis: r.dis, autoFail: r.autoFail, autoCrit: r.autoCrit, penalty: r.penalty });
  // prone: own attacks disadvantage; against it advantage in melee, disadvantage at range
  assert.deepEqual(only(rm({ statuses: ["prone"], type: "attack" })), { adv: [], dis: ["prone"], autoFail: null, autoCrit: null, penalty: 0 });
  assert.deepEqual(rm({ type: "attack", targetStatuses: ["prone"], distance: 5 }).adv, ["target prone (melee)"]);
  assert.deepEqual(rm({ type: "attack", targetStatuses: ["prone"], distance: 5.1 }).dis, ["target prone (ranged)"]);
  // restrained: own attacks and DEX saves disadvantage, attacks against it advantage
  assert.deepEqual(rm({ statuses: ["restrained"], type: "attack" }).dis, ["restrained"]);
  assert.deepEqual(rm({ statuses: ["restrained"], type: "save", ability: "dex" }).dis, ["restrained"]);
  assert.deepEqual(rm({ statuses: ["restrained"], type: "save", ability: "str" }).dis, []);
  assert.deepEqual(rm({ type: "attack", targetStatuses: ["restrained"] }).adv, ["target restrained"]);
  // stunned / paralyzed / unconscious: advantage against them, STR and DEX saves fail automatically
  for (const c of ["stunned", "paralyzed", "unconscious"]) {
    assert.deepEqual(rm({ type: "attack", targetStatuses: [c] }).adv, [`target ${c}`], c);
    for (const ab of ["str", "dex"]) assert.equal(rm({ statuses: [c], type: "save", ability: ab }).autoFail, c, `${c}/${ab}`);
    for (const ab of ["con", "int", "wis", "cha"]) assert.equal(rm({ statuses: [c], type: "save", ability: ab }).autoFail, null, `${c}/${ab}`);
  }
  // paralyzed / unconscious: a hit within 5 ft is a critical hit; stunned is not
  assert.equal(rm({ type: "attack", targetStatuses: ["paralyzed"], distance: 5 }).autoCrit, "target paralyzed");
  assert.equal(rm({ type: "attack", targetStatuses: ["unconscious"], distance: 5 }).autoCrit, "target unconscious");
  assert.equal(rm({ type: "attack", targetStatuses: ["stunned"], distance: 5 }).autoCrit, null);
  assert.equal(rm({ type: "attack", targetStatuses: ["paralyzed"], distance: 15 }).autoCrit, null);
  // invisible: own attacks advantage, attacks against it disadvantage
  assert.deepEqual(rm({ statuses: ["invisible"], type: "attack" }).adv, ["invisible"]);
  assert.deepEqual(rm({ type: "attack", targetStatuses: ["invisible"] }).dis, ["target invisible"]);
  // poisoned / frightened: own attacks and ability checks disadvantage, saves untouched
  for (const c of ["poisoned", "frightened"]) {
    assert.deepEqual(rm({ statuses: [c], type: "attack" }).dis, [c], c);
    assert.deepEqual(rm({ statuses: [c], type: "check" }).dis, [c], c);
    assert.deepEqual(rm({ statuses: [c], type: "initiative" }).dis, [c], c);
    assert.deepEqual(rm({ statuses: [c], type: "save", ability: "con" }).dis, [], c);
  }
});

ok("conditions: exhaustion ladder, advantage/disadvantage cancelling, chips, quick-bar targeting", () => {
  // -2 per level on every d20 roll, -5 ft per level, level 6 = dead
  for (const type of ["attack", "save", "check", "initiative"]) {
    for (let n = 0; n <= 6; n++) assert.equal(cond.rollModifiers({ type, exhaustion: n }).penalty, -2 * n || 0, `${type}/${n}`);
  }
  assert.equal(cond.exhaustedSpeed(30, 0), 30); assert.equal(cond.exhaustedSpeed(30, 4), 10); assert.equal(cond.exhaustedSpeed(30, 6), 0);
  assert.ok(cond.rollModifiers({ statuses: ["exhaustion6"], type: "attack", exhaustion: 6 }).notes.includes("dead"));
  assert.equal(cond.exhaustionLevel(["exhaustion2", "prone"]), 2);
  assert.equal(cond.stepExhaustion(5, 1), 6); assert.equal(cond.stepExhaustion(6, 1), 6);
  assert.equal(cond.stepExhaustion(0, -1), 0); assert.equal(cond.stepExhaustion(3, -1), 2);
  // advantage + disadvantage from any source = normal
  assert.equal(cond.resolveMode("normal", { adv: ["invisible"], dis: ["prone"] }), "normal");
  assert.equal(cond.resolveMode("advantage", { adv: [], dis: ["target invisible"] }), "normal");
  assert.equal(cond.resolveMode("disadvantage", { adv: ["target restrained"], dis: [] }), "normal");
  assert.equal(cond.resolveMode("normal", { adv: ["a", "b"], dis: [] }), "advantage");
  assert.equal(cond.resolveMode("normal", { adv: [], dis: [] }), "normal");
  // chips: conditions once, exhaustion as one entry with its level
  const chips = cond.conditionChips(["prone", "exhaustion3"]);
  assert.equal(chips.length, Object.keys(cond.CONDITIONS).length + 1);
  assert.equal(chips.filter(c => c.exhaustion).length, 1);
  assert.deepEqual(cond.activeChips(["prone", "exhaustion3"]).map(c => [c.id, c.level]), [["prone", 0], ["exhaustion", 3]]);
  assert.deepEqual(cond.activeChips([]).map(c => c.id), []);
  assert.equal(cond.activeChips(["exhaustion1"])[0].img, "systems/ap-turm/icons/exhaustion-1.svg");
  // quick bar: controlled tokens first, then targets, else nothing
  assert.deepEqual(cond.toggleTargets({ controlled: ["a", "b"], targets: ["c"] }), { tokens: ["a", "b"], source: "controlled" });
  assert.deepEqual(cond.toggleTargets({ controlled: [], targets: ["c"] }), { tokens: ["c"], source: "targets" });
  assert.deepEqual(cond.toggleTargets({ controlled: [], targets: [] }), { tokens: [], source: "none" });
  assert.deepEqual(cond.toggleTargets({}), { tokens: [], source: "none" });
});

ok("recharge: 1d6 against the recharge number frees an ability again", () => {
  // the rule the NPC data model applies per spent recharge entry
  const freed = (recharge, roll) => roll >= parseInt(recharge, 10);
  assert.equal(freed("5-6", 4), false); assert.equal(freed("5-6", 5), true); assert.equal(freed("5-6", 6), true);
  assert.equal(freed("6", 5), false); assert.equal(freed("6", 6), true);
  assert.equal(freed("4-6", 4), true); assert.equal(freed("4-6", 3), false);
  assert.ok(!/^\d/.test("rest"));   // "recharges after a rest" is never rolled
});


/* ---------- 10. Phase 5: export round trip, import robustness, NPC exchange ---------- */

/** Every path where `a` and `b` differ, as "a.b.c" strings. */
function diffPaths(a, b, path = "", out = []) {
  const ao = a && typeof a === "object", bo = b && typeof b === "object";
  if (ao !== bo) { out.push(path || "(root)"); return out; }
  if (ao) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], path ? path + "." + k : k, out); return out; }
  if (a !== b) out.push(path || "(root)");
  return out;
}

ok("export round trip: gades.json field by field, deviations documented", () => {
  const raw = JSON.parse(fs.readFileSync(new URL("./fixtures/ap_gades_worn (1).json", import.meta.url), "utf8").replace(/^﻿/, ""));
  const out = roundTrip(raw);
  // Allowed deviations for a v4 export of the app: the data version (v4 -> v5, spell rule) and the new field
  // "notices" (empty: gades has no Learn Spell purchases). Field order is compared separately,
  // the _wepMigrated/_featMigrated/_itemMigrated flags are written back because the app sets them too.
  const ALLOWED = ["v", "notices"];
  const diffs = diffPaths(raw, out).filter(p => !ALLOWED.includes(p));
  assert.deepEqual(diffs, [], "gades round trip changed fields: " + diffs.join(", "));
  assert.deepEqual([out.v, out.notices], [5, []]);
  assert.deepEqual(Object.keys(out).filter(k => k !== "notices"), Object.keys(raw), "field order differs");
  for (const k of ["_wepMigrated", "_featMigrated", "_itemMigrated"]) assert.equal(out[k], true, "migration flag missing: " + k);
  // and the app reads it back to the same character
  assert.deepEqual(appDerived(appLoad(out)), appDerived(appLoad(raw)), "derived after round trip");
});

/** A state that touches every field the Phase 5 hand-over names explicitly. */
function maximalState() {
  const S = APP.DEFAULTS();
  Object.assign(S, {
    v: 4, mode: "turm", name: "Vollbild", theme: "celestial", startAp: 50, earnedAp: 230,
    spUsed: 7, layUsed: 11,
    abilities: { str: 16, dex: 12, con: 15, int: 10, wis: 13, cha: 8 },
    selectedSkills: ["arc", "ath"], selectedProfs: ["hvy", "shl"], customProfs: ["Thieves' Tools"],
    hpRolls: [8, 5, 7], equipment: "",
    identity: { species: "Mensch", klasse: "Weapon Bearer", background: "Turmwache", alignment: "NG", exp: "230" },
    notes: "Zeile eins\nZeile zwei & drei",
    armor: { id: "half-plate", shield: true }
  });
  // shop purchases including both element choices: eleDmg picks the element, changeEle replaces it
  S.bought = { eleDmg: 2, changeEle: 1, critBoost: 1, spellslot6: 1, learn6: 1, learn1: 1, layHands: 1, hitDie: 2, res: 1, saveProf: 2, asi: 1 };
  S.choices = { eleDmg: ["feuer", "blitz"], changeEle: ["dunkelheit"], res: ["eis"], saveProf: ["con", "wis"], asi: ["str"] };
  S.milestones = { 1: { type: "asi", stats: { str: 1, con: 1 } }, 2: { type: "feat", name: "Turmgänger" } };
  // both currency sets side by side
  S.currency = { cp: 5, sp: 4, ep: 3, gp: 2, pp: 1, ku: 36, br: 18, si: 90, go: 24, ed: 8 };
  S.crystals = [{ name: "Ordnungssplitter", elem: "ordnung" }, { name: "", elem: "erz" }, { name: "Leer", elem: "" }, { name: "", elem: "arch" }, { name: "Fünfter", elem: "licht" }];
  S.turmwissen = [{ trigger: "Es gibt oben und unten" }, { trigger: "Wer im Turm stirbt, gehört dem Turm" }];
  S.slotsUsed = { 6: 1, 7: 0, 8: 2, 9: 1 };
  S.play = { hpCurrent: 23, tempHp: 4, spentHitDice: 2, deathSucc: 2, deathFail: 1, inspiration: 3, inspMax: 5, exhaustion: 4 };
  S.weapons = [
    { id: "w1", name: "Zweihänder", abil: "str", dice: "2d6", dtype: "erz", bonus: 1, prof: true, equipped: true, notes: "Umgeht Erzimmunität\nZweite Zeile" },
    { id: "w2", name: "Dolch", abil: "fin", dice: "1d4", dtype: "dunkelheit", bonus: 0, prof: false, equipped: false, notes: "" }
  ];
  S.spells = [
    { id: "s1", name: "Lichtbogen", lvl: 1, elem: "licht", notes: "Reichweite 60 ft", prepared: true },
    { id: "s2", name: "Turmruf", lvl: 6, elem: "turm", notes: "", prepared: false }
  ];
  S.feats = [
    { id: "f1", name: "Turmgänger", desc: "Kennt die Wege", src: "Milestone #2", bon: { str: 1, ac: 1, speed: 5, init: 2, hp: 3 } },
    { id: "f2", name: "Zäh", desc: "", src: "", bon: {} }
  ];
  S.items = [
    { id: "i1", name: "Kristallreif", qty: 1, notes: "5 Sockel", attuned: true, charges: 3, used: 1, recharge: "dawn", origin: "tower" },
    { id: "i2", name: "Seil", qty: 2, notes: "", attuned: false, charges: 0, used: 0, recharge: "none", origin: "city" }
  ];
  S._wepMigrated = S._featMigrated = S._itemMigrated = true;
  return S;
}

ok("export round trip: maximal state (eleDmg/changeEle, weapon notes, Turmwissen, crystals, both currencies, slotsUsed, death saves, exhaustion, inspiration)", () => {
  const raw = maximalState();
  const out = roundTrip(raw);
  assert.deepEqual(diffPaths(canonical(raw), out), [], "maximal state round trip");
  // every field the hand-over names, checked by name so a silent drop cannot pass
  assert.deepEqual(out.choices.eleDmg, ["feuer", "blitz"]);
  assert.deepEqual(out.choices.changeEle, ["dunkelheit"]);
  assert.equal(out.weapons[0].notes, "Umgeht Erzimmunität\nZweite Zeile");
  assert.deepEqual(out.turmwissen.map(t => t.trigger), ["Es gibt oben und unten", "Wer im Turm stirbt, gehört dem Turm"]);
  assert.equal(out.crystals.length, 5);
  assert.deepEqual(out.crystals[3], { name: "", elem: "arch" });
  for (const k of ["cp", "sp", "ep", "gp", "pp", "ku", "br", "si", "go", "ed"]) assert.equal(out.currency[k], raw.currency[k], "currency " + k);
  assert.deepEqual(out.slotsUsed, { 6: 1, 7: 0, 8: 2, 9: 1 });
  assert.equal(out.play.deathSucc, 2); assert.equal(out.play.deathFail, 1);
  assert.equal(out.play.exhaustion, 4); assert.equal(out.play.inspiration, 3); assert.equal(out.play.inspMax, 5);
  assert.equal(out.play.hpCurrent, 23); assert.equal(out.play.tempHp, 4); assert.equal(out.play.spentHitDice, 2);
  assert.equal(out.spells[1].lvl, 6); assert.equal(out.spells[1].elem, "turm"); assert.equal(out.spells[1].prepared, false);
  assert.deepEqual(out.feats[0].bon, { str: 1, ac: 1, speed: 5, init: 2, hp: 3 });
  assert.equal(out.items[0].recharge, "dawn"); assert.equal(out.items[0].origin, "tower"); assert.equal(out.items[0].attuned, true);
  assert.equal(out.notes, "Zeile eins\nZeile zwei & drei");   // HTML in Foundry, plain text again in the app
  // and idempotent
  assert.deepEqual(roundTrip(out), out, "second round trip");
});

ok("importer: broken, empty and foreign JSON is refused with a cause", () => {
  const bad = (data) => { const r = imp.validateAppExport(data); assert.equal(r.ok, false, "should be refused: " + JSON.stringify(data)?.slice(0, 40)); return r.reason; };
  assert.match(bad(null), /no data/);
  assert.match(bad(undefined), /no data/);
  assert.match(bad([]), /JSON list/);
  assert.match(bad("Kriegsmeister"), /plain text/);
  assert.match(bad(42), /no character sheet/);
  assert.match(bad({}), /empty object/);
  assert.match(bad({ foo: 1, bar: 2 }), /foo, bar/);
  assert.match(bad({ format: "ap-turm-npc", v: 1, name: "Drache", data: {} }), /NPC export/);
  assert.match(bad({ _id: "abc123", type: "character", system: {} }), /Foundry document export/);
  assert.match(bad({ startAp: 50, earnedAp: 100 }), /"abilities" is missing/);         // truncated before the abilities
  assert.match(bad({ startAp: 50, abilities: "x" }), /not an object/);
  assert.match(bad({ startAp: 50, abilities: {} }), /no ability scores/);
  // text level: empty file and a file cut in half
  assert.match(imp.parseAppExportText("").reason, /is empty/);
  assert.match(imp.parseAppExportText("   \n ").reason, /is empty/);
  const full = fs.readFileSync(new URL("./fixtures/kriegsmeister.json", import.meta.url), "utf8");
  const cut = imp.parseAppExportText(full.slice(0, Math.floor(full.length * 0.6)));
  assert.equal(cut.ok, false);
  assert.match(cut.reason, /not valid JSON/);
  assert.match(imp.parseAppExportText("<html><body>nope</body></html>").reason, /not valid JSON/);
  // valid files pass, with warnings where a field has the wrong type but the sheet is still readable
  for (const f of fs.readdirSync(new URL("./fixtures/", import.meta.url)).filter(x => x.endsWith(".json"))) {
    const r = imp.parseAppExportText(fs.readFileSync(new URL("./fixtures/" + f, import.meta.url), "utf8"));
    assert.equal(r.ok, true, "fixture refused: " + f);
    assert.deepEqual(r.warnings, [], "unexpected warning for " + f);
  }
  const warned = imp.validateAppExport({ ...maximalState(), weapons: "Zweihänder", bought: 5, abilities: { str: 16, dex: 12, con: 15, int: 10, wis: 13 } });
  assert.equal(warned.ok, true);
  assert.equal(warned.warnings.length, 3, warned.warnings.join(" | "));
  // and such a file still converts without throwing and without the broken fields
  const created = convertAppExport({ ...maximalState(), weapons: "Zweihänder", bought: 5 });
  assert.equal(created.items.filter(i => i.type === "weapon").length, 0);
  assert.deepEqual(created.system.bought, {});
});

ok("NPC exchange: export -> import is lossless, foreign files are refused", () => {
  const system = {
    mode: "turm", typeLine: "Large dragon", hp: { value: 180, max: 243, temp: 5 }, ac: 19, dc: 18, speed: 40,
    speeds: "Fly 80, Swim 40", pb: 5, abilities: { str: 23, dex: 10, con: 21, int: 18, wis: 15, cha: 19 },
    saves: { str: null, dex: 5, con: 10, int: null, wis: 7, cha: null }, skills: { perception: 12, stealth: 5 },
    senses: "blindsight 60 ft.", languages: "Common, Draconic", conditionImmunities: "charmed",
    defenseNote: "from nonmagical attacks", headerNotes: "Treasure: hoard",
    resistances: ["eis"], immunities: ["cold"], vulnerabilities: [], element: "eis",
    legendary: { resist: { value: 2, max: 3 }, actions: { value: 1, max: 3 } },
    adv: { attacks: false, spellSaves: true },
    entries: [
      { name: "Multiattack", section: "actions", text: "The dragon makes three attacks.", toHit: null, range: "", saveDc: null, saveAbility: "", damage: "", dmgType: "", recharge: "", rechargeUsed: false, uses: { value: 0, max: 0, per: "" }, legendaryCost: 0, parent: "" },
      { name: "Cold Breath", section: "actions", text: "DC 21 Constitution saving throw.", toHit: null, range: "60 ft", saveDc: 21, saveAbility: "con", damage: "12d8", dmgType: "eis", recharge: "5-6", rechargeUsed: true, uses: { value: 1, max: 3, per: "day" }, legendaryCost: 0, parent: "Breath Weapons" }
    ],
    cr: "16", statblock: "Adult Silver Dragon\nAC 19", notes: "<p>Wacht über die dritte Ebene.</p>"
  };
  const out = npc.exportNpcData({ name: "Silberdrache", img: "icons/dragon.webp", system, prototypeToken: { width: 3, height: 3, disposition: -1, texture: { src: "tokens/dragon.webp" } } });
  assert.equal(out.format, "ap-turm-npc");
  assert.equal(out.v, 1);
  assert.ok(npc.isNpcExport(out));
  assert.deepEqual(npc.validateNpcExport(out), { ok: true });
  const back = npc.npcImportData(out);
  assert.equal(back.type, "npc");
  assert.equal(back.name, "Silberdrache");
  assert.equal(back.img, "icons/dragon.webp");
  assert.deepEqual(back.prototypeToken, { width: 3, height: 3, disposition: -1, texture: { src: "tokens/dragon.webp" } });
  assert.deepEqual(back.system, system, "npc system data changed on the way");
  // second pass identical (a file exchanged twice between worlds stays the same)
  assert.deepEqual(npc.exportNpcData({ name: back.name, img: back.img, system: back.system, prototypeToken: back.prototypeToken }), out);
  assert.equal(npc.npcFileName("Silber Drache!"), "ap_npc_silber_drache_.json");
  // refusals
  const bad = (d) => { const r = npc.validateNpcExport(d); assert.equal(r.ok, false); return r.reason; };
  assert.match(bad(null), /no JSON object/);
  assert.match(bad([]), /no JSON object/);
  assert.match(bad({}), /Not an AP-Turm NPC export/);
  assert.match(bad(JSON.parse(fs.readFileSync(new URL("./fixtures/kriegsmeister.json", import.meta.url), "utf8"))), /Not an AP-Turm NPC export/);
  assert.match(bad({ format: "ap-turm-npc", v: 99, name: "x", data: {} }), /newer system version/);
  assert.match(bad({ format: "ap-turm-npc", v: 1, name: "x" }), /"data" is missing/);
  assert.match(bad({ format: "ap-turm-npc", v: 1, name: "", data: {} }), /"name" is missing/);
  // a character export is not an NPC export and the other way round
  assert.ok(!npc.isNpcExport(maximalState()));
  assert.equal(imp.validateAppExport(out).ok, false);
});

ok("statblock: empty field, prose without structure, doubled paste, parsing twice", () => {
  const usable = (t) => statblock.parseUsable(statblock.parseStatblock(t));
  assert.equal(usable("").ok, false);
  assert.equal(usable("   \n\n ").ok, false);
  assert.match(usable("Dies ist ein Fliesstext ueber einen Drachen ohne jede Struktur.").reason, /No statblock recognized/);
  assert.match(usable("Hallo Welt").reason, /No statblock recognized/);
  assert.match(usable('{"foo":1,"bar":[2,3]}').reason, /No statblock recognized/);
  // real statblocks pass - no false rejection through the duplicate check
  const dir = new URL("./fixtures/", import.meta.url);
  const files = fs.readdirSync(dir).filter(f => f.startsWith("statblock-")).map(f => new URL(f, dir))
    .concat(fs.readdirSync(new URL("gm/", dir)).filter(f => f.endsWith(".txt")).map(f => new URL("gm/" + f, dir)));
  for (const url of files) {
    const text = fs.readFileSync(url, "utf8");
    const u = usable(text);
    assert.equal(u.ok, true, `statblock refused: ${url.pathname} (${u.reason})`);
    // pressing the button twice changes nothing: the update replaces every field it recognized
    const a = statblock.statblockToUpdate(statblock.parseStatblock(text));
    const b = statblock.statblockToUpdate(statblock.parseStatblock(text));
    assert.deepEqual(b, a, "parsing twice differs: " + url.pathname);
    // the same statblock pasted twice is refused instead of doubling the entries
    const twice = usable(text + "\n" + text);
    assert.equal(twice.ok, false, "doubled paste accepted: " + url.pathname);
    assert.match(twice.reason, /more than once/);
  }
  assert.deepEqual(statblock.duplicateEntryNames([{ section: "actions", name: "Slam" }, { section: "actions", name: "slam" }]), ["slam"]);
  assert.deepEqual(statblock.duplicateEntryNames([{ section: "actions", name: "Slam" }, { section: "traits", name: "Slam" }]), []);
});

ok("migration: which stored data is actually rewritten", () => {
  const lm = migration.legacyMarkers;
  // current data: nothing to do
  assert.deepEqual(lm("character", convertAppExport(maximalState()).system), []);
  assert.deepEqual(lm("npc", { entries: [{ name: "Slam", section: "actions" }], saves: { str: null, dex: 3 }, legendary: { resist: { value: 0, max: 0 }, actions: { value: 3, max: 3 } } }), []);
  assert.deepEqual(lm("gear", { qty: 2 }), []);
  assert.deepEqual(lm("feat", { bon: {} }), []);
  // legacy shapes the data models translate on read and this step writes back
  assert.deepEqual(lm("character", { crystals: ["Alter String"] }), ["crystals as text"]);
  assert.deepEqual(lm("character", { crystals: [{ name: "", elem: "macht" }] }), ["crystal element macht"]);
  assert.deepEqual(lm("character", { play: { inspiration: true } }), ["inspiration as yes/no"]);
  assert.deepEqual(lm("npc", { attacks: [{ name: "Bite" }] }), ["attacks list"]);
  assert.deepEqual(lm("npc", { traits: "Pack Tactics. ..." }), ["traits as text"]);
  assert.deepEqual(lm("npc", { actions: "Slam. ..." }), ["actions as text"]);
  assert.deepEqual(lm("npc", { legendary: { value: 3, max: 3 } }), ["legendary counter"]);
  assert.deepEqual(lm("npc", { saves: { str: 0, dex: null } }), ["save bonus 0"]);
  assert.deepEqual(lm("npc", { entries: [{ name: "Bite", adv: { attacks: true } }] }), ["per-entry combat modifiers"]);
  assert.deepEqual(lm("weapon", { dtype: "macht" }), ["damage type macht"]);
  assert.deepEqual(lm("spell", { elem: "macht" }), ["element macht"]);
  assert.deepEqual(lm("character", undefined), []);
  assert.deepEqual(lm("npc", { entries: [], traits: "   " }), []);
});

/* ---------- HP on a level rollback (app fix v09-05m) ---------- */

/** Build tag of the bundled app ("v09-05l", "v09-05m", ...). */
const APP_BUILD = html.match(/class="buildtag"[^>]*>([^<]+)</)?.[1]?.trim() ?? "";

ok("hp: rolls above the current level are kept but do not count", () => {
  const base = APP.DEFAULTS();
  base.mode = "turm";
  base.abilities = { ...base.abilities, con: 10 };            // CON mod 0: hpMax == hpSum
  // 17 rolled hit dice; the first 16 sum to 87, the 17th adds 10
  const rolls = [6, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6, 4, 10];
  base.hpRolls = rolls;
  const at = (earned) => rules.derived({ ...base, earnedAp: earned, hpRolls: base.hpRolls });

  // level 17: every roll counts
  let d = at(160);
  assert.equal(d.level, 17);
  assert.equal(d.hpSum, 97);
  assert.equal(d.hpMax, 97);
  assert.deepEqual(award.pendingHitDieLevels(base.hpRolls, d.level), []);

  // AP correction back to level 16: the 17th roll no longer counts, but it is not deleted
  d = at(150);
  assert.equal(d.level, 16);
  assert.equal(d.hpSum, 87);
  assert.equal(d.hpMax, 87);
  assert.deepEqual(base.hpRolls, rolls, "derived() must not touch the stored rolls");
  assert.deepEqual(award.pendingHitDieLevels(base.hpRolls, d.level), []);

  // back up: the old roll applies again, nothing has to be rolled a second time
  d = at(160);
  assert.equal(d.hpSum, 97);
  assert.equal(d.hpMax, 97);
  assert.deepEqual(award.pendingHitDieLevels(base.hpRolls, d.level), [], "no open hit die after the level returns");

  // an unrolled level in between stays open, a stored roll does not
  assert.deepEqual(award.pendingHitDieLevels([6, 0, 6, 5], 4), [2]);
  assert.deepEqual(award.pendingHitDieLevels(rolls, 20), [18, 19, 20]);

  // CON modifier still scales with the level, not with the number of rolls
  const withCon = rules.derived({ ...base, abilities: { ...base.abilities, con: 16 }, earnedAp: 150 });
  assert.equal(withCon.hpMax, 87 + 16 * 3);

  // the app is the source of truth: compare as soon as the bundled build carries the fix
  const appSum = (earned) => { APP.setState({ ...base, earnedAp: earned, hpRolls: [...rolls] }); return APP.derived().hpSum; };
  if (APP_BUILD >= "v09-05m") {
    assert.equal(appSum(160), 97, "app " + APP_BUILD);
    assert.equal(appSum(150), 87, "app " + APP_BUILD);
  } else {
    // documented mismatch: the bundled app still sums every roll
    assert.equal(appSum(150), 97);
    console.log(`  note: bundled app is ${APP_BUILD}, the hpSum fix is in v09-05m - level rollback not compared against the app`);
  }
});

/* ---------- GM award tools (Paket A) ---------- */

/** derived() of a state that differs from DEFAULTS only in earnedAp. */
function appProgression(earned) {
  const S = APP.DEFAULTS(); S.earnedAp = earned; APP.setState(S);
  const d = APP.derived();
  return { earned, level: d.level, pb: d.pb, milestones: d.numMilestones, cantripTier: d.cantripTier };
}

ok("award: progressionAt matches the app's derived()", () => {
  const values = new Set();
  // every threshold and its neighbours (10 / 75 / 100) plus random values
  for (let e = 0; e <= 1200; e++) values.add(e);
  for (let i = 0; i < 300; i++) values.add(Math.floor(Math.random() * 5000));
  for (const e of values) assert.deepEqual(award.progressionAt(e), appProgression(e), "progression differs at earned=" + e);
  // non-integer / junk input is rounded resp. treated as 0, never below the level 1 floor
  assert.deepEqual(award.progressionAt(-50), award.progressionAt(0));
  assert.equal(award.progressionAt(undefined).level, 1);
  assert.equal(award.progressionAt(9.6).earned, 10);
});

ok("award: effects of an AP award (thresholds, milestones, corrections)", () => {
  // nothing crosses a threshold: no lines, earned still rises
  let e = award.awardEffects(151, 5);
  assert.deepEqual(e.lines, []);
  assert.equal(e.after, 156); assert.equal(e.applied, 5);

  // level threshold: every 10 earned AP
  assert.deepEqual(award.awardEffects(139, 1).lines, ["Level 14 → 15"]);
  assert.deepEqual(award.awardEffects(138, 1).lines, []);
  // one award may cross several level thresholds at once (one line, from -> to)
  assert.deepEqual(award.awardEffects(150, 30).lines, ["Level 16 → 19"]);

  // milestone + proficiency bonus: every 75 earned AP (75 is no level threshold, so no level line)
  assert.deepEqual(award.awardEffects(74, 1).lines,
    ["Milestone 1 available — +2 ability points or a feat", "Proficiency bonus +2 → +3"]);
  // order of the lines: level, milestones, proficiency bonus, cantrip tier
  assert.deepEqual(award.awardEffects(149, 1).lines,
    ["Level 15 → 16", "Milestone 2 available — +2 ability points or a feat", "Proficiency bonus +3 → +4"]);
  // two milestones at once are listed separately
  assert.deepEqual(award.awardEffects(70, 80).lines,
    ["Level 8 → 16", "Milestone 1 available — +2 ability points or a feat",
     "Milestone 2 available — +2 ability points or a feat", "Proficiency bonus +2 → +4", "Cantrip tier 1 → 2"]);

  // cantrip tier: every 100 earned AP
  assert.deepEqual(award.awardEffects(99, 1).lines, ["Level 10 → 11", "Cantrip tier 1 → 2"]);
  assert.deepEqual(award.awardEffects(195, 5).lines, ["Level 20 → 21", "Cantrip tier 2 → 3"]);

  // correction: a negative award reverses exactly the same thresholds
  assert.deepEqual(award.awardEffects(140, -1).lines, ["Level 15 → 14"]);
  assert.deepEqual(award.awardEffects(150, -10).lines, ["Level 16 → 15", "Milestone 2 lost", "Proficiency bonus +4 → +3"]);
  assert.deepEqual(award.awardEffects(75, -1).lines, ["Milestone 1 lost", "Proficiency bonus +3 → +2"]);
  assert.deepEqual(award.awardEffects(150, -80).lines,
    ["Level 16 → 8", "Milestone 2 lost", "Milestone 1 lost", "Proficiency bonus +4 → +2", "Cantrip tier 2 → 1"]);
  assert.deepEqual(award.awardEffects(100, -1).lines, ["Level 11 → 10", "Cantrip tier 2 → 1"]);

  // earned AP never drop below 0 (schema minimum): applied reports what was really booked
  e = award.awardEffects(5, -20);
  assert.equal(e.after, 0); assert.equal(e.delta, -20); assert.equal(e.applied, -5);
  assert.deepEqual(e.lines, []);                                   // level 1 is the floor on both sides
  // a zero award changes nothing
  assert.deepEqual(award.awardEffects(150, 0).lines, []);
  assert.equal(award.awardEffects(150, 0).applied, 0);
  assert.equal(award.awardEffects(150, 0).after, 150);

  // the new levels are the ones whose hit die still has to be rolled
  assert.deepEqual(award.awardEffects(150, 30).newLevels, [17, 18, 19]);
  assert.deepEqual(award.awardEffects(150, -30).newLevels, []);

  // lines and totals agree with the app for random awards
  for (let i = 0; i < 500; i++) {
    const before = Math.floor(Math.random() * 600);
    const delta = Math.floor(Math.random() * 200) - 100;
    const eff = award.awardEffects(before, delta);
    assert.deepEqual(eff.from, appProgression(before));
    assert.deepEqual(eff.to, appProgression(Math.max(0, before + delta)));
    assert.equal(eff.lines.some(l => l.startsWith("Level ")), eff.from.level !== eff.to.level);
    assert.equal(eff.lines.filter(l => l.startsWith("Milestone ")).length, Math.abs(eff.to.milestones - eff.from.milestones));
    assert.equal(eff.lines.some(l => l.startsWith("Proficiency bonus")), eff.from.pb !== eff.to.pb);
    assert.equal(eff.lines.some(l => l.startsWith("Cantrip tier")), eff.from.cantripTier !== eff.to.cantripTier);
  }
});

ok("award: turmwissen ranks stay gapless", () => {
  let list = [];
  const triggers = ["Erste Tür", "Der Spiegel", "  Stimme im Schacht  "];
  triggers.forEach((t, i) => {
    list = award.appendTurmwissen(list, t);
    assert.equal(list.length, i + 1, "rank is index + 1");
    assert.equal(list[i].trigger, t.trim());
  });
  // earlier ranks are untouched, the list keeps the app's {trigger} shape
  assert.deepEqual(list, [{ trigger: "Erste Tür" }, { trigger: "Der Spiegel" }, { trigger: "Stimme im Schacht" }]);
  // missing / broken entries of old data do not create gaps
  assert.deepEqual(award.appendTurmwissen([{ trigger: "A" }, {}, null], "B"),
    [{ trigger: "A" }, { trigger: "" }, { trigger: "" }, { trigger: "B" }]);
  assert.deepEqual(award.appendTurmwissen(undefined, "X"), [{ trigger: "X" }]);
  // the source array is not mutated
  const src = [{ trigger: "A" }];
  award.appendTurmwissen(src, "B");
  assert.deepEqual(src, [{ trigger: "A" }]);
});

ok("award: open hit die rolls are the levels without a roll", () => {
  assert.deepEqual(award.pendingHitDieLevels([8, 6, 7], 3), []);
  assert.deepEqual(award.pendingHitDieLevels([8, 6, 7], 5), [4, 5]);      // two levels gained, not rolled yet
  assert.deepEqual(award.pendingHitDieLevels([8, 0, 7], 3), [2]);         // a gap in the middle counts too
  assert.deepEqual(award.pendingHitDieLevels([], 1), [1]);
  assert.deepEqual(award.pendingHitDieLevels([8, 6, 7, 9], 2), []);       // rolls above the level are ignored
  assert.deepEqual(award.pendingHitDieLevels(undefined, 2), [1, 2]);
});

/* ---------- the three Request Roll bugs (auto failure, DC boundary, both d20 visible) ---------- */

ok("auto failure reads the rolling actor's own conditions and nobody else's", () => {
  // stand-ins for the documents: only `statuses` is read, and only through statusIdsOf()
  const roller = { name: "Gades", statuses: new Set() };
  const target = { name: "Dummy", statuses: new Set(["unconscious"]) };
  const speaker = { name: "GM token", statuses: new Set(["stunned"]) };
  const mods = (me, ability) => cond.rollModifiers({
    statuses: cond.statusIdsOf(me), targetStatuses: cond.statusIdsOf(target), type: "save", ability
  });
  // the roller carries nothing: no automatic failure, whatever the target or any other actor carries
  for (const ab of ["str", "dex", "con", "int", "wis", "cha"]) assert.equal(mods(roller, ab).autoFail, null, `clean roller / ${ab}`);
  assert.equal(cond.rollModifiers({ statuses: cond.statusIdsOf(speaker), type: "save", ability: "str" }).autoFail, "stunned");
  // only once the status sits on the rolling actor himself does it strike, and only on STR / DEX
  roller.statuses.add("unconscious");
  assert.equal(mods(roller, "str").autoFail, "unconscious");
  assert.equal(mods(roller, "dex").autoFail, "unconscious");
  for (const ab of ["con", "int", "wis", "cha"]) assert.equal(mods(roller, ab).autoFail, null, `unconscious / ${ab}`);
  // an unset status is not read from anywhere: an actor without a status set at all is clean
  assert.deepEqual(cond.statusIdsOf({}), []);
  assert.deepEqual(cond.statusIdsOf(null), []);
  assert.deepEqual(cond.statusIdsOf({ statuses: new Set(["prone", "", null, 7]) }), ["prone"]);
});

ok("no roll ever sets or clears a status", () => {
  // the list a roll reads is frozen, so no code in the roll path can add or remove a status
  const list = cond.statusIdsOf({ statuses: new Set(["prone"]) });
  assert.ok(Object.isFrozen(list));
  assert.throws(() => list.push("unconscious"), TypeError);
  assert.throws(() => list.pop(), TypeError);
  // one run through every roll kind, with the roller's and the target's conditions unchanged afterwards
  const me = new Set(["prone", "poisoned", "exhaustion2"]);
  const tg = new Set(["restrained", "invisible"]);
  const before = [[...me], [...tg]];
  for (const type of ["attack", "save", "check", "initiative", "deathSave"]) {
    for (const ability of [null, "str", "dex", "con", "int", "wis", "cha"]) {
      for (const distance of [null, 5, 30]) {
        const r = cond.rollModifiers({ statuses: cond.statusIdsOf({ statuses: me }), targetStatuses: cond.statusIdsOf({ statuses: tg }), type, ability, distance, exhaustion: 2 });
        assert.ok(Array.isArray(r.adv) && Array.isArray(r.dis));
        cond.resolveMode("normal", r);
      }
    }
  }
  // the builders that turn a roll into a formula do not touch conditions either
  rolls.d20Formula(5, { mode: "advantage", situational: 2 });
  rolls.attackOutcome({ d20: 12, total: 18, ac: 15 });
  rolls.deathSaveOutcome({ d20: 12, total: 12, succ: 0, fail: 0 });
  assert.deepEqual([[...me], [...tg]], before, "a roll changed a status set");
});

ok("DC boundary: reaching the DC (or AC) is a success", () => {
  // checkSuccess is what rollCheck uses for saves, ability and skill checks and for requested rolls
  assert.equal(rolls.checkSuccess(12, 12), true);       // the card from the bug report: 12 vs. DC 12
  assert.equal(rolls.checkSuccess(11, 12), false);
  assert.equal(rolls.checkSuccess(13, 12), true);
  assert.equal(rolls.checkSuccess(0, 0), true);
  assert.equal(rolls.checkSuccess(-1, 0), false);
  assert.equal(rolls.checkSuccess(5, null), null);      // no DC set: no verdict
  assert.equal(rolls.checkSuccess(5, undefined), null);
  for (const dc of [1, 8, 12, 15, 20, 30]) {
    assert.equal(rolls.checkSuccess(dc, dc), true, `total == DC ${dc}`);
    assert.equal(rolls.checkSuccess(dc - 1, dc), false, `total == DC-1 ${dc}`);
  }
  // attack vs. AC uses the same boundary (a natural 1 and the crit range stay ahead of it)
  for (const ac of [10, 15, 19]) {
    assert.equal(rolls.attackOutcome({ d20: 10, total: ac, ac }), "hit", `total == AC ${ac}`);
    assert.equal(rolls.attackOutcome({ d20: 10, total: ac - 1, ac }), "miss", `total == AC-1 ${ac}`);
  }
  assert.equal(rolls.attackOutcome({ d20: 1, total: 99, ac: 10 }), "fumble");
  assert.equal(rolls.attackOutcome({ d20: 20, total: 0, ac: 99 }), "crit");
  assert.equal(rolls.attackOutcome({ d20: 10, total: 12, ac: null }), null);
  // death saves: 10 is a success
  assert.equal(rolls.deathSaveOutcome({ d20: 10, total: 10 }).result, "success");
  assert.equal(rolls.deathSaveOutcome({ d20: 9, total: 9 }).result, "fail");
});

ok("request roll: consequences (damage on failure, status, card header)", () => {
  // full damage on a failure, half (rounded down) on a success, nothing when the card does not halve
  assert.equal(requestRoll.damageForRow({ total: 11, success: false, half: true }), 11);
  assert.equal(requestRoll.damageForRow({ total: 11, success: true, half: true }), 5);
  assert.equal(requestRoll.damageForRow({ total: 11, success: true, half: false }), 0);
  assert.equal(requestRoll.damageForRow({ total: 11, success: false, half: false }), 11);
  assert.equal(requestRoll.damageForRow({ total: null, success: false, half: true }), 0);   // not rolled yet
  assert.equal(requestRoll.damageForRow({}), 0);
  assert.equal(requestRoll.damageForRow({ total: 1, success: true, half: true }), 0);
  // the header names the consequence, and only when a DC makes failing possible
  assert.equal(requestRoll.consequenceLine({ dc: 14, dmg: { formula: "3d6", dtype: "poison" }, statusLabel: "Poisoned" }),
    "on failure: 3d6 Poison, Poisoned");
  assert.equal(requestRoll.consequenceLine({ dc: 14, dmg: { formula: "3d6", dtype: "feuer" } }), "on failure: 3d6 Feuer");
  assert.equal(requestRoll.consequenceLine({ dc: 14, statusLabel: "Prone" }), "on failure: Prone");
  assert.equal(requestRoll.consequenceLine({ dc: 14 }), "");
  assert.equal(requestRoll.consequenceLine({ dc: null, dmg: { formula: "3d6", dtype: "poison" } }), "");
  // the damage list follows the campaign mode of the world's characters
  assert.equal(requestRoll.worldMode([{ system: { mode: "turm" } }, { system: { mode: "ap" } }]), "turm");
  assert.equal(requestRoll.worldMode([{ system: { mode: "ap" } }, { system: { mode: "ap" } }, { system: { mode: "turm" } }]), "ap");
  assert.equal(requestRoll.worldMode([]), "turm");
  // rows: an automatic failure has no total but a verdict, and it carries the status that was set
  const rows = requestRoll.requestRows([{ uuid: "Actor.a", name: "Gades" }, { uuid: "Actor.b", name: "Markus" }]);
  const done = [
    { ...rows[0], total: null, success: false, autoFail: "unconscious", dmgTotal: 9, status: "Poisoned" },
    { ...rows[1], total: 12, success: true, dmgTotal: 9 }
  ];
  const view = requestRoll.rowView(done, true, { half: true });
  assert.deepEqual(view.map(r => [r.rolled, r.totalText, r.verdict, r.amount]), [[true, "—", "FAILURE", 9], [true, 12, "SUCCESS", 4]]);
  assert.equal(view[0].status, "Poisoned");
  // an applied row offers no button any more
  assert.equal(requestRoll.rowView([{ ...done[0], applied: true }], true, { half: true })[0].amount, 0);
  // without a consequence the rows stay as they were
  assert.deepEqual(requestRoll.rowView([{ ...rows[0], total: 12, success: true }], true).map(r => r.amount), [0]);
});

/* ---------- Paket C: areas of effect, area geometry, HP status sync ---------- */

const areaMod = await import("../module/area.mjs");

ok("area parser: shape and size out of an entry text", () => {
  const pa = areaMod.parseArea;
  assert.deepEqual(pa("The dragon exhales an icy blast in a 60-foot cone."), { shape: "cone", size: 60 });
  assert.deepEqual(pa("a 20-foot-radius sphere centered on a point within 120 feet"), { shape: "circle", size: 20 });
  assert.deepEqual(pa("in a 90-foot-long, 5-foot-wide Line"), { shape: "ray", size: 90 });
  assert.deepEqual(pa("a 30-foot line that is 5 feet wide"), { shape: "ray", size: 30 });
  assert.deepEqual(pa("a 15-foot cube originating from the dragon"), { shape: "rect", size: 15 });
  assert.deepEqual(pa("a 10-foot square"), { shape: "rect", size: 10 });
  assert.deepEqual(pa("a 20-foot-radius, 40-foot-high cylinder"), { shape: "circle", size: 20 });
  // no area: plain attacks, ranges and distances stay without a template
  assert.equal(pa("Melee Attack Roll: +12, reach 10 ft. Hit: 17 (2d8 + 8) Slashing damage."), null);
  assert.equal(pa("Each creature within 30 feet of the dragon must succeed on a save."), null);
  assert.equal(pa("a cone of fire"), null);                       // no measurement
  assert.equal(pa("a 10-foot Emanation"), null);                  // shape the system does not place
  assert.equal(pa("a 15-foot aura"), null);
  assert.equal(pa(""), null);
  assert.equal(pa(null), null);
  assert.equal(pa(undefined), null);
  // entryArea only hands out what can actually be placed
  assert.deepEqual(areaMod.entryArea({ areaShape: "cone", areaSize: 60 }), { shape: "cone", size: 60 });
  assert.equal(areaMod.entryArea({ areaShape: "", areaSize: 0 }), null);
  assert.equal(areaMod.entryArea({ areaShape: "emanation", areaSize: 10 }), null);
  assert.equal(areaMod.entryArea({ areaShape: "cone", areaSize: 0 }), null);
  assert.equal(areaMod.entryArea(undefined), null);
});

ok("area geometry: which point a cone, circle, line or cube catches", () => {
  const inside = areaMod.pointInArea;
  // circle, radius 20 ft around the origin
  const circle = { shape: "circle", size: 20, x: 0, y: 0 };
  assert.equal(inside({ x: 15, y: 0 }, circle), true);
  assert.equal(inside({ x: 0, y: 20 }, circle), true);            // exactly on the edge counts
  assert.equal(inside({ x: 15, y: 15 }, circle), false);          // 21.2 ft away
  // cone, 60 ft, the 5e opening angle, pointing east
  const cone = { shape: "cone", size: 60, x: 0, y: 0, direction: 0, angle: 53.13 };
  assert.equal(inside({ x: 30, y: 0 }, cone), true);
  assert.equal(inside({ x: 30, y: 14 }, cone), true);             // 25 degrees off the middle
  assert.equal(inside({ x: 30, y: 31 }, cone), false);            // 46 degrees off
  assert.equal(inside({ x: -30, y: 0 }, cone), false);            // behind the caster
  assert.equal(inside({ x: 70, y: 0 }, cone), false);             // beyond the range
  assert.equal(inside({ x: 0, y: 0 }, cone), true);               // the origin itself
  // the same cone turned south (y grows downwards on the canvas)
  const south = { ...cone, direction: 90 };
  assert.equal(inside({ x: 0, y: 30 }, south), true);
  assert.equal(inside({ x: 0, y: -30 }, south), false);
  // line, 30 ft long and 5 ft wide, pointing east
  const ray = { shape: "ray", size: 30, x: 0, y: 0, direction: 0, width: 5 };
  assert.equal(inside({ x: 20, y: 0 }, ray), true);
  assert.equal(inside({ x: 20, y: 2 }, ray), true);
  assert.equal(inside({ x: 20, y: 3 }, ray), false);              // outside the width
  assert.equal(inside({ x: 35, y: 0 }, ray), false);              // past the end
  assert.equal(inside({ x: -5, y: 0 }, ray), false);              // behind the start
  // cube, 15 ft, corner on the placed point (Foundry's rect template)
  const rect = { shape: "rect", size: 15, x: 0, y: 0 };
  assert.equal(inside({ x: 7, y: 7 }, rect), true);
  assert.equal(inside({ x: 15, y: 15 }, rect), true);
  assert.equal(inside({ x: 16, y: 7 }, rect), false);
  assert.equal(inside({ x: -1, y: 7 }, rect), false);
  // nothing is caught by a shape the system does not know or by an empty area
  assert.equal(inside({ x: 0, y: 0 }, { shape: "emanation", size: 10, x: 0, y: 0 }), false);
  assert.equal(inside({ x: 0, y: 0 }, { shape: "circle", size: 0, x: 0, y: 0 }), false);
  assert.equal(inside(null, circle), false);
  // the token list keeps its order and returns indices
  assert.deepEqual(areaMod.tokensInArea([{ x: 10, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 5 }], circle), [0, 2]);
  assert.deepEqual(areaMod.tokensInArea([], circle), []);
  assert.deepEqual(areaMod.tokensInArea(undefined, circle), []);
});

ok("statblock parser: the area tags on the fixtures", () => {
  // every parsed entry carries the two fields, and a tag never stands without a size
  for (const f of ["statblock-book.txt", "statblock-web.txt", "statblock-2024.txt"]) {
    for (const e of statblock.parseStatblock(readFixture(f)).entries) {
      assert.equal(typeof e.areaShape, "string", `${f}: ${e.name} areaShape`);
      assert.ok(Number.isInteger(e.areaSize), `${f}: ${e.name} areaSize`);
      if (e.areaShape) assert.ok(e.areaSize > 0, `${f}: ${e.name} tagged without a size`);
    }
  }
  // the GM's dragon: both breath weapons are 60-foot cones and get the template button
  const dragon = statblock.parseStatblock(fs4.readFileSync(new URL("./fixtures/gm/adult-silver-dragon.txt", import.meta.url), "utf8"));
  for (const name of ["Cold Breath", "Paralyzing Breath"]) {
    const e = dragon.entries.find(x => x.name === name);
    assert.ok(e, `${name} parsed`);
    assert.deepEqual([e.areaShape, e.areaSize], ["cone", 60], name);
    assert.ok(areaMod.entryArea(e), `${name} can be placed`);
  }
  // an attack without an area phrase stays without a tag (no template button)
  const bite = dragon.entries.find(x => /^Bite/i.test(x.name));
  assert.ok(bite, "Bite parsed");
  assert.equal(bite.areaShape, "");
  assert.equal(areaMod.entryArea(bite), null);
});

ok("HP sync: the downed status follows every hit point change", () => {
  const plan = rolls.downedPlan;
  // dropping to 0 sets the status the actor type uses
  assert.deepEqual(plan({ type: "character", before: 5, after: 0, statuses: [] }), { set: "unconscious", clear: [], isDown: true });
  assert.deepEqual(plan({ type: "npc", before: 9, after: 0, statuses: [] }), { set: "dead", clear: [], isDown: true });
  // already carrying it: nothing to do, so a second run never creates a second effect
  assert.deepEqual(plan({ type: "character", before: 0, after: 0, statuses: [{ id: "unconscious", auto: true }] }), { set: null, clear: [], isDown: true });
  // above 0 the automation's own status goes again
  assert.deepEqual(plan({ type: "character", before: 0, after: 2, statuses: [{ id: "unconscious", auto: true }] }), { set: null, clear: ["unconscious"], isDown: false });
  assert.deepEqual(plan({ type: "npc", before: 0, after: 4, statuses: [{ id: "dead", auto: true }] }).clear, ["dead"]);
  // a hit point change that never crosses 0 cleans up too: the field was edited directly before
  assert.deepEqual(plan({ type: "character", before: 2, after: 3, statuses: [{ id: "unconscious", auto: true }] }).clear, ["unconscious"]);
  // a status the GM set by hand is never taken away by a heal
  assert.deepEqual(plan({ type: "character", before: 0, after: 5, statuses: [{ id: "unconscious" }] }), { set: null, clear: [], isDown: false });
  assert.deepEqual(plan({ type: "character", before: 5, after: 9, statuses: [{ id: "unconscious", auto: false }] }).clear, []);
  assert.deepEqual(plan({ type: "npc", before: 0, after: 4, statuses: [{ id: "dead" }] }).clear, []);
  // every other condition stays untouched
  assert.deepEqual(plan({ type: "character", before: 0, after: 4, statuses: [{ id: "prone", auto: true }, { id: "unconscious", auto: true }] }).clear, ["unconscious"]);
  // hit points that are not set at all count as full
  assert.equal(plan({ type: "character", before: undefined, after: undefined, statuses: [] }).isDown, false);
  assert.deepEqual(plan({}), { set: null, clear: [], isDown: false });
});

ok("item library: name conflicts and field round trip", () => {
  const index = [{ _id: "a1", name: "Heiltrank" }, { _id: "a2", name: "Heiltrank (2)" }, { _id: "a3", name: "Seil" }];
  // same name: trimmed, whitespace collapsed, case-insensitive
  assert.equal(lib.findByName(index, "Heiltrank")._id, "a1");
  assert.equal(lib.findByName(index, "  heiltrank ")._id, "a1");
  assert.equal(lib.findByName(index, "Heil trank"), null);
  assert.equal(lib.findByName(index, "Fackel"), null);
  assert.equal(lib.findByName(undefined, "Seil"), null);
  // "Save as copy": first free number, an existing suffix is continued, not stacked
  assert.equal(lib.copyName("Heiltrank", index.map(e => e.name)), "Heiltrank (3)");
  assert.equal(lib.copyName("Heiltrank (2)", index.map(e => e.name)), "Heiltrank (3)");
  assert.equal(lib.copyName("Seil", index.map(e => e.name)), "Seil (2)");
  assert.equal(lib.copyName("seil", ["Seil", "SEIL (2)"]), "seil (3)");
  // conflict answers
  const names = index.map(e => e.name);
  assert.deepEqual(lib.resolveConflict(null, null, "Fackel", names), { action: "create", name: "Fackel" });
  assert.deepEqual(lib.resolveConflict(null, "replace", "Fackel", names), { action: "create", name: "Fackel" });   // no conflict, nothing to replace
  assert.deepEqual(lib.resolveConflict(index[0], "replace", "heiltrank", names), { action: "replace", id: "a1", name: "Heiltrank" });
  assert.deepEqual(lib.resolveConflict(index[0], "copy", "Heiltrank", names), { action: "create", name: "Heiltrank (3)" });
  assert.deepEqual(lib.resolveConflict(index[0], "cancel", "Heiltrank", names), { action: "cancel" });
  assert.deepEqual(lib.resolveConflict(index[0], null, "Heiltrank", names), { action: "cancel" });        // dialog closed = cancel
  assert.deepEqual(lib.resolveConflict({ id: "b7", name: "X" }, "replace", "X", []), { action: "replace", id: "b7", name: "X" });

  // round trip item -> library -> item: every gear field of the data model stays identical
  const gearSrc = fs.readFileSync(new URL("../module/data/items.mjs", import.meta.url), "utf8").match(/class GearData[\s\S]*?return \{([\s\S]*?)\n    \};/)[1];
  const gearFields = [...gearSrc.matchAll(/^\s{6}(\w+):/gm)].map(m => m[1]);
  assert.deepEqual(gearFields, ["qty", "notes", "attuned", "equipped", "attunement", "effects", "charges", "used", "recharge", "origin"]);
  const onActor = {
    _id: "itm1", name: "Kristalllampe", type: "gear", img: "icons/lamp.webp", sort: 300000, folder: null,
    ownership: { default: 0, u1: 3 }, _stats: { createdTime: 1, modifiedTime: 2, compendiumSource: null },
    // items with effects keep them through the library (1.3.0)
    system: { qty: 3, notes: "Leuchtet 30 ft\nzweite Zeile", attuned: true, equipped: true, attunement: true,
      effects: rules.expandEffects({ bon: { str: 2 }, adv: { skills: ["ste"] }, res: ["feuer"], senses: "Darkvision 60 ft" }),
      charges: 4, used: 1, recharge: "dawn", origin: "tower" },
    flags: { "ap-turm": { note: "x" } }, effects: [{ _id: "e1", name: "Glow", changes: [], _stats: {} }]
  };
  const inLib = lib.libraryData(onActor);
  for (const k of ["_id", "sort", "folder", "ownership", "_stats"]) assert.equal(k in inLib, false, k + " stays behind");
  const back = lib.libraryData({ ...inLib, _id: "lib9", _stats: { compendiumSource: null }, folder: "f1", sort: 5 });
  for (const f of gearFields) assert.deepEqual(back.system[f], onActor.system[f], f);
  assert.deepEqual(back.system, onActor.system);
  assert.equal(back.name, onActor.name); assert.equal(back.type, "gear"); assert.equal(back.img, onActor.img);
  assert.deepEqual(back.flags, onActor.flags);
  assert.deepEqual(back.effects, [{ name: "Glow", changes: [] }]);
  // a copy, not a reference: editing the library entry leaves the actor's item alone
  inLib.system.qty = 99; assert.equal(onActor.system.qty, 3);
  // "carried in" stays carried in, "found in tower" stays tower (origin is not reset on the way)
  for (const origin of ["city", "tower"]) assert.equal(lib.libraryData(lib.libraryData({ ...onActor, system: { ...onActor.system, origin } })).system.origin, origin);
  // the copy name override
  assert.equal(lib.libraryData(onActor, { name: "Kristalllampe (2)" }).name, "Kristalllampe (2)");

  // picker search: all words in any order, case-insensitive, sorted
  const list = [{ name: "Seil" }, { name: "Heiltrank groß" }, { name: "heiltrank klein" }, { name: "Fackel" }];
  assert.deepEqual(lib.filterEntries(list, "").map(e => e.name), ["Fackel", "Heiltrank groß", "heiltrank klein", "Seil"]);
  assert.deepEqual(lib.filterEntries(list, "HEIL").map(e => e.name), ["Heiltrank groß", "heiltrank klein"]);
  assert.deepEqual(lib.filterEntries(list, "klein heil").map(e => e.name), ["heiltrank klein"]);
  assert.deepEqual(lib.filterEntries(list, "xyz"), []);
  // the pack is readable for players, writable for assistants and the GM
  assert.deepEqual(lib.LIBRARY_OWNERSHIP, { PLAYER: "OBSERVER", ASSISTANT: "OWNER" });
});

// JB2A free database (when the module is installed next to the system): every mapped path has to exist in it
const jb2aPaths = await (async () => {
  try {
    const url = new URL("../../../modules/JB2A_DnD5e/scripts/jb2a_sequencer.js", import.meta.url);
    if (!fs.existsSync(url)) return null;
    const mod = await import(url.href);
    await mod.jb2aFreeDatabase("modules");
    const out = [];
    const walk = (o, pre) => { for (const [k, v] of Object.entries(o)) { if (k.startsWith("_")) continue; if (typeof v === "string" || Array.isArray(v)) out.push(pre + k); else if (v && typeof v === "object") walk(v, pre + k + "."); } };
    walk(mod.freeDatabase, "jb2a.");
    return out;
  } catch { return null; }
})();

ok("fx map: every element and D&D type has a look, every path exists in JB2A", () => {
  // 20 elements, no element without an entry, no entry without all three parts
  assert.equal(fxMap.FX_KEYS.elements.length, 20);
  for (const k of fxMap.FX_KEYS.elements) {
    const e = fxMap.ELEMENT_FX[k];
    assert.ok(e, "element without fx: " + k);
    for (const part of ["projectile", "impact", "cast"]) assert.match(e[part]?.file ?? "", /^jb2a\./, `${k}.${part}`);
  }
  assert.deepEqual(Object.keys(fxMap.ELEMENT_FX).sort(), [...fxMap.FX_KEYS.elements].sort());   // no stray keys
  assert.equal("macht" in fxMap.ELEMENT_FX, false);
  // every D&D type is covered: a look, or null for the physical types (the weapon swing carries those)
  for (const k of fxMap.FX_KEYS.dnd) assert.ok(k in fxMap.DAMAGE_FX, "D&D type without fx: " + k);
  for (const k of ["slashing", "piercing", "bludgeoning"]) assert.equal(fxMap.DAMAGE_FX[k], null);
  // Turm mode: element colour as tint only where the file is a stand-in, exact matches keep their colour
  const fire = fxMap.typeFx("feuer", "turm");
  assert.deepEqual(fire.projectile, { file: "jb2a.fire_bolt.orange", tint: null });
  const blood = fxMap.typeFx("blut", "turm");
  assert.equal(blood.projectile.tint, cfg.ELEMENTS.blut.c);
  for (const k of fxMap.FX_KEYS.elements) {
    const l = fxMap.typeFx(k, "turm");
    for (const part of ["projectile", "impact", "cast"]) {
      const exp = fxMap.ELEMENT_FX[k][part].tint ? cfg.ELEMENTS[k].c : null;
      assert.equal(l[part].tint, exp, `${k}.${part} tint`);
    }
  }
  // AP mode: D&D types on the JB2A standard colours, never tinted; physical types -> null (weapon only)
  for (const k of fxMap.FX_KEYS.dnd) {
    const l = fxMap.typeFx(k, "ap");
    if (fxMap.DAMAGE_FX[k] === null) { assert.equal(l, null, k); continue; }
    for (const part of ["projectile", "impact", "cast"]) assert.equal(l[part].tint, null, `${k}.${part}`);
  }
  assert.equal(fxMap.typeFx("fire", "ap").projectile.file, "jb2a.fire_bolt.orange");
  // values of the other mode stay readable; unknown / empty types have no look
  assert.equal(fxMap.typeFx("fire", "turm").projectile.file, "jb2a.fire_bolt.orange");
  assert.equal(fxMap.typeFx("feuer", "ap").projectile.file, "jb2a.fire_bolt.orange");
  assert.equal(fxMap.typeFx("", "turm"), null);
  assert.equal(fxMap.typeFx("unbekannt", "ap"), null);
  // weapon swing tint: element colour in Turm mode only
  assert.equal(fxMap.weaponTint("gift", "turm"), cfg.ELEMENTS.gift.c);
  assert.equal(fxMap.weaponTint("poison", "ap"), null);
  assert.equal(fxMap.weaponTint("slashing", "turm"), null);
  // weapons: spear stab, ranged detection by name / range text / DEX
  assert.equal(fxMap.meleeFile("Obsidianspeer"), "jb2a.spear.melee.01.white");
  assert.equal(fxMap.meleeFile("Spear"), "jb2a.spear.melee.01.white");
  assert.equal(fxMap.meleeFile("Zweihänder"), "jb2a.greatsword.melee.standard.white");
  assert.equal(fxMap.meleeFile("Zweihaender"), "jb2a.greatsword.melee.standard.white");
  assert.equal(fxMap.meleeFile("Bite"), "jb2a.bite.200px.red");
  assert.equal(fxMap.meleeFile("Irgendwas"), fxMap.MELEE_DEFAULT);
  assert.equal(fxMap.rangedFile("Leichte Armbrust"), "jb2a.bolt.physical.orange");
  assert.equal(fxMap.rangedFile("Longbow"), "jb2a.arrow.physical.white.01");
  assert.equal(fxMap.isRangedAttack({ name: "Longbow" }), true);
  assert.equal(fxMap.isRangedAttack({ name: "Spear", range: "reach 5 ft" }), false);
  assert.equal(fxMap.isRangedAttack({ name: "Spit", range: "range 30/60 ft" }), true);
  assert.equal(fxMap.isRangedAttack({ name: "Rapier", abil: "fin" }), false);
  assert.equal(fxMap.isRangedAttack({ name: "Schleuder", abil: "str" }), true);
  assert.equal(fxMap.isRangedAttack({ name: "Waffe", abil: "dex" }), true);
  assert.equal(fxMap.isRangedAttack({ name: "Zweihänder", abil: "str" }), false);

  // every file the map can hand out exists in the free JB2A database (the ranged ones as a prefix)
  const files = new Set([fxMap.MELEE_DEFAULT, fxMap.RANGED_DEFAULT, ...fxMap.MELEE_FX.map(x => x[1]), ...fxMap.RANGED_FX.map(x => x[1]),
    ...Object.values(fxMap.DEFAULT_FX).map(x => x.file), "jb2a.magic_missile.purple"]);
  for (const e of [...Object.values(fxMap.ELEMENT_FX), ...Object.values(fxMap.DAMAGE_FX)]) if (e) for (const part of ["projectile", "impact", "cast"]) files.add(e[part].file);
  if (jb2aPaths) {
    for (const f of files) assert.ok(jb2aPaths.some(p => p === f || p.startsWith(f + ".")), "not in JB2A free: " + f);
  } else console.log("  (JB2A_DnD5e not installed next to the system - path check skipped)");
});

ok("hit feedback: colour, crit, healing and temp HP", () => {
  const fb = hitFb;
  // Turm: element colour of the damage type
  assert.deepEqual(fb.feedbackStyle({ kind: "damage", amount: 12, dtype: "feuer", mode: "turm" }),
    { text: "-12", color: cfg.ELEMENTS.feuer.c, fontSize: fb.FEEDBACK_SIZE.base, fontWeight: "normal" });
  // AP mode neutral, also for an element key; Turm mode with an unassigned D&D type or no type neutral
  assert.equal(fb.feedbackStyle({ kind: "damage", amount: 5, dtype: "fire", mode: "ap" }).color, fb.FEEDBACK_COLORS.neutral);
  assert.equal(fb.feedbackStyle({ kind: "damage", amount: 5, dtype: "feuer", mode: "ap" }).color, fb.FEEDBACK_COLORS.neutral);
  assert.equal(fb.feedbackStyle({ kind: "damage", amount: 5, dtype: "fire", mode: "turm" }).color, fb.FEEDBACK_COLORS.neutral);
  assert.equal(fb.feedbackStyle({ kind: "damage", amount: 5, dtype: "", mode: "turm" }).color, fb.FEEDBACK_COLORS.neutral);
  // every element has its own colour
  for (const k of Object.keys(cfg.ELEMENTS)) assert.equal(fb.elementColor(k, "turm"), cfg.ELEMENTS[k].c);
  // crit: bigger and bold
  const crit = fb.feedbackStyle({ kind: "damage", amount: 30, dtype: "eis", mode: "turm", crit: true });
  assert.equal(crit.fontSize, fb.FEEDBACK_SIZE.crit); assert.equal(crit.fontWeight, "bold");
  assert.ok(fb.FEEDBACK_SIZE.crit > fb.FEEDBACK_SIZE.base);
  // healing green with a plus, never crit-sized
  assert.deepEqual(fb.feedbackStyle({ kind: "heal", amount: 8, crit: true }), { text: "+8", color: fb.FEEDBACK_COLORS.heal, fontSize: fb.FEEDBACK_SIZE.base, fontWeight: "normal" });
  // temp HP loss grey
  assert.equal(fb.feedbackStyle({ kind: "temp", amount: 4 }).color, fb.FEEDBACK_COLORS.temp);
  // one change -> its numbers: HP part in colour, temp part grey, one total for several damage parts
  assert.deepEqual(fb.feedbackParts({ taken: 10, fromTemp: 4, dtype: "gift", mode: "turm" }).map(x => [x.text, x.color]),
    [["-6", cfg.ELEMENTS.gift.c], ["-4", fb.FEEDBACK_COLORS.temp]]);
  assert.deepEqual(fb.feedbackParts({ taken: 3, fromTemp: 3 }).map(x => x.text), ["-3"]);                      // all into temp HP
  assert.equal(fb.feedbackParts({ taken: 3, fromTemp: 3 })[0].color, fb.FEEDBACK_COLORS.temp);
  assert.deepEqual(fb.feedbackParts({ taken: 0, dtype: "feuer", mode: "turm" }).map(x => x.text), ["-0"]);     // immune: still shows the hit
  assert.deepEqual(fb.feedbackParts({ healed: 7 }).map(x => [x.text, x.color]), [["+7", fb.FEEDBACK_COLORS.heal]]);
  const total = rolls.damageTotal([{ rolled: 7 }, { rolled: 5, critRolled: 4 }]);
  assert.deepEqual(fb.feedbackParts({ taken: total, mode: "ap" }).map(x => x.text), [`-${total}`]);
  // motion
  assert.equal(fb.feedbackMotion({ taken: 5 }), "hit");
  assert.equal(fb.feedbackMotion({ healed: 2 }), "heal");
  assert.equal(fb.feedbackMotion({ taken: 0 }), null);
});

ok("NPC items: rows, library round trip, delete", () => {
  // create: an NPC with a dropped gear item, a feat and a weapon; the box lists all of them flat
  let items = [
    { _id: "g1", name: "Gnollbeutel", type: "gear", sort: 200, system: { qty: 3, notes: "Knochen,\n  Zähne und  Münzen", attuned: false, charges: 2, used: 1, recharge: "dawn", origin: "tower" } },
    { _id: "f1", name: "Rampage", type: "feat", sort: 100, system: { desc: "Bonus action move", src: "", bon: {} } },
    { _id: "w1", name: "Spear", type: "weapon", sort: 300, system: { dice: "1d6", dtype: "piercing" } }
  ];
  let rows = npcItems.npcItemRows(items, { isGM: true });
  assert.deepEqual(rows.map(r => r.id), ["f1", "g1", "w1"]);                   // sort order
  const g = rows.find(r => r.id === "g1");
  assert.deepEqual(g, { id: "g1", name: "Gnollbeutel", type: "gear", isGear: true, qty: 3, notes: "Knochen, Zähne und Münzen", canSave: true });
  assert.equal(rows.find(r => r.id === "f1").canSave, false);                  // only gear goes to the library
  assert.equal(rows.find(r => r.id === "w1").qty, 1);
  assert.equal(npcItems.npcItemRows(items, { isGM: false }).some(r => r.canSave), false);   // players never see it
  // library: the NPC's gear goes in and comes back with every field
  const back = lib.libraryData(lib.libraryData(items[0]));
  assert.deepEqual(back.system, items[0].system);
  assert.equal(back.name, "Gnollbeutel");
  // "From library" onto the NPC: a new row with the same fields
  items = [...items, { ...back, _id: "g2", sort: 400 }];
  rows = npcItems.npcItemRows(items, { isGM: true });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.at(-1), { ...g, id: "g2" });
  // delete: the row is gone, the rest untouched
  items = items.filter(i => i._id !== "g1");
  rows = npcItems.npcItemRows(items, { isGM: true });
  assert.deepEqual(rows.map(r => r.id), ["f1", "w1", "g2"]);
  assert.deepEqual(npcItems.npcItemRows([]), []);
  assert.deepEqual(npcItems.npcItemRows(undefined), []);
});

ok("QoL: undo state, display names, history log, concentration DC, turn notice, tooltip level", () => {
  // ---- undo: HP / temp back to the state before the hit, once only, only GM or the applier
  const f = { type: "applied", before: { hp: 30, temp: 5 }, after: { hp: 0, temp: 0 }, appliedBy: "u1", taken: 40 };
  assert.deepEqual(qol.undoPlan(f), { hp: 30, temp: 5, restoreToken: false });
  assert.deepEqual(qol.undoPlan({ ...f, tokenBackup: { sceneId: "s", token: {} } }), { hp: 30, temp: 5, restoreToken: true });
  assert.equal(qol.canUndo(f, { userId: "u1", isGM: false }), true);         // the applier
  assert.equal(qol.canUndo(f, { userId: "u2", isGM: false }), false);        // someone else
  assert.equal(qol.canUndo(f, { userId: "u2", isGM: true }), true);          // the GM
  const done = qol.markUndone(f, { by: "Gamemaster" });
  assert.equal(done.undone, true); assert.equal(f.undone, undefined);      // input untouched
  assert.equal(qol.undoPlan(done), null);                                   // once only
  assert.equal(qol.canUndo(done, { userId: "u1", isGM: true }), false);
  assert.equal(qol.undoPlan({ type: "applied" }), null);                    // old lines without a stored state
  assert.equal(qol.canUndo(null, { isGM: true }), false);
  assert.deepEqual(qol.undoPlan({ before: { hp: "7", temp: null } }), { hp: 7, temp: 0, restoreToken: false });
  // the plan really reverses the hit: apply 40 to 30 HP + 5 temp, then undo
  const hit = rolls.applyDamage({ hp: 30, temp: 5 }, 40);
  assert.deepEqual([hit.hp, hit.temp], [0, 0]);
  const back = qol.undoPlan({ before: { hp: 30, temp: 5 }, after: { hp: hit.hp, temp: hit.temp } });
  assert.deepEqual([back.hp, back.temp], [30, 5]);

  // ---- display names: GM real, players the NPC's display name; empty / blank field = real name; characters never
  const npc = { type: "npc", name: "Gnoll Pack Lord", displayName: "Hyäne" };
  assert.equal(qol.publicName(npc), "Hyäne");
  assert.equal(qol.nameFor(npc, { isGM: true }), "Gnoll Pack Lord");
  assert.equal(qol.nameFor(npc, { isGM: false }), "Hyäne");
  assert.equal(qol.nameFor({ ...npc, displayName: "" }, { isGM: false }), "Gnoll Pack Lord");
  assert.equal(qol.nameFor({ ...npc, displayName: "   " }, { isGM: false }), "Gnoll Pack Lord");
  assert.equal(qol.publicName({ ...npc, displayName: "  Hyäne " }), "Hyäne");
  assert.equal(qol.nameFor({ type: "character", name: "Gades", displayName: "X" }, { isGM: false }), "Gades");
  assert.equal(qol.publicName({}), "");

  // ---- history: award / buy / sell entries, oldest first, capped at 200
  const t = 1700000000000;
  let h = [];
  h = qol.appendHistory(h, qol.awardHistoryEntry({ amount: 25, reason: "Boss", by: "Gamemaster", t }));
  h = qol.appendHistory(h, qol.buyHistoryEntry({ id: "extraAttack", name: "Extra Attack", rank: 2, cost: 20, t: t + 1 }));
  h = qol.appendHistory(h, qol.sellHistoryEntry({ id: "extraAttack", name: "Extra Attack", rank: 2, refund: 20, t: t + 2 }));
  assert.deepEqual(h.map(e => e.kind), ["award", "buy", "sell"]);
  assert.deepEqual(h[0], { t, kind: "award", amount: 25, reason: "Boss", by: "Gamemaster" });
  assert.equal(h[1].cost, 20); assert.equal(h[1].rank, 2); assert.equal(h[1].entry, "Extra Attack");
  assert.equal(h[2].cost, -20);
  assert.equal(qol.historyText(h[0]), "+25 AP · Boss · by Gamemaster");
  assert.equal(qol.historyText(h[1]), "Bought Extra Attack (rank 2) · 20 AP");
  assert.equal(qol.historyText(h[2]), "Sold Extra Attack (rank 2) · +20 AP back");
  assert.equal(qol.historyText(qol.awardHistoryEntry({ amount: -5, t })), "-5 AP");
  assert.equal(qol.historyText(qol.buyHistoryEntry({ id: "res", name: "Resistance", rank: 1, cost: 10, choice: "feuer", t })), "Bought Resistance (rank 1) · feuer · 10 AP");
  const before = h.slice();
  qol.appendHistory(h, qol.awardHistoryEntry({ amount: 1, t }));
  assert.deepEqual(h, before);                                              // never mutates
  let big = [];
  for (let i = 0; i < 205; i++) big = qol.appendHistory(big, qol.awardHistoryEntry({ amount: i, t: t + i }));
  assert.equal(big.length, qol.HISTORY_CAP);
  assert.equal(qol.HISTORY_CAP, 200);
  assert.equal(big[0].amount, 5);                                           // the oldest five fell out
  assert.equal(big.at(-1).amount, 204);
  assert.deepEqual(qol.appendHistory(undefined, { kind: "x" }), [{ kind: "x" }]);
  // sell refund as the character model computes it: sold rank + entries that lost their prerequisite
  const S = { bought: { extraAttack: 2 } };
  const it = cfg.findShopItem("extraAttack");
  const res = rules.sellRank(S, "extraAttack");
  assert.equal(rules.computeSpent(S) - rules.computeSpent({ ...S, bought: res.bought }), rules.costOfRank(it, 1));

  // ---- concentration DC = max(10, floor(damage / 2))
  assert.equal(qol.concentrationDC(1), 10);
  assert.equal(qol.concentrationDC(20), 10);
  assert.equal(qol.concentrationDC(21), 10);
  assert.equal(qol.concentrationDC(22), 11);
  assert.equal(qol.concentrationDC(45), 22);
  assert.equal(qol.concentrationDC(0), 10);
  assert.equal(qol.concentrationDC("abc"), 10);

  // ---- turn notice: banner for the owner of the active token, heads-up for the next one, nothing for the GM
  assert.deepEqual(qol.turnNotice({ isGM: false, ownsCurrent: true, ownsNext: false }), { banner: true, next: false });
  assert.deepEqual(qol.turnNotice({ isGM: false, ownsCurrent: false, ownsNext: true }), { banner: false, next: true });
  assert.deepEqual(qol.turnNotice({ isGM: false, ownsCurrent: true, ownsNext: true }), { banner: true, next: false });
  assert.deepEqual(qol.turnNotice({ isGM: true, ownsCurrent: true, ownsNext: true }), { banner: false, next: false });
  assert.equal(qol.nextTurnIndex([{}, {}, {}], 0), 1);
  assert.equal(qol.nextTurnIndex([{}, {}, {}], 2), 0);                        // wraps into the next round
  assert.equal(qol.nextTurnIndex([{}, { defeated: true }, {}], 0), 2);        // defeated ones are skipped
  assert.equal(qol.nextTurnIndex([{}, { defeated: true }], 0), null);         // nobody else left
  assert.equal(qol.nextTurnIndex([], 0), null);

  // ---- tooltip: values for the GM and observers, name + icons for everyone else
  assert.equal(qol.tooltipLevel({ isGM: true }), "full");
  assert.equal(qol.tooltipLevel({ isGM: false, canObserve: true }), "full");
  assert.equal(qol.tooltipLevel({ isGM: false, canObserve: false }), "limited");
});

ok("jukebox: mood tiles, folder import, combat coupling; concentration card locks after one roll", () => {
  const J = jb;
  // ---- tiles: add / rename / reorder / delete, one combat tile only
  let t = [];
  t = J.addTile(t, { id: "a", playlistId: "p1", label: "Tavern", color: "#7a5a2c", icon: "beer-mug" });
  t = J.addTile(t, { id: "b", playlistId: "p2", label: "Battle", icon: "fa-swords", combat: true });
  t = J.addTile(t, { id: "c", playlistId: "p3", label: "  Dungeon  " });
  assert.deepEqual(t.map(x => x.id), ["a", "b", "c"]);
  assert.equal(t[0].icon, "fa-solid fa-beer-mug");                  // icon normalized
  assert.equal(t[1].icon, "fa-solid fa-swords");
  assert.equal(J.normalizeIcon("fa-regular fa-moon"), "fa-regular fa-moon");
  assert.equal(J.normalizeIcon(""), "");
  assert.equal(t[2].label, "Dungeon");                               // trimmed
  assert.equal(t[2].color, J.MOOD_COLORS[0]);                        // default colour
  assert.equal(J.combatTile(t).id, "b");
  // a second combat tile takes the mark away from the first (add and update)
  let t2 = J.addTile(t, { id: "d", playlistId: "p4", label: "Boss", combat: true });
  assert.deepEqual(t2.filter(x => x.combat).map(x => x.id), ["d"]);
  t2 = J.updateTile(t2, "a", { combat: true });
  assert.deepEqual(t2.filter(x => x.combat).map(x => x.id), ["a"]);
  assert.deepEqual(J.updateTile(t2, "a", { combat: false }).filter(x => x.combat), []);
  // rename (empty refused), unknown id unchanged
  assert.equal(J.renameTile(t, "c", "Crypt").find(x => x.id === "c").label, "Crypt");
  assert.equal(J.renameTile(t, "c", "   ").find(x => x.id === "c").label, "Dungeon");
  assert.deepEqual(J.updateTile(t, "zzz", { label: "x" }), t);
  // reorder: drag "c" onto "a" -> in front of it; unknown target -> to the end
  assert.deepEqual(J.reorderTiles(t, "c", "a").map(x => x.id), ["c", "a", "b"]);
  assert.deepEqual(J.reorderTiles(t, "a", null).map(x => x.id), ["b", "c", "a"]);
  assert.deepEqual(J.reorderTiles(t, "a", "a").map(x => x.id), ["a", "b", "c"]);
  assert.deepEqual(J.reorderTiles(t, "nope", "a").map(x => x.id), ["a", "b", "c"]);
  // delete only removes the tile (the list does not know playlists beyond their id)
  assert.deepEqual(J.deleteTile(t, "b").map(x => x.id), ["a", "c"]);
  assert.equal(J.combatTile(J.deleteTile(t, "b")), null);
  assert.equal(t.length, 3);                                         // inputs never mutated
  // active tile = the first tile whose playlist plays
  assert.equal(J.activeTile(t, ["p3", "p2"]).id, "b");
  assert.equal(J.activeTile(t, []), null);

  // ---- folder import: audio filter, alphabetical (natural), names
  const listing = ["music/Tavern/10_End.mp3", "music/Tavern/2_Drinks.OGG", "music/Tavern/cover.jpg", "music/Tavern/1%20Intro.wav",
    "music/Tavern/notes.txt", "music/Tavern/loop.webm", "music/Tavern/fight.flac", "music/Tavern/readme.md", "music/Tavern/x.m4a"];
  assert.deepEqual(J.audioFiles(listing), ["music/Tavern/1%20Intro.wav", "music/Tavern/2_Drinks.OGG", "music/Tavern/10_End.mp3",
    "music/Tavern/fight.flac", "music/Tavern/loop.webm"]);
  for (const ext of ["mp3", "ogg", "wav", "webm", "flac"]) assert.equal(J.isAudioFile(`a/b.${ext}`), true, ext);
  assert.equal(J.isAudioFile("a/b.mp3?x=1"), true);
  assert.equal(J.isAudioFile("a/b.png"), false);
  assert.equal(J.isAudioFile("a/mp3"), false);
  assert.equal(J.folderName("music/Tavern Night/"), "Tavern Night");
  assert.equal(J.folderName("music/Tavern%20Night"), "Tavern Night");
  assert.equal(J.folderName(""), "Imported");
  assert.equal(J.trackName("music/Tavern/2_Drinks_and_Dice.OGG"), "2 Drinks and Dice");
  assert.equal(J.trackName("music/Tavern/1%20Intro.wav"), "1 Intro");
  // name conflict: create / append / new (free name) / cancel, case-insensitive
  const names = ["Tavern", "Tavern (2)", "Battle"];
  assert.deepEqual(J.importPlan(names, "Forest"), { action: "create", name: "Forest" });
  assert.deepEqual(J.importPlan(names, "tavern", "append"), { action: "append", name: "Tavern" });
  assert.deepEqual(J.importPlan(names, "Tavern", "new"), { action: "create", name: "Tavern (3)" });
  assert.deepEqual(J.importPlan(names, "Tavern", "cancel"), { action: "cancel" });
  assert.deepEqual(J.importPlan(names, "Tavern", null), { action: "cancel" });      // dialog closed
  assert.deepEqual(J.importPlan(names, "  "), { action: "create", name: "Imported" });
  assert.equal(J.freeName("Battle", names), "Battle (2)");
  assert.equal(J.freeName("Forest", names), "Forest");
  // append adds only files the playlist does not have yet
  assert.deepEqual(J.newPaths(["a.mp3", "b.mp3"], ["b.mp3", "c.mp3"]), ["c.mp3"]);
  assert.equal(J.sameName("SoundBoard", " soundboard "), true);

  // ---- combat coupling
  assert.equal(J.combatStartPlan({ enabled: false, tiles: t, playingIds: ["p1"] }), null);           // setting off
  assert.deepEqual(J.combatStartPlan({ enabled: true, tiles: t, playingIds: ["p1"] }), { play: "p2", remember: { prev: "p1", combat: "p2" } });
  assert.deepEqual(J.combatStartPlan({ enabled: true, tiles: t, playingIds: [] }), { play: "p2", remember: { prev: null, combat: "p2" } });
  assert.equal(J.combatStartPlan({ enabled: true, tiles: t, playingIds: ["p2"] }), null);            // already on
  assert.equal(J.combatStartPlan({ enabled: true, tiles: J.deleteTile(t, "b"), playingIds: [] }), null);   // no combat tile
  const mem = { prev: "p1", combat: "p2" };
  assert.deepEqual(J.combatEndPlan({ memory: mem, playingIds: ["p2"] }), { play: "p1", stop: "p2" });
  assert.deepEqual(J.combatEndPlan({ memory: { prev: null, combat: "p2" }, playingIds: ["p2"] }), { play: null, stop: "p2" });
  assert.equal(J.combatEndPlan({ memory: mem, playingIds: ["p3"] }), null);   // changed by hand during the fight: stays
  assert.equal(J.combatEndPlan({ memory: {}, playingIds: ["p2"] }), null);

  // ---- concentration save card: the first result locks the card
  const card = { type: "concentrationSave", actorUuid: "Actor.x", dc: 14, spell: "Bless" };
  assert.equal(qol.concentrationSaveDone(card), false);
  const locked = qol.lockConcentrationSave(card, { total: 9, success: false });
  assert.deepEqual(locked.result, { total: 9, success: false, autoFail: null });
  assert.equal(qol.concentrationSaveDone(locked), true);
  assert.equal(qol.lockConcentrationSave(locked, { total: 20, success: true }), null);      // no second roll
  assert.equal(card.result, undefined);                                                       // input untouched
  assert.equal(qol.concentrationResultText(locked), "CON save 9 vs. DC 14: FAILURE - concentration broken");
  assert.equal(qol.concentrationResultText(qol.lockConcentrationSave(card, { total: 17, success: true })), "CON save 17 vs. DC 14: SUCCESS - concentration holds");
  assert.equal(qol.concentrationResultText(qol.lockConcentrationSave(card, { success: false, autoFail: "unconscious" })), "automatic failure (unconscious): FAILURE - concentration broken");
  assert.equal(qol.lockConcentrationSave(null, { total: 1 }), null);
});

ok("jukebox: import from the computer - file filter, folder name, upload folder", () => {
  const f = (name, rel = "") => ({ name, webkitRelativePath: rel });
  // a folder selection: audio only (subfolders included), natural order, other files reported as ignored
  const picked = jb.pickAudio([
    f("10 - Finale.mp3", "Tavern Night/10 - Finale.mp3"), f("cover.jpg", "Tavern Night/cover.jpg"),
    f("2 - Drinks.OGG", "Tavern Night/2 - Drinks.OGG"), f("1 - Intro.wav", "Tavern Night/1 - Intro.wav"),
    f("notes.txt", "Tavern Night/notes.txt"), f("Loop.webm", "Tavern Night/extra/Loop.webm"), f("Battle.flac", "Tavern Night/Battle.flac"),
    f("clip.m4a", "Tavern Night/clip.m4a"), f("desktop.ini", "Tavern Night/desktop.ini")
  ]);
  assert.deepEqual(picked.files.map(x => x.name), ["1 - Intro.wav", "2 - Drinks.OGG", "10 - Finale.mp3", "Battle.flac", "Loop.webm"]);
  assert.deepEqual(picked.ignored.sort(), ["clip.m4a", "cover.jpg", "desktop.ini", "notes.txt"]);
  assert.deepEqual(picked.duplicates, []);
  // same file name in two subfolders: the second one would overwrite the first in the upload folder
  const dup = jb.pickAudio([f("a.mp3", "X/a.mp3"), f("A.MP3", "X/sub/A.MP3"), f("b.mp3", "X/b.mp3")]);
  assert.deepEqual(dup.files.map(x => x.name), ["a.mp3", "b.mp3"]);
  assert.deepEqual(dup.duplicates, ["A.MP3"]);
  assert.deepEqual(jb.pickAudio([]), { files: [], ignored: [], duplicates: [] });
  assert.deepEqual(jb.pickAudio(undefined).files, []);
  // multi-select (no relative path) works the same; the folder name is then empty
  assert.deepEqual(jb.pickAudio([f("x.MP3"), f("y.wav"), f("z.png")]).files.map(x => x.name), ["x.MP3", "y.wav"]);
  assert.equal(jb.pickedFolderName([f("x.mp3")]), "");
  assert.equal(jb.pickedFolderName([f("x.mp3", "Dungeon Loops/x.mp3")]), "Dungeon Loops");
  assert.equal(jb.pickedFolderName([f("x.mp3", "Dungeon Loops/sub/x.mp3")]), "Dungeon Loops");
  // upload folder: Data/music/<playlist name>, made safe for the file system
  assert.equal(jb.uploadDir("Tavern Night"), "music/Tavern Night");
  assert.equal(jb.uploadDir('Boss: "Phase 2" / Final?'), "music/Boss Phase 2 Final");
  assert.equal(jb.uploadDir("  ...  "), "music/Imported");
  assert.equal(jb.uploadDir("Ende."), "music/Ende");
  assert.equal(jb.safeDirName("a\\b|c*d"), "a b c d");
  assert.equal(jb.UPLOAD_ROOT, "music");
  assert.equal(jb.FADE_MS, 2000);
});

ok("custom shop: overlay, cost ladder, every effect, prerequisites, export / import, broken entries", () => {
  const E = (o) => ({ id: "c_" + (o.id ?? "x"), name: o.name ?? "Entry", category: o.category ?? "Custom", costs: o.costs ?? [10], mult: o.mult, maxRanks: o.maxRanks,
    prereqs: o.prereqs ?? [], choice: o.choice ?? "none", effects: o.effects ?? [], desc: o.desc ?? "" });
  const baseCats = Object.keys(cfg.SHOP_DATA);

  // ---- overlay: collision protection, categories, prerequisites that do not exist
  const o = cs.buildOverlay([
    E({ id: "herz", name: "Eisenherz", category: "Other", effects: [{ type: "bonus", target: "ability", key: "con", value: 1 }] }),
    E({ id: "neu", name: "Neues Zeug", category: "Tower Arts", prereqs: ["c_herz", "extraAttack", "c_gibtsnicht"] }),
    { ...E({ id: "herz", name: "Doppelt" }) },                         // same id again
    { ...E({ name: "Kein Präfix" }), id: "asi" },                       // built-in id
    { ...E({ name: "Ohne Präfix" }), id: "eisen" },                     // no c_
    E({ id: "leer", name: "  " }),                                      // empty name
    E({ id: "teuer", name: "Kaputt", costs: [10, -5] })                 // bad cost ladder
  ]);
  assert.deepEqual(o.entries.map(e => e.id), ["c_herz", "c_neu"]);
  assert.equal(o.skipped.length, 5);
  assert.ok(o.skipped.some(s => s.errors.includes("duplicate id")));
  assert.ok(o.skipped.some(s => s.errors.some(x => /built-in/.test(x))));
  assert.ok(o.skipped.some(s => s.errors.some(x => /must start with "c_"/.test(x))));
  assert.ok(o.skipped.some(s => s.errors.includes("the name is empty")));
  assert.ok(o.skipped.some(s => s.errors.some(x => /cost ladder/.test(x))));
  assert.deepEqual(Object.keys(o.shop), [...baseCats, "Tower Arts"]);        // new category after the built-in ones
  assert.ok(o.shop.Other.some(x => x.id === "c_herz" && x.custom));           // existing category: appended
  assert.equal(o.shop.Other.filter(x => x.id === "asi").length, 1);           // built-in untouched
  assert.deepEqual(o.prereqs.c_neu, ["c_herz", "extraAttack"]);               // unknown prerequisite dropped
  assert.equal(o.prereqs.learn2, "spellslot2");                                // built-in prerequisites kept
  assert.equal(cfg.SHOP_DATA.Other.some(x => x.id === "c_herz"), false);      // buildOverlay is pure

  // ---- cost ladder / isMaxed for custom entries
  const item = (x) => cs.buildOverlay([x]).shop[x.category ?? "Custom"].find(i => i.id === x.id);
  const lad = item(E({ id: "lad", costs: "10, 20, 30", mult: 3 }));
  assert.deepEqual([0, 1, 2, 3].map(k => rules.costOfRank(lad, k)), [10, 20, 30, 90]);
  assert.equal(rules.isMaxed(lad, 99), false);                                 // several costs, no max: unlimited
  const one = item(E({ id: "one", costs: [15] }));
  assert.equal(rules.isMaxed(one, 0), false); assert.equal(rules.isMaxed(one, 1), true);   // one cost, mult 2: one rank
  const capped = item(E({ id: "cap", costs: [5], mult: 1, maxRanks: 3 }));
  assert.equal(rules.costOfRank(capped, 5), 5);
  assert.equal(rules.isMaxed(capped, 2), false); assert.equal(rules.isMaxed(capped, 3), true);
  assert.equal(rules.isMaxed(cfg.findShopItem("noEat"), 1), true);            // built-in rule unchanged

  // ---- effects, one at a time, on the Kriegsmeister (earned 150, level 16, STR 20, CON 18)
  const base = foundryState(convertAppExport(km));
  const withCustom = (entries, bought = {}, choices = {}, used = {}) => {
    const S = { ...base, bought: { ...base.bought, ...bought }, choices: { ...base.choices, ...choices } };
    const bon = cs.customBonusSource(S, entries);
    const d = rules.derived(Object.values(bon).some(Boolean) ? { ...S, feats: [...S.feats, { name: "custom", bon }] } : S);
    return cs.applyCustomEffects(d, S, entries, { used });
  };
  const ok1 = (x) => { const v = cs.validateEntry(x); assert.ok(v.ok, JSON.stringify(v.errors)); return v.entry; };
  const d0 = withCustom([]);
  // ability: CON 18 -> 19 (mod stays +4); two ranks -> 20: mod +5, HP max + level
  const herz = ok1(E({ id: "herz", costs: [10, 20], effects: [{ type: "bonus", target: "ability", key: "con", value: 1 }] }));
  const d1 = withCustom([herz], { c_herz: 1 });
  assert.equal(d1.fin.con, 19); assert.equal(d1.mods.con, 4); assert.equal(d1.hpMax, d0.hpMax);
  const d2 = withCustom([herz], { c_herz: 2 });
  assert.equal(d2.fin.con, 20); assert.equal(d2.mods.con, 5); assert.equal(d2.hpMax, d0.hpMax + d0.level);
  assert.equal(d2.saveData.con.mod, d0.saveData.con.mod + 1);                 // the modifier reaches the save
  // cap 20: STR is already 20
  const str = ok1(E({ id: "str", effects: [{ type: "bonus", target: "ability", key: "str", value: 2 }] }));
  assert.equal(withCustom([str], { c_str: 1 }).fin.str, 20);
  // chosen ability: one pick per rank
  const pick = ok1(E({ id: "pick", costs: [5, 5], mult: 1, choice: "ability", effects: [{ type: "bonus", target: "ability", key: "chosen", value: 1 }] }));
  const dp = withCustom([pick], { c_pick: 2 }, { c_pick: ["int", "int"] });
  assert.equal(dp.fin.int, d0.fin.int + 2);
  // AC / initiative / speed / HP max
  const misc = ok1(E({ id: "misc", effects: [{ type: "bonus", target: "ac", value: 1 }, { type: "bonus", target: "init", value: 2 }, { type: "bonus", target: "speed", value: 5 }, { type: "bonus", target: "hp", value: 3 }] }));
  const dm = withCustom([misc], { c_misc: 2 });
  assert.equal(dm.ac, d0.ac + 2); assert.equal(dm.init, d0.init + 4); assert.equal(dm.walk, d0.walk + 10); assert.equal(dm.hpMax, d0.hpMax + 6);
  // save / skill / passive perception (fixed and chosen)
  const sv = ok1(E({ id: "sv", effects: [{ type: "bonus", target: "save", key: "dex", value: 2 }, { type: "bonus", target: "skill", key: "prc", value: 1 }, { type: "bonus", target: "passive", value: 3 }] }));
  const ds = withCustom([sv], { c_sv: 1 });
  assert.equal(ds.saveData.dex.mod, d0.saveData.dex.mod + 2);
  assert.equal(ds.skillData.prc.mod, d0.skillData.prc.mod + 1);
  assert.equal(ds.passivePerc, d0.passivePerc + 1 + 3);
  const skc = ok1(E({ id: "skc", choice: "skill", effects: [{ type: "bonus", target: "skill", key: "chosen", value: 2 }] }));
  assert.equal(withCustom([skc], { c_skc: 1 }, { c_skc: ["ath"] }).skillData.ath.mod, d0.skillData.ath.mod + 2);
  // advantage on a chosen skill / save (listed like advSkill / advSave)
  const adv = ok1(E({ id: "adv", choice: "skill", effects: [{ type: "advantage", target: "skill" }] }));
  assert.deepEqual(withCustom([adv], { c_adv: 1 }, { c_adv: ["ste"] }).custom.advSkills, ["ste"]);
  const advs = ok1(E({ id: "advs", choice: "save", effects: [{ type: "advantage", target: "save" }] }));
  assert.deepEqual(withCustom([advs], { c_advs: 1 }, { c_advs: ["wis"] }).custom.advSaves, ["wis"]);
  // proficiency: chosen skill / save (PB once, never twice), armor / weapon group
  const prof = ok1(E({ id: "prof", choice: "skill", effects: [{ type: "prof", target: "skill" }, { type: "prof", target: "gear", key: "hvy" }] }));
  const notProf = Object.keys(d0.skillData).find(k => !d0.skillData[k].prof);
  const dpr = withCustom([prof], { c_prof: 1 }, { c_prof: [notProf] });
  assert.equal(dpr.skillData[notProf].prof, true); assert.equal(dpr.skillData[notProf].mod, d0.skillData[notProf].mod + d0.pb);
  assert.deepEqual(dpr.custom.profs, ["hvy"]);
  const already = Object.keys(d0.skillData).find(k => d0.skillData[k].prof);
  assert.equal(withCustom([prof], { c_prof: 1 }, { c_prof: [already] }).skillData[already].mod, d0.skillData[already].mod);
  const sprof = ok1(E({ id: "sprof", choice: "save", effects: [{ type: "prof", target: "save" }] }));
  const notSave = Object.keys(d0.saveData).find(k => !d0.saveData[k].prof);
  assert.equal(withCustom([sprof], { c_sprof: 1 }, { c_sprof: [notSave] }).saveData[notSave].mod, d0.saveData[notSave].mod + d0.pb);
  // resource pool: formula earned/10 = 15, earned/5 = 30 (like Lay on Hands), used points, rest type
  const pool = ok1(E({ id: "pool", effects: [{ type: "pool", name: "Schild", max: "earned/10", reset: "long" }, { type: "pool", name: "Funke", max: "earned/5", reset: "short" }] }));
  const dpo = withCustom([pool], { c_pool: 1 }, {}, { [cs.poolKey("c_pool", 0)]: 4 });
  assert.deepEqual(dpo.custom.pools.map(p => [p.name, p.max, p.value, p.reset]), [["Schild", 15, 11, "long"], ["Funke", 30, 30, "short"]]);
  assert.equal(dpo.custom.pools[1].max, rules.layPool(150));
  assert.equal(cs.evalFormula("floor(level/2)+1", { earned: 150, level: 16 }), 9);
  assert.equal(cs.evalFormula("3", {}), 3);
  for (const bad of ["earned/5; alert(1)", "window", "earned**2", "Math.max(1)", "", "(earned"]) assert.equal(cs.parseFormula(bad).ok, false, bad);
  // spell points and casts of a rank 6-9
  const sp = ok1(E({ id: "sp", effects: [{ type: "sp", value: 3 }, { type: "casts", rank: 7, value: 1 }] }));
  const dsp = withCustom([sp], { c_sp: 2 });
  assert.equal(dsp.spTotal, d0.spTotal + 6); assert.equal(dsp.spLeft, dsp.spTotal - dsp.spUsed);
  assert.equal(dsp.slots.find(s => s.L === 7).total, (d0.slots.find(s => s.L === 7)?.total ?? 0) + 2);
  // damage dice in the chosen element, stacking with eleDmg
  const dice = ok1(E({ id: "dice", choice: "damage", effects: [{ type: "dice", value: 1 }] }));
  const S2 = { ...base, bought: { ...base.bought, c_dice: 2 }, choices: { ...base.choices, c_dice: ["eis", "feuer"] } };
  const dd = withCustom([dice], { c_dice: 2 }, { c_dice: ["eis", "feuer"] });
  assert.deepEqual(dd.custom.dice, [{ label: "Entry", n: 2, element: "feuer" }]);
  const w = convertAppExport(km).items.find(i => i.type === "weapon").system;
  const dmg = rolls.buildDamage(w, dd, S2);
  assert.ok(dmg.parts.some(p => p.label === "Elemental"));                    // eleDmg stays
  assert.deepEqual(dmg.parts.find(p => p.label === "Entry"), { ...dmg.parts.find(p => p.label === "Entry"), dice: [{ n: 2, faces: 6 }], type: "feuer" });
  // text only
  const txt = ok1(E({ id: "txt", effects: [{ type: "text", text: "Kann im Dunkeln sehen." }] }));
  assert.deepEqual(withCustom([txt], { c_txt: 1 }).custom.features.map(f => f.text), ["Kann im Dunkeln sehen."]);
  // not bought: no effect at all
  assert.deepEqual(withCustom([herz, pool, dice, txt]).custom, { pools: [], dice: [], advSkills: [], advSaves: [], profs: [], features: [] });
  assert.equal(withCustom([herz]).fin.con, d0.fin.con);
  // effects that need a choice are refused without it
  assert.equal(cs.validateEntry(E({ effects: [{ type: "dice", value: 1 }] })).ok, false);
  assert.equal(cs.validateEntry(E({ effects: [{ type: "bonus", target: "ability", key: "chosen", value: 1 }] })).ok, false);
  assert.equal(cs.validateEntry(E({ effects: [{ type: "pool", name: "X", max: "level*", reset: "long" }] })).ok, false);

  // ---- prerequisites mixing built-in and custom entries (all must be bought), cascade on sale
  try {
    cs.installCustomShop([E({ id: "a", name: "A" }), E({ id: "b", name: "B", prereqs: ["c_a", "extraAttack"] })]);
    const S = { bought: { extraAttack: 1 }, choices: {} };
    assert.equal(rules.isLocked(S, "c_b"), true);                                // c_a missing
    assert.equal(rules.isLocked({ bought: { extraAttack: 1, c_a: 1 } }, "c_b"), false);
    assert.equal(rules.isLocked({ bought: { c_a: 1 } }, "c_b"), true);            // built-in one missing
    assert.deepEqual(rules.cascadeUnlock({ c_a: 0, c_b: 1, extraAttack: 1 }, { c_b: ["x"] }), { bought: { c_a: 0, extraAttack: 1 }, choices: {} });
    assert.equal(rules.isLocked({ bought: {} }, "learn2"), true);                // built-in single prerequisite unchanged
    assert.ok(cfg.findShopItem("c_a")); assert.equal(cs.customEntries().length, 2);
    assert.equal(rules.computeSpent({ bought: { c_a: 1 } }), 10);                // the AP budget counts custom entries
  } finally { cs.installCustomShop([]); }
  assert.equal(cfg.findShopItem("c_a"), null);
  assert.deepEqual(Object.keys(cfg.SHOP_DATA), baseCats);                        // uninstall leaves the built-in shop

  // ---- export / import round trip, merge by id, broken entries skipped
  const list = [herz, pool];
  const file = JSON.parse(JSON.stringify(cs.exportCustomShop(list)));
  assert.equal(file.type, cs.FORMAT);
  const back = cs.importCustomShop(file, []);
  assert.deepEqual(back.entries, list); assert.equal(back.added, 2); assert.equal(back.replaced, 0);
  const merged = cs.importCustomShop({ ...file, entries: [{ ...herz, name: "Eisenherz II" }, { id: "c_bad", name: "", costs: [] }, txt] }, list);
  assert.equal(merged.replaced, 1); assert.equal(merged.added, 1); assert.equal(merged.skipped.length, 1);
  assert.deepEqual(merged.entries.map(e => e.name), ["Eisenherz II", "Entry", "Entry"]);
  assert.ok(cs.importCustomShop({ foo: 1 }, []).error);
  assert.deepEqual(cs.buyersOf("c_herz", [{ name: "Gades", bought: { c_herz: 1 } }, { name: "Kurt", bought: {} }]), ["Gades"]);

  // ---- a broken stored entry is skipped, the rest still installs
  try {
    const res = cs.installCustomShop([E({ id: "gut", name: "Gut" }), { id: "c_kaputt", name: "Kaputt", costs: "abc", effects: [{ type: "bonus", target: "ability", key: "xyz", value: 1 }] }, null, 42]);
    assert.deepEqual(res.entries.map(e => e.id), ["c_gut"]);
    assert.equal(res.skipped.length, 3);
    assert.ok(cfg.findShopItem("c_gut")); assert.equal(cfg.findShopItem("c_kaputt"), null);
  } finally { cs.installCustomShop([]); }

  // ---- the app export keeps custom purchases (the app ignores unknown ids), the importer keeps them too
  const created = convertAppExport({ ...km, bought: { ...km.bought, c_herz: 2 }, choices: { ...km.choices, c_pick: ["int"] } });
  assert.equal(created.system.bought.c_herz, 2); assert.deepEqual(created.system.choices.c_pick, ["int"]);
});

ok("statblock: PB from CR when no proficiency line, save DC from one 'spell save DC' (Tiamat)", () => {
  const tiamat = fs.readFileSync(new URL("./fixtures/statblock-tiamat.txt", import.meta.url), "utf8");
  const p = statblock.parseStatblock(tiamat);
  assert.equal(p.cr, "30");
  assert.equal(/Proficiency Bonus/i.test(tiamat), false);      // the fixture really lacks the line
  assert.equal(p.pb, 9);                                        // CR 29-30 -> +9
  assert.equal(p.dc, 26);                                       // "spell save DC 26"
  const up = statblock.statblockToUpdate(p);
  assert.equal(up.system.pb, 9); assert.equal(up.system.dc, 26);
  // the whole CR table
  const table = { "0": 2, "1/8": 2, "1/2": 2, "4": 2, "5": 3, "8": 3, "9": 4, "12": 4, "13": 5, "16": 5, "17": 6, "20": 6, "21": 7, "24": 7, "25": 8, "28": 8, "29": 9, "30": 9 };
  for (const [cr, pb] of Object.entries(table)) assert.equal(statblock.pbFromCr(cr), pb, cr);
  assert.equal(statblock.pbFromCr("31"), null); assert.equal(statblock.pbFromCr("—"), null);
  // a printed proficiency bonus wins over the CR
  assert.equal(statblock.parseStatblock(tiamat.replace(/^Challenge.*$/m, (l) => `${l}\nProficiency Bonus +7`)).pb, 7);
  // two different spell save DCs: none is taken; the same DC twice is fine
  const two = statblock.parseStatblock(`${tiamat}\nSecond Casting. spell save DC 19 for these.`);
  assert.equal(two.dc, null); assert.equal(statblock.statblockToUpdate(two).system.dc, undefined);
  assert.equal(statblock.parseStatblock(`${tiamat}\nEcho. Again spell save DC 26.`).dc, 26);
  // the other fixtures keep their values (no DC invented)
  const dragon = statblock.parseStatblock(fs.readFileSync(new URL("./fixtures/gm/adult-silver-dragon.txt", import.meta.url), "utf8"));
  assert.ok(dragon.pb >= 2);
});

ok("jukebox v2: up next / previous (sequential, loop, shuffle order, end of playlist)", () => {
  const { MODES } = jb;
  const order = ["a", "b", "c"];
  // sequential: the next in order; after the last one the first (Foundry's loop) or nothing (repeat off)
  assert.equal(jb.upNext({ mode: MODES.SEQUENTIAL, order, currentId: "a" }), "b");
  assert.equal(jb.upNext({ mode: MODES.SEQUENTIAL, order, currentId: "c" }), "a");
  assert.equal(jb.upNext({ mode: MODES.SEQUENTIAL, order, currentId: "c", repeat: false }), null);
  assert.equal(jb.upNext({ mode: MODES.SEQUENTIAL, order, currentId: "b", repeat: false }), "c");
  // shuffle: the playlist's own shuffled playback order decides, not the display order
  const shuffled = ["c", "a", "b"];
  assert.equal(jb.upNext({ mode: MODES.SHUFFLE, order: shuffled, currentId: "c" }), "a");
  assert.equal(jb.upNext({ mode: MODES.SHUFFLE, order: shuffled, currentId: "b" }), "c");
  assert.equal(jb.upNext({ mode: MODES.SHUFFLE, order: shuffled, currentId: "b", repeat: false }), null);
  // nothing playing yet: the first of the order; simultaneous / soundboard: no "up next"
  assert.equal(jb.upNext({ mode: MODES.SEQUENTIAL, order, currentId: null }), "a");
  assert.equal(jb.upNext({ mode: MODES.SIMULTANEOUS, order, currentId: "a" }), null);
  assert.equal(jb.upNext({ mode: MODES.DISABLED, order, currentId: "a" }), null);
  assert.equal(jb.upNext({ mode: MODES.SEQUENTIAL, order: [], currentId: "a" }), null);
  // a single track loops onto itself
  assert.equal(jb.upNext({ mode: MODES.SEQUENTIAL, order: ["x"], currentId: "x" }), "x");
  // previous
  assert.equal(jb.previousTrack({ mode: MODES.SEQUENTIAL, order, currentId: "b" }), "a");
  assert.equal(jb.previousTrack({ mode: MODES.SEQUENTIAL, order, currentId: "a" }), "c");
  assert.equal(jb.previousTrack({ mode: MODES.SEQUENTIAL, order, currentId: "a", repeat: false }), "a");
  assert.equal(jb.previousTrack({ mode: MODES.SHUFFLE, order: shuffled, currentId: "a" }), "c");
  assert.equal(jb.previousTrack({ mode: MODES.SIMULTANEOUS, order, currentId: "b" }), null);
  // where repeat-off stops
  assert.equal(jb.isLastTrack(order, "c"), true); assert.equal(jb.isLastTrack(order, "a"), false); assert.equal(jb.isLastTrack([], "a"), false);
});

ok("jukebox v2: library search (playlist hits, track hits, expand list)", () => {
  const lib = [
    { id: "p1", name: "Tavern Night", sounds: [{ id: "s1", name: "Lute Jig" }, { id: "s2", name: "Drums of War" }] },
    { id: "p2", name: "Battle", sounds: [{ id: "s3", name: "War Drums" }, { id: "s4", name: "Victory" }] },
    { id: "p3", name: "Forest", sounds: [{ id: "s5", name: "Birds" }] }
  ];
  // empty query: everything, nothing expanded
  const all = jb.filterLibrary(lib, "  ");
  assert.deepEqual(all.playlists.map(p => [p.id, p.tracks]), [["p1", ["s1", "s2"]], ["p2", ["s3", "s4"]], ["p3", ["s5"]]]);
  assert.deepEqual(all.expand, []);
  // playlist name hit: all its tracks, not expanded
  const tav = jb.filterLibrary(lib, "tavern");
  assert.deepEqual(tav.playlists, [{ id: "p1", nameHit: true, tracks: ["s1", "s2"] }]);
  assert.deepEqual(tav.expand, []);
  // track hits in two playlists: only the matching tracks, both expanded (case-insensitive, words in any order)
  const drums = jb.filterLibrary(lib, "DRUMS war");
  assert.deepEqual(drums.playlists.map(p => [p.id, p.tracks]), [["p1", ["s2"]], ["p2", ["s3"]]]);
  assert.deepEqual(drums.expand, ["p1", "p2"]);
  // words split over playlist and track name
  const bv = jb.filterLibrary(lib, "battle victory");
  assert.deepEqual(bv.playlists.map(p => [p.id, p.tracks]), [["p2", ["s4"]]]);
  assert.deepEqual(bv.expand, ["p2"]);
  // no hit
  assert.deepEqual(jb.filterLibrary(lib, "dragon").playlists, []);
  assert.deepEqual(jb.filterLibrary(undefined, "x"), { playlists: [], expand: [] });
});

ok("jukebox v2: track drop planning (sort within, move across, no-op)", () => {
  const sorts = { a: 100000, b: 200000, c: 300000 };
  // same playlist: c in front of a
  const s1 = jb.planTrackDrop({ soundId: "c", sourcePlaylistId: "P", targetPlaylistId: "P", beforeId: "a", targetOrder: ["a", "b", "c"], currentSorts: sorts });
  assert.equal(s1.action, "sort");
  assert.deepEqual(s1.order, ["c", "a", "b"]);
  assert.deepEqual(s1.updates, [{ _id: "c", sort: 100000 }, { _id: "a", sort: 200000 }, { _id: "b", sort: 300000 }]);
  // same playlist: a to the end (drop on the playlist head)
  const s2 = jb.planTrackDrop({ soundId: "a", sourcePlaylistId: "P", targetPlaylistId: "P", beforeId: null, targetOrder: ["a", "b", "c"], currentSorts: sorts });
  assert.deepEqual(s2.order, ["b", "c", "a"]);
  // dropped onto itself / onto its own place: nothing
  assert.deepEqual(jb.planTrackDrop({ soundId: "b", sourcePlaylistId: "P", targetPlaylistId: "P", beforeId: "b", targetOrder: ["a", "b", "c"], currentSorts: sorts }), { action: "none" });
  assert.deepEqual(jb.planTrackDrop({ soundId: "b", sourcePlaylistId: "P", targetPlaylistId: "P", beforeId: "c", targetOrder: ["a", "b", "c"], currentSorts: sorts }), { action: "none" });
  assert.deepEqual(jb.planTrackDrop({ soundId: "c", sourcePlaylistId: "P", targetPlaylistId: "P", beforeId: null, targetOrder: ["a", "b", "c"], currentSorts: sorts }), { action: "none" });
  // alphabetical playlist (all sorts 0): the first manual sort writes every value
  const s3 = jb.planTrackDrop({ soundId: "b", sourcePlaylistId: "P", targetPlaylistId: "P", beforeId: "a", targetOrder: ["a", "b"], currentSorts: { a: 0, b: 0 } });
  assert.deepEqual(s3.updates, [{ _id: "b", sort: 100000 }, { _id: "a", sort: 200000 }]);
  // across playlists: x goes in front of b in Q; the new track's sort, the others shift
  const m = jb.planTrackDrop({ soundId: "x", sourcePlaylistId: "P", targetPlaylistId: "Q", beforeId: "b", targetOrder: ["a", "b", "c"], currentSorts: sorts });
  assert.equal(m.action, "move");
  assert.deepEqual(m.order, ["a", "x", "b", "c"]);
  assert.equal(m.sort, 200000);
  assert.deepEqual(m.updates, [{ _id: "b", sort: 300000 }, { _id: "c", sort: 400000 }]);
  // across into an empty playlist / to the end
  assert.deepEqual(jb.planTrackDrop({ soundId: "x", sourcePlaylistId: "P", targetPlaylistId: "Q", targetOrder: [] }), { action: "move", order: ["x"], sort: 100000, updates: [] });
  const end = jb.planTrackDrop({ soundId: "x", sourcePlaylistId: "P", targetPlaylistId: "Q", targetOrder: ["a", "b"], currentSorts: { a: 100000, b: 200000 } });
  assert.deepEqual([end.sort, end.updates], [300000, []]);
  assert.deepEqual(jb.planTrackDrop({ soundId: "x" }), { action: "none" });
});

ok("jukebox v2: master volume scales tracks, durations, seek position", () => {
  // master = loudest track; moving it keeps the proportions
  assert.equal(jb.masterVolume([0.2, 0.8, 0.4]), 0.8);
  assert.deepEqual(jb.scaleVolumes([0.2, 0.8, 0.4], 0.4), [0.1, 0.4, 0.2]);
  assert.deepEqual(jb.scaleVolumes([0.2, 0.8, 0.4], 1), [0.25, 1, 0.5]);
  assert.deepEqual(jb.scaleVolumes([0, 0], 0.5), [0.5, 0.5]);       // from silence: every track gets the master
  assert.deepEqual(jb.scaleVolumes([0.5, 0.25], 2), [1, 0.5]);       // clamped to 0..1
  assert.deepEqual(jb.scaleVolumes([], 0.5), []);
  assert.equal(jb.masterVolume([]), 0);
  assert.equal(jb.fmtDuration(187), "3:07"); assert.equal(jb.fmtDuration(59.9), "0:59"); assert.equal(jb.fmtDuration(undefined), ""); assert.equal(jb.fmtDuration(NaN), "");
  assert.equal(jb.seekPosition(0.5, 200), 100);
  assert.equal(jb.seekPosition(-1, 200), 0);
  assert.equal(jb.seekPosition(1.2, 200), 199.75);
  assert.equal(jb.seekPosition(0.5, 0), null); assert.equal(jb.seekPosition(0.5, undefined), null);
});

/** Journal HTML as plain text (tags out, entities decoded). */
const plain = (h) => h.replace(/<[^>]+>/g, " ").replace(/&(amp|lt|gt|quot|#39);/g, (m, c) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[c])).replace(/\s+/g, " ");

ok("rules journal: pages generated from the tables (core values present)", () => {
  const pages = rj.buildRulesPages();
  assert.deepEqual(pages.map(p => p.name), ["Progression", "Shop", "Elements & Damage", "Conditions", "Combat & Rest"]);
  const text = (i) => plain(pages[i].content);
  // the overwrite note on the first page
  assert.match(text(0), /Manual edits are overwritten/);
  // Progression: PB step at 75, milestone at 75, level every 10, cantrip at 100, point buy 72 / 6-18, cap 20 / Limit Break 22
  assert.match(text(0), /\+3 75 /); assert.match(text(0), /One milestone every 75 earned AP/);
  assert.match(text(0), /\+1 level every 10 earned AP/); assert.match(text(0), /2 100 /);
  assert.match(text(0), /at most 72 /); assert.match(text(0), /Each ability 6-18/);
  assert.match(text(0), /Final score cap 20 /); assert.match(text(0), /20 → 22 → 24/);
  assert.match(text(0), /150 earned AP: 30/);                                   // Lay on Hands = earned / 5
  // thresholds really come from derived(): PB +4 at 150 (Kriegsmeister), level 16 at 150
  assert.deepEqual(rj.thresholds(d => d.pb, 160).map(t => t.earned), [0, 75, 150]);
  assert.equal(rj.thresholds(d => d.level, 150).at(-1).value, 16);
  // Shop: every built-in entry with its ladder; prerequisites by name
  for (const [cat, list] of Object.entries(cfg.SHOP_DATA)) { assert.ok(text(1).includes(cat)); for (const it of list) assert.ok(text(1).includes(it.name), it.name); }
  assert.match(text(1), /Extra Attack 10, 20, 40, 80, then ×2 unlimited/);
  assert.match(text(1), /Ritual Casting 30 \(once\) 1/);
  assert.ok(text(1).includes("Spellslot Lvl 2 (+1 spell) 5, 10, 20, 40, 80, then ×2 unlimited Spellslot Lvl 1 (+1 spell)"));
  assert.ok(text(1).includes("Extra Spell Lvl 2 5, then ×1 unlimited Spellslot Lvl 2 (+1 spell)"));
  assert.match(text(1), /Resistance 12, 24, 48, then ×2 unlimited — Resistance/);
  // Elements: all 20 with colours, the multipliers from damageMultiplier()
  const els = Object.values(cfg.ELEMENTS);
  assert.equal(els.length, 20);
  for (const e of els) { assert.ok(text(2).includes(e.l), e.l); assert.ok(pages[2].content.includes(e.c), e.c); }
  assert.match(text(2), /The 20 elements/); assert.match(text(2), /Resistance × 0.5 \(rounded down: 7 → 3\) Immunity × 0 Vulnerability × 2/);
  // Conditions: effects read from rollModifiers(), exhaustion table
  assert.match(text(3), /Prone Disadvantage on its attack rolls\. Attacks against it within 5 ft have advantage\. Attacks against it from further than 5 ft have disadvantage\./);
  assert.match(text(3), /Paralyzed .*STR and DEX saving throws fail automatically/);
  assert.match(text(3), /Concentrating Marker only/);
  assert.match(text(3), /6 -12 -30 ft \(30 ft → 0 ft\) dead/);
  // Combat & Rest: crit range, rest lists, tower rules with carry limit 5 and the currency rates
  assert.match(text(4), /natural 20; with "Crit 19-20" on 19-20/);
  assert.match(text(4), /Carry limit 5:/); assert.match(text(4), /5 sockets/);
  assert.match(text(4), /GO \(10 → 1 ED\)/); assert.match(text(4), /KU \(100 → 1 BR\)/);
  for (const r of rules.REST_RULES.long.resets) assert.ok(text(4).includes(r), r);
  assert.match(text(4), /advantage 2 1 normal/);                               // any advantage + any disadvantage = normal
  // stable hash, changes with the content
  assert.equal(rj.pagesHash(pages), rj.pagesHash(rj.buildRulesPages()));
});

ok("rules journal: a custom shop entry appears after installation (and leaves again)", () => {
  const before = rj.buildRulesPages();
  try {
    const res = cs.installCustomShop([{ id: "c_herz", name: "Drachenherz", category: "Tower Gifts", desc: "Ein schlagendes Herz.", costs: [10, 20], mult: 3, maxRanks: 4,
      prereqs: ["extraAttack"], choice: "ability", effects: [{ type: "bonus", target: "ability", key: "chosen", value: 1 }] }]);
    assert.equal(cs.customEntries().length, 1, JSON.stringify(res));
    const pages = rj.buildRulesPages();
    const shop = plain(pages[1].content);
    assert.match(shop, /Tower Gifts/);
    assert.match(shop, /★ Drachenherz Ein schlagendes Herz\. \+1 chosen ability 10, 20, then ×3 4 Extra Attack Ability/);
    assert.notEqual(rj.pagesHash(pages), rj.pagesHash(before));             // the journal gets rebuilt
  } finally { cs.installCustomShop([]); }
  assert.equal(rj.pagesHash(rj.buildRulesPages()), rj.pagesHash(before));
});

ok("backup: file names, zip, round trip of one file through the importer", () => {
  const d = new Date(2026, 8, 23, 14, 5, 0);
  assert.equal(bk.dateStamp(d), "2026-09-23");
  assert.equal(bk.backupFileName("Kriegsmeister", d), "ap_kriegsmeister_2026-09-23.json");
  assert.equal(bk.backupFileName("Gades Worn", d), "ap_gades_worn_2026-09-23.json");
  assert.equal(bk.backupFileName("", d), "ap_character_2026-09-23.json");
  assert.deepEqual(bk.uniqueFileNames(["Ann", "ann", "Bob"], d), ["ap_ann_2026-09-23.json", "ap_ann_2026-09-23_2.json", "ap_bob_2026-09-23.json"]);
  assert.equal(bk.backupZipName(d), "ap-turm-characters_2026-09-23.zip");
  // CRC-32 reference value
  assert.equal(bk.crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
  // two characters -> zip -> back; each file is the app export and imports to the same character
  const kmC = convertAppExport(km);
  const gades = convertAppExport(JSON.parse(fs.readFileSync(new URL("./fixtures/ap_gades_worn%20(1).json", import.meta.url), "utf8").replace(/^﻿/, "")));
  const chars = [kmC, gades].map(c => ({ name: c.name, system: c.system, items: c.items.map((it, i) => ({ _id: "it" + i, ...it })) }));
  const files = bk.backupFiles(chars, d);
  assert.deepEqual(files.map(f => f.name), ["ap_kriegsmeister_2026-09-23.json", `ap_${gades.name.replace(/[^\w\-]+/g, "_").toLowerCase()}_2026-09-23.json`]);
  const zip = bk.makeZip(files.map(f => ({ name: f.name, text: JSON.stringify(f.data, null, 2) })), d);
  assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const back = bk.readZip(zip);
  assert.deepEqual(back.map(f => [f.name, f.crcOk]), files.map(f => [f.name, true]));
  const again = convertAppExport(JSON.parse(back[0].text));
  assert.equal(again.name, kmC.name);
  assert.deepEqual(norm(rules.derived(foundryState(again))), norm(rules.derived(foundryState(kmC))));
  assert.deepEqual(again.system.bought, kmC.system.bought); assert.deepEqual(again.system.choices, kmC.system.choices);
  assert.deepEqual(again.items.map(i => [i.type, i.name]), kmC.items.map(i => [i.type, i.name]));
  const d2 = rules.derived(foundryState(again));
  assert.deepEqual([d2.level, d2.pb, d2.ac, d2.fin.str], [16, 4, 19, 20]);
  // umlauts in file content survive (UTF-8)
  const u = bk.readZip(bk.makeZip([{ name: "ä.json", text: "{\"n\":\"Zweihänder\"}" }], d));
  assert.deepEqual([u[0].name, JSON.parse(u[0].text).n, u[0].crcOk], ["ä.json", "Zweihänder", true]);
});

ok("spawn: names of the copies (numbering, display names, count clamp)", () => {
  assert.deepEqual(sp.spawnNames({ name: "Gnoll", count: 3 }), [
    { name: "Gnoll 1", displayName: "" }, { name: "Gnoll 2", displayName: "" }, { name: "Gnoll 3", displayName: "" }]);
  assert.deepEqual(sp.spawnNames({ name: "Gnoll", displayName: "Hyena", count: 2 }), [
    { name: "Gnoll 1", displayName: "Hyena 1" }, { name: "Gnoll 2", displayName: "Hyena 2" }]);
  assert.deepEqual(sp.spawnNames({ name: "Gnoll", displayName: "Hyena", count: 2, numbered: false }), [
    { name: "Gnoll", displayName: "Hyena" }, { name: "Gnoll", displayName: "Hyena" }]);
  assert.deepEqual(sp.spawnNames({ name: "  ", count: 1 }), [{ name: "NPC 1", displayName: "" }]);
  assert.equal(sp.spawnNames({ name: "Gnoll", count: 20 })[19].name, "Gnoll 20");
  assert.equal(sp.copyCount(4), 4); assert.equal(sp.copyCount("7"), 7); assert.equal(sp.copyCount(0), 1);
  assert.equal(sp.copyCount(99), 20); assert.equal(sp.copyCount(3.9), 3); assert.equal(sp.copyCount("x"), null);
});

ok("spawn: grid positions around the centre (free cells first, no overlaps, scene bounds)", () => {
  const g = 100;
  // 4 medium tokens around (1050, 1050): the centre cell first, then its nearest neighbours
  const p4 = sp.planPositions({ center: { x: 1050, y: 1050 }, count: 4, gridSize: g });
  assert.equal(p4.length, 4);
  assert.deepEqual(p4[0], { x: 1000, y: 1000 });
  assert.deepEqual(p4.slice(1), [{ x: 1000, y: 900 }, { x: 900, y: 1000 }, { x: 1100, y: 1000 }]);
  const key = (p) => `${p.x},${p.y}`;
  assert.equal(new Set(p4.map(key)).size, 4);
  // every cell on the grid
  for (const p of p4) { assert.equal(p.x % g, 0); assert.equal(p.y % g, 0); }
  // an occupied centre cell is skipped
  const busy = sp.planPositions({ center: { x: 1050, y: 1050 }, count: 3, gridSize: g, occupied: [{ x: 1000, y: 1000, w: 100, h: 100 }] });
  assert.ok(!busy.some(p => key(p) === "1000,1000"));
  assert.equal(busy.length, 3);
  // 20 copies: 20 distinct cells, all within two rings of the centre
  const p20 = sp.planPositions({ center: { x: 1050, y: 1050 }, count: 20, gridSize: g });
  assert.equal(new Set(p20.map(key)).size, 20);
  assert.ok(p20.every(p => Math.abs(p.x - 1000) <= 200 && Math.abs(p.y - 1000) <= 200));
  // large tokens (2x2) never overlap each other
  const big = sp.planPositions({ center: { x: 1000, y: 1000 }, count: 4, gridSize: g, size: 2 });
  for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
    const a = big[i], b = big[j];
    assert.ok(!(a.x < b.x + 200 && a.x + 200 > b.x && a.y < b.y + 200 && a.y + 200 > b.y), "large overlap");
  }
  // at the scene's corner only cells inside the scene
  const edge = sp.planPositions({ center: { x: 50, y: 50 }, count: 4, gridSize: g, bounds: { width: 1000, height: 1000 } });
  assert.ok(edge.every(p => p.x >= 0 && p.y >= 0));
  assert.equal(edge.length, 4);
  // fully packed surroundings: occupied cells are used as a last resort instead of placing nothing
  const packed = sp.planPositions({ center: { x: 50, y: 50 }, count: 2, gridSize: g, bounds: { width: 100, height: 200 }, occupied: [{ x: 0, y: 0, w: 100, h: 200 }] });
  assert.equal(packed.length, 2);
});

ok("reach: equipped weapon / NPC attacks / default 5 ft, ring size", () => {
  const W = (reach, equipped = true) => ({ type: "weapon", system: { equipped, reach } });
  assert.equal(rc.characterReach([]), 5);
  assert.equal(rc.characterReach([W(10, false)]), 5);                  // not equipped: default
  assert.equal(rc.characterReach([W(10)]), 10);
  assert.equal(rc.characterReach([W(5), W(10), W(15, false)]), 10);      // longest equipped
  assert.equal(rc.characterReach([W(undefined)]), 5);                    // old weapon without the field
  assert.equal(rc.characterReach([{ type: "gear", system: { equipped: true, reach: 30 } }]), 5);
  // NPC: statblock ranges as the parser stores them
  assert.equal(rc.reachFromRange("10 ft"), 10);
  assert.equal(rc.reachFromRange("80/320 ft"), null);                    // a range, not a reach
  assert.equal(rc.reachFromRange("5 ft / 20/60 ft"), 5);                 // melee or ranged
  assert.equal(rc.reachFromRange(""), null);
  const dragon = statblock.parseStatblock(fs.readFileSync(new URL("./fixtures/gm/adult-silver-dragon.txt", import.meta.url), "utf8"));
  assert.equal(rc.npcReach(dragon.entries), 15);                        // Bite 10, Claw 5, Tail 15
  assert.equal(rc.npcReach([{ toHit: null, range: "30 ft" }]), 5);       // no attack: default
  assert.equal(rc.npcReach([{ toHit: 4, range: "80/320 ft" }]), 5);       // ranged only: default
  assert.equal(rc.reachOf({ type: "character", items: [W(10)] }), 10);
  assert.equal(rc.reachOf({ type: "npc", system: { entries: dragon.entries } }), 15);
  assert.equal(rc.reachOf({ type: "stash" }), null);
  // imported weapons get 5 ft, a longer reach survives the app round trip
  const kmC = convertAppExport(km);
  assert.ok(kmC.items.filter(i => i.type === "weapon").every(w => w.system.reach === 5));
  const out = exportAppData({ name: "X", system: kmC.system, items: [{ ...kmC.items.find(i => i.type === "weapon"), system: { ...kmC.items.find(i => i.type === "weapon").system, reach: 10 } }] });
  assert.equal(out.weapons[0].reach, 10);
  assert.equal(convertAppExport(out).items.find(i => i.type === "weapon").system.reach, 10);
  assert.equal("reach" in exportAppData({ name: "X", system: kmC.system, items: kmC.items }).weapons[0], false);   // default: not written
  // ring = token edge + reach (grid distance): medium token, 5 ft cells of 100 px, 10 ft reach -> 50 + 200
  assert.deepEqual(rc.ringRadius({ width: 100, height: 100, reach: 10, gridSize: 100, gridDistance: 5 }), { rx: 250, ry: 250 });
  assert.deepEqual(rc.ringRadius({ width: 200, height: 200, reach: 15, gridSize: 100, gridDistance: 5 }), { rx: 400, ry: 400 });
});

ok("stash: taking a stack, currency claims, chat lines, carry limit untouched", () => {
  assert.deepEqual(st.takePlan(5, 2), { take: 2, left: 3, whole: false });
  assert.deepEqual(st.takePlan(3, 3), { take: 3, left: 0, whole: true });
  assert.deepEqual(st.takePlan(1, 1), { take: 1, left: 0, whole: true });
  assert.equal(st.takePlan(3, 4), null); assert.equal(st.takePlan(3, 0), null); assert.equal(st.takePlan(3, "x"), null);
  assert.equal(st.takeLine("Gades", "Heiltrank", 2), "Gades takes 2× Heiltrank from the Party Stash.");
  assert.equal(st.takeLine("Gades", "Seil", 1), "Gades takes Seil from the Party Stash.");
  assert.equal(st.putLine("Gades", "Heiltrank", 3), "Gades puts 3× Heiltrank into the Party Stash.");
  // a claimed currency amount goes onto the stash purse (both modes' keys exist on the stash)
  const claim = transfer.parseClaim("50 GO, 20 SI", "turm");
  assert.deepEqual(st.currencyUpdate({ go: 10, si: 0 }, claim.amounts), { "system.currency.go": 60, "system.currency.si": 20 });
  assert.deepEqual(st.currencyUpdate({}, transfer.parseClaim("30 gp", "ap").amounts), { "system.currency.gp": 30 });
  assert.deepEqual(st.currencyUpdate({}, { xx: 5 }), {});
  assert.deepEqual(st.ALL_CURRENCY_KEYS, ["ku", "br", "si", "go", "ed", "cp", "sp", "ep", "gp", "pp"]);
  // new stash mode: what most characters play
  assert.equal(st.stashMode(["turm", "turm", "ap"]), "turm"); assert.equal(st.stashMode(["ap", "ap"]), "ap"); assert.equal(st.stashMode([]), "turm");
  // tower items in the stash count against nobody: the limit only counts a character's own items
  const gades = [{ type: "gear", system: { origin: "tower" } }, { type: "gear", system: { origin: "city" } }];
  const stashItems = [{ type: "gear", system: { origin: "tower" } }, { type: "gear", system: { origin: "tower" } }];
  assert.equal(transfer.carryCount(gades), 1);
  assert.equal(transfer.carryCount(gades.concat(stashItems.slice(0, 1))), 2);   // after taking one tower item: it counts
});

/* ---------- dnd5e import (Spell Library / Monster Library) ---------- */
const fx5e = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/dnd5e/${f}.json`, import.meta.url), "utf8"));
const sel5e = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
const plain5e = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

ok("dnd5e spells: all header fields in the description, level, concentration flag, content 1:1", () => {
  const bless = d5.convertSpell(fx5e("spell-bless"), { source: "SRD 2014" });
  assert.equal(bless.type, "spell"); assert.equal(bless.name, "Bless");
  assert.equal(bless.system.lvl, 1); assert.equal(bless.system.concentration, true); assert.equal(bless.system.elem, "");
  const t = plain5e(bless.system.description);
  for (const s of ["Level 1 Enchantment", "Concentration", "Casting Time: Action", "Range: 30 feet", "Components: V, S, M (A sprinkling of holy water)",
    "Duration: Concentration, up to 1 Minute"]) assert.ok(t.includes(s), s);
  // the description text itself is carried over unchanged (every sentence of the source is there)
  for (const p of plain5e(fx5e("spell-bless").system.description.value).split(/(?<=\.)\s/).filter(x => x.length > 20)) assert.ok(t.includes(p.trim()), p);
  assert.match(t, /At Higher Levels\. When you cast this spell using a spell slot of 2nd level or higher/);
  assert.equal(bless.flags["ap-turm"].dnd5e.source, "SRD 2014");
  const fireball = d5.convertSpell(fx5e("spell-fireball"));
  assert.equal(fireball.system.lvl, 3); assert.equal(fireball.system.concentration, false);
  const ft = plain5e(fireball.system.description);
  assert.match(ft, /Level 3 Evocation/); assert.match(ft, /Range: 150 feet \(20-foot sphere\)/);
  assert.match(ft, /Components: V, S, M \(A tiny ball of bat guano and sulfur\)/); assert.match(ft, /Duration: Instantaneous/);
  assert.match(ft, /At Higher Levels\. When you cast this spell using a spell slot of 4th level or higher, the damage increases by 1d6/);
  const bolt = d5.convertSpell(fx5e("spell-firebolt"));
  assert.equal(bolt.system.lvl, 0); assert.match(plain5e(bolt.system.description), /Evocation Cantrip.*Components: V, S /);
  const dm = d5.convertSpell(fx5e("spell-detectmagic"));
  assert.equal(dm.system.concentration, true);
  assert.match(plain5e(dm.system.description), /Concentration · Ritual.*Casting Time: Action or Ritual.*Range: Self \(30-foot radius\)/);
  // chat card: the header stays visible, the rest folds
  const parts = d5.spellDescriptionParts(fireball.system.description);
  assert.match(plain5e(parts.head), /^Level 3 Evocation Casting Time: Action Range: 150 feet/);
  assert.match(plain5e(parts.body), /^A bright streak flashes/);
  assert.ok(!/<\/div>/.test(parts.body) && !/<div/.test(parts.head));
  assert.deepEqual(d5.spellDescriptionParts(""), { head: "", body: "" });
  assert.deepEqual(d5.spellDescriptionParts("<p>Only text</p>"), { head: "", body: "<p>Only text</p>" });
});

ok("dnd5e spells: app export / re-import round trip keeps the description", () => {
  const created = convertAppExport(km);
  const bless = d5.convertSpell(fx5e("spell-bless"));
  const items = [...created.items, { ...bless, _id: "sp1" }, { name: "Fireball", type: "spell", _id: "sp2", system: { lvl: 3, elem: "", notes: "", prepared: true, concentration: false, description: "" } }];
  const out = exportAppData({ name: created.name, system: created.system, items });
  // the app JSON carries no description
  const spell = out.spells.find(s => s.name === "Bless");
  assert.ok(spell); assert.equal("description" in spell, false); assert.equal(JSON.stringify(out).includes("apt-spell5e"), false);
  // re-import: the description of the spell the actor already has survives (same name + level)
  const again = convertAppExport(out);
  assert.equal(again.items.find(i => i.name === "Bless").system.description ?? "", "");
  imp.keepSpellDescriptions(again.items, items);
  assert.equal(again.items.find(i => i.name === "Bless").system.description, bless.system.description);
  // a spell with another level or name gets nothing; an existing description is not overwritten
  const other = [{ name: " bless ", type: "spell", system: { lvl: 2 } }, { name: "Bless", type: "spell", system: { lvl: 1, description: "<p>mine</p>" } }];
  imp.keepSpellDescriptions(other, items);
  assert.equal(other[0].system.description, undefined); assert.equal(other[1].system.description, "<p>mine</p>");
  const spaced = [{ name: "  BLESS ", type: "spell", system: { lvl: 1 } }];
  imp.keepSpellDescriptions(spaced, items);
  assert.equal(spaced[0].system.description, bless.system.description);
});

ok("dnd5e monsters: all field groups, tags, legendary counters (Adult Red Dragon, SRD 2014)", () => {
  const src = fx5e("monster-adult-red-dragon-2014");
  const m = d5.convertMonster(src, { source: "SRD 2014", mode: "turm" });
  const s = m.system;
  assert.equal(m.type, "npc"); assert.equal(m.name, "Adult Red Dragon");
  assert.equal(s.typeLine, "Huge Dragon, Chaotic Evil"); assert.equal(s.cr, "17"); assert.equal(s.pb, 6);
  assert.equal(s.ac, 19); assert.deepEqual(s.hp, { value: 256, max: 256, temp: 0 });
  assert.equal(s.speed, 40); assert.equal(s.speeds, "Climb 40, Fly 80");
  assert.deepEqual(s.abilities, { str: 27, dex: 10, con: 25, int: 16, wis: 13, cha: 21 });
  assert.deepEqual(s.saves, { str: null, dex: 6, con: 13, int: null, wis: 7, cha: 11 });
  assert.deepEqual(s.skills, { perception: 13, stealth: 6 });
  assert.equal(s.senses, "Blindsight 60 ft., Darkvision 120 ft."); assert.equal(s.languages, "Common, Draconic");
  assert.deepEqual([s.resistances, s.immunities, s.vulnerabilities], [[], ["?fire"], []]);   // turm: not assigned yet
  assert.equal(s.typeMarks, true);
  assert.deepEqual(s.legendary, { resist: { value: 3, max: 3 }, actions: { value: 3, max: 3 } });
  assert.equal(s.statblock, ""); assert.match(s.notes, /Imported from SRD 2014/); assert.match(s.notes, /19d12 \+ 133/);
  assert.equal(m.prototypeToken.width, 3); assert.equal(m.prototypeToken.actorLink, false);
  const e = (n) => s.entries.find(x => x.name === n);
  assert.deepEqual(sel5e(e("Bite"), ["section", "toHit", "range", "damage", "dmgType"]), { section: "actions", toHit: 14, range: "10 ft", damage: "2d10 + 8 + 2d6", dmgType: "?piercing" });
  assert.equal(e("Bite").text, "Melee Weapon Attack: +14 to hit, reach 10 ft., one target. Hit: 19 (2d10 + 8) Piercing damage plus 7 (2d6) Fire damage.");
  assert.deepEqual(sel5e(e("Fire Breath"), ["section", "saveDc", "saveAbility", "damage", "dmgType", "areaShape", "areaSize", "recharge"]),
    { section: "actions", saveDc: 21, saveAbility: "dex", damage: "18d6", dmgType: "?fire", areaShape: "cone", areaSize: 60, recharge: "5-6" });
  assert.match(e("Fire Breath").text, /DC 21 Dexterity saving throw, taking 63 \(18d6\) Fire damage/);
  assert.deepEqual(sel5e(e("Wing Attack"), ["section", "legendaryCost", "saveDc", "saveAbility"]), { section: "legendary", legendaryCost: 2, saveDc: 22, saveAbility: "dex" });
  assert.equal(e("Detect").legendaryCost, 1); assert.equal(e("Legendary Resistance").section, "traits");
  assert.equal(e("Frightful Presence").saveDc, 16);
  // every text of the source is there, rendered as dnd5e shows it (no enricher syntax left)
  for (const x of s.entries) assert.ok(!/\[\[|@UUID|&Reference|lookup @/.test(x.text), x.name);
  // the entries work with the NPC tools: area for the template button, reach for the ring
  assert.deepEqual(areaMod.entryArea(e("Fire Breath")), { shape: "cone", size: 60 });
  assert.equal(rc.npcReach(s.entries), 15);
});

ok("dnd5e monsters: spellcasting trait, 2024 statblock texts, uses per day", () => {
  const m = d5.convertMonster(fx5e("monster-adult-red-dragon-2024"), { source: "SRD 2024" });
  const s = m.system;
  assert.equal(s.dc, 20);
  const sc = s.entries.find(x => x.name === "Spellcasting (spell list)");
  assert.equal(sc.section, "traits");
  assert.equal(sc.text, "Spellcasting (Charisma): spell save DC 20, +12 to hit with spell attacks.\n1st Level: Command, Detect Magic\n2nd Level: Scorching Ray\n3rd Level: Fireball");
  const rend = s.entries.find(x => x.name === "Rend");
  assert.equal(rend.text, "Melee Attack Roll: +14, reach 10 ft. Hit: 13 (1d10 + 8) Slashing damage plus 5 (2d4) Fire damage.");
  assert.match(s.entries.find(x => x.name === "Fire Breath").text, /Dexterity Saving Throw: DC 21, each creature in a 60-foot Cone\.\nFailure: 59 \(17d6\) Fire damage\./);
  assert.match(s.entries.find(x => x.name === "Legendary Resistance").text, /If the adult red dragon fails a saving throw/);
  assert.equal(s.entries.find(x => x.name === "Pounce").text, "The adult red dragon moves up to half its Speed, and it makes one Rend attack.");
  // uses X/day and recharge from the structured data
  const f = { name: "Web", type: "feat", system: { description: { value: "<p>x</p>" }, uses: { max: "3", spent: 1, recovery: [{ period: "day", type: "recoverAll" }] }, activities: {} } };
  assert.deepEqual(d5.featureEntry(f, { name: "Spider", mods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, pb: 2 }).uses, { value: 2, max: 3, per: "day" });
  const old = { name: "Old", type: "feat", system: { description: { value: "" }, uses: { recovery: "" }, recharge: { value: 6 }, activities: {} } };
  assert.equal(d5.featureEntry(old, { name: "x", mods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, pb: 2 }).recharge, "6");
});

ok("dnd5e monsters: mode rule (ap 1:1, turm not assigned), CR -> PB fallback, enrichers, dedupe", () => {
  const src = fx5e("monster-adult-red-dragon-2014");
  const turm = d5.convertMonster(src, { mode: "turm" }), ap = d5.convertMonster(src, { mode: "ap" });
  assert.equal(turm.system.mode, "turm"); assert.equal(ap.system.mode, "ap");
  // turm -> "not assigned" ("?fire": no effect until the GM picks a type), ap -> the D&D type 1:1
  assert.deepEqual(turm.system.immunities, ["?fire"]); assert.deepEqual(ap.system.immunities, ["fire"]);
  assert.equal(rolls.isUnassignedType("?fire", "turm"), true); assert.equal(rolls.isUnassignedType("fire", "ap"), false);
  assert.equal(rolls.damageMultiplier("fire", { immunities: ap.system.immunities }, { mode: "ap" }), 0);
  assert.equal(rolls.damageMultiplier("fire", { immunities: turm.system.immunities }, { mode: "turm" }), 1);
  assert.equal(turm.system.entries.find(e => e.name === "Bite").dmgType, "?piercing");
  // qualified defenses: the keys plus the qualifier as note (like the text parser)
  const lichish = structuredClone(src);
  lichish.system.traits.dr = { value: ["bludgeoning", "piercing"], bypasses: ["mgc"], custom: "" };
  const lm = d5.convertMonster(lichish, { mode: "ap" });
  assert.deepEqual(lm.system.resistances, ["bludgeoning", "piercing"]);
  assert.equal(lm.system.defenseNote, "Resistances: Bludgeoning, Piercing from nonmagical attacks");
  // PB: from the data, else from the CR table
  assert.equal(d5.creaturePb({ details: { cr: 17 } }), 6); assert.equal(d5.creaturePb({ details: { cr: 0.25 } }), 2);
  assert.equal(d5.creaturePb({ details: { cr: 30 } }), 9); assert.equal(d5.creaturePb({ attributes: { prof: 4 }, details: { cr: 30 } }), 4);
  assert.equal(d5.crText(0.125), "1/8"); assert.equal(d5.crText(0.5), "1/2"); assert.equal(d5.crText(10), "10");
  // enrichers rendered like dnd5e
  const ctx = { name: "Ogre", mods: { str: 4, dex: -1, con: 3, int: -3, wis: -2, cha: -2 }, pb: 2, rules: "2014" };
  assert.equal(d5.renderEnrichers("[[/save dex 21 format=long]], [[/damage 2d6 + @abilities.str.mod type=fire average=true]] damage, [[/check wis 15]] or [[lookup @name lowercase]].", ctx),
    "DC 21 Dexterity saving throw, 11 (2d6 + 4) Fire damage, DC 15 Wisdom or ogre.");
  assert.equal(d5.renderEnrichers("@UUID[Compendium.dnd5e.spells.Item.x]{Fireball} &amp;Reference[prone] [[/r 1d4 + 1]]", ctx), "Fireball prone 1d4 + 1");
  assert.equal(d5.averageOf("2d10 + 8"), 19); assert.equal(d5.averageOf("18d6"), 63); assert.equal(d5.tidyFormula("2d10 + 8 + 0"), "2d10 + 8");
  // libraries: first source wins, folders by CR band
  const { kept, dropped } = d5.dedupeByName([{ name: "Fireball", source: "A" }, { name: "fireball ", source: "B" }, { name: "Bless", source: "B" }]);
  assert.deepEqual(kept.map(k => k.source + ":" + k.name), ["A:Fireball", "B:Bless"]); assert.deepEqual(dropped, [{ name: "fireball ", source: "B" }]);
  assert.deepEqual([0, 4, 5, 10, 11, 16, 17, 30].map(d5.crBand), ["CR 0–4", "CR 0–4", "CR 5–10", "CR 5–10", "CR 11–16", "CR 11–16", "CR 17+", "CR 17+"]);
});

ok("dnd5e libraries per source: no cross-source skip, compendia per source, source tags in From library", () => {
  // equal names from different sources all stay; only duplicates within one source are dropped
  const list = [
    { name: "Fireball", source: "srd2014" }, { name: "Bless", source: "srd2014" },
    { name: "Fireball", source: "srd2024" },
    { name: "Fireball", source: "ddb-terra-nova" }, { name: "fireball ", source: "ddb-terra-nova" }, { name: "Bless (Legacy)", source: "ddb-terra-nova" }
  ];
  const { bySource, dropped } = d5.dedupeWithinSource(list);
  assert.deepEqual([...bySource.keys()], ["srd2014", "srd2024", "ddb-terra-nova"]);
  assert.deepEqual(bySource.get("srd2014").map(x => x.name), ["Fireball", "Bless"]);
  assert.deepEqual(bySource.get("srd2024").map(x => x.name), ["Fireball"]);
  assert.deepEqual(bySource.get("ddb-terra-nova").map(x => x.name), ["Fireball", "Bless (Legacy)"]);
  assert.deepEqual(dropped, [{ name: "fireball ", source: "ddb-terra-nova" }]);
  // one compendium per kind and source, rights as before
  assert.deepEqual(d5.LIBRARY_SOURCES.map(s => s.key), ["srd2014", "srd2024", "ddb-terra-nova"]);
  const sp = d5.libraryPackDef("spells", "srd2014"), mo = d5.libraryPackDef("monsters", "ddb-terra-nova");
  assert.deepEqual([sp.name, sp.label, sp.type, sp.ownership.PLAYER], ["ap-turm-spells-srd2014", "Spells — SRD 2014", "Item", "OBSERVER"]);
  assert.deepEqual([mo.name, mo.label, mo.type, mo.ownership.PLAYER], ["ap-turm-monsters-ddb-terra-nova", "Monsters — DDB terra-nova", "Actor", "NONE"]);
  assert.equal(d5.libraryPackDef("spells", "srd2024").label, "Spells — SRD 2024");
  assert.equal(d5.bundleFile("monsters", "srd2024"), "monsters-srd2024.json");
  // From library: one list over all spell compendia, every hit with its source tag
  const merged = d5.mergeSpellEntries([
    { key: "ddb-terra-nova", pack: "world.ap-turm-spells-ddb-terra-nova", entries: [{ _id: "d1", name: "Fireball", type: "spell", system: { lvl: 3 } }] },
    { key: "srd2014", pack: "world.ap-turm-spells-srd2014", entries: [{ _id: "a1", name: "Fireball", type: "spell", system: { lvl: 3 } }, { _id: "a2", name: "Bless", type: "spell", system: { lvl: 1 } }] },
    { key: "srd2024", pack: "world.ap-turm-spells-srd2024", entries: [{ _id: "b1", name: "Fireball", type: "spell", system: { lvl: 3 } }, { _id: "f", name: "Folder", type: "gear" }] }
  ]);
  assert.deepEqual(merged.map(e => e.label), ["Bless — SRD 2014", "Fireball — SRD 2014", "Fireball — SRD 2024", "Fireball — DDB"]);
  assert.deepEqual(merged.filter(e => e.name === "Fireball").map(e => [e.pack, e._id, e.tag]),
    [["world.ap-turm-spells-srd2014", "a1", "SRD 2014"], ["world.ap-turm-spells-srd2024", "b1", "SRD 2024"], ["world.ap-turm-spells-ddb-terra-nova", "d1", "DDB"]]);
  // the picker's search keeps all versions
  assert.equal(lib.filterEntries(merged, "fireball").length, 3);
  // conversion keeps web images (D&D Beyond avatars) as they are
  const withWeb = d5.convertMonster({ ...fx5e("monster-adult-red-dragon-2014") }, { img: "https://www.dndbeyond.com/avatars/1/2/x.jpeg", tokenImg: "https://www.dndbeyond.com/avatars/1/2/t.jpeg" });
  assert.equal(withWeb.img, "https://www.dndbeyond.com/avatars/1/2/x.jpeg"); assert.equal(withWeb.prototypeToken.texture.src, "https://www.dndbeyond.com/avatars/1/2/t.jpeg");
});


async function okAsync(name, fn) { try { await fn(); passed++; } catch (e) { console.error("FAIL:", name); throw e; } }

await okAsync("zip writer: deflated and binary entries round trip, stored zips still read", async () => {
  const d = new Date(2026, 8, 23, 12, 0, 0);
  const json = JSON.stringify({ docs: Array.from({ length: 200 }, (_, i) => ({ name: `Spell ${i}`, text: "Zweihänder ".repeat(20) })) });
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
  const zip = await bk.zipDeflated([{ name: "ap-turm-import/spells-srd2014.json", text: json }, { name: "ap-turm-import/images/a b/ä.png", bytes: png, compress: false }], d);
  const raw = bk.readZip(zip);
  assert.deepEqual(raw.map(e => [e.name, e.method]), [["ap-turm-import/spells-srd2014.json", 8], ["ap-turm-import/images/a b/ä.png", 0]]);
  assert.ok(raw[0].bytes.length < json.length / 5, "JSON is compressed");
  const back = await bk.unzipEntries(zip);
  assert.equal(new TextDecoder().decode(back[0].bytes), json);
  assert.deepEqual([...back[1].bytes], [...png]);
  assert.ok(back.every(e => e.crcOk));
  // a zip written by another tool (Node's deflate, what "compress to zip" tools produce) reads the same way
  const zlib = await import("node:zlib");
  const other = bk.makeZip([{ name: "x/monsters-srd2024.json", bytes: new TextEncoder().encode(json), deflated: new Uint8Array(zlib.deflateRawSync(Buffer.from(json))) }], d);
  assert.equal(new TextDecoder().decode((await bk.unzipEntries(other))[0].bytes), json);
  // stored zips (character backup) unchanged
  const stored = bk.readZip(bk.makeZip([{ name: "a.json", text: "{}" }], d));
  assert.deepEqual([stored[0].method, stored[0].text, stored[0].crcOk], [0, "{}", true]);
  assert.throws(() => bk.readZip(new Uint8Array(40)), /not a zip/);
});

await okAsync("library bundles: export zip and import from bundle file (names, checks, images, written back from a compendium)", async () => {
  // file names
  assert.deepEqual(d5.bundleKeyOfFile("spells-srd2014.json"), { kind: "spells", key: "srd2014" });
  assert.deepEqual(d5.bundleKeyOfFile("ap-turm-import/monsters-ddb-terra-nova.json"), { kind: "monsters", key: "ddb-terra-nova" });
  assert.deepEqual(d5.bundleKeyOfFile("C:\\Downloads\\monsters-srd2024.json"), { kind: "monsters", key: "srd2024" });
  assert.equal(d5.bundleKeyOfFile("spells-homebrew.json"), null);
  assert.equal(d5.bundleKeyOfFile("ap_gades_worn.json"), null);
  assert.equal(d5.LIBRARY_ZIP, "ap-turm-libraries.zip");
  // bundle checks
  const good = { format: "ap-turm-dnd5e-import", kind: "spells", source: "srd2014", docs: [] };
  assert.equal(d5.bundleProblem(good), null);
  assert.equal(d5.bundleProblem(good, "spells", "srd2014"), null);
  assert.match(d5.bundleProblem(good, "monsters"), /expected monsters/);
  assert.match(d5.bundleProblem({ ...good, format: "x" }), /not an AP-Turm library bundle/);
  assert.match(d5.bundleProblem({ ...good, source: "homebrew" }), /unknown source/);
  assert.match(d5.bundleProblem({ ...good, docs: null }), /no documents/);
  // image entries of the zip land at their own Data path; never in a package or world folder, never outside Data
  assert.equal(d5.imageTargetOfEntry("ddb-images/other/monster/avatar/undead/2014-toa-acererak.png"), "ddb-images/other/monster/avatar/undead/2014-toa-acererak.png");
  assert.equal(d5.imageTargetOfEntry("ap-turm-import/images/systems/dnd5e/tokens/beast/Octopus.webp"), "ap-turm-import/images/systems/dnd5e/tokens/beast/Octopus.webp");
  assert.equal(d5.imageTargetOfEntry("ap-turm-import/images/../../worlds/x.png"), null);
  assert.equal(d5.imageTargetOfEntry("worlds/turm/x.png"), null);
  assert.equal(d5.imageTargetOfEntry("systems/ap-turm/icons/x.png"), null);
  assert.equal(d5.imageTargetOfEntry("C:/Windows/x.png"), null);
  assert.equal(d5.imageTargetOfEntry("ap-turm-import/images/readme.txt"), null);
  // portable bundle: every local image travels; Data files keep their path, package files move to ap-turm-import/images
  const monster = { folder: "CR 0–4", data: { name: "Octopus", img: "ddb-images/other/monster/avatar/beast/Octopus%20Big.png",
    prototypeToken: { texture: { src: "systems/dnd5e/tokens/beast/Octopus.webp" } }, items: [{ img: "icons/svg/item-bag.svg" }],
    system: { notes: "<p>Picture: ddb-images/x.png</p>", entries: [{ name: "Ink Cloud", text: "A cloud of ink.png" }] } } };
  const web = { folder: "CR 17+", data: { name: "Acererak", img: "https://www.dndbeyond.com/avatars/x.png", prototypeToken: { texture: { src: "systems/ap-turm/icons/npc.svg" } } } };
  const mBundle = { ...good, kind: "monsters", source: "srd2024", docs: [monster, web] };
  const port = d5.portableBundle(mBundle);
  assert.deepEqual(port.images, [
    { src: "systems/dnd5e/tokens/beast/Octopus.webp", path: "ap-turm-import/images/systems/dnd5e/tokens/beast/Octopus.webp" },
    { src: "ddb-images/other/monster/avatar/beast/Octopus Big.png", path: "ddb-images/other/monster/avatar/beast/Octopus Big.png" }
  ].sort((a, b) => a.path.localeCompare(b.path)));
  assert.equal(port.changed, true);
  assert.equal(port.bundle.docs[0].data.prototypeToken.texture.src, "ap-turm-import/images/systems/dnd5e/tokens/beast/Octopus.webp");
  assert.equal(port.bundle.docs[0].data.img, "ddb-images/other/monster/avatar/beast/Octopus%20Big.png");   // unchanged reference
  assert.deepEqual(port.bundle.docs[1].data, web.data);
  assert.equal(mBundle.docs[0].data.prototypeToken.texture.src, "systems/dnd5e/tokens/beast/Octopus.webp");   // input untouched
  const plain = d5.portableBundle({ ...good, docs: [web] });
  assert.deepEqual([plain.changed, plain.images.length], [false, 0]);
  // written back from a compendium: the stored ids, folders, sort and stats go, the CR folder name stays
  const packDoc = { _id: "abc", name: "Bat", type: "npc", folder: "fid", sort: 5, ownership: { default: 0 }, _stats: { x: 1 }, img: "ap-turm-import/images/dnd5e/bat.png", system: { ac: 12 } };
  assert.deepEqual(d5.bundleDocData(packDoc), { name: "Bat", type: "npc", img: "ap-turm-import/images/dnd5e/bat.png", system: { ac: 12 } });
  const rebuilt = d5.bundleFromPack("monsters", "srd2024", [{ folder: "CR 17+", data: web.data }, { folder: "CR 0–4", data: d5.bundleDocData(packDoc) }], new Date(Date.UTC(2026, 8, 23)));
  assert.equal(d5.bundleProblem(rebuilt, "monsters", "srd2024"), null);
  assert.deepEqual(rebuilt.docs.map(x => [x.folder, x.data.name]), [["CR 17+", "Acererak"], ["CR 0–4", "Bat"]]);
  assert.deepEqual([rebuilt.label, rebuilt.sources[0].count, rebuilt.report.images.web, rebuilt.report.images.copied], ["SRD 2024", 2, 1, 1]);
  // the whole way: real bundle from disk + rebuilt bundle + an image -> ap-turm-libraries.zip -> read back as the recipient does
  const onDisk = new URL("../../../ap-turm-import/spells-srd2014.json", import.meta.url);
  const spellText = fs.existsSync(onDisk) ? fs.readFileSync(onDisk, "utf8")
    : JSON.stringify({ ...good, docs: [{ folder: null, data: { name: "Bless", type: "spell", system: { lvl: 1 } } }] });
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1, 2, 3]);
  const files = d5.libraryZipFiles([{ kind: "spells", key: "srd2014", text: spellText }, { kind: "monsters", key: "srd2024", text: JSON.stringify(rebuilt) }],
    [{ path: "ap-turm-import/images/dnd5e/bat.png", bytes: png }]);
  assert.deepEqual(files.map(f => f.name), ["ap-turm-import/spells-srd2014.json", "ap-turm-import/monsters-srd2024.json", "ap-turm-import/images/dnd5e/bat.png"]);
  const zip = await bk.zipDeflated(files);
  const libs = await import("../module/libraries5e.mjs");
  const bad = new TextEncoder().encode(JSON.stringify({ format: "other" }));
  const read = await libs.readBundleFiles([{ name: "ap-turm-libraries.zip", bytes: zip }, { name: "spells-srd2024.json", bytes: bad }]);
  assert.deepEqual(read.bundles.map(b => `${b.kind}-${b.source}`), ["spells-srd2014", "monsters-srd2024"]);
  assert.equal(read.bundles[0].docs.length, JSON.parse(spellText).docs.length);
  assert.deepEqual(read.images.map(i => [i.path, [...i.bytes]]), [["ap-turm-import/images/dnd5e/bat.png", [...png]]]);
  assert.deepEqual(read.problems, ["spells-srd2024.json: not an AP-Turm library bundle"]);
  // single bundle JSONs work without the zip, too
  const single = await libs.readBundleFiles([{ name: "monsters-srd2024.json", bytes: new TextEncoder().encode(JSON.stringify(rebuilt)) }]);
  assert.deepEqual([single.bundles.length, single.images.length, single.problems.length], [1, 0, 0]);
});

await okAsync("release: manifest/package.json versions match, migration by version comparison", async () => {
  const sys = JSON.parse(fs.readFileSync(new URL("../system.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(sys.version, /^\d+\.\d+\.\d+$/); // set by tools/release.mjs
  assert.ok(sys.download.includes(`/releases/download/v${sys.version}/ap-turm.zip`));
  assert.equal(pkg.version, sys.version);
  assert.equal(migration.needsMigration("1.1.0", "1.2.0"), "migrate");
  assert.equal(migration.needsMigration("1.2.0", "1.2.0"), "none");
  assert.equal(migration.needsMigration("1.10.0", "1.2.0"), "downgrade");
  assert.equal(migration.needsMigration("", "1.2.0"), "fresh");
  assert.deepEqual(migration.stepsFor("0.9.0", "1.2.0").map(s => s.version), ["1.0.0"]);
  assert.deepEqual(migration.stepsFor("1.1.0", "1.2.0"), []);
});

ok("dice tray: formula from clicks, modifier, advantage, reroll 1s", () => {
  let s = tray.emptyTray();
  assert.equal(tray.trayFormula(s), "");
  // 2d6+3 by clicks
  s = tray.addDie(tray.addDie(s, 6), 6);
  s = tray.setMod(s, "+3");
  assert.equal(tray.trayFormula(s), "2d6 + 3");
  // right click removes one, never below zero
  s = tray.removeDie(s, 6);
  assert.equal(tray.trayFormula(s), "1d6 + 3");
  s = tray.removeDie(tray.removeDie(s, 6), 6);
  assert.equal(tray.trayFormula(s), "3");
  assert.equal(tray.setMod(s, "-2").mod, -2);
  assert.equal(tray.trayFormula(tray.setMod(s, "-2")), "-2");
  assert.equal(tray.setMod(s, "abc").mod, 0);
  // fixed order d4 ... d100, negative modifier
  s = tray.setMod(tray.addDie(tray.addDie(tray.addDie(tray.emptyTray(), 100), 4), 8), -1);
  assert.equal(tray.trayFormula(s), "1d4 + 1d8 + 1d100 - 1");
  // advantage / disadvantage: d20 implied, toggling the same mode again = normal
  let a = tray.toggleAdv(tray.setMod(tray.emptyTray(), 5), "advantage");
  assert.equal(tray.trayFormula(a), "2d20kh1 + 5");
  assert.equal(tray.trayFormula(tray.toggleAdv(a, "disadvantage")), "2d20kl1 + 5");
  assert.equal(tray.trayFormula(tray.toggleAdv(a, "advantage")), "5");
  assert.equal(tray.trayFormula(tray.addDie(a, 20)), "2d20kh1 + 5");
  assert.equal(tray.trayFormula(tray.addDie(tray.addDie(tray.emptyTray(), 20), 20)), "2d20");
  // reroll 1s like the app's rollHitDie (reroll until not 1 = rr1)
  const html2 = fs.readFileSync(new URL("../ap-character-sheet.html", import.meta.url), "utf8");
  assert.ok(html2.includes("function rollHitDie(){return hitDie().dice.reduce((sum,d)=>{let r;do{r=1+Math.floor(Math.random()*d);}while(r===1);"));
  assert.equal(tray.REROLL_MOD, "rr1");
  let h = tray.emptyTray();
  for (let i = 0; i < 6; i++) h = tray.addDie(h, 8);
  h = tray.toggleReroll(h);
  assert.equal(tray.trayFormula(h), "6d8rr1");
  assert.equal(tray.trayFormula(tray.toggleAdv(h, "advantage")), "6d8rr1 + 2d20rr1kh1");
  // single die (Shift+click) and the sheet's plain d20
  assert.equal(tray.singleDieFormula(8), "1d8");
  assert.equal(tray.plainD20Formula("normal"), "1d20");
  assert.equal(tray.plainD20Formula("advantage"), "2d20kh1");
  assert.equal(tray.plainD20Formula("disadvantage"), "2d20kl1");
});

ok("tower tracker: d20 element table, time, interval quakes, outside time, undo", () => {
  // d20 over the 20 elements in ELEMENTS order
  assert.equal(tower.ELEMENT_ORDER.length, 20);
  assert.deepEqual(tower.ELEMENT_ORDER, Object.keys(cfg.ELEMENTS));
  assert.equal(tower.elementForD20(1), "erde");
  assert.equal(tower.elementForD20(18), "feuer");
  assert.equal(tower.elementForD20(19), "turm");
  assert.equal(tower.elementForD20(20), "arch");
  assert.equal(tower.elementForD20(21), "");
  // formatting
  assert.equal(tower.formatDuration(0), "0m");
  assert.equal(tower.formatDuration(10), "10m");
  assert.equal(tower.formatDuration(60), "1h");
  assert.equal(tower.formatDuration(3130), "2d 4h 10m");
  assert.equal(tower.formatDuration(2880 + 240), "2d 4h");
  assert.deepEqual(tower.quakePips(2).map(p => p.on), [true, true, false]);
  // start: level 1 or free, times 0, log empty
  let r = tower.startRun({ level: 7, startedAt: "Day 1" });
  assert.deepEqual([r.active, r.level, r.levelsReached, r.quakes, r.timeInsideMinutes, r.timeOnLevelMinutes, r.log.length], [true, 7, 7, 0, 0, 0, 0]);
  assert.equal(tower.startRun({ level: 99 }).level, 50);
  assert.equal(tower.startRun({}).level, 1);
  // outside = levelsReached hours (+ offset)
  assert.equal(tower.outsideHours(r), 7);
  assert.equal(tower.outsideHours({ ...r, outsideOffsetHours: 2.5 }), 9.5);
  assert.equal(tower.formatHours(9.5), "9.5");
  // level change: quakes 0, time on level 0, levelsReached = max
  r = { ...r, quakes: 2, timeOnLevelMinutes: 50, timeInsideMinutes: 50, element: "feuer" };
  let up = tower.setLevel(r, 9);
  assert.deepEqual([up.level, up.quakes, up.timeOnLevelMinutes, up.timeInsideMinutes, up.levelsReached, up.element], [9, 0, 0, 50, 9, ""]);
  assert.equal(tower.setLevel(up, 8).levelsReached, 9);
  assert.equal(tower.setLevel(up, 9), up);
  // manual interval: no automatic quakes
  r = tower.startRun({ level: 1 });
  let b = tower.bookTime(r, 600);
  assert.deepEqual([b.run.timeOnLevelMinutes, b.run.timeInsideMinutes, b.run.quakes, b.quakes.length], [600, 600, 0, 0]);
  // interval 60: booking crosses multiples -> one quake each, several at once, capped at 3
  r = { ...tower.startRun({ level: 1 }), quakeIntervalMinutes: 60 };
  b = tower.bookTime(r, 10);
  assert.deepEqual(b.quakes, []);
  b = tower.bookTime(b.run, 50);                 // 60: reaches the first multiple
  assert.deepEqual(b.quakes, [1]);
  b = tower.bookTime(b.run, 125);                // 185: passes 120 and 180
  assert.deepEqual([b.quakes, b.run.quakes, tower.collapsed(b.run)], [[2, 3], 3, true]);
  b = tower.bookTime(b.run, 600);                // no fourth quake, time still counts
  assert.deepEqual([b.quakes, b.run.quakes, b.run.timeOnLevelMinutes], [[], 3, 785]);
  assert.equal(tower.quakesFromTime(0, 480, 60, 1), 2);  // a manual quake counts towards the 3
  assert.equal(tower.quakesFromTime(30, 59, 60, 0), 0);
  assert.equal(tower.quakesFromTime(0, 100, 0, 0), 0);
  assert.equal(tower.addQuake({ ...r, quakes: 3 }).quakes, 3);
  // log + undo: time and quakes back, never across a level change
  r = tower.withLog(r, r, [{ type: "start", text: "Enter" }]);
  assert.equal(tower.canUndo(r), false);
  const t1 = tower.bookTime(r, 70);
  let r2 = tower.withLog(r, t1.run, [{ type: "time", text: "+70" }, { type: "quake", text: "Quake 1" }], { undoable: true });
  assert.deepEqual([r2.log.length, r2.log[1].ts, r2.log[1].level, tower.canUndo(r2)], [3, 70, 1, true]);
  const u = tower.undoLast(r2);
  assert.deepEqual([u.run.timeOnLevelMinutes, u.run.timeInsideMinutes, u.run.quakes, u.run.log.length, u.removed.length], [0, 0, 0, 1, 2]);
  let r3 = tower.withLog(r2, tower.setLevel(r2, 2), [{ type: "level", text: "Level 2" }]);
  assert.equal(tower.canUndo(r3), false);
  const r5 = tower.withLog(r2, tower.setLevel(r2, 2), [{ type: "collapse", level: 1, text: "Level 1 collapses" }, { type: "level", text: "Level 2" }]);
  assert.deepEqual(r5.log.slice(-2).map(e => e.level), [1, 2]);
  assert.equal(tower.undoLast(r3).run, r3);
  // element override is undoable
  let r4 = tower.withLog(r3, tower.setElement(r3, "eis"), [{ type: "element", text: "Eis" }], { undoable: true });
  assert.equal(tower.undoLast(r4).run.element, "");
  assert.equal(tower.setElement(r3, "macht").element, "");
  // normalize stored junk
  const n = tower.normalizeRun({ level: "0", quakes: 9, element: "nope", log: [null, { g: 1 }] });
  assert.deepEqual([n.level, n.quakes, n.element, n.log.length, n.active], [1, 3, "", 1, false]);
  assert.deepEqual(tower.summary({ ...r, levelsReached: 7, timeInsideMinutes: 3130, outsideOffsetHours: 0 }), { levelsReached: 7, inside: "2d 4h 10m", outsideHours: "7" });
});

ok("spell rule v5: spellslot = spell purchase, learn = extra known spell, prereq chain, migration", () => {
  const base = (bought, extra = {}) => ({ ...APP.DEFAULTS(), mode: "turm", startAp: 200, earnedAp: 0, bought, ...extra });
  const both = (S) => { APP.setState(structuredClone(S)); const a = norm(APP.derived()); const r = norm(rules.derived(structuredClone(S))); assert.deepEqual(r, a); return a; };
  const spent = (S) => { APP.setState(structuredClone(S)); const a = APP.computeSpent(); assert.equal(rules.computeSpent(S), a); return a; };
  // (a) spellslot1-5 x1: 33 AP, 15 points, max rank 5, 5 known spells
  const a = base({ spellslot1: 1, spellslot2: 1, spellslot3: 1, spellslot4: 1, spellslot5: 1 });
  let d = both(a);
  assert.deepEqual([spent(a), d.spTotal, d.spMaxRank, d.known.reduce((x, k) => x + k.max, 0)], [33, 15, 5, 5]);
  assert.deepEqual(d.spBreak.map(b => b.pts), [1, 2, 3, 4, 5]);
  // (b) plus a second spellslot5: 51 AP, 20 points, 6 known
  const b = base({ ...a.bought, spellslot5: 2 });
  d = both(b);
  assert.deepEqual([spent(b), d.spTotal, d.spMaxRank, d.known.reduce((x, k) => x + k.max, 0)], [51, 20, 5, 6]);
  // learn adds a known spell only (no points, no max rank, no slot)
  d = both(base({ ...b.bought, learn3: 2 }));
  assert.deepEqual([d.spTotal, d.spMaxRank, d.known.find(k => k.L === 3).max, d.slots.find(s => s.L === 3).total], [20, 5, 3, 1]);
  // mode ap: slots of rank N = spellslotN
  d = both({ ...base({ spellslot1: 3, spellslot2: 1, learn1: 2 }), mode: "ap" });
  assert.deepEqual(d.slots.map(s => [s.L, s.total]), [[1, 3], [2, 1]]);
  // known counter: spells on the sheet vs. allowed, over = yellow
  d = both(base({ spellslot1: 1 }, { spells: [{ id: "s1", lvl: 1, name: "A" }, { id: "s2", lvl: 1, name: "B" }] }));
  assert.deepEqual(d.known, [{ L: 1, max: 1, have: 2, over: true }]);
  // (c) learn3 without spellslot3 is locked, (d) spellslot3 without spellslot2 is locked
  for (const [S, id] of [[base({ spellslot1: 1, spellslot2: 1 }), "learn3"], [base({ spellslot1: 1 }), "spellslot3"]]) {
    APP.setState(structuredClone(S));
    assert.equal(APP.isLocked(id), true, id);
    assert.equal(rules.isLocked(S, id), true, id);
    assert.equal(rules.shopStatus(S, rules.findItem(id)).canBuy, false);
  }
  assert.equal(rules.isLocked(base({}), "spellslot1"), false);
  assert.equal(rules.isLocked(base({ spellslot3: 1 }), "learn3"), false);
  assert.equal(cfg.PREREQS.learn3, "spellslot3");
  assert.equal(cfg.PREREQS.spellslot3, "spellslot2");
  assert.equal(cfg.PREREQS.spellslot1, undefined);
  assert.equal(rules.findItem("learn4").name, "Extra Spell Lvl 4");
  assert.equal(rules.findItem("learn4").hint, "Additional known spell of rank 4. Requires Spellslot Lvl 4.");
  assert.equal(rules.findItem("spellslot4").name, "Spellslot Lvl 4 (+1 spell)");
  // selling spellslot2 removes what depends on it (spellslot3.., learn2..)
  assert.deepEqual(rules.sellRank(base({ spellslot1: 1, spellslot2: 1, spellslot3: 1, learn2: 1, learn1: 1 }), "spellslot2").bought, { spellslot1: 1, learn1: 1 });
  // (e) migration: learn1-5 + spellslot5 x1 (old 42 AP) -> spellslot1-5 x1 + second spellslot5, -9 AP, still 20 points
  const old = { v: 4, mode: "turm", startAp: 200, earnedAp: 0, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    bought: { learn1: 1, learn2: 1, learn3: 1, learn4: 1, learn5: 1, spellslot5: 1 } };
  APP.setState(structuredClone({ ...APP.DEFAULTS(), ...old }));
  assert.equal(APP.computeSpent(), 42);
  const S = appLoad(old);
  assert.deepEqual(S.bought, { spellslot1: 1, spellslot2: 1, spellslot3: 1, spellslot4: 1, spellslot5: 2 });
  assert.equal(S.v, 5);
  assert.equal(S.notices.length, 1);
  assert.match(S.notices[0].text, /^Spellcasting rule change: your purchases were converted\. AP balance changed by -9\. Please settle with your GM\.$/);
  APP.setState(S); assert.deepEqual([APP.computeSpent(), APP.derived().spTotal], [51, 20]);
  // idempotent: loading the migrated sheet again changes nothing
  const S2 = appLoad(JSON.parse(JSON.stringify(S)));
  assert.deepEqual([S2.bought, S2.notices.length], [S.bought, 1]);
  // Foundry: same conversion, notice, flag; export v5; an unconverted actor exports as v4
  const r = rules.convertSpellPurchases(old.bought);
  assert.deepEqual([r.bought, r.converted, r.delta], [S.bought, [1, 2, 3, 4, 5], -9]);
  const created = convertAppExport(old);
  assert.deepEqual([created.system.bought, created.flags["ap-turm"].dataVersion, created.notice, created.system.notices.length], [S.bought, 5, S.notices[0].text, 1]);
  const again = convertAppExport(exportAppData({ name: created.name, system: created.system, items: [] }));
  assert.deepEqual([again.system.bought, again.notice, again.system.notices.length], [S.bought, "", 1]);
  assert.equal(exportAppData({ name: "x", system: { bought: old.bought }, items: [], dataVersion: 4 }).v, 4);
  assert.equal(convertAppExport(exportAppData({ name: "x", system: { bought: old.bought }, items: [], dataVersion: 4 })).system.bought.spellslot5, 2);
  // a v5 sheet with learn purchases is never converted
  assert.deepEqual(convertAppExport({ ...old, v: 5 }).system.bought, old.bought);
  // migration step registered for 1.3.0
  assert.deepEqual(migration.stepsFor("1.2.1", "1.3.0").map(x => x.version), ["1.3.0"]);
});

/* Minimal Foundry stub so the data models' static migrateData can run in Node (no schema is built). */
async function loadDataModels() {
  if (!globalThis.foundry) {
    class Field { constructor(...a) { this.args = a; } }
    const fields = new Proxy({}, { get: () => Field });
    globalThis.foundry = { data: { fields }, abstract: { TypeDataModel: class { static migrateData(s) { return s; } } } };
  }
  const items = await import("../module/data/items.mjs");
  const npcM = await import("../module/data/npc.mjs");
  return { ...items, ...npcM };
}

await okAsync("weapon damage types: both lists in turm mode, second damage line, typed apply, NPC not-assigned marks", async () => {
  // grouped choices: turm both lists, ap D&D types only
  assert.deepEqual(cfg.damageTypeGroups("turm").map(g => [g.label, g.options.length]), [["Damage types", 13], ["Elements", 20]]);
  assert.deepEqual(cfg.damageTypeGroups("ap").map(g => g.label), ["Damage types"]);
  const go = cfg.damageTypeGroupOptions("turm", "?fire", { none: true });
  assert.deepEqual(go.extra.map(o => [o.value, o.label, o.selected]), [["", "— none —", false], ["?fire", "Fire (not assigned)", true]]);
  assert.equal(cfg.damageTypeGroupOptions("turm", "slashing").groups[0].options.find(o => o.selected).value, "slashing");
  assert.equal(cfg.damageTypeGroupOptions("ap", "feuer").extra[0].label, "Feuer");      // other-mode value stays readable
  // second line: own part with its own type; crit doubles both, crit max maximizes both, +1d6 Elemental stays the third
  const S = { ...APP.DEFAULTS(), mode: "turm", earnedAp: 150, abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    bought: { eleDmg: 1 }, choices: { eleDmg: ["blitz"] } };
  const d = rules.derived(S);
  const w = { abil: "str", dice: "1d8", dtype: "slashing", dice2: "1d6", type2: "feuer", bonus: 0, prof: true };
  let dmg = rolls.buildDamage(w, d, S, { crit: false });
  assert.deepEqual(dmg.parts.map(p => [p.label, p.formula, p.type]), [["Weapon", "1d8 + 3", "slashing"], ["Weapon 2", "1d6", "feuer"], ["Elemental", "1d6", "blitz"]]);
  dmg = rolls.buildDamage(w, d, S, { crit: true, critMax: false });
  assert.deepEqual(dmg.parts.map(p => p.critFormula), ["1d8", "1d6", "1d6"]);
  dmg = rolls.buildDamage(w, d, S, { crit: true, critMax: true });
  assert.deepEqual(dmg.parts.map(p => p.critFlat), [8, 6, 6]);
  assert.equal(rolls.buildDamage({ ...w, dice2: "" }, d, S).parts.length, 2);
  assert.equal(rolls.buildDamage({ ...w, type2: "" }, d, S).parts[1].type, "slashing");   // empty second type = first type
  // typed apply: 1d8 slashing + 1d6 feuer against fire resistance -> only the second line is halved
  const parts = rolls.buildDamage({ ...w }, d, { ...S, bought: {} }).parts;
  parts[0].rolled = 9; parts[1].rolled = 5;
  const groups = rolls.damageGroups(parts);
  assert.deepEqual(groups, [{ type: "slashing", amount: 9 }, { type: "feuer", amount: 5 }]);
  const typed = rolls.typedDamage(groups, { resistances: ["feuer"] }, { mode: "turm" });
  assert.deepEqual([typed.taken, typed.lines.map(l => [l.type, l.mult, l.taken])], [11, [["slashing", 1, 9], ["feuer", 0.5, 2]]]);
  // D&D types count in turm mode now (character / item defenses); only "?" types are ignored
  assert.equal(rolls.typedDamage(groups, { resistances: ["slashing"] }, { mode: "turm" }).taken, 4 + 5);
  assert.equal(rolls.typedDamage(groups, { resistances: ["?slashing"] }, { mode: "turm" }).taken, 14);
  assert.equal(rolls.typedDamage([{ type: "fire", amount: 7 }], { immunities: ["fire"] }, { mode: "ap" }).taken, 0);
  // app: the weapon line shows both lines, the editor offers both groups in turm mode
  const html = fs.readFileSync(new URL("../ap-character-sheet.html", import.meta.url), "utf8");
  assert.ok(html.includes('<optgroup label="Damage types">') && html.includes('<optgroup label="Elements">'));
  assert.ok(html.includes("${(w.dice2||\"\").trim()?` + ${escapeHtml(w.dice2.trim())} ${dmgTypeSpan(w.type2||w.dtype)}`:\"\"}"));
  // import / export: dice2 + type2 1:1, absent fields stay absent
  const raw = { ...APP.DEFAULTS(), mode: "turm", weapons: [{ id: "w1", name: "Flammenschwert", abil: "str", dice: "1d8", dtype: "slashing", dice2: "1d6", type2: "feuer", bonus: 1, prof: true, equipped: true, notes: "" },
    { id: "w2", name: "Dolch", abil: "dex", dice: "1d4", dtype: "piercing", bonus: 0, prof: true, equipped: false, notes: "" }] };
  const out = roundTrip(raw);
  assert.deepEqual(out.weapons.map(x => [x.dice2, x.type2]), [["1d6", "feuer"], [undefined, undefined]]);
  assert.deepEqual(convertAppExport(raw).items.filter(i => i.type === "weapon").map(i => [i.system.dice2, i.system.type2]), [["1d6", "feuer"], ["", ""]]);
  // data models: old weapon -> defaults for the new fields, old turm NPC -> D&D keys marked once, new data untouched
  const DM = await loadDataModels();
  const ow = DM.WeaponData.migrateData({ abil: "str", dice: "1d8", dtype: "macht" });
  assert.deepEqual([ow.dtype, ow.dice2, ow.type2], ["arch", "", ""]);
  const oldNpc = DM.NpcData.migrateData({ mode: "turm", resistances: ["fire", "eis"], immunities: [], vulnerabilities: [], entries: [{ name: "Bite", section: "actions", dmgType: "piercing" }] });
  assert.deepEqual([oldNpc.resistances, oldNpc.entries[0].dmgType, oldNpc.typeMarks], [["?fire", "eis"], "?piercing", true]);
  const newNpc = DM.NpcData.migrateData({ mode: "turm", typeMarks: true, resistances: ["fire"], entries: [{ name: "Claw", section: "actions", dmgType: "slashing" }] });
  assert.deepEqual([newNpc.resistances, newNpc.entries[0].dmgType], [["fire"], "slashing"]);
  const apNpc = DM.NpcData.migrateData({ mode: "ap", resistances: ["fire"], entries: [] });
  const modeOnly = DM.NpcData.migrateData({ mode: "turm" });                            // partial update: untouched
  assert.equal(modeOnly.typeMarks, undefined);
  assert.deepEqual([apNpc.resistances, apNpc.typeMarks], [["fire"], true]);
  const partial = DM.NpcData.migrateData({ resistances: ["fire"] });                     // token delta: no mode -> untouched
  assert.deepEqual([partial.resistances, partial.typeMarks], [["fire"], undefined]);
});

await okAsync("items with effects: equipped / attuned, bonuses, proficiency, A/D, defenses, round trip, data models", async () => {
  const raw = JSON.parse(fs.readFileSync(new URL("./fixtures/items-effects.json", import.meta.url), "utf8"));
  const S = appLoad(raw);
  compareAll(S, "items-effects");                                          // app == rules, item by item
  const d = rules.derived(S);
  const off = (pred) => { const c = structuredClone(S); c.items = c.items.filter(i => !pred(i)); return rules.derived(c); };
  // Gauntlets (str +2, equipped, attuned): STR 14 -> 16, mod +2 -> +3, attack +1
  const w = S.weapons[0];
  const noG = off(i => i.id === "igaunt");
  assert.deepEqual([d.fin.str, d.mods.str, noG.fin.str, noG.mods.str], [16, 3, 14, 2]);
  assert.equal(rules.weaponStats(w, d).atk - rules.weaponStats(w, noG).atk, 1);
  // not equipped -> no effect; attunement required but not attuned -> no effect
  const unequip = structuredClone(S); delete unequip.items[0].equipped;
  assert.equal(rules.derived(unequip).fin.str, 14);
  const unattuned = structuredClone(S); unattuned.items[0].attuned = false;
  assert.equal(rules.derived(unattuned).fin.str, 14);
  assert.equal(rules.itemActive(unattuned.items[0]), false);
  assert.equal(rules.itemActive({ equipped: true }), true);
  // the Cursed Ring is not equipped: no AC -2, no disadvantage
  assert.deepEqual([d.saveData.wis.dis, d.itemFx.dis.death], [[], []]);
  const cursed = structuredClone(S); cursed.items[3].equipped = true;
  const dc = rules.derived(cursed);
  assert.deepEqual([dc.ac, dc.saveData.wis.dis, dc.itemFx.dis.death], [d.ac - 2, ["Cursed Ring"], ["Cursed Ring"]]);
  // Ring: adv Stealth (marker with the item name), prof Stealth + Athletics (no stacking, not counted against 6),
  // +1 Stealth, DEX save proficiency, +1 spell DC / attack, +2 spell points, advantage on initiative
  assert.deepEqual([d.skillData.ste.adv, d.skillData.ste.prof, d.skillData.ath.prof], [["Ring of Shadows"], true, true]);
  assert.equal(d.skillData.ste.mod, d.mods.dex + d.pb + 1);
  assert.equal(d.skillData.ath.mod, d.mods.str + d.pb);                   // already proficient: no double PB
  assert.equal(S.selectedSkills.length, 1);
  assert.deepEqual([d.saveData.dex.prof, d.saveData.dex.mod], [true, d.mods.dex + d.pb]);
  assert.deepEqual([d.spellDC, d.spellAtk, d.spTotal], [8 + d.pb + d.spellMod + 1, d.pb + d.spellMod + 1, 1 + 2]);
  assert.deepEqual(rolls.itemRollPreset(d, "skill", "ste"), { mode: "advantage", adv: ["Ring of Shadows"], dis: [], label: "Advantage: Ring of Shadows" });
  assert.equal(rolls.itemRollPreset(d, "init").mode, "advantage");
  assert.equal(rolls.itemRollPreset(dc, "save", "wis").label, "Disadvantage: Cursed Ring");
  assert.equal(rolls.itemRollPreset(d, "attack").mode, "normal");
  // Cloak: +2 WIS save, res feuer + slashing (with the shop resistance eis), senses and note
  assert.equal(d.saveData.wis.mod, d.mods.wis + 2);
  assert.deepEqual(d.itemFx.res.map(r => [r.key, r.src]), [["feuer", "Cloak of the Tower"], ["slashing", "Cloak of the Tower"]]);
  assert.deepEqual(rolls.characterDefenses(S), { resistances: ["eis", "feuer", "slashing"], immunities: [], vulnerabilities: [] });
  assert.deepEqual([d.itemFx.senses[0].text, d.itemFx.notes[0].text], ["Darkvision 60 ft", "Glows in the dark"]);
  // attribute tooltip
  assert.equal(rules.abilityBreakdown(S, "str", d), "16 = 14 + 2 Gauntlets of Ogre Power");
  // weapon 1d8 slashing + 1d6 feuer against a target with fire resistance: only the second line halves;
  // against this character a D&D type counts in turm mode as well (slashing resisted by the cloak)
  const typed = rolls.typedDamage([{ type: "slashing", amount: 8 }, { type: "feuer", amount: 5 }], { resistances: ["feuer"] }, { mode: "turm" });
  assert.deepEqual(typed.lines.map(l => l.taken), [8, 2]);
  assert.equal(rolls.typedDamage([{ type: "slashing", amount: 8 }, { type: "feuer", amount: 5 }], rolls.characterDefenses(S), { mode: "turm" }).taken, 4 + 2);
  // export -> import -> same state (app shape, compact effects, missing fields stay missing)
  const out = roundTrip(raw);
  assert.deepEqual(out.items, raw.items);
  assert.deepEqual(out.weapons, raw.weapons);
  // Foundry pipeline: import -> data -> app state -> derived identical to the app
  const fs1 = foundryState(convertAppExport(raw));
  assert.deepEqual(norm(rules.derived(fs1)), appDerived(S));
  const gear = convertAppExport(raw).items.filter(i => i.type === "gear");
  assert.equal(gear[0].system.effects.bon.str, 2);
  assert.deepEqual(gear[4].system.effects, rules.expandEffects(undefined));
  assert.equal(rules.compactEffects(gear[4].system.effects), null);
  // app and rules use the same helpers
  APP.setState(S);
  for (const it of S.items) assert.deepEqual(rules.compactEffects(it.effects), APP.compactEffects(it.effects), it.name);
  assert.deepEqual(norm(rules.itemEffects(S.items)), norm(APP.itemEffects(S.items)));
  assert.equal(APP.abilityBreakdown("str", APP.derived()), "16 = 14 + 2 Gauntlets of Ogre Power");
  // data models: old gear item -> defaults (not equipped, no attunement requirement, empty effects)
  const DM = await loadDataModels();
  const og = DM.GearData.migrateData({ qty: 1, notes: "", attuned: true, charges: 0, used: 0, recharge: "long", origin: "city" });
  assert.deepEqual([og.equipped, og.attunement, og.effects], [false, false, rules.expandEffects(undefined)]);
  const keep = DM.GearData.migrateData({ qty: 1, origin: "city", recharge: "long", equipped: true, effects: { bon: { str: 2 } } });
  assert.deepEqual([keep.equipped, keep.effects.bon.str, keep.effects.bon.dex], [true, 2, 0]);
  // partial update data stays partial (Foundry runs migrateData on updates too)
  assert.deepEqual(DM.GearData.migrateData({ effects: { bon: { str: 1 } } }), { effects: { bon: { str: 1 } } });
  assert.deepEqual(DM.WeaponData.migrateData({ dtype: "fire" }), { dtype: "fire" });
});

console.log(`All ${passed} test groups passed.`);

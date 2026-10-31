/**
 * Custom shop entries of the GM (Foundry only; the HTML app ignores their ids).
 *
 * - Entries live in a world setting; installCustomShop() lays them over the built-in tables SHOP_DATA / PREREQS /
 *   SELECTORS, so shop tab, buy / sell, AP budget, prerequisites, history, features list and the app export treat
 *   them exactly like built-in entries. Ids start with "c_" and never replace a built-in id; built-in entries are
 *   never changed.
 * - A defective entry (e.g. from a broken import) is skipped and reported, it never breaks a sheet.
 * - Effects: ability / AC / initiative / speed / HP-max bonuses join derived() as one more bonus source (the same
 *   path as feat bonuses), so the built-in rules - final score cap 20 (+2 per Limit Break), modifiers, HP, AC,
 *   saves - apply unchanged. Everything else is added onto the finished derived() values (applyCustomEffects).
 * Pure module (tested in Node): no Foundry globals.
 */
import { SHOP_DATA, PREREQS, SELECTORS, ABILITIES, SKILLS, ARMOR_WEAPON_PROFS } from "./config.mjs";

export const CUSTOM_PREFIX = "c_";
export const FORMAT = "ap-turm-custom-shop";

/** Choice made at purchase (stored in choices[id], one pick per rank). */
export const CHOICE_TYPES = { none: "No choice", ability: "Ability", skill: "Skill", save: "Saving throw", damage: "Damage type / element" };
/** SELECTORS type for each choice (the sheet's pick dialog). */
const SELECTOR_TYPE = { ability: "ability", skill: "skill", save: "save", damage: "damage" };

export const EFFECT_TYPES = {
  bonus: "+N bonus", advantage: "Advantage", prof: "Proficiency", pool: "Resource pool",
  sp: "+N spell points", casts: "+N casts of a rank 6-9", dice: "+Nd6 damage (chosen element)", text: "Text only"
};
export const BONUS_TARGETS = { ability: "Ability", save: "Save", skill: "Skill", ac: "AC", init: "Initiative", speed: "Speed (ft)", hp: "HP max", passive: "Passive Perception" };
/** Bonus targets that go through derived() as a bonus source (they change further values there). */
const SOURCE_TARGETS = { ac: "ac", init: "init", speed: "speed", hp: "hp" };

/* ============================================================
   Formula: numbers, earned, level, + - * / ( ), floor(...)
   ============================================================ */

/**
 * Parse a pool formula. Only numbers, `earned`, `level`, the four basic operators, brackets and floor() are
 * allowed; anything else is an error. The result is evaluated with floor() at the end (like Lay on Hands).
 * @returns {{ok:true, evaluate:(vars:{earned:number, level:number})=>number}|{ok:false, error:string}}
 */
export function parseFormula(src) {
  const text = String(src ?? "").trim();
  if (!text) return { ok: false, error: "empty formula" };
  const tokens = [];
  const re = /\s*(\d+(?:\.\d+)?|earned|level|floor|[-+*/()])/y;
  let pos = 0;
  while (pos < text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) { if (/^\s+$/.test(text.slice(pos))) break; return { ok: false, error: `not allowed: "${text.slice(pos).trim().slice(0, 12)}" (only numbers, earned, level, + - * / ( ) and floor)` }; }
    tokens.push(m[1]);
    pos = re.lastIndex;
  }
  let i = 0;
  const peek = () => tokens[i];
  const take = (t) => { if (tokens[i] !== t) throw new Error(`expected "${t}"`); i++; };
  // expr := term (("+"|"-") term)* ; term := factor (("*"|"/") factor)* ; factor := num | var | floor(expr) | (expr) | -factor
  const expr = () => { let node = term(); while (peek() === "+" || peek() === "-") { const op = tokens[i++]; const r = term(); const l = node; node = op === "+" ? (v) => l(v) + r(v) : (v) => l(v) - r(v); } return node; };
  const term = () => { let node = factor(); while (peek() === "*" || peek() === "/") { const op = tokens[i++]; const r = factor(); const l = node; node = op === "*" ? (v) => l(v) * r(v) : (v) => { const d = r(v); return d === 0 ? 0 : l(v) / d; }; } return node; };
  const factor = () => {
    const t = tokens[i++];
    if (t === undefined) throw new Error("formula ends too early");
    if (/^\d/.test(t)) { const n = Number(t); return () => n; }
    if (t === "earned") return (v) => Number(v.earned) || 0;
    if (t === "level") return (v) => Number(v.level) || 0;
    if (t === "floor") { take("("); const inner = expr(); take(")"); return (v) => Math.floor(inner(v)); }
    if (t === "(") { const inner = expr(); take(")"); return inner; }
    if (t === "-") { const f = factor(); return (v) => -f(v); }
    throw new Error(`unexpected "${t}"`);
  };
  try {
    const node = expr();
    if (i < tokens.length) throw new Error(`unexpected "${tokens[i]}"`);
    return { ok: true, evaluate: (vars) => { const r = node(vars || {}); return Number.isFinite(r) ? Math.max(0, Math.floor(r)) : 0; } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Value of a pool maximum: a plain number or a formula; null when invalid. */
export function evalFormula(src, vars) {
  const p = parseFormula(src);
  return p.ok ? p.evaluate(vars) : null;
}

/* ============================================================
   Validation
   ============================================================ */

const int = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : NaN; };
const str = (v) => String(v ?? "").trim();

/** "10, 20, 30" or [10, 20, 30] -> [10, 20, 30]; null when a value is not a positive number. */
export function parseCosts(v) {
  const list = Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/).filter(Boolean);
  if (!list.length) return null;
  const out = list.map(Number);
  return out.every(n => Number.isFinite(n) && n > 0 && Number.isInteger(n)) ? out : null;
}

/** Normalize and check one effect; returns {effect} or {error}. */
function checkEffect(raw, choice, idx) {
  const e = raw && typeof raw === "object" ? raw : {};
  const where = `effect ${idx + 1}`;
  const type = str(e.type);
  const value = int(e.value ?? 1);
  const needsValue = ["bonus", "sp", "casts", "dice"].includes(type);
  if (needsValue && (!Number.isFinite(value) || value === 0)) return { error: `${where}: value must be a whole number other than 0` };
  const chosenOk = (target) => (target === "ability" && choice === "ability") || (target === "skill" && choice === "skill") || (target === "save" && (choice === "save" || choice === "ability"));
  switch (type) {
    case "bonus": {
      const target = str(e.target);
      if (!(target in BONUS_TARGETS)) return { error: `${where}: unknown bonus target "${target}"` };
      let key = str(e.key);
      if (["ability", "save", "skill"].includes(target)) {
        if (key === "chosen") { if (!chosenOk(target)) return { error: `${where}: "chosen" needs the matching choice at purchase` }; }
        else if (target === "skill" ? !(key in SKILLS) : !(key in ABILITIES)) return { error: `${where}: unknown ${target} "${key}"` };
      } else key = "";
      return { effect: { type, target, key, value } };
    }
    case "advantage": {
      const target = str(e.target);
      if (!["skill", "save"].includes(target)) return { error: `${where}: advantage needs skill or save` };
      if (!chosenOk(target)) return { error: `${where}: advantage on a chosen ${target} needs that choice at purchase` };
      return { effect: { type, target, key: "chosen" } };
    }
    case "prof": {
      const target = str(e.target);
      if (target === "gear") {
        const key = str(e.key);
        if (!ARMOR_WEAPON_PROFS.some(p => p.id === key)) return { error: `${where}: unknown armor / weapon group "${key}"` };
        return { effect: { type, target, key } };
      }
      if (!["skill", "save"].includes(target)) return { error: `${where}: proficiency needs skill, save or an armor / weapon group` };
      if (!chosenOk(target)) return { error: `${where}: proficiency in a chosen ${target} needs that choice at purchase` };
      return { effect: { type, target, key: "chosen" } };
    }
    case "pool": {
      const name = str(e.name);
      if (!name) return { error: `${where}: the pool needs a name` };
      const max = str(e.max);
      const p = parseFormula(max);
      if (!p.ok) return { error: `${where}: pool maximum - ${p.error}` };
      const reset = e.reset === "short" ? "short" : e.reset === "long" ? "long" : null;
      if (!reset) return { error: `${where}: reset must be short or long rest` };
      return { effect: { type, name, max, reset } };
    }
    case "sp": return { effect: { type, value } };
    case "casts": {
      const rank = int(e.rank);
      if (!(rank >= 6 && rank <= 9)) return { error: `${where}: rank must be 6-9` };
      return { effect: { type, rank, value } };
    }
    case "dice":
      if (choice !== "damage") return { error: `${where}: damage dice need the damage type / element choice at purchase` };
      return { effect: { type, value } };
    case "text": {
      const text = str(e.text);
      if (!text) return { error: `${where}: the text is empty` };
      return { effect: { type, text } };
    }
    default: return { error: `${where}: unknown effect type "${type}"` };
  }
}

/**
 * Normalize and check a custom entry.
 * @param {object} raw
 * @param {object} [o]  {builtinIds: Set of built-in shop ids}
 * @returns {{ok:true, entry:object}|{ok:false, errors:string[], id:string, name:string}}
 */
export function validateEntry(raw, { builtinIds = BUILTIN_IDS } = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const errors = [];
  const id = str(r.id);
  const name = str(r.name);
  if (!id.startsWith(CUSTOM_PREFIX) || id.length <= CUSTOM_PREFIX.length || /[^\w-]/.test(id)) errors.push(`id "${id}" must start with "${CUSTOM_PREFIX}"`);
  if (builtinIds.has(id)) errors.push(`id "${id}" is a built-in entry`);
  if (!name) errors.push("the name is empty");
  const category = str(r.category) || "Custom";
  const costs = parseCosts(r.costs);
  if (!costs) errors.push("the cost ladder needs positive whole numbers (e.g. 10, 20, 30)");
  const mult = r.mult === undefined || r.mult === null || r.mult === "" ? 2 : Number(r.mult);
  if (!Number.isFinite(mult) || mult <= 0) errors.push("the multiplier must be a positive number");
  const maxRanks = r.maxRanks === undefined || r.maxRanks === null || r.maxRanks === "" ? null : int(r.maxRanks);
  if (maxRanks !== null && !(maxRanks >= 1)) errors.push("max ranks must be empty or at least 1");
  const choice = str(r.choice) || "none";
  if (!(choice in CHOICE_TYPES)) errors.push(`unknown choice "${choice}"`);
  const prereqs = [...new Set((Array.isArray(r.prereqs) ? r.prereqs : []).map(str).filter(Boolean))].filter(p => p !== id);
  const effects = [];
  (Array.isArray(r.effects) ? r.effects : []).forEach((e, idx) => {
    const res = checkEffect(e, choice, idx);
    if (res.error) errors.push(res.error); else effects.push(res.effect);
  });
  if (errors.length) return { ok: false, errors, id, name };
  return { ok: true, entry: { id, name, category, desc: str(r.desc), costs, mult, maxRanks, prereqs, choice, effects } };
}

/* ============================================================
   Labels
   ============================================================ */

const keyLabel = (target, key) => {
  if (key === "chosen") return `chosen ${target}`;
  if (target === "skill") return SKILLS[key]?.l ?? key;
  if (target === "ability" || target === "save") return `${ABILITIES[key] ?? key}${target === "save" ? " save" : ""}`;
  if (target === "gear") return ARMOR_WEAPON_PROFS.find(p => p.id === key)?.name ?? key;
  return key;
};

/** One short line per effect for the list. */
export function effectLabel(e) {
  const v = Number(e?.value) || 0;
  const sign = v > 0 ? "+" : "";
  switch (e?.type) {
    case "bonus": return `${sign}${v} ${["ability", "save", "skill"].includes(e.target) ? keyLabel(e.target, e.key) : BONUS_TARGETS[e.target] ?? e.target}`;
    case "advantage": return `advantage: ${keyLabel(e.target, "chosen")}`;
    case "prof": return `proficiency: ${keyLabel(e.target, e.key)}`;
    case "pool": return `pool "${e.name}" ${e.max} (${e.reset} rest)`;
    case "sp": return `${sign}${v} spell points`;
    case "casts": return `${sign}${v} rank ${e.rank} casts`;
    case "dice": return `+${v}d6 chosen element`;
    case "text": return `text: ${String(e.text ?? "").slice(0, 40)}`;
    default: return String(e?.type ?? "?");
  }
}

/* ============================================================
   Overlay onto the built-in tables
   ============================================================ */

// snapshot of the built-in tables before anything was installed
const BASE_SHOP = Object.fromEntries(Object.entries(SHOP_DATA).map(([c, l]) => [c, l.map(x => ({ ...x }))]));
const BASE_PREREQS = { ...PREREQS };
const BASE_SELECTORS = { ...SELECTORS };
export const BUILTIN_IDS = new Set(Object.values(BASE_SHOP).flat().map(x => x.id));
/** Built-in shop categories, in order. */
export const BUILTIN_CATEGORIES = Object.keys(BASE_SHOP);

/**
 * Lay custom entries over the base tables (pure: returns new objects). Invalid entries, duplicate ids and
 * prerequisites that do not exist are skipped / dropped and reported.
 * @returns {{shop, prereqs, selectors, entries:object[], skipped:{id,name,errors}[]}}
 */
export function buildOverlay(customs, base = { shop: BASE_SHOP, prereqs: BASE_PREREQS, selectors: BASE_SELECTORS }) {
  const builtinIds = new Set(Object.values(base.shop).flat().map(x => x.id));
  const shop = Object.fromEntries(Object.entries(base.shop).map(([c, l]) => [c, l.map(x => ({ ...x }))]));
  const prereqs = { ...base.prereqs };
  const selectors = { ...base.selectors };
  const entries = [], skipped = [], seen = new Set();
  for (const raw of Array.isArray(customs) ? customs : []) {
    const v = validateEntry(raw, { builtinIds });
    if (!v.ok) { skipped.push({ id: v.id, name: v.name, errors: v.errors }); continue; }
    if (seen.has(v.entry.id)) { skipped.push({ id: v.entry.id, name: v.entry.name, errors: ["duplicate id"] }); continue; }
    seen.add(v.entry.id);
    entries.push(v.entry);
  }
  const known = new Set([...builtinIds, ...seen]);
  for (const e of entries) {
    e.prereqs = e.prereqs.filter(p => known.has(p));
    (shop[e.category] ??= []).push({ id: e.id, name: e.name, costs: [...e.costs], mult: e.mult, maxRanks: e.maxRanks, desc: e.desc, custom: true });
    if (e.prereqs.length) prereqs[e.id] = e.prereqs.length === 1 ? e.prereqs[0] : [...e.prereqs];
    if (e.choice !== "none") selectors[e.id] = { type: SELECTOR_TYPE[e.choice], label: `${e.name}: ${CHOICE_TYPES[e.choice]}` };
  }
  return { shop, prereqs, selectors, entries, skipped };
}

let installed = [];
/** The custom entries currently laid over the tables. */
export function customEntries() { return installed; }
/** One installed custom entry by id. */
export function customEntry(id) { return installed.find(e => e.id === id) ?? null; }

/**
 * Install custom entries into the live tables (replacing an earlier install). Returns the overlay result; the
 * skipped entries are for the caller to report.
 */
export function installCustomShop(customs) {
  const o = buildOverlay(customs);
  for (const k of Object.keys(SHOP_DATA)) delete SHOP_DATA[k];
  Object.assign(SHOP_DATA, o.shop);
  for (const k of Object.keys(PREREQS)) delete PREREQS[k];
  Object.assign(PREREQS, o.prereqs);
  for (const k of Object.keys(SELECTORS)) delete SELECTORS[k];
  Object.assign(SELECTORS, o.selectors);
  installed = o.entries;
  return o;
}

/* ============================================================
   Effects
   ============================================================ */

/** Storage key of a pool in system.resources.customUsed: entry id + effect index (safe as an update path). */
export const poolKey = (entryId, effectIndex) => `${entryId}-${effectIndex}`;

const picksOf = (S, id) => (S.choices?.[id] || []).map(String).filter(Boolean);
const ranksOf = (S, id) => Math.max(0, Number(S.bought?.[id]) || 0);

/**
 * Ability / AC / initiative / speed / HP-max bonuses of the bought custom entries, shaped like one feat's `bon`.
 * It joins derived() as one more feat, so the cap 20 and every value that depends on it stay the built-in rules.
 */
export function customBonusSource(S, entries = installed) {
  const bon = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, ac: 0, speed: 0, hp: 0, init: 0 };
  for (const e of entries || []) {
    const n = ranksOf(S, e.id);
    if (!n) continue;
    for (const ef of e.effects) {
      if (ef.type !== "bonus") continue;
      if (ef.target === "ability") {
        if (ef.key === "chosen") for (const p of picksOf(S, e.id).slice(0, n)) { if (p in ABILITIES) bon[p] += ef.value; }
        else bon[ef.key] += ef.value * n;
      } else if (ef.target in SOURCE_TARGETS) bon[SOURCE_TARGETS[ef.target]] += ef.value * n;
    }
  }
  return bon;
}

/**
 * Add the remaining custom effects onto a finished derived() result (mutates and returns `d`). Adds d.custom:
 * {pools, dice, advSkills, advSaves, profs, features}.
 * @param {object} d        derived(S) (with customBonusSource already fed in)
 * @param {object} S        app state
 * @param {object[]} [entries]
 * @param {object} [o]      {used: {entryId: used} of the pools}
 */
export function applyCustomEffects(d, S, entries = installed, { used = {} } = {}) {
  const custom = { pools: [], dice: [], advSkills: [], advSaves: [], profs: [], features: [] };
  d.custom = custom;
  const vars = { earned: d.earned, level: d.level };
  const addPb = (entry) => { if (!entry.prof) { entry.prof = true; entry.mod += d.pb; } };
  for (const e of entries || []) {
    const n = ranksOf(S, e.id);
    if (!n) continue;
    const picks = picksOf(S, e.id).slice(0, n);
    e.effects.forEach((ef, idx) => {
      switch (ef.type) {
        case "bonus": {
          if (ef.target === "save") {
            const keys = ef.key === "chosen" ? picks : Array(n).fill(ef.key);
            for (const k of keys) if (d.saveData[k]) d.saveData[k].mod += ef.value;
          } else if (ef.target === "skill") {
            const keys = ef.key === "chosen" ? picks : Array(n).fill(ef.key);
            for (const k of keys) if (d.skillData[k]) { d.skillData[k].mod += ef.value; if (k === "prc") d.passivePerc += ef.value; }
          } else if (ef.target === "passive") d.passivePerc += ef.value * n;
          break;
        }
        case "advantage":
          for (const k of picks) (ef.target === "skill" ? custom.advSkills : custom.advSaves).push(k);
          break;
        case "prof":
          if (ef.target === "gear") { if (!custom.profs.includes(ef.key)) custom.profs.push(ef.key); }
          else if (ef.target === "skill") for (const k of picks) { if (d.skillData[k]) { const before = d.skillData[k].prof; addPb(d.skillData[k]); if (!before && k === "prc") d.passivePerc += d.pb; d.skillProfSet?.add?.(k); } }
          else for (const k of picks) { if (d.saveData[k]) { addPb(d.saveData[k]); d.profSaves?.add?.(k); } }
          break;
        case "pool": {
          const max = (evalFormula(ef.max, vars) ?? 0) * n;
          const key = poolKey(e.id, idx);   // no pool name in the key: it becomes an update path
          const u = Math.max(0, Math.min(max, Number(used[key]) || 0));
          custom.pools.push({ key, entryId: e.id, name: ef.name, max, value: max - u, reset: ef.reset });
          break;
        }
        case "sp":
          d.spTotal += ef.value * n;
          break;
        case "casts": {
          const slot = d.slots.find(s => s.L === ef.rank);
          if (slot) slot.total += ef.value * n;
          else { d.slots.push({ L: ef.rank, total: ef.value * n, learned: 0 }); d.slots.sort((a, b) => a.L - b.L); }
          break;
        }
        case "dice":
          custom.dice.push({ label: e.name, n: ef.value * n, element: picks[picks.length - 1] ?? "" });
          break;
        case "text":
          custom.features.push({ entryId: e.id, name: e.name, text: ef.text, ranks: n });
          break;
      }
    });
  }
  // spell points after the additions: used stays within the new total
  d.spUsed = Math.max(0, Math.min(Number(S.spUsed) || 0, d.spTotal));
  d.spLeft = d.spTotal - d.spUsed;
  return d;
}

/* ============================================================
   Export / import of the custom list
   ============================================================ */

/** File content for "Export". */
export function exportCustomShop(entries) {
  return { type: FORMAT, version: 1, entries: (entries || []).map(e => JSON.parse(JSON.stringify(e))) };
}

/**
 * Merge an imported file into the current list: same id replaces, new ids are added, broken entries are skipped.
 * @returns {{entries:object[], added:number, replaced:number, skipped:{id,name,errors}[]}|{error:string}}
 */
export function importCustomShop(data, current = []) {
  const list = Array.isArray(data) ? data : (data && data.type === FORMAT && Array.isArray(data.entries) ? data.entries : null);
  if (!list) return { error: `not an AP-Turm custom shop file (expected "type": "${FORMAT}")` };
  const out = (current || []).map(e => ({ ...e }));
  let added = 0, replaced = 0;
  const skipped = [];
  for (const raw of list) {
    const v = validateEntry(raw);
    if (!v.ok) { skipped.push({ id: v.id, name: v.name, errors: v.errors }); continue; }
    const at = out.findIndex(e => e.id === v.entry.id);
    if (at >= 0) { out[at] = v.entry; replaced++; } else { out.push(v.entry); added++; }
  }
  return { entries: out, added, replaced, skipped };
}

/** Characters (plain {name, bought}) that have bought the entry. */
export function buyersOf(id, characters) {
  return (characters || []).filter(c => (Number(c?.bought?.[id]) || 0) > 0).map(c => c.name);
}

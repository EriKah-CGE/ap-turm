/**
 * dnd5e -> AP-Turm conversion for the Spell Library and the Monster Library (pure, tested in Node).
 *
 * Only the document shell changes: dnd5e items and actors do not load in this system, so their content is carried
 * over 1:1 into AP-Turm spell items and NPCs - no turm adaptation, no conversion of numbers, no balancing.
 * - Damage / condition types keep their dnd5e keys. In mode "turm" such a type is therefore "not assigned" (yellow
 *   tag, the GM maps it when needed); in mode "ap" it is a normal D&D type.
 * - dnd5e writes its texts with enrichers ([[/attack extended]], [[/damage average]], [[lookup @name]], @UUID[...]{x}).
 *   They are rendered here the way dnd5e displays them, from the same structured data, so the text reads as in dnd5e.
 * - Derived numbers the dnd5e source does not store (save and skill totals, to-hit, save DCs "from ability") are
 *   computed with dnd5e's own formulas; the proficiency bonus comes from the CR (dnd5e does the same).
 */
import { pbFromCr } from "./statblock.mjs";
import { markUnassignedTypes } from "./rolls.mjs";
import { htmlToText } from "./exporter.mjs";

/* ============================================================
   Tables (dnd5e keys -> labels)
   ============================================================ */

export const ABILITY_LABELS = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const SCHOOLS = { abj: "Abjuration", con: "Conjuration", div: "Divination", enc: "Enchantment", evo: "Evocation", ill: "Illusion", nec: "Necromancy", trs: "Transmutation" };
const ACTIVATION = { action: "Action", bonus: "Bonus Action", reaction: "Reaction", minute: "Minute", hour: "Hour", day: "Day", special: "Special", legendary: "Legendary Action", mythic: "Mythic Action", lair: "Lair Action", crew: "Crew Action" };
const TIME_UNITS = { turn: "Turn", round: "Round", minute: "Minute", hour: "Hour", day: "Day", month: "Month", year: "Year" };
const DURATION_SPECIAL = { inst: "Instantaneous", perm: "Permanent", spec: "Special", disp: "Until Dispelled", dstr: "Until Dispelled or Triggered" };
const SIZES = { tiny: "Tiny", sm: "Small", med: "Medium", lg: "Large", huge: "Huge", grg: "Gargantuan" };
const SKILLS5E = {
  acr: ["Acrobatics", "dex"], ani: ["Animal Handling", "wis"], arc: ["Arcana", "int"], ath: ["Athletics", "str"], dec: ["Deception", "cha"],
  his: ["History", "int"], ins: ["Insight", "wis"], itm: ["Intimidation", "cha"], inv: ["Investigation", "int"], med: ["Medicine", "wis"],
  nat: ["Nature", "int"], prc: ["Perception", "wis"], prf: ["Performance", "cha"], per: ["Persuasion", "cha"], rel: ["Religion", "int"],
  slt: ["Sleight of Hand", "dex"], ste: ["Stealth", "dex"], sur: ["Survival", "wis"]
};
const LANGUAGES = { deep: "Deep Speech", cant: "Thieves' Cant", druidic: "Druidic", undercommon: "Undercommon" };
const SENSES = ["blindsight", "darkvision", "tremorsense", "truesight"];
const MOVES = ["walk", "burrow", "climb", "fly", "swim"];
const AREA = { cone: "cone", line: "ray", wall: "ray", sphere: "circle", radius: "circle", cylinder: "circle", emanation: "circle", circle: "circle", cube: "rect", square: "rect" };
const LEVEL_WORDS = ["Cantrips", "1st Level", "2nd Level", "3rd Level", "4th Level", "5th Level", "6th Level", "7th Level", "8th Level", "9th Level"];

const cap = (s) => String(s ?? "").replace(/^./, c => c.toUpperCase());
const titleCase = (s) => String(s ?? "").replace(/\b[a-z]/g, c => c.toUpperCase());
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/** A list from dnd5e data that may be an array, a Set, an empty string or missing. */
const list = (x) => (Array.isArray(x) ? x : x instanceof Set ? [...x] : x && typeof x === "object" && typeof x[Symbol.iterator] === "function" ? [...x] : []);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const abilityMod = (score) => Math.floor((num(score, 10) - 10) / 2);
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

/** CR as the statblock writes it: 0.125 -> "1/8". */
export function crText(cr) {
  const n = Number(cr);
  if (!Number.isFinite(n)) return "";
  return n === 0.125 ? "1/8" : n === 0.25 ? "1/4" : n === 0.5 ? "1/2" : String(n);
}

/** Proficiency bonus of a creature: from the data if present, else from the CR table (dnd5e does the same). */
export function creaturePb(sys) {
  const stored = Number(sys?.attributes?.prof);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return pbFromCr(crText(sys?.details?.cr)) ?? 2;
}

/* ============================================================
   Formulas and dice
   ============================================================ */

/** Resolve @-references of a dnd5e formula with the creature's numbers (@mod, @prof, @abilities.x.mod). */
export function resolveFormula(formula, ctx, abil = null) {
  let f = String(formula ?? "").trim();
  if (!f) return "";
  f = f.replace(/@abilities\.(\w{3})\.mod/g, (m, a) => String(ctx.mods[a] ?? 0))
    .replace(/@mod\b/g, () => String(abil ? ctx.mods[abil] ?? 0 : 0))
    .replace(/@prof\b/g, () => String(ctx.pb))
    .replace(/@attributes\.prof\b/g, () => String(ctx.pb));
  return f;
}

/** "2d10 + 8 + 0" -> "2d10 + 8"; simplifies the flat numbers of a sum of dice and numbers. */
export function tidyFormula(f) {
  const parts = String(f ?? "").replace(/\s+/g, "").replace(/-/g, "+-").split("+").filter(Boolean);
  const dice = [], flats = [];
  let ok = true;
  for (const p of parts) {
    if (/^-?\d*d\d+$/i.test(p)) dice.push(p.replace(/^-?/, m => m).toLowerCase());
    else if (/^-?\d+$/.test(p)) flats.push(Number(p));
    else ok = false;
  }
  if (!ok) return String(f).trim();
  const flat = flats.reduce((a, b) => a + b, 0);
  const out = dice.join(" + ");
  if (!out) return String(flat);
  return flat ? `${out} ${flat > 0 ? "+" : "-"} ${Math.abs(flat)}` : out;
}

/** Average of a dice formula ("2d10 + 8" -> 19), null when it has anything but dice and numbers. */
export function averageOf(formula) {
  const parts = String(formula ?? "").replace(/\s+/g, "").replace(/-/g, "+-").split("+").filter(Boolean);
  let total = 0;
  for (const p of parts) {
    const d = /^(-?)(\d*)d(\d+)$/i.exec(p);
    if (d) { total += (d[1] ? -1 : 1) * (Number(d[2] || 1) * (Number(d[3]) + 1)) / 2; continue; }
    if (/^-?\d+$/.test(p)) { total += Number(p); continue; }
    return null;
  }
  return Math.floor(total);
}

/** One dnd5e damage part -> {formula, type}. */
function partFormula(part, ctx, abil) {
  if (!part) return null;
  if (part.custom?.enabled && part.custom.formula) return { formula: tidyFormula(resolveFormula(part.custom.formula, ctx, abil)), type: list(part.types)[0] ?? "" };
  const n = num(part.number, 0), d = num(part.denomination, 0);
  const dice = n && d ? `${n}d${d}` : "";
  const bonus = resolveFormula(part.bonus, ctx, abil);
  const f = [dice, bonus].filter(Boolean).join(" + ");
  if (!f) return null;
  return { formula: tidyFormula(f), type: list(part.types)[0] ?? "" };
}

/* ============================================================
   Activities
   ============================================================ */

/** Save ability of a save activity: a string in dnd5e 4, a list / set in later versions. */
const saveAbilityOf = (act) => { const a = act?.save?.ability; return typeof a === "string" ? a : [...(a ?? [])][0] ?? ""; };

const activitiesOf = (item) => Object.values(item?.system?.activities ?? {}).sort((a, b) => num(a.sort) - num(b.sort));

/** Activation type of an item: an activity's own (when set) or the item's. */
function activationOf(item) {
  for (const a of activitiesOf(item)) if (a.activation?.type) return { type: a.activation.type, value: num(a.activation.value, 1) };
  const s = item?.system?.activation;
  return s?.type ? { type: s.type, value: num(s.value, 1) } : { type: "", value: 0 };
}

/** Attack ability of a weapon attack ("" = dnd5e default: STR melee, DEX ranged, the better one with finesse). */
function attackAbility(item, act, ctx) {
  const set = act?.attack?.ability;
  if (set && set !== "none" && ctx.mods[set] !== undefined) return set;
  if (set === "none") return null;
  if (set === "spellcasting") return ctx.spellAbility;
  const props = list(item.system?.properties);
  const ranged = act?.attack?.type?.value === "ranged";
  if (act?.attack?.type?.classification === "spell") return ctx.spellAbility;
  if (props.includes("fin")) return ctx.mods.dex >= ctx.mods.str ? "dex" : "str";
  return ranged ? "dex" : "str";
}

/** To-hit of an attack activity. */
export function attackBonus(item, act, ctx) {
  const bonus = num(resolveFormula(act?.attack?.bonus, ctx).replace(/\s+/g, "").split("+").reduce((a, p) => a + num(p, 0), 0));
  if (act?.attack?.flat) return bonus;
  const abil = attackAbility(item, act, ctx);
  const prof = item.type === "weapon" ? (item.system?.proficient === 0 ? 0 : ctx.pb) : ctx.pb;
  return (abil ? ctx.mods[abil] : 0) + prof + bonus + num(item.system?.magicalBonus, 0);
}

/** Damage parts of an activity (the weapon's base damage with its ability modifier first). */
export function activityDamage(item, act, ctx) {
  const out = [];
  const abil = act?.type === "attack" ? attackAbility(item, act, ctx) : (item.system?.ability || null);
  if (act?.type === "attack" && act.damage?.includeBase !== false && item.type === "weapon") {
    const base = item.system?.damage?.base;
    const p = partFormula(base, ctx, abil);
    if (p) {
      const flat = (abil ? ctx.mods[abil] : 0) + num(item.system?.magicalBonus, 0);
      out.push({ formula: tidyFormula(`${p.formula} + ${flat}`), type: p.type });
    }
  }
  for (const part of list(act?.damage?.parts)) { const p = partFormula(part, ctx, abil); if (p) out.push(p); }
  return out;
}

/** Save DC of a save activity. */
export function saveDc(act, ctx) {
  const dc = act?.save?.dc ?? {};
  const calc = dc.calculation ?? "";
  if (!calc || calc === "flat" || calc === "custom") { const n = Number(resolveFormula(dc.formula, ctx)); return Number.isFinite(n) && n > 0 ? n : null; }
  if (calc === "spellcasting") return 8 + ctx.pb + (ctx.spellAbility ? ctx.mods[ctx.spellAbility] : 0);
  if (ctx.mods[calc] !== undefined) return 8 + ctx.pb + ctx.mods[calc];
  const n = Number(dc.formula);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Reach / range text of an attack ("10 ft", "80/320 ft", "5 ft / 20/60 ft"). */
function rangeText(item, act) {
  const r = item.system?.range ?? {};
  const melee = act?.attack?.type?.value !== "ranged";
  const thrown = list(item.system?.properties).includes("thr");
  const reach = num(r.reach, 0) || 5;
  const ranged = r.value ? `${r.value}${r.long ? `/${r.long}` : ""} ft` : "";
  if (melee && thrown && ranged) return `${reach} ft / ${ranged}`;
  if (melee) return `${reach} ft`;
  return ranged;
}

/* ============================================================
   Enrichers (rendered as dnd5e shows them)
   ============================================================ */

function damageText(parts, { average = false, extended = false } = {}) {
  if (!parts.length) return "";
  const one = (p) => {
    const avg = averageOf(p.formula);
    const t = p.type ? ` ${titleCase(p.type)}` : "";
    return average && avg !== null ? `${avg} (${p.formula})${t}` : `${p.formula}${t}`;
  };
  if (extended) return `Hit: ${parts.map(p => `${one(p)} damage`).join(" plus ")}`;
  return parts.map(one).join(" plus ");
}

function attackText(item, act, ctx, extended, { bare = false } = {}) {
  if (!act) return "";
  const bonus = signed(attackBonus(item, act, ctx));
  if (!extended) return bonus;
  const ranged = act.attack?.type?.value === "ranged";
  const spell = act.attack?.type?.classification === "spell";
  const r = item.system?.range ?? {};
  const reach = num(r.reach, 0) || 5;
  const range = r.value ? `range ${r.value}${r.long ? `/${r.long}` : ""} ft.` : "";
  const thrown = list(item.system?.properties).includes("thr");
  if (ctx.rules === "2024") {
    const kind = ranged ? "Ranged" : thrown && range ? "Melee or Ranged" : "Melee";
    const where = (ranged ? range : thrown && range ? `reach ${reach} ft. or ${range}` : `reach ${reach} ft.`).replace(/\.$/, "");
    return bare ? `${kind} Attack Roll: ${bonus}` : `${kind} Attack Roll: ${bonus}, ${where}`;
  }
  const kind = `${ranged ? "Ranged" : thrown && range ? "Melee or Ranged" : "Melee"} ${spell ? "Spell" : "Weapon"} Attack`;
  if (bare) return `${kind}: ${bonus} to hit`;
  const where = ranged ? range : thrown && range ? `reach ${reach} ft. or ${range}` : `reach ${reach} ft.`;
  const count = num(act.target?.affects?.count, 1);
  return `${kind}: ${bonus} to hit, ${where}, ${count > 1 ? `${count} targets` : "one target"}`;
}

/** Parse the options of an enricher: "extended average dex 21 format=long" -> {flags:Set, kv:{}, words:[]}. */
function enricherArgs(s) {
  const words = [], kv = {};
  for (const w of String(s ?? "").trim().split(/\s+/).filter(Boolean)) {
    const m = /^(\w+)=(.*)$/.exec(w);
    if (m) kv[m[1]] = m[2]; else words.push(w);
  }
  return { words, kv, has: (f) => words.includes(f) || kv[f] === "true" };
}

/**
 * Render the dnd5e enrichers of a text.
 * @param {string} html
 * @param {object} ctx   {name, mods, pb, spellAbility, spellDc, spellAttack, rules, item (for [[/attack]] etc.)}
 */
export function renderEnrichers(html, ctx) {
  const item = ctx.item ?? null;
  const acts = item ? activitiesOf(item) : [];
  const actBy = (id) => acts.find(a => a._id === id) ?? null;
  const firstOf = (types) => acts.find(a => types.includes(a.type)) ?? null;
  let s = String(html ?? "");
  // [[...]]{Label}: the label wins
  s = s.replace(/\[\[[^\]]*\]\]\{([^}]*)\}/g, "$1");
  s = s.replace(/\[\[\s*\/(\w+)\s*([^\]]*)\]\]/g, (m, cmd, rest, offset, whole) => {
    const a = enricherArgs(rest);
    const act = a.kv.activity ? actBy(a.kv.activity) : null;
    switch (cmd.toLowerCase()) {
      case "attack": {
        const at = act ?? firstOf(["attack"]);
        if (a.words.length && /^[+-]?\d+$/.test(a.words[0])) return signed(Number(a.words[0]));
        // some texts write the reach themselves right after the enricher (", reach 10 ft., one target")
        const bare = /^\s*,\s*(reach|range)\b/i.test(whole.slice(offset + m.length));
        return at ? attackText(item, at, ctx, a.has("extended"), { bare }) : "";
      }
      case "damage": {
        const formulaWords = a.words.filter(w => !["average", "extended"].includes(w));
        let parts;
        if (formulaWords.length) {
          const type = a.kv.type ?? a.kv.types ?? "";
          parts = [{ formula: tidyFormula(resolveFormula(formulaWords.join(" "), ctx, item?.system?.ability || null)), type: type.split(/[,|]/)[0] }];
        } else {
          const d = act ?? firstOf(["attack", "damage", "save"]);
          parts = d && item ? activityDamage(item, d, ctx) : [];
        }
        // "extended" is the statblock form, which dnd5e always writes with the average
        const average = a.has("average") || a.has("extended") || (a.kv.average !== undefined && a.kv.average !== "false");
        return damageText(parts, { average, extended: a.has("extended") });
      }
      case "save": {
        const ab = a.words.find(w => ABILITY_LABELS[w]) ?? a.kv.ability;
        const dcWord = a.words.find(w => /^\d+$/.test(w)) ?? a.kv.dc;
        const sv = act ?? firstOf(["save"]);
        const ability = ab ?? saveAbilityOf(sv);
        const dc = dcWord ? Number(dcWord) : (sv ? saveDc(sv, ctx) : null);
        const label = ABILITY_LABELS[ability] ?? cap(ability);
        const core = `${dc ? `DC ${dc} ` : ""}${label}`.trim();
        return a.kv.format === "long" || a.has("extended") ? `${core} saving throw` : core;
      }
      case "check": case "skill": case "tool": {
        const dcWord = a.words.find(w => /^\d+$/.test(w)) ?? a.kv.dc;
        const what = a.words.filter(w => !/^\d+$/.test(w)).map(w => SKILLS5E[w]?.[0] ?? ABILITY_LABELS[w] ?? cap(w)).join(" ");
        const core = `${dcWord ? `DC ${dcWord} ` : ""}${what}`.trim();
        return a.kv.format === "long" ? `${core} check` : core;
      }
      case "item": return a.words.join(" ").replace(/^["']|["']$/g, "");
      case "r": case "roll": case "gmr": case "br": case "pr": case "sr": return tidyFormula(resolveFormula(a.words.join(" ").replace(/#.*/, ""), ctx));
      case "heal": case "healing": return a.words.filter(w => !["average", "extended"].includes(w)).join(" ");
      case "award": return a.words.join(" ");
      default: return a.words.join(" ");
    }
  });
  // [[lookup @path option]]
  s = s.replace(/\[\[\s*lookup\s+@([\w.]+)([^\]]*)\]\]/gi, (m, path, rest) => {
    const a = enricherArgs(rest);
    const act = a.kv.activity ? actBy(a.kv.activity) : null;
    let v = "";
    if (path === "name") v = ctx.name ?? "";
    else if (path === "save.dc.value") v = act ? saveDc(act, ctx) ?? "" : "";
    else if (path === "target.affects.type") v = act?.target?.affects?.type || "creature";
    else if (path === "target.template.size") v = act?.target?.template?.size ?? "";
    else if (path === "target.affects.count") v = act?.target?.affects?.count ?? "";
    else if (path === "attributes.spell.dc" || path === "attributes.spelldc") v = ctx.spellDc ?? "";
    else if (path === "attributes.spell.attack") v = ctx.spellAttack ?? "";
    else if (/^abilities\.(\w{3})\.mod$/.test(path)) v = ctx.mods[path.split(".")[1]] ?? "";
    else if (path === "prof" || path === "attributes.prof") v = ctx.pb;
    const text = String(v);
    return a.has("lowercase") ? text.toLowerCase() : a.has("uppercase") ? text.toUpperCase() : a.has("capitalize") ? cap(text) : text;
  });
  // inline rolls [[1d6]] / [[/r ...]] leftovers
  s = s.replace(/\[\[\s*([^\]]*?)\s*\]\]/g, (m, inner) => tidyFormula(resolveFormula(inner, ctx)));
  // links: @UUID[...]{Label} / @Compendium[...]{Label} / &Reference[prone]{Label} / @Embed[...]
  s = s.replace(/@(?:UUID|Compendium|Item|Actor|JournalEntry|RollTable)\[[^\]]*\]\{([^}]*)\}/g, "$1");
  s = s.replace(/@(?:UUID|Compendium|Item|Actor|JournalEntry|RollTable)\[([^\]]*)\]/g, (m, id) => id.split(".").pop());
  s = s.replace(/&(?:amp;)?Reference\[[^\]]*\]\{([^}]*)\}/g, "$1");
  s = s.replace(/&(?:amp;)?Reference\[([^\]\s=]*)[^\]]*\]/g, (m, id) => id.split(".").pop());
  s = s.replace(/@Embed\[[^\]]*\](\{[^}]*\})?/g, "");
  return s;
}

/* ============================================================
   Spells
   ============================================================ */

/** The header lines of a spell as dnd5e shows them (school/level, casting time, range, components, duration). */
export function spellHeader(sys) {
  const lvl = num(sys.level, 0);
  const school = SCHOOLS[sys.school] ?? cap(sys.school);
  const props = new Set(list(sys.properties));
  const ritual = props.has("ritual");
  const conc = props.has("concentration");
  const levelLine = lvl === 0 ? `${school} Cantrip` : `Level ${lvl} ${school}`;
  const act = sys.activation ?? {};
  const actType = act.type ?? Object.values(sys.activities ?? {})[0]?.activation?.type ?? "";
  const actValue = num(act.value, 1);
  let casting = ACTIVATION[actType] ?? cap(actType);
  if (["minute", "hour", "day"].includes(actType)) casting = `${actValue} ${casting}${actValue === 1 ? "" : "s"}`;
  else if (actType) casting = `${actValue > 1 ? `${actValue} ` : ""}${casting}${actValue > 1 ? "s" : ""}`;
  if (act.condition) casting += `, ${act.condition}`;
  if (ritual) casting += " or Ritual";
  const r = sys.range ?? {};
  let range = (r.units === "ft" || r.units === "mi") && !r.value ? "—" : r.units === "ft" || r.units === "mi" ? `${r.value} ${r.units === "ft" ? "feet" : r.value === "1" ? "mile" : "miles"}` : ({ self: "Self", touch: "Touch", spec: "Special", any: "Unlimited", sight: "Sight" }[r.units] ?? cap(r.units ?? ""));
  const tpl = sys.target?.template;
  if (tpl?.type && tpl.size) {
    const shape = `${tpl.size}-${tpl.units === "mi" ? "mile" : "foot"} ${tpl.type}`;
    range = r.units === "self" ? `Self (${shape})` : `${range} (${shape})`;
  }
  const comps = [props.has("vocal") && "V", props.has("somatic") && "S", props.has("material") && "M"].filter(Boolean).join(", ");
  const material = props.has("material") && sys.materials?.value ? ` (${sys.materials.value})` : "";
  const d = sys.duration ?? {};
  let duration = DURATION_SPECIAL[d.units] ?? (TIME_UNITS[d.units] ? `${d.value || 1} ${TIME_UNITS[d.units]}${num(d.value, 1) === 1 ? "" : "s"}` : cap(d.units ?? ""));
  if (conc) duration = `Concentration, up to ${duration}`;
  return { levelLine, casting, range, components: comps + material, duration, ritual, concentration: conc };
}

/**
 * Convert a dnd5e spell item into an AP-Turm spell item.
 * @param {object} doc      dnd5e Item source (type "spell")
 * @param {object} [o]      {source: label of the source pack, img: resolved image path ("" = default)}
 * @returns {object}        Item create data
 */
export function convertSpell(doc, { source = "", img = null } = {}) {
  const sys = doc.system ?? {};
  const h = spellHeader(sys);
  const ctx = { name: doc.name, mods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, pb: 2, spellAbility: null, rules: sys.source?.rules ?? "2014", item: doc };
  const body = renderEnrichers(sys.description?.value ?? "", ctx);
  const src = [sys.source?.book, sys.source?.custom].filter(Boolean).join(", ");
  const markers = [h.concentration && "Concentration", h.ritual && "Ritual"].filter(Boolean);
  const description = `<div class="apt-spell5e">`
    + `<p class="apt-spell-head"><em>${esc(h.levelLine)}</em>${markers.length ? ` · <strong>${markers.join(" · ")}</strong>` : ""}</p>`
    + `<p><strong>Casting Time:</strong> ${esc(h.casting)}<br><strong>Range:</strong> ${esc(h.range)}<br>`
    + `<strong>Components:</strong> ${esc(h.components || "None")}<br><strong>Duration:</strong> ${esc(h.duration)}</p>`
    + `<hr>${body}`
    + (src || sys.source?.rules ? `<p class="apt-spell-src"><small>Source: ${esc(src || "dnd5e")}${sys.source?.rules ? ` (${esc(sys.source.rules)} rules)` : ""}</small></p>` : "")
    + `</div>`;
  return {
    name: doc.name,
    type: "spell",
    img: img || "icons/svg/book.svg",
    system: { lvl: Math.max(0, Math.min(9, num(sys.level, 0))), elem: "", notes: "", prepared: true, concentration: h.concentration, description },
    flags: { "ap-turm": { dnd5e: { source, id: doc._id ?? "", identifier: sys.identifier ?? "" } } }
  };
}

/**
 * Split a spell description for the chat card: the header part (level line, casting time, range, components,
 * duration - everything before the first <hr>) stays visible, the rest folds. Without an <hr> everything folds.
 * @param {string} html
 * @returns {{head: string, body: string}}
 */
export function spellDescriptionParts(html) {
  const s = String(html ?? "").trim();
  if (!s) return { head: "", body: "" };
  const i = s.search(/<hr\s*\/?>/i);
  if (i < 0) return { head: "", body: s };
  const m = /<hr\s*\/?>/i.exec(s.slice(i));
  let head = s.slice(0, i), body = s.slice(i + m[0].length);
  // a wrapper opened in the head (<div class="apt-spell5e">) closes in the body: keep both parts well-formed
  const open = /^<div[^>]*>/i.exec(head);
  if (open && /<\/div>\s*$/i.test(body)) { head = head.slice(open[0].length); body = body.replace(/<\/div>\s*$/i, ""); }
  return { head: head.trim(), body: body.trim() };
}

/* ============================================================
   Creatures
   ============================================================ */

/** Section of a creature feature from its dnd5e activation. */
export function sectionOf(item) {
  if (/^Legendary Actions?$/i.test(item.name)) return "legendary";
  if (/^Lair Actions?$/i.test(item.name)) return "lair";
  const t = activationOf(item).type;
  return { action: "actions", bonus: "bonus", reaction: "reactions", legendary: "legendary", mythic: "legendary", lair: "lair" }[t] ?? "traits";
}

/** Recharge ("5-6", "6") and uses (x/Day) of a feature. */
function usesOf(item) {
  const u = item.system?.uses ?? {};
  const rec = list(u.recovery);
  const recharge = rec.find(r => r?.period === "recharge");
  const oldRecharge = num(item.system?.recharge?.value, 0);          // dnd5e 3 shape
  if (recharge || oldRecharge) { const f = recharge ? num(recharge.formula, 6) : oldRecharge; return { recharge: f >= 6 ? "6" : `${f}-6`, uses: null }; }
  const max = Number(u.max);
  if (Number.isFinite(max) && max > 0) {
    const per = rec.find(r => ["day", "dawn", "dusk", "lr", "sr"].includes(r?.period))?.period ?? (typeof u.per === "string" ? u.per : "");
    const perText = { day: "day", dawn: "day", dusk: "day", lr: "long rest", sr: "short rest" }[per] ?? "";
    return { recharge: "", uses: { value: Math.max(0, max - num(u.spent, 0)), max, per: perText } };
  }
  return { recharge: "", uses: null };
}

/** An embedded feature -> an NPC statblock entry. */
export function featureEntry(item, ctx) {
  const icx = { ...ctx, item };
  const text = htmlToText(renderEnrichers(item.system?.description?.value ?? "", icx)).replace(/\n{3,}/g, "\n\n").trim();
  const acts = activitiesOf(item);
  const attack = acts.find(a => a.type === "attack");
  const save = acts.find(a => a.type === "save");
  const dmgAct = attack ?? save ?? acts.find(a => a.type === "damage");
  const parts = dmgAct ? activityDamage(item, dmgAct, ctx) : [];
  const act = activationOf(item);
  const { recharge, uses } = usesOf(item);
  const tplAct = acts.find(a => a.target?.template?.type) ?? null;
  const tpl = tplAct?.target?.template ?? item.system?.target?.template ?? null;
  const shape = tpl?.type ? AREA[tpl.type] ?? "" : "";
  return {
    name: item.name,
    section: sectionOf(item),
    text,
    toHit: attack ? attackBonus(item, attack, ctx) : null,
    range: attack ? rangeText(item, attack) : "",
    saveDc: save ? saveDc(save, ctx) : null,
    saveAbility: save ? saveAbilityOf(save) : "",
    damage: parts.map(p => p.formula).join(" + "),
    dmgType: parts[0]?.type ?? "",
    areaShape: shape,
    areaSize: shape ? num(tpl.size, 0) : 0,
    recharge,
    rechargeUsed: false,
    uses: uses ?? { value: 0, max: 0, per: "" },
    legendaryCost: act.type === "legendary" || act.type === "mythic" ? Math.max(1, act.value || 1) : 0,
    parent: ""
  };
}

/** Spell list of a spellcasting creature as a plain-text trait. */
export function spellcastingEntry(spells, ctx) {
  if (!spells.length) return null;
  const byLevel = new Map();
  for (const s of spells) {
    const l = num(s.system?.level, 0);
    if (!byLevel.has(l)) byLevel.set(l, new Set());
    byLevel.get(l).add(s.name);
  }
  const lines = [...byLevel.keys()].sort((a, b) => a - b).map(l => `${LEVEL_WORDS[l] ?? `Level ${l}`}: ${[...byLevel.get(l)].join(", ")}`);
  const ability = ctx.spellAbility ? ABILITY_LABELS[ctx.spellAbility] : "";
  const head = `Spellcasting${ability ? ` (${ability})` : ""}: spell save DC ${ctx.spellDc}, ${signed(ctx.spellAttack)} to hit with spell attacks.`;
  return {
    name: "Spellcasting (spell list)", section: "traits", text: [head, ...lines].join("\n"),
    toHit: null, range: "", saveDc: null, saveAbility: "", damage: "", dmgType: "", areaShape: "", areaSize: 0,
    recharge: "", rechargeUsed: false, uses: { value: 0, max: 0, per: "" }, legendaryCost: 0, parent: ""
  };
}

function languagesText(t) {
  const lang = t?.languages ?? {};
  const out = list(lang.value).map(k => LANGUAGES[k] ?? titleCase(String(k).replace(/^.*:/, "")));
  if (lang.custom) out.push(...String(lang.custom).split(/;\s*/).filter(Boolean));
  const tele = lang.communication?.telepathy?.value;
  if (tele) out.push(`Telepathy ${tele} ${lang.communication.telepathy.units || "ft"}.`);
  return out.join(", ");
}

function sensesText(attr) {
  const s = attr?.senses ?? {};
  const ranges = s.ranges ?? s;
  const units = s.units || "ft";
  const out = SENSES.filter(k => num(ranges[k], 0) > 0).map(k => `${cap(k)} ${ranges[k]} ${units}.`);
  if (s.special) out.push(s.special);
  return out.join(", ");
}

function typeLine(sys) {
  const d = sys.details ?? {};
  const t = d.type ?? {};
  const size = SIZES[sys.traits?.size] ?? cap(sys.traits?.size ?? "");
  let type = t.value === "custom" ? t.custom : cap(t.value ?? "");
  if (t.swarm) type = `Swarm of ${SIZES[t.swarm] ?? cap(t.swarm)} ${cap(t.value)}s`;
  if (t.subtype) type += ` (${t.subtype})`;
  return [[size, type].filter(Boolean).join(" "), d.alignment].filter(Boolean).join(", ");
}

/** Armor class of a creature (dnd5e calculations: flat / natural / default with armor / mage armor ...). */
export function creatureAc(sys, items, mods) {
  const ac = sys.attributes?.ac ?? {};
  const calc = ac.calc ?? "default";
  if (calc === "flat" || calc === "natural") return num(ac.flat, 10);
  if (calc === "mage") return 13 + mods.dex;
  if (calc === "draconic") return 13 + mods.dex;
  if (calc === "unarmoredMonk") return 10 + mods.dex + mods.wis;
  if (calc === "unarmoredBarb") return 10 + mods.dex + mods.con;
  if (calc === "custom" && ac.formula) {
    const f = String(ac.formula).replace(/@abilities\.(\w{3})\.mod/g, (m, a) => String(mods[a] ?? 0));
    if (/^[\d\s+\-]+$/.test(f)) return f.replace(/\s+/g, "").replace(/-/g, "+-").split("+").filter(Boolean).reduce((a, b) => a + Number(b), 0);
  }
  // default: equipped armor + shield
  const eq = (items ?? []).filter(i => i.type === "equipment" && i.system?.equipped !== false);
  const armor = eq.find(i => ["light", "medium", "heavy", "natural"].includes(i.system?.type?.value) && num(i.system?.armor?.value, 0) > 0);
  const shield = eq.filter(i => i.system?.type?.value === "shield").reduce((a, i) => a + num(i.system?.armor?.value, 2) + num(i.system?.armor?.magicalBonus, 0), 0);
  let base = 10 + mods.dex;
  if (armor) {
    const cap_ = armor.system.armor.dex;
    const dex = cap_ === null || cap_ === undefined || cap_ === "" ? mods.dex : Math.min(mods.dex, num(cap_, 0));
    base = num(armor.system.armor.value, 10) + num(armor.system.armor.magicalBonus, 0) + (armor.system.type.value === "heavy" ? 0 : dex);
  }
  return base + shield + (num(ac.flat, 0) && calc === "default" ? 0 : 0);
}

/**
 * Convert a dnd5e NPC actor into an AP-Turm NPC.
 * @param {object} doc      dnd5e Actor source with its embedded items as objects (doc.items[])
 * @param {object} [o]      {source, mode ("turm" | "ap"), img / tokenImg: resolved paths ("" = default), imgNote}
 * @returns {object}        Actor create data
 */
export function convertMonster(doc, { source = "", mode = "turm", img = null, tokenImg = null } = {}) {
  const sys = doc.system ?? {};
  const items = (doc.items ?? []).filter(i => i && typeof i === "object");
  const abilities = {}, mods = {};
  for (const k of Object.keys(ABILITY_LABELS)) { abilities[k] = Math.max(1, Math.min(30, num(sys.abilities?.[k]?.value, 10))); mods[k] = abilityMod(abilities[k]); }
  const pb = creaturePb(sys);
  const spellAbility = sys.attributes?.spellcasting || null;
  const spellMod = spellAbility ? mods[spellAbility] : 0;
  const bonusDc = num(sys.bonuses?.spell?.dc, 0);
  const ctx = {
    name: doc.name, mods, pb, spellAbility, rules: sys.source?.rules ?? "2014",
    spellDc: 8 + pb + spellMod + bonusDc, spellAttack: pb + spellMod
  };
  const globalSave = num(sys.bonuses?.abilities?.save, 0);
  const saves = {};
  for (const k of Object.keys(ABILITY_LABELS)) {
    const a = sys.abilities?.[k] ?? {};
    const total = mods[k] + (num(a.proficient, 0) ? pb : 0) + num(a.bonuses?.save, 0) + globalSave;
    saves[k] = total === mods[k] ? null : total;
  }
  const skills = {};
  for (const [k, sk] of Object.entries(sys.skills ?? {})) {
    const def = SKILLS5E[k];
    if (!def) continue;
    const mult = num(sk.value, 0);
    const extra = num(sk.bonuses?.check, 0);
    if (!mult && !extra) continue;
    const abil = sk.ability || def[1];
    skills[def[0].toLowerCase().replace(/\s+/g, "")] = mods[abil] + Math.floor(mult * pb) + extra;
  }
  const mv = sys.attributes?.movement ?? {};
  const speeds = MOVES.filter(k => k !== "walk" && num(mv[k], 0) > 0).map(k => `${cap(k)} ${mv[k]}${k === "fly" && mv.hover ? " (hover)" : ""}`).join(", ");
  const t = sys.traits ?? {};
  const keys = (x) => list(x?.value).map(String);
  const defenseNote = ["dr", "di", "dv"].map(k => {
    const x = t[k] ?? {};
    const label = { dr: "Resistances", di: "Immunities", dv: "Vulnerabilities" }[k];
    const bits = [];
    if (list(x.bypasses).length) {
      const by = list(x.bypasses);
      const q = [by.includes("mgc") && "from nonmagical attacks", by.includes("ada") && "that aren't adamantine", by.includes("sil") && "that aren't silvered"].filter(Boolean).join(" ");
      bits.push(`${keys(x).map(titleCase).join(", ")} ${q || `(bypassed by: ${by.join(", ")})`}`);
    }
    if (x.custom) bits.push(x.custom);
    return bits.length ? `${label}: ${bits.join("; ")}` : "";
  }).filter(Boolean).join("\n");
  const ci = [...keys(t.ci).map(titleCase), ...(t.ci?.custom ? [t.ci.custom] : [])].join(", ");
  const features = items.filter(i => i.type !== "spell" && !["equipment", "loot", "consumable", "container", "tool", "backpack"].includes(i.type))
    .sort((a, b) => num(a.sort) - num(b.sort));
  const gear = items.filter(i => ["equipment", "loot", "consumable", "container", "tool", "backpack"].includes(i.type)).map(i => i.name);
  const entries = features.map(i => featureEntry(i, ctx));
  const spellEntry = spellcastingEntry(items.filter(i => i.type === "spell"), ctx);
  if (spellEntry) entries.push(spellEntry);
  const hp = sys.attributes?.hp ?? {};
  const hpMax = Math.max(0, num(hp.max, num(hp.value, 1)));
  const notes = [
    `<p>Imported from ${esc(source || "dnd5e")}.</p>`,
    hp.formula ? `<p>Hit Points: ${esc(String(hpMax))} (${esc(hp.formula)})</p>` : "",
    sys.details?.environment ? `<p>Environment: ${esc(sys.details.environment)}</p>` : "",
    sys.details?.biography?.value ? sys.details.biography.value : ""
  ].join("");
  const legact = num(sys.resources?.legact?.max, 0), legres = num(sys.resources?.legres?.max, 0);
  const proto = doc.prototypeToken ?? {};
  const out = {
    name: doc.name,
    type: "npc",
    img: img || "icons/svg/mystery-man.svg",
    prototypeToken: {
      name: proto.name || doc.name, actorLink: false,
      width: num(proto.width, 1) || 1, height: num(proto.height, proto.width ?? 1) || 1,
      texture: { src: tokenImg || img || "icons/svg/mystery-man.svg" },
      displayName: proto.displayName ?? 20, disposition: proto.disposition ?? -1
    },
    system: {
      mode,
      typeLine: typeLine(sys),
      hp: { value: Math.max(0, num(hp.value, hpMax)), max: hpMax, temp: 0 },
      ac: creatureAc(sys, items, mods),
      dc: spellAbility ? ctx.spellDc : 0,
      speed: num(mv.walk, 0),
      speeds,
      pb,
      abilities,
      saves,
      skills,
      senses: sensesText(sys.attributes),
      languages: languagesText(t),
      conditionImmunities: ci,
      defenseNote,
      headerNotes: gear.length ? `Gear: ${gear.join(", ")}` : "",
      resistances: keys(t.dr), immunities: keys(t.di), vulnerabilities: keys(t.dv),
      legendary: { resist: { value: legres, max: legres }, actions: { value: legact, max: legact } },
      entries,
      cr: crText(sys.details?.cr),
      statblock: "",
      notes
    },
    flags: { "ap-turm": { dnd5e: { source, id: doc._id ?? "", cr: Number(sys.details?.cr) || 0 } } }
  };
  // mode turm: the D&D types are "not assigned" until the GM decides (prefix "?")
  markUnassignedTypes(out.system, mode);
  out.system.typeMarks = true;
  return out;
}

/** CR band folder of a creature: "CR 0–4", "CR 5–10", "CR 11–16", "CR 17+". */
export function crBand(cr) {
  const n = Number(cr) || 0;
  return n <= 4 ? "CR 0–4" : n <= 10 ? "CR 5–10" : n <= 16 ? "CR 11–16" : "CR 17+";
}

/** Keep the first document per name (case-insensitive) in source order; returns {kept, dropped:[{name, source}]}. */
export function dedupeByName(list) {
  const seen = new Set(), kept = [], dropped = [];
  for (const x of list) {
    const k = String(x.name ?? "").trim().toLowerCase();
    if (seen.has(k)) { dropped.push({ name: x.name, source: x.source }); continue; }
    seen.add(k); kept.push(x);
  }
  return { kept, dropped };
}

/* ============================================================
   Libraries per source
   ============================================================ */

/** The import sources: key (file and pack names), label (compendium title) and the short tag of the picker. */
export const LIBRARY_SOURCES = [
  { key: "srd2014", label: "SRD 2014", tag: "SRD 2014" },
  { key: "srd2024", label: "SRD 2024", tag: "SRD 2024" },
  { key: "ddb-terra-nova", label: "DDB terra-nova", tag: "DDB" }
];
export const sourceDef = (key) => LIBRARY_SOURCES.find(s => s.key === key) ?? null;

/**
 * Compendium of one kind and source: name "ap-turm-spells-srd2014", label "Spells — SRD 2014".
 * Spells: players may read (Observer); monsters: GM only.
 */
export function libraryPackDef(kind, key) {
  const src = sourceDef(key) ?? { key, label: key, tag: key };
  const spells = kind === "spells";
  return {
    kind, key, tag: src.tag,
    name: `ap-turm-${kind}-${key}`,
    label: `${spells ? "Spells" : "Monsters"} — ${src.label}`,
    type: spells ? "Item" : "Actor",
    ownership: spells ? { PLAYER: "OBSERVER", TRUSTED: "OBSERVER", ASSISTANT: "OWNER" } : { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "OWNER" }
  };
}

/** Bundle file of one kind and source: "spells-srd2014.json". */
export const bundleFile = (kind, key) => `${kind}-${key}.json`;

/**
 * Drop duplicate names only WITHIN one source; the same name from different sources stays (one per compendium).
 * @param {{name:string, source:string}[]} list
 * @returns {{bySource: Map<string, object[]>, dropped: {name, source}[]}}
 */
export function dedupeWithinSource(list) {
  const bySource = new Map(), dropped = [];
  for (const x of list) {
    if (!bySource.has(x.source)) bySource.set(x.source, []);
    bySource.get(x.source).push(x);
  }
  for (const [src, items] of bySource) {
    const r = dedupeByName(items);
    bySource.set(src, r.kept);
    dropped.push(...r.dropped);
  }
  return { bySource, dropped };
}

/**
 * Entries of the Spell Library picker from several compendia: every entry keeps its pack and gets the source tag;
 * sorted by name, then by source order.
 * @param {{pack:string, key:string, entries:object[]}[]} sources   index entries per spell compendium
 * @returns {object[]}  {_id, name, img, system, pack, key, tag, label: "Fireball — SRD 2014"}
 */
export function mergeSpellEntries(sources) {
  const order = (k) => { const i = LIBRARY_SOURCES.findIndex(s => s.key === k); return i < 0 ? 99 : i; };
  const out = [];
  for (const s of sources ?? []) {
    const tag = sourceDef(s.key)?.tag ?? s.key;
    for (const e of s.entries ?? []) {
      if (e.type && e.type !== "spell") continue;
      out.push({ ...e, pack: s.pack, key: s.key, tag, label: `${e.name} — ${tag}` });
    }
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)) || order(a.key) - order(b.key));
}

/* ---------- bundle transfer (Export bundles / Import from bundle file) ---------- */

export const BUNDLE_FORMAT = "ap-turm-dnd5e-import";
/** The one zip that carries all bundles and their local images to another installation. */
export const LIBRARY_ZIP = "ap-turm-libraries.zip";
/** Where the extract tool copies world-local images and where package images are moved for the transfer (relative to Data). */
export const LOCAL_IMAGE_DIR = "ap-turm-import/images/";
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i;

/** {kind, key} of a bundle file name ("spells-srd2014.json", also inside a folder of a zip), else null. */
export function bundleKeyOfFile(name) {
  const base = String(name ?? "").split(/[\\/]/).pop();
  const m = /^(spells|monsters)-(.+)\.json$/i.exec(base);
  if (!m || !sourceDef(m[2])) return null;
  return { kind: m[1].toLowerCase(), key: m[2] };
}

/** Why an object is not a usable import bundle (null when it is); kind/key must match when given. */
export function bundleProblem(bundle, kind = null, key = null) {
  if (!bundle || typeof bundle !== "object") return "not a JSON object";
  if (bundle.format !== BUNDLE_FORMAT) return "not an AP-Turm library bundle";
  if (!["spells", "monsters"].includes(bundle.kind)) return `unknown kind "${bundle.kind}"`;
  if (!sourceDef(bundle.source)) return `unknown source "${bundle.source}"`;
  if (kind && bundle.kind !== kind) return `contains ${bundle.kind}, expected ${kind}`;
  if (key && bundle.source !== key) return `source ${bundle.source}, expected ${key}`;
  if (!Array.isArray(bundle.docs)) return "no documents";
  return null;
}

const IMAGE_REF = /\.(png|jpe?g|webp|gif|svg|avif|bmp)(\?[^\s<]*)?$/i;
const NOT_CARRIED = /^(https?:|data:|blob:|icons\/|systems\/ap-turm\/)/i;
const PACKAGE_DIR = /^(systems|modules|worlds)\//i;
/** Fields that hold an image path (document img, token texture src, icons); text fields are never read as paths. */
const IMAGE_KEYS = new Set(["img", "src", "icon", "image", "thumb", "avatar"]);
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const safePath = (p) => !!p && !/^[a-z]+:/i.test(p) && p.split("/").every(x => x && x !== "." && x !== "..");

/**
 * Make a bundle portable: every local image it refers to travels in the libraries zip.
 * - Web addresses, Foundry's core icons (icons/...) and this system's own files stay and are not carried.
 * - Files in Data (ddb-images/..., tokenizer/..., ap-turm-import/images/...) keep their path.
 * - Files inside another package or a world (systems/dnd5e/..., modules/..., worlds/...) would not exist at the
 *   recipient: they move to ap-turm-import/images/<same path>, and the bundle refers to the new place.
 * @returns {{bundle:object, images:{src:string, path:string}[], changed:boolean}}  src: the file at the sender,
 *   path: the Data path in the zip and at the recipient
 */
export function portableBundle(bundle) {
  const images = new Map();
  let changed = false;
  const map = (v, key) => {
    if (!IMAGE_KEYS.has(key) || !IMAGE_REF.test(v) || NOT_CARRIED.test(v) || /[<\n]/.test(v)) return v;
    const file = safeDecode(v.split("?")[0]);
    if (!safePath(file)) return v;
    const path = PACKAGE_DIR.test(file) ? LOCAL_IMAGE_DIR + file : file;
    images.set(path, file);
    if (path === file) return v;
    changed = true;
    return path;
  };
  const walk = (v, key) => typeof v === "string" ? map(v, key)
    : Array.isArray(v) ? v.map(x => walk(x, key))
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)])) : v;
  const docs = (bundle?.docs ?? []).map(d => ({ ...d, data: walk(d.data, null) }));
  const list = [...images].map(([path, src]) => ({ src, path })).sort((a, b) => a.path.localeCompare(b.path));
  return { bundle: changed ? { ...bundle, docs } : bundle, images: list, changed };
}

/**
 * Target path in Data for an image entry of the libraries zip: the entry's own path (Data-relative), never inside
 * systems/, modules/ or worlds/ and never outside Data; null for anything else.
 */
export function imageTargetOfEntry(name) {
  const n = String(name ?? "").replace(/\\/g, "/");
  if (!IMAGE_EXT.test(n) || !safePath(n) || PACKAGE_DIR.test(n)) return null;
  return n;
}

/** Document data from a compendium for a bundle: without id, folder, sort, ownership and stats. */
export function bundleDocData(obj) {
  const { _id, folder, sort, ownership, _stats, ...rest } = obj ?? {};
  return rest;
}

/**
 * A bundle written back from a world compendium (when the file on disk is missing).
 * @param {"spells"|"monsters"} kind
 * @param {string} key
 * @param {{folder:string|null, data:object}[]} docs   compendium documents (bundleDocData) with their folder name
 */
export function bundleFromPack(kind, key, docs, created = new Date()) {
  const src = sourceDef(key) ?? { label: key };
  const bundle = {
    format: BUNDLE_FORMAT, kind, source: key, label: src.label, created: created.toISOString(), rebuiltFromCompendium: true,
    sources: [{ source: src.label, count: docs.length }],
    docs: docs.map(d => ({ folder: d.folder ?? null, data: d.data })).sort((a, b) => String(a.data.name).localeCompare(String(b.data.name))),
    report: { duplicates: [], conversionErrors: [], images: { kept: 0, web: 0, copied: 0, fallback: [] } }
  };
  for (const d of bundle.docs) {
    const img = String(d.data.img ?? "");
    if (/^https?:\/\//.test(img)) bundle.report.images.web++;
    else if (img.startsWith(LOCAL_IMAGE_DIR)) bundle.report.images.copied++;
    else bundle.report.images.kept++;
  }
  return bundle;
}

/**
 * Entries of ap-turm-libraries.zip: bundles and images under the Data-relative paths they get again on import.
 * @param {{kind, key, text:string}[]} bundles
 * @param {{path:string, bytes:Uint8Array}[]} images
 */
export function libraryZipFiles(bundles, images = []) {
  return [
    ...bundles.map(b => ({ name: `ap-turm-import/${bundleFile(b.kind, b.key)}`, text: b.text })),
    ...images.map(i => ({ name: i.path, bytes: i.bytes, compress: false }))
  ];
}

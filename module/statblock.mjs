/**
 * 5e statblock text parser (book / PDF copy, web copy, markdown copy, 2024 layout). Pure module, tested in Node.
 *
 * Header block (everything that is a stat line or a keyword line): name, size/type line, AC, HP, speed (all movement
 * modes), the six abilities (row, per-line or 2024 table incl. save column), saving throws, skills (bonuses -> passive
 * Perception), senses, languages, damage resistances / immunities / vulnerabilities, condition immunities, CR,
 * proficiency bonus, legendary resistance / legendary action counts.
 * Every other paragraph becomes a structured entry {name, section, text, toHit, saveDc, saveAbility, damage, dmgType,
 * range, recharge, uses, legendaryCost, parent} in its section (traits = everything before "Actions", actions, bonus,
 * reactions, legendary, lair). A paragraph that does not start with "Name." continues the previous entry; the first
 * paragraph of a section without a name is its intro ("can take 3 legendary actions" -> counter). Options of an entry
 * that "uses one of the following ..." (Breath Weapons -> Cold Breath, Paralyzing Breath) are children sharing its
 * recharge. Damage types are never translated: the D&D word stays as typed (turm mode marks it "not assigned").
 * Whatever a regex does not recognize simply stays in the entry text; nothing is dropped.
 */
import { DAMAGE_TYPES } from "./config.mjs";
import { parseArea } from "./area.mjs";

const ABILS = ["str", "dex", "con", "int", "wis", "cha"];
const SECTION_RE = /^(traits|actions|bonus actions|reactions|legendary actions|lair actions|villain actions|mythic actions|regional effects)\.?$/i;
const SIZE_RE = /^(tiny|small|medium|large|huge|gargantuan)\b/i;
/** "Name. text" / "Name (3/Day). text": a name is at most five words plus an optional parenthetical (no commas, no digits). */
const NAME_RE = /^(?<name>[A-Z][A-Za-z'\-]*(?:\s+[A-Za-z'\-]+){0,4}(?:\s\([^)]{1,40}\))?)\.\s+(?<text>[\s\S]*)$/;
const DTYPE_KEYS = Object.keys(DAMAGE_TYPES);
const CONDITION_WORDS = new Set(["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"]);
const QUALIFIED_RE = /\b(from|that|while|except|nonmagical|non-magical|silvered|adamantine)\b/i;
const META_RE = /^(Skills|Senses|Languages|Gear|Habitat|Treasure|Condition Immunities|Damage (?:Resistances?|Immunities?|Vulnerabilities?)|Resistances?|Immunities?|Vulnerabilities?)\b:?\s*/i;
const hasConditionWord = (t) => String(t).toLowerCase().split(/[,;]|\band\b/).some(p => CONDITION_WORDS.has(p.trim()));

/** Unicode dashes / quotes, markdown links [text](url) and bold markers reduced to plain text. */
const normalizeText = (t) => String(t ?? "")
  .replace(/\r\n?/g, "\n").replace(/[−–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "")
  .replace(/ /g, " ").replace(/[ \t]+/g, " ");

const toInt = (s) => { const n = parseInt(String(s).replace(/\s+/g, ""), 10); return Number.isFinite(n) ? n : null; };
const cleanDice = (s) => String(s).trim().replace(/\s*([+-])\s*/g, " $1 ").replace(/\s+/g, " ");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Damage word as typed (lowercased). Never translated into an element: the GM assigns elements by hand in turm mode. */
export function damageKey(word) {
  return String(word ?? "").trim().toLowerCase();
}

/** "cold, fire; bludgeoning, piercing, and slashing from nonmagical attacks" -> keys (condition words filtered out). */
export function parseDamageList(text) {
  const out = [];
  for (const clause of String(text).split(/;/)) {
    const c = clause.trim(); if (!c) continue;
    const qualified = QUALIFIED_RE.test(c);
    const parts = c.split(/,|\band\b/).map(p => p.trim().toLowerCase()).filter(p => p && !CONDITION_WORDS.has(p));
    // qualified clauses ("... from nonmagical attacks"): every known type named anywhere in the clause
    const keys = qualified ? DTYPE_KEYS.filter(k => new RegExp("(^|[^a-z])" + k + "([^a-z]|$)", "i").test(c)) : parts;
    for (const k of keys) if (k && !out.includes(k)) out.push(k);
    if (qualified && !keys.length) out.push(c);
  }
  return out;
}

/** Condition words of a mixed 2024 "Immunities Cold; Frightened, Poisoned" line -> "Frightened, Poisoned". */
export function parseConditionList(text) {
  const out = [];
  for (const p of String(text).split(/[,;]|\band\b/)) { const w = p.trim().toLowerCase(); if (CONDITION_WORDS.has(w) && !out.includes(cap(w))) out.push(cap(w)); }
  return out.join(", ");
}

/** "Arcana +8, Perception +11" -> { arcana: 8, perception: 11 } (keys lowercased, spaces removed). */
export function parseSkills(text) {
  const out = {};
  const re = /([A-Za-z][A-Za-z ]*?)\s*([+-]\s?\d+)/g;
  let m; while ((m = re.exec(String(text))) !== null) out[m[1].trim().toLowerCase().replace(/\s+/g, "")] = toInt(m[2]);
  return out;
}

const SKILL_LABELS = { acrobatics: "Acrobatics", animalhandling: "Animal Handling", arcana: "Arcana", athletics: "Athletics", deception: "Deception", history: "History",
  insight: "Insight", intimidation: "Intimidation", investigation: "Investigation", medicine: "Medicine", nature: "Nature", perception: "Perception", performance: "Performance",
  persuasion: "Persuasion", religion: "Religion", sleightofhand: "Sleight of Hand", stealth: "Stealth", survival: "Survival" };
/** { arcana: 8 } -> "Arcana +8" (inverse of parseSkills, for the header field). */
export function formatSkills(skills) {
  return Object.entries(skills ?? {}).map(([k, v]) => `${SKILL_LABELS[k] ?? cap(k)} ${v >= 0 ? "+" : ""}${v}`).join(", ");
}

/** "40 ft., Fly 80 ft. (hover), swim 40 ft." -> { speed: 40, speeds: "Fly 80 (hover), Swim 40" }. */
export function parseSpeed(text) {
  const t = String(text);
  const walk = /^(?:walk\s+)?(\d+)\s*ft/i.exec(t.trim());
  const speed = walk ? toInt(walk[1]) : null;
  const modes = [];
  const re = /\b(burrow|climb|fly|swim|hover)\s+(\d+)\s*ft\.?(?:\s*\(([^)]*)\))?/gi;
  let m; while ((m = re.exec(t)) !== null) modes.push(`${cap(m[1].toLowerCase())} ${m[2]}${m[3] ? ` (${m[3].trim()})` : ""}`);
  return { speed: speed ?? (modes.length ? 0 : toInt(t)), speeds: modes.join(", ") };
}

/**
 * Parse one attack entry (legacy helper). Returns null when the line is not an attack.
 * @returns {{name, bonus, dice, dtype, range, text}|null}
 */
export function parseAttack(entry) {
  const m = /^(?<name>[^.]{1,60}?)\.\s+(?<kind>Melee or Ranged|Melee|Ranged)\s+(?:Weapon\s+|Spell\s+)?Attack(?:\s+Roll)?:\s*(?<bonus>[+-]?\s?\d+)(?:\s+to\s+hit)?[,.]?\s*(?<rest>.*)$/is.exec(entry.trim());
  if (!m) return null;
  const rest = m.groups.rest;
  const hit = /Hit:\s*(?:\d+\s*)?\((?<dice>[^)]+)\)\s*(?<dtype>[A-Za-z]+)\s+damage/i.exec(rest);
  if (!hit) return null;
  const dice = cleanDice(hit.groups.dice);
  const dtype = damageKey(hit.groups.dtype);
  const extra = [];
  const plusRe = /plus\s+(?:\d+\s*)?\((?<d>[^)]+)\)\s*(?<t>[A-Za-z]+)\s+damage/gi;
  let p; while ((p = plusRe.exec(rest)) !== null) extra.push({ dice: cleanDice(p.groups.d), dtype: damageKey(p.groups.t) });
  const rng = /(?<a>reach\s+[^,.]+?(?:\s+ft\.?)?|range\s+[^,.]+?(?:\s+ft\.?)?)(?:,?\s+or\s+(?<b>range\s+[^,.]+?(?:\s+ft\.?)?))?[,.]/i.exec(rest);
  const range = rng ? [rng.groups.a, rng.groups.b].filter(Boolean).map(x => x.replace(/^(reach|range)\s+/i, "").replace(/\s+ft\.?$/i, " ft").trim()).join(" / ") : "";
  return { name: m.groups.name.trim(), bonus: toInt(m.groups.bonus) ?? 0, dice, dtype, range, extra, text: entry.trim(), kind: m.groups.kind };
}

/**
 * Merge lines into paragraphs: a line starts a new paragraph only when it is a section header, a keyword line or
 * "Name. ..."; everything else (PDF wraps, continuation paragraphs) is appended to the previous paragraph. The first
 * line after a section header always starts a paragraph (section intro).
 */
export function mergeEntries(lines) {
  const out = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const starts = SECTION_RE.test(line) || META_RE.test(line) || NAME_RE.test(line);
    if (prev !== undefined && !starts && !SECTION_RE.test(prev)) out[out.length - 1] = prev + " " + line;
    else out.push(line);
  }
  return out;
}

/**
 * Parse a statblock.
 * @param {string} text
 * @returns {object} { name, typeLine, ac, acNote, hp:{max, formula}, speed, speeds, speedText, abilities, saves, skills,
 *   senses, languages, conditionImmunities, defenseNote, headerNotes, pb, cr, resistances, immunities, vulnerabilities,
 *   legendary:{resist, actions}, entries:[], recognized:string[] (field names filled), unparsed:string[] }
 */
export function parseStatblock(text) {
  const res = {
    name: "", typeLine: "", ac: null, acNote: "", hp: { max: null, formula: "" }, speed: null, speeds: "", speedText: "",
    abilities: {}, saves: {}, skills: {}, senses: "", languages: "", conditionImmunities: "", defenseNote: "", headerNotes: "",
    pb: null, cr: "", dc: null, passivePerception: null, resistances: [], immunities: [], vulnerabilities: [],
    legendary: { resist: 0, actions: 0 }, entries: [], recognized: [], unparsed: []
  };
  const rawLines = normalizeText(text).split("\n").map(l => l.trim()).filter(Boolean);
  if (!rawLines.length) return res;
  const rec = (k) => { if (!res.recognized.includes(k)) res.recognized.push(k); };
  const addNote = (field, line) => { res[field] = res[field] ? res[field] + "\n" + line : line; };

  // 1. ability scores -------------------------------------------------------------------------
  const consumed = new Set();
  const abilRow = /^STR\s+DEX\s+CON\s+INT\s+WIS\s+CHA$/i;
  const six = /^(\d+)\s*\(([+-]?\d+)\)\s+(\d+)\s*\(([+-]?\d+)\)\s+(\d+)\s*\(([+-]?\d+)\)\s+(\d+)\s*\(([+-]?\d+)\)\s+(\d+)\s*\(([+-]?\d+)\)\s+(\d+)\s*\(([+-]?\d+)\)$/;
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    // book: "STR DEX CON INT WIS CHA" then "14 (+2) 12 (+1) ..."
    if (abilRow.test(l) && rawLines[i + 1] && six.test(rawLines[i + 1])) {
      const m = six.exec(rawLines[i + 1]);
      ABILS.forEach((a, j) => res.abilities[a] = toInt(m[1 + j * 2]));
      consumed.add(i); consumed.add(i + 1); rec("abilities"); break;
    }
    // web (one line): "STR 14 (+2) DEX 12 (+1) ..."
    const inline = new RegExp(ABILS.map(a => `${a}\\s*(\\d+)\\s*\\(([+-]?\\d+)\\)`).join("\\s+"), "i");
    if (inline.test(l)) { const m = inline.exec(l); ABILS.forEach((a, j) => res.abilities[a] = toInt(m[1 + j * 2])); consumed.add(i); rec("abilities"); break; }
  }
  if (!res.recognized.includes("abilities")) {
    // per line: "STR 14 (+2)" | "STR 14 +2 +2" (2024: score, mod, save) | "STR" newline "14 (+2)"
    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i];
      let m = /^(STR|DEX|CON|INT|WIS|CHA)\s+(\d+)\s*(?:\(([+-]?\d+)\))?\s*(?:([+-]\s?\d+)\s+([+-]\s?\d+))?\s*$/i.exec(l);
      if (m) {
        const a = m[1].toLowerCase(); res.abilities[a] = toInt(m[2]); consumed.add(i);
        if (m[5] !== undefined) { res.saves[a] = toInt(m[5]); rec("saves"); }
        continue;
      }
      m = /^(STR|DEX|CON|INT|WIS|CHA)$/i.exec(l);
      if (m && rawLines[i + 1] && /^(\d+)\s*(?:\(([+-]?\d+)\))?\s*$/.test(rawLines[i + 1])) {
        const a = m[1].toLowerCase(); res.abilities[a] = toInt(/^(\d+)/.exec(rawLines[i + 1])[1]); consumed.add(i); consumed.add(i + 1); i++;
      }
    }
    if (Object.keys(res.abilities).length) rec("abilities");
  }

  // 2. stat / keyword lines (anywhere) -> header fields ----------------------------------------
  const defense = (kind, m, raw) => {
    const list = parseDamageList(m[1]);
    for (const k of list) if (!res[kind].includes(k)) res[kind].push(k);
    rec(kind);
    const conds = parseConditionList(m[1]);
    if (conds) { res.conditionImmunities = res.conditionImmunities ? `${res.conditionImmunities}, ${conds}` : conds; rec("conditionImmunities"); }
    if (QUALIFIED_RE.test(m[1])) { addNote("defenseNote", raw); rec("defenseNote"); }   // the qualifier stays readable
  };
  const statPatterns = [
    [/^(?:Armor Class|AC)\s+(\d+)\s*(?:\(([^)]*)\))?/i, (m) => { res.ac = toInt(m[1]); res.acNote = m[2]?.trim() ?? ""; rec("ac"); }],
    [/^(?:Hit Points|HP)\s+(\d+)\s*(?:\(([^)]*)\))?/i, (m) => { res.hp.max = toInt(m[1]); res.hp.formula = m[2]?.trim() ?? ""; rec("hp"); }],
    [/^Speed\s+(.+)$/i, (m) => { res.speedText = m[1].trim(); const s = parseSpeed(m[1]); res.speed = s.speed; res.speeds = s.speeds; rec("speed"); }],
    [/^Saving Throws?\s+(.+)$/i, (m) => { const re = /\b(Str|Dex|Con|Int|Wis|Cha)\w*\s*([+-]\s?\d+)/gi; let x; while ((x = re.exec(m[1])) !== null) res.saves[x[1].toLowerCase().slice(0, 3)] = toInt(x[2]); rec("saves"); }],
    [/^Skills:?\s+(.+)$/i, (m) => { Object.assign(res.skills, parseSkills(m[1])); rec("skills"); }],
    [/^Senses:?\s+(.+)$/i, (m) => { res.senses = m[1].trim(); rec("senses"); }],
    [/^Languages:?\s+(.+)$/i, (m) => { res.languages = m[1].trim(); rec("languages"); }],
    [/^Condition Immunities:?\s+(.+)$/i, (m) => { const c = parseConditionList(m[1]) || m[1].trim(); res.conditionImmunities = res.conditionImmunities ? `${res.conditionImmunities}, ${c}` : c; rec("conditionImmunities"); }],
    // 2014 "Damage Resistances ...", 2024 "Resistances ..." (may mix damage types and conditions)
    [/^(?:Damage )?Resistances?:?\s+(.+)$/i, (m, raw) => defense("resistances", m, raw)],
    [/^(?:Damage )?Immunities?:?\s+(.+)$/i, (m, raw) => defense("immunities", m, raw)],
    [/^(?:Damage )?Vulnerabilities?:?\s+(.+)$/i, (m, raw) => defense("vulnerabilities", m, raw)],
    [/^(?:Gear|Habitat|Treasure)\b/i, (m, raw) => { addNote("headerNotes", raw); rec("headerNotes"); }],
    [/^(?:Challenge|CR)\s+([\d/]+)(?:\s*\(([^)]*)\))?/i, (m) => { res.cr = m[1]; rec("cr"); const pb = /PB\s*\+?(\d+)/i.exec(m[2] ?? ""); if (pb) { res.pb = toInt(pb[1]); rec("pb"); } }],
    [/^Proficiency Bonus\s*\+?(\d+)/i, (m) => { res.pb = toInt(m[1]); rec("pb"); }],
    [/^Initiative\s+[+-]?\d+/i, () => {}],
    [/^Legendary Action Uses:?\s*(\d+)/i, (m) => { res.legendary.actions = toInt(m[1]); rec("legendary"); }]
  ];
  for (let i = 0; i < rawLines.length; i++) {
    if (consumed.has(i)) continue;
    for (const [re, fn] of statPatterns) {
      const m = re.exec(rawLines[i]);
      if (m) { fn(m, rawLines[i]); consumed.add(i); break; }
    }
  }

  // 3. name / type line -----------------------------------------------------------------------
  let start = 0;
  if (!consumed.has(0) && !SECTION_RE.test(rawLines[0]) && !SIZE_RE.test(rawLines[0])) { res.name = rawLines[0]; consumed.add(0); rec("name"); start = 1; }
  for (let i = start; i < Math.min(rawLines.length, start + 2); i++) {
    if (!consumed.has(i) && SIZE_RE.test(rawLines[i])) { res.typeLine = rawLines[i]; consumed.add(i); rec("typeLine"); break; }
  }

  // 4. remaining lines -> sections -> structured entries -------------------------------------
  const rest = rawLines.filter((l, i) => !consumed.has(i));
  const merged = mergeEntries(rest);
  let section = "traits", intro = true;
  for (const e of merged) {
    if (SECTION_RE.test(e)) { section = sectionKey(e); intro = true; continue; }
    const named = NAME_RE.test(e);
    // "Legendary Resistance (3/Day). ..." is the counter in the legendary box, not a text entry
    const lr = /^Legendary Resistance\s*\((\d+)\/Day/i.exec(e);
    if (lr) { res.legendary.resist = toInt(lr[1]); rec("legendary"); intro = false; continue; }
    // section intro "The dragon can take 3 legendary actions, ..." sets the counter and is no entry
    const la = !named && /can take (\d+) legendary actions/i.exec(e);
    if (la) { res.legendary.actions = toInt(la[1]); rec("legendary"); intro = false; continue; }
    const entry = parseEntry(e, section);
    if (!entry.name) {
      if (intro) { entry.name = SECTIONS[section]; entry.legendaryCost = 0; }   // other nameless intro: named after its section
      else { const prev = res.entries[res.entries.length - 1]; if (prev) { prev.text = `${prev.text} ${entry.text}`.trim(); continue; } }
    }
    intro = false;
    res.entries.push(entry);
    if (entry.toHit !== null || entry.saveDc !== null || entry.damage) rec("entries");
  }
  res.entries = dedupeEntries(res.entries);
  linkChildren(res.entries);
  res.unparsed = res.entries.filter(e => !e.name).map(e => e.text);
  // no printed proficiency bonus: derive it from the challenge rating
  if (res.pb === null && res.cr) { const pb = pbFromCr(res.cr); if (pb !== null) { res.pb = pb; rec("pb"); } }
  // save DC of the NPC: a "spell save DC N" in the text, but only when every mention names the same DC
  const dcs = [...new Set([...normalizeText(text).matchAll(/spell save DC\s*(\d+)/gi)].map(m => toInt(m[1])))];
  if (dcs.length === 1) { res.dc = dcs[0]; rec("dc"); }
  // "passive Perception 14" (usually in the Senses line) is taken over directly
  const pp = /\bpassive\s+Perception\s*:?\s*(\d+)/i.exec(normalizeText(text));
  if (pp) { res.passivePerception = toInt(pp[1]); rec("passive"); }
  return res;
}

/**
 * Drop entries that repeat one already parsed in the same section with the same name and text. That is
 * what a statblock pasted twice into the box produces; a real statblock never lists the same action twice.
 */
function dedupeEntries(entries) {
  const seen = new Set();
  return entries.filter(e => {
    const key = `${e.section} ${e.name} ${e.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Options of an entry that "uses one of the following ..." become its children: following entries of the same
 * section whose name contains the singular of the parent's last word (Breath Weapons -> Cold Breath, Paralyzing Breath).
 */
export function linkChildren(entries) {
  for (let i = 0; i < entries.length; i++) {
    const p = entries[i];
    if (!p.name || p.parent || !/one of the following/i.test(p.text)) continue;
    const keys = p.name.split(/\s+/).map(w => w.toLowerCase().replace(/s$/, "")).filter(w => w.length >= 4);
    if (!keys.length) continue;
    for (let j = i + 1; j < entries.length; j++) {
      const c = entries[j];
      const n = c.name.toLowerCase();
      if (c.section !== p.section || !keys.some(k => n.includes(k))) break;
      c.parent = p.name;
    }
  }
  return entries;
}

/* ---------- entries ---------- */

export const SECTIONS = { traits: "Traits", actions: "Actions", bonus: "Bonus Actions", reactions: "Reactions", legendary: "Legendary Actions", lair: "Lair Actions" };
const SECTION_KEYS = { traits: "traits", actions: "actions", "bonus actions": "bonus", reactions: "reactions", "legendary actions": "legendary",
  "lair actions": "lair", "villain actions": "actions", "mythic actions": "legendary", "regional effects": "lair" };
function sectionKey(header) { return SECTION_KEYS[header.replace(/\.$/, "").trim().toLowerCase()] ?? "actions"; }

const ABILITY_NAMES = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };

/** Empty entry with every field the NPC data model knows. */
export function emptyEntry(section = "actions") {
  return { name: "", section, text: "", toHit: null, range: "", saveDc: null, saveAbility: "", damage: "", dmgType: "",
    areaShape: "", areaSize: 0,
    recharge: "", rechargeUsed: false, uses: { value: 0, max: 0, per: "" }, legendaryCost: 0, parent: "" };
}

/**
 * One statblock paragraph ("Name (Recharge 5-6). text ...") into a structured object. Values are pulled from the
 * text by regex; whatever is not recognized simply stays in the text. Never returns null.
 * @param {string} raw
 * @param {string} section  traits | actions | bonus | reactions | legendary | lair
 */
export function parseEntry(raw, section = "actions") {
  const e = emptyEntry(section);
  const line = normalizeText(raw).trim();
  // keyword lines (Skills, Senses, Languages, Condition Immunities ...) handed in directly: keyword = name, rest = text
  const meta = META_RE.exec(line);
  const split = meta ? null : NAME_RE.exec(line);
  let name = meta ? meta[1] : split ? split.groups.name.trim() : "";
  e.text = meta ? line.slice(meta[0].length).trim() : split ? split.groups.text.trim() : line;
  // parentheticals in the name: (Recharge 5-6) | (2/Day) | (Costs 2 Actions) | (1/Day, ...) -- recognized ones are removed
  const paren = /\s*\(([^)]*)\)\s*$/.exec(name);
  if (paren) {
    const inner = paren[1];
    const rc = /Recharge\s*(\d)(?:\s*-\s*(\d))?/i.exec(inner);
    const us = /(\d+)\s*\/\s*(Day|Long Rest|Short Rest|Short or Long Rest|Rest)/i.exec(inner);
    const lc = /Costs\s+(\d+)\s+Actions?/i.exec(inner);
    const rl = /Recharges? after a (Short|Long|Short or Long) Rest/i.exec(inner);
    if (rc) e.recharge = rc[2] ? `${rc[1]}-${rc[2]}` : rc[1];
    if (us) e.uses = { value: toInt(us[1]), max: toInt(us[1]), per: us[2].toLowerCase().replace(/\s+/g, " ") };
    if (lc) e.legendaryCost = toInt(lc[1]);
    if (rl) e.recharge = "rest";
    if (rc || us || lc || rl) name = name.slice(0, paren.index).trim();
  }
  e.name = name;
  const t = e.text;
  // to hit (2014 "+4 to hit", 2024 "Attack Roll: +4")
  let m = /([+-]\s?\d+)\s+to\s+hit/i.exec(t) ?? /Attack Roll:\s*([+-]\s?\d+)/i.exec(t);
  if (m) e.toHit = toInt(m[1]);
  // reach / range
  const rng = /(?<a>reach\s+[^,.]+?(?:\s+ft\.?)?|range\s+[^,.]+?(?:\s+ft\.?)?)(?:,?\s+or\s+(?<b>range\s+[^,.]+?(?:\s+ft\.?)?))?[,.]/i.exec(t);
  if (rng) e.range = [rng.groups.a, rng.groups.b].filter(Boolean).map(x => x.replace(/^(reach|range)\s+/i, "").replace(/\s+ft\.?$/i, " ft").trim()).join(" / ");
  // saving throw (2014 "DC 15 Dexterity saving throw", 2024 "Dexterity Saving Throw: DC 15")
  m = /DC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i.exec(t);
  if (m) { e.saveDc = toInt(m[1]); e.saveAbility = ABILITY_NAMES[m[2].toLowerCase()]; }
  else { m = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+Saving Throw:\s*DC\s*(\d+)/i.exec(t); if (m) { e.saveDc = toInt(m[2]); e.saveAbility = ABILITY_NAMES[m[1].toLowerCase()]; } }
  // damage: first "(dice) type damage"; "plus (dice) type damage" is appended; "or (dice)" alternatives are left in the text
  const dmgRe = /(plus\s+)?(?:\d+\s*)?\(([^()]*\d*d\d+[^()]*)\)\s*([A-Za-z]+)\s+damage/gi;
  let d; const extras = [];
  while ((d = dmgRe.exec(t)) !== null) {
    if (!e.damage) { e.damage = cleanDice(d[2]); e.dmgType = damageKey(d[3]); }
    else if (d[1]) extras.push(cleanDice(d[2]));
  }
  if (extras.length) e.damage = [e.damage, ...extras].join(" + ");
  // recharge / uses mentioned in the text instead of the name
  if (!e.recharge) { const rc = /Recharge\s*(\d)(?:\s*-\s*(\d))?/i.exec(t); if (rc) e.recharge = rc[2] ? `${rc[1]}-${rc[2]}` : rc[1]; }
  if (!e.uses.max) { const us = /\b(\d+)\/(Day|Long Rest|Short Rest)\b/i.exec(t); if (us) e.uses = { value: toInt(us[1]), max: toInt(us[1]), per: us[2].toLowerCase() }; }
  // area of effect ("60-foot cone", "20-foot-radius sphere", "90-foot-long, 5-foot-wide line", "15-foot cube")
  const ar = parseArea(t);
  if (ar) { e.areaShape = ar.shape; e.areaSize = ar.size; }
  if (section === "legendary" && !e.legendaryCost && name && !/^Legendary Actions?$/i.test(name)) e.legendaryCost = 1;
  return e;
}

/**
 * Convert a parse result into an actor update ({name, system}) for the NPC data model.
 * Fields that were not recognized are left out so existing values survive. Damage types are written as parsed
 * in both modes; turm mode shows them as "not assigned" until the GM picks an element.
 */
/**
 * Is a parse result worth applying? Plain prose still yields a "name" (the first line), so a result with
 * nothing but that is not a statblock and must not replace the NPC's entries.
 * @param {object} parsed  Result of parseStatblock()
 * @returns {{ok:boolean, reason?:string}}
 */
export function parseUsable(parsed) {
  if (!parsed || (!parsed.recognized.length && !parsed.entries.length)) return { ok: false, reason: "The text contains no statblock (no field and no entry recognized)." };
  const fields = parsed.recognized.filter(k => k !== "name");
  if (!fields.length && !parsed.entries.length) return { ok: false, reason: "No statblock recognized: neither values (AC, HP, abilities, speed, …) nor named entries were found - only a first line that would be read as the name." };
  const dup = duplicateEntryNames(parsed.entries);
  if (dup.length) return { ok: false, reason: `The text apparently contains the same statblock more than once (duplicates: ${dup.slice(0, 4).join(", ")}${dup.length > 4 ? ` and ${dup.length - 4} more` : ""}). Paste it only once.` };
  return { ok: true };
}

/** Entry names that occur more than once inside the same section - the signature of a doubled paste. */
export function duplicateEntryNames(entries = []) {
  const seen = new Set(), dup = [];
  for (const e of entries) {
    if (!e?.name) continue;
    const key = `${e.section} ${e.name.toLowerCase()}`;
    if (seen.has(key)) { if (!dup.includes(e.name)) dup.push(e.name); }
    else seen.add(key);
  }
  return dup;
}

/**
 * Proficiency bonus for a challenge rating (5e table): 0-4 +2, 5-8 +3, 9-12 +4, 13-16 +5, 17-20 +6, 21-24 +7,
 * 25-28 +8, 29-30 +9. Fractions ("1/2") count as 0. null for something that is no CR.
 */
export function pbFromCr(cr) {
  const s = String(cr ?? "").trim();
  const m = /^(\d+)(?:\s*\/\s*(\d+))?$/.exec(s);
  if (!m) return null;
  const value = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
  if (!Number.isFinite(value) || value < 0 || value > 30) return null;
  return value < 5 ? 2 : Math.min(9, 2 + Math.ceil((Math.floor(value) - 4) / 4));
}

export function statblockToUpdate(parsed) {
  const sys = {};
  const has = (k) => parsed.recognized.includes(k);
  if (has("ac")) sys.ac = parsed.ac;
  if (has("hp")) sys.hp = { value: parsed.hp.max, max: parsed.hp.max };
  if (has("speed") && parsed.speed !== null) { sys.speed = parsed.speed; sys.speeds = parsed.speeds; }
  if (has("abilities")) sys.abilities = { ...parsed.abilities };
  if (has("saves")) sys.saves = Object.fromEntries(ABILS.map(a => [a, parsed.saves[a] ?? null]));
  if (has("skills")) sys.skills = { ...parsed.skills };
  if (has("senses")) sys.senses = parsed.senses;
  if (has("passive")) sys.passivePerc = parsed.passivePerception;
  if (has("languages")) sys.languages = parsed.languages;
  if (has("conditionImmunities")) sys.conditionImmunities = parsed.conditionImmunities;
  if (has("defenseNote")) sys.defenseNote = parsed.defenseNote;
  if (has("headerNotes")) sys.headerNotes = parsed.headerNotes;
  if (has("resistances")) sys.resistances = parsed.resistances;
  if (has("immunities")) sys.immunities = parsed.immunities;
  if (has("vulnerabilities")) sys.vulnerabilities = parsed.vulnerabilities;
  if (has("cr")) sys.cr = parsed.cr;
  if (has("pb")) sys.pb = parsed.pb;
  if (has("dc")) sys.dc = parsed.dc;
  if (has("typeLine")) sys.typeLine = parsed.typeLine;
  if (has("legendary")) sys.legendary = {
    resist: { value: parsed.legendary.resist, max: parsed.legendary.resist },
    actions: { value: parsed.legendary.actions, max: parsed.legendary.actions }
  };
  sys.entries = parsed.entries.map(e => ({ ...e, uses: { ...e.uses } }));
  const update = { system: sys };
  if (has("name") && parsed.name) update.name = parsed.name;
  return update;
}

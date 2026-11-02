/**
 * Roll formulas and damage application (pure, no Foundry dependency; tested in Node).
 *
 * Attack:  d20 (2d20kh1 / 2d20kl1) + weaponStats().atk (+ situational)
 *          weaponStats().atk = ability mod + PB (if proficient) + weapon bonus + exhaustion (-2 x level)
 * Crit:    natural d20 >= critRange; critRange = 19 with a critBoost purchase, else 20
 * Damage:  weapon dice (may carry a flat part, "2d8+4") + ability mod + weapon bonus
 *          + Dueling (+2 when the fighting style "dueling" is chosen and enabled in the dialog)
 *          + eleDmg: 1d6 per rank, weapon's damage type, shown separately
 *          + free-text extra dice (no rule attached)
 *          Crit: every die is rolled twice; with critMax the extra dice are maximized instead.
 * Apply:   temp HP first, then HP; resistance halves (rounded down), immunity zeroes.
 */
import { weaponStats, eleElement, hitDie, itemEffects } from "./rules.mjs";
import { damageTypeLabel as configDamageTypeLabel, ELEMENTS, isUnassignedKey, UNASSIGNED_PREFIX } from "./config.mjs";

/* ---------- dice strings ---------- */

/**
 * Parse a simple dice expression ("2d8+4", "1d6 + 2 - 1", "d10") into dice and a flat modifier.
 * Unknown tokens are ignored (the weapon dice field is free text).
 * @returns {{dice: {n:number, faces:number}[], flat:number, ok:boolean}}
 */
export function parseDice(str) {
  const dice = []; let flat = 0; let ok = true;
  const s = String(str ?? "").replace(/\s+/g, "").toLowerCase();
  if (!s) return { dice, flat, ok: false };
  const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/g;
  let m; let consumed = 0;
  while ((m = re.exec(s)) !== null) {
    consumed += m[0].length;
    if (m[3] !== undefined) {
      const n = (m[2] === "" ? 1 : parseInt(m[2])) * (m[1] === "-" ? -1 : 1);
      dice.push({ n, faces: parseInt(m[3]) });
    } else {
      flat += parseInt(m[5]) * (m[4] === "-" ? -1 : 1);
    }
  }
  if (consumed !== s.length) ok = false;
  return { dice, flat, ok };
}

/** Formula text for a dice list: "2d8 + 1d6". Negative counts are rendered as "- 1d4". */
export function diceFormula(dice) {
  return dice.filter(d => d.n).map((d, i) => {
    const sign = d.n < 0 ? "-" : (i === 0 ? "" : "+");
    return `${sign ? sign + " " : ""}${Math.abs(d.n)}d${d.faces}`;
  }).join(" ").replace(/^\+ /, "");
}

/** Maximum result of a dice list (used for critMax). */
export function diceMax(dice) { return dice.reduce((a, d) => a + d.n * d.faces, 0); }

/* ---------- attack ---------- */

export const ADV_FORMULA = { advantage: "2d20kh1", normal: "1d20", disadvantage: "2d20kl1" };
export const MODE_LABEL = { advantage: "Advantage", normal: "", disadvantage: "Disadvantage" };

/**
 * dnd5e-style modifier keys on a click: plain = normal, Shift = advantage, Ctrl/Alt (or Meta) = disadvantage,
 * right-click (button 2 / contextmenu) = open the dialog (prefilled with the key-derived mode).
 * @param {object} [ev]  {shiftKey, ctrlKey, altKey, metaKey, button, type}
 * @returns {{mode:string, dialog:boolean}}
 */
export function rollModeFromEvent(ev = {}) {
  let mode = "normal";
  if (ev?.shiftKey) mode = "advantage";
  else if (ev?.ctrlKey || ev?.altKey || ev?.metaKey) mode = "disadvantage";
  const dialog = ev?.button === 2 || ev?.type === "contextmenu";
  return { mode, dialog };
}

/**
 * Generic d20 formula: 2d20kh1 / 1d20 / 2d20kl1 + (bonus + situational).
 * @returns {{formula:string, bonus:number, mode:string}}
 */
export function d20Formula(bonus, { mode = "normal", situational = 0 } = {}) {
  const b = (Number(bonus) || 0) + (Number(situational) || 0);
  const die = ADV_FORMULA[mode] ?? ADV_FORMULA.normal;
  return { formula: `${die}${b >= 0 ? " + " : " - "}${Math.abs(b)}`, bonus: b, mode: ADV_FORMULA[mode] ? mode : "normal" };
}

/** Ability check bonus: ability modifier + exhaustion penalty (saves/skills carry it in derived() already). */
export function abilityCheckBonus(d, key) { return (d.mods?.[key] || 0) + (d.exhPen || 0); }

/**
 * Death saving throw (d20 + exhaustion): >= 10 success, natural 20 = back to 1 HP (counters reset),
 * natural 1 = two failures. Counters are capped at 3.
 * @returns {{result:"revive"|"success"|"fail"|"fail2", succ:number, fail:number, hp?:number}}
 */
export function deathSaveOutcome({ d20, total, succ = 0, fail = 0 }) {
  if (d20 === 20) return { result: "revive", succ: 0, fail: 0, hp: 1 };
  if (d20 === 1) return { result: "fail2", succ, fail: Math.min(3, fail + 2) };
  if (total >= 10) return { result: "success", succ: Math.min(3, succ + 1), fail };
  return { result: "fail", succ, fail: Math.min(3, fail + 1) };
}

/** Spending a hit die: the current hit die's dice (d6+d8 etc.) + CON modifier; healing never below 0. */
export function hitDieHealFormula(S, d) {
  const dice = hitDie(S).dice.map(x => `1d${x}`).join(" + ");
  const con = d.mods?.con || 0;
  return con ? `${dice}${con > 0 ? " + " : " - "}${Math.abs(con)}` : dice;
}

/** HP after a quick adjustment: negative = damage (temp HP first), positive = healing capped at max. */
export function adjustHp({ hp, temp, max }, delta) {
  const n = Math.floor(Number(delta) || 0);
  if (n < 0) { const r = applyDamage({ hp, temp }, -n); return { hp: r.hp, temp: r.temp, taken: r.taken, healed: 0 }; }
  const h = Math.max(0, Number(hp) || 0), m = Math.max(0, Number(max) || 0);
  const nh = m ? Math.min(m, h + n) : h + n;
  return { hp: nh, temp: Math.max(0, Number(temp) || 0), taken: 0, healed: nh - h };
}

/** 19 with critBoost, else 20 */
export function critRange(S) { return (S.bought.critBoost || 0) > 0 ? 19 : 20; }

export function isCrit(d20, range) { return d20 >= range; }

/**
 * Attack formula and parts for a weapon.
 * @param {object} w        Weapon system data
 * @param {object} d        derived()
 * @param {object} [opts]   {mode: "advantage"|"normal"|"disadvantage", situational: number}
 */
export function buildAttack(w, d, { mode = "normal", situational = 0 } = {}) {
  const st = weaponStats(w, d);
  const parts = [{ label: "d20", formula: ADV_FORMULA[mode] ?? ADV_FORMULA.normal }];
  const am = d.mods[st.abK] || 0;
  parts.push({ label: st.abK.toUpperCase(), value: am });
  if (w.prof) parts.push({ label: "Prof", value: d.pb });
  if (Number(w.bonus)) parts.push({ label: "Weapon", value: Number(w.bonus) });
  if (d.fb?.atk) parts.push({ label: "Items", value: d.fb.atk });
  if (d.exhPen) parts.push({ label: "Exhaustion", value: d.exhPen });
  if (Number(situational)) parts.push({ label: "Situational", value: Number(situational) });
  const bonus = st.atk + (Number(situational) || 0);
  const formula = `${parts[0].formula}${bonus >= 0 ? " + " : " - "}${Math.abs(bonus)}`;
  return { formula, parts, bonus, abK: st.abK, mode };
}

/**
 * Outcome of an attack against an AC (null = no target).
 * A natural 1 is reported as a miss ("fumble"), a crit always hits.
 * @returns {"crit"|"hit"|"miss"|"fumble"|null}
 */
/**
 * Success of a d20 total against a DC: reaching the DC is a success, one below it is a failure.
 * The one place the system compares against a DC (saves, ability and skill checks, requested rolls);
 * an attack compares against an AC the same way, in attackOutcome.
 * @param {number} total
 * @param {number|null} dc   null = no DC was set, so there is no verdict
 * @returns {boolean|null}
 */
export function checkSuccess(total, dc) {
  if (dc === null || dc === undefined) return null;
  return Number(total) >= Number(dc);
}

export function attackOutcome({ d20, total, ac, critRange: range = 20 }) {
  if (isCrit(d20, range)) return "crit";
  if (d20 === 1) return "fumble";
  if (ac === null || ac === undefined) return null;
  return total >= ac ? "hit" : "miss";
}

/* ---------- damage ---------- */

/**
 * Damage components for a weapon.
 * @param {object} w      Weapon system data
 * @param {object} d      derived()
 * @param {object} S      app state (bought/choices)
 * @param {object} [opts] {crit, critMax, extra (dice text), dueling (boolean, default = style chosen)}
 * @returns {{parts: object[], crit: boolean, critMax: boolean, dtype: string, warnings: string[]}}
 *   part: {label, dice:[{n,faces}], flat:number, type, formula, critFormula?, critFlat?}
 */
export function buildDamage(w, d, S, { crit = false, critMax = null, extra = "", dueling = null } = {}) {
  const st = weaponStats(w, d);
  const warnings = [];
  const useCritMax = critMax ?? ((S.bought.critMax || 0) > 0);
  const hasDueling = (S.bought.fightStyle || 0) > 0 && (S.choices.fightStyle || []).includes("dueling");
  const useDueling = dueling ?? hasDueling;
  const dtype = w.dtype || "";
  const parts = [];

  const base = parseDice(w.dice);
  if (!base.ok && !base.dice.length && !base.flat) warnings.push(`Weapon dice "${w.dice}" could not be read.`);
  parts.push({ label: "Weapon", dice: base.dice, flat: base.flat + st.dmgMod, type: dtype,
    detail: `${w.dice}${st.dmgMod ? (st.dmgMod > 0 ? " + " : " - ") + Math.abs(st.dmgMod) : ""}` });
  if (useDueling && hasDueling) parts.push({ label: "Dueling", dice: [], flat: 2, type: dtype });
  // optional second damage line of the weapon (e.g. 1d8 slashing + 1d6 fire): own type, own resistance check
  if (String(w.dice2 ?? "").trim()) {
    const second = parseDice(w.dice2);
    if (!second.ok && !second.dice.length && !second.flat) warnings.push(`Second damage "${w.dice2}" could not be read.`);
    parts.push({ label: "Weapon 2", dice: second.dice, flat: second.flat, type: w.type2 || dtype, detail: String(w.dice2) });
  }
  // +1d6 per eleDmg rank in the chosen element (choices.eleDmg / changeEle), not the weapon's type
  const ele = S.bought.eleDmg || 0;
  if (ele > 0) {
    const el = eleElement(S);
    if (!el) warnings.push("Elemental +1d6 has no element yet: choose one (eleDmg purchase / Element Swap).");
    parts.push({ label: "Elemental", dice: [{ n: ele, faces: 6 }], flat: 0, type: el });
  }
  // custom shop entries with "+Nd6 in the chosen element": one part each, stacking with eleDmg
  for (const c of d.custom?.dice ?? []) {
    if (!(c.n > 0)) continue;
    if (!c.element) warnings.push(`${c.label}: +${c.n}d6 has no element chosen yet.`);
    parts.push({ label: c.label, dice: [{ n: c.n, faces: 6 }], flat: 0, type: c.element });
  }
  if (String(extra ?? "").trim()) {
    const ex = parseDice(extra);
    if (!ex.ok) warnings.push(`Extra dice "${extra}" partly unreadable; using ${diceFormula(ex.dice) || "0"}${ex.flat ? " + " + ex.flat : ""}.`);
    parts.push({ label: "Extra", dice: ex.dice, flat: ex.flat, type: dtype });
  }

  for (const p of parts) {
    p.formula = [diceFormula(p.dice), p.flat ? String(p.flat) : ""].filter(Boolean).join(" + ") || "0";
    if (crit && p.dice.length) {
      if (useCritMax) { p.critFlat = diceMax(p.dice); p.critFormula = null; }
      else { p.critFormula = diceFormula(p.dice); p.critFlat = 0; }
    } else { p.critFormula = null; p.critFlat = 0; }
  }
  return { parts, crit, critMax: useCritMax, dtype, dueling: useDueling && hasDueling, warnings };
}

/* ---------- NPC entries (system.entries[]) ---------- */

/** Attack-like view of a statblock entry (null when it has neither to-hit nor damage). */
export function entryAttackData(e) {
  if (!e) return null;
  if (e.toHit === null && !e.damage) return null;
  return { name: e.name || "Attack", bonus: Number(e.toHit) || 0, dice: e.damage || "", dtype: e.dmgType || "", range: e.range || "" };
}

/** Labels of the manual combat modifiers (system.adv) that grant advantage for this roll type ("attack" | "save"). */
export function manualAdvantages(adv, type) {
  const out = [];
  if (type === "attack" && adv?.attacks) out.push("combat modifier: attacks");
  if (type === "save" && adv?.spellSaves) out.push("combat modifier: spell saves");
  return out;
}

/* ---------- NPC attacks (system.attacks[] entries, no weapon items) ---------- */

/**
 * Attack formula for an NPC attack entry: d20 + printed bonus + exhaustion + situational.
 * @param {object} atk        {name, bonus, dice, dtype, range}
 * @param {object} [opts]     {mode, situational, exhPen}
 */
export function buildNpcAttack(atk, { mode = "normal", situational = 0, exhPen = 0 } = {}) {
  const parts = [{ label: "d20", formula: ADV_FORMULA[mode] ?? ADV_FORMULA.normal }];
  const b = Number(atk?.bonus) || 0;
  parts.push({ label: "Bonus", value: b });
  if (Number(exhPen)) parts.push({ label: "Exhaustion", value: Number(exhPen) });
  if (Number(situational)) parts.push({ label: "Situational", value: Number(situational) });
  const bonus = b + (Number(exhPen) || 0) + (Number(situational) || 0);
  const formula = `${parts[0].formula}${bonus >= 0 ? " + " : " - "}${Math.abs(bonus)}`;
  return { formula, parts, bonus, mode: ADV_FORMULA[mode] ? mode : "normal" };
}

/**
 * Damage parts for an NPC attack entry: the printed dice ("2d6 + 4", may hold several dice groups) in the
 * entry's damage type, plus free-text extra dice. A crit rolls every die twice (no crit-max for NPCs).
 */
export function buildNpcDamage(atk, { crit = false, extra = "" } = {}) {
  const warnings = [];
  const dtype = atk?.dtype || "";
  const base = parseDice(atk?.dice);
  if (!base.ok && !base.dice.length && !base.flat) warnings.push(`Damage "${atk?.dice}" could not be read.`);
  const parts = [{ label: atk?.name || "Damage", dice: base.dice, flat: base.flat, type: dtype }];
  if (String(extra ?? "").trim()) {
    const ex = parseDice(extra);
    if (!ex.ok) warnings.push(`Extra dice "${extra}" partly unreadable; using ${diceFormula(ex.dice) || "0"}${ex.flat ? " + " + ex.flat : ""}.`);
    parts.push({ label: "Extra", dice: ex.dice, flat: ex.flat, type: dtype });
  }
  for (const p of parts) {
    p.formula = [diceFormula(p.dice), p.flat ? String(p.flat) : ""].filter(Boolean).join(" + ") || "0";
    if (crit && p.dice.length) { p.critFormula = diceFormula(p.dice); p.critFlat = 0; }
    else { p.critFormula = null; p.critFlat = 0; }
  }
  return { parts, crit, critMax: false, dtype, warnings };
}

/** Damage per type once the parts are rolled: [{type, amount}] in the order of first appearance. */
export function damageGroups(parts) {
  const out = [];
  for (const p of parts ?? []) {
    const amount = (p.rolled ?? 0) + (p.critRolled ?? 0) + (p.critFlat ?? 0);
    const type = p.type ?? "";
    const g = out.find(x => x.type === type);
    if (g) g.amount += amount; else out.push({ type, amount });
  }
  return out;
}

/**
 * Damage per type against the target's defenses: every type is halved / doubled / zeroed on its own (rounded down
 * per type), then summed. Returns {taken, lines:[{type, amount, mult, taken}]}.
 */
export function typedDamage(groups, defenses = {}, { mode = "ap" } = {}) {
  const lines = (groups ?? []).map(g => {
    const amount = Math.max(0, Math.floor(Number(g.amount) || 0));
    const mult = damageMultiplier(g.type, defenses, { mode });
    return { type: g.type ?? "", amount, mult, taken: Math.floor(amount * mult) };
  });
  return { taken: lines.reduce((a, l) => a + l.taken, 0), lines };
}

/** Sum of parts once their dice results are known: parts[i].rolled (normal) and parts[i].critRolled. */
export function damageTotal(parts) {
  return parts.reduce((a, p) => a + (p.rolled ?? 0) + (p.critRolled ?? 0) + (p.critFlat ?? 0), 0);
}

/** Human label of a damage type / element key (both tables, so values from either mode stay readable). */
export function damageTypeLabel(key) { return configDamageTypeLabel(key); }

/* ---------- apply ---------- */

const norm = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Does a resistance/immunity list cover a damage type? Matches the key or the label
 * (custom entries from the shop's "Custom / other" are free text).
 */
export function listCovers(list, dtype) {
  const key = norm(dtype); if (!key) return false;
  const label = norm(damageTypeLabel(dtype));
  return (list || []).some(x => { const v = norm(x); return v === key || (label && v === label); });
}

/**
 * Turm mode: an imported D&D damage type (or any non-element key) that no element has been assigned to yet.
 * Such a type is shown with a warning and neither resists nor is resisted until the GM assigns an element.
 */
export function isUnassignedType(key, mode) {
  return isUnassignedKey(key);
}

/**
 * Mode "turm": mark imported damage types as "not assigned" ("?fire"). Every key that is no element and not marked yet
 * gets the prefix: resistances, immunities, vulnerabilities and the entries' dmgType of an NPC system object.
 * Mode "ap" keeps D&D types 1:1. Mutates and returns `sys`.
 */
export function markUnassignedTypes(sys, mode) {
  if (mode !== "turm" || !sys) return sys;
  const mark = (k) => { const s = String(k ?? "").trim(); return !s || isUnassignedKey(s) || (s.toLowerCase() in ELEMENTS) ? s : UNASSIGNED_PREFIX + s; };
  for (const kind of ["resistances", "immunities", "vulnerabilities"]) if (Array.isArray(sys[kind])) sys[kind] = sys[kind].map(mark);
  if (Array.isArray(sys.entries)) for (const e of sys.entries) if (e && typeof e === "object" && e.dmgType) e.dmgType = mark(e.dmgType);
  return sys;
}

/**
 * Multiplier for a damage type given resistances/immunities: 0 (immune), 0.5 (resistant), 2 (vulnerable) or 1.
 * In turm mode unassigned types (damage or defense entries) are ignored.
 * @param {string} dtype
 * @param {{resistances?: string[], immunities?: string[], vulnerabilities?: string[]}} defenses
 * @param {{mode?: string}} [opts]  mode of the target ("ap" | "turm")
 */
export function damageMultiplier(dtype, { resistances = [], immunities = [], vulnerabilities = [] } = {}, { mode = "ap" } = {}) {
  if (isUnassignedType(dtype, mode)) return 1;
  const assigned = (list) => (list || []).filter(k => !isUnassignedType(k, mode));
  resistances = assigned(resistances); immunities = assigned(immunities); vulnerabilities = assigned(vulnerabilities);
  if (listCovers(immunities, dtype)) return 0;
  const res = listCovers(resistances, dtype), vul = listCovers(vulnerabilities, dtype);
  if (res && vul) return 1;
  if (vul) return 2;
  if (res) return 0.5;
  return 1;
}

export const DEFENSE_ABBR = { resistances: "RES", immunities: "IMM", vulnerabilities: "VUL" };

/**
 * Defense chips of a target plus the verdict for one damage type: why the damage is halved, doubled or zeroed.
 * @param {string} dtype
 * @param {{resistances?: string[], immunities?: string[], vulnerabilities?: string[]}} defenses
 * @param {{mode?: string}} [opts]
 * @returns {{mult: number, label: string, reason: string, chips: {kind, abbr, key, label, hit, unassigned}[]}}
 */
export function defenseVerdict(dtype, defenses = {}, { mode = "ap" } = {}) {
  const chips = [];
  for (const kind of ["resistances", "immunities", "vulnerabilities"]) {
    for (const key of defenses[kind] ?? []) {
      const unassigned = isUnassignedType(key, mode);
      chips.push({ kind, abbr: DEFENSE_ABBR[kind], key, label: damageTypeLabel(key), unassigned, hit: !unassigned && !isUnassignedType(dtype, mode) && listCovers([key], dtype) });
    }
  }
  const mult = damageMultiplier(dtype, defenses, { mode });
  const hits = chips.filter(c => c.hit).map(c => `${c.abbr} ${c.label}`);
  const label = mult === 0 ? "× 0" : mult === 0.5 ? "× ½" : mult === 2 ? "× 2" : "× 1";
  const reason = isUnassignedType(dtype, mode) ? "type not assigned" : hits.join(", ");
  return { mult, label, reason, chips };
}

/** Defenses of a character: the "res" purchases plus resistances / immunities / vulnerabilities of active items. */
export function characterDefenses(S) {
  const fx = itemEffects(S.items);
  return {
    resistances: [...(S.choices.res || []), ...fx.res.map(r => r.key)],
    immunities: fx.imm.map(r => r.key),
    vulnerabilities: fx.vuln.map(r => r.key)
  };
}

/**
 * Advantage / disadvantage that active items give a roll, as the preselection of the roll (the player can still
 * change it): type "skill" | "save" (with key), "attack", "init", "death". Both at once cancel out.
 * @returns {{mode:string, adv:string[], dis:string[], label:string}}  label: "Advantage: Cloak of Elvenkind"
 */
export function itemRollPreset(d, type, key = null) {
  const fx = d?.itemFx;
  if (!fx) return { mode: "normal", adv: [], dis: [], label: "" };
  const pick = (kind) => type === "skill" ? (fx[kind].skills[key] ?? []) : type === "save" ? (fx[kind].saves[key] ?? []) : (fx[kind][type] ?? []);
  const adv = [...pick("adv")], dis = [...pick("dis")];
  const mode = adv.length && dis.length ? "normal" : adv.length ? "advantage" : dis.length ? "disadvantage" : "normal";
  const label = [adv.length ? `Advantage: ${adv.join(", ")}` : "", dis.length ? `Disadvantage: ${dis.join(", ")}` : ""].filter(Boolean).join(" · ");
  return { mode, adv, dis, label };
}

/**
 * Apply damage to HP pools: temp HP first, then HP (never below 0).
 * @param {{hp:number, temp:number}} pools
 * @param {number} amount   Raw damage
 * @param {number} mult     0 / 0.5 / 1 (resistance halves, rounded down)
 * @returns {{hp:number, temp:number, taken:number, fromTemp:number, fromHp:number, amount:number}}
 */
/* ---------- downed / defeated (HP <= 0) ---------- */

/** Status id to set at HP <= 0: player characters go unconscious, everything else is defeated (CONFIG.specialStatusEffects.DEFEATED). */
export function downedStatusId(type, defeatedId = "dead") {
  return type === "character" ? "unconscious" : defeatedId;
}

/** HP transition across 0. null/undefined HP means "full" (character default). */
export function downedTransition(before, after) {
  const b = (before === null || before === undefined) ? 1 : Number(before) || 0;
  const a = (after === null || after === undefined) ? 1 : Number(after) || 0;
  return { isDown: a <= 0, down: b > 0 && a <= 0, up: b <= 0 && a > 0 };
}

/**
 * What the HP sync has to change on an actor. Runs for every hit point change, so it is written as a
 * state rule, not a transition: at 0 or less the downed status belongs on the actor, above 0 it does not.
 * Only statuses the automation set itself (auto) are taken away again - a status the GM set by hand stays.
 * @param {object} o
 * @param {string} o.type                            actor type
 * @param {number|null} o.before                     hit points before
 * @param {number|null} o.after                      hit points after
 * @param {{id:string, auto?:boolean}[]} [o.statuses] the actor's current statuses with their origin
 * @param {string} [o.deadId]                        CONFIG.specialStatusEffects.DEFEATED
 * @returns {{set:string|null, clear:string[], isDown:boolean}}
 */
export function downedPlan({ type, before, after, statuses = [], deadId = "dead" } = {}) {
  const tr = downedTransition(before, after);
  if (tr.isDown) {
    const want = downedStatusId(type, deadId);
    return { set: statuses.some(s => s.id === want) ? null : want, clear: [], isDown: true };
  }
  const clear = [];
  for (const id of new Set([deadId, "unconscious"])) {
    if (statuses.some(s => s.id === id && s.auto)) clear.push(id);
  }
  return { set: null, clear, isDown: false };
}

/**
 * Chat line appended when a target drops to 0 HP.
 * @param {string} name
 * @param {string} type   actor type; characters go down, everything else is defeated
 * @param {"remove"|"mark"|"nogm"} [plan]  what happens to a defeated NPC token (see planDefeatedToken)
 */
export function downedLine(name, type, plan = "mark") {
  if (type === "character") return `${name} goes down.`;
  if (plan === "remove") return `${name} was defeated and removed.`;
  if (plan === "nogm") return `${name} is defeated. No GM connected, the token stays on the scene.`;
  return `${name} is defeated.`;
}

export function applyDamage({ hp, temp }, amount, mult = 1) {
  const raw = Math.max(0, Math.floor(Number(amount) || 0));
  const taken = Math.floor(raw * mult);
  let t = Math.max(0, Number(temp) || 0), h = Math.max(0, Number(hp) || 0);
  const fromTemp = Math.min(t, taken);
  t -= fromTemp;
  const fromHp = Math.min(h, taken - fromTemp);
  h -= fromHp;
  return { hp: h, temp: t, taken, fromTemp, fromHp, amount: raw };
}

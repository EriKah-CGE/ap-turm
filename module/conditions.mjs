/**
 * Conditions (CONFIG.statusEffects) and their effect on d20 rolls. Pure module, tested in Node.
 *
 * Statuses: prone, restrained, stunned, unconscious, invisible, poisoned, frightened, paralyzed, concentrating,
 * dead, exhaustion1..6 (concentrating is a marker only, it changes no roll). Rules (5e core for the conditions, the table's own rule for exhaustion):
 *   attacker prone / restrained / poisoned / frightened   -> disadvantage on attacks
 *   attacker invisible                                     -> advantage on attacks
 *   attacker poisoned / frightened                         -> disadvantage on ability checks (incl. initiative)
 *   attacker restrained                                    -> disadvantage on DEX saves
 *   attacker stunned / paralyzed / unconscious             -> STR and DEX saves fail automatically
 *   target restrained / stunned / paralyzed / unconscious  -> advantage on attacks against it
 *   target invisible                                       -> disadvantage on attacks against it
 *   target prone                                           -> advantage within 5 ft, disadvantage beyond
 *   target paralyzed / unconscious, hit within 5 ft        -> critical hit
 *   exhaustion N                                           -> -2 x N on every d20 roll, -5 ft speed, 6 = dead
 * Advantage and disadvantage from any source cancel out to a normal roll (5e).
 */

export const EXHAUSTION_MAX = 6;
export const EXHAUSTION_PENALTY = -2;   // per level, on every d20 roll
export const EXHAUSTION_SPEED = -5;     // ft per level

export const CONDITIONS = {
  prone:       { name: "Prone",       img: "icons/svg/falling.svg" },
  restrained:  { name: "Restrained",  img: "icons/svg/net.svg" },
  stunned:     { name: "Stunned",     img: "icons/svg/daze.svg" },
  unconscious: { name: "Unconscious", img: "icons/svg/unconscious.svg" },
  invisible:   { name: "Invisible",   img: "icons/svg/invisible.svg" },
  poisoned:    { name: "Poisoned",    img: "icons/svg/poison.svg" },
  frightened:  { name: "Frightened",  img: "icons/svg/terror.svg" },
  paralyzed:   { name: "Paralyzed",   img: "icons/svg/paralysis.svg" },
  // set by casting a concentration spell (concentration.mjs); no effect on any roll
  concentrating: { name: "Concentrating", img: "icons/svg/aura.svg" },
  dead:        { name: "Dead",        img: "icons/svg/skull.svg" }
};

export const exhaustionId = (n) => `exhaustion${n}`;
export const EXHAUSTION_IDS = Array.from({ length: EXHAUSTION_MAX }, (_, i) => exhaustionId(i + 1));

/** The full CONFIG.statusEffects list (conditions + six exhaustion levels). */
export function statusEffects() {
  const list = Object.entries(CONDITIONS).map(([id, c]) => ({ id, name: c.name, img: c.img }));
  for (let n = 1; n <= EXHAUSTION_MAX; n++) {
    list.push({ id: exhaustionId(n), name: `Exhaustion ${n}`, img: `systems/ap-turm/icons/exhaustion-${n}.svg`,
      description: `-${2 * n} on d20 rolls, -${5 * n} ft speed${n === EXHAUSTION_MAX ? ", dead" : ""}` });
  }
  return list;
}

/** Order of the chips in the sheet header and the quick bar: the conditions, then exhaustion as one icon. */
export const CHIP_ORDER = Object.keys(CONDITIONS).filter(id => id !== "dead").concat("dead");

/**
 * Chip list for a status set: every condition once, exhaustion as a single entry carrying its level.
 * @param {Iterable<string>} statuses
 * @returns {{id:string, name:string, img:string, active:boolean, exhaustion:boolean, level:number}[]}
 */
export function conditionChips(statuses = [], level = null) {
  const set = new Set(statuses);
  const lvl = level === null ? exhaustionLevel(set) : Math.max(0, Math.min(EXHAUSTION_MAX, Number(level) || 0));
  const list = CHIP_ORDER.map(id => ({ id, name: CONDITIONS[id].name, img: CONDITIONS[id].img, active: set.has(id), exhaustion: false, level: 0 }));
  list.push({ id: "exhaustion", name: "Exhaustion", img: `systems/ap-turm/icons/exhaustion-${Math.max(1, lvl)}.svg`, active: lvl > 0, exhaustion: true, level: lvl });
  return list;
}

/** Only the active chips (sheet header shows these). */
export function activeChips(statuses = [], level = null) {
  return conditionChips(statuses, level).filter(c => c.active);
}

/**
 * Exhaustion level after a click: left click steps up, right click steps down, clamped to 0..6.
 * @param {number} level
 * @param {number} delta
 */
export function stepExhaustion(level, delta) {
  return Math.max(0, Math.min(EXHAUSTION_MAX, (Number(level) || 0) + delta));
}

/** Exhaustion level from a status set (highest exhaustionN present). */
export function exhaustionLevel(statuses) {
  let lvl = 0;
  for (const s of statuses ?? []) { const m = /^exhaustion(\d)$/.exec(s); if (m) lvl = Math.max(lvl, +m[1]); }
  return Math.min(EXHAUSTION_MAX, lvl);
}

const has = (set, id) => !!set && (set instanceof Set ? set.has(id) : Array.from(set).includes(id));

/**
 * The status ids of exactly this actor. Every roll reads its conditions through this function and
 * through no other path: never from a target, never from the speaker of a card, never from a token
 * that was cached somewhere. The returned list is frozen, because a roll may read conditions but must
 * never set or clear one.
 * @param {{statuses?:Iterable<string>}|null} actor
 * @returns {readonly string[]}
 */
export function statusIdsOf(actor) {
  const s = actor?.statuses;
  return Object.freeze(s ? [...s].filter(id => typeof id === "string" && id) : []);
}

/**
 * Roll modifiers from the roller's and the target's conditions.
 * @param {object} o
 * @param {Iterable<string>} [o.statuses]        roller's status ids
 * @param {Iterable<string>} [o.targetStatuses]  target's status ids (attacks only)
 * @param {"attack"|"save"|"check"|"initiative"|"deathSave"} o.type
 * @param {string} [o.ability]                   save / check ability key
 * @param {number|null} [o.distance]             attacker-target distance in ft (null = unknown)
 * @param {number} [o.exhaustion]                exhaustion level to apply as a flat penalty (0 when already in the bonus)
 * @returns {{adv:string[], dis:string[], autoFail:string|null, autoCrit:string|null, penalty:number, notes:string[]}}
 */
export function rollModifiers({ statuses = [], targetStatuses = [], type, ability = null, distance = null, exhaustion = 0 } = {}) {
  const me = new Set(statuses), tg = new Set(targetStatuses);
  const r = { adv: [], dis: [], autoFail: null, autoCrit: null, penalty: 0, notes: [] };
  const isCheck = type === "check" || type === "initiative";
  if (type === "attack") {
    if (has(me, "prone")) r.dis.push("prone");
    if (has(me, "restrained")) r.dis.push("restrained");
    if (has(me, "poisoned")) r.dis.push("poisoned");
    if (has(me, "frightened")) r.dis.push("frightened");
    if (has(me, "invisible")) r.adv.push("invisible");
    for (const c of ["stunned", "paralyzed", "unconscious"]) if (has(me, c)) r.notes.push(`${c}: cannot take actions`);
    for (const c of ["restrained", "stunned", "paralyzed", "unconscious"]) if (has(tg, c)) r.adv.push(`target ${c}`);
    if (has(tg, "invisible")) r.dis.push("target invisible");
    if (has(tg, "prone")) {
      if (distance === null || distance === undefined) r.notes.push("target prone: advantage within 5 ft, disadvantage beyond (distance unknown)");
      else if (distance <= 5) r.adv.push("target prone (melee)");
      else r.dis.push("target prone (ranged)");
    }
    const helpless = ["paralyzed", "unconscious"].filter(c => has(tg, c));
    if (helpless.length) {
      if (distance === null || distance === undefined) r.notes.push(`target ${helpless[0]}: a hit within 5 ft is a critical hit (distance unknown)`);
      else if (distance <= 5) r.autoCrit = `target ${helpless[0]}`;
    }
  } else if (type === "save") {
    if ((ability === "str" || ability === "dex")) {
      for (const c of ["stunned", "paralyzed", "unconscious"]) if (has(me, c)) { r.autoFail = c; break; }
    }
    if (ability === "dex" && has(me, "restrained")) r.dis.push("restrained");
  } else if (isCheck) {
    if (has(me, "poisoned")) r.dis.push("poisoned");
    if (has(me, "frightened")) r.dis.push("frightened");
  }
  const ex = Math.max(0, Math.min(EXHAUSTION_MAX, Number(exhaustion) || 0));
  if (ex) { r.penalty = EXHAUSTION_PENALTY * ex; r.notes.push(`exhaustion ${ex}: ${r.penalty}`); }
  if (has(me, "dead") || has(me, exhaustionId(EXHAUSTION_MAX))) r.notes.push("dead");
  return r;
}

/**
 * Final roll mode: the user's choice (keys / dialog) plus condition sources. Any advantage and any
 * disadvantage together cancel to normal.
 * @param {"advantage"|"normal"|"disadvantage"} userMode
 * @param {{adv:string[], dis:string[]}} m
 */
export function resolveMode(userMode, m) {
  const adv = (m?.adv?.length ?? 0) + (userMode === "advantage" ? 1 : 0);
  const dis = (m?.dis?.length ?? 0) + (userMode === "disadvantage" ? 1 : 0);
  if (adv && dis) return "normal";
  if (adv) return "advantage";
  if (dis) return "disadvantage";
  return "normal";
}

/**
 * Which tokens a quick-bar click applies to: the controlled tokens, else the targeted ones, else none.
 * @param {object} o  {controlled: Token[], targets: Iterable<Token>}
 * @returns {{tokens: object[], source: "controlled"|"targets"|"none"}}
 */
export function toggleTargets({ controlled = [], targets = [] } = {}) {
  const ctrl = [...controlled];
  if (ctrl.length) return { tokens: ctrl, source: "controlled" };
  const tg = [...targets];
  if (tg.length) return { tokens: tg, source: "targets" };
  return { tokens: [], source: "none" };
}

/** Effective speed after exhaustion (never below 0). */
export function exhaustedSpeed(speed, level) {
  return Math.max(0, (Number(speed) || 0) + EXHAUSTION_SPEED * Math.max(0, Math.min(EXHAUSTION_MAX, Number(level) || 0)));
}

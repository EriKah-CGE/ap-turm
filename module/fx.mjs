/**
 * Attack and cast animations with JB2A + Sequencer (soft integration: only when both modules are active).
 *
 * - Detection: jb2a_patreon or JB2A_DnD5e (free), plus sequencer. Without them nothing happens except one
 *   debug line in the console.
 * - Attack roll with a target: melee -> swing from the attacker to the target (beside it on a miss), ranged ->
 *   missile from the attacker to the target. A crit adds a big impact on the target.
 * - Spell cast: with a target a projectile in the element's look, without one a short cast effect on the caster.
 * - The looks come from fx-map.mjs; Sequencer plays them for everyone.
 * - Nothing here may block a roll or a damage application: every entry point swallows its errors (console only)
 *   and is called without awaiting it.
 * - World setting "Attack animations (JB2A)" (default on, only has an effect with the modules active).
 */
import { meleeFile, rangedFile, isRangedAttack, typeFx, weaponTint, DEFAULT_FX } from "./fx-map.mjs";

const SYSTEM_ID = "ap-turm";
export const ANIMATIONS_SETTING = "attackAnimations";

export function registerFxSetting() {
  game.settings.register(SYSTEM_ID, ANIMATIONS_SETTING, {
    name: "Attack animations (JB2A)",
    hint: "Attack, projectile and cast animations. Only works while JB2A (free or Patreon) and Sequencer are active.",
    scope: "world", config: true, type: Boolean, default: true
  });
}

let reported = false;
/** Are the modules there (and the setting on)? Reports a missing module once, as a debug line. */
export function fxAvailable() {
  const mods = game.modules;
  const jb2a = !!(mods.get("jb2a_patreon")?.active || mods.get("JB2A_DnD5e")?.active);
  const seq = !!mods.get("sequencer")?.active && typeof globalThis.Sequence === "function";
  if (!(jb2a && seq)) {
    if (!reported) { console.debug(`${SYSTEM_ID} | attack animations off: ${jb2a ? "" : "JB2A "}${seq ? "" : "Sequencer "}not active`); reported = true; }
    return false;
  }
  try { return game.settings.get(SYSTEM_ID, ANIMATIONS_SETTING) !== false; } catch { return true; }
}

/** The placed token of an actor on the current scene. */
function tokenOf(actor) {
  const t = actor?.token?.object ?? actor?.getActiveTokens?.(true, false)?.[0] ?? null;
  return t?.scene?.id === canvas?.scene?.id ? t : null;
}

const tinted = (effect, color) => (color ? effect.tint(color) : effect);

/** Two distinct tokens far enough apart to stretch an effect between them (Sequencer rejects a zero distance). */
const canStretch = (a, b) => !!a && !!b && a !== b && Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) >= 1;

/** Run a builder in a guarded way: errors go to the console, never to the caller. */
function guarded(label, fn) {
  try {
    if (!fxAvailable()) return;
    const run = fn();
    if (run?.catch) run.catch(err => console.error(`${SYSTEM_ID} | fx ${label}`, err));
  } catch (err) {
    console.error(`${SYSTEM_ID} | fx ${label}`, err);
  }
}

/**
 * Animation for an attack roll.
 * @param {object} o
 * @param {Actor} o.actor          attacker
 * @param {Token|null} o.target    target token (no target: no animation)
 * @param {string} o.name          weapon / attack name
 * @param {string} [o.dtype]       damage type (element in Turm mode)
 * @param {string} [o.abil]        weapon ability (character weapons)
 * @param {string} [o.range]       range text (NPC attacks)
 * @param {string} o.outcome       "hit" | "crit" | "miss" | "fumble" | ...
 */
export function playAttackFx({ actor, target, name = "", dtype = "", abil = "", range = "", outcome = "hit" } = {}) {
  guarded("attack", () => {
    if (!target) return;
    const source = tokenOf(actor);
    const mode = actor?.system?.mode ?? "ap";
    const miss = outcome === "miss" || outcome === "fumble";
    const crit = outcome === "crit";
    const look = typeFx(dtype, mode);
    const color = weaponTint(dtype, mode);
    const ranged = isRangedAttack({ name, range, abil });
    const seq = new Sequence({ moduleName: SYSTEM_ID, softFail: true });
    let e = seq.effect().file(ranged ? rangedFile(name) : meleeFile(name));
    if (canStretch(source, target)) e = e.atLocation(source).stretchTo(target);
    else e = e.atLocation(target);
    e = tinted(e.missed(miss), color);
    if (crit) {
      e.scale?.(1.3);
      const impact = look?.impact ?? { file: DEFAULT_FX.impact.file, tint: null };
      tinted(seq.effect().file(impact.file).atLocation(target).scaleToObject(2.2).delay(ranged ? 500 : 250), impact.tint ?? color);
    }
    return seq.play();
  });
}

/**
 * Animation for a spell cast: projectile to the current target, otherwise a cast effect on the caster.
 * @param {object} o  {actor, target: Token|null, elem: element / damage type of the spell}
 */
export function playCastFx({ actor, target = null, elem = "" } = {}) {
  guarded("cast", () => {
    const source = tokenOf(actor);
    const mode = actor?.system?.mode ?? "ap";
    const look = typeFx(elem, mode);
    const seq = new Sequence({ moduleName: SYSTEM_ID, softFail: true });
    if (canStretch(source, target)) {
      const proj = look?.projectile ?? { file: "jb2a.magic_missile.purple", tint: null };
      tinted(seq.effect().file(proj.file).atLocation(source).stretchTo(target), proj.tint);
    } else if (source) {
      const cast = look?.cast ?? { file: DEFAULT_FX.cast.file, tint: null };
      tinted(seq.effect().file(cast.file).atLocation(source).scaleToObject(1.8), cast.tint);
    } else return;
    return seq.play();
  });
}

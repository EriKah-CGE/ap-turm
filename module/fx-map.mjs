/**
 * Mapping element / damage type / weapon -> JB2A animation (Sequencer database paths, "jb2a." prefix).
 * Every path exists in the free JB2A module (JB2A_DnD5e); the Patreon module registers the same paths.
 * Ranged entries stop before the distance suffix (".30ft"), Sequencer picks the variant that fits the distance.
 *
 * Element entries: projectile (ranged attack / spell with a target), impact (on the target, crits), cast (on the
 * caster, spell without a target). `tint: true` marks a part whose file is only the nearest match - it is tinted
 * with the element colour from ELEMENTS. Parts without tint are an exact match and keep their own colour.
 * AP mode: D&D damage types on the JB2A standard colours, never tinted.
 * Pure data + lookups, loadable in Node (test/rules.test.mjs).
 */
import { ELEMENTS, DAMAGE_TYPES } from "./config.mjs";

const p = (file, tint = false) => ({ file, tint });

// tintable fallbacks for elements without a JB2A counterpart (light bases take the tint best)
const GEN = {
  projectile: p("jb2a.guiding_bolt.01.blueyellow", true),
  impact: p("jb2a.impact.frost.white.01", true),
  cast: p("jb2a.cast_generic.01.yellow", true)
};

export const ELEMENT_FX = {
  erde:        { projectile: p("jb2a.boulder.toss.02.01.stone.brown"), impact: p("jb2a.impact.ground_crack.01.orange", true), cast: p("jb2a.cast_generic.earth.01.browngreen") },
  eis:         { projectile: p("jb2a.ray_of_frost.blue"), impact: p("jb2a.impact.frost.white.01"), cast: p("jb2a.cast_generic.02.blue") },
  chaos:       { projectile: p("jb2a.eldritch_blast.purple", true), impact: GEN.impact, cast: GEN.cast },
  blut:        { projectile: p("jb2a.scorching_ray.01.orange", true), impact: GEN.impact, cast: GEN.cast },
  ordnung:     { projectile: GEN.projectile, impact: GEN.impact, cast: GEN.cast },
  licht:       { projectile: p("jb2a.guiding_bolt.01.blueyellow"), impact: p("jb2a.impact.006.yellow"), cast: p("jb2a.cast_generic.01.yellow") },
  blitz:       { projectile: p("jb2a.chain_lightning.primary.blue", true), impact: p("jb2a.impact.004.blue", true), cast: p("jb2a.cast_generic.02.blue", true) },
  gaya:        { projectile: GEN.projectile, impact: GEN.impact, cast: p("jb2a.cast_generic.earth.01.browngreen") },
  erz:         { projectile: p("jb2a.bolt.physical.orange", true), impact: GEN.impact, cast: GEN.cast },
  energie:     { projectile: p("jb2a.magic_missile.purple", true), impact: GEN.impact, cast: GEN.cast },
  gift:        { projectile: p("jb2a.disintegrate.green"), impact: GEN.impact, cast: GEN.cast },
  heilig:      { projectile: p("jb2a.guiding_bolt.01.blueyellow"), impact: p("jb2a.impact.006.yellow"), cast: p("jb2a.cast_generic.01.yellow") },
  wind:        { projectile: GEN.projectile, impact: GEN.impact, cast: GEN.cast },
  wasser:      { projectile: p("jb2a.spell_projectile.ice_shard.blue", true), impact: p("jb2a.impact.water.02.blue"), cast: p("jb2a.cast_generic.water.02.blue") },
  schoepfung:  { projectile: GEN.projectile, impact: GEN.impact, cast: GEN.cast },
  zerstoerung: { projectile: p("jb2a.fire_bolt.orange", true), impact: p("jb2a.explosion.01.orange"), cast: GEN.cast },
  dunkelheit:  { projectile: p("jb2a.eldritch_blast.purple", true), impact: GEN.impact, cast: GEN.cast },
  feuer:       { projectile: p("jb2a.fire_bolt.orange"), impact: p("jb2a.impact.fire.01.orange"), cast: p("jb2a.cast_generic.fire.01.orange") },
  turm:        { projectile: GEN.projectile, impact: GEN.impact, cast: GEN.cast },
  arch:        { projectile: p("jb2a.eldritch_blast.purple", true), impact: GEN.impact, cast: GEN.cast }
};

// physical types have no element look: the weapon animation carries them (null = weapon default)
const PLAIN_IMPACT = p("jb2a.impact.003.blue");
export const DAMAGE_FX = {
  acid:        { projectile: p("jb2a.disintegrate.green"), impact: PLAIN_IMPACT, cast: p("jb2a.cast_generic.earth.01.browngreen") },
  bludgeoning: null,
  cold:        ELEMENT_FX.eis,
  fire:        ELEMENT_FX.feuer,
  force:       { projectile: p("jb2a.magic_missile.purple"), impact: p("jb2a.impact.003.blue"), cast: p("jb2a.cast_generic.02.blue") },
  lightning:   { projectile: p("jb2a.chain_lightning.primary.blue"), impact: p("jb2a.impact.004.blue"), cast: p("jb2a.cast_generic.02.blue") },
  necrotic:    { projectile: p("jb2a.eldritch_blast.purple"), impact: p("jb2a.toll_the_dead.green.shockwave"), cast: p("jb2a.cast_generic.03.blue") },
  piercing:    null,
  poison:      { projectile: p("jb2a.disintegrate.green"), impact: p("jb2a.toll_the_dead.green.shockwave"), cast: p("jb2a.cast_generic.earth.01.browngreen") },
  psychic:     { projectile: p("jb2a.eldritch_blast.purple"), impact: p("jb2a.particle_burst.01.circle.bluepurple"), cast: p("jb2a.cast_generic.03.blue") },
  radiant:     ELEMENT_FX.licht,
  slashing:    null,
  thunder:     { projectile: p("jb2a.magic_missile.purple"), impact: p("jb2a.impact.004.blue"), cast: p("jb2a.cast_generic.02.blue") }
};

/** Default look for attacks without an element (physical types, unknown or empty type). */
export const DEFAULT_FX = { projectile: p("jb2a.arrow.physical.white.01"), impact: PLAIN_IMPACT, cast: p("jb2a.cast_generic.01.yellow") };

// weapon name -> melee swing (first match wins; German and English names)
export const MELEE_FX = [
  [/speer|spear|lanze|lance|pike|trident|dreizack/i, "jb2a.spear.melee.01.white"],
  [/dolch|dagger|messer|knife/i, "jb2a.dagger.melee.02.white"],
  [/zweih(ä|ae)nder|greatsword|gro(ß|ss)schwert|claymore/i, "jb2a.greatsword.melee.standard.white"],
  [/streitaxt|greataxe|battleaxe|gro(ß|ss)axt/i, "jb2a.greataxe.melee.standard.white"],
  [/axt|axe|beil/i, "jb2a.handaxe.melee.standard.white"],
  [/maul|vorschlaghammer/i, "jb2a.maul.melee.standard.white"],
  [/hammer/i, "jb2a.warhammer.melee.01.white"],
  [/streitkolben|mace|morgenstern|flegel|flail/i, "jb2a.mace.melee.01.white"],
  [/keule|club/i, "jb2a.club.melee.01.white"],
  [/kampfstab|quarterstaff|stab\b|staff/i, "jb2a.quarterstaff.melee.01.white"],
  [/rapier|degen/i, "jb2a.rapier.melee.01.white"],
  [/krumms(ä|ae)bel|scimitar|s(ä|ae)bel/i, "jb2a.scimitar.melee.01.white"],
  [/falchion/i, "jb2a.falchion.melee.01.white"],
  [/glefe|glaive/i, "jb2a.glaive.melee.01.white"],
  [/hellebarde|halberd/i, "jb2a.halberd.melee.01.white"],
  [/kurzschwert|shortsword/i, "jb2a.shortsword.melee.01.white"],
  [/faust|fist|unarmed|waffenlos|schlag\b/i, "jb2a.unarmed_strike.physical.01.blue"],
  [/klaue|claw|kralle/i, "jb2a.claws.200px.red"],
  [/biss|bite/i, "jb2a.bite.200px.red"]
];
export const MELEE_DEFAULT = "jb2a.sword.melee.01.white";

// weapon name -> ranged missile
export const RANGED_FX = [
  [/armbrust|crossbow/i, "jb2a.bolt.physical.orange"],
  [/bogen|bow/i, "jb2a.arrow.physical.white.01"],
  [/pistole|pistol|gewehr|muskete|musket|flinte|gun|rifle/i, "jb2a.bullet.01.orange"],
  [/schleuder|sling/i, "jb2a.bullet.02.orange"],
  [/dolch|dagger|messer|knife/i, "jb2a.dagger.throw.01.white"]
];
export const RANGED_DEFAULT = "jb2a.arrow.physical.white.01";

// names that mark a weapon or NPC attack as ranged
const RANGED_NAME = /armbrust|crossbow|bogen|\bbow|longbow|shortbow|pistole|pistol|gewehr|muskete|musket|flinte|\bgun|rifle|schleuder|sling|wurf|throw|dart|javelin|wurfspeer/i;

/**
 * Is this attack ranged? Name first ("Longbow", "Wurfdolch"), then the NPC range text ("range 80/320 ft"),
 * then the weapon ability: DEX (not finesse) is the ranged column of the app's weapon table.
 * @param {object} o  {name, range: NPC range text, abil: weapon ability key}
 */
export function isRangedAttack({ name = "", range = "", abil = "" } = {}) {
  if (RANGED_NAME.test(String(name))) return true;
  const r = String(range).toLowerCase();
  if (/\branged?\b/.test(r)) return true;
  if (/\breach\b/.test(r)) return false;
  const ft = Number(/(\d+)\s*(?:\/\s*\d+\s*)?ft/.exec(r)?.[1]);
  if (Number.isFinite(ft) && ft > 10) return true;
  return abil === "dex";
}

/** Melee swing for a weapon name. */
export function meleeFile(name) {
  for (const [re, file] of MELEE_FX) if (re.test(String(name ?? ""))) return file;
  return MELEE_DEFAULT;
}

/** Missile for a ranged weapon name. */
export function rangedFile(name) {
  for (const [re, file] of RANGED_FX) if (re.test(String(name ?? ""))) return file;
  return RANGED_DEFAULT;
}

/**
 * The element / damage type look: {projectile, impact, cast} each {file, tint: colour or null}, or null for a
 * physical / unknown type (the weapon animation alone). Turm mode reads ELEMENTS, AP mode DAMAGE_TYPES; a
 * value from the other mode is still found (old data stays readable), but only elements are ever tinted.
 * @param {string} dtype
 * @param {string} mode  "turm" | "ap"
 */
export function typeFx(dtype, mode = "ap") {
  const k = String(dtype ?? "").trim().toLowerCase();
  const fromElement = ELEMENT_FX[k];
  const fromDnd = k in DAMAGE_FX ? DAMAGE_FX[k] : undefined;
  let entry, color = null;
  if (mode === "turm") { entry = fromElement ?? fromDnd; if (fromElement) color = ELEMENTS[k].c; }
  else { entry = fromDnd ?? fromElement; if (!fromDnd && fromElement) color = ELEMENTS[k].c; }
  if (!entry) return null;
  const part = (x) => ({ file: x.file, tint: x.tint && color ? color : null });
  return { projectile: part(entry.projectile), impact: part(entry.impact), cast: part(entry.cast) };
}

/** Tint of the weapon swing itself: the element colour in Turm mode, none otherwise. */
export function weaponTint(dtype, mode = "ap") {
  if (mode !== "turm") return null;
  return ELEMENTS[String(dtype ?? "").trim().toLowerCase()]?.c ?? null;
}

/** Every damage key the map has to cover: the 20 elements and the D&D types. */
export const FX_KEYS = { elements: Object.keys(ELEMENTS), dnd: Object.keys(DAMAGE_TYPES) };

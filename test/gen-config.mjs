// Generates module/config.mjs from the HTML app so the tables are copied, not retyped.
// Run: node test/gen-config.mjs
import fs from "node:fs";
const html = fs.readFileSync(new URL("../ap-character-sheet.html", import.meta.url), "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
function grab(name) {
  const re = new RegExp("^const " + name + "=([\\s\\S]*?);\\s*$", "m");
  const m = js.match(re);
  if (!m) throw new Error("not found: " + name);
  return m[1].trim();
}
// SHOP_DATA / ARMORS / ELEMENTS / HIT_DICE span several lines; the non-greedy regex stops at the
// first line ending in ";" which is the closing "};" / "];" of those blocks.
const names = ["PREREQS","SELECTORS","SHOP_DATA","ARMOR_WEAPON_PROFS","ABILITIES","ABBR","SKILLS","DAMAGE_TYPES",
  "CREATURE_TYPES","FIGHT_STYLES","WEAPONS","DMG_SHORT","HIT_DICE","WEP_ABIL","ARMORS","ELEMENTS","RECHARGE","FEAT_EXTRA"];
let out = `/**
 * AP-Turm rule tables.
 * GENERATED from ap-character-sheet.html by test/gen-config.mjs -- do not edit the tables by hand;
 * edit the HTML app (source of truth) and re-run \`node test/gen-config.mjs\`.
 */\n\n`;
for (const n of names) out += `export const ${n}=${grab(n)};\n\n`;
const lim = js.match(/^const TOWER_CARRY_LIMIT=(\d+), CRYSTAL_LIMIT=(\d+);/m);
out += `export const TOWER_CARRY_LIMIT=${lim[1]};\nexport const CRYSTAL_LIMIT=${lim[2]};\n\n`;
out += `/* Currency sets per mode (labels as shown in the app) */
export const CURRENCIES={
  turm:[["ku","KU","Kupfer (100 = 1 BR)"],["br","BR","Bronze (100 = 1 SI)"],["si","SI","Silber (100 = 1 GO)"],["go","GO","Gold (10 = 1 ED)"],["ed","ED","Edelsteine"]],
  ap:[["cp","CP","Copper"],["sp","SP","Silver"],["ep","EP","Electrum"],["gp","GP","Gold"],["pp","PP","Platinum"]]
};

export const MODES={ap:"Standard AP",turm:"Turm"};
export const SPELL_LEVELS=[0,1,2,3,4,5,6,7,8,9];
export const GEAR_ORIGINS={city:"Carried in from Monsbaiya",tower:"Found in the tower"};
export const WEAPON_ABILITY_LABELS={str:"Strength",dex:"Dexterity",fin:"Finesse (best of STR/DEX)",con:"Constitution",int:"Intelligence",wis:"Wisdom",cha:"Charisma"};

/* eleDmg picks its element at purchase, changeEle swaps it (rule from the user, app v09-05k).
 * Kept as defaults so that the generated SELECTORS from an app version that lacks them still work;
 * once the app defines them, its values win. */
SELECTORS.eleDmg ??= {type:"damage",label:"Element (+1d6)"};
SELECTORS.changeEle ??= {type:"damage",label:"New Element"};

/** Lookup a shop entry by id across all categories. */
export function findShopItem(id){for(const c in SHOP_DATA){const f=SHOP_DATA[c].find(x=>x.id===id);if(f)return f;}return null;}

/* ---------- damage types by mode ----------
 * Mode "ap": the D&D damage types (DAMAGE_TYPES); mode "turm": the 20 elements (ELEMENTS).
 * Applies to weapon damage type, the "res" purchase, the spell editor and the +1d6 Elemental display.
 * Values stored under the other mode stay readable: labels are looked up in both tables. */
export function damageTypeChoices(mode){
  return mode==="turm" ? Object.fromEntries(Object.keys(ELEMENTS).map(k=>[k,ELEMENTS[k].l])) : {...DAMAGE_TYPES};
}
export function damageTypeLabel(key){ const k=baseTypeKey(key); return ELEMENTS[k]?.l ?? DAMAGE_TYPES[k] ?? k; }
export function damageTypeColor(key){ return ELEMENTS[baseTypeKey(key)]?.c ?? ""; }

/* ---------- "not assigned" (statblock / dnd5e import in mode turm) ----------
 * An imported type the GM has not decided on yet is stored with the prefix "?" ("?fire"). It never resists and is
 * never resisted. Every key without the prefix is a real type, D&D type or element, in both modes. */
export const UNASSIGNED_PREFIX="?";
export function isUnassignedKey(key){ return String(key??"").startsWith(UNASSIGNED_PREFIX); }
export function baseTypeKey(key){ const s=String(key??""); return s.startsWith(UNASSIGNED_PREFIX)?s.slice(1):s; }

/* ---------- weapons, NPC actions, item defenses (rule from the user, 1.3.0) ----------
 * Mode "turm": both lists, grouped ("Damage types" = DAMAGE_TYPES, "Elements" = ELEMENTS); mode "ap": DAMAGE_TYPES only.
 * res / eleDmg / changeEle / spell editor keep damageTypeChoices (turm -> elements). */
export function damageTypeGroups(mode){
  const dnd={label:"Damage types",options:Object.entries(DAMAGE_TYPES).map(([value,label])=>({value,label}))};
  if(mode!=="turm")return [dnd];
  return [dnd,{label:"Elements",options:Object.keys(ELEMENTS).map(k=>({value:k,label:ELEMENTS[k].l}))}];
}
/** Grouped select data: {extra: options before the groups (none / current foreign or unassigned value), groups}. */
export function damageTypeGroupOptions(mode,current,{none=false,noneLabel="— none —"}={}){
  const cur=String(current??"");
  const groups=damageTypeGroups(mode).map(g=>({label:g.label,options:g.options.map(o=>({...o,selected:o.value===cur}))}));
  const known=groups.some(g=>g.options.some(o=>o.value===cur));
  const extra=[];
  if(none)extra.push({value:"",label:noneLabel,selected:!cur});
  if(cur&&!known)extra.push({value:cur,label:damageTypeLabel(cur)+(isUnassignedKey(cur)?" (not assigned)":""),selected:true,foreign:true});
  return {extra,groups};
}
/** Choices for a select: current mode's list plus the current value if it comes from the other mode. */
export function damageTypeOptions(mode, current){
  const choices=damageTypeChoices(mode);
  const out=Object.entries(choices).map(([value,label])=>({value,label,selected:value===current}));
  if(current && !(current in choices)) out.unshift({value:current,label:damageTypeLabel(current),selected:true,foreign:true});
  return out;
}

export const AP_TURM={PREREQS,SELECTORS,SHOP_DATA,ARMOR_WEAPON_PROFS,ABILITIES,ABBR,SKILLS,DAMAGE_TYPES,CREATURE_TYPES,FIGHT_STYLES,WEAPONS,DMG_SHORT,HIT_DICE,WEP_ABIL,ARMORS,ELEMENTS,RECHARGE,FEAT_EXTRA,TOWER_CARRY_LIMIT,CRYSTAL_LIMIT,CURRENCIES,MODES,SPELL_LEVELS,GEAR_ORIGINS,WEAPON_ABILITY_LABELS,findShopItem,damageTypeChoices,damageTypeLabel,damageTypeColor,damageTypeOptions,damageTypeGroups,damageTypeGroupOptions,isUnassignedKey,baseTypeKey,UNASSIGNED_PREFIX};
export default AP_TURM;
`;
fs.writeFileSync(new URL("../module/config.mjs", import.meta.url), out);
console.log("wrote module/config.mjs", out.length, "bytes");

/**
 * AP-Turm rule tables.
 * GENERATED from ap-character-sheet.html by test/gen-config.mjs -- do not edit the tables by hand;
 * edit the HTML app (source of truth) and re-run `node test/gen-config.mjs`.
 */

export const PREREQS={spellslot2:"spellslot1",spellslot3:"spellslot2",spellslot4:"spellslot3",spellslot5:"spellslot4",spellslot6:"spellslot5",spellslot7:"spellslot6",spellslot8:"spellslot7",spellslot9:"spellslot8",learn1:"spellslot1",learn2:"spellslot2",learn3:"spellslot3",learn4:"spellslot4",learn5:"spellslot5",learn6:"spellslot6",learn7:"spellslot7",learn8:"spellslot8",learn9:"spellslot9",med:"lgt",hvy:"med",mar:"sim"};

export const SELECTORS={asi:{type:"ability",label:"Ability (+1)"},max20:{type:"ability",label:"Limit Break (Max +2)"},saveProf:{type:"ability",label:"Save Proficiency"},skillProf:{type:"skill",label:"Skill Proficiency"},skillExp:{type:"skill",label:"Skill Expertise"},advSkill:{type:"skill",label:"Advantage on Skill"},advSave:{type:"ability",label:"Advantage on Save"},res:{type:"damage",label:"Resistance"},eleDmg:{type:"damage",label:"Element (+1d6 per rank)"},changeEle:{type:"damage",label:"New element (replaces +1d6 element)"},unarmored:{type:"ability",label:"AC Stat"},altStat:{type:"ability",label:"Attack Stat"},fightStyle:{type:"fightStyle",label:"Fighting Style"},wepMastery:{type:"weapon",label:"Weapon Choice"},monsterDmg:{type:"creature",label:"Creature Type"}};

export const SHOP_DATA={
 "Magic (Core)":[{id:"spellslot1",name:"Spellslot Lvl 1 (+1 spell)",costs:[4,8,16,32,64]},{id:"spellslot2",name:"Spellslot Lvl 2 (+1 spell)",costs:[5,10,20,40,80]},{id:"spellslot3",name:"Spellslot Lvl 3 (+1 spell)",costs:[7,14,28,56,112]},{id:"spellslot4",name:"Spellslot Lvl 4 (+1 spell)",costs:[8,16,32,64,128]},{id:"spellslot5",name:"Spellslot Lvl 5 (+1 spell)",costs:[9,18,36,72,144]},{id:"spellslot6",name:"Spellslot Lvl 6 (+1 spell)",costs:[11,22,44,88]},{id:"spellslot7",name:"Spellslot Lvl 7 (+1 spell)",costs:[12,24,48,96]},{id:"spellslot8",name:"Spellslot Lvl 8 (+1 spell)",costs:[13,26,52,104]},{id:"spellslot9",name:"Spellslot Lvl 9 (+1 spell)",costs:[15,30,60,120]},{id:"cantrip",name:"Cantrip known",costs:[4,8,16,32,64]},{id:"spellDC",name:"Spell Attack/DC +1",costs:[10,20,40]},{id:"sorc",name:"Sorcery Points",costs:[25]},{id:"meta",name:"Meta Magic",costs:[10,20,40,80]}],
 "Magic (Learn)":[{id:"learn1",name:"Extra Spell Lvl 1",hint:"Additional known spell of rank 1. Requires Spellslot Lvl 1.",costs:[4],mult:1},{id:"learn2",name:"Extra Spell Lvl 2",hint:"Additional known spell of rank 2. Requires Spellslot Lvl 2.",costs:[5],mult:1},{id:"learn3",name:"Extra Spell Lvl 3",hint:"Additional known spell of rank 3. Requires Spellslot Lvl 3.",costs:[7],mult:1},{id:"learn4",name:"Extra Spell Lvl 4",hint:"Additional known spell of rank 4. Requires Spellslot Lvl 4.",costs:[8],mult:1},{id:"learn5",name:"Extra Spell Lvl 5",hint:"Additional known spell of rank 5. Requires Spellslot Lvl 5.",costs:[9],mult:1},{id:"learn6",name:"Extra Spell Lvl 6",hint:"Additional known spell of rank 6. Requires Spellslot Lvl 6.",costs:[11],mult:1},{id:"learn7",name:"Extra Spell Lvl 7",hint:"Additional known spell of rank 7. Requires Spellslot Lvl 7.",costs:[12],mult:1},{id:"learn8",name:"Extra Spell Lvl 8",hint:"Additional known spell of rank 8. Requires Spellslot Lvl 8.",costs:[13],mult:1},{id:"learn9",name:"Extra Spell Lvl 9",hint:"Additional known spell of rank 9. Requires Spellslot Lvl 9.",costs:[15],mult:1},{id:"ritual",name:"Ritual Casting",costs:[30]},{id:"warlock",name:"Warlock Casting",costs:[100]},{id:"ritualFast",name:"Fast Rituals",costs:[3]},{id:"bonusCast",name:"Bonus Action Cast",costs:[12]},{id:"changeEle",name:"Element Swap",costs:[15]},{id:"advConc",name:"Adv. Concentration",costs:[30]},{id:"nonPrep",name:"Cast Non-Prepared",costs:[6,12,24,48]},{id:"slotBoost",name:"Slot Level +2",costs:[15,30,60]},{id:"healCon",name:"Self Heal +CON",costs:[6]},{id:"smite",name:"Divine Smite",costs:[15]},{id:"storeWep",name:"Store Spell",costs:[12]},{id:"layHands",name:"Lay on Hands",costs:[15]}],
 "Combat (Off)":[{id:"extraAttack",name:"Extra Attack",costs:[10,20,40,80]},{id:"wepMastery",name:"Weapon Mastery",costs:[5,10,20,40]},{id:"wepPlus1",name:"Weapon +1",costs:[9,18,36]},{id:"eleDmg",name:"+1d6 Elemental",costs:[15,30,60]},{id:"monsterDmg",name:"+2d6 vs Type",costs:[15,30,60]},{id:"largeDmg",name:"+1d6 vs Large",costs:[12,24,48]},{id:"objMax",name:"Max vs Objects",costs:[3]},{id:"critBoost",name:"Crit 19-20",costs:[15,30]},{id:"critMax",name:"Crit Max Dmg",costs:[10,20,40]},{id:"killAdv",name:"Adv after Kill",costs:[4,8,16]},{id:"sneak",name:"Sneak Attack",costs:[25]},{id:"sneakPlus",name:"Sneak Dmg +1d6",costs:[8,16,32,64]},{id:"rage",name:"Rage",costs:[25]},{id:"reckless",name:"Reckless Attack",costs:[8]},{id:"ki",name:"Ki / Flurry",costs:[25]},{id:"kiAbil",name:"Ki Abilities",costs:[10,20,40]},{id:"kiRest",name:"Ki Restore",costs:[15]},{id:"fightStyle",name:"Fighting Style",costs:[5,10,20]},{id:"shieldAtt",name:"+1 vs Shield",costs:[6,12]},{id:"psychCast",name:"Mage Slayer",costs:[15,30,60]},{id:"hitAdv",name:"Hit -> Adv",costs:[12,24,48]},{id:"firstAdv",name:"First Round Adv",costs:[6]},{id:"throwDist",name:"Thrown Range",costs:[6,12,24]},{id:"cleave",name:"Cleave",costs:[20]},{id:"poison",name:"Poison Weapon",costs:[20,40,80]},{id:"concDmg",name:"Disrupt Conc.",costs:[15]}],
 "Combat (Def)":[{id:"reactAc",name:"Reaction +1 AC",costs:[6,12,24]},{id:"disarmImm",name:"Disarm Immune",costs:[3]},{id:"wepGlow",name:"Weapon Glow",costs:[3,6,12]},{id:"morphObj",name:"Morph Weapon",costs:[6]},{id:"pocketWep",name:"Pocket Weapon",costs:[6]},{id:"finalAtt",name:"Final Attack",costs:[3,6,12]},{id:"fancyFoot",name:"Fancy Footwork",costs:[8]},{id:"infAmmo",name:"Infinite Ammo",costs:[6]},{id:"saveProne",name:"Save Prone",costs:[6]},{id:"saveShove",name:"Save Shove",costs:[3]},{id:"saveFright",name:"Save Fright",costs:[9]},{id:"saveDisarm",name:"Save Disarm",costs:[6]},{id:"savePois",name:"Save Poison",costs:[9]},{id:"initAdv",name:"Adv Initiative",costs:[5]},{id:"noRangeDis",name:"No Range Dis",costs:[6]},{id:"acStationary",name:"Stationary AC",costs:[12]},{id:"healAlly",name:"Heal Ally",costs:[15]},{id:"reroll1",name:"Reroll 1s",costs:[8]},{id:"bardInsp",name:"Bardic Insp.",costs:[8]},{id:"wildshape",name:"Wildshape",costs:[30]},{id:"critTemp",name:"Crit TempHP",costs:[15]},{id:"hitDie",name:"Hit Die Upgrade",costs:[10,20,30]},{id:"proneImm",name:"Prone Immune",costs:[10]},{id:"reach",name:"Reach +5ft",costs:[12,24,48]},{id:"cunning",name:"Cunning Action",costs:[10,20,40]},{id:"altStat",name:"Alt Attack Stat",costs:[10]},{id:"unarmored",name:"Unarmored Def",costs:[15]}],
 "Other":[{id:"asi",name:"Ability Score",costs:[5,10,20,40,80]},{id:"max20",name:"Limit Break",costs:[20,40,80]},{id:"saveProf",name:"Save Prof",costs:[5,10,20]},{id:"skillProf",name:"Skill Prof",costs:[4,8,16,32]},{id:"skillExp",name:"Skill Expertise",costs:[8,16,32]},{id:"advSkill",name:"Adv on Skill",costs:[3,6,12]},{id:"advSave",name:"Adv on Save",costs:[3,6,12]},{id:"skillD4",name:"Skill Boost d4",costs:[2,4,8]},{id:"res",name:"Resistance",costs:[12,24,48]},{id:"noEat",name:"No Food/Drink",costs:[8]},{id:"track",name:"Track Enemy after Dmg",costs:[6,12,24]},{id:"dark",name:"Darkvision",costs:[10,20,40]},{id:"tele",name:"Telepathy",costs:[8,16,32]},{id:"truesight",name:"Truesight",costs:[60,120]},{id:"movement",name:"Movement +5ft",costs:[6,12,24]},{id:"strintimidation",name:"Intimidation STR",costs:[5]}]
};

export const ARMOR_WEAPON_PROFS=[{id:"lgt",name:"Light Armor"},{id:"med",name:"Medium Armor"},{id:"hvy",name:"Heavy Armor"},{id:"shl",name:"Shields"},{id:"sim",name:"Simple Weapons"},{id:"mar",name:"Martial Weapons"}];

export const ABILITIES={str:"Strength",dex:"Dexterity",con:"Constitution",int:"Intelligence",wis:"Wisdom",cha:"Charisma"};

export const ABBR={str:"STR",dex:"DEX",con:"CON",int:"INT",wis:"WIS",cha:"CHA"};

export const SKILLS={acr:{l:"Acrobatics",a:"dex"},ani:{l:"Animal Handling",a:"wis"},arc:{l:"Arcana",a:"int"},ath:{l:"Athletics",a:"str"},dec:{l:"Deception",a:"cha"},his:{l:"History",a:"int"},ins:{l:"Insight",a:"wis"},itm:{l:"Intimidation",a:"cha"},inv:{l:"Investigation",a:"int"},med:{l:"Medicine",a:"wis"},nat:{l:"Nature",a:"int"},prc:{l:"Perception",a:"wis"},prf:{l:"Performance",a:"cha"},per:{l:"Persuasion",a:"cha"},rel:{l:"Religion",a:"int"},slt:{l:"Sleight of Hand",a:"dex"},ste:{l:"Stealth",a:"dex"},sur:{l:"Survival",a:"wis"}};

export const DAMAGE_TYPES={acid:"Acid",bludgeoning:"Bludgeoning",cold:"Cold",fire:"Fire",force:"Force",lightning:"Lightning",necrotic:"Necrotic",piercing:"Piercing",poison:"Poison",psychic:"Psychic",radiant:"Radiant",slashing:"Slashing",thunder:"Thunder"};

export const CREATURE_TYPES={aberration:"Aberration",beast:"Beast",celestial:"Celestial",construct:"Construct",dragon:"Dragon",elemental:"Elemental",fey:"Fey",fiend:"Fiend",giant:"Giant",humanoid:"Humanoid",monstrosity:"Monstrosity",ooze:"Ooze",plant:"Plant",undead:"Undead"};

export const FIGHT_STYLES={archery:"Archery",defense:"Defense",dueling:"Dueling",gwf:"Great Weapon",protection:"Protection",twf:"Two-Weapon",blind:"Blind Fighting",interception:"Interception",thrown:"Thrown Weapon",unarmed:"Unarmed"};

export const WEAPONS={longsword:"Longsword",dagger:"Dagger",greatsword:"Greatsword",shortsword:"Shortsword",bow:"Shortbow/Longbow",axe:"Battleaxe",other:"Other"};

export const DMG_SHORT={slashing:"slashing",piercing:"piercing",bludgeoning:"bludgeoning",fire:"fire",cold:"cold",acid:"acid",force:"force",lightning:"lightning",necrotic:"necrotic",poison:"poison",psychic:"psychic",radiant:"radiant",thunder:"thunder"};

export const HIT_DICE=[
  {l:"d8",  dice:[8]},
  {l:"d10", dice:[10]},
  {l:"d12", dice:[12]},
  {l:"d6+d8", dice:[6,8]},
  {l:"d6+d10",dice:[6,10]},
  {l:"d6+d12",dice:[6,12]}
];

export const WEP_ABIL={str:"STR",dex:"DEX",con:"CON",int:"INT",wis:"WIS",cha:"CHA",fin:"FIN"};

export const ARMORS={
  none:{l:"No armor",b:10,dex:99,str:0,sd:false},
  padded:{l:"Padded",b:11,dex:99,str:0,sd:true},
  leather:{l:"Leather",b:11,dex:99,str:0,sd:false},
  studded:{l:"Studded leather",b:12,dex:99,str:0,sd:false},
  hide:{l:"Hide",b:12,dex:2,str:0,sd:false},
  chainshirt:{l:"Chain shirt",b:13,dex:2,str:0,sd:false},
  scale:{l:"Scale mail",b:14,dex:2,str:0,sd:true},
  breastplate:{l:"Breastplate",b:14,dex:2,str:0,sd:false},
  halfplate:{l:"Half plate",b:15,dex:2,str:0,sd:true},
  ring:{l:"Ring mail",b:14,dex:0,str:0,sd:true},
  chainmail:{l:"Chain mail",b:16,dex:0,str:13,sd:true},
  splint:{l:"Splint",b:17,dex:0,str:15,sd:true},
  plate:{l:"Plate",b:18,dex:0,str:15,sd:true}
};

export const ELEMENTS={
  erde:{l:"Erde",c:"#8a6a3a"}, eis:{l:"Eis",c:"#7fc4d8"}, chaos:{l:"Chaos",c:"#b04ec0"},
  blut:{l:"Blut",c:"#a02234"}, ordnung:{l:"Ordnung",c:"#4a72b8"}, licht:{l:"Licht",c:"#e8c84a"},
  blitz:{l:"Blitz",c:"#d8a520"}, gaya:{l:"Gaya",c:"#4e9e52"}, erz:{l:"Erz/Machina",c:"#7a8590"},
  energie:{l:"Energie",c:"#38b0a0"}, gift:{l:"Gift",c:"#6faa32"}, heilig:{l:"Heilig",c:"#e0d090"},
  wind:{l:"Wind",c:"#9ccfae"}, wasser:{l:"Wasser",c:"#3a86c8"}, schoepfung:{l:"Schöpfung",c:"#c9a24a"},
  zerstoerung:{l:"Zerstörung",c:"#9a3a20"}, dunkelheit:{l:"Dunkelheit",c:"#4a3a5a"}, feuer:{l:"Feuer",c:"#d85a28"},
  turm:{l:"Turm",c:"#8f7a5a"}, arch:{l:"Arch",c:"#c04a7a"}
};

export const RECHARGE={long:"Long rest",short:"Short rest",dawn:"Dawn",none:"Never"};

export const FEAT_EXTRA={ac:"AC",speed:"Speed",hp:"Max HP",init:"Initiative"};

export const TOWER_CARRY_LIMIT=5;
export const CRYSTAL_LIMIT=5;

/* Currency sets per mode (labels as shown in the app) */
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

/**
 * AP-Turm rule formulas.
 *
 * Pure functions, no Foundry dependency, so they can be tested in Node against the HTML app
 * (test/rules.test.mjs). Every function takes the app-shaped state `S` (see DEFAULTS() in
 * ap-character-sheet.html) instead of reading a global. Bodies are copied from the app; only the
 * `S` parameter and imports were added.
 */
import { SHOP_DATA, PREREQS, ABILITIES, SKILLS, HIT_DICE, ARMORS, ABBR, findShopItem } from "./config.mjs";

/* ---------- Data version / spell rule (app DATA_VERSION, migrateSpellRule) ---------- */
/** App data version: 5 = spell rule with spellslotN as the spell purchase and learnN as "Extra Spell". */
export const DATA_VERSION=5;
/** The app's migrateSpellRule() as a pure function: for every rank with learnN >= 1 the first learnN becomes a
 *  spellslotN purchase. Returns {bought, converted (ranks), delta (AP balance change = spent before - spent after)}. */
export function convertSpellPurchases(boughtIn){
  const bought={...(boughtIn||{})};const before=computeSpent({bought});const converted=[];
  for(let L=1;L<=9;L++){const k="learn"+L;if((bought[k]||0)>=1){bought["spellslot"+L]=(bought["spellslot"+L]||0)+1;bought[k]-=1;if(!bought[k])delete bought[k];converted.push(L);}}
  return {bought,converted,delta:before-computeSpent({bought})};
}
/** Text of the one-time notice (same wording as the app). */
export function spellRuleNotice(delta){return `Spellcasting rule change: your purchases were converted. AP balance changed by ${delta>0?"+":""}${delta}. Please settle with your GM.`;}

/* ---------- AP / Shop ---------- */
export function findItem(id){return findShopItem(id);}
export function costOfRank(item,k){const mult=item.mult!==undefined?item.mult:2;if(k<item.costs.length)return item.costs[k];return item.costs[item.costs.length-1]*mult;}
export function totalSpentForItem(item,count){let s=0;for(let k=0;k<count;k++)s+=costOfRank(item,k);return s;}
export function computeSpent(S){let t=0;for(const id in S.bought){const it=findItem(id);if(it)t+=totalSpentForItem(it,S.bought[id]||0);}return t;}
export function totalAp(S){return (Number(S.startAp)||0)+(Number(S.earnedAp)||0);}
export function availableAp(S){return totalAp(S)-computeSpent(S);}
export function isMaxed(item,count){if(item.maxRanks)return count>=item.maxRanks;return item.costs.length===1&&count>=1&&item.mult!==1;}   // maxRanks: custom entries only
/** Prerequisites of an entry as a list (built-in entries have one id, custom entries may have several). */
export function prereqList(id){const req=PREREQS[id];return !req?[]:(Array.isArray(req)?req:[req]);}
export function isLocked(S,id){return prereqList(id).some(r=>(S.bought[r]||0)===0);}

/** Shop card state for one entry, as the app's renderShop() computes it. */
export function shopStatus(S,item){
  const count=S.bought[item.id]||0,locked=isLocked(S,item.id),maxed=isMaxed(item,count),next=costOfRank(item,count);
  const canAfford=availableAp(S)>=next,canBuy=!locked&&!maxed&&canAfford;
  return {count,locked,maxed,next,canAfford,canBuy};
}
/** App's cascadeUnlock(): drop purchases whose prerequisite is gone. Returns new {bought, choices}. */
export function cascadeUnlock(boughtIn,choicesIn){
  const bought={...boughtIn},choices={...choicesIn};
  let changed=true;while(changed){changed=false;for(const dep in PREREQS){if(prereqList(dep).some(req=>(bought[req]||0)===0)&&(bought[dep]||0)>0){delete bought[dep];if(choices[dep])delete choices[dep];changed=true;}}}
  return {bought,choices};
}
/** App's sell(): new {bought, choices} after selling one rank (null if nothing to sell). */
export function sellRank(S,id){
  const count=S.bought[id]||0;if(count<=0)return null;
  const bought={...S.bought},choices={...S.choices};
  bought[id]=count-1;
  if(choices[id]&&choices[id].length){choices[id]=choices[id].slice(0,-1);}
  if(bought[id]===0)delete bought[id];
  return cascadeUnlock(bought,choices);
}
/** App's setAbility() clamp: point-buy 6-18, total <= 72. */
export function clampAbility(abilities,k,val){
  val=Math.round(val);if(isNaN(val))val=10;if(val<6)val=6;if(val>18)val=18;
  const others=Object.keys(abilities).filter(x=>x!==k).reduce((a,x)=>a+abilities[x],0);
  if(others+val>72){val=72-others;if(val<6)return {ok:false,value:abilities[k]};}
  return {ok:true,value:val};
}
/** App's toggleSkill(). */
export function skillsAfterToggle(skills,k,on){
  if(on){return skills.includes(k)?[...skills]:[...skills,k];}
  return skills.filter(x=>x!==k);
}
/** App's toggleProf(): removing a prerequisite also removes dependents. */
export function profsAfterToggle(profs,id,on){
  let p=[...profs];
  if(on){if(!p.includes(id))p.push(id);}
  else{p=p.filter(x=>x!==id);if(id==="lgt")p=p.filter(x=>x!=="med"&&x!=="hvy");if(id==="med")p=p.filter(x=>x!=="hvy");if(id==="sim")p=p.filter(x=>x!=="mar");}
  return p;
}
/** Hit-die roll formula for Foundry: every component die rerolls 1s (app: do..while r===1). */
export function hitDieFormula(S){return hitDie(S).dice.map(d=>`1d${d}rr1`).join(" + ");}

/* ---------- Elemental damage (eleDmg): element chosen at purchase, changeEle swaps it ----------
 * choices.eleDmg[] holds one pick per rank, choices.changeEle[] one per swap; the last swap wins,
 * otherwise the last eleDmg pick. Old data without a pick yields "" (roll +1d6 without element,
 * the sheet shows "Choose element"). Reference: eleElem in renderOverview() of the app (v09-05k). */
export function eleElement(S){
  const swaps=S.choices?.changeEle||[], picks=S.choices?.eleDmg||[];
  const last=(a)=>a.length?String(a[a.length-1]||""):"";
  return last(swaps)||last(picks)||"";
}

/* ---------- Rests: what each rest resets (the rest methods of the character and the rules journal read this) ----------
 * items: gear with charges whose recharge is listed gets its used charges back. */
export const REST_RULES={
  short:{
    items:["short"],
    resets:["Items that recharge on a short rest","Custom resource pools that reset on a short rest","Spell slot counters, only with Warlock Casting"],
    note:"Hit Dice are spent by hand (pips on the sheet)."
  },
  long:{
    items:["long","dawn","short"],
    resets:["Spell points used","Lay on Hands used","Spent Hit Dice","Death saves (successes and failures)","HP back to maximum","Rank 6-9 cast counters (spell slots used)","All custom resource pools","Items that recharge on a long rest, at dawn or on a short rest"]
  }
};

/* ---------- Lay on Hands: pool = earned AP / 5, reset on a long rest ---------- */
export function layPool(earned){return Math.max(1,Math.floor((Number(earned)||0)/5));}

/* ---------- Hit-die ladder: base d8, each "hitDie" purchase steps up ---------- */
export function hitDie(S){const n=Math.min(S.bought.hitDie||0,HIT_DICE.length-1);return HIT_DICE[n];}
export function hitDieMax(S){return hitDie(S).dice.reduce((a,b)=>a+b,0);}

/* ---------- Feats: sum of all feat bonuses {str..cha, ac, speed, hp, init} ---------- */
/* ---------- Items with effects (1.3.0) ----------
   An item works only while equipped and, if it requires attunement, attuned. effects (all optional, missing = none):
   bon {str..cha, ac, speed, hp, init, atk, dmg, spellDC, spellPoints}, saveBon {str..cha}, skillBon {<skill>},
   prof {skills, saves} (proficiency, not counted against the limit of 6, never stacks), adv / dis {skills, saves,
   attack, init, death}, res / imm / vuln [type keys], senses, note. Summed like feats (featBonuses). */
export const ITEM_BON={str:"STR",dex:"DEX",con:"CON",int:"INT",wis:"WIS",cha:"CHA",ac:"AC",speed:"Speed",hp:"Max HP",init:"Initiative",atk:"Attack",dmg:"Damage",spellDC:"Spell DC/Attack",spellPoints:"Spell Points"};
export const ITEM_ROLLS=["attack","init","death"];
export function itemActive(it){return !!(it&&it.equipped&&(!it.attunement||it.attuned));}
/* effects without defaults (zero bonuses, empty lists, false flags): the shape that is stored and exported */
export function compactEffects(e){
  e=e||{};const out={};const num=(o,keys)=>{const r={};for(const k of keys){const v=parseInt((o||{})[k]);if(v)r[k]=v;}return Object.keys(r).length?r:null;};
  const list=(a)=>Array.isArray(a)?[...new Set(a.map(String).filter(Boolean))]:[];
  const b=num(e.bon,Object.keys(ITEM_BON));if(b)out.bon=b;
  const sb=num(e.saveBon,Object.keys(ABILITIES));if(sb)out.saveBon=sb;
  const kb=num(e.skillBon,Object.keys(SKILLS));if(kb)out.skillBon=kb;
  const pr={};const ps=list((e.prof||{}).skills).filter(k=>SKILLS[k]),pv=list((e.prof||{}).saves).filter(a=>ABILITIES[a]);if(ps.length)pr.skills=ps;if(pv.length)pr.saves=pv;if(Object.keys(pr).length)out.prof=pr;
  for(const kind of ["adv","dis"]){const x=e[kind]||{};const r={};const sk=list(x.skills).filter(k=>SKILLS[k]),sv=list(x.saves).filter(a=>ABILITIES[a]);if(sk.length)r.skills=sk;if(sv.length)r.saves=sv;for(const f of ITEM_ROLLS)if(x[f])r[f]=true;if(Object.keys(r).length)out[kind]=r;}
  for(const kind of ["res","imm","vuln"]){const l=list(e[kind]);if(l.length)out[kind]=l;}
  for(const kind of ["senses","note"]){const t=String(e[kind]||"").trim();if(t)out[kind]=t;}
  return Object.keys(out).length?out:null;
}
/* effects of all active items: sums, proficiencies, advantage/disadvantage sources, defenses, texts */
export function itemEffects(items){
  const fx={bon:{},src:{},saveBon:{},skillBon:{},profSkills:[],profSaves:[],adv:{skills:{},saves:{},attack:[],init:[],death:[]},dis:{skills:{},saves:{},attack:[],init:[],death:[]},res:[],imm:[],vuln:[],senses:[],notes:[]};
  (items||[]).forEach(it=>{
    if(!itemActive(it))return;
    const e=compactEffects(it.effects);if(!e)return;const nm=it.name||"Item";
    for(const k in (e.bon||{})){fx.bon[k]=(fx.bon[k]||0)+e.bon[k];(fx.src[k]=fx.src[k]||[]).push({name:nm,v:e.bon[k]});}
    for(const a in (e.saveBon||{}))fx.saveBon[a]=(fx.saveBon[a]||0)+e.saveBon[a];
    for(const k in (e.skillBon||{}))fx.skillBon[k]=(fx.skillBon[k]||0)+e.skillBon[k];
    ((e.prof||{}).skills||[]).forEach(k=>{if(!fx.profSkills.includes(k))fx.profSkills.push(k);});
    ((e.prof||{}).saves||[]).forEach(a=>{if(!fx.profSaves.includes(a))fx.profSaves.push(a);});
    for(const kind of ["adv","dis"]){const x=e[kind]||{};(x.skills||[]).forEach(k=>(fx[kind].skills[k]=fx[kind].skills[k]||[]).push(nm));(x.saves||[]).forEach(a=>(fx[kind].saves[a]=fx[kind].saves[a]||[]).push(nm));for(const f of ITEM_ROLLS)if(x[f])fx[kind][f].push(nm);}
    for(const kind of ["res","imm","vuln"])(e[kind]||[]).forEach(k=>fx[kind].push({key:k,src:nm}));
    if(e.senses)fx.senses.push({src:nm,text:e.senses});
    if(e.note)fx.notes.push({src:nm,text:e.note});
  });
  return fx;
}
/** Full effects shape (data model / sheet) from the compact app shape; unknown keys dropped. */
export function expandEffects(e){
  const c=compactEffects(e)||{};
  const nums=(o,keys)=>Object.fromEntries(keys.map(k=>[k,Number(o?.[k])||0]));
  const rollFx=(x)=>({skills:[...(x?.skills||[])],saves:[...(x?.saves||[])],attack:!!x?.attack,init:!!x?.init,death:!!x?.death});
  return {
    bon:nums(c.bon,Object.keys(ITEM_BON)), saveBon:nums(c.saveBon,Object.keys(ABILITIES)), skillBon:{...(c.skillBon||{})},
    prof:{skills:[...(c.prof?.skills||[])],saves:[...(c.prof?.saves||[])]}, adv:rollFx(c.adv), dis:rollFx(c.dis),
    res:[...(c.res||[])], imm:[...(c.imm||[])], vuln:[...(c.vuln||[])], senses:c.senses||"", note:c.note||""
  };
}
export function featBonuses(feats,items){
  const t={str:0,dex:0,con:0,int:0,wis:0,cha:0,ac:0,speed:0,hp:0,init:0,atk:0,dmg:0,spellDC:0,spellPoints:0};
  (feats||[]).forEach(f=>{const b=f.bon||{};for(const k in t){const v=parseInt(b[k]);if(v)t[k]+=v;}});
  const ib=itemEffects(items).bon;for(const k in ib)if(k in t)t[k]+=ib[k];   /* active items, summed like feats */
  return t;
}
/* tooltip of a final ability score: "18 = 16 + 2 Gauntlets of Ogre Power" (cap noted when it bites) */
export function abilityBreakdown(S,k,d){
  const parts=[];const fbF=(S.feats||[]).reduce((a,f)=>a+(parseInt((f.bon||{})[k])||0),0);if(fbF)parts.push([fbF,"Feats"]);
  ((d.itemFx.src||{})[k]||[]).forEach(x=>parts.push([x.v,x.name]));
  const asi=(S.choices.asi||[]).filter(a=>a===k).length;if(asi)parts.push([asi,"Ability Score"]);
  let ms=0;for(const i in S.milestones){const m=S.milestones[i];if(m&&m.type==="asi"&&m.stats)ms+=(m.stats[k]||0);}if(ms)parts.push([ms,"Milestones"]);
  const base=S.abilities[k];const sum=base+parts.reduce((a,p)=>a+p[0],0);
  return `${d.fin[k]} = ${base}${parts.map(([v,n])=>` ${v<0?"-":"+"} ${Math.abs(v)} ${n}`).join("")}${sum>d.fin[k]?` (cap ${d.maxCap[k]})`:""}`;
}


/* ---------- Weapons ---------- */
export function weaponStats(w,d){
  let abK=w.abil;
  if(w.abil==="fin") abK=(d.mods.dex>=d.mods.str)?"dex":"str";
  const am=d.mods[abK]||0;
  const bonus=Number(w.bonus)||0;
  const atk=am+(w.prof?d.pb:0)+bonus+(d.exhPen||0)+((d.fb&&d.fb.atk)||0);
  const dmgMod=am+bonus+((d.fb&&d.fb.dmg)||0);
  const dmg=(w.dice||"")+(dmgMod?fmtMod(dmgMod):"");
  return {abK,atk,dmg,dmgMod};
}

/* ---------- Derived ---------- */
export function mod(s){return Math.floor((s-10)/2);}
export function fmtMod(m){return (m>=0?"+":"")+m;}
export function derived(S){
  const earned=Number(S.earnedAp)||0;
  const level=Math.max(1,Math.floor(earned/10)+1);
  const pb=2+Math.floor(earned/75);
  const numMilestones=Math.floor(earned/75);
  const cantripTier=1+Math.floor(earned/100);
  const bonusStatPoints=numMilestones*2;
  const fb=featBonuses(S.feats,S.items);
  const fin={...S.abilities};
  for(const a in ABILITIES) if(fb[a]) fin[a]+=fb[a];
  (S.choices.asi||[]).forEach(ab=>{if(fin[ab]!==undefined)fin[ab]+=1;});
  for(const i in S.milestones){const m=S.milestones[i];if(m&&m.type==="asi"&&m.stats){for(const ab in m.stats)if(fin[ab]!==undefined)fin[ab]+=(m.stats[ab]||0);}}
  const maxCap={str:20,dex:20,con:20,int:20,wis:20,cha:20};(S.choices.max20||[]).forEach(ab=>{if(maxCap[ab]!==undefined)maxCap[ab]+=2;});
  for(const a in fin)if(maxCap[a]!==undefined)fin[a]=Math.min(fin[a],maxCap[a]);   // final score cap 20 (+2 per max20 purchase)
  const mods={};for(const a in fin)mods[a]=mod(fin[a]);
  const exh=Math.max(0,Math.min(6,parseInt(S.play.exhaustion)||0));
  const exhPen=-2*exh;                         // 2024 rules: -2 per level on d20 Tests
  let walk=Math.max(0,30+(S.bought.movement||0)*5+fb.speed-5*exh);  // -5 ft per level
  // only the rolls of the levels actually reached count (app v09-05m); rolls above the current level
  // stay stored, so the same roll applies again when the level comes back
  const hpSum=(S.hpRolls||[]).slice(0,level).reduce((a,b)=>a+(Number(b)||0),0);
  const hpMax=hpSum+level*mods.con+fb.hp;
  const arm=ARMORS[(S.armor&&S.armor.id)||"none"]||ARMORS.none;
  const armWorn=arm!==ARMORS.none;
  const shield=!!(S.armor&&S.armor.shield);
  let ac,acNote;
  if(armWorn){
    ac=arm.b+Math.max(0,Math.min(mods.dex,arm.dex))+fb.ac;
    acNote=arm.l;
  }else{
    const unCh=(S.choices.unarmored||[])[0];
    if(unCh){ac=10+mods.dex+mods[unCh]+fb.ac;acNote="Unarmored Def ("+ABBR[unCh]+")";}
    else{ac=10+mods.dex+fb.ac;acNote="unarmored";}
  }
  if(shield){ac+=2;acNote+=" + shield";}
  const armStrLack=armWorn&&arm.str>0&&fin.str<arm.str;
  if(armStrLack)walk=Math.max(0,walk-10);
  if((S.bought.fightStyle||0)>0&&(S.choices.fightStyle||[]).includes("defense")&&armWorn)ac+=1;
  const ifx=itemEffects(S.items);
  const profSaves=new Set([...(S.choices.saveProf||[]),...ifx.profSaves]);
  const skillProfSet=new Set([...(S.selectedSkills||[]),...(S.choices.skillProf||[]),...ifx.profSkills]);
  const skillExpSet=new Set(S.choices.skillExp||[]);
  const strIntim=(S.bought.strintimidation||0)>0;
  const skillData={};for(const k in SKILLS){let abK=SKILLS[k].a;if(k==="itm"&&strIntim)abK="str";const prof=skillProfSet.has(k),exp=skillExpSet.has(k);skillData[k]={prof,exp,mod:mods[abK]+(exp?pb*2:(prof?pb:0))+exhPen+(ifx.skillBon[k]||0),adv:ifx.adv.skills[k]||[],dis:ifx.dis.skills[k]||[]};}
  const saveData={};for(const a in ABILITIES){const prof=profSaves.has(a);saveData[a]={prof,mod:mods[a]+(prof?pb:0)+exhPen+(ifx.saveBon[a]||0),adv:ifx.adv.saves[a]||[],dis:ifx.dis.saves[a]||[]};}
  const init=mods.dex+fb.init+exhPen;
  const passivePerc=10+skillData.prc.mod;
  /* Spell purchases (v5): spellslotN = the spell purchase (casting rank N, one known spell, a slot; Turm: N points per slot).
     learnN = "Extra Spell": one more known spell of rank N only. Mode ap: slots of rank N = spellslotN. */
  const slots=[];for(let L=1;L<=9;L++){const tot=S.bought["spellslot"+L]||0;if(tot>0)slots.push({L,total:tot,extra:S.bought["learn"+L]||0});}
  /* Turm: spell points = sum of rank x spellslot purchases of that rank; max rank = highest rank with a spellslot */
  let spTotal=0, spMaxRank=0, spBreak=[];
  for(let L=1;L<=9;L++){
    const units=S.bought["spellslot"+L]||0;
    if(units){ spMaxRank=Math.max(spMaxRank,L); spTotal+=L*units; spBreak.push({L,units,pts:L*units}); }
  }
  /* known spells per rank = spellslotN + learnN; have = spells of that rank on the sheet */
  const known=[];for(let L=1;L<=9;L++){const max=(S.bought["spellslot"+L]||0)+(S.bought["learn"+L]||0);const have=(S.spells||[]).filter(sp=>(parseInt(sp.lvl)||0)===L).length;if(max>0||have>0)known.push({L,max,have,over:have>max});}
  spTotal+=fb.spellPoints;   /* items: + spell points (Turm pool) */
  const spUsed=Math.max(0,Math.min(parseInt(S.spUsed)||0,spTotal));
  const spLeft=spTotal-spUsed;
  const spellMod=Math.max(mods.cha,mods.wis,mods.int);
  const spellDC=8+pb+spellMod+(S.bought.spellDC||0)+fb.spellDC;
  const spellAtk=pb+spellMod+(S.bought.spellDC||0)+exhPen+fb.spellDC;
  const atkBonus=Math.max(mods.str,mods.dex)+pb+(S.bought.wepPlus1||0)+exhPen+fb.atk;
  return {earned,level,pb,numMilestones,cantripTier,bonusStatPoints,fin,mods,maxCap,walk,hpSum,hpMax,ac,acNote,profSaves,skillProfSet,skillExpSet,strIntim,skillData,saveData,init,passivePerc,slots,known,spellMod,spellDC,spellAtk,atkBonus,exh,exhPen,fb,spTotal,spUsed,spLeft,spMaxRank,spBreak,arm,armWorn,shield,armStrLack,itemFx:ifx};
}

/* ============================================================
   Bridge: Foundry system data + embedded items  ->  app state S
   ============================================================ */

/**
 * Build the app-shaped state from a character's system data and its embedded items.
 * `system` may be the live TypeDataModel or a plain object with the same shape; `items` is an
 * iterable of objects with `{type, name, system}` (Item documents or plain data).
 */
export function stateFromSystem(system, items){
  const list=[...(items||[])];
  const pick=(type)=>list.filter(i=>i.type===type);
  const num=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d;};
  return {
    mode: system.mode||"turm",
    startAp: num(system.ap?.start),
    earnedAp: num(system.ap?.earned),
    abilities: {...system.abilities},
    bought: {...(system.bought||{})},
    choices: {...(system.choices||{})},
    milestones: {...(system.milestones||{})},
    selectedSkills: [...(system.skills||[])],
    selectedProfs: [...(system.profs||[])],
    customProfs: [...(system.customProfs||[])],
    hpRolls: [...(system.hp?.rolls||[])],
    play: {
      hpCurrent: system.hp?.value ?? null,
      tempHp: num(system.hp?.temp),
      spentHitDice: num(system.play?.spentHitDice),
      deathSucc: num(system.play?.deathSucc),
      deathFail: num(system.play?.deathFail),
      inspiration: num(system.play?.inspiration),
      inspMax: num(system.play?.inspMax,5),
      exhaustion: num(system.play?.exhaustion)
    },
    spUsed: num(system.resources?.spUsed),
    layUsed: num(system.resources?.layUsed),
    slotsUsed: {...(system.resources?.slotsUsed||{})},
    armor: {id: system.armor?.id||"none", shield: !!system.armor?.shield},
    currency: {...(system.currency||{})},
    crystals: (system.crystals||[]).map(c=>({name:c.name||"",elem:c.elem||""})),
    turmwissen: (system.turmwissen||[]).map(t=>({trigger:t.trigger||""})),
    identity: {...(system.identity||{})},
    notes: system.notes||"",
    weapons: pick("weapon").map(i=>({id:i.id,name:i.name,...i.system})),
    spells: pick("spell").map(i=>({id:i.id,name:i.name,...i.system})),
    feats: pick("feat").map(i=>({id:i.id,name:i.name,...i.system})),
    items: pick("gear").map(i=>({id:i.id,name:i.name,...i.system}))
  };
}

/**
 * Character sheet (Phase 2): tabs Overview / Attributes & Skills / Shop / Level & Milestones / Inventory.
 * Header and combat strip stay visible on every tab. All edits go through actor.update() (form
 * submitOnChange) or the CharacterData mutation methods (data-action handlers).
 */
import { ABILITIES, ABBR, SKILLS, ELEMENTS, DAMAGE_TYPES, DMG_SHORT, CURRENCIES, ARMOR_WEAPON_PROFS, SHOP_DATA, SELECTORS,
  PREREQS, CREATURE_TYPES, FIGHT_STYLES, WEAPONS, ARMORS, CRYSTAL_LIMIT, TOWER_CARRY_LIMIT, WEP_ABIL, FEAT_EXTRA,
  findShopItem, damageTypeChoices, damageTypeLabel, damageTypeColor } from "../config.mjs";
import { weaponStats, fmtMod, availableAp, totalAp, computeSpent, shopStatus, hitDieMax, eleElement } from "../rules.mjs";
import { importAppJSONIntoActor } from "../importer.mjs";
import { downloadActorExport } from "../exporter.mjs";
import { rollAttack, rollDamage, rollCheck, rollInitiative, castSpell, rollHitDie, rollDeathSave, applyHpDelta } from "../chat.mjs";
import { SheetSizeMixin } from "./sizing.mjs";
import { chipClick, addConditionMenu, chipContext } from "./condition-chips.mjs";
import { guardWrites } from "./guard.mjs";
import { giveItemDialog, carryCount } from "../transfer.mjs";
import { saveToLibrary, fromLibraryDialog } from "../library.mjs";
import { spellFromLibraryDialog } from "../libraries5e.mjs";
import { historyText, HISTORY_CAP } from "../qol.mjs";
import { customEntry } from "../custom-shop.mjs";
import { prereqList } from "../rules.mjs";
import { openShopEditor } from "../shop-editor.mjs";
import { rollPlainD20 } from "../dice-tray.mjs";

/** Right mouse button (click with button 2 or a contextmenu event). */
const isRightClick = (ev) => ev?.button === 2 || ev?.type === "contextmenu";
/** Roll actions accept left and right click (right = dialog with situational bonus). */
const roll = (handler) => ({ handler, buttons: [0, 2] });

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const { DialogV2 } = foundry.applications.api;

function labelFor(id, t) {
  const ty = SELECTORS[id]?.type;
  if (ty === "ability") return ABBR[t] || t;
  if (ty === "save") return ABBR[t] ? `${ABBR[t]} save` : t;
  if (ty === "skill") return SKILLS[t]?.l || t;
  if (ty === "damage") return damageTypeLabel(t) || t;   // both tables: values from the other mode stay readable
  if (ty === "creature") return CREATURE_TYPES[t] || t;
  if (ty === "fightStyle") return FIGHT_STYLES[t] || t;
  if (ty === "weapon") return WEAPONS[t] || t;
  return t;
}
function optionsFor(type, mode) {
  if (type === "ability" || type === "save") return ABILITIES;
  if (type === "skill") { const o = {}; Object.keys(SKILLS).forEach(k => o[k] = SKILLS[k].l); return o; }
  if (type === "damage") return damageTypeChoices(mode);   // ap: D&D damage types, turm: the 20 elements
  if (type === "creature") return CREATURE_TYPES;
  if (type === "fightStyle") return FIGHT_STYLES;
  if (type === "weapon") return WEAPONS;
  return {};
}
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const TPL = "systems/ap-turm/templates/actor/character/";

/**
 * Portrait click on an actor sheet: left = ImagePopout (the picture large, shareable by the GM), right-click by
 * an owner = the core image picker ("editImage"). Shared by character and NPC sheet.
 */
export function portraitClick(sheet, ev, target) {
  const actor = sheet.document;
  if (ev?.button === 2 || ev?.type === "contextmenu") {
    ev.preventDefault?.();
    if (!sheet.isEditable) return null;
    const edit = sheet.options.actions?.editImage;
    const fn = typeof edit === "function" ? edit : edit?.handler;
    return fn?.call(sheet, ev, target);
  }
  const { ImagePopout } = foundry.applications.apps;
  return new ImagePopout({ src: actor.img, uuid: actor.uuid, window: { title: actor.name } }).render({ force: true });
}

export class ApTurmCharacterSheet extends SheetSizeMixin(HandlebarsApplicationMixin(ActorSheetV2), "character") {

  static DEFAULT_OPTIONS = {
    classes: ["ap-turm", "sheet", "actor", "character"],
    position: { width: 900, height: 860 },
    window: {
      resizable: true,
      controls: [
        { action: "importAppJson", icon: "fa-solid fa-file-import", label: "AP_TURM.Import.SheetControl", ownership: "OWNER" },
        { action: "exportAppJson", icon: "fa-solid fa-file-export", label: "AP_TURM.Export.SheetControl", ownership: "OWNER" }
      ]
    },
    form: { submitOnChange: true, closeOnSubmit: false },
    // every action writes to the actor unless it is listed as read-only below
    actions: guardWrites({
      rollD20: ApTurmCharacterSheet.#onRollD20,
      importAppJson: ApTurmCharacterSheet.#onImportAppJson,
      exportAppJson: ApTurmCharacterSheet.#onExportAppJson,
      deathSave: roll(ApTurmCharacterSheet.#onDeathSave),
      hpAdjust: ApTurmCharacterSheet.#onHpAdjust,
      rollHitDie: ApTurmCharacterSheet.#onRollHitDie,
      exhaustion: ApTurmCharacterSheet.#onExhaustion,
      conditionChip: { handler: ApTurmCharacterSheet.#onConditionChip, buttons: [0, 2] },
      conditionAdd: ApTurmCharacterSheet.#onConditionAdd,
      inspiration: ApTurmCharacterSheet.#onInspiration,
      hitDiePip: roll(ApTurmCharacterSheet.#onHitDiePip),
      spellPointPip: ApTurmCharacterSheet.#onSpellPointPip,
      spAdjust: ApTurmCharacterSheet.#onSpAdjust,
      slotPip: ApTurmCharacterSheet.#onSlotPip,
      layAdjust: ApTurmCharacterSheet.#onLayAdjust,
      poolAdjust: ApTurmCharacterSheet.#onPoolAdjust,
      openShopEditor: ApTurmCharacterSheet.#onOpenShopEditor,
      portrait: { handler: ApTurmCharacterSheet.#onPortrait, buttons: [0, 2] },
      shortRest: ApTurmCharacterSheet.#onShortRest,
      longRest: ApTurmCharacterSheet.#onLongRest,
      createItem: ApTurmCharacterSheet.#onCreateItem,
      editItem: ApTurmCharacterSheet.#onEditItem,
      deleteItem: ApTurmCharacterSheet.#onDeleteItem,
      toggleEquipped: ApTurmCharacterSheet.#onToggleEquipped,
      toggleWeaponProf: ApTurmCharacterSheet.#onToggleWeaponProf,
      cycleWeaponAbility: ApTurmCharacterSheet.#onCycleWeaponAbility,
      gearCharge: ApTurmCharacterSheet.#onGearCharge,
      giveItem: ApTurmCharacterSheet.#onGiveItem,
      saveToLibrary: ApTurmCharacterSheet.#onSaveToLibrary,
      fromLibrary: ApTurmCharacterSheet.#onFromLibrary,
      spellFromLibrary: ApTurmCharacterSheet.#onSpellFromLibrary,
      abilityStep: ApTurmCharacterSheet.#onAbilityStep,
      toggleSkill: ApTurmCharacterSheet.#onToggleSkill,
      toggleProf: ApTurmCharacterSheet.#onToggleProf,
      addProf: ApTurmCharacterSheet.#onAddProf,
      removeProf: ApTurmCharacterSheet.#onRemoveProf,
      shopCategory: ApTurmCharacterSheet.#onShopCategory,
      buy: ApTurmCharacterSheet.#onBuy,
      sell: ApTurmCharacterSheet.#onSell,
      rollHp: ApTurmCharacterSheet.#onRollHp,
      milestoneStats: ApTurmCharacterSheet.#onMilestoneStats,
      milestoneFeat: ApTurmCharacterSheet.#onMilestoneFeat,
      milestoneReset: ApTurmCharacterSheet.#onMilestoneReset,
      addTurmwissen: ApTurmCharacterSheet.#onAddTurmwissen,
      removeTurmwissen: ApTurmCharacterSheet.#onRemoveTurmwissen,
      rollAttack: roll(ApTurmCharacterSheet.#onRollAttack),
      rollDamage: roll(ApTurmCharacterSheet.#onRollDamage),
      rollSave: roll(ApTurmCharacterSheet.#onRollSave),
      rollSkill: roll(ApTurmCharacterSheet.#onRollSkill),
      rollAbility: roll(ApTurmCharacterSheet.#onRollAbility),
      rollInitiative: roll(ApTurmCharacterSheet.#onRollInitiative),
      castSpell: ApTurmCharacterSheet.#onCastSpell
    }, ["rollD20", "exportAppJson", "shopCategory", "editItem", "saveToLibrary", "openShopEditor", "portrait", "rollAttack", "rollDamage", "rollSave", "rollSkill", "rollAbility", "rollInitiative"])
  };

  static PARTS = {
    header: { template: TPL + "header.hbs" },
    strip: { template: TPL + "strip.hbs", templates: [TPL + "resources.hbs", "systems/ap-turm/templates/actor/conditions.hbs"] },
    tabs: { template: TPL + "tabs.hbs" },
    overview: { template: TPL + "overview.hbs", scrollable: [""] },
    attributes: { template: TPL + "attributes.hbs", scrollable: [""] },
    shop: { template: TPL + "shop.hbs", scrollable: [""] },
    level: { template: TPL + "level.hbs", scrollable: [""] },
    inventory: { template: TPL + "inventory.hbs", templates: [TPL + "gear-row.hbs"], scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "overview", label: "Overview" },
        { id: "attributes", label: "Attributes & Skills" },
        { id: "shop", label: "Shop" },
        { id: "level", label: "Level & Milestones" },
        { id: "inventory", label: "Inventory" }
      ],
      initial: "overview"
    }
  };

  /** Active shop category index (sheet-local UI state, like the app's activeShopCat). */
  #shopCat = 0;

  /** Inline item edits pulled out of the form data (items.<id>.name ...). */
  #pendingItemUpdates = null;

  /* ---------- context ---------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const d = sys.derived;
    const S = sys.appState;
    const isTurm = S.mode === "turm";
    const editable = this.isEditable;

    /* header / strip */
    const identity = sys.identity;
    const ap = { start: S.startAp, earned: S.earnedAp, spent: computeSpent(S), avail: availableAp(S), total: totalAp(S) };
    const deathSucc = [1, 2, 3].map(i => ({ i, on: S.play.deathSucc >= i }));
    const deathFail = [1, 2, 3].map(i => ({ i, on: S.play.deathFail >= i }));
    const exhaustion = [1, 2, 3, 4, 5, 6].map(i => ({ i, on: S.play.exhaustion >= i }));
    const inspN = Math.max(0, S.play.inspiration || 0);
    const inspMax = Math.max(S.play.inspMax || 5, inspN);
    const inspiration = Array.from({ length: inspMax }, (_, i) => ({ i: i + 1, on: i < inspN }));
    const hdSpent = Math.min(S.play.spentHitDice || 0, d.level);
    const hitDicePips = Array.from({ length: d.level }, (_, i) => ({ i: i + 1, used: i < hdSpent }));

    /* overview */
    const abilities = Object.keys(ABILITIES).map(k => ({
      key: k, abbr: ABBR[k], label: ABILITIES[k], base: S.abilities[k], value: d.fin[k], mod: fmtMod(d.mods[k]),
      save: fmtMod(d.saveData[k].mod), saveProf: d.saveData[k].prof
    }));
    const skills = Object.keys(SKILLS).sort((a, b) => SKILLS[a].l.localeCompare(SKILLS[b].l)).map(k => {
      const s = d.skillData[k];
      let abK = SKILLS[k].a; if (k === "itm" && d.strIntim) abK = "str";
      return { key: k, label: SKILLS[k].l, abbr: ABBR[abK], mod: fmtMod(s.mod), prof: s.prof, exp: s.exp };
    });
    // +Nd6 in the chosen element (choices.eleDmg / changeEle); missing pick on old data -> hint
    const eleEl = eleElement(S);
    const eleRanks = S.bought.eleDmg || 0;
    const extraDmg = eleRanks ? ` +${eleRanks}d6${eleEl ? " " + damageTypeLabel(eleEl) : ""}` : "";
    const eleHint = eleRanks && !eleEl;
    const weapons = actor.items.filter(i => i.type === "weapon").sort((a, b) => a.sort - b.sort).map(w => {
      const st = weaponStats(w.system, d);
      const dt = w.system.dtype;
      return {
        id: w.id, name: w.name, equipped: w.system.equipped, prof: w.system.prof, abil: WEP_ABIL[w.system.abil] || w.system.abil,
        atk: fmtMod(st.atk), dmg: st.dmg + extraDmg,
        dtype: damageTypeLabel(dt), dtypeColor: damageTypeColor(dt), notes: w.system.notes
      };
    });
    const spells = actor.items.filter(i => i.type === "spell").sort((a, b) => (a.system.lvl - b.system.lvl) || a.name.localeCompare(b.name)).map(s => ({
      id: s.id, name: s.name, lvl: s.system.lvl === 0 ? "C" : s.system.lvl,
      elem: s.system.elem ? damageTypeLabel(s.system.elem) : "", elemColor: damageTypeColor(s.system.elem), notes: s.system.notes,
      concentration: !!s.system.concentration
    }));
    const feats = actor.items.filter(i => i.type === "feat").sort((a, b) => a.sort - b.sort).map(f => {
      const b = f.system.bon; const out = [];
      for (const k of Object.keys(ABILITIES)) if (b[k]) out.push(fmtMod(b[k]) + " " + ABBR[k]);
      for (const [k, l] of Object.entries(FEAT_EXTRA)) if (b[k]) out.push(fmtMod(b[k]) + " " + l);
      return { id: f.id, name: f.name, desc: f.system.desc, src: f.system.src, bonus: out.join(", ") };
    });
    const seriesLine = (prefix, label) => {
      const lv = []; for (let L = 1; L <= 9; L++) { const n = S.bought[prefix + L] || 0; if (n > 0) lv.push(n > 1 ? `${L}×${n}` : `${L}`); }
      return lv.length ? { name: `${label} Lvl ${lv.join(", ")}`, count: lv.length } : null;
    };
    const purchases = Object.keys(SHOP_DATA).map(cat => {
      const lines = []; let addedLearn = false, addedSlot = false;
      SHOP_DATA[cat].filter(it => (S.bought[it.id] || 0) > 0).forEach(it => {
        if (/^learn\d$/.test(it.id)) { if (!addedLearn) { const l = seriesLine("learn", "Learn Spell"); if (l) lines.push(l); addedLearn = true; } return; }
        if (/^spellslot\d$/.test(it.id)) { if (!addedSlot) { const l = seriesLine("spellslot", "Spellslot"); if (l) lines.push(l); addedSlot = true; } return; }
        const ch = (S.choices[it.id] && S.choices[it.id].length) ? S.choices[it.id].map(t => labelFor(it.id, t)).join(", ") : "";
        const ce = it.custom ? customEntry(it.id) : null;
        const text = ce ? [ce.desc, ...ce.effects.filter(e => e.type === "text").map(e => e.text)].filter(Boolean).join(" · ") : "";
        lines.push({ name: it.name, choices: ch, count: S.bought[it.id], text, custom: !!ce });
      });
      return { cat, lines };
    }).filter(c => c.lines.length);
    const turmwissen = S.turmwissen.map((t, i) => ({ index: i, rank: i + 1, trigger: t.trigger, last: i === S.turmwissen.length - 1 }));
    const spBreak = d.spBreak.map(s => `Rank ${s.L}: ${s.units}×${s.L} = ${s.pts}`).join(" · ");
    const spPips = d.spTotal <= 20 ? Array.from({ length: d.spTotal }, (_, i) => ({ i: i + 1, used: i < d.spUsed })) : null;
    const slotRow = (s) => {
      const used = S.slotsUsed[s.L] || 0;
      return { L: s.L, total: s.total, left: s.total - used, pips: Array.from({ length: s.total }, (_, i) => ({ i: i + 1, used: i < used })) };
    };
    const highRanks = d.slots.filter(s => s.L >= 6).map(slotRow);
    const slots = d.slots.map(slotRow);
    const allProfs = [...new Set([...S.selectedProfs, ...(d.custom?.profs ?? [])])];   // custom shop proficiencies join the list
    const profs = {
      armor: allProfs.filter(x => ["lgt", "med", "hvy", "shl"].includes(x)).map(x => ARMOR_WEAPON_PROFS.find(p => p.id === x)?.name).join(", ") || "—",
      weapons: allProfs.filter(x => ["sim", "mar"].includes(x)).map(x => ARMOR_WEAPON_PROFS.find(p => p.id === x)?.name).join(", ") || "—",
      custom: S.customProfs.length ? S.customProfs.join(", ") : "—"
    };

    /* attributes tab */
    const sum = Object.values(S.abilities).reduce((a, b) => a + b, 0), rem = 72 - sum;
    const abilityEditor = Object.keys(ABILITIES).map(k => {
      const base = S.abilities[k], fin = d.fin[k], bonus = fin - base;
      return { key: k, label: ABILITIES[k], base, fin, mod: fmtMod(d.mods[k]), bonus, minusDisabled: base <= 6, plusDisabled: base >= 18 || rem <= 0 };
    });
    const skillEditor = Object.keys(SKILLS).sort((a, b) => SKILLS[a].l.localeCompare(SKILLS[b].l)).map(k => ({
      key: k, label: SKILLS[k].l, abbr: ABBR[SKILLS[k].a], on: S.selectedSkills.includes(k)
    }));
    const profEditor = ARMOR_WEAPON_PROFS.map(p => {
      const on = S.selectedProfs.includes(p.id), req = PREREQS[p.id], locked = !!(req && !S.selectedProfs.includes(req));
      return { key: p.id, label: p.name, on, locked };
    });
    const customProfs = S.customProfs.map((v, i) => ({ index: i, value: v }));
    const counts = { pb: rem, pbBad: rem < 0, skills: S.selectedSkills.length, skillsBad: S.selectedSkills.length > 6,
      profs: S.selectedProfs.length + S.customProfs.length, profsBad: S.selectedProfs.length + S.customProfs.length > 6 };

    /* shop tab */
    const cats = Object.keys(SHOP_DATA);
    if (this.#shopCat >= cats.length) this.#shopCat = 0;
    const shopNav = cats.map((c, i) => ({ index: i, label: c, active: i === this.#shopCat }));
    const shopCards = SHOP_DATA[cats[this.#shopCat]].slice().sort((a, b) => a.name.localeCompare(b.name)).map(it => {
      const st = shopStatus(S, it);
      let costStr = st.next + " AP", costCls = "";
      if (st.maxed) { costStr = "MAX"; costCls = "max"; }
      else if (st.locked) { costStr = "locked"; costCls = "max"; }
      else if (!st.canAfford) costCls = "no";
      const chosen = (S.choices[it.id] && S.choices[it.id].length) ? S.choices[it.id].map(t => labelFor(it.id, t)).join(", ") : "";
      return { id: it.id, name: it.name, count: st.count, locked: st.locked, canBuy: st.canBuy && editable, canSell: st.count > 0 && editable,
        costStr, costCls, chosen, needs: prereqList(it.id).map(r => findShopItem(r)?.name ?? r).join(" + "),
        desc: it.desc ?? "", custom: !!it.custom };
    });

    /* level tab */
    const hdMax = hitDieMax(S);
    const hpCells = Array.from({ length: Math.max(d.level, S.hpRolls.length) }, (_, i) => ({
      index: i, level: i + 1, value: S.hpRolls[i] || 0, extra: i >= d.level, pending: i < d.level && !S.hpRolls[i]
    }));
    // open point after a level-up: hit die of those levels not rolled yet (one line, levels joined)
    const hpPending = sys.hpPending;
    const hpPendingLabel = hpPending.length ? `Level ${hpPending.join(", ")}: hit die not yet rolled` : "";
    if (context.tabs?.level && hpPending.length) { context.tabs.level.pending = true; context.tabs.level.pendingHint = hpPendingLabel; }
    const milestones = [];
    for (let i = 1; i <= d.numMilestones; i++) {
      const m = S.milestones[i];
      let label = null;
      if (m?.type === "asi") label = "Stats: " + Object.entries(m.stats || {}).filter(([, v]) => v > 0).map(([a, v]) => `+${v} ${ABBR[a]}`).join(", ");
      else if (m?.type === "feat") label = "Feat: " + m.name;
      milestones.push({ index: i, label, chosen: !!m });
    }
    const progress = [["Earned AP", d.earned], ["Level", d.level], ["Proficiency Bonus", "+" + d.pb], ["Cantrip Tier", d.cantripTier],
      ["Milestones", d.numMilestones], ["Bonus Stats", "+" + d.bonusStatPoints]].map(([k, v]) => ({ label: k, value: v }));

    /* inventory tab */
    const gearAll = actor.items.filter(i => i.type === "gear").sort((a, b) => a.sort - b.sort).map(g => ({
      id: g.id, name: g.name, qty: g.system.qty, notes: g.system.notes, attuned: g.system.attuned,
      charges: g.system.charges, left: g.system.charges - g.system.used, origin: g.system.origin,
      pips: Array.from({ length: g.system.charges }, (_, i) => ({ i: i + 1, used: i < (g.system.used || 0) }))
    }));
    const gearCity = gearAll.filter(g => g.origin === "city");
    const gearTower = gearAll.filter(g => g.origin === "tower");   // carryCount() counts exactly these
    const armorOptions = Object.keys(ARMORS).map(k => {
      const a = ARMORS[k];
      const extra = a.b > 10 ? " (AC " + a.b + (a.dex === 99 ? "+Dex" : a.dex === 2 ? "+Dex max2" : "") + ")" : "";
      return { value: k, label: a.l + extra, selected: (S.armor.id || "none") === k };
    });
    const crystals = Array.from({ length: CRYSTAL_LIMIT }, (_, i) => {
      const c = S.crystals[i] || { name: "", elem: "" };
      const el = ELEMENTS[c.elem];
      const placeholder = c.elem ? (el?.l ?? c.elem) + (c.elem === "arch" ? "kristall" : "-Kristall") : "Empty socket";
      return { index: i, name: c.name, elem: c.elem, color: el?.c ?? "", set: !!(c.name || c.elem), placeholder,
        options: [{ value: "", label: "— none —", selected: !c.elem }, ...Object.keys(ELEMENTS).map(k => ({ value: k, label: ELEMENTS[k].l, selected: c.elem === k }))] };
    });
    const currency = CURRENCIES[isTurm ? "turm" : "ap"].map(([k, l, t]) => ({ key: k, label: l, title: t, value: S.currency[k] || 0 }));

    return Object.assign(context, {
      actor, system: sys, fields: sys.schema.fields, d, S, isTurm, editable,
      name: actor.name, img: actor.img, identity, ap,
      modeOptions: [{ value: "ap", label: "Standard (AP)", selected: !isTurm }, { value: "turm", label: "Turm", selected: isTurm }],
      hp: { value: sys.hp.value, max: d.hpMax, temp: sys.hp.temp, source: actor.system._source.hp.value },
      hitDie: sys.hitDie.l, hitDice: sys.hitDice, hitDicePips, hitDieMaxLabel: (sys.hitDie.l.includes("+") ? "×(" + sys.hitDie.l + ")" : sys.hitDie.l),
      pb: fmtMod(d.pb), init: fmtMod(d.init), spellAtk: fmtMod(d.spellAtk),
      exhPen: d.exh ? `${d.exhPen} / -${5 * d.exh}ft` : "",
      deathSucc, deathFail, exhaustion, inspiration, inspN, downed: (sys.hp.value ?? d.hpMax) <= 0,
      conditionChips: chipContext(actor),
      abilities, skills, weapons, spells, feats, purchases, turmwissen, spBreak, spPips, highRanks, slots, profs,
      eleHint, eleRanks, eleLabel: eleEl ? damageTypeLabel(eleEl) : "", eleColor: damageTypeColor(eleEl),
      lay: sys.resources.lay, sp: sys.resources.sp, pools: sys.resources.pools ?? [],
      customAdv: [...(d.custom?.advSkills ?? []).map(k => SKILLS[k]?.l ?? k), ...(d.custom?.advSaves ?? []).map(k => `${ABBR[k] ?? k} save`)].join(", "),
      abilityEditor, skillEditor, profEditor, customProfs, counts,
      shopNav, shopCards,
      hpCells, hdMax, milestones, progress, hpPending, hpPendingLabel,
      gearAll, gearCity, gearTower, armorOptions, crystals, currency,
      history: (sys.history ?? []).map(e => ({ kind: e.kind, text: historyText(e), when: e.t ? new Date(e.t).toLocaleString() : "" })),
      historyCap: HISTORY_CAP, historyOpen: this.#historyOpen,
      isGM: game.user.isGM, carryLimit: TOWER_CARRY_LIMIT, carried: carryCount(actor.items), crystalLimit: CRYSTAL_LIMIT, attuned: gearAll.filter(g => g.attuned).length,
      notesEnriched: await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.notes, { secrets: actor.isOwner, relativeTo: actor })
    });
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId in context.tabs) context.tab = context.tabs[partId];
    return context;
  }

  /* ---------- form handling ---------- */

  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    // inline item fields: items.<id>.<path>
    this.#pendingItemUpdates = data.items ?? null;
    delete data.items;
    return data;
  }

  async _processSubmitData(event, form, submitData, options) {
    await super._processSubmitData(event, form, submitData, options);
    const items = this.#pendingItemUpdates;
    this.#pendingItemUpdates = null;
    if (!items) return;
    const updates = Object.entries(items)
      .filter(([id]) => this.actor.items.has(id))
      .map(([id, data]) => ({ _id: id, ...foundry.utils.flattenObject(data) }));
    if (updates.length) await this.actor.updateEmbeddedDocuments("Item", updates);
  }

  /** The "History" box on the Level tab (sheet-local UI state, starts collapsed). */
  #historyOpen = false;

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    root.querySelector("details.apt-history")?.addEventListener("toggle", (ev) => { this.#historyOpen = ev.currentTarget.open; });
    // Ability point-buy inputs (not form-bound: the 72 check must run first)
    root.querySelectorAll("[data-ability-input]").forEach(inp => inp.addEventListener("change", async () => {
      const k = inp.dataset.abilityInput;
      await this.actor.system.setAbility(k, +inp.value);
      // Always show the stored (clamped) value: an unchanged store does not trigger a re-render on its own.
      inp.value = this.actor.system.abilities[k];
      this.render();
    }));
    // Custom proficiency entry: Enter adds
    const np = root.querySelector("[data-prof-input]");
    if (np) np.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); ApTurmCharacterSheet.#onAddProf.call(this, ev, np); } });
  }

  /** Drag: skills / saves (data-drag-roll="kind:key") become roll macros on the hotbar; items use the core drag data. */
  async _onDragStart(event) {
    const el = event.currentTarget;
    if (el.dataset.dragRoll) {
      const [kind, key] = el.dataset.dragRoll.split(":");
      event.dataTransfer.setData("text/plain", JSON.stringify({ type: "ap-turm-roll", kind, key, actorUuid: this.actor.uuid }));
      return;
    }
    return super._onDragStart(event);
  }

  /* ---------- helpers ---------- */

  #item(target) { return this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId); }

  /** App pickTarget(): select from options or enter a custom value. */
  static async pickTarget(title, type, id, mode) {
    const opts = optionsFor(type, mode);
    const options = Object.entries(opts).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("") +
      `<option value="__custom__">Custom / other…</option>`;
    const content = `<div class="form-group"><label>${esc(SELECTORS[id]?.label || "Choose")}</label>
        <div class="form-fields"><select name="choice">${options}</select></div></div>
      <div class="form-group"><label>Custom name</label><div class="form-fields"><input type="text" name="custom" placeholder="e.g. Close Quarters Shooter"></div></div>`;
    const res = await DialogV2.prompt({
      window: { title }, content, rejectClose: false,
      ok: { label: "Apply", callback: (ev, button) => ({ choice: button.form.elements.choice.value, custom: button.form.elements.custom.value.trim() }) }
    });
    if (!res) return null;
    if (res.choice === "__custom__") {
      if (!res.custom) { ui.notifications.warn("Please enter a name."); return null; }
      return res.custom;
    }
    return res.choice;
  }

  /* ---------- actions: header / strip ---------- */

  static async #onImportAppJson() { await importAppJSONIntoActor(this.actor); }
  static #onExportAppJson() { downloadActorExport(this.actor); }
  /** Death save pip: click = roll (modifier keys), right-click = set the counter by hand. */
  static #onDeathSave(ev, t) {
    if (isRightClick(ev)) { ev.preventDefault(); return this.actor.system.setDeathSave(t.dataset.kind, +t.dataset.i); }
    return rollDeathSave(this.actor, { event: ev });
  }
  /** HP quick buttons: ±1, with Shift ±5. */
  static #onHpAdjust(ev, t) { return applyHpDelta(this.actor, (+t.dataset.delta) * (ev.shiftKey ? 5 : 1)); }
  static #onRollHitDie() { return rollHitDie(this.actor); }
  static #onExhaustion(ev, t) { return this.actor.system.setExhaustion(+t.dataset.i); }
  /** Condition chip: click removes it (exhaustion: one level down), right-click on exhaustion adds one. */
  static #onConditionChip(ev, t) { if (isRightClick(ev)) ev.preventDefault(); return chipClick(this.actor, ev, t); }
  static #onConditionAdd(ev, t) { return addConditionMenu(this.actor, t); }
  static #onInspiration(ev, t) { return this.actor.system.setInspiration(+t.dataset.i); }
  /** Hit die pip: click = roll one hit die and heal, right-click = mark spent / restore by hand. */
  static #onHitDiePip(ev, t) {
    if (isRightClick(ev)) { ev.preventDefault(); return this.actor.system.setSpentHitDice(+t.dataset.i); }
    return rollHitDie(this.actor);
  }
  static #onSpellPointPip(ev, t) { return this.actor.system.setSpellPointPip(+t.dataset.i); }
  static #onSpAdjust(ev, t) { return this.actor.system.adjustSpellPoints(+t.dataset.delta); }
  static #onSlotPip(ev, t) { return this.actor.system.setSlotPip(t.dataset.rank, +t.dataset.i); }
  static #onLayAdjust(ev, t) { return this.actor.system.adjustLayHands(+t.dataset.delta); }
  static #onShortRest() { return this.actor.system.shortRest(); }
  static #onLongRest() { return this.actor.system.longRest(); }

  /* ---------- actions: items ---------- */

  static async #onCreateItem(ev, t) {
    const type = t.dataset.type;
    const names = { weapon: "New Weapon", spell: "New Spell", feat: "New Feat", gear: "New Item" };
    const item = await Item.implementation.create({ name: names[type] ?? "New Item", type }, { parent: this.actor });
    item?.sheet.render(true);
  }
  static #onEditItem(ev, t) { this.#item(t)?.sheet.render(true); }
  static async #onDeleteItem(ev, t) { const it = this.#item(t); if (it) await it.deleteDialog(); }
  static #onToggleEquipped(ev, t) { const it = this.#item(t); return it?.update({ "system.equipped": !it.system.equipped }); }
  static #onToggleWeaponProf(ev, t) { const it = this.#item(t); return it?.update({ "system.prof": !it.system.prof }); }
  static #onCycleWeaponAbility(ev, t) {
    const it = this.#item(t); if (!it) return;
    const order = ["str", "dex", "fin", "con", "int", "wis", "cha"];
    return it.update({ "system.abil": order[(order.indexOf(it.system.abil) + 1) % order.length] });
  }
  static #onGearCharge(ev, t) { const it = this.#item(t); if (it) return this.actor.system.setGearCharge(it.id, +t.dataset.i); }
  /** "Give to…" on a gear row: pick the receiving character (and, for a stack, the amount). */
  static async #onGiveItem(ev, t) { const it = this.#item(t); if (it) await giveItemDialog(it); }
  /** "Save to library" on a gear row (GM only; writes the compendium, not the actor). */
  static async #onSaveToLibrary(ev, t) { const it = this.#item(t); if (it) await saveToLibrary(it); }
  /** "From library": pick an entry of the item library, it is created on this sheet. */
  static async #onFromLibrary() { await fromLibraryDialog(this.actor); }
  static async #onSpellFromLibrary() { await spellFromLibraryDialog(this.actor); }

  /* ---------- actions: attributes ---------- */

  static #onAbilityStep(ev, t) {
    const k = t.dataset.key;
    return this.actor.system.setAbility(k, this.actor.system.abilities[k] + (+t.dataset.delta));
  }
  static #onToggleSkill(ev, t) { return this.actor.system.toggleSkill(t.dataset.key, t.checked); }
  static #onToggleProf(ev, t) { return this.actor.system.toggleProf(t.dataset.key, t.checked); }
  static async #onAddProf() {
    const inp = this.element.querySelector("[data-prof-input]");
    const v = inp?.value.trim();
    if (!v) return;
    inp.value = "";
    await this.actor.system.addCustomProf(v);
  }
  static #onRemoveProf(ev, t) { return this.actor.system.removeCustomProf(+t.dataset.index); }

  /* ---------- actions: shop ---------- */

  /** Custom shop pool: - spends a point, + gives one back. */
  static #onPoolAdjust(ev, t) { return this.actor.system.poolAdjust(t.dataset.key, -(Number(t.dataset.delta) || 0)); }
  static #onOpenShopEditor() { return openShopEditor(); }
  /** Portrait: click = show it large (ImagePopout); right-click (owner) = choose another image. */
  static #onPortrait(ev, t) { return portraitClick(this, ev, t); }

  static #onShopCategory(ev, t) { this.#shopCat = +t.dataset.index; this.render({ parts: ["shop"] }); }
  static async #onBuy(ev, t) {
    const id = t.dataset.id;
    const it = findShopItem(id); if (!it) return;
    const sel = SELECTORS[id];
    let choice;
    if (sel) {
      choice = await ApTurmCharacterSheet.pickTarget(it.name, sel.type, id, this.actor.system.mode);
      if (!choice) return;
    }
    await this.actor.system.buy(id, choice);
  }
  static #onSell(ev, t) { return this.actor.system.sell(t.dataset.id); }

  /* ---------- actions: level ---------- */

  static #onRollHp() { return this.actor.system.rollHitPoints(); }
  static async #onMilestoneStats(ev, t) {
    const index = +t.dataset.index;
    const rows = Object.keys(ABILITIES).map(k => `<div class="form-group"><label>${ABILITIES[k]}</label><div class="form-fields"><input type="number" name="${k}" value="0" min="0" max="2"></div></div>`).join("");
    const res = await DialogV2.prompt({
      window: { title: `Milestone #${index} — Stats` },
      content: `<p>Assign exactly <b>2</b> points.</p>${rows}`, rejectClose: false,
      ok: { label: "Apply", callback: (e, button) => new foundry.applications.ux.FormDataExtended(button.form).object }
    });
    if (!res) return;
    const stats = {}; let tot = 0;
    for (const k of Object.keys(ABILITIES)) { const v = Math.max(0, Math.min(2, +res[k] || 0)); if (v > 0) stats[k] = v; tot += v; }
    if (tot !== 2) { ui.notifications.warn("Must be exactly 2 points."); return; }
    await this.actor.system.setMilestoneStats(index, stats);
  }
  static async #onMilestoneFeat(ev, t) {
    const index = +t.dataset.index;
    const res = await DialogV2.prompt({
      window: { title: `Milestone #${index} — Feat` },
      content: `<div class="form-group"><label>Feat name</label><div class="form-fields"><input type="text" name="feat" placeholder="e.g. Sentinel" autofocus></div></div>`,
      rejectClose: false,
      ok: { label: "Apply", callback: (e, button) => button.form.elements.feat.value.trim() }
    });
    if (res === null || res === undefined) return;
    await this.actor.system.setMilestoneFeat(index, res);
  }
  static #onMilestoneReset(ev, t) { return this.actor.system.resetMilestone(+t.dataset.index); }

  /* ---------- actions: Turmwissen ---------- */

  /* ---------- actions: rolls (Phase 3) ---------- */

  static #onRollAttack(ev, t) { if (isRightClick(ev)) ev.preventDefault(); const it = this.#item(t); if (it) return rollAttack(this.actor, it, { event: ev }); }
  static #onRollDamage(ev, t) { if (isRightClick(ev)) ev.preventDefault(); const it = this.#item(t); if (it) return rollDamage(this.actor, it, { event: ev }); }
  static #onRollSave(ev, t) { if (isRightClick(ev)) ev.preventDefault(); return rollCheck(this.actor, { kind: "save", key: t.dataset.key }, { event: ev }); }
  static #onRollSkill(ev, t) { if (isRightClick(ev)) ev.preventDefault(); return rollCheck(this.actor, { kind: "skill", key: t.dataset.key }, { event: ev }); }
  static #onRollAbility(ev, t) { if (isRightClick(ev)) ev.preventDefault(); return rollCheck(this.actor, { kind: "ability", key: t.dataset.key }, { event: ev }); }
  static #onRollInitiative(ev) { if (isRightClick(ev)) ev.preventDefault(); return rollInitiative(this.actor, { event: ev }); }
  static #onCastSpell(ev, t) { const it = this.#item(t); if (it) return castSpell(this.actor, it); }

  static #onAddTurmwissen() { return this.actor.system.addTurmwissen(); }
  static #onRemoveTurmwissen() { return this.actor.system.removeLastTurmwissen(); }

  /** "Roll d20" in the header: plain d20 (Shift advantage, Ctrl/Alt disadvantage), speaker = this actor. */
  static #onRollD20(event) {
    return rollPlainD20(this.actor, event);
  }
}

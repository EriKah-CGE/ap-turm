/**
 * Character (player) data model.
 * Schema mirrors the app state `S` (DEFAULTS() in ap-character-sheet.html); weapons/spells/feats/gear
 * live as embedded Items. All derived values come from rules.derived() -- no formulas here.
 * The async methods are the app's mutation functions (buy/sell/setAbility/rests ...) rewritten
 * against actor.update(); the rule logic they use lives in rules.mjs.
 */
import {
  derived, hitDie, hitDieFormula, layPool, stateFromSystem, shopStatus, sellRank, clampAbility,
  skillsAfterToggle, profsAfterToggle, costOfRank, computeSpent, REST_RULES
} from "../rules.mjs";
import { appendHistory, buyHistoryEntry, sellHistoryEntry } from "../qol.mjs";
import { customBonusSource, applyCustomEffects, customEntries } from "../custom-shop.mjs";
import { SELECTORS, findShopItem } from "../config.mjs";
import { pendingHitDieLevels } from "../award.mjs";

const { SchemaField, NumberField, StringField, BooleanField, ArrayField, ObjectField, HTMLField } = foundry.data.fields;

const int = (opts = {}) => new NumberField({ required: true, nullable: false, integer: true, initial: 0, ...opts });
const abilityGroup = (opts) => new SchemaField({
  str: int(opts), dex: int(opts), con: int(opts), int: int(opts), wis: int(opts), cha: int(opts)
});

/** Build an update object that turns ObjectField `oldObj` into `newObj` (deleted keys via "-=key"). */
function objectFieldDiff(path, oldObj, newObj) {
  const out = {};
  for (const k of Object.keys(oldObj || {})) if (!(k in newObj)) out[`${path}.-=${k}`] = null;
  for (const [k, v] of Object.entries(newObj)) out[`${path}.${k}`] = v;
  return out;
}

export class CharacterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      mode: new StringField({ required: true, blank: false, initial: "turm", choices: ["ap", "turm"] }),
      theme: new StringField({ required: true, blank: false, initial: "celestial" }),   // app theme, round-trip only
      ap: new SchemaField({
        start: int({ initial: 50, min: 0 }),
        earned: int({ initial: 0, min: 0 })
      }),
      // Point-buy base scores 6-18 (bonuses from asi/milestones/feats are derived)
      abilities: abilityGroup({ initial: 10, min: 6, max: 18 }),
      // Shop counters and pick lists: system.bought[id] = n, system.choices[id] = [...]
      bought: new ObjectField(),
      choices: new ObjectField(),
      // milestones[index] = {type:"asi", stats:{str:1,...}} | {type:"feat", name}
      milestones: new ObjectField(),
      skills: new ArrayField(new StringField({ blank: false })),        // selectedSkills
      profs: new ArrayField(new StringField({ blank: false })),         // selectedProfs (lgt/med/hvy/shl/sim/mar)
      customProfs: new ArrayField(new StringField({ blank: false })),   // languages / tools
      hp: new SchemaField({
        rolls: new ArrayField(int({ min: 0 })),                        // one roll per level
        value: new NumberField({ required: true, nullable: true, integer: true, initial: null }), // null = full
        temp: int({ min: 0 })
      }),
      play: new SchemaField({
        spentHitDice: int({ min: 0 }),
        deathSucc: int({ min: 0, max: 3 }),
        deathFail: int({ min: 0, max: 3 }),
        inspiration: int({ min: 0 }),
        inspMax: int({ initial: 5, min: 1 }),
        exhaustion: int({ min: 0, max: 6 })
      }),
      resources: new SchemaField({
        spUsed: int({ min: 0 }),
        layUsed: int({ min: 0 }),
        slotsUsed: new ObjectField(),                                   // {rank: used}
        customUsed: new ObjectField()                                   // {poolKey: used} of custom shop pools
      }),
      armor: new SchemaField({
        id: new StringField({ required: true, blank: false, initial: "none" }),
        shield: new BooleanField({ initial: false })
      }),
      currency: new SchemaField({
        cp: int(), sp: int(), ep: int(), gp: int(), pp: int(),
        ku: int(), br: int(), si: int(), go: int(), ed: int()
      }),
      crystals: new ArrayField(new SchemaField({
        name: new StringField({ required: true, initial: "" }),
        elem: new StringField({ required: true, initial: "" })
      })),
      turmwissen: new ArrayField(new SchemaField({
        trigger: new StringField({ required: true, initial: "" })
      })),
      identity: new SchemaField({
        species: new StringField({ required: true, initial: "" }),
        klasse: new StringField({ required: true, initial: "Weapon Bearer" }),
        background: new StringField({ required: true, initial: "" }),
        alignment: new StringField({ required: true, initial: "" }),
        exp: new StringField({ required: true, initial: "" })
      }),
      notes: new HTMLField({ required: true, initial: "" }),
      // AP log: awards and shop purchases / sales, oldest first, capped at HISTORY_CAP (qol.mjs)
      history: new ArrayField(new ObjectField()),
      // one-time notices (spell rule conversion), shown in the Level tab; app field S.notices
      notices: new ArrayField(new SchemaField({ date: new StringField({ initial: "" }), text: new StringField({ initial: "" }) }))
    };
  }

  /** Catch old field names / shapes before validation. */
  static migrateData(source) {
    if (Array.isArray(source.crystals)) {
      source.crystals = source.crystals.map(c => {
        if (!c || typeof c !== "object") return { name: typeof c === "string" ? c : "", elem: "" };
        if (c.elem === "macht") c.elem = "arch";
        return c;
      });
    }
    if (source.abilities) {
      for (const k of ["str", "dex", "con", "int", "wis", "cha"]) {
        const v = source.abilities[k];
        if (typeof v === "number") source.abilities[k] = Math.max(6, Math.min(18, Math.round(v)));
      }
    }
    if (source.play && typeof source.play.inspiration === "boolean") {
      source.play.inspiration = source.play.inspiration ? 1 : 0;
    }
    return super.migrateData(source);
  }

  /* ---------- derived ---------- */

  /** App-shaped state built from this model plus the actor's embedded items. */
  get appState() {
    return stateFromSystem(this, this.parent?.items ?? []);
  }

  get actor() { return this.parent; }

  prepareDerivedData() {
    super.prepareDerivedData();
    const S = this.appState;
    // custom shop entries: ability / AC / init / speed / HP bonuses as one more bonus source of derived()
    // (cap 20 and every dependent value stay the built-in rules), the rest added onto the result
    const entries = customEntries();
    let d;
    try {
      const bon = customBonusSource(S, entries);
      d = derived(Object.values(bon).some(Boolean) ? { ...S, feats: [...(S.feats || []), { name: "custom shop", bon }] } : S);
      applyCustomEffects(d, S, entries, { used: this.resources?.customUsed ?? {} });
    } catch (err) {
      console.error("ap-turm | custom shop effects skipped", err);
      d = derived(S);
      d.custom = { pools: [], dice: [], advSkills: [], advSaves: [], profs: [], features: [] };
    }
    this.derived = d;

    // Flat, roll-data friendly copies (@level, @pb, @init, @mods.str ...)
    this.level = d.level;
    this.pb = d.pb;
    this.mods = d.mods;
    this.final = d.fin;
    this.ac = d.ac;
    this.init = d.init;
    this.passivePerception = d.passivePerc;   // token tooltip / trackable value (@passivePerception)
    this.speed = d.walk;
    this.attacks = 1 + (Number(S.bought.extraAttack) || 0);

    // HP: null means "full" in the app; token bars need numbers
    this.hp.max = d.hpMax;
    if (this.hp.value === null) this.hp.value = d.hpMax;

    // Hit dice
    this.hitDie = hitDie(S);
    this.hitDice = { value: d.level - Math.min(S.play.spentHitDice || 0, d.level), max: d.level };
    // Levels whose hit die has not been rolled yet (a level gained from a GM AP award shows up here)
    this.hpPending = pendingHitDieLevels(S.hpRolls, d.level);

    // Spell points / lay on hands as {value,max} resources
    this.resources.sp = { value: d.spLeft, max: d.spTotal };
    const pool = layPool(d.earned);
    const layUsed = Math.min(S.layUsed || 0, pool);
    this.resources.lay = { value: pool - layUsed, max: pool, active: (S.bought.layHands || 0) > 0 };
    this.resources.pools = d.custom.pools;

    this.isTurm = S.mode === "turm";
    this.crystalsSet = S.crystals.filter(c => c && (c.name || c.elem)).length;
    this.turmwissenRank = S.turmwissen.length;
  }

  /* ---------- mutations (app functions on actor.update) ---------- */

  #update(data) { return this.parent.update(data); }

  #chat(content) {
    return ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.parent }),
      content
    });
  }

  /** Point-buy: app setAbility(). Returns false when the 72 budget blocks the change. */
  async setAbility(k, val) {
    const r = clampAbility(this.appState.abilities, k, val);
    if (!r.ok) { ui.notifications.warn("Point-buy budget (72) reached."); return false; }
    await this.#update({ [`system.abilities.${k}`]: r.value });
    return true;
  }

  async toggleSkill(k, on) {
    return this.#update({ "system.skills": skillsAfterToggle(this.appState.selectedSkills, k, on) });
  }

  async toggleProf(id, on) {
    return this.#update({ "system.profs": profsAfterToggle(this.appState.selectedProfs, id, on) });
  }

  async addCustomProf(text) {
    const v = String(text ?? "").trim();
    if (!v) return;
    return this.#update({ "system.customProfs": [...this.customProfs, v] });
  }

  async removeCustomProf(index) {
    const list = [...this.customProfs];
    list.splice(index, 1);
    return this.#update({ "system.customProfs": list });
  }

  /**
   * App buy(): the sheet resolves the selector choice first (dialog) and passes it here.
   * @param {string} id        Shop entry id
   * @param {string} [choice]  Chosen option for SELECTORS entries
   */
  async buy(id, choice) {
    const it = findShopItem(id);
    if (!it) return false;
    const S = this.appState;
    const st = shopStatus(S, it);
    if (st.locked || st.maxed) return false;
    if (!st.canAfford) { ui.notifications.warn("Not enough AP."); return false; }
    if (SELECTORS[id] && !choice) return false;
    const update = { [`system.bought.${id}`]: st.count + 1 };
    if (SELECTORS[id]) update[`system.choices.${id}`] = [...(S.choices[id] || []), choice];
    update["system.history"] = appendHistory(this.history, buyHistoryEntry({ id, name: it.name, rank: st.count + 1, cost: st.next, choice: choice ?? "" }));
    await this.#update(update);
    return true;
  }

  /** App sell() incl. cascadeUnlock(). */
  async sell(id) {
    const S = this.appState;
    const res = sellRank(S, id);
    if (!res) return false;
    const update = Object.assign(
      objectFieldDiff("system.bought", S.bought, res.bought),
      objectFieldDiff("system.choices", S.choices, res.choices)
    );
    // the refund covers the sold rank plus every entry that lost its prerequisite with it
    const refund = computeSpent(S) - computeSpent({ ...S, bought: res.bought });
    update["system.history"] = appendHistory(this.history, sellHistoryEntry({ id, name: findShopItem(id)?.name ?? id, rank: S.bought[id] || 0, refund }));
    await this.#update(update);
    return true;
  }

  /** Milestone reward "+2 Stats": stats = {str:1, con:1} summing to exactly 2. */
  async setMilestoneStats(index, stats) {
    const tot = Object.values(stats).reduce((a, b) => a + b, 0);
    if (tot !== 2) { ui.notifications.warn("Must be exactly 2 points."); return false; }
    await this.#update({ [`system.milestones.${index}`]: { type: "asi", stats } });
    return true;
  }

  /** Milestone reward "Feat": stores the milestone and creates the feat item if none of that name exists. */
  async setMilestoneFeat(index, name) {
    const n = String(name ?? "").trim();
    if (!n) { ui.notifications.warn("Please enter a name."); return false; }
    await this.#update({ [`system.milestones.${index}`]: { type: "feat", name: n } });
    const exists = this.parent.items.some(i => i.type === "feat" && i.name === n);
    if (!exists) await this.parent.createEmbeddedDocuments("Item", [{ name: n, type: "feat", system: { src: "Milestone #" + index } }]);
    ui.notifications.info(n + " added to Feats - edit it there to add stat bonuses (e.g. +1 STR).");
    return true;
  }

  /** App milestone Reset: a feat milestone also removes the feat created for it. */
  async resetMilestone(index) {
    const m = this.milestones[index];
    if (m?.type === "feat") {
      const feat = this.parent.items.find(i => i.type === "feat" && i.system.src === "Milestone #" + index);
      if (feat) await feat.delete();
    }
    return this.#update({ [`system.milestones.-=${index}`]: null });
  }

  /** Roll the next empty HP level with the current hit die (1s rerolled per component die). */
  async rollHitPoints() {
    const S = this.appState;
    const d = this.derived;
    const rolls = [...S.hpRolls];
    let idx = rolls.findIndex(x => !x);
    if (idx === -1) idx = rolls.length;
    if (idx >= d.level) { ui.notifications.warn("HP already set for all levels."); return null; }
    const roll = await new Roll(hitDieFormula(S)).evaluate();
    while (rolls.length <= idx) rolls.push(0);
    rolls[idx] = roll.total;
    await this.#update({ "system.hp.rolls": rolls });
    await roll.toMessage({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.parent }),
      flavor: `Hit Points Level ${idx + 1} (${hitDie(S).l}, rerolls 1s)`
    });
    return roll;
  }

  /** Pip helpers: app pattern cur===i ? i-1 : i */
  static pip(cur, i) { return cur === i ? i - 1 : i; }

  async setDeathSave(kind, i) {
    const key = kind === "succ" ? "deathSucc" : "deathFail";
    return this.#update({ [`system.play.${key}`]: CharacterData.pip(this.play[key], i) });
  }
  async setExhaustion(i) { return this.#update({ "system.play.exhaustion": CharacterData.pip(this.play.exhaustion, i) }); }
  async setInspiration(i) { return this.#update({ "system.play.inspiration": CharacterData.pip(Math.max(0, this.play.inspiration), i) }); }
  async setSpentHitDice(i) { return this.#update({ "system.play.spentHitDice": CharacterData.pip(this.play.spentHitDice, i) }); }
  async setSpellPointPip(i) { return this.#update({ "system.resources.spUsed": CharacterData.pip(this.resources.spUsed, i) }); }
  async setSlotPip(rank, i) {
    const cur = this.resources.slotsUsed[rank] || 0;
    return this.#update({ [`system.resources.slotsUsed.${rank}`]: CharacterData.pip(cur, i) });
  }
  /** App data-spadj: spUsed = clamp(cur - delta, 0, spTotal) */
  async adjustSpellPoints(delta) {
    const cur = this.resources.spUsed;
    const v = Math.max(0, Math.min(this.derived.spTotal, cur - delta));
    return this.#update({ "system.resources.spUsed": v });
  }
  /** App data-layadj: layUsed = clamp(cur - delta, 0, pool) */
  async adjustLayHands(delta) {
    const pool = layPool(this.derived.earned);
    const v = Math.max(0, Math.min(pool, this.resources.layUsed - delta));
    return this.#update({ "system.resources.layUsed": v });
  }

  async addTurmwissen() {
    return this.#update({ "system.turmwissen": [...this.turmwissen.map(t => ({ trigger: t.trigger })), { trigger: "" }] });
  }
  /** Only the last rank can be removed (app). */
  async removeLastTurmwissen() {
    return this.#update({ "system.turmwissen": this.turmwissen.slice(0, -1).map(t => ({ trigger: t.trigger })) });
  }

  /** Gear charge pip on an embedded gear item. */
  async setGearCharge(itemId, i) {
    const it = this.parent.items.get(itemId);
    if (!it || it.type !== "gear") return;
    return it.update({ "system.used": CharacterData.pip(it.system.used || 0, i) });
  }

  /** App shortRest(): recharge "short" items; warlock purchase resets slot counters. */
  async shortRest() {
    const S = this.appState;
    const itemUpdates = [];
    for (const it of this.parent.items) {
      if (it.type !== "gear") continue;
      const s = it.system;
      if ((s.charges || 0) > 0 && REST_RULES.short.items.includes(s.recharge) && (s.used || 0) > 0) itemUpdates.push({ _id: it.id, "system.used": 0 });
    }
    if (itemUpdates.length) await this.parent.updateEmbeddedDocuments("Item", itemUpdates);
    // custom shop pools that come back on a short rest
    const shortPools = (this.derived.custom?.pools ?? []).filter(p => p.reset === "short");
    if (shortPools.length) await this.#update(Object.fromEntries(shortPools.map(p => [`system.resources.customUsed.${p.key}`, 0])));
    let wl = false;
    if (S.bought.warlock > 0) {
      const su = {}; for (const k in S.slotsUsed) su[`system.resources.slotsUsed.${k}`] = 0;
      await this.#update(su); wl = true;
    }
    const n = itemUpdates.length;
    await this.#chat(`<p><b>Short rest.</b> ${wl ? "Warlock slots restored. " : ""}${n ? n + " item(s) recharged. " : ""}Spend Hit Dice via the pips.</p>`);
  }

  /**
   * Spend (+) or restore (-) points of a custom shop pool; clamped to 0..max.
   * @param {string} key   pool key (entry id + effect index)
   * @param {number} delta points spent (negative = give back)
   */
  async poolAdjust(key, delta) {
    const p = (this.derived.custom?.pools ?? []).find(x => x.key === key);
    if (!p) return false;
    const used = Math.max(0, Math.min(p.max, (p.max - p.value) + (Number(delta) || 0)));
    await this.#update({ [`system.resources.customUsed.${key}`]: used });
    return true;
  }

  /** App spellsRest() (long rest). */
  async longRest() {
    const S = this.appState;
    const update = {
      "system.resources.spUsed": 0,
      "system.resources.layUsed": 0,
      "system.play.spentHitDice": 0,
      "system.play.deathSucc": 0,
      "system.play.deathFail": 0,
      "system.hp.value": null
    };
    for (const k in S.slotsUsed) update[`system.resources.slotsUsed.${k}`] = 0;
    // custom shop pools: every pool (short- and long-rest ones) is full after a long rest
    for (const p of this.derived.custom?.pools ?? []) update[`system.resources.customUsed.${p.key}`] = 0;
    await this.#update(update);
    const itemUpdates = [];
    for (const it of this.parent.items) {
      if (it.type !== "gear") continue;
      const s = it.system;
      if ((s.charges || 0) > 0 && REST_RULES.long.items.includes(s.recharge) && (s.used || 0) > 0) itemUpdates.push({ _id: it.id, "system.used": 0 });
    }
    if (itemUpdates.length) await this.parent.updateEmbeddedDocuments("Item", itemUpdates);
    const n = itemUpdates.length;
    await this.#chat(`<p><b>Long rest.</b> Slots, hit dice, HP${n ? " & " + n + " item" + (n > 1 ? "s" : "") : ""} restored.</p>`);
  }

  /** Cost of the next rank of a shop entry (for the sheet). */
  nextCost(id) { const it = findShopItem(id); return it ? costOfRank(it, this.bought[id] || 0) : 0; }
}

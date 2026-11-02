/**
 * NPC data model (Phase 4): lean but fully rollable. AC, HP, speed (plus other movement modes), six abilities, save
 * bonuses (null = ability modifier), skills (passive Perception), senses, languages, damage resistances / immunities /
 * vulnerabilities, condition immunities, legendary resistances and actions as counters, element (turm mode), manual
 * combat modifiers, and the statblock as structured entries (traits, actions, bonus actions, reactions, legendary
 * actions, lair actions) with to-hit, save DC, damage, recharge, uses, legendary cost and parent (options of an entry).
 * Exhaustion of an NPC comes from its status effects (exhaustion1..6), not from a field.
 * Damage types stay as imported; in turm mode a type that is no element counts as "not assigned" until the GM picks one.
 */
import { mod } from "../rules.mjs";
import { exhaustionLevel, exhaustedSpeed } from "../conditions.mjs";
import { emptyEntry, parseEntry } from "../statblock.mjs";
import { isUnassignedType, markUnassignedTypes } from "../rolls.mjs";

const { SchemaField, NumberField, StringField, ArrayField, HTMLField, BooleanField, TypedObjectField } = foundry.data.fields;

const int = (opts = {}) => new NumberField({ required: true, nullable: false, integer: true, initial: 0, ...opts });
const nint = () => new NumberField({ required: true, nullable: true, integer: true, initial: null });
const str = (initial = "") => new StringField({ required: true, initial });
const ABILS = ["str", "dex", "con", "int", "wis", "cha"];
const abilityGroup = (opts) => new SchemaField(Object.fromEntries(ABILS.map(a => [a, int(opts)])));
const counter = () => new SchemaField({ value: int({ min: 0 }), max: int({ min: 0 }) });
export const SECTION_ORDER = ["traits", "actions", "bonus", "reactions", "legendary", "lair"];
const LEG_RES_RE = /^Legendary Resistance/i;

export class NpcData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      mode: new StringField({ required: true, initial: "turm", choices: ["ap", "turm"] }),
      // true = "not assigned" damage types carry the prefix "?" (1.3.0). Older stored data in mode turm treated every
      // non-element key as not assigned; migrateData marks those once (see markUnassignedTypes).
      typeMarks: new BooleanField({ initial: true }),
      // what players see instead of the name (chat cards, tracker, tooltip); empty = the real name
      displayName: str(),
      typeLine: str(),
      hp: new SchemaField({
        value: int({ initial: 10, min: 0 }),
        max: int({ initial: 10, min: 0 }),
        temp: int({ min: 0 })
      }),
      ac: int({ initial: 10, min: 0 }),
      // Save DC of the NPC's abilities; 0 = none (used as DC prefill when a player targets this NPC)
      dc: int({ initial: 0, min: 0 }),
      speed: int({ initial: 30, min: 0 }),
      speeds: str(),                    // other movement modes as text: "Fly 80, Swim 40"
      pb: int({ initial: 2, min: 0 }),
      abilities: abilityGroup({ initial: 10, min: 1, max: 30 }),
      // Save bonus as printed in the statblock (total); null = plain ability modifier
      saves: new SchemaField(Object.fromEntries(ABILS.map(a => [a, nint()]))),
      // Skill bonuses as printed: { perception: 11, stealth: 5 } (keys lowercased, no spaces)
      skills: new TypedObjectField(new NumberField({ required: true, nullable: false, integer: true, initial: 0 })),
      senses: str(),
      languages: str(),
      conditionImmunities: str(),
      defenseNote: str(),               // qualified defense lines as printed ("... from nonmagical attacks")
      headerNotes: str(),               // Gear / Habitat / Treasure lines
      resistances: new ArrayField(new StringField({ blank: false })),
      immunities: new ArrayField(new StringField({ blank: false })),
      vulnerabilities: new ArrayField(new StringField({ blank: false })),
      legendary: new SchemaField({
        resist: counter(),
        actions: counter()
      }),
      // Element of the enemy (turm mode), informational and prefill for new attacks
      element: str(),
      // Manual combat modifiers (Pack Tactics, Magic Resistance ...): set by hand, never guessed
      adv: new SchemaField({ attacks: new BooleanField({ initial: false }), spellSaves: new BooleanField({ initial: false }) }),
      entries: new ArrayField(new SchemaField({
        name: str(),
        section: new StringField({ required: true, initial: "actions", choices: SECTION_ORDER }),
        text: str(),
        toHit: nint(),
        range: str(),
        saveDc: nint(),
        saveAbility: str(),
        damage: str(),
        dmgType: str(),
        areaShape: str(),               // "" | cone | ray | circle | rect (from the statblock text)
        areaSize: int({ min: 0 }),      // ft
        recharge: str(),                 // "5-6", "6", "rest" or ""
        rechargeUsed: new BooleanField({ initial: false }),
        uses: new SchemaField({ value: int({ min: 0 }), max: int({ min: 0 }), per: str() }),
        legendaryCost: int({ min: 0 }),
        parent: str()                    // name of the entry this one is an option of (shares its recharge / uses)
      })),
      cr: str(),
      statblock: str(),
      notes: new HTMLField({ required: true, initial: "" })
    };
  }

  /** Old shapes: legendary {value,max}; attacks[] and traits/actions text -> entries; saves 0 -> null; per-entry adv -> adv. */
  static migrateData(source) {
    if (source.legendary && ("value" in source.legendary) && !("actions" in source.legendary)) {
      source.legendary = { resist: { value: 0, max: 0 }, actions: { value: source.legendary.value ?? 0, max: source.legendary.max ?? 0 } };
    }
    if (source.saves) for (const a of ABILS) if (source.saves[a] === 0) source.saves[a] = null;
    if (!Array.isArray(source.entries) || !source.entries.length) {
      const entries = [];
      for (const a of source.attacks ?? []) {
        if (!a || typeof a !== "object") continue;
        const e = emptyEntry("actions");
        e.name = a.name ?? "Attack"; e.toHit = a.bonus ?? a.atk ?? 0; e.damage = a.dice ?? a.dmg ?? ""; e.dmgType = a.dtype ?? ""; e.range = a.range ?? "";
        e.text = a.notes ?? "";
        entries.push(e);
      }
      for (const [field, section] of [["traits", "traits"], ["actions", "actions"]]) {
        const text = source[field];
        if (typeof text !== "string" || !text.trim()) continue;
        let sec = section;
        for (const line of text.split("\n").map(l => l.trim()).filter(Boolean)) {
          const hdr = /^(ACTIONS|BONUS ACTIONS|REACTIONS|LEGENDARY ACTIONS|LAIR ACTIONS)$/i.exec(line);
          if (hdr) { sec = { actions: "actions", "bonus actions": "bonus", reactions: "reactions", "legendary actions": "legendary", "lair actions": "lair" }[hdr[1].toLowerCase()]; continue; }
          entries.push(parseEntry(line, sec));
        }
      }
      if (entries.length) source.entries = entries;
    }
    if (Array.isArray(source.entries)) {
      for (const e of source.entries) {
        if (!e || typeof e !== "object" || !e.adv) continue;
        source.adv ??= {};
        if (e.adv.attacks) source.adv.attacks = true;
        if (e.adv.spellSaves) source.adv.spellSaves = true;
        delete e.adv;
      }
    }
    delete source.attacks; delete source.traits; delete source.actions;
    // stored data from before 1.3.0 (full source: has "mode", lacks "typeMarks"): mode turm marks non-element keys
    if ("mode" in source && source.typeMarks === undefined) {
      markUnassignedTypes(source, source.mode);
      source.typeMarks = true;
    }
    return super.migrateData(source);
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this.mods = {};
    for (const k of ABILS) this.mods[k] = mod(this.abilities[k]);
    this.saveMods = {};
    for (const k of ABILS) this.saveMods[k] = this.saves[k] ?? this.mods[k];
    this.saveProf = {};
    for (const k of ABILS) this.saveProf[k] = this.saves[k] !== null && this.saves[k] !== this.mods[k];
    this.passivePerception = 10 + (this.skills.perception ?? this.mods.wis);
    // exhaustion from statuses: -2 x level on every d20 (applied in the rolls), -5 ft speed
    this.exhaustion = exhaustionLevel(this.parent?.statuses ?? []);
    this.exhPen = -2 * this.exhaustion;
    this.speedEff = exhaustedSpeed(this.speed, this.exhaustion);
    this.init = this.mods.dex + this.exhPen;
    this.isTurm = this.mode === "turm";
    // turm mode: imported D&D damage types that no element has been assigned to yet (defenses and entries)
    this.unassigned = this.isTurm
      ? [...this.resistances, ...this.immunities, ...this.vulnerabilities, ...this.entries.map(e => e.dmgType)].filter(k => isUnassignedType(k, this.mode)).length
      : 0;
  }

  /* ---------- helpers ---------- */

  /** Index of the entry that holds the recharge / uses of entry `index` (its parent when it is an option). */
  holderIndex(index) {
    const e = this.entries[index];
    if (!e?.parent) return index;
    const p = this.entries.findIndex(x => x.name === e.parent && x.section === e.section);
    return p >= 0 ? p : index;
  }

  /* ---------- mutations ---------- */

  #update(data) { return this.parent.update(data); }
  #entriesCopy() { return this.entries.map(e => ({ ...e, uses: { ...e.uses } })); }

  /** Legendary counters: pip pattern (cur === i ? i - 1 : i) or explicit reset. */
  async setLegendary(kind, i) {
    const cur = this.legendary[kind].value;
    return this.#update({ [`system.legendary.${kind}.value`]: cur === i ? i - 1 : i });
  }
  async resetLegendary(kind = null) {
    const u = {};
    for (const k of kind ? [kind] : ["resist", "actions"]) u[`system.legendary.${k}.value`] = this.legendary[k].max;
    return this.#update(u);
  }
  async addEntry(section = "actions", data = {}) {
    const entries = this.#entriesCopy();
    const e = { ...emptyEntry(section), ...data };
    if (!e.name) e.name = section === "traits" ? "New trait" : "New action";
    if (section !== "traits" && e.toHit === null && !e.saveDc && !e.damage && !data.text) { e.toHit = this.pb + Math.max(this.mods.str, this.mods.dex); e.damage = "1d6"; e.dmgType = this.element || ""; e.range = "5 ft"; }
    entries.push(e);
    return this.#update({ "system.entries": entries });
  }
  async updateEntry(index, data) {
    const entries = this.#entriesCopy();
    if (!entries[index]) return null;
    const old = entries[index].name;
    entries[index] = foundry.utils.mergeObject(entries[index], data, { inplace: false });
    if (data.name !== undefined && data.name !== old) for (const c of entries) if (c.parent === old) c.parent = data.name;   // keep options attached
    return this.#update({ "system.entries": entries });
  }
  async removeEntry(index) {
    const entries = this.#entriesCopy();
    const [gone] = entries.splice(index, 1);
    if (gone?.name) for (const c of entries) if (c.parent === gone.name) c.parent = "";
    return this.#update({ "system.entries": entries });
  }
  /**
   * Pay the costs of using an entry: legendary actions, recharge (marks it spent), X/Day uses. Options of an entry
   * (Cold Breath under Breath Weapons) pay with their parent's recharge / uses.
   * Returns false (with a warning) when the entry cannot be used.
   */
  async spendEntry(index) {
    const e = this.entries[index];
    if (!e) return false;
    const hi = this.holderIndex(index), h = this.entries[hi];
    const update = {};
    if (e.section === "legendary" && e.legendaryCost > 0) {
      if (this.legendary.actions.value < e.legendaryCost) { ui.notifications.warn(`${e.name}: not enough legendary actions (${this.legendary.actions.value}/${this.legendary.actions.max}).`); return false; }
      update["system.legendary.actions.value"] = this.legendary.actions.value - e.legendaryCost;
    }
    if (LEG_RES_RE.test(e.name)) {
      if (this.legendary.resist.value <= 0) { ui.notifications.warn(`${e.name}: none left.`); return false; }
      update["system.legendary.resist.value"] = this.legendary.resist.value - 1;
    } else if (h.uses.max > 0) {
      if (h.uses.value <= 0) { ui.notifications.warn(`${h.name}: no uses left (0/${h.uses.max} per ${h.uses.per || "day"}).`); return false; }
    }
    if (h.recharge && h.rechargeUsed) { ui.notifications.warn(`${h.name}: not recharged yet (Recharge ${h.recharge}).`); return false; }
    const entries = this.#entriesCopy();
    if (h.uses.max > 0 && !LEG_RES_RE.test(e.name)) entries[hi].uses.value = h.uses.value - 1;
    if (h.recharge) entries[hi].rechargeUsed = true;
    update["system.entries"] = entries;
    await this.#update(update);
    return true;
  }
  async setEntryRecharge(index, used) {
    const entries = this.#entriesCopy();
    const hi = this.holderIndex(index);
    if (!entries[hi]) return null;
    entries[hi].rechargeUsed = !!used;
    return this.#update({ "system.entries": entries });
  }
  /** Start of this NPC's turn: roll 1d6 for every spent recharge ability; available again at >= the recharge number. */
  async rollRecharges() {
    const spent = this.entries.map((e, index) => ({ e, index })).filter(x => x.e.recharge && x.e.rechargeUsed && /^\d/.test(x.e.recharge));
    if (!spent.length) return null;
    const entries = this.#entriesCopy();
    const rolls = [], lines = [];
    for (const { e, index } of spent) {
      const min = parseInt(e.recharge, 10);
      const roll = await new Roll("1d6").evaluate();
      rolls.push(roll);
      const ok = roll.total >= min;
      if (ok) entries[index].rechargeUsed = false;
      lines.push(`<li><b>${foundry.utils.escapeHTML(e.name)}</b> (Recharge ${e.recharge}): ${roll.total} → ${ok ? "available again" : "still spent"}</li>`);
    }
    await this.#update({ "system.entries": entries });
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.parent }), rolls,
      whisper: game.users.filter(u => u.isGM).map(u => u.id),   // the players must not see what recharged
      content: `<div class="ap-turm-chat apt-applied"><p><b>${foundry.utils.escapeHTML(this.parent.name)}</b> · Recharge</p><ul class="apt-recharge">${lines.join("")}</ul></div>`,
      flags: { "ap-turm": { type: "recharge" } }
    });
    return rolls;
  }
  /** Long rest: HP to max, uses and recharge abilities restored, legendary counters reset. */
  async longRest() {
    const entries = this.#entriesCopy();
    for (const e of entries) { if (e.uses.max > 0) e.uses.value = e.uses.max; e.rechargeUsed = false; }
    await this.#update({
      "system.hp.value": this.hp.max, "system.entries": entries,
      "system.legendary.resist.value": this.legendary.resist.max, "system.legendary.actions.value": this.legendary.actions.max
    });
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.parent }),
      content: `<div class="ap-turm-chat apt-applied"><p><b>${foundry.utils.escapeHTML(this.parent.name)}</b>: Long rest. HP, uses, recharge abilities and legendary counters restored.</p></div>`
    });
  }
  async addDefense(kind, key) {
    const k = String(key ?? "").trim(); if (!k) return null;
    const list = [...this[kind]];
    if (list.includes(k)) return null;
    list.push(k);
    return this.#update({ [`system.${kind}`]: list });
  }
  async removeDefense(kind, index) {
    const list = [...this[kind]];
    list.splice(index, 1);
    return this.#update({ [`system.${kind}`]: list });
  }
  /** Replace one defense entry (assigning an element to an imported D&D type). */
  async setDefense(kind, index, key) {
    const k = String(key ?? "").trim(); if (!k) return null;
    const list = [...this[kind]];
    if (list[index] === undefined) return null;
    list[index] = k;
    return this.#update({ [`system.${kind}`]: list.filter((v, i) => list.indexOf(v) === i) });
  }
}

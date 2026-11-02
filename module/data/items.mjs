/**
 * Item data models: weapon, spell, feat, gear. Field names match the app arrays
 * (S.weapons / S.spells / S.feats / S.items) so the importer and the later export are 1:1.
 */
const { SchemaField, NumberField, StringField, BooleanField, HTMLField, ArrayField, ObjectField } = foundry.data.fields;
import { ITEM_BON, expandEffects } from "../rules.mjs";

const int = (opts = {}) => new NumberField({ required: true, nullable: false, integer: true, initial: 0, ...opts });
const str = (initial = "") => new StringField({ required: true, initial });

export class WeaponData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      abil: new StringField({ required: true, blank: false, initial: "str",
        choices: ["str", "dex", "fin", "con", "int", "wis", "cha"] }),
      dice: str("1d8"),
      // D&D damage type in mode "ap", element key in mode "turm"
      dtype: str("slashing"),
      // optional second damage line (rule from the user, 1.3.0): own dice and own type, e.g. 1d6 fire
      dice2: str(),
      type2: str(),
      bonus: int(),
      prof: new BooleanField({ initial: true }),
      equipped: new BooleanField({ initial: false }),
      // reach in ft (the reach ring on the canvas); 5 ft unless the weapon says otherwise
      reach: int({ min: 0, initial: 5 }),
      notes: str()
    };
  }

  static migrateData(source) {
    if (source.dtype === "macht") source.dtype = "arch";
    if (source.type2 === "macht") source.type2 = "arch";
    // only a complete stored item (Foundry also runs migrateData on partial update data, which must stay partial)
    if ("dice" in source && "dtype" in source && "abil" in source) { source.dice2 ??= ""; source.type2 ??= ""; }
    return super.migrateData(source);
  }
}

export class SpellData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      lvl: int({ min: 0, max: 9, initial: 1 }),   // 0 = cantrip
      elem: str(),
      notes: str(),
      prepared: new BooleanField({ initial: true }),
      concentration: new BooleanField({ initial: false }),
      // full spell text (Spell Library import: casting time, range, components, duration, description); Foundry only
      description: new HTMLField({ required: true, initial: "" })
    };
  }

  static migrateData(source) {
    if (source.elem === "macht") source.elem = "arch";
    return super.migrateData(source);
  }
}

export class FeatData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      desc: str(),
      src: str(),
      // Summed into derived values like the app's featBonuses()
      bon: new SchemaField({
        str: int(), dex: int(), con: int(), int: int(), wis: int(), cha: int(),
        ac: int(), speed: int(), hp: int(), init: int()
      })
    };
  }
}

export class GearData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      qty: int({ min: 1, initial: 1 }),
      notes: str(),
      attuned: new BooleanField({ initial: false }),
      // items with effects (1.3.0): effects only work while equipped and - if attunement is required - attuned
      equipped: new BooleanField({ initial: false }),
      attunement: new BooleanField({ initial: false }),
      effects: new SchemaField({
        bon: new SchemaField(Object.fromEntries(Object.keys(ITEM_BON).map(k => [k, int()]))),
        saveBon: new SchemaField(Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, int()]))),
        skillBon: new ObjectField(),                      // {<skill key>: bonus}
        prof: new SchemaField({ skills: new ArrayField(new StringField({ blank: false })), saves: new ArrayField(new StringField({ blank: false })) }),
        adv: rollEffects(),
        dis: rollEffects(),
        res: new ArrayField(new StringField({ blank: false })),
        imm: new ArrayField(new StringField({ blank: false })),
        vuln: new ArrayField(new StringField({ blank: false })),
        senses: str(),
        note: str()
      }),
      charges: int({ min: 0, max: 20 }),
      used: int({ min: 0 }),
      recharge: new StringField({ required: true, blank: false, initial: "long",
        choices: ["long", "short", "dawn", "none"] }),
      // Turm carry limit (re-entry reminder) counts "tower" only
      origin: new StringField({ required: true, blank: false, initial: "city", choices: ["city", "tower"] })
    };
  }

  /** Items from before 1.3.0: not equipped, no attunement requirement, no effects. */
  static migrateData(source) {
    // only a complete stored item: Foundry also runs migrateData on partial update data ({effects: {bon: {str: 1}}}),
    // which must never be expanded to defaults (that would reset every other effect)
    if (source && typeof source === "object" && "qty" in source && "origin" in source && "recharge" in source) {
      if (source.equipped === undefined) source.equipped = false;
      if (source.attunement === undefined) source.attunement = false;
      source.effects = expandEffects(source.effects);
    }
    return super.migrateData(source);
  }
}

/** adv / dis of an item: skills, saves and the three single rolls. */
function rollEffects() {
  return new SchemaField({
    skills: new ArrayField(new StringField({ blank: false })), saves: new ArrayField(new StringField({ blank: false })),
    attack: new BooleanField({ initial: false }), init: new BooleanField({ initial: false }), death: new BooleanField({ initial: false })
  });
}

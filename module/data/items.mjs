/**
 * Item data models: weapon, spell, feat, gear. Field names match the app arrays
 * (S.weapons / S.spells / S.feats / S.items) so the importer and the later export are 1:1.
 */
const { SchemaField, NumberField, StringField, BooleanField, HTMLField } = foundry.data.fields;

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
      charges: int({ min: 0, max: 20 }),
      used: int({ min: 0 }),
      recharge: new StringField({ required: true, blank: false, initial: "long",
        choices: ["long", "short", "dawn", "none"] }),
      // Turm carry limit (re-entry reminder) counts "tower" only
      origin: new StringField({ required: true, blank: false, initial: "city", choices: ["city", "tower"] })
    };
  }
}

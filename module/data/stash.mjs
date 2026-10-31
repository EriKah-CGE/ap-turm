/**
 * Party stash (Actor subtype "stash"): a purse in both currency sets and the embedded items. The mode decides
 * which currencies the sheet shows and whether claimed loot counts as "found in the tower".
 */
import { ALL_CURRENCY_KEYS } from "../stash-logic.mjs";

const { SchemaField, NumberField, StringField } = foundry.data.fields;
const int = () => new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 });

export class StashData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      mode: new StringField({ required: true, initial: "turm", choices: ["turm", "ap"] }),
      currency: new SchemaField(Object.fromEntries(ALL_CURRENCY_KEYS.map(k => [k, int()])))
    };
  }
}

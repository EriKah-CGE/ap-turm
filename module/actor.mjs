/**
 * Actor document class. Only adds the last safety net of the data migrations: the spell rule (data version 5) runs on
 * every Actor source that enters the client - loading the world, creating from a compendium, bundle, duplicate or
 * Foundry's "Import Data" - because only the document level sees the version flag (the character data model only
 * sees system). The conversion itself is the pure rules.migrateActorSpellRule; storing it and the GM whisper are
 * migration.settleSpellRule.
 */
import { migrateActorSpellRule } from "./rules.mjs";

export class APTActor extends foundry.documents.Actor {
  /** @override */
  static migrateData(source) {
    migrateActorSpellRule(source);
    return super.migrateData(source);
  }

  /**
   * New characters get a player token like dnd5e: vision on, linked to the actor, friendly. Only on creation;
   * actors from a compendium keep their stored token, existing actors are untouched.
   * @override
   */
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    if (this._stats?.compendiumSource?.startsWith("Compendium.")) return;
    if (this.type !== "character") return;
    this.updateSource({
      prototypeToken: { sight: { enabled: true }, actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY }
    });
  }
}

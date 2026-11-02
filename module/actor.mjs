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
}

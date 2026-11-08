/**
 * AP-Turm system entry point (Foundry VTT v13).
 */
import { AP_TURM } from "./config.mjs";
import * as rules from "./rules.mjs";
import { CharacterData } from "./data/character.mjs";
import { NpcData } from "./data/npc.mjs";
import { StashData } from "./data/stash.mjs";
import { ApTurmStashSheet } from "./sheets/stash-sheet.mjs";
import { WeaponData, SpellData, FeatData, GearData } from "./data/items.mjs";
import { ApTurmCharacterSheet } from "./sheets/character-sheet.mjs";
import { ApTurmNpcSheet } from "./sheets/npc-sheet.mjs";
import { ApTurmItemSheet } from "./sheets/item-sheet.mjs";
import { registerSizeSetting } from "./sheets/sizing.mjs";
import { importAppJSON, importAppJSONIntoActor, createActorFromAppExport, importAppExportIntoActor, convertAppExport } from "./importer.mjs";
import { exportActor, exportAppData, downloadActorExport } from "./exporter.mjs";
import { exportNpc, exportNpcData, downloadNpcExport, createNpcFromExport, importNpcIntoActor, isNpcExport } from "./npc-transfer.mjs";
import * as rolls from "./rolls.mjs";
import * as chat from "./chat.mjs";
import { macros, registerMacroHooks, ensureSystemMacros } from "./macros.mjs";
import { statusEffects } from "./conditions.mjs";
import * as statblock from "./statblock.mjs";
import * as loot from "./loot.mjs";
import { registerLootHooks, importLootTableDialog } from "./loot-dialog.mjs";
import { registerMigrationSetting, checkMigration, migrateWorld, migrateSpellRule, settleSpellRule, migrateSpellPoints, settleSpellPoints } from "./migration.mjs";
import { APTActor } from "./actor.mjs";
import { registerConditionBarSettings, registerConditionBarHooks, refreshConditionBar, conditionBar } from "./condition-bar.mjs";
import { award, awardApDialog, awardTurmwissenDialog } from "./award.mjs";
import { requestRoll, requestRollDialog, registerRequestRoll } from "./request-roll.mjs";
import { transfer, registerTransfer, registerDirectoryDrops, openStash } from "./transfer.mjs";
import { library, registerLibrary } from "./library.mjs";
import { registerHitFeedbackSetting, showHitFeedback } from "./hit-feedback.mjs";
import { registerFxSetting, playAttackFx, playCastFx, fxAvailable } from "./fx.mjs";
import { registerConcentrationSetting, registerConcentration, breakConcentration } from "./concentration.mjs";
import { registerTableUiSettings, registerTableUi, rollNpcInitiative } from "./table-ui.mjs";
import { registerJukeboxSettings, registerJukebox, registerPlaylistClass, jukebox } from "./jukebox.mjs";
import { registerCustomShopSetting, installFromSetting, openShopEditor } from "./shop-editor.mjs";
import * as customShop from "./custom-shop.mjs";
import { installSidebarButton } from "./sidebar-menu.mjs";
import { overview, openCombatOverview, registerCombatOverviewHooks } from "./combat-overview.mjs";
import { area } from "./area.mjs";
import { ensureRulesJournal, rebuildRulesJournal } from "./rules-journal.mjs";
import * as rulesJournalLogic from "./rules-journal-logic.mjs";
import { backup, exportAllCharacters } from "./backup.mjs";
import { registerKeybindings } from "./keybindings.mjs";
import { libraries5e, importLibrariesDialog, importFromBundleFileDialog } from "./libraries5e.mjs";
import * as dnd5eConvert from "./dnd5e-convert.mjs";
import { registerSpawn, placeCopies, placeCopiesDialog } from "./spawn.mjs";
import { registerReachRingSetting, registerReachRing, refreshReachRing, reachRingState } from "./reach-ring.mjs";
import { registerDiceTraySetting, registerDiceTray, diceTray } from "./dice-tray.mjs";
import { registerTowerSettings, registerTowerHooks, installTowerButton, towerTracker } from "./tower-tracker.mjs";
import { registerMapBuilder, mapBuilder } from "./map-builder.mjs";

const SYSTEM_ID = "ap-turm";

Hooks.once("init", () => {
  CONFIG.AP_TURM = AP_TURM;
  game.apturm = { config: AP_TURM, rules, importAppJSON, importAppJSONIntoActor, createActorFromAppExport, importAppExportIntoActor, convertAppExport, exportActor, exportAppData, downloadActorExport, exportNpc, exportNpcData, downloadNpcExport, createNpcFromExport, importNpcIntoActor, isNpcExport, rolls, chat, macros, statblock, loot: { ...loot, importLootTableDialog }, migrateWorld, migrateSpellRule, migrateSpellPoints, conditionBar, refreshConditionBar, award, requestRoll, transfer, library, fx: { playAttackFx, playCastFx, fxAvailable, showHitFeedback }, qol: { breakConcentration, rollNpcInitiative, undoApplied: chat.undoApplied }, jukebox, customShop: { ...customShop, openShopEditor }, overview, openCombatOverview, area, rulesJournal: { ...rulesJournalLogic, ensureRulesJournal, rebuildRulesJournal }, backup, spawn: { placeCopies, placeCopiesDialog }, libraries5e: { ...libraries5e, convert: dnd5eConvert }, reachRing: { refresh: refreshReachRing, state: reachRingState }, diceTray, tower: towerTracker, mapBuilder };
  chat.registerSettings();
  registerHitFeedbackSetting();
  registerFxSetting();
  registerConcentrationSetting();
  registerTableUiSettings();
  registerJukeboxSettings();
  registerCustomShopSetting();
  installFromSetting();          // custom shop entries over the built-in tables, before any actor is prepared
  registerSizeSetting();
  registerMigrationSetting();
  registerConditionBarSettings();
  registerConditionBarHooks();
  chat.registerChatHooks();
  chat.registerActorHooks();
  chat.registerCombatHooks();
  registerMacroHooks();
  registerRequestRoll();
  registerTransfer();
  registerLibrary();
  registerConcentration();
  registerTableUi();
  registerJukebox();
  registerPlaylistClass();       // Repeat toggle of the jukebox (stop after the last track)
  registerCombatOverviewHooks();
  registerKeybindings();
  registerSpawn();
  registerReachRingSetting();
  registerReachRing();
  registerDiceTraySetting();
  registerDiceTray();
  registerTowerSettings();
  registerTowerHooks();
  registerMapBuilder();

  // Actor document class: last net of the data migrations (spell rule), see actor.mjs
  CONFIG.Actor.documentClass = APTActor;

  // Data models (types are declared in system.json -> documentTypes)
  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Actor.dataModels.npc = NpcData;
  CONFIG.Actor.dataModels.stash = StashData;
  CONFIG.Item.dataModels.weapon = WeaponData;
  CONFIG.Item.dataModels.spell = SpellData;
  CONFIG.Item.dataModels.feat = FeatData;
  CONFIG.Item.dataModels.gear = GearData;

  // Initiative: 1d20 + derived @init (DEX mod + feat bonus + exhaustion penalty)
  CONFIG.Combat.initiative = { formula: "1d20 + @init", decimals: 2 };

  // Token bars / tracked values
  CONFIG.Actor.trackableAttributes = {
    character: { bar: ["hp", "resources.sp", "resources.lay", "hitDice"], value: ["ac", "level", "pb", "init", "speed", "passivePerception"] },
    npc: { bar: ["hp", "legendary.actions", "legendary.resist"], value: ["ac", "speed", "speedEff", "init", "passivePerception"] }
  };

  // Conditions: the table's own list (prone, restrained, stunned, unconscious, invisible, poisoned, frightened,
  // paralyzed, dead) plus exhaustion 1-6 (-2 x level on d20 rolls, -5 ft, 6 = dead). They act on the rolls
  // via conditions.mjs, not only as icons. "dead" stays CONFIG.specialStatusEffects.DEFEATED.
  CONFIG.statusEffects = statusEffects();

  // Item effects stay on the item (no legacy transfer to the actor)
  CONFIG.ActiveEffect.legacyTransferral = false;

  // Sheets
  const { Actors, Items } = foundry.documents.collections;
  Actors.registerSheet(SYSTEM_ID, ApTurmCharacterSheet, { types: ["character"], makeDefault: true, label: "AP_TURM.Sheet.Character" });
  Actors.registerSheet(SYSTEM_ID, ApTurmNpcSheet, { types: ["npc"], makeDefault: true, label: "AP_TURM.Sheet.Npc" });
  Actors.registerSheet(SYSTEM_ID, ApTurmStashSheet, { types: ["stash"], makeDefault: true, label: "Party Stash" });
  Items.registerSheet(SYSTEM_ID, ApTurmItemSheet, { types: ["weapon", "spell", "feat", "gear"], makeDefault: true, label: "AP_TURM.Sheet.Item" });
});

/* Actors directory (sidebar tab and popout):
   - every row is a drop target for a gear item dragged from a character sheet (transfer.mjs),
   - one "AP-Turm" button opens the GM tools as a menu: "Import character" creates a new Actor (players
     import into their own sheet via its "Import JSON" window control), "Award AP", "Grant Turmwissen"
     and "Request Roll". All four are GM only, so players get no button at all. */
Hooks.on("renderActorDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  registerDirectoryDrops(root);
  installSidebarButton(root, {
    label: "AP-Turm",
    entries: [
      { id: "import", icon: "fa-file-import", label: game.i18n.localize("AP_TURM.Import.Button"), gm: true, handler: () => importAppJSON() },
      { id: "award-ap", icon: "fa-star", label: "Award AP", gm: true, handler: () => awardApDialog() },
      { id: "award-tw", icon: "fa-book", label: "Grant Turmwissen", gm: true, handler: () => awardTurmwissenDialog() },
      { id: "request-roll", icon: "fa-dice-d20", label: "Request Roll", gm: true, handler: () => requestRollDialog() },
      { id: "stash", icon: "fa-box-open", label: "Party Stash", gm: true, handler: () => openStash() },
      { id: "shop-editor", icon: "fa-screwdriver-wrench", label: "Shop Editor", gm: true, handler: () => openShopEditor() },
      { id: "rules-journal", icon: "fa-book-open", label: "Rebuild rules journal", gm: true, handler: () => rebuildRulesJournal() },
      { id: "export-all", icon: "fa-file-zipper", label: "Export all characters", gm: true, handler: () => exportAllCharacters() },
      { id: "import-5e", icon: "fa-book-skull", label: "Import dnd5e libraries", gm: true, handler: () => importLibrariesDialog() },
      { id: "import-bundle", icon: "fa-file-arrow-up", label: "Import from bundle file", gm: true, handler: () => importFromBundleFileDialog() }
    ]
  });
  installTowerButton(root);   // "Tower" next to it (GM only): Tower Tracker window
});

/* Spell rule (data version 5) on every way a character enters the world: APTActor.migrateData converts the source in
   memory (load, compendium, bundle, duplicate, "Import Data"); the client that created or replaced the actor stores
   the result and whispers the AP difference to the GMs, the active GM settles everything else on ready. */
Hooks.on("createActor", (actor, options, userId) => {
  if (userId === game.user.id) settleSpellRule(actor).then(() => settleSpellPoints(actor)).catch(err => console.error(`${SYSTEM_ID} | spell rule`, err));
});
Hooks.on("updateActor", (actor, changes, options, userId) => {
  if (userId === game.user.id && changes?.flags?.[SYSTEM_ID]?.spellRulePending) settleSpellRule(actor).catch(err => console.error(`${SYSTEM_ID} | spell rule`, err));
});

/* Import button in the RollTables directory header (same technique as the Actors button above) */
registerLootHooks();

/* the custom shop again once the world settings are certainly there; characters recompute with it */
Hooks.once("setup", () => {
  installFromSetting({ notify: game.user.isGM });
  for (const a of game.actors ?? []) if (a.type === "character") a.reset();
});

Hooks.once("ready", () => {
  console.log(`${SYSTEM_ID} | AP-Turm ${game.system.version} ready (Foundry ${game.version})`);
  chat.registerSocket();
  ensureSystemMacros().catch(err => console.error(`${SYSTEM_ID} | ensureSystemMacros`, err));
  checkMigration().catch(err => console.error(`${SYSTEM_ID} | migration`, err));
  if (game.user.isActiveGM) migrateSpellRule().then(() => migrateSpellPoints()).catch(err => console.error(`${SYSTEM_ID} | spell rule`, err));
  refreshConditionBar().catch(err => console.error(`${SYSTEM_ID} | condition bar`, err));
  ensureRulesJournal().catch(err => console.error(`${SYSTEM_ID} | rules journal`, err));
});

# Foundry VTT v13: Eigenes Game System vs. dnd5e-Modul — technischer Leitfaden für das "AP Point-Buy"-Regelwerk

Stand: September 2026. Recherche zu Foundry v13 als Zielplattform des Systems `ap-turm`.

## TL;DR
- **Eigenes Game System bauen** (nicht auf dnd5e aufsetzen). Die Abweichungen (AP-abgeleitetes Level, eigene Übungsbonus-Formel, Zauberpunkte statt Slots, eigene Trefferwürfel-Leiter) kollidieren zu tief mit dnd5e; dnd5e bietet keine Config zum Austausch der Übungsbonus-Formel und kennt Zauberpunkte nicht nativ — Anpassung nur per libWrapper-Patch, was fragil ist.
- Der Port ist gut machbar: Vorhandene Vanilla-JS-Logik wird zu einem `TypeDataModel` (Schema via `foundry.data.fields`) plus Ableitungen in `prepareDerivedData()`; die `innerHTML`-Renderfunktion wird durch eine `ActorSheetV2` + `HandlebarsApplicationMixin` mit `PARTS`/`actions` ersetzt; JSON-Export/Import wird ein Importer, der `Actor.create()` mit `type`-spezifischem `system`-Objekt aufruft.
- Empfohlener Startpunkt: **Asacolips Boilerplate** (nur als Referenz lesen; Struktur selbst anlegen), DataModels aktivieren.

## 1. Grundsatzentscheidung: eigenes System
- dnd5e-**Code** ist MIT-lizenziert, **Inhalte** separat CC-BY (SRD). Wiederverwendung wäre lizenzrechtlich möglich; das Problem ist die Architektur, nicht die Lizenz.
- Der **Übungsbonus** in dnd5e ist tabellenbasiert fest verdrahtet (+2 Lvl 1–4, +3 ab 5 … +6 ab 17). Es gibt **keinen `CONFIG.DND5E`-Schlüssel** zum Ersetzen der Formel. Eigene Formel nur per libWrapper-Patch der Datenaufbereitung oder Active Effects auf `system.attributes.prof`.
- **Zauberpunkte sind in dnd5e nicht nativ.** Das Modul `dnd5e-spellpoints` liefert ein Verbrauchs-Item und hängt sich in den Hook `dnd5e.preItemUsageConsumption`. Schon ein abweichendes Subsystem erfordert Hook-Chirurgie plus Trägeritem.
- Für „level from earned AP", „custom hit-die ladder", „spell points", „Turmwissen", „Lay on Hands pool", „crystal circlet" gibt es in dnd5e keine sauberen Erweiterungspunkte.
- dnd5e für v13 ist die **5.x-Linie**; dnd5e 5.0.0 (Mai 2025) läuft ausschließlich auf v13. Hohes Änderungstempo → Aufsatzmodule brechen bei Major-Updates.

## 2. Kernarchitektur von Foundry v13
- **Documents** = persistente Datenobjekte: `Actor`, `Item`, `Scene`, `TokenDocument`, `ChatMessage`, `Combat`/`Combatant`, `ActiveEffect`, `JournalEntry`/`JournalEntryPage`, `Macro`, `RollTable`, `Playlist`, `Card`. Basisklasse `foundry.abstract.Document`.
- **Embedded Documents**: `Item`, `ActiveEffect` in `Actor`; `Token`, `Wall`, `Note` in `Scene`. Bearbeitung über `actor.createEmbeddedDocuments("Item", [...])`, `actor.updateEmbeddedDocuments(...)`, Zugriff über `actor.items`, `actor.effects`.
- **Client/Server-Split**: Server validiert Core-Schemata; das `system`-Feld (TypeDataModel) wird **clientseitig** konstruiert — sensible Felder (HTML, Dateipfade) im Manifest unter `documentTypes` deklarieren (`htmlFields`, `filePathFields`). Seit v13 sind Client-Klassen als ES-Module in Namespaces (`foundry.documents`, `foundry.applications`, `foundry.data.fields`) erreichbar, nicht mehr global.
- **Datenfluss**: `document.update({...})` schreibt in die DB, triggert `updateXxx`-Hooks, repliziert per Socket an alle Clients. `actor.system.xyz` liest aufbereitete Daten.
- **Permissions**: Ownership-Levels NONE/LIMITED/OBSERVER/OWNER; `document.isOwner`, `document.testUserPermission(user, level)`.
- **Hooks**: `Hooks.once("init", ...)` (CONFIG, DataModels, Sheets registrieren), `Hooks.once("ready", ...)`, `Hooks.on("renderActorSheetV2", (app, html, context, options) => ...)` — `html` ist in v13 ein **DOM-Element, kein jQuery**. Lifecycle: `preCreateActor`/`createActor`, `preUpdateItem`/`updateItem`, `preDelete…`/`delete…`; `pre*`-Hooks können mit `return false` abbrechen.
- **CONFIG**: `CONFIG.Actor.dataModels`, `CONFIG.Item.dataModels`, `CONFIG.Actor.trackableAttributes`, `CONFIG.Combat.initiative`, `CONFIG.statusEffects`, `CONFIG.ActiveEffect.legacyTransferral`.
- **game.settings**: `game.settings.register(namespace, key, {scope, config, type, default})`; Scopes Client, **User (neu in v13)**, World.
- **game.i18n**: `localize("KEY")`, `format("KEY", {x})`; Sprachdateien im Manifest unter `languages`.

## 3. System vs. Modul
- **System** = Regelwerk: Datenmodelle, Sheets, CONFIG-Overrides, Initiative-Formel, Templates; genau ein aktives System pro Welt.
- **Modul** = Erweiterung: mehrere gleichzeitig, kann Document-Subtypes über `documentTypes` beisteuern (Module Sub-Types), Sheets registrieren, Hooks, Kompendien — ersetzt das System nicht.
- **`system.json` (v13)**: `id` (= Ordnername, lowercase), `title`, `description`, `version`, `compatibility: {minimum, verified, maximum}`, `esmodules`, `styles`, `languages: [{lang, name, path}]`, `packs`, `packFolders`, `documentTypes: { Actor: { character: {htmlFields, filePathFields} }, Item: {...} }`, `grid` (Distanz/Einheit), `primaryTokenAttribute`/`secondaryTokenAttribute`, `manifest`, `download`, `authors[]`, `url`, `license`, `readme`, `bugs`, `changelog`, `relationships`, `socket`, `background`.
- Legacy-Felder `minimumCoreVersion`, `compatibleCoreVersion`, `author` (String) sind überholt; `compatibility.minimum/maximum` werden hart erzwungen.
- **Lokale Installation**: Ordner nach `{userData}/Data/systems/<id>/` (Ordnername = `id`), Foundry neu starten.
- **Distribution**: `manifest`-URL auf die aktuelle `system.json`, `download` auf getaggte Zip; Package Browser nur nach Einreichung bei foundryvtt.com.

## 4. Data Modeling in v13
- `class CharacterData extends foundry.abstract.TypeDataModel { static defineSchema() {...} }`, registriert im `init`-Hook via `CONFIG.Actor.dataModels.character = CharacterData`.
- Felder aus `foundry.data.fields`: `NumberField`, `StringField`, `BooleanField`, `SchemaField` (verschachtelt), `ArrayField`, `ObjectField`, `HTMLField`, `FilePathField`, `SetField`, `ForeignDocumentField`. Beispiel Ressource: `new SchemaField({ value: new NumberField({initial:10}), max: new NumberField({initial:10}) })`.
- `documentTypes` im Manifest muss alle Subtypes deklarieren (sonst verwirft der Server sie).
- `prepareBaseData()` (vor Active Effects) vs. `prepareDerivedData()` (abgeleitete Werte: Level aus AP, PB-Formel, Zauberpunkte, HP). Parent-Dokument über `this.parent`.
- **Migrationen**: `static migrateData(source)` im DataModel; zusätzlich systemweite `migrateWorld()` im `ready`-Hook mit Versions-Flag.
- `template.json` kann in v13 entfallen; Typen über `documentTypes` + `CONFIG.*.dataModels`. DataModels liefern Validierung, Defaults, Methoden.
- **Flags**: `document.setFlag(scope, key, value)` / `getFlag` für schemalose Zusatzdaten.

## 5. ApplicationV2 / Sheets in v13
- v13 unterstützt V1 noch (deprecated, `foundry.appv1.*`), aber Neuentwicklung mit **AppV2**; die gesamte Core-UI ist auf AppV2 migriert.
- Hierarchie: `ApplicationV2` → `DocumentSheetV2` → `ActorSheetV2`; dazu `DialogV2`. Sheets: `class MyActorSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {...}`.
- `static DEFAULT_OPTIONS`: `classes`, `position: {width, height}`, `window: {title, resizable}`, `tag: "form"`, `form: {handler, submitOnChange, closeOnSubmit}`, `actions: { myAction: this.#handler }`.
- `static PARTS`: benannte Template-Fragmente (`{ header: {template}, tabs: {template}, main: {template} }`).
- `static TABS`: Tab-Gruppen (`{ sheet: { tabs: [{id, group, label}], initial } }`); Tab-Templates mit `class="tab"`, `data-tab`, `data-group`.
- Kontext: `async _prepareContext(options)` (ersetzt `getData()`); `context.system = this.actor.system`. HTML-Felder über `foundry.applications.ux.TextEditor.implementation.enrichHTML(...)`.
- Interaktionen: `data-action="rollAttack"` im HTML + `actions`-Map; Handler `static async #rollAttack(event, target)` mit `this` = Sheet. Sonstige Listener in `_onRender(context, options)` per `addEventListener` (DOM, kein jQuery).
- Formular: `tag: "form"` + `form.handler`; kein verschachteltes `<form>`. Eingebettete Item-Edits über `name="items.<id>.system.xyz"` mit überschriebenem `_processFormData`/`_processSubmitData`.
- Registrierung: `foundry.documents.collections.Actors.unregisterSheet("core", ActorSheet)`, dann `registerSheet("ap-turm", MyActorSheet, {types:["character"], makeDefault:true})`.
- CSS/Theming: v13 nutzt **CSS Layers** und Light/Dark-Themes über CSS-Variablen; Checkboxen sind FontAwesome-Icons. Altes Styling bricht oft.
- Fallstrick: **CONFIG-Werte nicht in statischen Feld-Initialisierern** (`static PARTS`) verwenden — dort noch undefined; Template-Pfade hart kodieren.

## 6. Würfel & Chat
- `const roll = new Roll(formula, data)`, `await roll.evaluate()`; `roll.total`, `roll.terms`, `roll.dice`.
- Vorteil/Nachteil: `2d20kh1` / `2d20kl1`.
- Reroll: Modifier `r1`. Maximieren: `roll.evaluate({maximize:true})` (für maximierte Crit-Würfel) oder Würfelanzahl verdoppeln.
- Crit-Range 19–20: nach `evaluate` den d20-Term prüfen (`roll.dice[0].results`), bei ≥19 Crit-Logik.
- Chat: `roll.toMessage({speaker, flavor})`; Karten mit Buttons via `ChatMessage.create({content, rolls:[roll], speaker})`, Buttons per `data-action` + Listener über `Hooks.on("renderChatMessageHTML", ...)`.
- Schaden auf Ziel: `game.user.targets` (Set der Tokens) → `token.actor` → eigene `applyDamage(amount, type)` mit Resistenzen/Elementen → `actor.update({"system.hp.value": ...})`.
- Rettungswürfe: `1d20 + @saveMod` vs. SG, Ergebnis in die Karte.
- Dice So Nice: kompatibel bei echten `Roll`-Objekten via `toMessage`/`ChatMessage.create({rolls})`.

## 7. Combat & Tokens
- Initiative: `CONFIG.Combat.initiative = { formula: "1d20 + @init", decimals: 2 }` im `init`-Hook.
- Hooks: `combatStart`, `combatTurn`, `combatRound`, `updateCombat`, `deleteCombat`.
- Token-Balken: `primaryTokenAttribute`/`secondaryTokenAttribute` im Manifest und/oder `CONFIG.Actor.trackableAttributes = { character: { bar: ["hp"], value: ["ap"] } }`; Bar-Attribute brauchen `value` + `max`.
- Zustände: `CONFIG.statusEffects` = Array `{id, name, img, ...}`, im Token-HUD toggelbar, erzeugen `ActiveEffect`; ein Effect kann mehrere `statuses` tragen.
- Active Effects: `changes: [{key, mode, value, priority}]`; Modi ADD(2), MULTIPLY(1), OVERRIDE(5), UPGRADE(4), DOWNGRADE(3), CUSTOM(0); `CONFIG.ActiveEffect.legacyTransferral = false` lässt Item-Effekte auf dem Item bleiben und trotzdem wirken.
- Bewegung v13: Drag-Measurement mit Wegpunkten, Bewegungsarten (walk/fly/climb/burrow/teleport/swim), „Automatic Token Rotation".

## 8. Kompendium-Packs (für später)
- `packs: [{ name, label, path: "packs/items", type: "Item", system: "ap-turm", ownership }]`.
- Format seit v11: **LevelDB**. Foundry CLI (`@foundryvtt/foundryvtt-cli`): `fvtt package pack -n "items" --in src/packs/items --out packs` / `unpack`; JSON/YAML-Quellen im Repo, LevelDB beim Release bauen.
- Für `ap-turm` in Phase 1–3 nicht nötig (Shop = Code-Tabelle).

## 9. Entwicklungs-Workflow & Tooling
- Boilerplate: `asacolips-projects/boilerplate` (Wiki-Tutorial „System Development"). Node ≥ 20. Als Referenz nutzen.
- Weitere Referenzen: „Simple Worldbuilding", `TheFifthRider/simplyroleplaying`.
- Hot Reload: Manifest-`flags.hotReload` mit Pfaden; `.js/.mjs/.css/.html/.hbs/.json` werden ohne Reload injiziert; Hook `hotReload`.
- Debugging: Browser-DevTools, `CONFIG.debug.hooks = true`, `ui.notifications`. `public/scripts/foundry.js` im Installationsordner enthält den kommentierten Client-Code.
- Ressourcen: `foundryvtt.com/api/v13/`, `foundryvtt.com/article/system-development/`, `/system-data-models/`, `foundryvtt.wiki` (System-Dev-Tutorial, AppV2-Conversion-Guide, DataModel/Hooks/ActiveEffects), Discord `#system-development`.
- Portierungs-Fallstricke aus Vanilla-JS: kein DOM-State (Sheet wird bei jedem `update` neu gerendert; State ins DataModel), kein jQuery, Event-Handler über `actions`/Delegation, kein localStorage, alles ESM ohne Globals.

## 10. Vergleich der Optionen
**Eigenes System** — Pro: volle Kontrolle über Datenmodell, Progression, PB-Formel, Zauberpunkte, Hit-Die-Leiter; sauberes Sheet; unabhängig von dnd5e-Updates. Contra: Angriff/Schaden/Rettung/Zustände/Combat selbst bauen. Aufwand mittel-hoch, geradlinig.
**Modul auf dnd5e** — Pro: Kampf-Engine, Kompendien, Ökosystem vorhanden. Contra: PB-Formel nicht konfigurierbar, Zauberpunkte nur via Hook + Item, keine Erweiterungspunkte für AP-Level/Turmwissen/Lay-Hands/Kristallreif/Hit-Die-Leiter, keine offizielle Tab-API (nur Render-Hooks/libWrapper), bricht bei dnd5e-Major-Updates. Aufwand hoch und fragil.
**Baukästen** — Custom System Builder (flexibel, aber Logik in dessen Formeleditor statt JS — für den vorhandenen JS-Code unpassend); Simple Worldbuilding nur als Prototyp.
**Empfehlung: eigenes System.**

## 11. NPC-Sheet & Statblock-Import
- Actor-Subtype `npc` mit reduziertem DataModel (HP, AC, Tempo, Saves, Resistenzen, Legendary-Zähler, Angriffsliste, Freitext), eigene schlanke `ActorSheetV2`-PARTS, `types:["npc"]`.
- dnd5e-Actor-JSON: Mapping-Funktion auf das eigene Schema, `Actor.create({name, type:"npc", system: mappedData})`, Items/Effekte per `createEmbeddedDocuments`.
- Statblock-Text: eigener Regex-Parser (AC, HP, Speed, Ability-Block, Actions) — keine etablierte systemagnostische Library; 80 % Trefferquote reicht, Rest passt der Spielleiter an.

## 12. v12 → v13, Ausblick v14
- AppV2 gereift (Core-UI migriert; V1 deprecated), Theme-System (CSS Layers, Light/Dark), DOM statt jQuery, ProseMirror (`<prose-mirror>`-Element statt `{{editor}}`), neues Token-Bewegungssystem, Manifest-Legacy-Felder abgekündigt, Client-Klassen in Namespaces, User-Settings-Scope.
- **v14** ist bereits stabil (Full Stable April 2026); dnd5e ist auf v14 verifiziert, bleibt v13-lauffähig. AppV2 + DataModels sind die zukunftssicheren Muster; Legacy vermeiden.

## Port-Plan (Kurz)
- State-Objekt → DataModel-Schema; abgeleitete Werte in `prepareDerivedData()`.
- localStorage → `actor.update()`.
- innerHTML-Render → Handlebars-PARTS + `_prepareContext`; Buttons → `data-action`.
- JSON Export/Import → DialogV2-Importer, `migrateData` für Altformat.
- Rasten → Methoden am DataModel mit Chat-Log.

## Etappen
1. Setup: Struktur anlegen, `compatibility.minimum/verified = 13`, Testwelt (nie die Kampagnenwelt).
2. Datenmodell: `CharacterData`, `NpcData`, Item-Modelle, `documentTypes`, Registrierung, Ableitungen, Migration des Alt-JSON. Erst weiter, wenn Werte stimmen.
3. Charakter-Sheet: `ActorSheetV2` + Mixin, PARTS/TABS, `_prepareContext`, Registrierung, CSS gegen v13-Variablen.
4. Würfel & Chat: Angriff (Vorteil/Nachteil, Crit 19–20, maximierte Crit-Würfel), Schaden, Rettungswurf; Chat-Karten; `game.user.targets` + `applyDamage`.
5. NPC-Sheet + Zustände: `CONFIG.statusEffects`, Active Effects, Initiative-Formel.
6. (Optional) Kompendium-Shop mit Foundry CLI.
7. Importer/Parser: App-JSON, optional dnd5e-Actor-JSON / Statblock-Regex.
8. Politur: Settings, i18n, Hot Reload, Migrationsroutine, Manifest-URLs.

## Lizenz
- Foundry-EULA („Limited License for Package Development"): Pakete nur zur Nutzung mit lizenzierter Software; eigene Inhalte frei verteilbar/verkaufbar.
- dnd5e-Software MIT, SRD-Inhalte CC-BY-4.0 (Attribution TASL bei Übernahme). Für ein komplett eigenes Regelwerk keine Attribution nötig.

## Caveats
- Exakte v13-Namespaces (z. B. `foundry.documents.collections.Actors`) können sich zwischen Minor-Versionen verschieben — im Zweifel `foundry.js`/API-Docs der installierten Build prüfen.
- Kein systemagnostischer Statblock-Parser vorhanden; eigener Parser empfohlen.

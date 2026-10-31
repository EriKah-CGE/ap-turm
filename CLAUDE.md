# AP-Turm — Foundry VTT v13 Game System

Projektauftrag für Claude Code. Diese Datei ist die Spezifikation; sie fasst ein langes
Vorgespräch zusammen. Bei Widersprüchen zwischen dieser Datei und dem Quellcode der
HTML-App gilt: **Die HTML-App ist die Quelle der Wahrheit für Regeln und Formeln.**

## Ausgangslage

- `ap-character-sheet.html` — fertige, getestete Single-File-App (Vanilla JS, localStorage,
  innerHTML-Rendering) für ein Homebrew-System auf D&D-5e-Basis. Enthält **alle Regeln als
  Code**: `SHOP_DATA`, `PREREQS`, Preisleiter, `derived()`, `ELEMENTS`, `ARMORS`, `HIT_DICE`,
  Rast-Logik, Lay-on-Hands-Pool, Turmwissen. Diese Logik wird **übernommen, nicht neu erfunden**.
- `docs/foundry-v13-research.md` — Recherchebericht zu Foundry v13 (Architektur, DataModels,
  ApplicationV2, Roll/Chat-API, Packs, Lizenz). Vor dem ersten Code lesen.
- Ziel: eigenständiges Foundry-**System** (kein Modul auf dnd5e). Entscheidung ist gefallen
  und begründet (dnd5e-Übungsbonus fest verdrahtet, keine Zauberpunkte, Progression inkompatibel).
- Zielplattform: Foundry **v13** (`compatibility.minimum: 13`, `verified`: exakte Version des
  Spielleiters eintragen). Nur AppV2 + TypeDataModel — die Muster tragen bis v14.

## Feste Architektur-Entscheidungen (nicht neu diskutieren)

1. **System-ID:** `ap-turm`. Ordner = ID.
2. **Actor-Typen:** `character` (Spieler), `npc` (Gegner, schlank).
3. **Item-Typen:** `weapon`, `spell`, `feat`, `gear` (Inventar). In der App sind das Arrays im
   Zustand; in Foundry werden sie **eingebettete Item-Dokumente** (Hotbar, Chat-Karten, Drag & Drop).
4. **Shop bleibt Code-Tabelle** (`SHOP_DATA` in `module/config.mjs`), **kein Kompendium**.
   Käufe sind Zähler (`system.bought[id] = n`) plus Wahl-Optionen (`system.choices[id] = [...]`).
   Keine LevelDB/CLI-Pipeline in Phase 1–3.
5. **Sheets:** `ActorSheetV2` + `HandlebarsApplicationMixin`, `PARTS`/`TABS`, `data-action`.
   **Kein jQuery**, kein innerHTML-Zustand, keine globalen Variablen, nur ESM.
6. **Persistenz:** ausschließlich `actor.update()` / `createEmbeddedDocuments()`. Kein localStorage.
7. **Druck-/Mobile-Schicht der App wird nicht portiert** (Foundry braucht sie nicht).
8. **CSS neu** gegen Foundry-v13-Variablen (Light/Dark-Theme, CSS Layers). App-CSS nicht übernehmen.
9. **Regeländerungen** nur auf explizite Anweisung des Nutzers. Nichts „verbessern", was nicht
   beauftragt ist — auch nicht, wenn es naheliegt. Besprochenes ≠ beauftragt.

## Das Regelwerk in Kurzform (Details: `derived()` in der HTML)

Progression (alles aus **verdienten AP** `earnedAp`; `startAp` ist nur Kaufbudget):
- Level = `max(1, floor(earned/10)+1)`
- Übungsbonus PB = `2 + floor(earned/75)`
- Milestones = `floor(earned/75)`; jeder Milestone = +2 Attributspunkte **oder** ein Feat
  (Feat-Milestone erzeugt automatisch ein editierbares Feat mit Statbonus-Feldern)
- Cantrip-Stufe = `1 + floor(earned/100)`
- AP-Budget = `startAp + earnedAp`; Kosten je Rang: `costs[k]`, darüber `letzter × mult` (Default 2)
- Attribute: Point-Buy Summe ≤ 72, je 6–18; Kappe 20 (Item `max20` hebt sie); Skills max 6; Profs max 6
- Zaubermodifikator = `max(CHA, WIS, INT)`; SG = `8 + PB + Mod + spellDC-Käufe`;
  Zauberangriff = `PB + Mod + spellDC-Käufe` (+ Erschöpfungsmalus)

Modus `turm` (Kampagnenmodus, Standard für diese Runde) vs. `ap` (Standard-D&D-Slots):
- **Zauberpunkte** = Σ über Ränge r: `r × (learn_r ? 1 : 0 + spellslot_r)`; Max-Rang = höchster `learn_r`
- **Rang 1–5:** beliebig oft wirkbar, kosten nur Punkte
- **Rang 6–9:** zusätzlich begrenzt auf `learn_r + spellslot_r` Wirkungen pro langer Rast
  (eigener Zähler, `slotsUsed[r]`), kosten **trotzdem** Punkte
- **Traglimit:** 5 Gegenstände, aber **nur** für Herkunft `tower` (im Turm gefunden) und **nur beim
  Wiederbetreten** des Turms; während eines Runs im Turm unbegrenzt, `carried in` (Herkunft `city`) immer
  unbegrenzt. Reine Anzeige/Erinnerung („Found in tower X/5“), nie ein Block. **Kristallreif** mit
  5 Sockeln `{name, elem}`, vom Limit ausgenommen
- **20 Elemente** mit Farben: erde eis chaos blut ordnung licht blitz gaya erz energie gift heilig
  wind wasser schoepfung zerstoerung dunkelheit feuer + `turm` + `arch` (**nicht** „macht")
- Waffen-Schadenstyp im Turm-Modus = Element (statt D&D-Typ); Waffen haben Notizfeld
- **Turmwissen:** Array `[{trigger}]`, Index+1 = Rang, nur letzter Eintrag löschbar
- **Währungen Turm:** KU, BR, SI, GO, ED — Kurse 100/100/100, GO→ED **10**. Modus `ap`: cp/sp/ep/gp/pp
- **Lay on Hands:** Pool = `floor(earned/5)`, Reset bei langer Rast
- **Hit-Die-Leiter** (Shop `hitDie`, Kosten 10/20/30, dann ×2): d8 → d10 → d12 → d6+d8 → d6+d10 → d6+d12;
  Einsen je Teilwürfel neu; `hpMax = Σ hpRolls + Level × CON-Mod`
- **AC:** Rüstungstabelle (`ARMORS`: padded 11 … half-plate 15/dex≤2 … plate 18/dex0; STR-Anforderung
  → −10 ft), Schild +2, Kampfstil Defense +1 nur mit Rüstung, Unarmored Def = 10 + DEX + Wahlattribut
- **Erschöpfung (2024):** −2 × Stufe auf alle d20-Würfe, −5 ft; Stufe 6 = tot. Inspiration 0–5
- **Kurze Rast:** Items mit `recharge: short` aufladen; bei `warlock`-Kauf Slots zurücksetzen
- **Lange Rast:** `spUsed`, `slotsUsed`, `spentHitDice`, `layUsed`, Death Saves, HP, Items (short/long/dawn)
- **Angriff:** Mod (Waffenattribut) + PB (wenn proficient) + Waffenbonus; **Crit 19–20** bei `critBoost`,
  **maximierte Crit-Würfel** bei `critMax`; `eleDmg` = +1d6 je Rang auf jedem Treffer — **Element wird beim Kauf gewählt**
  (`choices.eleDmg[]`, modusabhängige Liste); `changeEle` (Element Swap) fragt beim Kauf ein neues Element ab, das
  das eleDmg-Element **ersetzt** (letzter Swap gilt). Nicht das Waffenelement verwenden.
- **Modusregel für alle Schadens-/Elementwahlen:** `ap` → `DAMAGE_TYPES` (D&D), `turm` → `ELEMENTS`. Gilt für
  Waffen-Schadenstyp, `res`, `eleDmg`, `changeEle`, Zauber-Editor. Altwerte aus dem anderen Modus bleiben lesbar.
- **Statblock-Import:** im Modus `ap` D&D-Typen 1:1; im Modus `turm` keine automatische Zuordnung zu Elementen —
  Typen werden als „nicht zugeordnet" importiert und vom Spielleiter manuell gesetzt (gilt für Resistenzen/Immunitäten/
  Verwundbarkeiten und die Schadenstypen aller Aktionen; nicht zugeordnete Typen greifen bei Resistenzen nicht).

## Zuordnung App-Zustand → Foundry

Der App-Zustand `S` (siehe `DEFAULTS()` in der HTML) wird so verteilt:

| App (`S.…`) | Foundry |
|---|---|
| name, identity, notes, theme | `actor.name`, `system.identity`, `system.notes` |
| mode, startAp, earnedAp | `system.mode`, `system.ap.start`, `system.ap.earned` |
| abilities, bought, choices, milestones, skills, profs | `system.*` gleichnamig |
| hpRolls, play.*, spUsed, layUsed, slotsUsed | `system.hp.rolls`, `system.play.*`, `system.resources.*` |
| armor {id, shield}, currency, crystals, turmwissen | `system.*` gleichnamig |
| weapons[] | Items vom Typ `weapon` |
| spells[] (lvl, name, elem) | Items vom Typ `spell` |
| feats[] (name, desc, src, bon{}) | Items vom Typ `feat`; `bon` als Active Effect **oder** in `prepareDerivedData` summiert (einfacher: summieren wie die App) |
| items[] (qty, notes, attunement, charges, used, recharge, origin) | Items vom Typ `gear` |

Der **Importer** (`module/importer.mjs`) liest den App-JSON-Export und erzeugt Actor + eingebettete
Items. Alte Feldnamen (`macht` → `arch`, fehlende Felder) werden in `static migrateData()` abgefangen.
Export aus Foundry zurück in das App-Format ist erwünscht, aber Phase 5.

## Phasen mit Abnahmekriterien

**Phase 1 — Fundament.** `system.json`, `module/ap-turm.mjs` (init: DataModels + Sheets registrieren,
`CONFIG.Combat.initiative`, `trackableAttributes`), `module/config.mjs` (Tabellen aus der HTML),
`module/data/character.mjs` + `npc.mjs` + Item-Modelle, `module/importer.mjs`, Minimal-Sheet
(nur Anzeige). **Abnahme:** Kriegsmeister-JSON importieren → Level 16, PB +4, AC 19 (Platte +
Defense), HP = Σ Würfe + 16×4, 4 Angriffe, Zauberpunkte/Lay-Hands-Pool wie in der App.
Die reine Formellogik vorher in Node gegen die App testen (die HTML lässt sich per
`new Function` laden — Beispiel unten).

**Phase 2 — Charakter-Sheet.** Tabs Übersicht / Attribute / Shop / Level; Shop kaufen/verkaufen mit
Prereq-Prüfung; Kristallreif; Turmwissen; Rast-Buttons; Item-Sheets für weapon/spell/feat/gear.
**Abnahme:** Kauf ändert sofort Werte; Neuöffnen zeigt gleichen Stand; zweiter Spieler sieht nur seinen Bogen.

**Phase 3 — Würfe & Chat.** Angriff (Vorteil/Nachteil `2d20kh1/kl1`, Crit-Range, Vergleich gegen
AC von `game.user.targets`), Schaden (Crit-Max, Elementtyp, Button „auf Ziel anwenden" mit
Resistenzen), Rettungswürfe gegen SG, Skill-Würfe, Chat-Karten mit `data-action`, Dice-So-Nice-tauglich
(echte `Roll`-Objekte). **Abnahme:** Probekampf gegen Dummy-Token stimmig.

**Phase 4 — NPC & Zustände.** Schlankes NPC-Sheet (AC, HP, Tempo, Saves, Resistenzen, Legendary-Zähler,
Angriffsliste mit Wurf-Buttons, Freitext); Statblock-Text-Parser (Regex, 80 % reichen);
`CONFIG.statusEffects` mit euren Zuständen (liegend, festgehalten, betäubt, unsichtbar, Erschöpfung).

**Phase 5 — Umzug.** Export zurück ins App-Format, Migrationsroutine mit Versions-Flag, Feinschliff.

## Arbeitsweise

- Vor jeder Phase: betroffene Funktionen in der HTML lesen (`derived`, `spellsRest`, `shortRest`,
  `renderOverview`, `renderShop`, `costOfRank`, `availableAp`, `hitDie/rollHitDie`, `layPool`).
- Kleine, lauffähige Schritte. Nach jedem Schritt: **Nutzer testet in Foundry** (F5, Konsole F12),
  Fehlerzeilen kommen zurück. Nicht mehrere ungetestete Schritte stapeln.
- Formeln nie „aus dem Kopf" — aus der HTML kopieren und in Node gegen Referenzwerte prüfen:
  ```js
  const js = fs.readFileSync('ap-character-sheet.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  // Tabellen isoliert laden: const M={exports:{}}; new Function('module', js.match(/const SHOP_DATA=\{[\s\S]*?\n\};/)[0]+';module.exports=SHOP_DATA')(M);
  ```
- Referenzcharakter „Kriegsmeister" (Turm, 50 Start / 150 Earned): STR 17 DEX 10 CON 16 INT 8 WIS 11
  CHA 10; Käufe extraAttack×3, eleDmg, critBoost, critMax, hitDie, wepPlus1, fightStyle(defense),
  saveProf×2(con,wis), res, healCon, layHands, asi×2(str,con); Milestones +1STR/+1CON, +1STR/+1WIS;
  Platte ohne Schild; Zweihänder 2d6 +1. Erwartet: Level 16, PB +4, STR 20, CON 18, AC 19,
  Angriff +10, Lay Hands 30/30, Hit Die d10.
- Keine Emojis in UI-Texten. Sprache der UI: Englisch wie in der App (Labels 1:1 übernehmen),
  Kommunikation mit dem Nutzer: Deutsch, direkt, ohne Floskeln.
- Lizenz: eigenes Regelwerk, keine SRD-Inhalte → keine Attribution nötig. `system.json` → `license: MIT`.

## Nicht tun

- Nicht auf dnd5e aufsetzen. Kein Boilerplate-Generator laufen lassen (Struktur selbst anlegen,
  Boilerplate nur als Referenz lesen). Keine Kompendium-Packs in Phase 1–3.
- Keine ApplicationV1-Klassen, kein jQuery, kein `template.json` (Typen über `documentTypes` + `CONFIG.*.dataModels`).
- Keine Regeln ergänzen, umdeuten oder „balancen".

# Changelog

Jede Version hat eine Sektion `## x.y.z`; `npm run release -- x.y.z` übernimmt sie als Release-Notes auf GitHub.

## 1.4.0

- **Passive Werte:** Perception, Insight und Investigation = 10 + Fertigkeitsmodifikator (Übung, Expertise, Attribut,
  Erschöpfung, Feats, Gegenstände); Vorteil (Kauf „Adv on Skill" oder ausgerüsteter Gegenstand) +5, Nachteil −5,
  beides hebt sich auf. App und Foundry rechnen identisch.
- Übersicht (App, Druck und Foundry-Charakterbogen): Zeile „Passive: Perception · Insight · Investigation" unter den
  Skills, Tooltip mit der Rechnung („10 + 4 + 5 advantage (Cloak)"); der Kasten „Passive Perc" in der Leiste entfällt.
  App-Build v09-05r, Referenzbögen weiter auf einer Druckseite.
- Foundry: Passive Perception im Token-Tooltip und als verfolgbarer Wert (`passivePerception`) für Charaktere und NPCs.
  Custom-Shop-Effekte (Skill-Bonus, Übung, Vorteil, „Passive Perception") wirken auf alle drei Werte.
- NPC-Bogen: Passive Perception als Feld (leer = 10 + Perception bzw. WIS-Modifikator); der Statblock-Import übernimmt
  ein im Text gefundenes „passive Perception N" direkt.
- **Zauberpunkte nach der D&D-Tabelle (Regelkorrektur, Turm-Modus):** Rang 1 = 2, 2 = 3, 3 = 5, 4 = 6, 5 = 7, 6 = 9,
  7 = 10, 8 = 11, 9 = 13 Punkte – je Spellslot-Kauf in den Pool und je Wirken als Kosten (Cantrips frei, Rang 6–9
  weiter zusätzlich pro langer Rast begrenzt). Bisher galt Rang = Punkte. Aufschlüsselung „Rank 3: 1 × 5 = 5", Kosten
  hinter jedem Zauber, im Zauberbogen und auf der Chat-Karte; Regel-Journal mit Tabelle. App: Knopf „Cast" je Zauber
  (Build v09-05s). Bestehende Charaktere: Pool aus den Käufen, verbrauchte Punkte über dem Pool werden gekappt, einmal
  der Hinweis „Your pool is now X points" (App: Meldung, Foundry: Flüsternachricht an den Spielleiter). AP-Preise
  unverändert.
- **Map Builder (Spielleiter):** Karten aus Kacheln bauen – Palette mit Sets, Kategorien und Suche; Ziehen auf die Szene
  oder Stempeln/Füllen am Raster, Drehen (R, Shift+R), Spiegeln (F), Rechtsklick entfernt. Automatische Wände inkl.
  Türen und Fallgitter, gedreht/gespiegelt mit der Kachel, geteilte Kanten nur einmal, beim Entfernen mit weg.
  Werkzeuge Room und Corridor, Undo für 50 Schritte (Strg+Z), „New scene from set", Einstellung „remember last tile".
  Startset „ap-base" (23 Kacheln, selbst gezeichnet von `tools/make-tiles.mjs`); eigene Sets unter
  `Data/ap-turm-tiles/<set-id>/set.json`.

## 1.3.0

- Würfelleiste (Dice Tray) direkt unter dem Chat-Eingabefeld für Spieler und Spielleiter: d4–d100 per Klick zur Formel
  (Rechtsklick entfernt, Shift+Klick würfelt genau diesen Würfel), Modifikator, freie Formel (Enter würfelt),
  Advantage/Disadvantage für den d20, „Reroll 1s" für Hit-Dice-Würfe. Echte Würfe im Chat, Wurfmodus wie im Chat gewählt,
  Dice-So-Nice-tauglich. Ausblendbar über die Client-Einstellung „Show dice tray".
- „Roll d20"-Knopf in der Kopfzeile von Charakter- und NPC-Bogen (Shift: Advantage, Ctrl: Disadvantage).
- Dice Tray: Würfelsymbole statt Text (Zahl darunter, Zähler „×3" als Badge).
- Tower Tracker (GM, Knopf „Tower" neben AP-Turm): Lauf betreten/verlassen mit Journal „Tower Log <Datum>", Ebene,
  Element per d20 (überschreibbar), Zeitbuchung mit automatischen Beben im Intervall, drittes Beben → Kollaps und
  Würfel auf „Uncontrolled Landing", Log mit „Undo last". Spieler-HUD unter den Szene-Steuerungen (abschaltbar),
  Banner beim dritten Beben und beim Kollaps.

- **Zauberkauf (Regelkorrektur):** „Spellslot Lvl N (+1 spell)" ist der eigentliche Zauberkauf (Rang N wirken, ein
  bekannter Zauber, Turm: N Zauberpunkte je Kauf, AP-Modus: ein Slot je Kauf); „Extra Spell Lvl N" (früher Learn Spell)
  gibt nur einen weiteren bekannten Zauber. Neue Kaufkette Spellslot N → N−1, Extra Spell N → Spellslot N. Zähler
  „Rank N: x of y spells". Alte Bögen werden einmalig umgestellt (App: Datenversion 5, Meldung + Level-Tab;
  Foundry: Weltmigration mit Flüsternachricht an den Spielleiter pro Charakter), ohne AP-Ausgleich.
- **Zauber-Migration auf jedem Eintrittspfad:** App: zentrale Migration beim Laden, Datei-Import, Moduswechsel und
  Export (Build v09-05q). Foundry: Importer, Erstellung aus Kompendium/Bundle/Duplikat, „Import Data", jeder Weltstart
  (aktiver GM) und Actor-`migrateData` als letztes Netz; Flüsternachricht mit AP-Differenz auch beim Import. Alte Käufe
  werden auch bei falscher Versionsmarke erkannt (Extra Spell ohne Spellslot desselben Rangs).
- **Waffen-Schadenstypen:** Im Turm-Modus auch D&D-Schadenstypen (gruppierte Auswahl), optionale zweite Schadenszeile
  je Waffe; „Apply to target" rechnet jeden Typ getrennt gegen Resistenzen. NPC-Aktionen im Turm-Modus mit beiden
  Listen; importierte Typen bleiben „nicht zugeordnet" (intern Präfix „?", alte NPCs werden beim Laden markiert).
- **Gegenstände mit Wirkung:** Boni, Übung, Vorteil/Nachteil, Resistenzen/Immunitäten/Verwundbarkeiten, Sinne;
  wirksam nur ausgerüstet (und eingestimmt, falls nötig). Equipped-Schalter in der Inventarliste, Abschnitt „Effects"
  in App-Editor und Gegenstandsbogen, A/D-Marken, Vorauswahl im Wurfdialog, Bibliothek/Übergabe/Loot-Claim behalten
  die Wirkungen.

## 1.2.1

- Verteilung über GitHub: Installation und Updates per Manifest-URL im Foundry-Setup
  (`https://github.com/EriKah-CGE/ap-turm/releases/latest/download/system.json`).
- Release-Skript `npm run release -- x.y.z`. Keine Regel- oder Funktionsänderungen.

## 1.2.0

- Komfortfunktionen am Tisch: Undo nach *Apply to target*, „Your turn"-Banner, Token-Tooltip, NPC-Anzeigename,
  NPC-Initiative per Knopf, History-Box, Konzentration mit CON-Save.
- Jukebox v2 auf Foundrys Playlists (Now Playing, Moods, Soundboard, Bibliothek).
- Shop-Editor für eigene Point-Buy-Einträge der Spielleitung.
- Journal „AP-Turm Rules" aus den Code-Tabellen; Gesamt-Backup aller Charaktere als Zip; Tastenkürzel.
- Party Stash, Place copies, Reichweiten-Ring.
- Zauber- und Monster-Bibliotheken aus dnd5e-Kompendien, übertragbar per *Export bundles* / *Import from bundle file*.
- Übergabepaket `npm run handover`.
- Portrait-Fix (fester 3:4-Rahmen); Statblock-Parser leitet PB aus CR ab und übernimmt einen eindeutigen Spell Save DC.

## 1.1.0

- Award AP / Grant Turmwissen über den Seitenleisten-Knopf „AP-Turm".
- Request Roll mit Konsequenzen bei Misserfolg (Schaden, Zustand, Erschöpfung).
- Gegenstände zwischen Charakteren übergeben (Dialog oder Drag & Drop, Teilmengen).
- Loot-Claim auf RollTable-Karten, optional in die Item-Bibliothek; Kampfübersicht für den Spielleiter.
- Flächen-Templates aus NPC-Aktionen mit automatischer Zielwahl; Item-Bibliothek als Welt-Kompendium.
- NPC-Gegenstände als einklappbare Liste im NPC-Bogen.
- Traglimit-Regel korrigiert: zählt nur Turmfunde, nur als Erinnerung für den Wiedereintritt.
- Treffer-Feedback fest eingebaut, JB2A-Animationen optional.

## 1.0.0

- Erste Fassung als eigenständiges Foundry-v13-System: Charakter (Progression aus verdienten AP, Shop, Level,
  Turm-Modus mit Zauberpunkten, 20 Elementen, Kristallreif, Turmwissen, Würfelleiter, Rasten).
- Import der App-JSONs und Export zurück ins App-Format, Migration mit Versions-Flag.
- Angriffs-, Schadens-, Rettungs- und Skill-Würfe mit Chat-Karten und *Apply to target*.
- Schlankes NPC-Sheet mit Statblock-Parser, Loot-Tabellen-Import, Zustände inkl. Erschöpfung (2024).

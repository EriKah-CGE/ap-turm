# Changelog

Jede Version hat eine Sektion `## x.y.z`; `npm run release -- x.y.z` übernimmt sie als Release-Notes auf GitHub.

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

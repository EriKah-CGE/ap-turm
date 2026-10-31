# AP-Turm

## Installation für den Spielleiter

1. Foundry starten, im Setup auf **Game Systems** → **Install System**.
2. Unten bei **Manifest URL** einfügen:
   ```
   https://github.com/EriKah-CGE/ap-turm/releases/latest/download/system.json
   ```
3. **Install** klicken.

Updates erscheinen danach im Setup unter **Game Systems** als Update-Knopf (oder über „Check for Updates").

**Wichtig:** Eine zuvor per Zip installierte Fassung vorher unter *Game Systems* deinstallieren. Die Welten bleiben
dabei erhalten — sie liegen in `Data/worlds`, nicht im System-Ordner.

## Charakterbogen-App

Die Einzeldatei-App `ap-character-sheet.html` ist online erreichbar, ohne Dateien zu verschicken:

**https://erikah-cge.github.io/ap-turm/**

- **Am Handy:** Seite öffnen, im Browsermenü **„Zum Startbildschirm hinzufügen"**. Die App startet dann wie eine
  eigene App und funktioniert nach dem ersten Aufruf auch offline. Die laufende Fassung steht oben in der Toolbar
  neben *Load* (z. B. `v09-05o`).
- **Einmalige Datenübernahme:** Die Daten liegen im Browser-Speicher (localStorage), und der ist an die Adresse
  gebunden — unter der neuen Adresse ist der Bogen zunächst leer. In der alten Datei **Export JSON**, unter der
  neuen Adresse **Load** und die exportierte Datei wählen. Das ist pro Gerät und Browser einmal nötig.
- Die lokale Datei funktioniert weiterhin wie bisher.

Eigenständiges Spielsystem für **Foundry VTT v13** (getestet mit Build 13.351). Es setzt das
Homebrew-Regelwerk der Einzeldatei-App `ap-character-sheet.html` um: Progression aus verdienten AP,
Shop als AP-Budget, Turm-Modus mit Zauberpunkten, 20 Elementen, Kristallreif, Turmwissen und
Würfelleiter. Es baut **nicht** auf dnd5e auf und braucht kein weiteres Modul (JB2A + Sequencer
sind optional für Angriffsanimationen).

Versionen und Änderungen: [CHANGELOG.md](CHANGELOG.md) · Lizenz MIT · keine SRD-Inhalte

## Neu in 1.2.0

- **Komfortfunktionen am Tisch:** Undo nach *Apply to target*, „Your turn"-Banner, Token-Tooltip, Anzeigename für
  NPCs, NPC-Initiative per Knopf, History-Box, Konzentration mit CON-Save (siehe *Komfortfunktionen am Tisch*).
- **Jukebox v2:** Musikpult auf Foundrys Playlists: Now Playing mit Fade out, Moods, Soundboard, Bibliothek (siehe *Jukebox*).
- **Shop-Editor:** eigene Point-Buy-Einträge der Spielleitung für die Welt.
- **Regelreferenz:** Journal „AP-Turm Rules", aus den Code-Tabellen erzeugt.
- **Gesamt-Backup:** alle Charaktere als App-JSONs in einer Zip.
- **Tastenkürzel** für Kampfübersicht, Jukebox, Zustandsleiste, Award AP, Request Roll.
- **Party Stash:** gemeinsamer Vorrat mit Kasse, Nehmen/Hineinlegen, Claim aus Loot-Karten.
- **Place copies:** mehrere Kopien eines NPC auf einmal setzen, nummeriert, optional in den Kampf.
- **Reichweiten-Ring** um das ausgewählte Token (Waffen-Reichweite bzw. NPC-Nahkampf).
- **Zauber- und Monster-Bibliotheken** aus dnd5e-Kompendien, ein Kompendium pro Quelle, Quell-Tags in
  *From library*.
- **Bibliotheken übertragen:** *Export bundles* packt alle Bibliotheken samt Bildern in `ap-turm-libraries.zip`,
  *Import from bundle file* legt sie in einer anderen Installation wieder an — ohne dnd5e.
- **Übergabepaket:** `npm run handover` stellt System, Bibliotheken, Anleitung und Kurzanleitung in einem Ordner zusammen.
- **Portrait-Fix:** Bilder im Kopf von Charakter- und NPC-Bogen sitzen in einem festen 3:4-Rahmen und werden
  zugeschnitten statt gestaucht.
- **Statblock-Parser:** ohne Zeile „Proficiency Bonus" wird der PB aus dem CR abgeleitet; ein eindeutiger
  „spell save DC" wird zum Save DC des NPC.

Beim ersten Start einer bestehenden Welt mit 1.2.0 erkennt die Migration per Versionsvergleich den Sprung von
1.1.0; es sind keine Datenänderungen fällig, der Dialog mit Backup-Hinweis erscheint trotzdem einmal und
vermerkt danach die neue Version.

## Neu in 1.1.0

- **Award AP / Grant Turmwissen** über den Seitenleisten-Knopf „AP-Turm" (siehe *AP und Turmwissen vergeben*).
- **Request Roll** mit Konsequenzen bei Misserfolg (Schaden, Zustand, Erschöpfung) — *Gruppen-Aufforderungen*.
- **Gegenstände übergeben** zwischen Charakteren (Dialog oder Drag & Drop, Teilmengen).
- **Loot-Claim** auf RollTable-Karten, optional direkt in die Item-Bibliothek.
- **Kampfübersicht** für den Spielleiter.
- **Flächen-Templates** aus NPC-Aktionen mit automatischer Zielwahl.
- **Item-Bibliothek** als Welt-Kompendium „AP-Turm Library".
- **NPC-Gegenstände:** einklappbare Liste im NPC-Bogen.
- **Traglimit-Regel korrigiert:** zählt nur Turmfunde, nur als Erinnerung für den Wiedereintritt.
- **Treffer-Feedback** (Schadenszahl, Aufblitzen) fest eingebaut, **JB2A-Animationen** optional.

---

## Manuelle Installation (Zip, ohne Updates)

Nur nötig, wenn die Manifest-URL nicht genutzt werden kann:

1. `ap-turm.zip` von der [Release-Seite](https://github.com/EriKah-CGE/ap-turm/releases/latest) herunterladen.
2. Inhalt nach `Data/systems/ap-turm/` im Foundry-Datenverzeichnis entpacken, so dass
   `Data/systems/ap-turm/system.json` liegt. (Windows-Standard: `%LOCALAPPDATA%\FoundryVTT\Data\systems\ap-turm\`.)
3. Foundry neu starten. Unter **Game Systems** erscheint „AP-Turm".

## Neue Welt anlegen

1. Setup → **Game Worlds** → *Create World*.
2. Als *Game System* „AP-Turm" wählen, Titel vergeben, Welt starten.
3. In den Welt-Einstellungen (*Configure Settings → System Settings*) stehen:
   - **Defeated NPC tokens** — Token nach dem Tod entfernen oder nur als besiegt markieren.
   - **Show condition bar** (pro Client) und **Condition bar for the GM only** (Welt).
   - **Show hit feedback** — schwebende Schadenszahlen und Aufblitzen am Token (Standard an).
   - **Attack animations (JB2A)** — Angriffs- und Zauberanimationen, nur mit aktiven Modulen (Standard an).
   - **Turn sound** — Klang zum „Your turn"-Banner (Standard an).
   - **Token tooltips** — Info-Karte beim Überfahren eines Tokens (Standard an).
   - **Concentration automation** — Konzentrations-Status und CON-Save nach Schaden (Standard an).
   - **Combat music** — die Jukebox wechselt bei Kampfbeginn auf die Kampf-Kachel (Standard aus).
   - Die Fenstergrößen der Bögen werden pro Client gemerkt.
4. Beim ersten Start einer Welt, die zuletzt mit einer älteren Systemversion lief, erscheint ein
   Dialog mit Backup-Hinweis. Erst nach der Bestätigung werden Daten geschrieben; „Later"
   verschiebt das auf den nächsten Start.

## Charakterbögen aus der App importieren

Die App exportiert einen Bogen als `ap_<name>.json`.

- **Spielleiter:** in der Seitenleiste *Actors* auf **„AP-Turm"** und im Menü auf **„Import character"**. Daraus
  entsteht ein neuer Actor. Derselbe Knopf nimmt auch NPC-Exporte dieses Systems entgegen und legt
  dann einen NPC an.
- **Spieler:** eigenen Bogen öffnen und in der Fensterleiste **Import JSON** wählen. Das ersetzt
  alle Werte und eingebetteten Items dieses Actors. Spieler können nur ihre eigenen Bögen
  importieren; der Seitenleisten-Knopf ist nur für den Spielleiter sichtbar.
- **Zurück in die App:** **Export JSON** in der Fensterleiste des Bogens erzeugt wieder eine Datei
  im App-Format (Feldreihenfolge und Inhalt identisch), die die App ohne Verlust lädt.

Kaputte, leere, abgeschnittene oder fremde Dateien werden mit einer Begründung abgelehnt; es wird
in dem Fall nichts angelegt und nichts überschrieben.

## NPCs zwischen Welten austauschen

Der NPC-Bogen hat **Export NPC JSON** und **Import NPC JSON** in der Fensterleiste. Das Format ist
schlank und eigenständig (`ap_npc_<name>.json`, Feld `format: "ap-turm-npc"`) und enthält Werte,
Verteidigungen, Statblock-Einträge, Legendary-Zähler, Notizen sowie Bild- und Tokengröße. Ein
Charakter-Export wird hier abgelehnt und umgekehrt.

## Statblock-Import

Im NPC-Bogen, Reiter **Statblock**: 5e-Statblock als Text einfügen (Buch-, Web- oder 2024-Layout)
und **Parse** drücken. Erkannt werden AC, HP, Speed, Attribute, Rettungswürfe, Fertigkeiten, Sinne,
Sprachen, Resistenzen/Immunitäten/Verwundbarkeiten, CR, Übungsbonus sowie Traits, Aktionen,
Bonusaktionen, Reaktionen, legendäre und Lair-Aktionen samt Trefferbonus, SG, Schaden, Recharge,
X/Tag und legendären Kosten. Optionen eines Eintrags (z. B. „Cold Breath" unter „Breath Weapons")
werden ihrem Elterneintrag zugeordnet.

- Reiner Fließtext ohne Struktur wird abgelehnt, der Bogen bleibt unverändert.
- Ein doppelt eingefügter Statblock wird erkannt und abgelehnt, statt Einträge zu verdoppeln.
- Ein zweites Mal „Parse" auf denselben Text ändert nichts (das Ergebnis ersetzt die Felder, es
  wächst nichts an).
- **Flächen-Templates:** Nennt der Text einer Aktion eine Fläche („60-foot cone",
  „20-foot-radius sphere", „90-foot-long, 5-foot-wide line", „15-foot cube"), bekommt der Eintrag im
  Bogen ein Maß-Tag und einen Template-Knopf. Der Klick hängt ein Foundry-MeasuredTemplate an die Maus
  (Klick platziert, Rechtsklick oder Esc bricht ab); Kegel und Linie starten am Token des NPC und
  drehen sich mit der Maus. Nach dem Platzieren sind alle Tokens, deren Mittelpunkt in der Fläche
  liegt, als Ziele des Spielleiters gesetzt (das Token des NPC selbst nie), und hat die Aktion eine SG, geht die gewohnte
  Rettungswurf-Karte sofort an genau diese Ziele. Das Template bleibt liegen und wird mit Foundrys
  eigenen Werkzeugen wieder gelöscht. Formen, die Foundry nicht als Template kennt (z. B. „emanation"),
  werden übergangen — solche Aktionen behalten nur ihren Rettungswurf-Knopf.
- Fehlt im Statblock die Zeile „Proficiency Bonus", wird der Übungsbonus aus dem CR abgeleitet
  (0–4 → +2, 5–8 → +3, … 29–30 → +9). Nennt der Text genau einen „spell save DC N", wird N als Save DC
  des NPCs übernommen (bei verschiedenen DCs keiner).
- Bestehende NPCs bekommen die Flächen-Tags beim nächsten **Parse**; es wird nichts automatisch
  umgebaut.
- Im Turm-Modus werden D&D-Schadenstypen **nicht** automatisch auf Elemente abgebildet. Sie stehen
  gelb markiert im Bogen (Karten zeigen „type not assigned"); ein Klick öffnet die Elementauswahl. Nicht zugeordnete
  Typen greifen bei Resistenzen nicht.

## Loot-Tabellen

Seitenleiste *Rolltables* → **„AP-Turm: Import table"** (nur Spielleiter). Text aus Word oder
Excel einfügen; Würfelbereiche, Gewichte, Lücken und Überlappungen zeigt die Vorschau, erzeugt wird
eine normale Foundry-RollTable.

Alternativ lässt sich im selben Dialog eine Datei laden (`.json` oder `.txt`):

- `.txt` läuft durch denselben Textparser wie eingefügter Text und bleibt im Textfeld editierbar.
- `.json` erkennt drei Formen: einen **Foundry-RollTable-Export** (Bereiche, Gewichte, Name und
  Formel aus der Datei, unbekannte Felder werden ignoriert), eine **einfache Liste** (Strings =
  Gleichverteilung, oder Objekte `{text, range, weight}`) und unser **eigenes Exportformat**
  (`format: "ap-turm-loot"`).
- Kaputtes JSON oder eine unpassende Struktur nennt den Grund im Dialog; es wird nichts angelegt.

## AP und Turmwissen vergeben

Seitenleiste *Actors* → **„AP-Turm"** → **„Award AP"**, **„Grant Turmwissen"** und **„Request Roll"**
(nur Spielleiter, dieselben Werkzeuge liegen als Makros im Ordner *AP-Turm*). Der eine Knopf trägt das
Systemsymbol und öffnet ein kleines Menü; GM-Einträge fehlen im Menü der Spieler, und bleibt für einen
Benutzer kein Eintrag übrig, fehlt der Knopf ganz.

- **Award AP:** Checkbox-Liste aller Charaktere (voreingestellt alle), ein AP-Wert (negativ für
  Korrekturen) und ein optionaler Anlass. Erhöht wird ausschließlich `system.ap.earned`; verdiente
  AP fallen nie unter 0.
- Danach geht eine Chat-Karte an alle: „The party gains 10 AP (Anlass)" und darunter je Charakter
  die Folgen aus `derived()` — Level-Up, neu verfügbare Milestones, gestiegener Übungsbonus, neue
  Cantrip-Stufe. **Nichts davon wird automatisch gesetzt:** Milestone-Wahl und Trefferwürfel bleiben
  am Bogen des Spielers.
- Ein noch nicht gewürfelter Trefferwürfel steht als offener Punkt im Bogen: Warnzeichen am Reiter
  *Level & Milestones*, dort die Zeile „Level 17: hit die not yet rolled" und die
  betroffenen HP-Felder farbig umrandet.
- Bei einer negativen Vergabe über eine Level-Schwelle zählen die Würfe oberhalb des neuen Levels
  nicht mehr mit, bleiben aber gespeichert. Steigt das Level wieder, gilt der alte Wurf erneut und
  es wird nichts als offen markiert.
- **Grant Turmwissen:** Checkbox-Liste (nur Charaktere im Modus *Turm*) und ein Auslöser. Bei
  jedem gewählten Charakter wird ein neuer Rang angehängt; die Karte „Turmwissen Rank N" geht per
  Flüstern nur an den Spielleiter und die betroffenen Spieler.

## Gruppen-Aufforderungen

Seitenleiste *Actors* → **„AP-Turm"** → **„Request Roll"** (nur Spielleiter, auch als Makro). Wurfart (Save /
Ability Check / Skill Check), der konkrete Wert, eine optionale DC und die Empfänger als
Checkbox-Liste. Sind Tokens anvisiert, sind deren Charaktere vorausgewählt, sonst alle.

- Ergebnis ist **eine** Chat-Karte an alle mit einer Zeile pro Charakter und einem **Roll**-Knopf.
- Der Klick würfelt mit den Boni und Zuständen des eigenen Charakters; dieselben Tasten wie am Bogen
  (Klick normal, Shift Vorteil, Strg Nachteil, Rechtsklick Dialog). Das Ergebnis ersetzt den Knopf,
  bei gesetzter DC mit SUCCESS/FAILURE. Die Detailkarte des Wurfs steht wie gewohnt im Chat.
- Knöpfe fremder Charaktere sind ausgegraut. Die Karte wird vom Würfelnden per `message.update`
  aktualisiert; fehlt ihm das Recht, übernimmt der aktive Spielleiter über den Socket.
- **Konsequenzen (nur mit DC):** der Abschnitt *On failure* im Dialog nimmt eine Schadensformel mit
  Schadenstyp (modusabhängige Liste), das Häkchen *half damage on success* (Standard an) und einen
  Status aus `CONFIG.statusEffects` (plus *Exhaustion +1*). Der Kopf der Karte nennt die Konsequenz:
  „DC 14 — on failure: 3d6 Poison, Poisoned".
- Der Schaden wird **einmal pro Empfänger** zusammen mit dessen Wurf gewürfelt und liegt als Knopf in
  der Zeile: bei Erfolg die Hälfte (oder nichts), bei Fehlschlag voll, angewendet mit Resistenzen und
  Immunitäten des Ziels. Ein gewählter Status wird bei Fehlschlag automatisch gesetzt (nötigenfalls
  über den Spielleiter-Socket) und in der Zeile vermerkt.
- Ein **automatischer Fehlschlag** (betäubt / paralysiert / bewusstlos bei STR- und DEX-Saves, gelesen
  ausschließlich an den Zuständen des würfelnden Actors) wird gar nicht gewürfelt: die Karte zeigt nur
  die Begründung. Kein Wurf setzt oder entfernt jemals einen Zustand.
- Ein Wert **gleich der DC ist ein Erfolg** (12 gegen DC 12 = SUCCESS); Angriff gegen AC ebenso.
- Bei Vorteil oder Nachteil zeigt die Karte **beide Würfel**, der gewertete ist hervorgehoben.

## Kampfübersicht

Knopf im Kopf des Kampf-Tracker (nur Spielleiter) oder das Makro **Combat Overview** im Ordner
*AP-Turm*. Ein schmales Fenster mit einer Zeile je Teilnehmer des laufenden Kampfes, in
Initiative-Reihenfolge; der Zug, der gerade dran ist, ist hervorgehoben.

- Je Zeile: Bild (Klick wählt den Token und schwenkt hin), Name (Klick öffnet den Bogen),
  Initiative, AC, Trefferpunkte als Feld mit Balken und temporären TP.
- Das TP-Feld nimmt einen **absoluten Wert** (`12`) oder eine **Änderung** (`+5`, `-3`) und schreibt
  über dieselben Pfade wie das Token-HUD, inklusive Status-Abgleich bei 0 TP.
- Aktive Zustände stehen als kleine Symbole daneben; ein Klick nimmt sie weg (Erschöpfung: Klick eine
  Stufe herunter, Rechtsklick eine herauf).
- Bei NPCs zusätzlich die legendären Zähler als klickbare Punkte und die Recharge-Fähigkeiten mit
  Zustand (Klick schaltet bereit/verbraucht um).
- **Ohne laufenden Kampf** listet das Fenster die Tokens der aktuellen Szene im selben Format, ist
  also auch vor dem ersten Initiativewurf brauchbar.
- Das Fenster ist in der Größe verstellbar, die Größe wird pro Client gemerkt. Änderungen an
  Trefferpunkten, Zuständen oder Effekten tauschen nur die betroffene Zeile aus, damit nichts flackert
  und ein Feld, in dem gerade getippt wird, den Fokus behält.

## Gegenstände übergeben

Nur **Gear** wechselt den Besitzer — Waffen und Feats sind personengebunden, Kristalle bleiben Sache
des Spielleiters.

- Entweder der Knopf **Give to…** in der Gegenstandszeile des Inventars, oder Drag & Drop vom eigenen
  Bogen auf einen anderen Charakter: auf dessen Bogen, auf sein Token oder auf seine Zeile in der
  Akteure-Liste.
- Bei einem Stapel (`qty > 1`) fragt ein Dialog die Stückzahl; der Rest bleibt beim Geber.
- Reihenfolge: erst beim Empfänger anlegen, dann beim Geber abziehen — nur wenn das Anlegen geklappt
  hat. Schlägt es fehl, bleibt das Original unverändert.
- Spieler geben nur vom eigenen Bogen. Gehört ihnen der Empfänger nicht, führt der aktive Spielleiter
  beide Schritte aus; ist kein Spielleiter online, passiert nichts und der Spieler bekommt eine
  Meldung. Chat-Zeile: „Gades gives Heiltrank ×2 to Markus."

## Loot einsammeln

Die Ergebnis-Karte eines RollTable-Wurfs bekommt pro Zeile einen Knopf **Claim**.

- Klick wählt den Empfänger (eigene Charaktere, beim Spielleiter alle) und legt den Ergebnistext als
  Gegenstand an — im Turm-Modus mit Herkunft *Found in the tower*.
- Ein Mengenpräfix setzt die Stückzahl („3 Heiltränke", „50 Goldmünzen", „3x Torch").
- Ein reiner Währungsbetrag in den Kürzeln des jeweiligen Modus wird stattdessen der Währung
  gutgeschrieben („50 GO", „20 gp", auch „50 GO, 20 SI"). Kürzel des anderen Modus zählen nicht.
- Danach ist der Knopf für alle deaktiviert („Claimed by Gades"). Normale Chat-Nachrichten bleiben
  unberührt.
- Der Spielleiter sieht den Empfänger-Dialog immer (auch bei nur einem Charakter) und kann dort
  **Also save to library** ankreuzen: Der Gegenstand landet zusätzlich in der Item-Bibliothek.

## Item-Bibliothek

Wiederkehrende Turm-Gegenstände liegen im Welt-Kompendium **AP-Turm Library**. Es entsteht beim ersten
Speichern durch den Spielleiter, gehört zur Welt und wandert mit dem Welt-Backup (kein System-Pack).

- **Hinein (nur Spielleiter):** Buch-Symbol **Save to library** an jeder Gegenstandszeile im Inventar,
  im Kopfmenü jedes Gegenstands-Bogens (auch auf NPCs und bei Welt-Items) und im Rechtsklick-Menü der
  Items-Seitenleiste. Gibt es den Namen schon (ohne Groß-/Kleinschreibung), fragt ein Dialog
  *Replace / Save as copy / Cancel*; die Kopie heißt „Name (2)", „Name (3)" …
- **Heraus:** Kompendium öffnen und den Eintrag auf einen Bogen ziehen, oder im Inventar-Tab
  **From library** — Suchfeld, Klick legt den Gegenstand an. Alle Felder (Menge, Notizen, Ladungen,
  Aufladung, Herkunft) bleiben wie gespeichert.
- Spieler haben Lesezugriff (Observer) und nutzen *From library* für den eigenen Bogen.

## Shop-Editor: eigene Einträge (Spielleiter)

Eigene Point-Buy-Einträge für die Welt. Öffnen über **Shop editor** oben im Shop-Tab (nur für den
Spielleiter sichtbar) oder das Menü *AP-Turm* in der Actors-Seitenleiste → **Shop Editor**.

- **Eintrag:** Name, Kategorie (bestehende oder neue), Beschreibung, Kostenleiter (z. B. `10, 20, 30`),
  Multiplikator für weitere Ränge (Standard 2), Max-Ränge (leer = wie die eingebauten Einträge),
  Voraussetzungen (Mehrfachauswahl; alle müssen gekauft sein) und optional eine Wahl beim Kauf
  (Attribut, Skill, Rettungswurf oder Schadenstyp/Element je nach Modus).
- **Wirkungen** (beliebig viele, Werte pro Rang): +N auf Attribut (fest oder gewählt), Save, Skill,
  AC, Initiative, Speed, HP-Max, Passive Perception; Vorteil auf gewählten Skill/Save; Proficiency in
  gewähltem Skill/Save oder einer Rüstungs-/Waffengruppe; **Ressourcen-Pool** (Zahl oder Formel mit
  `earned`/`level`, z. B. `earned/5`, Reset bei kurzer oder langer Rast — erscheint in der
  Resources-Leiste mit −/+); +N Zauberpunkte; +N Wirkungen eines Rangs 6–9; +Nd6 Schaden im beim Kauf
  gewählten Element (zusätzlich zu Elemental Damage); reiner Text (erscheint unter Features & Abilities).
- Die eingebaute Regelrechnung bleibt, wie sie ist: Attributsboni unterliegen derselben Endwert-Kappe 20
  (+2 je Limit Break) und wirken über den Modifikator auf HP, Saves und Co.
- Custom-Einträge tragen IDs mit `c_`, stehen im Shop-Tab in ihrer Kategorie (mit ★) und verhalten sich
  beim Kaufen/Verkaufen wie eingebaute (AP-Prüfung, Voraussetzungen, History, Features-Liste). Eingebaute
  Einträge sind im Editor nicht änderbar.
- **Export / Import** der Liste als JSON-Datei, um Einträge in andere Welten mitzunehmen (gleiche ID
  ersetzt, neue kommen dazu, defekte werden übersprungen).
- **Löschen** warnt, wenn Charaktere den Eintrag gekauft haben, und nennt sie. Ihr Kauf bleibt in den
  Daten, wirkt aber nicht mehr, und die AP zählen wieder als frei.
- **Nur in Foundry:** Der App-Export schreibt Custom-Käufe mit ihren `c_`-IDs mit; die HTML-App kennt sie
  nicht und ignoriert sie. Beim Import zurück nach Foundry bleiben sie erhalten.
- Ein defekter Eintrag (z. B. aus einer kaputten Importdatei) wird beim Laden übersprungen und in der
  Konsole gemeldet; der Bogen funktioniert weiter.

## Traglimit (Turm-Modus)

Im Inventar-Tab stehen die Gegenstände getrennt nach Herkunft: *Carried in* (von außen mitgebracht) und
*Found in tower*. Nur die Turmfunde haben einen Zähler („Found in tower 3/5"): Beim **Wiederbetreten**
des Turms dürfen höchstens 5 Turmfunde mit hinein. Während eines Runs ist die Menge unbegrenzt,
mitgebrachte Gegenstände sind es immer, die 5 Kristalle im Kristallreif zählen nie. Über 5 wird der
Zähler als Hinweis markiert; nichts wird blockiert. Geclaimter Loot zählt als Turmfund.

## NPC-Gegenstände

Der Stats-Tab des NPC-Bogens hat eine einklappbare Box **Items** (anfangs zu, der Kopf zeigt die
Anzahl). Sie listet alle eingebetteten Items flach: Name, Menge, Notiz (gekürzt, voller Text im
Tooltip), Bearbeiten, Löschen und für den Spielleiter *Save to library*. Darunter **+ Add item** und
**From library**. Auf den NPC gezogene Items erscheinen hier. Kein Traglimit, keine Herkunftsgruppen.

## Treffer-Feedback und Animationen

- **Apply to target** und die TP-Knöpfe zeigen über dem Token eine aufsteigende Zahl (~1,5 s):
  im Turm-Modus in der Elementfarbe des Schadenstyps, sonst neutral; Crits größer und fett,
  Heilung grün mit Plus, von temporären TP geschluckter Schaden grau. Dazu blitzt der Token kurz
  auf und wackelt (Schaden) bzw. pulsiert grün (Heilung). Alle Clients sehen es; verdeckte Token
  nur der Spielleiter. Abschaltbar über *Show hit feedback*.
- **Mit JB2A (Free oder Patreon) und Sequencer** kommen Animationen dazu: Nahkampf-Hieb bzw. -Stich
  vom Angreifer zum Ziel (bei Fehlschlag daneben), Fernkampf und Zauber mit Ziel als Projektil,
  Zauber ohne Ziel als kurzer Cast-Effekt am Wirker. Ein Crit legt einen großen Impact auf das Ziel.
  Die Waffe wird am Namen erkannt (Speer, Zweihänder, Bogen, Armbrust …). Fehlen die Module, läuft
  alles wie ohne sie. Fehler in den Animationen blockieren nie Wurf oder Schaden.
- Elemente ohne eigene JB2A-Animation bekommen die nächstliegende, eingefärbt in der Elementfarbe;
  die Zuordnung steht in `module/fx-map.mjs`. Im AP-Modus gelten die JB2A-Standardfarben.

## Komfortfunktionen am Tisch

- **Undo:** Jede Zeile „… hits …" nach *Apply to target* hat einen Knopf **Undo** (sichtbar für den
  Spielleiter und den, der den Schaden angewendet hat). Er setzt TP und temporäre TP auf den Stand davor,
  nimmt den dadurch gesetzten Automatik-Zustand (bewusstlos / tot) wieder weg und holt einen dabei
  entfernten NPC-Token samt Kampf-Eintrag zurück. Danach steht „undone" in der Zeile; Undo geht nur einmal.
  Spieler brauchen dafür einen Spielleiter online, wenn ihnen das Ziel nicht gehört oder ein Token
  zurückgeholt werden muss.
- **„Your turn":** Beim Zugwechsel bekommt der Besitzer des aktiven Tokens ein Banner („Your turn — Gades")
  und einen kurzen Klang, der Besitzer des nächsten Tokens eine kleine Vorwarnung („Next: schmock").
  Der Spielleiter bekommt nichts.
- **Token-Tooltip:** Kurz über einem Token verweilen zeigt TP/Temp, RK, Zustände, Element und bei NPCs
  Legendary-Zähler und Recharge-Stand. Spieler sehen die Werte nur bei Tokens, die sie beobachten dürfen;
  bei fremden NPCs nur Name und Zustands-Symbole.
- **Anzeigename für NPCs:** Feld *Display name* im NPC-Kopf. Ist es gesetzt, sehen Spieler diesen Namen auf
  Chat-Karten (Angriff, Schaden, Rettungswurf, besiegt), als Absender, im Kampf-Tracker (beim Anlegen des
  Eintrags) und im Tooltip; der Spielleiter sieht überall den echten Namen. Die Namensanzeige am Token selbst
  steuert Foundrys Token-Einstellung *Display Name* — für versteckte Namen dort z. B. „Owner" oder „Never"
  wählen. Die Verbergung ist eine Anzeige, kein Schutz: der echte Name steht in den Nachrichtendaten.
- **Roll NPC initiative:** Drachen-Symbol im Kopf des Kampf-Trackers (Spielleiter). Würfelt für alle
  NPC-Einträge ohne Initiative; Spielercharaktere bleiben unberührt.
- **History:** Einklappbare Box auf dem Tab *Level & Milestones*: AP-Vergaben (Datum, Betrag, Anlass, von wem)
  und Shop-Käufe/-Verkäufe (Eintrag, Rang, Kosten bzw. Erstattung). Höchstens 200 Einträge; die Liste beginnt
  mit diesem Update, ältere Vorgänge werden nicht nachgetragen.
- **Konzentration:** Häkchen *Concentration* am Zauber. Beim Wirken bekommt der Wirker den Zustand
  *Concentrating* (ohne Wirkung auf Würfe); ein zweiter Konzentrationszauber ersetzt den ersten mit Hinweis
  im Chat. Schaden über *Apply to target* schickt eine CON-Save-Karte (DC = max(10, halber Schaden));
  misslingt der Wurf, endet die Konzentration („Concentration broken"). Nach dem ersten Wurf ersetzt das
  Ergebnis den Knopf — die Karte lässt sich nicht noch einmal würfeln.

## Jukebox (Spielleiter)

Ein Musikpult auf Foundrys eigenen Playlists: Alles läuft über die normale Playlist-Wiedergabe, die Daten
bleiben normale Playlists, die Playlists-Seitenleiste funktioniert unverändert weiter. Öffnen über den
eigenen Eintrag **AP-Turm Jukebox** (Schallplatten-Symbol) ganz unten in der linken Werkzeugleiste — er
öffnet nur das Fenster, die aktive Ebene bleibt, wie sie ist — oder das Makro *Jukebox* im Ordner „AP-Turm".

Das Fenster ersetzt die Playlists-Seitenleiste vollständig: oben Transport, Moods und Soundboard, darunter die
Bibliothek mit eigenem Scrollbereich. Mindestgröße 460 × 460; unter 700 px Höhe klappen Moods und Soundboard
zuerst ein (per Klick auf die Überschrift wieder auf). Der Auf-/Zu-Zustand von Moods, Soundboard und jeder
Playlist wird pro Browser gespeichert.

- **Now Playing:** laufende Playlist und Track mit Fortschritt, Pause/Fortsetzen, Stop und **Fade out**
  (~2 s ausblenden, dann stoppen). Bei sequenziellen und Shuffle-Playlists zusätzlich:
  - **Zurück / Weiter** (am Anfang bzw. Ende je nach Repeat: umlaufen oder stoppen).
  - **Up next:** der tatsächlich nächste Track aus Foundrys Wiedergabereihenfolge, bei Shuffle also der echte
    Nachfolger; ohne Repeat am Ende „— (end of playlist)".
  - **Repeat** (Standard an = Foundrys eigenes Verhalten): aus = die Playlist stoppt nach dem letzten Track.
    Gespeichert als Flag `ap-turm.noRepeat` an der Playlist.
  - **Shuffle** schaltet den Modus der Playlist zwischen sequenziell und zufällig; der laufende Track spielt weiter.
- **Fortschrittsleiste anklicken** springt an diese Stelle, bei allen Spielern gleichzeitig.
- **Lautstärke, zwei Ebenen:** Der Regler im Transport ist die Playlist-Lautstärke (= lautester Track); ihn zu
  bewegen skaliert alle Tracks im selben Verhältnis. Jeder Track hat zusätzlich seinen eigenen Regler in der
  Bibliothek. Beides hören alle Spieler so; die persönliche Lautstärke stellt jeder in Foundrys Audio-Einstellungen ein.
- **Moods:** Kacheln für Playlists. *+ Add mood* wählt Playlist, Beschriftung, Farbe, optional ein
  FontAwesome-Icon (z. B. `fa-dragon`) und das Häkchen *Combat*. Kacheln lassen sich bearbeiten, per Drag
  umsortieren und löschen — gelöscht wird nur die Kachel, nie die Playlist. Klick = Überblendung (die laufende
  Musik blendet in ~2 s aus, die neue ein); Klick auf die aktive Kachel pausiert bzw. setzt fort.
  Die Überblendung nutzt Foundrys Fade-Dauer der Playlist; hat eine Playlist keine, setzt die Jukebox sie
  beim ersten Einsatz auf 2 s (sichtbar in der Playlist-Konfiguration).
- **Soundboard:** Die Sounds der Playlist „Soundboard" (Groß-/Kleinschreibung egal) erscheinen als kleine
  Knöpfe; ein Klick spielt den Sound einmal über der laufenden Musik. Die Playlist wird dafür auf Foundrys
  Modus *Soundboard Only* gestellt.
- **Import folder as playlist:** Ordner wählen → neue Playlist mit allen Audiodateien (mp3, ogg, wav, webm,
  flac), alphabetisch, sequenziell oder zufällig (*Shuffle*). Gibt es den Namen schon: ergänzen (ohne
  Duplikate), neu anlegen („Name (2)") oder abbrechen. Ein Ordner namens „Soundboard" wird direkt zum Soundboard.
- **Import from computer:** Musik von irgendwo auf dem PC — der Browser-Dialog wählt einen ganzen Ordner
  (mit Unterordnern) oder einzelne Dateien. Die Audiodateien werden nach `Data/music/<Playlistname>/`
  hochgeladen (nur so kann der Server sie allen Spielern ausliefern) und als Playlist angelegt; gleiche
  Namens- und Shuffle-Logik wie oben. Anzeige „file X of Y"; Dateien, die nicht hochgeladen werden konnten,
  stehen am Ende gesammelt in einer Meldung, die übrigen werden trotzdem übernommen.
- **Drag & Drop:** Audiodateien oder einen Ordner aus dem Explorer aufs Jukebox-Fenster ziehen — danach
  derselbe Ablauf (Name, Shuffle, Upload).
- **Bibliothek:** alle Playlists außer dem Soundboard als aufklappbare Liste.
  - **Kopf:** Name, Anzahl Tracks, Play/Pause (Überblendung wie eine Kachel), ⋮ bzw. Rechtsklick für
    *Rename*, *Add file…*, *Create mood tile* und *Delete* (mit Rückfrage; die Audiodateien bleiben auf der Platte).
  - ***Add file…*** fügt eine Datei aus Foundrys Datenordner hinzu (Dateiauswahl) oder lädt Dateien vom PC nach
    `Data/music/<Playlistname>/` hoch.
  - **Tracks:** Name, Dauer, Play (genau dieser Track, mit Überblendung von der laufenden Musik), Markierung des
    laufenden Tracks, eigener Lautstärkeregler (bleibt gespeichert), ⋮/Rechtsklick für *Rename* und *Delete*.
  - **Verschieben:** Einen Track am Namen ziehen und auf einen anderen Track (davor einsortieren) oder auf einen
    Playlist-Kopf (ans Ende) fallen lassen, innerhalb einer Playlist zum Sortieren, auf eine andere Playlist zum
    Verschieben. Eine von Hand sortierte Playlist steht danach auf Foundrys manueller Sortierung.
  - **Suche** über Playlist- und Tracknamen (alle Wörter, beliebige Reihenfolge); Playlists mit Treffern in
    Tracks klappen auf.
  - ***+ New playlist*** legt eine leere Playlist an (sequenziell, 2 s Fade).
- Alle Änderungen, auch aus der nativen Seitenleiste oder von einem anderen Spielleiter, erscheinen sofort, ohne
  dass Suche, Scrollposition oder aufgeklappte Playlists verloren gehen.
- **Kampfmusik** (Setting *Combat music*): Bei Kampfbeginn blendet die Jukebox auf die Kachel mit *Combat*
  über und merkt sich, was vorher lief; wird der Kampf beendet, blendet sie zurück. Hat der Spielleiter während
  des Kampfes selbst gewechselt, bleibt seine Wahl stehen.

## Party Stash

Ein gemeinsamer Beute-Ort der Gruppe: ein eigener Akteur-Typ `stash`, den alle Spieler besitzen. Die
Spielleitung legt ihn beim ersten Gebrauch an (Claim in den Stash, Übergabe an den Stash oder *Actors* →
**AP-Turm** → **Party Stash**).

- Sheet: Kasse in den Währungen des Modus (KU … ED bzw. cp … pp), Gegenstandsliste ohne Traglimit,
  **From library** für die Spielleitung.
- **Claim:** Im Empfängerdialog einer Loot-Karte steht der Stash an erster Stelle, auch für reine
  Geldbeträge (landen in der Stash-Kasse).
- **Nehmen:** **Take** an der Zeile (bei Stapeln mit Anzahl) oder den Gegenstand auf den **eigenen** Bogen
  ziehen; Chat: „Gades takes 2× Heiltrank from the Party Stash." Wer den Stash nicht besitzt, bekommt den
  Gegenstand über den aktiven Spielleiter.
- **Hineinlegen:** wie jede Übergabe (*Give to…* oder Drag auf Stash-Sheet/-Token).
- Gegenstände „im Turm gefunden" im Stash zählen bei niemandem auf die persönliche 5er-Grenze.
- **Achtung beim Update auf diese Version:** Neue Akteur-Typen liest der Server nur beim Weltstart ein.
  Nach dem Einspielen die Welt einmal über *Return to Setup* beenden und neu starten.

## Mehrere Kopien setzen (Place copies)

Rechtsklick auf einen NPC in der Actors-Liste → **Place copies** oder derselbe Eintrag im Drei-Punkte-Menü
des NPC-Bogens (nur Spielleitung). Anzahl 1–20; die Tokens landen in einem Raster um die Bildmitte, freie
Felder zuerst, unverknüpft mit eigenen HP. *Number the tokens* nummeriert „Gnoll 1…N" (ein Anzeigename
wird mitnummeriert). Läuft ein Kampf, trägt *Add to combat* sie in den im Tracker angezeigten Kampf ein,
ohne Initiative; der NPC-Initiative-Knopf würfelt sie.

## Reichweiten-Ring

Beim Auswählen eines Tokens (Spieler: die eigenen, Spielleitung: alle) erscheint ein dezenter Ring in
Reichweite, gemessen vom Token-Rand: Charakter = längste Reichweite der ausgerüsteten Waffen (neues Feld
**Reach (ft)** an Waffen, Standard 5), NPC = längste Nahkampf-Reichweite seiner Angriffe (aus dem
Statblock, z. B. „reach 10 ft."). Nur das zuletzt ausgewählte Token zeichnet. Client-Setting *Show reach
ring* (Standard an). Eine Reichweite ungleich 5 wird beim App-Export mitgeschrieben und beim Import
wieder gelesen.

## Zauber- und Monster-Kompendien (Import aus dnd5e)

Zauber und Kreaturen aus dnd5e-Kompendien auf der eigenen Festplatte, **inhaltlich unverändert** übernommen: keine
Turm-Anpassung, keine Umrechnung. Konvertiert wird nur die Dokumenthülle, weil dnd5e-Dokumente in diesem System
nicht laden.

**Ein Kompendium pro Quelle:** „Spells — SRD 2014", „Spells — SRD 2024", „Spells — DDB terra-nova" und
„Monsters — SRD 2014", „Monsters — SRD 2024", „Monsters — DDB terra-nova". Jede Quelle wird vollständig
importiert; gleichnamige Einträge gibt es bewusst mehrfach, je Fassung in ihrem Kompendium, gewählt wird von Fall zu
Fall. Übersprungen werden nur Dubletten *innerhalb* einer Quelle (die DDB-Packs enthalten manche Namen mehrfach).

1. **Pakete erzeugen** (einmalig, auf dem Foundry-Rechner): `node tools/dnd5e-extract.mjs`. Das Skript liest *Kopien*
   der Packs (Foundrys mitgeliefertes `classic-level`, wie die foundryvtt-cli), konvertiert und schreibt je Quelle
   `Data/ap-turm-import/spells-<quelle>.json` und `monsters-<quelle>.json`. Die Quellen stehen oben im Skript
   (`SOURCES`), ihre Namen und Tags in `LIBRARY_SOURCES` (`module/dnd5e-convert.mjs`).
2. **In der Welt importieren:** *Actors* → **AP-Turm** → **Import dnd5e libraries** (nur Spielleitung). Der Dialog
   zeigt jede gefundene Quelle mit Häkchen (Standard: alle). Import in Stapeln mit Fortschrittsanzeige; ein
   fehlschlagendes Dokument wird übersprungen; ein wiederholter Import einer Quelle ergänzt nur Fehlendes. Der
   Bericht (je Kompendium: Anzahl, Übersprungene, Bilder) kommt als Flüsternachricht.

**Zauber** (Spell-Kompendien, Spieler dürfen lesen): Ein Zauber trägt seinen vollständigen dnd5e-Text im Feld
**Description**: Schule und Grad, Casting Time, Range, Components samt Material, Duration, Konzentrations- und
Ritual-Markierung, Beschreibung, „At Higher Levels". Der Grad wird zum Rang (0 = Cantrip), das Konzentrations-Häkchen
wird übernommen, das Element bleibt leer. Auf den Bogen per Drag aus einem Kompendium oder **From library** in der
Spells-Box: Die Suche läuft über alle Spell-Kompendien zusammen, jede Trefferzeile zeigt ihre Quelle als Tag
(„Fireball · SRD 2014", „Fireball · DDB"). Die Zauberkarte zeigt die Kopfdaten immer und den Text einklappbar. Der
App-Export schreibt die Description nicht mit; beim Re-Import einer App-JSON behalten vorhandene Zauber ihre
Description (Abgleich Name + Grad).

**Kreaturen** (Monster-Kompendien, nur Spielleitung, je mit Ordnern CR 0–4 / 5–10 / 11–16 / 17+): Werte aus den
*strukturierten* dnd5e-Daten, nicht über den Text-Parser.
- **Übernommen:** Typ-Zeile, CR, PB, AC, HP (Formel in den Notes), alle Bewegungsarten, Attribute, Save- und
  Skill-Boni, Sinne, Sprachen, Resistenzen, Immunitäten und Verwundbarkeiten samt Zustands-Immunitäten sowie
  Legendary-Zähler.
- **Aktionen:** Einträge nach der dnd5e-Aktivierung (Traits, Actions, Bonus, Reactions, Legendary mit Kosten, Lair),
  mit Trefferbonus, Schaden, Save, Recharge, x/Day und Fläche für den Template-Knopf.
- **Zauberwirkende Kreaturen:** Die Zauberliste steht als Trait „Spellcasting (spell list)".
- **Texte:** dnd5e-Enricher (`[[/attack]]`, `[[/damage average]]`, `[[lookup @name]]` …) werden so ausgeschrieben, wie
  dnd5e sie anzeigt.
- **Modusregel:** Schadenstypen bleiben die dnd5e-Schlüssel, also im Modus *turm* „nicht zugeordnet" (gelb) und
  im Modus *ap* 1:1.
- **Bilder:** Pfade in Foundry und Web-Adressen (z. B. D&D-Beyond-Avatare) bleiben erhalten; ist ein Webbild später
  nicht mehr erreichbar, zeigt Foundry das Standardbild. Welt-lokale Bilder werden nach
  `Data/ap-turm-import/images` kopiert; fehlende Dateien ersetzt das Standardbild (steht im Bericht). Die meisten
  DDB-Bilder sind **Dateien im eigenen Data-Ordner** (`Data/ddb-images/…`, vom DDB-Importer), keine Web-Adressen;
  beim Übertragen reisen sie deshalb in der Bundle-Zip mit (siehe unten).

### Bibliotheken auf eine andere Installation übertragen

Der Empfänger braucht weder dnd5e noch `tools/`, nur das System.

- **Absender:** *Actors* → **AP-Turm** → **Import dnd5e libraries** → **Export bundles**. Heruntergeladen wird
  `ap-turm-libraries.zip` mit allen Bundles (`ap-turm-import/spells-<quelle>.json`, `monsters-<quelle>.json`) und allen
  lokalen Bildern, die sie verwenden. Fehlt ein Bundle auf der Platte, schreibt der Export es vorher aus dem
  Welt-Kompendium zurück nach `Data/ap-turm-import` — der Export funktioniert also auch ohne die Dateien des
  Extraktionsskripts. Bericht als Flüsternachricht (Einträge je Kompendium, Bilder, Größe, zurückgeschriebene Dateien).
- **Bilder in der Zip:** Web-Adressen und Foundrys Kern-Icons (`icons/…`) reisen nicht mit, sie sind überall da.
  Dateien im Data-Ordner (`ddb-images/…`, `tokenizer/…`, `ap-turm-import/images/…`) behalten ihren Pfad. Bilder aus
  einem anderen System, Modul oder einer Welt (z. B. `systems/dnd5e/tokens/…`) gäbe es beim Empfänger nicht; sie
  werden nach `ap-turm-import/images/systems/dnd5e/…` verlegt, das Bundle in der Zip zeigt auf den neuen Ort. Mit den
  DDB-Monstern ist die Zip deshalb gut 600 MB groß.
- **Empfänger:** *Actors* → **AP-Turm** → **Import from bundle file** (oder derselbe Knopf im Dialog *Import dnd5e
  libraries*) → `ap-turm-libraries.zip` wählen; einzelne Bundle-JSONs gehen auch, mehrere auf einmal. Zuerst werden
  die Bilder an ihren Platz im Data-Ordner gelegt (eine schon vorhandene Datei gleicher Größe bleibt unangetastet),
  dann entstehen dieselben getrennten Kompendien wie beim Quellen-Import: gleiche Rechte, CR-Ordner, Quell-Tags.
  Ein zweiter Import ergänzt nur Fehlendes. Bericht als Flüsternachricht.

## Anleitung für die Spielleitung

`ap-turm-gm-guide.pdf` (neben der Zip) ist eine bebilderte Anleitung für neue Spielleitungen, erzeugt
aus `docs/gm-guide/index.html`; das Kapitel „Libraries übernehmen" beschreibt Export und Import der Bibliotheken.
Die PDF gehört nicht in die System-Zip.

## Übergabepaket

`npm run handover` legt `Data/ap-turm-handover/` an mit allem, was eine neue Spielleitung braucht:

- `ap-turm-v<version>.zip` — das System (frisch gebaut wie mit `npm run package`),
- `ap-turm-libraries.zip` — die Bibliotheken, gebaut aus `Data/ap-turm-import` wie *Export bundles* (ein fehlendes
  Bundle oder Bild steht am Ende als Hinweis; einmal in Foundry *Export bundles* ausführen schreibt fehlende Bundles
  aus den Kompendien zurück),
- `ap-turm-gm-guide.pdf` — die Anleitung,
- `HANDOVER.txt` — fünf Schritte vom Entpacken bis zum Charakter-Import.

Der Ordner wird bei jedem Lauf neu befüllt.

## Regelreferenz (Journal „AP-Turm Rules")

Beim ersten Weltstart legt das System (der aktive Spielleiter) das Journal **AP-Turm Rules** an. Seine Seiten
werden aus den Code-Tabellen und Formeln erzeugt, nicht von Hand gepflegt; jede Zahl kommt aus derselben
Rechnung wie auf den Bögen:

- **Progression:** Level-, PB-, Milestone- und Cantrip-Schwellen, Point-Buy (6–18, Summe 72, Kappe 20,
  Limit Break), Zauber-SG, Lay on Hands, Hit-Die-Leiter, Rüstungstabelle.
- **Shop:** alle Kategorien mit Kostenleiter, Max-Rängen, Voraussetzungen und Wahl beim Kauf, inklusive der
  eigenen Einträge aus dem Shop-Editor (★).
- **Elements & Damage:** die 20 Elemente mit Farbe, die Modusregel, Resistenz/Immunität/Verwundbarkeit.
- **Conditions:** jeder Zustand mit seiner Wirkung auf die Würfe, Erschöpfungstabelle.
- **Combat & Rest:** Crits, Vorteil/Nachteil-Verrechnung, Todesrettungswürfe, was kurze und lange Rast
  zurücksetzen, Turmregeln (Traglimit/Wiedereintritt, Kristallreif, Turmwissen, Währungskurse).

Spieler haben Lesezugriff. Das Journal wird automatisch neu erzeugt, sobald sich der Inhalt ändert
(Systemupdate, Änderung im Shop-Editor), und auf Wunsch über *Actors* → **AP-Turm** → **Rebuild rules journal**.
Handänderungen am Journal werden dabei überschrieben (Hinweis auf der ersten Seite).

## Gesamt-Backup

*Actors* → **AP-Turm** → **Export all characters** (nur Spielleiter): Alle Charaktere werden als einzelne
App-JSONs (`ap_<name>_<datum>.json`, gleiche Namen bekommen `_2`, `_3` …) in einer Zip
`ap-turm-characters_<datum>.zip` heruntergeladen; der Spielleiter bekommt eine Flüsternachricht mit der Anzahl.
Foundry v13 bringt im Browser keine Zip-Bibliothek mit, die Zip schreibt das System selbst (ohne Kompression,
mit jedem Entpacker lesbar). Zurück geht jede Datei über den normalen Einzelimport.

## Tastenkürzel

Unter *Configure Controls* → *AP-Turm* einstellbar; in Textfeldern greifen sie nie.

| Aktion | Standard | Wer |
|---|---|---|
| Kampfübersicht öffnen/schließen | O | Spielleiter |
| Jukebox öffnen/schließen | J | Spielleiter |
| Zustandsleiste ein/aus | — | alle (außer die Leiste ist auf Spielleiter beschränkt) |
| Award AP | — | Spielleiter |
| Request Roll | — | Spielleiter |

Spielleiter-Kürzel tauchen bei Spielern in *Configure Controls* nicht auf und tun für sie nichts, auch keine Meldung.

## Würfe und Mehrspielerbetrieb

- Klick = normal, **Shift** = Vorteil (`2d20kh1`), **Ctrl/Alt** = Nachteil (`2d20kl1`),
  **Rechtsklick** = Dialog mit situativem Bonus. Alle Würfe sind echte `Roll`-Objekte und damit
  Dice-So-Nice-tauglich.
- Angriffe vergleichen gegen die AC des anvisierten Tokens (`game.user.targets`), Crit-Bereich und
  maximierte Crit-Würfel kommen aus den Käufen.
- **Apply to target** rechnet Resistenz, Immunität, Verwundbarkeit und temporäre TP ein. Gehört
  das Ziel dem Spieler nicht, übernimmt der aktive Spielleiter die Anwendung über den System-Socket.
  Ist kein Spielleiter online, passiert nichts und der Spieler bekommt eine Meldung.
- Rettungswurf-Karten zeigen pro Ziel einen Knopf. Jeder Spieler würfelt auf seinem eigenen Token;
  Knöpfe fremder Token sind ausgegraut.
- Aktionen, die schreiben (Shop, Rasten, Items, Zustände), laufen nur mit Besitzrecht und melden
  sonst verständlich, dass das Dokument nicht dem Nutzer gehört.
- **Zustand bei 0 TP:** Jede Änderung der Trefferpunkte gleicht den Zustand ab, egal über welchen Weg
  sie geschrieben wurde (Feld im Bogen, Token-HUD, Kampfübersicht, Rast, Schaden). Bei 0 TP setzt das
  System *bewusstlos* (Charaktere) bzw. *tot* (NPCs), über 0 nimmt es sie wieder weg — aber nur, wenn
  es sie selbst gesetzt hat. Vom Spielleiter von Hand gesetzte Zustände bleiben in jedem Fall stehen.
  Zustände aus der Zeit vor dieser Änderung tragen die Markierung nicht und gelten deshalb als von
  Hand gesetzt.

## Bekannte Grenzen

- Keine System-Kompendien: Ausrüstung, Zauber und Gegner werden importiert oder von Hand angelegt; die
  Item-Bibliothek und die Zauber-/Monster-Bibliotheken sind Welt-Kompendien. Der Shop ist eine Code-Tabelle
  (`module/config.mjs`).
- Fernkampf erkennt die Animation am Waffennamen, am Reichweitentext von NPC-Aktionen oder an DEX
  als Waffenattribut. Eine ungewöhnlich benannte Fernkampfwaffe mit STR zeigt einen Nahkampf-Hieb.
- Der Statblock-Parser deckt die üblichen Layouts ab, aber nicht jede Formatierung. Was er nicht
  erkennt, bleibt als Text im Eintrag stehen und lässt sich im Bogen nachtragen.
- Im Turm-Modus bleiben importierte D&D-Schadenstypen bis zur Zuweisung durch den Spielleiter ohne
  Wirkung auf Resistenzen. Das ist Absicht.
- Active Effects werden nicht ausgewertet: Feat-Boni werden wie in der App summiert
  (`prepareDerivedData`), nicht als Effekte verteilt.
- Die Migration schreibt alte Feldformen nur bei Actors und Items der Welt zurück. Nicht verknüpfte
  Tokens auf Szenen behalten ihre Kopie; sie funktionieren weiter, weil die Datenmodelle alte Formen
  bei jedem Laden übersetzen, werden aber im Migrationsbericht nur gezählt.
- Der System-Socket vertraut dem eigenen Spieltisch: Eine Schadensanfrage eines Spielers prüft
  Ziel und Betrag auf Plausibilität, aber nicht auf Berechtigung im Sinne eines Schutzes gegen
  manipulierte Clients.
- Getestet mit Foundry 13.351. Ältere v13-Builds sollten laufen (`minimum: 13`), sind aber nicht
  geprüft; v12 und früher nicht.

## Entwicklung

```
npm test         # Node-Tests: Regeln gegen die HTML-App, Import/Export-Rundlauf, Parser, Migration, Bundles
npm run package  # baut ap-turm-v<version>.zip (ohne test, docs, tools, node_modules)
npm run handover # Übergabeordner Data/ap-turm-handover (System-Zip, Bibliotheken-Zip, PDF, HANDOVER.txt)
npm run release -- x.y.z  # GitHub-Release, siehe Release-Ablauf
```

`ap-character-sheet.html` ist die Quelle der Wahrheit für Regeln und Formeln; die Tests laden sie und
vergleichen `module/rules.mjs` Wert für Wert dagegen. `test/gen-config.mjs` erzeugt
`module/config.mjs` neu aus der App, damit die Tabellen kopiert und nicht abgetippt sind.

## Release-Ablauf

Jede Änderung, die beim Spielleiter ankommen soll, endet mit einem Release:

1. Änderungen committen; `npm test` muss grün sein.
2. In `CHANGELOG.md` eine Sektion `## x.y.z` mit den Änderungen anlegen und committen.
3. `npm run release -- x.y.z`

Das Skript (`tools/release.mjs`) bricht ab, wenn das Arbeitsverzeichnis nicht sauber ist, die Version nicht größer als
die aktuelle ist, der Tag `vx.y.z` schon existiert oder die CHANGELOG-Sektion fehlt. Sonst setzt es die Version in
`system.json`/`package.json`, schreibt die Download-URL auf `releases/download/vx.y.z/ap-turm.zip` um, baut
`ap-turm.zip` (nur `system.json`, `module/`, `templates/`, `styles/`, `lang/`, `icons/`, `README.md`, `LICENSE`),
committet „Release vx.y.z", setzt den Tag, pusht und legt mit `gh` das GitHub-Release mit `ap-turm.zip` und
`system.json` an. Foundry findet das Update über die Manifest-URL (`releases/latest/download/system.json`).

**Achtung auf dem Entwicklungsrechner:** Dieser Ordner ist das Git-Repo. Hier im Foundry-Setup **nicht** auf
„Update" klicken — Foundry würde den Ordner durch den Inhalt des Release-Zips ersetzen.

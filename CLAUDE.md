# MapmakerBT — Projekt-Gedächtnis

> Diese Datei ist **nicht** im Git-Repo (steht in `.gitignore`). Vor jeder neuen Aufgabe komplett lesen,
> danach kurz und stichpunktartig aktuell halten.

## Regeln (vom Nutzer gesetzt, verbindlich)

1. **Niemals `git commit` oder `git push`** — unter keinen Umständen.
2. Tokensparend arbeiten: kurze, präzise Antworten; keine Abstriche bei Code-Qualität.
3. Vor jeder Aufgabe zuerst diese `CLAUDE.md` lesen, danach aktualisieren (kein Aufblähen).
4. `Sunray/esp32_ble/esp32_ble_platformio` (bzw. `/home/penis/projects/MeinSunray/…`) darf **gelesen**,
   aber **nicht verändert** werden.

## Projektüberblick

- **Was:** MapCreator für Ardumower — statische PWA zur Aufnahme und Pflege von Mähkarten
  (Perimeter, Ausschlussflächen, Dockpunkte) eines Ardumower/Sunray über **Web Bluetooth**.
- **Repo:** `github.com/Algo-giti/MapmakerBT`, deployed über GitHub Pages.
- **Lokal:** `/home/penis/projects/MapmakerBT` (Branch `main`/master, letzter Commit `1cd3c2d v16`).
- **Zielplattform:** Android + Chrome (Web Bluetooth). iOS/iPadOS wird nicht unterstützt (kein Web Bluetooth).
- **Sprachen:** DE/EN umschaltbar, DE ist Standard.
- **Kein Karten-Upload zu Sunray** — die App erzeugt nur Karten-Dateien (JSON/GeoJSON).
- Bisher mit ChatGPT entwickelt; Code ist entsprechend gewachsen (eine große `app.js`).

## Architektur

Kein Build-Schritt, keine Frameworks, keine npm-Abhängigkeiten. Reine statische Dateien,
per `<script src>` geladen, globaler `state`-Objekt-Ansatz.

| Datei | Zeilen | Inhalt |
|---|---|---|
| `index.html` | 405 | UI-Gerüst: Kopfzeile + Vollbildkarte + Joystick, dazu die separate Menüseite (`#menuPage`) |
| `app.js` | 2836 | **Gesamte Anwendungslogik**: I18N, BLE, State, IndexedDB, SVG-Rendering, Import/Export, Validierung, Fahrsteuerung |
| `protocol.js` | 104 | `SunrayProtocol`: Checksumme, Verschlüsselung, Parser für `V,`- und `S,`-Antworten. Auch unter Node nutzbar (`module.exports`) |
| `styles.css` | 2399 | Dark-Layout, mobile-first; neuestes Layer `v17` enthält die aktuelle Oberfläche |
| `sw.js` | 57 | Service Worker: App-Dateien **network-first**, alles andere cache-first; Cache-Name aus `APP_VERSION` |
| `manifest.webmanifest` | 15 | PWA-Manifest |
| `tests/` | — | Testinfrastruktur, siehe eigenen Abschnitt unten |

Tests laufen ohne Runner und ohne npm: `node tests/run-all.js` (oder einzeln,
plus `node --check app.js`, `node --check protocol.js`).

### Oberfläche (Stand v18)

Vier Zonen im `#appFrame` — **Flexbox-Spalte**, kein Grid: Update-Leiste, Kopfzeile, Karte
(`flex: 1 1 auto; min-height: 0`), Fahrzone. Dazu drei Overlays: die Vollbildseite `#menuPage`,
der Moduswahl-Dialog `#modeDialog` und der Bestätigungsdialog `#confirmDialog`.

**Warum Flex und nicht Grid:** die Update-Leiste ist meistens ausgeblendet. In einem Grid mit
vier festen Zeilen rutschten die übrigen Kinder dann eine Zeile hoch — die Karte landete in der
`auto`-Zeile und die Fahrzone in der `1fr`-Zeile. Ergebnis: die Fahrzone nahm den halben
Bildschirm ein, die Karte schrumpfte auf Inhaltshöhe. Bei Flex trägt jedes Kind seine Rolle
selbst, unabhängig davon, wie viele Geschwister gerade ausgeblendet sind.

0. **Update-Leiste** (`#updateBar`, oberste Grid-Zeile): erscheint nur, wenn eine neue Fassung
   im Wartestand liegt; ein Tipp übergibt an sie. Details unter „Auslieferung“.
1. **Kopfzeile** (`.appbar`): Menü-Button (☰), Bluetooth-Statussymbol (auch Kurzweg zur
   Verbindungssektion), Moduswahl-Chip (öffnet `#modeDialog`), RTK-Badge (`updateRtkBadge()`,
   Text Fix/Float/No Fix, Satelliten als `Mäher/Station`), Akku-Chip.
2. **Karte** (`.map-stage`): füllt den Rest. Zeiger-Steuerung auf dem SVG
   (`onMapPointerDown/Move/Up`): Tap wählt aus, Ziehen ab 8 px verschiebt, zwei Finger zoomen.
   Oben eine schmale, halbtransparente Hinweiszeile (`.map-hud`, Karte bleibt dahinter sichtbar).
   Sie muss `right`/`bottom` explizit auf `auto` setzen — sonst spannt die ältere `.map-hud`-Regel
   (v1-Layer, `bottom: 10px`) den Kasten über die ganze Kartenhöhe. Oben rechts der Lösch-Button mit Beschriftung und darunter „Ansicht zurücksetzen“
   (nur nach eigenem Zoom). Unten rechts der `.capture-cluster`.
3. **Fahrzone** (`.drive-zone`): der Joystick, fest sichtbar, für den Daumen. Sie ist bewusst
   **nur so hoch wie ihr Inhalt**: `flex: 0 0 auto`, `align-content: center`. Drei Spalten
   (`minmax(0,1fr) auto minmax(0,1fr)`) — der Joystick sitzt fest in Spalte 2 und bleibt damit
   mittig, die Statusanzeige (`.drive-meta`) belegt eine Außenspalte, damit der bedienende Daumen
   sie nicht verdeckt. Seite über `data-label-side` am `#driveZone`, **Standard links**, weil der
   Joystick mittig sitzt und der rechte Daumen von rechts kommt. **Beide Kinder brauchen
   `grid-row: 1`** — ohne das rutscht die Anzeige in Spalte 1 in eine zweite Zeile, weil der
   Platzierungszeiger nach dem Joystick (Spalte 2) schon hinter Spalte 1 steht; das war der
   sichtbare Layout-Sprung in der Rechtshänder-Einstellung. Die seitliche Anordnung gilt auf
   **jeder** Bildschirmbreite; im Breitbild-Layout ist dafür die Fahrspalte auf
   `clamp(300px, 30vw, 520px)` verbreitert und der Joystick dort etwas zurückhaltender.

   **Joystick-Größe** (`--joystick-size`): `clamp(110px, 25dvh × --joystick-scale,
   min(240px × --joystick-scale, 38dvh))`. Die bestehende bildschirmabhängige Rechnung bleibt, die
   Einstellung skaliert sie nur. `--joystick-scale` kommt aus `state.view.joystickScale`
   (`JOYSTICK_SCALES` = 0.75 / **1** / 1.25 / 1.5, Standard 1 = bisherige Größe) und wird von
   `applyDriveZonePreferences()` am `<html>` gesetzt. Die Obergrenze `38dvh` verhindert, dass die
   größte Stufe die Karte verdrängt. Die Kugel misst 41 % der Basis und skaliert automatisch mit.
   Kein `height: auto` + `aspect-ratio`, sonst streckt der Container ihn auf die verfügbare Höhe
   und die Zone wächst mit.

`.menu-scroll` ist auf `max-width: 760px; margin-inline: auto` begrenzt, damit die
Einstellungszeilen auf Desktop und Handy dieselbe Spaltenbreite haben.

**Ab 760 px Fensterbreite** wechselt `#appFrame` auf Grid mit **benannten Bereichen**
(`update / bar / map / drive`) und stellt die Fahrzone als Spalte **neben** die Karte
(`clamp(220px, 22vw, 320px)`). Die Bereiche sind bewusst benannt: bei reiner Reihenfolge würde die
meist ausgeblendete Update-Leiste die übrigen Kinder verschieben — genau der Fehler, der die
Aufteilung im Hochformat schon einmal vertauscht hat. Der Modus-Chip ist dort auf 260 px begrenzt,
RTK- und Akku-Chip rücken per `margin-left: auto` an den rechten Rand.
4. **Menüseite** (`#menuPage`, `setMenuOpen()`): sechs Top-Level-Abschnitte — Verbindung, Karten,
   Einstellungen, Kartenprüfung, Diagnose, Hilfe. Unter Einstellungen liegen als eigene Ebene
   Fahrgeschwindigkeit, Ansicht & Maßstab und Aufnahme. `bindAccordion(container)` sorgt auf
   beiden Ebenen dafür, dass immer nur ein Abschnitt offen ist.

**Damit die Menüseite scrollt, müssen zwei Dinge stimmen** (beide sind schon einmal gebrochen,
`tests/layout-test.js` prüft sie jetzt):
   - `.menu-scroll` braucht `min-height: 0`, sonst wächst das Flex-Kind auf Inhaltshöhe.
   - `.menu-page` (und `.modal-backdrop`) brauchen `height: 100dvh`. `inset: 0` misst bei einem
     `position: fixed`-Element den **Layout**-Viewport; auf Android Chrome ist das die Höhe *ohne*
     Adressleiste, also mehr als sichtbar ist. Der untere Rand liegt dann hinter der Browserleiste,
     `.menu-scroll` bekommt zu viel Höhe, und knapp zu langer Inhalt wird abgeschnitten, **ohne**
     dass überhaupt gescrollt werden kann. `.app-frame` nutzt aus demselben Grund `100dvh` —
     alle Vollbildebenen müssen dieselbe Bezugsgröße verwenden.

**Aufnahme-Cluster** (`.capture-cluster`): im Normalfall der große Halte-Button `#addPointBtn`
und darüber der kleine Umriss-Button `#autoCaptureBtn` (Aufnahmepunkt). Welche Knöpfe wann
sichtbar sind, steht in der Tabelle unten. Läuft die Automatik, bekommt der
Cluster `.auto-active`: der manuelle Button wird ausgeblendet, der Automatik-Button rückt an
dessen Stelle, wird groß, rot gefüllt und zeigt Pause. Der Lösch-Button ist währenddessen
komplett ausgeblendet.

**Drei Zustände des Hauptbuttons und des Lösch-Buttons:**

| Auswahl | `#addPointBtn` | `#autoCaptureBtn` | `#deletePointBtn` (Label darüber) |
|---|---|---|---|
| keine | Punkt aufnehmen (550 ms halten) | sichtbar | „Letzten Punkt“ → `undoPoint()` |
| ein Punkt | Verschieben (ein Tap) | ausgeblendet | „Punktauswahl löschen“ → `deleteSelectedPoint()` |
| Ausschlussfläche | ausgeblendet | ausgeblendet | „Fläche löschen“ → `deleteSelectedArea()` mit Rückfrage |
| Automatik läuft | ausgeblendet | groß, rot, Pause | ausgeblendet |

Bei ausgewählter Fläche bleibt also **nur der Papierkorb** stehen — aufnehmen lässt sich in
diesem Zustand nichts. Nach dem Löschen rufen `deleteSelectedPoint()`, `deleteSelectedArea()`
und `undoPoint()` ausdrücklich `refreshCaptureState()` auf; `renderMap()` allein aktualisiert
die Knöpfe nicht, sie blieben sonst bis zum nächsten Telemetrie-Takt im alten Zustand.

`refreshDeleteButton()` setzt Label, Farbe (`delete-point` = Akzent, `delete-area` = Warnfarbe)
und Sichtbarkeit; `deleteAction()` verzweigt anhand der Auswahl.

**Punktgröße:** sichtbarer Radius 5 (ausgewählt 9) bei 3,5 Rand — bewusst klein. Die
Trefferfläche hängt nicht daran, sie kommt aus dem unsichtbaren `map-point-hit`-Kreis mit
`state.hitRadiusUnits` (immer ≥ 44 × 44 px).

**Punktfarben:** der **Rand** zeigt das Element (`--perimeter` grün, `--exclusion` rot,
`--waypoint` bernstein, `--dock` blau), die **Füllung** die RTK-Qualität
(`quality-excellent/good/warning/bad`). Die Qualitätsregeln dürfen deshalb **kein `stroke`**
setzen — vorher taten sie das mit `!important` und alle Punkte sahen unabhängig vom Element
gleich aus. `tests/layout-test.js` prüft beides.

**Auswahl:** `state.selectedPoint` (Einzelpunkt) und `state.selectedArea` (Ausschluss-ID).
`handleMapTap()` prüft zuerst die Punkte im Touch-Radius, dann per `pointInPolygon()` die
Innenflächen der Ausschlusskonturen — bewusst **nur** dort, weil ein Tap in den Perimeter sonst
jedes Verschieben der Karte abfangen würde.

**Rückfragen und Meldungen:** `askConfirm({ title, message, confirmLabel, cancelLabel, tone })` gibt ein
`Promise<boolean>` zurück und zeigt `#confirmDialog` — dieselbe Karte wie `#modeDialog`
(zentriert, dunkel, abgerundet, eigene Knöpfe). `window.confirm()` wird nirgends mehr benutzt;
`tests/ui-test.js` prüft beides per Quelltextsuche. `tone: 'danger'` färbt den Bestätigen-Knopf als
Warnfarbe, die Beschriftung ist pro Fall konkret statt „OK“/„Abbrechen“ — beide Knöpfe sagen,
was sie tun („Kontur automatisch schließen“ / „Kontur NOCH NICHT schließen“). Deshalb stehen die
Knöpfe untereinander (`.modal-actions` mit einer Spalte); nebeneinander reicht die Breite nicht. Antworten kommen aus `confirmDialogRespond(answer)` —
Klick auf einen der Knöpfe, Klick auf den Hintergrund oder Escape. Eine noch offene Rückfrage
gilt beim Öffnen der nächsten als abgelehnt, damit kein Promise hängen bleibt.
`showNotice({ title, message, tone })` nutzt denselben Dialog mit `singleButton: true`
(Abbrechen ausgeblendet, `.modal-actions.single`) und ersetzt `window.alert()`.
`reportError(error)` ist die Sammelstelle aller `.catch`-Zweige aus Nutzeraktionen: es
protokolliert den Fehler **und** zeigt ihn als Meldung — vorher landete er nur in einer
Browserbox. `reportBleError(context, error, { immediate })` meldet fehlgeschlagene Funkbefehle:
der Kurzhinweis (`bleWriteFailedShort`) steht **immer sofort** in der Kartenzeile und, während
gefahren wird, in der Fahrzeile; der Dialog kommt höchstens alle
`BLE_ERROR_NOTICE_INTERVAL_MS` (20 s), sonst würde der 650-ms-Fahr-Heartbeat den Nutzer
zuschütten. `immediate: true` erzwingt ihn — bei Not-Halt (`AT+M,0,0`, `AT+C,0,0`) und bei
ausdrücklichen Tastendrucken (`AT+V`/`AT+S` in der Diagnose). `establishGatt()` setzt die
Sperrzeit zurück, damit der erste Fehler einer neuen Verbindung wieder sichtbar wird. Weder `window.confirm()` noch `window.alert()` werden noch benutzt.
**In Tests** hängt `tests/app-harness.js` über `globalThis.__confirmAdapter` eine automatische
Antwort ein (dieselbe Konvention wie `bleAdapter()`): `sandbox.__confirmAnswer` steuert sie,
`sandbox.__lastConfirm` / `__lastConfirmRequest` lesen die letzte Frage zurück. Für den echten
Dialogpfad löschen die Tests den Adapter (`delete sandbox.__confirmAdapter`) und antworten mit
`confirmDialogRespond()`.

**Schnellzugriff „Fläche schließen & neue“** (`#closeAndNewBtn` in `#closeAndNewWrap`, auf der
Karte **unter dem Papierkorb**, mit Beschriftung „Schließen & neu“): erscheint nur, wenn
`canCloseAndStartNew()` — Modus `exclusion`, Karte nicht gesperrt, **keine Auswahl aktiv** (bei
ausgewähltem Punkt oder ausgewählter Fläche genügen Papierkorb und Verschieben) und die laufende
Kontur ist **noch offen** (`closed === false`) mit ≥ 3 Punkten. Ein Tipp schließt die Kontur über dieselbe `closeContour()`-Logik
wie der Moduswechsel und legt sofort per `createExclusion()` eine neue leere an; der Modus bleibt.
**Bewusst ohne Rückfrage**, weil der Knopf ausschließlich dafür da ist — im Gegensatz zum
Moduswechsel, wo das Schließen eine Nebenwirkung wäre. Gedacht für Reihen kleiner Flächen (Bäume).

**Moduswechsel:** `openModeDialog()` → `requestModeChange(mode)`. Hat die verlassene Kontur ≥ 3
Punkte und ist noch offen, fragt `offerToCloseContour()` einmal nach; „Ja“ schließt sie, „Nein“
lässt sie offen und der Wechsel findet trotzdem statt. Wegpunkte und Dock sind offene Pfade und
lösen nie eine Rückfrage aus. `openContours()` findet alle offenen Konturen; die Kartenprüfung
meldet sie als `checkAreaOpen`/`checkPerimeterOpen` und bietet `closeAllOpenContours()` an.

**Positions-Glättung:** `state.fixHistory` sammelt die letzten Fixes aus `handleLine()`;
`smoothedPosition()` mittelt alle innerhalb von `POSITION_SMOOTHING_WINDOW_MS` (2 s) und
`pointFromTelemetry()` nimmt diesen Mittelwert (Feld `smoothedFrom` = Anzahl der Fixes). Bei
weniger als zwei Fixes im Fenster wird nicht gemittelt. **Einschränkung:** bei 2 s Polling liegen
im Fenster meist nur ein bis zwei Fixes — die Glättung wirkt erst mit kürzerem Poll-Intervall
richtig.

**Automatik:** zeitgesteuert über `state.view.autoCaptureIntervalS` (Standard 5 s, nur im Menü
einstellbar). Die Beschriftung über dem Knopf trägt das Intervall in **beiden** Zuständen:
„Auto-Aufnahme (5s)“ bzw. „Automatik läuft (5s)“. Bewusst auch im gestoppten Zustand — der
laufende Zustand ist ohne verbundenen Mäher gar nicht erreichbar (`ui.autoCaptureBtn.disabled`
verlangt frische Telemetrie), das Intervall wäre sonst praktisch unsichtbar.
**Das Intervall lässt sich während des Laufs nicht ändern**, weil `setMenuOpen(true)` eine
laufende Automatik stoppt; der `setInterval`-Takt würde eine Änderung ohnehin erst nach einem
Neustart übernehmen. `startAutoCapture()` legt sofort einen Punkt und dann `setInterval` →
`autoCaptureTick()`. Die frühere distanz-/„intelligent“-basierte Auto-Aufnahme ist entfallen.

**Hell/Dunkel:** `state.view.theme` ∈ `system | light | dark`. `applyTheme()` setzt
`data-theme` am `<html>` — bei `system` **kein** Attribut, dann entscheidet `prefers-color-scheme`.
Farben laufen über die `--shell-*`-Tokens im v18-Layer von `styles.css`; die Hell-Palette steht
dort zweimal (Attributselektor und Media-Query) und muss inhaltlich gleich bleiben.

**Der `viewBox` der Karte folgt der gemessenen Fläche** (`updateViewBox()`, `state.viewBox`):
eine viewBox-Einheit ist genau ein CSS-Pixel. Vorher war er fest auf 1000 × 680 — auf einem
hochkant gehaltenen Telefon passt das Seitenverhältnis nicht, und `preserveAspectRatio="meet"`
legte oben und unten breite leere Streifen an, sodass die Karte nur ein Band in der Mitte nutzte.
`computeTransform()` und `clampViewport()` rechnen deshalb mit `state.viewBox` und `MAP_PADDING`
statt mit festen Zahlen; die Kartenfläche kommt aus dem CSS-Hintergrund (`--map-canvas`) statt aus
einem `<rect>` mit fester Größe.

Nutzer-Zoom: `state.viewport = { zoom, dx, dy, custom, base }`. Solange `custom` false ist, folgt
die Ansicht dem Auto-Fit (`computeTransform`); ab der ersten Geste wird die Basis eingefroren
(`beginCustomViewport()`) und `activeTransform()` legt Zoom/Verschiebung darüber. `clampViewport()`
hält Zoom in `MIN_USER_ZOOM`/`MAX_USER_ZOOM` (0,6–14) und verhindert, dass die Karte aus dem Bild
geschoben wird. Trefferflächen der Punkte: `state.hitRadiusUnits` wird je Render aus
`svgMetrics()` so gesetzt, dass immer mindestens 44 × 44 px Touch-Ziel entstehen.

**Bewusst nicht enthalten:** Mähsteuerung (Start/Stop/Dock/Mähmotor/PWM), Tab-Leiste, seitliche
Schieber, Rechts-/Linkshänder-Umschaltung, Messwerkzeug, Teilstück-/Geraden-Bearbeitung,
Undo-Pfeil (im Lösch-Button aufgegangen), distanzbasierte Auto-Aufnahme, Versionsverwaltung
(„Versionen & Verlauf“ mit Speichern/Wiederherstellen — vom Nutzer als unübersichtlich verworfen),
**jede sichtbare Versionsnummer der App**.

**Keine Versionsnummer im UI.** Die Version lebt nur noch in `sw.js` (`APP_VERSION` →
Cache-Name); `app.js` führt keine Versionskonstante mehr. `tests/sw-test.js` prüft, dass keine
Versionsangabe ins Markup zurückkehrt.

**Elementliste** (Menü → *Karten*): `mapElements()` liefert Perimeter, jede Ausschlussfläche,
Wegpunkte und Dockpfad mit Punktzahl; `renderElementList()` zeichnet sie als Zeilen. Ein Tipp auf
die Zeile macht das Element zum Aufnahmeziel (`activateElement()`), der Papierkorb daneben leert
es bzw. entfernt eine Ausschlussfläche ganz (`deleteElement()`, mit Rückfrage). Das ersetzt das
frühere Auswahlfeld, das nur Ausschlussflächen kannte und nur im Ausschluss-Modus sichtbar war,
sowie „Aktuelles Element leeren“. Neue Ausschlussflächen legt der Knopf unter der Liste an.

**Sperrzustand** ist auf drei Wegen erkennbar, weil Farbe allein auf dem Gerät nicht reichte:
Bügelform (offen/geschlossen, `lockIcon()` mit Schlüsselloch nur im gesperrten Zustand), Farbe
(Warnfarbe) und Wort — die Schaltfläche trägt „Gesperrt“ bzw. „Offen“, die Kartenkarte zusätzlich
die Zeile „🔒 Karte gesperrt – keine Änderungen möglich“.

**Keine Verlaufsaufzeichnung mehr.** `map.history`, `checkpointMap()`, `geometrySnapshot()`,
`applyGeometrySnapshot()`, `undoLastHistoryChange()` und die Liste „Letzte Punkte“ sind restlos
entfernt (vom Nutzer verworfen). Neue Karten führen kein `history`-Feld mehr; vorhandene Felder
in alten Karten werden nur nicht mehr gelesen. Rückgängig gibt es nur noch über den Lösch-Button
auf der Karte („Letzten Punkt“).

### Wichtige Funktionsgruppen in `app.js`

- **BLE** (~Z. 1265–1500): `onNotification`, `writeBytes`, `sendSunray`, `initializeSunrayHandshake`,
  `startPolling`, `establishGatt`, `connectBluetooth`, `scheduleReconnect`, `onDisconnected`, `disconnectBluetooth`
- **Protokoll-Auswertung**: `handleLine` (~Z. 1213)
- **Fahrsteuerung**: Joystick (`joystickVectorFromPointer` → Auslenkung = Geschwindigkeit zwischen
  `driveSpeedMin` und `driveSpeedMax`), `sendDriveVector`, `stopDrive`, `emergencyStop`
  (wird nur noch beim Trennen genutzt). **Der zweite Wert von `AT+M` ist eine Drehrate im
  Roboterrahmen, keine Lenkrichtung** — deshalb spiegelt `joystickVectorFromPointer()` die
  Lenkung bei `linear < 0`, siehe „Rückwärtslenkung“ unten.
- **Persistenz** (~Z. 1497–1640): IndexedDB `ardumower-bt-mapper`, Store `maps`, max. 10 Karten
- **Karten-Rendering** (~Z. 2107–2385): eigenes SVG-Zeichnen, `computeTransform`/`toScreen`
- **Import/Export** (~Z. 2385–2600): JSON-Backup und GeoJSON
- **Validierung** (~Z. 2604–2710): Selbstschnitt, Überlappung, Punktabstände, RTK-Qualität
- **UI/Menü/i18n**: `setMenuOpen`, `setMode`/`cycleMode`, `refreshCaptureState`, `applyLanguage`
- **Kartengesten**: `svgMetrics`, `pointerToViewBox`, `activeTransform`, `clampViewport`,
  `onMapPointerDown/Move/Up`, `handleMapTap`

### BLE-Ablauf (App-Seite)

0. Aller Zugriff auf Web Bluetooth läuft über `bleAdapter()` (app.js, direkt vor dem `ui`-Objekt).
   Im Browser liefert die Funktion `navigator.bluetooth`; ist `globalThis.__bleAdapter` gesetzt,
   gewinnt dieser — darüber hängen die Tests den Fake-Stack ein. Sonst gibt es keine direkte
   `navigator.bluetooth`-Verwendung mehr.
1. `adapter.requestDevice({ filters: [{ services: [FFE0] }] })` — nur nach Nutzergeste.
2. `device.gatt.connect()` → Service `0000ffe0-…` → Characteristic `0000ffe1-…`.
3. `startNotifications()` + Listener `characteristicvaluechanged`.
4. Handshake: `AT+V` **unverschlüsselt** senden, 1800 ms auf `V,…` warten; bei Timeout einmal ohne
   Checksumme wiederholen. Aus der Antwort: Firmware, Version, `encryptionEnabled`, `challenge`.
5. Schlüssel = `passwort % challenge` (`deriveEncryptionKey`).
6. Polling: alle **2000 ms** `AT+S`; wird übersprungen, solange ein Schreibvorgang läuft oder in den
   letzten 220 ms ein Fahrbefehl ging.
7. Senden: Kommando + `,0x<crc8>`, bei aktiver Verschlüsselung zeichenweise verschoben
   (`encryptPrintable`, Wrap im druckbaren ASCII 32..126), dann `\n`, in **15-Byte-Chunks** mit
   `writeValueWithResponse` und 12 ms Pause.
8. Empfang: Bytes → `state.rxBuffer`, an `\r?\n` zerlegt, `handleLine` parst `V,`/`S,`.
9. Bei `gattserverdisconnected`: automatischer Reconnect mit Backoff `1s, 2.5s, 5s, 10s, 15s`, max. 8 Versuche.

**Bestätigt:** Sunray verschlüsselt **Antworten nicht** (`Comm::cmdAnswer` in `sunray/comm.cpp` hängt nur
CRC + CRLF an). Das Plain-Parsing in `handleLine` ist also korrekt. Nur *Kommandos* werden verschlüsselt,
`AT+V` immer im Klartext (Sunray überspringt die Entschlüsselung explizit für `AT+V`).

### Rückwärtslenkung (`AT+M`: Drehrate, nicht Lenkrichtung)

`AT+M,linear,angular` gibt Sunray eine Längsgeschwindigkeit **und eine Drehrate** vor
(Einrad-/Differentialmodell: `ẋ = v·cosθ`, `ẏ = v·sinθ`, `θ̇ = ω`). Eine Drehrate ist von der
Fahrtrichtung **unabhängig**: dieselbe Drehung, die den Mäher vorwärts nach links trägt, trägt
ihn rückwärts nach rechts. Nachgerechnet (Roboter blickt nach +x, +y ist links von ihm):

| Kommando | Ergebnis |
|---|---|
| `linear +`, `angular +` | vorwärts / links |
| `linear +`, `angular -` | vorwärts / rechts |
| `linear -`, `angular +` | rückwärts / **rechts** |
| `linear -`, `angular -` | rückwärts / **links** |

Der Joystick liefert aber eine *Lenkrichtung*: hinten-links soll hinten-links fahren. Deshalb
spiegelt `joystickVectorFromPointer()` die Lenkung, sobald `linear < 0`
(`const steering = linear < 0 ? nx : -nx`). Vorwärts ändert sich dadurch nichts — genau deshalb
war der Fehler am Gerät auch nur in den beiden rückwärtigen Quadranten sichtbar. Beim Drehen auf
der Stelle (`linear === 0`, reine Seitwärtsauslenkung) gilt die Vorwärtskonvention, weil es dort
keine Fahrtrichtung zum Spiegeln gibt.

`tests/ui-test.js` prüft das nicht über Vorzeichen, sondern integriert dasselbe Modell
(`driveOutcome()`) und vergleicht die **tatsächliche Fahrtrichtung** für alle vier Quadranten —
die Vorzeichen für sich genommen sahen vorher plausibel aus.

### Sunray-Kommandos, die die App nutzt

- `AT+V` — Version/Handshake
- `AT+S` — Statuszeile (X, Y, delta, solution, Akku, Satelliten, Genauigkeit …)
- `AT+M,linear,angular` — manuelles Fahren; Sunray stoppt nach **1000 ms** ohne neues `AT+M`,
  daher App-Heartbeat alle **650 ms** (Totmann-Prinzip)
- `AT+C,1,-1` / `AT+C,0,-1` — Mähmotor an/aus; `AT+C,0,0` — STOP ALLES

### Datenformat der Mähkarten

```jsonc
{
  "format": "ardumower-web-map",
  "generator": "MapCreator für Ardumower",
  "version": 2,
  "id": "<uuid>",
  "name": "…",
  "coordinateSystem": "sunray-local-xy-meters",
  "createdAt": "ISO", "updatedAt": "ISO",
  "locked": false,
  "perimeterClosed": false,
  "perimeter":   [ { "x": 0, "y": 0, /* + Qualitätsmetadaten der Aufnahme */ } ],
  "exclusions":  [ { "id": "…", "name": "…", "closed": true, "points": [ … ] } ],
  "waypoints":   [ … ],
  "dockPoints":  [ … ]
}
```

`exclusion.closed` unterscheidet fertige Polygone von noch offenen Konturen; Bestandskarten ohne
das Feld gelten als geschlossen. Aufgenommene Punkte tragen zusätzlich `smoothedFrom` (Anzahl der
gemittelten Fixes).

Koordinaten sind **lokale Sunray-XY-Meter**, keine WGS84-Geokoordinaten. Der GeoJSON-Export nutzt
dasselbe lokale XY-System (Polygon für Flächen, LineString/Point für Teilgeometrien);
Wegpunkte werden als LineString mit `role: "waypoints"` exportiert.

## Testinfrastruktur

Kein Runner, kein `package.json`, keine Abhängigkeiten — reine Node-Skripte.
**Alles starten:** `node tests/run-all.js`. Einzeln: `node tests/<datei>.js`.

| Datei | Rolle |
|---|---|
| `tests/app-harness.js` | Lädt `protocol.js` + `app.js` per `vm` in einen Sandkasten mit DOM-Stubs. Optionen: `clock` (virtuelle Uhr), `bleAdapter` (Fake-BLE), `exportNames` (welche App-Internas als `__test` herausgereicht werden). Schneidet den `init()`-Autostart ab. Von **beiden** App-Tests benutzt — keine zweite Ladelogik anlegen. |
| `tests/virtual-clock.js` | Ersetzt `setTimeout`/`setInterval`/`Date.now`/`performance.now` im Sandkasten. `await clock.runFor(ms)` spult virtuelle Zeit ab und leert dazwischen die Microtask-Queue, dadurch laufen 78 s Reconnect-Backoff in Millisekunden und völlig deterministisch. |
| `tests/fake-ble.js` | Fake-Web-Bluetooth + nachgebaute ESP32/Sunray-Gegenseite. Zusätzlich schaltbar: `failWrites` (Schreibvorgänge werden abgewiesen, obwohl der Link steht), `suppressDisconnectEvent`. |
| `tests/protocol-test.js` | Reine Protokollfunktionen (unverändert). |
| `tests/app-core-test.js` | Geometrie, Kartenmodell, Validierung (unverändert, nur auf `app-harness.js` umgestellt). |
| `tests/ble-test.js` | Die BLE-Szenarien (28 Fälle), inklusive der Absicherung aller vier umgesetzten App-Fixes. Stacktraces mit `BLE_TEST_STACK=1`. |
| `tests/sw-test.js` | Prüft die **Auslieferung** (7 Fälle): Cache-Version an genau einer Stelle in `sw.js`, App-Dateien network-first mit `cache: 'no-cache'` und Cache als Rückfallebene, `cache: 'reload'` beim Cache-Aufbau, alle von `index.html` geladenen Dateien im Cache, alte Caches werden entfernt, Neuladen bei `controllerchange` — und dass **keine** Versionsangabe im UI auftaucht. |
| `tests/layout-test.js` | Statische Regressionsprüfung für Menüseite, Kartenknöpfe und Grundaufteilung (14 Fälle). `resolve(selector, property, { media })` löst die Kaskade auf; ohne `media` zählen nur Regeln **außerhalb** von `@media`: löst die Kaskade (inklusive `@media`) auf und prüft die Struktur in `index.html`. Deckt ab: Scrollcontainer intakt (`min-height: 0`, kein zweiter Scrollcontainer), Vollbildebenen in `dvh`, Blocklayout der Abschnittsstapel, kein Clipping aufgeklappter Abschnitte, gemeinsame senkrechte Achse der Kartenknöpfe, umbrechende Beschriftungen, HUD zweizeilig und ohne Überlappung der Knopfspalte. Braucht keinen Browser. |
| `tests/ui-test.js` | Die Kartier-Oberfläche (33 Fälle): Bestätigungs- und Meldungsdialog (Titel/Text/Beschriftung, beide Antworten, verdrängte Rückfrage, Einknopf-Meldung, `reportError` protokolliert und zeigt, keine `window.confirm()`/`window.alert()`-Aufrufe mehr), Moduswahl per Dialog, Rückfrage zum Schließen von Konturen, Kartenprüfung mit Konturschluss, Aufnahme/Löschen in allen drei Button-Zuständen, Flächenauswahl, Automatik (Ersetzen des manuellen Knopfs und Intervall), Positions-Glättung, Hell/Dunkel, Akkordeon, Auswahl per Tap, Touch-Zielgröße, Zoom-Grenzen, Tap-vs-Ziehen, Pinch, Halte-Aufnahme, Joystick-Kennlinie, RTK-Badge, Menüseite, gesperrte Karte, `init()`-Startpfad. Stacktraces mit `UI_TEST_STACK=1`. Antworten auf `confirm()` steuert der Test über `sandbox.__confirmAnswer`. |

### Was `tests/fake-ble.js` simulieren kann

`createFakeBluetooth({ clock, … })` liefert `{ adapter, device, sim }`. Über `sim` steuerbar:
`encryptionEnabled`/`password`/`challenge`, `answerDelayMs`, `notifyIntervalMs`,
`notifyAck` (false = Notify-Kette reißt ohne `SUCCESS_NOTIFY` nach dem ersten Paket ab),
`silent` (empfängt, antwortet nie), `answerVersion` (false = keine `V,`-Antwort),
`connectFailures` (n scheiternde `gatt.connect()`), `reuseCharacteristic` (Chrome gibt beim
Reconnect dasselbe Characteristic-Objekt zurück), `telemetry` (Werte der `S,`-Zeile).
Aktionen: `dropLink()` (plötzlicher Abbruch), `answer(line)`, `inject(text)` (rohe Bytes an der
Firmware vorbei), `pendingTxBytes()`. Beobachtung: `commands` (entschlüsselt), `rawCommands`,
`writes`, `stats` (u. a. `connectCalls`, `notifyPackets`, `listenerAdds`/`listenerRemoves`,
`maxWriteChunk`). Antworten werden wie beim echten ESP32 in **15-Byte-Notifies** zerlegt,
Kommandos werden entschlüsselt (`AT+V` bleibt Klartext) und ihre Checksumme ist prüfbar.

### Aufbau von `tests/ble-test.js`

Alle 27 Fälle sind harte Zusicherungen (`test(...)`); die frühere `probe()`-Mechanik wurde
entfernt, nachdem jeder dokumentierte Verdachtsfall behoben oder widerlegt war. Stacktraces mit
`BLE_TEST_STACK=1 node tests/ble-test.js`.

Abgedeckt: Handshake inkl. Schlüsselableitung, `AT+V` im Klartext vs. verschlüsselte
Folgekommandos, 2-s-Polling und Telemetrieübernahme, 15-Byte-Chunking beim Senden,
Zusammensetzen einer über mehrere Notifies verteilten `S,`-Zeile, plötzlicher Linkverlust +
Aufräumen + erfolgreicher Reconnect, manuelles Trennen (Not-Halt, genau ein Disconnect-Pfad,
kein Reconnect), `AT+V`-Wiederholung ohne Checksumme bei ausbleibender Antwort, abgerissene
Notify-Kette, Reconnect mit frischem und mit wiederverwendetem Characteristic, dazu die
Absicherung der vier App-Fixes (siehe „Umgesetzte App-Fixes“).

### Ergebnisse aus dem ersten Lauf

- **App-Punkt 8 (doppelte Listener) ist entkräftet.** `establishGatt()` ruft zwar bei jedem
  Reconnect `addEventListener` auf und räumt nie ab (`listenerAdds` 2 / `listenerRemoves` 0),
  aber es ist immer dieselbe Funktionsreferenz `onNotification` — `EventTarget` dedupliziert
  das. Auch beim wiederverwendeten Characteristic-Objekt wird jede Zeile genau **einmal**
  verarbeitet. Als Ursache für den Abbruch fällt der Punkt damit weg.
- **App-Punkt 9 (doppelter Disconnect-Pfad) tritt nicht auf**: bei `disconnectBluetooth()` mit
  offener Verbindung läuft `onDisconnected()` genau einmal.
- **App-Punkte 10, 11, 13 und die App-Reaktion auf ESP32-Punkt 4** wurden zuerst reproduziert und
  anschließend behoben; Details und Konstanten stehen unter „Umgesetzte App-Fixes“.
  Zum Ausgangsbefund: 60 s Funkstille galten weiter als „verbunden“, nach 8 Fehlversuchen blieb
  `state.device` gesetzt, 200 000 Zeichen ohne `\n` wurden ungebremst gepuffert, und bei
  abgerissener Notify-Kette kamen von 31 `AT+S` nur 7 Zeilen zurück — ohne jede Reaktion der App.

### Noch nicht abgedeckt

- Firmware-Verhalten selbst (Watchdog-Reboot, TX-Ringpuffer-Race, WiFi/BLE-Koexistenz,
  Supervision-Timeout `BLE_TIMEOUT 30`) — das braucht die echte Hardware bzw. die serielle Konsole.
- SVG-Rendering im Detail (Formen/Raster/Roboter), i18n-Umschaltung, IndexedDB-Persistenz,
  Import/Export-Dialoge, Kartenprüfung im Zusammenspiel mit der Oberfläche.
- Fahrsteuerung (Joystick, 650-ms-Heartbeat, Mähmotor-Halteaktion) — der Fake könnte das,
  es fehlen nur die Testfälle.
- Hintergrund-Throttling durch Chrome (App-Punkt 12) lässt sich mit der virtuellen Uhr
  nachbilden, ist aber noch nicht als Fall geschrieben.
- Keine Browser-Automatisierung (bewusst nicht aufgesetzt) und keine CI.

## Gegenseite: ESP32-Firmware

Pfad (nur lesen): `/home/penis/projects/MeinSunray/esp32_ble/esp32_ble_platformio`
(PlatformIO-Umbau des Sketches aus `esp32_ble/`; hat eigene `CLAUDE.md`).

- `src/main.cpp` (773 Z.) ist eine **BLE↔UART-Bridge**: Bluedroid-GATT-Server mit Service `FFE0` /
  Characteristic `FFE1` (NOTIFY|READ|WRITE|WRITE_NR + BLE2902), UART2 auf GPIO16/17 mit 115200 Bd
  zum Ardumower-PCB.
- Zwei Ringpuffer à 2048 Byte (`rxBuf`/`txBuf`). `onWrite` schiebt in `rxBuf`; `loop()` schreibt
  `rxBuf` → UART. UART-Antworten sammeln sich in `bleAnswer`, bis `\n`/`\r` kommt oder 100 ms
  Ruhe (`bleAnswerTimeout`), dann `bleSend()` → `txBuf` → `bleNotify()`.
- `bleNotify()` sendet höchstens `BLE_MTU-5` = **15 Byte** pro Paket; das nächste Paket wird erst
  aus dem Callback `onStatus(SUCCESS_NOTIFY)` nachgeschoben.
- Relevante Werte aus `include/config.h`:
  `BLE_MTU 20`, `BLE_MIN_INTERVAL 2`, `BLE_MAX_INTERVAL 10`, `BLE_LATENCY 0`, `BLE_TIMEOUT 30`,
  `USE_BLE 1`, `USE_HTTP_SERVER 1`, `ENCRYPTION_ENABLED true`, `ENCRYPTION_PASSWORD 123456`.
- Task-Watchdog mit Panic (Reboot) aktiv; `esp_task_wdt_reset()` nur einmal pro Sekunde am Ende
  von `loop()`.
- WiFi wird nur gestartet, solange **kein** BLE-Client verbunden ist; einmal assoziiertes WiFi
  bleibt aber aktiv. `ArduinoOTA.handle()` und `relay_loop()` laufen immer.

## Offene Baustelle: BLE bricht nach Sekunden ab

Noch **nicht** behoben — nur analysiert. Kandidaten, grob nach Wahrscheinlichkeit:

### ESP32-seitig

1. **`BLE_TIMEOUT 30` = 300 ms Supervision-Timeout (Top-Verdacht).** Zusammen mit
   `BLE_MIN/MAX_INTERVAL 2/10` (= 2,5–12,5 ms) ist der Link extrem eng getaktet: schon wenige
   verpasste Connection Events (Funkstörung, WiFi-Koexistenz, blockierter ESP32) reißen die
   Verbindung. Übliche stabile Werte: Intervall 12–24 (15–30 ms), Latency 0, Timeout 400–600
   (4–6 s). `updateConnParams` wird direkt in `onConnect` mit diesen Werten aufgerufen — der Abbruch
   „nach einigen Sekunden“ passt zeitlich genau dazu.
2. **Watchdog-Reboot statt echtem BLE-Abbruch.** WDT läuft mit Panic; wird `loop()` länger
   blockiert als `WDT_TIMEOUT`, startet der ESP32 neu — für die App sieht das exakt wie ein
   BLE-Disconnect aus. Blockierer im Pfad: `delay(500)` nach Disconnect, `startWIFI()` mit
   10 × `delay(50)` plus bis zu 20 s Assoziationswartezeit, `ArduinoOTA.handle()`.
   **Wichtigste Diagnose: serielle Konsole (115200) während eines Abbruchs mitschneiden** und auf
   Reset-Reason / Panic prüfen.
3. **Race auf dem TX-Ringpuffer.** `bleSend()` läuft im Arduino-Loop-Task, `bleNotify()` läuft
   zusätzlich im Bluedroid-Callback-Task (`onStatus`). Beide verändern `txReadPos` und den
   *globalen* `String notifyData` (Heap!) ohne Mutex → Heap-Korruption bis Crash/Reboot.
4. **Abreißende Notify-Kette.** Kommt kein `SUCCESS_NOTIFY` (z. B. bei Congestion / Fehlerstatus),
   wird `txBuf` nie weiter geleert — bis zum nächsten `bleSend()`. Symptom: Verbindung steht,
   aber es kommen keine Daten mehr; danach evtl. `txBuf overflow!` auf der Konsole.
   **Ursache weiterhin offen (Firmware, nicht angefasst).** App-seitig wird der Zustand jetzt
   erkannt und beendet, statt still „verbunden“ zu bleiben — siehe Fix 4 unten.
5. **WiFi/BLE-Koexistenz** auf einer Antenne: HTTP-Server, OTA, mDNS/DHCP konkurrieren mit dem
   BLE-Funk. Bei 300 ms Supervision-Timeout reicht das für einen Abriss.
6. **`BLE_MTU 20` / 15-Byte-Pakete.** Eine `AT+S`-Antwort ist >100 Zeichen → 7+ Notifies je Poll,
   2× pro Sekunde. Größere MTU (185/247) würde die Funklast massiv senken.
7. Kosmetisch: `setMinPreferred(0x06)` wird direkt danach von `setMinPreferred(0x12)` überschrieben.

### App-seitig

8. ~~**Kein `removeEventListener`** für `characteristicvaluechanged` in `establishGatt()`.~~
   **Durch Test widerlegt** (`tests/ble-test.js`): es ist immer dieselbe Funktionsreferenz,
   `EventTarget` dedupliziert, keine Doppelverarbeitung. Nur kosmetisch unsauber.
9. ~~**Doppelter Disconnect-Pfad**~~ — **durch Test widerlegt**: `onDisconnected()` läuft je
   Trennvorgang genau einmal.
10. ~~**Kein RX-Watchdog.**~~ **Behoben** — siehe „Umgesetzte App-Fixes“ unten.
11. ~~**Reconnect endet still.**~~ **Behoben** — siehe „Umgesetzte App-Fixes“ unten.
12. **Hintergrund-Throttling:** Chrome Android drosselt Timer in inaktiven Tabs / bei Bildschirm aus.
    Dann fallen 2-s-Poll und 650-ms-Fahr-Heartbeat aus. Wake Lock wird nur während der
    Auto-/Teilstück-Aufnahme angefordert.
13. ~~`state.rxBuffer` ist unbegrenzt.~~ **Behoben** — siehe „Umgesetzte App-Fixes“ unten.
14. Der 12-ms-Abstand zwischen Chunks ist wirkungslose Totzeit; limitierend ist das
    Connection-Intervall, nicht die JS-Seite.
15. **NEU (2026-09-05, am Geraet beobachtet): einzelne `write()` scheitern mit
    „GATT Error Unknown“, waehrend die Verbindung steht.** Betrifft `AT+S` und `AT+M`,
    gelegentlich beim Steuern, nicht sicher reproduzierbar. Keiner der vier Fixes deckt das ab —
    sie reagieren auf **Stille**, nicht auf einen aktiv abgewiesenen Schreibvorgang.
    Ist-Zustand und Testabdeckung stehen unten unter „Fehlgeschlagene Schreibvorgaenge“.
    Ursache offen; passt zum ESP32-Verdacht 3 (Race auf dem TX-Ringpuffer / Heap-Korruption),
    ist damit aber **nicht** bestaetigt. Firmware unangetastet.

### Umgesetzte App-Fixes (2026-09-04)

Alle vier Fixes betreffen **nur** die App. An der ESP32-Firmware wurde nichts geändert.
Gemeinsames Muster vorher: Die App blieb auf „verbunden“ hängen, obwohl der Link faktisch tot war.
Zentraler neuer Baustein ist `dropStaleLink(reasonKey)`: es trennt über denselben Pfad wie ein
echter Funkabriss (`gatt.disconnect()` → `gattserverdisconnected` → `onDisconnected()`), merkt sich
den Grund in `state.disconnectReasonKey` und hat ein 500-ms-Sicherheitsnetz, falls das Event ausbleibt.

| Fix | Was jetzt passiert | Konstanten |
|---|---|---|
| **App-10 · RX-Watchdog** | `startRxWatchdog()` läuft ab `establishGatt()` und prüft jede Sekunde `Date.now() - state.lastBleRxAt`. Über 8 s ohne Empfang → `dropStaleLink('bleLinkStalled')` → Reconnect. Beim Zurückkehren aus dem Hintergrund (`visibilitychange`) wird `lastBleRxAt` aufgefrischt, damit Chromes Timer-Throttling keinen Fehlalarm auslöst. | `BLE_RX_TIMEOUT_MS 8000`, `BLE_RX_CHECK_INTERVAL_MS 1000` |
| **App-11 · Endzustand** | `scheduleReconnect()` prüft die Obergrenze vorab; danach räumt `giveUpReconnect()` auf: Listener ab, `state.device/server/characteristic = null`, Zähler zurück, Status `reconnectGaveUp` („Verbindung fehlgeschlagen – bitte erneut verbinden.“). Kein Endlos-Retry, aber der Verbinden-Knopf ist wieder aktiv. | `BLE_MAX_RECONNECT_ATTEMPTS 8` |
| **App-13 · rxBuffer** | `onNotification()` verwirft den Puffer, sobald er ohne Zeilenende 4 KB überschreitet, protokolliert das als Protokollfehler und zählt `state.rxOverflows`. Ab dem dritten Überlauf gilt der Datenstrom als kaputt → `dropStaleLink('bleProtocolError')`. Gültige, auch lange Zeilen bleiben unangetastet. | `BLE_RX_BUFFER_LIMIT 4096`, `BLE_RX_OVERFLOW_LIMIT 3` |
| **ESP32-4 · App-Reaktion** | `state.pendingStateReplies` zählt gesendete `AT+S` und wird bei jeder geparsten `V,`/`S,`-Zeile auf 0 gesetzt. Vier unbeantwortete Abfragen (≈ 8 s) → `dropStaleLink('bleNoAnswer')`. Das greift auch, wenn noch Bruchstücke eintrudeln und `lastBleRxAt` deshalb frisch bleibt — genau die Lage bei abgerissener Notify-Kette. | `BLE_UNANSWERED_POLL_LIMIT 4` |

**Testergebnis vorher/nachher:** vor den Fixes 18 BLE-Fälle mit vier `probe()`-Beobachtungen, die
alle „OFFEN“ meldeten. Danach 27 BLE-Fälle, ausschließlich harte Zusicherungen — die
`probe()`-Mechanik ist entfallen, weil kein Verdachtsfall mehr nur beobachtet wird. Neu abgedeckt:
Karenzzeit des Watchdogs, Selbstheilung nach Stille, kein Fehlalarm bei laufendem Empfang,
sauberer Endzustand + manueller Neuversuch, gedeckelter rxBuffer inkl. Resynchronisation und
Nicht-Überkorrektur bei langen gültigen Zeilen, Erkennung unbeantworteter Abfragen trotz
eintrudelnder Bruchstücke, sowie das Sicherheitsnetz bei ausbleibendem Disconnect-Event
(neue Fake-Option `suppressDisconnectEvent`).

**Weiterhin offen:** die eigentliche Ursache des Abbruchs. Die App fängt die Symptome jetzt sauber
ab und verbindet neu, aber ESP32-Punkte 1–7 (Supervision-Timeout `BLE_TIMEOUT 30`, WDT-Reboot,
TX-Ringpuffer-Race, MTU 20, WiFi/BLE-Koexistenz) sind unberührt und brauchen die serielle Konsole
bzw. eine vom Nutzer freigegebene Firmware-Änderung. Ebenfalls offen: App-Punkt 12
(Hintergrund-Throttling — nur die Watchdog-Karenzzeit ist entschärft, nicht das Aussetzen von
Polling und Fahr-Heartbeat) und App-Punkt 14 (wirkungslose 12 ms zwischen den Chunks).

### Fehlgeschlagene Schreibvorgänge (Ist-Zustand, 2026-09-05)

Analysiert, **noch nicht verändert** — der Umfang einer Gegenmaßnahme ist mit dem Nutzer
abzustimmen, weil es um Fahrbefehle geht.

- **Der Fehler geht nicht verloren.** `writeBytes()` fängt nichts ab, `sendSunray()` reicht die
  Ablehnung durch (und löst im `finally` die Sendesperre `state.sendBusy`, es hängt also nichts).
  Jede Aufrufstelle hat ein `.catch` auf `reportBleError()`: Kurzhinweis sofort in der
  Kartenzeile und, während gefahren wird, in der Fahrzeile; Dialog gedrosselt auf 20 s, bei
  Not-Halt und Diagnose-Tasten sofort. Ein unbehandelter `unhandledrejection` entsteht nirgends.
- **Es gibt keinen Retry.** Ein gescheitertes Kommando wird nicht wiederholt. Beim Fahren ist das
  faktisch entschärft: der 650-ms-Heartbeat schickt ohnehin gleich wieder ein `AT+M`. Der
  Stopp beim Loslassen (`AT+M,0,0`) wird dagegen **genau einmal** versucht — hier rettet die
  Sunray-Seite: sie hält nach **1000 ms ohne neues `AT+M`** von selbst an, ein verlorener Stopp
  bedeutet also höchstens ~1 s Nachlauf, keinen weiterfahrenden Mäher.
- **Nichts erkennt den Zustand.** Die ESP32-4-Erkennung zählt `pendingStateReplies` nur bei
  **erfolgreich gesendetem** `AT+S` hoch — ein nicht abgeschickter Poll zählt nicht. Bleibt allein
  der RX-Watchdog, der nach **8 s Stille** greift. Bei dauerhaft scheiternden Schreibvorgängen
  gilt der Link also 8 s lang als gesund; bei nur gelegentlichen Fehlern greift er gar nicht.
- **Der gefährlichste Teil: halbe Zeilen.** `writeBytes()` stückelt jedes Kommando in 15-Byte-
  Chunks. Scheitert ein Chunk in der Mitte, bricht die Schleife ab — die bereits gesendeten
  Chunks stehen ohne `\n` im `rxBuf` der Firmware. Das **nächste, erfolgreiche** Kommando klebt
  daran fest. Gemessen im Fake:

  ```
  gesendet: AT+C,-1,…,128   (Chunk 2 abgewiesen)
  danach:   AT+S
  Firmware sieht: "AT+C,-1,-1,-1,-AT+S,0x13"   ← eine einzige Zeile
  ```

  Sunray verwirft sie an der Prüfsumme, aber **das `AT+S` ist mit verloren** — die Verbindung
  steht, die App wartet auf eine Antwort, die nie kommt. Genau das Bild „verbunden, aber
  Befehle wirken nicht“. Eine Resynchronisation (nach einem Schreibfehler ein einzelnes `\n`
  nachschicken) gibt es nicht.

**Umgesetzt (nur die Resynchronisation, vom Nutzer so freigegeben):** `writeBytes()` merkt sich,
ob schon ein Chunk rausging. Scheitert ein späterer, schickt `resyncAfterPartialWrite()` ein
einzelnes `\n` hinterher und wirft danach den **ursprünglichen** Fehler weiter — die Meldung an
den Nutzer bleibt also unverändert. Die Firmware verwirft das Bruchstück an der Prüfsumme, das
nächste Kommando fängt sauber an. Best effort: scheitert auch das `\n`, wird es nur protokolliert
(`bleResyncDone` / `bleResyncFailed`). Scheitert schon der **erste** Chunk, liegt kein Bruchstück
vor und es wird nichts nachgeschickt. **Bewusst nicht umgesetzt** (auf Wunsch des Nutzers):
Retry gescheiterter Kommandos und eine eigene Erkennung/Trennung nach n Schreibfehlern.

**Testabdeckung** (`tests/ble-test.js`, fünf neue Fälle): vereinzelter Fehler wird gemeldet und
nicht wiederholt; Fehler mitten im Kommando wird durch das nachgesendete Zeilenende abgeschlossen
und das Folgekommando kommt unverstümmelt an; ohne angefangene Zeile wird nichts nachgeschickt;
dauerhaftes Scheitern trennt erst nach 8 s über den RX-Watchdog; scheiternder Fahr-Heartbeat
landet in der Fahrzeile und der nächste Takt kommt an. Gegen einen simulierten Rückfall geprüft.
`tests/fake-ble.js` kann das jetzt gezielt: **`failWriteChunks: n`** weist die nächsten n
Chunk-Schreibvorgänge ab und lässt den Link danach normal weiterlaufen (`failWrites` bleibt der
Dauerfall), `stats.writeFailures` zählt mit, und der Fehlertext ist der von Chrome/Android
gemeldete Wortlaut **`GATT Error Unknown`**.

### Nächster Diagnoseschritt (wenn es ans Beheben geht)

- ESP32-Seriellkonsole während eines Abbruchs mitlesen (Reboot vs. sauberer Disconnect?).
- Android-Seite: `chrome://bluetooth-internals` bzw. `adb logcat` auf den HCI-Reason-Code prüfen —
  `0x08` = Supervision-Timeout, `0x13` = Gegenstelle hat getrennt, `0x22` = LMP-Timeout,
  `0x3E` = Verbindungsaufbau fehlgeschlagen.
- Erst dann entscheiden, ob die Ursache in der Firmware-Konfiguration oder in der App liegt.
  Änderungen an der ESP32-Firmware sind nur nach Rücksprache mit dem Nutzer erlaubt.

## Sonstige gesammelte Code-Probleme (noch nicht umgesetzt)

- **`app.js` ist ein 3121-Zeilen-Monolith** mit einem globalen, überall veränderten `state`-Objekt.
  Sinnvolle Aufteilung: `ble.js`, `state.js`, `storage.js`, `map-render.js`, `map-io.js`,
  `validate.js`, `ui.js`, `i18n.js` (ES-Module gehen auf GitHub Pages ohne Build).
- **I18N** liegt als riesiges Objektliteral in `app.js` (~230 Zeilen je Sprache) — gehört in
  separate JSON-Dateien.
- ~~**`ui`-Objekt** … eine umbenannte ID ergibt still `undefined`.~~ **Entschärft**: `$()` liefert
  für fehlende Kennungen einen stillen Platzhalter statt `undefined` und sammelt sie in
  `missingUiElements`; `init()` schreibt die Liste ins Diagnoseprotokoll. Zusätzlich öffnet
  `init()` die Datenbank **vor** `bindEvents()`, und beide Blöcke laufen in eigenen `try`-Zweigen
  mit sichtbarer Fehlermeldung — eine kaputte Bindung kann die Karten nicht mehr unerreichbar
  machen.
- ~~**Fehlerbehandlung:** viele `.catch` schlucken Fehler ins Diagnose-Log.~~ **Behoben**: Fehler
  aus Nutzeraktionen laufen über `reportError()`, fehlgeschlagene Funkbefehle über
  `reportBleError()`, eine scheiternde Automatik hält an und meldet sich. Still bleiben nur noch
  zwei interne Aufräumschritte beim Trennen (`gatt.disconnect()`, `removeEventListener`) — dort
  gibt es für den Nutzer nichts zu tun, und der Verbindungsstatus meldet die Trennung ohnehin.
- **Kein Linter, kein Formatter, keine CI.** Die Node-Tests sind handgeschrieben, ohne Runner
  und ohne `package.json`.
- ~~**Service Worker cache-first mit fester Cache-Konstante**~~ — **behoben**: `index.html`,
  `styles.css`, `app.js` und `protocol.js` laufen jetzt network-first, der Cache ist nur noch das
  Offline-Netz darunter. Vorher blieben korrigierte Dateien auf dem Gerät unsichtbar, bis jemand
  daran dachte, den Cache-Namen zu erhöhen — genau das hat zwei fertige Fixes am Gerät als
  „nicht behoben“ erscheinen lassen.
- **Deutsche Strings hart im Datenmodell:** `normalizeMap()` setzt `Ausschluss {n}`, `makeMap()`
  schreibt `generator: 'MapCreator für Ardumower'` in jede exportierte Datei — trotz DE/EN-Umschaltung.
- **Kartenformat ohne echte Migration:** `version` wird nur per `Math.max(2, …)` hochgezogen; ein
  Migrationspfad für künftige Formatänderungen fehlt.
- `styles.css` mit 2073 Zeilen / 68 KB ist unstrukturiert und ungeprüft auf tote Regeln.

## Entscheidungen / Konventionen

- Kein Build-Schritt, keine Abhängigkeiten — die App muss als reine statische Dateisammlung
  von GitHub Pages laufen.
- Alle Sunray-Protokolldetails gehören in `protocol.js` (ist auch unter Node testbar), nicht in `app.js`.
- BLE-Zugriff nur über `bleAdapter()` — nie wieder direkt `navigator.bluetooth` benutzen, sonst
  lässt sich der Fake-Stack nicht mehr einhängen.
- Neue Tests an `tests/app-harness.js` anknüpfen, keine zweite Ladelogik für `app.js` bauen.
- Deutsch ist die Standardsprache der Oberfläche; neue UI-Strings immer in **beiden** Sprachen ergänzen.
  Gegenprobe: alle `data-i18n`-Schlüssel aus `index.html` und alle `tr('…')`-Schlüssel müssen in
  `I18N.de` **und** `I18N.en` stehen.
- Diese App steuert kein Mähen. Start/Stop/Dock/Mähmotor gehören nicht hinein.
- Bedienung ist für den Daumen ausgelegt: Touch-Ziele mindestens 44 × 44 px, Aufnahme nur per
  Halten, damit Karten-Gesten nichts auslösen.
- `README.md` enthält ausschließlich Projekterklärung und Nutzungsanleitung — keine Versionshistorie,
  kein Deployment-/GitHub-Pages-Setup, keine Entwicklerhinweise (auf Wunsch des Nutzers, 2026-09-04).
- Änderungen an der ESP32-Firmware sind hier tabu; bei Bedarf dem Nutzer melden und vorschlagen.
- **Bei jedem Deploy `APP_VERSION` in `sw.js` hochzählen.** Sonst erscheint keine Update-Leiste
  (der Browser sieht keinen neuen Worker) und die Offline-Rückfallebene serviert weiter die
  Dateien vom Installationszeitpunkt der alten Version.

## Änderungsprotokoll

- 2026-09-05: **Rückwärtsfahrt war seitenverkehrt.** Am Gerät gemeldet: hinten-links am Joystick
  fuhr hinten-rechts und umgekehrt, vorwärts stimmte. Ursache ist keine Vorzeichen-Schlamperei,
  sondern die Bedeutung des zweiten `AT+M`-Werts: das ist eine **Drehrate im Roboterrahmen**,
  keine Lenkrichtung, und eine Drehrate ist von der Fahrtrichtung unabhängig. Mit dem
  Einradmodell nachgerechnet und bestätigt (Tabelle unter „Rückwärtslenkung“).
  `joystickVectorFromPointer()` spiegelt die Lenkung jetzt bei `linear < 0`; Vorwärtsfahrt und
  Drehen auf der Stelle bleiben unverändert. Zwei neue Testfälle (ui 50), die statt der
  Vorzeichen die **integrierte Fahrtrichtung** aller vier Quadranten prüfen; gegen den
  simulierten Rückfall geprüft (meldet dann wörtlich „muss nach links ausweichen, tut es aber
  nach rechts“). `APP_VERSION` auf `v22`.

- 2026-09-05: **Neues Gerätesymptom analysiert: einzelne Schreibvorgänge scheitern mit
  „GATT Error Unknown“ bei stehender Verbindung.** Reine Analyse, kein Verhalten geändert.
  Ergebnis siehe „Fehlgeschlagene Schreibvorgänge (Ist-Zustand)“: der Fehler wird sauber
  durchgereicht und gemeldet, es gibt keinen Retry, keine Erkennung außer dem 8-s-RX-Watchdog
  — und als eigentliches Risiko eine **halbe Zeile im Firmware-Puffer**, an der das nächste
  Kommando festklebt und mit verloren geht. Davon umgesetzt wurde nach Rücksprache **nur die
  Resynchronisation** (`resyncAfterPartialWrite()`: ein einzelnes `\n` nach einem abgebrochenen
  Kommando, ursprünglicher Fehler wird weitergeworfen); kein Retry, keine neue Trennlogik.
  `tests/fake-ble.js` um `failWriteChunks` und `stats.writeFailures` erweitert,
  `tests/ble-test.js` von 28 auf 33 Fälle, `APP_VERSION` auf `v21`.

- 2026-09-05: **„Schließen & neu ist immer noch sichtbar“ — Ursache war die Auslieferung, nicht der Code.**
  Gegengeprüft: die ausgelieferten `app.js`, `index.html`, `styles.css` und `protocol.js` sind
  **byte-identisch** (gleiche MD5) mit dem lokalen Stand, die Sichtbarkeitsregel steckt also am
  Server. Ein Durchlauf des echten Tippweges (`handleMapTap()` auf einen Punkt) blendet den Knopf
  aus und lässt ihn auch über den nächsten Telemetrie-Takt ausgeblendet. Übrig blieb die
  Rückfallebene des Service Workers: `APP_VERSION` stand seit vielen Deploys unverändert auf
  `v19`. Damit (a) erkennt der Browser **keinen** neuen Worker — die Update-Leiste erscheint nie,
  eine im Hintergrund weiterlaufende PWA lädt also nie neu — und (b) liefert der `catch`-Zweig
  bei scheiterndem Netzabruf (draußen am Mäher der Normalfall) genau die Dateien aus, die beim
  **Installieren von v19** geholt wurden, also den alten Stand. `APP_VERSION` jetzt `v20`;
  der Kommentar dort hält fest, dass bei **jedem** Deploy hochgezählt werden muss.
  Der Testfall zur Sichtbarkeit benutzt jetzt die echte Geste (`handleMapTap()`) statt
  `applyPointSelection()` direkt.

- 2026-09-05: **Drei Unstimmigkeiten aus dem Gerätetest.** (a) Der Layout-Sprung bei
  „Rechtshänder“ kam nicht von der Textbreite, sondern von der Grid-Platzierung: die Anzeige in
  Spalte 1 landete ohne `grid-row` in einer **zweiten Zeile** (Platzierungszeiger stand nach dem
  Joystick in Spalte 2 bereits hinter Spalte 1) — daher „unten links“ und die wachsende Zone.
  Beide Kinder haben jetzt `grid-row: 1`, die Regeln beider Seiten sind exakt gespiegelt.
  (b) Im Desktop-Browser stand die Anzeige unter dem Joystick, weil die 760-px-Media-Query auf
  eine Spalte zurückfiel — die Überschreibung ist entfernt, die Fahrspalte dafür von
  `clamp(220px, 22vw, 320px)` auf `clamp(300px, 30vw, 520px)` verbreitert. (c) Die Einstellungen
  sahen im breiten Fenster anders aus, weil `.menu-scroll` keine Maximalbreite hatte; jetzt
  760 px und zentriert. Vier neue Testfälle (layout 19), gegen drei simulierte Rückfälle geprüft.

- 2026-09-05: Der Schnellzugriff „Schließen & neu“ verschwindet jetzt auch, solange ein Punkt oder
  eine Fläche ausgewählt ist, und bei einer bereits geschlossenen Kontur — dort gäbe es nichts zu
  schließen, und beim Bearbeiten reichen Papierkorb und Verschieben. Neuer Testfall (ui 48).

- 2026-09-05: **Statusanzeige seitlich, Joystick-Größe einstellbar.** Die Fahrzone ist jetzt ein
  Drei-Spalten-Grid: Joystick fest mittig, `.drive-meta` in einer Außenspalte (Standard links,
  umschaltbar über *Einstellungen › Fahrgeschwindigkeit*, `data-label-side`). Neue Einstellung
  „Größe des Joysticks“ mit vier Stufen (Klein 0,75 / **Mittel 1** / Groß 1,25 / Sehr groß 1,5);
  die Stufe skaliert über `--joystick-scale` die bestehende Rechnung, statt eine zweite
  einzuführen. Auf einem 853-px-Bildschirm ergibt das Fahrzonen von 21,6 % bis 40,3 %, gedeckelt
  durch `38dvh`. Die Kugel ist auf 41 % der Basis umgestellt und braucht keine eigenen
  Media-Query-Größen mehr. Vier neue Testfälle (ui 47, layout 16), gegen drei simulierte
  Rückfälle geprüft.

- 2026-09-05: Punkte schlanker (Radius 7→5, Rand 5→3,5, sichtbarer Durchmesser 19→13,5 px;
  Auswahlring 19→15) — die 44-px-Trefferfläche bleibt unberührt, ein Test sichert beides
  gemeinsam ab. Joystick von ~25 % auf ~30 % der Bildschirmhöhe
  (`clamp(130px, 25dvh, 240px)`, Kugel 76→88 px). Die DOM-Stubs im Testharness führen jetzt
  `children` und `innerHTML` mit, damit gezeichnete SVG-Elemente prüfbar sind.

- 2026-09-05: Schnellzugriff „Fläche schließen & neue“ ist von der Kopfzeile auf die Karte
  gewandert — direkt unter den Papierkorb, mit Beschriftung, gleiche Sichtbarkeitsregel.
  Außerdem: **Punkte sind wieder nach Element unterscheidbar.** Die Qualitätsregeln setzten
  `stroke: … !important` und überschrieben damit die Elementfarbe; jetzt färbt die Qualität nur
  noch die Füllung, der Rand gehört dem Element (Rand zusätzlich von 4 auf 5 verstärkt).
  Neuer Fall in `tests/layout-test.js` (15), gegen einen simulierten Rückfall geprüft.

- 2026-09-05: **Automatik-Label: Ursachensuche und Erweiterung.** Gemeldet war „es wird gar nichts
  angezeigt“. Geprüft und ausgeschlossen: `ui.autoCaptureLabel` zeigt auf ein vorhandenes Element,
  `tr()` interpoliert `{seconds}` korrekt (`replaceAll`), die Zuweisung steht vor jedem `return`
  in `refreshCaptureState()`, keine CSS-Regel blendet die Beschriftung aus — ein Testlauf des
  echten Codepfads liefert „Automatik läuft (5s)“, und Server wie i18n-Strings sind aktuell
  ausgeliefert. Übrig bleibt: der **laufende** Zustand ist ohne verbundenen Mäher nicht
  erreichbar, der Automatik-Knopf bleibt dann gesperrt. Deshalb steht das Intervall jetzt in
  **beiden** Zuständen im Label. Neue Tests: Interpolation in DE und EN, kein unersetzter
  Platzhalter. Außerdem: das Aufnahmesymbol im kleinen Umriss-Knopf ist ein abgerundetes Quadrat
  statt eines Punkts (Kassettenrekorder-Anmutung); ein Icon-Set gibt es im Projekt nicht, alle
  Symbole sind handgeschriebenes Inline-SVG.

- 2026-09-05: **Schnellzugriff „Fläche schließen & neue beginnen“** (`#closeAndNewBtn`) für Reihen
  kleiner Ausschlussflächen. Sichtbar nur im Ausschluss-Modus ab drei Punkten der laufenden
  Kontur, schließt über die bestehende `closeContour()`-Logik und startet sofort eine neue leere
  Fläche — ohne Rückfrage. Dabei ist aufgefallen, dass `addCurrentPoint()` nach dem Aufnehmen kein
  `refreshCaptureState()` aufrief: Knopfzustände hingen bis zum nächsten Telemetrie-Takt
  hinterher. Drei neue Fälle in `tests/ui-test.js` (43).

- 2026-09-05: **Joystick anteilig, Breitbild-Layout.** Der Joystick misst jetzt
  `clamp(110px, 20dvh, 200px)` statt fester Pixel — die Fahrzone belegt damit rund ein Viertel
  der Bildschirmhöhe (24,5 % auf einem 853-px-Telefon, 25,3 % auf kleinen, 20 % auf Tablets).
  Ab 760 px Fensterbreite steht die Fahrzone als Spalte neben der Karte statt darunter, über ein
  Grid mit benannten Bereichen; der Modus-Chip ist dort begrenzt und lief vorher über die halbe
  Leiste. `resolve()` in `tests/layout-test.js` kann jetzt nach `@media`-Kontext filtern; zwei
  neue Fälle (14), gegen zwei simulierte Rückfälle geprüft.

- 2026-09-05: Beschriftung über dem Automatik-Knopf zeigt bei laufender Aufnahme das Intervall
  („Automatik läuft (5s)“ / „Automatic running (5s)“), gespeist aus
  `state.view.autoCaptureIntervalS`. Zwei Zusicherungen in `tests/ui-test.js`.

- 2026-09-05: **Aufteilung Karte/Fahrzone endgültig gefixt — Ursache war die Update-Leiste.**
  `#appFrame` war ein Grid mit vier festen Zeilen, die Update-Leiste ist aber fast immer
  `hidden` (`display: none`). Damit rutschten die drei sichtbaren Kinder je eine Zeile hoch: die
  Karte landete in der `auto`-Zeile (schrumpfte auf Inhaltshöhe), die Fahrzone in der
  `minmax(0,1fr)`-Zeile (nahm allen freien Platz). Jetzt Flexbox-Spalte mit expliziten Rollen
  (`flex: 0 0 auto` für Leiste/Kopfzeile/Fahrzone, `flex: 1 1 auto; min-height: 0` für die Karte).
  `tests/layout-test.js` prüft die Rollen statt der Grid-Zeilen; gegen vier simulierte Rückfälle
  geprüft.

- 2026-09-05: **Fahrzone nahm den halben Bildschirm ein.** Der Joystick hatte
  `height: auto; aspect-ratio: 1`; als Grid-Kind mit `align-items: stretch` wurde er auf die
  Zeilenhöhe gestreckt, was die `auto`-Zeile weiter wachsen ließ. Jetzt feste Pixelgröße
  (200 px, 170/150 px auf kleineren, 240 px auf großen Schirmen), `align-self: center`,
  `align-content: center` in der Zone und `min-content` als Grid-Zeile — die Karte bekommt den
  gesamten Rest. Neuer Fall in `tests/layout-test.js` (13), gegen drei simulierte Rückfälle geprüft.

- 2026-09-05: **Kartenelemente als Liste, Sperrzustand deutlich.** Neu: `mapElements()`,
  `renderElementList()`, `deleteElement()`, `activateElement()` — alle vier Elementarten stehen
  im Menü unter *Karten* mit Punktzahl, sind antippbar und einzeln löschbar. Entfallen:
  Auswahlfeld `exclusionSelect`, „Löschen“-Knopf, „Aktuelles Element leeren“ samt
  `clearCurrentElement()`, `deleteExclusion()` und `renderExclusionControls()`. Das Anlegen einer
  weiteren Ausschlussfläche blieb als eigener Knopf unter der Liste erhalten — ohne ihn gäbe es
  keinen Weg zu mehr als einer Fläche. Das Schloss ist größer (30 px), hat im gesperrten Zustand
  einen gefüllten Körper mit Schlüsselloch und im offenen einen sichtbar abgeklappten Bügel;
  beide Zustände sind beschriftet, gesperrte Karten tragen zusätzlich eine Klartextzeile.

- 2026-09-05: **Update-Hinweis auf der Hauptseite statt Knopf in der Diagnose.** `sw.js` ruft kein
  `skipWaiting()` mehr im `install` — eine neue Fassung bleibt im Wartestand, bis der Nutzer die
  Leiste `#updateBar` antippt; die App schickt dann `postMessage({ type: 'skipWaiting' })`, und
  der bestehende `controllerchange`-Handler lädt neu. `watchForUpdates()` horcht auf
  `updatefound` und prüft beim Zurückkehren zur App (`visibilitychange`) auf Neues. Damit lädt
  die Seite nie mehr ungefragt mitten in der Aufnahme neu. Der Knopf „Nach Updates suchen“ in der
  Diagnose ist entfallen. Außerdem: die Kontur-Rückfrage beschriftet **beide** Knöpfe mit ihrer
  Wirkung („Kontur automatisch schließen“ / „Kontur NOCH NICHT schließen“), die Dialogknöpfe
  stehen dafür untereinander.

- 2026-09-05: **Verlaufsaufzeichnung restlos entfernt** — „Letzte Änderung zurück“ samt Hinweis,
  die Liste „Letzte Punkte“ und darunter das ganze Gerüst (`checkpointMap()`,
  `geometrySnapshot()`, `applyGeometrySnapshot()`, `historyReason()`, `refreshHistoryUndoState()`,
  `undoLastHistoryChange()`, `recentArray()`, ~14 Übersetzungsschlüssel). Neue Karten haben kein
  `history`-Feld mehr; `tests/app-core-test.js` prüft das. „Aktuelles Element leeren“ bleibt.
  Außerdem: das Schlosssymbol in der Kartenübersicht ist kein Emoji mehr, sondern ein
  gezeichnetes Schloss (`lockIcon()`) — offener Bügel und gedämpfte Farbe gegen geschlossenen
  Bügel, gefüllten Körper, Warnfarbe und die Wortmarke „Gesperrt“; gesperrte Karten bekommen
  zusätzlich einen farbigen Kartenrahmen. `tests/ui-test.js` prüft, dass sich die Bügelform
  unterscheidet.

- 2026-09-05: Bei ausgewählter Ausschlussfläche sind jetzt **beide** Aufnahmeknöpfe ausgeblendet
  (`#captureFabWrap` und `#autoFabWrap`), es bleibt nur der Papierkorb. Dabei ist aufgefallen,
  dass `renderMap()` die Knopfzustände nicht auffrischt: nach `deleteSelectedPoint()`,
  `deleteSelectedArea()` und `undoPoint()` blieb der Hauptknopf bis zum nächsten
  Telemetrie-Takt (bis zu 2 s) im alten Zustand — die drei rufen jetzt `refreshCaptureState()`.

- 2026-09-05: **Zwei Fehler nach dem Gerätetest.** (a) Das `hidden`-Attribut wirkte bei Knöpfen
  nicht: `button { display: inline-flex }` aus einem alten Layer schlägt das `display: none` des
  Browsers. Dadurch stand in reinen Meldungen der Abbrechen-Knopf und „Ansicht zurücksetzen“ war
  dauerhaft sichtbar. Neue globale Regel `[hidden] { display: none !important; }`,
  `tests/layout-test.js` prüft sie. (b) Startfestigkeit: `$()` gibt für fehlende Kennungen einen
  Platzhalter zurück und meldet sie beim Start; `init()` öffnet die Datenbank jetzt **vor**
  `bindEvents()` und fängt beide Blöcke einzeln ab. Vorher genügte ein fehlendes Element (etwa
  eine ältere `index.html` aus dem Cache bei schon neuer `app.js`), damit `init()` vor
  `openDb()` abbrach — dann schlug jede Kartenaktion mit „Cannot read properties of null
  (reading 'transaction')“ fehl und alle Karten schienen verschwunden.

- 2026-09-05: **Knopf „Nach Updates suchen“** in der Diagnose-Sektion (`checkForUpdate()`):
  `registration.update()` umgeht den HTTP-Cache und lädt einen geänderten Service Worker, danach
  wird neu geladen. Hintergrund: nach jedem Deploy blieb die Frage offen, ob der Stand am Gerät
  angekommen ist — und seit die Versionsnummer aus dem UI raus ist, gibt es keine Anzeige mehr
  dafür. Der Knopf ist die verlässliche Antwort darauf, ohne eine Version anzuzeigen.
  `tests/sw-test.js` (8 Fälle) prüft ihn.

- 2026-09-05: Automatik-Knopf wird ausgeblendet, solange ein einzelner Punkt ausgewählt ist
  (`ui.autoFabWrap.hidden`); der Hauptknopf steht dann auf „Verschieben“. Bei Flächenauswahl und
  bei laufender Automatik bleibt er sichtbar. Drei Zusicherungen in `tests/ui-test.js` ergänzt.

- 2026-09-05: **Keine sichtbare Versionsnummer mehr, Versionsverwaltung entfernt.** Entfernt wurden
  das Abzeichen `v16` im Kopf der Hilfe-Sektion (`index.html`, dazu die tote Regel `.help-version`)
  und die Versionsangabe in der Startzeile des Diagnoseprotokolls; `APP_VERSION` gibt es in
  `app.js` nicht mehr (nur noch intern in `sw.js` als Cache-Name). Ebenfalls entfernt: die Karte
  „Versionen & Verlauf“ im Menü samt `saveManualVersion()`, `restoreHistoryEntry()`,
  `renderHistory()` und neun toten i18n-Schlüsseln. „Letzte Änderung zurück“ und der Lösch-Button
  auf der Karte bleiben unverändert. Hilfetexte, die entfernte Funktionen beschrieben
  (Versionen/Undo, Teilstück-Bearbeitung), sind angepasst; `tests/sw-test.js` prüft jetzt, dass
  keine Versionsangabe ins Markup zurückkehrt.

- 2026-09-05: **Fehlgeschlagene Funkbefehle sind sichtbar.** Die stillen `.catch((e) => log(…))`
  im BLE-Pfad (Fahr-Heartbeat, Joystick, Polling, Not-Halt, Diagnose-Tasten) laufen jetzt über
  `reportBleError()`: Kurzhinweis sofort in der Kartenzeile bzw. Fahrzeile, Dialog gedrosselt auf
  20 s, bei Not-Halt und Tastendruck sofort. Eine fehlschlagende Automatik-Aufnahme hält jetzt an
  und meldet den Grund, statt still weiterzulaufen. `tests/fake-ble.js` kann Schreibvorgänge über
  `failWrites` abweisen; neue Fälle in `tests/ble-test.js` (28) und `tests/ui-test.js` (33).

- 2026-09-05: **Auch die Fehlermeldungen im App-Design.** Die 16 `window.alert()`-Aufrufe laufen
  jetzt über `showNotice()` — derselbe Dialog mit nur einem Knopf („Verstanden“). Die 15
  gleichlautenden `.catch((e) => alert(e.message))`-Zweige sind zu `.catch(reportError)`
  zusammengefasst; `reportError()` schreibt zusätzlich ins Diagnoseprotokoll. Der `alert`-Stub im
  Testharness ist entfernt, damit ein Rückfall auffliegt statt verdeckt zu werden.

- 2026-09-05: **Alle Bestätigungen im App-Design.** Die sieben `window.confirm()`-Aufrufe
  (Fläche löschen, Karte löschen, Ausschluss löschen, Element leeren, Version wiederherstellen,
  Kontur schließen, offene Konturen schließen) laufen jetzt über `askConfirm()` und
  `#confirmDialog` im Stil des Moduswahl-Dialogs, mit konkreter Knopfbeschriftung statt „OK“ und
  Warnfarbe bei Löschvorgängen. Test-Hook von `sandbox.confirm` auf `globalThis.__confirmAdapter`
  umgestellt; `tests/ui-test.js` auf 30 Fälle erweitert, inklusive Quelltextprüfung, dass
  `window.confirm()` nicht zurückkommt. `window.alert()` in den `.catch`-Zweigen ist bewusst
  unverändert geblieben (nicht Teil der Aufgabe).

- 2026-09-04: **Karte nutzt die volle Fläche.** Der feste `viewBox` 1000 × 680 passte nicht zum
  Seitenverhältnis der Kartenfläche; `preserveAspectRatio="meet"` ließ oben und unten breite
  leere Streifen. Jetzt folgt der `viewBox` der gemessenen Fläche (`updateViewBox()`),
  `computeTransform()`/`clampViewport()` rechnen mit `state.viewBox` und `MAP_PADDING`, das
  `<rect class="canvas-bg">` mit fester Größe ist durch den CSS-Hintergrund `--map-canvas`
  ersetzt. Außerdem: Symbole kräftiger (dickere Striche, größere Icons) und im gesperrten
  Zustand mit `opacity: .62` noch lesbar; der Automatik-Knopf trägt jetzt den gefüllten
  Aufnahmepunkt statt eines Plus.

- 2026-09-04: **Nachbesserungen aus dem Gerätetest.** Automatik-Knopf zeigt jetzt das
  Aufnahmesymbol (+) statt eines Play-Dreiecks. Aus dem Menü *Verbindung* sind X/Y/GPS und
  „keine Zusatzdaten“ entfernt (die Position steht auf der Karte, der RTK-Zustand in der
  Kopfzeile); übrig bleibt die Firmware-Zeile. Beschriftung und Erklärung im Menü nutzen jetzt
  dieselbe Schriftfamilie mit klarer Abstufung nur über Größe und Farbe — vorher stand ein
  0,75-rem-Fettlabel direkt über einem 0,62-rem-Hinweis in Monospace und anderer Graustufe.
  Fünf weitere tote i18n-Schlüssel entfernt.
- 2026-09-04: **Auslieferung: HTTP-Cache vor dem Service Worker.** Trotz network-first lieferte
  der Browser-HTTP-Cache wegen `cache-control: max-age=600` von GitHub Pages bis zu zehn Minuten
  lang die alte Datei — deployte Korrekturen sahen dadurch weiter „nicht behoben“ aus. Der
  Shell-Zweig in `sw.js` holt jetzt mit `cache: 'no-cache'`, erzwingt also eine Rückfrage beim
  Server (`If-None-Match`). `tests/sw-test.js` prüft das mit.

- 2026-09-04: **Kartenknöpfe und Hinweiszeilen nach Gerätetest korrigiert.** Die Beschriftung
  „Letzten Punkt“ lag halb unter der Hinweiszeile und halb außerhalb des Bildschirms, die
  Beschriftung im runden Aufnahme-Knopf wurde abgeschnitten („Varte auf Positio“), und die Knöpfe
  oben und unten rechts standen auf unterschiedlichen Achsen. Jetzt: feste 96-px-Knopfspalte für
  `.map-fab-stack` und `.capture-cluster` mit gleichem `right`-Abstand, Beschriftungen über den
  Knöpfen mit Umbruch und `max-width`, Aufnahme-Beschriftung aus dem Kreis heraus in einen
  `.fab-with-label`-Block (`#captureFabWrap`, wird bei Automatik samt Knopf ausgeblendet),
  `.map-hud` wieder zweizeilig oben links mit Platz für die Knopfspalte. `tests/layout-test.js`
  auf 11 Fälle erweitert.

- 2026-09-04: **Zwei Ursachen hinter „Fix kommt nicht an“.** (a) Auslieferung: Der Service Worker
  war cache-first mit festem Cache-Namen; `styles.css` und `app.js` wurden nach dem letzten
  Namenswechsel mehrfach korrigiert und deployt, das Gerät zeigte aber weiter die Version aus dem
  `v18`-Cache. `sw.js` neu: App-Dateien network-first, Cache-Name aus `APP_VERSION` (`v19`),
  `cache: 'reload'` beim Aufbau, Version steht beim Start im Diagnoseprotokoll. Dazu lädt die App
  bei `controllerchange` einmalig neu — sonst zeigt der erste Neuladevorgang nach einem Deploy
  noch die Dateien des alten Workers, und der Nutzer müsste von Hand ein zweites Mal neu laden.
  **Beim Umstieg von einem cache-first-Stand gilt das noch: einmal zusätzlich neu laden.** (b) Layout:
  aufgeklappte Menüabschnitte wurden abgeschnitten und verschwanden hinter dem nächsten Abschnitt
  — `.menu-section`/`.menu-subsection` hatten `overflow: hidden`, und die Stapel waren Grid- bzw.
  Flexcontainer, die ihre Kinder stauchen können. Jetzt Blocklayout mit Rand-Abständen, kein
  Clipping, `[open]` sichert `height: auto; overflow: visible`. Neu: `tests/sw-test.js`,
  `tests/layout-test.js` auf 8 Fälle erweitert.

- 2026-09-04: **Menüseite scrollte erneut nicht.** Ursache diesmal *nicht* `min-height: 0` (das war
  noch vorhanden), sondern die Höhenmessung: `.menu-page` hing über `inset: 0` am Layout-Viewport,
  `.app-frame` dagegen an `100dvh`. Auf Android Chrome ist der Layout-Viewport die Höhe ohne
  Adressleiste — die Menüseite war rund 200 px höher als der sichtbare Bereich, ihr unteres Ende lag
  hinter der Browserleiste, und Inhalt, der nur knapp überstand, war weder sichtbar noch erreichbar.
  Fix: `height`/`max-height: 100dvh` auf `.menu-page` und `height: 100dvh` auf `.modal-backdrop`,
  dazu `overscroll-behavior: contain` auf `.menu-scroll`. Die verschachtelte Akkordeon-Ebene war
  nicht beteiligt (sie erzeugt keinen eigenen Scrollcontainer). Neu: `tests/layout-test.js`.

- 2026-09-04: **Gerätetest-Feedback umgesetzt (v18).** Behoben: Menüseite scrollt wieder
  (`.menu-scroll` fehlte `min-height: 0` — deshalb waren Geschwindigkeit und Rasterweite gar nicht
  erreichbar, beide Eingaben waren korrekt verdrahtet); Karten-Hinweis auf einen schmalen,
  halbtransparenten Streifen reduziert. Neu: Menü-Akkordeon mit sechs Top-Level-Abschnitten und
  eigener Einstellungsebene, Moduswahl als zentrierter Dialog, Rückfrage zum Schließen der
  verlassenen Kontur ab drei Punkten inkl. `exclusion.closed` und Angebot in der Kartenprüfung,
  Positions-Glättung über die letzten 2 s, zeitgesteuerte Automatik-Aufnahme mit eigenem Knopf,
  vereinheitlichter Lösch-Button (ersetzt den Undo-Pfeil), Flächenauswahl für Ausschlussflächen,
  Hell-/Dunkel-Modus mit Systemvorgabe. `styles.css` um das Token-/Theme-Layer v18 erweitert,
  v17-Block auf Tokens umgestellt; 126 tote i18n-Schlüssel (≈ 15 KB) entfernt.

- 2026-09-04: **BLE-Fixes App-Seite.** App-10 (RX-Watchdog), App-11 (sauberer Endzustand nach
  erschöpftem Reconnect), App-13 (gedeckelter `rxBuffer`) und die App-seitige Reaktion auf
  ESP32-Punkt 4 (unbeantwortete `AT+S`) umgesetzt; neue Konstanten und `dropStaleLink()` in
  `app.js`, vier neue i18n-Schlüsselpaare, `tests/ble-test.js` von 18 auf 27 harte Fälle
  erweitert (`probe()`-Mechanik entfallen), `tests/fake-ble.js` um `suppressDisconnectEvent`
  ergänzt. Firmware unverändert.

- 2026-09-04: **UI-Neugestaltung (v17).** `index.html` komplett neu aufgebaut (Kopfzeile,
  Vollbildkarte, Joystick-Zone, separate Menüseite); `app.js` entsprechend umgebaut: Pinch-Zoom/Pan
  mit Grenzen, Auswahl per Tap mit 44-px-Trefferflächen, Halte-Aufnahme, Verschieben/Löschen
  einzelner Punkte, neuer Modus **Wegpunkt** inkl. `map.waypoints` und GeoJSON-Export,
  Joystick-Auslenkung = Geschwindigkeit (Min/Max in den Einstellungen). Entfernt: Mähmotor-/
  Not-Halt-Steuerung, Tab-Leiste, seitliche Schieber, Handedness, Messwerkzeug, Teilstück- und
  Geraden-Bearbeitung. `styles.css`: defektes v15-Layer (eine Zeile mit literalen `\n`) entfernt,
  neues v17-Layer ergänzt. `sw.js`-Cache auf `v17` gehoben, `README.md` auf die neue Bedienung
  aktualisiert, `tests/ui-test.js` neu.

- 2026-09-04: Fake-BLE-Testebene gebaut — `bleAdapter()` als einzige Web-Bluetooth-Schnittstelle
  in `app.js`, dazu `tests/app-harness.js`, `tests/virtual-clock.js`, `tests/fake-ble.js`,
  `tests/ble-test.js`, `tests/run-all.js`; `app-core-test.js` auf den gemeinsamen Loader umgestellt.
  Verdachtsfälle 8 und 9 widerlegt, 10, 11, 13 und ESP32-Punkt 4 reproduziert.

- 2026-09-04: `CLAUDE.md` und `.gitignore` angelegt; Codebasis (App + ESP32-Gegenseite) analysiert;
  BLE-Abbruch-Kandidaten und sonstige Code-Probleme dokumentiert; `README.md` auf reine
  Nutzeranleitung reduziert.

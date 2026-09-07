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
2. **Karte** (`.map-stage`): füllt den Rest und ist selbst eine **Flexbox-Spalte** aus
   `.map-toolbar` (`flex: 0 0 auto`), dem Hinweisstreifen `#extendPanel` und
   `.map-canvas-area` (`flex: 1 1 auto; min-height: 0; position: relative`). Zeiger-Steuerung auf
   dem SVG (`onMapPointerDown/Move/Up`): Tap wählt aus, Ziehen ab 8 px verschiebt, zwei Finger
   zoomen.

   **Finale Aufteilung (Stand v42) — was in der Leiste steht und was auf der Karte liegt.**
   Die Zuordnung ist zweimal hin und her gewandert; sie steht hier vollständig, damit sie sich
   nicht wieder aus dem Verlauf rekonstruieren lässt.

   | Element | Ort | Rechtshänder | Linkshänder |
   |---|---|---|---|
   | Lösch-Werkzeug (`#deleteFabWrap`) | Werkzeugleiste | rechts | links |
   | „Punkt davor/danach“ (`#insertBeforeWrap`/`#insertAfterWrap`) | Werkzeugleiste | rechts | links |
   | „Schließen & neu“ (`#closeAndNewWrap`) | Werkzeugleiste | rechts | links |
   | „Erweitern“ (`#extendWrap`) | Werkzeugleiste | rechts | links |
   | Karteninfo (`#mapInfo`) | **auf der Karte**, oben | links | rechts |
   | Ansicht zurücksetzen (`#fitViewBtn`) | **auf der Karte**, oben | rechts | links |
   | Rückgängig (`#undoFabWrap`) | **auf der Karte**, unten | links | rechts |
   | Aufnahme-Cluster (`.capture-cluster`) | **auf der Karte**, unten | rechts | links |

   **Werkzeugleiste** (`.map-toolbar`) trägt seit v42 **nur noch** `.map-tools`. Sie steht auf
   `justify-content: flex-end`, sammelt sich also an der Daumenseite; `row-reverse` bei
   Linkshändern dreht die Seite. **`space-between` wäre hier falsch** — mit einem einzigen Kind
   bliebe die halbe Zeile leer. Sind **alle** Werkzeugslots ausgeblendet (etwa während der
   Automatik), blendet `refreshToolbarVisibility()` die ganze Leiste aus; sonst bliebe ein
   leerer Streifen samt Trennlinie stehen und nähme der Karte Höhe. Die Gruppe bleibt schrumpfbar
   (`flex: 0 1 auto; min-width: 0`) und scrollt notfalls waagerecht.

   **Karteninfo `#mapInfo`** liegt wieder als halbtransparentes Overlay (`--shell-hud`) oben auf
   der Karte, **einzeilig**: `display: flex`, darin `#mapSummary` (Name · Punktzahl),
   `#contourStatus` und `#pointStatus`. Jede Angabe ist `flex: 0 1 auto` mit Ellipse, die Box
   selbst `pointer-events: none`, damit Kartengesten darunter weiterlaufen, und
   `max-width: calc(100% - var(--edge-gap) - 56px)`, damit sie nicht ins Ansicht-Symbol läuft.
   **Warum zurück auf die Karte:** in der Leiste konkurrierte sie mit den Werkzeugen um die
   Breite (das war die Ursache des abgeschnittenen „Perimeter erweitern“).

   **Konturstatus `#contourStatus`** (`refreshContourStatus()`, gerufen aus `renderMap()` **und**
   `refreshCaptureState()`): zeigt `contourClosed`/`contourOpen`, gespeist aus `activeContour()`.
   Das liefert nur für Perimeter und Ausschlussfläche etwas — **Wegpunkte und Dockpfad sind
   offene Pfade, dort gibt es kein sinnvolles Offen/Geschlossen**, das Feld bleibt leer und
   verschwindet per `.info-chip:empty { display: none }` ganz.

   **Ansicht zurücksetzen `#fitViewBtn`** ist ein **reines Symbol** ohne Knopffläche und Rahmen
   (`border: 0; background: none`), wie in Kartenprogrammen üblich; ein Schlagschatten hält es
   über hellem wie dunklem Kartengrund lesbar, die Trefferfläche bleibt 44 × 44 px. Die
   Sichtbarkeitsregel ist unverändert: eingeblendet erst nach eigener Zoom-/Verschiebe-Geste.

   **Rückgängig `#undoFabWrap`** sitzt unten an der Kartenecke **gegenüber** dem Aufnahme-Cluster,
   in der Größe des **inaktiven** Automatik-Knopfes (48 px Umriss-Kreis, `.undo-fab`), nicht in
   der des großen Aufnahme-Knopfes. Funktion, 20er-Stapel und Sichtbarkeitsregeln sind
   unverändert; nur die Position hat gewechselt. Es trägt **keine sichtbare Beschriftung** mehr,
   nur sein `aria-label` — die Kurzschlüssel `undoShort` und `fitViewShort` sind entfallen.

   **`--edge-gap` (12 px) ist der gemeinsame Randabstand** aller randständigen Bedienelemente:
   Karteninfo, Ansicht-Symbol, Rückgängig-Knopf, Aufnahme-Cluster **und** der seitliche
   Innenabstand der Fahrzone. Nur dadurch stehen der Rückgängig-Knopf auf der Karte und der
   Joystick-Umschalter in der Fahrzone darunter auf **einer** senkrechten Linie, obwohl sie in
   verschiedenen Bereichen liegen. Wer einen davon ändert, muss das Token ändern, nicht die
   einzelne Regel; `tests/layout-test.js` nagelt genau das fest.

3. **Fahrzone** (`.drive-zone`): der Joystick, fest sichtbar, für den Daumen. Sie ist bewusst
   **nur so hoch wie ihr Inhalt**: `flex: 0 0 auto`, `align-content: center`. Drei Spalten
   (`minmax(0,1fr) auto minmax(0,1fr)`) — der Joystick sitzt fest in Spalte 2 und bleibt damit
   mittig, die Statusanzeige (`.drive-meta`) belegt eine Außenspalte, damit der bedienende Daumen
   sie nicht verdeckt. Die Seite kommt aus der Händigkeit (siehe unten), **Standard links**, weil der
   Joystick mittig sitzt und der rechte Daumen von rechts kommt. **Beide Kinder brauchen
   `grid-row: 1`** — ohne das rutscht die Anzeige in Spalte 1 in eine zweite Zeile, weil der
   Platzierungszeiger nach dem Joystick (Spalte 2) schon hinter Spalte 1 steht; das war der
   sichtbare Layout-Sprung in der Rechtshänder-Einstellung. Die seitliche Anordnung gilt auf
   **jeder** Bildschirmbreite; im Breitbild-Layout ist dafür die Fahrspalte auf
   `clamp(300px, 30vw, 520px)` verbreitert und der Joystick dort etwas zurückhaltender.

   **Zwei Steuerungsarten** über `state.view.driveControl` ∈ `joystick | buttons`
   (**Standard `joystick`**): der runde Joystick oder ein Kreuz aus **vier Richtungstasten**
   (`.drive-pad`, keine Diagonalen — genau das ist der Zweck). Umschaltbar über `#driveModeBtn`
   **neben dem Fahrfeld** und, gleichwertig, unter *Einstellungen › Fahrgeschwindigkeit*.
   **Das Symbol zeigt den Modus, in den der Knopf wechselt**, nicht den aktiven — wie ein
   Hell/Dunkel-Schalter, der im Hellen den Mond zeigt. Die CSS-Klasse benennt weiterhin den
   aktiven Modus, nur das gezeigte Symbol ist das jeweils andere
   (`.mode-joystick .icon-pad`); `tests/layout-test.js` nagelt genau diese Zuordnung fest, weil
   sie rein in CSS steckt und ein Test auf die Beschriftung sie nicht mitfängt.

   **Gemeinsames Feld `.drive-control` (`#driveControlArea`):** Größe (`--joystick-size`) und
   Gitterplatzierung stehen **nur dort**, Joystick und Tastenkreuz füllen es mit `100%` aus —
   Größeneinstellung, Fahrtanzeige und Händigkeit gelten damit unverändert für beide.

   **Seitenspalte `.drive-side` (seit v41): Umschalter oben, Fahrtanzeige darunter.** Der
   Umschalter `#driveModeBtn` (`.drive-mode-side`) und `.drive-meta` liegen als **Stapel**
   (`flex-direction: column`) in der Außenspalte des Fahrzonen-Grids — Rechtshänder Spalte 1,
   Linkshänder Spalte 3 über `:root[data-handed="left"] .drive-side`. `.drive-meta` hat keinen
   eigenen Gitterplatz mehr. Die Spalte ist seit v42 `justify-self: stretch`, und der Umschalter
   richtet sich mit `align-self: flex-start` (Linkshänder `flex-end`) an ihrer **Außenkante**
   aus. Zusammen mit dem seitlichen Innenabstand `var(--edge-gap)` der Fahrzone steht er damit
   genauso weit vom Bildschirmrand entfernt wie der Rückgängig-Knopf auf der Karte darüber.
   **Warum:** vorher saß der Knopf `position: absolute; right: 100%` neben dem Feld, und das Feld
   reservierte ihm per `--drive-toggle-gap` 50 px Außenabstand — genau die Breite, die der
   Fahrtanzeige in derselben Seitenspalte dann fehlte („Fahrt gestoppt“ wurde am Rand
   abgeschnitten, auf einem 360-px-Telefon blieben je Seite ~37 px). Beide standen also
   nebeneinander um denselben Platz an. Im Stapel braucht keiner Platz vom anderen, und ohne
   Absolut-Positionierung kann der Knopf den Kreis nicht überlappen. Das `.sr-only`-Label
   `#driveModeLabel` benennt weiter das **Ziel** („Zu Richtungstasten wechseln“).

   **Der Text der Fahrtanzeige bricht an Leerzeichen um** („Fahrt“ / „gestoppt“) und endet bei
   einem Wort, das auch dann nicht passt, sichtbar mit „…“ (`overflow: hidden;
   text-overflow: ellipsis; overflow-wrap: normal`) — nie stilles Abschneiden.

   **Die Joystick-Größe ist an die Breite gebunden**, damit die Seitenspalten nie unter die
   Knopfbreite fallen: `--drive-side-reserve: 130px` (2 × (34 px Knopf + 10 px Spaltenabstand) +
   2 × 12 px Innenabstand) geht als `calc(100vw - var(--drive-side-reserve))` in das `min()` der
   `--joystick-size` ein; im Breitbild-Layout entsprechend `var(--drive-column) -
   var(--drive-side-reserve)`, wobei `--drive-column` am `.app-frame` die Fahrspaltenbreite
   trägt. Ohne diese Grenze schob die Stufe „Sehr groß“ (1,5) auf einem 360-px-Telefon den
   Joystick auf 300 px und ließ je Seite 12 px übrig. `tests/layout-test.js` rechnet die
   Seitenspalte für 360 × 800 in allen vier Stufen nach (≥ 34 px, bei Stufe ≤ 1 ≥ 52 px für
   „gestoppt“). **Nicht ohne Gerät verifizierbar:** ob der Stapel auf jeder Bildschirmbreite
   wirklich beides vollständig zeigt — beim nächsten Gerätetest gezielt prüfen, auch in der
   Stufe „Sehr groß“ und als Linkshänder.

   **Der Tastenmodus hat eine eigene Geschwindigkeit** `state.view.cursorSpeedCms` (Startwert
   **15 cm/s**, Untergrenze 2 cm/s, Obergrenze die eingestellte `driveSpeedMax` in cm/s —
   Rangieren darf nie schneller werden als der Joystick). Sie gilt für **alle vier** Tasten, das
   Joystick-Maximum spielt hier keine Rolle. `cursorDriveVector(direction)`: vorwärts/rückwärts
   ist `linear = ±v, angular = 0`; links/rechts ist **Drehen auf der Stelle** (`linear = 0`) —
   genau das, was der Joystick bei reiner Seitwärtsauslenkung ohnehin sendet. Aus cm/s wird die
   Drehrate über die halbe Spurweite (`v / (mowerWidth/2)`, die Mäherbreite führt die App
   bereits), gedeckelt auf `driveTurnMax`. **Nicht ohne Gerät verifizierbar:** ob sich 15 cm/s
   für Präzisionsmanöver richtig anfühlt.

   Beide Modi teilen sich `startDriveHeartbeat()` — Sunray stoppt nach 1000 ms ohne neues `AT+M`,
   der Takt ist also in beiden Fällen sicherheitsrelevant und existiert nur einmal.

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

**Knopfbeschriftungen (nur noch am Aufnahme-Cluster) stehen seitlich, nicht oberhalb.** `.fab-label` ist `position: absolute`
im `position: relative`-Wrapper `.fab-with-label` und hängt senkrecht mittig am eigenen Knopf.
Oberhalb wuchsen mehrzeilige Beschriftungen nach oben und deckten auf schmalen Telefonen das
Symbol des darüberliegenden Knopfes ab. Weil die Beschriftung aus dem Fluss genommen ist, trägt
sie nichts zur Höhe der Knopfspalte bei — die gemeinsame senkrechte Mittelachse der Knöpfe bleibt
erhalten. **Standardseite ist links** (`right: 100%`), weil beide Knopfspalten am rechten
Bildschirmrand kleben; Knöpfe am linken Rand tragen `.label-right` und spiegeln die Seite
(`left: 100%`, `right: auto`). Breite ist auf `min(112px, 32vw)` gedeckelt, längere Texte brechen
um statt abgeschnitten zu werden, und `.map-hud` lässt mit `calc(100% - 220px)` Platz für
Knopfspalte **und** Beschriftung. `tests/layout-test.js` prüft Seite, Verankerung, Spiegelung und
das Breitenbudget. **Offen, ohne Gerät nicht prüfbar:** ob das auf jeder kleinen Bildschirmgröße
tatsächlich überlappungsfrei bleibt — der Test rechnet mit den CSS-Zahlen, nicht mit echtem
Textumbruch.

**Händigkeit: ein Schalter für die gesamte Bedienung.** `state.view.handed` ∈ `right | left`
(**Standard `right`**), einstellbar in *Einstellungen › Fahrgeschwindigkeit* (`#handedSelect`).
`applyHandedness()` setzt **ein einziges Attribut** `data-handed` am `<html>` — dieselbe
Schreibweise wie `applyTheme()` — und das Stylesheet hängt alle gespiegelten Stellen daran:

| Stelle | Rechtshänder (Grundregel) | Linkshänder (`:root[data-handed="left"]`) |
|---|---|---|
| `.map-toolbar` | Werkzeuge rechts | `flex-direction: row-reverse` (links) |
| `.map-info` | `left: var(--edge-gap)` | `right: var(--edge-gap); left: auto` |
| `.map-view-reset` | `right: var(--edge-gap)` | `left: var(--edge-gap); right: auto` |
| `.map-corner-undo` | `left: var(--edge-gap)` | `right: var(--edge-gap); left: auto` |
| `.capture-cluster` | `right: var(--edge-gap)` | `left: var(--edge-gap); right: auto` |
| `.capture-cluster .fab-label` | links vom Knopf (`right: 100%`) | rechts (`left: 100%`) |
| `.drive-side` | Spalte 1 | Spalte 3 |
| `.drive-mode-side` | `align-self: flex-start` | `align-self: flex-end` |
| `.drive-meta` | rechtsbündig | linksbündig |

**Warum zentral:** vorher saß die Umschaltung als `data-label-side` an der Fahrzone und betraf
nur deren Anzeige; jede weitere Stelle hätte ihre eigene Bedingung gebraucht. Rechtshänder steht
bewusst in den **Grundregeln**, nur die Linkshänder-Seite wird überschrieben — für bestehende
Nutzer ändert sich dadurch nichts. `tests/ui-test.js` prüft per Quelltextsuche, dass es keine
zweite, parallele Umschaltung mehr gibt (`dataset.labelSide` ist verboten, `data-handed` wird an
genau einer Stelle gesetzt).

**Migration:** die Einstellung hieß früher `driveLabelSide` und meinte die Seite der
Fahrtanzeige — `'left'` bedeutete Rechtshänder. `loadViewPreferences()` rechnet gespeicherte
Altwerte um (`driveLabelSide: 'right'` → `handed: 'left'`).

**Punktgröße:** sichtbarer Radius 5 (ausgewählt 9) bei 3,5 Rand — bewusst klein. Die
Trefferfläche hängt nicht daran, sie kommt aus dem unsichtbaren `map-point-hit`-Kreis mit
`state.hitRadiusUnits` (immer ≥ 44 × 44 px).

**Punktfarben:** der **Rand** zeigt das Element (`--perimeter` grün, `--exclusion` rot,
`--waypoint` bernstein, `--dock` blau), die **Füllung** die RTK-Qualität
(`quality-excellent/good/warning/bad`). Die Qualitätsregeln dürfen deshalb **kein `stroke`**
setzen — vorher taten sie das mit `!important` und alle Punkte sahen unabhängig vom Element
gleich aus. `tests/layout-test.js` prüft beides.

**Punkte nachträglich einfügen** (`insertPointAtSelection(offset)`, `offset` 0 = davor,
1 = danach): setzt einen Punkt auf den **geometrischen Mittelpunkt** der Strecke zwischen dem
ausgewählten Punkt und seinem Vorgänger bzw. Nachfolger. **Die Live-Position spielt keine Rolle**
— es wird nichts gemessen, sondern gerechnet, und deshalb greift „Nur bei RTK FIX“ hier
ausdrücklich **nicht**. Aus A-B-C-D wird mit ausgewähltem B also A-[Mitte AB]-B-C-D bzw.
A-B-[Mitte BC]-C-D.

**Alle vier Elementarten sind geordnete Arrays** — auch Wegpunkte und Dockpfad sind offene Pfade,
die als Polylinie gezeichnet und als LineString exportiert werden —, „davor/danach“ ist dort also
genauso wohldefiniert wie beim Perimeter. Eingefügt wird bei `offset 0` an `sel.index`, bei
`offset 1` an `sel.index + 1`.

**Ränder** über `insertNeighbourIndex(target, index, offset, closed)`: am Anfang einer **offenen**
Kontur hat „davor“ keinen Vorgänger, am Ende hat „danach“ keinen Nachfolger — die Funktion liefert
dann `-1`, und `refreshCaptureState()` graut genau diesen Knopf aus (nicht ausblenden, sonst
springt die Leiste). Bei **geschlossenen** Konturen laufen beide über die Schlussstrecke
letzter↔erster Punkt um; `selectedContourClosed()` liest dafür `perimeterClosed` bzw.
`exclusion.closed`, Wegpunkte und Dockpfad gelten immer als offen.

**Der eingefügte Punkt trägt `interpolated: true` und keine eigene Messung.** Die Gütedaten
(`gps`) erbt `midpointBetween()` vom **schlechteren** der beiden Nachbarn: ein konstruierter Punkt
ist höchstens so verlässlich wie die Strecke, auf der er liegt. Ohne dieses Erben hätte
`pointQuality()` jeden eingefügten Punkt als `bad` (rot) gezeichnet und `pointQualityStats()` ihn
in der Kartenprüfung als „ohne RTK FIX aufgenommen“ gezählt.

Nach dem Einfügen hebt die Funktion die Auswahl auf, damit die Oberfläche wie nach dem Verschieben
in den Normalzustand zurückfällt. Sichtbar sind die beiden Werkzeuge nur bei ausgewähltem
**Einzelpunkt** (nicht bei Flächenauswahl), nicht während der Automatik und nicht in gesperrten
Karten.

**`capturePreconditionKey()`** ist die gemeinsame Vorbedingung für jedes Setzen eines Punktes an
der **Live-Position**. Sie liefert `noCurrentPosition` bei alter Telemetrie, `noRtkFix` wenn
„Nur bei RTK FIX“ greift, sonst `null`. Benutzt wird sie von `appendCurrentPoint()` — das
Einfügen misst nicht und fragt sie deshalb nicht.

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
`askText({ title, message, value, confirmLabel, maxLength })` ersetzt `window.prompt()` und nutzt
**denselben** Dialog mit dem zusätzlichen Feld `#confirmDialogInput` — bewusst kein zweites Modal,
Escape, Hintergrundklick und Knopflogik gibt es nur einmal. `state.pendingConfirmText` schaltet
`confirmDialogRespond()` in den Textmodus: die Antwort ist dann der eingegebene Text bzw. `null`
bei Abbruch statt eines Wahrheitswerts. Testadapter: `globalThis.__promptAdapter`.
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

**Schnellzugriff „Fläche schließen & neue“** (`#closeAndNewBtn` in `#closeAndNewWrap`, als
Werkzeug in der Leiste oben, Beschriftung „Schließen & neu“): erscheint nur, wenn
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
weniger als zwei Fixes im Fenster wird nicht gemittelt. Mit dem **500-ms-Polling** liegen jetzt
bis zu vier Fixes im 2-s-Fenster statt einem bis zwei — die Glättung wirkt damit erstmals so, wie
sie gedacht war. Die frühere Einschränkung ist damit erledigt.

**Automatik — zwei Modi** über `state.view.autoCaptureMode` ∈ `time | distance`, umschaltbar in
*Einstellungen › Aufnahme*; **`time` bleibt Standard**. Im Menü steht immer nur die Zeile des
gewählten Modus (`applyAutoCaptureModeToUi()`).

- **Zeitbasiert:** `state.view.autoCaptureIntervalS` (Standard 5 s, 1–120).
- **Distanzbasiert:** `state.view.autoCaptureDistanceCm` (Standard 50 cm, **Minimum 10 cm**,
  Maximum 1000 cm). Ein Punkt entsteht, sobald die Strecke zwischen der aktuellen Position und
  dem **zuletzt tatsächlich gesetzten** Auto-Punkt (`state.autoCaptureLastPoint`) den Wert
  erreicht — bewusst nicht zur letzten Messung, sonst summierten sich kleine Schritte bei
  langsamer Fahrt nie zum Schwellwert. Gemessen wird zweidimensional (`Math.hypot`). Der Takt ist
  in diesem Modus `BLE_POLL_INTERVAL_MS`, nicht das Zeitintervall: es soll jede neue Position
  geprüft werden. Das Minimum von 10 cm liegt bewusst deutlich über der RTK-Fix-Genauigkeit von
  wenigen Zentimetern. **Nicht ohne Gerät verifizierbar:** ob 10 cm bei echtem RTK-Rauschen
  wirklich nicht „zittert“.

Die Beschriftung über dem Knopf trägt die Einheit des Modus in **beiden** Zuständen:
„Auto-Aufnahme (5s)“ / „Automatik läuft (5s)“ bzw. „Auto-Aufnahme (50cm)“ /
„Automatik läuft (50cm)“.

**„Nur bei RTK FIX“ gilt in beiden Modi** — das war schon vorher so und ist jetzt festgenagelt:
`startAutoCapture()` startet ohne FIX gar nicht erst, `autoCaptureTick()` prüft es je Takt, und
`appendCurrentPoint()` prüft es ein drittes Mal. Kein Bug gefunden, aber ein Test dafür ergänzt. Bewusst auch im gestoppten Zustand — der
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

**Flächen und Texte gehören in die Grundregel als Token, nicht in einen Hell-Override.** Das ist
zweimal schiefgegangen und hat dieselbe Signatur: eine Regel setzt einen festen dunklen
Hintergrund, der Hell-Block überschreibt daneben **nur** die Schrift- oder Rahmenfarbe — im
Dunkel-Modus fällt nichts auf, im Hell-Modus steht dunkler Text auf dunklem Kasten. Betroffen
waren `.validation-summary` (gemeldet) sowie `.help-status-row`, `.compat-item`,
`.help-feature-grid > div`, `.format-card`, `.faq-list details` und `.view-divider`. Alle nutzen
jetzt `--shell-panel-2` / `--shell-border` / `--shell-text` / `--shell-muted` in der Grundregel,
womit ein einziger Wert für beide Modi gilt. `tests/layout-test.js` prüft, dass Hintergrund,
Rahmen und Schrift dieser Flächen `var(--shell-…)` sind und der Wert `#0a1013` nirgends
zurückkehrt.

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
Schieber, Diagonalen im Tastenmodus, Messwerkzeug, Teilstück-/Geraden-Bearbeitung,
Undo-Pfeil (im Lösch-Button aufgegangen), distanzbasierte Auto-Aufnahme, Versionsverwaltung
(„Versionen & Verlauf“ mit Speichern/Wiederherstellen — vom Nutzer als unübersichtlich verworfen),
**jede sichtbare Versionsnummer der App**.

**Keine Versionsnummer im UI.** Die Version lebt nur noch in `sw.js` (`APP_VERSION` →
Cache-Name); `app.js` führt keine Versionskonstante mehr. `tests/sw-test.js` prüft, dass keine
Versionsangabe ins Markup zurückkehrt.

**Karte umbenennen und duplizieren** (Werkzeuge auf jeder Karte der Übersicht):
- `renameMapById()` ändert **nur** `map.name` — Geometrie, Positionsmodus, Ursprung und Kennung
  bleiben unangetastet. Eingabe über `askText()`, getrimmt und auf `MAP_NAME_MAX` = 60 Zeichen
  gekürzt (dieselbe Grenze wie das Eingabefeld für neue Karten, damit lange Namen die Kartenleiste
  nicht sprengen); ein leerer Name wird abgelehnt. **Gesperrte Karten lassen sich nicht
  umbenennen** — Umbenennen ist eine Änderung, und die Sperre schützt vor Änderungen.
- `duplicateMapById()` kopiert **tief** über `JSON.parse(JSON.stringify(...))`, damit weder Punkte
  noch Ausschlussflächen als gemeinsame Referenz hängen bleiben. Karte und jede Ausschlussfläche
  bekommen neue Kennungen; Geometrie, Positionsmodus, Ursprung **und die Sperre** kommen 1:1 mit.
  Die **aktive Karte wechselt nicht** — Duplizieren soll die laufende Arbeit nicht unterbrechen.
  Die Obergrenze `MAX_MAPS` gilt auch hier.
- `uniqueCopyName()` schneidet ein vorhandenes „(Kopie)“/„(copy)“ am Ende zuerst ab (sonst
  entstünde „… (Kopie) (Kopie)“) und zählt dann hoch, bis kein Anzeigename doppelt vorkommt. Der
  Kopie-Zusatz wird in die 60 Zeichen eingerechnet, ein sehr langer Name also gekürzt.

**Geschlossene Kontur nachträglich erweitern** (`#extendBtn` in `#extendWrap`, Werkzeug in der
Kartenleiste). Sichtbar nur, wenn `canStartExtension()`: Modus `perimeter` oder `exclusion`, die
aktive Kontur **geschlossen** mit ≥ 3 Punkten, Karte nicht gesperrt, keine Automatik. Wegpunkte und
Dockpfad sind offene Pfade — `activeContour()` liefert dort `null`.

Der Knopf in der Leiste **startet** nur; geführt wird der Ablauf danach im **Hinweisstreifen**
`#extendPanel` (`.map-hint`). Der sitzt als eigene Zeile **zwischen Werkzeugleiste und
Zeichenfläche** — bewusst kein Overlay und kein blockierendes Modal: die Anweisung hat die volle
Breite (in der schmalen Werkzeugleiste wurde sie abgeschnitten) und verdeckt die Karte nicht,
denn während der Auswahl muss weiter auf Punkte getippt werden. Er trägt den Schritttext
(`aria-live="polite"`), „Abbrechen“ (nur in der Auswahlphase, dort ist noch nichts verändert) und
„Fertig“ (sobald die Kante offen ist). `state.extension =
{ role, exclusionId, phase: 'picking' | 'adding', firstIndex, hintKey, hintVars }`;
`setExtensionHint()` merkt sich den Schlüssel, damit `refreshExtendPanel()` den Text jederzeit
neu zeichnen kann.

- **Auswahlphase:** `handleMapTap()` leitet Punkttreffer an `handleExtensionTap()` um und lässt
  **keinen** Tipp in die Innenfläche durch — während der Erweiterung geht es ausschließlich um die
  Kante. Der erste gewählte Punkt ist über `isExtensionPick()` als `.extend-pick-point` markiert
  (Warnfarbe, gestrichelter Ring — bewusst *nicht* die Auswahlfarbe, es ist keine Auswahl zum
  Verschieben). Nicht benachbart → `areNeighbourIndices()` sagt nein, die Auswahl beginnt von
  vorn, **an der Kontur ändert sich nichts**; der Hinweisstreifen zeigt den Fehler in Warnfarbe
  (`.map-hint.is-error`) und fordert erneut auf. Bewusst kein Dialog je Fehlgriff: die Auswahl
  zweier benachbarter Punkte misslingt auf kleinen Bildschirmen leicht, ein Modal je Mistipp wäre
  eine Zumutung — und ein blockierendes Modal verböte ohnehin das nötige Tippen auf die Karte.
- **Auftrennen** (`openContourForExtension()`, ein Undo-Schritt): `reorderForExtension()` ordnet
  die Punktfolge so um, dass sie beim **zweiten** gewählten Punkt beginnt, im Ring von der Kante
  weg läuft und beim **ersten** endet — der erste ist damit das neue offene Ende. Die Laufrichtung
  ergibt sich daraus, ob der zweite Punkt im Array auf den ersten folgt oder ihm vorangeht; die
  Schlussstrecke letzter↔erster zählt als Kante. Danach `perimeterClosed = false` bzw.
  `exclusion.closed = false`. Umgeordnet wird **in place** (`points.splice(0, …)`), weil
  `getActivePointArray()` dieselbe Array-Referenz liefert.
- **Anhängen** braucht keinerlei Sonderweg: `appendCurrentPoint()` hängt hinten an, und hinten
  steht der erste gewählte Punkt. Halte-Aufnahme, Automatik und Glättung gelten unverändert.
- **„Fertig“** (`finishExtension()`) schließt über dasselbe `closeContour()` wie der Moduswechsel.
- **Abbruch ohne „Fertig“** ändert bewusst nichts an der Geometrie: die Kontur bleibt **offen**,
  und dafür gibt es bereits `offerToCloseContour()` beim Moduswechsel und die Kartenprüfung
  (`openContours()` → `checkPerimeterOpen`/`checkAreaOpen` mit Angebot zum Schließen). `setMode()`
  beendet die Erweiterung, sobald die Elementart wechselt; `setActiveMapById()` ebenso.
- **`refreshExtensionState()`** hält den Zustand mit der Karte im Einklang: ein Undo, das die
  Kante wieder schließt, beendet die Erweiterung — sonst zeigte der Knopf „Fertig“ für eine
  längst geschlossene Kontur. Läuft aus `refreshExtendButton()` und damit aus jedem
  `refreshCaptureState()`.
- Während der Erweiterung sind **„Punkt davor/danach“ ausgeblendet** und die Flächenauswahl ist
  abgeschaltet — dieselbe Überlegung wie beim ausgeblendeten Papierkorb während der Automatik.
  **Nicht ohne Gerät verifizierbar:** ob die Zwei-Punkte-Auswahl auf kleinen Bildschirmen
  zuverlässig zu treffen ist (Trefferflächen benachbarter Punkte überlappen bei dichten Konturen),
  und ob der Hinweisstreifen dort vollständig lesbar bleibt, ohne der Karte zu viel Höhe zu
  nehmen.

**Elementliste** (Menü → *Karten*): `mapElements()` liefert Perimeter, jede Ausschlussfläche,
Wegpunkte und Dockpfad mit Punktzahl; `renderElementList()` zeichnet sie als Zeilen. Ein Tipp auf
die Zeile macht das Element zum Aufnahmeziel (`activateElement()`), der Papierkorb daneben leert
es bzw. entfernt eine Ausschlussfläche ganz (`deleteElement()`, mit Rückfrage). Das ersetzt das
frühere Auswahlfeld, das nur Ausschlussflächen kannte und nur im Ausschluss-Modus sichtbar war,
sowie „Aktuelles Element leeren“. **Einen Knopf „+ Neue Ausschlussfläche“ gibt es hier nicht
mehr** — Flächen entstehen von selbst, sobald im Ausschluss-Modus der erste Punkt fällt
(`appendCurrentPoint()` → `createExclusion()`); der Knopf erzeugte nur leere Platzhalter.

**Leere Ausschlussflächen räumt `pruneEmptyExclusions()` weg.** Sie hatten sich angesammelt und
ließen sich nicht einmal von Hand entfernen, weil der Papierkorb in der Elementliste bei null
Punkten gesperrt ist. Entfernt wird jede Fläche ohne Punkt — **außer der gerade bearbeiteten**
(`state.mode === 'exclusion'` und `state.activeExclusionId`), sonst fiele man unmittelbar nach
dem Moduswechsel wieder aus dem Modus heraus, bevor der erste Punkt steht. Gesperrte Karten
bleiben unangetastet. Zwei Auslöser:
- `requestModeChange()` **nach** `setMode()` — beim Verlassen ist der Modus dann nicht mehr
  `exclusion`, die eben verlassene leere Kontur also nicht mehr geschützt.
- `setMenuOpen(true)` — damit Altlasten aus früheren Sitzungen beim Öffnen der Übersicht
  verschwinden.

Die Funktion ist bewusst **synchron und ohne Undo-Schritt** (es geht nur Leergut verloren, ein
Eintrag dafür würde den 20er-Stapel mit Nichts füllen); Speichern erledigt der Aufrufer.

**Die Nummer einer Ausschlussfläche ist reine Beschriftung, keine Referenz.** Alles Technische
läuft über `exclusion.id` (`state.activeExclusionId`, `state.selectedArea`, `data-exclusion-id`,
Undo-Schnappschüsse). `localizedExclusionName()` bildet die Nummer ohnehin aus dem **Listenindex**
und ignoriert dabei einen gespeicherten Standardnamen — die Anzeige ist nach jedem Entfernen
automatisch wieder 1..x. Zusätzlich schreibt `renumberDefaultExclusionNames()` das Feld `name`
mit um, denn **der Export nimmt dieses Feld**; sonst stünde in der Datei weiter „Ausschluss 5“,
während die Liste 2 zeigt. Eigene Namen (etwa aus einem GeoJSON-Import) erkennt
`isDefaultExclusionName()` am Muster `Ausschluss|Exclusion N` und lässt sie unberührt.

**Sperrzustand** ist auf drei Wegen erkennbar, weil Farbe allein auf dem Gerät nicht reichte:
Bügelform (offen/geschlossen, `lockIcon()` mit Schlüsselloch nur im gesperrten Zustand), Farbe
(Warnfarbe) und Wort — die Schaltfläche trägt „Gesperrt“ bzw. „Offen“, die Kartenkarte zusätzlich
die Zeile „🔒 Karte gesperrt – keine Änderungen möglich“.

**Rückgängig-Knopf** (`#undoBtn` in `#undoFabWrap`, unten an der Kartenecke gegenüber dem
Aufnahme-Cluster, eigenes Symbol — gebogener Pfeil, nicht die Mülltonne): nimmt genau einen Bearbeitungsschritt
zurück. Er steht **parallel** zum Zustand „Letzten Punkt“ des Papierkorbs oben rechts — der
bleibt unverändert, beide sind bewusst nicht zusammengelegt, und die Symbole sind verschieden
(gebogener Pfeil gegen Mülltonne).

- `state.undoStack` hält bis zu `UNDO_STACK_LIMIT` = **20** Schnappschüsse, ältere fallen vorn
  weg. Der Stapel lebt **nur im Speicher** und wird nie in der Karte gespeichert — die früher
  persistierte Versionsverwaltung ist und bleibt entfernt. `setActiveMapById()` leert ihn.
- `geometrySnapshot()` kopiert nur die Geometrie (Perimeter samt `perimeterClosed`,
  Ausschlussflächen, Wegpunkte, Dockpfad, `activeExclusionId`) — Name, Sperre und Zeitstempel
  gehören nicht zu einem Bearbeitungsschritt. `commitUndo(snapshot)` legt ab, `pushUndo()` ist
  die Kurzform für „jetzt schnappschussen“.
- **Verdrahtet** (jeweils nach allen frühen Ausstiegen, unmittelbar vor der Mutation):
  `appendCurrentPoint()`, `relearnSelectedPoint()` (Verschieben), `deleteSelectedPoint()`,
  `undoPoint()`, `deleteSelectedArea()`, `deleteElement()`, `createExclusion()`,
  `closePerimeter()`, `reopenPerimeter()`, `closeContour()`.
- **Zusammengesetzte Aktionen kosten genau einen Schritt**: `asOneUndoStep(fn)` setzt
  `state.undoSuspended`, damit verschachtelte Aufrufe nichts eigenes ablegen — genutzt von
  `closeAndStartNewExclusion()` und `closeAllOpenContours()`. `appendCurrentPoint()` macht
  dasselbe von Hand: es nimmt den Schnappschuss **vor** einer eventuell automatisch angelegten
  Ausschlussfläche und legt ihn erst ab, wenn wirklich ein Punkt entsteht — ein Fehlversuch ohne
  Positionsdaten erzeugt so keinen leeren Schritt.
- **Leerer Stapel** = Knopf ausgegraut (`refreshUndoButton()`), nicht wirkungslos tippbar.
  **Während der Automatik und bei gesperrter Karte ausgeblendet** — dieselbe Regel wie beim
  Papierkorb, so vom Nutzer entschieden.

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
6. Polling: alle **500 ms** `AT+S` (`BLE_POLL_INTERVAL_MS`); wird übersprungen, solange ein
   Schreibvorgang läuft oder in den letzten 220 ms ein Fahrbefehl ging. Weder die Hauptplatine
   (aktualisiert die Position intern alle 20 ms) noch die ESP32-Brücke (reine UART↔BLE-
   Weiterleitung ohne eigene Taktung) begrenzen das — die früheren 2000 ms waren eine reine
   Entscheidung der App. **`BLE_UNANSWERED_POLL_LIMIT` wird deshalb aus dem Intervall
   abgeleitet** (`BLE_UNANSWERED_POLL_GRACE_MS` 8000 / Intervall = 16): als feste Anzahl hätte
   das schnellere Polling die Karenzzeit von 8 s auf 2 s verkürzt und gesunde Verbindungen
   abgeschossen. **Nicht ohne Gerät verifizierbar:** ob 500 ms in der Praxis stabil bleiben
   (BLE-Last, Akku).
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

## GeoJSON-Abgleich mit CaSSAndRA (Analyse 2026-09-06)

Verglichen wurde unser Export/Import mit dem GeoJSON, das die Mapping-Oberfläche von
**CaSSAndRA** (`github.com/EinEinfach/CaSSAndRA`) schreibt. **Am Code wurde nichts geändert** —
zwei Abweichungen sind Formatentscheidungen und liegen beim Nutzer (siehe unten).

### Ist-Zustand gegen CaSSAndRA-Konvention

| Aspekt | MapmakerBT | CaSSAndRA (GeoJSON-UI) | Bewertung |
|---|---|---|---|
| Typ-Kennung (intern) | `properties.role` = `perimeter` / `exclusion` / `waypoints` / `dock` | — | bleibt unser Merkmal |
| `properties.name` | **seit 2026-09-06 der CaSSAndRA-Typ** (siehe Mapping unten) | trägt den Typ | ✅ **angeglichen** |
| Anzeigename | `properties.label` (übersetzt: „Perimeter“, „Ausschluss 1“, „Dockpfad“) | — | eigenes Feld, kollidiert nicht mehr |
| Perimeter | `Polygon`, Ring geschlossen (`closeRing()` hängt den ersten Punkt an) | `Polygon`, geschlossen | ✅ **gleich** |
| Ausschluss | `Polygon`, Ring geschlossen | `Polygon`, geschlossen | ✅ **gleich** |
| Dockpfad | `LineString`, **offen** (`geometryForLine()` hängt nichts an) | `LineString`, offen, gerichtet | ✅ **gleich** |
| Dock-Verlängerung | **keine** | +20 cm in Fahrtrichtung beim Speichern | ✅ bewusst nicht übernommen |
| Koordinaten | lokale Sunray-**Meter**, Reihenfolge `[x, y]` | absolute **Grad** `[lon, lat]` | **abweichend** → Entscheidung 2 |
| Wegpunkte | eigenes Konzept, `role: 'waypoints'`, offener `LineString` | existiert nicht | bleibt, wird nicht angeglichen |

**Damit ist alles, was ohne Rückfrage anzugleichen gewesen wäre, bereits richtig:** geschlossen/
offen stimmt für alle drei gemeinsamen Typen, und die von CaSSAndRA nachträglich angehängten
20 cm gibt es bei uns nicht (geprüft in `mapToGeoJson()` und `geometryForLine()` — keine Stelle
manipuliert die Punktliste). `tests/app-core-test.js` nagelt beides jetzt fest, inklusive eines
Falls, der die CaSSAndRA-Verlängerung simuliert und dann fehlschlagen muss.

**Nebenbefund zur Reihenfolge:** unser `[x, y]` entspricht formal der GeoJSON-Ordnung `[lon, lat]`
(x = Ost, y = Nord). Die Reihenfolge ist also **nicht** falsch — nur die Einheit ist eine andere.

### Umgesetzt: Typbezeichner (2026-09-06)

`properties.name` trägt jetzt **ausschließlich** den Typ in CaSSAndRAs UI-Schreibweise, der
übersetzte Anzeigename ist in das neue Feld **`properties.label`** gezogen. `properties.role`
bleibt unverändert unser internes Merkmal.

| unser `role` | `properties.name` | `properties.label` |
|---|---|---|
| `perimeter` | `perimeter` | „Perimeter“ |
| `exclusion` | `exclusion` | Name der Fläche, z. B. „Ausschluss 1“ |
| `waypoints` | `search wire` (**mit Leerzeichen**) | „Wegpunkte“ |
| `dock` | `dockpoints` (**nicht** `dockPath` — das ist CaSSAndRAs abweichendes API-Vokabular) | „Dockpfad“ |

`CASSANDRA_TYPE_BY_ROLE` und die daraus gebildete Umkehrung stehen direkt vor
`geometryForLine()`. **Import** (`featureRole()`): zuerst `properties.role`, ersatzweise der Typ
aus `properties.name` — reine CaSSAndRA-Dateien werden also am Bezeichner erkannt. Der
Anzeigename einer importierten Fläche kommt aus `importedExclusionName()`: `label` zuerst, sonst
ein `name`, **der kein Typbezeichner ist** (ältere Dateien dieser App trugen den Anzeigenamen
noch dort), sonst der Standardname. Ohne diese Prüfung hieße jede importierte Fläche „exclusion“.

**Dabei behoben:** `geoJsonToMap()` kannte gar keinen Wegpunkt-Zweig — exportierte Wegpunkte
gingen beim Wiedereinlesen verloren. Der Rundlauf erhält sie jetzt.

**Weiterhin offen — Bezeichner ≠ Kompatibilität:** ein Import echter CaSSAndRA-Dateien ist
dadurch **noch nicht** sinnvoll nutzbar. CaSSAndRA exportiert absolute Grad-Koordinaten, wir
lesen und schreiben lokale Meter; die Werte würden schlicht falsch interpretiert. Das bleibt
Entscheidung 1 unten.

### Positionsmodus: relativ oder absolut (2026-09-06)

Optionaler Zusatzmodus nach dem Vorbild der grauonline-App. **Ohne Aktivierung ändert sich
nichts** — `positionMode: 'relative'` ist der Standard, es erscheint kein Eingabefeld, und der
Export bleibt bei lokalen Metern.

- **Gespeichert wird beides an der Karte** (`map.positionMode`, `map.origin = { lat, lon }`),
  nicht global. **Begründung:** der Ursprung definiert, was die Koordinaten *dieser* Karte
  bedeuten. Zwei Karten liegen in aller Regel an zwei verschiedenen Orten — ein globaler Ursprung
  wäre für jede zweite Karte falsch. Außerdem reist er so im JSON-Backup **und** im GeoJSON mit,
  sodass ein Import die Grad auch auf einem anderen Gerät zurückrechnen kann. Die Bedienelemente
  stehen deshalb im Menü unter *Karten*, nicht unter *Einstellungen*.
- **Umgerechnet wird nur beim GeoJSON-Export**, nie im Datenmodell. Intern bleiben alle Punkte
  lokale Meter. Ein Moduswechsel wirkt daher **nicht rückwirkend** auf gespeicherte Karten, nur
  auf künftige Exporte. Der **JSON-Export bleibt bewusst in Metern**: er ist das vollständige
  Backup des internen Modells (`JSON.stringify(state.activeMap)`) und muss unverändert wieder
  einlesbar sein; der Ursprung steckt als Feld darin.
- **Formel** (wie CaSSAndRA/grauonline): `lat = y/111111 + origin.lat`,
  `lon = x/(111111·cos(origin.lat)) + origin.lon`, Ausgabe in GeoJSON-Reihenfolge `[lon, lat]`
  mit 7 Nachkommastellen (≈ 1,1 cm). Rückweg entsprechend.
- **Zwei Bedingungen müssen zusammenkommen** (`mapOriginInUse()`): Modus `absolute` **und** ein
  gültiger Ursprung (`normalizeOrigin()`: Breite −90..90, Länge −180..180). Fehlt eines von
  beiden, exportiert die App weiter Meter, statt falsche Grad zu erzeugen.
- **Import**: der Ursprung kommt aus `properties.origin` der Datei, erkannt an
  `properties.coordinateSystem === 'wgs84-degrees'`. Kündigt eine Datei Grad an, bringt aber
  keinen Ursprung mit, wird sie mit `missingOrigin` abgelehnt — stillschweigend Grad als Meter zu
  lesen wäre schlimmer als eine klare Meldung. Dateien ohne Kennzeichnung gelten wie bisher als
  lokale Meter.
- Die CaSSAndRA-Bezeichner (`properties.name`/`label`) gelten in beiden Modi unverändert.

### Offene Entscheidung (Nutzer)

1. **Fremde CaSSAndRA-Dateien.** Für absolute `[lon, lat]` bräuchte es eine Referenzposition
   (`rover_lat`/`rover_lon`) und die Umrechnung `lat = y/111111 + ref_lat`,
   `lon = x/(111111·cos(ref_lat)) + ref_lon`. **Die Referenz haben wir nicht:** Sunray liefert
   über `AT+S` ausschließlich lokale X/Y-Meter. Der neue Positionsmodus löst das für **unsere
   eigenen** Dateien (der Ursprung wird vom Nutzer eingetragen und reist mit), aber eine **fremde
   CaSSAndRA-Datei** bringt ihren Ursprung nicht mit: sie enthält nur Grad. Um sie einzulesen,
   müsste der Nutzer den passenden Ursprung von Hand angeben — dafür gibt es bisher keinen Weg.

**Wichtig für beide:** solange die Koordinaten lokale Meter sind, wäre ein CaSSAndRA-Import bei
uns wertlos — Grad würden als Meter gelesen. Unser Import bleibt deshalb bewusst auf `role`
beschränkt, statt fremde Dateien scheinbar zu akzeptieren und stillschweigend Unsinn zu erzeugen.

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
| `tests/layout-test.js` | Statische Regressionsprüfung für Menüseite, Kartenknöpfe und Grundaufteilung (34 Fälle). `resolve(selector, property, { media })` löst die Kaskade auf; ohne `media` zählen nur Regeln **außerhalb** von `@media`: löst die Kaskade (inklusive `@media`) auf und prüft die Struktur in `index.html`. Deckt ab: Scrollcontainer intakt (`min-height: 0`, kein zweiter Scrollcontainer), Vollbildebenen in `dvh`, Blocklayout der Abschnittsstapel, kein Clipping aufgeklappter Abschnitte, gemeinsame senkrechte Achse der Kartenknöpfe, umbrechende Beschriftungen, HUD zweizeilig und ohne Überlappung der Knopfspalte. Braucht keinen Browser. |
| `tests/ui-test.js` | Die Kartier-Oberfläche (120 Fälle): Bestätigungs- und Meldungsdialog (Titel/Text/Beschriftung, beide Antworten, verdrängte Rückfrage, Einknopf-Meldung, `reportError` protokolliert und zeigt, keine `window.confirm()`/`window.alert()`-Aufrufe mehr), Moduswahl per Dialog, Rückfrage zum Schließen von Konturen, Kartenprüfung mit Konturschluss, Aufnahme/Löschen in allen drei Button-Zuständen, Flächenauswahl, Automatik (Ersetzen des manuellen Knopfs und Intervall), Positions-Glättung, Hell/Dunkel, Akkordeon, Auswahl per Tap, Touch-Zielgröße, Zoom-Grenzen, Tap-vs-Ziehen, Pinch, Halte-Aufnahme, Joystick-Kennlinie, RTK-Badge, Menüseite, gesperrte Karte, `init()`-Startpfad. Stacktraces mit `UI_TEST_STACK=1`. Antworten auf `confirm()` steuert der Test über `sandbox.__confirmAnswer`. |

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
  Sie ist **zweisprachig in einer Datei**: Sprachnavigation und Screenshots oben, danach der
  deutsche Abschnitt (`<a id="deutsch">`), dann der englische (`<a id="english">`). Bewusst keine
  zweite Datei — ein Link bleibt ein Link, und beide Fassungen veralten sonst getrennt. **Beide
  Sprachen müssen bei inhaltlichen Änderungen gemeinsam gepflegt werden.**
- Die **In-App-Hilfe** beschreibt den tatsächlichen Funktionsumfang und ist bei jeder
  Funktionsänderung mitzuziehen — in `I18N.de` **und** `I18N.en`. Der deutsche Text steht
  zusätzlich als Fallback im Markup, wie bei allen anderen `data-i18n`-Elementen auch.
- Änderungen an der ESP32-Firmware sind hier tabu; bei Bedarf dem Nutzer melden und vorschlagen.
- **Bei jedem Deploy `APP_VERSION` in `sw.js` hochzählen.** Sonst erscheint keine Update-Leiste
  (der Browser sieht keinen neuen Worker) und die Offline-Rückfallebene serviert weiter die
  Dateien vom Installationszeitpunkt der alten Version.

## Änderungsprotokoll

- 2026-09-07: **Layout-Konsolidierung: Undo, Karteninfo und Ansicht-Symbol zurück auf die
  Karte.** Die obere Werkzeugleiste trägt jetzt nur noch Werkzeuge (Löschen, Punkt davor/danach,
  „Schließen & neu“, „Erweitern“) und verschwindet ganz, sobald keines davon sichtbar ist. Auf
  die Kartenfläche gewandert sind: der 20-Schritte-Rückgängig-Knopf (unten, gegenüber dem
  Aufnahme-Cluster, in der Größe des **inaktiven** Automatik-Knopfes), die Karteninfo als
  einzeiliger halbtransparenter Streifen oben und das Ansicht-Symbol als **reines Zeichen** ohne
  Knopffläche in der gegenüberliegenden oberen Ecke. Die Karteninfo zeigt zusätzlich den
  Konturstatus „offen“/„geschlossen“, gespeist aus `activeContour()` und damit ausdrücklich nur
  im Perimeter- und Ausschluss-Modus; bei Wegpunkten und Dockpfad bleibt das Feld leer. Alle vier
  Positionen hängen am bestehenden `data-handed`, keine zweite Umschaltlogik. Neu ist das Token
  `--edge-gap` (12 px): es gilt für Karteninfo, Ansicht-Symbol, Rückgängig, Aufnahme-Cluster
  **und** den seitlichen Innenabstand der Fahrzone, wodurch Rückgängig-Knopf und
  Joystick-Umschalter auf einer senkrechten Linie stehen — dafür ist `.drive-side` jetzt
  `justify-self: stretch` und der Umschalter an der Außenkante ausgerichtet. Entfallen sind die
  Kurzbeschriftungen `undoShort` und `fitViewShort` (beide Knöpfe tragen auf der Karte nur noch
  ihr `aria-label`). Sechs neue Testfälle (layout 34, ui 120), gegen neun simulierte Rückfälle
  geprüft; Hilfe (neuer Eintrag „Karteninfo auf der Karte“) und README in beiden Sprachen
  nachgezogen. **Nicht ohne Gerät verifizierbar:** ob die Karte mit den drei zurückgewanderten
  Overlays auf kleinen Bildschirmen noch übersichtlich bleibt. `APP_VERSION` auf `v42`.

- 2026-09-07: **Fahrstatus abgeschnitten, Umschalter in die Seitenspalte.** Gemeldet: „Fahrt
  gestoppt“ wurde am Rand abgeschnitten, der Umschalter wirkte weiter am Kreis. Ausgeliefert war
  nachweislich der lokale Stand (MD5 von `styles.css` identisch, `v40`). Ursache im CSS: der
  Umschalter stand `position: absolute; right: 100%` neben dem Feld, und das Feld reservierte
  ihm 50 px Außenabstand (`--drive-toggle-gap`) — in derselben Seitenspalte, in der die
  Fahrtanzeige lag; auf einem 360-px-Telefon blieben ihr ~37 px, in der Stufe „Sehr groß“ 12 px.
  Fix: neue Seitenspalte `.drive-side` mit Umschalter **oben** und Fahrtanzeige **darunter**
  (Rechtshänder Spalte 1, Linkshänder Spalte 3, gemeinsam über `data-handed`), der Knopf ist aus
  `#driveControlArea` herausgezogen, Absolut-Positionierung und Außenabstand sind weg. Der
  Anzeigetext bricht an Leerzeichen um und kürzt sonst sichtbar per „…“. Zusätzlich ist die
  Joystick-Größe an die Breite gebunden (`--drive-side-reserve` 120 px, im Breitbild an
  `--drive-column`), damit die Seitenspalten nie unter die Knopfbreite fallen. Zwei neue
  layout-Fälle (31), einer rechnet die Seitenspalte für 360 × 800 in allen vier Stufen nach;
  gegen sieben simulierte Rückfälle geprüft. Hilfe und README (beide Sprachen) ergänzt.
  `APP_VERSION` auf `v41`.

- 2026-09-06: **„Perimeter erweitern“ wurde am Telefon rechts abgeschnitten.** Zwei Ursachen,
  beide im CSS bzw. in den Texten bestätigt. (a) `.map-tools` war `flex: 0 0 auto` und konnte
  damit nicht schrumpfen: die Gruppe nahm immer ihre volle Inhaltsbreite ein, wuchs über die
  Leiste hinaus und wurde von `.map-stage { overflow: hidden }` gekappt — das dokumentierte
  „scrollt notfalls waagerecht“ war nie erreichbar. Jetzt `flex: 0 1 auto; min-width: 0`, und
  die Karteninfo gibt über ihr höheres Schrumpfgewicht (`1 10 auto`) zuerst nach. (b) Die
  Kurzbeschriftung `extendPerimeterShort` war gar nicht kurz, sie trug den vollen Text
  „Perimeter erweitern“ — jetzt „Erweitern“ (EN „Extend“), der lange Text bleibt im
  `aria-label`. Dazu ein Deckel je Werkzeug (`max-width`), Ellipse statt Überlauf am Label und
  eine Media-Query unter 430 px für Abstände, Mindestbreite und Schrift. Der bestehende
  layout-Test hatte den Fehler festgeschrieben (`flex: 0 0 auto` als „die Werkzeuge geben nicht
  nach“) — er prüft jetzt die Absicht über die Schrumpfgewichte. Zwei neue layout-Fälle (29),
  gegen sechs simulierte Rückfälle geprüft; der Rückfall „langes Kurzlabel“ lief zunächst durch
  eine reine Längengrenze durch, deshalb prüft der Test jetzt Kurz- gegen Langfassung.
  `APP_VERSION` auf `v40`.

- 2026-09-06: **Drei Korrekturen nach dem Gerätetest.** (a) Der Steuerungs-Umschalter zeigt jetzt
  das Symbol des Modus, in den er **wechselt**, nicht des aktiven — im Joystick-Modus also das
  Steuerkreuz. Das steckt rein in CSS; der vorhandene Test auf die Beschriftung hätte einen
  Rückfall nicht gefangen, deshalb gibt es jetzt einen eigenen Fall für die Symbolzuordnung
  (beim Sabotage-Durchlauf aufgefallen). Das `.sr-only`-Label benennt ebenfalls das Ziel, das
  feste `aria-label` am Knopf ist entfallen — es hätte den Text überschrieben. (b) Der Knopf
  überlappte den Kreis; er steht jetzt **vollständig daneben** (`right: 100%`, gespiegelt
  `left: 100%`), und `--drive-toggle-gap` reserviert den Platz, damit er nicht in die
  Fahrtanzeige läuft. (c) Die Anleitung zum Kontur-Erweitern wurde in der schmalen
  Werkzeugleiste abgeschnitten. Sie läuft jetzt über den Hinweisstreifen `#extendPanel`
  zwischen Leiste und Zeichenfläche — volle Breite, `aria-live`, Fehler in Warnfarbe, und
  „Fertig“/„Abbrechen“ sitzen mit darin. Bewusst **kein** Overlay und kein blockierendes Modal:
  während der Auswahl muss die Karte antippbar bleiben. In der Leiste steht nur noch der
  Startknopf. Ein neuer layout-Fall (27) plus ein neuer für die Symbolzuordnung, sechs ui-Fälle
  angepasst; gegen sieben simulierte Rückfälle geprüft. `APP_VERSION` auf `v39`.

- 2026-09-06: **Umschalter ans Fahrfeld, Konturen nachträglich erweiterbar.** (a) Der
  Joystick/Tasten-Umschalter sitzt nicht mehr in der Werkzeugleiste, sondern in der oberen Ecke
  des Fahrfelds — bei Rechtshändern links, bei Linkshändern gespiegelt rechts, über dasselbe
  `data-handed`. Dafür teilen sich Joystick und Tastenkreuz jetzt das Feld `.drive-control`, das
  allein Größe und Gitterplatz trägt; beide füllen es aus. Die Umschaltlogik selbst ist
  unverändert, das Textlabel nur noch `.sr-only`. Vier Positions-Tests umgestellt, ein neuer
  Fall für die Ecke und die Spiegelung. (b) Neues Werkzeug „Perimeter/Fläche erweitern“: zwei
  benachbarte Punkte antippen trennt die Kante auf, `reorderForExtension()` macht den zuerst
  gewählten Punkt zum offenen Ende, danach hängt das gewohnte Aufnehmen an — neue Punkte landen
  genau zwischen den beiden gewählten. „Fertig“ schließt über `closeContour()`. Auftrennen und
  jeder Punkt sind eigene Undo-Schritte; ein Undo, das die Kante wieder schließt, beendet die
  Erweiterung (`refreshExtensionState()`). **Abbruch lässt die Kontur offen** — das deckt die
  bestehende Logik für offene Konturen ab, es kam keine neue Sonderbehandlung dazu. Zehn neue
  ui-Fälle (117), gegen neun simulierte Rückfälle geprüft; Hilfe und README in beiden Sprachen
  ergänzt. `APP_VERSION` auf `v38`.

- 2026-09-06: **Karte umbenennen und duplizieren.** Zwei Werkzeuge je Karte in der Übersicht.
  Umbenennen läuft über den neuen `askText()`, der **denselben** Dialog wie die Rückfragen mit
  einem zusätzlichen Eingabefeld benutzt — kein zweites Modal und kein `window.prompt()`; ein
  Test prüft das per Quelltextsuche. Validierung: getrimmt, leer abgelehnt, auf 60 Zeichen
  gekürzt, gesperrte Karten bleiben gesperrt. Duplizieren kopiert tief (neue Kennungen für
  Karte und Ausschlussflächen), übernimmt Geometrie, Positionsmodus, Ursprung und Sperre 1:1
  und lässt die aktive Karte unangetastet. `uniqueCopyName()` schneidet ein vorhandenes
  „(Kopie)“ ab und zählt hoch, sodass weder „(Kopie) (Kopie)“ noch doppelte Namen entstehen.
  Acht neue ui-Fälle (107), gegen sechs simulierte Rückfälle geprüft; Hilfe und README in
  beiden Sprachen ergänzt. `APP_VERSION` auf `v37`.

- 2026-09-06: **Zweiter Steuerungsmodus: vier Richtungstasten.** Umschaltbar über einen neuen
  Knopf ganz rechts in der Kartenleiste (Symbol zeigt den aktiven Modus) und über
  *Einstellungen › Fahrgeschwindigkeit*; die Wahl liegt in `state.view.driveControl` und
  übersteht einen Neustart. Das Tastenkreuz sitzt in derselben Gitterzelle wie der Joystick und
  nutzt dieselbe `--joystick-size` — Größeneinstellung, Fahrtanzeige und Linkshänder-Spiegelung
  gelten dadurch ohne zweite Layoutlogik für beide. Eigene Geschwindigkeit
  `cursorSpeedCms` (15 cm/s, 2 bis `driveSpeedMax`), die für alle vier Tasten gilt; der Joystick
  bleibt beim RC-Prinzip. Links/rechts dreht auf der Stelle über den bestehenden `AT+M`-Weg
  (`linear 0` plus Drehrate), die Drehrate kommt aus cm/s geteilt durch die halbe Spurweite
  (Mäherbreite) und ist auf `driveTurnMax` gedeckelt. Beide Modi teilen sich einen
  `startDriveHeartbeat()`. Acht neue ui-Fälle (99), gegen sechs simulierte Rückfälle geprüft;
  Hilfe und README in beiden Sprachen ergänzt. `APP_VERSION` auf `v36`.

- 2026-09-06: **Positionsmodus in der Hilfe erklärt.** Neuer Eintrag „Positionsmodus“ in der
  Karte *Karten erstellen & korrigieren* (DE/EN): relativ ist der Standard und braucht keine
  Eingabe, absolut nur für den Austausch mit Programmen, die Weltkoordinaten erwarten, der
  Ursprung gehört zur jeweiligen Karte, und ohne gültigen Ursprung bleibt alles bei lokalen
  Metern. Dazu ein kurzer Abschnitt in der README (beide Sprachen) unter *Karten sichern und
  übertragen* — dem Ort, an dem der Export ohnehin erklärt wird — mit dem zusätzlichen Hinweis,
  dass der JSON-Backup in jedem Fall in Metern bleibt. `APP_VERSION` auf `v35`.

- 2026-09-06: **Statuskasten der Kartenprüfung war im Hell-Modus unlesbar.** Ursache im CSS
  bestätigt: `.validation-summary` hatte `background: #0c1518` und `border: #263a41` fest
  verdrahtet, der Hell-Block überschrieb daneben **nur** `color` — dunkler Text auf fast
  schwarzem Kasten. Jetzt `--shell-panel-2` / `--shell-border` / `--shell-text` in der
  Grundregel, die beiden überflüssigen Hell-Overrides sind entfallen. **Ein Scan über alle im
  Markup benutzten Selektoren mit festem dunklem Hintergrund ohne Hell-Override fand dieselbe
  Ursache in fünf Hilfe-Flächen** (`.help-status-row`, `.compat-item`, `.help-feature-grid >
  div`, `.format-card`, `.faq-list details`) und in `.view-divider`; alle mit umgestellt,
  inklusive der Schriftfarben darin. `.connection-orb` und die Sprachumschaltung standen im
  Treffer, sind aber durch eine spätere Regel längst auf `--accent-soft` — unverändert
  gelassen. Zwei neue Testfälle (layout 25), gegen vier simulierte Rückfälle geprüft.
  `APP_VERSION` auf `v34`.

- 2026-09-06: **Optionaler Positionsmodus relativ/absolut.** Neue Einstellung im Menü unter
  *Karten*: „Relativ“ (Standard, alles unverändert) oder „Absolut“ mit einmalig einzutragendem
  Ursprung (Breite/Länge, üblicherweise die Ladestation). **Gespeichert an der Karte**, nicht
  global — zwei Karten liegen an zwei Orten, und so reist der Ursprung im Backup und im GeoJSON
  mit. Umgerechnet wird **nur beim GeoJSON-Export**; das Datenmodell und der JSON-Backup-Export
  bleiben lokale Meter, ein Moduswechsel wirkt also nicht rückwirkend. Umrechnung nur, wenn
  Modus **und** gültiger Ursprung zusammenkommen; sonst weiter Meter statt falscher Grad. Der
  Import erkennt Grad an `coordinateSystem: 'wgs84-degrees'` und rechnet über den mitgelieferten
  Ursprung zurück; kündigt eine Datei Grad ohne Ursprung an, wird sie abgelehnt. Neun neue
  Testfälle (app core, ui 91), gegen fünf simulierte Rückfälle geprüft — darunter ein
  vergessenes `cos(lat)` und ein Ursprung, der nach dem Zurückschalten weiter umrechnet.
  `APP_VERSION` auf `v33`.

- 2026-09-06: **Typbezeichner an CaSSAndRA angeglichen.** `properties.name` trägt im
  GeoJSON-Export jetzt nur noch den Typ in CaSSAndRAs Schreibweise (`perimeter`, `exclusion`,
  `search wire` mit Leerzeichen, `dockpoints`), der übersetzte Anzeigename ist ins neue Feld
  `properties.label` gezogen; `properties.role` bleibt unser internes Merkmal. Der Import
  erkennt Features jetzt über `role` **oder** über einen CaSSAndRA-Namen (`featureRole()`).
  Beim Umbau ist aufgefallen, dass `geoJsonToMap()` **keinen Wegpunkt-Zweig hatte** —
  exportierte Wegpunkte gingen beim Wiedereinlesen verloren; behoben. Der Anzeigename einer
  importierten Fläche kommt aus `label`, ersatzweise aus einem `name`, der kein Typbezeichner
  ist (alte Dateien), sonst dem Standardnamen — sonst hieße jede Fläche „exclusion“.
  Koordinaten bleiben lokale Meter, Ringschluss und offener Dockpfad unverändert. Drei neue
  Testblöcke in `tests/app-core-test.js`, gegen sechs simulierte Rückfälle geprüft.
  `APP_VERSION` auf `v32`.

- 2026-09-06: **GeoJSON-Export gegen CaSSAndRA abgeglichen — reine Analyse, kein Codeeingriff.**
  Ergebnis im Abschnitt „GeoJSON-Abgleich mit CaSSAndRA“: geschlossen/offen stimmt für
  Perimeter, Ausschluss und Dockpfad bereits überein, und die 20-cm-Verlängerung des letzten
  Dockpunktes gibt es bei uns nicht. Es gab also nichts unkritisch anzugleichen. Zwei
  Abweichungen sind Formatentscheidungen und liegen beim Nutzer: das Typ-Vokabular
  (`properties.role` gegen CaSSAndRAs `properties.name`, dazu dessen abweichendes
  API-Vokabular `dockPath`) und die Koordinaten (lokale Meter gegen absolute `[lon, lat]` —
  dafür fehlt uns die Referenzposition, Sunray liefert über `AT+S` nur lokale X/Y).
  Neue Testfälle in `tests/app-core-test.js`: Ringschluss je Typ, offener Dockpfad ohne
  Verlängerung, Koordinatenreihenfolge, Rundlauf Export→Import, Polygon-Rückfall bei zwei
  Punkten. Gegen vier simulierte Rückfälle geprüft, darunter die CaSSAndRA-Verlängerung.
  `APP_VERSION` unverändert, weil sich an der App nichts geändert hat.

- 2026-09-06: **PWA-Installation erklärt.** Die Hilfe empfahl das Installieren, ohne zu sagen,
  was eine PWA ist oder wie es geht. Neuer Abschnitt in der Karte *Offline im Garten*: kurze
  Erklärung (eigenes Symbol, Vollbild ohne Adressleiste, läuft aus dem Zwischenspeicher, kein
  App-Store), nummerierte Schritte für Android/Chrome und der Safari-Weg für iPhone/iPad —
  letzterer **mit dem ausdrücklichen Hinweis**, dass iOS kein Web Bluetooth kennt und die App
  dort keine Verbindung aufbauen kann; ohne diesen Satz wäre die Anleitung eine Falle. Dazu ein
  Hinweis, dass Deinstallieren die gespeicherten Karten nicht anfasst. Alles in DE und EN, dazu
  derselbe Inhalt in der README (beide Sprachen) statt einer abweichenden Zweitfassung.
  **Kein externer Link:** in der Hilfe gibt es kein `<a href>`-Muster, und ein Auswärtslink wäre
  in einer offline gedachten App genau dann tot, wenn man ihn braucht. Nebenbei den veralteten
  Fallback-Text von `offlineWorks4` im Markup nachgezogen (die Übersetzung war schon aktuell).
  `APP_VERSION` auf `v31`.

- 2026-09-06: **Einfügen ist geometrisch, nicht positionsbasiert** (Korrektur der Vorgabe vom
  selben Tag). „Punkt davor/danach“ setzt den neuen Punkt auf die **Mitte der Strecke** zum
  Nachbarn statt an die Mäherposition; damit entfällt jede Abhängigkeit von Telemetrie und
  „Nur bei RTK FIX“. Neu: `insertNeighbourIndex()` für die Ränder (offene Kontur → Knopf
  ausgegraut, geschlossene → Umlauf über die Schlussstrecke), `selectedContourClosed()` und
  `midpointBetween()`. Dabei ist aufgefallen, dass ein Punkt ohne `gps` von `pointQuality()`
  als `bad` gilt und in der Kartenprüfung als „ohne RTK FIX“ zählte — der eingefügte Punkt
  trägt deshalb `interpolated: true` und erbt die Güte des **schlechteren** Nachbarn.
  Vier weitere ui-Fälle (86), gegen fünf simulierte Rückfälle geprüft; Hilfe und README in
  beiden Sprachen nachgezogen. `APP_VERSION` auf `v30`.

- 2026-09-06: **Punkt davor/danach einfügen.** Zwei neue Werkzeuge in der Kartenleiste, sichtbar
  nur bei ausgewähltem Einzelpunkt: `insertPointAtSelection(offset)` setzt per
  `splice(sel.index + offset, 0, point)` einen Punkt an der Live-Position in die Punktfolge.
  Datenstruktur geprüft: alle vier Elementarten sind geordnete Arrays, auch Wegpunkte und
  Dockpfad (offene Pfade, LineString-Export) — „davor/danach“ ist überall eindeutig, es war
  also nichts abzugrenzen. Position und Glättung kommen unverändert aus `pointFromTelemetry()`.
  Die RTK-Vorbedingung ist dabei zu `capturePreconditionKey()` zusammengezogen worden, damit
  „Nur bei RTK FIX“ für Aufnehmen und Einfügen dieselbe Stelle hat. Ein Einfügen ist ein
  Undo-Schritt, danach fällt die Oberfläche wie nach dem Verschieben in den Normalzustand.
  Sieben neue ui-Fälle (82), gegen fünf simulierte Rückfälle geprüft; Hilfe und README in
  beiden Sprachen ergänzt. `APP_VERSION` auf `v29`.

- 2026-09-06: **Hilfe und README auf den aktuellen Stand gebracht, README zweisprachig.**
  In-App-Hilfe: die Karte „Karten erstellen & korrigieren“ ist von 10 auf 17 Einträge gewachsen
  (Moduswechsel mit Schließen-Abfrage, Halte-Aufnahme, Flächenauswahl, Lösch-Werkzeug mit drei
  Zuständen, Rückgängig über 20 Schritte, „Schließen & neu“, Automatik zeit-/distanzbasiert,
  Elementliste, automatische Bereinigung leerer Ausschlussflächen), dazu eine neue Karte
  „Ansicht & Bedienung“ (RTK-Anzeige, Nur bei RTK FIX, Zoomen, Hell/Dunkel, Bedienseite,
  Joystick-Größe, Diagnose). **Entfernt**, weil die Funktionen nicht mehr existieren:
  `helpSmartAuto*` (intelligente Auto-Aufnahme) und `helpVersions*` („Änderung zurücknehmen“
  im Menü). Korrigiert: Punktqualität (Rand = Element, Füllung = RTK), Lösch-Werkzeug steht in
  der Kartenleiste statt „oben rechts“, Fahrgeschwindigkeit unter *Einstellungen ›
  Fahrgeschwindigkeit*, GeoJSON exportiert auch Wegpunkte. Alles in DE und EN.
  README: gegen den Ist-Stand geprüft und korrigiert (kein „+ Neue Ausschlussfläche“ mehr,
  Werkzeugleiste statt Eckknöpfe, Undo mit 20 Schritten, Distanz-Automatik, Bedienseite,
  Joystick-Größe, Bereinigung leerer Flächen, Update-Leiste) und **zweisprachig** ausgebaut.
  `APP_VERSION` auf `v28`.

- 2026-09-06: **Karteninfo in die Werkzeugleiste, Händigkeit zentral.** (a) Kartenname,
  Punktzahl und Statuszeile stehen jetzt links in der Kartenleiste statt als halbtransparenter
  Kasten auf der Karte; der Overlay `.map-hud` ist restlos entfernt, die Karte gewinnt dessen
  Fläche. Damit ein langer Name die Werkzeuge nicht aus der Leiste schiebt, hat `.map-info`
  `flex: 1 1 auto; min-width: 0` und kürzt je Zeile per Ellipse, `.map-tools` ist `0 0 auto`.
  (b) Die Links-/Rechtshänder-Einstellung galt bisher nur der Fahrtanzeige. Sie ist jetzt ein
  **einziges Attribut `data-handed` am `<html>`** (`applyHandedness()`), an dem Werkzeugleiste,
  Karteninfo, Aufnahme-Cluster samt Beschriftungen und Fahrtanzeige gemeinsam hängen — statt
  fünf einzelner Bedingungen. Das alte `data-label-side` an der Fahrzone ist weg, gespeicherte
  Altwerte werden migriert. Fünf neue Testfälle (ui 74, layout 23), gegen fünf simulierte
  Rückfälle geprüft. `APP_VERSION` auf `v27`.

- 2026-09-06: **Leere Ausschlussflächen räumen sich selbst auf.** Der Knopf „+ Neue
  Ausschlussfläche“ unter der Elementliste ist entfallen — er erzeugte genau die leeren
  Platzhalter, die sich in der Übersicht sammelten, während Flächen längst automatisch beim
  ersten Punkt entstehen. Neu: `pruneEmptyExclusions()`, ausgelöst beim Verlassen des
  Ausschluss-Modus (nach `setMode()`, damit die eben verlassene Kontur nicht mehr geschützt
  ist) und beim Öffnen der Menüseite (Altlasten früherer Sitzungen). Geschützt ist nur die
  gerade bearbeitete Fläche, gesperrte Karten bleiben unangetastet. **Zur Nummerierung geprüft:**
  die Nummer ist reine Anzeige, `localizedExclusionName()` bildet sie aus dem Listenindex,
  Referenzen laufen über `exclusion.id` — es war also nichts zu reparieren. Ergänzt wurde nur
  `renumberDefaultExclusionNames()`, weil der **Export** das Feld `name` mitnimmt und dort sonst
  die alte Nummer stünde; eigene Namen bleiben. Acht neue ui-Fälle (72), gegen fünf simulierte
  Rückfälle geprüft. `APP_VERSION` auf `v26`.

- 2026-09-05: **Werkzeugleiste oben statt Knöpfe in den Kartenecken.** Gemeldet: auf schmalen
  Bildschirmen brachen die Beschriftungen an den Eckknöpfen Buchstabe für Buchstabe
  untereinander. Ursache war die Kombination aus Beschriftungen, die nur die Knopfbreite zur
  Verfügung hatten, und `overflow-wrap: anywhere`. Lösch-Werkzeug, Rückgängig, „Schließen & neu“
  und „Ansicht zurück“ stehen jetzt in einer waagerechten `.map-toolbar` am oberen Rand der
  Karte, Symbol oben und Beschriftung `nowrap` darunter; passt die Leiste nicht, scrollt sie
  waagerecht. `.map-stage` ist dafür eine Flexbox-Spalte aus Leiste und `.map-canvas-area`
  geworden, in der Hinweiszeile und Aufnahme-Cluster jetzt liegen. Zustände, Klick-Handler und
  Sichtbarkeitsregeln blieben unverändert — die `…Wrap`-Hüllen tragen weiterhin `hidden`, also
  brauchte `app.js` außer dem neuen Schlüssel `fitViewShort` keine Logikänderung. Aufnahme- und
  Automatik-Knopf sind unverändert unten rechts. Vier layout-Fälle umgeschrieben (21), gegen
  drei simulierte Rückfälle geprüft. `APP_VERSION` auf `v25`.

- 2026-09-05: **Polling auf 500 ms, distanzbasierte Automatik.** (a) `BLE_POLL_INTERVAL_MS` = 500
  statt 2000. Dabei musste `BLE_UNANSWERED_POLL_LIMIT` von der festen 4 auf eine Ableitung aus
  `BLE_UNANSWERED_POLL_GRACE_MS`/Intervall umgestellt werden — sonst hätte die Karenzzeit
  8 s → 2 s betragen und gesunde Verbindungen getrennt. Ein BLE-Testfall hat sich dadurch
  inhaltlich gedreht: bei abgerissener Notify-Kette tropft der ESP32-Stau jetzt viermal so
  schnell heraus, es setzen sich wieder ganze Zeilen zusammen, der Link ist also nur noch
  langsam statt tot — und darf deshalb nicht mehr getrennt werden. Der Fall „es kommt wirklich
  nichts Verwertbares“ bleibt eigenständig abgedeckt. (b) Neuer Automatik-Modus
  „Distanzbasiert“ (10–1000 cm, Standard 50) neben dem bestehenden Zeitmodus, mit
  modusabhängigem Label und modusabhängiger Menüzeile. Die RTK-FIX-Pflicht galt bereits für
  beide Modi — geprüft, kein Bug, jetzt per Test abgesichert. Sieben neue ui-Fälle und ein
  neuer ble-Fall (ui 64, ble 34), gegen fünf simulierte Rückfälle geprüft. `APP_VERSION` auf
  `v24`.

- 2026-09-05: **Beschriftungen seitlich, neuer allgemeiner Rückgängig-Knopf.** (a) Alle
  Knopfbeschriftungen stehen jetzt neben statt über dem Knopf — absolut positioniert am eigenen
  Knopf, Standardseite links, `.label-right` spiegelt sie für Knöpfe am linken Rand. Damit
  können mehrzeilige Labels das Symbol darüber nicht mehr verdecken, und die Knopfspalte behält
  ihre Mittelachse. `.map-hud` reserviert entsprechend mehr Platz. (b) Neuer `#undoBtn` unten
  links mit 20-Schritte-Stapel über `geometrySnapshot()`/`commitUndo()`/`asOneUndoStep()`,
  verdrahtet an zehn kartenändernde Aktionen; parallel zum bestehenden Papierkorb, eigenes
  Symbol, bei leerem Verlauf ausgegraut, während der Automatik ausgeblendet. Elf neue Testfälle
  (ui 57, layout 21), gegen vier simulierte Rückfälle geprüft. `APP_VERSION` auf `v23`.

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
  umschaltbar über *Einstellungen › Fahrgeschwindigkeit*; seit 2026-09-06 über `data-handed`). Neue Einstellung
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

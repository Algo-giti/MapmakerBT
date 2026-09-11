# MapmakerBT — Projekt-Gedächtnis

> Diese Datei **ist im Git-Repo versioniert** (`git ls-files` findet sie, `.gitignore` listet sie
> nicht). Änderungen an ihr landen also in jedem Commit, der sie mitnimmt. Vor jeder neuen Aufgabe
> komplett lesen, danach kurz und stichpunktartig aktuell halten.

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

   **Finale Aufteilung (Stand v48) — was in der Leiste steht und was auf der Karte liegt.**
   Die Zuordnung ist zweimal hin und her gewandert; sie steht hier vollständig, damit sie sich
   nicht wieder aus dem Verlauf rekonstruieren lässt.

   | Element | Ort | Rechtshänder | Linkshänder |
   |---|---|---|---|
   | Kartenname (`#mapNameLabel`), Zeile 1 | Werkzeugleiste | links | rechts |
   | Punktzahl + Konturzustand (`#mapMeta`), Zeile 2 | Werkzeugleiste | links | rechts |
   | Lösch-Werkzeug (`#deleteFabWrap`) | Werkzeugleiste | rechts | links |
   | „Punkt davor/danach“ (`#insertBeforeWrap`/`#insertAfterWrap`) | Werkzeugleiste | rechts | links |
   | „Schließen & neu“ (`#closeAndNewWrap`) | Werkzeugleiste | rechts | links |
   | „Erweitern“ (`#extendWrap`) | Werkzeugleiste | rechts | links |
   | Positionsanzeige (`#mapPosition`) | **auf der Karte**, unten mittig | zwischen Rückgängig und Aufnahme | gespiegelt |
   | Ansicht zurücksetzen (`#fitViewBtn`) | **auf der Karte**, oben | rechts | links |
   | Rückgängig (`#undoFabWrap`) | **auf der Karte**, unten | links | rechts |
   | Aufnahme-Cluster (`.capture-cluster`) | **auf der Karte**, unten | rechts | links |

   **Werkzeugleiste** (`.map-toolbar`) trägt zwei Kinder: den **zweizeiligen Infoblock**
   `.toolbar-info` (`#toolbarInfo`) und `.map-tools`, deshalb `justify-content: space-between`;
   `row-reverse` bei Linkshändern dreht beide Seiten. Der Infoblock gibt bei Platzmangel
   **zuerst** nach (`flex: 0 10 auto` gegen `0 1 auto` bei den Werkzeugen) und kürzt per
   Ellipse — er darf die Werkzeuge nie verdrängen.

   **Der Infoblock ist eine Spalte, die Leiste bleibt eine Zeile** (`flex-direction: column` nur
   am Block). Zeile 1 ist der Kartenname (`.toolbar-map-name`, `#mapNameLabel`), Zeile 2 die
   kleiner gesetzte `.toolbar-map-meta` (`#mapMeta`) mit `#mapSummary` (Punktzahl) und
   `#contourStatus` (Kontur samt Zustand). Waagerechte Seite kommt aus `row-reverse` der Leiste,
   die **Ausrichtung im Block** zusätzlich aus `align-items` (`flex-start` / links gespiegelt
   `flex-end`) — ohne das stünde der Text bei Linkshändern linksbündig in einem rechtsbündigen
   Block. `refreshToolbarVisibility()` klappt die Leiste nur ein, wenn **weder** Name **noch**
   eine der beiden Angaben gefüllt ist und kein Werkzeug sichtbar ist — sonst verschwände
   ausgerechnet die Karteninfo.

   **Warum zurück in die Leiste (v48):** auf kleinen Displays (Xperia XZ1) kostete der
   Overlay-Streifen `.map-info` zu viel Kartenfläche. Er ist **restlos entfernt**; ein
   layout-Test verbietet seine Rückkehr. Der frühere Einwand — die Info konkurriere in der
   Leiste mit den Werkzeugen um die Breite — bleibt beantwortet durch das höhere
   Schrumpfgewicht des Blocks und `min-width: 0`.

   **Positionsanzeige `#mapPosition`** liegt unten auf der Karte und spannt sich als **Band**
   genau über die Lücke zwischen Rückgängig- und Aufnahme-Knopf. Sie trägt allein `#pointStatus`
   (die Positions-/Ereignismeldung). Beide Kanten sind gesetzt —
   `left: calc(--edge-gap + --fab-size + 8px)`, `right: calc(--edge-gap + --capture-size + 8px)`,
   bei Linkshändern vertauscht —, **deshalb kann sie die Knöpfe nicht überlappen**, sie kürzt
   vorher per Ellipse. Die Abzüge sind seitenverschieden, weil die Knöpfe verschieden breit sind
   (48 gegen 104 px); dafür gibt es das Token `--capture-size`. Das Band selbst ist unsichtbar
   und `pointer-events: none`; die halbtransparente Pille (`--shell-hud`) trägt der Text darin,
   damit sie sich auf die Textbreite zusammenzieht und mittig in der Lücke steht. Nachgerechnet
   bleiben auf 320/360/412/720 px CSS-Breite mindestens 60 px Lücke; der Test rechnet das für
   beide Händigkeiten nach. **Nicht ohne Gerät verifizierbar:** ob die zweizeilige Leiste auf dem
   Xperia XZ1 nicht doch zu viel Höhe von der Karte nimmt.

   **Konturzustand: immer als Anhängsel an eine Bezeichnung, nie als freistehendes Wort.**
   Das war ein gemeldeter Fehler — „geschlossen“ stand an fester Stelle der Karteninfo, und bei
   mehreren Ausschlussflächen war nicht erkennbar, welche gemeint ist. Der Zustand wird deshalb
   nur noch über `contourStateSuffix(role, exclusionId)` erzeugt, das ein
   ` · geschlossen`/` · offen` **an einen vorhandenen Namen anhängt**.

   `contourClosedState(role, exclusionId)` ist die einzige Quelle des Zustands und liefert
   ausdrücklich drei Werte: `true`, `false` und **`null`** für „das Konzept gibt es hier nicht“
   (Wegpunkte, Dockpfad, nicht mehr vorhandene Fläche). Nur an `null` hängt, ob überhaupt etwas
   angezeigt wird; `selectedContourClosed()` delegiert dorthin.

   Angehängt wird an genau zwei Stellen:
   - `selectedPointLabel()` → „Ausschluss 1 · Punkt 3 · offen“ (Statuszeile, von jedem
     Telemetrie-Takt neu geschrieben) und die Auswahlmeldung `areaSelected`.
   - `#contourStatus` über `contourStatusChipText()` → **Name plus Zustand** als eine Einheit,
     etwa „Perimeter · geschlossen“ oder „Ausschluss 2 · offen“.

   `contourStatusChipText()` entscheidet in dieser Reihenfolge, welche Kontur betroffen ist:
   1. **Ausgewählter Einzelpunkt** → Feld bleibt leer. Die Statuszeile daneben trägt den Namen
      bereits, sonst stünde er zweimal in derselben Zeile.
   2. **Ausgewählte Fläche** (`selectedExclusion()`) → deren Name und Zustand. Bewusst nicht
      über die Auswahlmeldung: die ist nur vorübergehend, der nächste Telemetrie-Takt
      überschreibt `#pointStatus` wieder.
   3. Sonst die Kontur des aktiven Modus (`activeContour()` bzw. `currentExclusion()`).

   Gerufen wird `refreshContourStatus()` aus `renderMap()` **und** `refreshCaptureState()`. Weil
   im Feld jetzt ein Name steht, ist `.info-chip` schrumpfbar (`flex: 0 1 auto; min-width: 0`)
   und kürzt per Ellipse; leer verschwindet es weiterhin per `.info-chip:empty`.

   **Das Konturfeld ist die einzige sichtbare Zustandsanzeige.** Die Statuszeile `#pointStatus`
   daneben darf denselben Sachverhalt nicht wiederholen — genau das war ein gemeldeter Fehler:
   bei geschlossenem Perimeter stand dort zusätzlich der ausgeschriebene Satz
   `perimeterAlreadyClosed`, direkt neben „Perimeter · geschlossen“. Der vierte Parameter von
   `show()` ist in diesem Zweig deshalb `''`. **Der Satz selbst bleibt erhalten**, aber
   ausschließlich als dritter Parameter, also als Vorlesehilfe `#captureButtonHint` — die ist
   `.sr-only`, steht also nicht sichtbar in der Zeile und erklärt dem Screenreader den Zustand
   des Aufnahme-Knopfes. Merksatz für neue Zweige: **Zustand ins Konturfeld, Handlung auf den
   Knopf, Ereignisse in die Statuszeile.**

   **Ansicht zurücksetzen `#fitViewBtn`** ist ein **reines Symbol** ohne Knopffläche und Rahmen
   (`border: 0; background: none`), wie in Kartenprogrammen üblich; ein Schlagschatten hält es
   über hellem wie dunklem Kartengrund lesbar, die Trefferfläche bleibt 44 × 44 px. Die
   Sichtbarkeitsregel ist unverändert: eingeblendet erst nach eigener Zoom-/Verschiebe-Geste.

   **Rückgängig `#undoFabWrap`** sitzt unten an der Kartenecke **gegenüber** dem Aufnahme-Cluster,
   in der Größe des **inaktiven** Automatik-Knopfes (48 px Umriss-Kreis, `.undo-fab`), nicht in
   der des großen Aufnahme-Knopfes. Funktion, 20er-Stapel und Sichtbarkeitsregeln sind
   unverändert; nur die Position hat gewechselt. Es trägt **keine sichtbare Beschriftung** mehr,
   nur sein `aria-label` — die Kurzschlüssel `undoShort` und `fitViewShort` sind entfallen.

   **Zwei Token halten die Randspalte zusammen.** `--edge-gap` (12 px) ist der Randabstand aller
   randständigen Bedienelemente: Karteninfo, Ansicht-Symbol, Rückgängig-Knopf, Aufnahme-Cluster
   **und** der seitliche Innenabstand der Fahrzone. `--fab-size` (48 px) ist die Größe der
   kleinen runden Randknöpfe (`.undo-fab`, `.auto-fab`) und legt damit die **Mittelachse** der
   Spalte fest: `--edge-gap + --fab-size / 2` vom Bildschirmrand.

   **Gleicher Randabstand genügt nicht.** Der Joystick-Umschalter ist nur 34 px breit; bündig
   links stand er sichtbar versetzt unter dem 48 px breiten Rückgängig-Knopf. Er rückt deshalb um
   `--drive-toggle-inset` = `(--fab-size - --drive-toggle-size) / 2` ein und liegt damit auf
   derselben Mittelachse. Bei Linkshändern wird `margin-left` ausdrücklich auf `0` zurückgesetzt
   und stattdessen `margin-right` gesetzt — sonst wirken beide Einrückungen gleichzeitig. Wer
   eine dieser Größen ändert, ändert das Token, nicht die einzelne Regel;
   `tests/layout-test.js` rechnet beide Mitten nach.

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

   **Die Spalte füllt seit v43 auch die Höhe (`align-self: stretch`).** Ohne das erbt sie
   `align-items: center` von `.drive-zone`: der Stapel aus Umschalter und Fahrtanzeige stand
   dann **mittig**, der Umschalter also tief unten neben der Anzeige statt oben. Als erstes Kind
   der höhenfüllenden Spalte sitzt er jetzt am oberen Rand der Steuerzone und damit senkrecht
   unter dem Rückgängig-Knopf der Karte — dazwischen liegen nur die Zonenkante und der obere
   Innenabstand, ein zusätzlicher `margin-top` am Knopf wäre ein Rückfall. Damit die Fahrtanzeige
   deswegen nicht gleich unter dem Umschalter klebt, behält sie über `margin-block: auto` ihre
   senkrechte Mitte neben dem Joystick. **Senkrechte Reihenfolge kommt allein aus der
   DOM-Reihenfolge** (Umschalter vor `.drive-meta`), waagerechte Seite aus `align-self` — in
   einer Spalten-Flexbox ist `align-self` die **Quer**achse, also links/rechts.
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

   **Das Tastenkreuz erbte einen Außenabstand aus einer Altlast — das war die eigentliche
   Ursache der abgeschnittenen Taste unten.** Nachgewiesen durch Auflösen der **ganzen** Kaskade
   für das Element (nicht nur für den Selektortext): `styles.css:1715` `.drive-pad` aus dem
   v14-Layer setzt `margin: 16px auto 10px` und trifft dieses Element weiterhin;
   `styles.css:2442` `.drive-zone .drive-pad` setzte Größe, Lücke und Zeilen, aber **nie**
   `margin`. `styles.css:2376` `.drive-zone .joystick-base` setzt dagegen ausdrücklich
   `margin: 0` — genau diese Asymmetrie fehlte, und nur deshalb war der Kreis nie betroffen,
   obwohl sich beide dasselbe Feld teilen.

   **Warum das unabhängig von der Größenstufe abschneidet**, als geschlossene Rechnung: die Zone
   ist `padTop + F + padBottom` hoch und sitzt am unteren Bildschirmrand, ihre Inhaltsoberkante
   liegt also bei `H − F − padBottom`. Das Kreuz ist `height: 100%` = `F`, beginnt aber bei
   `+ marginTop` — seine Unterkante liegt damit bei `H − padBottom + marginTop`. Erlaubt ist
   höchstens `H − padBottom`. **Jedes `marginTop > 0` schneidet ab, das `F` kürzt sich heraus.**
   Bei 16 px oberem Abstand und 8 px unterem Innenabstand (`env(safe-area-inset-bottom)` ist auf
   Android häufig 0) ragte die Taste 8 px über den Bildschirmrand und wurde von
   `body { overflow: hidden }` gekappt. Fix: `.drive-zone .drive-pad { margin: 0 }` plus
   `grid-template-areas: none`, weil die Altlast Bereiche benennt, die es im heutigen Markup
   nicht mehr gibt.

   **Warum der erste Fixversuch danebenlag:** er behob eine echte, aber andere Einschränkung
   (siehe nächster Absatz) — und sein Test fragte mit `resolve('.drive-zone .drive-pad', …)` nur
   Regeln mit **wörtlich diesem** Selektor ab. Die Altlast `.drive-pad` trifft dasselbe Element,
   war für diese Abfrage aber unsichtbar. `tests/layout-test.js` hat deshalb jetzt zusätzlich
   `effectiveStyle({ classes, ancestors, tag }, property)`: es wertet **jede** passende Regel aus
   und entscheidet nach Spezifität und Reihenfolge. **Für Altlasten-Fallen ist das das richtige
   Werkzeug — `resolve()` reicht dafür nicht.**

   **Zusätzlich braucht das Tastenkreuz eine eigene Untergrenze für die Feldgröße.** Global gilt
   `button { min-height: 46px }`, und eine `1fr`-Gitterzeile kann ihr Kind nicht unter dessen
   Mindesthöhe drücken: das Kreuz brauchte dadurch immer mindestens 3 × 46 + 2 × 4 = 146 px. War
   das Feld kleiner (kleine Größenstufe, niedriges Display), lief der Überhang unten aus der
   Fahrzone heraus und die Taste „zurück“ wurde vom Bildschirmrand gekappt. **Der runde Joystick
   ist kein `<button>` und hatte dieses Minimum nie** — deshalb trat der Fehler nur im
   Tastenmodus auf, obwohl sich beide dasselbe Feld teilen. Zwei Teile gehören zusammen:
   `.drive-key { min-height: 0 }` lässt die Tasten mit dem Feld schrumpfen, und
   `--drive-field-min` = `3 × --drive-pad-key-min + 2 × --drive-pad-gap` (= 140 px) ist die
   **Untergrenze der `--joystick-size`-Rechnung**, damit jede Taste ein 44-px-Daumenziel bleibt.
   `.drive-pad` benutzt dieselbe `--drive-pad-gap`, mit der gerechnet wurde. **Nicht ohne Gerät
   verifizierbar:** ob das Kreuz auf allen realen Bildschirmgrößen und -verhältnissen vollständig
   sichtbar bleibt — der Test rechnet vier gängige Auflösungen in allen vier Stufen nach, nicht
   den echten Umbruch.

   **Der Tastenmodus hat eine eigene Geschwindigkeit** `state.view.cursorSpeedCms` (Startwert
   **15 cm/s**, Untergrenze 2 cm/s, Obergrenze die eingestellte `driveSpeedMax` in cm/s —
   Rangieren darf nie schneller werden als der Joystick). Sie gilt für **alle vier** Tasten, das
   Joystick-Maximum spielt hier keine Rolle. `cursorDriveVector(direction)`: vorwärts/rückwärts
   ist `linear = ±v, angular = 0`; links/rechts ist **Drehen auf der Stelle** (`linear = 0`) —
   genau das, was der Joystick bei reiner Seitwärtsauslenkung ohnehin sendet. Aus cm/s wird die
   Drehrate über die halbe Spurweite (`v / (mowerWidth/2)`, die Mäherbreite führt die App
   bereits), gedeckelt auf `driveTurnMax`. **Nicht ohne Gerät verifizierbar:** ob sich 15 cm/s
   für Präzisionsmanöver richtig anfühlt.

   Beide Modi teilen sich `startDriveHeartbeat()`; der Takt ist in beiden Fällen
   sicherheitsrelevant und existiert nur einmal. (Er war ursprünglich auf ein 1000-ms-Fenster der
   Firmware ausgelegt — dass dieses Fenster trägt, ist **nicht belegt**, siehe „SICHERHEIT: Das
   1000-ms-Totmannfenster trägt nicht“.) Er läuft
   **laufend**, nicht nur einmal beim Antippen (per Test festgehalten).

   **Ruhezustand: der Stopp wird laufend wiederholt** (`startIdleStopTicker()`, `sendIdleStop()`,
   `DRIVE_IDLE_STOP_INTERVAL_MS` = **500 ms** = `BLE_POLL_INTERVAL_MS`). Solange **keine**
   Fahreingabe anliegt (`driveInputActive()` prüft `state.driveDirection`), geht alle 500 ms ein
   `AT+M,0,0` raus — nur bei tatsächlich stehender Verbindung (`connected`, kein `demo`,
   Characteristic vorhanden). **Zweck:** ein einzelnes verlorenes Stopp-Paket heilt sich im
   nächsten Takt von selbst, ganz **ohne** Fehlererkennung. Das ergänzt die Meldung bei
   fehlgeschlagenen Schreibvorgängen, ersetzt sie nicht.

   **Warum 500 ms:** dieselbe Kadenz wie das Polling (eine Taktung statt zweier); geht ein Stopp
   verloren, landet der nächste 500 ms später. (Die ursprüngliche Begründung „damit fallen zwei
   Stopps in Sunrays 1000-ms-Fenster“ ist hinfällig — das Fenster ist nicht belegt.)
   Schneller wäre reine Zusatzlast auf einem Link mit 15-Byte-Paketen. Die Leerlauflast steigt
   dadurch von 2 auf 4 Schreibvorgängen je Sekunde.

   **Lebenszyklus** hängt an der Verbindung, wie `startPolling()`/`startRxWatchdog()`: gestartet
   in `establishGatt()`, beendet in `dropStaleLink()`, `onDisconnected()` und
   `giveUpReconnect()`. `stopDrive()` schickt beim Loslassen weiterhin **sofort** einen Stopp;
   der Ruhe-Takt übernimmt danach ohne eigenes Zutun, weil er nur `driveInputActive()` prüft.

   **Fehler werden nur beim Übergang gemeldet** (`state.idleStopFailing`): zwei Stopps je Sekunde
   würden die Statuszeile sonst zuschütten. Der erste Fehlschlag läuft über `reportBleError()`,
   jeder weitere nur ins Diagnoseprotokoll; geht es wieder, fällt der Zustand zurück und die
   nächste Störung meldet sich erneut. Ohne Verbindung wird **gar nicht** gesendet — sonst liefe
   der Aufruf in „nicht verbunden“ und meldete dem Nutzer einen Sendefehler, obwohl nichts zu
   senden war.

   **Es gibt darunter keine nachgewiesene Ebene.** Die frühere Aussage, Sunray halte auch bei
   komplettem Ausfall von App und Funk nach spätestens einer Sekunde an, ist **zurückgezogen** —
   sie war eine unbelegte Schlussfolgerung, und der Nutzer hat am Gerät das Gegenteil beobachtet.
   Der Ruhe-Takt ist damit nicht die zweite, sondern die **einzige** Ebene, und er wirkt nur bei
   stehendem Funklink. Begründung und Belegstellen: „SICHERHEIT: Das 1000-ms-Totmannfenster trägt
   nicht“.

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
| `.toolbar-info` | `align-items: flex-start` | `align-items: flex-end` |
| `.map-position` | Rückgängig links, Aufnahme rechts abgezogen | Abzüge vertauscht |
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
Not-Halt (die früheren Diagnose-Tasten gibt es nicht mehr). `establishGatt()` setzt die
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

### Export und Teilen (Menü → Karten)

**Eine Datei, zwei Wege.** `MAP_EXPORT_FORMATS` ist die einzige Stelle, an der Endung, MIME-Typ und
Inhalt je Format stehen (`json` → `.mapcreator-ardumower.json`, das vollständige Backup;
`geojson` → `.geojson` über `mapToGeoJson()`). `mapExportFile(format)` baut daraus
`{ text, fileName, mimeType }`; `exportMapFile()` reicht das an `downloadTextFile()` weiter,
`shareCurrentMap()` an `navigator.share()`. **Geteilt wird damit wortgleich dieselbe Datei mit
demselben Dateinamen wie beim Speichern** — ein ui-Test vergleicht beide Wege inhaltlich und
verbietet per Quelltextsuche eine zweite Erzeugungsstelle.

**Vier Knöpfe in derselben Gruppe** (`.export-grid`, zwei Spalten): Speichern und Teilen stehen je
Format nebeneinander, auf schmalen Schirmen (eine Spalte) untereinander. Ausdrücklich kein eigener
Platz woanders im Menü. Die Teilen-Knöpfe tragen im Markup `hidden` und werden **erst durch die
bestandene Prüfung eingeblendet** — andernfalls blitzte auf Geräten ohne Datei-Freigabe kurz ein
Knopf auf, der nichts kann, und ein Fehler in der Prüfung ließe ihn stehen statt verschwinden.

**Fähigkeitsprüfung je Format, nicht pauschal** (`canShareMapFormat(format)`): geprüft wird mit
einer **Probedatei gleicher Endung und gleichen MIME-Typs** über `navigator.canShare({ files })`,
weil Browser die Freigabe am Dateityp entscheiden — `application/geo+json` kann abgelehnt werden,
während `application/json` durchgeht. `shareCapableNavigator()` verlangt `share`, `canShare`
**und** `File`. Fehlt etwas, blendet `refreshShareButtons()` (aus `init()`) den betroffenen Knopf
**aus** statt ihn stehen zu lassen und später einen Fehler zu zeigen; der normale Export bleibt der
Weg.

**Abbruch ist kein Fehler.** Schließt der Nutzer das Freigabe-Menü, wirft `navigator.share()` einen
`AbortError` — der wird still verworfen. Jeder andere Fehler geht über `reportError()` sichtbar an
den Nutzer. Wird `shareCurrentMap()` trotz fehlender Unterstützung gerufen (etwa nach einem
Rückfall in der Sichtbarkeitslogik), kommt `showNotice()` mit dem Verweis auf den Export statt einer
Ausnahme.

**Bewusst keine Anbieternamen** in Hilfe und README: das Freigabe-Menü kommt vom Gerät, welche
Ziele darin stehen, entscheidet nicht diese App.

**Nicht ohne Gerät verifizierbar:** ob das Android-Freigabe-Menü die Datei tatsächlich korrekt an
die Ziel-App übergibt (Dateiname, Endung, Inhalt) — insbesondere bei Cloud-/Dateisynchronisations-Apps,
die eigene Vorstellungen vom MIME-Typ haben.

### CaSSAndRA-Exportformat (drittes Format, Stand v52)

Erzeugt **genau die Datei, die CaSSAndRA selbst schreibt** (`export_geojson`,
`MowManager/CaSSAndRA/CaSSAndRA/src/backend/data/mapdata.py:665-690`) — nicht unsere Vermutung
davon. Endung `.json`, MIME `application/json`, wie CaSSAndRAs eigener Download
(`chooseperimeter.py:69`).

**Form, jeder Punkt belegt:**
- **Genau zwei Schlüssel oben** (`type`, `features`, mapdata.py:670). Ein dritter mit einem Objekt
  als Wert lässt `pd.read_json` (mapdata.py:463) scheitern — der GeoJSON-Zweig ab :507 wird dann
  **nie erreicht**. Genau daran scheiterte unser normaler GeoJSON-Export (top-level `properties`).
- **Reihenfolge** perimeter (:674), dockpoints (:678), search wire (:682), exclusion je Fläche
  (:686-689). Dockpfad und Suchdraht werden **auch leer** geschrieben, weil das Vorbild sie
  unbedingt anlegt.
- `properties` trägt **nur** `name`; `idx` steht auf **Feature**-Ebene, nicht in `properties` (:688).
- **Geschlossene Ringe** (mapdata.py:614-630 über :668). Empirisch geprüft: shapely liefert für
  offenen wie geschlossenen Ring dieselben Koordinaten, ein geschlossener erzeugt **keinen**
  doppelten Punkt — nur ein doppelt geschlossener täte das.
- **7 Nachkommastellen — unsere Wahl, keine Eigenschaft des Vorbilds.** CaSSAndRAs eigener
  Export **rundet nicht**: `coords_rel_to_abs()` (mapdata.py:696-703) gibt volle Doubles zurück,
  `.values.tolist()` und `json.dumps` schreiben sie unverändert. Nachgeprüft an zwei echten
  CaSSAndRA-Dateien — dort stehen **20 Nachkommastellen**. Die Rundung führt allein
  `localToAbsolute()` (`DEGREE_DECIMALS`, app.js) ein, und sie ist der einzige Grund, warum der
  Rundlauf überhaupt eine Abweichung hat. Gerechnet, nicht geschätzt: 5 → 472,6 mm, 6 → 61,4 mm,
  **7 → 6,1 mm**, 8 → 0,6 mm. Theoretische Obergrenze bei 7 Stellen 7,86 mm (Äquator), 6,51 mm
  bei 52°. Gemessen über beide echten Karten gegen die echte Python-Importfunktion: **7,85 mm**.
  **Folge, die beachtet werden muss:** eine Karte, deren Koordinaten viel kleiner sind als
  1e-7 Grad, fällt durch diese Rundung vollständig auf [0, 0] zusammen — genau das passierte,
  solange der Import Grad als Meter las.
- **Flächen unter drei Punkten bleiben draußen**: `Polygon(coordinates[0])` (mapdata.py:515) wirft
  dann und reißt den ganzen Import mit. **Nicht still**: `noticeCassandraSkippedAreas()` zeigt beim
  Export einmal eine Meldung mit Anzahl, Namen und Punktzahl jeder ausgelassenen Fläche — auch der
  leeren, weil die Entscheidung, ob der Verlust belanglos ist, dem Nutzer gehört. Der Export läuft
  danach weiter. **Erst handeln, dann melden**: ein Dialog davor verbraucht die Nutzergeste, und
  `navigator.share()` verlangt eine frische. **Zusätzlich davor sichtbar**: `#cassandraSkippedHint`
  steht dauerhaft neben den Export-Knöpfen, sobald die aktive Karte solche Flächen führt — gespeist
  aus derselben `cassandraSkippedAreas()`, damit Hinweis und Meldung dasselbe sagen. Nachgeführt
  aus `refreshExportButtons()`, das dafür auch aus `setMenuOpen(true)` läuft: die Knöpfe stehen auf
  der Menüseite, und die Geometrie kann sich seit dem letzten `renderMapControls()` geändert haben.
- **Fünftes Feature `mapmaker`** mit unseren Metadaten. CaSSAndRAs Import vergleicht
  `properties.name` in einer `if`/`elif`-Kette **ohne `else`** (mapdata.py:511-521) — ein
  unbekannter Name fällt still heraus. Empirisch gegengeprüft: mit und ohne dieses Feature kommen
  dieselben Zeilen heraus, auch als erstes Feature und mit `geometry: null`. **Zwingend** ist nur,
  dass es `properties.name` überhaupt trägt: fehlt `properties` oder `name`, bricht der Import mit
  `KeyError` ab, weil der Vergleich vor jeder Fallunterscheidung steht.

**Umrechnung** ist die exakte Umkehrung von `coords_abs_to_rel` (mapdata.py:704-710) — bewusst
dieselbe grobe Näherung, weil sich nur so beide Richtungen aufheben; eine geodätisch richtigere
Formel driftete beim Rückweg. `cos` nimmt **Bogenmaß** und die Breite des **Bezugspunkts**, nie
die des jeweiligen Punktes.

**Bezugspunkt (`state.cassandraReference`, `CASSANDRA_REFERENCE_KEY`)** gehört zur **Installation**,
nicht zur Karte, und ist ausdrücklich **nicht** `map.origin`: CaSSAndRA führt selbst nur einen
einzigen Wert (`rovercfg.lat`/`lon`), und eine relativ geführte Karte ist für dieses Format
genauso brauchbar. Die Sperre hängt deshalb **nicht** an `positionMode`, sondern allein daran, ob
das Wertepaar gesetzt und gültig ist.

**Vorrang, von oben nach unten (Stand v53):**
1. ein **gespeichertes** Wertepaar — gewinnt immer;
2. ein **ausdrücklich geleertes** Feld (im Speicher steht `null`) — bleibt leer, Export gesperrt;
3. **nichts gespeichert** → `map.origin` der aktiven Karte, falls sie `absolute` ist und einen
   gültigen Ursprung hat, sonst die **Vorgabe 0/0**.

`storedCassandraReference()` unterscheidet dafür drei Speicherzustände: Schlüssel fehlt (nie
festgelegt), Schlüssel enthält `null` (geleert), Schlüssel enthält ein Paar. **Ohne den mittleren
Fall hätte die Sperre keinen Bestand** — das nächste Zeichnen würde das geleerte Feld wieder mit
der Vorgabe füllen.

**Fall 3 wird nicht gespeichert.** Täte er es, wäre schon nach dem ersten Zeichnen etwas
gespeichert und die Vorbelegung aus `map.origin` damit für immer unerreichbar — auch für den Fall,
dass der Nutzer erst später eine absolut geführte Karte anlegt. So folgt die Vorbelegung der
aktiven Karte, bis der Nutzer selbst etwas einträgt. Damit ist `map.origin` als Vorbelegung
**erreichbar geblieben**, nur nicht mehr persistent.

**0/0 ist eine Angabe, kein Platzhalter.** Es ist CaSSAndRAs eigener Auslieferungswert
(`cfgdata.py:195-196`) — wer dort nie etwas eingetragen hat, stimmt mit unserer Vorgabe überein.
Rechnerisch ist der Äquator der **ungünstigste** Fall der Näherung (`cos(0) = 1`), gemessen
**5,5473 mm** über die ganze Beispielkarte, gegen die echte Python-Importfunktion gegengeprüft
(identische vier Zahlen). Die theoretische Obergrenze dort ist 7,86 mm.

**Ausgleich für die weggefallene Hürde:** `noticeCassandraExport()` nennt bei **jedem** Export den
tatsächlich verwendeten Bezugspunkt im Klartext, in derselben Meldung wie die ausgelassenen
Flächen und ohne zusätzliche Nutzergeste. Grund: seit 0/0 vorbelegt ist, kann eine Datei ohne
jedes Zutun entstehen, und 0/0 ist nur richtig, wenn auch in CaSSAndRA 0/0 steht — weicht es ab,
liegt die Karte dort versetzt, **ohne** dass eine Seite einen Fehler zeigt.

**Ein leeres Eingabefeld ist keine Null.** `Number('')` ist `0`, und 0 liegt im gültigen Bereich —
ohne Vorprüfung machte `normalizeOrigin()` aus zwei leeren Feldern das Wertepaar 0/0, der Nutzer
könnte einen einmal eingetragenen Wert also gar nicht mehr zurücknehmen. `originFromInputs()`
(direkt über `mapOriginInUse()`) fängt den Leerfall ab und ist die **einzige** Stelle dafür:
sie bedient sowohl den CaSSAndRA-Bezugspunkt (`updateCassandraReferenceFromUi()`) als auch den
**Kartenursprung** (`updatePositionModeFromUi()`, seit v54). Schon ein einzelnes leeres Feld
genügt — ein halber Ursprung ist keiner. Ein ui-Test verbietet, dass ein Eingabefeld wieder
unmittelbar in `normalizeOrigin()` läuft.

**Ein geleertes Ursprungsfeld setzt den Modus nicht zurück:** `positionMode` bleibt `absolute`,
`origin` wird `null`. Diesen Zustand trägt der Code seit jeher — `mapOriginInUse()` verlangt
beides, `mapToGeoJson()` fällt auf `sunray-local-xy-meters` zurück, `normalizeMap()` und das
JSON-Backup erhalten ihn, und die Ursprungsfelder bleiben sichtbar und leer. Ein stiller Rückfall
auf `relative` wäre eine Entscheidung über den Kopf des Nutzers hinweg. *(Ein GeoJSON-Rundlauf
verliert den Modus — die Datei ist in Metern und trägt keine Modusmarke; der JSON-Backup nicht.)*

**Ausgegraut statt ausgeblendet** (`refreshExportButtons()`), anders als bei den Teilen-Knöpfen:
die Bedingungen sind behebbar, eine fehlende Browserfähigkeit nicht. Der Hinweis darunter nennt den
**Grund wörtlich**, deshalb trägt er kein festes `data-i18n` — der Text kommt aus
`refreshExportButtons()` und wird über `renderMapControls()` auch beim Sprachwechsel neu gesetzt.

**Zwei Sperrgründe, ein Mechanismus.** `cassandraExportBlockKey(map)` ist die einzige Stelle, die
entscheidet, und liefert einen Übersetzungsschlüssel oder `null`: fehlender Bezugspunkt
(`cassandraMissingHint`) oder ein Perimeter unter drei Punkten. Der zweite Grund ist **derselbe
Befund samt Wortlaut, den die Kartenprüfung ohnehin meldet** (`checkPerimeterTooFew`) — kein
zweiter Mechanismus daneben. Gefragt wird er von `refreshExportButtons()` (Knopfzustand) **und**
von `mapExportFile()` über `spec.blockKey` (Dateierzeugung), damit auch das Teilen nicht daran
vorbeikommt. Die Bedingung „taugt als Fläche" selbst steht genau einmal im Code
(`hasUsablePolygon()`) und wird von Kartenprüfung, Exportsperre und `closePerimeter()` gemeinsam
benutzt — ebenso der Ausschluss-Filter in `mapToCassandraGeoJson()` und `cassandraSkippedAreas()`.

**Ein ui-Test verbietet jede zweite handgeschriebene Zählung, und zwar funktionsweise abgegrenzt.**
Eine Textsuche kann die Absicht nicht lesen: `points.length >= 3` steht im Code für mehrere
verschiedene Fragen. Der Test führt deshalb eine ausgeschriebene Liste `HANDZAEHLUNG_ERLAUBT`
(Funktionsname → erwartete Anzahl + Grund) in vier Gruppen: **Geometrie-Primitive** auf einem
lokalen Parameter (`pointInPolygon`, `polygonsIntersect`, `polygonArea`, `pathLength`,
`pathSpacingIssues`), **Zeichnen und Geometrie bauen** (`drawThumbnailPath`, `drawPolyline`,
`nearestBoundaryPoint`, `closeRing`, `geometryForArea`), **„ist die Kontur offen?"** — steht immer
zusammen mit `closed`/`perimeterClosed` (`openContours`, `canStartExtension`, `finishExtension`,
`canCloseAndStartNew`), und **andere Merkmale derselben Punktliste** (`mapToGeoJson`s
`completePolygon`, `handleMapTap`s Trefferfläche, `validateActiveMap`s Innenlage- und
Überlappungsprüfung). Ein Vorkommen in einer **nicht gelisteten** Funktion schlägt an, ein
**zusätzliches** in einer gelisteten ebenfalls. Weil die reine Anzahl sich aushebeln ließe, indem
jemand eine erlaubte Zählung durch eine verbotene ersetzt, prüft der Test für
`checkPerimeterTooFew` und `checkAreaTooFew` zusätzlich die Zeile selbst.

**Nachgewiesen, nicht behauptet** (Grenzfälle 2/3/4 Punkte, offen und geschlossen, alle drei
Aufrufer gegen den Stand vor der Änderung): die drei abgelösten Bedingungen sind in allen zwölf
Fällen ergebnisgleich. Zum Schlusspunkt: **das Modell speichert keinen.** `closePerimeter()` und
`closeContour()` setzen nur ein Kennzeichen (3 Punkte bleiben 3), und `pointsFromGeoGeometry()`
schneidet einen aus einer Datei mitgebrachten Schlusspunkt ab (4 Koordinaten → 3 Ecken). Rohe
Feldlänge und Eckenzahl sind damit dasselbe, alt wie neu. `tests/app-core-test.js` hält die
Tabelle fest.


**Warum der Nutzer den Wert eintragen muss:** Sunray hat **keinen** AT-Befehl, der lat0/lon0
ausliest. `AT+P` (`comm.cpp:1024` → `cmdPosMode()`, `:474-504`) ist reines Schreiben und antwortet
mit dem nackten `"P"` (`:502-503`); lat/lon erscheinen in `comm.cpp` nur in `CONSOLE.print`
(`:498, :500, :1399-1402`), nie in einem `cmdAnswer()`. `AT+S` (`:684-736`) liefert nur
`stateX`/`stateY` in lokalen Metern. In der Voreinstellung (`absolutePosSource = false`,
`StateEstimator.h:64`) gibt es dort überhaupt kein lat0/lon0 — der Nullpunkt ist die
RTK-Basisstation über UBX-NAV-RELPOSNED (`ublox.cpp:81-82`). CaSSAndRA seinerseits lässt den Wert
von Hand eintragen (`accordion.py:228-232, :617-619`) und schiebt ihn per `AT+P` zum Mäher
(`sunraycommstack.py:150-158`); ein Parser für eine Antwort mit Werten existiert **nirgends**.
*(Belege aus `/home/penis/projects/MeinSunray`; auf dem Gerät läuft eine MRTREE-Variante, die
lokal nicht vorliegt — für die geflashte Firmware ist damit nichts davon belegt.)*

**Ein falscher Wert ist ungefährlich, aber nicht folgenlos.** Vollständige Suche nach
`rovercfg.lat`/`lon` in CaSSAndRA: reine Rechenkonstante in `mapdata.py:697-698` und `:705-706`
(Aufrufer ausschließlich Export und Import), Übertragung per `AT+P` in `sunraycommstack.py:156`,
und sonst nur Anzeige in den eigenen Eingabefeldern (`accordion.py:228, 232, 675`) und die
API-Ausgabe (`settingstopic.py:69-70`). **Kein Kartenhintergrund, keine Live-Position.** Der Wert
fällt beim Rundlauf heraus — er muss nur auf beiden Seiten derselbe sein.

**Eigener Rückweg:** `geoJsonToMap()` liest Ursprung und Kartenname aus dem `mapmaker`-Feature,
**nur wenn oben kein `properties`-Block steht** — der Top-Level-Block gewinnt immer. Ohne diesen
Rückweg läse unser eigener Import die Grad als Meter; ohne den Vorrang würde ein fremdes Feature
namens `mapmaker` eine alte Datei umdeuten. `tests/app-core-test.js` führt dafür ein **Prüfmuster
im alten Format** mit (Struktur und echte Koordinaten aus einer Datei, die der Nutzer mit einer
früheren Fassung exportiert hat) und weist nach, dass Name, Modus, Ursprung und Koordinaten
unverändert ankommen — in der relativen wie in der absoluten Variante, samt Gegenprobe mit einem
untergeschobenen `mapmaker`-Feature.

### Sunray-App-Exportformat (viertes Format, Stand v56)

Erzeugt die Datei, die die **grauonline-Sunray-App** selbst schreibt — Vorlage ist ein echter
Export des Nutzers (`tests/map/sunrayapp_map.json`, 10 Karten, nicht versioniert).
Endung `.sunray.json`, MIME `application/json`.

**Form, jeder Punkt belegt:**
- **Äußere Hülle ist eine Liste von Karten**, auch bei einer einzigen. `import_sunray()` läuft mit
  `for map_number in range(len(df))` (mapdata.py:471) über die Zeilen.
- Je Karte: `perimeter`, `exclusions` (Array von Arrays), `waypoints`, `dockpoints`, `name`,
  `patternAngle`, `mowOfs`, `patternRings`, `doMowExclusions`, `doMowPerimeter`, `doMowArea`,
  `doPerimeterBorder`, `doExclusionsBorder`.
- **Konturpunkt:** `X`, `Y`, `delta`, `timestamp`, `sol` — in dieser Reihenfolge.
  **Wegpunkte tragen nur `X`/`Y`** (in der Vorlage durchgängig).
- **Koordinaten sind lokale Sunray-Meter** und werden **nicht umgerechnet**. Beleg: X −44…+11,
  Y −49…+40; als Grad wären das ~4300 km. CaSSAndRAs Sunray-Zweig rechnet nichts um — anders als
  der GeoJSON-Zweig. **Dieses Format braucht deshalb keinen Bezugspunkt**, und die Sperre des
  CaSSAndRA-Exports darf hier nicht greifen (`sunray` hat kein `blockKey`).
- **Ringe bleiben offen** — die Vorlage schreibt in allen zehn Karten keinen Schlusspunkt.
- **Leere Listen werden geschrieben** (`dockpoints` ist dort 10 von 10 leer).

**`delta` und `timestamp` sind harte Pflichtfelder.** `coords.drop(['delta','timestamp'], axis=1)`
(mapdata.py:491) steht **ohne** `try`: fehlt eines, wirft `.drop()` einen KeyError, und die
**ganze Datei** wird abgewiesen — nicht nur die eine Karte. Empirisch an der echten Funktion
geprüft (`status -1`). `sol` ist dagegen optional (mapdata.py:493-497 fängt es ab), und auch die
Vorlage lässt es bei 4 von 3468 Punkten weg — wir schreiben es deshalb nur, wenn es gemessen wurde,
statt eine Güte zu erfinden.

**Was die drei Felder bedeuten** (belegt, nicht geraten):
- `delta` = `stateEstimator.stateDelta`, Roboterausrichtung in Bogenmaß — `AT+S` baut
  `S,batterie,stateX,stateY,stateDelta,solution,…` (comm.cpp:684-698, `stateDelta` auf :692).
  Wertespanne der Vorlage −3,14…+3,12 passt auf ±π.
- `sol` = `gps.solution` (comm.cpp:694), Konstanten `SOL_INVALID`/`SOL_FLOAT`/`SOL_FIXED`
  (gps.h:5-7).
- `timestamp` stammt **nicht** aus Sunray — kein Feld der Statuszeile; die App setzt die
  Aufnahmezeit selbst, als **ISO-String**, nicht als Zahl.

**Der Mäher sieht diese drei Felder nie.** `AT+W,startidx,x,y,x,y,…` überträgt nur Koordinaten
(`Comm::cmdWaypoint()`, comm.cpp:354-387), `Map::setPoint(int idx, float x, float y)` (map.cpp:769)
nimmt nur x und y, und die Firmware-Klasse `Point` (map.h:21-41) hat überhaupt nur `px`/`py` in cm.
Ein fester Wert wäre für Mäher und CaSSAndRA also folgenlos — **trotzdem wird `delta` seit v56 echt
mitgespeichert** (`pointFromTelemetry()` legt `gps.delta` ab; wir empfangen den Wert über
`protocol.js:74` seit jeher). Grund: ob die grauonline-App das Feld beim Wiedereinlesen auswertet,
ist **nicht belegt** — die App liegt nicht vor. Altbestand ohne `delta` bekommt 0.

**Mähfelder sind Platzhalter, keine Messwerte** (`SUNRAY_APP_MOW_DEFAULTS`). Diese App steuert kein
Mähen und führt diese Einstellungen nicht. Geschrieben werden die Werte, die in der Vorlage über
alle zehn Karten gleich sind (`patternRings: false`, alle Mäh-/Randflaggen `true`); `patternAngle`
und `mowOfs` streuen dort (1,22–3,11 rad bzw. 0,19–0,51 m) und stehen deshalb auf 0 bzw. 0,2.

**Ausgelassene Ausschlussflächen laufen über denselben Weg wie beim CaSSAndRA-Export**:
`hasUsablePolygon()` filtert, `skippedAreas()` (früher `cassandraSkippedAreas()`, umbenannt weil
formatunabhängig) stellt sie zusammen, `noticeSunrayExport()` nennt sie. Keine zweite Zählung.

**Gemeldet, nicht gebaut — die 4er-Grenze.** CaSSAndRAs Sunray-Zweig verlangt `len(exclusion_df) > 3`
(mapdata.py:480), also **mindestens vier** Punkte; eine Fläche mit genau drei wird dort **still**
verworfen. Anders als im GeoJSON-Zweig reißt sie dabei **nichts** mit — der Rest der Karte kommt an.
Wir filtern weiterhin mit `hasUsablePolygon()` (≥3), weil die Datei der App-Schreibsicht folgt und
der Mäher ein Dreieck verarbeiten kann. Eine gesonderte Warnung für Drei-Punkt-Flächen ist bewusst
**nicht** gebaut; sie wäre die nächste Ausbaustufe, wenn der Fall praktisch auftritt.

**Gemessen:** die erzeugte Datei durch die **echte** Python-Importfunktion ergibt gegenüber der
Vorlage **0,000000 mm** Abweichung über alle 22 Punkte des Prüfmusters — es wird nichts
umgerechnet und nichts gerundet. Prüfmuster `tests/fixtures/sunray-app-map.json`: aus der echten
Datei abgeleitet, auf 14 Punkte ausgedünnt, auf einen erfundenen Nullpunkt verschoben, cm-Raster,
ein Punkt bewusst ohne `sol` — versioniert, kein Rückschluss auf den Standort.

**Nicht belegt:** wie `dockpoints` in der Vorlage aufgebaut sind (in allen zehn Karten leer); wie
die App mit Flächen unter acht Punkten umgeht (kleinste vorkommende Fläche hat acht); ob die
grauonline-App `delta`, `patternAngle` oder `mowOfs` beim Einlesen auswertet.

### Sunray-App-Dateien einlesen (Stand v57)

**Erkennung strukturell** (`isSunrayAppFile()`, eine Stelle, wie `isCassandraGeoJson()`): die
äußere Hülle ist eine **nicht leere Liste**, **jeder** Eintrag ist ein Objekt mit einem Array
`perimeter`, und **mindestens ein** Perimeter trägt Punkte, deren Felder durchgängig `X`/`Y` als
Zahlen führen. Großschreibung ist dabei das Merkmal — unser eigenes Modell schreibt `x`/`y` klein.
Unser JSON-Backup und beide GeoJSON-Formate sind Objekte, keine Listen, und fallen schon am ersten
Merkmal heraus. **Keine Heuristik über Zahlenwerte.** Eine Liste aus Karten mit ausschließlich
leeren Konturen gilt bewusst **nicht** als erkannt: sie trägt kein Merkmal, das sie von irgendeiner
anderen Liste unterscheidet.

**Mehrere Karten: der Nutzer wählt** (`chooseSunrayMap()`). Die Vorlage führt zehn Karten in einer
Datei. Still die erste zu nehmen ist ausgeschlossen; ein Abbruch bricht den Import **vollständig**
ab, ohne Karte und ohne Meldung. Bei **genau einer** Karte wird nicht gefragt — ein Dialog mit
einer einzigen Wahlmöglichkeit wäre Schikane, und die Importmeldung sagt hinterher ohnehin, was
hereinkam. **`MAX_MAPS` ist dabei kein neuer Fall**: ein Import erzeugt genau eine Karte, und der
Fall „kein Platz frei" wird in `importMapFile()` wie bisher vorab abgefangen.

**Die Auswahl ist der vierte Modus desselben Dialogs.** `askChoice({ title, message, options })`
nutzt `#confirmDialog` mit dem neuen `#confirmDialogSelect` — kein zweites Modal, Escape,
Hintergrundklick und Knopflogik gibt es hier genau einmal. `state.pendingConfirmChoice` schaltet
`confirmDialogRespond()` in den Auswahlmodus: die Antwort ist dann der gewählte Wert bzw. `null`
bei Abbruch. Testadapter `globalThis.__choiceAdapter` (Steuerung `sandbox.__choiceAnswer`,
Rückschau `__lastChoiceRequest`). **Dabei behoben:** jeder Modus blendet die Felder der anderen
jetzt ausdrücklich aus. Vorher räumte allein `confirmDialogRespond()` auf — damit entschied die
Reihenfolge der Aufrufe über die Darstellung, und ein Dialog soll bei jedem Öffnen derselbe sein.

**Beschriftung:** `sunrayAppMapLabel()` stellt die **Position immer voran**, nicht nur bei
namenlosen Karten — die Vorlage führt neun verschiedene Namen bei zehn Karten, zwei Einträge wären
sonst nicht auseinanderzuhalten. Dazu Punktzahl und Zahl der Flächen; eine Karte ohne Namen wird
als „(ohne Namen)" geführt und ist nie ein leerer Eintrag.

**Felder eins zu eins** (`sunrayAppPointToModel()`): `timestamp` → `capturedAt`, `sol` →
`gps.solution`, `delta` → `gps.delta`. Beide Seiten haben dieselbe Quelle, es wird nichts
umgerechnet. **`gps` entsteht gar nicht**, wenn weder `sol` noch `delta` dastehen — ein leeres
Objekt ließe `pointQuality()` denselben Schluss ziehen wie eine gemessene schlechte Güte.

**Konturen gelten als geschlossen** — und das ist ausdrücklich **nicht** dieselbe Frage, die
`geoRingClosed()` für GeoJSON beantwortet. Dort wird geprüft, ob die Datei einen Schlusspunkt
**trägt**; die Sunray-Vorlage schreibt **nie** einen (in allen zehn Karten geprüft), ihre Konturen
sind trotzdem geschlossene Polygone. `geoRingClosed()` lieferte hier durchgehend `false` und wäre
die falsche Auskunft, keine gemeinsame Quelle — ein Test hält genau das fest. Ein **leerer**
Perimeter gilt nicht als geschlossene Kontur.

**Verworfen wird zweierlei, und beides wird genannt** (`noticeSunrayImport()`, Hinweiszeile
`#importNotice`, kein Dialog):
- **`waypoints`** — in der Vorlage 1238 bis 2870 Punkte je Karte: ein von der App **berechneter
  Mähpfad**, nicht die Handvoll gesetzter Wegpunkte, die unser Modell meint. Die Zahl der
  weggefallenen Punkte steht im Klartext.
- **die Mähfelder** `patternAngle`, `mowOfs`, `patternRings`, `doMowExclusions`, `doMowPerimeter`,
  `doMowArea`, `doPerimeterBorder`, `doExclusionsBorder` — diese App steuert kein Mähen und hat
  dafür keine Entsprechung. Verwerfen ist in Ordnung, **stillschweigend verwerfen nicht**.

**Gemessen:** Rundlauf lesen → schreiben → lesen über das Prüfmuster: **0,000000 mm** — es wird
nirgends umgerechnet oder gerundet, und `capturedAt`, `gps.delta` und `gps.solution` überleben
unverändert. Prüfmuster: `tests/fixtures/sunray-app-map.json` (eine Karte) und
`sunray-app-multi.json` (drei Karten, davon eine **ohne Namen** und eine mit 120 Wegpunkten) —
beide abgeleitet, verschoben, versioniert. `tests/map/` wird von keinem Test vorausgesetzt.

**Altbestand bleibt exportierbar:** Punkte ohne `gps.delta` bekommen beim Schreiben 0, Punkte ganz
ohne `gps` behalten `delta` und `timestamp` (beides Pflichtfelder für CaSSAndRA) und bekommen kein
erfundenes `sol`. Ein eigener Test hält das fest.

### Exportknöpfe: Reihenfolge und Gliederung (Stand v56)

Vier Formate in drei Gruppen, nach Zweck statt nach Alter: **Sunray** (für die grauonline-App und
den Mäher), **CaSSAndRA** (für den Import dort), dann **JSON** (vollständige Sicherung dieser App)
und **GeoJSON** (Fremdwerkzeuge). Der Hinweistext sagt je Format, wofür es da ist, und ausdrücklich,
dass JSON und GeoJSON **nicht** für den Import in CaSSAndRA gedacht sind — das war die Verwechslung,
die überhaupt zu diesem Format geführt hat.

**Der CaSSAndRA-Bezugspunkt steht in derselben Gruppe wie sein Knopf** (`.export-group`,
`#cassandraGroup`): nur dieses eine Format braucht ihn, und frei unter der Formatbeschreibung sah er
aus wie eine allgemeine Einstellung. Die Felder bleiben **unabhängig vom Positionsmodus sichtbar** —
der Bezugspunkt gehört zur Installation, nicht zur Karte. Ein ui-Test grenzt die Gruppe über die
**div-Verschachtelung** ab, nicht über den nächsten Textschnipsel: ein zusätzlich eingefügtes
`</div>` nähme die Felder sonst aus der Gruppe, ohne dass der Test es merkt (genau so ist er einmal
durchgerutscht).

### Verbindungshinweis: parallele HTTP-Verbindungen (Stand v56)

`#httpConflictHint` steht **dauerhaft** und rot hervorgehoben beim Verbinden-Knopf — bewusst kein
Dialog bei jedem Verbindungsversuch. Der Wortlaut ist als **Beobachtung** formuliert, nicht als
Ursache: belegt ist bisher nur, dass ein Mäher mit gleichzeitiger CaSSAndRA-Verbindung abbrach und
ein anderer ohne nicht — **zwei verschiedene Geräte, kein kontrollierter Vergleich**. Ein ui-Test
prüft in beiden Sprachen, dass die einschränkenden Formulierungen dastehen und keine ursächlichen
(„verursacht", „is caused by").

### CaSSAndRA-Dateien einlesen (Stand v55)

**Erkannt wird an der Form, nie an den Zahlen.** `isCassandraGeoJson(data)` ist die einzige
Stelle; alle Merkmale müssen zutreffen, eines genügt zum Ausschluss:

1. **genau zwei Top-Level-Schlüssel**, `type` und `features` (mapdata.py:670) — unser eigenes
   GeoJSON führt dort zusätzlich `name` und `properties`;
2. jedes Feature trägt `properties` mit **ausschließlich** `name` — damit ist `properties.role`
   (unser internes Merkmal) mit ausgeschlossen;
3. jeder Name stammt aus `CASSANDRA_FEATURE_NAMES` (`perimeter`, `dockpoints`, `search wire`,
   `exclusion`) — damit ist das Metadaten-Feature `mapmaker` mit ausgeschlossen, mit dem sich
   **unser eigener** CaSSAndRA-Export zu erkennen gibt;
4. mindestens ein Feature: ohne eines trägt die Datei kein Merkmal.

**Warum ausdrücklich keine Heuristik über die Größenordnung.** „Betrag kleiner als 1, also Grad"
wäre geraten und ist nachweislich falsch: steht in CaSSAndRA ein echter Bezugspunkt, liegen die
Werte bei ~52 und ~13 und sähen wie Meter aus. Die Form der Datei dagegen ist eindeutig, weil
`export_geojson` sie fest verdrahtet baut.

**Der Bezugspunkt steht nicht in der Datei** — er lebt allein in CaSSAndRAs `rovercfg.lat`/`lon`.
Er kommt deshalb aus `cassandraReferenceInUse()`, also aus derselben Einstellung wie beim Export.
**Ist dort nichts Gültiges gesetzt, wird nicht importiert** (`cassandraImportNoReference`), und
zwar bewusst **ohne** Rückfall auf 0/0: die Vorgabe gehört in `loadCassandraReference()`, nicht in
den Importweg — sonst hätte ein ausdrücklich geleertes Feld hier keine Wirkung mehr, genau wie bei
der Exportsperre.

**Gemeldet wird als Hinweiszeile, nicht als Dialog.** `noticeCassandraImport()` schreibt Format
und verwendeten Bezugspunkt im Klartext nach `#importNotice` — dasselbe Muster wie
`#cassandraSkippedHint` neben den Export-Knöpfen. Ein Modal wäre hier falsch: der Import läuft auf
der Menüseite, und die Meldung soll dort stehen, wo der Nutzer gerade ist. Die Überlegung dahinter
ist dieselbe wie bei `noticeCassandraExport()` — der Wert, an dem alles hängt, wird genannt statt
vorausgesetzt. **Erst handeln, dann melden**; `clearImportNotice()` räumt vor jedem Import auf.

**Ringschluss: eine Quelle, zwei Leser.** `geoRingClosed(geometry)` entscheidet, ob die Datei den
Schlusspunkt trägt. `pointsFromGeoGeometry()` schneidet ihn daraufhin ab, `geoJsonToMap()` setzt
daraufhin `perimeterClosed` bzw. `exclusion.closed`. Vorher hing beides an derselben Bedingung in
zwei Ausprägungen, und die zweite fehlte schlicht: **jede importierte Karte galt als offen**, auch
aus unserem eigenen GeoJSON. Die Funktion kennt weiterhin nur Geometrie — die Rolle bleibt beim
Aufrufer, der sie ohnehin hat.

**Gemessen** (`tests/app-core-test.js`, beide echten Karten): 39,010 × 49,760 m und
38,270 × 87,780 m, exakt die wahren Werte, Perimeter und alle Flächen geschlossen. Vollständiger
Rundlauf gegen die **echte** Python-Importfunktion (pandas + shapely, außerhalb des Repos):
größte Abweichung **7,85 mm** bei einer theoretischen Grenze von 7,86 mm — der Rest ist die
7-Stellen-Rundung unseres Exports. Vorher kam dieselbe Karte mit 0,000 × 0,000 m an.

**Prüfmuster statt echter Karten** (`tests/fixtures/cassandra-perimeter.geojson.json`): aus
karte-a abgeleitet, auf 14 Punkte ausgedünnt, auf einen erfundenen Nullpunkt verschoben, cm-Raster
— trägt keinen Rückschluss auf das Grundstück und ist deshalb versioniert. **`tests/map/` ist in
`.gitignore` und wird von keinem Test vorausgesetzt**: die Prüfung gegen die echten Karten läuft
nur, wo sie liegen, und meldet sonst ausdrücklich, dass sie **übersprungen** wurde — ein stilles
Durchwinken sähe im Protokoll wie ein bestandener Test aus.

**Nicht ohne Gerät verifizierbar:** ob CaSSAndRAs Upload-Dialog auf dem Zielgerät die Datei
tatsächlich annimmt — geprüft ist nur, dass `dcc.Upload` (`uploadsunray.py:14`) kein `accept`
setzt und der Callback (`:32`) den Dateinamen nicht auswertet.

### Ringschluss und Punktlöschen (Stand v59)

**Eine Ecke zu entfernen öffnet keinen Ring.** Das Modell speichert **keinen** Schlusspunkt —
`closePerimeter()` setzt nur ein Kennzeichen, drei Punkte bleiben drei. `perimeterClosed` sagt
also „zeichne die Kante letzter↔erster Punkt", nicht „die Punktliste endet dort, wo sie beginnt".

`deleteSelectedPoint()` und `undoPoint()` setzten das Kennzeichen trotzdem zurück, und zwar
**nur für den Perimeter**, ohne Gegenstück für Ausschlussflächen. Daran hingen zwei gemeldete
Symptome mit **einer** Wurzel, weil beide dasselbe Feld lesen:

- **Das Erweitern-Feld blieb dauerhaft weg.** `canStartExtension()` verlangt `contour.closed`, und
  `activeContour()` liest dafür `perimeterClosed`. Punkte auszuwählen half nicht — die Bedingung
  fragt die Auswahl gar nicht ab.
- **Der Umriss ging an ganz anderer Stelle auf.** `drawPolyline()` bekommt `close` allein aus dem
  Kennzeichen und macht aus `polygon` ein `polyline`; die fehlende Kante liegt zwischen letztem
  und erstem Punkt, im Prüfmuster **13,381 m** vom gelöschten Punkt entfernt.

**Gemessen, in allen drei Herkünften gleich** (Sunray-Import, in der App entstanden,
CaSSAndRA-Import): vorher `perimeterClosed=false` und `canStartExtension=false` nach dem Löschen,
jetzt beide `true`, und der gezeichnete Umriss bleibt `polygon`. **Am Import lag es nicht** — der
setzt nur unbedingt `perimeterClosed = true` (`sunrayAppToMap()`, `geoJsonToMap()`), weshalb
importierte Karten häufiger in dem Zustand stehen, in dem der Fehler überhaupt sichtbar wird.

**Bewusst nicht durch eine Bedingung ersetzt.** „Ist der Ring geschlossen?" und „taugt die Kontur
als Fläche?" sind zwei Fragen. Die zweite beantwortet `hasUsablePolygon()` an ihrer einen Stelle;
eine zu kurze Kontur meldet `checkPerimeterTooFew` und sperrt darüber auch den Export. `drawPolyline()`
verlangt für ein `polygon` ohnehin eigenständig drei Ecken, ein geschlossen gekennzeichneter
Zwei-Punkt-Perimeter wird also trotzdem offen gezeichnet.

**`perimeterClosed` darf nur an acht Stellen geschrieben werden**, jede mit eigenem Grund:
`closePerimeter()` (schließt), `reopenPerimeter()` (öffnet auf Nutzerwunsch), `normalizeMap()`
(fehlendes Feld gilt als offen), `deleteElement()` (leert den Perimeter **vollständig** — dann gibt
es keinen Ring), `undoLastAction()` (Schnappschuss), `sunrayAppToMap()` und `geoJsonToMap()`
(Import) sowie `openContourForExtension()` (trennt die Kante absichtlich auf). Ein ui-Test führt
diese Liste mit Grund je Eintrag und schlägt sowohl bei einer nicht gelisteten Funktion als auch
bei einem zusätzlichen Vorkommen in einer gelisteten an — dieselbe Bauart wie der Wächter gegen
Handzählungen neben `hasUsablePolygon()`.

### Erweitern: das aktive Ende (Stand v60)

**Der zuerst getippte Punkt wird das Ende, an dem weitergebaut wird.** Das ist keine neue Regel —
`reorderForExtension()` macht ihn zum Listenende, und `appendCurrentPoint()` hängt ausnahmslos
am Listenende an (`target.push`). Sie stand nur nirgends, weshalb der Nutzer sie nicht kennen
konnte. Sie ist damit zugleich die **einzige** Stellschraube: ein Umschalten nach dem Auftrennen
gibt es bewusst nicht, wer das falsche Ende erwischt hat, bricht ab und fängt neu an.

`extensionEndIndex()` ist die **einzige Stelle**, die „welcher Punkt ist das aktive Ende?"
beantwortet — in der Auswahlphase `ext.firstIndex`, danach das Listenende, das mit jedem
aufgenommenen Punkt weiterwandert. Drei Leser hängen daran, damit sie nie auf verschiedene Punkte
zeigen können: die Markierung (`isExtensionPick()`, gilt jetzt in **beiden** Phasen, gezeichnet
mit den vorhandenen Klassen `.extend-pick-point` / `.extend-pick-ring`), die Hinweiszeile und die
Vorschaulinie.

**Die Nummer holt `refreshExtendPanel()` live**, sie wird nicht in `hintVars` mitgegeben: sie
ändert sich mit jedem Punkt, ein einmal gesetzter Wert wäre sofort alt. Der Hinweisstreifen ist
dafür der richtige Ort und **nicht** `#pointStatus` — die Statuszeile wird von jedem
Telemetrie-Takt über `show()` in `refreshCaptureState()` überschrieben.

**Vorschaulinie `drawExtensionGuide()`** zieht vom aktiven Ende zur Mäherposition, Bauart und
Ebene wie `drawSelectionGuide()`. Sie wird **nicht** gezeichnet, solange ein Punkt ausgewählt ist:
dann verschiebt der Hauptknopf, statt anzuhängen (`addCurrentPoint()`), die Linie behauptete also
etwas Falsches. Dasselbe löst die Überschneidung — beide Linien enden am Mäher, sichtbar ist immer
nur eine. Ihre Warnfarbe bindet sie sichtbar an das markierte Ende; `.edit-distance-line` und
`.boundary-distance-line` liegen farblich ohnehin schon dicht beieinander.

**Der Tipp ins Leere hebt die Auswahl in Phase `adding` wieder auf.** Der Ausstieg in
`handleMapTap()` fragt jetzt die Phase ab statt nur `state.extension`. Er war für die
**Auswahlphase** gedacht; dass er auch danach griff, sperrte die einzige Geste, die eine Auswahl
aufheben kann — der Hauptknopf stand dann dauerhaft auf „Verschieben", während der
Hinweisstreifen zum Aufnehmen aufforderte. **Mitgegangen ist ein zweiter Verhaltenswechsel:** in
Phase `adding` wählt ein Tipp in eine Ausschlussfläche wieder die ganze Fläche aus. Das ist so
gewollt — die Karte soll sich dort verhalten wie sonst auch. In der Auswahlphase bleibt beides
gesperrt.

**Seit v61 hängt der Hauptknopf in Phase `adding` immer an**, auch mit ausgewähltem Punkt — vorher
stand er auf „Verschieben" und **überschrieb** eine bestehende Ecke der Kontur, die gerade
erweitert wurde (gemessen: Länge 5 → 5, Punkt 2 von (0,10) auf (55,55)). `captureButtonMoves()`
ist die **einzige Stelle**, die entscheidet, ob der Knopf verschiebt statt aufzunehmen;
Beschriftung, Symbol, Haltegeste, Tippgeste und die Aktion lesen alle dort, damit der Knopf nicht
eines sagt und ein anderes tut. **Die Geste gehört mit dazu:** ohne Auswahl wird gehalten, beim
Verschieben genügt ein Tap — beide Einstiege (`beginCaptureHold()`, `captureButtonTap()`) hängen
deshalb an derselben Funktion, ebenso das Abbrechen eines laufenden Haltevorgangs in
`refreshCaptureState()` (sonst hätte jeder Telemetrie-Takt das Halten wieder abgebrochen).

**Verschoben wird dort über den eigenen Knopf `#movePointBtn`**, der den Platz des
Automatik-Knopfes einnimmt. Der ist frei, und zwar aus zwei voneinander unabhängigen Gründen:
`ui.autoFabWrap.hidden` hängt an derselben Größe `selected`, und eine Auswahl entsteht nur über
`applyPointSelection()`, das `setMode()` ruft, das eine laufende Automatik beendet. Beide Knöpfe
lesen bewusst dieselbe Größe, können sich also nicht überlagern. `movePointToMower()` ist der
**einzige** Weg zum Verschieben — Hauptknopf und eigener Knopf rufen dieselbe Funktion, und
`relearnSelectedPoint()` hat genau einen Aufrufer; ein ui-Test hält beides per Quelltextsuche fest.

**Nur in Phase `adding`, bewusst nicht überall.** Außerhalb der Erweiterung tut der Hauptknopf
ohne Auswahl ohnehin schon Verschiedenes (`Perimeter wieder öffnen`, `Perimeter schließen`),
„hängt immer an" wäre dort keine sinnvolle Regel; und es gibt keine stehende Aufforderung, die
ihm widerspräche — der Hinweisstreifen existiert nur, solange `state.extension` gesetzt ist.

**Eine Ausnahme bleibt:** steht der Mäher in Phase `adding` näher als 0,50 m am **ersten** Punkt
der Liste (also am anderen Ende der aufgetrennten Kante) und hat die Kontur ≥ 5 Punkte, greift
weiterhin `perimeterClosureCandidate()` und der Knopf schließt den Ring. Das ist gleichbedeutend
mit „Fertig" und war schon vor v61 so.

### Kartenobergrenze `MAX_MAPS` (Stand v58)

**25 Karten, und die Zahl steht an genau einer Stelle** (`const MAX_MAPS`, app.js). Meldungen und
Hilfetexte schreiben sie nicht ab, sondern tragen den Platzhalter `{maxMaps}`, den `tr()`
**ausnahmslos** ersetzt — auch für die per `data-i18n` gesetzten Texte, die gar keine Variablen
übergeben. Ohne diesen Weg hätte jede Grenzänderung vier i18n-Werte und einen Markup-Fallback
hinterhergezogen, und genau das war vorher der Fall.

Das Zählfeld `#mapCountBadge` trägt im Markup **keine** Zahl mehr; `renderMapGallery()` füllt es
aus der Konstante. Ein Startwert dort wäre eine zweite Behauptung über die Grenze.

**Gemessen, nicht geschätzt:** eine Karte mit den Punktzahlen einer echten (212 Perimeter + 6
Flächen mit 16/15/21/18/27/11 = 320 Punkte, jeder mit vollem `gps`-Objekt) belegt im internen
Modell **≈ 63 KiB**; 25 Karten also **≈ 1,5 MiB**. Für IndexedDB belanglos.

**Der Auswahldialog beim Sunray-Import hängt nicht an dieser Zahl.** Seine Einträge kommen aus der
eingelesenen **Datei**, nicht aus dem Bestand, und `importMapFile()` wirft `mapLimitReached`,
bevor `chooseSunrayMap()` überhaupt läuft — am Limit erscheint gar kein Dialog.

**Nebeneffekt, gemessen:** `renderMapGallery()` läuft bei **jedem** `saveActiveMap()`, zeichnet
also bei jedem aufgenommenen Punkt sämtliche Vorschaubilder neu. Im Harness (Stub-DOM, echte
SVG-Kosten im Browser sind damit **nicht** belegt) 2,29 ms bei 10 Karten gegen **4,07 ms bei 25** —
gegen die schnellste Speicherkadenz von 500 ms unter 1 %.

**Gemeldet, nicht gebaut — auf vollen Speicher reagiert nichts sinnvoll.** `dbRequest()`
(app.js:2402-2410) lehnt ab, `saveActiveMap()` (app.js:2530) fängt nichts, und weil es
`state.saving = true` und „Speichert …" **vor** dem Schreiben setzt, bleibt die Anzeige nach einem
abgelehnten Schreibvorgang dauerhaft auf „Speichert …" stehen (empirisch geprüft mit einem
`QuotaExceededError`). Der Fehler selbst geht als allgemeiner Fehlerdialog über `reportError()`
raus, nicht als „Speicher voll". Unabhängig von der Zahl und deshalb hier nicht mitgeändert.

### Diagnoseprotokoll (Menü → Diagnose)

**Das Protokoll liegt seit v50 in `state.logEntries`, nicht mehr nur im DOM.** Vorher hängte
`log()` direkt an `ui.debugLog.textContent` an. Das ließ sich weder exportieren noch begrenzen.
`log()` schreibt jetzt in einen **Ringpuffer** (`LOG_ENTRY_LIMIT` = 200, älteste Zeilen fallen
vorn weg — dieselbe Überlegung wie beim gedeckelten `rxBuffer`) und ruft `renderDebugLog()`.

**Pausierbares Mitlaufen.** `renderDebugLog()` scrollt nur ans Ende, wenn `state.logAutoScroll`
gesetzt ist. `onDebugLogScroll()` (am `scroll`-Ereignis des `<pre>`) setzt das Flag bei jeder
Bewegung neu über `debugLogAtBottom()`: `scrollHeight − scrollTop − clientHeight <=
LOG_BOTTOM_TOLERANCE_PX` (24 px Toleranz gegen Rundungsdifferenzen). Neue Zeilen werden auch im
pausierten Zustand angehängt, die Ansicht springt nur nicht. `#logJumpBtn` („Neue Einträge – zum
Ende springen“) ist genau dann sichtbar, wenn pausiert ist (`refreshLogJumpHint()`), und ruft
`scrollLogToEnd()`.

**`debugLogAtBottom()` liefert bei unbrauchbaren Messwerten ausdrücklich `true`.** Vor dem ersten
Zeichnen und im Testharness sind `scrollHeight`/`clientHeight` 0 oder undefiniert; ohne diese
Regel stünde der Hinweis von Anfang an da, obwohl niemand gescrollt hat. Der Normalfall ist
Mitlaufen, pausiert wird erst bei nachweislichem Hochscrollen.

**Export** (`#exportLogBtn` → `exportDebugLog()`): `logExportText()` nimmt die letzten
`LOG_EXPORT_LIMIT` = **100** Zeilen wortgleich zur Anzeige (bei weniger alle vorhandenen),
`logExportFileName()` baut `mapcreator-log_JJJJ-MM-TT_HH-MM-SS.txt` — die Sekunde ist nötig,
damit zwei Exporte kurz nacheinander nicht denselben Namen tragen. Ausgeliefert wird über das
bestehende `downloadTextFile()`. **Bei leerem Protokoll wird keine Datei erzeugt**, sondern
`showNotice()` gezeigt; eine leere Datei sähe nach einem Fehler aus. Der Puffer hält bewusst mehr
Zeilen vor als der Export mitnimmt, damit nach einem Export noch Vorgeschichte da ist.

**Die Knöpfe „AT+V senden“ und „AT+S senden“ sind entfernt, nicht repariert.** Geprüft und
belegt: die Handler waren korrekt verdrahtet (`bindEvents()`), beide Kennungen existierten im
Markup (ein Abgleich aller 134 per `$()` geholten Kennungen gegen `index.html` fand **keine**
fehlende), und sowohl `sendSunray()` als auch `handleLine()` protokollieren unbedingt (`TX`/`RX`).
Es gab also keinen Defekt. Beide Knöpfe waren jedoch nur bei **stehender Verbindung** bedienbar
(`refreshConnectionUi()`: `disabled = !state.connected || state.demo`) — und genau in diesem
Zustand gehen beide Kommandos ohnehin automatisch raus: `AT+V` im Handshake, `AT+S` alle 500 ms
per Polling, jeweils mit protokollierter Antwort. Es existierte damit **kein** Zustand, in dem
ein Knopf etwas bewirkt hätte, das die App nicht schon selbst tut. Das gemeldete „passiert
nichts“ passt zum unverbundenen Zustand, in dem beide korrekt gesperrt sind. Entfernt sind
Markup, `ui`-Einträge, Handler, die zwei Zeilen in `refreshConnectionUi()` und die
Übersetzungsschlüssel `sendVersion`/`sendState`; ein ui-Test verbietet ihre Rückkehr. Damit
entfällt auch der frühere Sonderfall „ausdrückliche Tastendrücke“ für sofortige Fehlerdialoge in
`reportBleError()` — `immediate: true` gilt jetzt nur noch beim Not-Halt.

**Testbarkeit:** `tests/app-harness.js` stubbt `addEventListener` als **No-Op**, Klicks lassen
sich also nicht simulieren. Tests rufen die Funktionen deshalb direkt auf (`t.log()`,
`t.onDebugLogScroll()`, `t.exportDebugLog()`), und die Verdrahtung selbst wird per Quelltextsuche
geprüft. Der Element-Stub führt dafür jetzt `clientHeight` und `click()`.

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
- **Persistenz** (~Z. 1497–1640): IndexedDB `ardumower-bt-mapper`, Store `maps`, max. `MAX_MAPS` Karten
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
- `AT+M,linear,angular` — manuelles Fahren; App-Heartbeat alle **650 ms**. **Achtung:** das
  früher hier behauptete 1000-ms-Totmannfenster gilt nur eingeschränkt — siehe den folgenden
  Abschnitt, bevor irgendeine Sicherheitsüberlegung darauf aufgebaut wird.
- `AT+C,1,-1` / `AT+C,0,-1` — Mähmotor an/aus; `AT+C,0,0` — STOP ALLES

### SICHERHEIT: Das 1000-ms-„Totmannfenster“ trägt nicht (überprüft 2026-09-07)

**Die App darf sich NICHT darauf verlassen, dass der Mäher von selbst stehen bleibt, wenn keine
`AT+M` mehr ankommen.** Anlass: der Nutzer hat am Gerät beobachtet, dass der Mäher weiterfährt,
obwohl keine Fahrbefehle mehr eintreffen. Nachfolgend, was im Code belegbar ist und was nicht.

**Woher die Zahl 1000 stammt — belegt, aber missverstanden.** Sie ist keine Erfindung: 

| Ort | Code |
|---|---|
| `/home/penis/projects/MeinSunray/sunray/motor.cpp:176` | `setLinearAngularSpeedTimeout = millis() + 1000;` in `Motor::setLinearAngularSpeed()` |
| `/home/penis/projects/MeinSunray/sunray/motor.cpp:276-281` | in `Motor::run()`: nach Ablauf `motorLeftRpmSet = 0; motorRightRpmSet = 0;` |

Falsch war nicht die Zahl, sondern die daraus gezogene **Verallgemeinerung** („selbst wenn App und
Funk komplett ausfallen, hält der Mäher nach spätestens einer Sekunde an“). Diese Aussage stand
nie im Code; sie war eine Schlussfolgerung und ist in dieser Form **unbelegt**.

**Warum sie nicht trägt — vier belegte Einschränkungen:**

1. **Der Timer hängt an `setLinearAngularSpeed()`, nicht an `AT+M`.** *Jeder* Aufrufer setzt ihn
   zurück. Neben `comm.cpp:284` (das ist `AT+M`) gibt es vor allem `LineTracker.cpp:355`, das in
   **jedem autonom fahrenden Betriebszustand** laufend Geschwindigkeiten setzt, dazu
   `rcmodel.cpp:137` (R/C-Modus). Solange irgendein anderes Teilsystem die Motoren kommandiert,
   **läuft das Fenster nie ab**. Es wirkt praktisch nur in `OP_IDLE` — geprüft: `IdleOp::run()`
   (`sunray/src/op/IdleOp.cpp`) kommandiert die Motoren nicht, dort greift der Timeout also.
   In `OP_MOW`, `OP_DOCK`, den Escape-Zuständen usw. greift er **nicht**.
2. **Er ist nicht konfigurierbar, aber umgehbar.** 1000 ist hart im Quelltext, es gibt kein
   `#define` in `sunray/config.h` (durchsucht). Abschaltbar ist er damit nicht — wohl aber durch
   die Betriebsart aushebelbar (Punkt 1). `RCMODEL_ENABLE` ist in `config.h:490` auskommentiert,
   dieser Pfad ist in dieser Konfiguration also inaktiv.
3. **Er bremst nicht, er nullt nur den Drehzahl-Sollwert.** `motor.cpp:279-281` setzt
   ausschließlich `motorLeftRpmSet`/`motorRightRpmSet` auf 0; `linearSpeedSet`/`angularSpeedSet`
   bleiben stehen (deshalb meldet `robot.cpp:715 robotShouldMove()` danach weiterhin „fährt“).
   Es ist ausdrücklich **kein** `stopImmediately()`, der Auslauf hängt am PID.
4. **Er setzt eine laufende Hauptschleife voraus.** `Motor::run()` wird aus `robot.cpp:1050`
   gerufen und arbeitet nur alle 50 ms. Hängt oder rebootet die Hauptplatine, läuft auch kein
   Timeout.

**Der entscheidende Punkt: für die Firmware des Nutzers ist gar nichts belegt.** Auf dem Mäher
läuft eine **MRTREE-Variante**, die auf diesem Rechner **nicht vorliegt** — gesucht und nur
`/home/penis/projects/MeinSunray` und `/home/penis/projects/MeinSunray-sim` gefunden, deren
`motor.cpp` byte-identisch sind. Alle obigen Zeilenangaben gelten für die **Master-Kopie im
Arbeitsverzeichnis**, nicht für die geflashte Firmware. Ob MRTREE diesen Timeout überhaupt noch
enthält, ist **unbekannt und ungeprüft**.

**Mögliche Erklärungen der Beobachtung — ausdrücklich Hypothesen, keine Befunde:** (a) MRTREE hat
den Timeout entfernt oder verändert; (b) der Mäher war nicht in `OP_IDLE`, sondern in einem
autonom fahrenden Zustand, der den Timer laufend zurücksetzt; (c) die Hauptschleife war blockiert.
Keine davon ist belegt.

**Konsequenz für diese App:** Die Annahme „ein verlorenes Stopp-Paket kostet höchstens ~1 s
Nachlauf“ ist gestrichen. Der Ruhe-Stopp-Takt und der Fahr-Heartbeat sind damit **nicht** die
zweite Ebene über einer sicheren Firmware-Abschaltung, sondern **die einzige** Ebene — und beide
setzen einen funktionierenden Funklink voraus. Fällt der Funk während der Fahrt aus, kann die App
nichts mehr senden, und es gibt keinen nachgewiesenen Schutz dahinter.

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
| `tests/layout-test.js` | Statische Regressionsprüfung für Menüseite, Kartenknöpfe und Grundaufteilung (39 Fälle). `effectiveStyle(element, property)` löst die Kaskade **elementbezogen** auf (jede passende Regel, nach Spezifität) — nötig für Altlastregeln, die `resolve(selector, …)` nicht sieht. `resolve(selector, property, { media })` löst die Kaskade auf; ohne `media` zählen nur Regeln **außerhalb** von `@media`: löst die Kaskade (inklusive `@media`) auf und prüft die Struktur in `index.html`. Deckt ab: Scrollcontainer intakt (`min-height: 0`, kein zweiter Scrollcontainer), Vollbildebenen in `dvh`, Blocklayout der Abschnittsstapel, kein Clipping aufgeklappter Abschnitte, gemeinsame senkrechte Achse der Kartenknöpfe, umbrechende Beschriftungen, HUD zweizeilig und ohne Überlappung der Knopfspalte. Braucht keinen Browser. |
| `tests/ui-test.js` | Die Kartier-Oberfläche (143 Fälle): Bestätigungs- und Meldungsdialog (Titel/Text/Beschriftung, beide Antworten, verdrängte Rückfrage, Einknopf-Meldung, `reportError` protokolliert und zeigt, keine `window.confirm()`/`window.alert()`-Aufrufe mehr), Moduswahl per Dialog, Rückfrage zum Schließen von Konturen, Kartenprüfung mit Konturschluss, Aufnahme/Löschen in allen drei Button-Zuständen, Flächenauswahl, Automatik (Ersetzen des manuellen Knopfs und Intervall), Positions-Glättung, Hell/Dunkel, Akkordeon, Auswahl per Tap, Touch-Zielgröße, Zoom-Grenzen, Tap-vs-Ziehen, Pinch, Halte-Aufnahme, Joystick-Kennlinie, RTK-Badge, Menüseite, gesperrte Karte, `init()`-Startpfad. Stacktraces mit `UI_TEST_STACK=1`. Antworten auf `confirm()` steuert der Test über `sandbox.__confirmAnswer`. `navigator.share`/`canShare` werden je Fall in den Sandkasten gehängt (`stubShare()`), der Sandkasten führt dafür `File`; den normalen Export fängt `captureDownload()` über einen `Blob`-Spion und den erzeugten Anker ab. |

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
  Stopp beim Loslassen (`AT+M,0,0`) wird dagegen **genau einmal** versucht. **Korrektur
  2026-09-07:** hier stand, die Sunray-Seite halte nach 1000 ms von selbst an, ein verlorener
  Stopp koste also höchstens ~1 s Nachlauf. Das ist **nicht belegt** und wird durch die
  Beobachtung am Gerät widerlegt (siehe Sicherheitsabschnitt). Aufgefangen wird ein verlorener
  Stopp allein durch den Ruhe-Stopp-Takt (500 ms) — und nur, solange der Funk steht.
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

- **Leere Einstellungsfelder rutschen auf die Untergrenze statt auf den Rückfallwert** (gemeldet
  2026-09-10, nicht angefasst). `clampNumber(value, min, max, fallback)` (`app.js:1085-1089`)
  fängt nur `!Number.isFinite(n)` ab — `Number('')` ist aber `0`, also endlich, und wird auf `min`
  geklemmt. Der `fallback`-Parameter ist damit für ein **leeres** Feld unerreichbar; er greift nur
  bei Text wie `abc`. Gemessen (jeweils Feld geleert, alle anderen unverändert):

  | Feld | vorher | leer → danach |
  |---|---|---|
  | `mowerLengthInput` | 0,60 | **0,10** |
  | `mowerWidthInput` | 0,35 | **0,10** |
  | `autoCaptureIntervalInput` | 5 | **1** |
  | `autoCaptureDistanceInput` | 50 | **10** |
  | `driveSpeedMinInput` | 0,08 | **0,02** |
  | `driveSpeedMaxInput` | 0,25 | **0,03** |
  | `driveTurnMaxInput` | 1,15 | **0,20** |
  | `cursorSpeedInput` | 3 | **2** |

  Betroffen sind `updateViewPreferencesFromUi()` (`app.js:1166-1184`) und `loadViewPreferences()`
  (dort ohne Feldbezug, deshalb harmlos). Anders als beim Ursprung ist das **sichtbar** — die
  Felder werden danach neu gezeichnet und zeigen den geklemmten Wert —, und es sind reine
  Komforteinstellungen, keine Interoperabilität. `driveSpeedMaxInput` fällt dabei auf
  `driveSpeedMin + 0.01`, die Fahrgeschwindigkeit also praktisch auf Null. Behebbar mit derselben
  Überlegung wie `originFromInputs()`: den Leerfall vor `Number()` abfangen.

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

- 2026-09-11: **Hauptknopf hängt beim Erweitern immer an, Verschieben bekommt einen eigenen Knopf.**
  Der in v60 gemeldete Griff ist behoben: in Phase `adding` nimmt der Hauptknopf auch mit
  ausgewähltem Punkt auf, statt eine bestehende Ecke zu überschreiben. **Vorab geprüft und
  gemeldet statt angenommen:** (M1a) für einen ausgewählten Punkt bot die Oberfläche dort nur
  Papierkorb und Hauptknopf — „davor/danach" ist während einer Erweiterung ausgeblendet —, und
  `relearnSelectedPoint()` war **ausschließlich** über den Hauptknopf erreichbar (ein Aufrufer,
  zwei Gesten, kein Menüweg, Ziehen auf der Karte verschiebt die Ansicht, nicht Punkte).
  (M1b) Der Platz des Automatik-Knopfes ist immer frei, doppelt abgesichert: gleiche Bedingung
  `selected`, und eine Punktauswahl beendet über `setMode()` eine laufende Automatik. (M1c) Nur in
  Phase `adding` getrennt, weil allein dort eine stehende Aufforderung zum Aufnehmen existiert und
  der Hauptknopf außerhalb ohnehin mehrere Aufgaben trägt. **Beim Bauen aufgefallen:** die
  Unterscheidung steckt nicht nur in der Beschriftung, sondern in der **Geste** — halten gegen
  tippen —, und `refreshCaptureState()` hätte ein laufendes Halten bei jedem Telemetrie-Takt
  abgebrochen; alle vier Stellen hängen jetzt an `captureButtonMoves()`. Kein zweiter Weg daneben:
  beide Knöpfe rufen `movePointToMower()`. Neu: 6 ui-Fälle (194), 1 layout-Fall (42), neuer
  i18n-Schlüssel `movePointAction` in DE und EN. **Kein Bestandstest hatte die alte Wirkung
  festgeschrieben** — geprüft und ausdrücklich verneint, die vorhandenen Fälle zur Punktauswahl
  betreffen sämtlich den Zustand außerhalb einer Erweiterung und laufen unverändert durch. Gegen
  dreizehn simulierte Rückfälle geprüft; zwei liefen zunächst durch — der an den Aufnahmepfad
  umgehängte Knopf (Verdrahtung ist im Harness nicht klickbar, jetzt per Quelltextsuche
  festgehalten, was zugleich eine kopierte Zweitfassung auffliegen lässt) und der Wegfall der
  Prüfung auf einen tatsächlich vorhandenen Punkt. `APP_VERSION` auf `v61`.

- 2026-09-11: **Erweitern: Auswahl wieder aufhebbar, aktives Ende sichtbar.** (K1) Der Ausstieg in
  `handleMapTap()` fragt jetzt die Phase ab statt nur `state.extension`. Er war für die
  Auswahlphase gedacht, griff aber auch in Phase `adding` — dort ist eine Punktauswahl wieder
  möglich, und der Tipp ins Leere ist die **einzige** Geste, die sie aufhebt; sie war damit
  unverlassbar, während der Hauptknopf auf „Verschieben" stand. **Zweiter Verhaltenswechsel
  bewusst mitgenommen:** in Phase `adding` wählt ein Tipp in eine Ausschlussfläche wieder die
  ganze Fläche aus. (K2) Die Regel „der zuerst getippte Punkt wird das offene Ende" existierte
  bereits in `reorderForExtension()`, wurde aber nirgends genannt; sie steht jetzt im Hinweistext
  (DE/EN), das aktive Ende bleibt über beide Phasen markiert, und eine Vorschaulinie zieht von ihm
  zur Mäherposition. Neu ist dafür nur `extensionEndIndex()` als **einzige** Quelle der Frage —
  Markierung, Hinweiszeile und Vorschau lesen alle dort. Ohne Umdrehlogik, ohne Umschalten, ohne
  dritte Phase. Die Nummer holt `refreshExtendPanel()` live, weil sie mit jedem Punkt wandert;
  `#pointStatus` schied aus, weil jeder Telemetrie-Takt sie überschreibt. (K3) **Gemeldet, nicht
  mitrepariert:** der „Verschieben"-Griff überschreibt mit ausgewähltem Punkt weiterhin eine
  bestehende Ecke, statt anzuhängen. Neu: 5 ui-Fälle (188); ein Bestandstest hat nur seinen Namen
  geschärft („In der Auswahlphase …"), seine Zusicherungen sind unverändert und prüfen weiterhin
  nur die Auswahlphase. Gegen dreizehn simulierte Rückfälle geprüft — einer zerlegte nur die
  Laufzeit statt das Verhalten und wurde ersetzt, einer (Vorschau schon in der Auswahlphase) lief
  zunächst durch und hat den Test geschärft. `APP_VERSION` auf `v60`.

- 2026-09-11: **Ringschluss überlebt das Löschen einzelner Punkte.** Zwei gemeldete Symptome, **eine**
  Wurzel: `deleteSelectedPoint()` setzte `perimeterClosed` zurück, obwohl das Entfernen einer Ecke
  keinen Ring öffnet — das Modell speichert gar keinen Schlusspunkt. Beide Symptome lesen dasselbe
  Feld: das Erweitern-Feld verschwand dauerhaft (`canStartExtension()` über `activeContour()`), und
  der Umriss wurde als `polyline` statt `polygon` gezeichnet, die Lücke also an der Kante
  letzter↔erster Punkt — im Prüfmuster **13,381 m** vom gelöschten Punkt entfernt, was die
  Beobachtung „oben gelöscht, unten offen" erklärt. Für Ausschlussflächen gab es den Griff nie,
  daher trat es dort nicht auf. Derselbe Griff in `undoPoint()` („Letzten Punkt") ist mit
  gestrichen. **Bewusst ersatzlos, nicht durch eine Bedingung ersetzt:** ob der Ring geschlossen ist
  und ob die Kontur als Fläche taugt, sind zwei Fragen; die zweite beantwortet `hasUsablePolygon()`
  an ihrer einen Stelle, gemeldet wird sie als `checkPerimeterTooFew`, und `drawPolyline()` verlangt
  für ein `polygon` eigenständig drei Ecken. **Am Import lag es nicht** — in allen drei Herkünften
  (Sunray, App, CaSSAndRA) identisch reproduziert; importierte Karten kommen nur unbedingt
  geschlossen an und stehen deshalb häufiger in dem Zustand, in dem der Fehler sichtbar wird.
  `deleteElement()` bleibt unangetastet, dort wird der Perimeter vollständig geleert. Neu: 5
  ui-Fälle (183), darunter ein Wächter mit der ausgeschriebenen Liste der acht erlaubten
  Schreibstellen samt Grund. **Kein Bestandstest hatte die falsche Wirkung festgeschrieben** —
  anders als beim CaSSAndRA-Import geprüft und ausdrücklich verneint. Gegen zwölf simulierte
  Rückfälle geprüft, darunter der als Bedingung getarnte und die falsche Symmetrie zu den Flächen;
  zwei Sabotagen zerlegten zunächst nur die Syntax und wurden durch saubere Varianten ersetzt.
  `APP_VERSION` auf `v59`.

- 2026-09-11: **Kartenobergrenze von 10 auf 25.** Vorab geprüft und gemeldet statt angenommen:
  die Zahl stand an **neun** weiteren Stellen von Hand (beide Sprachen von `mapLimitReached` und
  `offlineWorks4`, der Markup-Fallback, das Zählfeld `0 / 10`, README DE/EN, CLAUDE.md) und war in
  `tests/` **überhaupt nicht** abgedeckt. Sie steht jetzt nur noch in `MAX_MAPS`; Texte ziehen sie
  über den Platzhalter `{maxMaps}` heran, den `tr()` ausnahmslos ersetzt — nur so bekommen auch die
  per `data-i18n` gesetzten Hilfezeilen die richtige Zahl, ohne sie abzuschreiben. Ausdrücklich
  **nicht** angefasst: die „zehn Karten"-Stellen in den Sunray-Kommentaren — gleiche Zahl, anderer
  Gegenstand (die Vorlagendatei des Nutzers). **Zur Rückfrage nach dem Auswahldialog:** der hängt
  gar nicht an `MAX_MAPS`, seine Einträge kommen aus der eingelesenen Datei, und am Limit wird
  ohnehin vor dem Dialog abgebrochen; er ist zudem ein natives `<select>`. Speicher gemessen:
  **≈ 63 KiB je Karte, 25 Karten ≈ 1,5 MiB**. **Gemeldet, nicht gebaut:** auf vollen Speicher
  reagiert nichts sinnvoll, und die Anzeige bleibt nach einem abgelehnten Schreibvorgang dauerhaft
  auf „Speichert …" stehen (empirisch mit `QuotaExceededError` geprüft) — unabhängig von der Zahl.
  Neu: 4 ui-Fälle (178), darunter ein Wächter gegen eine zweite handgeschriebene Zählung nach dem
  Muster des Handzählungs-Tests. **Dabei aufgefallen:** ein Bestandstest hatte die 10 als Literal
  festgeschrieben und füllt jetzt bis `MAX_MAPS` auf. Gegen zwölf simulierte Rückfälle geprüft —
  zwei liefen zunächst durch: die Grenzprüfung fing 10 und 26 nur über eine Zusicherung auf die
  Konstante (also Absicht statt Wirkung, jetzt allein über das Verhalten belegt), und ein von Hand
  in das Zählfeld geschriebenes `/ 25` blieb unbemerkt, weil `25 / 25` von außen richtig aussieht.
  i18n-Parität DE/EN geprüft. `APP_VERSION` auf `v58`.

- 2026-09-11: **Sunray-App-Dateien lassen sich auch lesen.** Erkennung strukturell über
  `isSunrayAppFile()` (Liste, jeder Eintrag mit `perimeter`, Punkte mit großem `X`/`Y`) — keines
  unserer eigenen drei Formate gilt als Sunray-Datei, per Test in beide Richtungen abgesichert.
  **Mehrere Karten wählt der Nutzer**; dafür ist der Bestätigungsdialog um einen vierten Modus
  gewachsen (`askChoice()` + `#confirmDialogSelect`), kein zweites Modal. Bei genau einer Karte
  wird nicht gefragt, ein Abbruch importiert nichts, und die Position steht in jeder Beschriftung
  vorn, weil Namen sich wiederholen können. Felder eins zu eins (`timestamp` → `capturedAt`,
  `sol` → `gps.solution`, `delta` → `gps.delta`); ohne Messung entsteht **kein** leeres
  `gps`-Objekt. **Verworfen und gemeldet:** der berechnete Mähpfad in `waypoints` (mit Anzahl im
  Klartext) und die Mäheinstellungen der Datei. **Widerspruch im Auftrag gemeldet und aufgelöst:**
  „dieselbe Quelle wie beim GeoJSON-Import" (`geoRingClosed()`) beantwortet die Frage, ob die Datei
  einen Schlusspunkt trägt — die Sunray-Vorlage trägt nie einen, ihre Konturen sind trotzdem
  geschlossen; das ist Formatkonvention, keine zweite Lösung derselben Frage, und ein Test hält
  fest, dass `geoRingClosed()` hier `false` sagen würde. **Dabei behoben:** die Dialogmodi blendeten
  die Felder der jeweils anderen nicht aus, die Darstellung hing also an der Reihenfolge der
  Aufrufe. Rundlauf lesen→schreiben→lesen: **0,000000 mm**. Neu: 1 Block in
  `tests/app-core-test.js`, 5 ui-Fälle (174), Prüfmuster `sunray-app-multi.json`, Harness um
  `__choiceAdapter` ergänzt. Gegen zwölf simulierte Rückfälle geprüft; einer schlug zunächst nur
  durch Endlosrekursion fehl und wurde durch die saubere Variante ersetzt. i18n-Parität maschinell
  geprüft. `APP_VERSION` auf `v57`.

- 2026-09-11: **Viertes Exportformat „Sunray-App", Knöpfe nach Zweck gegliedert, zwei
  Wortlaut-Korrekturen.** (T1) Neues Format nach der Schreibsicht der grauonline-App, Vorlage ist
  ein echter Export mit zehn Karten. Belege und Entscheidungen im eigenen Abschnitt; die beiden
  Kernbefunde: **`delta` und `timestamp` sind Pflichtfelder** — `coords.drop([...])`
  (mapdata.py:491) steht ohne `try`, fehlt eines, wird die **ganze Datei** abgewiesen (empirisch
  geprüft) —, und **das Format braucht keinen Bezugspunkt**, weil CaSSAndRAs Sunray-Zweig nicht
  umrechnet. Die erzeugte Datei ergibt durch die echte Python-Importfunktion **0,000000 mm**
  Abweichung. `delta` wird seit jetzt echt mitgespeichert (`gps.delta`) statt erfunden — wir
  empfangen den Wert über `protocol.js:74` seit jeher, hatten ihn nur nie abgelegt; ob die
  grauonline-App ihn auswertet, ist **nicht belegt**. `cassandraSkippedAreas()` heißt jetzt
  `skippedAreas()`, weil beide Formate dieselbe Auslassung teilen — `hasUsablePolygon()` bleibt die
  einzige Zählung. **Gemeldet, nicht gebaut:** CaSSAndRA verlangt dort `> 3` Punkte je Fläche, eine
  Drei-Punkt-Fläche wird still verworfen (ohne Totalausfall); eine gesonderte Warnung dafür steht
  aus. (T2) Reihenfolge Sunray → CaSSAndRA → JSON → GeoJSON, Beschreibung je Format mit dem
  ausdrücklichen Satz, dass JSON und GeoJSON **nicht** für CaSSAndRA gedacht sind. (T3) Der
  Bezugspunkt steht jetzt in derselben Gruppe wie der CaSSAndRA-Knopf, bleibt aber unabhängig vom
  Positionsmodus sichtbar. (T4) **„üblicherweise die der Ladestation" war unbelegt und ist
  ersetzt:** in der Voreinstellung (`absolutePosSource = false`, StateEstimator.h:64) zählt Sunray
  relativ zur **RTK-Basisstation** (`posN = gps.relPosN`, StateEstimator.cpp:381-382, aus
  UBX-NAV-RELPOSNED); mit `absolutePosSource` ist der Nullpunkt der per `AT+P` gesetzte Punkt
  (`relativeLL(absolutePosSourceLat, …)`, StateEstimator.cpp:379; comm.cpp:486-490) — eine **freie
  Wahl**, kein Ort im Garten. (T5) Dauerhafter roter Hinweis beim Verbinden zu parallelen
  HTTP-Verbindungen, ausdrücklich als **Beobachtung** formuliert: zwei verschiedene Geräte, kein
  kontrollierter Vergleich. Neu: 1 Block in `tests/app-core-test.js`, 4 ui-Fälle (169), Prüfmuster
  `tests/fixtures/sunray-app-map.json`. Gegen zehn simulierte Rückfälle geprüft — einer rutschte
  durch (der T3-Test grenzte die Gruppe nach Text statt nach div-Verschachtelung ab) und ist
  geschärft. i18n-Parität DE/EN maschinell geprüft. `APP_VERSION` auf `v56`.

- 2026-09-11: **CaSSAndRA-Dateien lassen sich einlesen; Ringschluss überlebt jeden Import.**
  Zwei gemeldete Befunde, **eine Wurzel**. (a) Eine echte CaSSAndRA-Datei wurde als lokale Meter
  gelesen, weil die Grad-Erkennung allein an `properties.coordinateSystem` hing — einem Feld, das
  `export_geojson` (mapdata.py:665-690) gar nicht schreibt. Gemessen: eine 39 × 50 m große Karte
  kam mit **0,48 mm** an, Faktor exakt 111111. Neu ist die strukturelle Erkennung
  `isCassandraGeoJson()`, ausdrücklich **keine** Heuristik über die Größenordnung — die wäre
  geraten und bei einem echten Bezugspunkt (~52/~13) nachweislich falsch. (b) Unser eigener Export
  war in CaSSAndRA unsichtbar, sobald er aus einem so importierten Bestand stammte: die
  7-Stellen-Rundung machte aus der 0,48-mm-Karte **212 identische Punkte auf [0,0]** — durch die
  echte Python-Importfunktion geprüft, die dazu „Import successfull" meldet. Mit (a) behoben, (b)
  brauchte keinen eigenen Eingriff. **Der Bezugspunkt war ausgeschlossen, nicht vermutet:** die
  Testkarten tragen Koordinaten um 0, und CaSSAndRA schreibt sie mit `rovercfg.lat`/`lon` — der
  Wert stand dort also auf 0/0, wie unser Export auch. (c) `geoRingClosed()` ist jetzt die einzige
  Quelle des Ringschlusses; sie speist das Abschneiden des Schlusspunktes **und** das Setzen von
  `perimeterClosed`/`exclusion.closed`. Letzteres fehlte bisher ganz — **jede** importierte Karte
  galt als offen, auch aus unserem eigenen GeoJSON. Ohne gültigen Bezugspunkt wird gar nicht
  importiert (kein Rückfall auf 0/0, gleiche Überlegung wie bei der Exportsperre); gemeldet wird
  als Hinweiszeile `#importNotice`, nicht als Dialog. Nachgemessen: beide echten Karten kommen mit
  **39,010 × 49,760 m** und **38,270 × 87,780 m** an, Rundlauf gegen die echte Importfunktion
  **7,85 mm** bei 7,86 mm theoretischer Grenze. Neu: 1 Block in `tests/app-core-test.js`, 3
  ui-Fälle (165), 1 layout-Fall (41), das versionierte Prüfmuster
  `tests/fixtures/cassandra-perimeter.geojson.json`. Gegen zehn simulierte Rückfälle geprüft —
  einer traf zunächst nicht den gemeinten Fehler und wurde geschärft. **Dabei aufgefallen:** ein
  Bestandstest hatte die alte, falsche Wirkung festgeschrieben (CaSSAndRA-Vokabular als Meter
  gelesen); er prüft jetzt nur noch das Vokabular, und der Bezugspunkt wird wie nach
  `loadCassandraReference()` gesetzt, statt die Tests in einem Zustand laufen zu lassen, den die
  App nicht kennt. **Korrigiert:** die Angabe „7 Nachkommastellen" beim CaSSAndRA-Format war eine
  Eigenschaft **unseres** Exports, nicht des Vorbilds — CaSSAndRA rundet nicht (20 Stellen in
  beiden echten Dateien). `APP_VERSION` auf `v55`.

- 2026-09-10: **Drittes Exportformat „CaSSAndRA".** Erzeugt wortgleich die Form von CaSSAndRAs
  eigenem `export_geojson` (mapdata.py:665-690) statt einer Vermutung davon; Details und Belege im
  Abschnitt „CaSSAndRA-Exportformat". Vorab geprüft statt angenommen: (V1) `rovercfg.lat`/`lon`
  wird in CaSSAndRA außer für die Umrechnung und `AT+P` nur in den eigenen Eingabefeldern und der
  API-Ausgabe gelesen — ein geografisch falscher Wert fällt beim Rundlauf heraus; (V2) ein Feature
  mit unbekanntem `properties.name` wird durch die `if`/`elif`-Kette ohne `else` still übergangen,
  empirisch in sieben Varianten bestätigt, weshalb das Metadaten-Feature `mapmaker` gebaut werden
  durfte; (V3) `dcc.Upload` schränkt Endungen nicht ein und der Callback wertet den Dateinamen
  nicht aus, deshalb `.json` wie CaSSAndRAs eigener Export; (V4) Auslieferungswert dort ist 0/0
  (`cfgdata.py:195-196`), das wird bei uns bewusst **nicht** vorbelegt. Der Bezugspunkt ist ein
  eigenes, installationsweites Wertepaar (`mapcreator-ardumower-cassandra-reference-v1`), nicht
  `map.origin`, und die Sperre hängt **nicht** am Positionsmodus. Gemessener Rundlauf gegen die
  echte, kopierte Importfunktion (pandas + shapely, außerhalb des Repos): **größte Abweichung
  4,73 mm**, alle vier Typen erkannt, keine Dublette, die zweipunktige Fläche korrekt ausgelassen.
  **Einschränkung des bleibenden Tests:** die Testform des Repos ist reines Node ohne
  Abhängigkeiten, der Originalimport ist Python — der Test in `tests/app-core-test.js` rechnet
  deshalb gegen eine zeilengetreue Portierung von `coords_abs_to_rel` und liefert dieselben Zahlen
  wie das Original (4,2720 / 4,7287 / 3,9080 / 4,4286 mm). Hilfe und README in beiden Sprachen
  ergänzt. `APP_VERSION` auf `v52`.

  **Nachtrag am selben Tag:** (a) Ein Perimeter unter drei Punkten sperrt den Export jetzt über
  **denselben** Weg wie der fehlende Bezugspunkt — die Kartenprüfung kannte den Fall bereits
  (`checkPerimeterTooFew`), also wurde dort angehängt statt neu gebaut; die Bedingung selbst steht
  seitdem genau einmal im Code (`hasUsablePolygon()`), auch `closePerimeter()` benutzt sie.
  (b) Ausgelassene Ausschlussflächen werden beim Export **benannt** statt still weggelassen.
  (c) Ein bleibendes Prüfmuster im alten GeoJSON-Format sichert die Änderung an `geoJsonToMap()`
  rückwärts ab. (d) Der Satz, `CLAUDE.md` sei nicht versioniert, war falsch und ist korrigiert.
  Neun neue ui-Fälle (152), zwei neue Blöcke in `tests/app-core-test.js`; gegen acht simulierte
  Rückfälle geprüft — einer (ein `mapmaker`-Feature verdrängt den Top-Level-Namen) lief zunächst
  durch, weil die Sabotage die Reihenfolge gar nicht umkehrte; mit der schärferen Fassung schlägt
  die Zusicherung „der Top-Level-Name gewinnt" an.

  **Zweiter Nachtrag:** die Gleichheit von `hasUsablePolygon()` mit den drei abgelösten
  Bedingungen ist an den Grenzfällen 2/3/4 Punkte gegen den Stand vor der Änderung gemessen und
  als Tabelle in `tests/app-core-test.js` festgehalten; dabei ist die verbliebene zweite
  Schreibweise in `mapToCassandraGeoJson()` aufgefallen und gemeldet statt stillschweigend
  angeglichen. Dazu der dauerhafte Hinweis `#cassandraSkippedHint` neben den Export-Knöpfen, der
  ausgelassene Flächen zeigt, **bevor** die Datei entsteht. Drei neue ui-Fälle (155), ein neuer
  Block in `tests/app-core-test.js`; gegen fünf simulierte Rückfälle geprüft — einer lief zunächst
  durch, weil die Sabotage einen Kommentarblock übersah und gar nichts veränderte.

  **Dritter Nachtrag:** die gemeldete vierte Handzählung in `mapToCassandraGeoJson()` ist auf
  `hasUsablePolygon()` umgestellt, und der Schutztest zählt jetzt nicht mehr nur den Perimeter,
  sondern jede Schreibweise `…length >= 3` / `< 3` im ganzen `app.js` — funktionsweise gegen eine
  ausgeschriebene Liste mit Grund je Eintrag abgegrenzt, damit Rendering, Geometrie-Primitive,
  Offen/Geschlossen-Prüfungen und `completePolygon` nicht fälschlich anschlagen. Gegen vier
  Sabotagen geprüft, darunter eine **verhaltensgleiche** (die Exportsperre zählt wieder selbst,
  Ergebnis identisch) — sie fällt trotzdem auf, weil der Test die Struktur prüft, nicht nur die
  Wirkung.

  **Vierter Nachtrag (v53): Vorgabe 0/0 für den Bezugspunkt.** Auf Wunsch des Nutzers ist der
  CaSSAndRA-Bezugspunkt mit 0/0 vorbelegt, solange nichts gespeichert ist; ein gespeicherter Wert
  gewinnt. Vorrang und Erreichbarkeit der bisherigen Vorbelegung aus `map.origin` stehen im
  Abschnitt „CaSSAndRA-Exportformat" — sie bleibt erreichbar, wird aber nicht mehr persistiert.
  Die Sperre bei geleertem Feld bleibt; dafür unterscheidet der Speicher jetzt „geleert" von „nie
  festgelegt". **Dabei aufgefallen und behoben:** zwei leere Eingabefelder wurden von
  `normalizeOrigin()` zu 0/0 gemacht (`Number('') === 0`), der Bezugspunkt ließ sich also gar
  nicht zurücknehmen und die Sperre griff nie — neu ist `originFromInputs()`. Dieselbe Falle im
  Kartenursprung (`updatePositionModeFromUi()`) ist gemeldet, aber nicht mitgeändert. Als
  Ausgleich für die weggefallene Hürde nennt jede Export-Meldung den verwendeten Bezugspunkt im
  Klartext. Rundlauf bei `lat0 = 0` gemessen: **5,5473 mm**, gegen die echte Python-Importfunktion
  gegengeprüft (identisch). Vier neue ui-Fälle (160), ein neuer Block in `tests/app-core-test.js`;
  gegen sechs simulierte Rückfälle geprüft. Hilfe und README in beiden Sprachen nachgezogen.

  **Fünfter Nachtrag (v54):** dieselbe Leerfall-Falle im **Kartenursprung** behoben —
  `updatePositionModeFromUi()` liest die beiden Felder jetzt über dasselbe `originFromInputs()`,
  keine zweite Lösung daneben; der Helfer ist dafür zu `normalizeOrigin()` hochgezogen. Vorher
  geprüft und gemessen, dass `positionMode: 'absolute'` mit `origin: null` sauber trägt — deshalb
  bleibt der Modus stehen, statt heimlich auf `relative` zurückzufallen. Zwei neue ui-Fälle (162),
  gegen drei simulierte Rückfälle geprüft. **Offen gemeldet, nicht angefasst:** `clampNumber()`
  hat dieselbe Signatur des Problems für die acht Einstellungsfelder — siehe „Leere
  Einstellungsfelder".

- 2026-09-08: **Karten teilen (Web Share API).** Neben jedem Export-Knopf im Menü → Karten steht
  jetzt ein Teilen-Knopf; beide Wege holen ihre Datei aus **derselben** Quelle
  (`MAP_EXPORT_FORMATS` → `mapExportFile()`), geteilt wird also wortgleich dieselbe Datei mit
  demselben Dateinamen wie beim Speichern. Die Fähigkeitsprüfung läuft **je Format** über
  `navigator.canShare({ files })` mit einer Probedatei gleicher Endung und gleichen MIME-Typs —
  Browser entscheiden am Dateityp, `application/geo+json` kann also abgelehnt werden, während
  `application/json` durchgeht; ein nicht unterstütztes Format blendet nur seinen eigenen Knopf
  aus. Ein Abbruch durch den Nutzer (`AbortError`) bleibt still, jeder andere Fehler geht über
  `reportError()` sichtbar an den Nutzer. Neun neue ui-Fälle (143), Harness um `File` im
  Sandkasten ergänzt. Gegen neun simulierte Rückfälle geprüft; einer (stilles Aussteigen ohne
  Meldung) lief zunächst durch, weil die Zusicherung `String(undefined)` prüfte — sie vergleicht
  jetzt beobachtbar, dass nichts geteilt wurde und eine Meldung kam. Hilfe und README in beiden
  Sprachen ergänzt, **ohne Anbieternamen** (das Freigabe-Menü kommt vom Gerät). **Nicht ohne Gerät
  verifizierbar:** ob das Android-Freigabe-Menü die Datei korrekt an die Ziel-App übergibt.
  `APP_VERSION` auf `v51`.

- 2026-09-08: **Diagnose-Bereich überarbeitet.** (a) **AT+V-/AT+S-Knöpfe entfernt statt
  repariert.** Geprüft: die Handler waren verdrahtet, keine der 134 per `$()` geholten Kennungen
  fehlt im Markup, und `sendSunray()`/`handleLine()` protokollieren unbedingt — es lag **kein**
  Defekt vor. Beide Knöpfe waren aber nur bei stehender Verbindung bedienbar, und genau dann
  gehen `AT+V` (Handshake) und `AT+S` (Polling, alle 500 ms) ohnehin automatisch raus. Es gab
  also keinen Zustand, in dem sie etwas Eigenes bewirkt hätten; das gemeldete „passiert nichts“
  passt zum unverbundenen Zustand, in dem sie korrekt gesperrt sind. (b) **Protokoll lesbar:**
  `log()` schreibt in den Ringpuffer `state.logEntries` (200 Zeilen), das Mitscrollen pausiert,
  sobald der Nutzer hochscrollt, und `#logJumpBtn` sagt das und führt zurück ans Ende; unten
  angekommen läuft es von selbst wieder mit. (c) **Export:** „Log exportieren“ legt die letzten
  100 Zeilen als Textdatei ab, Dateiname mit Datum und Uhrzeit auf die Sekunde genau; leeres
  Protokoll erzeugt keine Datei, sondern eine Meldung. Elf neue ui-Fälle (134), Harness-Stub um
  `clientHeight` und `click()` ergänzt; gegen acht simulierte Rückfälle geprüft. Hilfe und README
  in beiden Sprachen nachgezogen. `APP_VERSION` auf `v50`.

- 2026-09-07: **Sicherheitsannahme widerrufen: das 1000-ms-Totmannfenster ist nicht belegt.**
  Der Nutzer hat am Gerät beobachtet, dass der Mäher weiterfährt, obwohl keine `AT+M` mehr
  ankommen. Nachgeprüft: die Zahl 1000 ist **keine Erfindung**, sie steht in
  `MeinSunray/sunray/motor.cpp:176` (`setLinearAngularSpeedTimeout = millis() + 1000`) und wird in
  `motor.cpp:276-281` ausgewertet. Falsch war die **Verallgemeinerung** daraus. Vier belegte
  Einschränkungen: der Timer hängt an `Motor::setLinearAngularSpeed()` und wird von *jedem*
  Aufrufer zurückgesetzt — vor allem von `LineTracker.cpp:355` in jedem autonom fahrenden
  Zustand, sodass er praktisch nur in `OP_IDLE` überhaupt ablaufen kann; er ist hart codiert (kein
  `#define` in `config.h`), nullt aber nur die Drehzahl-Sollwerte statt zu bremsen; und er setzt
  eine laufende Hauptschleife voraus. **Entscheidend:** auf dem Mäher läuft die
  **MRTREE-Variante**, die auf diesem Rechner nicht vorliegt (nur `MeinSunray` und
  `MeinSunray-sim`, `motor.cpp` byte-identisch) — für die geflashte Firmware ist damit **gar
  nichts** belegt. Neuer Abschnitt „SICHERHEIT: Das 1000-ms-Totmannfenster trägt nicht“, dazu vier
  überzogene Stellen im Dokument und drei Kommentare in `app.js` korrigiert. **Kein Code-Verhalten
  geändert**, Gegenmaßnahmen nur vorgeschlagen. `APP_VERSION` unverändert.

- 2026-09-07: **Kontinuierlicher Stopp im Ruhezustand (Sicherheit).** Solange keine Fahreingabe
  anliegt, schickt `startIdleStopTicker()` alle **500 ms** ein `AT+M,0,0` — ein einzelnes
  verlorenes Stopp-Paket heilt sich damit im nächsten Takt, ohne dass ein Fehler erkannt werden
  müsste. 500 ms gewählt, weil das die Kadenz des Pollings ist (eine Taktung statt zweier) und
  in Sunrays 1000-ms-Totmannfenster **zwei** Stopps fallen; die Leerlauflast steigt von 2 auf 4
  Schreibvorgängen je Sekunde. Lebenszyklus an der Verbindung wie beim Polling und beim
  RX-Watchdog; ohne Verbindung wird nichts gesendet und auch kein Sendefehler gemeldet.
  Fehlschläge melden sich nur beim **Übergang** von „geht“ zu „geht nicht“, sonst würde die
  Statuszeile bei zwei Stopps je Sekunde zugeschüttet. **Zur Rückfrage aus der Aufgabe:** der
  Fahrbefehl geht während aktiver Fahrt bereits laufend raus (`startDriveHeartbeat()`, 650 ms),
  nicht nur einmal beim Antippen — geprüft und jetzt per Test festgehalten. Sieben neue
  ble-Fälle (41), dreizehn bestehende um das Stillstellen des neuen Takts ergänzt. Gegen acht
  simulierte Rückfälle geprüft; einer (entfernte Verbindungsprüfung) lief zunächst durch, weil
  der Test nur auf ausbleibende Kommandos schaute — er prüft jetzt zusätzlich, dass dabei kein
  Sendefehler gemeldet wird. Hilfe und README in beiden Sprachen ergänzt. `APP_VERSION` auf
  `v49`.

- 2026-09-07: **Zwei Umzüge für kleine Displays (Xperia XZ1).** (a) Punktzahl und Konturzustand
  liegen nicht mehr als Overlay auf der Karte, sondern als **zweite Zeile unter dem Kartennamen**
  in der Werkzeugleiste: `.toolbar-info` ist eine Spalte, die Leiste bleibt eine Zeile. Die
  Händigkeit dreht die Seite weiter über `row-reverse`, zusätzlich spiegelt `align-items` die
  Ausrichtung im Block — ohne das stünde der Text bei Linkshändern linksbündig in einem
  rechtsbündigen Block. `.map-info` ist restlos entfernt, ein Test verbietet die Rückkehr;
  `refreshToolbarVisibility()` hält die Leiste jetzt auch offen, wenn nur die zweite Zeile
  gefüllt ist. (b) Die Positionsanzeige sitzt unten auf der Karte, mittig zwischen Rückgängig-
  und Aufnahme-Knopf. Sie spannt als Band über die Lücke — **beide** Kanten gesetzt, Abzüge
  seitenverschieden (48 gegen 104 px, neues Token `--capture-size`) und mit der Händigkeit
  vertauscht —, kann die Knöpfe deshalb nicht überlappen und kürzt vorher. Die Pille sitzt auf
  dem Text, nicht auf dem Band, damit sie sich auf die Textbreite zusammenzieht. Zwei neue
  layout-Fälle (40), einer rechnet die Lücke für 320/360/412/720 px in beiden Händigkeiten nach;
  fünf bestehende Fälle umgestellt, ein ui-Fall erweitert. Gegen acht simulierte Rückfälle
  geprüft. Hilfe und README in beiden Sprachen nachgezogen. **Nicht ohne Gerät verifizierbar:**
  ob die zweizeilige Leiste auf dem XZ1 nicht zu viel Höhe von der Karte nimmt.
  `APP_VERSION` auf `v48`.

- 2026-09-07: **Tastenkreuz unten abgeschnitten — zweiter Anlauf, Ursache belegt.** Der erste
  Fixversuch (v46) griff nicht. Nachgewiesen durch Auflösen der **ganzen** Kaskade für das
  Element statt nur für den Selektortext: `styles.css:1715` `.drive-pad { margin: 16px auto
  10px }` aus dem alten v14-Layer trifft das Kreuz weiterhin, während `styles.css:2442`
  `.drive-zone .drive-pad` Größe, Lücke und Zeilen setzte, aber **nie** `margin`. Der Kreis
  setzt in `styles.css:2376` seit jeher `margin: 0` und war deshalb nie betroffen — genau die
  Asymmetrie, die der Nutzer vermutet hatte. Rechnung: die Unterkante des Kreuzes liegt bei
  `H − padBottom + marginTop`, erlaubt ist `H − padBottom`; die Feldgröße kürzt sich heraus,
  **jedes positive `marginTop` schneidet ab, in jeder Größenstufe**. Bei 16 px gegen 8 px
  Innenabstand ragten 8 px über den Rand. Fix: `margin: 0` und `grid-template-areas: none` in
  `.drive-zone .drive-pad`. **Warum der erste Versuch das nicht fand:** sein Test fragte
  `resolve('.drive-zone .drive-pad', …)` ab, das nur wörtlich passende Selektoren kennt — die
  Altlast war unsichtbar. `tests/layout-test.js` hat deshalb jetzt `effectiveStyle()`, das jede
  auf ein Element passende Regel nach Spezifität und Reihenfolge auswertet. Zwei neue
  layout-Fälle (39): einer vergleicht die Randbox von Kreuz und Kreis über die volle Kaskade,
  einer rechnet die Unterkante des Kreuzes gegen die Bildschirmhöhe für fünf Auflösungen in
  allen vier Stufen — ausdrücklich im Cursor-Modus. Gegen sechs simulierte Rückfälle geprüft,
  darunter genau der durchgerutschte; der Fehlertext nennt dabei die schuldige Altlastregel.
  Die Untergrenze `--drive-field-min` aus v46 bleibt: sie deckt eine zweite, echte
  Einschränkung ab (`button { min-height: 46px }`). `APP_VERSION` auf `v47`.

- 2026-09-07: **Drei Layout-Korrekturen: Mittelachse, Kartenname, abgeschnittenes Tastenkreuz.**
  (a) Rückgängig-Knopf und Joystick-Umschalter hatten zwar denselben Randabstand, sind aber
  48 gegen 34 px breit — bündig links standen sie sichtbar versetzt. Neues Token `--fab-size`
  legt Größe und damit Mittelachse der Randknöpfe fest, der Umschalter rückt um die halbe
  Differenz ein (`--drive-toggle-inset`), bei Linkshändern gespiegelt mit ausdrücklichem
  Zurücksetzen der Gegenseite. (b) **Nur der Kartenname** ist zurück in die Werkzeugleiste
  gewandert (links, Ellipse, gibt vor den Werkzeugen nach); auf der Karte bleiben Punktzahl,
  Konturzustand und Positionsmeldung, der Streifen wird dadurch kürzer. Neuer i18n-Schlüssel
  `mapPoints`, `mapSummary` entfallen. Die Leiste klappt nur noch ein, wenn auch der Name leer
  ist. (c) **Das Tastenkreuz wurde unten abgeschnitten.** Ursache im CSS bestätigt: global gilt
  `button { min-height: 46px }`, eine `1fr`-Zeile kann ihr Kind nicht darunter drücken, das Kreuz
  brauchte also immer mindestens 146 px und lief in kleinen Feldgrößen unten aus der Fahrzone.
  Der runde Joystick ist kein `<button>` und hatte dieses Minimum nie — deshalb nur im
  Tastenmodus, obwohl beide dasselbe Feld teilen. Fix: `.drive-key { min-height: 0 }` plus eine
  aus Tastengröße und Lücke gerechnete Untergrenze `--drive-field-min` (140 px) in der
  `--joystick-size`-Rechnung, sodass jede Taste ein 44-px-Daumenziel bleibt. Zwei neue
  layout-Fälle (37), drei angepasst, zwei ui-Fälle umgeschrieben; gegen acht simulierte
  Rückfälle geprüft. Hilfe und README in beiden Sprachen nachgezogen. **Nicht ohne Gerät
  verifizierbar:** ob das Kreuz auf allen realen Bildschirmgrößen vollständig sichtbar bleibt.
  `APP_VERSION` auf `v46`.

- 2026-09-07: **Konturstatus stand doppelt in der Karteninfo.** Gemeldet und im Code bestätigt:
  bei geschlossenem Perimeter reichte `refreshCaptureState()` den Text
  `perimeterAlreadyClosed` („Perimeter ist bereits geschlossen.“) an `show()` **zweimal**
  weiter — als Vorlesehilfe und als sichtbare Statuszeile. Neben dem Konturfeld
  („Perimeter · geschlossen“) stand damit derselbe Sachverhalt ausgeschrieben ein zweites Mal,
  und beide nahmen sich in der einzeiligen Karteninfo den Platz weg. Die beiden Bausteine
  stammen aus verschiedenen Aufgaben, der neuere hatte den älteren nie abgelöst. Fix: die
  sichtbare Statuszeile bleibt in diesem Zweig leer, den Zustand sagt allein das Konturfeld und
  die Handlung der Knopf („Perimeter wieder öffnen“). **Der Satz ist nicht ersatzlos gestrichen**
  — er bleibt die `.sr-only`-Vorlesehilfe `#captureButtonHint` am Aufnahme-Knopf, wo er nicht
  sichtbar ist und dem Screenreader den Knopfzustand erklärt. Ein neuer ui-Fall (123) zählt die
  Treffer des Zustandsworts über alle sichtbaren Teile der Zeile und prüft die Aufteilung in
  beiden Sprachen; gegen vier simulierte Rückfälle geprüft, darunter das versehentliche
  Streichen der Vorlesehilfe. `APP_VERSION` auf `v45`.

- 2026-09-07: **Konturstatus war nicht zuordenbar.** Gemeldet: „geschlossen“/„offen“ stand als
  freistehendes Wort an fester Stelle der Karteninfo, mal zwischen Punktzahl und
  Positionsmeldung, mal zwischen Punktzahl und „Ausschluss 1 · Punkt 3“ — bei mehreren
  Ausschlussflächen war nicht erkennbar, auf welche es sich bezieht. Ursache im Code bestätigt:
  `refreshContourStatus()` schrieb nur das Zustandswort in ein eigenes Feld, ohne jede Bindung
  an eine Bezeichnung. Der Zustand entsteht jetzt ausschließlich über `contourStateSuffix()` als
  **Anhängsel an einen Namen**: die Punktbezeichnung wird zu „Ausschluss 1 · Punkt 3 · offen“,
  das Feld selbst trägt „Perimeter · geschlossen“ bzw. „Ausschluss 2 · offen“. Bei ausgewähltem
  Einzelpunkt bleibt das Feld leer, damit der Name nicht zweimal in derselben Zeile steht; eine
  ausgewählte Fläche schlägt dagegen den Modus, weil ihre Auswahlmeldung nur vorübergehend ist.
  Neu ist `contourClosedState()` als einzige Quelle mit drei Werten (`true`/`false`/`null`);
  `selectedContourClosed()` delegiert dorthin, statt die Prüfung ein zweites Mal zu führen. Das
  Feld kann jetzt schrumpfen und kürzen, weil ein Name darin steht. Drei ui-Fälle neu bzw.
  umgeschrieben (122) — darunter zwei Ausschlussflächen mit **gleichzeitig verschiedenem**
  Zustand — plus eine layout-Zusicherung; gegen sieben simulierte Rückfälle geprüft. Hilfe und
  README in beiden Sprachen nachgezogen. `APP_VERSION` auf `v44`.

- 2026-09-07: **Joystick-Umschalter saß zu tief.** Am Gerät gemeldet: der Knopf klebte unten
  neben der Fahrtanzeige statt oben unter dem Rückgängig-Knopf der Karte. Ursache im CSS
  bestätigt: `.drive-side` hatte zwar `justify-self: stretch` (Breite), erbte aber weiter
  `align-items: center` aus `.drive-zone` — der ganze Stapel stand damit senkrecht mittig, und
  weil die Fahrtanzeige darunter hängt, rutschte der Umschalter genau in deren Höhe. Fix: die
  Spalte füllt jetzt auch die Höhe (`align-self: stretch`), wodurch ihr erstes Kind am oberen
  Rand der Steuerzone einhängt; die Fahrtanzeige behält über `margin-block: auto` ihre
  senkrechte Mitte. Waagerechte Seite, Außenkante und `--edge-gap` sind unverändert, der Knopf
  bleibt außerhalb des Kreises und ohne absolutes Positionieren. Ein neuer layout-Fall (35), der
  die senkrechte Lage über `align-self` und die DOM-Reihenfolge prüft und die Seite gegen den
  Rückgängig-Knopf gegenrechnet; gegen sieben simulierte Rückfälle geprüft. `APP_VERSION` auf
  `v43`.

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

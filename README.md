# MapCreator für Ardumower

**[🇩🇪 Deutsch](#deutsch) · [🇬🇧 English](#english)**

Direkter Link: https://algo-giti.github.io/MapmakerBT/

<img src="https://github.com/Algo-giti/MapmakerBT/blob/main/screenshots/switch.jpg" alt="" width="300">
<img src="https://github.com/Algo-giti/MapmakerBT/blob/main/screenshots/menu_speed.png" alt="" width="300">
<img src="https://github.com/Algo-giti/MapmakerBT/blob/main/screenshots/demo_mode.jpg" alt="" width="300">
<img src="https://github.com/Algo-giti/MapmakerBT/blob/main/screenshots/menu_connection.jpg" alt="" width="300">

---

<a id="deutsch"></a>

# 🇩🇪 Deutsch

MapCreator ist eine mobile Web-App, mit der du die Mähkarte deines Ardumower/Sunray direkt im
Garten aufnimmst und pflegst. Die App verbindet sich per **Bluetooth Low Energy** direkt mit dem
Ardumower-ESP32 – ohne Internet, ohne Server, ohne Konto.

Die Oberfläche lässt sich zwischen **Deutsch und Englisch** umschalten; Deutsch ist voreingestellt.

## Was die App kann

- Ardumower per Bluetooth verbinden
- lokale Sunray-X/Y-Position, RTK-Status, Satelliten und Akkuspannung live anzeigen
- **Perimeter**, mehrere **Ausschlussflächen**, **Wegpunkte** und **Dockpunkte** aufnehmen
- Punkte automatisch setzen – wahlweise im Zeittakt oder nach gefahrener Strecke
- vorhandene Karten nachträglich korrigieren: Punkt antippen, an die aktuelle Mäherposition
  verschieben oder löschen
- nachträglich Punkte auf halber Strecke vor oder hinter einen ausgewählten Punkt einfügen
- eine bereits geschlossene Kontur an einer beliebigen Kante wieder öffnen und verlängern
- die letzten 20 Bearbeitungsschritte einzeln rückgängig machen
- Karten auf Geometrie- und RTK-Probleme prüfen
- bis zu 10 Karten auf dem Gerät verwalten
- Karten als JSON-Backup oder als GeoJSON exportieren und wieder importieren
- den Mäher während der Aufnahme mit dem Daumen-Joystick manuell fahren
- wahlweise mit Joystick oder mit vier Richtungstasten fahren
- die gesamte Bedienung für Links- oder Rechtshänder spiegeln
- Demo-Modus zum Ausprobieren ohne Mäher

Ein Upload der fertigen Karte zu Sunray gehört **nicht** zum Funktionsumfang. MapCreator erzeugt
die Kartendatei, das Einspielen erfolgt mit deinem gewohnten Werkzeug.

## Voraussetzungen

- **Android mit Chrome** – empfohlen und getestet.
- **Samsung Internet** funktioniert ebenfalls.
- **Firefox** unterstützt kein Web Bluetooth und funktioniert nicht.
- **iPhone/iPad** werden nicht unterstützt: Safari und die Chromium-Browser unter iOS/iPadOS
  stellen Webseiten kein Web Bluetooth zur Verfügung.
- Auf dem Ardumower muss der ESP32 mit BLE laufen und in Reichweite sein.

## Erste Schritte

1. Die MapCreator-Seite in Chrome auf dem Android-Gerät öffnen.
2. Bluetooth am Gerät einschalten.
3. Oben links das **Menü** (☰) öffnen – oder direkt das Bluetooth-Symbol antippen – und unter
   **Verbindung** das **Sunray-Passwort** eintragen (Standard ist `123456`).
4. Auf **Gerät suchen & verbinden** tippen und den Ardumower aus der Liste auswählen.
   Der Browser darf die Gerätesuche nur nach dieser Tippgeste starten.
5. Zurück auf der Karte färbt sich das Bluetooth-Symbol grün, das **RTK-Feld** zeigt
   „Fix / Float / No Fix“ mit den Satelliten als *Mäher/RTK-Station*, daneben steht die
   Akkuspannung.

Das Passwort bleibt nur für die laufende Sitzung im Speicher und wird nicht mit der Karte gespeichert.

## Die Oberfläche

Die App besteht aus drei Zonen:

- **Kopfzeile** – Menü, Verbindungsstatus, Moduswahl, RTK-Status und Akku.
- **Karte** – nimmt den größten Teil des Bildschirms ein. Ganz oben liegt eine schmale
  **Werkzeugleiste**: links Kartenname und Punktzahl samt Statuszeile, rechts die Werkzeuge
  (Lösch-Werkzeug, Rückgängig, bei Bedarf „Schließen & neu“ und „Ansicht zurück“). Darunter die
  Kartenfläche mit Mäherposition, aufgenommenen Punkten und deren Verbindungslinien, unten rechts
  der Aufnahme-Knopf.
- **Fahrzone** unten – der Joystick für den Daumen, daneben die Fahrtanzeige.

Alle Einstellungen liegen auf einer eigenen **Menüseite** (☰) mit sechs Bereichen: Verbindung,
Karten, Einstellungen, Kartenprüfung, Diagnose und Hilfe. Unter *Einstellungen* stecken
Fahrgeschwindigkeit, Ansicht & Maßstab sowie Aufnahme. Es ist immer nur ein Bereich geöffnet;
das Öffnen eines Bereichs klappt die anderen zu.

## Karte aufnehmen

1. Im Menü unter **Karten** über **Neue Karte anlegen** eine Karte erstellen.
2. Den **Moduswahl-Button** in der Kopfzeile antippen; es öffnet sich ein Auswahlfeld in der
   Bildschirmmitte mit **Perimeter, Ausschluss, Wegpunkt und Dock**. Der Button zeigt danach
   immer den aktiven Modus.
3. Den Mäher an die gewünschte Stelle fahren und den großen Button unten rechts
   **gedrückt halten**, bis der Ring einmal herumgelaufen ist. Das Halten verhindert, dass beim
   Schieben oder Zoomen der Karte versehentlich Punkte entstehen.
   - **Grün** bedeutet echter RTK FIX – nur dann ist der Punkt wirklich genau.
   - Ist **„Nur bei RTK FIX“** aktiv, bleibt die Aufnahme bei FLOAT oder INVALID gesperrt.
4. Für lange Strecken die **Automatik** einschalten: der kleine Knopf mit dem Aufnahmesymbol über
   dem Aufnahme-Button. Solange sie läuft, ersetzt ein großer roter Knopf mit Pause-Symbol den
   manuellen Button. Es gibt zwei Betriebsarten, umschaltbar im Menü unter
   *Einstellungen › Aufnahme*:
   - **zeitbasiert** – alle *n* Sekunden ein Punkt (Startwert 5 s),
   - **distanzbasiert** – ein Punkt, sobald der Mäher seit dem letzten automatischen Punkt weit
     genug gefahren ist (Startwert 50 cm, Minimum 10 cm).

   Die Beschriftung über dem Knopf zeigt den eingestellten Wert, also „Auto-Aufnahme (5s)“ oder
   „Auto-Aufnahme (50cm)“. Auch die Automatik hält sich an „Nur bei RTK FIX“.
5. Nähert sich der Mäher nach einem ausreichend langen Perimeter wieder dem Startpunkt, bietet
   die App an, den Perimeter zu **schließen**.
6. Eine neue **Ausschlussfläche** brauchst du nicht anzulegen: sie entsteht von selbst, sobald du
   im Ausschluss-Modus den ersten Punkt setzt. Für Reihen kleiner Flächen – etwa Bäume – gibt es
   in der Werkzeugleiste **„Schließen & neu“**: ein Tipp schließt die laufende Fläche und beginnt
   sofort die nächste.

Beim Wechsel des Aufnahmemodus fragt die App nach, ob die verlassene Kontur geschlossen werden
soll – aber nur, wenn sie mindestens drei Punkte hat und noch offen ist. Sagst du Nein, bleibt sie
offen und du kannst später an genau diesem Punkt weitermachen. Offene Konturen findet auch die
**Kartenprüfung** und bietet an, sie zu schließen.

Beim manuellen Aufnehmen mittelt MapCreator die Positionen der letzten rund zwei Sekunden. Das
dämpft das GPS-Rauschen, ohne dass du warten musst.

## Punkte korrigieren

Tippe einen vorhandenen Punkt direkt auf der Karte an. Die Trefferfläche ist deutlich größer als
der sichtbare Punkt, damit sie mit dem Daumen erreichbar bleibt. Der ausgewählte Punkt wird
hervorgehoben, und der große Button unten rechts wird zum **Verschieben**-Button: ein einfacher
Tipp setzt den Punkt auf die aktuelle Mäherposition.

Tippst du mitten in eine fertige **Ausschlussfläche**, wird die ganze Fläche ausgewählt. Beim
Perimeter passiert das absichtlich nicht, sonst ließe sich die Karte nicht mehr frei verschieben.

Ein Tipp auf eine leere Stelle hebt die Auswahl wieder auf.

### Punkte nachträglich einfügen

Solange ein Punkt ausgewählt ist, stehen in der Werkzeugleiste zusätzlich **„Punkt davor“** und
**„Punkt danach“**. Ein Tipp setzt einen neuen Punkt genau auf die **Mitte der Strecke** zum
jeweiligen Nachbarn – praktisch, wenn eine Kontur an einer Stelle zu grob geraten ist. Aus der
Folge A-B-C-D wird mit ausgewähltem B also A-[Mitte AB]-B-C-D bzw. A-B-[Mitte BC]-C-D. Danach ist
die Auswahl aufgehoben und die Oberfläche wieder im Normalzustand.

Das ist eine **rein geometrische** Ergänzung: die aktuelle Mäherposition spielt keine Rolle, der
Mäher muss dafür nirgends hinfahren, und „Nur bei RTK FIX“ greift hier nicht. Der neue Punkt wird
als konstruiert vermerkt und erbt die Qualitätsangabe des schlechteren seiner beiden Nachbarn – er
ist höchstens so verlässlich wie die Strecke, auf der er liegt.

Es gilt für alle vier Elementarten: Perimeter, Ausschlussflächen, Wegpunkte und Dockpfad sind
geordnete Punktfolgen. **Am Rand einer noch offenen Kontur** fehlt auf einer Seite die Strecke –
beim ersten Punkt gibt es kein „davor“, beim letzten kein „danach“; der jeweilige Knopf ist dann
ausgegraut. Bei einer **geschlossenen** Kontur laufen beide über die Schlussstrecke vom letzten
zum ersten Punkt um.

### Eine geschlossene Kontur erweitern

Ist ein Perimeter oder eine Ausschlussfläche bereits geschlossen, musst du sie nicht neu
aufnehmen, um sie an einer Stelle zu verlängern. In der Kartenleiste erscheint dann
**„Perimeter erweitern“** bzw. **„Fläche erweitern“**:

1. Knopf antippen. Die Statuszeile bittet dich, **zwei direkt benachbarte Punkte** anzutippen –
   also zwei Punkte, die durch eine Kante verbunden sind.
2. Sind die beiden nicht benachbart, sagt die Statuszeile das und die Auswahl beginnt von vorn.
   An der Kontur ändert sich dabei nichts.
3. Passt es, wird die Kante zwischen ihnen aufgetrennt und die Kontur gilt wieder als offen. Der
   **zuerst** angetippte Punkt ist ab jetzt das offene Ende.
4. Nimm weitere Punkte auf wie sonst auch – Halte-Knopf, Automatik und Positions-Glättung
   funktionieren unverändert. Die neuen Punkte landen genau zwischen den beiden gewählten.
5. **„Fertig“** schließt die Kontur wieder; der zuletzt aufgenommene Punkt verbindet sich mit dem
   zweiten der beiden gewählten.

Brichst du vorher ab – etwa durch einen Moduswechsel –, bleibt die Kontur einfach **offen**. Das
ist kein Sonderfall: die App fragt beim Moduswechsel ohnehin, ob eine offene Kontur geschlossen
werden soll, und die **Kartenprüfung** findet offene Konturen und bietet an, sie zu schließen.

### Das Lösch-Werkzeug

Ein Werkzeug, drei Aufgaben – die Beschriftung darunter sagt jeweils, was passiert:

| Auswahl | Beschriftung | Wirkung |
|---|---|---|
| keine | Letzten Punkt | löscht den zuletzt aufgenommenen Punkt, beliebig oft hintereinander |
| ein Punkt | Punktauswahl löschen | löscht genau diesen Punkt |
| eine Ausschlussfläche | Fläche löschen | löscht die ganze Fläche, nach Rückfrage |

Während die Automatik läuft, ist das Werkzeug ausgeblendet.

### Rückgängig

Daneben steht **Rückgängig**. Es nimmt die letzten **20 Bearbeitungsschritte** einzeln zurück –
nicht nur das Aufnehmen, sondern auch Verschieben, Löschen einzelner Punkte, das Löschen ganzer
Flächen und das Schließen einer Kontur. Jeder Tipp geht einen Schritt zurück; ist der Verlauf
leer, ist der Knopf ausgegraut. Der Verlauf gilt für die laufende Sitzung und die geöffnete Karte.

### Kartenpflege

Im Menü unter **Karten** stehen unter *Elemente der Karte* der Perimeter, alle Ausschlussflächen,
die Wegpunkte und der Dockpfad mit ihrer Punktzahl. Ein Tipp auf eine Zeile macht das Element zum
Aufnahmeziel, der Papierkorb daneben leert es.

Ausschlussflächen **ohne einen einzigen Punkt** werden automatisch entfernt – sobald du den
Ausschluss-Modus verlässt oder die Menüseite öffnest. Die Fläche, an der du gerade arbeitest,
bleibt davon unberührt. Die verbleibenden Flächen werden lückenlos neu durchnummeriert.

In der Kartenübersicht trägt jede Karte zwei kleine Werkzeuge: der **Stift** benennt sie um – das
ändert nur den Namen, nicht den Inhalt – und das **Kopiersymbol** legt eine vollständige,
unabhängige Kopie an, mit allen Punkten, dem Positionsmodus und dem Ursprung. Die Kopie bekommt
automatisch einen freien Namen („… (Kopie)“, dann „(Kopie 2)“ und so weiter); die Karte, an der du
gerade arbeitest, bleibt aktiv.

Fertige Karten kannst du im Menü unter **Karten** **sperren**, damit sie nicht mehr versehentlich
verändert werden. Eine gesperrte Karte lässt sich auch nicht umbenennen.

## Kartenansicht und Bedienung

- **Hell- und Dunkelmodus**: standardmäßig übernimmt die App die Einstellung des Geräts;
  unter *Einstellungen › Ansicht & Maßstab* lässt sich Hell oder Dunkel fest wählen.
- **Bedienseite**: unter *Einstellungen › Fahrgeschwindigkeit* stellst du Rechts- oder
  Linkshänder ein. Linkshänder spiegelt die **gesamte** Bedienung – Werkzeuge und Karteninfo in
  der Werkzeugleiste, den Aufnahme-Knopf und die Fahrtanzeige.
- **Joystick-Größe** in vier Stufen von Klein bis Sehr groß: größer heißt mehr Trefferfläche,
  kleiner mehr Platz für die Karte.
- **Pinch-to-Zoom** und Verschieben mit dem Finger; die Karte lässt sich nicht aus dem Bild
  schieben. Sobald du die Ansicht selbst verändert hast, erscheint in der Werkzeugleiste
  **„Ansicht zurück“**.
- Raster in 0,10 / 0,25 / 0,50 / 1 / 2 / 5 m oder automatisch
- maßstäbliche Darstellung des Mähers samt Ausrichtung, Standard 0,60 × 0,35 m, anpassbar
- Fahrspur während der Aufnahme
- **Punktfarben**: der Rand zeigt, zu welchem Element ein Punkt gehört, die Füllung die
  RTK-Qualität im Moment der Aufnahme
- Live-Abstand zum Perimeter bzw. zum ausgewählten Punkt
- Bildschirm-Wachhalten während längerer Aufnahmen

## Manuell fahren

Der Joystick liegt fest unter der Karte und ist für die Bedienung mit dem Daumen ausgelegt.

- Die **Richtung** der Auslenkung ist die Fahrtrichtung, die **Stärke** der Auslenkung die
  Geschwindigkeit – wie bei einem RC-Fahrzeug. Ein separater Geschwindigkeitsregler entfällt.
  Auch rückwärts stimmt die Lenkrichtung: hinten-links am Joystick fährt hinten-links.
- **Minimale und maximale Geschwindigkeit** legst du im Menü unter
  *Einstellungen › Fahrgeschwindigkeit* fest: das Minimum gilt ab der Totzone, das Maximum am
  vollen Ausschlag.
- Der Joystick ist eine **Totmannsteuerung**: beim Loslassen springt er in die Mitte zurück und
  der Mäher stoppt sofort.

Für genaues Rangieren gibt es alternativ **vier Richtungstasten**. Der kleine Knopf in der oberen
Ecke des Fahrfelds schaltet zwischen beidem um, sein Symbol zeigt den gerade aktiven Modus – bei
Linkshändern sitzt er gespiegelt in der anderen Ecke. Dieselbe Wahl steht auch unter
*Einstellungen › Fahrgeschwindigkeit*. Die Tasten kennen bewusst nur
vorwärts, rückwärts und Drehen auf der Stelle – keine Diagonalen, damit beim Geradeausfahren
nichts versehentlich lenkt. Sie fahren mit einer **eigenen, langsamen Geschwindigkeit**
(Startwert 15 cm/s, nie schneller als die eingestellte Höchstgeschwindigkeit); der Joystick bleibt
davon unberührt. Halten und Loslassen verhalten sich wie beim Joystick.

Diese App steuert bewusst **kein Mähen**: kein Start, kein Stop, kein Docking und keine
Mähmotor-Steuerung. Sie nimmt ausschließlich Karten auf.

> **Sicherheitshinweis**
> Bricht die Bluetooth-Verbindung ab, kann die Webseite keinen Stop-Befehl mehr senden.
> Nutze die manuelle Steuerung deshalb nur bei Sichtkontakt und halte den physischen
> Stop/Not-Aus des Mähers erreichbar.

## Karten sichern und übertragen

Alle Karten liegen **lokal im Browser** dieses Geräts. Ein anderer Browser, ein anderes Profil oder
gelöschte Website-Daten bedeuten: Karten sind weg.

- **JSON-Export** ist das vollständige Backup einer Karte inklusive Metadaten.
- **GeoJSON-Export** eignet sich zur Weiterverarbeitung: Perimeter und Ausschlussflächen werden
  als Polygone exportiert, Wegpunkte und Dockpfad als LineString. Die Koordinaten bleiben dabei im
  lokalen XY-Meter-System von Sunray, es sind keine Geokoordinaten.
- Beide Formate lassen sich wieder importieren.

**Erstelle regelmäßig JSON-Backups deiner wichtigen Karten.**

### Positionsmodus: relativ oder absolut

Jede Karte rechnet standardmäßig in **lokalen Metern** relativ zum Startpunkt des Mähers – das ist
der Modus *Relativ*, und für die normale Nutzung ist dort nichts einzustellen.

Der Modus *Absolut* im Menü unter **Karten** ist nur dann interessant, wenn du die Karte mit
Programmen austauschen willst, die echte Weltkoordinaten erwarten. Dafür trägst du einmalig die
GPS-Position des Nullpunkts ein, üblicherweise die der Ladestation; der GeoJSON-Export enthält
danach absolute Längen- und Breitengrade statt Meter. Der Ursprung gehört zur **jeweiligen Karte**,
nicht zur App – verschiedene Karten liegen meist an verschiedenen Orten – und wird mitexportiert,
damit ein Import die Werte wieder zurückrechnen kann.

Solange kein gültiger Ursprung eingetragen ist, bleibt alles bei lokalen Metern. Der JSON-Backup
bleibt in jedem Fall in Metern, denn er ist die vollständige Sicherung der Karte selbst.

## Ohne Internet im Garten arbeiten

1. Die Seite mindestens einmal **mit Internet** in Chrome öffnen.
2. Im Menü unter **Hilfe** warten, bis der Systemcheck den Offline-Cache als bereit meldet.
3. Optional als App installieren – siehe unten.

Danach starten die App-Dateien aus dem lokalen Cache. Bluetooth, Kartenaufnahme, Bearbeitung und
Datei-Export brauchen ohnehin keine Internetverbindung.

### Als App installieren (PWA)

MapCreator ist eine **Progressive Web App**: eine Webseite, die sich wie eine installierte App
verhält. Sie bekommt ein eigenes Symbol auf dem Startbildschirm, startet im Vollbild ohne
Adressleiste und lädt ihre Dateien aus dem lokalen Zwischenspeicher – deshalb läuft sie im Garten
auch ohne Internet. Ein App-Store ist nicht beteiligt, es wird nichts zusätzlich heruntergeladen.

**Android / Chrome**

1. Die Seite einmal mit Internet öffnen und warten, bis der Systemcheck den Offline-Zwischenspeicher
   als bereit meldet.
2. Oben rechts das Browser-Menü (⋮) öffnen.
3. **„App installieren“** antippen – je nach Chrome-Fassung heißt der Eintrag
   *„Zum Startbildschirm hinzufügen“*. Manchmal schlägt Chrome es auch von selbst unten vor.
4. Danach startet MapCreator über das neue Symbol auf dem Startbildschirm.

**iPhone / iPad (Safari)**: Teilen-Symbol → *„Zum Home-Bildschirm“*. Beachte, dass unter iOS und
iPadOS kein Browser Web Bluetooth bereitstellt: die installierte App kann dort **keine Verbindung
zum Ardumower** aufbauen. Karten ansehen, importieren und exportieren funktioniert, aufnehmen nicht.

Deinstallieren geht wie bei jeder App über das Symbol. Die gespeicherten Karten liegen im Browser
und bleiben davon unberührt, solange die Website-Daten nicht gelöscht werden.

Liegt eine neue Fassung der App bereit, erscheint oben eine schmale Hinweisleiste. Erst ein Tipp
darauf lädt die neue Fassung – mitten in einer Aufnahme lädt die Seite nie ungefragt neu.

## Wenn etwas nicht funktioniert

**Der Ardumower wird nicht gefunden.**
Bluetooth am Gerät prüfen, aktuelles Chrome verwenden, Reichweite verringern und sicherstellen,
dass der ESP32 tatsächlich sendet. Ist bereits eine andere App verbunden, diese zuerst trennen.

**Der Aufnahme-Button wird nicht grün.**
Grün bedeutet echter RTK FIX. Prüfe den RTK-Empfang und die Live-Daten. Mit aktivierter Option
„Nur bei RTK FIX“ bleibt die Aufnahme bei FLOAT oder INVALID bewusst gesperrt.

**Die Bluetooth-Verbindung bricht ab.**
MapCreator versucht nach einem unerwarteten Abbruch automatisch, sich wieder zu verbinden.
Gelingt das nicht, einfach erneut auf **Gerät suchen & verbinden** tippen. Standby des Geräts,
zu große Entfernung oder ein Browser-Neustart trennen die Verbindung immer.

**Die App startet ohne WLAN nicht.**
Die Seite muss einmal mit Internet geöffnet worden sein und der Offline-Cache im Systemcheck
bereit gemeldet haben.

**Meine Karten sind verschwunden.**
Karten liegen nur lokal im Browser. Gelöschte Website-Daten, ein anderer Browser oder ein anderes
Profil verwenden getrennte Speicher. Importiere dein letztes JSON-Backup.

Im Menü unter **Diagnose** siehst du das vollständige Protokoll der Bluetooth-Kommunikation. Es hilft,
wenn du ein Problem melden möchtest.

## Lizenz

Siehe [LICENSE](LICENSE).

---

<a id="english"></a>

# 🇬🇧 English

MapCreator is a mobile web app for recording and maintaining the mowing map of your
Ardumower/Sunray right there in the garden. It connects to the Ardumower ESP32 directly over
**Bluetooth Low Energy** – no internet, no server, no account.

The interface can be switched between **German and English**; German is the default.

## What the app can do

- connect to the Ardumower over Bluetooth
- show the local Sunray X/Y position, RTK status, satellites and battery voltage live
- record a **perimeter**, several **exclusion areas**, **waypoints** and **dock points**
- place points automatically – either on a time interval or by distance travelled
- correct existing maps afterwards: tap a point, move it to the current mower position, or delete it
- insert additional points halfway before or after a selected point afterwards
- reopen an already closed contour at any edge and extend it
- undo the last 20 editing steps one at a time
- check maps for geometry and RTK problems
- keep up to 10 maps on the device
- export maps as a JSON backup or as GeoJSON, and import them again
- drive the mower manually with the thumb joystick while recording
- drive either with the joystick or with four direction keys
- mirror the entire layout for left- or right-handed use
- demo mode for trying things out without a mower

Uploading the finished map to Sunray is **not** part of the scope. MapCreator produces the map
file; loading it onto the mower is done with your usual tool.

## Requirements

- **Android with Chrome** – recommended and tested.
- **Samsung Internet** works as well.
- **Firefox** does not support Web Bluetooth and will not work.
- **iPhone/iPad** are not supported: on iOS/iPadOS neither Safari nor the Chromium browsers
  expose Web Bluetooth to web pages.
- The Ardumower's ESP32 must be running with BLE and be within range.

## Getting started

1. Open the MapCreator page in Chrome on the Android device.
2. Turn on Bluetooth.
3. Open the **menu** (☰) at the top left – or tap the Bluetooth icon directly – and enter the
   **Sunray password** under **Connection** (`123456` by default).
4. Tap **Search & connect** and pick the Ardumower from the list. The browser is only allowed to
   start the device search after this tap.
5. Back on the map, the Bluetooth icon turns green, the **RTK badge** shows
   “Fix / Float / No Fix” with the satellites as *mower/RTK station*, and the battery voltage sits
   next to it.

The password is kept only for the running session and is never stored with the map.

## The interface

The app has three zones:

- **Header** – menu, connection status, mode selection, RTK status and battery.
- **Map** – takes up most of the screen. A slim **tool bar** sits at the very top: on the left the
  map name and point count together with the status line, on the right the tools (delete tool,
  undo, plus “Close & new” and “Reset view” when they apply). Below it the map itself with the
  mower position, the recorded points and their connecting lines, and the capture button at the
  bottom right.
- **Drive zone** at the bottom – the joystick for your thumb, with the drive status beside it.

All settings live on a separate **menu page** (☰) with six sections: Connection, Maps, Settings,
Map check, Diagnostics and Help. *Settings* contains Drive speed, View & scale, and Capture. Only
one section is open at a time; opening one collapses the others.

## Recording a map

1. Create a map in the menu under **Maps** with **Create new map**.
2. Tap the **mode button** in the header; a dialog opens in the middle of the screen offering
   **Perimeter, Exclusion, Waypoint and Dock**. The button then always shows the active mode.
3. Drive the mower to the spot you want and **press and hold** the large button at the bottom
   right until the ring has gone round once. Holding prevents points from appearing accidentally
   while panning or zooming the map.
   - **Green** means a real RTK FIX – only then is the point genuinely accurate.
   - While **“Only with RTK FIX”** is on, capturing stays blocked on FLOAT or INVALID.
4. For long stretches, switch on **automatic capture**: the small button with the record symbol
   above the capture button. While it runs, a large red button with a pause symbol replaces the
   manual one. There are two modes, switchable in the menu under *Settings › Capture*:
   - **time-based** – one point every *n* seconds (5 s to start with),
   - **distance-based** – one point as soon as the mower has travelled far enough since the last
     automatic point (50 cm to start with, 10 cm minimum).

   The label above the button shows the configured value, i.e. “Auto capture (5s)” or
   “Auto capture (50cm)”. Automatic capture respects “Only with RTK FIX” too.
5. Once a sufficiently long perimeter brings the mower back near its starting point, the app
   offers to **close** the perimeter.
6. You do not need to create a new **exclusion area**: one appears by itself as soon as you place
   the first point in exclusion mode. For rows of small areas – trees, for instance – the tool bar
   offers **“Close & new”**: one tap closes the current area and immediately starts the next.

When you switch capture mode, the app asks whether the contour you are leaving should be closed –
but only if it has at least three points and is still open. Say no and it stays open, so you can
continue from exactly that point later. The **map check** also finds open contours and offers to
close them.

When capturing manually, MapCreator averages the positions of roughly the last two seconds. That
damps the GPS noise without making you wait.

## Correcting points

Tap an existing point directly on the map. The hit area is considerably larger than the visible
point so it stays reachable with a thumb. The selected point is highlighted and the large button
at the bottom right becomes the **move** button: a single tap places the point at the current
mower position.

Tapping inside a finished **exclusion area** selects the whole area. This deliberately does not
happen on the perimeter, otherwise you could no longer pan the map freely.

Tapping an empty spot clears the selection again.

### Inserting points afterwards

While a point is selected, the tool bar additionally offers **“Point before”** and
**“Point after”**. One tap places a new point exactly **halfway along the segment** to the
respective neighbour – handy when a contour turned out too coarse in one spot. With B selected,
the sequence A-B-C-D becomes A-[midpoint AB]-B-C-D or A-B-[midpoint BC]-C-D. Afterwards the
selection is cleared and the interface returns to its normal state.

This is a **purely geometric** addition: the current mower position plays no part, the mower does
not have to drive anywhere, and “Only with RTK FIX” does not apply here. The new point is marked
as constructed and inherits the quality rating of the worse of its two neighbours – it is only as
trustworthy as the segment it sits on.

It applies to all four element types: perimeter, exclusion areas, waypoints and the dock path are
ordered sequences. **At the edge of a contour that is still open** one side has no segment – the
first point has no “before”, the last no “after”, and that button is greyed out. On a **closed**
contour both wrap around the closing segment from the last point to the first.

### Extending a closed contour

If a perimeter or exclusion area is already closed, you do not have to record it again just to
extend it in one place. The map bar then offers **“Extend perimeter”** or **“Extend area”**:

1. Tap the button. The status line asks you to tap **two directly neighbouring points** – that is,
   two points joined by an edge.
2. If the two are not neighbours, the status line says so and the selection starts over. Nothing
   on the contour is changed.
3. If they fit, the edge between them is cut and the contour counts as open again. The point you
   tapped **first** becomes the open end.
4. Capture further points as usual – the hold button, automatic capture and position smoothing all
   work unchanged. The new points land exactly between the two you picked.
5. **“Done”** closes the contour again; the last captured point joins up with the second of the two
   you picked.

If you break off before that – by switching mode, for instance – the contour simply stays **open**.
That is not a special case: the app asks on every mode change whether an open contour should be
closed, and the **map check** finds open contours and offers to close them.

### The delete tool

One tool, three jobs – the label underneath says what will happen:

| Selection | Label | Effect |
|---|---|---|
| none | Last point | deletes the most recently captured point, repeatedly if you like |
| a point | Delete selected point | deletes exactly that point |
| an exclusion area | Delete area | deletes the whole area, after a confirmation |

While automatic capture is running the tool is hidden.

### Undo

Next to it sits **Undo**. It takes back the last **20 editing steps** one at a time – not just
captures, but also moving points, deleting single points, deleting whole areas and closing a
contour. Each tap goes one step back; when the history is empty the button is greyed out. The
history belongs to the running session and the map you have open.

### Map maintenance

The menu under **Maps** lists, under *Map elements*, the perimeter, every exclusion area, the
waypoints and the dock path with their point counts. Tapping a row makes that element the capture
target; the bin next to it empties the element.

Exclusion areas **without a single point** are removed automatically – as soon as you leave
exclusion mode or open the menu page. The area you are currently working on is left alone. The
remaining areas are renumbered without gaps.

In the map overview every map carries two small tools: the **pencil** renames it – that changes
only the name, not the contents – and the **copy icon** creates a complete, independent copy with
all points, the position mode and the origin. The copy automatically gets a free name (“… (copy)”,
then “(copy 2)” and so on); the map you are currently working on stays active.

Finished maps can be **locked** in the menu under **Maps** so they cannot be changed by accident.
A locked map cannot be renamed either.

## Map view and operation

- **Light and dark mode**: by default the app follows the device setting; under
  *Settings › View & scale* you can pin it to light or dark.
- **Operating side**: choose right- or left-handed under *Settings › Drive speed*. Left-handed
  mirrors the **entire** layout – tools and map info in the tool bar, the capture button and the
  drive status.
- **Joystick size** in four steps from small to very large: larger means a bigger target, smaller
  means more room for the map.
- **Pinch to zoom** and pan with one finger; the map cannot be pushed out of view. As soon as you
  change the view yourself, **“Reset view”** appears in the tool bar.
- grid at 0.10 / 0.25 / 0.50 / 1 / 2 / 5 m, or automatic
- the mower drawn to scale including its heading, 0.60 × 0.35 m by default, adjustable
- movement trail while recording
- **Point colours**: the outline shows which element a point belongs to, the fill shows the RTK
  quality at the moment it was captured
- live distance to the perimeter or to the selected point
- keeps the screen awake during longer recordings

## Driving manually

The joystick sits permanently below the map and is designed for thumb operation.

- The **direction** of the deflection is the driving direction, the **amount** of deflection is
  the speed – just like an RC vehicle. There is no separate speed slider. Steering is correct in
  reverse as well: back-left on the joystick drives back-left.
- **Minimum and maximum speed** are set in the menu under *Settings › Drive speed*: the minimum
  applies from the dead zone on, the maximum at full deflection.
- The joystick is a **dead man's control**: let go and it snaps back to the centre and the mower
  stops immediately.

For precise manoeuvring there are alternatively **four direction keys**. The small button in the top
corner of the drive field switches between the two and its icon shows the mode currently active –
for left-handed use it sits mirrored in the other corner. The same choice is available under
*Settings › Drive speed*. The keys deliberately only know forward, backward and
turning on the spot – no diagonals, so nothing steers by accident while driving straight. They use
their **own slow speed** (15 cm/s to start with, never faster than the configured maximum); the
joystick is unaffected. Press and release behave just like the joystick.

This app deliberately does **not** control mowing: no start, no stop, no docking and no mowing
motor control. It only records maps.

> **Safety note**
> If the Bluetooth connection drops, the web page can no longer send a stop command. Only use
> manual driving within sight of the mower and keep its physical stop/emergency switch reachable.

## Backing up and transferring maps

All maps live **locally in the browser** of this device. A different browser, a different profile
or cleared site data means the maps are gone.

- **JSON export** is the complete backup of a map including metadata.
- **GeoJSON export** is meant for further processing: perimeter and exclusion areas are exported
  as polygons, waypoints and the dock path as LineStrings. The coordinates stay in Sunray's local
  XY metre system – they are not geographic coordinates.
- Both formats can be imported again.

**Make regular JSON backups of the maps that matter to you.**

### Position mode: relative or absolute

By default every map works in **local metres** relative to the mower's starting point – that is the
*Relative* mode, and for normal use there is nothing to configure.

The *Absolute* mode in the menu under **Maps** is only of interest if you want to exchange the map
with programs that expect real world coordinates. For that you enter the GPS position of the zero
point once, usually that of the charging station; the GeoJSON export then contains absolute
longitude and latitude instead of metres. The origin belongs to the **individual map**, not to the
app – different maps usually sit in different places – and it is exported along with the file so
that an import can convert the values back.

As long as no valid origin is set, everything stays in local metres. The JSON backup always stays
in metres, because it is the complete backup of the map itself.

## Working offline in the garden

1. Open the page at least once **with internet** in Chrome.
2. In the menu under **Help**, wait until the system check reports the offline cache as ready.
3. Optionally install it as an app – see below.

After that the app files start from the local cache. Bluetooth, map recording, editing and file
export do not need an internet connection anyway.

### Installing it as an app (PWA)

MapCreator is a **Progressive Web App**: a web page that behaves like an installed app. It gets
its own icon on the home screen, starts full screen without an address bar and loads its files
from the local cache – which is why it works in the garden without internet. No app store is
involved and nothing extra is downloaded.

**Android / Chrome**

1. Open the page once with internet and wait until the system check reports the offline cache as
   ready.
2. Open the browser menu (⋮) at the top right.
3. Tap **“Install app”** – depending on the Chrome version the entry is called
   *“Add to Home screen”*. Chrome sometimes offers it by itself at the bottom of the screen.
4. MapCreator then starts from the new icon on your home screen.

**iPhone / iPad (Safari)**: share icon → *“Add to Home Screen”*. Note that on iOS and iPadOS no
browser provides Web Bluetooth: the installed app **cannot connect to the Ardumower** there.
Viewing, importing and exporting maps works, recording does not.

Uninstalling works like any other app, via the icon. The stored maps live in the browser and are
not affected, as long as the site data is not cleared.

When a new version of the app is available, a slim notice bar appears at the top. Only a tap on it
loads the new version – the page never reloads unasked in the middle of a recording.

## When something does not work

**The Ardumower is not found.**
Check Bluetooth on the device, use an up-to-date Chrome, reduce the distance and make sure the
ESP32 is actually advertising. If another app is already connected, disconnect that one first.

**The capture button does not turn green.**
Green means a real RTK FIX. Check RTK reception and the live data. With “Only with RTK FIX”
enabled, capturing stays deliberately blocked on FLOAT or INVALID.

**The Bluetooth connection drops.**
After an unexpected drop MapCreator tries to reconnect on its own. If that does not work, just tap
**Search & connect** again. Device standby, too much distance or a browser restart always break
the connection.

**The app does not start without Wi-Fi.**
The page must have been opened with internet once and the offline cache must have been reported as
ready in the system check.

**My maps have disappeared.**
Maps only live locally in the browser. Cleared site data, a different browser or a different
profile use separate storage. Import your most recent JSON backup.

The menu under **Diagnostics** shows the full log of the Bluetooth communication. It helps when
you want to report a problem.

## License

See [LICENSE](LICENSE).

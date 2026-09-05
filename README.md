# MapCreator für Ardumower

Direkter Link:
https://algo-giti.github.io/MapmakerBT/

MapCreator ist eine mobile Web-App, mit der du die Mähkarte deines Ardumower/Sunray direkt im
Garten aufnimmst und pflegst. Die App verbindet sich per **Bluetooth Low Energy** direkt mit dem
Ardumower-ESP32 – ohne Internet, ohne Server, ohne Konto.

Die Oberfläche lässt sich zwischen **Deutsch und Englisch** umschalten; Deutsch ist voreingestellt.

Screenshots:

<img src="[pfad/zum/bild.png](https://github.com/Algo-giti/MapmakerBT/blob/main/screenshots/menu_connection.jpg)" alt="" width="300">







## Was die App kann

- Ardumower per Bluetooth verbinden
- lokale Sunray-X/Y-Position, RTK-Status, Satelliten und Akkuspannung live anzeigen
- **Perimeter**, mehrere **Ausschlussflächen**, **Wegpunkte** und **Dockpunkte** aufnehmen
- vorhandene Karten nachträglich korrigieren: Punkt antippen, an die aktuelle Mäherposition
  verschieben oder löschen
- Karten auf Geometrie- und RTK-Probleme prüfen
- die letzte Änderung an einer Karte rückgängig machen
- bis zu 10 Karten auf dem Gerät verwalten
- Karten als JSON-Backup oder als GeoJSON exportieren und wieder importieren
- den Mäher während der Aufnahme mit dem Daumen-Joystick manuell fahren
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
- **Karte** – nimmt den größten Teil des Bildschirms ein und zeigt Mäherposition, aufgenommene
  Punkte und deren Verbindungslinien.
- **Fahrzone** unten – der Joystick für den Daumen.

Alle Einstellungen liegen auf einer eigenen **Menüseite** (☰) mit sechs Bereichen: Verbindung,
Karten, Einstellungen, Kartenprüfung, Diagnose und Hilfe. Unter *Einstellungen* stecken
Fahrgeschwindigkeit, Ansicht & Maßstab sowie Aufnahme. Es ist immer nur ein Bereich geöffnet;
das Öffnen eines Bereichs klappt die anderen zu.

## Karte aufnehmen

1. Im Menü unter **Karten** über **+ Neu** eine Karte anlegen.
2. Den **Moduswahl-Button** in der Kopfzeile antippen; es öffnet sich ein Auswahlfeld in der
   Bildschirmmitte mit **Perimeter, Ausschluss, Wegpunkt und Dock**. Der Button zeigt danach
   immer den aktiven Modus.
3. Den Mäher an die gewünschte Stelle fahren und den großen Button unten rechts
   **gedrückt halten**, bis der Ring einmal herumgelaufen ist. Das Halten verhindert, dass beim
   Schieben oder Zoomen der Karte versehentlich Punkte entstehen.
   - **Grün** bedeutet echter RTK FIX – nur dann ist der Punkt wirklich genau.
   - Ist **„Nur bei RTK FIX"** aktiv, bleibt die Aufnahme bei FLOAT oder INVALID gesperrt.
4. Für lange Strecken die **Automatik** einschalten: der kleine Knopf mit dem Play-Symbol über
   dem Aufnahme-Button. Solange sie läuft, ersetzt ein großer roter Knopf mit Pause-Symbol den
   manuellen Button, und MapCreator setzt im eingestellten Takt selbstständig Punkte. Das
   **Intervall** (Startwert 5 Sekunden) steht im Menü unter *Einstellungen › Aufnahme*.
5. Nähert sich der Mäher nach einem ausreichend langen Perimeter wieder dem Startpunkt, bietet
   die App an, den Perimeter zu **schließen**.
6. Weitere Ausschlussflächen legst du im Menü unter *Karten* mit **+ Neu** an.

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

### Der Lösch-Button oben rechts

Ein Button, drei Aufgaben – die Beschriftung darüber sagt jeweils, was passiert:

| Auswahl | Beschriftung | Wirkung |
|---|---|---|
| keine | Letzten Punkt | löscht den zuletzt aufgenommenen Punkt, beliebig oft hintereinander |
| ein Punkt | Punktauswahl löschen | löscht genau diesen Punkt |
| eine Ausschlussfläche | Fläche löschen | löscht die ganze Fläche, nach Rückfrage |

Während die Automatik läuft, ist der Button ausgeblendet.

Fertige Karten kannst du im Menü unter **Karten** **sperren**, damit sie nicht mehr versehentlich
verändert werden.

## Kartenansicht

- **Hell- und Dunkelmodus**: standardmäßig übernimmt die App die Einstellung des Geräts;
  unter *Einstellungen › Ansicht & Maßstab* lässt sich Hell oder Dunkel fest wählen.
- **Pinch-to-Zoom** und Verschieben mit dem Finger; die Karte lässt sich nicht aus dem Bild
  schieben, und der Button oben rechts stellt die automatische Ansicht wieder her.
- Raster in 0,10 / 0,25 / 0,50 / 1 / 2 / 5 m oder automatisch
- maßstäbliche Darstellung des Mähers samt Ausrichtung, Standard 0,60 × 0,35 m, anpassbar
- Fahrspur während der Aufnahme
- farbliche Bewertung der Punktqualität nach RTK-Lösung und Genauigkeit
- Live-Abstand zum Perimeter bzw. zum ausgewählten Punkt
- Bildschirm-Wachhalten während längerer Aufnahmen

## Manuell fahren

Der Joystick liegt fest unter der Karte und ist für die Bedienung mit dem Daumen ausgelegt.

- Die **Richtung** der Auslenkung ist die Fahrtrichtung, die **Stärke** der Auslenkung die
  Geschwindigkeit – wie bei einem RC-Fahrzeug. Ein separater Geschwindigkeitsregler entfällt.
- **Minimale und maximale Geschwindigkeit** legst du im Menü unter **Fahren** fest; der volle
  Ausschlag entspricht deinem Maximum.
- Der Joystick ist eine **Totmannsteuerung**: beim Loslassen springt er in die Mitte zurück und
  der Mäher stoppt sofort.

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
- **GeoJSON-Export** eignet sich zur Weiterverarbeitung; die Koordinaten bleiben dabei im lokalen
  XY-Meter-System von Sunray, es sind keine Geokoordinaten.
- Beide Formate lassen sich wieder importieren.

**Erstelle regelmäßig JSON-Backups deiner wichtigen Karten.**

## Ohne Internet im Garten arbeiten

1. Die Seite mindestens einmal **mit Internet** in Chrome öffnen.
2. Im Menü unter **Hilfe** warten, bis der Systemcheck den Offline-Cache als bereit meldet.
3. Optional über das Chrome-Menü als App installieren.

Danach starten die App-Dateien aus dem lokalen Cache. Bluetooth, Kartenaufnahme, Bearbeitung und
Datei-Export brauchen ohnehin keine Internetverbindung.

## Wenn etwas nicht funktioniert

**Der Ardumower wird nicht gefunden.**
Bluetooth am Gerät prüfen, aktuelles Chrome verwenden, Reichweite verringern und sicherstellen,
dass der ESP32 tatsächlich sendet. Ist bereits eine andere App verbunden, diese zuerst trennen.

**Der Aufnahme-Button wird nicht grün.**
Grün bedeutet echter RTK FIX. Prüfe den RTK-Empfang und die Live-Daten. Mit aktivierter Option
„Nur bei RTK FIX" bleibt die Aufnahme bei FLOAT oder INVALID bewusst gesperrt.

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

# MapCreator für Ardumower

MapCreator ist eine mobile Web-App, mit der du die Mähkarte deines Ardumower/Sunray direkt im
Garten aufnimmst und pflegst. Die App verbindet sich per **Bluetooth Low Energy** direkt mit dem
Ardumower-ESP32 – ohne Internet, ohne Server, ohne Konto.

Die Oberfläche lässt sich zwischen **Deutsch und Englisch** umschalten; Deutsch ist voreingestellt.

## Was die App kann

- Ardumower per Bluetooth verbinden
- lokale Sunray-X/Y-Position, RTK-Status, Satelliten und Akkuspannung live anzeigen
- **Perimeter**, mehrere **Ausschlussflächen** und **Dockpunkte** aufnehmen
- vorhandene Karten nachträglich korrigieren: einzelne Punkte neu anlernen, Teilstücke neu
  aufnehmen, zwischen zwei Punkten begradigen
- Karten auf Geometrie- und RTK-Probleme prüfen
- lokale Versionsstände speichern und Änderungen rückgängig machen
- bis zu 10 Karten auf dem Gerät verwalten
- Karten als JSON-Backup oder als GeoJSON exportieren und wieder importieren
- den Mäher während der Aufnahme manuell fahren
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
3. In den Reiter **Verbindung** wechseln und das **Sunray-Passwort** eintragen
   (Standard ist `123456`).
4. Auf **Gerät suchen & verbinden** tippen und den Ardumower aus der Liste auswählen.
   Der Browser darf die Gerätesuche nur nach dieser Tippgeste starten.
5. Sobald die Anzeige oben auf verbunden springt, erscheinen X/Y-Position und RTK-Status.

Das Passwort bleibt nur für die laufende Sitzung im Speicher und wird nicht mit der Karte gespeichert.

## Karte aufnehmen

1. Im Reiter **Karten** über **+ Neu** eine Karte anlegen.
2. Zurück im Reiter **Aufnahme** den Modus wählen: Perimeter, Ausschluss oder Dock.
3. Den Mäher an die gewünschte Stelle fahren und den großen Aufnahme-Button drücken.
   - **Grün** bedeutet echter RTK FIX – nur dann ist der Punkt wirklich genau.
   - Ist **„Nur bei RTK FIX"** aktiv, bleibt die Aufnahme bei FLOAT oder INVALID gesperrt.
4. Für lange Strecken die **Auto-Aufnahme** einschalten: MapCreator setzt selbstständig Punkte,
   auf geraden Abschnitten weniger, in Kurven dichter.
5. Nähert sich der Mäher nach einem ausreichend langen Perimeter wieder dem Startpunkt, bietet
   die App an, den Perimeter zu **schließen**.
6. Für weitere Ausschlussflächen im Werkzeugbereich **+ Neu** antippen.

Der zuletzt gesetzte Punkt lässt sich jederzeit rückgängig machen.

## Karte bearbeiten

Über **Punkte bearbeiten** einen vorhandenen Punkt direkt auf der Karte antippen. Dann kannst du

- den Punkt an der aktuellen Mäherposition **neu anlernen**,
- ein ganzes **Teilstück** zwischen zwei Punkten neu abfahren und aufnehmen,
- die Strecke zwischen zwei ausgewählten Punkten zu einer **Geraden** begradigen.

Der maximal erlaubte Abstand zwischen Mäher und ausgewähltem Punkt lässt sich einstellen, damit
nicht versehentlich der falsche Punkt verschoben wird.

Fertige Karten kannst du im Reiter **Karten** **sperren**, damit sie nicht mehr versehentlich
verändert werden.

## Kartenansicht

- Raster in 0,10 / 0,25 / 0,50 / 1 / 2 / 5 m oder automatisch
- maßstäbliche Darstellung des Mähers, Standard 0,60 × 0,35 m, anpassbar
- Fahrspur während der Aufnahme
- farbliche Bewertung der Punktqualität nach RTK-Lösung und Genauigkeit
- Live-Abstand zum Perimeter bzw. zum ausgewählten Punkt
- Messwerkzeug: zwei Stellen antippen und die Distanz in Metern ablesen
- Bildschirm-Wachhalten während längerer Aufnahmen

Fahrsteuerung und Werkzeuge liegen als seitliche Schieber direkt über der Karte und sind
für Rechts- oder Linkshänder umschaltbar.

## Manuell fahren

Die Fahrsteuerung öffnet sich über den seitlichen Griff in der Kartenansicht.

- Der runde **Joystick** kombiniert stufenlos Vorwärts/Rückwärts und Drehung, Kurvenfahrt
  inklusive. Er ist als **Totmannsteuerung** ausgelegt: beim Loslassen springt er in die Mitte
  zurück und der Mäher stoppt.
- Die **Fahrgeschwindigkeit** ist über den Regler einstellbar, Standard 0,15 m/s.
- Der **Mähmotor** lässt sich erst nach separater Freigabe und **1,5 Sekunden Halten** einschalten;
  ausgeschaltet wird er sofort. Die PWM ist von 0 bis 255 einstellbar. Bei PWM 0 startet der
  Mähmotor nicht.
- **STOP ALLES** schaltet den Mähmotor ab und versetzt Sunray in den Ruhezustand.

> **Sicherheitshinweis**
> Bricht die Bluetooth-Verbindung ab, kann die Webseite keinen Stop-Befehl mehr senden.
> Nutze die manuelle Steuerung deshalb nur bei Sichtkontakt und halte den physischen
> Stop/Not-Aus des Mähers erreichbar. Die Mähmotor-Anzeige zeigt nur den zuletzt gesendeten
> Zustand, sie ist keine unabhängige Rückmeldung vom Mäher.

## Karten sichern und übertragen

Alle Karten liegen **lokal im Browser** dieses Geräts. Ein anderer Browser, ein anderes Profil oder
gelöschte Website-Daten bedeuten: Karten sind weg.

- **JSON-Export** ist das vollständige Backup einer Karte inklusive Metadaten und Versionsverlauf.
- **GeoJSON-Export** eignet sich zur Weiterverarbeitung; die Koordinaten bleiben dabei im lokalen
  XY-Meter-System von Sunray, es sind keine Geokoordinaten.
- Beide Formate lassen sich wieder importieren.

**Erstelle regelmäßig JSON-Backups deiner wichtigen Karten.**

## Ohne Internet im Garten arbeiten

1. Die Seite mindestens einmal **mit Internet** in Chrome öffnen.
2. Im Reiter **Hilfe** warten, bis der Systemcheck den Offline-Cache als bereit meldet.
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

Im Reiter **Diagnose** siehst du das vollständige Protokoll der Bluetooth-Kommunikation. Es hilft,
wenn du ein Problem melden möchtest.

## Lizenz

Siehe [LICENSE](LICENSE).

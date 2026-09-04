# MapCreator für Ardumower v16

Mobile, statische PWA für **GitHub Pages** zur Kartenerstellung und Kartenpflege eines Ardumower/Sunray über **Web Bluetooth**. Die App läuft primär auf Android + Chrome, speichert Karten lokal in IndexedDB und kann nach dem ersten erfolgreichen Laden offline weiterverwendet werden.

Die Oberfläche ist vollständig **Deutsch/Englisch** umschaltbar; Deutsch ist Standard.

## Schwerpunkt

MapCreator bleibt ein Werkzeug für:

- Ardumower per BLE verbinden
- lokale Sunray-X/Y-Position und RTK-Status anzeigen
- Perimeter, Ausschlussflächen und Dockpfad aufnehmen
- vorhandene Karten korrigieren
- Karten prüfen, versionieren und sichern
- bis zu 10 Karten lokal verwalten

Ein Upload der Karte zu Sunray ist nicht Bestandteil der App.



## Neu in v15

- seitliche **Fahren-/Werkzeuge-Schieber repariert** (doppelte Event-Handler entfernt)
- deutlich größere Touch-Flächen für beide seitlichen Schieber
- **Rechtshänder/Linkshänder umschaltbar**
  - Standard: Fahren rechts, Werkzeuge links
  - Linkshänder: Fahren links, Werkzeuge rechts
- Einstellung wird lokal gespeichert
- Fahr- und Werkzeugfenster auf kleinen Displays nahezu vollbreit
- Joystick und Bedienelemente vergrößert
- Werkzeugfenster hat jetzt ebenfalls einen eigenen Schließen-Button

## Neu in v14

- **Handy-first Kartenansicht:** GPS/RTK, X/Y und Akku sind deutlich kompakter; Akku sitzt jetzt direkt bei den GPS-Daten.
- **Werkzeuge als rechter Schieber:** Die Mapping-Werkzeuge sind standardmäßig eingezogen und werden über den rechten Randgriff geöffnet. Dadurch bleibt die Karte fast vollständig frei.
- **Fahrsteuerung als linker Schieber direkt auf der Karte:** Ein eigener Steuerungs-Reiter ist nicht mehr nötig.
- **Großer analoger Rund-Joystick:** stufenlose Kombination aus linearer und angularer Geschwindigkeit erlaubt Geradeaus-, Rückwärts- und echte Kurvenfahrt. Loslassen sendet `AT+M,0,0`.
- **Fahrgeschwindigkeit repariert:** Der Tempo-Regler ist auch ohne aktive BLE-Verbindung einstellbar und wird lokal gespeichert. Standard bleibt `0,15 m/s`.
- **Mähmotor weiterhin im Fahr-Schieber:** Freigabe, PWM 0–255, 1,5-s-Halteaktion zum Einschalten und STOP ALLES bleiben vorhanden.
- Linker und rechter Schieber schließen sich beim Öffnen gegenseitig, damit auf kleinen Displays maximal viel Kartenfläche sichtbar bleibt.

## Neu in v13

- Einstellbare Mähmotor-PWM von **0 bis 255** im eingeblendeten Fahrfenster.
- Schieberegler plus Zahlenfeld und Prozentanzeige.
- Der Wert wird lokal auf dem Gerät gespeichert und vor dem Einschalten an Sunray übertragen.
- Bei PWM `0` wird der Mähmotor nicht gestartet; wird `0` bei laufendem Mähmotor übernommen, schaltet MapCreator den Mähmotor zuerst aus.
- Sunray erhält die Einstellung über den `pwm`-Parameter von `AT+C`. Der Wert ist eine PWM-Obergrenze, **keine garantierte oder gemessene RPM-Drehzahl**.

## Neu in v12

### Mapping

- **Punktqualität:** Kartenpunkte werden anhand der bei der Aufnahme gespeicherten RTK-Lösung und Genauigkeit farblich bewertet.
- **Intelligente Auto-Aufnahme:** Auf geraden Strecken werden weniger Punkte erzeugt; bei Richtungsänderungen wird dichter aufgenommen.
- **Perimeter schließen:** Nähert sich der Mäher nach einem ausreichend langen Perimeter dem Startpunkt, bietet MapCreator das Schließen an. Bei Auto-Aufnahme kann der Perimeter automatisch geschlossen werden, ohne einen doppelten Startpunkt zu speichern.
- **Messwerkzeug:** Zwei Stellen auf der Karte antippen und die lokale XY-Distanz in Metern anzeigen.
- **Wake Lock:** Während Auto-/Teilstück-Aufnahme kann MapCreator den Bildschirm auf unterstützten Browsern wach halten.
- **Kartensperre:** Fertige Karten können gegen versehentliche Bearbeitung gesperrt werden.
- **Karten-Miniaturen:** Die bis zu 10 lokal gespeicherten Karten werden als kleine Geometrie-Vorschauen mit Fläche, Punktzahl und Änderungsdatum angezeigt.

### Manuelle Mähersteuerung

Die eingeblendete **Fahrsteuerung in der Kartenansicht** verwendet die offizielle Sunray-Kommunikationsschicht:

- `AT+M,linear,angular` für langsames manuelles Fahren
- `AT+M,0,0` zum Stoppen der Fahrt
- `AT+C,1,-1` zum Einschalten des Mähmotors, ohne die Operation bewusst zu ändern
- `AT+C,0,-1` zum Ausschalten des Mähmotors
- `AT+C,0,0` für **STOP ALLES**: Mähmotor aus + Sunray IDLE; Sunray behandelt `op=0` als besonderen Sicherheitsfall, der alle Motoren stoppt

Die Fahrsteuerung ist als **Totmannsteuerung** ausgelegt: den runden Joystick ziehen; beim Loslassen springt er in die Mitte und Stop wird gesendet. Durch gleichzeitigen Linear-/Angular-Anteil sind Kurvenfahrten möglich. Der Mähmotor lässt sich erst nach separater Freigabe und **1,5 Sekunden Halten** einschalten; Ausschalten erfolgt sofort.

**Wichtig:** Bei unterbrochener Bluetooth-Verbindung kann eine Webseite keinen neuen Stop-Befehl mehr übertragen. Die manuelle Steuerung deshalb nur bei Sichtkontakt verwenden und den physischen Stop/Not-Aus des Mähers erreichbar halten. Die Mähmotor-Anzeige in MapCreator zeigt den zuletzt von der App gesendeten Zustand und ist keine unabhängige Drehzahl-Rückmeldung.

## Bereits enthalten

- BLE UART Service `FFE0` / Characteristic `FFE1`
- Sunray `AT+V`-Handshake, Checksumme und Passwort-Verschlüsselung
- Live `AT+S`: X, Y, RTK-Lösung, Genauigkeit, Satelliten, Batterie, Orientierung (`delta`)
- technisches Dark-Layout
- großes Kartenfenster; unten nur eine große kontextabhängige Mapping-Aktion
- großer Aufnahme-Button grün nur bei echtem RTK FIX
- Raster 0,10 / 0,25 / 0,50 / 1 / 2 / 5 m oder automatisch
- maßstäbliche Mäheranzeige, Standard 0,60 × 0,35 m
- Perimeter, mehrere Ausschlussflächen und Dockpunkte
- Punkt neu anlernen
- Teilstück neu anlernen
- Gerade zwischen zwei ausgewählten Punkten
- Fahrspur während Mapping
- Live-Abstand zum Perimeter / ausgewählten Punkt
- Kartenprüfung auf Geometrie-/RTK-Probleme
- lokale Versionen und Undo
- bis zu 10 Karten in IndexedDB
- JSON Backup-Export/-Import
- GeoJSON Export/-Import mit lokalem XY-Meter-Koordinatensystem
- Hilfe/Systemcheck DE/EN
- PWA/Offline-Service-Worker
- Demo-Modus

## Offline im Garten

1. GitHub-Pages-Seite mindestens einmal **mit Internet** in Chrome öffnen.
2. Warten, bis der Hilfe-Systemcheck den Offline-Cache als bereit meldet.
3. Optional über Chrome als App/PWA installieren.
4. Danach können die statischen App-Dateien aus dem Cache geladen werden, wenn WLAN/Internet im Garten abbricht.

BLE, lokale Karten, Mapping, Bearbeitung und Datei-Export benötigen danach keine laufende Verbindung zu GitHub.

Das Löschen der Browser-/Website-Daten kann Offline-Cache und IndexedDB-Karten entfernen. Für wichtige Karten regelmäßig JSON-Backups erstellen.

## Browser

- **Android + Chrome:** empfohlen; Web Bluetooth in Chrome auf Android technisch ab Android 6.0 verfügbar. Aktuelles Android/Chrome empfohlen.
- **Samsung Internet:** Web Bluetooth grundsätzlich unterstützt.
- **Firefox / Firefox Android:** für BLE nicht geeignet, weil Web Bluetooth fehlt.
- **iPhone/iPad:** Safari und Chromium-Browser unter iOS/iPadOS stellen der Webseite kein natives Web Bluetooth bereit; direkte Ardumower-BLE-Verbindung funktioniert dort nicht.

## GitHub Pages

1. Inhalt dieses Ordners in ein Repository kopieren.
2. GitHub: **Settings → Pages**.
3. **Deploy from a branch**, z. B. `main` und `/ (root)`.
4. Die erzeugte HTTPS-Adresse in Chrome auf Android öffnen.
5. Im Reiter **Verbindung** auf **Gerät suchen & verbinden** tippen.

## Sunray-Passwort

Das Eingabefeld startet mit `123456`. Das Passwort wird nicht in Karten oder Local Storage gespeichert; es bleibt nur in der aktuellen Browser-Sitzung.

## Tests

```bash
node tests/protocol-test.js
node tests/app-core-test.js
node --check app.js
node --check protocol.js
```

## BLE-Stabilität in v16

- GATT-Schreibvorgänge bevorzugen jetzt **Write With Response** statt `writeWithoutResponse`.
- Mehrteilige BLE-Kommandos werden mit kurzem Abstand übertragen.
- Fahr-Heartbeat wurde auf 650 ms reduziert. Sunray stoppt manuelle Fahrt nach 1000 ms ohne neues `AT+M`, daher bleibt die Totmann-Sicherheit erhalten.
- `AT+S` wird nicht mehr direkt in laufende Fahr-Schreibvorgänge hineingequeued.
- Diagnose protokolliert Verbindungsdauer sowie TX/RX-Zähler beim Disconnect.
- Nach einem unerwarteten GATT-Abbruch versucht MapCreator automatisch mit Backoff wiederzuverbinden.

Wenn die Verbindung weiterhin reproduzierbar abbricht, ist als Nächstes die ESP32-Konfiguration zu prüfen. Die Sunray-Standardwerte `BLE_MIN_INTERVAL 2`, `BLE_MAX_INTERVAL 10`, `BLE_TIMEOUT 30` entsprechen sehr schnellen 2,5–12,5-ms-Intervallen und nur 300 ms Supervision Timeout. Je nach Android-Gerät kann eine weniger aggressive Einstellung stabiler sein.

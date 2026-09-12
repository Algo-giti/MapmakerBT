'use strict';

const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
const BLE_CHUNK_SIZE = 15; // Sunray ESP32 BLE_MTU=20; payload <= 15 bytes
const BLE_INTER_CHUNK_DELAY_MS = 12;
// ACHTUNG: NICHT als Totmann-Schutz verstehen. Der 1000-ms-Timeout in Sunrays
// Motor::setLinearAngularSpeed() wird von jedem anderen Motor-Aufrufer zurueckgesetzt und ist
// fuer die geflashte MRTREE-Firmware ueberhaupt nicht belegt. Siehe CLAUDE.md,
// "SICHERHEIT: Das 1000-ms-Totmannfenster traegt nicht".
const DRIVE_HEARTBEAT_MS = 650;
// RX-Watchdog: Sunray antwortet auf jedes AT+S. Bleiben drei Abfragen in Folge unbeantwortet,
// gilt der Link als tot, auch wenn Chrome ihn weiter als "connected" fuehrt.
const BLE_RX_TIMEOUT_MS = 8000;
const BLE_RX_CHECK_INTERVAL_MS = 1000;
const BLE_MAX_RECONNECT_ATTEMPTS = 8;
// Eine Sunray-Zeile ist rund 120 Zeichen lang; 4 KB lassen genug Luft fuer stark
// zerstueckelte Antworten und begrenzen trotzdem Muell ohne Zeilenende.
const BLE_RX_BUFFER_LIMIT = 4096;
const BLE_RX_OVERFLOW_LIMIT = 3;
// Abstand der AT+S-Abfragen. Weder die Hauptplatine (aktualisiert die Position intern alle
// 20 ms) noch die ESP32-Bruecke (reine UART-BLE-Weiterleitung ohne eigene Taktung) begrenzen
// das — die frueheren 2000 ms waren eine reine Entscheidung der App.
const BLE_POLL_INTERVAL_MS = 500;
// Sunray beantwortet jedes AT+S. Bleibt rund 8 s lang jede Abfrage ohne verwertbare Antwort,
// ist die Antwortkette gestoert — auch wenn noch Bruchstuecke eintrudeln und der reine
// Stille-Watchdog deshalb nicht anschlaegt. Die Grenze wird aus dem Intervall abgeleitet:
// als feste Anzahl haette das schnellere Polling sie auf 2 s verkuerzt und gesunde
// Verbindungen abgeschossen.
const BLE_UNANSWERED_POLL_GRACE_MS = 8000;
const BLE_UNANSWERED_POLL_LIMIT = Math.max(4, Math.round(BLE_UNANSWERED_POLL_GRACE_MS / BLE_POLL_INTERVAL_MS));
// Fehlgeschlagene Schreibvorgaenge wiederholen sich im Sekundentakt (Fahr-Heartbeat, Polling).
// Der Kurzhinweis erscheint jedes Mal, der Dialog hoechstens alle 20 s.
const BLE_ERROR_NOTICE_INTERVAL_MS = 20000;
// Manuelle Aufnahme mittelt die letzten Fixes, statt den Nutzer warten zu lassen.
// Distanzbasierte Automatik. Die Untergrenze liegt bewusst deutlich ueber der RTK-Fix-
// Genauigkeit von wenigen Zentimetern: darunter wuerde schon das Restrauschen der Position
// laufend Punkte ausloesen, obwohl der Maeher steht.
const AUTO_CAPTURE_DISTANCE_MIN_CM = 10;
const AUTO_CAPTURE_DISTANCE_MAX_CM = 1000;
const AUTO_CAPTURE_DISTANCE_DEFAULT_CM = 50;
const AUTO_CAPTURE_MODES = ['time', 'distance'];

/** So viele Bearbeitungsschritte haelt der Rueckgaengig-Stapel vor. */
const UNDO_STACK_LIMIT = 20;
/**
 * Obergrenze der **gespeicherten** Historie je Karte. Ein Schnappschuss ist die vollstaendige
 * Geometrie, also praktisch so gross wie die Karte selbst — gemessen 60,8 KiB bei einer Karte
 * mit 320 Punkten, deren Datensatz 61,0 KiB misst. Zwanzig davon waeren 1,19 MiB, und weil
 * `saveActiveMap()` bei **jedem** aufgenommenen Punkt laeuft (in der Automatik alle 500 ms),
 * ginge die Schreiblast um den Faktor 21 hoch. Der Platz ist dabei nicht das Problem, die
 * Schreibarbeit ist es. Bei kleinen Karten (40 Punkte: 7,7 KiB je Schritt) greift das Budget
 * gar nicht, dort bleiben alle 20 Schritte erhalten.
 */
const UNDO_STACK_BYTE_BUDGET = 512 * 1024;
// Diagnoseprotokoll: gedeckelter Ringpuffer, damit es nicht unbegrenzt waechst (dieselbe
// Ueberlegung wie beim rxBuffer). Der Export nimmt hoechstens die letzten 100 Zeilen — der
// Puffer haelt bewusst mehr vor, damit auch nach dem Export noch Vorgeschichte da ist.
const LOG_ENTRY_LIMIT = 200;
const LOG_EXPORT_LIMIT = 100;
// Toleranz in Pixeln, ab der die Ansicht als „am unteren Ende“ gilt.
const LOG_BOTTOM_TOLERANCE_PX = 24;
const POSITION_SMOOTHING_WINDOW_MS = 2000;
const POSITION_SMOOTHING_MAX_SAMPLES = 10;
// Fenster des Streuungs-Hoechstwerts. Bewusst nur die **Hoechstwerte** ueber 30 s, nicht die
// Rohfixes: `state.fixHistory` ist auf POSITION_SMOOTHING_MAX_SAMPLES gedeckelt und traegt gar
// nicht so weit zurueck — und fuer die Frage „war es zwischendurch schlechter?“ genuegt die
// bereits gerechnete Zahl.
const SCATTER_MAX_WINDOW_MS = 30000;
const DRIVE_POINTER_MIN_INTERVAL_MS = 160;
/**
 * Im Ruhezustand (keine Fahreingabe) geht laufend ein `AT+M,0,0` raus, damit ein **einzelnes
 * verlorenes Stopp-Paket** sich im naechsten Takt von selbst heilt, ohne dass dafuer ein Fehler
 * erkannt werden muesste. 500 ms sind bewusst gewaehlt: gleiche Taktung wie das Polling (eine
 * Kadenz statt zweier); geht ein Stopp verloren, landet der naechste 500 ms spaeter. Schneller
 * waere reine Zusatzlast auf einem Link, der ohnehin mit 15-Byte-Paketen arbeitet.
 *
 * ACHTUNG: Dieser Takt ist NICHT die zweite Ebene ueber einer sicheren Firmware-Abschaltung,
 * sondern die einzige — und er wirkt nur bei stehendem Funklink. Siehe CLAUDE.md.
 */
const DRIVE_IDLE_STOP_INTERVAL_MS = BLE_POLL_INTERVAL_MS;
const DB_NAME = 'ardumower-bt-mapper';
const DB_VERSION = 1;
const MAP_STORE = 'maps';
const ACTIVE_MAP_KEY = 'ardumower-bt-mapper-active-map';
const VIEW_PREFS_KEY = 'mapcreator-ardumower-view-prefs-v1';
// Der CaSSAndRA-Bezugspunkt gehoert zur Installation, nicht zur Karte, und liegt deshalb
// neben den Ansichtseinstellungen statt im Kartenmodell. Eigenes Praefix, weil sich alle
// GitHub-Pages-Projekte einen Origin und damit einen localStorage teilen.
const CASSANDRA_REFERENCE_KEY = 'mapcreator-ardumower-cassandra-reference-v1';
/**
 * Obergrenze des lokalen Kartenbestands. **Die einzige Stelle, an der diese Zahl steht** —
 * Meldungen und Hilfetexte ziehen sie ueber den Platzhalter `{maxMaps}` heran, den `tr()`
 * ausnahmslos ersetzt. Nachgerechnet an einer echten Karte (320 Punkte mit vollem gps-Objekt,
 * ~63 KiB): 25 Karten belegen rund 1,5 MiB in IndexedDB.
 */
const MAX_MAPS = 25;


const I18N = {
  de: {
    joystickSize: 'Größe des Joysticks', joystickSmall: 'Klein', joystickMedium: 'Mittel', joystickLarge: 'Groß', joystickXLarge: 'Sehr groß',
    joystickSizeHint: '„Mittel“ passt sich der Bildschirmhöhe an. Größer heißt mehr Trefferfläche, kleiner mehr Karte. In kleinen Stufen können die Drehtasten schmaler werden als ein Daumen; dann steht hier ein Hinweis. Geändert wird dadurch nichts.',
    driveControl: 'Steuerung', driveControlJoystick: 'Joystick', driveControlButtons: 'Richtungstasten',
    driveModeToggle: 'Steuerung umschalten', driveModeToJoystick: 'Zu Joystick wechseln', driveModeToButtons: 'Zu Richtungstasten wechseln', cursorSpeed: 'Geschwindigkeit im Cursor-Modus',
    driveZones: 'Geschwindigkeitszonen',
    driveZonesNote: 'Mit Zonen sind vorwärts und rückwärts längs dreigeteilt: innen das Minimum, in der Mitte der eingetragene Wert, außen das Maximum des Joysticks. Die Zone folgt dem Finger, solange er gedrückt bleibt — weiter nach außen schieben heißt schneller. Ohne Zonen gilt für beide der eingetragene Wert. Links und rechts drehen unabhängig davon immer mit der Hälfte des Höchstwerts.',
    driveTurnSizeHint: 'Bei dieser Größe sind die Drehtasten schmaler als ein Daumen (44 px). Eine größere Stufe hilft.',
    driveZoneOrderHint: 'Die Zonen beim Vorwärts- und Rückwärtsfahren ergeben von innen nach außen {slow} · {normal} · {fast} cm/s — diese Staffel steigt nicht durchgehend an. Beim Schieben nach außen wird es dazwischen langsamer. Die Werte gelten wie eingetragen, geändert wird nichts von selbst.',
    driveControlHint: 'Die Richtungstasten fahren bewusst langsam und ohne seitliches Lenken — links und rechts drehen auf der Stelle. Der Joystick bleibt vom Cursor-Wert unberührt.',
    driveUp: 'Vorwärts fahren', driveDown: 'Rückwärts fahren', driveLeft: 'Links drehen', driveRight: 'Rechts drehen',
    handedness: 'Bedienseite', handedRight: 'Rechtshänder', handedLeft: 'Linkshänder',
    handednessHint: 'Spiegelt die gesamte Bedienung: Werkzeuge und Karteninfo in der Kartenleiste, Aufnahme-Knopf und Fahrtanzeige.',
    closeAndNewShort: 'Schließen & neu',
    closeAndNew: 'Fläche schließen & neue beginnen', closedAndStartedNew: 'Fläche geschlossen · neue Fläche begonnen.',
    unlockedBadge: 'Offen', mapLockedNote: '🔒 Karte gesperrt – keine Änderungen möglich',
    mapElements: 'Elemente der Karte', elementPoints: '{count} Punkte',
    deleteElement: '{label} löschen', deleteElementConfirm: '{label} mit {count} Punkten wirklich löschen?',
    updateAvailable: 'Neue Version verfügbar – zum Aktualisieren tippen',
    closeContourYes: 'Kontur automatisch schließen', closeContourNo: 'Kontur NOCH NICHT schließen',
    closeContoursYes: 'Konturen automatisch schließen',
    lockedBadge: 'Gesperrt',
    bleWriteFailedTitle: 'Senden fehlgeschlagen', bleWriteFailedShort: 'Senden fehlgeschlagen: {message}',
    insertNoNeighbour: 'Dort gibt es keine Strecke: die Kontur ist an dieser Seite offen.',
    insertBefore: 'Punkt davor einfügen', insertBeforeShort: 'Punkt davor',
    insertAfter: 'Punkt danach einfügen', insertAfterShort: 'Punkt danach',
    pointInserted: 'Punkt auf halber Strecke an Position {n} eingefügt.',
    extendPerimeter: 'Perimeter erweitern', extendPerimeterShort: 'Erweitern',
    extendExclusion: 'Ausschlussfläche erweitern', extendExclusionShort: 'Erweitern',
    extendCancel: 'Erweitern abbrechen', extendCancelShort: 'Abbrechen',
    extendDone: 'Erweiterung abschließen', extendDoneShort: 'Fertig',
    gpsScatter: 'Streuung {cm} cm (max 30 s: {maxCm} cm) · {n} Fixes',
    gpsAccuracy: 'Genauigkeit ±{cm} cm',
    gpsPanelToggle: 'GPS-Details ein- oder ausblenden',
    gpsScatterWaiting: 'Streuung – · {n} Fixes',
    extendStep: 'Schritt {step} von {total}:',
    extendPickFirst: 'Punkt wählen von dem aus neue Punkte hinzugefügt werden sollen',
    extendPickSecond: 'Punkt wählen wo das Ende der Konturöffnung sein soll, Punkte dazwischen werden automatisch gelöscht',
    extendConfirmEdge: 'Punkt {b} gewählt — es wird kein Punkt gelöscht. Zum Öffnen Punkt {b} erneut antippen oder anderen Punkt wählen.',
    extendConfirmCutOne: 'Punkt {b} gewählt — ein Punkt dazwischen wird gelöscht. Zum Öffnen Punkt {b} erneut antippen oder anderen Punkt wählen.',
    extendConfirmCut: 'Punkt {b} gewählt — {count} Punkte dazwischen werden gelöscht. Zum Öffnen Punkt {b} erneut antippen oder anderen Punkt wählen.',
    extendWrongContour: 'Bitte einen Punkt dieser Kontur antippen.',
    extendOpened: 'Kontur geöffnet, bitte neue Punkte aufnehmen und fertig klicken, Kontur wird dann mit Punkt aus Schritt 2 verbunden und Kontur geschlossen.',
    extendFinished: 'Erweiterung abgeschlossen, die Kontur ist wieder geschlossen.',
    extendCancelled: 'Erweitern abgebrochen — an der Kontur wurde nichts geändert.',
    undoAction: 'Letzten Bearbeitungsschritt rückgängig machen',
    undoDone: 'Schritt zurückgenommen.', undoDoneLast: 'Schritt zurückgenommen – Verlauf ist jetzt leer.',
    bleResyncDone: 'Abgebrochenes Kommando abgeschlossen (Zeilenende nachgesendet).',
    bleResyncFailed: 'Abgebrochenes Kommando konnte nicht abgeschlossen werden: {message}',
    bleWriteFailed: 'Der Befehl {context} konnte nicht an den Mäher gesendet werden.\n\n{message}',
    errorTitle: 'Fehler', okUnderstood: 'Verstanden',
    deleteExclusionTitle: 'Ausschlussfläche löschen', clearNow: 'Leeren',
    closeContourTitle: 'Kontur schließen',
    chooseMode: 'Aufnahmemodus wählen', cancel: 'Abbrechen',
    closeContourQuestion: 'Soll {label} geschlossen werden? Der letzte Punkt wird mit dem ersten verbunden.',
    closeOpenContours: 'Offene Konturen schließen', closeContoursConfirm: '{count} offene Kontur(en) jetzt schließen?',
    checkAreaOpen: '{label}: Kontur ist offen — letzter und erster Punkt sind nicht verbunden.',
    areaSelected: '{name} ausgewählt · gesamte Fläche', areaDeleted: 'Ausschlussfläche gelöscht.',
    deleteAreaConfirm: '„{name}“ mit allen Punkten löschen?',
    settings: 'Einstellungen', appearance: 'Darstellung', themeSystem: 'System', themeLight: 'Hell', themeDark: 'Dunkel',
    themeHint: '„System“ übernimmt die Einstellung des Geräts.',
    autoCaptureInterval: 'Intervall der automatischen Aufnahme', autoCaptureOn: 'Automatik läuft ({seconds}s)',
    autoCaptureWhereHint: 'Ein- und ausgeschaltet wird die Automatik über den Knopf auf der Karte.',
    autoCaptureWaiting: 'Automatik wartet auf eine brauchbare Position …',
    onlyRtkFixHint: 'Ohne echten RTK FIX bleibt die Aufnahme gesperrt.',
    deleteLastLabel: 'Letzten Punkt', deletePointLabel: 'Punktauswahl löschen', deleteAreaLabel: 'Fläche löschen',
    bleLinkStalled: 'Keine Daten mehr vom Mäher – Verbindung wird neu aufgebaut.',
    reconnectGaveUp: 'Verbindung fehlgeschlagen – bitte erneut verbinden.',
    bleProtocolError: 'Gestörte Daten vom Mäher – Verbindung wird neu aufgebaut.',
    bleNoAnswer: 'Der Mäher antwortet nicht mehr – Verbindung wird neu aufgebaut.',
    menu: 'Menü', backToMap: 'Zurück zur Karte', waypoints: 'Wegpunkte', waypoint: 'Wegpunkt',
    rtkFix: 'Fix', rtkFloat: 'Float', rtkNone: 'No Fix', rtkNoData: 'Kein GPS',
    movePoint: 'Verschieben', movePointAction: 'Punkt auf Mäherposition verschieben', movePointHint: 'Tippen: Punkt springt auf die Mäherposition', holdToCapture: 'Zum Aufnehmen gedrückt halten',
    deletePoint: 'Ausgewählten Punkt löschen', pointDeleted: 'Punkt {n} gelöscht.', fitView: 'Ansicht zurücksetzen',
    driveSettings: 'Fahrgeschwindigkeit', driveSpeedRange: 'Geschwindigkeit', driveSpeedRangeHint: 'Auslenkung des Joysticks regelt stufenlos zwischen Min und Max.',
    driveSpeedMin: 'Minimum', driveSpeedMax: 'Maximum', driveTurnMax: 'Maximale Drehrate',
    driveSafetyNote: 'Loslassen stoppt sofort. Sunray stoppt zusätzlich nach 1 s ohne neues Fahrkommando.',
    captureSettings: 'Aufnahme',
    helpWaypointTitle: 'Wegpunkte', helpWaypointText: 'Offene Punktfolge für Anfahrtswege innerhalb der Karte aufnehmen.',
    driveHelpTitle: 'Manuell fahren',
    driveHelp1: 'Der Joystick unten steuert wie bei einem RC-Fahrzeug: die Richtung der Auslenkung ist die Fahrtrichtung, die Stärke der Auslenkung die Geschwindigkeit. Loslassen sendet sofort Stop.',
    driveHelp2: 'Minimale und maximale Geschwindigkeit werden im Menü unter „Einstellungen › Fahrgeschwindigkeit“ festgelegt: das Minimum gilt ab der Totzone, das Maximum am vollen Ausschlag.',
    driveHelp3: 'Im Ruhezustand — Joystick losgelassen, keine Richtungstaste gehalten — schickt die App laufend alle 500 ms einen Stopp-Befehl. Geht einer davon verloren, ersetzt ihn der nächste von selbst. Wichtig bleibt trotzdem: Bei Bluetooth-Funkverlust kann die Webseite keinen neuen Stop-Befehl mehr übertragen. Deshalb nur bei Sichtkontakt arbeiten und den physischen Stop/Not-Aus am Mäher erreichbar halten.',
    driveHelp4: 'Diese App steuert bewusst kein Mähen: kein Start, kein Stop, kein Docking. Sie nimmt ausschließlich Karten auf.',
    appTitle: 'MapCreator für Ardumower',
    appDescription: 'MapCreator für Ardumower – mobile Kartenaufnahme über Web Bluetooth und Sunray.',
    languageToggleLabel: 'Auf Englisch umschalten', tabMaps: 'Karten', tabConnection: 'Verbindung', tabHelp: 'Hilfe', tabDebug: 'Diagnose',
    activeMap: 'AKTIVE KARTE', battery: 'Akku', perimeter: 'Perimeter', exclusion: 'Ausschluss', dock: 'Dock',
    exclusionArea: 'Ausschlussfläche', delete: 'Löschen',
    onlyRtkFix: 'Nur bei RTK FIX',
    viewScale: 'Ansicht & Maßstab', showGrid: 'Raster anzeigen', gridSpacing: 'Rasterweite', gridAuto: 'Automatisch',
    showMower: 'Mäher anzeigen', mowerLength: 'Länge', mowerWidth: 'Breite', mowerScaleNote: 'Der Mäher wird maßstäblich zur Karte dargestellt.', mowerTooltip: 'Mäher {length} × {width} m',
    noPointSelected: 'Kein Punkt ausgewählt',
    selectedPointInfo: '{label} · Punkt {n}', relearnPoint: 'Punkt neu anlernen', pointRelearned: 'Punkt {n} neu angelernt: X {x} · Y {y}',
    positionMode: 'Positionsmodus', positionModeRelative: 'Relativ (lokale Meter)', positionModeAbsolute: 'Absolut (GPS-Grad)',
    originLat: 'Breitengrad des Ursprungs', originLon: 'Längengrad des Ursprungs',
    positionModeHint: 'Gilt nur für diese Karte und nur für den GeoJSON-Export. „Relativ“ ist der Standard und lässt alles wie bisher. Für „Absolut“ trägst du einmalig die GPS-Position ein, die dem Nullpunkt der Karte entsprechen soll — welcher Punkt das ist, legst du selbst fest. In der Voreinstellung zählt Sunray in Metern relativ zur RTK-Basisstation; ein fester Nullpunkt existiert im Mäher nur, wenn dort über AT+P ein Bezugspunkt gesetzt wurde.',
    renameMap: 'Karte umbenennen', renameMapHint: 'Neuer Name für diese Karte. Der Inhalt bleibt unverändert.',
    duplicateMap: 'Karte duplizieren', copySuffix: '(Kopie)', copySuffixN: '(Kopie {n})',
    nameEmpty: 'Der Name darf nicht leer sein.', save: 'Speichern',
    activeMapField: 'Aktive Karte', newMapField: 'Neue Karte', newMapPlaceholder: 'z. B. Hintergarten', createMap: 'Neue Karte anlegen', mapLimitReached: 'Maximal {maxMaps} Karten können lokal gespeichert werden. Lösche zuerst eine Karte.',
    backupManagement: 'Backup & Verwaltung', backupDescription: 'Die Kartendaten liegen in IndexedDB des Browsers. Ein Export ist die einfachste Sicherung.',
    saveJson: 'Als JSON speichern', saveGeoJson: 'Als GeoJSON speichern',
    shareJson: 'Als JSON teilen', shareGeoJson: 'Als GeoJSON teilen', shareMapTitle: 'Karte teilen',
    saveCassandra: 'Für CaSSAndRA speichern', shareCassandra: 'Für CaSSAndRA teilen',
    saveSunray: 'Für Sunray-App speichern', shareSunray: 'Für Sunray-App teilen',
    sunrayHelp: 'Genau die Form, die die Sunray-App von grauonline schreibt: eine Liste von Karten mit lokalen X/Y-Koordinaten in Metern, je Punkt zusätzlich Ausrichtung, Aufnahmezeit und RTK-Güte. Für die Sunray-App selbst und für den Mäher. CaSSAndRA liest dieses Format ebenfalls. Ein Bezugspunkt wird nicht gebraucht, weil nichts umgerechnet wird. Solche Dateien lassen sich auch einlesen: Enthält die Datei mehrere Karten, wählst du eine aus. Die Wegpunkte der Datei werden dabei nicht übernommen — das ist ein von der Sunray-App berechneter Mähpfad aus oft tausenden Punkten, nicht die selbst gesetzten Wegpunkte dieser App; wie viele Punkte wegfallen, steht nach dem Import unter dem Import-Knopf. Ebenso wenig übernommen werden die Mäheinstellungen der Datei, denn diese App steuert kein Mähen.',
    exportCassandraAria: 'Karte für CaSSAndRA exportieren oder teilen',
    exportBackupAria: 'Karte sichern oder weitergeben',
    sunrayImportName: 'Sunray-Karte',
    sunrayChooseTitle: 'Welche Karte importieren?',
    sunrayChooseMessage: 'Diese Datei enthält {count} Karten. Es wird genau eine übernommen — die übrigen bleiben in der Datei und lassen sich später einzeln importieren.',
    sunrayChooseConfirm: 'Diese Karte importieren',
    sunrayMapSummary: '{points} Punkte, {areas} Flächen',
    sunrayMapLabelNamed: '{n}. {name} · {summary}',
    sunrayMapLabelPlain: '{n}. (ohne Namen) · {summary}',
    sunrayImportTitle: 'Sunray-Karte importiert',
    sunrayImportDone: 'Als Datei der Sunray-App erkannt. Koordinaten sind lokale Meter und wurden unverändert übernommen; Perimeter und Ausschlussflächen gelten als geschlossen.',
    sunrayImportDropped: '{count} Wegpunkte wurden nicht übernommen: das ist ein von der Sunray-App berechneter Mähpfad, nicht die selbst gesetzten Wegpunkte dieser App.',
    sunrayImportIgnoredFields: 'Nicht übernommen wurden außerdem die Mäheinstellungen der Datei (Musterwinkel, Bahnabstand, Ringmuster und die Mäh-/Randflaggen) — diese App steuert kein Mähen.',
    sunrayExportTitle: 'Sunray-App-Export',
    sunrayExportDone: 'Die Datei ist im Format der Sunray-App von grauonline geschrieben: lokale X/Y-Koordinaten in Metern, wie der Mäher sie selbst führt. Ein Bezugspunkt wird dafür nicht gebraucht.',
    cassandraHelp: 'Genau die Form, die CaSSAndRA selbst schreibt und einliest: Weltkoordinaten in Grad, Perimeter, Dockpfad, Suchdraht und Ausschlussflächen. Gerechnet wird gegen den Bezugspunkt bei den Export-Knöpfen — voreingestellt 0 / 0, wie in CaSSAndRA ab Werk. Nach jedem Export steht der verwendete Wert in einer Meldung; er muss in CaSSAndRA derselbe sein. Dateien aus CaSSAndRA lassen sich damit auch **einlesen**: die App erkennt sie an ihrer Form und rechnet die Grad mit demselben Bezugspunkt in lokale Meter zurück. Ist dort nichts eingetragen, wird die Datei nicht importiert — ohne den Wert wären die Grad nicht zu deuten, denn CaSSAndRA schreibt ihn nicht in die Datei.',
    cassandraRefLat: 'CaSSAndRA-Bezugspunkt: Breite', cassandraRefLon: 'CaSSAndRA-Bezugspunkt: Länge',
    cassandraRefHint: 'Trage hier genau denselben Wert ein, der in CaSSAndRA unter den Robotereinstellungen als Breite und Länge steht. Es ist keine Ortsbestimmung: der Wert muss nur auf beiden Seiten derselbe sein, sonst liegt die Karte nach dem Import versetzt. Voreingestellt ist 0 / 0 — das ist auch CaSSAndRAs Auslieferungswert, passt also, solange dort nichts eingetragen wurde. Er gilt für alle Karten dieser Installation.',
    cassandraBlocked: 'Der CaSSAndRA-Export ist gesperrt: {reason}',
    cassandraExportTitle: 'CaSSAndRA-Export',
    cassandraReferenceUsed: 'Verwendeter Bezugspunkt: Breite {lat}, Länge {lon} — derselbe Wert muss in CaSSAndRA unter den Robotereinstellungen stehen, sonst liegt die Karte dort versetzt.',
    cassandraSkippedMessage: '{count} Ausschlussfläche(n) gehen nicht mit in die CaSSAndRA-Datei: {names}. CaSSAndRA verlangt für eine Fläche mindestens 3 Punkte — eine kürzere lässt den Import dort vollständig abbrechen. Der Rest der Karte wird exportiert.',
    cassandraSkippedItem: '{label} ({count} Punkte)',
    cassandraSkippedAhead: 'Nicht mit dabei: {names}. CaSSAndRA verlangt je Fläche mindestens 3 Punkte — der Rest der Karte wird exportiert.',
    cassandraMissingHint: 'Es ist unten kein Bezugspunkt eingetragen.',
    cassandraImportNoReference: 'Diese Datei stammt aus CaSSAndRA und enthält Grad-Koordinaten, aber keinen Bezugspunkt — CaSSAndRA schreibt ihn nicht in die Datei. Trage unter „CaSSAndRA-Bezugspunkt“ Breite und Länge ein (denselben Wert wie in CaSSAndRA unter den Robotereinstellungen, im Auslieferungszustand 0 und 0) und importiere die Datei danach erneut.',
    cassandraImportNotice: 'Als CaSSAndRA-Datei erkannt und aus Grad in lokale Meter umgerechnet. Verwendeter Bezugspunkt: Breite {lat}, Länge {lon} — derselbe Wert, der in CaSSAndRA unter den Robotereinstellungen steht. Weicht er dort ab, liegt die Karte hier versetzt.',
    shareHelpNote: 'Karten von einem Gerät auf ein anderes bringen: Auf dem Quellgerät die Karte speichern oder teilen. „Teilen“ übergibt genau dieselbe Datei an das Freigabe-Menü des Geräts, sodass sie ohne Umweg über den Download-Ordner weitergereicht werden kann; welche Ziele dort angeboten werden, entscheidet das Gerät, nicht diese App. Auf dem Zielgerät die Datei über „JSON / GeoJSON importieren“ im Menü unter Karten einlesen. Kann ein Browser keine Dateien teilen, erscheint der Teilen-Knopf gar nicht erst — dann bleibt Speichern der Weg.',
    shareUnsupported: 'Dieser Browser kann keine Dateien teilen. Nutze stattdessen „Als JSON speichern“ bzw. „Als GeoJSON speichern“ und übertrage die Datei von Hand.',
    exportHint: 'Sunray-App: für die Sunray-App von grauonline und den Mäher selbst. CaSSAndRA: für den Import in CaSSAndRA, braucht den Bezugspunkt oben. JSON: vollständige Sicherung dieser App, mit allen Zusatzdaten. GeoJSON: für Fremdwerkzeuge, die Geometrien lesen. JSON und GeoJSON sind NICHT für den Import in CaSSAndRA gedacht — dafür ist das CaSSAndRA-Format da.',
    importJsonGeoJson: 'JSON / GeoJSON importieren', deleteCurrentMap: 'Aktuelle Karte löschen',
    bluetoothConnection: 'Bluetooth-Verbindung', sunrayPassword: 'Sunray-Passwort', passwordHint: 'Nur für diese Sitzung. Wird nicht mit der Karte gespeichert.',
    httpConflictHint: 'Beobachtung, keine gesicherte Ursache: Läuft parallel eine HTTP-Verbindung zum selben Gerät — etwa CaSSAndRA, die Weboberfläche oder ein anderer Dienst —, kann die Bluetooth-Verbindung stören oder abbrechen. Wenn es Probleme gibt, beende solche Dienste vor dem Verbinden. Belegt ist bisher nur, dass ein Mäher mit gleichzeitiger CaSSAndRA-Verbindung abbrach und ein anderer ohne nicht; das waren zwei verschiedene Geräte, kein kontrollierter Vergleich.',
    searchConnect: 'Gerät suchen & verbinden', disconnect: 'Verbindung trennen',
    clearLog: 'Log leeren', exportLog: 'Log exportieren', logEmpty: 'Das Protokoll ist noch leer – es gibt nichts zu exportieren.', logPaused: 'Neue Einträge – zum Ende springen', mapPreviewAria: 'Vorschau der aufgenommenen Mähkarte', exportMapAria: 'Karte exportieren oder teilen',
    notConnected: 'Nicht verbunden', bleConnected: 'BLE verbunden', demoActive: 'Demo aktiv',
    ready: 'Bereit.', readyConnect: 'Bereit. Tippe auf „Gerät suchen & verbinden“.', bluetoothDisconnected: 'Bluetooth-Verbindung getrennt.', age: 'Alter {value} s',
    noMapActive: 'Keine Karte aktiv', createMapFirst: 'Im Reiter „Karten“ zuerst eine Karte anlegen', pleaseCreateMap: 'Bitte zuerst eine Karte anlegen.',
    waitPosition: 'Warte auf Position', noCurrentXY: 'Noch keine aktuellen X/Y-Daten', noCurrentPosition: 'Keine aktuelle Position vom Ardumower.',
    capturePoint: 'Punkt aufnehmen', readyPoint: 'Bereit: X {x} m · Y {y} m · RTK FIX', noRtkFix: 'Kein RTK FIX',
    captureBlocked: '{solution} · Aufnahme gesperrt', pointBlocked: 'Punkt gesperrt: {solution}. RTK FIX erforderlich.',
    captureAnyway: 'Punkt trotzdem aufnehmen', noTrueFix: '{solution} · kein echter FIX', warningPoint: 'Warnung: {solution}. Punkt kann trotzdem gespeichert werden.',
    encryptionInvalid: 'Sunray verlangt Verschlüsselung, Passwort ist ungültig.', connectedEncrypted: 'Verbunden · {firmware} {version} · Verschlüsselung aktiv',
    connectedPlain: 'Verbunden · {firmware} {version} · unverschlüsselt', checksumVersion: 'Hinweis: V-Antwort mit unerwarteter Checksumme',
    checksumState: 'Hinweis: S-Antwort mit unerwarteter Checksumme', errorNoCharacteristic: 'Keine BLE-Characteristic verbunden.',
    errorNotConnected: 'Nicht verbunden.', errorPassword: 'Sunray-Passwort fehlt oder ist ungültig.', encrypted: '(verschlüsselt)',
    noVersionChecksumRetry: 'Kein V-Reply auf Checksummen-Variante; teste direktes UART-Format.',
    noVersionReply: 'BLE verbunden, aber keine Sunray-AT+V-Antwort. Diagnose öffnen.', noVersionLog: 'Keine Sunray-Version empfangen. Status wird unverschlüsselt getestet.',
    stateError: 'AT+S Fehler', noWebBluetooth: 'Web Bluetooth ist in diesem Browser nicht verfügbar.', openingPicker: 'Bluetooth-Geräteauswahl wird geöffnet …',
    connectingDevice: 'Verbinde mit {name} …', bleDevice: 'BLE-Gerät', connectedWith: 'Verbunden mit {name}', bleDisconnectedLog: 'BLE getrennt',
    demoStop: 'Demo-Modus beenden', demoStart: 'Demo-Modus starten', demoDetail: 'Demo-Modus: simulierte RTK-FIX-Position.', demoEnded: 'Demo beendet.',
    firstMapName: 'Meine erste Karte', saving: 'Speichert …', savedAt: 'Lokal gespeichert · {time}',
    exclusionN: 'Ausschluss {n}', mapN: 'Karte {n}', deleteMapConfirm: 'Karte „{name}“ wirklich lokal löschen?',
    dockPath: 'Dockpfad',
    deleteExclusionConfirm: '{name} wirklich löschen?', pointSaved: 'Punkt gespeichert: X {x} · Y {y}', dockPoints: 'Dockpunkte',
    contourClosed: 'geschlossen', contourOpen: 'offen',
    mapPoints: '{points} Punkte', noMap: 'Keine Karte', noMapLoaded: 'Keine Karte geladen.', invalidMapFile: 'Datei ist keine MapCreator-für-Ardumower-Karte.', unknown: 'unbekannt',
    missingOrigin: 'Die Datei enthält Grad-Koordinaten, aber keine Ursprungsposition. Ohne sie lassen sich die Werte nicht in lokale Meter zurückrechnen.',
    unsupportedGeometry: 'GeoJSON-Geometrie {type} wird nicht unterstützt.', invalidCoordinates: 'GeoJSON enthält ungültige X/Y-Koordinaten.',
    invalidGeoJson: 'Datei ist kein unterstütztes GeoJSON FeatureCollection.', noGeoFeatures: 'GeoJSON enthält keine erkennbaren Features (perimeter, exclusion, search wire oder dockpoints).',
    insecureContext: 'Diese Seite läuft nicht in einem sicheren Kontext. Für Web Bluetooth bitte über HTTPS (z. B. GitHub Pages) öffnen.',
    browserNoBluetooth: 'Dieser Browser stellt Web Bluetooth nicht bereit. Für den Prototyp Android + Chrome verwenden; der Demo-Modus funktioniert trotzdem.',
    connectionFailed: 'Verbindung fehlgeschlagen: {message}', bleError: 'BLE Fehler', importFailed: 'Import fehlgeschlagen: {message}',
    versionError: 'AT+V Fehler', startError: 'Startfehler: {message}', appStarted: 'App gestartet',
    autoCaptureMode: 'Automatik-Modus', autoCaptureModeTime: 'Zeitbasiert', autoCaptureModeDistance: 'Distanzbasiert',
    autoCaptureDistance: 'Abstand der automatischen Aufnahme',
    autoCaptureDistanceHint: 'Ein neuer Punkt entsteht, sobald der Mäher seit dem letzten Auto-Punkt so weit gefahren ist. Unter 10 cm läuft die Automatik ins GPS-Rauschen.',
    autoCaptureDist: 'Auto-Aufnahme ({distance}cm)', autoCaptureDistOn: 'Automatik läuft ({distance}cm)',
    autoCapture: 'Auto-Aufnahme ({seconds}s)', autoCaptureOff: 'Automatik aus', autoCaptureRunning: 'Läuft · {count} Punkte automatisch', autoPointSaved: 'Auto-Punkt {count}: X {x} · Y {y}',
    showTrail: 'Fahrspur anzeigen', clearTrail: 'Fahrspur löschen', trailCleared: 'Fahrspur gelöscht.', distanceToBoundary: 'Zur Grenze {distance} m', distanceToPoint: 'Zum Punkt {distance} m',
    mapCheck: 'Kartenprüfung', checkNow: 'Jetzt prüfen', notCheckedYet: 'Noch nicht geprüft.', mapCheckOk: 'Karte plausibel · Fläche {area} m² · Umfang {perimeter} m · RTK FIX {fix}/{points}', mapCheckIssues: '{errors} Fehler · {warnings} Hinweise · Fläche {area} m²',
    checkPerimeterTooFew: 'Perimeter hat weniger als 3 Punkte.', checkAreaTooFew: '{label} hat weniger als 3 Punkte.', checkSelfIntersection: '{label} überschneidet sich selbst.', checkExclusionOutside: '{label} liegt nicht vollständig innerhalb des Perimeters.', checkExclusionOverlap: '{a} und {b} überschneiden sich.',
    checkClosePoints: '{label}: {count} sehr kurze Punktabstände unter 5 cm.', checkLongSegments: '{label}: {count} Strecken sind länger als 5 m.', checkNonFixPoints: '{count} von {points} Punkten wurden nicht mit RTK FIX aufgenommen.', checkDockEmpty: 'Kein Dockpfad vorhanden (optional).',
    systemCheckTitle: 'Systemcheck auf diesem Gerät', systemCheckText: 'Hier siehst du sofort, ob die technischen Voraussetzungen für den Einsatz im Garten passen.',
    secureContextLabel: 'HTTPS / sicherer Kontext', webBluetoothLabel: 'Web Bluetooth', offlineCacheLabel: 'Offline-Cache', internetStatusLabel: 'Browser-Netzwerkstatus', compatibilityDate: 'Kompatibilitätsstand: August 2026.', networkStatusNote: 'Der Online/Offline-Wert ist ein Browser-Netzwerksignal und kein aktiver Test zu GitHub.',
    statusReady: 'Bereit', statusAvailable: 'Verfügbar', statusUnavailable: 'Nicht verfügbar', statusOnline: 'Online', statusOffline: 'Offline', statusSecure: 'Sicher', statusInsecure: 'Nicht sicher', statusPreparing: 'Wird vorbereitet …',
    quickStartTitle: 'Schnellstart im Garten',
    quick1: 'MapCreator einmal mit Internet in Chrome öffnen. Dadurch werden die App-Dateien für Offline-Betrieb gespeichert.',
    quick2: 'Optional über Chrome „Zum Startbildschirm hinzufügen“ / „App installieren“ wählen.',
    quick3: 'Bluetooth am Android-Gerät einschalten und im Reiter „Verbindung“ auf „Gerät suchen & verbinden“ tippen.',
    quick4: 'Im Bluetooth-Dialog den Ardumower auswählen. Die Auswahl muss aus Sicherheitsgründen vom Benutzer bestätigt werden.',
    quick5: 'Eine vorhandene Karte wählen oder unter „Karten“ eine neue Karte anlegen.',
    quick6: 'Auf RTK FIX warten. Bei aktivem „Nur bei RTK FIX“ wird der große Aufnahme-Button erst dann grün.',
    quick7: 'Perimeter, Ausschlussflächen oder Dockpfad aufnehmen. Auto-Aufnahme kann Punkte nach eingestellter Distanz setzen.',
    quick8: 'Nach der Aufnahme die Kartenprüfung ausführen und die Karte als JSON sichern; GeoJSON ist zusätzlich für Geometrie-Austausch verfügbar.',
    compatTitle: 'Android & Browser-Kompatibilität', compatAndroidChrome: 'Empfohlen. Technische Mindestbasis für Web Bluetooth ist Android 6.0; verwende möglichst eine aktuelle Chrome-Version.',
    compatSamsung: 'Web Bluetooth wird unterstützt. Für den MapCreator empfehlen wir trotzdem Chrome als primär getesteten Browser.',
    compatFirefox: 'Nicht geeignet für die Bluetooth-Verbindung: Firefox stellt die benötigte Web-Bluetooth-API nicht bereit. Die Offline-Seite allein kann funktionieren, BLE jedoch nicht.',
    compatIos: 'Nicht unterstützt. Safari und Chrome auf iOS/iPadOS stellen für Webseiten derzeit kein natives Web Bluetooth bereit. Dadurch kann der MapCreator den Ardumower dort nicht direkt per BLE verbinden.',
    compatDesktop: 'Mit unterstütztem Chromium-Browser kann Web Bluetooth ebenfalls funktionieren. Die Oberfläche ist jedoch primär für Android-Handys und -Tablets ausgelegt.',
    androidMinTitle: 'Android-Version:', androidMinText: 'Google dokumentiert Web Bluetooth für Chrome auf Android ab Android 6.0. Da alte Geräte und Browser-Versionen stark variieren, ist ein aktuelles Android mit aktuellem Chrome klar empfehlenswert.', androidPermissionTitle: 'Bluetooth-Berechtigungen:', androidPermissionText: 'Falls die Gerätesuche blockiert ist, prüfe die Android-App-Berechtigungen von Chrome. Ab Android 12 gibt es dafür die Berechtigungsgruppe „Geräte in der Nähe“.',
    offlineTitle: 'Offline im Garten', offlineWorksTitle: 'Das funktioniert ohne Internet', offlineNeedsTitle: 'Dafür wird Internet benötigt',
    offlineWorks1: 'Bluetooth-Verbindung zum Ardumower', offlineWorks2: 'Live-X/Y, RTK-Status und Kartenaufnahme', offlineWorks3: 'Automatik-Aufnahme, Punktbearbeitung und Kartenprüfung', offlineWorks4: 'Bis zu {maxMaps} Karten im Browserspeicher, inklusive Rückgängig-Verlauf der laufenden Sitzung', offlineWorks5: 'JSON- und GeoJSON-Export',
    pwaTitle: 'Als App installieren (PWA)',
    pwaWhat: 'MapCreator ist eine Progressive Web App: eine Webseite, die sich wie eine installierte App verhält. Auf dem Startbildschirm bekommt sie ein eigenes Symbol, startet im Vollbild ohne Adressleiste und lädt ihre Dateien aus dem lokalen Zwischenspeicher — deshalb läuft sie im Garten auch ohne Internet. Ein App-Store ist nicht beteiligt, es wird nichts zusätzlich heruntergeladen.',
    pwaAndroidTitle: 'Android / Chrome',
    pwaAndroid1: 'Die Seite einmal mit Internet öffnen und warten, bis der Systemcheck unten den Offline-Zwischenspeicher als bereit meldet.',
    pwaAndroid2: 'Im Browser oben rechts das Menü (⋮) öffnen.',
    pwaAndroid3: '„App installieren“ antippen — je nach Chrome-Fassung heißt der Eintrag „Zum Startbildschirm hinzufügen“. Manchmal blendet Chrome den Vorschlag auch von selbst unten ein.',
    pwaAndroid4: 'Danach startet MapCreator über das neue Symbol auf dem Startbildschirm.',
    pwaIosTitle: 'iPhone / iPad (Safari)',
    pwaIos1: 'Teilen-Symbol antippen, dann „Zum Home-Bildschirm“ wählen.',
    pwaIos2: 'Achtung: Unter iOS und iPadOS stellt kein Browser Web Bluetooth bereit. Die installierte App kann dort keine Verbindung zum Ardumower aufbauen — Karten ansehen, importieren und exportieren geht, aufnehmen nicht.',
    pwaNote: 'Deinstallieren geht wie bei jeder App über das Symbol. Die gespeicherten Karten liegen im Browser und bleiben davon unberührt, solange die Website-Daten nicht gelöscht werden.',
    offlineNeeds1: 'Der allererste Aufruf von GitHub Pages', offlineNeeds2: 'Ein neues App-Update herunterladen', offlineNeeds3: 'Neu laden, falls der Offline-Cache vorher gelöscht wurde',
    offlineWarning: 'Wichtig: Browserdaten/Website-Daten löschen kann sowohl Offline-Cache als auch lokal gespeicherte Karten entfernen. Regelmäßig JSON-Backups erstellen.',
    bluetoothHelpTitle: 'Bluetooth-Verbindung verstehen', bleHelp1: 'MapCreator nutzt Bluetooth Low Energy (BLE) und verbindet sich direkt mit dem Ardumower-ESP32 – nicht über das Internet.', bleHelp2: 'Der bekannte Ardumower-BLE-UART-Service verwendet FFE0/FFE1. Sunray-Kommandos werden über diese Verbindung übertragen.', bleHelp3: 'Die Gerätesuche darf ein Browser nur nach einer Benutzeraktion starten. Deshalb musst du den Verbindungsbutton antippen und den Ardumower auswählen.', bleHelp4: 'Das Sunray-Passwort wird nur für die laufende Sitzung verwendet und nicht mit der Karte gespeichert.', bleHelp5: 'Wenn die BLE-Verbindung durch Standby, Reichweite oder Browser-Neustart abbricht, einfach erneut „Gerät suchen & verbinden“ verwenden.',
    mappingHelpTitle: 'Karten erstellen & korrigieren',
    helpPerimeterTitle: 'Perimeter', helpPerimeterText: 'Äußere Mähgrenze Punkt für Punkt aufnehmen. Ab drei Punkten schließt ein Tipp auf den ersten Punkt die Kontur. Ist der Perimeter geschlossen, nimmt der Knopf keine Punkte mehr auf — zum Weiterbauen erst über „Erweitern“ öffnen. Je Karte gibt es nur einen Perimeter.',
    helpExclusionTitle: 'Ausschlussflächen', helpExclusionText: 'Geschlossene Bereiche innerhalb des Perimeters, die nicht gemäht werden. Eine neue Fläche entsteht von selbst, sobald du im Ausschluss-Modus den ersten Punkt setzt. Ist die aktuelle Fläche bereits geschlossen, beginnt der nächste Punkt ebenfalls eine neue — die geschlossene bleibt unangetastet, und Anzeige und Auswahl springen auf die neue. Die Zahl der Ausschlussflächen ist unbegrenzt.',
    helpDockTitle: 'Dockpfad', helpDockText: 'Offenen Punktpfad für den Dockbereich erfassen.',
    helpModeTitle: 'Modus wechseln', helpModeText: 'Der Chip in der Kopfzeile öffnet die Auswahl. Hat die verlassene Kontur mindestens drei Punkte und ist noch offen, fragt die App einmal, ob sie geschlossen werden soll.',
    helpCaptureTitle: 'Punkt aufnehmen', helpCaptureText: 'Den großen Knopf unten rechts kurz gedrückt halten. Das Halten verhindert, dass beim Wischen oder Zoomen versehentlich Punkte entstehen.',
    helpEditTitle: 'Punkte bearbeiten', helpEditText: 'Punkt auf der Karte antippen: der große Knopf wird zum Verschieben-Knopf und setzt den Punkt auf die aktuelle Position; das Lösch-Werkzeug in der Kartenleiste entfernt ihn.',
    helpInsertTitle: 'Punkt einfügen', helpInsertText: 'Bei ausgewähltem Punkt setzen „Punkt davor“ und „Punkt danach“ einen neuen Punkt genau auf die Mitte der Strecke zum Nachbarpunkt — rein geometrisch, der Mäher muss dafür nirgends hinfahren. Am offenen Ende einer Kontur ist die jeweilige Seite ausgegraut.',
    helpAreaSelectTitle: 'Fläche auswählen', helpAreaSelectText: 'Ein Tipp in eine fertige Ausschlussfläche wählt sie ganz aus, um sie zu löschen. Beim Perimeter gibt es das bewusst nicht — dort würde jeder Tipp das Verschieben der Karte abfangen.',
    helpDeleteToolTitle: 'Lösch-Werkzeug', helpDeleteToolText: 'Ein Werkzeug mit drei Aufgaben: ohne Auswahl entfernt es den zuletzt gesetzten Punkt, bei ausgewähltem Punkt genau diesen, bei ausgewählter Fläche die ganze Fläche (mit Rückfrage).',
    helpUndoTitle: 'Rückgängig', helpUndoText: 'Der runde Knopf in der unteren Kartenecke gegenüber dem Aufnahme-Knopf (bei Rechtshändern links, bei Linkshändern rechts) nimmt die letzten 20 Bearbeitungsschritte einzeln zurück — Aufnehmen, Verschieben, Löschen, Konturschluss. Der Verlauf gehört zur Karte und wird mit ihr gespeichert: du kannst die App schließen, die Karte später wieder öffnen und weiter zurückspringen. Jede Karte hat ihren eigenen Verlauf; bei sehr großen Karten passen weniger als 20 Schritte hinein, damit das Speichern flott bleibt. Beim Löschen einer Karte geht ihr Verlauf mit. Bei leerem Verlauf ist der Knopf ausgegraut.',
    helpCloseNewTitle: 'Schließen & neu', helpCloseNewText: 'Erscheint im Ausschluss-Modus ab drei Punkten: schließt die laufende Fläche und beginnt sofort die nächste. Gedacht für Reihen kleiner Flächen wie Bäume.',
    helpAutoTitle: 'Automatik-Aufnahme', helpAutoText: 'Setzt Punkte selbstständig — wahlweise im Zeittakt oder nach gefahrener Strecke. Die Beschriftung über dem Knopf zeigt den eingestellten Wert, umgestellt wird er im Menü unter Aufnahme.',
    helpValidationTitle: 'Kartenprüfung', helpValidationText: 'Sucht Selbstüberschneidungen, problematische Abstände, Ausschlüsse außerhalb des Perimeters, offene Konturen und fehlende RTK-FIX-Punkte.',
    helpElementsTitle: 'Elemente der Karte', helpElementsText: 'Im Menü unter Karten stehen Perimeter, alle Ausschlussflächen, Wegpunkte und Dockpfad mit Punktzahl. Ein Tipp macht ein Element zum Aufnahmeziel, der Papierkorb daneben leert es.',
    helpCleanupTitle: 'Leere Flächen', helpCleanupText: 'Ausschlussflächen ohne Punkt werden automatisch entfernt, sobald du den Modus verlässt oder das Menü öffnest. Die verbleibenden werden lückenlos neu durchnummeriert.',
    formatsTitle: 'Speichern, JSON & GeoJSON', jsonHelp: 'Empfohlenes vollständiges Backup für MapCreator. Enthält Kartenstruktur, Punkte und zusätzliche Metadaten wie Aufnahme-/Editierinformationen.', geoJsonHelp: 'Für Geometrie-Austausch. Perimeter und Ausschlussflächen werden als Polygone exportiert, Wegpunkte und Dockpfad als LineString.', geoJsonXYWarning: 'Die Ardumower-Koordinaten sind lokale Sunray-X/Y-Werte in Metern. Sie sind keine GPS-Längen-/Breitengrade und werden deshalb im Export ausdrücklich als lokales metrisches Koordinatensystem gekennzeichnet.',
    troubleshootingTitle: 'Fehlerbehebung', faqDeviceTitle: 'Ardumower wird nicht gefunden', faqDeviceText: 'Prüfe Bluetooth am Tablet, aktuelle Chrome-Version, Reichweite und ob der ESP32 BLE sendet. Falls eine andere App bereits verbunden ist, diese Verbindung zuerst trennen. Danach Bluetooth-Gerätesuche erneut öffnen.', faqButtonTitle: 'Aufnahme-Button wird nicht grün', faqButtonText: 'Grün bedeutet echten RTK FIX. Prüfe RTK-Empfang und die Live-Daten. Wenn „Nur bei RTK FIX“ aktiv ist, bleibt die Aufnahme bei FLOAT/INVALID gesperrt.', faqOfflineTitle: 'Die App startet ohne WLAN nicht', faqOfflineText: 'Öffne die GitHub-Pages-Seite mindestens einmal mit Internet und warte, bis der Offline-Cache im Systemcheck als bereit angezeigt wird. Danach am besten als PWA installieren.', faqMapsGoneTitle: 'Meine Karten sind verschwunden', faqMapsGoneText: 'Karten liegen lokal im Browser. Gelöschte Website-Daten, ein anderer Browser oder ein anderes Benutzerprofil haben einen eigenen Speicher. Importiere dein letztes JSON-Backup.', faqIosTitle: 'Warum funktioniert es auf iPhone/iPad nicht?', faqIosText: 'Der MapCreator benötigt Web Bluetooth. Safari und Chrome auf iOS/iPadOS bieten diese Web-API derzeit nicht nativ an; deshalb kann die Webseite den Ardumower dort nicht direkt auswählen und verbinden.',
    privacyTitle: 'Daten & Privatsphäre', privacy1: 'GitHub Pages liefert nur die statische App aus. Deine aufgezeichneten Karten werden nicht automatisch zu GitHub hochgeladen.', privacy2: 'Karten liegen lokal im Browser des verwendeten Geräts.', privacy3: 'Bluetooth-Kommunikation läuft direkt zwischen Browser und Ardumower-ESP32.', privacy4: 'Das Sunray-Passwort wird nicht in den Kartendaten gespeichert.', privacy5: 'Für wichtige Karten regelmäßig ein JSON-Backup auf einem zweiten Speicherort ablegen.',
    showPointQuality: 'Punktqualität anzeigen', keepAwake: 'Bildschirm beim Mapping wachhalten', wakeLockAuto: 'Wird bei aktiver Aufnahme automatisch verwendet.', wakeLockActive: 'Bildschirm bleibt wach.', wakeLockUnavailable: 'Wake Lock in diesem Browser nicht verfügbar.', wakeLockReleased: 'Wake Lock derzeit nicht aktiv.',
    perimeterNearStart: 'Startpunkt erreicht · Abstand {distance} m', closePerimeter: 'Perimeter schließen', perimeterClosed: 'Perimeter geschlossen · kein doppelter Startpunkt gespeichert.', perimeterAlreadyClosed: 'Perimeter ist bereits geschlossen.',
    perimeterClosedTitle: 'Perimeter geschlossen', perimeterClosedCapture: 'Perimeter ist geschlossen — zum Weiterbauen erst öffnen (Erweitern).', perimeterReopenHint: 'Zum Weiterbauen erst öffnen (Erweitern).',
    captureNewArea: 'Neue Fläche beginnen', captureNewAreaAnyway: 'Neue Fläche trotzdem beginnen', areaStartedNew: '{name} begonnen · erster Punkt gesetzt.', checkPerimeterOpen: 'Perimeter ist noch nicht als geschlossen markiert.',
    mapOverview: 'Kartenübersicht', lockCurrentMap: 'Karte sperren', unlockCurrentMap: 'Karte entsperren', mapLocked: 'Gesperrt', mapLockedHint: 'Diese Karte ist gesperrt. Zum Bearbeiten zuerst entsperren.', mapCardArea: '{area} m²', mapCardPoints: '{points} Punkte', mapCardChanged: 'Geändert {date}', selectMap: 'Karte auswählen', drive: 'Fahren', stopEverythingDone: 'STOP gesendet · Fahrt 0 · Mähmotor AUS · IDLE',
    manualDrive: 'Manuell fahren', driveSpeed: 'Tempo', reverse: 'Zurück', left: 'Links', stop: 'Stop', driveIdle: 'Fahrt gestoppt', driveNeedConnection: 'Für manuelle Fahrt zuerst per BLE verbinden.',
    helpQualityTitle: 'Punktqualität', helpQualityText: 'Der Rand eines Punktes zeigt, zu welchem Element er gehört, die Füllung die RTK-Qualität bei der Aufnahme.',
    helpExtendTitle: 'Kontur nachträglich erweitern', helpExtendText: 'Ist ein Perimeter oder eine Ausschlussfläche schon geschlossen, öffnet „Erweitern“ in der Kartenleiste sie wieder. Ein Hinweisstreifen über der Karte führt in drei Schritten: erst den Punkt wählen, von dem aus weitergebaut wird, dann den Punkt, an dem die Öffnung endet — die Kontur wird zwischen beiden geöffnet. Die beiden müssen keine Nachbarn sein — liegen Punkte dazwischen, werden sie gelöscht, und zwar auf der kürzeren der beiden Seiten. Der Hinweisstreifen nennt die Anzahl vorher; erst ein zweiter Tipp auf denselben Punkt führt es aus, ein Tipp auf einen anderen Punkt wählt stattdessen diesen. Der zuerst gewählte Punkt blinkt in eigener Farbe, damit er sich vom nur vorgemerkten zweiten unterscheidet. Danach nimmst du wie gewohnt weitere Punkte auf — auch mit Automatik —, sie landen genau zwischen den beiden gewählten. „Fertig“ im Hinweisstreifen schließt die Kontur wieder.',
    helpMapToolsTitle: 'Karten umbenennen & kopieren', helpMapToolsText: 'In der Kartenübersicht trägt jede Karte zwei kleine Werkzeuge: der Stift benennt sie um (nur der Name ändert sich), das Kopiersymbol legt eine vollständige, unabhängige Kopie an — mit allen Punkten, dem Positionsmodus und dem Ursprung. Die Kopie bekommt automatisch einen freien Namen, die gerade aktive Karte bleibt aktiv.',
    helpDriveZonesTitle: 'Geschwindigkeitszonen beim Vorwärts- und Rückwärtsfahren', helpDriveZonesText: 'Die vier Tasten sind als Sanduhr geschnitten: vorwärts und rückwärts sind breite Trapeze, links und rechts schmale Keile. Der Grund ist die Bedienung — bei vor und zurück schiebt der Daumen über die ganze Länge, links und rechts sind Korrekturen auf der Stelle. Vorwärts und rückwärts sind längs dreigeteilt: innen das Minimum, in der Mitte der eingetragene Tastenwert, außen das Maximum — dieselben drei Werte, die unter Einstellungen › Fahrgeschwindigkeit ohnehin stehen, es kommt keine neue Zahl dazu. Die Zone folgt dem Finger, solange er gedrückt bleibt: weiter nach außen schieben heißt schneller, zurück zur Mitte wieder langsamer. Die Grenzen sind auf der Taste eingezeichnet, die gerade gefahrene Zone ist hervorgehoben. Jede Zone trägt einen Chevron, der nach außen breiter, flacher und kräftiger wird. Sind die Zonen abgeschaltet, steht auf vorwärts und rückwärts nur noch der eine Chevron der mittleren Geschwindigkeit — die Taste zeigt nichts, was sie nicht tut. Loslassen stoppt wie zuvor sofort. Die Einteilung lässt sich abschalten — dann gilt für beide Richtungen der eingetragene Tastenwert. Links und rechts haben keine Zonen: das Drehen auf der Stelle läuft immer mit der Hälfte des eingestellten Höchstwerts, gedeckelt durch die eingestellte Höchst-Drehrate. Die drei Werte sind frei einstellbar und werden nicht sortiert: liegt der mittlere unter dem inneren, wird das Schieben nach außen zwischendurch langsamer. Die Werte gelten dann wie eingetragen, und ein Hinweis bei den Geschwindigkeitsfeldern nennt die Reihenfolge.',
    helpDriveControlTitle: 'Joystick oder Richtungstasten', helpDriveControlText: 'Der kleine Knopf neben dem Fahrfeld schaltet zwischen beidem um; er zeigt das Symbol des Modus, in den er wechselt. Bei Rechtshändern steht er links vom Feld, bei Linkshändern gespiegelt rechts – jeweils direkt über der Fahrtanzeige. Der Joystick fährt wie eine Fernsteuerung: Richtung und Stärke der Auslenkung. Die Richtungstasten kennen nur vorwärts, rückwärts und Drehen auf der Stelle — kein versehentliches Lenken beim Geradeausfahren. Sie fahren mit einer eigenen, langsamen Geschwindigkeit für genaues Rangieren, einstellbar unter Einstellungen › Fahrgeschwindigkeit.',
    helpPositionModeTitle: 'Positionsmodus', helpPositionModeText: 'Jede Karte rechnet standardmäßig in lokalen Metern („Relativ“) — dafür ist keine Eingabe nötig. In der Voreinstellung zählt Sunray diese Meter relativ zur RTK-Basisstation, nicht zu einem Punkt im Garten. „Absolut“ brauchst du nur, wenn du die Karte mit Programmen austauschen willst, die echte Weltkoordinaten erwarten: dort trägst du im Menü unter Karten einmalig die GPS-Position ein, die dem Nullpunkt entsprechen soll. Welcher Punkt das ist, legst du selbst fest — der Mäher hat von sich aus keinen. Nur wenn im Mäher über AT+P ein Bezugspunkt gesetzt wurde, rechnet er selbst gegen diesen; dann ist es genau dieser Wert. Der Ursprung gehört zur jeweiligen Karte, weil verschiedene Karten meist an verschiedenen Orten liegen. Fehlt ein gültiger Ursprung, bleibt der Export bei lokalen Metern — falsch machen kannst du dabei nichts.',
    helpLockTitle: 'Kartensperre', helpLockText: 'Fertige Karten lassen sich gegen versehentliche Änderungen sperren.',
    viewHelpTitle: 'Ansicht & Bedienung',
    helpRtkTitle: 'RTK-Anzeige', helpRtkText: 'Das Abzeichen in der Kopfzeile zeigt Fix, Float oder No Fix und die Satelliten als Mäher/Station. Nur bei einem echten Fix ist die Position zentimetergenau.',
    helpScatterTitle: 'GPS-Details einblenden', helpScatterText: 'Ein Tipp auf das RTK-Feld in der Kopfzeile blendet oben auf der Karte die GPS-Details ein und wieder aus; die Wahl bleibt nach dem Neuladen erhalten. Dort steht der Fix-Status, die vom Mäher gemeldete Genauigkeit und die Streuung: wie weit die Messwerte der letzten zwei Sekunden auseinanderliegen — der größte Abstand zu ihrem Mittelwert in Zentimetern, dahinter der höchste Wert der letzten 30 Sekunden und die Zahl der Messwerte im Fenster. Kleine Zahlen heißen ruhige Position, ein großer 30-Sekunden-Wert verrät einen Ausreißer, der längst vorbei ist. Weniger Messwerte als sonst deuten auf eine Funklücke. Alles davon ist reine Information: es sperrt nichts und ändert weder Aufnahme noch Automatik.',
    helpFixOnlyTitle: 'Nur bei RTK FIX', helpFixOnlyText: 'Im Menü unter Aufnahme. Ist die Option aktiv, bleibt jede Aufnahme bei Float oder No Fix gesperrt — auch die Automatik.',
    helpThemeTitle: 'Hell & Dunkel', helpThemeText: 'Drei Stufen im Menü unter Ansicht & Maßstab: Hell, Dunkel oder der Vorgabe des Systems folgen.',
    helpHandedTitle: 'Bedienseite', helpHandedText: 'Die Umstellung auf Linkshänder spiegelt die gesamte Bedienung: Werkzeuge und Karteninfo in der Kartenleiste, Aufnahme-Knopf und Fahrtanzeige.',
    helpJoystickSizeTitle: 'Joystick-Größe', helpJoystickSizeText: 'Vier Stufen von Klein bis Sehr groß. Größer heißt mehr Trefferfläche für den Daumen, kleiner mehr Platz für die Karte.',
    helpMapInfoTitle: 'Karteninfo in der Werkzeugleiste', helpMapInfoText: 'Die Werkzeugleiste oben trägt zwei Zeilen: den Kartennamen und darunter, kleiner, die Punktzahl und die betroffene Kontur samt Zustand. Die aktuelle Position steht unten auf der Karte, zwischen Rückgängig- und Aufnahme-Knopf. Die Kartenfläche selbst bleibt damit frei von Text. Der Zustand steht immer unmittelbar hinter der Bezeichnung der Kontur, auf die er sich bezieht: „Perimeter · geschlossen“ oder „Ausschluss 2 · offen“, und bei ausgewähltem Punkt an dessen Bezeichnung, also „Ausschluss 1 · Punkt 3 · offen“. So ist auch bei mehreren Ausschlussflächen eindeutig, welche gemeint ist. „Offen“ heißt, dass zwischen letztem und erstem Punkt noch keine Verbindung besteht, „geschlossen“ heißt, dass die Fläche fertig umrundet ist. Wegpunkte und Dockpfad sind immer offene Pfade und zeigen deshalb keinen Zustand.',
    helpZoomTitle: 'Zoomen & Verschieben', helpZoomText: 'Zwei Finger zoomen, ein Finger verschiebt. Sobald du die Ansicht selbst verändert hast, erscheint in der oberen Kartenecke ein Symbol, das sie wieder auf die ganze Karte zurücksetzt.',
    helpDiagnosticsTitle: 'Diagnose', helpDiagnosticsText: 'Das Protokoll im Menü unter Diagnose zeigt gesendete Kommandos, Antworten und Fehler der Funkverbindung — hilfreich, wenn die Verbindung abreißt. Es läuft automatisch mit, solange die Ansicht ganz unten steht; scrollen Sie nach oben, hält es an und ein Hinweis führt zurück ans Ende. „Log exportieren“ legt die letzten 100 Zeilen als Textdatei ab, deren Name Datum und Uhrzeit trägt.',
    solutionInvalid: 'UNGÜLTIG', solutionUnknown: 'UNBEKANNT', importName: 'Import', geoJsonImport: 'GeoJSON Import', importSuffix: '(Import)'
  },
  en: {
    joystickSize: 'Joystick size', joystickSmall: 'Small', joystickMedium: 'Medium', joystickLarge: 'Large', joystickXLarge: 'Extra large',
    joystickSizeHint: '“Medium” adapts to the screen height. Larger means a bigger target, smaller leaves more map. At small sizes the turn keys can get narrower than a thumb; a note appears here when they do. Nothing is changed for you.',
    driveControl: 'Control', driveControlJoystick: 'Joystick', driveControlButtons: 'Direction keys',
    driveModeToggle: 'Switch control', driveModeToJoystick: 'Switch to joystick', driveModeToButtons: 'Switch to direction keys', cursorSpeed: 'Speed in cursor mode',
    driveZones: 'Speed zones',
    driveZonesNote: 'With zones, forward and reverse are split lengthwise into three: the minimum on the inside, the value entered above in the middle, the joystick maximum on the outside. The zone follows your finger while it stays down — sliding further out means faster. Without zones the value entered above applies to both. Left and right always turn at half the maximum speed, regardless of this setting.',
    driveTurnSizeHint: 'At this size the turn keys are narrower than a thumb (44 px). A larger size helps.',
    driveZoneOrderHint: 'From the inside out the forward and reverse zones are {slow} · {normal} · {fast} cm/s — that ladder does not rise all the way. Sliding outwards gets slower in between. The values apply exactly as entered, nothing is changed automatically.',
    driveControlHint: 'The direction keys deliberately drive slowly and without any sideways steering — left and right turn on the spot. The joystick is unaffected by the cursor speed.',
    driveUp: 'Drive forward', driveDown: 'Drive backward', driveLeft: 'Turn left', driveRight: 'Turn right',
    handedness: 'Operating side', handedRight: 'Right-handed', handedLeft: 'Left-handed',
    handednessHint: 'Mirrors the whole layout: tools and map info in the map bar, capture button and drive status.',
    closeAndNewShort: 'Close & new',
    closeAndNew: 'Close area & start a new one', closedAndStartedNew: 'Area closed · new area started.',
    unlockedBadge: 'Open', mapLockedNote: '🔒 Map locked – no changes possible',
    mapElements: 'Map elements', elementPoints: '{count} points',
    deleteElement: 'Delete {label}', deleteElementConfirm: 'Really delete {label} with {count} points?',
    updateAvailable: 'New version available – tap to update',
    closeContourYes: 'Close contour automatically', closeContourNo: 'Do NOT close the contour yet',
    closeContoursYes: 'Close contours automatically',
    lockedBadge: 'Locked',
    bleWriteFailedTitle: 'Sending failed', bleWriteFailedShort: 'Sending failed: {message}',
    insertNoNeighbour: 'No segment there: the contour is open on this side.',
    insertBefore: 'Insert a point before this one', insertBeforeShort: 'Point before',
    insertAfter: 'Insert a point after this one', insertAfterShort: 'Point after',
    pointInserted: 'Point inserted halfway along, at position {n}.',
    extendPerimeter: 'Extend perimeter', extendPerimeterShort: 'Extend',
    extendExclusion: 'Extend exclusion area', extendExclusionShort: 'Extend',
    extendCancel: 'Cancel extending', extendCancelShort: 'Cancel',
    extendDone: 'Finish extending', extendDoneShort: 'Done',
    gpsScatter: 'Scatter {cm} cm (30 s max: {maxCm} cm) · {n} fixes',
    gpsAccuracy: 'Accuracy ±{cm} cm',
    gpsPanelToggle: 'Show or hide GPS details',
    gpsScatterWaiting: 'Scatter – · {n} fixes',
    extendStep: 'Step {step} of {total}:',
    extendPickFirst: 'Choose the point from which new points are to be added',
    extendPickSecond: 'Choose the point where the contour opening should end, points in between are deleted automatically',
    extendConfirmEdge: 'Point {b} chosen — no point is deleted. Tap point {b} again to open, or choose a different point.',
    extendConfirmCutOne: 'Point {b} chosen — one point in between is deleted. Tap point {b} again to open, or choose a different point.',
    extendConfirmCut: 'Point {b} chosen — {count} points in between are deleted. Tap point {b} again to open, or choose a different point.',
    extendWrongContour: 'Please tap a point of this contour.',
    extendOpened: 'Contour opened, please capture new points and click Done, the contour is then joined to the point from step 2 and closed.',
    extendFinished: 'Extension finished, the contour is closed again.',
    extendCancelled: 'Extending cancelled — nothing on the contour was changed.',
    undoAction: 'Undo the last editing step',
    undoDone: 'Step undone.', undoDoneLast: 'Step undone – history is now empty.',
    bleResyncDone: 'Terminated the aborted command (sent a line break).',
    bleResyncFailed: 'Could not terminate the aborted command: {message}',
    bleWriteFailed: 'The command {context} could not be sent to the mower.\n\n{message}',
    errorTitle: 'Error', okUnderstood: 'Got it',
    deleteExclusionTitle: 'Delete exclusion area', clearNow: 'Clear',
    closeContourTitle: 'Close contour',
    chooseMode: 'Choose capture mode', cancel: 'Cancel',
    closeContourQuestion: 'Close {label}? The last point will be connected to the first one.',
    closeOpenContours: 'Close open contours', closeContoursConfirm: 'Close {count} open contour(s) now?',
    checkAreaOpen: '{label}: contour is open — last and first point are not connected.',
    areaSelected: '{name} selected · whole area', areaDeleted: 'Exclusion area deleted.',
    deleteAreaConfirm: 'Delete “{name}” with all its points?',
    settings: 'Settings', appearance: 'Appearance', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
    themeHint: '“System” follows the device setting.',
    autoCaptureInterval: 'Automatic capture interval', autoCaptureOn: 'Automatic running ({seconds}s)',
    autoCaptureWhereHint: 'The automatic capture is switched on and off with the button on the map.',
    autoCaptureWaiting: 'Automatic capture is waiting for a usable position …',
    onlyRtkFixHint: 'Without a true RTK FIX capturing stays blocked.',
    deleteLastLabel: 'Last point', deletePointLabel: 'Delete selected point', deleteAreaLabel: 'Delete area',
    bleLinkStalled: 'No more data from the mower – reconnecting.',
    reconnectGaveUp: 'Connection failed – please reconnect.',
    bleProtocolError: 'Corrupted data from the mower – reconnecting.',
    bleNoAnswer: 'The mower stopped answering – reconnecting.',
    menu: 'Menu', backToMap: 'Back to map', waypoints: 'Waypoints', waypoint: 'Waypoint',
    rtkFix: 'Fix', rtkFloat: 'Float', rtkNone: 'No Fix', rtkNoData: 'No GPS',
    movePoint: 'Move', movePointAction: 'Move point to the mower position', movePointHint: 'Tap: the point jumps to the mower position', holdToCapture: 'Hold to capture',
    deletePoint: 'Delete selected point', pointDeleted: 'Point {n} deleted.', fitView: 'Reset view',
    driveSettings: 'Drive speed', driveSpeedRange: 'Speed', driveSpeedRangeHint: 'Joystick deflection scales steplessly between min and max.',
    driveSpeedMin: 'Minimum', driveSpeedMax: 'Maximum', driveTurnMax: 'Maximum turn rate',
    driveSafetyNote: 'Releasing stops immediately. Sunray also stops after 1 s without a new drive command.',
    captureSettings: 'Capture',
    helpWaypointTitle: 'Waypoints', helpWaypointText: 'Capture an open sequence of points for approach paths inside the map.',
    driveHelpTitle: 'Manual driving',
    driveHelp1: 'The joystick at the bottom works like an RC car: the direction of deflection is the direction of travel, the amount of deflection is the speed. Releasing sends stop immediately.',
    driveHelp2: 'Minimum and maximum speed are set in the menu under “Settings › Drive speed”: the minimum applies from the dead zone on, the maximum at full deflection.',
    driveHelp3: 'While idle — joystick released, no direction key held — the app keeps sending a stop command every 500 ms. If one of them is lost, the next one replaces it by itself. It still matters that: if the Bluetooth link is lost, the website cannot transmit a new stop command. Use only with line of sight and keep the mower’s physical stop/emergency control accessible.',
    driveHelp4: 'This app deliberately does not control mowing: no start, no stop, no docking. It only captures maps.',
    appTitle: 'MapCreator für Ardumower',
    appDescription: 'MapCreator für Ardumower – mobile map recording via Web Bluetooth and Sunray.',
    languageToggleLabel: 'Switch to German', tabMaps: 'Maps', tabConnection: 'Connection', tabHelp: 'Help', tabDebug: 'Diagnostics',
    activeMap: 'ACTIVE MAP', battery: 'Battery', perimeter: 'Perimeter', exclusion: 'Exclusion', dock: 'Dock',
    exclusionArea: 'Exclusion area', delete: 'Delete',
    onlyRtkFix: 'RTK FIX only',
    viewScale: 'View & scale', showGrid: 'Show grid', gridSpacing: 'Grid spacing', gridAuto: 'Automatic',
    showMower: 'Show mower', mowerLength: 'Length', mowerWidth: 'Width', mowerScaleNote: 'The mower is drawn to scale on the map.', mowerTooltip: 'Mower {length} × {width} m',
    noPointSelected: 'No point selected',
    selectedPointInfo: '{label} · point {n}', relearnPoint: 'Relearn point', pointRelearned: 'Point {n} relearned: X {x} · Y {y}',
    positionMode: 'Position mode', positionModeRelative: 'Relative (local metres)', positionModeAbsolute: 'Absolute (GPS degrees)',
    originLat: 'Latitude of the origin', originLon: 'Longitude of the origin',
    positionModeHint: 'Applies to this map only and only to the GeoJSON export. “Relative” is the default and leaves everything as it was. For “Absolute” you enter, once, the GPS position that the map’s zero point should correspond to — which point that is, is your choice. By default Sunray counts metres relative to the RTK base station; a fixed zero point only exists inside the mower if a reference point was set there via AT+P.',
    renameMap: 'Rename map', renameMapHint: 'New name for this map. Its contents stay unchanged.',
    duplicateMap: 'Duplicate map', copySuffix: '(copy)', copySuffixN: '(copy {n})',
    nameEmpty: 'The name must not be empty.', save: 'Save',
    activeMapField: 'Active map', newMapField: 'New map', newMapPlaceholder: 'e.g. Back garden', createMap: 'Create new map', mapLimitReached: 'A maximum of {maxMaps} maps can be stored locally. Delete a map first.',
    backupManagement: 'Backup & management', backupDescription: 'Map data is stored in the browser’s IndexedDB. Exporting is the easiest way to create a backup.',
    saveJson: 'Save as JSON', saveGeoJson: 'Save as GeoJSON',
    shareJson: 'Share as JSON', shareGeoJson: 'Share as GeoJSON', shareMapTitle: 'Share map',
    saveCassandra: 'Save for CaSSAndRA', shareCassandra: 'Share for CaSSAndRA',
    saveSunray: 'Save for Sunray app', shareSunray: 'Share for Sunray app',
    sunrayHelp: 'Exactly the shape grauonline’s Sunray app writes: a list of maps with local X/Y coordinates in metres, each point carrying heading, capture time and RTK quality. For the Sunray app itself and for the mower. CaSSAndRA reads this format too. No reference point is needed, because nothing is converted. Such files can also be imported: if the file holds several maps, you pick one. The file’s waypoints are not taken over — that is a mowing path computed by the Sunray app, often thousands of points, not the waypoints you set yourself in this app; how many points are dropped is shown under the import button afterwards. The file’s mowing settings are left out as well, because this app does not control mowing.',
    exportCassandraAria: 'Export or share the map for CaSSAndRA',
    exportBackupAria: 'Back up or pass on the map',
    sunrayImportName: 'Sunray map',
    sunrayChooseTitle: 'Which map do you want to import?',
    sunrayChooseMessage: 'This file contains {count} maps. Exactly one is taken over — the others stay in the file and can be imported individually later.',
    sunrayChooseConfirm: 'Import this map',
    sunrayMapSummary: '{points} points, {areas} areas',
    sunrayMapLabelNamed: '{n}. {name} · {summary}',
    sunrayMapLabelPlain: '{n}. (no name) · {summary}',
    sunrayImportTitle: 'Sunray map imported',
    sunrayImportDone: 'Recognised as a file from the Sunray app. Coordinates are local metres and were taken over unchanged; perimeter and exclusion areas count as closed.',
    sunrayImportDropped: '{count} waypoints were not taken over: that is a mowing path computed by the Sunray app, not the waypoints you set yourself in this app.',
    sunrayImportIgnoredFields: 'Also left out were the file’s mowing settings (pattern angle, line offset, ring pattern and the mow/border flags) — this app does not control mowing.',
    sunrayExportTitle: 'Sunray app export',
    sunrayExportDone: 'The file is written in the format of grauonline’s Sunray app: local X/Y coordinates in metres, exactly as the mower keeps them. No reference point is needed for this.',
    cassandraHelp: 'Exactly the shape CaSSAndRA writes and reads itself: world coordinates in degrees, perimeter, dock path, search wire and exclusion areas. It is computed against the reference point next to the export buttons — preset to 0 / 0, as CaSSAndRA ships it. After every export a notice states the value that was used; it has to match the one in CaSSAndRA. Files from CaSSAndRA can also be **imported**: the app recognises them by their shape and converts the degrees back into local metres using the same reference point. If none is entered, the file is not imported — without that value the degrees cannot be interpreted, because CaSSAndRA does not write it into the file.',
    cassandraRefLat: 'CaSSAndRA reference point: latitude', cassandraRefLon: 'CaSSAndRA reference point: longitude',
    cassandraRefHint: 'Enter exactly the same value that CaSSAndRA shows under its robot settings as latitude and longitude. This is not a location fix: the value only has to be identical on both sides, otherwise the map ends up offset after the import. It is preset to 0 / 0 — which is also CaSSAndRA’s factory value, so it fits as long as nothing was entered there. It applies to every map of this installation.',
    cassandraBlocked: 'The CaSSAndRA export is locked: {reason}',
    cassandraExportTitle: 'CaSSAndRA export',
    cassandraReferenceUsed: 'Reference point used: latitude {lat}, longitude {lon} — the same value must be set in CaSSAndRA under its robot settings, otherwise the map ends up offset there.',
    cassandraSkippedMessage: '{count} exclusion area(s) are not part of the CaSSAndRA file: {names}. CaSSAndRA requires at least 3 points per area — a shorter one makes its import fail entirely. The rest of the map is exported.',
    cassandraSkippedItem: '{label} ({count} points)',
    cassandraSkippedAhead: 'Not included: {names}. CaSSAndRA requires at least 3 points per area — the rest of the map is exported.',
    cassandraMissingHint: 'No reference point has been entered below.',
    cassandraImportNoReference: 'This file comes from CaSSAndRA and holds degree coordinates, but no reference point — CaSSAndRA does not write one into the file. Enter latitude and longitude under “CaSSAndRA reference point” (the same value as in CaSSAndRA under its robot settings, 0 and 0 as shipped) and import the file again.',
    cassandraImportNotice: 'Recognised as a CaSSAndRA file and converted from degrees to local metres. Reference point used: latitude {lat}, longitude {lon} — the same value that is set in CaSSAndRA under its robot settings. If it differs there, the map ends up offset here.',
    shareHelpNote: 'Moving a map from one device to another: on the source device, save or share the map. “Share” hands exactly the same file to the device’s share menu, so it can be passed on without the detour via the download folder; which targets appear there is decided by the device, not by this app. On the target device, read the file back in via “Import JSON / GeoJSON” in the menu under Maps. If a browser cannot share files, the share button does not appear at all — saving remains the way there.',
    shareUnsupported: 'This browser cannot share files. Use “Save as JSON” or “Save as GeoJSON” instead and transfer the file manually.',
    exportHint: 'Sunray app: for grauonline’s Sunray app and the mower itself. CaSSAndRA: for importing into CaSSAndRA, needs the reference point above. JSON: a complete backup of this app, including all extra data. GeoJSON: for third-party tools that read geometries. JSON and GeoJSON are NOT meant for importing into CaSSAndRA — the CaSSAndRA format is there for that.',
    importJsonGeoJson: 'Import JSON / GeoJSON', deleteCurrentMap: 'Delete current map',
    bluetoothConnection: 'Bluetooth connection', sunrayPassword: 'Sunray password', passwordHint: 'For this session only. It is not stored with the map.',
    httpConflictHint: 'An observation, not an established cause: if an HTTP connection to the same device is running at the same time — CaSSAndRA, the web interface or another service —, it may disturb or drop the Bluetooth connection. If you run into trouble, stop such services before connecting. All that has been observed so far is that one mower with a concurrent CaSSAndRA connection dropped out and another one without did not; those were two different devices, not a controlled comparison.',
    searchConnect: 'Find device & connect', disconnect: 'Disconnect',
    clearLog: 'Clear log', exportLog: 'Export log', logEmpty: 'The log is still empty – there is nothing to export.', logPaused: 'New entries – jump to end', mapPreviewAria: 'Preview of the recorded mowing map', exportMapAria: 'Export or share map',
    notConnected: 'Not connected', bleConnected: 'BLE connected', demoActive: 'Demo active',
    ready: 'Ready.', readyConnect: 'Ready. Tap “Find device & connect”.', bluetoothDisconnected: 'Bluetooth connection disconnected.', age: 'Age {value} s',
    noMapActive: 'No active map', createMapFirst: 'Create a map in the “Maps” tab first', pleaseCreateMap: 'Please create a map first.',
    waitPosition: 'Waiting for position', noCurrentXY: 'No current X/Y data yet', noCurrentPosition: 'No current position from the Ardumower.',
    capturePoint: 'Capture point', readyPoint: 'Ready: X {x} m · Y {y} m · RTK FIX', noRtkFix: 'No RTK FIX',
    captureBlocked: '{solution} · capture blocked', pointBlocked: 'Point blocked: {solution}. RTK FIX required.',
    captureAnyway: 'Capture point anyway', noTrueFix: '{solution} · no true FIX', warningPoint: 'Warning: {solution}. The point can still be saved.',
    encryptionInvalid: 'Sunray requires encryption, but the password is invalid.', connectedEncrypted: 'Connected · {firmware} {version} · encryption active',
    connectedPlain: 'Connected · {firmware} {version} · unencrypted', checksumVersion: 'Note: V response has an unexpected checksum',
    checksumState: 'Note: S response has an unexpected checksum', errorNoCharacteristic: 'No BLE characteristic connected.',
    errorNotConnected: 'Not connected.', errorPassword: 'Sunray password is missing or invalid.', encrypted: '(encrypted)',
    noVersionChecksumRetry: 'No V reply to checksum variant; trying direct UART format.',
    noVersionReply: 'BLE connected, but no Sunray AT+V response. Open Diagnostics.', noVersionLog: 'No Sunray version received. Status will be tested unencrypted.',
    stateError: 'AT+S error', noWebBluetooth: 'Web Bluetooth is not available in this browser.', openingPicker: 'Opening Bluetooth device picker …',
    connectingDevice: 'Connecting to {name} …', bleDevice: 'BLE device', connectedWith: 'Connected to {name}', bleDisconnectedLog: 'BLE disconnected',
    demoStop: 'Stop demo mode', demoStart: 'Start demo mode', demoDetail: 'Demo mode: simulated RTK FIX position.', demoEnded: 'Demo ended.',
    firstMapName: 'My first map', saving: 'Saving …', savedAt: 'Saved locally · {time}',
    exclusionN: 'Exclusion {n}', mapN: 'Map {n}', deleteMapConfirm: 'Really delete map “{name}” locally?',
    dockPath: 'Dock path',
    deleteExclusionConfirm: 'Really delete {name}?', pointSaved: 'Point saved: X {x} · Y {y}', dockPoints: 'Dock points',
    contourClosed: 'closed', contourOpen: 'open',
    mapPoints: '{points} points', noMap: 'No map', noMapLoaded: 'No map loaded.', invalidMapFile: 'File is not a MapCreator für Ardumower map.', unknown: 'unknown',
    missingOrigin: 'The file contains degree coordinates but no origin position. Without it the values cannot be converted back to local metres.',
    unsupportedGeometry: 'GeoJSON geometry {type} is not supported.', invalidCoordinates: 'GeoJSON contains invalid X/Y coordinates.',
    invalidGeoJson: 'File is not a supported GeoJSON FeatureCollection.', noGeoFeatures: 'GeoJSON contains no recognisable features (perimeter, exclusion, search wire or dockpoints).',
    insecureContext: 'This page is not running in a secure context. Open it via HTTPS (for example GitHub Pages) to use Web Bluetooth.',
    browserNoBluetooth: 'This browser does not provide Web Bluetooth. Use Android + Chrome for the prototype; demo mode still works.',
    connectionFailed: 'Connection failed: {message}', bleError: 'BLE error', importFailed: 'Import failed: {message}',
    versionError: 'AT+V error', startError: 'Startup error: {message}', appStarted: 'App started',
    autoCaptureMode: 'Automatic mode', autoCaptureModeTime: 'Time-based', autoCaptureModeDistance: 'Distance-based',
    autoCaptureDistance: 'Distance between automatic points',
    autoCaptureDistanceHint: 'A new point is captured once the mower has travelled this far since the last automatic point. Below 10 cm the automation just follows GPS noise.',
    autoCaptureDist: 'Auto capture ({distance}cm)', autoCaptureDistOn: 'Automatic running ({distance}cm)',
    autoCapture: 'Auto capture ({seconds}s)', autoCaptureOff: 'Automatic off', autoCaptureRunning: 'Running · {count} points captured automatically', autoPointSaved: 'Auto point {count}: X {x} · Y {y}',
    showTrail: 'Show movement trail', clearTrail: 'Clear movement trail', trailCleared: 'Movement trail cleared.', distanceToBoundary: 'To boundary {distance} m', distanceToPoint: 'To point {distance} m',
    mapCheck: 'Map check', checkNow: 'Check now', notCheckedYet: 'Not checked yet.', mapCheckOk: 'Map looks plausible · area {area} m² · perimeter {perimeter} m · RTK FIX {fix}/{points}', mapCheckIssues: '{errors} errors · {warnings} notes · area {area} m²',
    checkPerimeterTooFew: 'Perimeter has fewer than 3 points.', checkAreaTooFew: '{label} has fewer than 3 points.', checkSelfIntersection: '{label} intersects itself.', checkExclusionOutside: '{label} is not fully inside the perimeter.', checkExclusionOverlap: '{a} and {b} overlap.',
    checkClosePoints: '{label}: {count} very short point gaps below 5 cm.', checkLongSegments: '{label}: {count} segments are longer than 5 m.', checkNonFixPoints: '{count} of {points} points were not captured with RTK FIX.', checkDockEmpty: 'No dock path present (optional).',
    systemCheckTitle: 'System check on this device', systemCheckText: 'See immediately whether the technical requirements for garden use are met.',
    secureContextLabel: 'HTTPS / secure context', webBluetoothLabel: 'Web Bluetooth', offlineCacheLabel: 'Offline cache', internetStatusLabel: 'Browser network status', compatibilityDate: 'Compatibility status: August 2026.', networkStatusNote: 'The online/offline value is a browser network signal, not an active test against GitHub.',
    statusReady: 'Ready', statusAvailable: 'Available', statusUnavailable: 'Unavailable', statusOnline: 'Online', statusOffline: 'Offline', statusSecure: 'Secure', statusInsecure: 'Not secure', statusPreparing: 'Preparing …',
    quickStartTitle: 'Quick start in the garden',
    quick1: 'Open MapCreator once in Chrome while online. This stores the app files for offline use.',
    quick2: 'Optionally use Chrome’s “Add to Home screen” / “Install app” command.',
    quick3: 'Enable Bluetooth on the Android device and tap “Find device & connect” in the Connection tab.',
    quick4: 'Select the Ardumower in the Bluetooth dialog. For security, the browser requires the user to confirm the device selection.',
    quick5: 'Select an existing map or create a new one under “Maps”.',
    quick6: 'Wait for RTK FIX. With “RTK FIX only” enabled, the large capture button turns green only when a real fix is available.',
    quick7: 'Record perimeter, exclusion areas or the dock path. Auto capture can add points at the configured distance.',
    quick8: 'Run the map check after recording and save the map as JSON; GeoJSON is also available for geometry exchange.',
    compatTitle: 'Android & browser compatibility', compatAndroidChrome: 'Recommended. The technical minimum platform documented for Web Bluetooth is Android 6.0; use a current Chrome version whenever possible.',
    compatSamsung: 'Web Bluetooth is supported. We still recommend Chrome as the primary browser for MapCreator.',
    compatFirefox: 'Not suitable for the Bluetooth connection: Firefox does not expose the required Web Bluetooth API. The offline page itself may work, but BLE does not.',
    compatIos: 'Not supported. Safari and Chrome on iOS/iPadOS currently do not expose native Web Bluetooth to websites, so MapCreator cannot connect directly to the Ardumower via BLE there.',
    compatDesktop: 'Web Bluetooth can also work in a supported Chromium browser. The interface is primarily designed for Android phones and tablets.',
    androidMinTitle: 'Android version:', androidMinText: 'Google documents Web Bluetooth for Chrome on Android starting with Android 6.0. Because old devices and browser versions vary widely, a current Android device with current Chrome is strongly recommended.', androidPermissionTitle: 'Bluetooth permissions:', androidPermissionText: 'If device discovery is blocked, check Chrome’s Android app permissions. Starting with Android 12, nearby Bluetooth access is grouped under the “Nearby devices” permission.',
    offlineTitle: 'Offline in the garden', offlineWorksTitle: 'Works without internet', offlineNeedsTitle: 'Internet is needed for',
    offlineWorks1: 'Bluetooth connection to the Ardumower', offlineWorks2: 'Live X/Y, RTK status and map recording', offlineWorks3: 'Automatic capture, point editing and map checks', offlineWorks4: 'Up to {maxMaps} maps in browser storage, including the undo history of the current session', offlineWorks5: 'JSON and GeoJSON export',
    pwaTitle: 'Installing it as an app (PWA)',
    pwaWhat: 'MapCreator is a Progressive Web App: a web page that behaves like an installed app. It gets its own icon on the home screen, starts full screen without an address bar, and loads its files from the local cache — which is why it works in the garden without internet. No app store is involved and nothing extra is downloaded.',
    pwaAndroidTitle: 'Android / Chrome',
    pwaAndroid1: 'Open the page once with internet and wait until the system check below reports the offline cache as ready.',
    pwaAndroid2: 'Open the browser menu (⋮) at the top right.',
    pwaAndroid3: 'Tap “Install app” — depending on the Chrome version the entry is called “Add to Home screen”. Chrome sometimes offers it by itself at the bottom of the screen.',
    pwaAndroid4: 'MapCreator then starts from the new icon on your home screen.',
    pwaIosTitle: 'iPhone / iPad (Safari)',
    pwaIos1: 'Tap the share icon, then choose “Add to Home Screen”.',
    pwaIos2: 'Note: on iOS and iPadOS no browser provides Web Bluetooth. The installed app cannot connect to the Ardumower there — viewing, importing and exporting maps works, recording does not.',
    pwaNote: 'Uninstalling works like any other app, via the icon. The stored maps live in the browser and are not affected, as long as the site data is not cleared.',
    offlineNeeds1: 'The very first GitHub Pages load', offlineNeeds2: 'Downloading a new app update', offlineNeeds3: 'Reloading after the offline cache has been cleared',
    offlineWarning: 'Important: clearing browser/site data can remove both the offline cache and locally stored maps. Create JSON backups regularly.',
    bluetoothHelpTitle: 'Understanding the Bluetooth connection', bleHelp1: 'MapCreator uses Bluetooth Low Energy (BLE) and connects directly to the Ardumower ESP32 – not through the internet.', bleHelp2: 'The known Ardumower BLE UART service uses FFE0/FFE1. Sunray commands are transported through this connection.', bleHelp3: 'A browser may start device discovery only after a user action. You therefore have to tap the connect button and select the Ardumower.', bleHelp4: 'The Sunray password is used only for the current session and is not stored with the map.', bleHelp5: 'If BLE disconnects because of standby, range or a browser restart, simply use “Find device & connect” again.',
    mappingHelpTitle: 'Creating & correcting maps',
    helpPerimeterTitle: 'Perimeter', helpPerimeterText: 'Record the outer mowing boundary point by point. From three points on, tapping the first point closes the contour. Once the perimeter is closed the button no longer captures points — reopen it via “Extend” to keep building. There is only one perimeter per map.',
    helpExclusionTitle: 'Exclusion areas', helpExclusionText: 'Closed areas inside the perimeter that must not be mowed. A new area is created automatically as soon as you place the first point in exclusion mode. If the current area is already closed, the next point starts another new one — the closed area is left untouched, and the display and selection jump to the new one. The number of exclusion areas is unlimited.',
    helpDockTitle: 'Dock path', helpDockText: 'Record an open point path for the docking area.',
    helpModeTitle: 'Switching mode', helpModeText: 'The chip in the header opens the selection. If the contour you leave has at least three points and is still open, the app asks once whether to close it.',
    helpCaptureTitle: 'Capturing a point', helpCaptureText: 'Press and hold the large button at the bottom right for a moment. Holding prevents points from appearing accidentally while panning or zooming.',
    helpEditTitle: 'Edit points', helpEditText: 'Tap a point on the map: the large button turns into the move button and places the point at the current position; the delete tool in the map bar removes it.',
    helpInsertTitle: 'Inserting a point', helpInsertText: 'With a point selected, “Point before” and “Point after” place a new point exactly halfway to the neighbouring point — purely geometric, the mower does not have to drive anywhere. At the open end of a contour that side is greyed out.',
    helpAreaSelectTitle: 'Selecting an area', helpAreaSelectText: 'Tapping inside a finished exclusion area selects the whole area so you can delete it. This deliberately does not apply to the perimeter — there every tap would swallow panning the map.',
    helpDeleteToolTitle: 'Delete tool', helpDeleteToolText: 'One tool with three jobs: with nothing selected it removes the last point placed, with a point selected exactly that point, with an area selected the whole area (after a confirmation).',
    helpUndoTitle: 'Undo', helpUndoText: 'The round button in the bottom corner of the map opposite the capture button (left for right-handed use, right for left-handed) takes back the last 20 editing steps one at a time — capturing, moving, deleting, closing a contour. The history belongs to the map and is stored with it: you can close the app, reopen the map later and keep stepping back. Every map has its own history; on very large maps fewer than 20 steps fit so that saving stays quick. Deleting a map deletes its history with it. The button is greyed out when the history is empty.',
    helpCloseNewTitle: 'Close & new', helpCloseNewText: 'Appears in exclusion mode from three points on: closes the current area and immediately starts the next one. Made for rows of small areas such as trees.',
    helpAutoTitle: 'Automatic capture', helpAutoText: 'Places points on its own — either on a time interval or by distance travelled. The label above the button shows the configured value; you switch modes in the menu under Capture.',
    helpValidationTitle: 'Map check', helpValidationText: 'Finds self-intersections, problematic spacing, exclusions outside the perimeter, open contours and points captured without RTK FIX.',
    helpElementsTitle: 'Map elements', helpElementsText: 'The menu under Maps lists the perimeter, every exclusion area, the waypoints and the dock path with their point counts. Tapping one makes it the capture target, the bin next to it empties it.',
    helpCleanupTitle: 'Empty areas', helpCleanupText: 'Exclusion areas without any point are removed automatically when you leave the mode or open the menu. The remaining ones are renumbered without gaps.',
    formatsTitle: 'Saving, JSON & GeoJSON', jsonHelp: 'Recommended complete MapCreator backup. Contains the map structure, points and extra metadata such as capture/edit information.', geoJsonHelp: 'For geometry exchange. Perimeter and exclusion areas are exported as polygons, waypoints and the dock path as LineStrings.', geoJsonXYWarning: 'Ardumower coordinates are local Sunray X/Y values in metres. They are not GPS longitude/latitude values, so the export explicitly marks them as a local metric coordinate system.',
    troubleshootingTitle: 'Troubleshooting', faqDeviceTitle: 'Ardumower is not found', faqDeviceText: 'Check Bluetooth on the tablet, a current Chrome version, range and whether the ESP32 is advertising BLE. If another app is already connected, disconnect it first. Then open Bluetooth device discovery again.', faqButtonTitle: 'Capture button does not turn green', faqButtonText: 'Green means a real RTK FIX. Check RTK reception and the live data. With “RTK FIX only” enabled, capture remains blocked for FLOAT/INVALID.', faqOfflineTitle: 'The app does not start without Wi-Fi', faqOfflineText: 'Open the GitHub Pages site at least once with internet and wait until the system check shows the offline cache as ready. Installing it as a PWA is recommended.', faqMapsGoneTitle: 'My maps are gone', faqMapsGoneText: 'Maps are stored locally in the browser. Cleared site data, a different browser or a different browser profile use separate storage. Import your latest JSON backup.', faqIosTitle: 'Why does it not work on iPhone/iPad?', faqIosText: 'MapCreator requires Web Bluetooth. Safari and Chrome on iOS/iPadOS currently do not provide this Web API natively, so the website cannot directly select and connect to the Ardumower there.',
    privacyTitle: 'Data & privacy', privacy1: 'GitHub Pages only serves the static app. Your recorded maps are not automatically uploaded to GitHub.', privacy2: 'Maps stay in the browser storage of the device being used.', privacy3: 'Bluetooth communication runs directly between the browser and the Ardumower ESP32.', privacy4: 'The Sunray password is not stored in map data.', privacy5: 'For important maps, regularly keep a JSON backup in a second location.',
    showPointQuality: 'Show point quality', keepAwake: 'Keep screen awake while mapping', wakeLockAuto: 'Used automatically while an active recording is running.', wakeLockActive: 'Screen will stay awake.', wakeLockUnavailable: 'Wake Lock is not available in this browser.', wakeLockReleased: 'Wake Lock is currently inactive.',
    perimeterNearStart: 'Start point reached · distance {distance} m', closePerimeter: 'Close perimeter', perimeterClosed: 'Perimeter closed · no duplicate start point stored.', perimeterAlreadyClosed: 'Perimeter is already closed.',
    perimeterClosedTitle: 'Perimeter closed', perimeterClosedCapture: 'The perimeter is closed — reopen it first to keep building (Extend).', perimeterReopenHint: 'Reopen it first to keep building (Extend).',
    captureNewArea: 'Start new area', captureNewAreaAnyway: 'Start new area anyway', areaStartedNew: '{name} started · first point set.', checkPerimeterOpen: 'Perimeter is not marked as closed yet.',
    mapOverview: 'Map overview', lockCurrentMap: 'Lock map', unlockCurrentMap: 'Unlock map', mapLocked: 'Locked', mapLockedHint: 'This map is locked. Unlock it before editing.', mapCardArea: '{area} m²', mapCardPoints: '{points} points', mapCardChanged: 'Changed {date}', selectMap: 'Select map', drive: 'Drive', stopEverythingDone: 'STOP sent · drive 0 · mowing motor OFF · IDLE',
    manualDrive: 'Manual drive', driveSpeed: 'Speed', reverse: 'Reverse', left: 'Left', stop: 'Stop', driveIdle: 'Drive stopped', driveNeedConnection: 'Connect via BLE before using manual drive.',
    helpQualityTitle: 'Point quality', helpQualityText: 'The outline of a point shows which element it belongs to, the fill shows the RTK quality at the time it was captured.',
    helpExtendTitle: 'Extending a closed contour', helpExtendText: 'If a perimeter or exclusion area is already closed, “Extend” in the map bar reopens it. A hint strip above the map guides you through three steps: first choose the point building continues from, then the point where the opening ends — the contour opens between them. They need not be neighbours — any points in between are deleted, on the shorter of the two sides. The hint strip states the number beforehand; only a second tap on the same point carries it out, while a tap on a different point picks that one instead. The point you chose first blinks in its own colour so it stands apart from the merely pending second one. Then capture further points as usual — automatic capture included — and they land exactly between the two you picked. “Done” in the hint strip closes the contour again.',
    helpMapToolsTitle: 'Renaming & copying maps', helpMapToolsText: 'In the map overview every map carries two small tools: the pencil renames it (only the name changes), the copy icon creates a complete, independent copy — with all points, the position mode and the origin. The copy automatically gets a free name, and the map you are working on stays active.',
    helpDriveZonesTitle: 'Speed zones for driving forward and back', helpDriveZonesText: 'The four keys are cut as an hourglass: forward and reverse are wide trapezoids, left and right narrow wedges. The reason is how they are used — for forward and back your thumb slides along the whole length, while left and right are corrections on the spot. Forward and reverse are split lengthwise into three: the minimum on the inside, the key speed you entered in the middle, the maximum on the outside — the same three values already under Settings › Drive speed, no new number is added. The zone follows your finger while it stays down: sliding further out means faster, back towards the centre slower again. The boundaries are drawn on the key and the zone currently in use is highlighted. Each zone carries a chevron that grows wider, flatter and stronger towards the outside. With the zones switched off, forward and reverse show only the single chevron of the middle speed — the key shows nothing it does not do. Releasing stops immediately, as before. The split can be switched off — the key speed then applies to both directions. Left and right have no zones: turning on the spot always runs at half the maximum speed you set, capped by the maximum turn rate. The three values are yours to set and are never sorted: if the middle one is below the inner one, sliding outwards gets slower in between. The values then apply exactly as entered, and a note next to the speed fields spells out the order.',
    helpDriveControlTitle: 'Joystick or direction keys', helpDriveControlText: 'The small button beside the drive field switches between the two; it shows the icon of the mode it switches to. For right-handed use it sits to the left of the field, for left-handed use mirrored to the right, directly above the drive status. The joystick drives like a remote control: direction and amount of deflection. The direction keys only know forward, backward and turning on the spot — no accidental steering while driving straight. They use their own slow speed for precise manoeuvring, adjustable under Settings › Drive speed.',
    helpPositionModeTitle: 'Position mode', helpPositionModeText: 'Every map works in local metres by default (“Relative”) — no input needed. By default Sunray counts those metres relative to the RTK base station, not to a point in the garden. You only need “Absolute” if you want to exchange the map with programs that expect real world coordinates: there you enter, once, in the menu under Maps, the GPS position the zero point should correspond to. Which point that is, is your choice — the mower has none of its own. Only if a reference point was set in the mower via AT+P does it compute against that one; then it is exactly that value. The origin belongs to the individual map, because different maps usually sit in different places. Without a valid origin the export stays in local metres — you cannot get this wrong.',
    helpLockTitle: 'Map lock', helpLockText: 'Finished maps can be locked against accidental changes.',
    viewHelpTitle: 'View & operation',
    helpRtkTitle: 'RTK display', helpRtkText: 'The badge in the header shows Fix, Float or No Fix and the satellites as mower/station. Only a real fix gives centimetre-accurate positions.',
    helpScatterTitle: 'Showing GPS details', helpScatterText: 'Tapping the RTK field in the header shows and hides the GPS details at the top of the map; the choice survives a reload. It shows the fix status, the accuracy reported by the mower and the scatter: how far the readings of the last two seconds lie apart — the largest distance from their mean in centimetres, followed by the highest value of the last 30 seconds and the number of readings in the window. Small numbers mean a steady position; a large 30-second value reveals an outlier that is long gone. Fewer readings than usual point to a radio gap. All of it is information only: it blocks nothing and changes neither capture nor automatic capture.',
    helpFixOnlyTitle: 'Only with RTK FIX', helpFixOnlyText: 'In the menu under Capture. While this option is on, every capture stays blocked on Float or No Fix — automatic capture included.',
    helpThemeTitle: 'Light & dark', helpThemeText: 'Three settings in the menu under View & scale: light, dark, or follow the system setting.',
    helpHandedTitle: 'Operating side', helpHandedText: 'Switching to left-handed mirrors the whole layout: tools and map info in the map bar, capture button and drive status.',
    helpJoystickSizeTitle: 'Joystick size', helpJoystickSizeText: 'Four steps from small to very large. Larger means a bigger target for your thumb, smaller means more room for the map.',
    helpMapInfoTitle: 'Map info in the tool bar', helpMapInfoText: 'The tool bar at the top carries two lines: the map name and, smaller beneath it, the point count and the contour concerned together with its state. The current position sits at the bottom of the map, between the undo and capture buttons. The map area itself stays free of text. The state always sits directly behind the name of the contour it refers to: “Perimeter · closed” or “Exclusion 2 · open”, and with a point selected behind that point, as in “Exclusion 1 · point 3 · open”. That keeps it unambiguous even with several exclusion areas. “Open” means there is still no link between the last and the first point, “closed” means the area is fully enclosed. Waypoints and the dock path are always open paths and therefore show no state.',
    helpZoomTitle: 'Zoom & pan', helpZoomText: 'Two fingers zoom, one finger pans. As soon as you change the view yourself, an icon appears in the top corner of the map that resets it to the whole map.',
    helpDiagnosticsTitle: 'Diagnostics', helpDiagnosticsText: 'The log in the menu under Diagnostics shows sent commands, replies and radio errors — useful when the connection drops. It follows along automatically while the view sits at the bottom; scroll up and it pauses, with a hint to jump back to the end. “Export log” saves the last 100 lines as a text file whose name carries the date and time.',
    solutionInvalid: 'INVALID', solutionUnknown: 'UNKNOWN', importName: 'Import', geoJsonImport: 'GeoJSON Import', importSuffix: '(Import)'
  }
};

function tr(key, vars = {}) {
  const dict = I18N[state?.language || 'de'] || I18N.de;
  let text = dict[key] ?? I18N.de[key] ?? key;
  // Die Kartengrenze steht nur in MAX_MAPS. Sie hier unbedingt einzusetzen ist der Grund, warum
  // auch Texte ohne eigene Variablen — die per `data-i18n` gesetzten Hilfezeilen — die Zahl
  // richtig zeigen, ohne dass jemand sie ein zweites Mal von Hand hinschreibt.
  text = text.replaceAll('{maxMaps}', String(MAX_MAPS));
  Object.entries(vars).forEach(([name, value]) => {
    text = text.replaceAll(`{${name}}`, String(value));
  });
  return text;
}

function localeCode() {
  return state?.language === 'en' ? 'en-GB' : 'de-DE';
}

function solutionNameLocalized(solution) {
  if (solution === 2) return 'RTK FIX';
  if (solution === 1) return 'RTK FLOAT';
  if (solution === 0) return tr('solutionInvalid');
  return tr('solutionUnknown');
}

// Einzige Stelle, an der die App auf die Web-Bluetooth-Implementierung zugreift.
// Im Browser ist das immer navigator.bluetooth; Tests haengen ueber
// globalThis.__bleAdapter eine Fake-Implementierung ein (tests/fake-ble.js).
function bleAdapter() {
  if (globalThis.__bleAdapter) return globalThis.__bleAdapter;
  return (typeof navigator === 'undefined' ? null : navigator.bluetooth) || null;
}

// Fehlt ein Element — etwa weil der Browser eine aeltere index.html aus dem Cache zeigt,
// waehrend app.js schon neu ist — darf das nicht die ganze App lahmlegen: frueher warf der
// erste Zugriff in bindEvents(), init() brach ab, und weil die Datenbank danach geoeffnet
// wurde, waren plotzlich "alle Karten weg". Stattdessen ein stiller Platzhalter, der beim
// Start gemeldet wird.
const missingUiElements = [];

function missingElementStub(id) {
  const noop = () => {};
  const stub = {
    id, textContent: '', innerHTML: '', value: '', checked: false, disabled: true, hidden: true,
    open: false, scrollTop: 0, scrollHeight: 0, dataset: {}, children: [], files: null, parentElement: null,
    style: { setProperty: noop, removeProperty: noop },
    classList: { add: noop, remove: noop, toggle: () => false, contains: () => false },
    addEventListener: noop, removeEventListener: noop, setAttribute: noop, removeAttribute: noop,
    getAttribute: () => null, appendChild: noop, append: noop, remove: noop, focus: noop, blur: noop,
    setPointerCapture: noop, releasePointerCapture: noop, closest: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  };
  return stub;
}

const $ = (id) => {
  const element = document.getElementById(id);
  if (element) return element;
  missingUiElements.push(id);
  return missingElementStub(id);
};
const ui = {
  // Kopfzeile
  menuBtn: $('menuBtn'), bleStatusBtn: $('bleStatusBtn'), modeCycleBtn: $('modeCycleBtn'), modeChipLabel: $('modeChipLabel'),
  modeDialog: $('modeDialog'), modeDialogCancel: $('modeDialogCancel'), closeContoursBtn: $('closeContoursBtn'),
  confirmDialog: $('confirmDialog'), confirmDialogTitle: $('confirmDialogTitle'), confirmDialogText: $('confirmDialogText'),
  confirmDialogActions: $('confirmDialogActions'), confirmDialogCancel: $('confirmDialogCancel'), confirmDialogAccept: $('confirmDialogAccept'),
  confirmDialogInput: $('confirmDialogInput'),
  confirmDialogSelect: $('confirmDialogSelect'),
  rtkBadge: $('rtkBadge'), rtkText: $('rtkText'), rtkSats: $('rtkSats'), batteryChip: $('batteryChip'), batteryFill: $('batteryFill'), batteryValue: $('batteryValue'),
  // Kartenbuehne
  mapSvg: $('mapSvg'), gridLayer: $('gridLayer'), shapeLayer: $('shapeLayer'), robotLayer: $('robotLayer'),
  deletePointBtn: $('deletePointBtn'), deleteFabWrap: $('deleteFabWrap'), deleteBtnLabel: $('deleteBtnLabel'),
  closeAndNewWrap: $('closeAndNewWrap'), closeAndNewBtn: $('closeAndNewBtn'), fitViewBtn: $('fitViewBtn'),
  undoFabWrap: $('undoFabWrap'), undoBtn: $('undoBtn'),
  driveModeBtn: $('driveModeBtn'), driveModeLabel: $('driveModeLabel'),
  driveButtons: $('driveButtons'), driveControlSelect: $('driveControlSelect'),
  cursorSpeedInput: $('cursorSpeedInput'), cursorSpeedRow: $('cursorSpeedRow'),
  driveZonesToggle: $('driveZonesToggle'), driveZonesRow: $('driveZonesRow'),
  driveZoneOrderHint: $('driveZoneOrderHint'),
  driveTurnSizeHint: $('driveTurnSizeHint'),
  extendWrap: $('extendWrap'), extendBtn: $('extendBtn'), extendBtnLabel: $('extendBtnLabel'),
  extendPanel: $('extendPanel'), extendPanelText: $('extendPanelText'),
  extendCancelBtn: $('extendCancelBtn'), extendDoneBtn: $('extendDoneBtn'),
  insertBeforeWrap: $('insertBeforeWrap'), insertBeforeBtn: $('insertBeforeBtn'),
  insertAfterWrap: $('insertAfterWrap'), insertAfterBtn: $('insertAfterBtn'),
  captureCluster: $('captureCluster'), autoFabWrap: $('autoFabWrap'), autoCaptureBtn: $('autoCaptureBtn'), autoCaptureLabel: $('autoCaptureLabel'),
  moveFabWrap: $('moveFabWrap'), movePointBtn: $('movePointBtn'), moveFabLabel: $('moveFabLabel'),
  captureFabWrap: $('captureFabWrap'), addPointBtn: $('addPointBtn'), captureProgress: $('captureProgress'), captureButtonTitle: $('captureButtonTitle'), captureButtonHint: $('captureButtonHint'),
  mapToolbar: $('mapToolbar'), contourStatus: $('contourStatus'),
  mapNameLabel: $('mapNameLabel'), mapSummary: $('mapSummary'),
  gpsPanel: $('gpsPanel'), gpsPanelFix: $('gpsPanelFix'), gpsPanelScatter: $('gpsPanelScatter'),
  gpsPanelAccuracy: $('gpsPanelAccuracy'), mapDistanceInfo: $('mapDistanceInfo'), pointStatus: $('pointStatus'), activeMapName: $('activeMapName'), saveState: $('saveState'),
  // Fahren
  driveZone: $('driveZone'), driveJoystick: $('driveJoystick'), joystickKnob: $('joystickKnob'), driveState: $('driveState'),
  joystickSizeSelect: $('joystickSizeSelect'), handedSelect: $('handedSelect'),
  autoCaptureModeSelect: $('autoCaptureModeSelect'), autoCaptureDistanceInput: $('autoCaptureDistanceInput'),
  autoCaptureIntervalRow: $('autoCaptureIntervalRow'), autoCaptureDistanceRow: $('autoCaptureDistanceRow'),
  driveSpeedMinInput: $('driveSpeedMinInput'), driveSpeedMaxInput: $('driveSpeedMaxInput'), driveTurnMaxInput: $('driveTurnMaxInput'), driveSpeedValue: $('driveSpeedValue'),
  // Menueseite
  menuPage: $('menuPage'), menuScroll: $('menuScroll'), settingsSections: $('settingsSections'),
  menuCloseBtn: $('menuCloseBtn'), languageToggle: $('languageToggle'),
  connectionPill: $('connectionPill'), connectionDetail: $('connectionDetail'), browserWarning: $('browserWarning'), passwordInput: $('passwordInput'),
  connectBtn: $('connectBtn'), disconnectBtn: $('disconnectBtn'), demoBtn: $('demoBtn'),
  firmwareValue: $('firmwareValue'),
  mapSelect: $('mapSelect'), newMapName: $('newMapName'), newMapBtn: $('newMapBtn'), deleteMapBtn: $('deleteMapBtn'), lockMapBtn: $('lockMapBtn'),
  exportJsonBtn: $('exportJsonBtn'), exportGeoJsonBtn: $('exportGeoJsonBtn'),
  shareJsonBtn: $('shareJsonBtn'), shareGeoJsonBtn: $('shareGeoJsonBtn'), importInput: $('importInput'),
  exportCassandraBtn: $('exportCassandraBtn'), shareCassandraBtn: $('shareCassandraBtn'),
  exportSunrayBtn: $('exportSunrayBtn'), shareSunrayBtn: $('shareSunrayBtn'),
  cassandraMissingHint: $('cassandraMissingHint'), cassandraSkippedHint: $('cassandraSkippedHint'),
  importNotice: $('importNotice'),
  cassandraLatInput: $('cassandraLatInput'), cassandraLonInput: $('cassandraLonInput'),
  mapGallery: $('mapGallery'), mapCountBadge: $('mapCountBadge'),
  elementList: $('elementList'),
  positionModeSelect: $('positionModeSelect'), originFields: $('originFields'),
  originLatInput: $('originLatInput'), originLonInput: $('originLonInput'),
  fixOnly: $('fixOnly'),
  autoCaptureIntervalInput: $('autoCaptureIntervalInput'), autoCaptureState: $('autoCaptureState'),
  showGrid: $('showGrid'), gridStepSelect: $('gridStepSelect'), showMower: $('showMower'), mowerLengthInput: $('mowerLengthInput'), mowerWidthInput: $('mowerWidthInput'),
  showTrail: $('showTrail'), clearTrailBtn: $('clearTrailBtn'), showPointQuality: $('showPointQuality'), keepAwake: $('keepAwake'), wakeLockStatus: $('wakeLockStatus'),
  validateMapBtn: $('validateMapBtn'), validationSummary: $('validationSummary'), validationList: $('validationList'), validationDrawer: $('validationDrawer'),
  updateBar: $('updateBar'),
  clearLogBtn: $('clearLogBtn'), exportLogBtn: $('exportLogBtn'), logJumpBtn: $('logJumpBtn'), debugLog: $('debugLog'),
  helpSecureStatus: $('helpSecureStatus'), helpBluetoothStatus: $('helpBluetoothStatus'), helpOfflineStatus: $('helpOfflineStatus'), helpNetworkStatus: $('helpNetworkStatus'),
};

const state = {
  language: 'de',
  // Bezugspunkt fuer den CaSSAndRA-Export: gilt fuer alle Karten dieser Installation.
  // null heisst „nicht gesetzt“ — es gibt bewusst keinen Standardwert.
  cassandraReference: null,
  // Diagnoseprotokoll als Daten, nicht nur als DOM-Text — siehe log().
  logEntries: [],
  logAutoScroll: true,
  connectionStatusKey: 'notConnected',
  connectionDetailKey: 'ready',
  connectionVars: {},
  browserWarningKey: null,
  offlineCacheReady: false,
  lastSavedAt: null,
  saving: false,
  db: null,
  device: null,
  server: null,
  characteristic: null,
  connected: false,
  demo: false,
  encryptionEnabled: false,
  encryptionChallenge: 0,
  encryptionKey: null,
  firmware: null,
  rxBuffer: '',
  pollTimer: null,
  rxWatchdogTimer: null,
  disconnectReasonKey: null,
  rxOverflows: 0,
  pendingStateReplies: 0,
  demoTimer: null,
  sendBusy: false,
  manualDisconnect: false,
  reconnectTimer: null,
  reconnectAttempts: 0,
  bleConnectedAt: 0,
  bleTxCommands: 0,
  bleRxLines: 0,
  lastBleRxAt: 0,
  mode: 'perimeter',
  menuOpen: false,
  // Nachtraegliches Erweitern einer geschlossenen Kontur, siehe startExtension().
  extension: null,
  pendingConfirm: null,
  pendingConfirmText: false,
  pendingConfirmChoice: false,
  pendingUpdate: null,
  lastBleErrorNoticeAt: 0,
  reloadingForUpdate: false,
  selectedPoint: null,
  selectedArea: null,
  fixHistory: [],
  // Je empfangenem Fix ein Eintrag { at, cm } — die Streuung des 2-s-Fensters zu diesem
  // Zeitpunkt. Reine Anzeige, geht nirgends in die Aufnahme ein.
  scatterHistory: [],
  // Nutzer-Zoom/-Verschiebung der Karte; solange custom=false folgt die Ansicht dem Auto-Fit.
  viewport: { zoom: 1, dx: 0, dy: 0, custom: false, base: null },
  gesture: null,
  // Der viewBox der Karte folgt der tatsaechlichen Flaeche in CSS-Pixeln (siehe updateViewBox).
  viewBox: { w: 1000, h: 680 },
  hitRadiusUnits: 26,
  captureHold: null,
  // Allgemeiner Rueckgaengig-Stapel (nur im Speicher, nichts davon wird in der Karte
  // gespeichert — die frueher persistierte Versionsverwaltung ist bewusst entfallen).
  // `undoStack` ist **keine** eigene Ablage, sondern eine Sicht auf `state.activeMap.undoStack`
  // — siehe die Eigenschaftsdefinition direkt hinter dem state-Literal.

  undoSuspended: false,
  autoCaptureRunning: false,
  autoCaptureTimer: null,
  autoCaptureBusy: false,
  autoCaptureCount: 0,
  // Bezugspunkt der distanzbasierten Automatik: ab hier wird die Fahrstrecke gemessen.
  autoCaptureLastPoint: null,
  currentTransform: null,
  wakeLock: null,
  driveTimer: null,
  driveDirection: null,
  driveVector: { linear: 0, angular: 0 },
  joystickPointerId: null,
  cursorPointerId: null,
  cursorZone: null,
  cursorKey: null,
  idleStopTimer: null,
  idleStopFailing: false,
  lastDriveSentAt: 0,

  appliedMowPwm: null,
  trail: [],
  validationResult: null,
  maps: [],
  activeMap: null,
  activeExclusionId: null,
  view: {
    showGrid: true, gridStep: 0.5, showMower: true, mowerLength: 0.60, mowerWidth: 0.35,
    autoCaptureIntervalS: 5, autoCaptureMode: 'time', autoCaptureDistanceCm: AUTO_CAPTURE_DISTANCE_DEFAULT_CM,
    showTrail: true, showPointQuality: true, keepAwake: true,
    driveSpeedMin: 0.08, driveSpeedMax: 0.25, driveTurnMax: 1.15, theme: 'system',
    joystickScale: '1', handed: 'right', driveControl: 'joystick', cursorSpeedCms: 15,
    driveZones: true, gpsPanel: false,
  },
  telemetry: {
    x: null, y: null, delta: null, solution: null, age: null, accuracy: null,
    visibleSatellites: null, visibleSatellitesDgps: null, batteryVoltage: null, receivedAt: 0,
  },
  pendingVersion: null,
};

/**
 * **Die Undo-Historie gehoert der Karte, nicht der Sitzung** (seit v68). `state.undoStack` ist
 * deshalb keine eigene Ablage, sondern eine Sicht auf `state.activeMap.undoStack`: jeder
 * `push`/`pop`/`shift` trifft unmittelbar den Kartendatensatz, den `saveActiveMap()` ohnehin
 * schreibt, und ein Kartenwechsel bringt ohne Zutun die Historie **dieser** Karte mit.
 *
 * Bewusst eine Sicht statt zweier abgeglichener Felder: eine Spiegelung haette an jeder der
 * sechs Stellen nachgezogen werden muessen, an denen `state.activeMap` gesetzt wird — eine
 * vergessene davon haette den Stapel still auf die falsche Karte zeigen lassen.
 */
Object.defineProperty(state, 'undoStack', {
  enumerable: true,
  get() {
    const map = state.activeMap;
    if (!map) return [];   // ohne Karte gibt es nichts zurueckzunehmen; Schreibzugriffe verfallen
    if (!Array.isArray(map.undoStack)) map.undoStack = [];
    return map.undoStack;
  },
});

/**
 * Das Protokoll liegt seit v50 in `state.logEntries` und nicht mehr nur im DOM. Zwei Gruende:
 * der Export braucht die Zeilen als Daten, und nur mit einem Puffer laesst sich die Zahl der
 * vorgehaltenen Zeilen ueberhaupt begrenzen — `textContent +=` wuchs unbegrenzt weiter.
 */
function log(message, data = '') {
  const stamp = new Date().toLocaleTimeString(localeCode());
  const suffix = data === '' ? '' : ` ${typeof data === 'string' ? data : JSON.stringify(data)}`;
  state.logEntries.push(`[${stamp}] ${message}${suffix}`);
  // Ringpuffer: die aeltesten Zeilen fallen vorn weg, wie beim gedeckelten rxBuffer.
  if (state.logEntries.length > LOG_ENTRY_LIMIT) {
    state.logEntries.splice(0, state.logEntries.length - LOG_ENTRY_LIMIT);
  }
  renderDebugLog();
}

/** Schreibt den Puffer in die Anzeige und laesst sie nur mitlaufen, wenn sie unten steht. */
function renderDebugLog() {
  if (!ui.debugLog) return;
  ui.debugLog.textContent = state.logEntries.length ? `${state.logEntries.join('\n')}\n` : '';
  if (state.logAutoScroll) scrollLogToEnd();
  else refreshLogJumpHint();
}

/**
 * Steht die Ansicht am unteren Ende? Ohne gemessenes Layout — im Test und vor dem ersten
 * Zeichnen sind die Werte 0 bzw. undefiniert — gilt ausdruecklich „ja“: der Normalfall ist
 * Mitlaufen, pausiert wird erst, wenn der Nutzer nachweislich hochgescrollt hat.
 */
function debugLogAtBottom() {
  const el = ui.debugLog;
  if (!el) return true;
  const metrics = [el.scrollHeight, el.scrollTop, el.clientHeight];
  if (!metrics.every((value) => Number.isFinite(value))) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= LOG_BOTTOM_TOLERANCE_PX;
}

/** Ans Ende springen und das Mitlaufen wieder aufnehmen. */
function scrollLogToEnd() {
  if (ui.debugLog) ui.debugLog.scrollTop = ui.debugLog.scrollHeight;
  state.logAutoScroll = true;
  refreshLogJumpHint();
}

/** Der Hinweis steht nur da, solange das Mitlaufen pausiert ist. */
function refreshLogJumpHint() {
  if (ui.logJumpBtn) ui.logJumpBtn.hidden = state.logAutoScroll;
}

/**
 * Jede Scrollbewegung entscheidet neu: unten angekommen laeuft die Ansicht wieder mit,
 * darueber bleibt sie stehen. Neue Zeilen werden trotzdem weiter angehaengt.
 */
function onDebugLogScroll() {
  state.logAutoScroll = debugLogAtBottom();
  refreshLogJumpHint();
}

/** Die letzten LOG_EXPORT_LIMIT Zeilen, wortgleich mit der Anzeige. */
function logExportText() {
  const lines = state.logEntries.slice(-LOG_EXPORT_LIMIT);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/** Dateiname mit Datum und Uhrzeit, damit sich mehrere Exporte unterscheiden lassen. */
function logExportFileName(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    + `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `mapcreator-log_${stamp}.txt`;
}

function exportDebugLog() {
  const content = logExportText();
  if (!content) { showNotice({ title: tr('exportLog'), message: tr('logEmpty') }); return; }
  downloadTextFile(content, logExportFileName(), 'text/plain');
}

function clearDebugLog() {
  state.logEntries.length = 0;
  state.logAutoScroll = true;
  renderDebugLog();
}

function refreshConnectionUi() {
  const online = state.connected || state.demo;
  ui.bleStatusBtn.classList.toggle('online', online);
  ui.bleStatusBtn.classList.toggle('offline', !online);
  ui.bleStatusBtn.classList.toggle('demo', state.demo);
  ui.connectionPill.textContent = tr(state.connectionStatusKey, state.connectionVars);
  ui.connectionDetail.textContent = tr(state.connectionDetailKey, state.connectionVars);
  ui.connectionPill.classList.toggle('online', state.connected);
  ui.connectionPill.classList.toggle('offline', !state.connected);
  ui.connectBtn.disabled = state.connected || state.demo || !window.isSecureContext || !bleAdapter();
  ui.disconnectBtn.disabled = !state.connected && !state.demo;
  refreshControlUi();
}


function driveSpeedLimits() {
  const min = clampNumber(state.view.driveSpeedMin, 0.02, 0.34, 0.08);
  const max = clampNumber(state.view.driveSpeedMax, min + 0.01, 0.50, Math.max(min + 0.02, 0.25));
  const turn = clampNumber(state.view.driveTurnMax, 0.20, 2.00, 1.15);
  return { min, max, turn };
}

function refreshControlUi() {
  const available = state.connected && !state.demo && Boolean(state.characteristic);
  if (ui.driveJoystick) ui.driveJoystick.classList.toggle('unavailable', !available);
  const { min, max } = driveSpeedLimits();
  const decimal = (v) => v.toFixed(2).replace('.', state.language === 'de' ? ',' : '.');
  if (ui.driveSpeedValue) ui.driveSpeedValue.textContent = `${decimal(min)} – ${decimal(max)} m/s`;
  // Auch der Sprachwechsel laeuft hier durch (applyLanguage), beide Hinweistexte sind dynamisch
  // und tragen deshalb kein festes data-i18n.
  refreshDriveZoneHint();
  refreshTurnKeyHint();
  if (!available) {
    clearInterval(state.driveTimer);
    state.driveTimer = null;
    state.driveDirection = null;
    ui.driveState.textContent = tr('driveNeedConnection');
  } else if (!state.driveDirection) {
    ui.driveState.textContent = tr('driveIdle');
  }
}

async function sendDriveVector(linear, angular, { force = false } = {}) {
  if (!state.connected || state.demo || !state.characteristic) return;
  const now = performance.now();
  if (!force && now - state.lastDriveSentAt < DRIVE_POINTER_MIN_INTERVAL_MS) return;
  if (!force && state.sendBusy) return;
  state.lastDriveSentAt = now;
  const l = Math.abs(linear) < 0.005 ? 0 : linear;
  const a = Math.abs(angular) < 0.01 ? 0 : angular;
  await sendSunray(`AT+M,${l.toFixed(2)},${a.toFixed(2)}`, { skipIfBusy: !force });
  if (ui.driveState) {
    const fmt = (v, digits) => Number(v).toFixed(digits).replace('.', state.language === 'de' ? ',' : '.');
    ui.driveState.textContent = `v ${fmt(l, 2)} m/s · ω ${fmt(a, 2)} rad/s`;
  }
}

function resetJoystickVisual() {
  if (ui.joystickKnob) ui.joystickKnob.style.transform = 'translate(-50%, -50%)';
}

/**
 * Der Tastenmodus fahert bewusst mit **einer eigenen, langsamen Geschwindigkeit** — nicht mit
 * dem Joystick-Maximum. Untergrenze 2 cm/s, Obergrenze die eingestellte Hoechstgeschwindigkeit:
 * schneller als der Joystick darf das Rangieren nicht werden.
 */
const CURSOR_SPEED_MIN_CMS = 2;
const CURSOR_SPEED_DEFAULT_CMS = 15;

function cursorSpeedLimits() {
  const max = Math.round(driveSpeedLimits().max * 100);
  const value = Math.round(clampNumber(state.view.cursorSpeedCms, CURSOR_SPEED_MIN_CMS, max, CURSOR_SPEED_DEFAULT_CMS));
  return { min: CURSOR_SPEED_MIN_CMS, max, value };
}

const CURSOR_DIRECTIONS = ['up', 'down', 'left', 'right'];

/**
 * Die drei Geschwindigkeitszonen, von der Mitte nach aussen. **Die einzige Stelle, die die
 * Grenzen nennt** — das Stylesheet bekommt sie ueber die beiden CSS-Variablen, die
 * `applyDriveZonePreferences()` von hier aus setzt, damit die gezeichneten Striche und die
 * gefahrene Geschwindigkeit nicht auseinanderlaufen koennen.
 *
 * **Sie gelten nur fuer vorwaerts und rueckwaerts.** Links und rechts sind seit der Sanduhrform
 * schmale Keile und drehen mit einer festen Geschwindigkeit, siehe `cursorDriveVector()`.
 *
 * `until` ist der Anteil der Strecke **Mitte -> Aussenkante**, nicht der sichtbaren Tastenlaenge:
 * die Mitte selbst ist ein winziges totes Feld zwischen den vier Tasten, und „von der Mitte nach
 * aussen" ist die Strecke, die der Finger tatsaechlich zurueckzulegen hat.
 *
 * 50/30/20 statt der frueheren 40/30/30: im Trapez laeuft die innere Zone zur Taille hin zu,
 * sie braucht deshalb mehr Weg als die beiden aeusseren, die ueber die volle Breite laufen.
 */
const DRIVE_ZONES = [
  { key: 'slow', until: 0.50 },
  { key: 'normal', until: 0.80 },
  { key: 'fast', until: 1 },
];

/**
 * Die Geschwindigkeit je Zone — **ohne eine einzige neue Zahl**. Langsam ist das Joystick-Minimum,
 * normal die bisherige Tastengeschwindigkeit, schnell das Joystick-Maximum. Damit entsteht keine
 * Geschwindigkeit, die der Nutzer nicht ohnehin schon fuer das Fahren von Hand freigegeben hat,
 * und die alte Auflage „Rangieren nie schneller als der Joystick" gilt unveraendert weiter.
 *
 * Eine aufsteigende Reihenfolge wird **nicht** erzwungen: `driveSpeedLimits()` sichert nur
 * `min < max`, die mittlere Zone kann darunter liegen, wenn der Nutzer das Joystick-Minimum hoch
 * und die Tastengeschwindigkeit niedrig setzt. Die Werte gelten dann wie eingetragen.
 */
function cursorZoneSpeeds() {
  const { min, max } = driveSpeedLimits();
  return { slow: min, normal: cursorSpeedLimits().value / 100, fast: max };
}

/**
 * Steigt die Staffel an? **Die einzige Stelle, die das entscheidet.** `driveSpeedLimits()`
 * sichert nur `min < max`, `cursorSpeedLimits()` deckelt die mittlere Zone auf `max` —
 * ungeprueft bleibt `normal` gegen `langsam`: wer das Joystick-Minimum hoch und die
 * Tastengeschwindigkeit niedrig setzt, bekommt etwa 30 / 5 / 45 cm/s.
 *
 * Die Werte gelten dann **wie eingetragen**. Sie werden weder sortiert noch stillschweigend
 * angehoben — eine heimliche Untergrenze wuerde eine Zahl veraendern, die der Nutzer selbst
 * eingetippt hat. Sichtbar gemacht wird der Fall stattdessen von `refreshDriveZoneHint()`.
 *
 * Gemeldet wird nur ein echter Rueckschritt, nicht blosse Gleichheit: zwei gleiche Werte machen
 * das Schieben nach aussen nirgends langsamer, es gaebe also nichts zu erklaeren.
 */
function cursorZoneLadder() {
  const speeds = cursorZoneSpeeds();
  const cms = DRIVE_ZONES.map((zone) => Math.round(speeds[zone.key] * 100));
  return { cms, descends: cms.some((value, index) => index > 0 && value < cms[index - 1]) };
}

/**
 * Wirkt die Zoneneinteilung fuer diese Richtung? **Nur vorwaerts und rueckwaerts koennen Zonen
 * haben.** Links und rechts sind seit der Sanduhrform schmale Keile: innen laufen sie auf eine
 * Spitze zu, dort waere die langsame Zone kein Daumenziel mehr. Sie drehen deshalb mit einer
 * festen Geschwindigkeit, unabhaengig davon, ob die Einteilung eingeschaltet ist.
 */
function cursorZonesActive(direction) {
  if (direction === 'left' || direction === 'right') return false;
  return Boolean(state.view.driveZones);
}

/**
 * **Der groesste Kreis, der in eine Drehtaste passt — die einzige Stelle, die das rechnet.**
 *
 * Der Keil ist ein gleichschenkliges Dreieck: `base` ist seine Aussenkante am Feldrand, `depth`
 * die Tiefe bis zur Spitze an der Taille. Beide folgen aus der Feldgroesse `field`, der Fuge
 * `gap` und der Taille `waist` — denselben drei Groessen, aus denen das Stylesheet die Form
 * schneidet. Der Inkreisdurchmesser eines Dreiecks ist `2 * Flaeche / Umfang * 2`, hier
 * ausgeschrieben als `2 * base * depth / (base + 2 * Schenkel)`.
 *
 * Die 44-px-Bedingung wird fuer links/rechts **hier** beantwortet und nirgends sonst: die
 * Aussenkante allein taugt nicht als Mass, weil ein langer duenner Keil daran vorbeikaeme.
 * `tests/layout-test.js` rechnet die Funktion gegen die ausgewerteten clip-path-Polygone nach
 * und leitet daraus die Schwelle ab, statt sie zu unterstellen.
 */
function turnKeyIncircle(field, gap, waist) {
  const half = field / 2 - gap;
  if (!(half > 0) || !(waist > 0) || !(waist < 1)) return 0;
  const cutX = gap / 2 * Math.sqrt((1 - waist) ** 2 + 1);
  const cutY = cutX / (1 - waist);
  const base = 2 * (half - cutY);
  const depth = half * (1 - waist) - cutX;
  if (!(base > 0) || !(depth > 0)) return 0;
  return 2 * base * depth / (base + 2 * Math.hypot(base / 2, depth));
}

/**
 * Die drei Formgroessen, aus denen die Tasten geschnitten werden. Sie stehen im **Stylesheet**
 * (`--drive-pad-gap`, `--drive-pad-waist`, `--drive-pad-key-min`) und werden von dort gelesen
 * statt hier ein zweites Mal hingeschrieben — sonst koennten Form und Hinweis auseinanderlaufen,
 * ohne dass es auffaellt. Sind sie nicht lesbar (kein Layout, kein Browser), gibt es `null`, und
 * der Hinweis bleibt weg: lieber nichts sagen als etwas Geratenes.
 */
function driveShapeTokens() {
  const read = globalThis.getComputedStyle;
  if (typeof read !== 'function') return null;
  const style = read(ui.driveButtons);
  const value = (name) => parseFloat(style?.getPropertyValue?.(name));
  const gap = value('--drive-pad-gap');
  const waist = value('--drive-pad-waist');
  const keyMin = value('--drive-pad-key-min');
  if (![gap, waist, keyMin].every(Number.isFinite)) return null;
  return { gap, waist, keyMin };
}

/**
 * Welche Zone liegt unter dem Finger? Gemessen als Anteil der Strecke von der Mitte des
 * Tastenkreuzes zur Aussenkante, **laengs** der gedrueckten Richtung. Quer dazu wird nichts
 * geprueft: der Finger darf die Taste seitlich verlassen, die Zeigererfassung haelt die Fahrt,
 * und der Zonenwechsel soll allein vom Schieben nach aussen kommen.
 *
 * Ohne messbares Feld (vor dem ersten Zeichnen) gilt die **mittlere** Zone — also genau das
 * Verhalten ohne Zoneneinteilung, statt einer geratenen Geschwindigkeit.
 */
function cursorZoneFromPointer(direction, event) {
  const rect = ui.driveButtons.getBoundingClientRect?.();
  const across = direction === 'left' || direction === 'right';
  const half = ((across ? rect?.width : rect?.height) || 0) / 2;
  if (!(half > 0) || !Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return 'normal';
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const outward = direction === 'up' ? cy - event.clientY
    : direction === 'down' ? event.clientY - cy
      : direction === 'left' ? cx - event.clientX
        : event.clientX - cx;
  const share = Math.min(1, Math.max(0, outward / half));
  return (DRIVE_ZONES.find((zone) => share < zone.until) || DRIVE_ZONES[DRIVE_ZONES.length - 1]).key;
}

/**
 * Fahrbefehl einer der vier Richtungstasten.
 *
 * **Vorwaerts/rueckwaerts** ist die Geschwindigkeit der Zone als Laengsfahrt; ohne Zone (oder
 * bei abgeschalteter Einteilung) gilt die mittlere, also der Zustand vor den Zonen.
 *
 * **Links/rechts** ist eine Drehung auf der Stelle (linear 0) mit einer **festen**
 * Geschwindigkeit: der Haelfte des eingestellten Hoechstwerts, bei den Vorgaben also 12,5 cm/s.
 * Der Keil hat seit der Sanduhrform keine Zonen mehr, und die frueher hier benutzte mittlere
 * Geschwindigkeit waere eine willkuerliche zweite Wahl gewesen — der halbe Hoechstwert bindet
 * das Drehen an eine Zahl, die der Nutzer ohnehin fuehrt, und fuehrt keine neue ein.
 *
 * Aus cm/s wird die Drehrate ueber die halbe Spurweite: laufen beide Raeder gegenlaeufig mit v,
 * dreht der Maeher mit v / (Breite/2). Die Breite fuehrt die App bereits als Maeherbreite.
 * Gedeckelt auf die eingestellte Hoechst-Drehrate. **Die Umrechnung steht weiterhin nur hier.**
 */
function cursorDriveVector(direction, zone = null) {
  const { max, turn } = driveSpeedLimits();
  if (direction === 'up' || direction === 'down') {
    const speeds = cursorZoneSpeeds();
    const v = cursorZonesActive(direction) && zone ? (speeds[zone] ?? speeds.normal) : speeds.normal;
    return { linear: direction === 'up' ? v : -v, angular: 0 };
  }
  const halfTrack = clampNumber(state.view.mowerWidth, 0.10, 3.00, 0.35) / 2;
  const omega = Math.min(turn, (max / 2) / halfTrack);
  return { linear: 0, angular: direction === 'left' ? omega : -omega };
}

function joystickVectorFromPointer(event) {
  const rect = ui.driveJoystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = Math.max(20, Math.min(rect.width, rect.height) / 2 - 34);
  let nx = (event.clientX - cx) / radius;
  let ny = (event.clientY - cy) / radius;
  const mag = Math.hypot(nx, ny);
  if (mag > 1) { nx /= mag; ny /= mag; }
  const dead = 0.07;
  if (Math.abs(nx) < dead) nx = 0;
  if (Math.abs(ny) < dead) ny = 0;
  // Auslenkung = Geschwindigkeit (RC-Prinzip): ab der Totzone sofort das eingestellte
  // Minimum, am Anschlag das Maximum.
  const { min, max, turn } = driveSpeedLimits();
  const ramp = (value) => (value === 0 ? 0 : Math.sign(value) * (min + (max - min) * Math.min(1, Math.abs(value))));
  const linear = -ramp(ny);
  // AT+M erwartet als zweiten Wert eine *Drehrate* im Roboterrahmen, keine Lenkrichtung. Eine
  // Drehrate ist von der Fahrtrichtung unabhaengig: dieselbe Drehung, die den Maeher vorwaerts
  // nach links traegt, traegt ihn rueckwaerts nach rechts. Ohne Spiegelung sind deshalb genau
  // die beiden rueckwaertigen Quadranten seitenverkehrt, waehrend vorwaerts richtig bleibt.
  // Beim Drehen auf der Stelle (linear === 0) gilt die Vorwaertskonvention.
  const steering = linear < 0 ? nx : -nx;
  return {
    nx, ny,
    linear,
    angular: steering * turn,
    px: nx * radius,
    py: ny * radius,
  };
}

function updateJoystickFromPointer(event, { forceSend = false } = {}) {
  if (!ui.driveJoystick || state.joystickPointerId !== event.pointerId) return;
  const v = joystickVectorFromPointer(event);
  if (ui.joystickKnob) ui.joystickKnob.style.transform = `translate(-50%, -50%) translate(${v.px.toFixed(1)}px, ${v.py.toFixed(1)}px)`;
  state.driveVector = { linear: v.linear, angular: v.angular };
  sendDriveVector(v.linear, v.angular, { force: forceSend }).catch((error) => reportBleError('AT+M', error));
}

function beginJoystick(event) {
  event.preventDefault();
  if (!state.connected || state.demo || !state.characteristic) {
    if (ui.driveState) ui.driveState.textContent = tr('driveNeedConnection');
    return;
  }
  stopDrive({ send: false });
  state.joystickPointerId = event.pointerId;
  state.driveDirection = 'joystick';
  try { ui.driveJoystick.setPointerCapture(event.pointerId); } catch (_) {}
  updateJoystickFromPointer(event, { forceSend: true });
  startDriveHeartbeat();
}

/** Fahreingabe aktiv? Joystick ausgelenkt oder Richtungstaste gehalten. */
function driveInputActive() {
  return Boolean(state.driveDirection);
}

/**
 * Ruhezustand-Stopp: solange **keine** Fahreingabe anliegt, geht alle
 * DRIVE_IDLE_STOP_INTERVAL_MS ein `AT+M,0,0` raus. Das ist die selbstheilende Ebene neben der
 * Fehlermeldung: ein verlorenes Stopp-Paket wird schlicht im naechsten Takt ersetzt, ohne dass
 * die App den Verlust ueberhaupt bemerken muss. Waehrend gefahren wird, schweigt dieser Takt —
 * dort schickt startDriveHeartbeat() den aktuellen Vektor.
 */
function startIdleStopTicker() {
  stopIdleStopTicker();
  state.idleStopTimer = setInterval(() => { sendIdleStop(); }, DRIVE_IDLE_STOP_INTERVAL_MS);
}

function stopIdleStopTicker() {
  if (state.idleStopTimer) clearInterval(state.idleStopTimer);
  state.idleStopTimer = null;
  state.idleStopFailing = false;
}

function sendIdleStop() {
  // Nur bei tatsaechlich stehender Verbindung — ins Leere zu senden bringt nichts.
  if (!state.connected || state.demo || !state.characteristic) return;
  if (driveInputActive()) return;
  sendSunray('AT+M,0,0').then(() => {
    state.idleStopFailing = false;
  }).catch((error) => {
    // Bei 2 Stopps je Sekunde wuerde jede Meldung die Statuszeile zuschuetten. Deshalb nur der
    // **Uebergang** von "geht" zu "geht nicht" wird gemeldet, jeder weitere Fehlschlag nur
    // protokolliert — die Drosselung in reportBleError() greift zusaetzlich.
    if (!state.idleStopFailing) {
      state.idleStopFailing = true;
      reportBleError('AT+M,0,0', error);
    } else {
      log('AT+M,0,0', error?.message || String(error));
    }
  });
}

/**
 * Fahr-Takt: alle DRIVE_HEARTBEAT_MS geht der aktuelle Vektor erneut raus. Beide Steuerungsarten
 * nutzen denselben Takt. Der Name "Totmann" waere irrefuehrend: dass die Firmware ohne neues
 * AT+M von selbst anhaelt, ist nicht belegt (siehe CLAUDE.md).
 */
function startDriveHeartbeat() {
  state.driveTimer = setInterval(() => {
    if (!state.driveDirection) return;
    sendDriveVector(state.driveVector.linear, state.driveVector.angular, { force: true })
      .catch((error) => reportBleError('AT+M', error));
  }, DRIVE_HEARTBEAT_MS);
}

/**
 * Zeigt die Zone, in der gerade gefahren wird, an der gedrueckten Taste. Getragen wird das von
 * `data-zone` an genau dem Tastenelement, das den Zeiger bekommen hat — nicht von einer Suche
 * ueber alle Tasten, damit keine zweite Quelle der Frage „welche Taste ist aktiv?" entsteht.
 */
function refreshCursorZoneVisual() {
  const key = state.cursorKey;
  if (!key?.dataset) return;
  if (state.cursorZone && cursorZonesActive(state.driveDirection)) key.dataset.zone = state.cursorZone;
  else delete key.dataset.zone;
}

/** Eine der vier Richtungstasten wird gedrueckt: fahren, bis sie losgelassen wird. */
function beginCursorDrive(direction, event) {
  if (event?.preventDefault) event.preventDefault();
  if (!state.connected || state.demo || !state.characteristic) {
    if (ui.driveState) ui.driveState.textContent = tr('driveNeedConnection');
    return;
  }
  stopDrive({ send: false });
  state.driveDirection = direction;
  state.cursorPointerId = event?.pointerId ?? null;
  state.cursorKey = event?.target?.closest?.('[data-direction]') || null;
  state.cursorZone = cursorZoneFromPointer(direction, event);
  state.driveVector = cursorDriveVector(direction, state.cursorZone);
  refreshCursorZoneVisual();
  try { event?.currentTarget?.setPointerCapture?.(event.pointerId); } catch (_) {}
  sendDriveVector(state.driveVector.linear, state.driveVector.angular, { force: true })
    .catch((error) => reportBleError('AT+M', error));
  startDriveHeartbeat();
}

/**
 * Der Finger wird auf der gedrueckten Taste verschoben: die Zone folgt ihm. **Diese Funktion
 * veraendert eine laufende Fahrt und startet nie eine.** Ohne gedrueckte Richtungstaste — also
 * `state.driveDirection` gleich `null` oder `'joystick'` — kehrt sie ohne jede Wirkung zurueck;
 * sie ruft weder `beginCursorDrive()` noch `startDriveHeartbeat()` und ruehrt keinen Zeitgeber
 * an, kann eine bereits beendete Fahrt also auch nicht am Leben halten.
 *
 * Zuerst wird `state.driveVector` gesetzt, erst danach gesendet: `sendDriveVector()` verwirft
 * eine ungezwungene Sendung innerhalb von DRIVE_POINTER_MIN_INTERVAL_MS oder waehrend eines
 * laufenden Schreibvorgangs — der 650-ms-Takt traegt den neuen Wert dann nach. Genau dieses
 * Muster nutzt der Joystick in `updateJoystickFromPointer()` bereits.
 */
function updateCursorDriveFromPointer(event) {
  const direction = state.driveDirection;
  if (!CURSOR_DIRECTIONS.includes(direction)) return;
  if (state.cursorPointerId !== null && event?.pointerId !== state.cursorPointerId) return;
  if (!cursorZonesActive(direction)) return;
  const zone = cursorZoneFromPointer(direction, event);
  if (zone === state.cursorZone) return;
  state.cursorZone = zone;
  state.driveVector = cursorDriveVector(direction, zone);
  refreshCursorZoneVisual();
  sendDriveVector(state.driveVector.linear, state.driveVector.angular)
    .catch((error) => reportBleError('AT+M', error));
}

function stopDrive({ send = true } = {}) {
  if (state.driveTimer) clearInterval(state.driveTimer);
  state.driveTimer = null;
  const wasDriving = Boolean(state.driveDirection) || state.joystickPointerId !== null;
  state.driveDirection = null;
  state.joystickPointerId = null;
  state.cursorPointerId = null;
  state.cursorZone = null;
  refreshCursorZoneVisual();
  state.cursorKey = null;
  state.driveVector = { linear: 0, angular: 0 };
  resetJoystickVisual();
  if (ui.driveState) ui.driveState.textContent = tr('driveIdle');
  if (send && state.connected && !state.demo && state.characteristic && wasDriving) {
    // Ein nicht angekommener Stopp ist sicherheitsrelevant: immer sofort melden.
    sendSunray('AT+M,0,0').catch((error) => reportBleError('AT+M,0,0', error, { immediate: true }));
  }
}

async function emergencyStop() {
  stopDrive({ send: false });
  refreshControlUi();
  if (!state.connected || state.demo || !state.characteristic) return;
  try { await sendSunray('AT+M,0,0'); } catch (error) { reportBleError('AT+M,0,0', error, { immediate: true }); }
  try { await sendSunray('AT+C,0,0'); } catch (error) { reportBleError('AT+C,0,0', error, { immediate: true }); }
  if (ui.driveState) ui.driveState.textContent = tr('stopEverythingDone');
}

function setConnectionDetail(detailKey, vars = {}) {
  state.connectionDetailKey = detailKey;
  state.connectionVars = vars;
  refreshConnectionUi();
}

function setConnectionStatus(connected, statusKey, detailKey = statusKey, vars = {}) {
  state.connected = connected;
  state.connectionStatusKey = statusKey;
  state.connectionDetailKey = detailKey;
  state.connectionVars = vars;
  refreshConnectionUi();
  refreshCaptureState();
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '–';
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function loadViewPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) || '{}');
    state.view.showGrid = saved.showGrid !== false;
    state.view.showMower = saved.showMower !== false;
    state.view.mowerLength = clampNumber(saved.mowerLength, 0.10, 3.00, 0.60);
    state.view.mowerWidth = clampNumber(saved.mowerWidth, 0.10, 3.00, 0.35);
    state.view.gridStep = saved.gridStep === 'auto' ? 'auto' : clampNumber(saved.gridStep, 0.10, 10.00, 0.50);
    state.view.autoCaptureIntervalS = Math.round(clampNumber(saved.autoCaptureIntervalS, 1, 120, 5));
    state.view.autoCaptureMode = AUTO_CAPTURE_MODES.includes(saved.autoCaptureMode) ? saved.autoCaptureMode : 'time';
    state.view.autoCaptureDistanceCm = Math.round(clampNumber(saved.autoCaptureDistanceCm,
      AUTO_CAPTURE_DISTANCE_MIN_CM, AUTO_CAPTURE_DISTANCE_MAX_CM, AUTO_CAPTURE_DISTANCE_DEFAULT_CM));
    state.view.theme = THEMES.includes(saved.theme) ? saved.theme : 'system';
    state.view.showTrail = saved.showTrail !== false;
    // Die GPS-Einblendung ist standardmaessig **aus** — sie liegt auf der Karte und soll nur da
    // sein, wenn jemand sie angefordert hat.
    state.view.gpsPanel = saved.gpsPanel === true;
    state.view.showPointQuality = saved.showPointQuality !== false;
    state.view.keepAwake = saved.keepAwake !== false;
    state.view.driveSpeedMin = clampNumber(saved.driveSpeedMin, 0.02, 0.34, 0.08);
    state.view.driveSpeedMax = clampNumber(saved.driveSpeedMax, 0.03, 0.50, 0.25);
    state.view.driveTurnMax = clampNumber(saved.driveTurnMax, 0.20, 2.00, 1.15);
    state.view.joystickScale = JOYSTICK_SCALES.includes(String(saved.joystickScale)) ? String(saved.joystickScale) : '1';
    // Migration: die Einstellung hiess frueher driveLabelSide und meinte die Seite der
    // Fahrtanzeige — links bedeutete Rechtshaender. Jetzt ist es die Haendigkeit selbst.
    state.view.handed = saved.handed === 'left' || saved.driveLabelSide === 'right' ? 'left' : 'right';
    state.view.driveControl = saved.driveControl === 'buttons' ? 'buttons' : 'joystick';
    state.view.cursorSpeedCms = Number.isFinite(Number(saved.cursorSpeedCms)) ? Number(saved.cursorSpeedCms) : 15;
    // Ein gespeichertes `driveZonesTurn` wird bewusst ignoriert: den Schalter gibt es nicht mehr,
    // links und rechts drehen mit fester Geschwindigkeit.
    state.view.driveZones = saved.driveZones !== false;
  } catch (_) {
    state.view = { showGrid: true, gridStep: 0.5, showMower: true, mowerLength: 0.60, mowerWidth: 0.35, autoCaptureIntervalS: 5, autoCaptureMode: 'time', autoCaptureDistanceCm: AUTO_CAPTURE_DISTANCE_DEFAULT_CM, showTrail: true, showPointQuality: true, keepAwake: true, gpsPanel: false, driveSpeedMin: 0.08, driveSpeedMax: 0.25, driveTurnMax: 1.15, theme: 'system',
      joystickScale: '1', handed: 'right', driveControl: 'joystick', cursorSpeedCms: 15,
      driveZones: true };
  }
}

/** Im Menue steht nur die Zeile, die zum gewaehlten Automatik-Modus gehoert. */
function applyAutoCaptureModeToUi() {
  const distance = state.view.autoCaptureMode === 'distance';
  ui.autoCaptureIntervalRow.hidden = distance;
  ui.autoCaptureDistanceRow.hidden = !distance;
}

function saveViewPreferences() {
  localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(state.view));
}

function applyViewPreferencesToUi() {
  ui.showGrid.checked = state.view.showGrid;
  ui.showMower.checked = state.view.showMower;
  ui.gridStepSelect.value = String(state.view.gridStep);
  if (!ui.gridStepSelect.value) ui.gridStepSelect.value = '0.5';
  ui.mowerLengthInput.value = state.view.mowerLength.toFixed(2);
  ui.mowerWidthInput.value = state.view.mowerWidth.toFixed(2);
  ui.autoCaptureIntervalInput.value = String(state.view.autoCaptureIntervalS);
  ui.autoCaptureModeSelect.value = state.view.autoCaptureMode;
  ui.autoCaptureDistanceInput.value = String(state.view.autoCaptureDistanceCm);
  applyAutoCaptureModeToUi();
  applyTheme();
  ui.showTrail.checked = state.view.showTrail;
  ui.showPointQuality.checked = state.view.showPointQuality;
  ui.keepAwake.checked = state.view.keepAwake;
  const limits = driveSpeedLimits();
  ui.driveSpeedMinInput.value = limits.min.toFixed(2);
  ui.driveSpeedMaxInput.value = limits.max.toFixed(2);
  ui.driveTurnMaxInput.value = limits.turn.toFixed(2);
  ui.joystickSizeSelect.value = state.view.joystickScale;
  ui.handedSelect.value = state.view.handed;
  ui.driveControlSelect.value = state.view.driveControl;
  const cursor = cursorSpeedLimits();
  ui.cursorSpeedInput.min = String(cursor.min);
  ui.cursorSpeedInput.max = String(cursor.max);
  ui.cursorSpeedInput.value = String(cursor.value);
  ui.driveZonesToggle.checked = state.view.driveZones;
  applyDriveControlMode();
  applyDriveZonePreferences();
}

function updateViewPreferencesFromUi() {
  state.view.showGrid = ui.showGrid.checked;
  state.view.showMower = ui.showMower.checked;
  state.view.gridStep = ui.gridStepSelect.value === 'auto' ? 'auto' : clampNumber(ui.gridStepSelect.value, 0.10, 10.00, 0.50);
  state.view.mowerLength = clampNumber(ui.mowerLengthInput.value, 0.10, 3.00, state.view.mowerLength);
  state.view.mowerWidth = clampNumber(ui.mowerWidthInput.value, 0.10, 3.00, state.view.mowerWidth);
  state.view.autoCaptureIntervalS = Math.round(clampNumber(ui.autoCaptureIntervalInput.value, 1, 120, state.view.autoCaptureIntervalS));
  state.view.autoCaptureMode = AUTO_CAPTURE_MODES.includes(ui.autoCaptureModeSelect.value) ? ui.autoCaptureModeSelect.value : 'time';
  state.view.autoCaptureDistanceCm = Math.round(clampNumber(ui.autoCaptureDistanceInput.value,
    AUTO_CAPTURE_DISTANCE_MIN_CM, AUTO_CAPTURE_DISTANCE_MAX_CM, state.view.autoCaptureDistanceCm));
  state.view.showTrail = ui.showTrail.checked;
  state.view.showPointQuality = ui.showPointQuality.checked;
  state.view.keepAwake = ui.keepAwake.checked;
  state.view.driveSpeedMin = clampNumber(ui.driveSpeedMinInput.value, 0.02, 0.34, state.view.driveSpeedMin);
  state.view.driveSpeedMax = clampNumber(ui.driveSpeedMaxInput.value, state.view.driveSpeedMin + 0.01, 0.50, state.view.driveSpeedMax);
  state.view.driveTurnMax = clampNumber(ui.driveTurnMaxInput.value, 0.20, 2.00, state.view.driveTurnMax);
  state.view.joystickScale = JOYSTICK_SCALES.includes(ui.joystickSizeSelect.value) ? ui.joystickSizeSelect.value : '1';
  state.view.handed = ui.handedSelect.value === 'left' ? 'left' : 'right';
  state.view.driveControl = ui.driveControlSelect.value === 'buttons' ? 'buttons' : 'joystick';
  // Gegen die aktuelle Hoechstgeschwindigkeit pruefen: Rangieren darf nie schneller werden.
  state.view.cursorSpeedCms = Math.round(clampNumber(ui.cursorSpeedInput.value,
    CURSOR_SPEED_MIN_CMS, Math.round(driveSpeedLimits().max * 100), state.view.cursorSpeedCms));
  state.view.driveZones = ui.driveZonesToggle.checked;
  // Eine laufende Fahrt wuerde sonst mit der Geschwindigkeit der alten Einstellung weiterlaufen,
  // bis der Finger losgelassen wird — das Menue ist aber ohnehin nur ohne Fahreingabe erreichbar.
  if (driveInputActive()) stopDrive();
  applyDriveControlMode();
  applyDriveZonePreferences();
  saveViewPreferences();
  refreshControlUi();
  renderMap();
}

function telemetryIsFresh() {
  const t = state.telemetry;
  return Number.isFinite(t.x) && Number.isFinite(t.y) && Date.now() - t.receivedAt < 6000;
}

function telemetryHasFix() {
  return telemetryIsFresh() && state.telemetry.solution === 2;
}

function xyDistance(a, b) {
  return a && b ? Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) : Infinity;
}

function ensureMapEditable({ silent = false } = {}) {
  if (!state.activeMap) return false;
  if (!state.activeMap.locked) return true;
  if (!silent) {
    ui.pointStatus.textContent = tr('mapLockedHint');
  }
  return false;
}

function pointQuality(point) {
  const solution = Number(point?.gps?.solution);
  const accuracy = Number(point?.gps?.accuracy);
  if (solution === 2 && Number.isFinite(accuracy) && accuracy <= 0.05) return 'excellent';
  if (solution === 2 && (!Number.isFinite(accuracy) || accuracy <= 0.12)) return 'good';
  if (solution === 2 || solution === 1) return 'warning';
  return 'bad';
}

function perimeterClosureCandidate() {
  const map = state.activeMap;
  if (!map || map.locked || state.mode !== 'perimeter' || map.perimeterClosed || !telemetryIsFresh()) return null;
  if (map.perimeter.length < 5) return null;
  if (pathLength(map.perimeter, false) < 5) return null;
  const distance = xyDistance(state.telemetry, map.perimeter[0]);
  if (!Number.isFinite(distance) || distance > 0.50) return null;
  return { distance };
}

async function closePerimeter({ automatic = false } = {}) {
  if (!ensureMapEditable() || !state.activeMap || !hasUsablePolygon(state.activeMap.perimeter)) return;
  pushUndo();
  state.activeMap.perimeterClosed = true;
  if (state.autoCaptureRunning) stopAutoCapture();
  await saveActiveMap();
  state.validationResult = null;
  renderMap();
  ui.pointStatus.textContent = tr('perimeterClosed');
  if (automatic) log('MAP', tr('perimeterClosed'));
}

function normalizeAngleRad(value) {
  let a = value;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

async function requestWakeLockIfNeeded() {
  if (!state.view.keepAwake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') {
    refreshWakeLockStatus();
    return;
  }
  if (state.wakeLock && !state.wakeLock.released) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => { state.wakeLock = null; refreshWakeLockStatus(); });
  } catch (error) {
    log('Wake Lock', error.message);
  }
  refreshWakeLockStatus();
}

async function releaseWakeLock() {
  const lock = state.wakeLock;
  state.wakeLock = null;
  if (lock && !lock.released) {
    try { await lock.release(); } catch (_) {}
  }
  refreshWakeLockStatus();
}

function refreshWakeLockStatus() {
  if (!ui.wakeLockStatus) return;
  if (!('wakeLock' in navigator)) ui.wakeLockStatus.textContent = tr('wakeLockUnavailable');
  else if (state.wakeLock && !state.wakeLock.released) ui.wakeLockStatus.textContent = tr('wakeLockActive');
  else ui.wakeLockStatus.textContent = state.view.keepAwake ? tr('wakeLockAuto') : tr('wakeLockReleased');
}

function mapPointCount(map) {
  return (map?.perimeter?.length || 0) + (map?.dockPoints?.length || 0) + (map?.waypoints?.length || 0)
    + (map?.exclusions || []).reduce((sum, ex) => sum + (ex.points?.length || 0), 0);
}

function mapNetArea(map) {
  if (!map?.perimeter?.length) return 0;
  return Math.max(0, polygonArea(map.perimeter) - (map.exclusions || []).reduce((sum, ex) => sum + polygonArea(ex.points || []), 0));
}

function rememberTrailPoint() {
  if (!telemetryIsFresh()) return;
  const p = { x: state.telemetry.x, y: state.telemetry.y, at: Date.now() };
  const last = state.trail[state.trail.length - 1];
  if (!last || xyDistance(last, p) >= 0.03) {
    state.trail.push(p);
    if (state.trail.length > 800) state.trail.splice(0, state.trail.length - 800);
  }
}

function refreshTelemetry() {
  const t = state.telemetry;
  rememberTrailPoint();
  updateBatteryChip();
  ui.firmwareValue.textContent = state.firmware ? `${state.firmware.firmware} ${state.firmware.version}` : 'Sunray';
  refreshCaptureState();
  renderMap();
}

function getSelectedPointArray() {
  const sel = state.selectedPoint;
  if (!state.activeMap || !sel) return null;
  if (sel.role === 'perimeter') return state.activeMap.perimeter;
  if (sel.role === 'dock') return state.activeMap.dockPoints;
  if (sel.role === 'waypoint') return state.activeMap.waypoints;
  if (sel.role === 'exclusion') {
    return state.activeMap.exclusions.find((e) => e.id === sel.exclusionId)?.points || null;
  }
  return null;
}

function getSelectedPoint() {
  const arr = getSelectedPointArray();
  const index = state.selectedPoint?.index;
  return Array.isArray(arr) && Number.isInteger(index) ? arr[index] || null : null;
}

function selectedPointLabel() {
  const sel = state.selectedPoint;
  if (!sel) return tr('noPointSelected');
  let label = tr('perimeter');
  if (sel.role === 'dock') label = tr('dockPath');
  if (sel.role === 'waypoint') label = tr('waypoints');
  if (sel.role === 'exclusion') {
    const exIndex = state.activeMap?.exclusions?.findIndex((e) => e.id === sel.exclusionId) ?? -1;
    const ex = exIndex >= 0 ? state.activeMap.exclusions[exIndex] : null;
    label = ex ? localizedExclusionName(ex, exIndex) : tr('exclusionArea');
  }
  // Der Konturzustand haengt unmittelbar an der Bezeichnung: „Ausschluss 1 · Punkt 3 · offen“.
  return tr('selectedPointInfo', { label, n: sel.index + 1 }) + contourStateSuffix(sel.role, sel.exclusionId);
}

function mowerDistanceToSelected() {
  const p = getSelectedPoint();
  const t = state.telemetry;
  const fresh = Number.isFinite(t.x) && Number.isFinite(t.y) && Date.now() - t.receivedAt < 6000;
  if (!p || !fresh) return null;
  return Math.hypot(t.x - p.x, t.y - p.y);
}

function selectedExclusion() {
  if (!state.selectedArea || !state.activeMap) return null;
  return state.activeMap.exclusions.find((e) => e.id === state.selectedArea) || null;
}

/** Loescht die ausgewaehlte Ausschlussflaeche — mit Rueckfrage, weil viele Punkte verloren gehen. */
async function deleteSelectedArea() {
  const exclusion = selectedExclusion();
  if (!exclusion || !ensureMapEditable()) return;
  const index = state.activeMap.exclusions.indexOf(exclusion);
  const confirmed = await askConfirm({
    title: tr('deleteAreaLabel'),
    message: tr('deleteAreaConfirm', { name: localizedExclusionName(exclusion, index) }),
    confirmLabel: tr('delete'),
    tone: 'danger',
  });
  if (!confirmed) return;
  pushUndo();
  state.activeMap.exclusions = state.activeMap.exclusions.filter((e) => e.id !== exclusion.id);
  state.selectedArea = null;
  state.selectedPoint = null;
  state.activeExclusionId = state.activeMap.exclusions[0]?.id || null;
  state.validationResult = null;
  renderElementList();
  await saveActiveMap();
  renderMap();
  refreshCaptureState();
  ui.pointStatus.textContent = tr('areaDeleted');
}

function clearPointSelection({ render = true } = {}) {
  state.selectedPoint = null;
  state.selectedArea = null;
  if (render) renderMap();
  refreshCaptureState();
}


// --- Kopfzeile ------------------------------------------------------------
function updateRtkBadge() {
  const t = state.telemetry;
  const fresh = telemetryIsFresh() && Number.isFinite(t.x) && Number.isFinite(t.y);
  ui.rtkBadge.classList.remove('fix', 'float', 'nofix', 'no-data');
  if (!fresh) {
    ui.rtkBadge.classList.add('no-data');
    ui.rtkText.textContent = tr('rtkNoData');
  } else if (t.solution === 2) {
    ui.rtkBadge.classList.add('fix');
    ui.rtkText.textContent = tr('rtkFix');
  } else if (t.solution === 1) {
    ui.rtkBadge.classList.add('float');
    ui.rtkText.textContent = tr('rtkFloat');
  } else {
    ui.rtkBadge.classList.add('nofix');
    ui.rtkText.textContent = tr('rtkNone');
  }
  // "Maeher/RTK-Station": sichtbare Satelliten des Rovers und der Basis.
  const mower = Number.isFinite(t.visibleSatellites) ? t.visibleSatellites : null;
  const station = Number.isFinite(t.visibleSatellitesDgps) ? t.visibleSatellitesDgps : null;
  ui.rtkSats.textContent = fresh && (mower !== null || station !== null)
    ? `${mower ?? '–'}/${station ?? '–'}`
    : '–/–';
}

function updateBatteryChip() {
  const volts = state.telemetry.batteryVoltage;
  ui.batteryValue.textContent = Number.isFinite(volts) ? `${volts.toFixed(1)} V` : '–';
  // Grobe Fuellstandsanzeige fuer eine 7s-LiIon-/Blei-Bank: 22 V leer, 29 V voll.
  const pct = Number.isFinite(volts) ? clampNumber((volts - 22) / 7 * 100, 0, 100, 0) : 0;
  ui.batteryFill.style.width = `${pct.toFixed(0)}%`;
  ui.batteryChip.classList.toggle('low', Number.isFinite(volts) && pct < 20);
  ui.batteryChip.classList.toggle('unknown', !Number.isFinite(volts));
}

// --- Akkordeon ------------------------------------------------------------
/** In einer Gruppe ist immer nur ein Abschnitt offen. */
function bindAccordion(container) {
  if (!container) return;
  const sections = [...(container.children || [])].filter((el) => el.tagName === 'DETAILS');
  sections.forEach((section) => section.addEventListener('toggle', () => {
    if (!section.open) return;
    sections.forEach((other) => { if (other !== section) other.open = false; });
  }));
}

// --- Hell/Dunkel ----------------------------------------------------------
const THEMES = ['system', 'light', 'dark'];
// Groessenstufen des Joysticks. '1' ist die bisherige, an die Bildschirmhoehe angepasste Groesse.
const JOYSTICK_SCALES = ['0.75', '1', '1.25', '1.5'];

/**
 * Groesse und Seite der Statusanzeige aus den Einstellungen anwenden. Die Groesse laeuft ueber
 * die CSS-Variable --joystick-scale, damit die vorhandene, bildschirmabhaengige Berechnung
 * erhalten bleibt und nur skaliert wird.
 */
/**
 * Ein einziger Schalter fuer die gesamte Haendigkeit: `data-handed` am <html>. Von dort haengen
 * alle gespiegelten Stellen im Stylesheet ab — Werkzeugleiste (Karteninfo gegen Werkzeuge),
 * Aufnahme-Cluster samt seiner Beschriftungen und die Fahrtanzeige neben dem Joystick.
 * Vorher sass das Attribut an der Fahrzone und betraf nur deren Anzeige; jede weitere Stelle
 * haette sonst ihre eigene Bedingung gebraucht.
 */
function applyHandedness() {
  // setAttribute statt dataset — dieselbe Schreibweise wie applyTheme().
  document.documentElement.setAttribute('data-handed', state.view.handed === 'left' ? 'left' : 'right');
}

/**
 * Der Hinweis auf eine absteigende Staffel: dauerhafte Zeile bei den Geschwindigkeitsfeldern,
 * kein Dialog — dasselbe Muster wie `#cassandraSkippedHint` neben den Export-Knoepfen. Er
 * **sperrt nichts**: die Zonen bleiben vollstaendig bedienbar, benannt wird nur ihre Reihenfolge.
 *
 * Gezeigt wird er nur, wenn die Staffel ueberhaupt wirkt — im Tastenmodus mit eingeschalteten
 * Zonen. Ohne Zonen gilt allein der mittlere Wert, es wird also nirgends langsamer; im
 * Joystick-Modus ist das betroffene Eingabefeld selbst ausgeblendet (`cursorSpeedRow`).
 */
/**
 * Der Hinweis auf zu schmale Drehtasten: dauerhafte Zeile bei der Groesseneinstellung, kein
 * Dialog — dasselbe Muster wie `#driveZoneOrderHint` und `#cassandraSkippedHint`. Er **sperrt
 * nichts** und **aendert nichts**: die Groesse bleibt, wie der Nutzer sie eingestellt hat,
 * benannt wird nur die Folge.
 *
 * Gezeigt nur im Tastenmodus — im Joystick-Modus gibt es keine Drehtasten, die zu schmal sein
 * koennten. Gemessen wird am tatsaechlich gezeichneten Feld (`getBoundingClientRect`), nicht an
 * der eingestellten Stufe: dieselbe Stufe ergibt auf verschiedenen Bildschirmen verschiedene
 * Feldgroessen, und genau davon haengt der Keil ab.
 */
function refreshTurnKeyHint() {
  const shape = driveShapeTokens();
  const rect = ui.driveButtons.getBoundingClientRect?.();
  const field = Math.min(rect?.width || 0, rect?.height || 0);
  const show = state.view.driveControl === 'buttons' && shape !== null && field > 0
    && turnKeyIncircle(field, shape.gap, shape.waist) < shape.keyMin;
  ui.driveTurnSizeHint.hidden = !show;
  ui.driveTurnSizeHint.textContent = show ? tr('driveTurnSizeHint') : '';
}

function refreshDriveZoneHint() {
  const ladder = cursorZoneLadder();
  const zonesApply = state.view.driveControl === 'buttons' && Boolean(state.view.driveZones);
  const show = zonesApply && ladder.descends;
  ui.driveZoneOrderHint.hidden = !show;
  ui.driveZoneOrderHint.textContent = show
    ? tr('driveZoneOrderHint', { slow: ladder.cms[0], normal: ladder.cms[1], fast: ladder.cms[2] })
    : '';
}

/**
 * Schaltet zwischen Joystick und Richtungstasten um. Beide sitzen in derselben Gitterspalte der
 * Fahrzone, es ist immer genau einer sichtbar — Groesseneinstellung, Fahrtanzeige und
 * Linkshaender-Spiegelung gelten deshalb unveraendert fuer beide.
 */
function applyDriveControlMode() {
  const buttons = state.view.driveControl === 'buttons';
  ui.driveJoystick.hidden = buttons;
  ui.driveButtons.hidden = !buttons;
  ui.driveModeBtn.classList.toggle('mode-buttons', buttons);
  ui.driveModeBtn.classList.toggle('mode-joystick', !buttons);
  // Symbol und Beschriftung benennen das **Ziel** des Tippens, nicht den Ist-Zustand — wie ein
  // Hell/Dunkel-Schalter, der im Hellen den Mond zeigt.
  ui.driveModeLabel.textContent = tr(buttons ? 'driveModeToJoystick' : 'driveModeToButtons');
  ui.driveModeBtn.setAttribute('aria-pressed', String(buttons));
  ui.cursorSpeedRow.hidden = !buttons;
  ui.driveZonesRow.hidden = !buttons;
  // Die Striche auf den Tasten haengen an derselben Groesse wie die Wirkung. Links und rechts
  // bleiben ohne Striche, das entscheidet das Stylesheet — sie haben keine Zonen.
  ui.driveButtons.classList.toggle('zones-on', Boolean(state.view.driveZones));
  refreshDriveZoneHint();
  // Nach dem Ein-/Ausblenden: vorher hat das Feld keine messbare Groesse.
  refreshTurnKeyHint();
}

/** Schnellumschalter in der Kartenleiste — dieselbe Einstellung wie im Menue. */
function toggleDriveControl() {
  stopDrive();
  state.view.driveControl = state.view.driveControl === 'buttons' ? 'joystick' : 'buttons';
  saveViewPreferences();
  applyDriveControlMode();
  applyViewPreferencesToUi();
}

function applyDriveZonePreferences() {
  const scale = JOYSTICK_SCALES.includes(state.view.joystickScale) ? state.view.joystickScale : '1';
  document.documentElement.style.setProperty('--joystick-scale', scale);
  // Die Zonengrenzen stehen nur in DRIVE_ZONES; das Stylesheet zeichnet die Striche und setzt die
  // Chevrons aus diesen beiden Variablen. Schriebe es eigene Prozentwerte, koennten Strich und
  // Wirkung auseinander laufen, ohne dass es jemandem auffaellt.
  // **Als blosser Anteil, nicht als Prozentwert:** das Stylesheet multipliziert ihn mit der
  // Tastenkante, weil `stroke-width` keine Prozente vertraegt (ein Prozentwert bezieht sich dort
  // auf die viewBox des SVG). Ein Prozentwert liesse sich nicht mit einer Laenge multiplizieren.
  document.documentElement.style.setProperty('--drive-zone-inner', `${DRIVE_ZONES[0].until}`);
  document.documentElement.style.setProperty('--drive-zone-outer', `${DRIVE_ZONES[1].until}`);
  applyHandedness();
  // Die Groessenstufe aendert das Feld und damit die Breite der Drehtasten.
  refreshTurnKeyHint();
}

function applyTheme() {
  const theme = THEMES.includes(state.view.theme) ? state.view.theme : 'system';
  // 'system' setzt kein Attribut: dann entscheidet prefers-color-scheme im Stylesheet.
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    const active = button.dataset.themeChoice === theme;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  state.view.theme = theme;
  saveViewPreferences();
  applyTheme();
}

// --- Rueckfragen ----------------------------------------------------------
/**
 * Bestaetigung im App-Design statt window.confirm(). Einzige Stelle fuer Rueckfragen;
 * gibt ein Promise<boolean> zurueck. Tests haengen ueber globalThis.__confirmAdapter eine
 * automatische Antwort ein — dieselbe Konvention wie bleAdapter() beim Bluetooth-Zugriff.
 */
function askConfirm({ title, message, confirmLabel, cancelLabel, tone = 'neutral', singleButton = false }) {
  if (typeof globalThis.__confirmAdapter === 'function') {
    return Promise.resolve(Boolean(globalThis.__confirmAdapter({ title, message, confirmLabel, cancelLabel, tone, singleButton })));
  }
  // Eine noch offene Rueckfrage gilt als abgelehnt, damit kein Promise haengen bleibt.
  if (state.pendingConfirm) confirmDialogRespond(false);
  return new Promise((resolve) => {
    state.pendingConfirm = resolve;
    ui.confirmDialogTitle.textContent = title;
    ui.confirmDialogText.textContent = message;
    ui.confirmDialogCancel.textContent = cancelLabel || tr('cancel');
    ui.confirmDialogInput.hidden = true;
    ui.confirmDialogSelect.hidden = true;
    ui.confirmDialogCancel.hidden = singleButton;
    ui.confirmDialogActions.classList.toggle('single', singleButton);
    ui.confirmDialogAccept.textContent = confirmLabel;
    ui.confirmDialogAccept.classList.toggle('danger', tone === 'danger');
    ui.confirmDialogAccept.classList.toggle('primary', tone !== 'danger');
    ui.confirmDialog.hidden = false;
  });
}

/**
 * Texteingabe im **selben** Dialog wie die Rueckfragen — ersetzt window.prompt(). Bewusst kein
 * zweites Modal: Escape, Klick auf den Hintergrund und die Knopflogik gibt es schon, ein
 * Nachbau waere eine zweite Stelle zum Pflegen. Liefert den eingegebenen Text oder null bei
 * Abbruch. In Tests haengt sich `globalThis.__promptAdapter` davor, wie bei askConfirm().
 */
function askText({ title, message, value = '', confirmLabel, cancelLabel, maxLength = MAP_NAME_MAX }) {
  if (typeof globalThis.__promptAdapter === 'function') {
    const answer = globalThis.__promptAdapter({ title, message, value, confirmLabel, maxLength });
    return Promise.resolve(answer === null || answer === undefined ? null : String(answer));
  }
  if (state.pendingConfirm) confirmDialogRespond(false);
  return new Promise((resolve) => {
    state.pendingConfirm = resolve;
    state.pendingConfirmText = true;
    ui.confirmDialogTitle.textContent = title;
    ui.confirmDialogText.textContent = message || '';
    ui.confirmDialogInput.hidden = false;
    ui.confirmDialogSelect.hidden = true;
    ui.confirmDialogInput.maxLength = maxLength;
    ui.confirmDialogInput.value = String(value || '');
    ui.confirmDialogCancel.textContent = cancelLabel || tr('cancel');
    ui.confirmDialogCancel.hidden = false;
    ui.confirmDialogActions.classList.remove('single');
    ui.confirmDialogAccept.textContent = confirmLabel || tr('save');
    ui.confirmDialogAccept.classList.remove('danger');
    ui.confirmDialogAccept.classList.add('primary');
    ui.confirmDialog.hidden = false;
    ui.confirmDialogInput.focus?.();
  });
}

/**
 * Auswahl aus einer Liste im **selben** Dialog wie Rueckfragen und Texteingabe — der vierte Modus
 * desselben Markups. Liefert den Wert des gewaehlten Eintrags oder `null` bei Abbruch.
 *
 * `options` ist eine Liste aus `{ value, label }`. Bewusst kein eigenes Modal: Escape,
 * Hintergrundklick und die Knopflogik stehen hier schon genau einmal, ein Nachbau waere eine
 * zweite Stelle zum Pflegen. In Tests haengt sich `globalThis.__choiceAdapter` davor, dieselbe
 * Konvention wie bei `askConfirm()` und `askText()`.
 */
function askChoice({ title, message, options, confirmLabel, cancelLabel }) {
  if (typeof globalThis.__choiceAdapter === 'function') {
    const answer = globalThis.__choiceAdapter({ title, message, options, confirmLabel });
    return Promise.resolve(answer === null || answer === undefined ? null : String(answer));
  }
  if (state.pendingConfirm) confirmDialogRespond(false);
  return new Promise((resolve) => {
    state.pendingConfirm = resolve;
    state.pendingConfirmChoice = true;
    ui.confirmDialogTitle.textContent = title;
    ui.confirmDialogText.textContent = message || '';
    ui.confirmDialogSelect.innerHTML = '';
    for (const option of options) {
      const el = document.createElement('option');
      el.value = String(option.value);
      el.textContent = option.label;
      ui.confirmDialogSelect.appendChild(el);
    }
    ui.confirmDialogSelect.value = String(options[0]?.value ?? '');
    ui.confirmDialogSelect.hidden = false;
    // Jeder Modus blendet die Felder der anderen ausdruecklich aus. `confirmDialogRespond()`
    // raeumt zwar am Ende auf, aber darauf zu bauen hiesse, dass die Reihenfolge der Aufrufe
    // ueber die Darstellung entscheidet — ein Dialog soll bei jedem Oeffnen derselbe sein.
    ui.confirmDialogInput.hidden = true;
    ui.confirmDialogCancel.textContent = cancelLabel || tr('cancel');
    ui.confirmDialogCancel.hidden = false;
    ui.confirmDialogActions.classList.remove('single');
    ui.confirmDialogAccept.textContent = confirmLabel || tr('okUnderstood');
    ui.confirmDialogAccept.classList.remove('danger');
    ui.confirmDialogAccept.classList.add('primary');
    ui.confirmDialog.hidden = false;
    ui.confirmDialogSelect.focus?.();
  });
}

/** Einseitige Meldung im selben Dialog — ersetzt window.alert(). */
function showNotice({ title, message, tone = 'neutral' }) {
  return askConfirm({ title, message, confirmLabel: tr('okUnderstood'), tone, singleButton: true })
    .then(() => undefined);
}

/**
 * Fehlgeschlagener Funkbefehl. Der Kurzhinweis steht immer sofort in der Kartenzeile (und bei
 * laufender Fahrt in der Fahrzeile); der Dialog kommt bei wiederkehrenden Fehlern nur alle
 * BLE_ERROR_NOTICE_INTERVAL_MS, sonst wuerde der 650-ms-Fahr-Heartbeat den Nutzer zuschuetten.
 * immediate = true erzwingt ihn — fuer Not-Halt und ausdrueckliche Tastendrucke.
 */
function reportBleError(context, error, { immediate = false } = {}) {
  const message = error?.message || String(error);
  log(context, message);
  const short = tr('bleWriteFailedShort', { message });
  if (ui.pointStatus) ui.pointStatus.textContent = short;
  if (ui.driveState && state.driveDirection) ui.driveState.textContent = short;
  const now = Date.now();
  if (!immediate && now - state.lastBleErrorNoticeAt < BLE_ERROR_NOTICE_INTERVAL_MS) return;
  state.lastBleErrorNoticeAt = now;
  showNotice({ title: tr('bleWriteFailedTitle'), message: tr('bleWriteFailed', { context, message }), tone: 'danger' });
}

/** Sammelstelle fuer Fehler aus Nutzeraktionen: sichtbare Meldung statt stiller Konsole. */
function reportError(error) {
  log('FEHLER', error?.message || String(error));
  return showNotice({ title: tr('errorTitle'), message: error?.message || String(error), tone: 'danger' });
}

function confirmDialogRespond(answer) {
  const resolve = state.pendingConfirm;
  const wasText = state.pendingConfirmText;
  const wasChoice = state.pendingConfirmChoice;
  const text = ui.confirmDialogInput.value;
  const choice = ui.confirmDialogSelect.value;
  state.pendingConfirm = null;
  state.pendingConfirmText = false;
  state.pendingConfirmChoice = false;
  ui.confirmDialog.hidden = true;
  ui.confirmDialogInput.hidden = true;
  ui.confirmDialogSelect.hidden = true;
  if (!resolve) return;
  // Drei Antwortarten aus einem Dialog: gewaehlter Wert, eingegebener Text, Wahrheitswert.
  // Abbruch ist in den ersten beiden Faellen `null`, damit der Aufrufer ihn von einer leeren
  // Eingabe unterscheiden kann.
  if (wasChoice) resolve(answer ? choice : null);
  else resolve(wasText ? (answer ? text : null) : Boolean(answer));
}

// --- Menueseite -----------------------------------------------------------
function setMenuOpen(open, { section = null } = {}) {
  state.menuOpen = Boolean(open);
  ui.menuPage.hidden = !state.menuOpen;
  document.body.classList.toggle('menu-open', state.menuOpen);
  if (state.menuOpen) {
    stopDrive();
    if (state.autoCaptureRunning) stopAutoCapture();
    // Altlasten aus frueheren Sitzungen: die Kartenuebersicht zeigt keine leeren Platzhalter.
    if (pruneEmptyExclusions()) saveActiveMap().catch(reportError);
    renderElementList();
    // Die Export-Knoepfe stehen auf dieser Seite. Ihr Zustand haengt an der Geometrie, die sich
    // seit dem letzten `renderMapControls()` geaendert haben kann — hier ist der letzte Moment,
    // bevor der Nutzer sie sieht, und `pruneEmptyExclusions()` ist gerade durchgelaufen.
    refreshExportButtons();
    if (section) { const el = document.getElementById(section); if (el) el.open = true; }
    ui.menuPage.scrollTop = 0;
  } else {
    renderMap();
  }
}

// --- Aufnahme-Button ------------------------------------------------------
const CAPTURE_HOLD_MS = 550;

function cancelCaptureHold() {
  if (state.captureHold?.timer) clearInterval(state.captureHold.timer);
  state.captureHold = null;
  ui.addPointBtn.classList.remove('holding');
  ui.captureProgress.style.setProperty('--capture-progress', '0');
}

/**
 * Verschiebt der Hauptknopf, statt aufzunehmen? **Die einzige Stelle, die das entscheidet** —
 * Beschriftung, Symbol, Haltegeste, Tippgeste und die Aktion selbst lesen alle hier, damit der
 * Knopf nicht eines sagt und ein anderes tut.
 *
 * Ja bei ausgewaehltem Punkt — aber **nicht** waehrend einer laufenden Erweiterung
 * (`phase === 'adding'`). Dort fordert der Hinweisstreifen zum Aufnehmen auf, und der Griff
 * ueberschrieb stattdessen eine bestehende Ecke: genau die Kontur, die gerade erweitert wird.
 * Verschoben wird dort ueber den eigenen Knopf `#movePointBtn`, der dieselbe Funktion ruft.
 */
function captureButtonMoves() {
  if (!state.selectedPoint || !getSelectedPoint()) return false;
  return state.extension?.phase !== 'adding';
}

/** Aufnahme erfordert Halten, damit Wischen/Zoomen auf der Karte nichts ausloest. */
function beginCaptureHold(event) {
  if (ui.addPointBtn.disabled || captureButtonMoves()) return;
  event.preventDefault();
  cancelCaptureHold();
  try { ui.addPointBtn.setPointerCapture(event.pointerId); } catch (_) {}
  ui.addPointBtn.classList.add('holding');
  const startedAt = Date.now();
  state.captureHold = {
    pointerId: event.pointerId,
    timer: setInterval(() => {
      const ratio = Math.min(1, (Date.now() - startedAt) / CAPTURE_HOLD_MS);
      ui.captureProgress.style.setProperty('--capture-progress', ratio.toFixed(3));
      if (ratio >= 1) {
        cancelCaptureHold();
        addCurrentPoint().catch((error) => { ui.pointStatus.textContent = error.message; log('CAPTURE', error.message); });
      }
    }, 40),
  };
}

/** Verschiebt der Knopf gerade, genuegt ein Tap; zum Aufnehmen wird weiterhin gehalten. */
function captureButtonTap() {
  if (ui.addPointBtn.disabled || !captureButtonMoves()) return;
  addCurrentPoint().catch((error) => { ui.pointStatus.textContent = error.message; log('CAPTURE', error.message); });
}

// --- Karte: Tap, Verschieben, Pinch-Zoom ----------------------------------
function gesturePointers() {
  return state.gesture ? [...state.gesture.pointers.values()] : [];
}

function onMapPointerDown(event) {
  if (!state.gesture) {
    state.gesture = { pointers: new Map(), moved: false, startedAt: Date.now(), pinch: null, start: { x: event.clientX, y: event.clientY } };
  }
  state.gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  try { ui.mapSvg.setPointerCapture(event.pointerId); } catch (_) {}
  if (state.gesture.pointers.size === 2) {
    const [a, b] = gesturePointers();
    beginCustomViewport();
    const mid = pointerToViewBox({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
    state.gesture.moved = true;
    state.gesture.pinch = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      zoom: state.viewport.zoom,
      mid,
      base: { x: (mid.x - state.viewport.dx) / state.viewport.zoom, y: (mid.y - state.viewport.dy) / state.viewport.zoom },
    };
  }
}

function onMapPointerMove(event) {
  const gesture = state.gesture;
  if (!gesture || !gesture.pointers.has(event.pointerId)) return;
  const previous = gesture.pointers.get(event.pointerId);
  gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const metrics = svgMetrics();

  if (gesture.pointers.size >= 2 && gesture.pinch) {
    const [a, b] = gesturePointers();
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mid = pointerToViewBox({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
    state.viewport.zoom = clampNumber(gesture.pinch.zoom * (distance / gesture.pinch.distance), MIN_USER_ZOOM, MAX_USER_ZOOM, 1);
    state.viewport.dx = mid.x - gesture.pinch.base.x * state.viewport.zoom;
    state.viewport.dy = mid.y - gesture.pinch.base.y * state.viewport.zoom;
    clampViewport();
    renderMap();
    return;
  }

  if (!gesture.moved) {
    // Erst ab 8 px Gesamtweg wird geschoben; darunter bleibt es ein Tap.
    if (Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) < 8) return;
    gesture.moved = true;
    beginCustomViewport();
  }
  state.viewport.dx += (event.clientX - previous.x) / metrics.scale;
  state.viewport.dy += (event.clientY - previous.y) / metrics.scale;
  clampViewport();
  renderMap();
}

function onMapPointerUp(event) {
  const gesture = state.gesture;
  if (!gesture) return;
  gesture.pointers.delete(event.pointerId);
  if (gesture.pointers.size > 0) { gesture.pinch = null; return; }
  const wasTap = !gesture.moved && Date.now() - gesture.startedAt < 500;
  state.gesture = null;
  if (wasTap && event.type === 'pointerup') handleMapTap(event);
}


function refreshCaptureState() {
  const t = state.telemetry;
  const fresh = telemetryIsFresh();
  const coords = Number.isFinite(t.x) && Number.isFinite(t.y);
  const hasTrueFix = telemetryHasFix();
  const blockedByFixRule = ui.fixOnly.checked && !hasTrueFix;
  const hasMap = Boolean(state.activeMap);
  const mapLocked = Boolean(state.activeMap?.locked);
  const selected = state.selectedPoint ? getSelectedPoint() : null;
  const areaSelected = Boolean(selectedExclusion());
  // Waehrend der Aufnahmephase einer Erweiterung haengt der Hauptknopf an, auch bei Auswahl.
  const moves = captureButtonMoves();

  updateRtkBadge();
  const auto = state.autoCaptureRunning;
  const button = ui.addPointBtn;
  button.classList.remove('capture-fix', 'capture-warning', 'capture-blocked', 'capture-idle', 'capture-stop');
  button.classList.toggle('move-mode', moves);
  // Automatik ersetzt den manuellen Knopf, statt neben ihm zu stehen.
  ui.captureCluster.classList.toggle('auto-active', auto);
  // Der ganze Block inklusive Beschriftung verschwindet, nicht nur der Knopf.
  // Bei ausgewaehlter Flaeche bleibt nur der Papierkorb stehen: aufnehmen laesst sich in
  // diesem Zustand nichts, es geht ausschliesslich um die Flaeche.
  ui.captureFabWrap.hidden = auto || areaSelected;
  // Das eingestellte Intervall steht in beiden Zustaenden im Label. Nur im laufenden Zustand
  // waere es unsichtbar, solange kein Maeher verbunden ist — dann bleibt der Knopf gesperrt.
  // Die Einheit folgt dem gewaehlten Modus, damit auf der Karte ablesbar bleibt, wonach die
  // Automatik ueberhaupt ausloest.
  ui.autoCaptureLabel.textContent = state.view.autoCaptureMode === 'distance'
    ? tr(auto ? 'autoCaptureDistOn' : 'autoCaptureDist', { distance: state.view.autoCaptureDistanceCm })
    : tr(auto ? 'autoCaptureOn' : 'autoCapture', { seconds: state.view.autoCaptureIntervalS });
  ui.autoCaptureBtn.setAttribute('aria-pressed', String(auto));
  // `captureTarget()` ist auch hier die eine Auskunft: was der Aufnahmeweg ablehnt, darf der
  // Automatik-Knopf nicht anbieten.
  const captureBlockKey = hasMap ? captureTarget().blockKey : null;
  ui.autoCaptureBtn.disabled = mapLocked || (!auto && (Boolean(captureBlockKey) || !(hasMap && fresh && coords && !blockedByFixRule)));
  // Mit ausgewaehltem Punkt geht es ums Verschieben, nicht ums Aufnehmen: die Automatik
  // hat in diesem Zustand nichts zu suchen.
  ui.autoFabWrap.hidden = Boolean(selected) || areaSelected;
  // Der Verschieben-Knopf nimmt den frei gewordenen Platz des Automatik-Knopfes ein. Beide
  // haengen bewusst an **derselben** Groesse `selected`, koennen sich also nicht ueberlagern.
  ui.moveFabWrap.hidden = !(selected && !moves) || areaSelected;
  // Beschriftung aus `tr()` statt aus `data-i18n` — wie beim Automatik-Knopf daneben, dessen
  // Platz er einnimmt, und damit der Sprachwechsel ihn ohne Umweg erreicht.
  ui.moveFabLabel.textContent = tr('movePoint');
  ui.movePointBtn.setAttribute('aria-label', tr('movePointAction'));
  // Bedienbar unter denselben Bedingungen, unter denen der Hauptknopf frueher verschoben hat.
  ui.movePointBtn.disabled = mapLocked || !fresh || !coords || blockedByFixRule;
  refreshDeleteButton();
  // Der Rueckgaengig-Knopf folgt derselben Regel wie der Papierkorb: waehrend der Automatik
  // ausgeblendet, damit ueber der Fahrzone nur der grosse Pause-Knopf steht.
  ui.undoFabWrap.hidden = state.autoCaptureRunning || mapLocked || !state.activeMap;
  // Einfuegen ergibt nur mit ausgewaehltem Einzelpunkt Sinn — dort, wo der Hauptknopf auf
  // „Verschieben“ steht. Ohne Auswahl, bei Flaechenauswahl und waehrend der Automatik weg.
  refreshExtendButton();
  // Waehrend einer Erweiterung waeren die Einfuegen-Werkzeuge nur verwechselbar: dort geht es um
  // das Anhaengen am offenen Ende, nicht um Zwischenpunkte.
  const canInsert = Boolean(selected) && !areaSelected && !state.autoCaptureRunning && !mapLocked
    && !state.extension;
  ui.insertBeforeWrap.hidden = !canInsert;
  ui.insertAfterWrap.hidden = !canInsert;
  // Am Rand einer offenen Kontur fehlt die Strecke, auf der der neue Punkt liegen wuerde:
  // der Knopf bleibt sichtbar (kein Springen der Leiste), ist aber ausgegraut.
  const insertTarget = canInsert ? getSelectedPointArray() : null;
  const insertClosed = canInsert && selectedContourClosed(state.selectedPoint);
  const neighbourFor = (offset) => (insertTarget
    ? insertNeighbourIndex(insertTarget, state.selectedPoint.index, offset, insertClosed) : -1);
  ui.insertBeforeBtn.disabled = neighbourFor(0) < 0;
  ui.insertAfterBtn.disabled = neighbourFor(1) < 0;
  refreshUndoButton();
  ui.closeAndNewWrap.hidden = !canCloseAndStartNew();
  refreshContourStatus();
  refreshGpsScatter();
  // In der Leiste steht nur noch die Werkzeuggruppe. Sind alle Werkzeuge ausgeblendet (etwa
  // waehrend der Automatik), bliebe sonst ein leerer Streifen samt Trennlinie stehen und
  // naehme der Karte Hoehe weg.
  refreshToolbarVisibility();
  // Im Verschieben-Zustand gibt es kein Halten: eine laufende Halteaktion wird verworfen.
  // (Nicht umgekehrt: ein laufendes Halten darf nicht von der 2-s-Telemetrie abgebrochen werden.)
  // Ausschlaggebend ist die **Wirkung** des Knopfes, nicht die blosse Auswahl: waehrend der
  // Aufnahmephase einer Erweiterung nimmt er auch mit ausgewaehltem Punkt auf, und jeder
  // Telemetrie-Takt haette das Halten sonst wieder abgebrochen.
  if (moves || auto) cancelCaptureHold();

  const show = (cls, title, hint, status) => {
    button.classList.add(cls);
    ui.captureButtonTitle.textContent = title;
    ui.captureButtonHint.textContent = hint;
    if (status !== undefined) ui.pointStatus.textContent = status;
  };
  const solution = () => solutionNameLocalized(t.solution);

  if (mapLocked) {
    button.disabled = true;
    show('capture-blocked', tr('mapLocked'), tr('mapLockedHint'), tr('mapLockedHint'));
    return;
  }

  // Ausgewaehlter Punkt: der Hauptbutton wird zum Verschieben-Button (ein Tap genuegt).
  // Waehrend der Aufnahmephase einer Erweiterung nicht — dort haengt er an, und das Verschieben
  // hat seinen eigenen Knopf. Genau diese Unterscheidung trifft `captureButtonMoves()`.
  if (moves) {
    const distance = mowerDistanceToSelected();
    button.disabled = !fresh || !coords || blockedByFixRule;
    const label = `${selectedPointLabel()}${Number.isFinite(distance) ? ` · ${distance.toFixed(2)} m` : ''}`;
    if (!fresh || !coords) show('capture-idle', tr('movePoint'), tr('noCurrentXY'), label);
    else if (blockedByFixRule) show('capture-blocked', tr('noRtkFix'), tr('captureBlocked', { solution: solution() }), label);
    else show(hasTrueFix ? 'capture-fix' : 'capture-warning', tr('movePoint'), tr('movePointHint'), label);
    return;
  }

  if (state.mode === 'perimeter' && state.activeMap?.perimeterClosed) {
    button.disabled = true;
    // Seit v71 oeffnet ein Tipp den Ring **nicht** mehr. Der Knopf ist deshalb gesperrt und
    // benennt den Hinderungsgrund — dieselbe Bauart wie der Zweig „Kein RTK FIX“ —, waehrend die
    // Statuszeile den Ausweg nennt. Sie wiederholt dabei bewusst **nicht** das Zustandswort, das
    // schon im Konturfeld steht (das war der gemeldete Fehler aus v45), sondern sagt nur, was zu
    // tun ist; die ausgeschriebene Fassung bleibt als Vorlesehilfe am Knopf.
    show('capture-blocked', tr('perimeterClosedTitle'), tr('perimeterClosedCapture'), tr('perimeterReopenHint'));
    return;
  }

  const startsNewArea = state.mode === 'exclusion' && hasMap && captureTarget().startsNewArea === true;
  const closeCandidate = state.mode === 'perimeter' ? perimeterClosureCandidate() : null;
  if (closeCandidate && !state.autoCaptureRunning) {
    button.disabled = false;
    const hint = tr('perimeterNearStart', { distance: closeCandidate.distance.toFixed(2) });
    show('capture-fix', tr('closePerimeter'), hint, hint);
    return;
  }

  if (auto) {
    ui.autoCaptureState.textContent = tr('autoCaptureRunning', { count: state.autoCaptureCount });
    return;
  }
  ui.autoCaptureState.textContent = tr('autoCaptureOff');

  button.disabled = !(hasMap && fresh && coords) || blockedByFixRule;
  if (!hasMap) show('capture-idle', tr('noMapActive'), tr('createMapFirst'), tr('pleaseCreateMap'));
  else if (!fresh || !coords) show('capture-idle', tr('waitPosition'), tr('noCurrentXY'), tr('noCurrentPosition'));
  else if (blockedByFixRule) show('capture-blocked', tr('noRtkFix'), tr('captureBlocked', { solution: solution() }), tr('pointBlocked', { solution: solution() }));
  // Beginnt der naechste Punkt eine neue Ausschlussflaeche, sagt der Knopf das auch — sonst
  // verspraeche „Punkt aufnehmen“ ein Anhaengen an die geschlossene Flaeche daneben.
  else if (hasTrueFix) show('capture-fix', tr(startsNewArea ? 'captureNewArea' : 'capturePoint'), tr('holdToCapture'), tr('readyPoint', { x: t.x.toFixed(2), y: t.y.toFixed(2) }));
  else show('capture-warning', tr(startsNewArea ? 'captureNewAreaAnyway' : 'captureAnyway'), tr('noTrueFix', { solution: solution() }), tr('warningPoint', { solution: solution() }));
}

function handleLine(rawLine) {
  const line = rawLine.trim();
  if (line) { state.bleRxLines += 1; state.lastBleRxAt = Date.now(); }
  if (!line) return;
  log('RX', line);

  if (line.startsWith('V,')) {
    const parsed = SunrayProtocol.parseVersion(line);
    if (!parsed) return;
    state.firmware = parsed;
    state.pendingStateReplies = 0;
    state.encryptionEnabled = parsed.encryptionEnabled;
    state.encryptionChallenge = parsed.challenge;
    if (parsed.encryptionEnabled) {
      state.encryptionKey = SunrayProtocol.deriveEncryptionKey(ui.passwordInput.value, parsed.challenge);
      if (state.encryptionKey === null) {
        setConnectionDetail('encryptionInvalid');
      } else {
        setConnectionDetail('connectedEncrypted', { firmware: parsed.firmware, version: parsed.version });
      }
    } else {
      state.encryptionKey = null;
      setConnectionDetail('connectedPlain', { firmware: parsed.firmware, version: parsed.version });
    }
    if (!parsed.checksumValid) log(tr('checksumVersion'));
    if (state.pendingVersion) {
      state.pendingVersion(parsed);
      state.pendingVersion = null;
    }
    refreshTelemetry();
    return;
  }

  if (line.startsWith('S,')) {
    const parsed = SunrayProtocol.parseState(line);
    if (!parsed) return;
    state.pendingStateReplies = 0;
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      state.fixHistory.push({ x: parsed.x, y: parsed.y, at: Date.now() });
      if (state.fixHistory.length > POSITION_SMOOTHING_MAX_SAMPLES) state.fixHistory.shift();
      rememberScatter();
    }
    state.telemetry = {
      x: parsed.x,
      y: parsed.y,
      delta: parsed.delta,
      solution: parsed.solution,
      age: parsed.age,
      accuracy: parsed.accuracy,
      visibleSatellites: parsed.visibleSatellites,
      visibleSatellitesDgps: parsed.visibleSatellitesDgps,
      batteryVoltage: parsed.batteryVoltage,
      receivedAt: Date.now(),
    };
    if (!parsed.checksumValid) log(tr('checksumState'));
    refreshTelemetry();
  }
}

function onNotification(event) {
  const text = new TextDecoder().decode(event.target.value);
  state.rxBuffer += text;
  if (state.rxBuffer.length > BLE_RX_BUFFER_LIMIT) {
    // Daten ohne Zeilenende liessen den Puffer frueher unbegrenzt wachsen. Der Rest wird
    // verworfen; die Auswertung faengt sich beim naechsten \n von selbst wieder.
    state.rxOverflows += 1;
    log('BLE', `RX buffer overflow #${state.rxOverflows}: ${state.rxBuffer.length} bytes without a line break, discarding`);
    state.rxBuffer = '';
    if (state.rxOverflows >= BLE_RX_OVERFLOW_LIMIT) {
      // Wiederholter Ueberlauf heisst: der Datenstrom ist kaputt, nicht nur einmal gestoert.
      dropStaleLink('bleProtocolError');
    }
    return;
  }
  const lines = state.rxBuffer.split(/\r?\n/);
  state.rxBuffer = lines.pop() || '';
  lines.forEach(handleLine);
}

async function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeChunk(chunk) {
  // Web Bluetooth + ESP32 is substantially more stable when each GATT write is acknowledged.
  // The Sunray FFE1 characteristic supports WRITE and WRITE_NR, so prefer WRITE here.
  if (typeof state.characteristic.writeValueWithResponse === 'function' && state.characteristic.properties.write) {
    await state.characteristic.writeValueWithResponse(chunk);
  } else if (typeof state.characteristic.writeValue === 'function' && state.characteristic.properties.write) {
    await state.characteristic.writeValue(chunk);
  } else if (typeof state.characteristic.writeValueWithoutResponse === 'function' && state.characteristic.properties.writeWithoutResponse) {
    await state.characteristic.writeValueWithoutResponse(chunk);
  } else {
    throw new Error('BLE characteristic is not writable');
  }
}

/**
 * Schliesst ein angefangenes Kommando in der Firmware ab.
 *
 * Kommandos gehen in 15-Byte-Chunks raus. Scheitert ein Chunk in der Mitte, stehen die schon
 * gesendeten Chunks ohne Zeilenende im rxBuf des ESP32 — das naechste, erfolgreiche Kommando
 * klebt daran fest, und die Firmware sieht eine einzige verstuemmelte Zeile. Beide Kommandos
 * sind damit verloren, obwohl die Verbindung steht. Ein einzelnes '\n' beendet das Bruchstueck:
 * die Firmware verwirft es an der Pruefsumme, und das naechste Kommando faengt sauber an.
 * Best effort — scheitert auch das, bleibt es beim urspruenglichen Fehler.
 */
async function resyncAfterPartialWrite() {
  try {
    await writeChunk(new TextEncoder().encode('\n'));
    log('BLE', tr('bleResyncDone'));
  } catch (error) {
    log('BLE', tr('bleResyncFailed', { message: error?.message || String(error) }));
  }
}

async function writeBytes(bytes) {
  if (!state.characteristic) throw new Error(tr('errorNoCharacteristic'));
  let written = 0;
  for (let i = 0; i < bytes.length; i += BLE_CHUNK_SIZE) {
    const chunk = bytes.slice(i, i + BLE_CHUNK_SIZE);
    try {
      await writeChunk(chunk);
    } catch (error) {
      // Nur wenn schon etwas rausging, liegt ein Bruchstueck in der Firmware.
      if (written > 0) await resyncAfterPartialWrite();
      throw error;
    }
    written += 1;
    if (i + BLE_CHUNK_SIZE < bytes.length) await sleepMs(BLE_INTER_CHUNK_DELAY_MS);
  }
}

async function sendSunray(command, { forcePlain = false, useChecksum = true, skipIfBusy = false } = {}) {
  if (!state.connected || !state.characteristic) throw new Error(tr('errorNotConnected'));
  if (skipIfBusy && state.sendBusy) return false;
  while (state.sendBusy) await sleepMs(8);
  state.sendBusy = true;
  try {
    let payload = useChecksum ? SunrayProtocol.withChecksum(command) : command;
    if (!forcePlain && state.encryptionEnabled) {
      if (state.encryptionKey === null) throw new Error(tr('errorPassword'));
      payload = SunrayProtocol.encryptPrintable(payload, state.encryptionKey);
      log(`TX ${command}`, tr('encrypted'));
    } else {
      log('TX', payload);
    }
    const bytes = new TextEncoder().encode(`${payload}\n`);
    await writeBytes(bytes);
    state.bleTxCommands += 1;
    return true;
  } finally {
    state.sendBusy = false;
  }
}

function waitForVersion(timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (state.pendingVersion) state.pendingVersion = null;
      resolve(null);
    }, timeoutMs);
    state.pendingVersion = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
  });
}

async function initializeSunrayHandshake() {
  state.encryptionEnabled = false;
  state.encryptionKey = null;
  const wait1 = waitForVersion(1800);
  await sendSunray('AT+V', { forcePlain: true, useChecksum: true });
  let version = await wait1;
  if (!version) {
    log(tr('noVersionChecksumRetry'));
    const wait2 = waitForVersion(1800);
    await sendSunray('AT+V', { forcePlain: true, useChecksum: false });
    version = await wait2;
  }
  if (!version) {
    setConnectionDetail('noVersionReply');
    log('WARN', tr('noVersionLog'));
  }
}

function startPolling() {
  stopPolling();
  const poll = () => {
    if (!state.connected || !state.characteristic) return;
    // Do not queue status requests directly on top of manual-drive traffic.
    if (state.sendBusy || (performance.now() - state.lastDriveSentAt < 220)) return;
    sendSunray('AT+S', { skipIfBusy: true })
      .then((sent) => { if (sent !== false) state.pendingStateReplies += 1; })
      .catch((error) => reportBleError('AT+S', error));
  };
  state.pendingStateReplies = 0;
  poll();
  state.pollTimer = setInterval(poll, BLE_POLL_INTERVAL_MS);
}

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

// --- RX-Watchdog ----------------------------------------------------------
// Ein GATT-Link kann "connected" melden und trotzdem nichts mehr liefern (ESP32-Reboot,
// abgerissene Notify-Kette, Supervision-Timeout, den Chrome noch nicht gemeldet hat).
// state.lastBleRxAt wurde bisher nur gepflegt, aber nie ausgewertet.

function startRxWatchdog() {
  stopRxWatchdog();
  state.lastBleRxAt = Date.now();
  state.rxWatchdogTimer = setInterval(checkRxWatchdog, BLE_RX_CHECK_INTERVAL_MS);
}

function stopRxWatchdog() {
  if (state.rxWatchdogTimer) clearInterval(state.rxWatchdogTimer);
  state.rxWatchdogTimer = null;
}

function checkRxWatchdog() {
  if (!state.connected || state.demo || !state.characteristic) return;
  if (state.pendingStateReplies >= BLE_UNANSWERED_POLL_LIMIT) {
    log('BLE', `${state.pendingStateReplies} status requests unanswered, dropping link`);
    dropStaleLink('bleNoAnswer');
    return;
  }
  const silenceMs = Date.now() - state.lastBleRxAt;
  if (silenceMs < BLE_RX_TIMEOUT_MS) return;
  log('BLE', `RX watchdog: ${Math.round(silenceMs / 1000)}s without data, dropping link`);
  dropStaleLink('bleLinkStalled');
}

/**
 * Trennt einen Link, der faktisch tot ist. Der Abbau laeuft ueber denselben Pfad wie ein
 * echter Funkabriss: gatt.disconnect() feuert gattserverdisconnected -> onDisconnected().
 * Nur wenn kein GATT mehr haengt, wird onDisconnected() direkt aufgerufen.
 */
function dropStaleLink(reasonKey) {
  stopRxWatchdog();
  stopPolling();
  stopIdleStopTicker();
  state.disconnectReasonKey = reasonKey;
  const device = state.device;
  if (device?.gatt?.connected) {
    try { device.gatt.disconnect(); } catch (error) { log('BLE', error.message); }
    // Sicherheitsnetz: bleibt gattserverdisconnected wider Erwarten aus, raeumen wir selbst auf.
    // Die Bedingung schliesst aus, dass ein inzwischen gelungener Reconnect getroffen wird.
    setTimeout(() => {
      if (state.connected && state.device === device && !device.gatt?.connected) onDisconnected();
    }, 500);
    return;
  }
  onDisconnected();
}

async function establishGatt(device, { reconnecting = false } = {}) {
  state.server = await device.gatt.connect();
  const service = await state.server.getPrimaryService(SERVICE_UUID);
  state.characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
  await state.characteristic.startNotifications();
  state.characteristic.addEventListener('characteristicvaluechanged', onNotification);
  state.rxBuffer = '';
  state.rxOverflows = 0;
  state.pendingStateReplies = 0;
  state.lastBleErrorNoticeAt = 0; // neue Verbindung: der erste Fehler wird wieder gezeigt
  state.sendBusy = false;
  state.bleConnectedAt = Date.now();
  state.bleTxCommands = 0;
  state.bleRxLines = 0;
  state.lastBleRxAt = 0;
  setConnectionStatus(true, 'bleConnected', 'connectedWith', { name: device.name || 'Ardumower' });
  const props = state.characteristic.properties;
  log('BLE', `GATT ready · write=${Boolean(props.write)} · writeNR=${Boolean(props.writeWithoutResponse)} · mode=${props.write ? 'with-response' : 'without-response'}`);
  await initializeSunrayHandshake();
  startPolling();
  startRxWatchdog();
  startIdleStopTicker();
  state.reconnectAttempts = 0;
  if (reconnecting) log('BLE', 'automatic reconnect successful');
}

async function connectBluetooth() {
  const adapter = bleAdapter();
  if (!adapter) throw new Error(tr('noWebBluetooth'));
  stopDemo();
  state.manualDisconnect = false;
  state.reconnectAttempts = 0;
  if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
  setConnectionDetail('openingPicker');
  const device = await adapter.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
    optionalServices: [SERVICE_UUID],
  });
  device.addEventListener('gattserverdisconnected', onDisconnected);
  state.device = device;
  setConnectionDetail('connectingDevice', { name: device.name || tr('bleDevice') });
  await establishGatt(device);
}

function scheduleReconnect(device) {
  if (state.manualDisconnect || !device || state.reconnectTimer) return;
  if (state.reconnectAttempts >= BLE_MAX_RECONNECT_ATTEMPTS) { giveUpReconnect(device); return; }
  const delays = [1000, 2500, 5000, 10000, 15000];
  const attempt = Math.min(state.reconnectAttempts, delays.length - 1);
  const delay = delays[attempt];
  state.reconnectAttempts += 1;
  log('BLE', `reconnect attempt ${state.reconnectAttempts} in ${delay} ms`);
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    if (state.manualDisconnect || state.connected) return;
    try {
      await establishGatt(device, { reconnecting: true });
    } catch (error) {
      log('BLE reconnect', error.message);
      scheduleReconnect(device);
    }
  }, delay);
}

/**
 * Endzustand nach erschoepften Reconnect-Versuchen: alles loesen, klar melden und die
 * Wiederverbindung dem Nutzer ueberlassen. Vorher blieb state.device gesetzt und die
 * Oberflaeche haengte still auf "Bluetooth getrennt".
 */
function giveUpReconnect(device) {
  if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
  stopPolling();
  stopRxWatchdog();
  stopIdleStopTicker();
  const target = device || state.device;
  if (target?.removeEventListener) {
    try { target.removeEventListener('gattserverdisconnected', onDisconnected); } catch (error) { log('BLE', error.message); }
  }
  state.device = null;
  state.server = null;
  state.characteristic = null;
  state.reconnectAttempts = 0;
  log('BLE', `giving up after ${BLE_MAX_RECONNECT_ATTEMPTS} reconnect attempts`);
  setConnectionStatus(false, 'notConnected', 'reconnectGaveUp');
}

function onDisconnected() {
  const device = state.device;
  const duration = state.bleConnectedAt ? Math.round((Date.now() - state.bleConnectedAt) / 1000) : 0;
  const reasonKey = state.disconnectReasonKey || 'bluetoothDisconnected';
  state.disconnectReasonKey = null;
  stopPolling();
  stopRxWatchdog();
  stopIdleStopTicker();
  state.characteristic = null;
  state.server = null;
  state.sendBusy = false;
  state.encryptionEnabled = false;
  state.encryptionKey = null;
  stopDrive({ send: false });
  setConnectionStatus(false, 'notConnected', reasonKey);
  log(tr('bleDisconnectedLog'), `after ${duration}s · TX=${state.bleTxCommands} · RX=${state.bleRxLines}`);
  if (!state.manualDisconnect) scheduleReconnect(device);
  else state.device = null;
}

async function disconnectBluetooth() {
  if (state.demo) {
    stopDemo();
    return;
  }
  state.manualDisconnect = true;
  if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
  if (state.device?.gatt?.connected) {
    await emergencyStop().catch(() => {});
    state.device.gatt.disconnect();
  } else {
    state.device = null;
    onDisconnected();
  }
}

function startDemo() {
  disconnectBluetooth();
  state.demo = true;
  ui.demoBtn.textContent = tr('demoStop');
  state.firmware = { firmware: 'Demo Sunray', version: '1.0', encryptionEnabled: false };
  let angle = 0;
  setConnectionStatus(true, 'demoActive', 'demoDetail');
  const tick = () => {
    angle += 0.08;
    state.telemetry = {
      x: 4 + Math.cos(angle) * 3.2,
      y: 2 + Math.sin(angle * 1.25) * 2.1,
      delta: Math.atan2(2.1 * 1.25 * Math.cos(angle * 1.25), -3.2 * Math.sin(angle)),
      solution: 2,
      age: 0.15,
      accuracy: 0.02,
      visibleSatellites: 39,
      visibleSatellitesDgps: 35,
      batteryVoltage: 26.4,
      receivedAt: Date.now(),
    };
    refreshTelemetry();
  };
  tick();
  state.demoTimer = setInterval(tick, 850);
}

function stopDemo() {
  if (state.demoTimer) clearInterval(state.demoTimer);
  state.demoTimer = null;
  if (state.demo) {
    state.demo = false;
    ui.demoBtn.textContent = tr('demoStart');
    state.telemetry.receivedAt = 0;
    setConnectionStatus(false, 'notConnected', 'demoEnded');
    refreshTelemetry();
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MAP_STORE)) db.createObjectStore(MAP_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbRequest(mode, action) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(MAP_STORE, mode);
    const store = tx.objectStore(MAP_STORE);
    const req = action(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * Zeitpunkt der letzten Aenderung fuer die Kartenuebersicht: **Datum und Uhrzeit**. Nur das
 * Datum reichte nicht — wer an einem Nachmittag mehrfach speichert, sah an allen Karten
 * denselben Text und konnte den juengsten Stand nicht erkennen. Sekunden bleiben weg, sie
 * traegen fuer diese Frage nichts bei und machen die Zeile nur laenger.
 */
function formatMapTimestamp(iso) {
  const date = new Date(iso || Date.now());
  if (!Number.isFinite(date.getTime())) return '—';
  return `${date.toLocaleDateString(localeCode())} ${date.toLocaleTimeString(localeCode(), { hour: '2-digit', minute: '2-digit' })}`;
}

function localizedMapName(map) {
  if (!map) return tr('noMap');
  const name = String(map.name || '').trim();
  if (name === 'Meine erste Karte' || name === 'My first map') return tr('firstMapName');
  const numbered = name.match(/^(?:Karte|Map)\s+(\d+)$/i);
  if (numbered) return tr('mapN', { n: numbered[1] });
  return name || tr('firstMapName');
}

/** Ein Name, den die App selbst vergeben hat — im Gegensatz zu einem eigenen Namen des Nutzers. */
const DEFAULT_EXCLUSION_NAME_RE = /^(?:Ausschluss|Exclusion)\s+\d+$/i;

function isDefaultExclusionName(exclusion) {
  const name = String(exclusion?.name || '').trim();
  return !name || DEFAULT_EXCLUSION_NAME_RE.test(name);
}

function localizedExclusionName(exclusion, index = 0) {
  if (isDefaultExclusionName(exclusion)) return tr('exclusionN', { n: index + 1 });
  return String(exclusion.name).trim();
}

/**
 * Schreibt die Standardnamen auf die laufende Nummer 1..x um; eigene Namen bleiben unberuehrt.
 * In der Oberflaeche waere das nicht noetig — localizedExclusionName() bildet die Nummer ohnehin
 * aus dem Listenindex. Der Export nimmt aber das Feld `name`, und dort stuende sonst weiter
 * „Ausschluss 5“, obwohl die Flaeche in der Liste als 2 gefuehrt wird.
 */
function renumberDefaultExclusionNames(map) {
  map.exclusions.forEach((exclusion, index) => {
    if (isDefaultExclusionName(exclusion)) exclusion.name = tr('exclusionN', { n: index + 1 });
  });
}

/**
 * Entfernt Ausschlussflaechen ohne einen einzigen Punkt und nummeriert den Rest lueckenlos neu.
 *
 * Solche Platzhalter sammelten sich an, weil sie beim Moduswechsel entstanden und sich in der
 * Elementliste nicht einmal von Hand loeschen liessen (der Papierkorb dort ist bei null Punkten
 * gesperrt). Ausgenommen bleibt die **gerade bearbeitete** Flaeche: im Ausschluss-Modus wuerde
 * man sonst unmittelbar nach dem Moduswechsel wieder herausfallen, bevor der erste Punkt steht.
 *
 * Bewusst synchron und ohne Undo-Schritt: es geht nur Leergut verloren, und ein Undo-Eintrag
 * dafuer wuerde den auf 20 Schritte begrenzten Stapel mit Nichts fuellen. Speichern erledigt der
 * Aufrufer, damit er es mit seinen uebrigen Aenderungen buendeln kann.
 *
 * @returns {number} Anzahl der entfernten Flaechen.
 */
function pruneEmptyExclusions() {
  const map = state.activeMap;
  if (!map || map.locked) return 0;
  const keepId = state.mode === 'exclusion' ? state.activeExclusionId : null;
  const before = map.exclusions.length;
  map.exclusions = map.exclusions.filter((e) => e.points.length > 0 || e.id === keepId);
  const removed = before - map.exclusions.length;
  if (!removed) return 0;
  if (!map.exclusions.some((e) => e.id === state.activeExclusionId)) {
    state.activeExclusionId = map.exclusions[0]?.id || null;
  }
  if (state.selectedArea && !map.exclusions.some((e) => e.id === state.selectedArea)) state.selectedArea = null;
  renumberDefaultExclusionNames(map);
  return removed;
}

function makeMap(name) {
  const now = new Date().toISOString();
  return {
    format: 'ardumower-web-map', generator: 'MapCreator für Ardumower', version: 2,
    id: newId(), name: name.trim(), coordinateSystem: 'sunray-local-xy-meters',
    createdAt: now, updatedAt: now, locked: false, perimeterClosed: false,
    // Positionsmodus und Ursprung gehoeren zur Karte, nicht zur App — Begruendung in CLAUDE.md.
    positionMode: 'relative', origin: null,
    perimeter: [], exclusions: [], waypoints: [], dockPoints: [],
  };
}

function normalizeMap(map) {
  if (!map) return map;
  map.format = 'ardumower-web-map';
  map.generator = 'MapCreator für Ardumower';
  map.version = Math.max(2, Number(map.version) || 1);
  map.locked = map.locked === true;
  map.perimeterClosed = map.perimeterClosed === true;
  if (!Array.isArray(map.perimeter)) map.perimeter = [];
  if (!Array.isArray(map.exclusions)) map.exclusions = [];
  map.exclusions.forEach((exclusion, index) => {
    if (!exclusion.id) exclusion.id = newId();
    if (!Array.isArray(exclusion.points)) exclusion.points = [];
    if (!exclusion.name) exclusion.name = `Ausschluss ${index + 1}`;
    // Bestandskarten wurden immer geschlossen gezeichnet — dabei bleibt es.
    exclusion.closed = exclusion.closed !== false;
  });
  if (!Array.isArray(map.waypoints)) map.waypoints = [];
  if (!Array.isArray(map.dockPoints)) map.dockPoints = [];
  // Bestandskarten kennen den Positionsmodus nicht: sie sind relativ, wie sie aufgenommen wurden.
  map.positionMode = map.positionMode === 'absolute' ? 'absolute' : 'relative';
  map.origin = normalizeOrigin(map.origin);
  // Die Undo-Historie reist seit v68 mit der Karte. Bestandskarten und importierte Dateien
  // bringen keine mit; ein Datensatz mit zu vielen Schritten wird hier auf das Mass gebracht.
  if (!Array.isArray(map.undoStack)) map.undoStack = [];
  map.undoStack = map.undoStack.filter((entry) => entry && Array.isArray(entry.perimeter));
  trimUndoStack(map.undoStack);
  return map;
}

async function loadMaps() {
  state.maps = (await dbRequest('readonly', (store) => store.getAll())).map(normalizeMap);
  state.maps.sort((a, b) => a.name.localeCompare(b.name, state.language === 'en' ? 'en' : 'de'));
  const remembered = localStorage.getItem(ACTIVE_MAP_KEY);
  state.activeMap = state.maps.find((m) => m.id === remembered) || state.maps[0] || null;
  if (!state.activeMap) {
    const first = makeMap(tr('firstMapName'));
    await dbRequest('readwrite', (store) => store.put(first));
    state.maps = [first];
    state.activeMap = first;
  }
  state.activeExclusionId = state.activeMap.exclusions?.[0]?.id || null;
  renderMapControls();
  renderMap();
}

async function saveActiveMap() {
  if (!state.activeMap) return;
  state.activeMap.updatedAt = new Date().toISOString();
  state.saving = true;
  ui.saveState.textContent = tr('saving');
  await dbRequest('readwrite', (store) => store.put(state.activeMap));
  const idx = state.maps.findIndex((m) => m.id === state.activeMap.id);
  if (idx >= 0) state.maps[idx] = state.activeMap;
  localStorage.setItem(ACTIVE_MAP_KEY, state.activeMap.id);
  state.saving = false;
  state.lastSavedAt = new Date();
  ui.saveState.textContent = tr('savedAt', { time: state.lastSavedAt.toLocaleTimeString(localeCode(), { hour: '2-digit', minute: '2-digit' }) });
  renderMapGallery();
}

function populateMapSelect(select) {
  select.innerHTML = '';
  state.maps.forEach((map) => {
    const option = document.createElement('option');
    option.value = map.id;
    option.textContent = localizedMapName(map);
    option.selected = map.id === state.activeMap?.id;
    select.appendChild(option);
  });
}

function thumbnailTransform(map) {
  const points = [...(map.perimeter || []), ...(map.dockPoints || [])];
  (map.exclusions || []).forEach((ex) => points.push(...(ex.points || [])));
  if (!points.length) return { scale: 12, ox: 80, oy: 50 };
  let minX=Math.min(...points.map(p=>p.x)), maxX=Math.max(...points.map(p=>p.x));
  let minY=Math.min(...points.map(p=>p.y)), maxY=Math.max(...points.map(p=>p.y));
  if(maxX-minX<1){minX-=0.5;maxX+=0.5;} if(maxY-minY<1){minY-=0.5;maxY+=0.5;}
  const scale=Math.min(140/(maxX-minX),80/(maxY-minY));
  return {scale,ox:10-minX*scale+(140-(maxX-minX)*scale)/2,oy:10+maxY*scale+(80-(maxY-minY)*scale)/2};
}

function drawThumbnailPath(svg, points, trf, cls, closed) {
  if (!points?.length) return;
  const coords=points.map(p=>`${(trf.ox+p.x*trf.scale).toFixed(1)},${(trf.oy-p.y*trf.scale).toFixed(1)}`).join(' ');
  svg.appendChild(svgEl(closed && points.length>=3 ? 'polygon':'polyline',{points:coords,class:cls}));
}

function renderMapGallery() {
  if (!ui.mapGallery) return;
  ui.mapGallery.innerHTML='';
  if (ui.mapCountBadge) ui.mapCountBadge.textContent=`${state.maps.length} / ${MAX_MAPS}`;
  state.maps.forEach((map)=>{
    normalizeMap(map);
    const card=document.createElement('div'); card.className=`map-gallery-card${map.id===state.activeMap?.id?' active':''}${map.locked?' locked':''}`;
    const select=document.createElement('button'); select.type='button'; select.className='map-card-select'; select.dataset.mapCardId=map.id; select.setAttribute('aria-label',`${tr('selectMap')}: ${localizedMapName(map)}`);
    const svg=svgEl('svg',{viewBox:'0 0 160 100',class:'map-card-thumb','aria-hidden':'true'}); const trf=thumbnailTransform(map);
    drawThumbnailPath(svg,map.perimeter,trf,'thumb-perimeter',true); (map.exclusions||[]).forEach(ex=>drawThumbnailPath(svg,ex.points,trf,'thumb-exclusion',true)); drawThumbnailPath(svg,map.dockPoints,trf,'thumb-dock',false);
    const copy=document.createElement('div'); copy.className='map-card-copy';
    const title=document.createElement('strong'); title.textContent=localizedMapName(map);
    const meta=document.createElement('small'); meta.textContent=`${tr('mapCardArea',{area:mapNetArea(map).toFixed(0)})} · ${tr('mapCardPoints',{points:mapPointCount(map)})}`;
    const changed=document.createElement('small'); changed.textContent=tr('mapCardChanged',{date:formatMapTimestamp(map.updatedAt||map.createdAt)});
    copy.append(title,meta,changed);
    if (map.locked) { const note=document.createElement('small'); note.className='map-card-locked-note'; note.textContent=tr('mapLockedNote'); copy.appendChild(note); } select.append(svg,copy);
    const lock=document.createElement('button'); lock.type='button'; lock.className=`map-card-lock${map.locked?' active':''}`; lock.dataset.mapLockId=map.id;
    lock.appendChild(lockIcon(map.locked));
    const badge=document.createElement('small'); badge.textContent=tr(map.locked?'lockedBadge':'unlockedBadge'); lock.appendChild(badge);
    lock.title=tr(map.locked?'unlockCurrentMap':'lockCurrentMap'); lock.setAttribute('aria-label',lock.title);
    const tools=document.createElement('div'); tools.className='map-card-tools';
    const toolBtn=(cls,dataset,label,paths)=>{
      const b=document.createElement('button'); b.type='button'; b.className=`map-card-tool ${cls}`;
      Object.assign(b.dataset,dataset); b.title=label; b.setAttribute('aria-label',label);
      const icon=svgEl('svg',{viewBox:'0 0 24 24','aria-hidden':'true'});
      paths.forEach((d)=>icon.appendChild(svgEl('path',{d})));
      b.appendChild(icon); return b;
    };
    tools.append(
      toolBtn('rename',{mapRenameId:map.id},`${tr('renameMap')}: ${localizedMapName(map)}`,
        ['M4 20h4L19 9l-4-4L4 16z','M14 6l4 4']),
      toolBtn('copy',{mapCopyId:map.id},`${tr('duplicateMap')}: ${localizedMapName(map)}`,
        ['M9 9h10v10H9z','M5 15V5h10']),
    );
    card.append(select,tools,lock); ui.mapGallery.appendChild(card);
  });
}

async function toggleMapLockById(mapId) {
  const map=state.maps.find(m=>m.id===mapId); if(!map)return;
  map.locked=!map.locked; map.updatedAt=new Date().toISOString();
  if(map.id===state.activeMap?.id){
    state.activeMap=map;
    if(map.locked){ stopAutoCapture(); clearPointSelection({render:false}); }
  }
  await dbRequest('readwrite',store=>store.put(map));
  renderMapControls(); renderMap();
}

/** Positionsmodus und Ursprung gehoeren zur Karte — die Felder folgen deshalb der aktiven. */
function renderPositionMode() {
  const map = state.activeMap;
  const absolute = map?.positionMode === 'absolute';
  ui.positionModeSelect.value = absolute ? 'absolute' : 'relative';
  ui.positionModeSelect.disabled = !map || Boolean(map.locked);
  ui.originFields.hidden = !absolute;
  ui.originLatInput.value = map?.origin ? String(map.origin.lat) : '';
  ui.originLonInput.value = map?.origin ? String(map.origin.lon) : '';
  ui.originLatInput.disabled = !map || Boolean(map.locked);
  ui.originLonInput.disabled = !map || Boolean(map.locked);
}

/**
 * Uebernimmt Modus und Ursprung aus den Eingabefeldern in die **aktive Karte**. Ein unvollstaendig
 * oder unsinnig eingetragener Ursprung wird zu null: der Modus bleibt dann zwar auf „absolut“
 * stehen, exportiert aber weiter lokale Meter (mapOriginInUse()), statt falsche Grad zu erzeugen.
 */
async function updatePositionModeFromUi() {
  const map = state.activeMap;
  if (!map || map.locked) { renderPositionMode(); return; }
  map.positionMode = ui.positionModeSelect.value === 'absolute' ? 'absolute' : 'relative';
  // Leere Felder ergeben `null`, nicht 0/0 (siehe `originFromInputs()`). Der Modus bleibt dabei
  // ausdruecklich `absolute`: ein geleertes Feld ist kein Widerruf der Moduswahl, und
  // `mapOriginInUse()` traegt diesen Zustand seit jeher — es exportiert dann weiter Meter,
  // statt falsche Grad zu erzeugen. Sichtbar bleibt er, weil die Ursprungsfelder offen stehen.
  map.origin = map.positionMode === 'absolute'
    ? originFromInputs(ui.originLatInput, ui.originLonInput)
    : null;
  renderPositionMode();
  await saveActiveMap();
}

function renderMapControls() {
  populateMapSelect(ui.mapSelect);
  renderMapGallery();
  const atMapLimit = state.maps.length >= MAX_MAPS;
  ui.newMapBtn.disabled = atMapLimit;
  ui.importInput.disabled = atMapLimit;
  ui.newMapName.disabled = atMapLimit;
  const importLabel = ui.importInput.previousElementSibling;
  if (importLabel) {
    importLabel.classList.toggle('is-disabled', atMapLimit);
    importLabel.setAttribute('aria-disabled', atMapLimit ? 'true' : 'false');
    importLabel.title = atMapLimit ? tr('mapLimitReached') : '';
  }
  ui.newMapBtn.title = atMapLimit ? tr('mapLimitReached') : '';
  ui.newMapName.title = atMapLimit ? tr('mapLimitReached') : '';
  const locked = Boolean(state.activeMap?.locked);
  ui.lockMapBtn.textContent = tr(locked ? 'unlockCurrentMap' : 'lockCurrentMap');
  ui.deleteMapBtn.disabled = locked;
  renderPositionMode();
  renderCassandraReference();
  renderElementList();
  renderValidation();
  refreshCaptureState();
}

function setActiveMapById(mapId) {
  const next = state.maps.find((m) => m.id === mapId);
  if (!next) return;
  stopAutoCapture();
  state.extension = null;
  state.activeMap = normalizeMap(next);
  // Seit v68 wird der Stapel nicht mehr geleert: `state.undoStack` zeigt auf `map.undoStack`,
  // mit der neuen Karte steht also deren eigene Historie bereit.
  refreshUndoButton();
  state.activeExclusionId = state.activeMap.exclusions?.[0]?.id || null;
  state.selectedPoint = null;
  state.validationResult = null;
  state.trail = [];
  resetViewport({ render: false });
  localStorage.setItem(ACTIVE_MAP_KEY, state.activeMap.id);
  renderMapControls();
  renderMap();
}

/**
 * Liste aller Kartenelemente: Perimeter, jede Ausschlussflaeche, Wegpunkte und Dockpfad —
 * mit Punktzahl, antippbar zum Aktivieren und jeweils einzeln loeschbar. Ersetzt das fruehere
 * Auswahlfeld, das nur Ausschlussflaechen kannte und nur im Ausschluss-Modus sichtbar war.
 */
function mapElements() {
  const map = state.activeMap;
  if (!map) return [];
  const items = [
    { key: 'perimeter', role: 'perimeter', label: tr('perimeter'), points: map.perimeter },
  ];
  map.exclusions.forEach((exclusion, index) => items.push({
    key: `exclusion:${exclusion.id}`, role: 'exclusion', exclusionId: exclusion.id,
    label: localizedExclusionName(exclusion, index), points: exclusion.points,
  }));
  items.push({ key: 'waypoint', role: 'waypoint', label: tr('waypoints'), points: map.waypoints });
  items.push({ key: 'dock', role: 'dock', label: tr('dockPath'), points: map.dockPoints });
  return items;
}

function renderElementList() {
  if (!ui.elementList) return;
  ui.elementList.innerHTML = '';
  const locked = Boolean(state.activeMap?.locked);
  if (!state.activeMap) { ui.elementList.textContent = tr('noMapLoaded'); return; }
  const exclusions = state.activeMap.exclusions;
  if (!exclusions.some((e) => e.id === state.activeExclusionId)) state.activeExclusionId = exclusions[0]?.id || null;

  mapElements().forEach((item) => {
    const row = document.createElement('div');
    const active = item.role === state.mode && (item.role !== 'exclusion' || item.exclusionId === state.activeExclusionId);
    row.className = `element-row${active ? ' active' : ''}`;

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'element-select';
    select.dataset.elementRole = item.role;
    if (item.exclusionId) select.dataset.elementExclusion = item.exclusionId;
    select.innerHTML = `<span class="element-dot" data-mode="${item.role}"></span>`
      + `<span class="element-name">${item.label}</span>`
      + `<span class="element-count">${tr('elementPoints', { count: item.points.length })}</span>`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'element-delete';
    remove.dataset.deleteRole = item.role;
    if (item.exclusionId) remove.dataset.deleteExclusion = item.exclusionId;
    remove.disabled = locked || !item.points.length;
    remove.title = tr('deleteElement', { label: item.label });
    remove.setAttribute('aria-label', remove.title);
    remove.appendChild(lockSafeTrashIcon());

    row.append(select, remove);
    ui.elementList.appendChild(row);
  });
}

/** Papierkorb-Symbol fuer die Elementliste. */
function lockSafeTrashIcon() {
  const icon = svgEl('svg', { viewBox: '0 0 24 24', class: 'element-trash', 'aria-hidden': 'true' });
  icon.appendChild(svgEl('path', { d: 'M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6' }));
  return icon;
}

/** Element aus der Liste leeren bzw. — bei Ausschlussflaechen — ganz entfernen. */
async function deleteElement(role, exclusionId) {
  if (!state.activeMap || !ensureMapEditable()) return;
  const item = mapElements().find((e) => e.role === role && (role !== 'exclusion' || e.exclusionId === exclusionId));
  if (!item || !item.points.length) return;
  const confirmed = await askConfirm({
    title: tr('deleteElement', { label: item.label }),
    message: tr('deleteElementConfirm', { label: item.label, count: item.points.length }),
    confirmLabel: tr('delete'),
    tone: 'danger',
  });
  if (!confirmed) return;
  pushUndo();
  if (role === 'exclusion') {
    state.activeMap.exclusions = state.activeMap.exclusions.filter((e) => e.id !== exclusionId);
    if (state.selectedArea === exclusionId) state.selectedArea = null;
    state.activeExclusionId = state.activeMap.exclusions[0]?.id || null;
  } else {
    item.points.splice(0, item.points.length);
    if (role === 'perimeter') state.activeMap.perimeterClosed = false;
  }
  state.selectedPoint = null;
  state.validationResult = null;
  await saveActiveMap();
  renderElementList();
  renderMap();
  refreshCaptureState();
}

/** Tippen auf eine Zeile macht das Element zum aktiven Aufnahmeziel. */
function activateElement(role, exclusionId) {
  if (exclusionId) state.activeExclusionId = exclusionId;
  setMode(role);
  renderElementList();
}

async function createMapFromInput() {
  stopAutoCapture();
  if (state.maps.length >= MAX_MAPS) throw new Error(tr('mapLimitReached'));
  const name = ui.newMapName.value.trim() || tr('mapN', { n: state.maps.length + 1 });
  const map = makeMap(name);
  await dbRequest('readwrite', (store) => store.put(map));
  state.maps.push(map);
  state.maps.sort((a, b) => a.name.localeCompare(b.name, state.language === 'en' ? 'en' : 'de'));
  state.activeMap = map;
  state.activeExclusionId = null;
  state.selectedPoint = null;
  ui.newMapName.value = '';
  renderMapControls();
  await saveActiveMap();
  renderMap();
}

/** So lang wie das Eingabefeld fuer neue Karten — laengere Namen sprengen sonst die Leiste. */
const MAP_NAME_MAX = 60;
const COPY_SUFFIX_RE = /\s*\((?:Kopie|Copy|copy)(?:\s+\d+)?\)$/i;

/**
 * Ein freier Name fuer die Kopie. Ein bereits vorhandenes „(Kopie)“ am Ende wird zuerst
 * abgeschnitten — sonst entstuende beim zweiten Duplizieren „… (Kopie) (Kopie)“. Danach wird
 * hochgezaehlt, bis kein Name doppelt vorkommt.
 */
function uniqueCopyName(sourceName) {
  const taken = new Set(state.maps.map((m) => localizedMapName(m)));
  const base = String(sourceName).replace(COPY_SUFFIX_RE, '').trim() || tr('firstMapName');
  const fit = (suffix) => `${base.slice(0, Math.max(1, MAP_NAME_MAX - suffix.length - 1))} ${suffix}`;
  const first = fit(tr('copySuffix'));
  if (!taken.has(first)) return first;
  for (let n = 2; n <= MAX_MAPS + 2; n += 1) {
    const candidate = fit(tr('copySuffixN', { n }));
    if (!taken.has(candidate)) return candidate;
  }
  return fit(tr('copySuffixN', { n: Date.now() % 1000 }));
}

/** Benennt eine Karte um — nur den Anzeigenamen, sonst nichts. */
async function renameMapById(mapId) {
  const map = state.maps.find((m) => m.id === mapId);
  if (!map) return;
  if (map.locked) { await showNotice({ title: tr('renameMap'), message: tr('mapLockedHint'), tone: 'danger' }); return; }
  const answer = await askText({
    title: tr('renameMap'),
    message: tr('renameMapHint'),
    value: localizedMapName(map),
    confirmLabel: tr('save'),
    maxLength: MAP_NAME_MAX,
  });
  if (answer === null) return;
  const name = answer.trim().slice(0, MAP_NAME_MAX);
  if (!name) { await showNotice({ title: tr('renameMap'), message: tr('nameEmpty'), tone: 'danger' }); return; }
  map.name = name;
  map.updatedAt = new Date().toISOString();
  await dbRequest('readwrite', (store) => store.put(map));
  renderMapControls();
  renderMap();
}

/**
 * Legt eine vollstaendig eigenstaendige Kopie an: tiefe Kopie ueber JSON, damit weder Punkte
 * noch Ausschlussflaechen als gemeinsame Referenz haengen bleiben. Neue Kennungen fuer Karte und
 * Flaechen, alles Uebrige — Geometrie, Positionsmodus, Ursprung, Sperre — bleibt wie im Original.
 * Die aktive Karte wechselt bewusst **nicht**: Duplizieren soll die laufende Arbeit nicht
 * unterbrechen.
 */
async function duplicateMapById(mapId) {
  const source = state.maps.find((m) => m.id === mapId);
  if (!source) return;
  if (state.maps.length >= MAX_MAPS) {
    await showNotice({ title: tr('duplicateMap'), message: tr('mapLimitReached'), tone: 'danger' });
    return;
  }
  const copy = normalizeMap(JSON.parse(JSON.stringify(mapWithoutUndo(source))));
  copy.id = newId();
  copy.exclusions.forEach((exclusion) => { exclusion.id = newId(); });
  copy.name = uniqueCopyName(localizedMapName(source));
  const now = new Date().toISOString();
  copy.createdAt = now;
  copy.updatedAt = now;
  await dbRequest('readwrite', (store) => store.put(copy));
  state.maps.push(copy);
  renderMapControls();
  return copy;
}

async function deleteActiveMap() {
  stopAutoCapture();
  if (!state.activeMap) return;
  if (state.activeMap.locked) { ui.pointStatus.textContent = tr('mapLockedHint'); return; }
  const confirmed = await askConfirm({
    title: tr('deleteCurrentMap'),
    message: tr('deleteMapConfirm', { name: localizedMapName(state.activeMap) }),
    confirmLabel: tr('delete'),
    tone: 'danger',
  });
  if (!confirmed) return;
  await dbRequest('readwrite', (store) => store.delete(state.activeMap.id));
  state.maps = state.maps.filter((m) => m.id !== state.activeMap.id);
  if (!state.maps.length) {
    const replacement = makeMap(tr('firstMapName'));
    await dbRequest('readwrite', (store) => store.put(replacement));
    state.maps.push(replacement);
  }
  state.activeMap = state.maps[0];
  state.activeExclusionId = state.activeMap.exclusions?.[0]?.id || null;
  state.selectedPoint = null;
  renderMapControls();
  await saveActiveMap();
  renderMap();
}

function getActivePointArray() {
  if (!state.activeMap) return null;
  if (state.mode === 'perimeter') return state.activeMap.perimeter;
  if (state.mode === 'dock') return state.activeMap.dockPoints;
  if (state.mode === 'waypoint') return state.activeMap.waypoints;
  if (state.mode === 'exclusion') {
    const exclusion = state.activeMap.exclusions.find((e) => e.id === state.activeExclusionId);
    return exclusion?.points || null;
  }
  return null;
}

/**
 * Wohin geht ein an der **Live-Position** aufgenommener Punkt? Die einzige Stelle, die das
 * entscheidet — Einzelaufnahme und Automatik haengen beide ueber `appendCurrentPoint()` daran,
 * und der Aufnahme-Knopf liest dieselbe Auskunft, damit er nicht etwas ankuendigt, das nicht
 * geschieht. Drei moegliche Antworten:
 *
 *  - `{ blockKey }`          — es wird nichts aufgenommen, der Schluessel nennt den Grund.
 *  - `{ startsNewArea: true }` — der Punkt beginnt eine **neue** Ausschlussflaeche.
 *  - `{ points }`            — er haengt an dieser Punktliste an.
 *
 * **Eine geschlossene Kontur nimmt keine Punkte mehr an** — genau das bedeutet der Schluss.
 * Perimeter und Ausschluss gehen dabei bewusst verschieden aus: einen Perimeter gibt es je
 * Karte nur einmal, ein zweiter waere gar nicht darstellbar, also bleibt nur der Hinweis, ihn
 * ueber „Erweitern“ zu oeffnen. Ausschlussflaechen sind dagegen unbegrenzt, und wer bei
 * geschlossener Flaeche aufnimmt, meint erkennbar die naechste — deshalb beginnt dort eine neue.
 *
 * `getActivePointArray()` beantwortet weiterhin „welche Punktliste gehoert zum Modus?“ und
 * kennt den Konturzustand ausdruecklich nicht: sie bedient auch Loeschen und Zaehlen, wo eine
 * geschlossene Kontur selbstverstaendlich die richtige Liste ist.
 */
function captureTarget() {
  if (!state.activeMap) return { blockKey: 'noMapActive' };
  if (state.mode === 'perimeter' && state.activeMap.perimeterClosed) {
    return { blockKey: 'perimeterClosedCapture' };
  }
  if (state.mode === 'exclusion') {
    const exclusion = currentExclusion();
    if (!exclusion || exclusion.closed) return { startsNewArea: true };
    return { points: exclusion.points };
  }
  const points = getActivePointArray();
  return points ? { points } : { blockKey: 'noMapActive' };
}

/**
 * Ein Knopf, drei Aufgaben: ohne Auswahl loescht er den zuletzt aufgenommenen Punkt,
 * bei ausgewaehltem Punkt genau diesen, bei ausgewaehlter Ausschlussflaeche die ganze Flaeche.
 * Waehrend der Automatik-Aufnahme ist er ausgeblendet.
 */
function refreshDeleteButton() {
  const button = ui.deletePointBtn;
  const wrap = ui.deleteFabWrap;
  const mapLocked = Boolean(state.activeMap?.locked);
  const area = selectedExclusion();
  const point = state.selectedPoint ? getSelectedPoint() : null;
  const count = (getActivePointArray() || []).length;
  if (wrap) wrap.hidden = state.autoCaptureRunning || mapLocked;
  button.classList.remove('delete-point', 'delete-area');
  if (area) {
    button.classList.add('delete-area');
    ui.deleteBtnLabel.textContent = tr('deleteAreaLabel');
    button.disabled = false;
  } else if (point) {
    button.classList.add('delete-point');
    ui.deleteBtnLabel.textContent = tr('deletePointLabel');
    button.disabled = false;
  } else {
    ui.deleteBtnLabel.textContent = tr('deleteLastLabel');
    button.disabled = count === 0;
  }
  button.title = ui.deleteBtnLabel.textContent;
}

/** Der Knopf aus refreshDeleteButton(): die Aktion richtet sich nach der aktuellen Auswahl. */
async function deleteAction() {
  if (state.autoCaptureRunning) return;
  if (selectedExclusion()) { await deleteSelectedArea(); return; }
  if (state.selectedPoint) { await deleteSelectedPoint(); return; }
  await undoPoint();
}

async function createExclusion() {
  if (!state.activeMap || !ensureMapEditable()) return;
  const number = state.activeMap.exclusions.length + 1;
  pushUndo();
  const exclusion = { id: newId(), name: tr('exclusionN', { n: number }), points: [], closed: false };
  state.activeMap.exclusions.push(exclusion);
  state.activeExclusionId = exclusion.id;
  renderElementList();
  await saveActiveMap();
  renderMap();
}

/**
 * Mittelt die Fixes der letzten POSITION_SMOOTHING_WINDOW_MS Millisekunden. Das daempft das
 * GPS-Rauschen, ohne dass der Nutzer warten muss. Weniger als zwei Fixes im Fenster: kein Mittel.
 */
function smoothedPosition() {
  const cutoff = Date.now() - POSITION_SMOOTHING_WINDOW_MS;
  const samples = state.fixHistory.filter((f) => f.at >= cutoff);
  if (samples.length < 2) return null;
  const sum = samples.reduce((acc, f) => ({ x: acc.x + f.x, y: acc.y + f.y }), { x: 0, y: 0 });
  return { x: sum.x / samples.length, y: sum.y / samples.length, samples: samples.length };
}

/**
 * **Streuung der GPS-Fixes** im selben 2-s-Fenster, das auch `smoothedPosition()` mittelt:
 * groesster Abstand eines Fixes zum Mittelwert, in Zentimetern, dazu die Zahl der Fixes im
 * Fenster. Letztere macht Funkluecken sichtbar — bei 500 ms Abfragetakt sind vier Fixes der
 * Normalfall, einer bedeutet, dass drei Antworten ausgeblieben sind.
 *
 * **Reine Anzeige.** Nichts davon geht in `pointFromTelemetry()`, `capturePreconditionKey()`
 * oder die Automatik ein; die Aufnahme verhaelt sich unveraendert.
 */
function fixScatter() {
  const cutoff = Date.now() - POSITION_SMOOTHING_WINDOW_MS;
  const samples = state.fixHistory.filter((f) => f.at >= cutoff);
  if (samples.length < 2) return { cm: null, samples: samples.length };
  const mean = samples.reduce((acc, f) => ({ x: acc.x + f.x, y: acc.y + f.y }), { x: 0, y: 0 });
  mean.x /= samples.length;
  mean.y /= samples.length;
  const radius = samples.reduce((max, f) => Math.max(max, Math.hypot(f.x - mean.x, f.y - mean.y)), 0);
  return { cm: radius * 100, samples: samples.length };
}

/**
 * Haelt den Verlauf der Streuung fest — **einmal je empfangenem Fix**, nicht je Neuzeichnen:
 * ein Eintrag je Zeichenvorgang wuerde denselben Wert mit frischem Zeitstempel nachschieben und
 * einen laengst abgelaufenen Hoechstwert ueber die 30 s hinaus am Leben halten.
 */
function rememberScatter() {
  const now = Date.now();
  const scatter = fixScatter();
  if (scatter.cm !== null) state.scatterHistory.push({ at: now, cm: scatter.cm });
  const cutoff = now - SCATTER_MAX_WINDOW_MS;
  while (state.scatterHistory.length && state.scatterHistory[0].at < cutoff) state.scatterHistory.shift();
}

/** Hoechste Streuung der letzten SCATTER_MAX_WINDOW_MS, oder null, solange nichts vorliegt. */
function scatterMaxCm() {
  const cutoff = Date.now() - SCATTER_MAX_WINDOW_MS;
  const recent = state.scatterHistory.filter((e) => e.at >= cutoff);
  return recent.length ? recent.reduce((max, e) => Math.max(max, e.cm), 0) : null;
}

/**
 * Der kompakte Text fuer das Streuungsfeld. Leer, solange ueberhaupt kein Fix vorliegt — dann
 * verschwindet das Feld per `.info-chip:empty`, statt eine Null zu behaupten. Ein einzelner Fix
 * ergibt noch keine Streuung, die **Zahl der Fixes** wird aber trotzdem gezeigt: genau daran ist
 * eine Funkluecke zu erkennen.
 */
function gpsScatterText() {
  if (!telemetryIsFresh() && !state.fixHistory.length) return '';
  const scatter = fixScatter();
  if (!state.fixHistory.length) return '';
  if (scatter.cm === null) return tr('gpsScatterWaiting', { n: scatter.samples });
  const max = scatterMaxCm();
  return tr('gpsScatter', {
    cm: Math.round(scatter.cm),
    maxCm: Math.round(max === null ? scatter.cm : Math.max(max, scatter.cm)),
    n: scatter.samples,
  });
}

/** Der Fix-Zustand als Wort — dieselben Schluessel, die auch das Abzeichen in der Kopfzeile nutzt. */
function fixStatusText() {
  if (!telemetryIsFresh()) return tr('rtkNoData');
  if (state.telemetry.solution === 2) return tr('rtkFix');
  if (state.telemetry.solution === 1) return tr('rtkFloat');
  return tr('rtkNone');
}

/** Die vom Mäher gemeldete Genauigkeit (`AT+S`-Feld 12, in Metern) als Zentimeterangabe. */
function gpsAccuracyText() {
  const accuracy = Number(state.telemetry.accuracy);
  if (!telemetryIsFresh() || !Number.isFinite(accuracy)) return '';
  return tr('gpsAccuracy', { cm: (accuracy * 100).toFixed(1) });
}

/**
 * Die GPS-Einblendung oben auf der Karte. Seit v68 steht die Streuung **nicht mehr** in der
 * Werkzeugleiste: dort nahm sie dauerhaft Platz neben Kartenname und Konturzustand weg, obwohl
 * sie nur zeitweise interessiert. Ein Tipp auf das Abzeichen in der Kopfzeile blendet sie um,
 * die Wahl ueberlebt einen Neustart (`state.view.gpsPanel`).
 *
 * **Weiterhin reine Anzeige** — nichts davon beruehrt Aufnahme oder Automatik.
 */
function refreshGpsScatter() {
  if (!ui.gpsPanel) return;
  ui.gpsPanel.hidden = !state.view.gpsPanel;
  if (ui.rtkBadge?.setAttribute) ui.rtkBadge.setAttribute('aria-expanded', state.view.gpsPanel ? 'true' : 'false');
  if (!state.view.gpsPanel) return;
  ui.gpsPanelFix.textContent = fixStatusText();
  ui.gpsPanelScatter.textContent = gpsScatterText();
  ui.gpsPanelAccuracy.textContent = gpsAccuracyText();
}

/** Der Tipp auf das Abzeichen. Merkt die Wahl ueber die vorhandenen Ansichtseinstellungen. */
function toggleGpsPanel() {
  state.view.gpsPanel = !state.view.gpsPanel;
  saveViewPreferences();
  refreshGpsScatter();
}

function pointFromTelemetry() {
  const t = state.telemetry;
  const smooth = smoothedPosition();
  return {
    x: Number((smooth ? smooth.x : t.x).toFixed(3)),
    y: Number((smooth ? smooth.y : t.y).toFixed(3)),
    smoothedFrom: smooth ? smooth.samples : 1,
    capturedAt: new Date().toISOString(),
    gps: {
      solution: t.solution,
      // Die Roboterorientierung in Bogenmass (`stateEstimator.stateDelta`, comm.cpp:692). Wir
      // empfangen sie seit jeher ueber `AT+S`, haben sie aber nie am Punkt abgelegt — die
      // Sunray-App-Datei fuehrt sie je Punkt, und ein erfundener Wert waere dort eine Aussage
      // ueber etwas, das tatsaechlich gemessen wurde.
      delta: t.delta,
      age: t.age,
      accuracy: t.accuracy,
      visibleSatellites: t.visibleSatellites,
      visibleSatellitesDgps: t.visibleSatellitesDgps,
    },
  };
}

async function relearnSelectedPoint() {
  if (!ensureMapEditable()) return;
  const target = getSelectedPointArray();
  const sel = state.selectedPoint;
  const oldPoint = getSelectedPoint();
  if (!target || !sel || !oldPoint) return;
  pushUndo();
  const point = pointFromTelemetry();
  point.originalCapturedAt = oldPoint.originalCapturedAt || oldPoint.capturedAt || null;
  point.editedAt = point.capturedAt;
  point.previousPosition = { x: oldPoint.x, y: oldPoint.y };
  target[sel.index] = point;
  await saveActiveMap();
  renderMap();
  ui.pointStatus.textContent = tr('pointRelearned', { n: sel.index + 1, x: point.x.toFixed(2), y: point.y.toFixed(2) });
}

/**
 * Den ausgewaehlten Punkt auf die Maeherposition setzen. **Der einzige Weg dorthin** — der
 * Hauptknopf ruft ihn ausserhalb der Erweiterung, der eigene Knopf `#movePointBtn` waehrend
 * ihrer Aufnahmephase. Keine zweite, nebenherlaufende Fassung.
 */
async function movePointToMower() {
  if (!state.selectedPoint) return;
  await relearnSelectedPoint();
  clearPointSelection();
}

/**
 * Gemeinsame Vorbedingung fuer jedes Setzen eines Punktes an der Live-Position — aufnehmen wie
 * einfuegen. Liefert den i18n-Schluessel des Hinderungsgrunds oder null, wenn es losgehen kann.
 * Bewusst eine Stelle: „Nur bei RTK FIX“ muss ueberall gleich gelten.
 */
function capturePreconditionKey() {
  if (!telemetryIsFresh()) return 'noCurrentPosition';
  if (ui.fixOnly.checked && !telemetryHasFix()) return 'noRtkFix';
  return null;
}

/** Ist die Kontur des ausgewaehlten Punktes geschlossen? Nur dann gibt es eine Verbindung
 *  zwischen letztem und erstem Punkt, ueber die „davor/danach“ umlaufen darf.
 *  Wegpunkte und Dockpfad sind immer offene Pfade. */
function selectedContourClosed(sel) {
  return contourClosedState(sel?.role, sel?.exclusionId) === true;
}

/**
 * Offen/geschlossen **einer bestimmten** Kontur: `true`, `false` — oder `null`, wo es das
 * Konzept gar nicht gibt. Wegpunkte und Dockpfad sind immer offene Pfade, und eine nicht mehr
 * vorhandene Ausschlussflaeche hat ebenfalls keinen Zustand. `null` ist deshalb ausdruecklich
 * etwas anderes als „offen“: nur daran haengt, ob ueberhaupt etwas angezeigt wird.
 */
function contourClosedState(role, exclusionId) {
  if (!state.activeMap) return null;
  if (role === 'perimeter') return Boolean(state.activeMap.perimeterClosed);
  if (role === 'exclusion') {
    const exclusion = state.activeMap.exclusions.find((e) => e.id === exclusionId);
    return exclusion ? exclusion.closed !== false : null;
  }
  return null;
}

/**
 * Der Zustand als **Anhaengsel an eine Konturbezeichnung** („ · geschlossen“), nie als
 * eigenstaendiges Wort. Genau das war der Fehler: als freistehendes Feld in der Karteninfo war
 * nicht erkennbar, auf welche der Konturen er sich bezieht.
 */
function contourStateSuffix(role, exclusionId) {
  const closed = contourClosedState(role, exclusionId);
  return closed === null ? '' : ` · ${tr(closed ? 'contourClosed' : 'contourOpen')}`;
}

/**
 * Index des Nachbarn, zwischen dem und dem ausgewaehlten Punkt der neue liegen soll — oder -1,
 * wenn es dort keine Strecke gibt. Am Anfang einer **offenen** Kontur hat „davor“ keinen
 * Vorgaenger, am Ende hat „danach“ keinen Nachfolger. Bei geschlossenen Konturen laeuft beides
 * ueber die Schlussstrecke letzter↔erster Punkt um.
 */
function insertNeighbourIndex(target, index, offset, closed) {
  if (!Array.isArray(target) || index < 0 || index >= target.length) return -1;
  if (offset === 0) {
    if (index > 0) return index - 1;
    return closed && target.length >= 2 ? target.length - 1 : -1;
  }
  if (index < target.length - 1) return index + 1;
  return closed && target.length >= 2 ? 0 : -1;
}

/** Rangfolge fuer „welcher der beiden Nachbarn ist der schlechtere“. */
const QUALITY_RANK = { excellent: 3, good: 2, warning: 1, bad: 0 };

/**
 * Der geometrische Mittelpunkt zweier Kartenpunkte. Er traegt `interpolated: true` und **keine
 * eigene Messung** — er ist konstruiert, nicht gefahren. Die Guetedaten erbt er vom
 * schlechteren der beiden Nachbarn: ein konstruierter Punkt ist hoechstens so verlaesslich wie
 * die Strecke, auf der er liegt. Ohne dieses Erben zaehlte jeder eingefuegte Punkt in der
 * Kartenpruefung als „ohne RTK FIX aufgenommen“ und waere auf der Karte rot.
 */
function midpointBetween(a, b) {
  const worse = QUALITY_RANK[pointQuality(a)] <= QUALITY_RANK[pointQuality(b)] ? a : b;
  return {
    x: Number(((a.x + b.x) / 2).toFixed(3)),
    y: Number(((a.y + b.y) / 2).toFixed(3)),
    capturedAt: new Date().toISOString(),
    interpolated: true,
    gps: worse.gps ? { ...worse.gps } : null,
  };
}

/**
 * Fuegt einen Punkt auf halber Strecke zwischen dem ausgewaehlten Punkt und seinem Vorgaenger
 * (offset 0) bzw. Nachfolger (offset 1) in dessen Punktfolge ein. Rein geometrisch — die
 * aktuelle Maeherposition spielt keine Rolle, deshalb greift hier auch „Nur bei RTK FIX“ nicht.
 * Alle vier Elementarten sind geordnete Arrays; auch Wegpunkte und Dockpfad sind offene Pfade
 * mit fester Reihenfolge, „davor/danach“ ist also ueberall wohldefiniert.
 */
async function insertPointAtSelection(offset) {
  if (!ensureMapEditable()) return null;
  const target = getSelectedPointArray();
  const sel = state.selectedPoint;
  if (!target || !sel || !target[sel.index]) return null;
  const neighbour = insertNeighbourIndex(target, sel.index, offset, selectedContourClosed(sel));
  if (neighbour < 0) { ui.pointStatus.textContent = tr('insertNoNeighbour'); return null; }
  pushUndo();
  const point = midpointBetween(target[sel.index], target[neighbour]);
  // „Davor“ schiebt sich auf den Platz des ausgewaehlten Punktes, „danach“ dahinter. Beim
  // Umlauf einer geschlossenen Kontur trifft das genau die Schlussstrecke.
  const at = offset === 0 ? sel.index : sel.index + 1;
  target.splice(at, 0, point);
  // Wie nach dem Verschieben: die Auswahl ist erledigt, die Oberflaeche faellt in den
  // Normalzustand zurueck.
  clearPointSelection({ render: false });
  state.validationResult = null;
  await saveActiveMap();
  renderMap();
  refreshCaptureState();
  ui.pointStatus.textContent = tr('pointInserted', { n: at + 1 });
  return point;
}

async function appendCurrentPoint({ automatic = false, targetOverride = null, save = true } = {}) {
  if (!ensureMapEditable()) return null;
  // Schnappschuss vor jeder Nebenwirkung: legt der Aufruf noch eine leere Ausschlussflaeche an,
  // nimmt ein Undo beides zusammen zurueck. Abgelegt wird er erst, wenn wirklich ein Punkt
  // entsteht — sonst haette ein Fehlversuch ohne Positionsdaten einen leeren Schritt erzeugt.
  const before = geometrySnapshot();
  let target = targetOverride;
  let startedArea = null;
  if (!target) {
    const decision = captureTarget();
    // Eine geschlossene Kontur meldet sich hier, statt sich stillschweigend wieder zu oeffnen
    // oder weiterzuwachsen. Beide Aufnahmewege laufen ueber diese Stelle, Automatik wie Tipp.
    if (decision.blockKey) { ui.pointStatus.textContent = tr(decision.blockKey); return null; }
    // Erst pruefen, dann anlegen: sonst bliebe nach einem Fehlversuch ohne Positionsdaten eine
    // leere neue Ausschlussflaeche stehen, und die Auswahl waere ohne jeden Punkt umgesprungen.
    if (capturePreconditionKey()) return null;
    if (decision.startsNewArea) {
      const nested = state.undoSuspended;
      state.undoSuspended = true;
      try { await createExclusion(); } finally { state.undoSuspended = nested; }
      startedArea = currentExclusion();
      target = startedArea?.points || null;
    } else {
      target = decision.points;
    }
  }
  if (!target || capturePreconditionKey()) return null;
  const point = pointFromTelemetry();
  commitUndo(before);
  target.push(point);
  if (save) await saveActiveMap();
  if (!automatic) {
    ui.pointStatus.textContent = startedArea
      ? tr('areaStartedNew', { name: localizedExclusionName(startedArea, state.activeMap.exclusions.indexOf(startedArea)) })
      : tr('pointSaved', { x: point.x.toFixed(2), y: point.y.toFixed(2) });
  }
  return point;
}

function stopAutoCapture({ render = true } = {}) {
  if (state.autoCaptureTimer) clearInterval(state.autoCaptureTimer);
  state.autoCaptureTimer = null;
  state.autoCaptureRunning = false;
  state.autoCaptureBusy = false;
  state.autoCaptureLastPoint = null;
  releaseWakeLock();
  if (render) { renderMap(); refreshCaptureState(); }
}

/** Zeitgesteuerte Aufnahme: alle state.view.autoCaptureIntervalS Sekunden ein Punkt. */
async function startAutoCapture() {
  if (!ensureMapEditable()) return;
  if (!state.activeMap || !telemetryIsFresh() || (ui.fixOnly.checked && !telemetryHasFix())) return;
  // Dieselbe Auskunft wie beim Einzelpunkt: eine geschlossene Flaeche nimmt nichts mehr an.
  const startTarget = captureTarget();
  if (startTarget.blockKey) { ui.pointStatus.textContent = tr(startTarget.blockKey); return; }
  if (startTarget.startsNewArea) await createExclusion();
  clearPointSelection({ render: false });
  state.autoCaptureRunning = true;
  state.autoCaptureCount = 0;
  state.autoCaptureLastPoint = null; // der erste Takt setzt den Bezugspunkt
  requestWakeLockIfNeeded();
  await autoCaptureTick();
  // Im Distanzmodus entscheidet nicht der Takt, sondern die gefahrene Strecke — deshalb wird
  // so oft geprueft, wie ueberhaupt neue Positionen eintreffen.
  const intervalMs = state.view.autoCaptureMode === 'distance'
    ? BLE_POLL_INTERVAL_MS
    : Math.max(1, state.view.autoCaptureIntervalS) * 1000;
  state.autoCaptureTimer = setInterval(() => {
    // Eine still weiterlaufende, aber fehlschlagende Automatik waere das Schlimmste:
    // anhalten und den Grund zeigen.
    autoCaptureTick().catch((error) => { stopAutoCapture(); reportError(error); });
  }, intervalMs);
  renderMap(); refreshCaptureState();
}

async function autoCaptureTick() {
  if (!state.autoCaptureRunning || state.autoCaptureBusy) return;
  if (!telemetryIsFresh() || (ui.fixOnly.checked && !telemetryHasFix())) {
    ui.pointStatus.textContent = tr('autoCaptureWaiting');
    return;
  }
  state.autoCaptureBusy = true;
  try {
    // Eine geschlossene Kontur nimmt nichts mehr an. Eine still weiterlaufende, aber wirkungslose
    // Automatik waere das Schlimmste — deshalb anhalten und den Grund nennen.
    const blocked = captureTarget().blockKey;
    if (blocked) {
      stopAutoCapture({ render: false });
      ui.pointStatus.textContent = tr(blocked);
      renderMap(); refreshCaptureState();
      return;
    }
    if (state.mode === 'perimeter' && perimeterClosureCandidate()) {
      await closePerimeter({ automatic: true });
      stopAutoCapture({ render: false });
      renderMap(); refreshCaptureState();
      return;
    }
    // Distanzmodus: erst ausloesen, wenn seit dem letzten Auto-Punkt genug Strecke liegt.
    // Der Bezugspunkt ist der zuletzt tatsaechlich gesetzte Punkt, nicht die letzte Messung —
    // sonst wuerde sich der Schwellwert bei langsamer Fahrt in kleinen Schritten aufaddieren.
    if (state.view.autoCaptureMode === 'distance' && state.autoCaptureLastPoint) {
      const now = pointFromTelemetry();
      const moved = Math.hypot(now.x - state.autoCaptureLastPoint.x, now.y - state.autoCaptureLastPoint.y);
      if (moved < state.view.autoCaptureDistanceCm / 100) return;
    }
    const point = await appendCurrentPoint({ automatic: true });
    if (point) {
      state.autoCaptureLastPoint = { x: point.x, y: point.y };
      state.autoCaptureCount += 1;
      ui.pointStatus.textContent = tr('autoPointSaved', { count: state.autoCaptureCount, x: point.x.toFixed(2), y: point.y.toFixed(2) });
      renderMap(); refreshCaptureState();
    }
  } finally {
    state.autoCaptureBusy = false;
  }
}

async function toggleAutoCapture() {
  if (state.autoCaptureRunning) { stopAutoCapture(); return; }
  await startAutoCapture();
}

async function addCurrentPoint() {
  if (state.activeMap?.locked) { ensureMapEditable(); return; }
  if (captureButtonMoves()) { await movePointToMower(); return; }
  // Frueher oeffnete ein Tipp hier den geschlossenen Perimeter wieder — eine Nebenwirkung, die
  // niemand angefordert hat. Der Ring bleibt jetzt zu; `captureTarget()` meldet den Grund.
  if (state.mode === 'perimeter' && perimeterClosureCandidate()) { await closePerimeter(); return; }
  await appendCurrentPoint();
  renderMap();
  refreshCaptureState();
}

/** Loescht den aktuell ausgewaehlten Punkt (Werkzeug oben rechts auf der Karte). */
async function deleteSelectedPoint() {
  if (!ensureMapEditable()) return;
  const target = getSelectedPointArray();
  const sel = state.selectedPoint;
  if (!target || !sel || !target[sel.index]) return;
  pushUndo();
  // Eine Ecke zu entfernen oeffnet keinen Ring: das Modell speichert keinen Schlusspunkt, der
  // Ringschluss ist allein das Kennzeichen. Frueher wurde es hier zurueckgesetzt, und zwar nur
  // fuer den Perimeter — daran hingen zwei Symptome: das Erweitern-Feld verschwand
  // dauerhaft (`canStartExtension()` liest dasselbe Feld), und der Umriss ging an der Kante
  // letzter↔erster Punkt auf, also sichtbar weit weg von der geloeschten Stelle. Ob die Kontur
  // danach noch als Flaeche taugt, ist eine **andere** Frage; die beantwortet
  // `hasUsablePolygon()` an ihrer einen Stelle und `checkPerimeterTooFew` meldet sie.
  target.splice(sel.index, 1);
  state.selectedPoint = null;
  state.validationResult = null;
  await saveActiveMap();
  renderMap();
  refreshCaptureState();
  ui.pointStatus.textContent = tr('pointDeleted', { n: sel.index + 1 });
}

/**
 * Schnappschuss der Kartengeometrie. Bewusst nur Geometrie und Auswahlziel — Name, Sperre und
 * Zeitstempel gehoeren nicht zu einem Bearbeitungsschritt.
 */
function geometrySnapshot() {
  const map = state.activeMap;
  if (!map) return null;
  const copy = (points) => points.map((p) => ({ ...p }));
  return {
    mapId: map.id,
    perimeter: copy(map.perimeter),
    perimeterClosed: Boolean(map.perimeterClosed),
    exclusions: map.exclusions.map((e) => ({ ...e, points: copy(e.points) })),
    waypoints: copy(map.waypoints),
    dockPoints: copy(map.dockPoints),
    activeExclusionId: state.activeExclusionId,
  };
}

/**
 * Legt einen Schnappschuss auf den Stapel. Waehrend state.undoSuspended (zusammengesetzte
 * Aktionen wie „schliessen & neu“) wird nichts abgelegt, damit ein Tipp des Nutzers auch genau
 * einem Undo-Schritt entspricht. Aelteste Eintraege fallen ueber UNDO_STACK_LIMIT hinaus weg.
 */
function commitUndo(snapshot) {
  if (!snapshot || state.undoSuspended) return;
  state.undoStack.push(snapshot);
  trimUndoStack(state.undoStack);
  refreshUndoButton();
}

function pushUndo() {
  commitUndo(geometrySnapshot());
}

/** Fuehrt eine zusammengesetzte Aktion als genau einen Undo-Schritt aus. */
async function asOneUndoStep(fn) {
  const before = geometrySnapshot();
  const nested = state.undoSuspended;
  state.undoSuspended = true;
  try {
    return await fn();
  } finally {
    state.undoSuspended = nested;
    commitUndo(before);
  }
}

function clearUndoStack() {
  // An Ort und Stelle leeren, nicht neu zuweisen: `state.undoStack` **ist** `map.undoStack`.
  state.undoStack.length = 0;
  refreshUndoButton();
}

/**
 * Haelt den Stapel innerhalb beider Grenzen: hoechstens `UNDO_STACK_LIMIT` Schritte **und**
 * hoechstens `UNDO_STACK_BYTE_BUDGET`. Die Groesse wird am **neuesten** Schnappschuss gemessen
 * und hochgerechnet, statt den ganzen Stapel zu serialisieren: alle Schnappschuesse einer Karte
 * sind nahezu gleich gross, und ein vollstaendiges `JSON.stringify` je aufgenommenem Punkt waere
 * genau die Last, die das Budget vermeiden soll.
 */
function trimUndoStack(stack) {
  if (!stack.length) return;
  const bytes = JSON.stringify(stack[stack.length - 1]).length;
  // **Eine** Rechnung fuer beide Grenzen: die Stueckzahl ist die Obergrenze des Erlaubten, das
  // Budget kann sie weiter druecken. Eine zusaetzliche Schleife nur fuer die 20 waere eine zweite
  // Aussage ueber dieselbe Grenze — und liesse sich aendern, ohne dass etwas anschlaegt.
  const allowed = Math.max(1, Math.min(UNDO_STACK_LIMIT, Math.floor(UNDO_STACK_BYTE_BUDGET / Math.max(1, bytes))));
  while (stack.length > allowed) stack.shift();
}

/** Aktiviert/deaktiviert den Rueckgaengig-Knopf anhand des Stapels. */
/**
 * Zeigt in der Karteninfo, ob die gerade bearbeitete Kontur offen oder geschlossen ist.
 * `activeContour()` liefert nur fuer Perimeter und Ausschlussflaechen etwas — Wegpunkte und
 * Dockpfad sind offene Pfade, dort waere die Angabe sinnlos. Ohne Kontur bleibt das Feld leer
 * und verschwindet per `.info-chip:empty` ganz.
 */
function refreshContourStatus() {
  if (!ui.contourStatus) return;
  ui.contourStatus.textContent = contourStatusChipText();
}

/**
 * Text des Konturfeldes in der Karteninfo: **Name der betroffenen Kontur plus ihr Zustand**,
 * etwa „Perimeter · geschlossen“ oder „Ausschluss 2 · offen“ — nie der Zustand allein.
 *
 * Welche Kontur betroffen ist, entscheidet sich in dieser Reihenfolge:
 *   1. Ein ausgewaehlter **Einzelpunkt** bringt seine Kontur schon in der Statuszeile daneben
 *      mit („Ausschluss 1 · Punkt 3 · offen“, aus `selectedPointLabel()`, von jedem
 *      Telemetrie-Takt neu geschrieben). Das Feld bleibt dann leer, sonst stuende der Name
 *      zweimal in derselben Zeile.
 *   2. Eine ausgewaehlte **Flaeche** — deren Auswahlmeldung ist nur voruebergehend, das Feld
 *      muss den Namen also selbst tragen.
 *   3. Sonst die Kontur des aktiven Modus (`activeContour()`).
 * Bei Wegpunkten und Dockpfad bleibt es leer und verschwindet per `.info-chip:empty` ganz.
 */
function contourStatusChipText() {
  if (!state.activeMap) return '';
  if (state.selectedPoint) return '';
  const named = (exclusion) => (exclusion
    ? `${localizedExclusionName(exclusion, state.activeMap.exclusions.indexOf(exclusion))}`
      + contourStateSuffix('exclusion', exclusion.id)
    : '');
  const area = selectedExclusion();
  if (area) return named(area);
  const contour = activeContour();
  if (!contour) return '';
  if (contour.role === 'perimeter') return tr('perimeter') + contourStateSuffix('perimeter', null);
  return named(currentExclusion());
}

/** Blendet die Werkzeugleiste ein bzw. aus, je nachdem ob ueberhaupt ein Werkzeug sichtbar ist. */
function refreshToolbarVisibility() {
  if (!ui.mapToolbar) return;
  const slots = [ui.deleteFabWrap, ui.insertBeforeWrap, ui.insertAfterWrap, ui.closeAndNewWrap, ui.extendWrap];
  // Seit der Kartenname hier steht, ist die Leiste praktisch immer belegt. Sie klappt nur noch
  // ein, wenn wirklich nichts darin steht — sonst wuerde ausgerechnet der Name verschwinden.
  // Der Infoblock traegt jetzt zwei Zeilen: Name und darunter Punktzahl/Konturzustand. Solange
  // eine davon gefuellt ist, bleibt die Leiste stehen — sonst verschwaende ausgerechnet sie.
  const hasInfo = Boolean((ui.mapNameLabel?.textContent || '').trim())
    || Boolean((ui.mapSummary?.textContent || '').trim())
    || Boolean((ui.contourStatus?.textContent || '').trim());
  ui.mapToolbar.hidden = !hasInfo && !slots.some((slot) => slot && !slot.hidden);
}

function refreshUndoButton() {
  if (!ui.undoBtn) return;
  const usable = Boolean(state.activeMap) && !state.activeMap.locked && state.undoStack.length > 0;
  ui.undoBtn.disabled = !usable;
  ui.undoBtn.setAttribute('aria-disabled', String(!usable));
}

/** Nimmt genau einen Bearbeitungsschritt zurueck. */
async function undoLastAction() {
  if (!state.activeMap || !state.undoStack.length) return;
  if (!ensureMapEditable()) return;
  const snapshot = state.undoStack.pop();
  // Der Stapel gilt nur fuer die gerade offene Karte; ein Kartenwechsel leert ihn ohnehin.
  if (snapshot.mapId !== state.activeMap.id) { clearUndoStack(); return; }
  const map = state.activeMap;
  map.perimeter = snapshot.perimeter.map((p) => ({ ...p }));
  map.perimeterClosed = snapshot.perimeterClosed;
  map.exclusions = snapshot.exclusions.map((e) => ({ ...e, points: e.points.map((p) => ({ ...p })) }));
  map.waypoints = snapshot.waypoints.map((p) => ({ ...p }));
  map.dockPoints = snapshot.dockPoints.map((p) => ({ ...p }));
  state.activeExclusionId = map.exclusions.some((e) => e.id === snapshot.activeExclusionId)
    ? snapshot.activeExclusionId : (map.exclusions[0]?.id || null);
  state.selectedPoint = null;
  state.selectedArea = null;
  state.validationResult = null;
  await saveActiveMap();
  renderElementList();
  renderMap();
  refreshCaptureState();
  refreshUndoButton();
  ui.pointStatus.textContent = tr(state.undoStack.length ? 'undoDone' : 'undoDoneLast');
}

async function undoPoint() {
  if (!ensureMapEditable()) return;
  const target = getActivePointArray();
  if (!target?.length) return;
  pushUndo();
  // Denselben Griff gab es hier; dieselbe Begruendung wie in `deleteSelectedPoint()`. Den
  // letzten Punkt zu entfernen verschiebt nur, wo die Schlusskante ansetzt.
  target.pop();
  state.selectedPoint = null;
  await saveActiveMap();
  renderMap();
  refreshCaptureState();
}

function allMapPoints() {
  const points = [];
  if (state.activeMap) {
    points.push(...state.activeMap.perimeter, ...state.activeMap.dockPoints, ...state.activeMap.waypoints);
    state.activeMap.exclusions.forEach((e) => points.push(...e.points));
  }
  if (state.view.showTrail) points.push(...state.trail);
  const freshTelemetry = Number.isFinite(state.telemetry.x) && Number.isFinite(state.telemetry.y) && Date.now() - state.telemetry.receivedAt < 6000;
  if (freshTelemetry && state.view.showMower) {
    const radius = Math.hypot(state.view.mowerLength, state.view.mowerWidth) / 2;
    points.push(
      { x: state.telemetry.x - radius, y: state.telemetry.y - radius },
      { x: state.telemetry.x + radius, y: state.telemetry.y + radius }
    );
  }
  return points;
}

/**
 * Schloss-Symbol fuer die Kartenuebersicht. Die frueheren Emoji 🔒/🔓 waren im Dunkeln kaum
 * zu unterscheiden — jetzt ein gezeichnetes Schloss: geschlossen mit Buegel auf dem Koerper,
 * offen mit hochgeklapptem Buegel, dazu unterschiedliche Farben und beim gesperrten Zustand
 * das Wort „Gesperrt“.
 */
function lockIcon(locked) {
  const icon = svgEl('svg', { viewBox: '0 0 24 24', class: `lock-icon${locked ? ' locked' : ' open'}`, 'aria-hidden': 'true' });
  icon.appendChild(svgEl('rect', { x: 3.5, y: 11, width: 17, height: 10, rx: 2.4, class: 'lock-body' }));
  icon.appendChild(svgEl('path', {
    // geschlossen: Buegel sitzt mittig auf dem Koerper.
    // offen: Buegel klappt deutlich nach rechts weg und endet neben dem Koerper.
    d: locked ? 'M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11' : 'M7.5 11V7.5a4.5 4.5 0 0 1 9 0',
    class: 'lock-shackle',
  }));
  if (locked) icon.appendChild(svgEl('circle', { cx: 12, cy: 16, r: 1.6, class: 'lock-keyhole' }));
  return icon;
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

const MAP_PADDING = 24; // Rand um die Karte in viewBox-Einheiten (= CSS-Pixel)
const MIN_USER_ZOOM = 0.6;
// Obergrenze des Nutzer-Zooms: 14 (bis v64) -> 60 (v65) -> 200 (v66), damit sich auch sehr dicht
// gesetzte Punkte noch einzeln treffen lassen. Minimum und Schrittweite (Rad 1,15 je Raste,
// Pinch stufenlos) bleiben unveraendert.
const MAX_USER_ZOOM = 200;

/**
 * Der viewBox war fest auf 1000x680. Auf einem hochkant gehaltenen Telefon passt dieses
 * Seitenverhaeltnis nicht zur Kartenflaeche, und "meet" legt oben und unten breite leere
 * Streifen an — die Karte nutzte nur ein Band in der Mitte. Deshalb folgt der viewBox jetzt
 * der gemessenen Flaeche: eine viewBox-Einheit ist genau ein CSS-Pixel.
 */
function updateViewBox() {
  const rect = ui.mapSvg.getBoundingClientRect?.() || { width: 1000, height: 680 };
  const w = Math.max(200, Math.round(rect.width || 1000));
  const h = Math.max(200, Math.round(rect.height || 680));
  if (w === state.viewBox.w && h === state.viewBox.h) return state.viewBox;
  state.viewBox = { w, h };
  ui.mapSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  // **Die eingefrorene Basis bleibt stehen.** Frueher wurde sie hier verworfen ("passt nicht mehr
  // zur neuen Flaeche") — und genau das riss dem Nutzer beim Erweitern dreimal die Ansicht weg:
  // der Hinweisstreifen `#extendPanel` ist ein Geschwister von `.map-canvas-area` (`flex: 1 1
  // auto`), also aendert jedes Ein- und Ausblenden **und jede andere Textlaenge darin** die
  // gemessene Hoehe des SVG. Mit verworfener Basis rechnet `activeTransform()` den Auto-Fit neu
  // und springt auf die aktuelle Geometrie.
  //
  // Behalten wir sie, bleibt der Inhalt an denselben viewBox-Koordinaten stehen: die gewonnene
  // oder verlorene Hoehe faellt unten an, es bewegt sich nichts.
  //
  // **Auch nicht geklemmt**, obwohl das naheliegt: `clampViewport()` haelt die Karte im Bild, und
  // seine Grenzen haengen an der Flaechenhoehe — bei starker Vergroesserung schiebt schon ein um
  // 60 px niedrigeres SVG den Ausschnitt messbar zurecht. Das waere wieder genau die Bewegung,
  // die hier abgestellt werden soll. Der Fall, fuer den das Verwerfen gedacht war (Drehen des
  // Geraets, Karte danach weit ausserhalb), bleibt erreichbar: jede Zieh- oder Zoomgeste klemmt
  // ohnehin, und „Ansicht zuruecksetzen“ steht in genau diesem Zustand sichtbar auf der Karte.
  return state.viewBox;
}

function svgMetrics() {
  const rect = ui.mapSvg.getBoundingClientRect?.() || { left: 0, top: 0, width: state.viewBox.w, height: state.viewBox.h };
  const { w, h } = state.viewBox;
  const scale = Math.min((rect.width || w) / w, (rect.height || h) / h) || 1;
  return { rect, scale, offX: ((rect.width || w) - w * scale) / 2, offY: ((rect.height || h) - h * scale) / 2 };
}

function pointerToViewBox(event) {
  const m = svgMetrics();
  return { x: (event.clientX - m.rect.left - m.offX) / m.scale, y: (event.clientY - m.rect.top - m.offY) / m.scale };
}

function resetViewport({ render = true } = {}) {
  state.viewport = { zoom: 1, dx: 0, dy: 0, custom: false, base: null };
  if (ui.fitViewBtn) ui.fitViewBtn.hidden = true;
  if (render) renderMap();
}

/** Verhindert, dass die Karte aus dem Bild geschoben wird. */
function clampViewport() {
  const vp = state.viewport;
  const { w, h } = state.viewBox;
  const pad = MAP_PADDING;
  // Mindestens ein Fuenftel der Flaeche muss Karte zeigen, sonst verirrt man sich im Leeren.
  const keepX = w * 0.2;
  const keepY = h * 0.2;
  vp.zoom = clampNumber(vp.zoom, MIN_USER_ZOOM, MAX_USER_ZOOM, 1);
  vp.dx = clampNumber(vp.dx, keepX - (w - pad) * vp.zoom, (w - keepX) - pad * vp.zoom, 0);
  vp.dy = clampNumber(vp.dy, keepY - (h - pad) * vp.zoom, (h - keepY) - pad * vp.zoom, 0);
}

/** Auto-Fit, solange der Nutzer nicht selbst gezoomt hat; danach eingefrorene Basis + Nutzer-Zoom. */
function activeTransform() {
  const vp = state.viewport;
  if (!vp.custom) return computeTransform(allMapPoints());
  const base = vp.base || computeTransform(allMapPoints());
  const scale = base.scale * vp.zoom;
  const ox = base.ox * vp.zoom + vp.dx;
  const oy = base.oy * vp.zoom + vp.dy;
  // Raster und Hilfslinien richten sich nach dem sichtbaren Ausschnitt, nicht nach dem Auto-Fit.
  return { scale, ox, oy, minX: -ox / scale, maxX: (1000 - ox) / scale, minY: (oy - 680) / scale, maxY: oy / scale };
}

function beginCustomViewport() {
  const vp = state.viewport;
  if (vp.custom) return;
  vp.base = computeTransform(allMapPoints());
  vp.custom = true;
  vp.zoom = 1; vp.dx = 0; vp.dy = 0;
  if (ui.fitViewBtn) ui.fitViewBtn.hidden = false;
}

function computeTransform(points) {
  const { w, h } = state.viewBox;
  const inner = { w: w - 2 * MAP_PADDING, h: h - 2 * MAP_PADDING };
  if (!points.length) {
    // Leere Karte: rund 10 m Breite zeigen, Rest ergibt sich aus dem Seitenverhaeltnis.
    const scale = inner.w / 10;
    return {
      scale, ox: w / 2, oy: h / 2,
      minX: -w / 2 / scale, maxX: w / 2 / scale, minY: -h / 2 / scale, maxY: h / 2 / scale,
    };
  }
  let minX = Math.min(...points.map((p) => p.x));
  let maxX = Math.max(...points.map((p) => p.x));
  let minY = Math.min(...points.map((p) => p.y));
  let maxY = Math.max(...points.map((p) => p.y));
  if (maxX - minX < 2) { minX -= 1; maxX += 1; }
  if (maxY - minY < 2) { minY -= 1; maxY += 1; }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.12 + 0.5;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const scale = Math.min(inner.w / (maxX - minX), inner.h / (maxY - minY));
  const ox = MAP_PADDING - minX * scale + (inner.w - (maxX - minX) * scale) / 2;
  const oy = MAP_PADDING + maxY * scale + (inner.h - (maxY - minY) * scale) / 2;
  return { scale, ox, oy, minX, maxX, minY, maxY };
}

function toScreen(point, tr) {
  return { x: tr.ox + point.x * tr.scale, y: tr.oy - point.y * tr.scale };
}

/** Umkehrung von toScreen: viewBox-Koordinaten zurueck in Sunray-XY-Meter. */
function toMapCoords(point, tr) {
  return { x: (point.x - tr.ox) / tr.scale, y: (tr.oy - point.y) / tr.scale };
}

function drawPolyline(points, tr, className, close = false) {
  if (!points.length) return;
  const screen = points.map((p) => toScreen(p, tr));
  const coords = screen.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const tag = close && points.length >= 3 ? 'polygon' : 'polyline';
  ui.shapeLayer.appendChild(svgEl(tag, { points: coords, class: className }));
}

function pointRefMatches(ref, meta, index) {
  return Boolean(ref && ref.role === meta.role && ref.index === index && (ref.role !== 'exclusion' || ref.exclusionId === meta.exclusionId));
}

function isSelectedPoint(meta, index) {
  return pointRefMatches(state.selectedPoint, meta, index);
}

/**
 * Welche Markierung ein Punkt der Erweiterung traegt — `'active'`, `'second'` oder `null`.
 *
 * Das **aktive Ende** beantwortet ausschliesslich `extensionEndIndex()`: in der Auswahlphase der
 * zuerst getippte Punkt, danach das offene Ende. In der Auswahlphase kommt der **zweite**
 * gewaehlte Punkt dazu, solange die Rueckschau laeuft: die Hinweiszeile nennt eine Punktzahl, die
 * zwischen beiden verschwindet, und ohne beide Markierungen waere nicht zu sehen, welche Strecke
 * gemeint ist.
 *
 * **Die beiden sehen seit v70 verschieden aus** (eigene Farbe, dazu blinkt das aktive Ende): sie
 * bedeuten Verschiedenes — am aktiven Ende wird weitergebaut, der zweite ist nur vorgemerkt und
 * laesst sich durch einen Tipp auf einen anderen Punkt noch wechseln. Zwei gleich markierte Punkte
 * liessen genau das nicht erkennen. Welcher der aktive ist, entscheidet weiterhin allein
 * `extensionEndIndex()` — hier steht keine zweite Antwort auf dieselbe Frage.
 */
function extensionPickKind(meta, index) {
  const ext = state.extension;
  if (!ext) return null;
  if (meta.role !== ext.role || (ext.role === 'exclusion' && meta.exclusionId !== ext.exclusionId)) return null;
  if (extensionEndIndex(ext) === index) return 'active';
  if (ext.phase === 'picking' && ext.secondIndex === index) return 'second';
  return null;
}

function isExtensionPick(meta, index) {
  return extensionPickKind(meta, index) !== null;
}

function drawPoints(points, tr, className, meta) {
  points.forEach((p, index) => {
    const s = toScreen(p, tr);
    const selected = isSelectedPoint(meta, index);
    const common = {
      'data-map-point': '1',
      'data-point-role': meta.role,
      'data-point-index': String(index),
    };
    if (meta.exclusionId) common['data-exclusion-id'] = meta.exclusionId;

    // Unsichtbares Touch-Ziel: mindestens 44x44 px, unabhaengig vom Zoom.
    const hit = svgEl('circle', {
      cx: s.x, cy: s.y, r: state.hitRadiusUnits, class: 'map-point-hit', tabindex: '0', role: 'button', ...common,
    });
    const hitTitle = svgEl('title');
    hitTitle.textContent = `#${index + 1} X ${p.x.toFixed(2)} / Y ${p.y.toFixed(2)}`;
    hit.appendChild(hitTitle);
    ui.shapeLayer.appendChild(hit);

    const pick = extensionPickKind(meta, index);
    const pickClass = pick ? ` extend-pick-point extend-pick-${pick}` : '';
    const qualityClass = state.view.showPointQuality ? ` quality-${pointQuality(p)}` : '';
    const circle = svgEl('circle', {
      cx: s.x, cy: s.y, r: selected ? 9 : 5,
      class: `${className} map-point${qualityClass}${selected ? ' selected-map-point' : ''}${pickClass}`,
      'pointer-events': 'none', role: 'img', ...common,
    });
    ui.shapeLayer.appendChild(circle);
    if (selected) ui.shapeLayer.appendChild(svgEl('circle', { cx: s.x, cy: s.y, r: 15, class: 'edit-selected-ring', 'pointer-events': 'none' }));
    if (pick) {
      ui.shapeLayer.appendChild(svgEl('circle', {
        cx: s.x, cy: s.y, r: 15, class: `extend-pick-ring extend-pick-ring-${pick}`, 'pointer-events': 'none',
      }));
    }
  });
}

function niceGridStep(span) {
  if (span <= 5) return 0.5;
  if (span <= 12) return 1;
  if (span <= 30) return 2;
  if (span <= 70) return 5;
  return 10;
}

function drawGrid(transform) {
  ui.gridLayer.innerHTML = '';
  if (!state.view.showGrid) return;
  const span = Math.max(transform.maxX - transform.minX, transform.maxY - transform.minY);
  const step = state.view.gridStep === 'auto' ? niceGridStep(span) : Number(state.view.gridStep);
  if (!Number.isFinite(step) || step <= 0) return;
  const xStart = Math.floor(transform.minX / step) * step;
  const yStart = Math.floor(transform.minY / step) * step;
  const majorStep = step * 5;
  const epsilon = step * 0.001;
  const lineClass = (value) => {
    if (Math.abs(value) < epsilon) return 'grid-line grid-axis';
    const nearestMajor = Math.round(value / majorStep) * majorStep;
    if (Math.abs(value - nearestMajor) < epsilon) return 'grid-line grid-major';
    return 'grid-line';
  };
  for (let x = xStart; x <= transform.maxX + step; x += step) {
    const a = toScreen({ x, y: transform.minY }, transform);
    const b = toScreen({ x, y: transform.maxY }, transform);
    ui.gridLayer.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: lineClass(x) }));
  }
  for (let y = yStart; y <= transform.maxY + step; y += step) {
    const a = toScreen({ x: transform.minX, y }, transform);
    const b = toScreen({ x: transform.maxX, y }, transform);
    ui.gridLayer.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: lineClass(y) }));
  }
}

function drawRobot(transform) {
  if (!state.view.showMower) return;
  const t = state.telemetry;
  const fresh = Number.isFinite(t.x) && Number.isFinite(t.y) && Date.now() - t.receivedAt < 6000;
  if (!fresh) return;

  const center = toScreen(t, transform);
  const lengthPx = Math.max(0.1, state.view.mowerLength) * transform.scale;
  const widthPx = Math.max(0.1, state.view.mowerWidth) * transform.scale;
  const angleDeg = Number.isFinite(t.delta) ? (-t.delta * 180 / Math.PI) : 0;
  const group = svgEl('g', {
    class: 'robot-mower',
    transform: `rotate(${angleDeg.toFixed(2)} ${center.x.toFixed(2)} ${center.y.toFixed(2)})`,
  });

  const title = svgEl('title');
  title.textContent = tr('mowerTooltip', { length: state.view.mowerLength.toFixed(2), width: state.view.mowerWidth.toFixed(2) });
  group.appendChild(title);

  const body = svgEl('rect', {
    x: center.x - lengthPx / 2,
    y: center.y - widthPx / 2,
    width: lengthPx,
    height: widthPx,
    rx: Math.min(10, Math.max(2, widthPx * 0.18)),
    class: 'robot-body',
  });
  group.appendChild(body);

  const frontX = center.x + lengthPx / 2;
  const noseDepth = Math.min(Math.max(4, lengthPx * 0.16), 18);
  const noseHalf = Math.min(Math.max(3, widthPx * 0.24), 12);
  group.appendChild(svgEl('polygon', {
    points: `${frontX},${center.y} ${frontX - noseDepth},${center.y - noseHalf} ${frontX - noseDepth},${center.y + noseHalf}`,
    class: 'robot-front',
  }));

  group.appendChild(svgEl('line', {
    x1: center.x - lengthPx * 0.22, y1: center.y - widthPx / 2,
    x2: center.x - lengthPx * 0.22, y2: center.y + widthPx / 2,
    class: 'robot-axle',
  }));
  group.appendChild(svgEl('circle', { cx: center.x, cy: center.y, r: 3.5, class: 'robot-center' }));
  ui.robotLayer.appendChild(group);

  ui.robotLayer.appendChild(svgEl('circle', { cx: center.x, cy: center.y, r: 7, class: 'robot-position-marker' }));
}

function drawMovementTrail(transform) {
  if (!state.view.showTrail || state.trail.length < 2) return;
  drawPolyline(state.trail, transform, 'movement-trail-shape', false);
}

function nearestPointOnSegment(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-12) return { x: a.x, y: a.y, distance: xyDistance(p, a) };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { ...q, distance: xyDistance(p, q) };
}

function nearestBoundaryPoint() {
  if (!state.activeMap || !telemetryIsFresh() || state.activeMap.perimeter.length < 2) return null;
  const points = state.activeMap.perimeter;
  let best = null;
  const count = points.length >= 3 ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    if (!b) continue;
    const candidate = nearestPointOnSegment(state.telemetry, a, b);
    if (!best || candidate.distance < best.distance) best = candidate;
  }
  return best;
}

function drawDistanceGuide(transform) {
  const nearest = nearestBoundaryPoint();
  if (!nearest || nearest.distance > 8) return;
  const a = toScreen(state.telemetry, transform); const b = toScreen(nearest, transform);
  ui.robotLayer.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'boundary-distance-line' }));
}

function refreshMapDistanceInfo() {
  const bits = [];
  const nearest = nearestBoundaryPoint();
  if (nearest) bits.push(tr('distanceToBoundary', { distance: nearest.distance.toFixed(2) }));
  if (state.selectedPoint) {
    const d = mowerDistanceToSelected(); if (Number.isFinite(d)) bits.push(tr('distanceToPoint', { distance: d.toFixed(2) }));
  }
  ui.mapDistanceInfo.textContent = bits.length ? bits.join(' · ') : '–';
}

function renderMap() {
  updateViewBox();
  ui.shapeLayer.innerHTML = '';
  ui.robotLayer.innerHTML = '';
  const transform = activeTransform();
  state.currentTransform = transform;
  state.hitRadiusUnits = Math.max(22, 22 / svgMetrics().scale);
  drawGrid(transform);
  drawMovementTrail(transform);

  if (state.activeMap) {
    ui.activeMapName.textContent = localizedMapName(state.activeMap);
    drawPolyline(state.activeMap.perimeter, transform, 'perimeter-shape', Boolean(state.activeMap.perimeterClosed));
    drawPoints(state.activeMap.perimeter, transform, 'point-perimeter', { role: 'perimeter' });
    state.activeMap.exclusions.forEach((exclusion) => {
      drawPolyline(exclusion.points, transform, `exclusion-shape${exclusion.id === state.selectedArea ? ' selected-area' : ''}`, exclusion.closed !== false);
      drawPoints(exclusion.points, transform, 'point-exclusion', { role: 'exclusion', exclusionId: exclusion.id });
    });
    drawPolyline(state.activeMap.waypoints, transform, 'waypoint-shape', false);
    drawPoints(state.activeMap.waypoints, transform, 'point-waypoint', { role: 'waypoint' });
    drawPolyline(state.activeMap.dockPoints, transform, 'dock-shape', false);
    drawPoints(state.activeMap.dockPoints, transform, 'point-dock', { role: 'dock' });

    // Der Kartenname steht oben in der Werkzeugleiste, auf der Karte selbst nur noch die
    // Punktzahl — sonst stuende derselbe Name zweimal auf dem Bildschirm.
    ui.mapNameLabel.textContent = localizedMapName(state.activeMap);
    ui.mapSummary.textContent = tr('mapPoints', { points: mapPointCount(state.activeMap) });
  } else {
    ui.activeMapName.textContent = tr('noMap');
    ui.mapNameLabel.textContent = tr('noMapLoaded');
    ui.mapSummary.textContent = '';
  }

  refreshContourStatus();
  refreshGpsScatter();
  drawSelectionGuide(transform);
  drawExtensionGuide(transform);
  drawDistanceGuide(transform);
  drawRobot(transform);
  refreshMapDistanceInfo();
  refreshDeleteButton();

}

function safeFileName(name) {
  return (name || 'mapcreator-ardumower-map').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'mapcreator-ardumower-map';
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Endung, MIME-Typ und Inhalt je Exportformat — die einzige Stelle, an der das festgelegt ist. */
/**
 * Vorgaben fuer die Maehfelder der Sunray-App-Datei. **Diese App steuert kein Maehen** (feste
 * Projektregel), fuehrt diese Einstellungen also nicht und kann sie nicht aus der Karte ableiten.
 * Geschrieben werden deshalb neutrale Werte, die in der echten App-Datei ueber alle zehn Karten
 * unveraendert vorkommen: `patternRings: false` und alle Maeh-/Randflaggen `true` (10 von 10).
 * `patternAngle` steht dort je Karte anders (1,22 bis 3,11 rad) und `mowOfs` streut ebenfalls
 * (0,19 / 0,2 / 0,5 / 0,51 m) — beide sind reine Maehparameter, die der Nutzer in der Zielanwendung
 * ohnehin einstellt. 0 bzw. 0,2 sind deshalb Platzhalter, keine Messwerte.
 */
const SUNRAY_APP_MOW_DEFAULTS = {
  patternAngle: 0,
  mowOfs: 0.2,
  patternRings: false,
  doMowExclusions: true,
  doMowPerimeter: true,
  doMowArea: true,
  doPerimeterBorder: true,
  doExclusionsBorder: true,
};

/**
 * Ein Konturpunkt in der Schreibweise der Sunray-App: `X`, `Y`, `delta`, `timestamp`, `sol` — in
 * genau dieser Reihenfolge, wie in der Vorlage.
 *
 * **`delta` und `timestamp` sind Pflicht**, nicht Zierde: CaSSAndRAs Sunray-Zweig raeumt sie mit
 * `coords.drop(['delta','timestamp'], axis=1)` (mapdata.py:491) weg — **ohne** `try`. Fehlt eines,
 * wirft `.drop()` einen KeyError, und die **ganze Datei** wird abgewiesen, nicht nur die Karte.
 * Empirisch geprueft gegen die echte Importfunktion.
 *
 * **`sol` ist optional** (mapdata.py:493-497 faengt es ab) — auch die echte App-Datei laesst es
 * bei einzelnen Punkten weg (4 von 3468). Wir schreiben es deshalb nur, wenn wir es haben, statt
 * eine Guete zu erfinden, die nie gemessen wurde.
 *
 * Die Werte sind nicht geraten: `timestamp` ist unser `capturedAt`, `sol` unser
 * `gps.solution` — beide stammen aus derselben Quelle wie bei der App (`AT+S` liefert
 * `solution`, comm.cpp:694). `delta` ist die Roboterorientierung in Bogenmass
 * (`stateEstimator.stateDelta`, comm.cpp:692); sie steht seit dieser Fassung in `gps.delta`.
 * Fehlt sie bei Altbestand, wird 0 geschrieben — der **Maeher sieht das Feld ohnehin nie**
 * (`AT+W` uebertraegt nur x und y, comm.cpp:354-387; `Map::setPoint()` map.cpp:769 nimmt nur x
 * und y; die Firmware-Klasse `Point` map.h:21-41 hat gar kein solches Feld), und CaSSAndRA
 * verwirft es in derselben Zeile, in der es das Feld liest.
 */
function sunrayAppPoint(point) {
  const out = {
    X: Number(point.x),
    Y: Number(point.y),
    delta: Number.isFinite(Number(point.gps?.delta)) ? Number(point.gps.delta) : 0,
    timestamp: point.capturedAt || point.originalCapturedAt || new Date(0).toISOString(),
  };
  const sol = Number(point.gps?.solution);
  if (Number.isFinite(sol)) out.sol = sol;
  return out;
}

/** Wegpunkte der Sunray-App tragen **nur** `X` und `Y` — kein delta, timestamp oder sol. */
function sunrayAppWaypoint(point) {
  return { X: Number(point.x), Y: Number(point.y) };
}

/**
 * Die Karte im Format der grauonline-Sunray-App.
 *
 * **Aeussere Huelle ist eine Liste**, auch fuer eine einzelne Karte: die Vorlage ist ein Array
 * von Karten (dort zehn), und `import_sunray()` laeuft mit `for map_number in range(len(df))`
 * (mapdata.py:471) ueber die Zeilen. Ein einzelnes Objekt waere eine andere Form.
 *
 * **Koordinaten bleiben lokale Sunray-Meter** — der Sunray-Zweig rechnet nichts um (anders als
 * der GeoJSON-Zweig ueber `coords_abs_to_rel`). Dieses Format braucht deshalb **keinen**
 * Bezugspunkt, und die Sperre des CaSSAndRA-Exports darf hier nicht greifen.
 *
 * **Ringe bleiben offen**: die Vorlage schreibt weder beim Perimeter noch bei Ausschlussflaechen
 * einen Schlusspunkt (in allen zehn Karten geprueft). Unser Modell fuehrt ohnehin keinen.
 *
 * **Leere Listen werden geschrieben**, weil die Vorlage sie schreibt (`dockpoints` ist dort in
 * allen zehn Karten leer, `waypoints` in vieren).
 */
function mapToSunrayApp(map) {
  if (!map) return null;
  return [{
    perimeter: (map.perimeter || []).map(sunrayAppPoint),
    // Flaechen, die als Polygon nicht taugen, bleiben draussen — dieselbe Entscheidung und
    // dieselbe Meldung wie beim CaSSAndRA-Export, ueber dieselbe Funktion.
    exclusions: (map.exclusions || [])
      .filter((exclusion) => hasUsablePolygon(exclusion.points))
      .map((exclusion) => (exclusion.points || []).map(sunrayAppPoint)),
    waypoints: (map.waypoints || []).map(sunrayAppWaypoint),
    dockpoints: (map.dockPoints || []).map(sunrayAppPoint),
    name: localizedMapName(map),
    ...SUNRAY_APP_MOW_DEFAULTS,
  }];
}

/**
 * Die Karte ohne ihre Undo-Historie — fuer alles, was die Karte **verlaesst** oder neu entsteht:
 * das JSON-Backup, eine Kopie, eine importierte Datei. Die Historie ist an die Kennung der Karte
 * gebunden (`snapshot.mapId`), in einer Kopie also ohnehin wertlos, und im Backup nur Ballast.
 */
function mapWithoutUndo(map) {
  if (!map) return map;
  const { undoStack, ...rest } = map;
  return rest;
}

const MAP_EXPORT_FORMATS = {
  // Endung und MIME aus der Vorlage `sunrayapp_map.json` abgeleitet: gewoehnliches JSON.
  // **Kein `blockKey`** — dieses Format fuehrt lokale Meter und braucht keinen Bezugspunkt.
  sunray: {
    extension: '.sunray.json',
    mimeType: 'application/json',
    build: (map) => JSON.stringify(mapToSunrayApp(map), null, 4),
  },
  json: {
    extension: '.mapcreator-ardumower.json',
    mimeType: 'application/json',
    // **Ohne die Undo-Historie.** Sie gehoert zur laufenden Bearbeitung, nicht zur Karte, die
    // jemand weitergibt — und sie waere das Zwanzigfache der Datei. `mapWithoutUndo()` ist die
    // einzige Stelle, die sie abstreift.
    build: (map) => JSON.stringify(mapWithoutUndo(map), null, 2),
  },
  geojson: {
    extension: '.geojson',
    mimeType: 'application/geo+json',
    build: (map) => JSON.stringify(mapToGeoJson(map), null, 2),
  },
  // Endung und MIME-Typ nach CaSSAndRAs eigenem Export (chooseperimeter.py:69 schreibt
  // `<Kartenname>.json`); dessen Upload-Bauteil schraenkt Endungen nicht ein und wertet den
  // Dateinamen nicht aus (uploadsunray.py:14, :32).
  cassandra: {
    extension: '.json',
    mimeType: 'application/json',
    blockKey: (map) => cassandraExportBlockKey(map),
    build: (map) => JSON.stringify(mapToCassandraGeoJson(map, cassandraReferenceInUse()), null, 2),
  },
};

/**
 * Einzige Quelle fuer Inhalt, Dateiname und MIME-Typ eines Kartenexports. Speichern und Teilen
 * holen ihre Datei ausdruecklich hier — sonst driften Format oder Dateiname zwischen den beiden
 * Wegen auseinander, und die geteilte Datei waere nicht mehr dieselbe wie die exportierte.
 */
function mapExportFile(format) {
  const spec = MAP_EXPORT_FORMATS[format];
  if (!spec || !state.activeMap) return null;
  // Derselbe Sperrgrund, der die Knoepfe ausgraut — damit kein Weg daran vorbeifuehrt, auch
  // nicht das Teilen. Lieber gar keine Datei als eine, die stillschweigend versetzt liegt oder
  // die die Gegenseite beim Einlesen abbrechen laesst.
  if (spec.blockKey && spec.blockKey(state.activeMap)) return null;
  return {
    text: spec.build(state.activeMap),
    fileName: `${safeFileName(localizedMapName(state.activeMap))}${spec.extension}`,
    mimeType: spec.mimeType,
  };
}

/** Liefert die erzeugte Datei zurueck, damit Aufrufer erkennen, ob wirklich etwas herauskam. */
function exportMapFile(format) {
  const file = mapExportFile(format);
  if (!file) return null;
  downloadTextFile(file.text, file.fileName, file.mimeType);
  return file;
}

function exportCurrentMapJson() { exportMapFile('json'); }

/**
 * Web Share API Level 2. Ohne `share`, `canShare` **und** `File` gibt es keinen Weg, eine Datei
 * weiterzureichen — dann bleibt der normale Export der einzige Pfad.
 */
function shareCapableNavigator() {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return null;
  if (typeof File !== 'function') return null;
  return nav;
}

/**
 * Kann dieses Geraet eine Datei **dieses Formats** teilen? Geprueft wird mit einer Probedatei
 * gleicher Endung und gleichen MIME-Typs, weil Browser die Freigabe am Dateityp entscheiden:
 * GeoJSON kann abgelehnt werden, waehrend JSON durchgeht. Eine feste Ja/Nein-Antwort fuer
 * „Teilen“ als Ganzes waere deshalb falsch.
 */
function canShareMapFormat(format) {
  const nav = shareCapableNavigator();
  const spec = MAP_EXPORT_FORMATS[format];
  if (!nav || !spec) return false;
  try {
    const probe = new File(['{}'], `mapcreator-ardumower-map${spec.extension}`, { type: spec.mimeType });
    return Boolean(nav.canShare({ files: [probe] }));
  } catch (error) {
    return false;
  }
}

/** Nicht unterstuetzt heisst: Knopf weg statt Knopf mit Fehlermeldung. Der Export bleibt. */
function refreshShareButtons() {
  ui.shareJsonBtn.hidden = !canShareMapFormat('json');
  ui.shareGeoJsonBtn.hidden = !canShareMapFormat('geojson');
  ui.shareCassandraBtn.hidden = !canShareMapFormat('cassandra');
  ui.shareSunrayBtn.hidden = !canShareMapFormat('sunray');
}

/**
 * Der CaSSAndRA-Export wird **ausgegraut**, nicht ausgeblendet: seine Bedingungen sind behebbar,
 * ein verschwundener Knopf verriete nicht einmal, dass es das Format gibt. Das unterscheidet ihn
 * von den Teilen-Knoepfen, deren Bedingung am Geraet haengt und bleibt. Der Hinweis nennt den
 * Grund woertlich, damit nicht geraten werden muss, welche der Bedingungen fehlt.
 */
function refreshExportButtons() {
  const reason = cassandraExportBlockKey(state.activeMap);
  ui.exportCassandraBtn.disabled = Boolean(reason);
  ui.shareCassandraBtn.disabled = Boolean(reason);
  ui.cassandraMissingHint.hidden = !reason;
  ui.cassandraMissingHint.textContent = reason ? tr('cassandraBlocked', { reason: tr(reason) }) : '';
  // Die Auslassung soll schon zu sehen sein, bevor die Datei in CaSSAndRA liegt — dieselbe
  // Aufstellung wie die Meldung nach dem Export, damit beide dasselbe sagen.
  const skipped = skippedAreas(state.activeMap);
  ui.cassandraSkippedHint.hidden = skipped.length === 0;
  ui.cassandraSkippedHint.textContent = skipped.length
    ? tr('cassandraSkippedAhead', { count: skipped.length, names: skipped.join(', ') })
    : '';
}

/**
 * Teilt genau die Datei, die auch der Export erzeugt (`mapExportFile()`), samt Dateinamen.
 * Ein Abbruch durch den Nutzer wirft `AbortError` — das ist keine Stoerung und bleibt still;
 * jeder andere Fehler geht ueber `reportError()` sichtbar an den Nutzer.
 */
async function shareCurrentMap(format) {
  const file = mapExportFile(format);
  if (!file) return false;
  const nav = shareCapableNavigator();
  if (!nav || !canShareMapFormat(format)) {
    showNotice({ title: tr('shareMapTitle'), message: tr('shareUnsupported') });
    return false;
  }
  const shareFile = new File([file.text], file.fileName, { type: file.mimeType });
  try {
    await nav.share({ files: [shareFile] });
    return true;
  } catch (error) {
    if (error && error.name === 'AbortError') return false;
    reportError(error);
    return false;
  }
}

/**
 * Ursprung einer absoluten Karte: Breite -90..90, Länge -180..180. Alles andere ist kein
 * Ursprung — dann bleibt die Karte relativ, statt falsche Grad zu erzeugen.
 */
function normalizeOrigin(origin) {
  const lat = Number(origin?.lat);
  const lon = Number(origin?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * Zwei Eingabefelder als Ursprung — oder `null`, wenn eines davon leer ist.
 *
 * **Ein leeres Feld ist keine Null.** `Number('')` ist 0, und 0 liegt im gueltigen Bereich; ohne
 * diese Vorpruefung macht `normalizeOrigin()` aus zwei leeren Feldern das Wertepaar 0/0. Der
 * Nutzer koennte einen einmal eingetragenen Ursprung dann gar nicht mehr zuruecknehmen, und was
 * er als „leer“ sieht, waere in Wahrheit die Nullinsel im Golf von Guinea.
 *
 * **Eine Stelle fuer beide Felderpaare** — CaSSAndRA-Bezugspunkt und Kartenursprung. Eine zweite
 * Loesung daneben waere genau die Doppelung, die hier schon einmal auseinandergedriftet ist.
 */
function originFromInputs(latInput, lonInput) {
  const lat = String(latInput.value ?? '').trim();
  const lon = String(lonInput.value ?? '').trim();
  if (!lat || !lon) return null;
  return normalizeOrigin({ lat, lon });
}

/** Rechnet eine Karte nur dann in Grad, wenn beides stimmt: Modus **und** gültiger Ursprung. */
function mapOriginInUse(map) {
  return map?.positionMode === 'absolute' ? normalizeOrigin(map.origin) : null;
}

// --- CaSSAndRA-Bezugspunkt -------------------------------------------------
// Der Wert, gegen den CaSSAndRA rechnet (dort `rovercfg.lat`/`rovercfg.lon`, von Hand in den
// Robotereinstellungen eingetragen). Er gehoert zur **Installation**, nicht zur Karte: eine
// relativ gefuehrte Karte ist fuer dieses Format genauso brauchbar wie eine absolute, und die
// Gegenseite fuehrt ohnehin nur einen einzigen Wert. Deshalb ausdruecklich **nicht** `map.origin`.

/**
 * Vorgabe, solange **nichts** gespeichert ist: 0/0. Das ist derselbe Auslieferungswert, den
 * CaSSAndRA selbst fuehrt (cfgdata.py:195-196) — wer dort nie etwas eingetragen hat, findet 0/0
 * vor, und dann stimmen beide Seiten ueberein. Der Rundlauf ist bei `lat0 = 0` exakt wie
 * ueberall sonst (`cos(0) = 1`), nur die Karte liegt geografisch im Golf von Guinea.
 * Als Funktion, damit nie ein gemeinsam benutztes Objekt herumgereicht wird.
 */
function defaultCassandraReference() {
  return { lat: 0, lon: 0 };
}

/**
 * Der Speicher kennt **drei** Zustaende, und die Unterscheidung traegt die ganze Vorrangregel:
 * - Schluessel fehlt        → es wurde noch nie etwas festgelegt  (`stored: false`)
 * - Schluessel enthaelt `null` → der Nutzer hat das Feld ausdruecklich geleert (`stored: true`, Wert null)
 * - Schluessel enthaelt ein Paar → dieser Wert gilt
 * Ohne den mittleren Fall wuerde ein geleertes Feld beim naechsten Zeichnen wieder mit der
 * Vorgabe gefuellt, und die Sperre haette keinen Bestand.
 */
function storedCassandraReference() {
  try {
    const raw = localStorage.getItem(CASSANDRA_REFERENCE_KEY);
    if (raw === null || raw === undefined || raw === '') return { stored: false, value: null };
    return { stored: true, value: normalizeOrigin(JSON.parse(raw)) };
  } catch (_) {
    return { stored: false, value: null };
  }
}

function loadCassandraReference() {
  const saved = storedCassandraReference();
  state.cassandraReference = saved.stored ? saved.value : defaultCassandraReference();
}

function saveCassandraReference() {
  // Auch `null` wird geschrieben: ein geleertes Feld ist eine Entscheidung des Nutzers und soll
  // die naechste Sitzung nicht wieder mit einer Vorbelegung ueberraschen.
  localStorage.setItem(CASSANDRA_REFERENCE_KEY, JSON.stringify(normalizeOrigin(state.cassandraReference)));
}

/** Gesetzt und gueltig? Nur dann darf das CaSSAndRA-Format ueberhaupt entstehen. */
function cassandraReferenceInUse() {
  return normalizeOrigin(state.cassandraReference);
}

/**
 * Taugt diese Punktfolge als Flaeche? Einzige Stelle, an der das entschieden wird — die
 * Kartenpruefung (`checkPerimeterTooFew`, `checkAreaTooFew`) und die Exportsperre fragen
 * dieselbe Funktion, damit nicht zwei Zaehlungen nebeneinander laufen und auseinanderdriften.
 */
function hasUsablePolygon(points) {
  return (points || []).length >= 3;
}

/**
 * Warum das CaSSAndRA-Format gerade nicht angeboten wird — ein Uebersetzungsschluessel oder
 * `null`. Ein einziger Ort fuer beide Wege: Knopfzustand (`refreshExportButtons()`) und
 * Dateierzeugung (`mapExportFile()`).
 *
 * Der zweite Grund ist bewusst **derselbe Befund, den die Kartenpruefung ohnehin meldet**
 * (`validateActiveMap()` → `checkPerimeterTooFew`), samt dessen Wortlaut: `Polygon(coordinates[0])`
 * (mapdata.py:512) wirft bei weniger als drei Koordinaten, und CaSSAndRAs Import bricht dann
 * vollstaendig ab (mapdata.py:569) statt nur den Perimeter auszulassen.
 */
function cassandraExportBlockKey(map) {
  if (!cassandraReferenceInUse()) return 'cassandraMissingHint';
  if (!hasUsablePolygon(map?.perimeter)) return 'checkPerimeterTooFew';
  return null;
}

/**
 * Vorbelegung aus der aktiven Karte, aber nur wenn die wirklich einen brauchbaren Ursprung fuehrt.
 * Sie steht **vor** der 0/0-Vorgabe: ein echter Ursprung ist die bessere Vermutung als die
 * Nullinsel. Erreichbar ist sie nur, solange nichts gespeichert ist (siehe
 * `storedCassandraReference()`) — sobald der Nutzer das Feld einmal angefasst hat, gilt sein Wert.
 */
function suggestedCassandraReference() {
  return mapOriginInUse(state.activeMap);
}

/**
 * Die beiden Felder folgen dem gemerkten Wert, nicht der Karte. **Vorrang, von oben nach unten:**
 * 1. ein gespeichertes Wertepaar — es gewinnt immer;
 * 2. ein ausdruecklich geleertes Feld (im Speicher steht `null`) — es bleibt leer, und der
 *    Export bleibt gesperrt; genau dafuer unterscheidet `storedCassandraReference()` „geleert“
 *    von „nie festgelegt“;
 * 3. nichts gespeichert → der Ursprung der aktiven Karte, falls sie absolut gefuehrt wird und
 *    einen gueltigen hat, sonst die Vorgabe 0/0.
 *
 * Fall 3 wird **nicht** gespeichert. Wuerde er es, waere schon nach dem ersten Zeichnen etwas
 * gespeichert und die Vorbelegung aus dem Kartenursprung damit fuer immer unerreichbar —
 * inklusive des Falls, dass der Nutzer erst spaeter eine absolut gefuehrte Karte anlegt.
 * So folgt die Vorbelegung der aktiven Karte, bis der Nutzer selbst etwas eintraegt.
 */
function renderCassandraReference() {
  const saved = storedCassandraReference();
  if (!saved.stored) {
    state.cassandraReference = suggestedCassandraReference() || defaultCassandraReference();
  }
  const value = cassandraReferenceInUse();
  ui.cassandraLatInput.value = value ? String(value.lat) : '';
  ui.cassandraLonInput.value = value ? String(value.lon) : '';
  refreshExportButtons();
}

async function updateCassandraReferenceFromUi() {
  state.cassandraReference = originFromInputs(ui.cassandraLatInput, ui.cassandraLonInput);
  saveCassandraReference();
  refreshExportButtons();
}

// Dieselbe Näherung wie CaSSAndRA und die grauonline-App: ein Grad Breite entspricht 111111 m,
// ein Grad Länge derselben Strecke mal cos(Breite). Für einen Garten ist das mehr als genau.
const METERS_PER_DEGREE = 111111;
const DEGREE_DECIMALS = 7; // 1e-7 Grad sind rund 1,1 cm

function lonScale(originLat) {
  return METERS_PER_DEGREE * Math.cos((originLat * Math.PI) / 180);
}

/** Lokale Sunray-Meter → absolute Grad, in GeoJSON-Reihenfolge [lon, lat]. */
function localToAbsolute(point, origin) {
  const lat = Number(point.y) / METERS_PER_DEGREE + origin.lat;
  const lon = Number(point.x) / lonScale(origin.lat) + origin.lon;
  return [Number(lon.toFixed(DEGREE_DECIMALS)), Number(lat.toFixed(DEGREE_DECIMALS))];
}

/** Absolute Grad [lon, lat] → lokale Sunray-Meter. */
function absoluteToLocal(lon, lat, origin) {
  return {
    x: Number(((Number(lon) - origin.lon) * lonScale(origin.lat)).toFixed(3)),
    y: Number(((Number(lat) - origin.lat) * METERS_PER_DEGREE).toFixed(3)),
  };
}

function pointCoordinate(point, origin = null) {
  if (origin) return localToAbsolute(point, origin);
  return [Number(point.x), Number(point.y)];
}

function closeRing(points, origin = null) {
  const coords = points.map((p) => pointCoordinate(p, origin));
  if (coords.length >= 3) coords.push([...coords[0]]);
  return coords;
}

function geometryForArea(points, origin = null) {
  if (points.length >= 3) return { type: 'Polygon', coordinates: [closeRing(points, origin)] };
  if (points.length === 2) return { type: 'LineString', coordinates: points.map((p) => pointCoordinate(p, origin)) };
  if (points.length === 1) return { type: 'Point', coordinates: pointCoordinate(points[0], origin) };
  return null;
}

/**
 * Unser interner `role` gegen den Typbezeichner, den CaSSAndRA in `properties.name` schreibt.
 * Die Schreibweisen sind woertlich uebernommen — „search wire“ traegt ein Leerzeichen.
 * `role` bleibt unser internes Merkmal und aendert sich nicht; `name` ist ab jetzt
 * ausschliesslich dieser Typ, der uebersetzte Anzeigename steht in `label`.
 */
const CASSANDRA_TYPE_BY_ROLE = {
  perimeter: 'perimeter',
  exclusion: 'exclusion',
  waypoints: 'search wire',
  dock: 'dockpoints',
};
const ROLE_BY_CASSANDRA_TYPE = Object.fromEntries(
  Object.entries(CASSANDRA_TYPE_BY_ROLE).map(([role, name]) => [name, role]));

/** Der Rollenname eines Features: bevorzugt unser `role`, sonst aus CaSSAndRAs `name`. */
function featureRole(properties) {
  const role = String(properties?.role || '').trim().toLowerCase();
  if (role) return role;
  const name = String(properties?.name || '').trim().toLowerCase();
  return ROLE_BY_CASSANDRA_TYPE[name] || '';
}

function geometryForLine(points, origin = null) {
  if (points.length >= 2) return { type: 'LineString', coordinates: points.map((p) => pointCoordinate(p, origin)) };
  if (points.length === 1) return { type: 'Point', coordinates: pointCoordinate(points[0], origin) };
  return null;
}

function sampleMetadata(points) {
  return points.map((point) => ({
    capturedAt: point.capturedAt || null,
    originalCapturedAt: point.originalCapturedAt || null,
    editedAt: point.editedAt || null,
    previousPosition: point.previousPosition || null,
    gps: point.gps || null,
  }));
}

function mapToGeoJson(map) {
  const features = [];
  // Nur mit Modus „absolut“ **und** gueltigem Ursprung wird umgerechnet; sonst bleibt alles
  // wie bisher bei lokalen Metern.
  const origin = mapOriginInUse(map);
  const system = origin ? 'wgs84-degrees' : 'sunray-local-xy-meters';
  const units = origin ? 'deg' : 'm';
  const perimeterGeometry = geometryForArea(map.perimeter, origin);
  if (perimeterGeometry) {
    features.push({
      type: 'Feature',
      properties: {
        role: 'perimeter',
        name: CASSANDRA_TYPE_BY_ROLE.perimeter,
        label: tr('perimeter'),
        coordinateSystem: system,
        units,
        completePolygon: map.perimeter.length >= 3,
        samples: sampleMetadata(map.perimeter),
      },
      geometry: perimeterGeometry,
    });
  }

  const waypointGeometry = geometryForLine(map.waypoints || [], origin);
  if (waypointGeometry) {
    features.push({
      type: 'Feature',
      properties: { role: 'waypoints', name: CASSANDRA_TYPE_BY_ROLE.waypoints, label: tr('waypoints'), coordinateSystem: system, units, samples: sampleMetadata(map.waypoints) },
      geometry: waypointGeometry,
    });
  }

  map.exclusions.forEach((exclusion, index) => {
    const geometry = geometryForArea(exclusion.points || [], origin);
    if (!geometry) return;
    features.push({
      type: 'Feature',
      properties: {
        role: 'exclusion',
        exclusionIndex: index,
        exclusionId: exclusion.id,
        name: CASSANDRA_TYPE_BY_ROLE.exclusion,
        label: localizedExclusionName(exclusion, index),
        coordinateSystem: system,
        units,
        completePolygon: exclusion.points.length >= 3,
        samples: sampleMetadata(exclusion.points),
      },
      geometry,
    });
  });

  const dockGeometry = geometryForLine(map.dockPoints, origin);
  if (dockGeometry) {
    features.push({
      type: 'Feature',
      properties: {
        role: 'dock',
        name: CASSANDRA_TYPE_BY_ROLE.dock,
        label: tr('dockPath'),
        coordinateSystem: system,
        units,
        samples: sampleMetadata(map.dockPoints),
      },
      geometry: dockGeometry,
    });
  }

  return {
    type: 'FeatureCollection',
    name: localizedMapName(map),
    properties: {
      format: 'ardumower-web-map-geojson',
      generator: 'MapCreator für Ardumower',
      version: 2,
      mapId: map.id,
      coordinateSystem: system,
      units,
      // Der Ursprung reist mit: nur damit kann ein Import die Grad wieder in Meter zurueckrechnen,
      // auch auf einem anderen Geraet.
      origin: origin ? { lat: origin.lat, lon: origin.lon } : null,
      note: origin
        ? 'Coordinates are WGS84 [longitude, latitude] degrees, derived from local Sunray X/Y metres via properties.origin.'
        : 'Coordinates are local Sunray X/Y values in meters, not WGS84 longitude/latitude.',
      createdAt: map.createdAt,
      updatedAt: map.updatedAt,
    },
    features,
  };
}

/**
 * Name des fuenften Features, das ausschliesslich unsere Metadaten traegt. CaSSAndRAs Import
 * vergleicht `properties.name` in einer if/elif-Kette **ohne else** (mapdata.py:511-521): ein
 * unbekannter Name faellt heraus, das Feature wird nie angefasst. Empirisch gegengeprueft — mit
 * und ohne dieses Feature kommen dieselben 24 Zeilen heraus. Zwingend ist nur, dass es
 * `properties.name` ueberhaupt traegt: fehlt `properties` oder `name`, bricht der Import mit
 * KeyError ab, weil der Vergleich vor jeder Fallunterscheidung steht.
 */
const CASSANDRA_METADATA_NAME = 'mapmaker';

/** Offene Punktfolge in absoluten Grad — Dockpfad und Suchdraht schliessen nicht (mapdata.py:619-621). */
function cassandraLine(points, origin) {
  return (points || []).map((point) => localToAbsolute(point, origin));
}

/**
 * Datei im Format, das CaSSAndRA selbst schreibt (`export_geojson`, mapdata.py:665-690):
 * genau zwei Schluessel auf oberster Ebene (:670 — ein Objekt mehr dort laesst `pd.read_json`
 * scheitern und den Import abbrechen, bevor der GeoJSON-Zweig ueberhaupt beginnt), danach die
 * Features in fester Reihenfolge perimeter (:674), dockpoints (:678), search wire (:682) und je
 * eine exclusion (:686-689) mit `idx` auf **Feature**-Ebene, nicht in `properties`. Dockpfad und
 * Suchdraht werden auch leer geschrieben, weil das Vorbild sie unbedingt anlegt.
 *
 * Die Umrechnung ist die exakte Umkehrung von `coords_abs_to_rel` (mapdata.py:704-710), die
 * CaSSAndRA beim Import faehrt — bewusst dieselbe grobe Naeherung, weil nur so beide Richtungen
 * sich aufheben; eine geodaetisch richtigere Formel wuerde beim Rueckweg driften.
 */
function mapToCassandraGeoJson(map, reference) {
  const origin = normalizeOrigin(reference);
  if (!map || !origin) return null;
  const features = [
    {
      type: 'Feature',
      properties: { name: 'perimeter' },
      geometry: { type: 'Polygon', coordinates: [closeRing(map.perimeter || [], origin)] },
    },
    {
      type: 'Feature',
      properties: { name: 'dockpoints' },
      geometry: { type: 'LineString', coordinates: cassandraLine(map.dockPoints, origin) },
    },
    {
      type: 'Feature',
      properties: { name: 'search wire' },
      geometry: { type: 'LineString', coordinates: cassandraLine(map.waypoints, origin) },
    },
  ];
  // Flaechen unter drei Punkten bleiben draussen: `Polygon(coordinates[0])` (mapdata.py:515)
  // wirft dann, und ein einziger solcher Rest reisst den ganzen Import mit.
  (map.exclusions || [])
    .filter((exclusion) => hasUsablePolygon(exclusion.points))
    .forEach((exclusion, index) => {
      features.push({
        type: 'Feature',
        properties: { name: 'exclusion' },
        idx: index,
        geometry: { type: 'Polygon', coordinates: [closeRing(exclusion.points, origin)] },
      });
    });
  // Unsere Metadaten. `origin` traegt genau den Bezugspunkt, gegen den die Grad oben gerechnet
  // wurden — damit bleibt die Datei nachtraeglich pruefbar und fuer uns wieder einlesbar.
  features.push({
    type: 'Feature',
    properties: {
      name: CASSANDRA_METADATA_NAME,
      format: 'ardumower-web-map-cassandra',
      generator: 'MapCreator für Ardumower',
      version: 2,
      mapId: map.id,
      label: localizedMapName(map),
      coordinateSystem: 'wgs84-degrees',
      units: 'deg',
      origin: { lat: origin.lat, lon: origin.lon },
      createdAt: map.createdAt,
      updatedAt: map.updatedAt,
      exportedAt: new Date().toISOString(),
    },
    geometry: null,
  });
  return { type: 'FeatureCollection', features };
}

/**
 * Flaechen, die dieses Format auslaesst, mit Anzeigename und Punktzahl. Gemeldet wird **jede**
 * ausgelassene Flaeche, auch eine leere: stillschweigend weglassen waere hier das Schlimmere,
 * und ob der Nutzer den Verlust fuer belanglos haelt, ist seine Entscheidung, nicht unsere.
 */
/**
 * Ausschlussflaechen, die als Polygon nicht taugen — mit Name und Punktzahl, fertig zum Anzeigen.
 * **Formatunabhaengig**, seit auch der Sunray-Export sie auslaesst: die Frage „taugt als Flaeche?“
 * beantwortet weiterhin allein `hasUsablePolygon()`, es gibt keine zweite Zaehlung daneben.
 */
function skippedAreas(map) {
  return (map?.exclusions || [])
    .map((exclusion, index) => ({ exclusion, index }))
    .filter(({ exclusion }) => !hasUsablePolygon(exclusion.points))
    .map(({ exclusion, index }) => tr('cassandraSkippedItem', {
      label: localizedExclusionName(exclusion, index),
      count: (exclusion.points || []).length,
    }));
}

/**
 * Einmal je Exportversuch, **eine** Meldung: sie nennt zuerst den tatsaechlich verwendeten
 * Bezugspunkt im Klartext und haengt an, was nicht mit hinausgeht.
 *
 * Warum der Bezugspunkt unbedingt genannt wird: seit die Vorgabe 0/0 ist, kann eine Datei ohne
 * jedes Zutun des Nutzers entstehen — und 0/0 ist nur dann richtig, wenn auch in CaSSAndRA 0/0
 * steht. Weicht es ab, liegt die Karte dort versetzt, **ohne** dass irgendeine Seite einen
 * Fehler zeigt. Der Klartext ist der Ausgleich fuer die weggefallene Huerde.
 *
 * Die ausgelassene Flaeche ist kein Fehler der Karte, sondern eine Grenze des Zielformats — der
 * Export laeuft danach weiter. Aufgerufen von beiden Wegen (Speichern und Teilen), damit keiner
 * still bleibt, und ohne zusaetzliche Nutzergeste.
 */
function noticeCassandraExport(map) {
  const reference = cassandraReferenceInUse();
  if (!reference) return;
  const parts = [tr('cassandraReferenceUsed', { lat: String(reference.lat), lon: String(reference.lon) })];
  const skipped = skippedAreas(map);
  if (skipped.length) {
    parts.push(tr('cassandraSkippedMessage', { count: skipped.length, names: skipped.join(', ') }));
  }
  showNotice({ title: tr('cassandraExportTitle'), message: parts.join(' ') });
}

/**
 * Meldung nach dem Sunray-Export. **Ohne Bezugspunkt**, weil das Format keinen braucht — genannt
 * wird stattdessen, in welchen Einheiten die Datei steht, und was ausgelassen wurde. Dieselbe
 * Aufstellung wie beim CaSSAndRA-Export (`skippedAreas()`), damit beide Wege dasselbe sagen.
 */
function noticeSunrayExport(map) {
  const parts = [tr('sunrayExportDone')];
  const skipped = skippedAreas(map);
  if (skipped.length) {
    parts.push(tr('cassandraSkippedMessage', { count: skipped.length, names: skipped.join(', ') }));
  }
  showNotice({ title: tr('sunrayExportTitle'), message: parts.join(' ') });
}

function exportCurrentMapSunray() {
  // Erst handeln, dann melden — wie beim CaSSAndRA-Export.
  if (exportMapFile('sunray')) noticeSunrayExport(state.activeMap);
}

function exportCurrentMapCassandra() {
  // Erst handeln, dann melden. Andersherum liefe die Meldung dem Teilen in die Quere: ein Dialog
  // dazwischen verbraucht die Nutzergeste, und `navigator.share()` verlangt eine frische.
  if (exportMapFile('cassandra')) noticeCassandraExport(state.activeMap);
}

function exportCurrentMapGeoJson() { exportMapFile('geojson'); }

function validateImportedMap(data) {
  if (!data || data.format !== 'ardumower-web-map' || !Array.isArray(data.perimeter) || !Array.isArray(data.exclusions) || !Array.isArray(data.dockPoints)) {
    throw new Error(tr('invalidMapFile'));
  }
  const clone = normalizeMap(structuredClone(data));
  clone.id = newId();
  clone.name = `${clone.name || tr('importName')} ${tr('importSuffix')}`;
  clone.createdAt = new Date().toISOString();
  clone.updatedAt = clone.createdAt;
  return clone;
}

/**
 * Die vier Feature-Namen, die CaSSAndRAs eigener Export schreibt (mapdata.py:674-689). Bewusst
 * eine geschlossene Liste: sie ist zugleich das Merkmal, an dem eine fremde Datei erkannt wird.
 */
const CASSANDRA_FEATURE_NAMES = new Set(['perimeter', 'dockpoints', 'search wire', 'exclusion']);

/**
 * Stammt diese Datei aus CaSSAndRAs eigenem `export_geojson` (mapdata.py:665-690)?
 *
 * **Strukturelle Erkennung, ausdruecklich keine Heuristik ueber die Zahlen.** Eine Regel wie
 * „Betrag kleiner als 1, also Grad“ waere geraten und nachweislich falsch: steht in CaSSAndRA
 * ein echter Bezugspunkt, liegen die Werte bei ~52 und ~13 und saehen wie Meter aus. Die Form
 * der Datei dagegen ist eindeutig, weil `export_geojson` sie fest verdrahtet baut.
 *
 * Alle Merkmale muessen zutreffen; eines genuegt zum Ausschluss:
 *  1. genau zwei Schluessel oben, `type` und `features` (mapdata.py:670) — unser eigenes GeoJSON
 *     fuehrt dort zusaetzlich `name` und `properties`;
 *  2. jedes Feature traegt `properties` mit **ausschliesslich** `name`. Damit ist zugleich
 *     ausgeschlossen, dass irgendwo `properties.role` steht — unser internes Merkmal;
 *  3. jeder Name stammt aus `CASSANDRA_FEATURE_NAMES`. Damit ist zugleich ausgeschlossen, dass
 *     das Metadaten-Feature `mapmaker` dabei ist, mit dem unser eigener CaSSAndRA-Export sich zu
 *     erkennen gibt — der darf hier auf keinen Fall als Fremdformat durchgehen, sonst wuerde
 *     seine eigene Ursprungsangabe uebergangen.
 *
 * Eine leere Feature-Liste gilt nicht als erkannt: ohne ein einziges Feature traegt die Datei
 * kein Merkmal, und ohne Merkmal wird nicht umgerechnet.
 */
function isCassandraGeoJson(data) {
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) return false;
  const keys = Object.keys(data);
  if (keys.length !== 2 || !keys.includes('type') || !keys.includes('features')) return false;
  if (!data.features.length) return false;
  return data.features.every((feature) => {
    const props = feature?.properties;
    if (!props || typeof props !== 'object' || Array.isArray(props)) return false;
    const propKeys = Object.keys(props);
    return propKeys.length === 1 && propKeys[0] === 'name' && CASSANDRA_FEATURE_NAMES.has(props.name);
  });
}

/**
 * Ist der Ring dieser Polygon-Geometrie geschlossen, traegt die Datei also den Schlusspunkt?
 *
 * **Einzige Stelle, an der das entschieden wird.** `pointsFromGeoGeometry()` schneidet den
 * doppelten Punkt daraufhin ab, `geoJsonToMap()` setzt daraufhin das Kennzeichen der Kontur —
 * zwei Leser, eine Quelle. Vorher hing beides an derselben Bedingung in zwei Auspraegungen,
 * und die zweite fehlte schlicht: der Schlusspunkt fiel weg, `perimeterClosed` blieb `false`.
 */
function geoRingClosed(geometry) {
  if (geometry?.type !== 'Polygon') return false;
  const coords = geometry.coordinates?.[0] || [];
  if (coords.length < 2) return false;
  const first = coords[0];
  const last = coords[coords.length - 1];
  return Array.isArray(first) && Array.isArray(last) && first[0] === last[0] && first[1] === last[1];
}

/**
 * Stammt diese Datei aus der grauonline-Sunray-App?
 *
 * **Strukturelle Erkennung, kein Blick auf die Zahlenwerte** — dieselbe Ueberlegung wie bei
 * `isCassandraGeoJson()`. Gefragt wird nach der Form, die `mapToSunrayApp()` schreibt und die die
 * Vorlage fuehrt:
 *  1. die aeussere Huelle ist eine **nicht leere Liste** (die Vorlage traegt zehn Karten, und
 *     `import_sunray()` laeuft mit `for map_number in range(len(df))`, mapdata.py:471);
 *  2. **jeder** Eintrag ist ein Objekt mit einem Array `perimeter`;
 *  3. mindestens ein Perimeter traegt Punkte, und **jeder** Punkt darin fuehrt die Zahlenfelder
 *     `X` und `Y` (gross geschrieben — unser eigenes Modell schreibt `x`/`y` klein).
 *
 * Punkt 3 verlangt bewusst mindestens einen gefuellten Perimeter: eine Liste aus Karten mit
 * ausschliesslich leeren Konturen traegt kein Merkmal, das sie von irgendeiner anderen Liste
 * unterscheidet — dann wird nicht geraten.
 *
 * Unser eigenes JSON-Backup und beide GeoJSON-Formate sind Objekte, keine Listen, und fallen
 * schon an Punkt 1 heraus.
 */
function isSunrayAppFile(data) {
  if (!Array.isArray(data) || !data.length) return false;
  const istPunkt = (p) => Boolean(p) && typeof p === 'object' && !Array.isArray(p)
    && Number.isFinite(Number(p.X)) && Number.isFinite(Number(p.Y));
  const karten = data.filter((k) => Boolean(k) && typeof k === 'object' && !Array.isArray(k)
    && Array.isArray(k.perimeter));
  if (karten.length !== data.length) return false;
  const gefuellt = karten.filter((k) => k.perimeter.length);
  if (!gefuellt.length) return false;
  return gefuellt.every((k) => k.perimeter.every(istPunkt));
}

/**
 * Ein Punkt aus der Sunray-App in unser Modell. Die Zuordnung ist eins zu eins, weil beide
 * Seiten dieselbe Quelle haben: `timestamp` ist unsere Aufnahmezeit, `sol` die RTK-Loesung aus
 * `AT+S` (comm.cpp:694) und `delta` die Roboterausrichtung (comm.cpp:692).
 *
 * `gps` bleibt **weg**, wenn weder `sol` noch `delta` dastehen — ein leeres Objekt liesse
 * `pointQuality()` denselben Schluss ziehen wie eine gemessene schlechte Guete.
 */
function sunrayAppPointToModel(point) {
  const out = { x: Number(point.X), y: Number(point.Y) };
  const capturedAt = typeof point.timestamp === 'string' ? point.timestamp : null;
  if (capturedAt) out.capturedAt = capturedAt;
  const gps = {};
  if (Number.isFinite(Number(point.sol))) gps.solution = Number(point.sol);
  if (Number.isFinite(Number(point.delta))) gps.delta = Number(point.delta);
  if (Object.keys(gps).length) out.gps = gps;
  return out;
}

/**
 * Beschriftung einer Karte in der Auswahlliste. Die **Position steht immer vorn**, nicht nur bei
 * namenlosen Karten: die Vorlage fuehrt neun verschiedene Namen bei zehn Karten, zwei Eintraege
 * waeren sonst nicht auseinanderzuhalten.
 */
function sunrayAppMapLabel(karte, index) {
  const name = String(karte?.name || '').trim();
  const punkte = (karte?.perimeter || []).length;
  const flaechen = (karte?.exclusions || []).filter((e) => Array.isArray(e) && e.length).length;
  const umfang = tr('sunrayMapSummary', { points: punkte, areas: flaechen });
  return name
    ? tr('sunrayMapLabelNamed', { n: index + 1, name, summary: umfang })
    : tr('sunrayMapLabelPlain', { n: index + 1, summary: umfang });
}

/**
 * Eine Karte der Sunray-App in unser Kartenmodell.
 *
 * **Konturen gelten als geschlossen.** Das ist ausdruecklich **nicht** dieselbe Frage, die
 * `geoRingClosed()` fuer GeoJSON beantwortet: dort wird geprueft, ob die Datei einen
 * Schlusspunkt **traegt**. Die Sunray-Vorlage schreibt **nie** einen (in allen zehn Karten
 * geprueft) — sie sind trotzdem geschlossene Polygone, der Schlusspunkt gehoert dort schlicht
 * nicht zur Schreibweise. `geoRingClosed()` lieferte hier also durchgehend `false` und waere die
 * falsche Auskunft, keine gemeinsame Quelle.
 *
 * **`waypoints` werden verworfen**, nicht uebernommen: in der Vorlage stehen dort 1238 bis 2870
 * Punkte — ein generierter Maehpfad, nicht die handvoll gesetzter Wegpunkte, die unser Modell
 * meint. Wie viele Punkte dabei wegfallen, meldet der Aufrufer im Klartext.
 *
 * **Verworfen werden ausserdem die Maehfelder** `patternAngle`, `mowOfs`, `patternRings`,
 * `doMowExclusions`, `doMowPerimeter`, `doMowArea`, `doPerimeterBorder` und `doExclusionsBorder`.
 * Diese App steuert kein Maehen und hat fuer sie keine Entsprechung; sie stillschweigend zu
 * schlucken waere falsch, deshalb nennt die Importmeldung sie.
 */
function sunrayAppToMap(karte) {
  const map = makeMap(String(karte?.name || '').trim() || tr('sunrayImportName'));
  map.name = `${map.name} ${tr('importSuffix')}`;
  map.perimeter = (karte?.perimeter || []).map(sunrayAppPointToModel);
  map.perimeterClosed = map.perimeter.length > 0;
  map.exclusions = (karte?.exclusions || [])
    .filter((flaeche) => Array.isArray(flaeche) && flaeche.length)
    .map((flaeche, index) => ({
      id: newId(),
      name: tr('exclusionN', { n: index + 1 }),
      points: flaeche.map(sunrayAppPointToModel),
      closed: true,
    }));
  map.dockPoints = (karte?.dockpoints || []).map(sunrayAppPointToModel);
  // waypoints bleiben bewusst draussen, siehe oben.
  map.waypoints = [];
  return map;
}

/** Punkte, die beim Einlesen wegfallen, weil unser Modell dafuer keine Entsprechung hat. */
function sunrayDiscardedWaypoints(karte) {
  return (karte?.waypoints || []).length;
}

function pointsFromGeoGeometry(geometry, samples = [], origin = null) {
  if (!geometry) return [];
  let coords = [];
  if (geometry.type === 'Point') coords = [geometry.coordinates];
  else if (geometry.type === 'LineString') coords = geometry.coordinates;
  else if (geometry.type === 'Polygon') coords = geometry.coordinates?.[0] || [];
  else throw new Error(tr('unsupportedGeometry', { type: geometry.type || tr('unknown') }));

  // Den Schlusspunkt traegt das Modell nicht — es merkt sich nur, dass die Kontur geschlossen
  // ist. Dieselbe Pruefung liest `geoJsonToMap()`, um genau das zu setzen.
  if (geoRingClosed(geometry)) coords = coords.slice(0, -1);

  return coords.map((coord, index) => {
    if (!Array.isArray(coord) || coord.length < 2 || !Number.isFinite(Number(coord[0])) || !Number.isFinite(Number(coord[1]))) {
      throw new Error(tr('invalidCoordinates'));
    }
    const meta = samples[index] || {};
    const local = origin ? absoluteToLocal(coord[0], coord[1], origin) : { x: Number(coord[0]), y: Number(coord[1]) };
    return {
      x: local.x,
      y: local.y,
      capturedAt: meta.capturedAt || null,
      originalCapturedAt: meta.originalCapturedAt || null,
      editedAt: meta.editedAt || null,
      previousPosition: meta.previousPosition || null,
      gps: meta.gps || null,
    };
  });
}

/**
 * Anzeigename einer importierten Ausschlussflaeche. `label` ist der neue Platz dafuer; aeltere
 * Dateien aus dieser App trugen ihn noch in `name`. Ein `name`, das nur den CaSSAndRA-Typ
 * enthaelt, ist kein Anzeigename — sonst hiesse jede Flaeche „exclusion“.
 */
function importedExclusionName(properties, number) {
  const label = String(properties?.label || '').trim();
  if (label) return label;
  const name = String(properties?.name || '').trim();
  if (name && !ROLE_BY_CASSANDRA_TYPE[name.toLowerCase()]) return name;
  return tr('exclusionN', { n: number });
}

function geoJsonToMap(data) {
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error(tr('invalidGeoJson'));
  }
  // Unser CaSSAndRA-Format darf auf oberster Ebene nur `type` und `features` fuehren, sonst
  // scheitert dort `pd.read_json` (mapdata.py:463). Name und Ursprung stehen deshalb im Feature
  // `mapmaker`, und von dort holen wir sie beim Wiedereinlesen zurueck.
  const metaFeature = data.features.find((f) => f?.properties?.name === CASSANDRA_METADATA_NAME);
  const meta = data.properties || metaFeature?.properties || {};
  // `meta.name` ist bei unserem Metadaten-Feature der Typbezeichner `mapmaker` und taugt
  // deshalb nicht als Kartenname — dafuer gibt es dort `label`.
  const map = makeMap(data.name || data.properties?.name || metaFeature?.properties?.label || tr('geoJsonImport'));
  map.name = `${map.name} ${tr('importSuffix')}`;
  // Grad koennen nur mit dem Ursprung zurueckgerechnet werden, mit dem sie entstanden sind —
  // ohne ihn waeren die Werte nicht zu deuten, und stillschweigend als Meter zu lesen waere
  // schlimmer als eine klare Fehlermeldung.
  const declared = String(meta.coordinateSystem || '').toLowerCase();
  let origin = null;
  if (isCassandraGeoJson(data)) {
    // CaSSAndRAs Format sagt nirgends, dass es Grad fuehrt — `export_geojson` schreibt nur `type`
    // und `features` (mapdata.py:670). Erkannt wird es deshalb an der Form, und die Grad sind
    // dann eine Eigenschaft des Formats, keine Vermutung ueber die Zahlen.
    //
    // Der Bezugspunkt steht **nicht** in der Datei: er lebt allein in CaSSAndRAs `rovercfg.lat`
    // und `lon`. Ohne ihn sind die Grad nicht zurueckzurechnen, deshalb wird hier lieber gar
    // nicht importiert als eine Karte an einem erfundenen Ort erzeugt. Bewusst **kein** Rueckfall
    // auf 0/0: die Vorgabe gehoert in die Einstellung (`loadCassandraReference()`), nicht in den
    // Importweg — sonst haette ein ausdruecklich geleertes Feld hier keine Wirkung mehr.
    origin = cassandraReferenceInUse();
    if (!origin) throw new Error(tr('cassandraImportNoReference'));
    map.positionMode = 'absolute';
    map.origin = origin;
  } else if (declared === 'wgs84-degrees') {
    origin = normalizeOrigin(meta.origin);
    if (!origin) throw new Error(tr('missingOrigin'));
    map.positionMode = 'absolute';
    map.origin = origin;
  }
  for (const feature of data.features) {
    const role = featureRole(feature?.properties);
    const points = pointsFromGeoGeometry(feature.geometry, feature?.properties?.samples || [], origin);
    if (role === 'perimeter') {
      map.perimeter = points;
      // Den Ringschluss traegt die Datei, und genau hier ging er bisher verloren: der doppelte
      // Punkt wurde abgeschnitten, das Kennzeichen aber nie gesetzt — jede importierte Karte galt
      // als offen. Gilt fuer jeden GeoJSON-Import, nicht nur fuer CaSSAndRA-Dateien.
      map.perimeterClosed = geoRingClosed(feature.geometry);
    } else if (role === 'exclusion') {
      map.exclusions.push({
        id: newId(),
        name: importedExclusionName(feature?.properties, map.exclusions.length + 1),
        points,
        closed: geoRingClosed(feature.geometry),
      });
    } else if (role === 'dock' || role === 'dockpoints' || role === 'dockpath') {
      map.dockPoints = points;
    } else if (role === 'waypoints' || role === 'waypoint') {
      map.waypoints = points;
    }
  }
  if (!map.perimeter.length && !map.exclusions.length && !map.dockPoints.length && !map.waypoints.length) {
    throw new Error(tr('noGeoFeatures'));
  }
  return map;
}

/**
 * Meldung nach einem Import im Klartext — dieselbe Ueberlegung wie bei `noticeCassandraExport()`:
 * die Umrechnung haengt an einem Wert, den nur der Nutzer mit CaSSAndRA abgleichen kann, also
 * wird er genannt statt vorausgesetzt. Nur das Anzeigemittel ist ein anderes (Hinweiszeile statt
 * Dialog), weil der Import auf der Menueseite laeuft und ein Modal dort im Weg staende.
 */
function noticeCassandraImport(origin) {
  if (!ui.importNotice) return;
  ui.importNotice.textContent = tr('cassandraImportNotice', { lat: String(origin.lat), lon: String(origin.lon) });
  ui.importNotice.hidden = false;
}

/** Vor jedem Import zuruecksetzen, damit kein Hinweis von der vorigen Datei stehen bleibt. */
function clearImportNotice() {
  if (!ui.importNotice) return;
  ui.importNotice.textContent = '';
  ui.importNotice.hidden = true;
}

/**
 * Meldung nach dem Einlesen einer Sunray-Datei: was uebernommen wurde und was **nicht**.
 * Verworfenes stillschweigend zu schlucken waere hier das Schlimmere — der Maehpfad kann
 * tausende Punkte umfassen, und die Maeheinstellungen der Datei gehen ebenfalls verloren.
 * Muster und Anzeigemittel wie `noticeCassandraImport()`: Hinweiszeile, kein Dialog.
 */
function noticeSunrayImport(verworfeneWegpunkte) {
  if (!ui.importNotice) return;
  const parts = [tr('sunrayImportDone')];
  if (verworfeneWegpunkte > 0) parts.push(tr('sunrayImportDropped', { count: verworfeneWegpunkte }));
  parts.push(tr('sunrayImportIgnoredFields'));
  ui.importNotice.textContent = parts.join(' ');
  ui.importNotice.hidden = false;
}

/**
 * Welche Karte der Datei soll es sein? Bei **genau einer** wird nicht gefragt — ein Dialog mit
 * einer einzigen Wahlmoeglichkeit waere reine Schikane, und die Importmeldung sagt hinterher
 * ohnehin, was hereinkam. Bei mehreren waehlt der Nutzer; ein Abbruch liefert `null` und der
 * Import unterbleibt vollstaendig. Still die erste zu nehmen ist ausgeschlossen.
 */
async function chooseSunrayMap(data) {
  if (data.length === 1) return 0;
  const answer = await askChoice({
    title: tr('sunrayChooseTitle'),
    message: tr('sunrayChooseMessage', { count: data.length }),
    options: data.map((karte, index) => ({ value: String(index), label: sunrayAppMapLabel(karte, index) })),
    confirmLabel: tr('sunrayChooseConfirm'),
  });
  if (answer === null) return null;
  const index = Number(answer);
  return Number.isInteger(index) && index >= 0 && index < data.length ? index : null;
}

async function importMapFile(file) {
  stopAutoCapture();
  clearImportNotice();
  if (state.maps.length >= MAX_MAPS) throw new Error(tr('mapLimitReached'));
  const text = await file.text();
  const data = JSON.parse(text);
  // Vor der Umwandlung gefragt, aber erst nach getaner Arbeit gemeldet: andersherum staende die
  // Meldung auch dann da, wenn der Import gleich darauf scheitert.
  const cassandra = data?.type === 'FeatureCollection' && isCassandraGeoJson(data);
  const sunray = isSunrayAppFile(data);
  let verworfeneWegpunkte = 0;
  let map;
  if (sunray) {
    const index = await chooseSunrayMap(data);
    // Abbruch in der Auswahl: kein Import, keine Meldung, kein halber Zustand.
    if (index === null) return;
    verworfeneWegpunkte = sunrayDiscardedWaypoints(data[index]);
    map = sunrayAppToMap(data[index]);
  } else {
    map = data?.type === 'FeatureCollection' ? geoJsonToMap(data) : validateImportedMap(data);
  }
  // Eine importierte Datei bringt keine Undo-Historie mit: die Karte bekommt hier eine neue
  // Kennung, an der eine mitgelieferte Historie ohnehin vorbeiliefe.
  map = normalizeMap(mapWithoutUndo(map));
  await dbRequest('readwrite', (store) => store.put(map));
  state.maps.push(map);
  state.maps.sort((a, b) => a.name.localeCompare(b.name, state.language === 'en' ? 'en' : 'de'));
  state.activeMap = map;
  state.activeExclusionId = map.exclusions[0]?.id || null;
  state.selectedPoint = null;
  renderMapControls();
  await saveActiveMap();
  renderMap();
  // Erst handeln, dann melden.
  if (cassandra) noticeCassandraImport(map.origin);
  else if (sunray) noticeSunrayImport(verworfeneWegpunkte);
}

function segmentsIntersect(a, b, c, d) {
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const on = (p, q, r) => Math.min(p.x, r.x) - 1e-9 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-9 && Math.min(p.y, r.y) - 1e-9 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-9;
  const o1 = orient(a,b,c), o2 = orient(a,b,d), o3 = orient(c,d,a), o4 = orient(c,d,b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  if (Math.abs(o1) < 1e-9 && on(a,c,b)) return true;
  if (Math.abs(o2) < 1e-9 && on(a,d,b)) return true;
  if (Math.abs(o3) < 1e-9 && on(c,a,d)) return true;
  if (Math.abs(o4) < 1e-9 && on(c,b,d)) return true;
  return false;
}

function polygonSelfIntersects(points) {
  if (points.length < 4) return false;
  for (let i = 0; i < points.length; i += 1) {
    const a1 = points[i], a2 = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.abs(i-j) <= 1 || (i === 0 && j === points.length - 1)) continue;
      const b1 = points[j], b2 = points[(j + 1) % points.length];
      if (segmentsIntersect(a1,a2,b1,b2)) return true;
    }
  }
  return false;
}

function pointInPolygon(point, polygon) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const hit = ((a.y > point.y) !== (b.y > point.y)) && point.x < (b.x-a.x) * (point.y-a.y) / ((b.y-a.y) || 1e-12) + a.x;
    if (hit) inside = !inside;
  }
  return inside;
}

function polygonEdgesIntersect(a, b) {
  if (a.length < 2 || b.length < 2) return false;
  for (let i=0;i<a.length;i+=1) for (let j=0;j<b.length;j+=1) if (segmentsIntersect(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length])) return true;
  return false;
}

function polygonsIntersect(a, b) {
  if (polygonEdgesIntersect(a, b)) return true;
  return a.length >= 3 && b.length >= 3 && (pointInPolygon(a[0],b) || pointInPolygon(b[0],a));
}

function polygonArea(points) {
  if (points.length < 3) return 0;
  let sum = 0; for (let i=0;i<points.length;i+=1) { const a=points[i], b=points[(i+1)%points.length]; sum += a.x*b.y-b.x*a.y; }
  return Math.abs(sum)/2;
}

function pathLength(points, closed = false) {
  let sum=0; for(let i=1;i<points.length;i+=1) sum+=xyDistance(points[i-1],points[i]);
  if (closed && points.length>=3) sum+=xyDistance(points[points.length-1],points[0]);
  return sum;
}

function pointQualityStats(map) {
  const points=[...map.perimeter,...map.dockPoints,...map.exclusions.flatMap((e)=>e.points)];
  return { total: points.length, fix: points.filter((p)=>p.gps?.solution===2).length };
}

function pathSpacingIssues(points, closed) {
  let close=0,long=0; const count=closed && points.length>=3 ? points.length : Math.max(0,points.length-1);
  for(let i=0;i<count;i+=1){ const d=xyDistance(points[i],points[(i+1)%points.length]); if(d<0.05)close+=1; if(d>5)long+=1; }
  return { close, long };
}

function validateActiveMap() {
  if (!state.activeMap) return;
  const map=state.activeMap; const issues=[];
  if (!hasUsablePolygon(map.perimeter)) issues.push({severity:'error',key:'checkPerimeterTooFew',vars:{}});
  else if (polygonSelfIntersects(map.perimeter)) issues.push({severity:'error',key:'checkSelfIntersection',vars:{label:tr('perimeter')}});
  if (map.perimeter.length >= 3 && !map.perimeterClosed) issues.push({severity:'warning',key:'checkPerimeterOpen',vars:{}});
  const perimeterSpacing=pathSpacingIssues(map.perimeter,true);
  if(perimeterSpacing.close)issues.push({severity:'warning',key:'checkClosePoints',vars:{label:tr('perimeter'),count:perimeterSpacing.close}});
  if(perimeterSpacing.long)issues.push({severity:'warning',key:'checkLongSegments',vars:{label:tr('perimeter'),count:perimeterSpacing.long}});
  map.exclusions.forEach((ex,index)=>{
    const label=localizedExclusionName(ex,index);
    if(ex.points.length>0 && !hasUsablePolygon(ex.points))issues.push({severity:'error',key:'checkAreaTooFew',vars:{label}});
    if(ex.points.length>=4 && polygonSelfIntersects(ex.points))issues.push({severity:'error',key:'checkSelfIntersection',vars:{label}});
    if(ex.points.length>=3 && map.perimeter.length>=3 && (ex.points.some((p)=>!pointInPolygon(p,map.perimeter)) || polygonEdgesIntersect(ex.points,map.perimeter)))issues.push({severity:'error',key:'checkExclusionOutside',vars:{label}});
    if(ex.points.length>=3 && ex.closed===false)issues.push({severity:'warning',key:'checkAreaOpen',vars:{label}});
    const spacing=pathSpacingIssues(ex.points,true); if(spacing.close)issues.push({severity:'warning',key:'checkClosePoints',vars:{label,count:spacing.close}}); if(spacing.long)issues.push({severity:'warning',key:'checkLongSegments',vars:{label,count:spacing.long}});
  });
  for(let i=0;i<map.exclusions.length;i+=1)for(let j=i+1;j<map.exclusions.length;j+=1){ const a=map.exclusions[i],b=map.exclusions[j]; if(a.points.length>=3&&b.points.length>=3&&polygonsIntersect(a.points,b.points))issues.push({severity:'error',key:'checkExclusionOverlap',vars:{a:localizedExclusionName(a,i),b:localizedExclusionName(b,j)}}); }
  const dockSpacing=pathSpacingIssues(map.dockPoints,false); if(dockSpacing.close)issues.push({severity:'warning',key:'checkClosePoints',vars:{label:tr('dockPath'),count:dockSpacing.close}}); if(dockSpacing.long)issues.push({severity:'warning',key:'checkLongSegments',vars:{label:tr('dockPath'),count:dockSpacing.long}});
  if(!map.dockPoints.length)issues.push({severity:'info',key:'checkDockEmpty',vars:{}});
  const quality=pointQualityStats(map); const nonFix=quality.total-quality.fix; if(nonFix)issues.push({severity:'warning',key:'checkNonFixPoints',vars:{count:nonFix,points:quality.total}});
  const netArea=Math.max(0, polygonArea(map.perimeter)-map.exclusions.reduce((sum,ex)=>sum+polygonArea(ex.points||[]),0));
  state.validationResult={issues,area:netArea,perimeter:pathLength(map.perimeter,true),quality};
  renderValidation();
  if(ui.validationDrawer)ui.validationDrawer.open=true;
}

function renderValidation() {
  if (!ui.validationSummary || !ui.validationList) return;
  const result=state.validationResult;
  ui.validationList.innerHTML='';
  if(!result){ui.validationSummary.textContent=tr('notCheckedYet');return;}
  const errors=result.issues.filter((i)=>i.severity==='error').length; const warnings=result.issues.filter((i)=>i.severity==='warning').length;
  ui.validationSummary.textContent=errors||warnings ? tr('mapCheckIssues',{errors,warnings,area:result.area.toFixed(1)}) : tr('mapCheckOk',{area:result.area.toFixed(1),perimeter:result.perimeter.toFixed(1),fix:result.quality.fix,points:result.quality.total});
  result.issues.forEach((issue)=>{const row=document.createElement('div');row.className=`validation-item ${issue.severity}`;row.textContent=tr(issue.key,issue.vars);ui.validationList.appendChild(row);});
  if (ui.closeContoursBtn) ui.closeContoursBtn.hidden = openContours().length === 0;
}

function refreshSaveState() {
  if (state.saving) {
    ui.saveState.textContent = tr('saving');
  } else if (state.lastSavedAt) {
    ui.saveState.textContent = tr('savedAt', { time: state.lastSavedAt.toLocaleTimeString(localeCode(), { hour: '2-digit', minute: '2-digit' }) });
  }
}

function applyLanguage() {
  document.documentElement.lang = state.language;
  document.title = tr('appTitle');
  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription) metaDescription.setAttribute('content', tr('appDescription'));

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = tr(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.setAttribute('placeholder', tr(element.dataset.i18nPlaceholder));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', tr(element.dataset.i18nAriaLabel));
  });

  ui.languageToggle.dataset.language = state.language;
  ui.languageToggle.setAttribute('aria-label', tr('languageToggleLabel'));
  ui.languageToggle.setAttribute('title', tr('languageToggleLabel'));
  ui.demoBtn.textContent = state.demo ? tr('demoStop') : tr('demoStart');
  ui.modeChipLabel.textContent = modeLabel(state.mode);

  refreshConnectionUi();
  browserCheck();
  updateHelpSystemStatus();
  refreshTelemetry();
  renderMapControls();
  renderMap();
  renderValidation();
  refreshSaveState();
  refreshWakeLockStatus();
  refreshControlUi();
}

function toggleLanguage() {
  state.language = state.language === 'de' ? 'en' : 'de';
  applyLanguage();
}

const CAPTURE_MODES = ['perimeter', 'exclusion', 'waypoint', 'dock'];

function modeLabel(mode) {
  if (mode === 'exclusion') return tr('exclusion');
  if (mode === 'waypoint') return tr('waypoints');
  if (mode === 'dock') return tr('dock');
  return tr('perimeter');
}

function setMode(mode, { preserveSelection = false } = {}) {
  if (!CAPTURE_MODES.includes(mode)) return;
  if (state.autoCaptureRunning) stopAutoCapture();
  // Ein Wechsel auf eine andere Elementart beendet die Erweiterung. Die aufgetrennte Kontur
  // bleibt dabei bewusst offen: dafuer gibt es bereits die Rueckfrage beim Moduswechsel und die
  // Kartenpruefung, die offene Konturen meldet und zu schliessen anbietet.
  if (state.extension && state.extension.role !== mode) state.extension = null;
  state.mode = mode;
  if (!preserveSelection) { state.selectedPoint = null; state.selectedArea = null; }
  ui.modeChipLabel.textContent = modeLabel(mode);
  ui.modeCycleBtn.dataset.mode = mode;
  renderMap();
  refreshCaptureState();
}

function openModeDialog() {
  if (!ui.modeDialog) return;
  ui.modeDialog.hidden = false;
  document.querySelectorAll('#modeDialog [data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === state.mode);
  });
}

function closeModeDialog() {
  if (ui.modeDialog) ui.modeDialog.hidden = true;
}

/**
 * Moduswahl aus dem Dialog. Hat die verlassene Kontur mindestens drei Punkte und ist noch
 * offen, wird einmal nachgefragt, ob sie geschlossen werden soll. Bei 0-2 Punkten oder bei
 * offenen Pfaden (Wegpunkte, Dock) wechselt die App ohne Rueckfrage.
 */
async function requestModeChange(mode) {
  closeModeDialog();
  if (!CAPTURE_MODES.includes(mode) || mode === state.mode) return;
  await offerToCloseContour(state.mode);
  setMode(mode);
  // Erst nach setMode(): beim Verlassen ist der Modus dann nicht mehr `exclusion`, die eben
  // verlassene leere Kontur also nicht mehr geschuetzt und wird sofort mit aufgeraeumt.
  if (pruneEmptyExclusions()) {
    renderElementList();
    renderMap();
    await saveActiveMap();
  }
}

function openContours() {
  const map = state.activeMap;
  if (!map) return [];
  const open = [];
  if (map.perimeter.length >= 3 && !map.perimeterClosed) open.push({ role: 'perimeter', label: tr('perimeter') });
  map.exclusions.forEach((ex, index) => {
    if (ex.points.length >= 3 && ex.closed === false) open.push({ role: 'exclusion', id: ex.id, label: localizedExclusionName(ex, index) });
  });
  return open;
}

/**
 * Die Kontur, die der aktuelle Aufnahmemodus bearbeitet — aber nur dort, wo es ueberhaupt
 * geschlossene Konturen gibt. Wegpunkte und Dockpfad sind offene Pfade und liefern null.
 */
function activeContour() {
  if (!state.activeMap) return null;
  if (state.mode === 'perimeter') {
    return { role: 'perimeter', id: null, points: state.activeMap.perimeter, closed: Boolean(state.activeMap.perimeterClosed) };
  }
  if (state.mode === 'exclusion') {
    const exclusion = currentExclusion();
    return exclusion ? { role: 'exclusion', id: exclusion.id, points: exclusion.points, closed: exclusion.closed !== false } : null;
  }
  return null;
}

/** Die Punktfolge, die gerade erweitert wird — dieselbe Array-Referenz wie in der Karte. */
function extensionPoints(ext = state.extension) {
  if (!ext || !state.activeMap) return null;
  if (ext.role === 'perimeter') return state.activeMap.perimeter;
  return state.activeMap.exclusions.find((e) => e.id === ext.exclusionId)?.points || null;
}

/**
 * Der Listenplatz, an dem die Erweiterung weiterbaut. **Die einzige Stelle, die diese Frage
 * beantwortet** — Markierung, Hinweiszeile und Vorschaulinie lesen alle hier, damit sie nie auf
 * verschiedene Punkte zeigen koennen.
 *
 * In der Auswahlphase ist es der **zuerst getippte** Punkt: `reorderForExtension()` macht genau
 * ihn zum Listenende. Danach ist es das Listenende selbst, denn `appendCurrentPoint()` haengt
 * ausnahmslos dort an — es wandert also mit jedem aufgenommenen Punkt weiter.
 */
function extensionEndIndex(ext = state.extension) {
  if (!ext) return -1;
  if (ext.phase === 'picking') return ext.firstIndex ?? -1;
  const points = extensionPoints(ext);
  return points && points.length ? points.length - 1 : -1;
}

function extensionIsClosed(ext = state.extension) {
  if (!ext || !state.activeMap) return false;
  if (ext.role === 'perimeter') return Boolean(state.activeMap.perimeterClosed);
  const exclusion = state.activeMap.exclusions.find((e) => e.id === ext.exclusionId);
  return Boolean(exclusion && exclusion.closed !== false);
}

/** Erweitern lohnt nur bei einer geschlossenen Kontur — eine offene laesst sich ohnehin fortsetzen. */
function canStartExtension() {
  if (!state.activeMap || state.activeMap.locked || state.autoCaptureRunning) return false;
  const contour = activeContour();
  return Boolean(contour && contour.closed && contour.points.length >= 3);
}

/**
 * **Die einzige Stelle, die entscheidet, welche Seite des Rings wegfaellt.** Zwei Punkte teilen
 * eine geschlossene Kontur in zwei Seiten; geoeffnet wird an der einen, die dabei verschwindet.
 *
 * Gemessen wird die **Weglaenge** dieser Seite, nicht ihre Punktzahl: wer die Luecke danach neu
 * abfaehrt, laeuft Meter, keine Punkte. Eine dicht gesetzte, kurze Strecke ist also die
 * guenstigere Wahl gegenueber einer langen mit wenigen Ecken — nach der Punktzahl waere es
 * umgekehrt.
 *
 * Zwei Eigenschaften folgen daraus zwingend, beide erwuenscht:
 * - **Benachbarte Punkte verhalten sich wie bisher.** Die direkte Kante ist nach der
 *   Dreiecksungleichung nie laenger als der Weg ueber alle uebrigen Punkte, die leere Seite
 *   gewinnt also immer — es faellt kein Punkt weg, genau wie vor v65.
 * - **Es bleiben immer mindestens drei Punkte stehen.** Die ganze Gegenseite zu loeschen hiesse,
 *   dass die andere Seite leer ist — das ist der Nachbarfall, und der geht nie so aus.
 */
function extensionCut(points, firstIndex, secondIndex) {
  const n = points.length;
  const span = (step) => {
    let length = 0;
    let removed = 0;
    for (let i = firstIndex; i !== secondIndex;) {
      const next = ((i + step) % n + n) % n;
      length += Math.hypot(points[next].x - points[i].x, points[next].y - points[i].y);
      if (next !== secondIndex) removed += 1;
      i = next;
    }
    return { length, removed };
  };
  const forward = span(1);
  const backward = span(-1);
  const useForward = forward.length <= backward.length;
  return { forward: useForward, removed: useForward ? forward.removed : backward.removed };
}

/**
 * Ordnet die Punktfolge so um, dass die Kontur zwischen den beiden gewaehlten Punkten aufgeht:
 * die Liste beginnt beim **zweiten** gewaehlten Punkt, laeuft ueber die **bleibende** Seite im
 * Ring herum und endet beim **ersten**. Damit ist der erste gewaehlte Punkt das neue Ende, an das
 * angehaengt wird — neue Punkte landen also genau zwischen den beiden gewaehlten.
 *
 * Die Punkte der wegfallenden Seite stehen in der Ausgabe nicht mehr; welche das sind, sagt
 * allein `extensionCut()`.
 */
function reorderForExtension(points, firstIndex, secondIndex) {
  const n = points.length;
  const cut = extensionCut(points, firstIndex, secondIndex);
  const step = cut.forward ? 1 : -1;
  const out = [];
  for (let k = 0; k < n - cut.removed; k += 1) {
    out.push(points[((secondIndex + k * step) % n + n) % n]);
  }
  return out;
}

/** Startet die Auswahl der beiden benachbarten Punkte; an der Kontur aendert sich dabei nichts. */
function startExtension() {
  if (!canStartExtension()) return;
  const contour = activeContour();
  state.extension = { role: contour.role, exclusionId: contour.id, phase: 'picking', firstIndex: null, secondIndex: null };
  clearPointSelection({ render: false });
  setExtensionHint('extendPickFirst');
  renderMap();
  refreshCaptureState();
}

/** Abbruch waehrend der Auswahl — es wurde noch nichts veraendert. */
function cancelExtension() {
  if (!state.extension) return;
  state.extension = null;
  renderMap();
  refreshCaptureState();
  ui.pointStatus.textContent = tr('extendCancelled');
}

/**
 * Oeffnet die Kontur zwischen den beiden gewaehlten Punkten: **ein** Undo-Schritt, auch wenn
 * dabei viele Punkte wegfallen — es ist eine Handlung des Nutzers, kein Stapel einzelner
 * Loeschungen.
 */
async function openContourForExtension(firstIndex, secondIndex) {
  const ext = state.extension;
  const points = extensionPoints(ext);
  if (!ext || !points) return;
  pushUndo();
  points.splice(0, points.length, ...reorderForExtension(points, firstIndex, secondIndex));
  if (ext.role === 'perimeter') state.activeMap.perimeterClosed = false;
  else {
    const exclusion = state.activeMap.exclusions.find((e) => e.id === ext.exclusionId);
    if (exclusion) exclusion.closed = false;
  }
  ext.phase = 'adding';
  ext.firstIndex = null;
  ext.secondIndex = null;
  state.validationResult = null;
  setExtensionHint('extendOpened');
  await saveActiveMap();
  renderMap();
  refreshCaptureState();
}

/**
 * **Die Schritte des Erweitern-Ablaufs in einer Liste** — daraus kommt die Nummer *und* die
 * Gesamtzahl im Hinweis. Eine eingetippte „von 3“ im Text liefe beim naechsten Umbau
 * auseinander, ohne dass es jemandem auffiele; hier kann sie das nicht.
 */
const EXTEND_STEPS = ['pickFirst', 'pickSecond', 'adding'];

/**
 * In welchem Schritt steckt der Ablauf gerade? Abgelesen am Zustand, nicht am Hinweistext.
 *
 * **Die Bestaetigung ist seit v69 kein eigener Schritt mehr.** Der zweite Tipp auf denselben
 * Punkt fuehrt weiterhin erst aus, was der erste angekuendigt hat (sonst koennte ein Fehlgriff
 * auf einer dichten Kontur eine ganze Strecke kosten) — aber er beantwortet dieselbe Frage wie
 * Schritt 2 („welcher Punkt ist das andere Ende?"), es ist nur die Antwort darauf bestaetigt.
 * Ein vorgemerkter zweiter Punkt bleibt deshalb in Schritt 2.
 */
function extensionStepKey(ext = state.extension) {
  if (!ext) return null;
  if (ext.phase === 'adding') return 'adding';
  return ext.firstIndex === null ? 'pickFirst' : 'pickSecond';
}

/** 1-basierte Schrittnummer, 0 wenn gerade nicht erweitert wird. */
function extensionStep(ext = state.extension) {
  const key = extensionStepKey(ext);
  return key ? EXTEND_STEPS.indexOf(key) + 1 : 0;
}

/**
 * Der Hinweisschluessel zur **Ankuendigung** einer Loeschung, an einer Stelle. Die Einzahl hat
 * einen eigenen Schluessel: „1 Punkte“ stand sichtbar falsch da.
 *
 * Nach dem Auftrennen gibt es seit v69 keine Zahl mehr zu melden — Schritt 3 hat einen festen
 * Wortlaut, und die Zahl steht dort, wo sie gebraucht wird: **vor** der Entscheidung.
 */
function extendCutHintKey(removed) {
  if (removed === 0) return 'extendConfirmEdge';
  return removed === 1 ? 'extendConfirmCutOne' : 'extendConfirmCut';
}

/**
 * Ein Tipp waehrend der Auswahlphase. Trifft er keinen Punkt der Kontur, passiert nichts.
 *
 * Der **zweite** Punkt ist seit v65 beliebig waehlbar, nicht mehr nur ein Nachbar. Weil dabei
 * ganze Streckenstuecke verschwinden koennen, oeffnet der zweite Tipp die Kontur nicht sofort:
 * er zeigt erst an, **wie viele Punkte** wegfallen; ein zweiter Tipp auf denselben Punkt fuehrt
 * ihn aus. Bewusst kein Dialog — waehrend der Auswahl muss die Karte antippbar bleiben, und der
 * Hinweisstreifen ist genau dafuer da. Ein Tipp auf einen **anderen** Punkt verschiebt die
 * Vorschau nur, aendert also weiterhin nichts an der Kontur.
 */
async function handleExtensionTap(item) {
  const ext = state.extension;
  const points = extensionPoints(ext);
  if (!ext || !points) return;
  const sameContour = item && item.role === ext.role
    && (ext.role !== 'exclusion' || item.exclusionId === ext.exclusionId);
  if (!sameContour) { setExtensionHint('extendWrongContour'); return; }
  if (ext.firstIndex === null) {
    ext.firstIndex = item.index;
    ext.secondIndex = null;
    setExtensionHint('extendPickSecond');
    renderMap();
    return;
  }
  if (item.index === ext.firstIndex) {
    ext.firstIndex = null;
    ext.secondIndex = null;
    setExtensionHint('extendPickFirst');
    renderMap();
    return;
  }
  if (ext.secondIndex !== item.index) {
    ext.secondIndex = item.index;
    const cut = extensionCut(points, ext.firstIndex, item.index);
    setExtensionHint(extendCutHintKey(cut.removed), { b: item.index + 1, count: cut.removed });
    renderMap();
    return;
  }
  await openContourForExtension(ext.firstIndex, item.index);
}

/** „Fertig“: die Kontur wird ueber dieselbe Logik wie sonst wieder geschlossen. */
async function finishExtension() {
  const ext = state.extension;
  if (!ext || ext.phase !== 'adding') return;
  const points = extensionPoints(ext);
  state.extension = null;
  if (points && points.length >= 3) await closeContour({ role: ext.role, id: ext.exclusionId });
  renderMap();
  refreshCaptureState();
  ui.pointStatus.textContent = tr('extendFinished');
}

/**
 * Haelt den Erweiterungszustand mit der Karte im Einklang. Ein Undo kann die aufgetrennte Kante
 * wieder geschlossen haben — dann gibt es nichts mehr anzuhaengen und der Zustand faellt weg.
 * Wird die Karte gesperrt oder verschwindet die Flaeche, ebenso.
 */
function refreshExtensionState() {
  const ext = state.extension;
  if (!ext) return;
  const points = extensionPoints(ext);
  if (!points || state.activeMap?.locked || (ext.phase === 'adding' && extensionIsClosed(ext))) {
    state.extension = null;
  }
}

/** Merkt sich die aktuelle Anweisung, damit der Hinweisbereich sie jederzeit neu zeichnen kann. */
function setExtensionHint(key, vars = {}) {
  if (!state.extension) return;
  state.extension.hintKey = key;
  state.extension.hintVars = vars;
  refreshExtendPanel();
}

/**
 * Der Hinweisbereich fuehrt durch die Erweiterung. Er sitzt als eigene Zeile **zwischen**
 * Werkzeugleiste und Zeichenflaeche, nicht als Overlay darueber: die Anweisung hat damit die
 * volle Breite (in der schmalen Werkzeugleiste wurde sie abgeschnitten) und verdeckt trotzdem
 * nichts — waehrend der Auswahl muss die Karte antippbar bleiben, ein blockierendes Modal
 * verboete sich also.
 */
function refreshExtendPanel() {
  const ext = state.extension;
  ui.extendPanel.hidden = !ext;
  if (!ext) return;
  const picking = ext.phase === 'picking';
  const body = tr(ext.hintKey || (picking ? 'extendPickFirst' : 'extendOpened'), ext.hintVars || {});
  // Die Schrittnummer steht **vor** jedem Hinweis, auch vor dem Fehlgriff-Hinweis: der tritt
  // innerhalb eines Schrittes auf und wirft den Ablauf nicht zurueck.
  const step = extensionStep(ext);
  ui.extendPanelText.textContent = step
    ? `${tr('extendStep', { step, total: EXTEND_STEPS.length })} ${body}`
    : body;
  ui.extendPanel.classList.toggle('is-error', ext.hintKey === 'extendWrongContour');
  // Abbrechen gibt es nur, solange nichts veraendert wurde; danach fuehrt „Fertig“ heraus.
  ui.extendCancelBtn.hidden = !picking;
  ui.extendDoneBtn.hidden = picking;
}

/** Der Knopf in der Leiste startet die Erweiterung; gefuehrt wird sie danach im Hinweisbereich. */
function refreshExtendButton() {
  refreshExtensionState();
  refreshExtendPanel();
  const can = canStartExtension() && !state.extension;
  ui.extendWrap.hidden = !can;
  if (!can) return;
  const key = state.mode === 'perimeter' ? 'extendPerimeter' : 'extendExclusion';
  ui.extendBtnLabel.textContent = tr(`${key}Short`);
  ui.extendBtn.setAttribute('aria-label', tr(key));
}

async function closeContour(entry) {
  if (entry.role === 'perimeter') { await closePerimeter(); return; }
  const exclusion = state.activeMap?.exclusions.find((e) => e.id === entry.id);
  if (!exclusion) return;
  pushUndo();
  exclusion.closed = true;
  state.validationResult = null;
  await saveActiveMap();
  renderMap();
}

/** Die gerade bearbeitete Ausschlussflaeche, falls es eine gibt. */
function currentExclusion() {
  if (!state.activeMap) return null;
  return state.activeMap.exclusions.find((e) => e.id === state.activeExclusionId) || null;
}

/**
 * Schnellzugriff fuer Reihen kleiner Flaechen (Baeume): nur sichtbar, wenn im
 * Ausschluss-Modus die laufende Kontur mindestens drei Punkte hat.
 */
function canCloseAndStartNew() {
  if (!state.activeMap || state.activeMap.locked) return false;
  if (state.mode !== 'exclusion') return false;
  // Beim Bearbeiten einer Auswahl reichen Papierkorb und Verschieben — der Schnellzugriff
  // wuerde dort nur im Weg stehen.
  if (state.selectedPoint || state.selectedArea) return false;
  const exclusion = currentExclusion();
  // Eine bereits geschlossene Kontur hat nichts mehr zu schliessen.
  return Boolean(exclusion && exclusion.closed === false && exclusion.points.length >= 3);
}

/**
 * Schliesst die laufende Ausschlusskontur und beginnt sofort eine neue — ohne Rueckfrage,
 * weil der Knopf ausschliesslich dafuer da ist. Nutzt dieselbe Schliess-Logik wie der
 * Moduswechsel (closeContour), damit es nur eine Stelle gibt.
 */
async function closeAndStartNewExclusion() {
  if (!canCloseAndStartNew()) return;
  const exclusion = currentExclusion();
  const index = state.activeMap.exclusions.indexOf(exclusion);
  await asOneUndoStep(async () => {
    await closeContour({ role: 'exclusion', id: exclusion.id, label: localizedExclusionName(exclusion, index) });
    await createExclusion();
  });
  refreshCaptureState();
  ui.pointStatus.textContent = tr('closedAndStartedNew');
}

async function offerToCloseContour(role) {
  if (!state.activeMap || state.activeMap.locked) return;
  const entry = openContours().find((c) => c.role === role
    && (role !== 'exclusion' || c.id === state.activeExclusionId));
  if (!entry) return;
  const confirmed = await askConfirm({
    title: tr('closeContourTitle'),
    message: tr('closeContourQuestion', { label: entry.label }),
    confirmLabel: tr('closeContourYes'),
    cancelLabel: tr('closeContourNo'),
  });
  if (!confirmed) return;
  await closeContour(entry);
}

/** Aus der Kartenpruefung: alle offenen Konturen auf einmal schliessen. */
async function closeAllOpenContours() {
  const open = openContours();
  if (!open.length || !ensureMapEditable()) return;
  const confirmed = await askConfirm({
    title: tr('closeOpenContours'),
    message: tr('closeContoursConfirm', { count: open.length }),
    confirmLabel: tr('closeContoursYes'),
    cancelLabel: tr('closeContourNo'),
  });
  if (!confirmed) return;
  await asOneUndoStep(async () => { for (const entry of open) await closeContour(entry); });
  validateActiveMap();
}

function selectablePoints() {
  if (!state.activeMap) return [];
  const items = state.activeMap.perimeter.map((point, index) => ({ point, role: 'perimeter', index, exclusionId: null }));
  state.activeMap.exclusions.forEach((exclusion) => exclusion.points.forEach((point, index) => items.push({ point, role: 'exclusion', index, exclusionId: exclusion.id })));
  state.activeMap.waypoints.forEach((point, index) => items.push({ point, role: 'waypoint', index, exclusionId: null }));
  state.activeMap.dockPoints.forEach((point, index) => items.push({ point, role: 'dock', index, exclusionId: null }));
  return items;
}

function applyPointSelection(ref) {
  if (ref.role === 'exclusion' && ref.exclusionId) { state.activeExclusionId = ref.exclusionId; renderElementList(); }
  setMode(ref.role, { preserveSelection: true });
  state.selectedArea = null;
  state.selectedPoint = ref;
  refreshCaptureState(); renderMap();
}

/** Tap auf die Karte: naechstliegenden Punkt im Touch-Radius auswaehlen, sonst Auswahl aufheben. */
function handleMapTap(event) {
  const tap = pointerToViewBox(event);
  const transform = state.currentTransform || activeTransform();
  let nearest = null; let nearestDistance = Infinity;
  for (const item of selectablePoints()) {
    const local = toScreen(item.point, transform);
    const distance = Math.hypot(tap.x - local.x, tap.y - local.y);
    if (distance < nearestDistance) { nearestDistance = distance; nearest = item; }
  }
  const picking = state.extension?.phase === 'picking';
  if (nearest && nearestDistance <= state.hitRadiusUnits) {
    if (picking) { handleExtensionTap(nearest).catch(reportError); return; }
    applyPointSelection({ role: nearest.role, index: nearest.index, exclusionId: nearest.exclusionId });
    return;
  }
  // Waehrend der **Auswahlphase** faengt kein Tipp die Flaeche ab: es geht ausschliesslich um die
  // beiden Punkte der Kante — dieselbe Ueberlegung wie beim ausgeblendeten Papierkorb waehrend
  // der Automatik. In Phase `adding` gilt das nicht mehr: dort waehlt ein Punkttipp wieder aus,
  // und der Tipp ins Leere ist die **einzige** Geste, die eine Auswahl wieder aufhebt. Stand die
  // Sperre auch dort, liess sich der Zustand „Punkt ausgewaehlt“ nicht mehr verlassen, obwohl der
  // Hinweisstreifen zum Aufnehmen aufforderte und der Hauptknopf auf „Verschieben“ stand.
  if (picking) {
    return;
  }
  // Tap in die Flaeche einer fertigen Ausschlusskontur waehlt die ganze Flaeche aus.
  // Bewusst nur fuer Ausschlussflaechen: beim Perimeter wuerde das jeden Tap in die Karte greifen.
  const mapPoint = toMapCoords(tap, transform);
  const area = (state.activeMap?.exclusions || []).find((ex) => ex.points.length >= 3 && pointInPolygon(mapPoint, ex.points));
  if (area) {
    state.selectedPoint = null;
    state.selectedArea = area.id;
    state.activeExclusionId = area.id;
    setMode('exclusion', { preserveSelection: true });
    renderElementList();
    ui.pointStatus.textContent = tr('areaSelected', { name: localizedExclusionName(area, state.activeMap.exclusions.indexOf(area)) })
      + contourStateSuffix('exclusion', area.id);
    renderMap(); refreshCaptureState();
    return;
  }
  if (state.selectedPoint || state.selectedArea) clearPointSelection();
}

function selectPointElement(element) {
  if (!element) return;
  const role = element.getAttribute('data-point-role'); const index = Number(element.getAttribute('data-point-index')); const exclusionId = element.getAttribute('data-exclusion-id') || null;
  if (!['perimeter','exclusion','waypoint','dock'].includes(role) || !Number.isInteger(index) || index < 0) return;
  applyPointSelection({ role, index, exclusionId });
}

function drawSelectionGuide(transform) {
  if (!state.selectedPoint || !telemetryIsFresh()) return;
  const point = getSelectedPoint();
  if (!point) return;
  const selected = toScreen(point, transform); const mower = toScreen(state.telemetry, transform);
  ui.robotLayer.appendChild(svgEl('line', { x1: selected.x, y1: selected.y, x2: mower.x, y2: mower.y, class: 'edit-distance-line' }));
}

/**
 * Vorschau waehrend der Erweiterung: die Strecke, die ein jetzt aufgenommener Punkt schliessen
 * wuerde — vom aktiven Ende zur Maeherposition. Ebene, Aufbau und Bedingungen wie bei
 * `drawSelectionGuide()`, nur mit anderem Anker.
 *
 * **Nicht, solange ein Punkt ausgewaehlt ist:** dann macht der Hauptknopf `Verschieben`
 * (`addCurrentPoint()`), es wuerde also gar nichts angehaengt, und die Linie behauptete etwas
 * Falsches. Das loest zugleich die Ueberschneidung mit `drawSelectionGuide()` — beide enden an
 * der Maeherposition, sichtbar ist deshalb immer nur eine von beiden.
 */
function drawExtensionGuide(transform) {
  const ext = state.extension;
  if (!ext || ext.phase !== 'adding' || state.selectedPoint || !telemetryIsFresh()) return;
  const points = extensionPoints(ext);
  const end = points?.[extensionEndIndex(ext)];
  if (!end) return;
  const from = toScreen(end, transform); const mower = toScreen(state.telemetry, transform);
  ui.robotLayer.appendChild(svgEl('line', { x1: from.x, y1: from.y, x2: mower.x, y2: mower.y, class: 'extend-guide-line' }));
}

function setHelpStatus(element, text, stateClass) {
  if (!element) return;
  element.textContent = text;
  element.classList.remove('ok', 'warn', 'bad');
  if (stateClass) element.classList.add(stateClass);
}

function updateHelpSystemStatus() {
  setHelpStatus(ui.helpSecureStatus, window.isSecureContext ? tr('statusSecure') : tr('statusInsecure'), window.isSecureContext ? 'ok' : 'bad');
  const bleAvailable = Boolean(bleAdapter());
  setHelpStatus(ui.helpBluetoothStatus, bleAvailable ? tr('statusAvailable') : tr('statusUnavailable'), bleAvailable ? 'ok' : 'bad');
  const swSupported = 'serviceWorker' in navigator && window.isSecureContext;
  const offlineText = state.offlineCacheReady ? tr('statusReady') : (swSupported ? tr('statusPreparing') : tr('statusUnavailable'));
  setHelpStatus(ui.helpOfflineStatus, offlineText, state.offlineCacheReady ? 'ok' : (swSupported ? 'warn' : 'bad'));
  setHelpStatus(ui.helpNetworkStatus, navigator.onLine ? tr('statusOnline') : tr('statusOffline'), navigator.onLine ? 'ok' : 'warn');
}

/**
 * Update-Anzeige. Der Service Worker ruft kein skipWaiting() mehr von sich aus; eine neue
 * Fassung bleibt im Wartestand, bis der Nutzer die Leiste auf der Hauptseite antippt. So laedt
 * die Seite nie ungefragt mitten in der Aufnahme neu, und die Leiste steht dort, wo der Nutzer
 * ohnehin hinschaut — in die Diagnose sieht kaum jemand.
 */
function showUpdateBar(registration) {
  state.pendingUpdate = registration;
  ui.updateBar.hidden = false;
  log('UPDATE', tr('updateAvailable'));
}

function watchForUpdates(registration) {
  if (!registration) return;
  if (registration.waiting && globalThis.navigator?.serviceWorker?.controller) showUpdateBar(registration);
  registration.addEventListener?.('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      // Ohne Controller ist es die Erstinstallation — dann gibt es nichts zu melden.
      if (installing.state === 'installed' && globalThis.navigator?.serviceWorker?.controller) showUpdateBar(registration);
    });
  });
}

/** Tippen auf die Leiste: wartende Fassung uebernehmen lassen, controllerchange laedt neu. */
function applyUpdate() {
  const registration = state.pendingUpdate;
  ui.updateBar.hidden = true;
  if (registration?.waiting) { registration.waiting.postMessage({ type: 'skipWaiting' }); return; }
  globalThis.location?.reload?.();
}

function browserCheck() {
  state.browserWarningKey = null;
  if (!window.isSecureContext) state.browserWarningKey = 'insecureContext';
  else if (!bleAdapter()) state.browserWarningKey = 'browserNoBluetooth';

  if (state.browserWarningKey) {
    ui.browserWarning.textContent = tr(state.browserWarningKey);
    ui.browserWarning.classList.remove('hidden');
    ui.connectBtn.disabled = true;
  } else {
    ui.browserWarning.classList.add('hidden');
    ui.browserWarning.textContent = '';
  }
}

function bindEvents() {
  // Kopfzeile
  ui.menuBtn.addEventListener('click', () => setMenuOpen(true));
  bindAccordion(ui.menuScroll);
  bindAccordion(ui.settingsSections);
  document.querySelectorAll('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)));
  ui.menuCloseBtn.addEventListener('click', () => setMenuOpen(false));
  ui.bleStatusBtn.addEventListener('click', () => setMenuOpen(true, { section: 'menuConnection' }));
  ui.modeCycleBtn.addEventListener('click', openModeDialog);
  ui.closeAndNewBtn.addEventListener('click', () => closeAndStartNewExclusion().catch(reportError));
  ui.undoBtn.addEventListener('click', () => undoLastAction().catch(reportError));
  ui.extendBtn.addEventListener('click', () => startExtension());
  ui.extendCancelBtn.addEventListener('click', () => cancelExtension());
  ui.extendDoneBtn.addEventListener('click', () => finishExtension().catch(reportError));
  ui.insertBeforeBtn.addEventListener('click', () => insertPointAtSelection(0).catch(reportError));
  ui.insertAfterBtn.addEventListener('click', () => insertPointAtSelection(1).catch(reportError));
  ui.modeDialogCancel.addEventListener('click', closeModeDialog);
  ui.confirmDialogAccept.addEventListener('click', () => confirmDialogRespond(true));
  ui.confirmDialogCancel.addEventListener('click', () => confirmDialogRespond(false));
  ui.confirmDialog.addEventListener('click', (event) => { if (event.target === ui.confirmDialog) confirmDialogRespond(false); });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!ui.confirmDialog.hidden) { confirmDialogRespond(false); return; }
    if (!ui.modeDialog.hidden) closeModeDialog();
  });
  ui.modeDialog.addEventListener('click', (event) => { if (event.target === ui.modeDialog) closeModeDialog(); });
  document.querySelectorAll('#modeDialog [data-mode]').forEach((button) => button.addEventListener('click', () => {
    requestModeChange(button.dataset.mode).catch(reportError);
  }));
  ui.closeContoursBtn.addEventListener('click', () => closeAllOpenContours().catch(reportError));
  ui.languageToggle.addEventListener('click', toggleLanguage);
  window.addEventListener('online', updateHelpSystemStatus);
  window.addEventListener('offline', updateHelpSystemStatus);

  // Karte: Tap, Verschieben, Pinch-Zoom
  ui.mapSvg.addEventListener('pointerdown', onMapPointerDown);
  ui.mapSvg.addEventListener('pointermove', onMapPointerMove);
  ['pointerup', 'pointercancel'].forEach((name) => ui.mapSvg.addEventListener(name, onMapPointerUp));
  ui.mapSvg.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const point = event.target.closest?.('[data-map-point="1"]');
    if (!point) return;
    event.preventDefault();
    selectPointElement(point);
  });
  ui.mapSvg.addEventListener('wheel', (event) => {
    event.preventDefault();
    beginCustomViewport();
    const focus = pointerToViewBox(event);
    const base = { x: (focus.x - state.viewport.dx) / state.viewport.zoom, y: (focus.y - state.viewport.dy) / state.viewport.zoom };
    state.viewport.zoom = clampNumber(state.viewport.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_USER_ZOOM, MAX_USER_ZOOM, 1);
    state.viewport.dx = focus.x - base.x * state.viewport.zoom;
    state.viewport.dy = focus.y - base.y * state.viewport.zoom;
    clampViewport();
    renderMap();
  }, { passive: false });
  ui.fitViewBtn.addEventListener('click', () => resetViewport());

  // Kartenwerkzeuge
  ui.deletePointBtn.addEventListener('click', () => deleteAction().catch(reportError));
  ui.autoCaptureBtn.addEventListener('click', () => toggleAutoCapture().catch(reportError));
  ui.movePointBtn.addEventListener('click', () => movePointToMower().catch(reportError));
  ui.addPointBtn.addEventListener('pointerdown', beginCaptureHold);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((name) => ui.addPointBtn.addEventListener(name, cancelCaptureHold));
  ui.addPointBtn.addEventListener('click', captureButtonTap);

  // Fahren
  ui.driveModeBtn.addEventListener('click', toggleDriveControl);
  ui.driveButtons.addEventListener('pointerdown', (event) => {
    const key = event.target.closest?.('[data-direction]');
    if (key) beginCursorDrive(key.dataset.direction, event);
  });
  // Zonenwechsel beim Schieben. Bewusst **kein** eigener Startweg: updateCursorDriveFromPointer()
  // steigt ohne gedrueckte Richtungstaste sofort wieder aus.
  ui.driveButtons.addEventListener('pointermove', (event) => updateCursorDriveFromPointer(event));
  ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave'].forEach((name) => ui.driveButtons
    .addEventListener(name, (event) => {
      if (state.cursorPointerId === null || event.pointerId === state.cursorPointerId) stopDrive();
    }));
  ui.driveJoystick.addEventListener('pointerdown', beginJoystick);
  ui.driveJoystick.addEventListener('pointermove', (event) => updateJoystickFromPointer(event));
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => ui.driveJoystick.addEventListener(name, (event) => {
    if (state.joystickPointerId === null || event.pointerId === state.joystickPointerId) stopDrive();
  }));
  [ui.driveSpeedMinInput, ui.driveSpeedMaxInput, ui.driveTurnMaxInput, ui.joystickSizeSelect, ui.handedSelect,
    ui.driveControlSelect, ui.cursorSpeedInput, ui.driveZonesToggle]
    .forEach((input) => input.addEventListener('change', () => {
    updateViewPreferencesFromUi();
    applyViewPreferencesToUi();
  }));

  // Verbindung
  ui.connectBtn.addEventListener('click', () => connectBluetooth().catch((error) => {
    setConnectionStatus(false, 'notConnected', 'connectionFailed', { message: error.message });
    log(tr('bleError'), error.message);
  }));
  ui.disconnectBtn.addEventListener('click', disconnectBluetooth);
  ui.demoBtn.addEventListener('click', () => state.demo ? stopDemo() : startDemo());
  ui.clearLogBtn.addEventListener('click', clearDebugLog);
  ui.exportLogBtn.addEventListener('click', exportDebugLog);
  ui.logJumpBtn.addEventListener('click', scrollLogToEnd);
  ui.debugLog.addEventListener('scroll', onDebugLogScroll);
  ui.updateBar.addEventListener('click', applyUpdate);

  // Karten
  ui.newMapBtn.addEventListener('click', () => createMapFromInput().catch(reportError));
  [ui.positionModeSelect, ui.originLatInput, ui.originLonInput].forEach((input) => input
    .addEventListener('change', () => updatePositionModeFromUi().catch(reportError)));
  ui.newMapName.addEventListener('keydown', (e) => { if (e.key === 'Enter') createMapFromInput().catch(reportError); });
  ui.deleteMapBtn.addEventListener('click', () => deleteActiveMap().catch(reportError));
  ui.mapSelect.addEventListener('change', () => setActiveMapById(ui.mapSelect.value));
  // Ein Tipp auf das RTK-Abzeichen blendet die GPS-Einblendung auf der Karte um.
  ui.rtkBadge.addEventListener('click', () => toggleGpsPanel());
  ui.mapGallery.addEventListener('click', (event) => {
    const rename = event.target.closest('[data-map-rename-id]');
    if (rename) { renameMapById(rename.dataset.mapRenameId).catch(reportError); return; }
    const copy = event.target.closest('[data-map-copy-id]');
    if (copy) { duplicateMapById(copy.dataset.mapCopyId).catch(reportError); return; }
    const lock = event.target.closest('[data-map-lock-id]');
    if (lock) { toggleMapLockById(lock.dataset.mapLockId).catch(reportError); return; }
    const select = event.target.closest('[data-map-card-id]');
    if (select) setActiveMapById(select.dataset.mapCardId);
  });
  ui.lockMapBtn.addEventListener('click', () => state.activeMap && toggleMapLockById(state.activeMap.id).catch(reportError));
  ui.exportJsonBtn.addEventListener('click', exportCurrentMapJson);
  ui.exportGeoJsonBtn.addEventListener('click', exportCurrentMapGeoJson);
  ui.shareJsonBtn.addEventListener('click', () => { shareCurrentMap('json'); });
  ui.shareGeoJsonBtn.addEventListener('click', () => { shareCurrentMap('geojson'); });
  ui.exportSunrayBtn.addEventListener('click', exportCurrentMapSunray);
  ui.shareSunrayBtn.addEventListener('click', () => {
    shareCurrentMap('sunray')
      .then((shared) => { if (shared) noticeSunrayExport(state.activeMap); })
      .catch(reportError);
  });
  ui.exportCassandraBtn.addEventListener('click', exportCurrentMapCassandra);
  ui.shareCassandraBtn.addEventListener('click', () => {
    shareCurrentMap('cassandra')
      .then((shared) => { if (shared) noticeCassandraExport(state.activeMap); })
      .catch(reportError);
  });
  // Bei jeder Aenderung des Wertepaars nachfuehren, nicht erst beim naechsten Menueoeffnen.
  [ui.cassandraLatInput, ui.cassandraLonInput].forEach((input) => input
    .addEventListener('change', () => updateCassandraReferenceFromUi().catch(reportError)));
  ui.importInput.addEventListener('change', () => {
    const file = ui.importInput.files?.[0];
    if (file) importMapFile(file).catch((e) => showNotice({ title: tr('errorTitle'), message: tr('importFailed', { message: e.message }), tone: 'danger' }));
    ui.importInput.value = '';
  });
  ui.validateMapBtn.addEventListener('click', validateActiveMap);

  // Aufnahme-Einstellungen
  ui.fixOnly.addEventListener('change', refreshCaptureState);
  [ui.autoCaptureIntervalInput, ui.autoCaptureModeSelect, ui.autoCaptureDistanceInput].forEach((input) => input
    .addEventListener('change', () => { updateViewPreferencesFromUi(); applyViewPreferencesToUi(); refreshCaptureState(); }));
  ui.elementList.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-delete-role]');
    if (remove) { deleteElement(remove.dataset.deleteRole, remove.dataset.deleteExclusion || null).catch(reportError); return; }
    const select = event.target.closest('[data-element-role]');
    if (select) activateElement(select.dataset.elementRole, select.dataset.elementExclusion || null);
  });

  // Ansicht
  [ui.showGrid, ui.gridStepSelect, ui.showMower, ui.showTrail, ui.showPointQuality].forEach((input) => input.addEventListener('change', updateViewPreferencesFromUi));
  [ui.mowerLengthInput, ui.mowerWidthInput].forEach((input) => input.addEventListener('change', () => { updateViewPreferencesFromUi(); applyViewPreferencesToUi(); }));
  ui.clearTrailBtn.addEventListener('click', () => { state.trail = []; renderMap(); ui.pointStatus.textContent = tr('trailCleared'); });
  ui.keepAwake.addEventListener('change', () => {
    updateViewPreferencesFromUi();
    if (state.view.keepAwake && state.autoCaptureRunning) requestWakeLockIfNeeded();
    else if (!state.view.keepAwake) releaseWakeLock();
    refreshWakeLockStatus();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopDrive(); cancelCaptureHold(); releaseWakeLock(); return; }
    // Chrome drosselt Timer im Hintergrund: nach der Rueckkehr braucht der Link eine
    // Karenzzeit, sonst meldet der RX-Watchdog eine Stille, die nur vom Throttling kam.
    if (state.connected) state.lastBleRxAt = Date.now();
    if (state.autoCaptureRunning) requestWakeLockIfNeeded();
  });
  window.addEventListener('blur', () => { stopDrive(); cancelCaptureHold(); });
  window.addEventListener('resize', () => { renderMap(); refreshTurnKeyHint(); });
}

async function init() {
  loadViewPreferences();
  loadCassandraReference();
  if (missingUiElements.length) {
    // Sichtbar machen statt still danebenlaufen — meist ein halb aktualisierter Cache.
    log('UI', `fehlende Elemente: ${missingUiElements.join(', ')}`);
  }
  // Karten zuerst: eine fehlerhafte Bedienelement-Bindung darf die Kartendaten nie blockieren.
  try {
    state.db = await openDb();
    await loadMaps();
  } catch (error) {
    log('DB', error.message);
    reportError(error);
  }
  try {
    applyViewPreferencesToUi();
    bindEvents();
  } catch (error) {
    log('START', error.message);
    reportError(error);
  }
  resetViewport({ render: false });
  setMode('perimeter');
  setConnectionStatus(false, 'notConnected', 'readyConnect');
  refreshShareButtons();
  renderCassandraReference();
  applyLanguage();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    // Uebernimmt ein neuer Service Worker die Kontrolle, wurde die Seite noch mit den Dateien
    // des alten ausgeliefert. Einmal neu laden holt sie frisch — sonst muesste der Nutzer von
    // Hand ein zweites Mal neu laden, um eine neue Version zu sehen.
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (state.reloadingForUpdate) return;
        state.reloadingForUpdate = true;
        log('Service Worker', 'neue Version aktiv, Seite wird neu geladen');
        location.reload();
      });
    }
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        watchForUpdates(registration);
        registration.update().catch(() => {});
        // Beim Zurueckkehren zur App nachsehen, ob inzwischen etwas Neues bereitsteht.
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) registration.update().catch(() => {});
        });
        return navigator.serviceWorker.ready;
      })
      .then(() => { state.offlineCacheReady = true; updateHelpSystemStatus(); })
      .catch((error) => { state.offlineCacheReady = false; updateHelpSystemStatus(); log('Service Worker', error.message); });
  } else {
    state.offlineCacheReady = false;
    updateHelpSystemStatus();
  }
  log(tr('appStarted'));
}

init().catch((error) => {
  console.error(error);
  ui.connectionDetail.textContent = tr('startError', { message: error.message });
});

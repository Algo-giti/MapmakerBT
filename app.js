'use strict';

// Muss zur Version in sw.js passen (tests/sw-test.js prueft das) und steht beim Start
// im Diagnoseprotokoll — so laesst sich auf dem Geraet ablesen, welcher Stand laeuft.
const APP_VERSION = 'v19';
const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
const BLE_CHUNK_SIZE = 15; // Sunray ESP32 BLE_MTU=20; payload <= 15 bytes
const BLE_INTER_CHUNK_DELAY_MS = 12;
const DRIVE_HEARTBEAT_MS = 650; // Sunray manual drive command times out after 1000 ms
// RX-Watchdog: Sunray antwortet auf jedes AT+S. Bleiben drei Abfragen in Folge unbeantwortet,
// gilt der Link als tot, auch wenn Chrome ihn weiter als "connected" fuehrt.
const BLE_RX_TIMEOUT_MS = 8000;
const BLE_RX_CHECK_INTERVAL_MS = 1000;
const BLE_MAX_RECONNECT_ATTEMPTS = 8;
// Eine Sunray-Zeile ist rund 120 Zeichen lang; 4 KB lassen genug Luft fuer stark
// zerstueckelte Antworten und begrenzen trotzdem Muell ohne Zeilenende.
const BLE_RX_BUFFER_LIMIT = 4096;
const BLE_RX_OVERFLOW_LIMIT = 3;
// Sunray beantwortet jedes AT+S. Bleiben vier Abfragen in Folge ohne verwertbare Antwort
// (rund 8 s), ist die Antwortkette gestoert — auch wenn noch Bruchstuecke eintrudeln und
// der reine Stille-Watchdog deshalb nicht anschlaegt.
const BLE_UNANSWERED_POLL_LIMIT = 4;
// Fehlgeschlagene Schreibvorgaenge wiederholen sich im Sekundentakt (Fahr-Heartbeat, Polling).
// Der Kurzhinweis erscheint jedes Mal, der Dialog hoechstens alle 20 s.
const BLE_ERROR_NOTICE_INTERVAL_MS = 20000;
// Manuelle Aufnahme mittelt die letzten Fixes, statt den Nutzer warten zu lassen.
const POSITION_SMOOTHING_WINDOW_MS = 2000;
const POSITION_SMOOTHING_MAX_SAMPLES = 10;
const DRIVE_POINTER_MIN_INTERVAL_MS = 160;
const DB_NAME = 'ardumower-bt-mapper';
const DB_VERSION = 1;
const MAP_STORE = 'maps';
const ACTIVE_MAP_KEY = 'ardumower-bt-mapper-active-map';
const VIEW_PREFS_KEY = 'mapcreator-ardumower-view-prefs-v1';
const MAX_MAPS = 10;


const I18N = {
  de: {
    bleWriteFailedTitle: 'Senden fehlgeschlagen', bleWriteFailedShort: 'Senden fehlgeschlagen: {message}',
    bleWriteFailed: 'Der Befehl {context} konnte nicht an den Mäher gesendet werden.\n\n{message}',
    errorTitle: 'Fehler', okUnderstood: 'Verstanden',
    deleteExclusionTitle: 'Ausschlussfläche löschen', clearNow: 'Leeren', closeNow: 'Schließen',
    closeContourTitle: 'Kontur schließen',
    chooseMode: 'Aufnahmemodus wählen', cancel: 'Abbrechen',
    closeContourQuestion: 'Soll {label} geschlossen werden? Der letzte Punkt wird mit dem ersten verbunden.',
    closeOpenContours: 'Offene Konturen schließen', closeContoursConfirm: '{count} offene Kontur(en) jetzt schließen?',
    checkAreaOpen: '{label}: Kontur ist offen — letzter und erster Punkt sind nicht verbunden.',
    areaSelected: '{name} ausgewählt · gesamte Fläche', areaDeleted: 'Ausschlussfläche gelöscht.',
    deleteAreaConfirm: '„{name}“ mit allen Punkten löschen?',
    settings: 'Einstellungen', appearance: 'Darstellung', themeSystem: 'System', themeLight: 'Hell', themeDark: 'Dunkel',
    themeHint: '„System“ übernimmt die Einstellung des Geräts.',
    autoCaptureInterval: 'Intervall der automatischen Aufnahme', autoCaptureOn: 'Automatik läuft',
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
    movePoint: 'Verschieben', movePointHint: 'Tippen: Punkt springt auf die Mäherposition', holdToCapture: 'Zum Aufnehmen gedrückt halten',
    deletePoint: 'Ausgewählten Punkt löschen', pointDeleted: 'Punkt {n} gelöscht.', fitView: 'Ansicht zurücksetzen',
    driveSettings: 'Fahrgeschwindigkeit', driveSpeedRange: 'Geschwindigkeit', driveSpeedRangeHint: 'Auslenkung des Joysticks regelt stufenlos zwischen Min und Max.',
    driveSpeedMin: 'Minimum', driveSpeedMax: 'Maximum', driveTurnMax: 'Maximale Drehrate',
    driveSafetyNote: 'Loslassen stoppt sofort. Sunray stoppt zusätzlich nach 1 s ohne neues Fahrkommando.',
    captureSettings: 'Aufnahme',
    helpWaypointTitle: 'Wegpunkte', helpWaypointText: 'Offene Punktfolge für Anfahrtswege innerhalb der Karte aufnehmen.',
    driveHelpTitle: 'Manuell fahren',
    driveHelp1: 'Der Joystick unten steuert wie bei einem RC-Fahrzeug: die Richtung der Auslenkung ist die Fahrtrichtung, die Stärke der Auslenkung die Geschwindigkeit. Loslassen sendet sofort Stop.',
    driveHelp2: 'Minimale und maximale Geschwindigkeit werden im Menü unter „Fahren“ festgelegt und gelten für den vollen Ausschlag.',
    driveHelp3: 'Wichtig: Bei Bluetooth-Funkverlust kann die Webseite keinen neuen Stop-Befehl mehr übertragen. Deshalb nur bei Sichtkontakt arbeiten und den physischen Stop/Not-Aus am Mäher erreichbar halten.',
    driveHelp4: 'Diese App steuert bewusst kein Mähen: kein Start, kein Stop, kein Docking. Sie nimmt ausschließlich Karten auf.',
    appTitle: 'MapCreator für Ardumower',
    appDescription: 'MapCreator für Ardumower – mobile Kartenaufnahme über Web Bluetooth und Sunray.',
    languageToggleLabel: 'Auf Englisch umschalten', tabMaps: 'Karten', tabConnection: 'Verbindung', tabHelp: 'Hilfe', tabDebug: 'Diagnose',
    activeMap: 'AKTIVE KARTE', battery: 'Akku', perimeter: 'Perimeter', exclusion: 'Ausschluss', dock: 'Dock',
    exclusionArea: 'Ausschlussfläche', newExclusion: '+ Neu', delete: 'Löschen', clearCurrentElement: 'Aktuelles Element leeren',
    onlyRtkFix: 'Nur bei RTK FIX', recentPoints: 'Letzte Punkte',
    viewScale: 'Ansicht & Maßstab', showGrid: 'Raster anzeigen', gridSpacing: 'Rasterweite', gridAuto: 'Automatisch',
    showMower: 'Mäher anzeigen', mowerLength: 'Länge', mowerWidth: 'Breite', mowerScaleNote: 'Der Mäher wird maßstäblich zur Karte dargestellt.', mowerTooltip: 'Mäher {length} × {width} m',
    noPointSelected: 'Kein Punkt ausgewählt',
    selectedPointInfo: '{label} · Punkt {n}', relearnPoint: 'Punkt neu anlernen', pointRelearned: 'Punkt {n} neu angelernt: X {x} · Y {y}',
    activeMapField: 'Aktive Karte', newMapField: 'Neue Karte', newMapPlaceholder: 'z. B. Hintergarten', createMap: 'Neue Karte anlegen', mapLimitReached: 'Maximal 10 Karten können lokal gespeichert werden. Lösche zuerst eine Karte.',
    backupManagement: 'Backup & Verwaltung', backupDescription: 'Die Kartendaten liegen in IndexedDB des Browsers. Ein Export ist die einfachste Sicherung.',
    saveJson: 'Als JSON speichern', saveGeoJson: 'Als GeoJSON speichern',
    exportHint: 'JSON enthält das vollständige Mapper-Backup. GeoJSON speichert Perimeter/Ausschlüsse/Dock als Geometrien mit lokalen Sunray-X/Y-Koordinaten in Metern.',
    importJsonGeoJson: 'JSON / GeoJSON importieren', deleteCurrentMap: 'Aktuelle Karte löschen',
    bluetoothConnection: 'Bluetooth-Verbindung', sunrayPassword: 'Sunray-Passwort', passwordHint: 'Nur für diese Sitzung. Wird nicht mit der Karte gespeichert.',
    searchConnect: 'Gerät suchen & verbinden', disconnect: 'Verbindung trennen',
    sendVersion: 'AT+V senden', sendState: 'AT+S senden', clearLog: 'Log leeren', mapPreviewAria: 'Vorschau der aufgenommenen Mähkarte', exportMapAria: 'Karte exportieren',
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
    firstMapName: 'Meine erste Karte', saving: 'Speichert …', savedAt: 'Lokal gespeichert · {time}', noExclusion: 'Noch keine Ausschlussfläche',
    exclusionN: 'Ausschluss {n}', mapN: 'Karte {n}', deleteMapConfirm: 'Karte „{name}“ wirklich lokal löschen?',
    dockPath: 'Dockpfad',
    deleteExclusionConfirm: '{name} wirklich löschen?', pointSaved: 'Punkt gespeichert: X {x} · Y {y}', dockPoints: 'Dockpunkte', clearConfirm: '{label} wirklich leeren?',
    mapSummary: '{name} · {points} Punkte', noMap: 'Keine Karte', noMapLoaded: 'Keine Karte geladen.',
    recentPoint: 'Punkt {n}', invalidMapFile: 'Datei ist keine MapCreator-für-Ardumower-Karte.', unknown: 'unbekannt',
    unsupportedGeometry: 'GeoJSON-Geometrie {type} wird nicht unterstützt.', invalidCoordinates: 'GeoJSON enthält ungültige X/Y-Koordinaten.',
    invalidGeoJson: 'Datei ist kein unterstütztes GeoJSON FeatureCollection.', noGeoFeatures: 'GeoJSON enthält keine Features mit role=perimeter, exclusion oder dock.',
    insecureContext: 'Diese Seite läuft nicht in einem sicheren Kontext. Für Web Bluetooth bitte über HTTPS (z. B. GitHub Pages) öffnen.',
    browserNoBluetooth: 'Dieser Browser stellt Web Bluetooth nicht bereit. Für den Prototyp Android + Chrome verwenden; der Demo-Modus funktioniert trotzdem.',
    connectionFailed: 'Verbindung fehlgeschlagen: {message}', bleError: 'BLE Fehler', importFailed: 'Import fehlgeschlagen: {message}',
    versionError: 'AT+V Fehler', startError: 'Startfehler: {message}', appStarted: 'App gestartet',
    autoCapture: 'Auto-Aufnahme', autoCaptureOff: 'Automatik aus', autoCaptureRunning: 'Läuft · {count} Punkte automatisch', autoPointSaved: 'Auto-Punkt {count}: X {x} · Y {y}',
    showTrail: 'Fahrspur anzeigen', clearTrail: 'Fahrspur löschen', trailCleared: 'Fahrspur gelöscht.', distanceToBoundary: 'Zur Grenze {distance} m', distanceToPoint: 'Zum Punkt {distance} m',
    mapCheck: 'Kartenprüfung', checkNow: 'Jetzt prüfen', notCheckedYet: 'Noch nicht geprüft.', mapCheckOk: 'Karte plausibel · Fläche {area} m² · Umfang {perimeter} m · RTK FIX {fix}/{points}', mapCheckIssues: '{errors} Fehler · {warnings} Hinweise · Fläche {area} m²',
    checkPerimeterTooFew: 'Perimeter hat weniger als 3 Punkte.', checkAreaTooFew: '{label} hat weniger als 3 Punkte.', checkSelfIntersection: '{label} überschneidet sich selbst.', checkExclusionOutside: '{label} liegt nicht vollständig innerhalb des Perimeters.', checkExclusionOverlap: '{a} und {b} überschneiden sich.',
    checkClosePoints: '{label}: {count} sehr kurze Punktabstände unter 5 cm.', checkLongSegments: '{label}: {count} Strecken sind länger als 5 m.', checkNonFixPoints: '{count} von {points} Punkten wurden nicht mit RTK FIX aufgenommen.', checkDockEmpty: 'Kein Dockpfad vorhanden (optional).',
    versionsHistory: 'Versionen & Verlauf', versionsDescription: 'Wichtige Bearbeitungen werden lokal als Wiederherstellungspunkte gespeichert.', saveVersionNow: 'Version jetzt speichern', noVersions: 'Noch keine Versionen gespeichert.', restoreVersion: 'Wiederherstellen', versionSaved: 'Version gespeichert.',
    undoLastChange: 'Letzte Änderung zurück', noChangeToUndo: 'Noch keine Änderung im Verlauf', undoChangeHint: '{reason} · {time}', restoreConfirm: 'Version vom {time} wirklich wiederherstellen?', restoredVersion: 'Version vom {time} wiederhergestellt.',
    historyManual: 'Manuelle Version', historyAddPoint: 'Punkt aufgenommen', historyAutoCapture: 'Auto-Aufnahme', historyDeletePoint: 'Punkt gelöscht', historyRelearnPoint: 'Punkt neu angelernt', historyClear: 'Element geleert', historyDeleteExclusion: 'Ausschluss gelöscht', historyCreateExclusion: 'Ausschluss angelegt', historyRestore: 'Vor Wiederherstellung',
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
    offlineWorks1: 'Bluetooth-Verbindung zum Ardumower', offlineWorks2: 'Live-X/Y, RTK-Status und Kartenaufnahme', offlineWorks3: 'Auto-Aufnahme, Punkt-/Teilstück-Bearbeitung und Kartenprüfung', offlineWorks4: 'Bis zu 10 Karten in IndexedDB, Versionen und Undo', offlineWorks5: 'JSON- und GeoJSON-Export',
    offlineNeeds1: 'Der allererste Aufruf von GitHub Pages', offlineNeeds2: 'Ein neues App-Update herunterladen', offlineNeeds3: 'Neu laden, falls der Offline-Cache vorher gelöscht wurde',
    offlineWarning: 'Wichtig: Browserdaten/Website-Daten löschen kann sowohl Offline-Cache als auch lokal gespeicherte Karten entfernen. Regelmäßig JSON-Backups erstellen.',
    bluetoothHelpTitle: 'Bluetooth-Verbindung verstehen', bleHelp1: 'MapCreator nutzt Bluetooth Low Energy (BLE) und verbindet sich direkt mit dem Ardumower-ESP32 – nicht über das Internet.', bleHelp2: 'Der bekannte Ardumower-BLE-UART-Service verwendet FFE0/FFE1. Sunray-Kommandos werden über diese Verbindung übertragen.', bleHelp3: 'Die Gerätesuche darf ein Browser nur nach einer Benutzeraktion starten. Deshalb musst du den Verbindungsbutton antippen und den Ardumower auswählen.', bleHelp4: 'Das Sunray-Passwort wird nur für die laufende Sitzung verwendet und nicht mit der Karte gespeichert.', bleHelp5: 'Wenn die BLE-Verbindung durch Standby, Reichweite oder Browser-Neustart abbricht, einfach erneut „Gerät suchen & verbinden“ verwenden.',
    mappingHelpTitle: 'Karten erstellen & korrigieren', helpPerimeterTitle: 'Perimeter', helpPerimeterText: 'Äußere Mähgrenze Punkt für Punkt oder automatisch nach Distanz aufnehmen.', helpExclusionTitle: 'Ausschlussflächen', helpExclusionText: 'Mehrere geschlossene Bereiche innerhalb des Perimeters anlegen, die nicht gemäht werden sollen.', helpDockTitle: 'Dockpfad', helpDockText: 'Offenen Punktpfad für den Dockbereich erfassen.', helpEditTitle: 'Punkte bearbeiten', helpEditText: 'Punkt auf der Karte antippen: der Hauptbutton wird zum Verschieben-Button, das Werkzeug oben rechts löscht ihn.', helpValidationTitle: 'Kartenprüfung', helpValidationText: 'Sucht Selbstüberschneidungen, problematische Abstände, Ausschlüsse außerhalb des Perimeters und fehlende RTK-FIX-Punkte.', helpVersionsTitle: 'Versionen & Undo', helpVersionsText: 'Wichtige Änderungen werden lokal als Wiederherstellungspunkte gespeichert.',
    formatsTitle: 'Speichern, JSON & GeoJSON', jsonHelp: 'Empfohlenes vollständiges Backup für MapCreator. Enthält Kartenstruktur, Punkte und zusätzliche Metadaten wie Aufnahme-/Editierinformationen.', geoJsonHelp: 'Für Geometrie-Austausch. Perimeter und Ausschlüsse werden als Polygone, der Dockpfad als LineString exportiert.', geoJsonXYWarning: 'Die Ardumower-Koordinaten sind lokale Sunray-X/Y-Werte in Metern. Sie sind keine GPS-Längen-/Breitengrade und werden deshalb im Export ausdrücklich als lokales metrisches Koordinatensystem gekennzeichnet.',
    troubleshootingTitle: 'Fehlerbehebung', faqDeviceTitle: 'Ardumower wird nicht gefunden', faqDeviceText: 'Prüfe Bluetooth am Tablet, aktuelle Chrome-Version, Reichweite und ob der ESP32 BLE sendet. Falls eine andere App bereits verbunden ist, diese Verbindung zuerst trennen. Danach Bluetooth-Gerätesuche erneut öffnen.', faqButtonTitle: 'Aufnahme-Button wird nicht grün', faqButtonText: 'Grün bedeutet echten RTK FIX. Prüfe RTK-Empfang und die Live-Daten. Wenn „Nur bei RTK FIX“ aktiv ist, bleibt die Aufnahme bei FLOAT/INVALID gesperrt.', faqOfflineTitle: 'Die App startet ohne WLAN nicht', faqOfflineText: 'Öffne die GitHub-Pages-Seite mindestens einmal mit Internet und warte, bis der Offline-Cache im Systemcheck als bereit angezeigt wird. Danach am besten als PWA installieren.', faqMapsGoneTitle: 'Meine Karten sind verschwunden', faqMapsGoneText: 'Karten liegen lokal im Browser. Gelöschte Website-Daten, ein anderer Browser oder ein anderes Benutzerprofil haben einen eigenen Speicher. Importiere dein letztes JSON-Backup.', faqIosTitle: 'Warum funktioniert es auf iPhone/iPad nicht?', faqIosText: 'Der MapCreator benötigt Web Bluetooth. Safari und Chrome auf iOS/iPadOS bieten diese Web-API derzeit nicht nativ an; deshalb kann die Webseite den Ardumower dort nicht direkt auswählen und verbinden.',
    privacyTitle: 'Daten & Privatsphäre', privacy1: 'GitHub Pages liefert nur die statische App aus. Deine aufgezeichneten Karten werden nicht automatisch zu GitHub hochgeladen.', privacy2: 'Karten und Versionen liegen lokal im Browser des verwendeten Geräts.', privacy3: 'Bluetooth-Kommunikation läuft direkt zwischen Browser und Ardumower-ESP32.', privacy4: 'Das Sunray-Passwort wird nicht in den Kartendaten gespeichert.', privacy5: 'Für wichtige Karten regelmäßig ein JSON-Backup auf einem zweiten Speicherort ablegen.',
    historyCloseContour: 'Kontur geschlossen',
    historyClosePerimeter: 'Perimeter schließen/öffnen',
    showPointQuality: 'Punktqualität anzeigen', keepAwake: 'Bildschirm beim Mapping wachhalten', wakeLockAuto: 'Wird bei aktiver Aufnahme automatisch verwendet.', wakeLockActive: 'Bildschirm bleibt wach.', wakeLockUnavailable: 'Wake Lock in diesem Browser nicht verfügbar.', wakeLockReleased: 'Wake Lock derzeit nicht aktiv.',
    perimeterNearStart: 'Startpunkt erreicht · Abstand {distance} m', closePerimeter: 'Perimeter schließen', perimeterClosed: 'Perimeter geschlossen · kein doppelter Startpunkt gespeichert.', perimeterAlreadyClosed: 'Perimeter ist bereits geschlossen.', reopenPerimeter: 'Perimeter wieder öffnen', checkPerimeterOpen: 'Perimeter ist noch nicht als geschlossen markiert.',
    mapOverview: 'Kartenübersicht', lockCurrentMap: 'Karte sperren', unlockCurrentMap: 'Karte entsperren', mapLocked: 'Gesperrt', mapLockedHint: 'Diese Karte ist gesperrt. Zum Bearbeiten zuerst entsperren.', mapCardArea: '{area} m²', mapCardPoints: '{points} Punkte', mapCardChanged: 'Geändert {date}', selectMap: 'Karte auswählen', drive: 'Fahren', stopEverythingDone: 'STOP gesendet · Fahrt 0 · Mähmotor AUS · IDLE',
    manualDrive: 'Manuell fahren', driveSpeed: 'Tempo', reverse: 'Zurück', left: 'Links', stop: 'Stop', driveIdle: 'Fahrt gestoppt', driveNeedConnection: 'Für manuelle Fahrt zuerst per BLE verbinden.',
    helpQualityTitle: 'Punktqualität', helpQualityText: 'Kartenpunkte können abhängig von RTK-Lösung und Genauigkeit farblich bewertet werden.', helpSmartAutoTitle: 'Intelligente Auto-Aufnahme', helpSmartAutoText: 'Auf Geraden werden weniger Punkte gesetzt, bei Richtungsänderungen automatisch dichter.', helpLockTitle: 'Kartensperre', helpLockText: 'Fertige Karten lassen sich gegen versehentliche Änderungen sperren.',
    solutionInvalid: 'UNGÜLTIG', solutionUnknown: 'UNBEKANNT', importName: 'Import', geoJsonImport: 'GeoJSON Import', importSuffix: '(Import)'
  },
  en: {
    bleWriteFailedTitle: 'Sending failed', bleWriteFailedShort: 'Sending failed: {message}',
    bleWriteFailed: 'The command {context} could not be sent to the mower.\n\n{message}',
    errorTitle: 'Error', okUnderstood: 'Got it',
    deleteExclusionTitle: 'Delete exclusion area', clearNow: 'Clear', closeNow: 'Close',
    closeContourTitle: 'Close contour',
    chooseMode: 'Choose capture mode', cancel: 'Cancel',
    closeContourQuestion: 'Close {label}? The last point will be connected to the first one.',
    closeOpenContours: 'Close open contours', closeContoursConfirm: 'Close {count} open contour(s) now?',
    checkAreaOpen: '{label}: contour is open — last and first point are not connected.',
    areaSelected: '{name} selected · whole area', areaDeleted: 'Exclusion area deleted.',
    deleteAreaConfirm: 'Delete “{name}” with all its points?',
    settings: 'Settings', appearance: 'Appearance', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
    themeHint: '“System” follows the device setting.',
    autoCaptureInterval: 'Automatic capture interval', autoCaptureOn: 'Automatic running',
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
    movePoint: 'Move', movePointHint: 'Tap: the point jumps to the mower position', holdToCapture: 'Hold to capture',
    deletePoint: 'Delete selected point', pointDeleted: 'Point {n} deleted.', fitView: 'Reset view',
    driveSettings: 'Drive speed', driveSpeedRange: 'Speed', driveSpeedRangeHint: 'Joystick deflection scales steplessly between min and max.',
    driveSpeedMin: 'Minimum', driveSpeedMax: 'Maximum', driveTurnMax: 'Maximum turn rate',
    driveSafetyNote: 'Releasing stops immediately. Sunray also stops after 1 s without a new drive command.',
    captureSettings: 'Capture',
    helpWaypointTitle: 'Waypoints', helpWaypointText: 'Capture an open sequence of points for approach paths inside the map.',
    driveHelpTitle: 'Manual driving',
    driveHelp1: 'The joystick at the bottom works like an RC car: the direction of deflection is the direction of travel, the amount of deflection is the speed. Releasing sends stop immediately.',
    driveHelp2: 'Minimum and maximum speed are set in the menu under “Drive” and apply across the full deflection.',
    driveHelp3: 'Important: if the Bluetooth link is lost, the website cannot transmit a new stop command. Use only with line of sight and keep the mower’s physical stop/emergency control accessible.',
    driveHelp4: 'This app deliberately does not control mowing: no start, no stop, no docking. It only captures maps.',
    appTitle: 'MapCreator für Ardumower',
    appDescription: 'MapCreator für Ardumower – mobile map recording via Web Bluetooth and Sunray.',
    languageToggleLabel: 'Switch to German', tabMaps: 'Maps', tabConnection: 'Connection', tabHelp: 'Help', tabDebug: 'Diagnostics',
    activeMap: 'ACTIVE MAP', battery: 'Battery', perimeter: 'Perimeter', exclusion: 'Exclusion', dock: 'Dock',
    exclusionArea: 'Exclusion area', newExclusion: '+ New', delete: 'Delete', clearCurrentElement: 'Clear current element',
    onlyRtkFix: 'RTK FIX only', recentPoints: 'Recent points',
    viewScale: 'View & scale', showGrid: 'Show grid', gridSpacing: 'Grid spacing', gridAuto: 'Automatic',
    showMower: 'Show mower', mowerLength: 'Length', mowerWidth: 'Width', mowerScaleNote: 'The mower is drawn to scale on the map.', mowerTooltip: 'Mower {length} × {width} m',
    noPointSelected: 'No point selected',
    selectedPointInfo: '{label} · point {n}', relearnPoint: 'Relearn point', pointRelearned: 'Point {n} relearned: X {x} · Y {y}',
    activeMapField: 'Active map', newMapField: 'New map', newMapPlaceholder: 'e.g. Back garden', createMap: 'Create new map', mapLimitReached: 'A maximum of 10 maps can be stored locally. Delete a map first.',
    backupManagement: 'Backup & management', backupDescription: 'Map data is stored in the browser’s IndexedDB. Exporting is the easiest way to create a backup.',
    saveJson: 'Save as JSON', saveGeoJson: 'Save as GeoJSON',
    exportHint: 'JSON contains the complete MapCreator backup. GeoJSON stores perimeter/exclusions/dock as geometries using local Sunray X/Y coordinates in metres.',
    importJsonGeoJson: 'Import JSON / GeoJSON', deleteCurrentMap: 'Delete current map',
    bluetoothConnection: 'Bluetooth connection', sunrayPassword: 'Sunray password', passwordHint: 'For this session only. It is not stored with the map.',
    searchConnect: 'Find device & connect', disconnect: 'Disconnect',
    sendVersion: 'Send AT+V', sendState: 'Send AT+S', clearLog: 'Clear log', mapPreviewAria: 'Preview of the recorded mowing map', exportMapAria: 'Export map',
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
    firstMapName: 'My first map', saving: 'Saving …', savedAt: 'Saved locally · {time}', noExclusion: 'No exclusion area yet',
    exclusionN: 'Exclusion {n}', mapN: 'Map {n}', deleteMapConfirm: 'Really delete map “{name}” locally?',
    dockPath: 'Dock path',
    deleteExclusionConfirm: 'Really delete {name}?', pointSaved: 'Point saved: X {x} · Y {y}', dockPoints: 'Dock points', clearConfirm: 'Really clear {label}?',
    mapSummary: '{name} · {points} points', noMap: 'No map', noMapLoaded: 'No map loaded.',
    recentPoint: 'Point {n}', invalidMapFile: 'File is not a MapCreator für Ardumower map.', unknown: 'unknown',
    unsupportedGeometry: 'GeoJSON geometry {type} is not supported.', invalidCoordinates: 'GeoJSON contains invalid X/Y coordinates.',
    invalidGeoJson: 'File is not a supported GeoJSON FeatureCollection.', noGeoFeatures: 'GeoJSON contains no features with role=perimeter, exclusion, or dock.',
    insecureContext: 'This page is not running in a secure context. Open it via HTTPS (for example GitHub Pages) to use Web Bluetooth.',
    browserNoBluetooth: 'This browser does not provide Web Bluetooth. Use Android + Chrome for the prototype; demo mode still works.',
    connectionFailed: 'Connection failed: {message}', bleError: 'BLE error', importFailed: 'Import failed: {message}',
    versionError: 'AT+V error', startError: 'Startup error: {message}', appStarted: 'App started',
    autoCapture: 'Auto capture', autoCaptureOff: 'Automatic off', autoCaptureRunning: 'Running · {count} points captured automatically', autoPointSaved: 'Auto point {count}: X {x} · Y {y}',
    showTrail: 'Show movement trail', clearTrail: 'Clear movement trail', trailCleared: 'Movement trail cleared.', distanceToBoundary: 'To boundary {distance} m', distanceToPoint: 'To point {distance} m',
    mapCheck: 'Map check', checkNow: 'Check now', notCheckedYet: 'Not checked yet.', mapCheckOk: 'Map looks plausible · area {area} m² · perimeter {perimeter} m · RTK FIX {fix}/{points}', mapCheckIssues: '{errors} errors · {warnings} notes · area {area} m²',
    checkPerimeterTooFew: 'Perimeter has fewer than 3 points.', checkAreaTooFew: '{label} has fewer than 3 points.', checkSelfIntersection: '{label} intersects itself.', checkExclusionOutside: '{label} is not fully inside the perimeter.', checkExclusionOverlap: '{a} and {b} overlap.',
    checkClosePoints: '{label}: {count} very short point gaps below 5 cm.', checkLongSegments: '{label}: {count} segments are longer than 5 m.', checkNonFixPoints: '{count} of {points} points were not captured with RTK FIX.', checkDockEmpty: 'No dock path present (optional).',
    versionsHistory: 'Versions & history', versionsDescription: 'Important edits are stored locally as restore points.', saveVersionNow: 'Save version now', noVersions: 'No versions saved yet.', restoreVersion: 'Restore', versionSaved: 'Version saved.',
    undoLastChange: 'Undo last change', noChangeToUndo: 'No change in history yet', undoChangeHint: '{reason} · {time}', restoreConfirm: 'Restore version from {time}?', restoredVersion: 'Version from {time} restored.',
    historyManual: 'Manual version', historyAddPoint: 'Point captured', historyAutoCapture: 'Auto capture', historyDeletePoint: 'Point deleted', historyRelearnPoint: 'Point relearned', historyClear: 'Element cleared', historyDeleteExclusion: 'Exclusion deleted', historyCreateExclusion: 'Exclusion created', historyRestore: 'Before restore',
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
    offlineWorks1: 'Bluetooth connection to the Ardumower', offlineWorks2: 'Live X/Y, RTK status and map recording', offlineWorks3: 'Auto capture, point/section editing and map checks', offlineWorks4: 'Up to 10 maps in IndexedDB, versions and undo', offlineWorks5: 'JSON and GeoJSON export',
    offlineNeeds1: 'The very first GitHub Pages load', offlineNeeds2: 'Downloading a new app update', offlineNeeds3: 'Reloading after the offline cache has been cleared',
    offlineWarning: 'Important: clearing browser/site data can remove both the offline cache and locally stored maps. Create JSON backups regularly.',
    bluetoothHelpTitle: 'Understanding the Bluetooth connection', bleHelp1: 'MapCreator uses Bluetooth Low Energy (BLE) and connects directly to the Ardumower ESP32 – not through the internet.', bleHelp2: 'The known Ardumower BLE UART service uses FFE0/FFE1. Sunray commands are transported through this connection.', bleHelp3: 'A browser may start device discovery only after a user action. You therefore have to tap the connect button and select the Ardumower.', bleHelp4: 'The Sunray password is used only for the current session and is not stored with the map.', bleHelp5: 'If BLE disconnects because of standby, range or a browser restart, simply use “Find device & connect” again.',
    mappingHelpTitle: 'Creating & correcting maps', helpPerimeterTitle: 'Perimeter', helpPerimeterText: 'Record the outer mowing boundary point by point or automatically by distance.', helpExclusionTitle: 'Exclusion areas', helpExclusionText: 'Create multiple closed areas inside the perimeter that must not be mowed.', helpDockTitle: 'Dock path', helpDockText: 'Record an open point path for the docking area.', helpEditTitle: 'Edit points', helpEditText: 'Select an existing point, move the mower close to it and relearn its position.', helpValidationTitle: 'Map check', helpValidationText: 'Finds self-intersections, problematic spacing, exclusions outside the perimeter and points captured without RTK FIX.', helpVersionsTitle: 'Versions & undo', helpVersionsText: 'Important changes are stored locally as restore points.',
    formatsTitle: 'Saving, JSON & GeoJSON', jsonHelp: 'Recommended complete MapCreator backup. Contains the map structure, points and extra metadata such as capture/edit information.', geoJsonHelp: 'For geometry exchange. Perimeter and exclusions are exported as polygons and the dock path as a LineString.', geoJsonXYWarning: 'Ardumower coordinates are local Sunray X/Y values in metres. They are not GPS longitude/latitude values, so the export explicitly marks them as a local metric coordinate system.',
    troubleshootingTitle: 'Troubleshooting', faqDeviceTitle: 'Ardumower is not found', faqDeviceText: 'Check Bluetooth on the tablet, a current Chrome version, range and whether the ESP32 is advertising BLE. If another app is already connected, disconnect it first. Then open Bluetooth device discovery again.', faqButtonTitle: 'Capture button does not turn green', faqButtonText: 'Green means a real RTK FIX. Check RTK reception and the live data. With “RTK FIX only” enabled, capture remains blocked for FLOAT/INVALID.', faqOfflineTitle: 'The app does not start without Wi-Fi', faqOfflineText: 'Open the GitHub Pages site at least once with internet and wait until the system check shows the offline cache as ready. Installing it as a PWA is recommended.', faqMapsGoneTitle: 'My maps are gone', faqMapsGoneText: 'Maps are stored locally in the browser. Cleared site data, a different browser or a different browser profile use separate storage. Import your latest JSON backup.', faqIosTitle: 'Why does it not work on iPhone/iPad?', faqIosText: 'MapCreator requires Web Bluetooth. Safari and Chrome on iOS/iPadOS currently do not provide this Web API natively, so the website cannot directly select and connect to the Ardumower there.',
    privacyTitle: 'Data & privacy', privacy1: 'GitHub Pages only serves the static app. Your recorded maps are not automatically uploaded to GitHub.', privacy2: 'Maps and versions stay in the browser storage of the device being used.', privacy3: 'Bluetooth communication runs directly between the browser and the Ardumower ESP32.', privacy4: 'The Sunray password is not stored in map data.', privacy5: 'For important maps, regularly keep a JSON backup in a second location.',
    historyCloseContour: 'Contour closed',
    historyClosePerimeter: 'Close/reopen perimeter',
    showPointQuality: 'Show point quality', keepAwake: 'Keep screen awake while mapping', wakeLockAuto: 'Used automatically while an active recording is running.', wakeLockActive: 'Screen will stay awake.', wakeLockUnavailable: 'Wake Lock is not available in this browser.', wakeLockReleased: 'Wake Lock is currently inactive.',
    perimeterNearStart: 'Start point reached · distance {distance} m', closePerimeter: 'Close perimeter', perimeterClosed: 'Perimeter closed · no duplicate start point stored.', perimeterAlreadyClosed: 'Perimeter is already closed.', reopenPerimeter: 'Reopen perimeter', checkPerimeterOpen: 'Perimeter is not marked as closed yet.',
    mapOverview: 'Map overview', lockCurrentMap: 'Lock map', unlockCurrentMap: 'Unlock map', mapLocked: 'Locked', mapLockedHint: 'This map is locked. Unlock it before editing.', mapCardArea: '{area} m²', mapCardPoints: '{points} points', mapCardChanged: 'Changed {date}', selectMap: 'Select map', drive: 'Drive', stopEverythingDone: 'STOP sent · drive 0 · mowing motor OFF · IDLE',
    manualDrive: 'Manual drive', driveSpeed: 'Speed', reverse: 'Reverse', left: 'Left', stop: 'Stop', driveIdle: 'Drive stopped', driveNeedConnection: 'Connect via BLE before using manual drive.',
    helpQualityTitle: 'Point quality', helpQualityText: 'Map points can be colour-coded based on RTK solution and recorded accuracy.', helpSmartAutoTitle: 'Smart auto capture', helpSmartAutoText: 'Uses fewer points on straight sections and automatically records more densely when direction changes.', helpLockTitle: 'Map lock', helpLockText: 'Finished maps can be locked against accidental changes.',
    solutionInvalid: 'INVALID', solutionUnknown: 'UNKNOWN', importName: 'Import', geoJsonImport: 'GeoJSON Import', importSuffix: '(Import)'
  }
};

function tr(key, vars = {}) {
  const dict = I18N[state?.language || 'de'] || I18N.de;
  let text = dict[key] ?? I18N.de[key] ?? key;
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

const $ = (id) => document.getElementById(id);
const ui = {
  // Kopfzeile
  menuBtn: $('menuBtn'), bleStatusBtn: $('bleStatusBtn'), modeCycleBtn: $('modeCycleBtn'), modeChipLabel: $('modeChipLabel'),
  modeDialog: $('modeDialog'), modeDialogCancel: $('modeDialogCancel'), closeContoursBtn: $('closeContoursBtn'),
  confirmDialog: $('confirmDialog'), confirmDialogTitle: $('confirmDialogTitle'), confirmDialogText: $('confirmDialogText'),
  confirmDialogActions: $('confirmDialogActions'), confirmDialogCancel: $('confirmDialogCancel'), confirmDialogAccept: $('confirmDialogAccept'),
  rtkBadge: $('rtkBadge'), rtkText: $('rtkText'), rtkSats: $('rtkSats'), batteryChip: $('batteryChip'), batteryFill: $('batteryFill'), batteryValue: $('batteryValue'),
  // Kartenbuehne
  mapSvg: $('mapSvg'), gridLayer: $('gridLayer'), shapeLayer: $('shapeLayer'), robotLayer: $('robotLayer'),
  deletePointBtn: $('deletePointBtn'), deleteFabWrap: $('deleteFabWrap'), deleteBtnLabel: $('deleteBtnLabel'), fitViewBtn: $('fitViewBtn'),
  captureCluster: $('captureCluster'), autoCaptureBtn: $('autoCaptureBtn'), autoCaptureLabel: $('autoCaptureLabel'),
  captureFabWrap: $('captureFabWrap'), addPointBtn: $('addPointBtn'), captureProgress: $('captureProgress'), captureButtonTitle: $('captureButtonTitle'), captureButtonHint: $('captureButtonHint'),
  mapSummary: $('mapSummary'), mapDistanceInfo: $('mapDistanceInfo'), pointStatus: $('pointStatus'), activeMapName: $('activeMapName'), saveState: $('saveState'),
  // Fahren
  driveJoystick: $('driveJoystick'), joystickKnob: $('joystickKnob'), driveState: $('driveState'),
  driveSpeedMinInput: $('driveSpeedMinInput'), driveSpeedMaxInput: $('driveSpeedMaxInput'), driveTurnMaxInput: $('driveTurnMaxInput'), driveSpeedValue: $('driveSpeedValue'),
  // Menueseite
  menuPage: $('menuPage'), menuScroll: $('menuScroll'), settingsSections: $('settingsSections'),
  menuCloseBtn: $('menuCloseBtn'), languageToggle: $('languageToggle'),
  connectionPill: $('connectionPill'), connectionDetail: $('connectionDetail'), browserWarning: $('browserWarning'), passwordInput: $('passwordInput'),
  connectBtn: $('connectBtn'), disconnectBtn: $('disconnectBtn'), demoBtn: $('demoBtn'),
  firmwareValue: $('firmwareValue'),
  mapSelect: $('mapSelect'), newMapName: $('newMapName'), newMapBtn: $('newMapBtn'), deleteMapBtn: $('deleteMapBtn'), lockMapBtn: $('lockMapBtn'),
  exportJsonBtn: $('exportJsonBtn'), exportGeoJsonBtn: $('exportGeoJsonBtn'), importInput: $('importInput'),
  mapGallery: $('mapGallery'), mapCountBadge: $('mapCountBadge'), saveVersionBtn: $('saveVersionBtn'), historyList: $('historyList'),
  historyUndoBtn: $('historyUndoBtn'), historyUndoHint: $('historyUndoHint'), recentPoints: $('recentPoints'),
  exclusionControls: $('exclusionControls'), exclusionSelect: $('exclusionSelect'), newExclusionBtn: $('newExclusionBtn'), deleteExclusionBtn: $('deleteExclusionBtn'),
  fixOnly: $('fixOnly'), clearModeBtn: $('clearModeBtn'),
  autoCaptureIntervalInput: $('autoCaptureIntervalInput'), autoCaptureState: $('autoCaptureState'),
  showGrid: $('showGrid'), gridStepSelect: $('gridStepSelect'), showMower: $('showMower'), mowerLengthInput: $('mowerLengthInput'), mowerWidthInput: $('mowerWidthInput'),
  showTrail: $('showTrail'), clearTrailBtn: $('clearTrailBtn'), showPointQuality: $('showPointQuality'), keepAwake: $('keepAwake'), wakeLockStatus: $('wakeLockStatus'),
  validateMapBtn: $('validateMapBtn'), validationSummary: $('validationSummary'), validationList: $('validationList'), validationDrawer: $('validationDrawer'),
  requestVersionBtn: $('requestVersionBtn'), requestStateBtn: $('requestStateBtn'), clearLogBtn: $('clearLogBtn'), debugLog: $('debugLog'),
  helpSecureStatus: $('helpSecureStatus'), helpBluetoothStatus: $('helpBluetoothStatus'), helpOfflineStatus: $('helpOfflineStatus'), helpNetworkStatus: $('helpNetworkStatus'),
};

const state = {
  language: 'de',
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
  pendingConfirm: null,
  lastBleErrorNoticeAt: 0,
  reloadingForUpdate: false,
  selectedPoint: null,
  selectedArea: null,
  fixHistory: [],
  // Nutzer-Zoom/-Verschiebung der Karte; solange custom=false folgt die Ansicht dem Auto-Fit.
  viewport: { zoom: 1, dx: 0, dy: 0, custom: false, base: null },
  gesture: null,
  // Der viewBox der Karte folgt der tatsaechlichen Flaeche in CSS-Pixeln (siehe updateViewBox).
  viewBox: { w: 1000, h: 680 },
  hitRadiusUnits: 26,
  captureHold: null,
  autoCaptureRunning: false,
  autoCaptureTimer: null,
  autoCaptureBusy: false,
  autoCaptureCount: 0,
  currentTransform: null,
  wakeLock: null,
  driveTimer: null,
  driveDirection: null,
  driveVector: { linear: 0, angular: 0 },
  joystickPointerId: null,
  lastDriveSentAt: 0,

  appliedMowPwm: null,
  trail: [],
  validationResult: null,
  maps: [],
  activeMap: null,
  activeExclusionId: null,
  view: {
    showGrid: true, gridStep: 0.5, showMower: true, mowerLength: 0.60, mowerWidth: 0.35,
    autoCaptureIntervalS: 5, showTrail: true, showPointQuality: true, keepAwake: true,
    driveSpeedMin: 0.08, driveSpeedMax: 0.25, driveTurnMax: 1.15, theme: 'system',
  },
  telemetry: {
    x: null, y: null, delta: null, solution: null, age: null, accuracy: null,
    visibleSatellites: null, visibleSatellitesDgps: null, batteryVoltage: null, receivedAt: 0,
  },
  pendingVersion: null,
};

function log(message, data = '') {
  const stamp = new Date().toLocaleTimeString(localeCode());
  const suffix = data === '' ? '' : ` ${typeof data === 'string' ? data : JSON.stringify(data)}`;
  ui.debugLog.textContent += `[${stamp}] ${message}${suffix}\n`;
  ui.debugLog.scrollTop = ui.debugLog.scrollHeight;
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
  ui.requestVersionBtn.disabled = !state.connected || state.demo;
  ui.requestStateBtn.disabled = !state.connected || state.demo;
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
  return {
    nx, ny,
    linear: -ramp(ny),
    angular: -nx * turn,
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
  state.driveTimer = setInterval(() => {
    if (state.driveDirection === 'joystick') sendDriveVector(state.driveVector.linear, state.driveVector.angular, { force: true }).catch((error) => reportBleError('AT+M', error));
  }, DRIVE_HEARTBEAT_MS);
}

function stopDrive({ send = true } = {}) {
  if (state.driveTimer) clearInterval(state.driveTimer);
  state.driveTimer = null;
  const wasDriving = Boolean(state.driveDirection) || state.joystickPointerId !== null;
  state.driveDirection = null;
  state.joystickPointerId = null;
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
    state.view.theme = THEMES.includes(saved.theme) ? saved.theme : 'system';
    state.view.showTrail = saved.showTrail !== false;
    state.view.showPointQuality = saved.showPointQuality !== false;
    state.view.keepAwake = saved.keepAwake !== false;
    state.view.driveSpeedMin = clampNumber(saved.driveSpeedMin, 0.02, 0.34, 0.08);
    state.view.driveSpeedMax = clampNumber(saved.driveSpeedMax, 0.03, 0.50, 0.25);
    state.view.driveTurnMax = clampNumber(saved.driveTurnMax, 0.20, 2.00, 1.15);
  } catch (_) {
    state.view = { showGrid: true, gridStep: 0.5, showMower: true, mowerLength: 0.60, mowerWidth: 0.35, autoCaptureIntervalS: 5, showTrail: true, showPointQuality: true, keepAwake: true, driveSpeedMin: 0.08, driveSpeedMax: 0.25, driveTurnMax: 1.15, theme: 'system' };
  }
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
  applyTheme();
  ui.showTrail.checked = state.view.showTrail;
  ui.showPointQuality.checked = state.view.showPointQuality;
  ui.keepAwake.checked = state.view.keepAwake;
  const limits = driveSpeedLimits();
  ui.driveSpeedMinInput.value = limits.min.toFixed(2);
  ui.driveSpeedMaxInput.value = limits.max.toFixed(2);
  ui.driveTurnMaxInput.value = limits.turn.toFixed(2);
}

function updateViewPreferencesFromUi() {
  state.view.showGrid = ui.showGrid.checked;
  state.view.showMower = ui.showMower.checked;
  state.view.gridStep = ui.gridStepSelect.value === 'auto' ? 'auto' : clampNumber(ui.gridStepSelect.value, 0.10, 10.00, 0.50);
  state.view.mowerLength = clampNumber(ui.mowerLengthInput.value, 0.10, 3.00, state.view.mowerLength);
  state.view.mowerWidth = clampNumber(ui.mowerWidthInput.value, 0.10, 3.00, state.view.mowerWidth);
  state.view.autoCaptureIntervalS = Math.round(clampNumber(ui.autoCaptureIntervalInput.value, 1, 120, state.view.autoCaptureIntervalS));
  state.view.showTrail = ui.showTrail.checked;
  state.view.showPointQuality = ui.showPointQuality.checked;
  state.view.keepAwake = ui.keepAwake.checked;
  state.view.driveSpeedMin = clampNumber(ui.driveSpeedMinInput.value, 0.02, 0.34, state.view.driveSpeedMin);
  state.view.driveSpeedMax = clampNumber(ui.driveSpeedMaxInput.value, state.view.driveSpeedMin + 0.01, 0.50, state.view.driveSpeedMax);
  state.view.driveTurnMax = clampNumber(ui.driveTurnMaxInput.value, 0.20, 2.00, state.view.driveTurnMax);
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
  if (!ensureMapEditable() || !state.activeMap || state.activeMap.perimeter.length < 3) return;
  if (!state.activeMap.perimeterClosed) checkpointMap('closePerimeter');
  state.activeMap.perimeterClosed = true;
  if (state.autoCaptureRunning) stopAutoCapture();
  await saveActiveMap();
  state.validationResult = null;
  renderMap();
  ui.pointStatus.textContent = tr('perimeterClosed');
  if (automatic) log('MAP', tr('perimeterClosed'));
}

async function reopenPerimeter() {
  if (!ensureMapEditable() || !state.activeMap) return;
  if (!state.activeMap.perimeterClosed) return;
  checkpointMap('closePerimeter');
  state.activeMap.perimeterClosed = false;
  await saveActiveMap();
  renderMap();
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
  return tr('selectedPointInfo', { label, n: sel.index + 1 });
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
  checkpointMap('deleteExclusion');
  state.activeMap.exclusions = state.activeMap.exclusions.filter((e) => e.id !== exclusion.id);
  state.selectedArea = null;
  state.selectedPoint = null;
  state.activeExclusionId = state.activeMap.exclusions[0]?.id || null;
  state.validationResult = null;
  renderExclusionControls();
  await saveActiveMap();
  renderMap();
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
function askConfirm({ title, message, confirmLabel, tone = 'neutral', singleButton = false }) {
  if (typeof globalThis.__confirmAdapter === 'function') {
    return Promise.resolve(Boolean(globalThis.__confirmAdapter({ title, message, confirmLabel, tone, singleButton })));
  }
  // Eine noch offene Rueckfrage gilt als abgelehnt, damit kein Promise haengen bleibt.
  if (state.pendingConfirm) confirmDialogRespond(false);
  return new Promise((resolve) => {
    state.pendingConfirm = resolve;
    ui.confirmDialogTitle.textContent = title;
    ui.confirmDialogText.textContent = message;
    ui.confirmDialogCancel.textContent = tr('cancel');
    ui.confirmDialogCancel.hidden = singleButton;
    ui.confirmDialogActions.classList.toggle('single', singleButton);
    ui.confirmDialogAccept.textContent = confirmLabel;
    ui.confirmDialogAccept.classList.toggle('danger', tone === 'danger');
    ui.confirmDialogAccept.classList.toggle('primary', tone !== 'danger');
    ui.confirmDialog.hidden = false;
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
  state.pendingConfirm = null;
  ui.confirmDialog.hidden = true;
  if (resolve) resolve(Boolean(answer));
}

// --- Menueseite -----------------------------------------------------------
function setMenuOpen(open, { section = null } = {}) {
  state.menuOpen = Boolean(open);
  ui.menuPage.hidden = !state.menuOpen;
  document.body.classList.toggle('menu-open', state.menuOpen);
  if (state.menuOpen) {
    stopDrive();
    if (state.autoCaptureRunning) stopAutoCapture();
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

/** Aufnahme erfordert Halten, damit Wischen/Zoomen auf der Karte nichts ausloest. */
function beginCaptureHold(event) {
  if (ui.addPointBtn.disabled || state.selectedPoint) return;
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

/** Mit ausgewaehltem Punkt genuegt ein Tap: der Punkt wandert auf die Maeherposition. */
function captureButtonTap() {
  if (ui.addPointBtn.disabled || !state.selectedPoint) return;
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

  updateRtkBadge();
  const auto = state.autoCaptureRunning;
  const button = ui.addPointBtn;
  button.classList.remove('capture-fix', 'capture-warning', 'capture-blocked', 'capture-idle', 'capture-stop');
  button.classList.toggle('move-mode', Boolean(selected));
  // Automatik ersetzt den manuellen Knopf, statt neben ihm zu stehen.
  ui.captureCluster.classList.toggle('auto-active', auto);
  // Der ganze Block inklusive Beschriftung verschwindet, nicht nur der Knopf.
  ui.captureFabWrap.hidden = auto;
  ui.autoCaptureLabel.textContent = tr(auto ? 'autoCaptureOn' : 'autoCapture');
  ui.autoCaptureBtn.setAttribute('aria-pressed', String(auto));
  ui.autoCaptureBtn.disabled = mapLocked || (!auto && !(hasMap && fresh && coords && !blockedByFixRule));
  refreshDeleteButton();
  // Im Verschieben-Zustand gibt es kein Halten: eine laufende Halteaktion wird verworfen.
  // (Nicht umgekehrt: ein laufendes Halten darf nicht von der 2-s-Telemetrie abgebrochen werden.)
  if (selected || auto) cancelCaptureHold();

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
  if (selected) {
    const distance = mowerDistanceToSelected();
    button.disabled = !fresh || !coords || blockedByFixRule;
    const label = `${selectedPointLabel()}${Number.isFinite(distance) ? ` · ${distance.toFixed(2)} m` : ''}`;
    if (!fresh || !coords) show('capture-idle', tr('movePoint'), tr('noCurrentXY'), label);
    else if (blockedByFixRule) show('capture-blocked', tr('noRtkFix'), tr('captureBlocked', { solution: solution() }), label);
    else show(hasTrueFix ? 'capture-fix' : 'capture-warning', tr('movePoint'), tr('movePointHint'), label);
    return;
  }

  if (state.mode === 'perimeter' && state.activeMap?.perimeterClosed) {
    button.disabled = false;
    show('capture-warning', tr('reopenPerimeter'), tr('perimeterAlreadyClosed'), tr('perimeterAlreadyClosed'));
    return;
  }

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
  else if (hasTrueFix) show('capture-fix', tr('capturePoint'), tr('holdToCapture'), tr('readyPoint', { x: t.x.toFixed(2), y: t.y.toFixed(2) }));
  else show('capture-warning', tr('captureAnyway'), tr('noTrueFix', { solution: solution() }), tr('warningPoint', { solution: solution() }));
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

async function writeBytes(bytes) {
  if (!state.characteristic) throw new Error(tr('errorNoCharacteristic'));
  for (let i = 0; i < bytes.length; i += BLE_CHUNK_SIZE) {
    const chunk = bytes.slice(i, i + BLE_CHUNK_SIZE);
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
  state.pollTimer = setInterval(poll, 2000);
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

function localizedMapName(map) {
  if (!map) return tr('noMap');
  const name = String(map.name || '').trim();
  if (name === 'Meine erste Karte' || name === 'My first map') return tr('firstMapName');
  const numbered = name.match(/^(?:Karte|Map)\s+(\d+)$/i);
  if (numbered) return tr('mapN', { n: numbered[1] });
  return name || tr('firstMapName');
}

function localizedExclusionName(exclusion, index = 0) {
  const name = String(exclusion?.name || '').trim();
  if (!name || /^(?:Ausschluss|Exclusion)\s+\d+$/i.test(name)) return tr('exclusionN', { n: index + 1 });
  return name;
}

function makeMap(name) {
  const now = new Date().toISOString();
  return {
    format: 'ardumower-web-map', generator: 'MapCreator für Ardumower', version: 2,
    id: newId(), name: name.trim(), coordinateSystem: 'sunray-local-xy-meters',
    createdAt: now, updatedAt: now, locked: false, perimeterClosed: false, perimeter: [], exclusions: [], waypoints: [], dockPoints: [], history: [],
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
  if (!Array.isArray(map.history)) map.history = [];
  return map;
}

function geometrySnapshot(map) {
  return {
    name: map.name,
    perimeterClosed: map.perimeterClosed === true,
    perimeter: structuredClone(map.perimeter || []),
    exclusions: structuredClone(map.exclusions || []),
    waypoints: structuredClone(map.waypoints || []),
    dockPoints: structuredClone(map.dockPoints || []),
  };
}

function checkpointMap(reasonKey, { beforeChange = true } = {}) {
  if (!state.activeMap) return null;
  normalizeMap(state.activeMap);
  const entry = {
    id: newId(), createdAt: new Date().toISOString(), reasonKey, beforeChange,
    snapshot: geometrySnapshot(state.activeMap),
  };
  state.activeMap.history.push(entry);
  if (state.activeMap.history.length > 30) state.activeMap.history.splice(0, state.activeMap.history.length - 30);
  return entry;
}

function historyReason(entry) {
  const keyMap = {
    manual: 'historyManual', addPoint: 'historyAddPoint', autoCapture: 'historyAutoCapture', deletePoint: 'historyDeletePoint', relearnPoint: 'historyRelearnPoint',
    clear: 'historyClear', deleteExclusion: 'historyDeleteExclusion', createExclusion: 'historyCreateExclusion',
    closePerimeter: 'historyClosePerimeter', closeContour: 'historyCloseContour', restore: 'historyRestore',
  };
  return tr(keyMap[entry?.reasonKey] || 'historyManual');
}

function applyGeometrySnapshot(snapshot) {
  if (!state.activeMap || !snapshot) return;
  state.activeMap.name = snapshot.name || state.activeMap.name;
  state.activeMap.perimeterClosed = snapshot.perimeterClosed === true;
  state.activeMap.perimeter = structuredClone(snapshot.perimeter || []);
  state.activeMap.exclusions = structuredClone(snapshot.exclusions || []);
  state.activeMap.waypoints = structuredClone(snapshot.waypoints || []);
  state.activeMap.dockPoints = structuredClone(snapshot.dockPoints || []);
  state.activeExclusionId = state.activeMap.exclusions[0]?.id || null;
  clearPointSelection({ render: false });
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
  renderHistory();
  refreshHistoryUndoState();
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
    const changed=document.createElement('small'); changed.textContent=tr('mapCardChanged',{date:new Date(map.updatedAt||map.createdAt||Date.now()).toLocaleDateString(localeCode())});
    copy.append(title,meta,changed); select.append(svg,copy);
    const lock=document.createElement('button'); lock.type='button'; lock.className=`map-card-lock${map.locked?' active':''}`; lock.dataset.mapLockId=map.id; lock.textContent=map.locked?'🔒':'🔓'; lock.title=tr(map.locked?'unlockCurrentMap':'lockCurrentMap'); lock.setAttribute('aria-label',lock.title);
    card.append(select,lock); ui.mapGallery.appendChild(card);
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
  ui.clearModeBtn.disabled = locked;
  ui.newExclusionBtn.disabled = locked;
  renderExclusionControls();
  renderHistory();
  refreshHistoryUndoState();
  renderValidation();
  refreshCaptureState();
}

function setActiveMapById(mapId) {
  const next = state.maps.find((m) => m.id === mapId);
  if (!next) return;
  stopAutoCapture();
  state.activeMap = normalizeMap(next);
  state.activeExclusionId = state.activeMap.exclusions?.[0]?.id || null;
  state.selectedPoint = null;
  state.validationResult = null;
  state.trail = [];
  resetViewport({ render: false });
  localStorage.setItem(ACTIVE_MAP_KEY, state.activeMap.id);
  renderMapControls();
  renderMap();
}

function renderExclusionControls() {
  ui.exclusionSelect.innerHTML = '';
  const exclusions = state.activeMap?.exclusions || [];
  if (!exclusions.length) {
    const option = document.createElement('option');
    option.textContent = tr('noExclusion');
    option.value = '';
    ui.exclusionSelect.appendChild(option);
    state.activeExclusionId = null;
  } else {
    if (!exclusions.some((e) => e.id === state.activeExclusionId)) state.activeExclusionId = exclusions[0].id;
    exclusions.forEach((exclusion, index) => {
      const option = document.createElement('option');
      option.value = exclusion.id;
      option.textContent = localizedExclusionName(exclusion, index);
      option.selected = exclusion.id === state.activeExclusionId;
      ui.exclusionSelect.appendChild(option);
    });
  }
  ui.deleteExclusionBtn.disabled = !state.activeExclusionId || Boolean(state.activeMap?.locked);
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
  checkpointMap('createExclusion');
  const number = state.activeMap.exclusions.length + 1;
  const exclusion = { id: newId(), name: tr('exclusionN', { n: number }), points: [], closed: false };
  state.activeMap.exclusions.push(exclusion);
  state.activeExclusionId = exclusion.id;
  renderExclusionControls();
  await saveActiveMap();
  renderMap();
}

async function deleteExclusion() {
  if (!state.activeMap || !state.activeExclusionId || !ensureMapEditable()) return;
  const exIndex = state.activeMap.exclusions.findIndex((e) => e.id === state.activeExclusionId);
  const ex = state.activeMap.exclusions[exIndex];
  const confirmed = await askConfirm({
    title: tr('deleteExclusionTitle'),
    message: tr('deleteExclusionConfirm', { name: ex ? localizedExclusionName(ex, exIndex) : tr('exclusionArea') }),
    confirmLabel: tr('delete'),
    tone: 'danger',
  });
  if (!confirmed) return;
  checkpointMap('deleteExclusion');
  if (state.selectedPoint?.role === 'exclusion' && state.selectedPoint.exclusionId === state.activeExclusionId) state.selectedPoint = null;
  state.activeMap.exclusions = state.activeMap.exclusions.filter((e) => e.id !== state.activeExclusionId);
  state.activeExclusionId = state.activeMap.exclusions[0]?.id || null;
  renderExclusionControls();
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
  checkpointMap('relearnPoint');
  const point = pointFromTelemetry();
  point.originalCapturedAt = oldPoint.originalCapturedAt || oldPoint.capturedAt || null;
  point.editedAt = point.capturedAt;
  point.previousPosition = { x: oldPoint.x, y: oldPoint.y };
  target[sel.index] = point;
  await saveActiveMap();
  renderMap();
  ui.pointStatus.textContent = tr('pointRelearned', { n: sel.index + 1, x: point.x.toFixed(2), y: point.y.toFixed(2) });
}

async function appendCurrentPoint({ automatic = false, targetOverride = null, save = true } = {}) {
  if (!ensureMapEditable()) return null;
  let target = targetOverride || getActivePointArray();
  if (!targetOverride && state.mode === 'exclusion' && !target) {
    await createExclusion();
    target = getActivePointArray();
  }
  if (!target || !telemetryIsFresh()) return null;
  if (ui.fixOnly.checked && !telemetryHasFix()) return null;
  if (!automatic && save) checkpointMap('addPoint');
  const point = pointFromTelemetry();
  target.push(point);
  if (save) await saveActiveMap();
  if (!automatic) ui.pointStatus.textContent = tr('pointSaved', { x: point.x.toFixed(2), y: point.y.toFixed(2) });
  return point;
}

function stopAutoCapture({ render = true } = {}) {
  if (state.autoCaptureTimer) clearInterval(state.autoCaptureTimer);
  state.autoCaptureTimer = null;
  state.autoCaptureRunning = false;
  state.autoCaptureBusy = false;
  releaseWakeLock();
  if (render) { renderMap(); refreshCaptureState(); }
}

/** Zeitgesteuerte Aufnahme: alle state.view.autoCaptureIntervalS Sekunden ein Punkt. */
async function startAutoCapture() {
  if (!ensureMapEditable()) return;
  if (!state.activeMap || !telemetryIsFresh() || (ui.fixOnly.checked && !telemetryHasFix())) return;
  if (state.mode === 'exclusion' && !getActivePointArray()) await createExclusion();
  clearPointSelection({ render: false });
  checkpointMap('autoCapture');
  state.autoCaptureRunning = true;
  state.autoCaptureCount = 0;
  requestWakeLockIfNeeded();
  await autoCaptureTick();
  const intervalMs = Math.max(1, state.view.autoCaptureIntervalS) * 1000;
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
    if (state.mode === 'perimeter' && perimeterClosureCandidate()) {
      await closePerimeter({ automatic: true });
      stopAutoCapture({ render: false });
      renderMap(); refreshCaptureState();
      return;
    }
    const point = await appendCurrentPoint({ automatic: true });
    if (point) {
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
  if (state.selectedPoint) { await relearnSelectedPoint(); clearPointSelection(); return; }
  if (state.mode === 'perimeter' && state.activeMap?.perimeterClosed) { await reopenPerimeter(); return; }
  if (state.mode === 'perimeter' && perimeterClosureCandidate()) { await closePerimeter(); return; }
  await appendCurrentPoint();
  renderMap();
}

/** Loescht den aktuell ausgewaehlten Punkt (Werkzeug oben rechts auf der Karte). */
async function deleteSelectedPoint() {
  if (!ensureMapEditable()) return;
  const target = getSelectedPointArray();
  const sel = state.selectedPoint;
  if (!target || !sel || !target[sel.index]) return;
  checkpointMap('deletePoint');
  target.splice(sel.index, 1);
  if (sel.role === 'perimeter') state.activeMap.perimeterClosed = false;
  state.selectedPoint = null;
  state.validationResult = null;
  await saveActiveMap();
  renderMap();
  ui.pointStatus.textContent = tr('pointDeleted', { n: sel.index + 1 });
}

async function undoPoint() {
  if (!ensureMapEditable()) return;
  const target = getActivePointArray();
  if (!target?.length) return;
  checkpointMap('deletePoint');
  target.pop();
  if (state.mode === 'perimeter') state.activeMap.perimeterClosed = false;
  state.selectedPoint = null;
  await saveActiveMap();
  renderMap();
}

async function clearCurrentElement() {
  if (!ensureMapEditable()) return;
  const target = getActivePointArray();
  if (!target?.length) return;
  const confirmed = await askConfirm({
    title: tr('clearCurrentElement'),
    message: tr('clearConfirm', { label: modeLabel(state.mode) }),
    confirmLabel: tr('clearNow'),
    tone: 'danger',
  });
  if (!confirmed) return;
  checkpointMap('clear');
  target.splice(0, target.length);
  if (state.mode === 'perimeter') state.activeMap.perimeterClosed = false;
  state.selectedPoint = null;
  await saveActiveMap();
  renderMap();
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

function svgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

const MAP_PADDING = 24; // Rand um die Karte in viewBox-Einheiten (= CSS-Pixel)
const MIN_USER_ZOOM = 0.6;
const MAX_USER_ZOOM = 14;

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
  // Eine eingefrorene Basisansicht passt nicht mehr zur neuen Flaeche.
  if (state.viewport.custom) state.viewport.base = null;
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

    const qualityClass = state.view.showPointQuality ? ` quality-${pointQuality(p)}` : '';
    const circle = svgEl('circle', {
      cx: s.x, cy: s.y, r: selected ? 11 : 7,
      class: `${className} map-point${qualityClass}${selected ? ' selected-map-point' : ''}`,
      'pointer-events': 'none', role: 'img', ...common,
    });
    ui.shapeLayer.appendChild(circle);
    if (selected) ui.shapeLayer.appendChild(svgEl('circle', { cx: s.x, cy: s.y, r: 19, class: 'edit-selected-ring', 'pointer-events': 'none' }));
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

function recentArray() {
  const arr = getActivePointArray() || [];
  return arr.slice(-6).map((p, i) => ({ point: p, index: arr.length - Math.min(6, arr.length) + i + 1 }));
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

    ui.mapSummary.textContent = tr('mapSummary', { name: localizedMapName(state.activeMap), points: mapPointCount(state.activeMap) });
  } else {
    ui.activeMapName.textContent = tr('noMap');
    ui.mapSummary.textContent = tr('noMapLoaded');
  }

  drawSelectionGuide(transform);
  drawDistanceGuide(transform);
  drawRobot(transform);
  refreshMapDistanceInfo();
  refreshDeleteButton();
  refreshHistoryUndoState();

  ui.recentPoints.innerHTML = '';
  recentArray().forEach(({ point, index }) => {
    const row = document.createElement('div');
    row.className = 'recent-point';
    row.innerHTML = `<span>${tr('recentPoint', { n: index })}</span><strong>X ${point.x.toFixed(2)} · Y ${point.y.toFixed(2)}</strong>`;
    ui.recentPoints.appendChild(row);
  });
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

function exportCurrentMapJson() {
  if (!state.activeMap) return;
  const payload = JSON.stringify(state.activeMap, null, 2);
  downloadTextFile(payload, `${safeFileName(localizedMapName(state.activeMap))}.mapcreator-ardumower.json`, 'application/json');
}

function pointCoordinate(point) {
  return [Number(point.x), Number(point.y)];
}

function closeRing(points) {
  const coords = points.map(pointCoordinate);
  if (coords.length >= 3) coords.push([...coords[0]]);
  return coords;
}

function geometryForArea(points) {
  if (points.length >= 3) return { type: 'Polygon', coordinates: [closeRing(points)] };
  if (points.length === 2) return { type: 'LineString', coordinates: points.map(pointCoordinate) };
  if (points.length === 1) return { type: 'Point', coordinates: pointCoordinate(points[0]) };
  return null;
}

function geometryForLine(points) {
  if (points.length >= 2) return { type: 'LineString', coordinates: points.map(pointCoordinate) };
  if (points.length === 1) return { type: 'Point', coordinates: pointCoordinate(points[0]) };
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
  const perimeterGeometry = geometryForArea(map.perimeter);
  if (perimeterGeometry) {
    features.push({
      type: 'Feature',
      properties: {
        role: 'perimeter',
        name: 'Perimeter',
        coordinateSystem: 'sunray-local-xy-meters',
        units: 'm',
        completePolygon: map.perimeter.length >= 3,
        samples: sampleMetadata(map.perimeter),
      },
      geometry: perimeterGeometry,
    });
  }

  const waypointGeometry = geometryForLine(map.waypoints || []);
  if (waypointGeometry) {
    features.push({
      type: 'Feature',
      properties: { role: 'waypoints', name: 'Waypoints', coordinateSystem: 'sunray-local-xy-meters', units: 'm', samples: sampleMetadata(map.waypoints) },
      geometry: waypointGeometry,
    });
  }

  map.exclusions.forEach((exclusion, index) => {
    const geometry = geometryForArea(exclusion.points || []);
    if (!geometry) return;
    features.push({
      type: 'Feature',
      properties: {
        role: 'exclusion',
        exclusionIndex: index,
        exclusionId: exclusion.id,
        name: localizedExclusionName(exclusion, index),
        coordinateSystem: 'sunray-local-xy-meters',
        units: 'm',
        completePolygon: exclusion.points.length >= 3,
        samples: sampleMetadata(exclusion.points),
      },
      geometry,
    });
  });

  const dockGeometry = geometryForLine(map.dockPoints);
  if (dockGeometry) {
    features.push({
      type: 'Feature',
      properties: {
        role: 'dock',
        name: tr('dockPath'),
        coordinateSystem: 'sunray-local-xy-meters',
        units: 'm',
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
      coordinateSystem: 'sunray-local-xy-meters',
      units: 'm',
      note: 'Coordinates are local Sunray X/Y values in meters, not WGS84 longitude/latitude.',
      createdAt: map.createdAt,
      updatedAt: map.updatedAt,
    },
    features,
  };
}

function exportCurrentMapGeoJson() {
  if (!state.activeMap) return;
  const payload = JSON.stringify(mapToGeoJson(state.activeMap), null, 2);
  downloadTextFile(payload, `${safeFileName(localizedMapName(state.activeMap))}.geojson`, 'application/geo+json');
}

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

function pointsFromGeoGeometry(geometry, samples = []) {
  if (!geometry) return [];
  let coords = [];
  if (geometry.type === 'Point') coords = [geometry.coordinates];
  else if (geometry.type === 'LineString') coords = geometry.coordinates;
  else if (geometry.type === 'Polygon') coords = geometry.coordinates?.[0] || [];
  else throw new Error(tr('unsupportedGeometry', { type: geometry.type || tr('unknown') }));

  if (geometry.type === 'Polygon' && coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (Array.isArray(first) && Array.isArray(last) && first[0] === last[0] && first[1] === last[1]) coords = coords.slice(0, -1);
  }

  return coords.map((coord, index) => {
    if (!Array.isArray(coord) || coord.length < 2 || !Number.isFinite(Number(coord[0])) || !Number.isFinite(Number(coord[1]))) {
      throw new Error(tr('invalidCoordinates'));
    }
    const meta = samples[index] || {};
    return {
      x: Number(coord[0]),
      y: Number(coord[1]),
      capturedAt: meta.capturedAt || null,
      originalCapturedAt: meta.originalCapturedAt || null,
      editedAt: meta.editedAt || null,
      previousPosition: meta.previousPosition || null,
      gps: meta.gps || null,
    };
  });
}

function geoJsonToMap(data) {
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error(tr('invalidGeoJson'));
  }
  const map = makeMap(data.name || data.properties?.name || tr('geoJsonImport'));
  map.name = `${map.name} ${tr('importSuffix')}`;
  for (const feature of data.features) {
    const role = String(feature?.properties?.role || '').toLowerCase();
    const points = pointsFromGeoGeometry(feature.geometry, feature?.properties?.samples || []);
    if (role === 'perimeter') {
      map.perimeter = points;
    } else if (role === 'exclusion') {
      map.exclusions.push({
        id: newId(),
        name: feature.properties?.name || tr('exclusionN', { n: map.exclusions.length + 1 }),
        points,
      });
    } else if (role === 'dock' || role === 'dockpoints' || role === 'dockpath') {
      map.dockPoints = points;
    }
  }
  if (!map.perimeter.length && !map.exclusions.length && !map.dockPoints.length) {
    throw new Error(tr('noGeoFeatures'));
  }
  return map;
}

async function importMapFile(file) {
  stopAutoCapture();
  if (state.maps.length >= MAX_MAPS) throw new Error(tr('mapLimitReached'));
  const text = await file.text();
  const data = JSON.parse(text);
  const map = data?.type === 'FeatureCollection' ? geoJsonToMap(data) : validateImportedMap(data);
  await dbRequest('readwrite', (store) => store.put(map));
  state.maps.push(map);
  state.maps.sort((a, b) => a.name.localeCompare(b.name, state.language === 'en' ? 'en' : 'de'));
  state.activeMap = map;
  state.activeExclusionId = map.exclusions[0]?.id || null;
  state.selectedPoint = null;
  renderMapControls();
  await saveActiveMap();
  renderMap();
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
  if (map.perimeter.length<3) issues.push({severity:'error',key:'checkPerimeterTooFew',vars:{}});
  else if (polygonSelfIntersects(map.perimeter)) issues.push({severity:'error',key:'checkSelfIntersection',vars:{label:tr('perimeter')}});
  if (map.perimeter.length >= 3 && !map.perimeterClosed) issues.push({severity:'warning',key:'checkPerimeterOpen',vars:{}});
  const perimeterSpacing=pathSpacingIssues(map.perimeter,true);
  if(perimeterSpacing.close)issues.push({severity:'warning',key:'checkClosePoints',vars:{label:tr('perimeter'),count:perimeterSpacing.close}});
  if(perimeterSpacing.long)issues.push({severity:'warning',key:'checkLongSegments',vars:{label:tr('perimeter'),count:perimeterSpacing.long}});
  map.exclusions.forEach((ex,index)=>{
    const label=localizedExclusionName(ex,index);
    if(ex.points.length>0 && ex.points.length<3)issues.push({severity:'error',key:'checkAreaTooFew',vars:{label}});
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

function refreshHistoryUndoState() {
  if(!ui.historyUndoBtn||!state.activeMap)return;
  normalizeMap(state.activeMap);
  const entry=[...state.activeMap.history].reverse().find((h)=>h.beforeChange);
  ui.historyUndoBtn.disabled=!entry || Boolean(state.activeMap?.locked);
  ui.historyUndoHint.textContent=entry ? tr('undoChangeHint',{reason:historyReason(entry),time:new Date(entry.createdAt).toLocaleTimeString(localeCode(),{hour:'2-digit',minute:'2-digit'})}) : tr('noChangeToUndo');
}

function renderHistory() {
  if(!ui.historyList)return;
  ui.historyList.innerHTML='';
  if(!state.activeMap){ui.historyList.textContent=tr('noVersions');return;}
  normalizeMap(state.activeMap);
  const entries=[...state.activeMap.history].reverse().slice(0,20);
  if(!entries.length){ui.historyList.textContent=tr('noVersions');return;}
  entries.forEach((entry)=>{
    const row=document.createElement('div');row.className='history-entry';
    const meta=document.createElement('div');meta.innerHTML=`<strong>${historyReason(entry)}</strong><small>${new Date(entry.createdAt).toLocaleString(localeCode(),{dateStyle:'short',timeStyle:'short'})}</small>`;
    const button=document.createElement('button');button.type='button';button.className='ghost compact-btn';button.textContent=tr('restoreVersion');button.dataset.restoreHistoryId=entry.id;button.disabled=Boolean(state.activeMap?.locked);
    row.append(meta,button);ui.historyList.appendChild(row);
  });
}

async function saveManualVersion() {
  if(!state.activeMap)return; checkpointMap('manual',{beforeChange:false}); await saveActiveMap(); renderHistory(); refreshHistoryUndoState(); ui.pointStatus.textContent=tr('versionSaved');
}

async function restoreHistoryEntry(id) {
  if(!state.activeMap || !ensureMapEditable())return; normalizeMap(state.activeMap); const entry=state.activeMap.history.find((h)=>h.id===id); if(!entry)return;
  const time=new Date(entry.createdAt).toLocaleString(localeCode(),{dateStyle:'short',timeStyle:'short'});
  const confirmed = await askConfirm({
    title: tr('restoreVersion'),
    message: tr('restoreConfirm', { time }),
    confirmLabel: tr('restoreVersion'),
  });
  if (!confirmed) return;
  checkpointMap('restore',{beforeChange:true}); applyGeometrySnapshot(entry.snapshot); await saveActiveMap(); state.validationResult=null; renderMapControls(); renderMap(); ui.pointStatus.textContent=tr('restoredVersion',{time});
}

async function undoLastHistoryChange() {
  if(!state.activeMap || !ensureMapEditable())return; normalizeMap(state.activeMap); let index=-1; for(let i=state.activeMap.history.length-1;i>=0;i-=1){if(state.activeMap.history[i].beforeChange){index=i;break;}}
  if(index<0)return; const entry=state.activeMap.history[index]; applyGeometrySnapshot(entry.snapshot); state.activeMap.history.splice(index,1); await saveActiveMap(); state.validationResult=null; renderMapControls(); renderMap();
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
  renderHistory();
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
  state.mode = mode;
  if (!preserveSelection) { state.selectedPoint = null; state.selectedArea = null; }
  ui.modeChipLabel.textContent = modeLabel(mode);
  ui.modeCycleBtn.dataset.mode = mode;
  ui.exclusionControls.classList.toggle('hidden', mode !== 'exclusion');
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

async function closeContour(entry) {
  if (entry.role === 'perimeter') { await closePerimeter(); return; }
  const exclusion = state.activeMap?.exclusions.find((e) => e.id === entry.id);
  if (!exclusion) return;
  checkpointMap('closeContour');
  exclusion.closed = true;
  state.validationResult = null;
  await saveActiveMap();
  renderMap();
}

async function offerToCloseContour(role) {
  if (!state.activeMap || state.activeMap.locked) return;
  const entry = openContours().find((c) => c.role === role
    && (role !== 'exclusion' || c.id === state.activeExclusionId));
  if (!entry) return;
  const confirmed = await askConfirm({
    title: tr('closeContourTitle'),
    message: tr('closeContourQuestion', { label: entry.label }),
    confirmLabel: tr('closeNow'),
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
    confirmLabel: tr('closeNow'),
  });
  if (!confirmed) return;
  for (const entry of open) await closeContour(entry);
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
  if (ref.role === 'exclusion' && ref.exclusionId) { state.activeExclusionId = ref.exclusionId; renderExclusionControls(); }
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
  if (nearest && nearestDistance <= state.hitRadiusUnits) {
    applyPointSelection({ role: nearest.role, index: nearest.index, exclusionId: nearest.exclusionId });
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
    renderExclusionControls();
    ui.pointStatus.textContent = tr('areaSelected', { name: localizedExclusionName(area, state.activeMap.exclusions.indexOf(area)) });
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
  ui.addPointBtn.addEventListener('pointerdown', beginCaptureHold);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((name) => ui.addPointBtn.addEventListener(name, cancelCaptureHold));
  ui.addPointBtn.addEventListener('click', captureButtonTap);

  // Fahren
  ui.driveJoystick.addEventListener('pointerdown', beginJoystick);
  ui.driveJoystick.addEventListener('pointermove', (event) => updateJoystickFromPointer(event));
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => ui.driveJoystick.addEventListener(name, (event) => {
    if (state.joystickPointerId === null || event.pointerId === state.joystickPointerId) stopDrive();
  }));
  [ui.driveSpeedMinInput, ui.driveSpeedMaxInput, ui.driveTurnMaxInput].forEach((input) => input.addEventListener('change', () => {
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
  ui.requestVersionBtn.addEventListener('click', () => sendSunray('AT+V', { forcePlain: true }).catch((e) => reportBleError('AT+V', e, { immediate: true })));
  ui.requestStateBtn.addEventListener('click', () => sendSunray('AT+S').catch((e) => reportBleError('AT+S', e, { immediate: true })));
  ui.clearLogBtn.addEventListener('click', () => { ui.debugLog.textContent = ''; });

  // Karten
  ui.newMapBtn.addEventListener('click', () => createMapFromInput().catch(reportError));
  ui.newMapName.addEventListener('keydown', (e) => { if (e.key === 'Enter') createMapFromInput().catch(reportError); });
  ui.deleteMapBtn.addEventListener('click', () => deleteActiveMap().catch(reportError));
  ui.mapSelect.addEventListener('change', () => setActiveMapById(ui.mapSelect.value));
  ui.mapGallery.addEventListener('click', (event) => {
    const lock = event.target.closest('[data-map-lock-id]');
    if (lock) { toggleMapLockById(lock.dataset.mapLockId).catch(reportError); return; }
    const select = event.target.closest('[data-map-card-id]');
    if (select) setActiveMapById(select.dataset.mapCardId);
  });
  ui.lockMapBtn.addEventListener('click', () => state.activeMap && toggleMapLockById(state.activeMap.id).catch(reportError));
  ui.exportJsonBtn.addEventListener('click', exportCurrentMapJson);
  ui.exportGeoJsonBtn.addEventListener('click', exportCurrentMapGeoJson);
  ui.importInput.addEventListener('change', () => {
    const file = ui.importInput.files?.[0];
    if (file) importMapFile(file).catch((e) => showNotice({ title: tr('errorTitle'), message: tr('importFailed', { message: e.message }), tone: 'danger' }));
    ui.importInput.value = '';
  });
  ui.saveVersionBtn.addEventListener('click', () => saveManualVersion().catch(reportError));
  ui.historyList.addEventListener('click', (event) => { const button = event.target.closest('[data-restore-history-id]'); if (button) restoreHistoryEntry(button.dataset.restoreHistoryId).catch(reportError); });
  ui.historyUndoBtn.addEventListener('click', () => undoLastHistoryChange().catch(reportError));
  ui.validateMapBtn.addEventListener('click', validateActiveMap);

  // Aufnahme-Einstellungen
  ui.fixOnly.addEventListener('change', refreshCaptureState);
  ui.autoCaptureIntervalInput.addEventListener('change', () => { updateViewPreferencesFromUi(); applyViewPreferencesToUi(); refreshCaptureState(); });
  ui.exclusionSelect.addEventListener('change', () => { state.activeExclusionId = ui.exclusionSelect.value || null; state.selectedPoint = null; renderMap(); refreshCaptureState(); });
  ui.newExclusionBtn.addEventListener('click', () => createExclusion().catch(reportError));
  ui.deleteExclusionBtn.addEventListener('click', () => deleteExclusion().catch(reportError));
  ui.clearModeBtn.addEventListener('click', () => clearCurrentElement().catch(reportError));

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
  window.addEventListener('resize', () => renderMap());
}

async function init() {
  loadViewPreferences();
  applyViewPreferencesToUi();
  bindEvents();
  resetViewport({ render: false });
  state.db = await openDb();
  await loadMaps();
  setMode('perimeter');
  setConnectionStatus(false, 'notConnected', 'readyConnect');
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
      .then((registration) => { registration.update().catch(() => {}); return navigator.serviceWorker.ready; })
      .then(() => { state.offlineCacheReady = true; updateHelpSystemStatus(); })
      .catch((error) => { state.offlineCacheReady = false; updateHelpSystemStatus(); log('Service Worker', error.message); });
  } else {
    state.offlineCacheReady = false;
    updateHelpSystemStatus();
  }
  log(tr('appStarted'), APP_VERSION);
}

init().catch((error) => {
  console.error(error);
  ui.connectionDetail.textContent = tr('startError', { message: error.message });
});

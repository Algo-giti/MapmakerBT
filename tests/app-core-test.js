'use strict';
const assert = require('assert');
const { loadApp } = require('./app-harness.js');

const { t } = loadApp({
  exportNames: ['state', 'makeMap', 'normalizeMap', 'polygonSelfIntersects', 'pointInPolygon',
    'polygonEdgesIntersect', 'polygonsIntersect', 'polygonArea', 'pathLength', 'geometryForArea', 'mapToGeoJson', 'geoJsonToMap', 'normalizeOrigin', 'mapOriginInUse',
    'mapToCassandraGeoJson', 'cassandraExportBlockKey', 'cassandraSkippedAreas', 'hasUsablePolygon',
    'closePerimeter',
    'validateActiveMap'],
});

const square = [{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}];
const bowtie = [{x:0,y:0},{x:4,y:4},{x:0,y:4},{x:4,y:0}];
assert.strictEqual(t.polygonSelfIntersects(square), false);
assert.strictEqual(t.polygonSelfIntersects(bowtie), true);
assert.strictEqual(t.pointInPolygon({x:2,y:2}, square), true);
assert.strictEqual(t.pointInPolygon({x:5,y:2}, square), false);
assert.strictEqual(t.polygonArea(square), 16);
assert.strictEqual(t.pathLength(square, true), 16);

const inside = [{x:1,y:1},{x:2,y:1},{x:2,y:2},{x:1,y:2}];
const outside = [{x:5,y:5},{x:6,y:5},{x:6,y:6},{x:5,y:6}];
assert.strictEqual(t.polygonEdgesIntersect(inside, square), false);
assert.strictEqual(t.polygonsIntersect(inside, square), true);
assert.strictEqual(t.polygonsIntersect(outside, square), false);

const map = t.makeMap('Test');
map.perimeter = square.map((p)=>({...p, gps:{solution:2}}));
map.exclusions.push({id:'ex1',name:'Exclusion 1',points:inside.map((p)=>({...p,gps:{solution:2}}))});
assert.strictEqual(map.version, 2);
const geo = t.mapToGeoJson(map);
assert.strictEqual(geo.type, 'FeatureCollection');
assert.strictEqual(geo.features[0].geometry.type, 'Polygon');

t.state.activeMap = map;
t.validateActiveMap();
assert.strictEqual(t.state.validationResult.area, 15); // 16 m² perimeter minus 1 m² exclusion
assert.strictEqual(t.state.validationResult.issues.some((i)=>i.key==='checkExclusionOutside'), false);

const legacy = t.normalizeMap({id:'old',name:'Old',perimeter:[],exclusions:[],dockPoints:[],version:1});
assert.strictEqual(legacy.version, 2);
// Die Versionsverwaltung ist entfernt: neue Karten fuehren kein history-Feld mehr.
assert.strictEqual(map.history, undefined);
assert.strictEqual(legacy.history, undefined);

// Wegpunkte gehoeren seit dem UI-Umbau zum Kartenmodell.
assert.strictEqual(map.waypoints.length, 0);
assert.strictEqual(legacy.waypoints.length, 0);
map.waypoints.push({x:1,y:1},{x:2,y:2});
const geoWithWaypoints = t.mapToGeoJson(map);
assert.ok(geoWithWaypoints.features.some((f)=>f.properties.role==='waypoints' && f.geometry.type==='LineString'));

// --- GeoJSON-Export: Struktur je Typ ---------------------------------------
// Abgleich mit der CaSSAndRA-Konvention (siehe CLAUDE.md, Abschnitt „GeoJSON-Abgleich“):
// Perimeter und Ausschluss sind geschlossene Polygone, der Dockpfad ein OFFENER LineString.
// Der Schluesselname (`role` vs. CaSSAndRAs `name`) und die Koordinaten (lokale Meter vs.
// absolute lon/lat) sind bewusst noch nicht angeglichen — offene Entscheidung des Nutzers.
{
  const m = t.makeMap('Export');
  m.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  m.exclusions.push({ id:'ex1', name:'Ausschluss 1', closed:true, points:[{x:2,y:2},{x:3,y:2},{x:3,y:3}] });
  m.dockPoints = [{x:0,y:0},{x:1,y:0},{x:2,y:0}];
  m.waypoints = [{x:5,y:5},{x:6,y:6}];
  const g = t.mapToGeoJson(m);
  const byRole = (role) => g.features.find((f) => f.properties.role === role);
  // Arrays aus dem vm-Sandkasten sind nie reference-equal zum Testrealm — als String vergleichen.
  const pair = (c) => `${c[0]},${c[1]}`;
  const pairs = (list) => list.map(pair).join(' | ');

  // Perimeter: Polygon mit geschlossenem Ring — der erste Punkt steht am Ende noch einmal.
  const per = byRole('perimeter');
  assert.strictEqual(per.geometry.type, 'Polygon');
  const ring = per.geometry.coordinates[0];
  assert.strictEqual(ring.length, m.perimeter.length + 1, 'der Ring traegt den Startpunkt doppelt');
  assert.strictEqual(pair(ring[0]), pair(ring[ring.length - 1]), 'Ring ist geschlossen');

  // Ausschluss: ebenso.
  const exc = byRole('exclusion');
  assert.strictEqual(exc.geometry.type, 'Polygon');
  const excRing = exc.geometry.coordinates[0];
  assert.strictEqual(excRing.length, 4);
  assert.strictEqual(pair(excRing[0]), pair(excRing[excRing.length - 1]));

  // Dockpfad: OFFENER LineString. Weder geschlossen noch verlaengert — CaSSAndRA haengt beim
  // Speichern 20 cm in Fahrtrichtung an, das wollen wir ausdruecklich nicht.
  const dock = byRole('dock');
  assert.strictEqual(dock.geometry.type, 'LineString');
  assert.strictEqual(dock.geometry.coordinates.length, m.dockPoints.length, 'kein Punkt kommt dazu');
  assert.notStrictEqual(pair(dock.geometry.coordinates[0]),
    pair(dock.geometry.coordinates[dock.geometry.coordinates.length - 1]), 'nicht geschlossen');
  assert.strictEqual(pairs(dock.geometry.coordinates), '0,0 | 1,0 | 2,0',
    'der Dockpfad kommt Punkt fuer Punkt unveraendert heraus, keine Verlaengerung');

  // Wegpunkte sind ein eigenes Konzept ohne CaSSAndRA-Entsprechung: offener LineString.
  const way = byRole('waypoints');
  assert.strictEqual(way.geometry.type, 'LineString');
  assert.strictEqual(way.geometry.coordinates.length, 2);

  // Koordinatenreihenfolge: [x, y] — x (Ost) zuerst, wie GeoJSON es fuer [lon, lat] vorsieht.
  // Die Werte sind allerdings lokale Sunray-Meter, keine Grad; das ist als Abweichung notiert.
  assert.strictEqual(pair(ring[1]), '10,0', 'x steht vorn');
  assert.strictEqual(per.properties.coordinateSystem, 'sunray-local-xy-meters');
  assert.strictEqual(g.properties.coordinateSystem, 'sunray-local-xy-meters');
}

// --- GeoJSON-Rundlauf: Export → Import verliert und erfindet nichts ---------
{
  const m = t.makeMap('Rundlauf');
  m.perimeter = [{x:0,y:0},{x:4,y:0},{x:4,y:4}];
  m.dockPoints = [{x:1,y:1},{x:2,y:1}];
  const back = t.geoJsonToMap(t.mapToGeoJson(m));
  assert.strictEqual(back.perimeter.length, 3, 'der doppelte Ringpunkt wird beim Import entfernt');
  assert.strictEqual(back.perimeter.map((p)=>`${p.x},${p.y}`).join(' | '), '0,0 | 4,0 | 4,4');
  assert.strictEqual(back.dockPoints.length, 2, 'der Dockpfad bleibt unveraendert lang');
  assert.strictEqual(back.dockPoints.map((p)=>`${p.x},${p.y}`).join(' | '), '1,1 | 2,1');
}

// --- Zu wenige Punkte fuer ein Polygon -------------------------------------
{
  const m = t.makeMap('Kurz');
  m.perimeter = [{x:0,y:0},{x:1,y:1}];
  const g = t.mapToGeoJson(m);
  const per = g.features.find((f) => f.properties.role === 'perimeter');
  assert.strictEqual(per.geometry.type, 'LineString', 'zwei Punkte ergeben kein Polygon');
  assert.strictEqual(per.properties.completePolygon, false);
}

// --- CaSSAndRA-Vokabular in properties.name --------------------------------
// `name` traegt ab jetzt ausschliesslich den Typ in CaSSAndRAs Schreibweise, der uebersetzte
// Anzeigename ist nach `label` gezogen. `role` bleibt unser internes Merkmal.
{
  const m = t.makeMap('Vokabular');
  m.perimeter = [{x:0,y:0},{x:1,y:0},{x:1,y:1}];
  m.exclusions.push({ id:'ex1', name:'Apfelbaum', closed:true, points:[{x:2,y:2},{x:3,y:2},{x:3,y:3}] });
  m.waypoints = [{x:5,y:5},{x:6,y:6}];
  m.dockPoints = [{x:0,y:0},{x:1,y:0}];
  const g = t.mapToGeoJson(m);
  const byRole = (role) => g.features.find((f) => f.properties.role === role);

  assert.strictEqual(byRole('perimeter').properties.name, 'perimeter');
  assert.strictEqual(byRole('exclusion').properties.name, 'exclusion');
  assert.strictEqual(byRole('waypoints').properties.name, 'search wire', 'mit Leerzeichen');
  assert.strictEqual(byRole('dock').properties.name, 'dockpoints', 'nicht dockPath, das ist das API-Vokabular');

  // Der Anzeigename lebt jetzt in label — uebersetzt, wie vorher in name.
  assert.strictEqual(byRole('perimeter').properties.label, 'Perimeter');
  assert.strictEqual(byRole('waypoints').properties.label, 'Wegpunkte');
  assert.strictEqual(byRole('dock').properties.label, 'Dockpfad');
  assert.strictEqual(byRole('exclusion').properties.label, 'Apfelbaum', 'eigener Flaechenname bleibt');

  // In name darf kein Anzeigename mehr stehen.
  for (const f of g.features) {
    assert.ok(!/Wegpunkte|Dockpfad|Apfelbaum/.test(f.properties.name),
      `properties.name traegt noch einen Anzeigenamen: ${f.properties.name}`);
  }
}

// --- Import erkennt beide Vokabulare ---------------------------------------
{
  // Reine CaSSAndRA-Bezeichner, ganz ohne unser `role`.
  const foreign = {
    type: 'FeatureCollection',
    features: [
      { type:'Feature', properties:{ name:'perimeter' },
        geometry:{ type:'Polygon', coordinates:[[[0,0],[4,0],[4,4],[0,0]]] } },
      { type:'Feature', properties:{ name:'exclusion' },
        geometry:{ type:'Polygon', coordinates:[[[1,1],[2,1],[2,2],[1,1]]] } },
      { type:'Feature', properties:{ name:'dockpoints' },
        geometry:{ type:'LineString', coordinates:[[0,0],[1,0]] } },
      { type:'Feature', properties:{ name:'search wire' },
        geometry:{ type:'LineString', coordinates:[[5,5],[6,6]] } },
    ],
  };
  const imported = t.geoJsonToMap(foreign);
  assert.strictEqual(imported.perimeter.length, 3, 'Perimeter erkannt');
  assert.strictEqual(imported.exclusions.length, 1, 'Ausschluss erkannt');
  assert.strictEqual(imported.dockPoints.length, 2, 'dockpoints erkannt');
  assert.strictEqual(imported.waypoints.length, 2, '„search wire“ erkannt');
  // Der Typbezeichner ist kein Anzeigename: die Flaeche darf nicht „exclusion“ heissen.
  assert.strictEqual(imported.exclusions[0].name, 'Ausschluss 1');

  // Aeltere Dateien dieser App trugen den Anzeigenamen noch in `name` — der bleibt erhalten.
  const legacyFile = {
    type: 'FeatureCollection',
    features: [{ type:'Feature', properties:{ role:'exclusion', name:'Birnbaum' },
      geometry:{ type:'Polygon', coordinates:[[[1,1],[2,1],[2,2],[1,1]]] } }],
  };
  assert.strictEqual(t.geoJsonToMap(legacyFile).exclusions[0].name, 'Birnbaum');

  // Weder role noch bekannter Name: unverstaendliches Format.
  assert.throws(() => t.geoJsonToMap({ type:'FeatureCollection', features:[
    { type:'Feature', properties:{ name:'irgendwas' }, geometry:{ type:'LineString', coordinates:[[0,0],[1,1]] } },
  ] }), /erkennbaren Features/);
}

// --- Rundlauf mit allen vier Typen -----------------------------------------
{
  const m = t.makeMap('Rundlauf 2');
  m.perimeter = [{x:0,y:0},{x:4,y:0},{x:4,y:4}];
  m.exclusions.push({ id:'ex1', name:'Apfelbaum', closed:true, points:[{x:1,y:1},{x:2,y:1},{x:2,y:2}] });
  m.waypoints = [{x:7,y:7},{x:8,y:8}];
  m.dockPoints = [{x:1,y:1},{x:2,y:1}];
  const back = t.geoJsonToMap(t.mapToGeoJson(m));
  assert.strictEqual(back.perimeter.length, 3);
  assert.strictEqual(back.exclusions.length, 1);
  assert.strictEqual(back.exclusions[0].name, 'Apfelbaum', 'der Anzeigename ueberlebt den Rundlauf');
  assert.strictEqual(back.dockPoints.length, 2);
  assert.strictEqual(back.waypoints.length, 2, 'Wegpunkte gehen beim Rundlauf nicht mehr verloren');
  assert.strictEqual(back.waypoints.map((p)=>`${p.x},${p.y}`).join(' | '), '7,7 | 8,8');
}

// --- Positionsmodus: Relativ (Standard) ------------------------------------
{
  const m = t.makeMap('Relativ');
  assert.strictEqual(m.positionMode, 'relative', 'Standard bleibt relativ');
  assert.strictEqual(m.origin, null);
  m.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  const g = t.mapToGeoJson(m);
  assert.strictEqual(g.properties.coordinateSystem, 'sunray-local-xy-meters');
  assert.strictEqual(g.properties.units, 'm');
  assert.strictEqual(g.properties.origin, null);
  const ring = g.features[0].geometry.coordinates[0];
  assert.strictEqual(`${ring[1][0]},${ring[1][1]}`, '10,0', 'unveraendert lokale Meter');

  // Bestandskarten ohne die neuen Felder bleiben relativ.
  const legacy2 = t.normalizeMap({ id:'x', name:'Alt', perimeter:[], exclusions:[], dockPoints:[] });
  assert.strictEqual(legacy2.positionMode, 'relative');
  assert.strictEqual(legacy2.origin, null);
}

// --- Positionsmodus: Absolut -----------------------------------------------
{
  const origin = { lat: 48.5, lon: 9.25 };
  const m = t.makeMap('Absolut');
  m.positionMode = 'absolute';
  m.origin = origin;
  m.perimeter = [{x:0,y:0},{x:100,y:0},{x:100,y:100}];
  m.dockPoints = [{x:0,y:0},{x:5,y:0}];
  const g = t.mapToGeoJson(m);

  assert.strictEqual(g.properties.coordinateSystem, 'wgs84-degrees');
  assert.strictEqual(g.properties.units, 'deg');
  assert.strictEqual(g.properties.origin.lat, 48.5, 'der Ursprung reist mit der Datei');
  assert.strictEqual(g.properties.origin.lon, 9.25);

  const ring = g.features.find((f)=>f.properties.role==='perimeter').geometry.coordinates[0];
  // Der Nullpunkt ist genau der Ursprung, Reihenfolge [lon, lat].
  assert.strictEqual(ring[0][0], 9.25);
  assert.strictEqual(ring[0][1], 48.5);
  // 100 m nach Norden: 100/111111 Grad Breite dazu, Laenge unveraendert.
  assert.ok(Math.abs(ring[2][1] - (48.5 + 100/111111)) < 1e-7, 'Breite aus Y');
  // 100 m nach Osten: durch cos(lat) geteilt, also mehr Grad als in Nord-Richtung.
  const lonStep = ring[1][0] - 9.25;
  assert.ok(lonStep > 100/111111, 'Laengengrade sind auf 48,5° kuerzer, brauchen also mehr Grad');
  assert.ok(Math.abs(lonStep - 100/(111111*Math.cos(48.5*Math.PI/180))) < 1e-7, 'Laenge aus X');
  // Der Ringschluss und der offene Dockpfad bleiben davon unberuehrt.
  assert.strictEqual(`${ring[0][0]},${ring[0][1]}`, `${ring[3][0]},${ring[3][1]}`);
  assert.strictEqual(g.features.find((f)=>f.properties.role==='dock').geometry.coordinates.length, 2);

  // Die CaSSAndRA-Bezeichner gelten in beiden Modi unveraendert.
  assert.strictEqual(g.features.find((f)=>f.properties.role==='dock').properties.name, 'dockpoints');
  assert.strictEqual(g.features.find((f)=>f.properties.role==='perimeter').properties.label, 'Perimeter');

  // Rundlauf: die Grad kommen als dieselben Meter zurueck (Rundung auf 1e-7 Grad ≈ 1 cm).
  const back = t.geoJsonToMap(g);
  assert.strictEqual(back.positionMode, 'absolute', 'der Modus kommt aus der Datei mit');
  assert.strictEqual(back.origin.lat, 48.5);
  const dx = back.perimeter.map((p, i) => Math.abs(p.x - m.perimeter[i].x));
  const dy = back.perimeter.map((p, i) => Math.abs(p.y - m.perimeter[i].y));
  assert.ok(Math.max(...dx, ...dy) < 0.02, `Rundlauf auf 2 cm genau, groesste Abweichung ${Math.max(...dx, ...dy)}`);
}

// --- Ungueltiger oder fehlender Ursprung -----------------------------------
{
  assert.strictEqual(t.normalizeOrigin({ lat: 91, lon: 0 }), null, 'Breite ausserhalb -90..90');
  assert.strictEqual(t.normalizeOrigin({ lat: 0, lon: 181 }), null, 'Laenge ausserhalb -180..180');
  assert.strictEqual(t.normalizeOrigin({ lat: 'abc', lon: 5 }), null);
  assert.strictEqual(t.normalizeOrigin(null), null);
  assert.strictEqual(t.normalizeOrigin({ lat: -89.9, lon: -179.9 }).lat, -89.9, 'Randwerte sind gueltig');

  // Umgekehrt: ein hinterlegter Ursprung allein genuegt nicht. Steht der Modus auf relativ,
  // bleibt der Export bei Metern — sonst wuerde ein einmal eingetragener Ursprung fuer immer
  // umrechnen, auch nach dem Zurueckschalten.
  const stale = t.makeMap('Ursprung ohne Modus');
  stale.origin = { lat: 48.5, lon: 9.25 };
  stale.positionMode = 'relative';
  assert.strictEqual(t.mapOriginInUse(stale), null, 'ohne Modus „absolut“ wird nicht umgerechnet');
  stale.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  const staleGeo = t.mapToGeoJson(stale);
  assert.strictEqual(staleGeo.properties.coordinateSystem, 'sunray-local-xy-meters');
  assert.strictEqual(staleGeo.features[0].geometry.coordinates[0][1][0], 10, 'weiterhin Meter');

  // Modus „absolut“ ohne gueltigen Ursprung darf keine Grad erzeugen — lieber weiter Meter.
  const m = t.makeMap('Ohne Ursprung');
  m.positionMode = 'absolute';
  m.origin = { lat: 999, lon: 0 };
  assert.strictEqual(t.mapOriginInUse(m), null);
  m.perimeter = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  const g = t.mapToGeoJson(m);
  assert.strictEqual(g.properties.coordinateSystem, 'sunray-local-xy-meters', 'faellt auf Meter zurueck');
  assert.strictEqual(g.features[0].geometry.coordinates[0][1][0], 10, 'weiterhin Meter');

  // Eine Datei, die Grad ankuendigt, aber keinen Ursprung mitbringt, wird abgelehnt.
  assert.throws(() => t.geoJsonToMap({
    type: 'FeatureCollection',
    properties: { coordinateSystem: 'wgs84-degrees' },
    features: [{ type:'Feature', properties:{ role:'perimeter' },
      geometry:{ type:'Polygon', coordinates:[[[9,48],[9.001,48],[9.001,48.001],[9,48]]] } }],
  }), /Ursprungsposition/);
}

// --- Umschalten wirkt nicht rueckwirkend -----------------------------------
{
  const m = t.makeMap('Umschalten');
  m.perimeter = [{x:3,y:4},{x:5,y:6},{x:7,y:8}];
  const before = m.perimeter.map((p)=>`${p.x},${p.y}`).join(' | ');
  m.positionMode = 'absolute';
  m.origin = { lat: 50, lon: 8 };
  t.mapToGeoJson(m);
  assert.strictEqual(m.perimeter.map((p)=>`${p.x},${p.y}`).join(' | '), before,
    'die gespeicherten Punkte bleiben lokale Meter, der Export rechnet nur ab');
  m.positionMode = 'relative';
  assert.strictEqual(m.perimeter.map((p)=>`${p.x},${p.y}`).join(' | '), before,
    'auch das Zurueckschalten laesst die Karte unangetastet');
}

// --- CaSSAndRA-Exportformat: Struktur und Rundlauf --------------------------
// Vorbild ist CaSSAndRAs eigener Export (`export_geojson`, mapdata.py:665-690). Geprueft wird
// die WIRKUNG: was CaSSAndRAs Import aus der Datei herausholt, nicht was wir hineinschreiben
// wollten.
//
// EINSCHRAENKUNG, bewusst benannt: CaSSAndRAs Import ist Python und braucht pandas und shapely;
// die Testform dieses Repos sind reine Node-Skripte ohne Abhaengigkeiten. Der Rundlauf laeuft
// deshalb gegen eine ZEILENGETREUE PORTIERUNG von `coords_abs_to_rel` (mapdata.py:704-710) und
// gegen das gemessene Verhalten von shapely (ein geschlossener Ring kommt unveraendert wieder
// heraus, es entsteht kein doppelter Punkt). Das Original wurde einmalig ausserhalb des Repos
// dagegen gerechnet; ein Aufruf des echten Imports ist hier nicht moeglich.
{
  // mapdata.py:705-706, Zeile fuer Zeile. `math.cos` rechnet im Bogenmass, `rovercfg.lat` steht
  // in Grad — deshalb die Umrechnung, und deshalb ausdruecklich die Breite des BEZUGSPUNKTS,
  // nicht die des jeweiligen Punktes.
  const coordsAbsToRel = (lon, lat, ref) => ({
    x: (lon - ref.lon) * (111111 * Math.cos((ref.lat * Math.PI) / 180)),
    y: (lat - ref.lat) * 111111,
  });
  const reference = { lat: 52.26742967, lon: 8.60921633 };

  const m = t.makeMap('CaSSAndRA');
  m.perimeter = [{x:0,y:0},{x:12.5,y:0},{x:12.5,y:8.25},{x:6.125,y:11.4},{x:0,y:8.25}];
  m.exclusions.push({ id:'ex1', name:'Ausschluss 1', closed:true,
    points:[{x:3,y:3},{x:4.5,y:3},{x:4.5,y:4.5},{x:3,y:4.5}] });
  // Eine Flaeche unter drei Punkten darf nicht mit hinaus: `Polygon(coordinates[0])`
  // (mapdata.py:515) wirft dann und reisst den ganzen Import mit.
  m.exclusions.push({ id:'ex2', name:'Ausschluss 2', closed:false, points:[{x:9,y:1},{x:9.5,y:1}] });
  m.dockPoints = [{x:0,y:0},{x:-1.5,y:-2}];
  m.waypoints = [{x:2,y:2},{x:5,y:5},{x:8,y:2}];

  const doc = t.mapToCassandraGeoJson(m, reference);

  // Genau zwei Schluessel oben — ein dritter mit einem Objekt als Wert laesst `pd.read_json`
  // (mapdata.py:463) scheitern, und der GeoJSON-Zweig wird dann nie erreicht.
  // Arrays aus dem vm-Sandkasten haben ein fremdes Prototyp — deshalb ueber Zeichenketten
  // vergleichen statt ueber deepStrictEqual.
  assert.strictEqual(Object.keys(doc).sort().join('|'), 'features|type');
  assert.strictEqual(doc.type, 'FeatureCollection');

  // Reihenfolge und Bezeichner woertlich nach mapdata.py:674, :678, :682, :686.
  assert.strictEqual(doc.features.map((f) => f.properties.name).join('|'),
    'perimeter|dockpoints|search wire|exclusion|mapmaker');
  assert.strictEqual(doc.features.map((f) => (f.geometry ? f.geometry.type : 'null')).join('|'),
    'Polygon|LineString|LineString|Polygon|null');

  // `properties` traegt beim Kartenteil nur den Namen; `idx` steht auf FEATURE-Ebene (:688).
  doc.features.slice(0, 4).forEach((f) => assert.strictEqual(Object.keys(f.properties).join('|'), 'name'));
  assert.strictEqual(doc.features[3].idx, 0);
  assert.strictEqual('idx' in doc.features[0], false);

  // Dockpfad und Suchdraht werden auch leer geschrieben — das Vorbild legt sie unbedingt an.
  const empty = t.mapToCassandraGeoJson(t.makeMap('Leer'), reference);
  assert.strictEqual(empty.features.map((f) => f.properties.name).join('|'),
    'perimeter|dockpoints|search wire|mapmaker');
  assert.strictEqual(empty.features[1].geometry.coordinates.length, 0);
  assert.strictEqual(empty.features[2].geometry.coordinates.length, 0);

  // Ohne Bezugspunkt entsteht keine Datei.
  assert.strictEqual(t.mapToCassandraGeoJson(m, null), null);
  assert.strictEqual(t.mapToCassandraGeoJson(m, { lat: 95, lon: 8 }), null);

  // Ringe sind geschlossen (mapdata.py:614-630 haengt den ersten Punkt an), offene Pfade nicht.
  const ring = doc.features[0].geometry.coordinates[0];
  assert.strictEqual(ring.length, m.perimeter.length + 1);
  assert.strictEqual(ring[0].join(','), ring[ring.length - 1].join(','));
  assert.strictEqual(doc.features[2].geometry.coordinates.length, m.waypoints.length);

  // Sieben Nachkommastellen: gerechnet, nicht geraten — bei 1e-7 Grad Schrittweite liegt der
  // Rundungsfehler bei hoechstens 0,5e-7 Grad, also rund 5,6 mm je Achse.
  doc.features.slice(0, 4).forEach((f) => {
    const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates;
    coords.forEach(([lon, lat]) => {
      [lon, lat].forEach((value) => {
        const decimals = (String(value).split('.')[1] || '').length;
        assert.ok(decimals <= 7, `zu viele Nachkommastellen: ${value}`);
      });
    });
  });

  // Rundlauf: was CaSSAndRA aus der Datei herausrechnet, gegen unsere Ausgangswerte.
  const worst = (points, coords) => points.reduce((max, point, index) => {
    const back = coordsAbsToRel(coords[index][0], coords[index][1], reference);
    return Math.max(max, Math.hypot(back.x - point.x, back.y - point.y));
  }, 0);

  const perimeterMm = worst(m.perimeter, doc.features[0].geometry.coordinates[0]) * 1000;
  const exclusionMm = worst(m.exclusions[0].points, doc.features[3].geometry.coordinates[0]) * 1000;
  const dockMm = worst(m.dockPoints, doc.features[1].geometry.coordinates) * 1000;
  const wireMm = worst(m.waypoints, doc.features[2].geometry.coordinates) * 1000;
  const largestMm = Math.max(perimeterMm, exclusionMm, dockMm, wireMm);
  assert.ok(largestMm < 10, `Rundlauf ueber 1 cm: ${largestMm.toFixed(4)} mm`);
  // Die theoretische Obergrenze bei 7 Stellen liegt am Aequator bei 7,86 mm; naeher an der
  // Grenze duerfte kein Punkt liegen, sonst stimmt an der Umrechnung etwas nicht.
  assert.ok(largestMm < 7.9, `Rundlauf ueber der theoretischen Grenze: ${largestMm.toFixed(4)} mm`);

  // Punktzahl bleibt erhalten: der Schlusspunkt des Rings ist der erste, kein zusaetzlicher.
  assert.strictEqual(new Set(doc.features[0].geometry.coordinates[0].map(String)).size, m.perimeter.length);

  // Das Metadaten-Feature traegt `properties.name` — ohne das bricht CaSSAndRAs Import mit
  // KeyError, weil der Vergleich vor jeder Fallunterscheidung steht (mapdata.py:511).
  const meta = doc.features[4];
  assert.strictEqual(meta.properties.name, 'mapmaker');
  assert.strictEqual(meta.geometry, null);
  assert.strictEqual(`${meta.properties.origin.lat},${meta.properties.origin.lon}`,
    `${reference.lat},${reference.lon}`);
  assert.strictEqual(meta.properties.mapId, m.id);

  // Und die Datei ist fuer uns selbst wieder einlesbar — ueber genau dieses Feature.
  const back = t.geoJsonToMap(doc);
  assert.strictEqual(back.positionMode, 'absolute');
  assert.strictEqual(`${back.origin.lat},${back.origin.lon}`, `${reference.lat},${reference.lon}`);
  assert.strictEqual(back.perimeter.length, m.perimeter.length);
  assert.strictEqual(back.exclusions.length, 1);
  assert.strictEqual(back.waypoints.length, m.waypoints.length);
  assert.strictEqual(back.dockPoints.length, m.dockPoints.length);
  const reread = m.perimeter.reduce((max, point, index) =>
    Math.max(max, Math.hypot(back.perimeter[index].x - point.x, back.perimeter[index].y - point.y)), 0) * 1000;
  assert.ok(reread < 10, `eigener Rueckweg ueber 1 cm: ${reread.toFixed(4)} mm`);

  console.log(`  CaSSAndRA-Rundlauf: groesste Abweichung ${largestMm.toFixed(4)} mm ` +
    `(Perimeter ${perimeterMm.toFixed(4)}, Ausschluss ${exclusionMm.toFixed(4)}, ` +
    `Dock ${dockMm.toFixed(4)}, Suchdraht ${wireMm.toFixed(4)})`);
}

// --- Rueckwaertsbeleg: GeoJSON im ALTEN Format ------------------------------
// Pruefmuster, nicht erfunden: die Struktur stammt wortgleich aus einer Datei, die der Nutzer
// mit einer frueheren Fassung exportiert hat (Top-Level `type`/`name`/`properties`/`features`,
// `properties.coordinateSystem`, `properties.origin`, Feature-`properties` mit `role`, `label`
// und `samples`). Die Koordinaten sind die echten ersten Punkte daraus, nur gekuerzt.
//
// Anlass: `geoJsonToMap()` holt Ursprung und Namen inzwischen ersatzweise aus dem Feature
// `mapmaker`, wenn oben kein `properties`-Block steht. Dieser Test haelt fest, dass die alten
// Dateien davon unberuehrt bleiben — geprueft wird, was ankommt, nicht was gemeint war.
{
  const legacySamples = (n) => Array.from({ length: n }, () => ({
    capturedAt: '2026-09-10T06:56:53.092Z', originalCapturedAt: null, editedAt: null,
    previousPosition: null, gps: { solution: 2, age: 0.15, accuracy: 0.02 },
  }));

  // (1) Relativ gefuehrt: lokale Meter, `origin: null`. So liegt die Datei auf der Platte.
  const legacyRelative = {
    type: 'FeatureCollection',
    name: 'Mein',
    properties: {
      format: 'ardumower-web-map-geojson', generator: 'MapCreator für Ardumower', version: 2,
      mapId: '74a5f096-e187-4338-99d6-38f9c68bc279',
      coordinateSystem: 'sunray-local-xy-meters', units: 'm', origin: null,
      note: 'Coordinates are local Sunray X/Y values in meters, not WGS84 longitude/latitude.',
      createdAt: '2026-09-06T10:10:31.436Z', updatedAt: '2026-09-10T06:57:11.302Z',
    },
    features: [
      { type: 'Feature',
        properties: { role: 'perimeter', name: 'perimeter', label: 'Perimeter',
          coordinateSystem: 'sunray-local-xy-meters', units: 'm', completePolygon: true,
          samples: legacySamples(5) },
        geometry: { type: 'Polygon', coordinates: [[[1.121,4.049],[0.819,3.272],[0.909,1.071],[0.816,0.715],[0.831,0.282],[1.121,4.049]]] } },
      { type: 'Feature',
        properties: { role: 'exclusion', exclusionIndex: 0, exclusionId: 'ex-legacy',
          name: 'exclusion', label: 'Ausschluss 1', coordinateSystem: 'sunray-local-xy-meters',
          units: 'm', completePolygon: true, samples: legacySamples(3) },
        geometry: { type: 'Polygon', coordinates: [[[2.031,1.281],[3.243,3.339],[4.26,2.603],[2.031,1.281]]] } },
    ],
  };

  const rel = t.geoJsonToMap(legacyRelative);
  assert.strictEqual(rel.name, 'Mein (Import)', 'der Kartenname kommt weiter von oben');
  assert.strictEqual(rel.positionMode, 'relative', 'ohne Grad-Kennzeichnung bleibt die Karte relativ');
  assert.strictEqual(rel.origin, null);
  // Koordinaten unveraendert: lokale Meter werden nicht angefasst, der Schlusspunkt faellt weg.
  assert.strictEqual(rel.perimeter.map((p) => `${p.x},${p.y}`).join(' | '),
    '1.121,4.049 | 0.819,3.272 | 0.909,1.071 | 0.816,0.715 | 0.831,0.282');
  assert.strictEqual(rel.exclusions.length, 1);
  assert.strictEqual(rel.exclusions[0].name, 'Ausschluss 1', 'der Anzeigename kommt aus `label`');
  assert.strictEqual(rel.exclusions[0].points.map((p) => `${p.x},${p.y}`).join(' | '),
    '2.031,1.281 | 3.243,3.339 | 4.26,2.603');
  assert.strictEqual(rel.perimeter[0].gps.solution, 2, 'die Aufnahme-Metadaten aus `samples` bleiben');

  // (2) Absolut gefuehrt: Grad plus Top-Level-Ursprung. Genau der Zweig, den die Aenderung
  // beruehrt hat — steht oben ein `properties`-Block, gewinnt der, egal was in den Features liegt.
  const origin = { lat: 52.26742967, lon: 8.60921633 };
  const local = [{x:0,y:0},{x:12.5,y:0},{x:12.5,y:8.25}];
  const absoluteMap = t.makeMap('Alt-Absolut');
  absoluteMap.positionMode = 'absolute';
  absoluteMap.origin = origin;
  absoluteMap.perimeter = local.map((p) => ({ ...p }));
  const legacyAbsolute = t.mapToGeoJson(absoluteMap);
  assert.strictEqual(legacyAbsolute.properties.coordinateSystem, 'wgs84-degrees',
    'das Pruefmuster traegt die alte Top-Level-Kennzeichnung');
  assert.ok(legacyAbsolute.properties.origin, 'und den Top-Level-Ursprung');

  const abs = t.geoJsonToMap(legacyAbsolute);
  assert.strictEqual(abs.name, 'Alt-Absolut (Import)');
  assert.strictEqual(abs.positionMode, 'absolute');
  assert.strictEqual(`${abs.origin.lat},${abs.origin.lon}`, `${origin.lat},${origin.lon}`,
    'der Ursprung kommt weiter aus dem Top-Level-Block');
  const drift = local.reduce((max, point, index) =>
    Math.max(max, Math.hypot(abs.perimeter[index].x - point.x, abs.perimeter[index].y - point.y)), 0) * 1000;
  assert.ok(drift < 10, `alte absolute Datei driftet: ${drift.toFixed(4)} mm`);

  // (3) Gegenprobe: ein Feature namens `mapmaker` in einer ALTEN Datei darf den Top-Level-Block
  // nicht verdraengen — sonst haette die Aenderung eine Hintertuer aufgemacht.
  const mitFremdemMapmaker = JSON.parse(JSON.stringify(legacyRelative));
  mitFremdemMapmaker.features.push({ type: 'Feature',
    properties: { name: 'mapmaker', label: 'Falscher Name', coordinateSystem: 'wgs84-degrees',
      origin: { lat: 1, lon: 1 } },
    geometry: null });
  const gegenprobe = t.geoJsonToMap(mitFremdemMapmaker);
  assert.strictEqual(gegenprobe.name, 'Mein (Import)', 'der Top-Level-Name gewinnt');
  assert.strictEqual(gegenprobe.positionMode, 'relative', 'die Top-Level-Kennzeichnung gewinnt');
  assert.strictEqual(gegenprobe.perimeter.map((p) => `${p.x},${p.y}`).join(' | '),
    '1.121,4.049 | 0.819,3.272 | 0.909,1.071 | 0.816,0.715 | 0.831,0.282');
}

// --- CaSSAndRA-Sperre und ausgelassene Flaechen -----------------------------
{
  // Die Bedingung „taugt als Flaeche“ hat genau eine Stelle; Kartenpruefung und Exportsperre
  // fragen dieselbe.
  assert.strictEqual(t.hasUsablePolygon([{x:0,y:0},{x:1,y:0},{x:1,y:1}]), true);
  assert.strictEqual(t.hasUsablePolygon([{x:0,y:0},{x:1,y:0}]), false);
  assert.strictEqual(t.hasUsablePolygon([]), false);
  assert.strictEqual(t.hasUsablePolygon(undefined), false);

  const m = t.makeMap('Sperre');
  t.state.cassandraReference = null;
  assert.strictEqual(t.cassandraExportBlockKey(m), 'cassandraMissingHint');
  t.state.cassandraReference = { lat: 52.26742967, lon: 8.60921633 };
  // Der zweite Grund ist derselbe Schluessel, den die Kartenpruefung meldet.
  assert.strictEqual(t.cassandraExportBlockKey(m), 'checkPerimeterTooFew');
  m.perimeter = [{x:0,y:0},{x:1,y:0}];
  assert.strictEqual(t.cassandraExportBlockKey(m), 'checkPerimeterTooFew');
  t.state.activeMap = m;
  t.validateActiveMap();
  assert.ok(t.state.validationResult.issues.some((i) => i.key === 'checkPerimeterTooFew'),
    'dieselbe Lage meldet auch die Kartenpruefung');
  m.perimeter = [{x:0,y:0},{x:5,y:0},{x:5,y:5}];
  assert.strictEqual(t.cassandraExportBlockKey(m), null);

  // Ausgelassene Flaechen werden benannt, mit Punktzahl — auch die leeren.
  m.exclusions.push({ id:'a', name:'Ausschluss 1', points:[{x:1,y:1},{x:2,y:1},{x:2,y:2}] });
  m.exclusions.push({ id:'b', name:'Ausschluss 2', points:[{x:3,y:1},{x:3.5,y:1}] });
  m.exclusions.push({ id:'c', name:'Ausschluss 3', points:[] });
  const skipped = t.cassandraSkippedAreas(m);
  assert.strictEqual(skipped.join(' | '), 'Ausschluss 2 (2 Punkte) | Ausschluss 3 (0 Punkte)');
  // Und was gemeldet wird, fehlt auch wirklich in der Datei.
  const doc = t.mapToCassandraGeoJson(m, t.state.cassandraReference);
  assert.strictEqual(doc.features.filter((f) => f.properties.name === 'exclusion').length, 1);
  t.state.activeMap = null;
  t.state.cassandraReference = null;
}

// --- Grenzfaelle von hasUsablePolygon() ------------------------------------
// `hasUsablePolygon()` hat drei handgeschriebene Zaehlungen abgeloest. Diese Tabelle haelt fest,
// was an den Grenzen 2/3/4 Punkte herauskommt — offen wie geschlossen —, damit die Gleichheit
// mit den alten Bedingungen nicht spaeter unbemerkt wegdriftet.
//
// Zum Schlusspunkt: das Modell speichert **keinen**. `closePerimeter()` und `closeContour()`
// setzen nur ein Kennzeichen, und der Import schneidet einen mitgelieferten Schlusspunkt ab
// (`pointsFromGeoGeometry()`). Rohe Feldlaenge und Eckenzahl sind damit dasselbe — geprueft.
{
  const ecken = (n) => [{x:0,y:0},{x:5,y:0},{x:5,y:5},{x:0,y:5}].slice(0, n);
  const erwartet = { 2: true, 3: false, 4: false }; // true = „zu wenige Punkte“ wird gemeldet

  for (const n of [2, 3, 4]) {
    for (const geschlossen of [false, true]) {
      const m = t.makeMap(`Grenzfall ${n}`);
      m.perimeter = ecken(n);
      m.perimeterClosed = geschlossen;
      t.state.activeMap = m;
      t.validateActiveMap();
      assert.strictEqual(
        t.state.validationResult.issues.some((i) => i.key === 'checkPerimeterTooFew'), erwartet[n],
        `Kartenpruefung, Perimeter, ${n} Punkte, ${geschlossen ? 'geschlossen' : 'offen'}`);

      const mit = t.makeMap('Flaeche');
      mit.perimeter = [{x:-9,y:-9},{x:9,y:-9},{x:9,y:9},{x:-9,y:9}];
      mit.perimeterClosed = true;
      mit.exclusions.push({ id:'x', name:'Ausschluss 1', closed: geschlossen, points: ecken(n) });
      t.state.activeMap = mit;
      t.validateActiveMap();
      assert.strictEqual(
        t.state.validationResult.issues.some((i) => i.key === 'checkAreaTooFew'), erwartet[n],
        `Kartenpruefung, Flaeche, ${n} Punkte, ${geschlossen ? 'geschlossen' : 'offen'}`);

      t.state.cassandraReference = { lat: 52.26742967, lon: 8.60921633 };
      assert.strictEqual(t.cassandraExportBlockKey(m) === 'checkPerimeterTooFew', erwartet[n],
        `Exportsperre, ${n} Punkte, ${geschlossen ? 'geschlossen' : 'offen'}`);
      t.state.cassandraReference = null;
    }
  }

  // Das Kennzeichen „geschlossen“ fuegt keinen Punkt hinzu — sonst zaehlte jede der drei
  // Bedingungen fuer geschlossene Konturen einen Punkt zu viel.
  const zu = t.makeMap('Schlusspunkt');
  zu.perimeter = ecken(3);
  zu.perimeterClosed = true;
  assert.strictEqual(zu.perimeter.length, 3);
  assert.notStrictEqual(`${zu.perimeter[0].x},${zu.perimeter[0].y}`,
    `${zu.perimeter[2].x},${zu.perimeter[2].y}`, 'der letzte Punkt ist nicht der erste');

  // Und ein aus einer Datei mitgebrachter Schlusspunkt landet nicht im Modell.
  const ausDatei = t.geoJsonToMap({
    type: 'FeatureCollection', name: 'Ring',
    properties: { coordinateSystem: 'sunray-local-xy-meters', origin: null },
    features: [{ type: 'Feature', properties: { role: 'perimeter', name: 'perimeter' },
      geometry: { type: 'Polygon', coordinates: [[[0,0],[5,0],[5,5],[0,0]]] } }],
  });
  assert.strictEqual(ausDatei.perimeter.length, 3, 'vier Koordinaten in der Datei, drei Ecken im Modell');
  t.state.activeMap = null;
}

// --- Rundlauf bei lat0 = 0 (die neue Vorgabe) ------------------------------
// Die Vorgabe fuer den CaSSAndRA-Bezugspunkt ist 0/0. Geografisch ist das die Nullinsel im Golf
// von Guinea, rechnerisch aber der **unguenstigste** Fall der Naeherung: `cos(0) = 1`, der Grad
// Laenge ist dort am laengsten, und der Rundungsfehler in Ostrichtung damit am groessten. Genau
// deshalb wird hier gemessen und nicht geschaetzt.
{
  const coordsAbsToRel = (lon, lat, ref) => ({
    x: (lon - ref.lon) * (111111 * Math.cos((ref.lat * Math.PI) / 180)),
    y: (lat - ref.lat) * 111111,
  });
  const reference = { lat: 0, lon: 0 };

  const m = t.makeMap('Nullinsel');
  m.perimeter = [{x:0,y:0},{x:12.5,y:0},{x:12.5,y:8.25},{x:6.125,y:11.4},{x:0,y:8.25}];
  m.exclusions.push({ id:'ex1', name:'Ausschluss 1', closed:true,
    points:[{x:3,y:3},{x:4.5,y:3},{x:4.5,y:4.5},{x:3,y:4.5}] });
  m.dockPoints = [{x:0,y:0},{x:-1.5,y:-2}];
  m.waypoints = [{x:2,y:2},{x:5,y:5},{x:8,y:2}];

  const doc = t.mapToCassandraGeoJson(m, reference);
  assert.ok(doc, 'bei 0/0 entsteht eine Datei — 0 ist ein gueltiger Bezugspunkt, kein fehlender');

  const worst = (points, coords) => points.reduce((max, point, index) => {
    const back = coordsAbsToRel(coords[index][0], coords[index][1], reference);
    return Math.max(max, Math.hypot(back.x - point.x, back.y - point.y));
  }, 0);

  const perimeterMm = worst(m.perimeter, doc.features[0].geometry.coordinates[0]) * 1000;
  const exclusionMm = worst(m.exclusions[0].points, doc.features[3].geometry.coordinates[0]) * 1000;
  const dockMm = worst(m.dockPoints, doc.features[1].geometry.coordinates) * 1000;
  const wireMm = worst(m.waypoints, doc.features[2].geometry.coordinates) * 1000;
  const largestMm = Math.max(perimeterMm, exclusionMm, dockMm, wireMm);

  assert.ok(largestMm < 10, `Rundlauf bei lat0=0 ueber 1 cm: ${largestMm.toFixed(4)} mm`);
  // Theoretische Obergrenze am Aequator: 0,5e-7 Grad je Achse, also 5,56 mm je Achse und
  // 7,86 mm als Vektor. Naeher darf kein Punkt liegen, sonst stimmt die Umrechnung nicht.
  assert.ok(largestMm < 7.9, `ueber der theoretischen Grenze am Aequator: ${largestMm.toFixed(4)} mm`);

  console.log(`  CaSSAndRA-Rundlauf bei lat0=0: groesste Abweichung ${largestMm.toFixed(4)} mm ` +
    `(Perimeter ${perimeterMm.toFixed(4)}, Ausschluss ${exclusionMm.toFixed(4)}, ` +
    `Dock ${dockMm.toFixed(4)}, Suchdraht ${wireMm.toFixed(4)})`);
}

console.log('app core tests: OK');

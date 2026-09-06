'use strict';
const assert = require('assert');
const { loadApp } = require('./app-harness.js');

const { t } = loadApp({
  exportNames: ['state', 'makeMap', 'normalizeMap', 'polygonSelfIntersects', 'pointInPolygon',
    'polygonEdgesIntersect', 'polygonsIntersect', 'polygonArea', 'pathLength', 'geometryForArea', 'mapToGeoJson', 'geoJsonToMap', 'normalizeOrigin', 'mapOriginInUse',
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

console.log('app core tests: OK');

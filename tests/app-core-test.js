'use strict';
const assert = require('assert');
const { loadApp } = require('./app-harness.js');

const { t } = loadApp({
  exportNames: ['state', 'makeMap', 'normalizeMap', 'polygonSelfIntersects', 'pointInPolygon',
    'polygonEdgesIntersect', 'polygonsIntersect', 'polygonArea', 'pathLength', 'geometryForArea', 'mapToGeoJson',
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

console.log('app core tests: OK');

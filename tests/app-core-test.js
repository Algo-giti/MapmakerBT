'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

function elementStub() {
  return {
    textContent: '', innerHTML: '', value: '', checked: true, disabled: false, hidden: false, dataset: {},
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, appendChild(){}, append(){},
    querySelector(){ return null; }, closest(){ return null; }, focus(){},
  };
}
const elements = new Map();
const documentStub = {
  documentElement: { lang: 'de' },
  getElementById(id){ if(!elements.has(id)) elements.set(id, elementStub()); return elements.get(id); },
  querySelector(){ return null; }, querySelectorAll(){ return []; },
  createElement(){ return elementStub(); },
  createElementNS(){ return elementStub(); },
  body: { appendChild(){} },
};
const localStore = new Map();
const sandbox = {
  console, structuredClone, TextEncoder, TextDecoder, Blob,
  crypto: require('crypto').webcrypto,
  document: documentStub,
  window: { isSecureContext: true },
  navigator: { bluetooth: {} },
  localStorage: { getItem:k=>localStore.get(k) ?? null, setItem:(k,v)=>localStore.set(k,String(v)) },
  setTimeout, clearTimeout, setInterval, clearInterval,
  URL: { createObjectURL(){ return 'blob:test'; }, revokeObjectURL(){} },
  alert(){}, confirm(){ return true; },
};
sandbox.globalThis = sandbox;
let source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
source = source.replace(/init\(\)\.catch\([\s\S]*?\n\}\);\s*$/, '');
source += `\n;globalThis.__test = { state, makeMap, normalizeMap, normalizedRange, polygonSelfIntersects, pointInPolygon, polygonEdgesIntersect, polygonsIntersect, polygonArea, pathLength, geometryForArea, mapToGeoJson, validateActiveMap };`;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'app.js' });
const t = sandbox.__test;

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
assert.ok(Array.isArray(map.history));
const geo = t.mapToGeoJson(map);
assert.strictEqual(geo.type, 'FeatureCollection');
assert.strictEqual(geo.features[0].geometry.type, 'Polygon');

t.state.activeMap = map;
t.validateActiveMap();
assert.strictEqual(t.state.validationResult.area, 15); // 16 m² perimeter minus 1 m² exclusion
assert.strictEqual(t.state.validationResult.issues.some((i)=>i.key==='checkExclusionOutside'), false);

const legacy = t.normalizeMap({id:'old',name:'Old',perimeter:[],exclusions:[],dockPoints:[],version:1});
assert.strictEqual(legacy.version, 2);
assert.ok(Array.isArray(legacy.history));

t.state.activeMap = { perimeter: new Array(6).fill(0).map((_,i)=>({x:i,y:0})), exclusions:[], dockPoints:[] };
t.state.rangeSelection = { start:{role:'perimeter',index:5,exclusionId:null}, end:{role:'perimeter',index:2,exclusionId:null} };
const range = t.normalizedRange();
assert.deepStrictEqual({start:range.start,end:range.end,reverse:range.reverse},{start:2,end:5,reverse:true});

console.log('app core tests: OK');

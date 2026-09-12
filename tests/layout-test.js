'use strict';
// Regressionstest fuer die scrollbare Menueseite.
//
// Der Bug ist zweimal aufgetreten und hatte zwei verschiedene Ursachen:
//   1. `.menu-scroll` fehlte `min-height: 0` — ein Flex-Kind waechst sonst auf Inhaltshoehe
//      und laeuft unter `body { overflow: hidden }` ins Leere.
//   2. `.menu-page` war ueber `inset: 0` an den Layout-Viewport gebunden. Auf Android Chrome
//      ist das die Hoehe OHNE Adressleiste, also mehr als sichtbar ist: der untere Rand liegt
//      hinter der Browserleiste, und knapp zu langer Inhalt wird abgeschnitten, ohne dass
//      ueberhaupt gescrollt werden kann.
//
// Beides laesst sich ohne Browser pruefen: die Regeln stehen fest im Stylesheet, und die
// Struktur (Scrollcontainer als direktes Kind der Seite) steht in index.html.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

/** Alle Regeln in Dateireihenfolge, inklusive der in @media-Bloecken. */
function parseRules(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let buffer = '';
  for (const ch of clean) {
    if (ch === '{') {
      const head = buffer.trim();
      buffer = '';
      if (head.startsWith('@')) { stack.push(head); rules.push({ open: head }); }
      else stack.push({ selector: head, media: stack.filter((s) => typeof s === 'string') });
    } else if (ch === '}') {
      const top = stack.pop();
      if (top && typeof top === 'object') {
        rules.push({ selectors: top.selector.split(',').map((s) => s.trim()), media: top.media.join(' '), body: buffer });
      }
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  return rules.filter((r) => r.selectors);
}

const rules = parseRules(css);

/**
 * Letzter gewinnender Wert einer Eigenschaft fuer einen exakten Selektor — beruecksichtigt
 * spaetere Layer und @media-Bloecke, die eine frueher gesetzte Regel wieder aufheben.
 */
function resolve(selector, property, { media = '' } = {}) {
  let value = null;
  let where = null;
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue;
    // Standard: nur Regeln ohne @media. Sonst nur die des angegebenen Kontexts.
    if (media ? !rule.media.includes(media) : rule.media) continue;
    const match = [...rule.body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'g'))].pop();
    if (match) { value = match[1].trim(); where = rule.media || 'ohne @media'; }
  }
  return { value, where };
}

/**
 * Spezifitaet eines Selektors, grob nach CSS-Regel (Kennungen, Klassen/Attribute/Pseudos, Typen).
 */
function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length;
  const types = (selector.match(/(^|[\s>+~])[a-z][\w-]*/g) || []).length;
  return ids * 10000 + classes * 100 + types;
}

/** Passt der Selektor auf ein Element mit dieser Klassenliste unter diesen Vorfahren? */
function selectorMatches(selector, { classes, ancestors, tag }) {
  if (selector.includes('#')) return false;
  const compounds = selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  const last = compounds[compounds.length - 1];
  if (/[:\[]/.test(last)) return false;               // Zustandsregeln bleiben aussen vor
  const lastTag = (last.match(/^[a-z][\w-]*/) || [])[0];
  if (lastTag && lastTag !== tag) return false;
  if (!(last.match(/\.[\w-]+/g) || []).every((c) => classes.includes(c.slice(1)))) return false;
  return compounds.slice(0, -1).every((compound) => {
    // Merkmale an einem **Vorfahren** sind pruefbar, wenn der Test sie ausdruecklich mitgibt:
    // `ancestors: ['drive-pad', 'zones-on', '[data-zone]']`. Ohne Eintrag passt die Regel nicht —
    // so bleibt das Verhalten fuer alle bisherigen Aufrufe unveraendert, und eine Regel, die
    // sich an `[data-zone]` haengt, laesst sich gezielt nachweisen statt nur zu vermuten.
    const attrs = compound.match(/\[[^\]]+\]/g) || [];
    if (attrs.some((a) => !ancestors.includes(a))) return false;
    const bare = compound.replace(/\[[^\]]+\]/g, '');
    if (/:/.test(bare)) return false;
    const compoundTag = (bare.match(/^[a-z][\w-]*/) || [])[0];
    if (compoundTag && !ancestors.includes(compoundTag)) return false;
    return (bare.match(/\.[\w-]+/g) || []).every((c) => ancestors.includes(c.slice(1)));
  });
}

/**
 * Gewinnender Wert einer Eigenschaft fuer ein **Element**, nicht fuer einen Selektortext.
 *
 * `resolve()` daneben fragt nur Regeln ab, deren Selektor woertlich uebereinstimmt. Genau daran
 * ist ein Fixversuch gescheitert: das Tastenkreuz erbte `margin: 16px auto 10px` aus der alten
 * Regel `.drive-pad` eines frueheren Layers, waehrend der Test `.drive-zone .drive-pad` abfragte
 * — die Altlast war fuer ihn unsichtbar, obwohl sie dasselbe Element trifft. Diese Funktion
 * beruecksichtigt **jede** Regel, die auf das Element passt, und entscheidet nach Spezifitaet
 * und Reihenfolge. Fuer Altlasten-Fallen ist sie das richtige Werkzeug.
 */
function effectiveStyle(element, property, { media = '' } = {}) {
  const target = { ancestors: [], tag: 'div', ...element };
  let best = null;
  rules.forEach((rule, index) => {
    if (media ? !rule.media.includes(media) : rule.media) return;
    rule.selectors.forEach((selector) => {
      if (!selectorMatches(selector, target)) return;
      const hit = [...rule.body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'g'))].pop();
      if (!hit) return;
      const score = specificity(selector);
      if (!best || score > best.score || (score === best.score && index >= best.index)) {
        best = { score, index, selector, value: hit[1].trim() };
      }
    });
  });
  return best || { value: null, selector: null };
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('.menu-scroll bleibt ein echter Scrollcontainer', () => {
  const minHeight = resolve('.menu-scroll', 'min-height');
  assert.strictEqual(minHeight.value, '0', `min-height muss 0 sein (zuletzt gesetzt in: ${minHeight.where})`);
  assert.strictEqual(resolve('.menu-scroll', 'overflow-y').value, 'auto');
  const flex = resolve('.menu-scroll', 'flex').value;
  assert.ok(flex && /^1\s/.test(flex), `flex muss wachsen duerfen, ist "${flex}"`);
  // Eine feste Hoehe wuerde den Scrollcontainer wieder aushebeln.
  assert.strictEqual(resolve('.menu-scroll', 'height').value, null, 'keine feste Hoehe am Scrollcontainer');
});

test('.menu-page haengt am sichtbaren Viewport, nicht am Layout-Viewport', () => {
  assert.strictEqual(resolve('.menu-page', 'position').value, 'fixed');
  assert.strictEqual(resolve('.menu-page', 'display').value, 'flex');
  assert.strictEqual(resolve('.menu-page', 'flex-direction').value, 'column');
  const height = resolve('.menu-page', 'height').value;
  assert.ok(height && height.includes('dvh'), `Hoehe muss in dvh gemessen werden, ist "${height}"`);
  // .app-frame macht es genauso — beide Vollbildebenen muessen dieselbe Bezugsgroesse nutzen.
  assert.ok((resolve('.app-frame', 'height').value || '').includes('dvh'));
});

test('Overlays ueber der Karte nutzen dieselbe Bezugshoehe', () => {
  const height = resolve('.modal-backdrop', 'height').value;
  assert.ok(height && height.includes('dvh'), `Modal-Hoehe muss in dvh gemessen werden, ist "${height}"`);
});

test('Die verschachtelte Einstellungsebene erzeugt keinen zweiten Scrollcontainer', () => {
  // Nur .menu-scroll darf scrollen; ein zweiter Container mit fester Hoehe wuerde
  // geoeffnete Unterabschnitte erneut abschneiden.
  for (const selector of ['.menu-subsections', '.menu-subsection', '.menu-body', '.menu-section']) {
    const overflowY = resolve(selector, 'overflow-y').value;
    assert.ok(overflowY === null || overflowY === 'visible', `${selector} darf nicht selbst scrollen (overflow-y: ${overflowY})`);
    assert.strictEqual(resolve(selector, 'height').value, null, `${selector} darf keine feste Hoehe haben`);
    assert.strictEqual(resolve(selector, 'max-height').value, null, `${selector} darf keine Hoehenbegrenzung haben`);
  }
});

test('Die Abschnittsstapel koennen ihre Kinder nicht zusammendruecken', () => {
  // In einem Spalten-Flexcontainer schrumpfen Kinder (flex-shrink: 1) auf die Containerhoehe,
  // in einem Grid koennen Zeilen von der Containerhoehe abhaengen. Beides fuehrt dazu, dass ein
  // aufgeklappter Abschnitt abgeschnitten wird, statt den Scrollcontainer zu verlaengern.
  for (const selector of ['.menu-scroll', '.menu-subsections', '.menu-body']) {
    const display = resolve(selector, 'display').value;
    assert.strictEqual(display, 'block', `${selector} muss Blocklayout nutzen, ist "${display}"`);
  }
});

test('Aufgeklappte Abschnitte werden nicht beschnitten', () => {
  // overflow: hidden am <details> schneidet aufgeklappten Inhalt ab, sobald die Hoehe aus
  // irgendeinem Grund nicht mitwaechst — der Inhalt verschwindet dann hinter dem Folgeabschnitt.
  for (const selector of ['.menu-section', '.menu-subsection']) {
    const overflow = resolve(selector, 'overflow').value;
    assert.ok(overflow === null || overflow === 'visible', `${selector} darf nicht clippen (overflow: ${overflow})`);
    assert.strictEqual(resolve(`${selector}[open]`, 'overflow').value, 'visible',
      `${selector}[open] muss overflow: visible absichern`);
    assert.strictEqual(resolve(`${selector}[open]`, 'height').value, 'auto');
  }
});

test('Die Karte traegt oben eine Werkzeugleiste und darunter die Zeichenflaeche', () => {
  // Die frueheren Eckstapel sind weg: Loeschen, Rueckgaengig, „Schliessen & neu“ und
  // „Ansicht zuruecksetzen“ stehen jetzt waagerecht oben. Nur der Aufnahme-Cluster bleibt
  // unten rechts.
  assert.strictEqual(resolve('.map-stage', 'display').value, 'flex');
  assert.strictEqual(resolve('.map-stage', 'flex-direction').value, 'column');
  assert.strictEqual(resolve('.map-toolbar', 'flex').value, '0 0 auto',
    'die Leiste darf nur ihre Inhaltshoehe kosten');
  assert.strictEqual(resolve('.map-canvas-area', 'flex').value, '1 1 auto', 'der Rest gehoert der Karte');
  assert.strictEqual(resolve('.map-canvas-area', 'min-height').value, '0',
    'ohne min-height:0 waechst die Zeichenflaeche auf Inhaltshoehe');
  assert.strictEqual(resolve('.map-canvas-area', 'position').value, 'relative',
    'Hinweiszeile und Aufnahme-Cluster richten sich an der Zeichenflaeche aus, nicht an der Buehne');
  // Der Aufnahme-Cluster ist unveraendert unten rechts geblieben — jetzt ueber den gemeinsamen
  // Randabstand, den sich alle randstaendigen Bedienelemente teilen.
  assert.strictEqual(resolve('.capture-cluster', 'position').value, 'absolute');
  assert.strictEqual(resolve('.capture-cluster', 'right').value, 'var(--edge-gap)');
  assert.strictEqual(resolve('.capture-cluster', 'bottom').value, 'var(--edge-gap)');
  const area = html.slice(html.indexOf('id="mapCanvasArea"'));
  for (const id of ['captureCluster', 'mapPosition', 'fitViewBtn', 'undoFabWrap']) {
    assert.ok(area.includes(`id="${id}"`), `${id} gehoert in die Zeichenflaeche`);
  }
  assert.ok(!html.includes('class="map-hud"'), 'der alte Overlay-Kasten kehrt nicht zurueck');
});


test('Der Verschieben-Knopf teilt sich Form und Platz mit dem Automatik-Knopf', () => {
  // Er nimmt dessen Platz ein, wenn ein Punkt ausgewaehlt ist — also muss er dieselbe Groesse
  // haben, sonst springt die Knopfspalte beim Umschalten.
  assert.ok(html.includes('id="moveFabWrap"'), 'der Knopf steht im Aufnahme-Cluster');
  const cluster = html.slice(html.indexOf('id="captureCluster"'), html.indexOf('id="captureFabWrap"'));
  assert.ok(cluster.includes('id="moveFabWrap"'), 'und zwar im selben Cluster wie der Automatik-Knopf');
  assert.ok(/id="movePointBtn"[^>]*class="[^"]*\bauto-fab\b/.test(html)
    || /class="[^"]*\bauto-fab\b[^"]*"[^>]*id="movePointBtn"/.test(html),
    'er nutzt die Form des Automatik-Knopfes, statt eine zweite Groesse einzufuehren');
  assert.strictEqual(resolve('.auto-fab', 'width').value, 'var(--fab-size)',
    'und damit die Groesse der kleinen Randknoepfe');
  // Das Pfeilkreuz besteht aus offenen Teilpfaden: die Fuellung aus `.auto-fab svg` muss weg.
  assert.strictEqual(resolve('.move-fab svg', 'fill').value, 'none');
});

test('Die Werkzeugleiste bricht Beschriftungen nicht um', () => {
  // Das war der gemeldete Fehler: auf schmalen Geraeten stapelten sich die Buchstaben
  // untereinander, weil nur die Knopfbreite zur Verfuegung stand.
  assert.strictEqual(resolve('.map-tool-label', 'white-space').value, 'nowrap',
    'die Beschriftung muss in einer Zeile bleiben');
  assert.strictEqual(resolve('.map-toolbar', 'display').value, 'flex');
  assert.strictEqual(resolve('.map-tools', 'overflow-x').value, 'auto',
    'passen die Werkzeuge nicht, scrollen sie waagerecht statt umzubrechen');
  assert.strictEqual(resolve('.map-tool', 'flex').value, '0 0 auto',
    'die Werkzeuge duerfen nicht zusammengequetscht werden');
  assert.strictEqual(resolve('.map-tool', 'display').value, 'grid', 'Symbol oben, Beschriftung darunter');
  assert.strictEqual(resolve('.map-tool', 'min-height').value, '44px', 'Daumenziel');
  const bar = html.slice(html.indexOf('id="mapToolbar"'), html.indexOf('id="mapCanvasArea"'));
  const tools = ['deletePointBtn', 'insertBeforeBtn', 'insertAfterBtn', 'closeAndNewBtn', 'extendBtn'];
  assert.ok(!bar.includes('id="driveModeBtn"'),
    'der Steuerungs-Umschalter sitzt jetzt in der Ecke des Fahrfelds, nicht mehr in der Leiste');
  // Rueckgaengig, Ansicht-Symbol und Positionszeile liegen auf der Karte, nicht in der Leiste.
  for (const id of ['undoBtn', 'fitViewBtn', 'mapPosition']) {
    assert.ok(!bar.includes(`id="${id}"`), `${id} gehoert nicht mehr in die Leiste`);
  }
  for (const id of tools) {
    assert.ok(bar.includes(`id="${id}"`), `${id} fehlt in der Werkzeugleiste`);
  }
  assert.strictEqual((bar.match(/map-tool-label/g) || []).length, tools.length, 'jedes Werkzeug ist beschriftet');
  assert.strictEqual((bar.match(/<svg/g) || []).length, tools.length, 'jedes Werkzeug hat ein Symbol');
  // Nie alle gleichzeitig sichtbar: die beiden Einfuegen-Werkzeuge starten ausgeblendet und
  // erscheinen nur bei ausgewaehltem Punkt, „Schliessen & neu“ und „Ansicht zurueck“ ebenso.
  for (const id of ['insertBeforeWrap', 'insertAfterWrap', 'closeAndNewWrap']) {
    assert.ok(new RegExp(`hidden=""[^>]*id="${id}"`).test(bar), `${id} startet ausgeblendet`);
  }
});

test('Keine Beschriftung bricht mehr mitten im Wort', () => {
  // `overflow-wrap: anywhere` war die Ursache der Buchstabenkolonnen. Die verbliebenen
  // Beschriftungen am Aufnahme-Cluster duerfen hoechstens zwischen Woertern umbrechen.
  assert.strictEqual(resolve('.fab-label', 'overflow-wrap').value, 'normal');
  assert.strictEqual(resolve('.fab-label', 'word-break').value, 'normal');
  assert.ok(resolve('.fab-label', 'max-width').value, 'Beschriftung braucht eine Breitenbegrenzung');
  // Im Diagnoseprotokoll ist `anywhere` weiterhin richtig (lange Protokollzeilen ohne
  // Leerzeichen) — geprueft wird deshalb gezielt an den Beschriftungen.
  assert.notStrictEqual(resolve('.map-tool-label', 'overflow-wrap').value, 'anywhere');
  assert.notStrictEqual(resolve('.map-tool-label', 'word-break').value, 'break-all');
});

test('Der Rueckgaengig-Knopf steht unten an der Kartenecke, spiegelbildlich zum Aufnehmen', () => {
  // Er ist aus der Werkzeugleiste zurueck auf die Karte gewandert: Rechtshaender unten links,
  // Linkshaender unten rechts — also genau gegenueber dem Aufnahme-Cluster, der seine Seite
  // behaelt. Der Lastenteiler ist der gemeinsame Randabstand --edge-gap.
  const area = html.slice(html.indexOf('id="mapCanvasArea"'));
  assert.ok(area.includes('id="undoFabWrap"'), 'der Schalter fuer die Sichtbarkeit bleibt erhalten');
  assert.ok(/disabled=""[^>]*id="undoBtn"/.test(html), 'bei leerem Verlauf startet der Knopf ausgegraut');
  assert.strictEqual(resolve('.map-corner-undo', 'position').value, 'absolute');
  assert.strictEqual(resolve('.map-corner-undo', 'left').value, 'var(--edge-gap)');
  assert.strictEqual(resolve('.map-corner-undo', 'bottom').value, 'var(--edge-gap)');
  assert.strictEqual(resolve(':root[data-handed="left"] .map-corner-undo', 'right').value, 'var(--edge-gap)');
  assert.strictEqual(resolve(':root[data-handed="left"] .map-corner-undo', 'left').value, 'auto',
    'ohne Zuruecksetzen von left waere der Knopf ueber die ganze Breite gespannt');
  // Gegenueberliegende Seiten: Aufnahme rechts, Rueckgaengig links (und gespiegelt umgekehrt).
  assert.strictEqual(resolve('.capture-cluster', 'right').value, 'var(--edge-gap)');
  assert.strictEqual(resolve(':root[data-handed="left"] .capture-cluster', 'left').value, 'var(--edge-gap)');
  // Groesse wie der Automatik-Knopf im inaktiven Zustand, nicht wie der grosse Aufnahme-Knopf.
  assert.strictEqual(resolve('.undo-fab', 'width').value, resolve('.auto-fab', 'width').value,
    'gleiche Groesse wie der kleine Umriss-Knopf');
  assert.strictEqual(resolve('.undo-fab', 'height').value, resolve('.auto-fab', 'height').value);
  assert.notStrictEqual(resolve('.undo-fab', 'width').value, resolve('.capture-fab', 'width').value,
    'aber ausdruecklich nicht so gross wie der Aufnahme-Knopf');
  assert.strictEqual(resolve('.undo-fab', 'border-radius').value, '50%');
  assert.ok(resolve('.undo-fab[disabled]', 'opacity').value, 'ausgegraut muss sichtbar anders aussehen');
  // Eigenes Symbol, nicht die Muelltonne des Loesch-Werkzeugs.
  const undo = area.slice(area.indexOf('id="undoBtn"'), area.indexOf('id="undoBtn"') + 400);
  assert.ok(!undo.includes('M4 7h16'), 'der Rueckgaengig-Knopf traegt nicht das Loesch-Symbol');
});

test('Karteninfo steht als zweite Zeile in der Werkzeugleiste, nicht auf der Karte', () => {
  // Auf kleinen Displays kostete der Overlay-Streifen zu viel Kartenflaeche. Punktzahl und
  // Konturzustand stehen jetzt unter dem Kartennamen in der Leiste; die Karte bleibt dort frei.
  assert.ok(!css.includes('.map-info {'), 'der Overlay-Streifen ist restlos entfernt');
  const bar = html.slice(html.indexOf('id="mapToolbar"'), html.indexOf('id="mapCanvasArea"'));
  for (const id of ['mapNameLabel', 'mapSummary', 'contourStatus']) {
    assert.ok(bar.includes(`id="${id}"`), `${id} gehoert in die Werkzeugleiste`);
  }
  assert.ok(bar.indexOf('id="mapMeta"') > bar.indexOf('id="mapNameLabel"'),
    'Zeile 1 ist der Kartenname, Zeile 2 die Angaben darunter');
  assert.ok(bar.indexOf('id="contourStatus"') > bar.indexOf('id="mapSummary"'),
    'der Konturstatus steht hinter der Punktzahl');
  // Zwei Zeilen entstehen nur, wenn der Block eine Spalte ist — die Leiste selbst bleibt Zeile.
  assert.strictEqual(resolve('.toolbar-info', 'flex-direction').value, 'column');
  assert.strictEqual(resolve('.map-toolbar', 'display').value, 'flex');
  assert.strictEqual(resolve('.toolbar-info', 'min-width').value, '0',
    'ohne min-width:0 schiebt ein langer Name die Werkzeuge aus der Leiste');
  const shrink = (sel) => Number((resolve(sel, 'flex').value || '').split(/\s+/)[1]);
  assert.ok(shrink('.toolbar-info') > shrink('.map-tools'),
    'der Infoblock muss vor den Werkzeugen nachgeben');
  // Die zweite Zeile ist kompakt und kuerzt statt umzubrechen.
  assert.strictEqual(resolve('.toolbar-map-meta', 'white-space').value, 'nowrap');
  assert.ok(parseFloat(resolve('.toolbar-map-meta', 'font-size').value)
    < parseFloat(resolve('.toolbar-map-name', 'font-size').value),
    'die zweite Zeile ist kleiner gesetzt als der Name');
  for (const prop of ['overflow', 'text-overflow', 'white-space']) {
    assert.ok(resolve('.info-line', prop).value, `.info-line braucht ${prop}`);
  }
  assert.strictEqual(resolve('.info-line', 'text-overflow').value, 'ellipsis');
  assert.ok(Number((resolve('.info-line', 'flex').value || '').split(/\s+/)[1]) > 0,
    'jede Angabe muss nachgeben koennen');
  // Konturfeld: traegt Name **und** Zustand, muss deshalb schrumpfen und kuerzen koennen.
  assert.strictEqual(resolve('.info-chip:empty', 'display').value, 'none',
    'leer darf es nicht einmal Platz kosten');
  assert.ok(Number((resolve('.info-chip', 'flex').value || '').split(/\s+/)[1]) > 0,
    'mit shrink 0 schiebt ein langer Konturname den Rest aus der Zeile');
  assert.strictEqual(resolve('.info-chip', 'min-width').value, '0');
  assert.strictEqual(resolve('.info-chip', 'text-overflow').value, 'ellipsis');
  // Und die Ausrichtung im Block spiegelt mit der Haendigkeit.
  assert.strictEqual(resolve('.toolbar-info', 'align-items').value, 'flex-start');
  assert.strictEqual(resolve(':root[data-handed="left"] .toolbar-info', 'align-items').value, 'flex-end');
});

test('„Ansicht zuruecksetzen“ ist ein reines Symbol in der oberen Kartenecke', () => {
  // Kein runder Knopf mehr, sondern ein schlichtes Zeichen direkt auf der Karte — wie in
  // Kartenprogrammen ueblich. Die Trefferflaeche bleibt trotzdem daumentauglich.
  assert.strictEqual(resolve('.map-view-reset', 'position').value, 'absolute');
  assert.strictEqual(resolve('.map-view-reset', 'right').value, 'var(--edge-gap)');
  assert.strictEqual(resolve(':root[data-handed="left"] .map-view-reset', 'left').value, 'var(--edge-gap)');
  assert.strictEqual(resolve(':root[data-handed="left"] .map-view-reset', 'right').value, 'auto');
  assert.strictEqual(resolve('.map-view-reset', 'border').value, '0', 'kein Rahmen');
  assert.strictEqual(resolve('.map-view-reset', 'background').value, 'none', 'keine Knopfflaeche');
  assert.strictEqual(resolve('.map-view-reset', 'width').value, '44px', 'Daumenziel trotz reinem Symbol');
  assert.strictEqual(resolve('.map-view-reset', 'height').value, '44px');
  assert.ok(/hidden=""[^>]*id="fitViewBtn"/.test(html), 'startet ausgeblendet, sichtbar erst nach eigener Geste');
});

test('Die Werkzeugleiste bleibt kompakt und verschwindet, wenn kein Werkzeug sichtbar ist', () => {
  // Nach dem Umzug von Karteninfo, Rueckgaengig und Ansicht-Symbol steht hier nur noch die
  // Werkzeuggruppe. `space-between` haette eine leere Haelfte hinterlassen.
  assert.strictEqual(resolve('.map-toolbar', 'justify-content').value, 'space-between',
    'Kartenname links, Werkzeuge rechts');
  assert.strictEqual(resolve(':root[data-handed="left"] .map-toolbar', 'flex-direction').value, 'row-reverse',
    'Linkshaender: beides auf der anderen Seite');
  const bar = html.slice(html.indexOf('id="mapToolbar"'), html.indexOf('id="mapCanvasArea"'));
  // Der Name steht vor den Werkzeugen und gibt bei Platzmangel zuerst nach.
  assert.ok(bar.indexOf('id="mapNameLabel"') > 0 && bar.indexOf('id="mapNameLabel"') < bar.indexOf('id="mapTools"'),
    'der Kartenname ist das erste Kind der Leiste');
  const shrink = (sel) => Number((resolve(sel, 'flex').value || '').split(/\s+/)[1]);
  assert.ok(shrink('.toolbar-info') > shrink('.map-tools'),
    'der Infoblock muss zuerst nachgeben, sonst verdraengt er die Werkzeuge');
  assert.strictEqual(resolve('.toolbar-map-name', 'text-overflow').value, 'ellipsis');
  assert.strictEqual(resolve('.toolbar-map-name', 'min-width').value, '0');
  // Auf der Karte darf der Name nicht ein zweites Mal stehen.
  const area = html.slice(html.indexOf('id="mapCanvasArea"'));
  assert.ok(!area.includes('id="mapNameLabel"'), 'der Kartenname liegt nicht mehr auf der Karte');
  // Und die App klappt sie ein, sobald alle Werkzeuge ausgeblendet sind (etwa waehrend der
  // Automatik) — sonst bliebe ein leerer Streifen samt Trennlinie stehen.
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/ui\.mapToolbar\.hidden\s*=/.test(src), 'die Leiste wird bei leerem Inhalt ausgeblendet');
});

test('Linkshaender spiegelt jedes mit dem Daumen bediente Element', () => {
  // Der Sinn der Einstellung ist Konsistenz: es darf nicht die Haelfte umschalten und der Rest
  // stehen bleiben. Geprueft wird deshalb jede gespiegelte Stelle gegen ihre Grundregel.
  const mirrored = [
    // [Selektor rechts (Grundregel), Selektor links, Eigenschaft, erwartet rechts, erwartet links]
    ['.map-toolbar', ':root[data-handed="left"] .map-toolbar', 'flex-direction', null, 'row-reverse'],
    ['.toolbar-info', ':root[data-handed="left"] .toolbar-info', 'align-items', 'flex-start', 'flex-end'],
    ['.map-view-reset', ':root[data-handed="left"] .map-view-reset', 'right', 'var(--edge-gap)', 'auto'],
    ['.map-view-reset', ':root[data-handed="left"] .map-view-reset', 'left', null, 'var(--edge-gap)'],
    ['.map-corner-undo', ':root[data-handed="left"] .map-corner-undo', 'left', 'var(--edge-gap)', 'auto'],
    ['.map-corner-undo', ':root[data-handed="left"] .map-corner-undo', 'right', null, 'var(--edge-gap)'],
    ['.drive-mode-side', ':root[data-handed="left"] .drive-mode-side', 'align-self', 'flex-start', 'flex-end'],
    ['.capture-cluster', ':root[data-handed="left"] .capture-cluster', 'right', 'var(--edge-gap)', 'auto'],
    ['.capture-cluster', ':root[data-handed="left"] .capture-cluster', 'left', null, 'var(--edge-gap)'],
    ['.drive-side', ':root[data-handed="left"] .drive-side', 'grid-column', '1', '3'],
    ['.drive-meta', ':root[data-handed="left"] .drive-meta', 'text-align', 'right', 'left'],
    ['.fab-label', ':root[data-handed="left"] .capture-cluster .fab-label', 'left', null, '100%'],
    ['.fab-label', ':root[data-handed="left"] .capture-cluster .fab-label', 'right', '100%', 'auto'],
  ];
  for (const [rightSel, leftSel, prop, expectRight, expectLeft] of mirrored) {
    assert.strictEqual(resolve(rightSel, prop).value, expectRight, `${rightSel} { ${prop} } (Rechtshaender)`);
    assert.strictEqual(resolve(leftSel, prop).value, expectLeft, `${leftSel} { ${prop} } (Linkshaender)`);
  }
  // Alles haengt an einem einzigen Attribut, nicht an mehreren nebeneinander.
  assert.ok(!css.includes('data-label-side'), 'die alte, nur fuer die Fahrzone gueltige Umschaltung ist weg');
  const handedRules = (css.match(/:root\[data-handed="left"\]/g) || []).length;
  assert.ok(handedRules >= 5, `alle Stellen haengen an data-handed, gefunden: ${handedRules}`);
});

test('Rechtshaender bleibt der unveraenderte Standard', () => {
  // Die Grundregeln beschreiben Rechtshaender; nur die Linkshaender-Seite wird ueberschrieben.
  // Damit aendert sich fuer bestehende Nutzer nichts, solange sie nichts umstellen.
  const html2 = html;
  assert.ok(/<select id="handedSelect">[\s\S]*?<option[^>]*selected=""[^>]*value="right"/.test(html2),
    'Rechtshaender ist in der Auswahl vorbelegt');
  assert.ok(!html2.includes('data-label-side'), 'kein Restattribut im Markup');
  assert.strictEqual(resolve('.capture-cluster', 'right').value, 'var(--edge-gap)', 'Aufnahme-Knopf unten rechts');
  assert.strictEqual(resolve('.drive-side', 'grid-column').value, '1', 'Fahrtanzeige links');
});

test('Flaechen und Texte der Kartenpruefung folgen den Theme-Tokens', () => {
  // Der Fehler: `.validation-summary` hatte einen fest verdrahteten fast schwarzen Hintergrund,
  // und der Hell-Modus ueberschrieb nur die Schriftfarbe. Ergebnis war dunkler Text auf
  // dunklem Kasten — im Dunkel-Modus unauffaellig, im Hell-Modus unlesbar. Ein Token gilt fuer
  // beide Modi, deshalb wird hier auf Tokens geprueft und nicht auf zwei Farbwerte.
  const tokenised = (selector, property) => {
    const value = resolve(selector, property).value || '';
    assert.ok(/var\(--shell-/.test(value),
      `${selector} { ${property}: ${value || '—'} } muss ein --shell-Token nutzen`);
  };
  for (const property of ['background', 'border', 'color']) tokenised('.validation-summary', property);

  // Die Ergebnisliste darunter hat keinen eigenen Hintergrund, ihre Schriftfarbe war fuer den
  // Hell-Modus aber schon gepflegt — das muss so bleiben.
  assert.ok(/var\(--shell-/.test(resolve(':root[data-theme="light"] .validation-item', 'color').value || ''),
    'die Meldungszeilen brauchen im Hell-Modus eine eigene Farbe');

  // Kein fester Dunkelwert darf zurueckkommen.
  const rule = css.slice(css.indexOf('.validation-summary {'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(body), `feste Farbe in .validation-summary: ${body.trim()}`);
});

test('Auch die Kaesten der Hilfe nutzen Theme-Tokens statt fester Dunkelwerte', () => {
  // Dieselbe Ursache, gefunden beim Nachziehen der Kartenpruefung: diese Flaechen behielten im
  // Hell-Modus ihren fast schwarzen Hintergrund (#0a1013), weil dort nur die Rahmenfarbe
  // ueberschrieben war.
  for (const selector of ['.help-status-row', '.compat-item', '.help-feature-grid > div',
    '.format-card', '.faq-list details']) {
    const value = resolve(selector, 'background').value || '';
    assert.ok(/var\(--shell-/.test(value), `${selector} { background: ${value || '—'} }`);
  }
  assert.ok(!css.includes('#0a1013'), 'der feste Dunkelwert darf nirgends mehr stehen');
  assert.ok(/var\(--shell-/.test(resolve('.view-divider', 'background').value || ''),
    'auch die Trennlinie war fest dunkel');
});

test('Umschalter und Fahrtanzeige stehen uebereinander in einer Seitenspalte', () => {
  // Der Rueckfall: der Umschalter sass absolut neben dem Fahrfeld und reservierte sich ueber
  // einen Aussenabstand genau die Breite, die der Fahrtanzeige in derselben Seitenspalte dann
  // fehlte — „Fahrt gestoppt“ wurde am Rand abgeschnitten. Jetzt teilen sich beide die
  // Aussenspalte als Stapel: Knopf oben, Anzeige darunter.
  const zone = html.slice(html.indexOf('id="driveZone"'), html.indexOf('</section>', html.indexOf('id="driveZone"')));
  const field = zone.slice(zone.indexOf('id="driveControlArea"'), zone.indexOf('class="drive-side"'));
  const side = zone.slice(zone.indexOf('class="drive-side"'));
  for (const id of ['driveJoystick', 'driveButtons']) {
    assert.ok(field.includes(`id="${id}"`), `${id} gehoert in das gemeinsame Fahrfeld`);
  }
  assert.ok(!field.includes('id="driveModeBtn"'), 'der Umschalter liegt nicht mehr im Fahrfeld');
  assert.ok(side.indexOf('id="driveModeBtn"') !== -1 && side.indexOf('id="driveModeBtn"') < side.indexOf('class="drive-meta"'),
    'Seitenspalte: Umschalter oben, Fahrtanzeige darunter');
  assert.strictEqual(resolve('.drive-side', 'flex-direction').value, 'column', 'uebereinander, nicht nebeneinander');
  assert.strictEqual(resolve('.drive-side', 'grid-row').value, '1');
  assert.strictEqual(resolve('.drive-side', 'min-width').value, '0', 'die Spalte darf den Joystick nicht wegdruecken');
  // Kein absolutes Positionieren mehr: in einer eigenen Gitterspalte kann der Knopf den Kreis
  // nicht ueberlappen — und braucht keinen reservierten Aussenabstand am Feld.
  assert.strictEqual(resolve('.drive-mode-side', 'position').value, null);
  assert.ok(!css.includes('--drive-toggle-gap') && !css.includes('drive-mode-corner'),
    'weder Aussenabstand noch Ecken-Regel duerfen zurueckkehren');
  assert.ok(!/margin:[^;]*var\(--drive-toggle-gap\)/.test(css));
  // Seite je Haendigkeit: Rechtshaender links vom Kreis (Spalte 1), Linkshaender rechts (Spalte 3).
  assert.strictEqual(resolve('.drive-side', 'grid-column').value, '1');
  assert.strictEqual(resolve(':root[data-handed="left"] .drive-side', 'grid-column').value, '3');
  assert.strictEqual(resolve('.drive-zone .drive-control', 'grid-column').value, '2', 'der Kreis bleibt mittig');
  // Der Fahrtanzeige-Text darf umbrechen, aber nie still abgeschnitten werden.
  assert.strictEqual(resolve('.drive-meta', 'overflow').value, 'hidden');
  assert.strictEqual(resolve('.drive-meta', 'text-overflow').value, 'ellipsis', 'Kuerzung sichtbar als „…“');
  assert.strictEqual(resolve('.drive-meta', 'max-width').value, '100%');
  assert.strictEqual(resolve('.drive-meta', 'grid-column').value, null, 'kein eigener Gitterplatz mehr');
});

test('Der Joystick-Umschalter sitzt oben in der Steuerzone, senkrecht unter dem Rueckgaengig-Knopf', () => {
  // Der Rueckfall: `.drive-side` erbte `align-items: center` von der Fahrzone, der Stapel aus
  // Umschalter und Fahrtanzeige stand also mittig — der Umschalter landete tief unten neben der
  // Anzeige statt oben unter dem Rueckgaengig-Knopf der Karte.
  assert.strictEqual(resolve('.drive-zone', 'align-items').value, 'center',
    'die Grundregel der Zone zentriert weiterhin, deshalb braucht die Spalte ihr eigenes align-self');
  assert.strictEqual(resolve('.drive-side', 'align-self').value, 'stretch',
    'nur eine hoehenfuellende Spalte haengt ihr erstes Kind am oberen Rand ein');
  // Senkrechte Reihenfolge kommt aus der DOM-Reihenfolge: Umschalter oben, Anzeige darunter.
  const zone = html.slice(html.indexOf('id="driveZone"'), html.indexOf('</section>', html.indexOf('id="driveZone"')));
  const side = zone.slice(zone.indexOf('class="drive-side"'));
  assert.ok(side.indexOf('id="driveModeBtn"') < side.indexOf('class="drive-meta"'),
    'der Umschalter ist das erste Kind und sitzt damit oben');
  assert.strictEqual(resolve('.drive-side', 'flex-direction').value, 'column');
  // Die Anzeige behaelt ihre senkrechte Mitte, statt gleich unter dem Umschalter zu kleben.
  assert.strictEqual(resolve('.drive-meta', 'margin-block').value, 'auto');
  // Waagerecht auf derselben Seite und Linie wie der Rueckgaengig-Knopf: beide an der
  // Aussenkante, beide mit --edge-gap Abstand zum Bildschirmrand.
  const pairs = [
    ['.map-corner-undo', 'left', '.drive-mode-side', 'flex-start'],
    [':root[data-handed="left"] .map-corner-undo', 'right', ':root[data-handed="left"] .drive-mode-side', 'flex-end'],
  ];
  for (const [undoSel, undoProp, toggleSel, expected] of pairs) {
    assert.strictEqual(resolve(undoSel, undoProp).value, 'var(--edge-gap)', `${undoSel} { ${undoProp} }`);
    assert.strictEqual(resolve(toggleSel, 'align-self').value, expected,
      `${toggleSel} muss an dieselbe Aussenkante wie der Rueckgaengig-Knopf`);
  }
  // Knapper Abstand: zwischen beiden liegt nur der untere Rand der Karte und der obere
  // Innenabstand der Fahrzone — kein zusaetzlicher Aussenabstand am Umschalter.
  assert.strictEqual(resolve('.drive-mode-side', 'margin-top').value, null);
  assert.strictEqual(resolve('.drive-mode-side', 'position').value, null,
    'kein Rueckfall auf absolutes Positionieren');
});

test('Umschalter und Rueckgaengig-Knopf stehen auf derselben Mittelachse', () => {
  // Gleicher Randabstand allein reicht nicht: der Rueckgaengig-Knopf ist 48 px breit, der
  // Umschalter nur 34 px. Buendig links standen sie deshalb sichtbar versetzt uebereinander.
  // Der Umschalter rueckt um die halbe Differenz ein, beide Mitten liegen dann exakt gleich.
  const px = (sel, prop) => parseFloat(resolve(sel, prop).value);
  const gap = px(':root', '--edge-gap');
  const fab = px(':root', '--fab-size');
  const toggle = px('.drive-mode-side', '--drive-toggle-size');
  assert.ok(gap > 0 && fab > 0 && toggle > 0, 'alle drei Kennzahlen stehen als Token im Stylesheet');
  // Beide runden Randknoepfe leiten ihre Groesse aus demselben Token ab.
  for (const selector of ['.undo-fab', '.auto-fab']) {
    assert.strictEqual(resolve(selector, 'width').value, 'var(--fab-size)', `${selector} nutzt das Token`);
  }
  const inset = (resolve('.drive-mode-side', '--drive-toggle-inset').value || '').replace(/\s+/g, ' ');
  assert.ok(inset.includes('var(--fab-size)') && inset.includes('var(--drive-toggle-size)'),
    `die Einrueckung muss aus beiden Breiten folgen, ist "${inset}"`);
  assert.strictEqual(resolve('.drive-mode-side', 'margin-left').value, 'var(--drive-toggle-inset)');
  // Nachgerechnet: gleiche Mitte, nicht nur gleicher Rand.
  const undoCentre = gap + fab / 2;
  const toggleCentre = gap + (fab - toggle) / 2 + toggle / 2;
  assert.strictEqual(toggleCentre, undoCentre, `Mitten: Umschalter ${toggleCentre}, Rueckgaengig ${undoCentre}`);
  // Linkshaender: gespiegelt eingerueckt, und die linke Einrueckung muss zurueckgesetzt werden.
  assert.strictEqual(resolve(':root[data-handed="left"] .drive-mode-side', 'margin-right').value,
    'var(--drive-toggle-inset)');
  assert.strictEqual(resolve(':root[data-handed="left"] .drive-mode-side', 'margin-left').value, '0',
    'sonst wirken beide Einrueckungen gleichzeitig');
});

test('Das Tastenkreuz hat dieselbe Randbox wie der Joystick — kein Ueberhang nach unten', () => {
  // **Die tatsaechliche Ursache der abgeschnittenen Taste.** Eine Altlast aus einem frueheren
  // Layer, `.drive-pad { margin: 16px auto 10px }`, traf das Kreuz weiterhin; die neuere Regel
  // `.drive-zone .drive-pad` setzte zwar Groesse und Luecke, aber nie `margin`. Der runde
  // Joystick setzt in `.drive-zone .joystick-base` ausdruecklich `margin: 0` und war deshalb nie
  // betroffen. Geprueft wird deshalb elementbezogen ueber die **ganze** Kaskade, nicht nur ueber
  // den Selektortext — genau daran ist der erste Fixversuch vorbeigelaufen.
  const field = { ancestors: ['drive-zone', 'drive-control'], tag: 'div' };
  const pad = (prop) => effectiveStyle({ ...field, classes: ['drive-pad'] }, prop);
  const circle = (prop) => effectiveStyle({ ...field, classes: ['joystick-base'] }, prop);
  const padMargin = pad('margin');
  assert.strictEqual(padMargin.value, '0',
    `das Kreuz erbt einen Aussenabstand aus "${padMargin.selector}": ${padMargin.value}`);
  for (const prop of ['margin', 'width', 'height']) {
    assert.strictEqual(pad(prop).value, circle(prop).value,
      `${prop}: Kreuz und Kreis muessen dieselbe Box haben, sonst laeuft eines der beiden heraus`);
  }
  // Geschlossene Rechnung, warum ein positiver oberer Aussenabstand **immer** abschneidet:
  // Zonenhoehe = padTop + Feld F + padBottom. Die Zone sitzt am unteren Bildschirmrand, ihre
  // Inhaltsoberkante liegt also bei H - padTop - F - padBottom + padTop = H - F - padBottom.
  // Das Kreuz ist F hoch, beginnt aber bei + marginTop → seine Unterkante liegt bei
  // H - padBottom + marginTop. Erlaubt ist hoechstens H - padBottom. Jedes marginTop > 0
  // schneidet ab, **unabhaengig von F** und damit von der Groessenstufe. Genau das Symptom.
  const [marginTop, , marginBottom] = (padMargin.value || '0').split(/\s+/);
  const overhang = parseFloat(marginTop) + parseFloat(marginBottom === undefined ? marginTop : marginBottom);
  assert.strictEqual(overhang, 0, `Ueberhang ${overhang}px ragt unten aus dem Fahrfeld heraus`);
  // Waagerecht ebenso: eine Mindestbreite je Spalte aus der Altlast wuerde das Kreuz in
  // schmalen Feldern seitlich heraustreiben.
  const columns = pad('grid-template-columns').value || '';
  assert.ok(!/minmax/.test(columns), `feste Mindestbreiten sprengen schmale Felder: ${columns}`);
  // Und die Bereichsnamen der Altlast sind zurueckgesetzt.
  assert.strictEqual(pad('grid-template-areas').value, 'none');
  // Seit dem diagonalen Schnitt ist die Flaeche kein Raster mehr. Die Altlast beschreibt aber
  // weiterhin eines; sie darf nicht wieder greifen koennen, sonst stuenden die beschnittenen
  // Tasten ploetzlich in Zellen und das Kreuz saehe wieder aus wie vorher.
  assert.strictEqual(pad('display').value, 'block',
    'die Flaeche traegt die Tasten uebereinander und trennt sie per clip-path, nicht in Zellen');
});

test('Das Tastenkreuz bleibt im Cursor-Modus auf dem Schirm — nachgerechnet je Groessenstufe', () => {
  // Ausdruecklich der **Cursor-Modus**: gerechnet wird mit der Randbox des Kreuzes, nicht mit
  // der des Kreises. Beide teilen sich zwar `--joystick-size`, aber nur die Randbox entscheidet,
  // was unten aus der Zone laeuft.
  const px = (sel, prop) => parseFloat(resolve(sel, prop).value);
  const field = { ancestors: ['drive-zone', 'drive-control'], tag: 'div' };
  const margin = (effectiveStyle({ ...field, classes: ['drive-pad'] }, 'margin').value || '0').split(/\s+/);
  const marginTop = parseFloat(margin[0]);
  const marginBottom = parseFloat(margin[2] === undefined ? margin[0] : margin[2]);
  // Innenabstaende der Zone aus dem Stylesheet; env(safe-area-inset-bottom) ist auf Android
  // haeufig 0 — der unguenstigste und zugleich haeufigste Fall.
  const padTop = 8;
  const padBottom = 8;
  const keyMin = px('.drive-zone .drive-control', '--drive-pad-key-min');
  const padGap = px('.drive-zone .drive-control', '--drive-pad-gap');
  const reserve = px('.drive-zone .drive-control', '--drive-side-reserve');
  const padMinHeight = 3 * keyMin + 2 * padGap;
  const appbar = 56; // Kopfzeile, grosszuegig angesetzt
  for (const [w, h] of [[360, 640], [360, 800], [320, 568], [412, 915], [393, 786]]) {
    for (const scale of [0.75, 1, 1.25, 1.5]) {
      const fieldSize = Math.max(padMinHeight,
        Math.min(25 * h / 100 * scale, 240 * scale, 38 * h / 100, w - reserve));
      const zoneHeight = padTop + Math.max(fieldSize, marginTop + fieldSize + marginBottom) + padBottom;
      // Unterkante des Kreuzes auf dem Schirm, gemessen von oben.
      const padBottomEdge = h - zoneHeight + padTop + marginTop + fieldSize;
      assert.ok(padBottomEdge <= h - padBottom + 0.001,
        `${w}x${h} Stufe ${scale}: Kreuz endet bei ${padBottomEdge}px, erlaubt sind ${h - padBottom}px`);
      // Und es bleibt Platz fuer Kopfzeile und Karte, die Zone darf den Schirm nicht sprengen.
      assert.ok(zoneHeight + appbar <= h,
        `${w}x${h} Stufe ${scale}: Fahrzone ${zoneHeight}px plus Kopfzeile passt nicht in ${h}px`);
      // Jede einzelne Taste bleibt ein Daumenziel.
      const keySize = (fieldSize - 2 * padGap) / 3;
      assert.ok(keySize >= 44, `${w}x${h} Stufe ${scale}: Taste nur ${keySize.toFixed(1)}px`);
    }
  }
});

/**
 * **Gemeinsamer Rechner fuer das Tastenkreuz.** Die vier `clip-path`-Polygone und die Kaesten der
 * Chevrons werden aus dem Stylesheet **ausgewertet**, nicht nachgebildet: Token aufloesen,
 * Prozente auf die Feldgroesse beziehen, dann die reine Arithmetik rechnen. Ein falscher Faktor
 * faellt damit auf, auch wenn er fuer sich genommen plausibel aussieht.
 *
 * Hier steht er einmal, weil drei Faelle darauf zugreifen: Fugen und Schranken, der Inkreis der
 * Drehtasten und die Lage der Chevrons.
 */
const drive = (() => {
  const CTL = '.drive-zone .drive-control';
  const raw = (sel, prop) => (resolve(sel, prop).value || '').replace(/\s+/g, ' ').trim();
  const px = (sel, prop) => parseFloat(raw(sel, prop));
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const bounds = [...app.matchAll(/until:\s*([\d.]+)/g)].map((m) => Number(m[1]));

  const tokens = {};
  for (const name of ['--drive-pad-gap', '--drive-pad-key-min', '--drive-pad-cut-x', '--drive-pad-cut-y',
    '--drive-pad-waist', '--drive-pad-waist-half', '--drive-pad-waist-lift', '--drive-pad-waist-slide',
    '--drive-chevron-air', '--drive-chevron-stroke', '--drive-chevron-stroke-min', '--drive-chevron-turn',
    '--drive-chevron-dim-slow', '--drive-chevron-dim-normal', '--drive-chevron-dim-fast',
    '--drive-chevron-rise-slow', '--drive-chevron-rise-normal', '--drive-chevron-rise-fast',
    '--drive-chevron-rise-turn']) tokens[name] = raw(CTL, name);
  for (const name of ['--zone-inner', '--zone-outer', '--drive-turn-depth',
    '--key-size', '--key-half', '--drive-pad-waist-half-len']) tokens[name] = raw('.drive-key', name);
  // Die beiden Zonengrenzen setzt `applyDriveZonePreferences()` aus DRIVE_ZONES. Eingesetzt
  // werden genau diese Werte — das Stylesheet wird damit gegen die **gefahrenen** Grenzen
  // nachgerechnet und nicht gegen seinen eigenen Rueckfallwert.
  // Seit die Chevrons ihre Masse in px brauchen, setzt `applyDriveZonePreferences()` den
  // **blossen Anteil** (0,5) statt eines Prozentwerts — nur eine Zahl laesst sich mit der
  // Tastenkante multiplizieren, und `stroke-width` vertraegt keine Prozente.
  tokens['--drive-zone-inner'] = `${bounds[0]}`;
  tokens['--drive-zone-outer'] = `${bounds[1]}`;

  const substitute = (expr, extra = {}) => {
    const all = { ...tokens, ...extra };
    let out = expr;
    for (let i = 0; i < 16 && /var\(/.test(out); i += 1) {
      out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/g, (m, name) => {
        assert.ok(all[name] !== undefined && all[name] !== '', `unbekanntes Token ${name} in "${expr}"`);
        return `(${all[name]})`;
      });
    }
    assert.ok(!/var\(/.test(out), `var() nicht aufloesbar in "${expr}"`);
    return out;
  };
  const toPx = (expr, F, extra = {}) => {
    // `--joystick-size` **ist** die Feldgroesse: `.drive-control` nimmt daraus Breite und Hoehe,
    // die vier Tasten liegen `inset: 0` darueber. Deshalb wird sie hier durch F ersetzt statt
    // ihre clamp()-Kette nachzubilden.
    let t = substitute(expr, { '--joystick-size': `${F}px`, ...extra })
      .replace(/\b(max|min)\(/g, 'Math.$1(')
      .replace(/\bcalc\(/g, '(')
      .replace(/([\d.]+)%/g, (m, n) => `(${F} * ${n} / 100)`)
      .replace(/([\d.]+)px/g, '$1');
    const rein = t.replace(/Math\.(max|min)/g, '');
    assert.ok(/^[\d\s().,+\-*/]+$/.test(rein), `unerwarteter Ausdruck: "${t}"`);
    return Function(`"use strict"; return (${t});`)();
  };
  /** „X Y, X Y, …" in Punkte zerlegen — calc() enthaelt keine Kommas, Klammertiefe genuegt. */
  const splitTop = (body, sep) => {
    const out = []; let depth = 0; let cur = '';
    for (const ch of body) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
  };
  const polygonOf = (dir, F) => {
    const clip = raw(`.drive-key.key-${dir}`, 'clip-path');
    assert.ok(clip.startsWith('polygon('), `.key-${dir} ist nicht beschnitten: "${clip}"`);
    // Keine Form darf eigene Masse schreiben: erlaubt sind nur Token und die Prozente 50/100.
    const bare = clip.replace(/var\([^()]*\)/g, '');
    for (const num of bare.match(/[\d.]+/g) || []) {
      assert.ok(num === '50' || num === '100',
        `.key-${dir} schreibt die eigene Zahl ${num} statt eines Token: "${clip}"`);
    }
    return splitTop(clip.slice('polygon('.length, -1), ',')
      .map((pt) => splitTop(pt, ' ').map((c) => toPx(c, F)));
  };

  // --- Abstand zweier konvexer Flaechen, ehrlich gemessen -------------------
  const segDist = (p, a, b) => {
    const vx = b[0] - a[0]; const vy = b[1] - a[1];
    const l2 = vx * vx + vy * vy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2)) : 0;
    return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
  };
  const inside = (p, poly) => {
    let pos = 0; let neg = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length];
      const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      if (cr > 1e-9) pos += 1;
      if (cr < -1e-9) neg += 1;
    }
    return pos === 0 || neg === 0;
  };
  /** 0, sobald sich die Flaechen ueberschneiden — sonst der kleinste Abstand Kante zu Kante. */
  const polyDistance = (A, B) => {
    for (const p of A) if (inside(p, B)) return 0;
    for (const p of B) if (inside(p, A)) return 0;
    let best = Infinity;
    for (let i = 0; i < A.length; i += 1) {
      for (let j = 0; j < B.length; j += 1) {
        const [a1, a2] = [A[i], A[(i + 1) % A.length]];
        const [b1, b2] = [B[j], B[(j + 1) % B.length]];
        best = Math.min(best, segDist(a1, b1, b2), segDist(a2, b1, b2), segDist(b1, a1, a2), segDist(b2, a1, a2));
      }
    }
    return best;
  };

  // --- Chevrons -------------------------------------------------------------
  const chevTokens = (dir, cls) => {
    const extra = {};
    for (const name of ['--chev-rise', '--chev-a0', '--chev-a1']) {
      const value = raw(`.drive-key .${cls}`, name);
      if (value) extra[name] = value;
    }
    for (const name of ['--chev-a', '--chev-w', '--chev-box-w', '--chev-box-h', '--chev-turn-x', '--chev-x', '--chev-y']) {
      const value = raw(`.key-${dir} .drive-chevron`, name);
      if (value) extra[name] = value;
    }
    return extra;
  };
  /**
   * Der umschliessende Kasten eines Chevrons in px. `overflow: visible` laesst den Strich ueber
   * den Pfad hinausstehen, der Kasten ist deshalb um die volle Strichstaerke groesser als das
   * Element — genauso, wie es am Geraet aussieht.
   */
  /**
   * Die Strichstaerke, alle Token eingesetzt — die Pruefung auf Prozente braucht den Klartext.
   * `--joystick-size` steht dabei als blosse Laenge `1px` ein: gefragt ist allein, ob im
   * Ausdruck ein **Prozentwert** ueberlebt, und die Feldgroesse ist per Bauart eine Laenge
   * (sie setzt Breite und Hoehe von `.drive-control`). Ein eigener Fall prueft das gesondert.
   */
  const chevronStrokeExpr = (dir, cls) =>
    substitute(raw('.drive-chevron', 'stroke-width'), { '--joystick-size': '1px', ...chevTokens(dir, cls) });
  const chevronBox = (dir, cls, F) => {
    const extra = chevTokens(dir, cls);
    const at = (name) => toPx(extra[name], F, extra);
    const stroke = toPx(raw('.drive-chevron', 'stroke-width'), F, extra);
    const w = at('--chev-box-w') + stroke;
    const h = at('--chev-box-h') + stroke;
    const cx = at('--chev-x');
    const cy = at('--chev-y');
    return { cx, cy, w, h, stroke, span: toPx(extra['--chev-w'], F, extra),
      rise: toPx('calc(var(--chev-w) * var(--chev-rise))', F, extra),
      corners: [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2],
        [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]] };
  };
  /** Das Band der Zone in Elementkoordinaten, laengs der Achse der Taste. */
  const chevronBand = (dir, cls, F) => {
    const extra = chevTokens(dir, cls);
    const a0 = toPx(extra['--chev-a0'], F, extra);
    const a1 = toPx(extra['--chev-a1'], F, extra);
    return dir === 'up' || dir === 'left' ? [F - a1, F - a0] : [a0, a1];
  };

  const keyMin = px(CTL, '--drive-pad-key-min');
  const padGap = px(CTL, '--drive-pad-gap');
  const waist = parseFloat(raw(CTL, '--drive-pad-waist'));
  const padMin = 3 * keyMin + 2 * padGap;
  const reserve = px(CTL, '--drive-side-reserve');
  const field = (scale, w, h) => Math.max(padMin,
    Math.min(25 * h / 100 * scale, 240 * scale, 38 * h / 100, w - reserve));
  /** Die zwanzig Faelle: fuenf gaengige Aufloesungen mal vier Groessenstufen. */
  const allFields = () => {
    const out = [];
    for (const [w, h] of [[360, 640], [360, 800], [320, 568], [412, 915], [393, 786]]) {
      for (const scale of [0.75, 1, 1.25, 1.5]) out.push([`${w}x${h} Stufe ${scale}`, field(scale, w, h)]);
    }
    return out;
  };

  return { raw, px, CTL, app, bounds, tokens, toPx, polygonOf, polyDistance, inside,
    chevronBox, chevronBand, chevronStrokeExpr, substitute, toPx, tokens,
    keyMin, padGap, waist, padMin, reserve, field, allFields };
})();

test('Die Sanduhrform: Fugen, Breiten und Schranken nachgerechnet', () => {
  // **Neu geschrieben, nicht angepasst.** Der Vorgaenger rechnete die Keilbreite als `2d - 2*cut`.
  // Das galt fuer das X durch die Mitte, wo alle vier Tasten dieselbe Form hatten. Seit der
  // Sanduhr sind es zwei verschiedene Formen: vor/zurueck sind Trapeze (aussen breit, zur Taille
  // hin schmaler), links/rechts Keile (aussen breit, nach innen auf eine Spitze zulaufend).
  // Eine gemeinsame Breitenformel gibt es nicht mehr, und die alte gilt fuer keine der beiden.
  const { raw, CTL, keyMin, padGap, waist, padMin, bounds, polygonOf, polyDistance, allFields } = drive;

  assert.ok(keyMin >= 44, `jede Taste bleibt ein Daumenziel (${keyMin}px)`);
  assert.ok(waist > 0 && waist < 1, `--drive-pad-waist muss zwischen 0 und 1 liegen, ist ${waist}`);
  // Die globale Mindesthoehe besteht weiter; die Ausnahme fuer die Tasten bleibt stehen, damit
  // ein Rueckbau auf ein Raster nicht dieselbe Falle stellt wie vor v46.
  assert.strictEqual(resolve('button', 'min-height').value, '46px');
  assert.strictEqual(resolve('.drive-key', 'min-height').value, '0');

  // --- Die beiden Fugenfaktoren muessen zur Taille passen ------------------
  // Die Faktoren sind ausgerechnet und koennen deshalb von der Taille abdriften — hier wird die
  // geschlossene Form nachgerechnet, statt den Zahlen zu glauben. (Ausgerechnet nicht, weil CSS
  // kein sqrt() haette — das gibt es seit Chrome 120 —, sondern weil ein nicht unterstuetzter
  // Ausdruck clip-path still ungueltig machen wuerde und dieser Test die Formen selbst auswertet.)
  const factorOf = (prop) => {
    const expr = raw(CTL, prop);
    assert.ok(/var\(--drive-pad-gap\)/.test(expr), `${prop} muss aus der Fuge folgen, ist "${expr}"`);
    return parseFloat((expr.match(/\*\s*([\d.]+)/) || [])[1]);
  };
  const wantX = Math.sqrt((1 - waist) ** 2 + 1) / 2;
  const wantY = wantX / (1 - waist);
  const facX = factorOf('--drive-pad-cut-x');
  const facY = factorOf('--drive-pad-cut-y');
  assert.ok(Math.abs(facX - wantX) < 1e-5,
    `--drive-pad-cut-x ist gap * ${facX}, zur Taille ${waist} gehoert gap * ${wantX.toFixed(6)}`);
  assert.ok(Math.abs(facY - wantY) < 1e-5,
    `--drive-pad-cut-y ist gap * ${facY}, zur Taille ${waist} gehoert gap * ${wantY.toFixed(6)}`);
  const cutX = padGap * facX;
  const cutY = padGap * facY;

  // --- Die Fuge zwischen **allen sechs** Paarungen -------------------------
  // Bis v63 wurde nur vorwaerts<->links gemessen, und zwar als Abstand zur **Geraden** durch die
  // Keilkante. Genau die eine Paarung, die dabei nie vorkam, war kaputt: vorwaerts und rueckwaerts
  // schrieben fuer ihre Taillenkante denselben Ausdruck und beruehrten sich auf 61,5 px Laenge
  // ohne jeden Abstand — waehrend zu den Keilen 4 px standen und das alte X dort sogar 5,66 px
  // liess. Gemessen wird deshalb jetzt Flaeche gegen Flaeche, mit echter Abstandsrechnung
  // (0, sobald sie sich ueberschneiden), fuer jede Paarung und jede der zwanzig Feldgroessen.
  const NACHBARN = [['up', 'down'], ['up', 'left'], ['up', 'right'], ['left', 'down'], ['right', 'down']];
  for (const [label, F] of allFields()) {
    const P = {
      up: polygonOf('up', F), down: polygonOf('down', F),
      left: polygonOf('left', F), right: polygonOf('right', F),
    };
    assert.strictEqual(P.up.length, 4, 'vorwaerts ist ein Trapez, kein Dreieck');
    assert.strictEqual(P.down.length, 4, 'rueckwaerts ist ein Trapez, kein Dreieck');
    assert.strictEqual(P.left.length, 3, 'links ist ein Keil');
    assert.strictEqual(P.right.length, 3, 'rechts ist ein Keil');
    for (const [a, b] of NACHBARN) {
      const d = polyDistance(P[a], P[b]);
      assert.ok(Math.abs(d - padGap) < 1e-6,
        `${label}: die Fuge zwischen ${a} und ${b} misst ${d.toFixed(6)}px statt ${padGap}px`);
    }
    // Links und rechts sind keine Nachbarn: zwischen ihren Spitzen bleibt das tote Feld, und es
    // darf nie unter die Fuge fallen (dann liefen die beiden Keile ineinander).
    const quer = polyDistance(P.left, P.right);
    assert.ok(quer >= padGap - 1e-6,
      `${label}: links und rechts stehen nur ${quer.toFixed(3)}px auseinander`);
    // Und zum Rand ist die Fuge genauso breit — der Grund fuer die Faktoren ueberhaupt.
    assert.ok(Math.abs(P.up[0][1] - padGap) < 1e-9, `${label}: vorwaerts haelt ${P.up[0][1]}px zum Rand`);
    assert.ok(Math.abs(P.left[0][0] - padGap) < 1e-9, `${label}: links haelt ${P.left[0][0]}px zum Rand`);
    // Die Taille ist breiter als die Fuge — sonst kippt das Trapez in sich zusammen.
    assert.ok(P.up[2][0] > P.up[3][0],
      `${label}: die Taille ist mit ${(P.up[2][0] - P.up[3][0]).toFixed(2)}px nicht breiter als die Fuge`);
  }

  // --- Die Zonengrenzen stehen nur in app.js ------------------------------
  assert.deepStrictEqual(bounds, [0.50, 0.80, 1],
    `DRIVE_ZONES muss die drei Grenzen tragen, gefunden: ${bounds.join(', ')}`);
  const lines = raw('.drive-pad.zones-on .drive-key', 'background-image');
  for (const name of ['--drive-zone-inner', '--drive-zone-outer']) {
    const short = name.endsWith('inner') ? 'inner' : 'outer';
    // Die beiden Variablen stehen seit den Chevrons an `.drive-key` statt an
    // `.drive-pad.zones-on .drive-key` — der eine Chevron ohne Zonen braucht sie auch dann.
    assert.ok(lines.includes(name) || raw('.drive-key', `--zone-${short}`).includes(name),
      `die Grenzstriche muessen ${name} lesen statt eine eigene Prozentzahl: "${lines}"`);
  }
  // Links und rechts tragen keine Grenzen mehr — sie haben keine Zonen.
  for (const dir of ['left', 'right']) {
    assert.strictEqual(resolve(`.drive-pad.zones-on .key-${dir}`, 'background-image').value, 'none',
      `.key-${dir} darf keine Zonengrenzen zeichnen`);
    assert.strictEqual(resolve(`.drive-pad.zones-on .key-${dir}[data-zone]`, 'background-image').value, 'none',
      `.key-${dir} darf auch mit data-zone kein Band zeichnen`);
  }

  // --- Die 44-px-Bedingung, je Richtung verschieden -----------------------
  // **Vor/zurueck** ist ein Trapez: am schmalsten an der Taille, und die innere Zonengrenze
  // liegt ein Stueck weiter aussen. **Links/rechts** ist ein Keil — was dort zaehlt, rechnet der
  // eigene Fall „Der Inkreis der Drehtasten" nach; die Aussenkante allein taeuscht.
  const widthUD = (F, d) => 2 * (waist * (F / 2 - padGap) + (1 - waist) * d - cutX + padGap / 2 * (1 - waist));
  const outerLR = (F) => 2 * (F / 2 - padGap - cutY);
  for (const [label, F] of allFields()) {
    const up = drive.polygonOf('up', F);
    const left = drive.polygonOf('left', F);
    assert.ok(Math.abs((up[2][0] - up[3][0]) - widthUD(F, 0)) < 1e-6,
      `${label}: Taille gerechnet ${widthUD(F, 0).toFixed(3)}px, im Polygon ${(up[2][0] - up[3][0]).toFixed(3)}px`);
    assert.ok(Math.abs((left[2][1] - left[0][1]) - outerLR(F)) < 1e-6,
      `${label}: Aussenkante gerechnet ${outerLR(F).toFixed(3)}px, im Polygon ${(left[2][1] - left[0][1]).toFixed(3)}px`);

    assert.ok(outerLR(F) >= keyMin,
      `${label}: der Keil links/rechts ist an der Aussenkante nur ${outerLR(F).toFixed(1)}px hoch`);
    assert.ok(widthUD(F, 0) >= keyMin,
      `${label}: das Trapez ist an der Taille nur ${widthUD(F, 0).toFixed(1)}px breit`);
    assert.ok(widthUD(F, bounds[0] * F / 2) >= keyMin,
      `${label}: an der inneren Zonengrenze nur ${widthUD(F, bounds[0] * F / 2).toFixed(1)}px breit`);
    // Vor/zurueck ist laenger als die Taste im alten Dreierraster — das war der Zweck des
    // diagonalen Schnitts. Fuer links/rechts gilt das ausdruecklich **nicht**.
    const lengthUD = F / 2 - padGap - padGap / 2;
    const lengthBefore = (F - 2 * padGap) / 3;
    assert.ok(lengthUD > lengthBefore,
      `${label}: vorwaerts ist mit ${lengthUD.toFixed(1)}px nicht laenger als die fruehere Taste (${lengthBefore.toFixed(1)}px)`);
  }

  // --- Die Schranke fuer --drive-field-min, aus den drei Bedingungen -------
  const fieldMinExpr = raw(CTL, '--drive-field-min');
  assert.ok(/3 \* var\(--drive-pad-key-min\)/.test(fieldMinExpr),
    `die Untergrenze muss nachvollziehbar bleiben, ist "${fieldMinExpr}"`);
  const needOuter = keyMin + 2 * padGap + 2 * cutY;
  const needWaist = 2 * ((keyMin / 2 + cutX - padGap / 2 * (1 - waist)) / waist + padGap);
  const needInner = (keyMin / 2 + cutX - padGap / 2 * (1 - waist) + waist * padGap)
    / (waist / 2 + (1 - waist) * bounds[0] / 2);
  for (const [name, need] of [['Aussenkante links/rechts', needOuter],
    ['Taille vor/zurueck', needWaist], ['innere Zonengrenze', needInner]]) {
    assert.ok(padMin >= need,
      `die Feld-Untergrenze ${padMin}px unterschreitet die Bedingung „${name}" (${need.toFixed(1)}px)`);
  }

  // Und das Kreuz fuellt dasselbe Feld wie der Kreis — eine Platzpruefung fuer beide Modi.
  for (const selector of ['.drive-zone .joystick-base', '.drive-zone .drive-pad']) {
    assert.strictEqual(resolve(selector, 'height').value, '100%', `${selector} fuellt das Feld`);
  }
});

test('Der Inkreis der Drehtasten und die Schwelle, an der der Hinweis verschwindet', () => {
  // `turnKeyIncircle()` in app.js ist die **einzige** Stelle, die beurteilt, ob eine Drehtaste
  // noch ein Daumenziel ist. Hier wird sie gegen die tatsaechlich ausgewerteten clip-path-Polygone
  // gerechnet — nicht gegen eine zweite Formel, die dieselben Annahmen wiederholte.
  const { app, padGap, waist, keyMin, polygonOf, allFields, inside } = drive;
  const { loadApp } = require('./app-harness.js');
  const { t } = loadApp({ exportNames: ['turnKeyIncircle'] });

  /** Groesster Kreis im Polygon, direkt gemessen: Mittelpunkt maximalen Randabstands. */
  const incircleOfPolygon = (poly) => {
    const edgeDist = (p) => Math.min(...poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / len;
    }));
    const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
    let best = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    if (!inside(best, poly)) best = [poly[0][0], poly[0][1]];
    let step = Math.max(...xs) - Math.min(...xs);
    let value = inside(best, poly) ? edgeDist(best) : 0;
    for (let i = 0; i < 200; i += 1) {
      let moved = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const p = [best[0] + dx * step, best[1] + dy * step];
        if (!inside(p, poly)) continue;
        const d = edgeDist(p);
        if (d > value) { value = d; best = p; moved = true; }
      }
      if (!moved) step /= 2;
      if (step < 1e-7) break;
    }
    return 2 * value;
  };

  let unter = 0;
  for (const [label, F] of allFields()) {
    for (const dir of ['left', 'right']) {
      const gemessen = incircleOfPolygon(polygonOf(dir, F));
      const gerechnet = t.turnKeyIncircle(F, padGap, waist);
      assert.ok(Math.abs(gemessen - gerechnet) < 1e-3,
        `${label} ${dir}: turnKeyIncircle sagt ${gerechnet.toFixed(4)}px, im Polygon stecken ${gemessen.toFixed(4)}px`);
    }
    if (t.turnKeyIncircle(F, padGap, waist) < keyMin) unter += 1;
  }
  // Der Befund, der die Hinweiszeile ueberhaupt noetig macht — festgehalten, nicht behauptet.
  assert.strictEqual(unter, 12, `der Keil unterschreitet ${keyMin}px in ${unter} statt 12 der 20 Faelle`);

  // Die Schwelle wird **abgeleitet**, nicht hingeschrieben.
  let lo = 100; let hi = 400;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (t.turnKeyIncircle(mid, padGap, waist) >= keyMin) hi = mid; else lo = mid;
  }
  assert.ok(Math.abs(Math.ceil(hi * 100) / 100 - 203.34) < 1e-9,
    `voll ab ${(Math.ceil(hi * 100) / 100).toFixed(2)}px statt 203.34px Feldgroesse`);
  assert.ok(t.turnKeyIncircle(140, padGap, waist) < 29.1 && t.turnKeyIncircle(140, padGap, waist) > 29.0,
    'im kleinsten Fall bleiben rund 29,0px');
  // Unbrauchbare Eingaben liefern 0 und damit „zu schmal" — nie eine geratene Zahl.
  for (const args of [[0, padGap, waist], [140, padGap, 0], [140, padGap, 1], [8, padGap, waist]]) {
    assert.strictEqual(t.turnKeyIncircle(...args), 0, `turnKeyIncircle(${args}) muss 0 liefern`);
  }

  // --- Waechter: keine zweite Rechnung daneben -----------------------------
  assert.strictEqual((app.match(/function turnKeyIncircle\(/g) || []).length, 1,
    'turnKeyIncircle darf es nur einmal geben');
  assert.strictEqual((app.match(/turnKeyIncircle\(/g) || []).length, 2,
    'genau eine Definition und genau ein Aufrufer — sonst steht die Beurteilung an zwei Stellen');
  assert.strictEqual((app.match(/Math\.sqrt\(\(1 - /g) || []).length, 1,
    'die Fugenfaktoren duerfen nur in turnKeyIncircle nachgerechnet werden');
  assert.ok(!/203[.,]3/.test(app),
    'die Schwelle gehoert nicht als Zahl in den Code — sie folgt aus der Funktion');
  // Und die 44 px kommen aus dem Stylesheet, nicht aus einer zweiten Zahl in app.js.
  assert.ok(/--drive-pad-key-min/.test(app) && /shape\.keyMin/.test(app),
    'das Daumenmass muss aus --drive-pad-key-min gelesen werden');
  const hintBody = app.slice(app.indexOf('function refreshTurnKeyHint'),
    app.indexOf('function refreshDriveZoneHint'));
  assert.ok(!/\b44\b/.test(hintBody), 'in der Hinweiszeile darf keine eigene 44 stehen');
  assert.ok(/driveControl === 'buttons'/.test(hintBody),
    'die Zeile gilt nur im Tastenmodus — im Joystick-Modus gibt es keine Drehtasten');
});

test('Die Chevrons: Anzahl, Sichtbarkeit und Lage', () => {
  const { padGap, polygonOf, chevronBox, chevronBand, allFields, inside, raw } = drive;

  // --- Anzahl im Markup ----------------------------------------------------
  const buttonOf = (dir) => {
    const m = html.match(new RegExp(`<button[^>]*data-direction="${dir}"[^>]*>([\\s\\S]*?)</button>`));
    assert.ok(m, `die Taste ${dir} fehlt im Markup`);
    return m[1];
  };
  for (const [dir, anzahl] of [['up', 3], ['down', 3], ['left', 1], ['right', 1]]) {
    const body = buttonOf(dir);
    const chevrons = body.match(/class="drive-chevron[^"]*"/g) || [];
    assert.strictEqual(chevrons.length, anzahl,
      `${dir} traegt ${chevrons.length} Chevrons statt ${anzahl}`);
    assert.strictEqual((body.match(/<svg/g) || []).length, anzahl,
      `${dir} darf ausser den Chevrons kein weiteres Symbol tragen`);
    assert.strictEqual((body.match(/aria-hidden="true"/g) || []).length, anzahl,
      `${dir}: jedes Chevron muss aria-hidden sein, der Name steht am Button`);
  }
  for (const [dir, klassen] of [['up', ['chev-slow', 'chev-normal', 'chev-fast']],
    ['down', ['chev-slow', 'chev-normal', 'chev-fast']], ['left', ['chev-turn']], ['right', ['chev-turn']]]) {
    for (const cls of klassen) {
      assert.ok(buttonOf(dir).includes(cls), `${dir} fehlt der Chevron ${cls}`);
    }
  }
  // Der aria-Name haengt unveraendert am Button, nicht am Symbol.
  for (const dir of ['up', 'down', 'left', 'right']) {
    assert.ok(new RegExp(`<button[^>]*data-direction="${dir}"[^>]*data-i18n-aria-label=`).test(html)
      || new RegExp(`<button[^>]*data-i18n-aria-label=[^>]*data-direction="${dir}"`).test(html),
      `${dir} muss seinen Namen weiterhin als aria-label am Button tragen`);
  }
  // Reine Zeichnung: die Trefferflaeche bleibt die beschnittene Taste.
  assert.strictEqual(raw('.drive-chevron', 'pointer-events'), 'none',
    'ein Chevron darf nie das Ziel eines Tipps werden');

  // --- Sichtbarkeit, ueber die aufgeloeste Kaskade -------------------------
  // `getComputedStyle` gibt es hier nicht — dieser Test laeuft in reinem Node ohne Browser.
  // `effectiveStyle()` wertet stattdessen **jede** passende Regel aus und entscheidet nach
  // Spezifitaet und Reihenfolge; das ist die Frage „was sieht der Nutzer", nicht „was steht da".
  const sichtbar = (klassen, vorfahren) => {
    const value = effectiveStyle({ classes: klassen, ancestors: vorfahren, tag: 'svg' }, 'display').value;
    return value !== 'none';
  };
  const KEYS = [['up', ['chev-slow', 'chev-normal', 'chev-fast']], ['down', ['chev-slow', 'chev-normal', 'chev-fast']]];
  for (const [dir, klassen] of KEYS) {
    for (const merkmal of [[], ['[data-zone]']]) {
      const aus = ['drive-pad', 'drive-key', `key-${dir}`, ...merkmal];
      const an = ['drive-pad', 'zones-on', 'drive-key', `key-${dir}`, ...merkmal];
      const zahlAus = klassen.filter((c) => sichtbar(['drive-chevron', c], aus)).length;
      const zahlAn = klassen.filter((c) => sichtbar(['drive-chevron', c], an)).length;
      const wo = merkmal.length ? ' (mit data-zone)' : '';
      assert.strictEqual(zahlAus, 1, `${dir}: ohne Zonen muessen genau 1 Chevron sichtbar sein, es sind ${zahlAus}${wo}`);
      assert.strictEqual(zahlAn, 3, `${dir}: mit Zonen muessen genau 3 sichtbar sein, es sind ${zahlAn}${wo}`);
      assert.ok(sichtbar(['drive-chevron', 'chev-normal'], aus),
        `${dir}: ohne Zonen muss der Chevron der **normalen** Zone stehenbleiben${wo}`);
    }
  }
  // Die Drehtasten zeigen ihren einen Chevron in jedem Fall.
  for (const dir of ['left', 'right']) {
    for (const vorfahren of [['drive-pad', 'drive-key', `key-${dir}`],
      ['drive-pad', 'zones-on', 'drive-key', `key-${dir}`, '[data-zone]']]) {
      assert.ok(sichtbar(['drive-chevron', 'chev-turn'], vorfahren),
        `${dir}: der Dreh-Chevron muss immer sichtbar sein`);
    }
  }
  // Umgeschaltet wird allein ueber die Klasse am Feld — sonst koennte der Layout-Test die Frage
  // gar nicht statisch beantworten, und der Nachweis fiele auf „Absicht" zurueck.
  assert.ok(/zones-on/.test(drive.app) && /classList\.toggle\('zones-on'/.test(drive.app),
    'die Sichtbarkeit muss an der CSS-Klasse zones-on haengen');
  // Und `data-zone` darf an den Chevrons nichts veraendern: die aktive Zone zeigt allein das Band.
  for (const rule of rules) {
    for (const selector of rule.selectors || []) {
      if (!/chev-/.test(selector)) continue;
      assert.ok(!/data-zone/.test(selector),
        `keine Chevron-Regel darf sich an data-zone haengen: "${selector}"`);
    }
  }

  // --- Lage: aus den Zonengrenzen, ohne eigene Zahl ------------------------
  for (const [cls, quelle] of [['chev-slow', '--drive-zone-inner'], ['chev-normal', '--drive-zone-outer'],
    ['chev-fast', '--drive-zone-outer']]) {
    const kette = [raw('.key-up .drive-chevron', '--chev-a'),
      raw(`.drive-key .${cls}`, '--chev-a0'), raw(`.drive-key .${cls}`, '--chev-a1'),
      raw('.drive-key', '--zone-inner'), raw('.drive-key', '--zone-outer')].join(' ');
    assert.ok(kette.includes(quelle),
      `${cls} muss seine Lage aus ${quelle} beziehen statt aus einer eigenen Prozentzahl`);
  }
  for (const cls of ['chev-slow', 'chev-normal', 'chev-fast']) {
    for (const prop of ['--chev-a0', '--chev-a1']) {
      const expr = raw(`.drive-key .${cls}`, prop);
      const bare = expr.replace(/var\([^()]*\)/g, '');
      for (const num of bare.match(/[\d.]+/g) || []) {
        assert.ok(num === '50' || num === '100',
          `${cls} { ${prop} } schreibt die eigene Zahl ${num}: "${expr}"`);
      }
    }
  }

  // --- Der Kasten liegt im Band UND in der Taste, in allen 20 Faellen ------
  for (const [label, F] of allFields()) {
    for (const dir of ['up', 'down']) {
      const poly = polygonOf(dir, F);
      const breiten = [];
      for (const cls of ['chev-slow', 'chev-normal', 'chev-fast']) {
        const box = chevronBox(dir, cls, F);
        const [lo, hi] = chevronBand(dir, cls, F);
        breiten.push(box.w);
        for (const ecke of box.corners) {
          assert.ok(inside(ecke, poly),
            `${label} ${dir}/${cls}: die Ecke (${ecke[0].toFixed(1)}|${ecke[1].toFixed(1)}) liegt ausserhalb der Taste`);
        }
        assert.ok(box.cy - box.h / 2 >= lo - 1e-6 && box.cy + box.h / 2 <= hi + 1e-6,
          `${label} ${dir}/${cls}: der Kasten (${(box.cy - box.h / 2).toFixed(1)}..${(box.cy + box.h / 2).toFixed(1)}) verlaesst sein Band (${lo.toFixed(1)}..${hi.toFixed(1)})`);
        assert.ok(box.stroke > 0 && box.rise > 0 && box.span > 0,
          `${label} ${dir}/${cls}: entartete Masse`);
      }
      // Nach aussen breiter — der Zweck des nach aussen fallenden Anstiegs. Die Baender werden
      // nach aussen kuerzer (0,25 F / 0,15 F / 0,1 F - Fuge), ein gleichfoermig skalierter
      // Chevron wuerde dadurch nach aussen **kleiner**.
      assert.ok(breiten[0] < breiten[1] && breiten[1] < breiten[2],
        `${label} ${dir}: die Chevrons werden nach aussen nicht breiter (${breiten.map((b) => b.toFixed(1)).join(' / ')})`);
    }
    for (const dir of ['left', 'right']) {
      const poly = polygonOf(dir, F);
      const box = chevronBox(dir, 'chev-turn', F);
      for (const ecke of box.corners) {
        assert.ok(inside(ecke, poly),
          `${label} ${dir}: die Ecke (${ecke[0].toFixed(1)}|${ecke[1].toFixed(1)}) liegt ausserhalb des Keils`);
      }
      // 45-Grad-Form: der Anstieg misst genau die halbe Spanne.
      assert.ok(Math.abs(box.rise - box.span / 2) < 1e-6,
        `${label} ${dir}: der Dreh-Chevron ist nicht in 45-Grad-Form (${box.rise.toFixed(2)} zu ${box.span.toFixed(2)})`);
      // Und er ist deutlich groesser als der fruehere Mini-Pfeil (15 % der Taste).
      assert.ok(box.span > 0.15 * F,
        `${label} ${dir}: der Dreh-Chevron ist mit ${box.span.toFixed(1)}px nicht groesser als der fruehere Pfeil`);
    }
    assert.ok(padGap > 0);
  }
});

test('Die Chevrons sind im Browser sichtbar: Strich als Laenge, Farbe gegen den Tastenhintergrund', () => {
  // **Die Luecke, die v63 am Geraet unsichtbar gemacht hat.** Die uebrigen Faelle rechnen das
  // Stylesheet nach und beziehen dabei jeden Prozentwert auf die Feldgroesse — fuer Breite,
  // Hoehe und Lage ist das richtig. Fuer `stroke-width` ist es **falsch**: SVG loest einen
  // Prozentwert dort gegen die eigene viewBox auf, nicht gegen die Taste. Gemessen in
  // Chrome 153: `stroke-width: 2.82353%` (gemeint waren 3,95 px bei F = 140) kam als
  // **0,045 px** an, pixelgleich mit `stroke-width: 0.04464px` — Faktor 88 zu duenn. Die
  // Node-Tests liefen gruen, weil sie 3,95 px ausrechneten. Deshalb hier drei Zusicherungen,
  // die eine Zahl allein nicht liefern kann.
  const { chevronStrokeExpr, chevronBox, allFields, tokens, toPx } = drive;
  const KEYS = [['up', ['chev-slow', 'chev-normal', 'chev-fast']],
    ['down', ['chev-slow', 'chev-normal', 'chev-fast']],
    ['left', ['chev-turn']], ['right', ['chev-turn']]];

  // --- 1. Der Strich ist eine Laenge, niemals ein Prozentwert -----------------
  const feldGroesse = resolve('.drive-zone .drive-control', '--joystick-size').value;
  assert.ok(feldGroesse && !feldGroesse.includes('%'),
    `--joystick-size muss eine Laenge sein, damit der Strich eine Laenge werden kann: "${feldGroesse}"`);
  assert.strictEqual(resolve('.drive-key', '--key-size').value, 'var(--joystick-size)',
    'die Tastenkante muss die Feldgroesse sein — die Taste liegt inset: 0 darueber');
  for (const [dir, klassen] of KEYS) {
    for (const cls of klassen) {
      const expr = chevronStrokeExpr(dir, cls);
      assert.ok(!expr.includes('%'),
        `${dir}/${cls}: stroke-width darf keinen Prozentwert enthalten — SVG bezoege ihn auf die `
        + `viewBox statt auf die Taste: "${expr}"`);
    }
  }

  // --- 2. Und er bleibt beim kleinsten Feld ein sichtbarer Strich -------------
  const minStrich = parseFloat(tokens['--drive-chevron-stroke-min']);
  assert.ok(minStrich >= 2, `die Untergrenze des Strichs ist mit ${minStrich}px unter 2px`);
  const felder = allFields().map(([, F]) => F);
  const kleinste = Math.min(...felder);
  for (const [dir, klassen] of KEYS) {
    for (const cls of klassen) {
      const strich = chevronBox(dir, cls, kleinste).stroke;
      assert.ok(strich >= minStrich - 1e-9,
        `F = ${kleinste}: ${dir}/${cls} zeichnet mit ${strich.toFixed(2)}px, die Untergrenze ist ${minStrich}px`);
    }
  }

  // --- 3. Die Farbe ist in beiden Themes eine andere als der Tastenhintergrund -
  // Der Chevron erbt `currentColor` von der Taste; faerbte ein Theme beide gleich, waere er
  // vorhanden, gemessen richtig und trotzdem nicht zu sehen.
  assert.strictEqual(resolve('.drive-key', 'color').value, 'var(--shell-text)',
    'der Chevron lebt von currentColor der Taste');
  assert.strictEqual(resolve('.drive-key', 'background').value, 'var(--shell-panel)',
    'der Tastenhintergrund muss ein Token sein, sonst laesst er sich nicht gegenpruefen');
  // Beide Hell-Fassungen zaehlen: die Palette steht laut CLAUDE.md zweimal (Attributselektor
  // und Media-Query) und muss inhaltlich gleich bleiben.
  const themes = [['dunkel', ':root', {}], ['hell (Einstellung)', ':root[data-theme="light"]', {}],
    ['hell (Systemvorgabe)', ':root:not([data-theme="dark"])', { media: 'prefers-color-scheme: light' }]];
  for (const [label, sel, opt] of themes) {
    const grund = resolve(sel, '--shell-panel', opt).value;
    const schrift = resolve(sel, '--shell-text', opt).value;
    assert.ok(grund && schrift, `${label}: --shell-panel/--shell-text fehlen in ${sel}`);
    assert.notStrictEqual(grund, schrift,
      `${label}: Chevron und Tastenhintergrund haben dieselbe Farbe ${grund}`);
  }

  // --- 3b. Und app.js liefert die Grenze als blosse Zahl, nicht als Prozentwert ---
  // Die uebrigen Faelle setzen den Wert aus DRIVE_ZONES selbst ein und saehen deshalb nicht,
  // wenn `applyDriveZonePreferences()` wieder `%` anhaengt — dann truege die ganze Kette bis
  // zur Strichstaerke erneut einen Prozentwert, und der Strich verschwaende wieder.
  const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  for (const name of ['--drive-zone-inner', '--drive-zone-outer']) {
    const zeile = appSrc.split('\n').find((l) => l.includes(`'${name}'`) && l.includes('setProperty'));
    assert.ok(zeile, `app.js setzt ${name} nicht`);
    assert.ok(!zeile.includes('%'),
      `app.js muss ${name} als blossen Anteil setzen, nicht als Prozentwert: "${zeile.trim()}"`);
  }

  // --- 4. Auch der blasseste Chevron traegt genug Deckkraft --------------------
  const blassest = Math.min(...['slow', 'normal', 'fast'].map((z) => parseFloat(tokens[`--drive-chevron-dim-${z}`])));
  assert.ok(blassest >= 0.5,
    `der blasseste Chevron traegt nur ${blassest} Deckkraft — er soll sich ohne Suchen abheben`);

  // --- 5. Die beiden Fassungen der halben Taille duerfen nicht auseinanderlaufen
  // `--drive-pad-waist-half` (Prozent, fuer die clip-path-Formen) und `--drive-pad-waist-half-len`
  // (px, fuer die Chevrons) sagen dasselbe. Zwei Schreibweisen derselben Groesse sind nur
  // tragbar, solange sie nachweislich uebereinstimmen.
  for (const [label, F] of allFields()) {
    const prozent = toPx('var(--drive-pad-waist-half)', F);
    const laenge = toPx('var(--drive-pad-waist-half-len)', F);
    assert.ok(Math.abs(prozent - laenge) < 1e-9,
      `${label}: die halbe Taille misst ${prozent.toFixed(4)}px in Prozent, aber ${laenge.toFixed(4)}px als Laenge`);
  }
});

test('Rueckgaengig-Knopf und Joystick-Umschalter haben denselben Randabstand', () => {
  // Sie liegen in verschiedenen Bereichen (Karte gegen Fahrzone), sollen aber optisch auf einer
  // senkrechten Linie stehen. Das traegt genau ein Token: --edge-gap. Auf der Karte ist es der
  // Abstand des Knopfes selbst, in der Fahrzone der seitliche Innenabstand — der Umschalter
  // sitzt dort an der Aussenkante seiner Spalte und landet damit auf demselben Wert.
  const gap = resolve(':root', '--edge-gap').value;
  assert.ok(gap && /^\d+px$/.test(gap), `--edge-gap muss ein fester Pixelwert sein, ist "${gap}"`);
  assert.strictEqual(resolve('.map-corner-undo', 'left').value, 'var(--edge-gap)');
  assert.ok((resolve('.drive-zone', 'padding').value || '').includes('var(--edge-gap)'),
    'die Fahrzone muss denselben seitlichen Innenabstand nutzen');
  assert.strictEqual(resolve('.drive-mode-side', 'align-self').value, 'flex-start',
    'ohne Ausrichtung an der Aussenkante haengt der Umschalter am Joystick statt am Rand');
  assert.strictEqual(resolve('.drive-side', 'justify-self').value, 'stretch',
    'nur eine ausgefuellte Spalte hat eine Aussenkante, an der der Knopf sitzen kann');
  // Und alle uebrigen randstaendigen Elemente teilen denselben Wert — ein Token, keine Kopien.
  for (const [selector, prop] of [['.capture-cluster', 'right'], ['.capture-cluster', 'bottom'],
    ['.map-position', 'bottom'], ['.map-view-reset', 'right'], ['.map-corner-undo', 'bottom']]) {
    assert.strictEqual(resolve(selector, prop).value, 'var(--edge-gap)',
      `${selector} { ${prop} } muss den gemeinsamen Randabstand nutzen`);
  }
});

test('Schmaler Bildschirm: Seitenspalte behaelt Platz fuer Umschalter und Anzeige', () => {
  // Rechnung mit den CSS-Zahlen: Zonenbreite minus Innenabstand, Spaltenabstaende und Joystick,
  // geteilt auf zwei Seitenspalten. Jede Seite muss den Umschalter (34 px) fassen, bei der
  // Standardgroesse zusaetzlich „Fahrt gestoppt“ in zwei Zeilen (~52 px fuer „gestoppt“).
  const px = (sel, prop) => parseFloat(resolve(sel, prop).value);
  const toggle = px('.drive-mode-side', '--drive-toggle-size');
  const gap = px('.drive-zone', 'column-gap');
  // Der seitliche Innenabstand der Fahrzone ist derselbe Randabstand wie auf der Karte —
  // nur dadurch stehen Umschalter und Rueckgaengig-Knopf auf einer senkrechten Linie.
  assert.ok((resolve('.drive-zone', 'padding').value || '').includes('var(--edge-gap)'),
    'die Fahrzone nutzt den gemeinsamen Randabstand');
  const padding = px(':root', '--edge-gap');
  const reserve = px('.drive-zone .drive-control', '--drive-side-reserve');
  assert.ok(toggle >= 34 && gap > 0 && padding > 0 && reserve > 0, 'alle Kennzahlen im Stylesheet');
  assert.ok(reserve >= 2 * (toggle + gap) + 2 * padding,
    `die Reserve (${reserve}) muss beide Umschalter samt Abstaenden decken`);
  const size = (resolve('.drive-zone .drive-control', '--joystick-size').value || '').replace(/\s+/g, ' ');
  assert.ok(size.includes('calc(100vw - var(--drive-side-reserve))'),
    `die Joystick-Groesse ist an die Bildschirmbreite gebunden: ${size}`);
  // Nachgerechnet fuer ein schmales Telefon (360 x 800) in jeder Groessenstufe.
  const joystick = (scale, w, h) => Math.max(110, Math.min(25 * h / 100 * scale, 240 * scale, 38 * h / 100, w - reserve));
  for (const scale of [0.75, 1, 1.25, 1.5]) {
    const sideWidth = (360 - 2 * padding - 2 * gap - joystick(scale, 360, 800)) / 2;
    assert.ok(sideWidth >= toggle, `Stufe ${scale}: Seitenspalte ${sideWidth}px < Umschalter ${toggle}px`);
    if (scale <= 1) assert.ok(sideWidth >= 52, `Stufe ${scale}: „gestoppt“ passt nicht (${sideWidth}px)`);
  }
  // Im breiten Fenster gilt dieselbe Bindung, nur an die Fahrspalte statt an 100vw.
  const wide = { media: 'min-width: 760px' };
  assert.ok((resolve('.drive-zone .drive-control', '--joystick-size', wide).value || '')
    .includes('var(--drive-column) - var(--drive-side-reserve)'), 'Breitbild: an die Fahrspalte gebunden');
  assert.ok((resolve('.app-frame', 'grid-template-columns', wide).value || '').includes('var(--drive-column)'));
});

test('Joystick und Tastenkreuz fuellen das gemeinsame Fahrfeld', () => {
  const field = html.slice(html.indexOf('id="driveControlArea"'), html.indexOf('class="drive-side"'));
  // Beide Steuerungen fuellen das Feld, damit die Ecke fuer beide dieselbe ist.
  for (const selector of ['.drive-zone .joystick-base', '.drive-zone .drive-pad']) {
    assert.strictEqual(resolve(selector, 'width').value, '100%', `${selector} fuellt das Feld`);
    assert.strictEqual(resolve(selector, 'height').value, '100%');
  }
  const toggle = html.slice(html.indexOf('id="driveModeBtn"') - 200, html.indexOf('id="driveModeLabel"'));
  assert.strictEqual((toggle.match(/drive-mode-icon/g) || []).length, 2, 'Joystick- und Steuerkreuz-Symbol');
  // Gezeigt wird das Symbol des **Ziels**, nicht des Ist-Zustands — wie ein Hell/Dunkel-Schalter,
  // der im Hellen den Mond zeigt. Die Klasse benennt weiterhin den aktiven Modus.
  assert.strictEqual(resolve('.drive-mode-tool.mode-joystick .icon-pad', 'display').value, 'grid',
    'im Joystick-Modus zeigt der Knopf das Steuerkreuz');
  assert.strictEqual(resolve('.drive-mode-tool.mode-buttons .icon-joystick', 'display').value, 'grid',
    'im Tastenmodus zeigt er den Joystick');
  for (const wrong of ['.drive-mode-tool.mode-joystick .icon-joystick',
    '.drive-mode-tool.mode-buttons .icon-pad']) {
    assert.notStrictEqual(resolve(wrong, 'display').value, 'grid', `${wrong} zeigt den Ist-Zustand`);
  }
});

test('Der Hinweis zur Kontur-Erweiterung verdeckt die Karte nicht', () => {
  // In der schmalen Werkzeugleiste wurde die Anweisung abgeschnitten. Sie steht jetzt als eigene
  // Zeile zwischen Leiste und Zeichenflaeche — volle Breite, und da sie kein Overlay ist, bleibt
  // die Karte darunter antippbar. Genau das braucht der Ablauf: man waehlt Punkte auf der Karte.
  assert.strictEqual(resolve('.map-hint', 'flex').value, '0 0 auto',
    'der Hinweis kostet nur seine Inhaltshoehe');
  assert.notStrictEqual(resolve('.map-hint', 'position').value, 'absolute',
    'kein Overlay ueber der Karte');
  assert.notStrictEqual(resolve('.map-hint', 'position').value, 'fixed');
  assert.strictEqual(resolve('.map-hint-text', 'min-width').value, '0',
    'ohne min-width:0 kann der Text die Knoepfe aus der Zeile schieben');
  // Im Markup steht er zwischen Werkzeugleiste und Zeichenflaeche, nicht darin.
  const stage = html.slice(html.indexOf('id="mapStage"'));
  const hint = stage.indexOf('id="extendPanel"');
  assert.ok(hint > stage.indexOf('id="mapToolbar"') && hint < stage.indexOf('id="mapCanvasArea"'),
    'der Hinweis sitzt zwischen Leiste und Zeichenflaeche');
  // Anleitung und Abschluss liegen zusammen, damit die Leiste nicht ueberlaeuft.
  // Ab dem oeffnenden Tag schneiden: die Attribute stehen alphabetisch, `aria-live` also vor `id`.
  const panel = stage.slice(stage.lastIndexOf('<div', hint), stage.indexOf('id="mapCanvasArea"'));
  for (const id of ['extendPanelText', 'extendCancelBtn', 'extendDoneBtn']) {
    assert.ok(panel.includes(`id="${id}"`), `${id} gehoert in den Hinweisbereich`);
  }
  assert.ok(panel.includes('aria-live="polite"'), 'Schrittwechsel muessen angesagt werden');
  // In der Werkzeugleiste bleibt nur der Startknopf.
  const bar = html.slice(html.indexOf('id="mapToolbar"'), hint + stage.indexOf('id="mapStage"'));
  assert.ok(!bar.includes('id="extendDoneBtn"'), 'kein zweiter Knopf in der schmalen Leiste');
});

test('Kurzbeschriftungen der Werkzeuge bleiben kurz genug fuer die Leiste', () => {
  // Gemeldet: „Perimeter erweitern“ wurde rechts abgeschnitten. Der Kurzschluessel trug
  // schlicht denselben langen Text wie das aria-label. Die Leiste kann jetzt zwar schrumpfen
  // und notfalls scrollen, aber ein ueberlanges Label schiebt trotzdem alles andere aus dem
  // Bild — deshalb hier eine harte Obergrenze je Kurzbeschriftung.
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const de = src.slice(src.indexOf('  de: {'), src.indexOf('  en: {'));
  // Rueckgaengig und „Ansicht zuruecksetzen“ tragen auf der Karte keine sichtbare Beschriftung
  // mehr (nur noch ihr aria-label), ihre Kurzschluessel sind entfallen.
  const shortKeys = ['deleteLastLabel', 'deletePointLabel', 'deleteAreaLabel',
    'insertBeforeShort', 'insertAfterShort', 'closeAndNewShort',
    'extendPerimeterShort', 'extendExclusionShort'];
  for (const key of shortKeys) {
    const hit = de.match(new RegExp(`${key}: '([^']*)'`));
    assert.ok(hit, `${key} fehlt`);
    assert.ok(hit[1].length <= 20, `${key} ist mit ${hit[1].length} Zeichen zu lang: „${hit[1]}“`);
  }
  // Entscheidend ist nicht die absolute Laenge, sondern dass eine „…Short“-Fassung wirklich
  // kuerzer ist als die ausfuehrliche daneben. Genau daran fehlte es: extendPerimeterShort
  // trug denselben Text wie extendPerimeter.
  for (const short of shortKeys.filter((k) => k.endsWith('Short'))) {
    const base = short.slice(0, -'Short'.length);
    const longHit = de.match(new RegExp(`\\b${base}: '([^']*)'`));
    if (!longHit) continue;
    const shortHit = de.match(new RegExp(`${short}: '([^']*)'`));
    assert.ok(shortHit[1].length < longHit[1].length,
      `${short} („${shortHit[1]}“) muss kuerzer sein als ${base} („${longHit[1]}“)`);
  }
  assert.ok(/extendPerimeter: '[^']{15,}'/.test(de), 'die ausfuehrliche Fassung bleibt erhalten');
});

test('Die Werkzeugleiste passt sich schmalen Bildschirmen an', () => {
  const narrow = { media: 'max-width: 430px' };
  assert.ok(Number.parseInt(resolve('.map-tool', 'min-width', narrow).value, 10)
    < Number.parseInt(resolve('.map-tool', 'min-width').value, 10),
  'auf schmalen Geraeten muessen die Werkzeuge schmaler werden duerfen');
  assert.ok(resolve('.map-tool', 'max-width').value, 'eine Obergrenze je Werkzeug fehlt');
  assert.strictEqual(resolve('.map-tool-label', 'text-overflow').value, 'ellipsis',
    'ein zu langes Label kuerzt, statt den Knopf zu verbreitern');
  assert.strictEqual(resolve('.map-tool-label', 'white-space').value, 'nowrap',
    'aber es bleibt einzeilig — keine Buchstabenkolonnen');
});

test('Die Positionszeile sitzt zwischen den beiden Eckknoepfen, ohne sie zu ueberlappen', () => {
  // Sie lag vorher als Teil des Overlay-Streifens oben auf der Karte. Jetzt spannt sie sich
  // unten ueber die Luecke zwischen Rueckgaengig- (links) und Aufnahme-Knopf (rechts).
  assert.strictEqual(resolve('.map-position', 'position').value, 'absolute');
  assert.strictEqual(resolve('.map-position', 'bottom').value, 'var(--edge-gap)');
  assert.strictEqual(resolve('.map-position', 'justify-content').value, 'center',
    'der Text steht mittig in der Luecke');
  assert.strictEqual(resolve('.map-position', 'pointer-events').value, 'none',
    'Kartengesten muessen darunter weiterlaufen');
  assert.ok((resolve('.map-position .info-line', 'background').value || '').includes('--shell-hud'),
    'halbtransparent, damit die Karte darunter sichtbar bleibt');
  // Im Markup liegt sie in der Zeichenflaeche zwischen den beiden Knoepfen.
  const area = html.slice(html.indexOf('id="mapCanvasArea"'));
  assert.ok(area.includes('id="mapPosition"') && area.includes('id="pointStatus"'),
    'Positionszeile und ihr Text gehoeren auf die Karte');
  assert.ok(!html.slice(html.indexOf('id="mapToolbar"'), html.indexOf('id="mapCanvasArea"'))
    .includes('id="pointStatus"'), 'sie steht nicht in der Werkzeugleiste');

  // Beide Kanten sind gesetzt — nur so kann sie die Knoepfe nicht ueberlappen. Die Abzuege sind
  // seitenverschieden, weil die Knoepfe verschieden breit sind, und drehen mit der Haendigkeit.
  const px = (v) => Number(String(v).replace('px', ''));
  const edge = px(resolve(':root', '--edge-gap').value);
  const fab = px(resolve(':root', '--fab-size').value);
  const capture = px(resolve(':root', '--capture-size').value);
  assert.ok(edge > 0 && fab > 0 && capture > 0, 'alle drei Groessen muessen benannte Token sein');
  const undoSide = `calc(var(--edge-gap) + var(--fab-size) + 8px)`;
  const captureSide = `calc(var(--edge-gap) + var(--capture-size) + 8px)`;
  assert.strictEqual(resolve('.map-position', 'left').value, undoSide, 'links der Rueckgaengig-Knopf');
  assert.strictEqual(resolve('.map-position', 'right').value, captureSide, 'rechts der Aufnahme-Knopf');
  assert.strictEqual(resolve(':root[data-handed="left"] .map-position', 'left').value, captureSide,
    'Linkshaender: der Aufnahme-Knopf steht links');
  assert.strictEqual(resolve(':root[data-handed="left"] .map-position', 'right').value, undoSide);

  // Nachgerechnet fuer schmale Displays: die Luecke muss in beiden Haendigkeiten positiv sein
  // und noch etwas Text tragen. Xperia XZ1 = 1080 physische Pixel, also 360 CSS-px bei DPR 3.
  const gapAt = (width) => width - (edge + fab + 8) - (edge + capture + 8);
  for (const width of [320, 360, 412, 720]) {
    const gap = gapAt(width);
    assert.ok(gap >= 60,
      `bei ${width} px bleiben nur ${gap} px zwischen den Knoepfen — zu wenig fuer die Positionszeile`);
  }
  // Die Rechnung ist seitenunabhaengig: beide Abzuege zusammen sind in jeder Haendigkeit gleich.
  assert.strictEqual(gapAt(360), 360 - (edge + capture + 8) - (edge + fab + 8),
    'gespiegelt bleibt die Luecke gleich breit');
});

test('Das hidden-Attribut blendet auch Knoepfe aus', () => {
  // `button { display: inline-flex }` schlaegt das display:none des Browsers fuer [hidden].
  // Ohne eine eigene Regel bleiben per element.hidden ausgeblendete Knoepfe sichtbar.
  const display = resolve('[hidden]', 'display').value || '';
  assert.ok(display.includes('none'), 'globale [hidden]-Regel fehlt');
  assert.ok(display.includes('!important'), 'ohne !important gewinnt die button-Regel');
});

test('Die Fahrzone bleibt inhaltshoch, die Karte bekommt den Rest', () => {
  // Der Joystick hatte height:auto mit aspect-ratio. Als Grid-Kind wurde er auf die
  // Zeilenhoehe gestreckt, die Zeile wuchs mit — die Fahrzone nahm den halben Bildschirm.
  // Kein Grid mit festen Zeilen: die Update-Leiste ist meist ausgeblendet, dann rutschen im
  // Grid alle Kinder eine Zeile hoch und Karte und Fahrzone tauschen ihre Rollen.
  assert.strictEqual(resolve('.app-frame', 'display').value, 'flex');
  assert.strictEqual(resolve('.app-frame', 'flex-direction').value, 'column');
  assert.strictEqual(resolve('.app-frame', 'grid-template-rows').value, null,
    'feste Grid-Zeilen brechen, sobald ein Kind ausgeblendet ist');
  const map = resolve('.app-frame > .map-stage', 'flex').value || '';
  assert.ok(map.startsWith('1'), `die Karte muss den Rest bekommen, hat "${map}"`);
  assert.strictEqual(resolve('.app-frame > .map-stage', 'min-height').value, '0',
    'ohne min-height:0 waechst das Flex-Kind auf Inhaltshoehe');
  const drive = resolve('.app-frame > .drive-zone', 'flex').value || '';
  assert.ok(drive.startsWith('0 0'), `die Fahrzone darf weder wachsen noch schrumpfen, hat "${drive}"`);
  // Die Groesse haengt an der Bildschirmhoehe, ist aber nach oben und unten begrenzt.
  const size = (resolve('.drive-zone .drive-control', '--joystick-size').value || '').replace(/\s+/g, ' ');
  assert.ok(size.startsWith('clamp('), `Joystick-Groesse muss anteilig begrenzt sein, ist "${size}"`);
  assert.ok(/dvh|vh|vw/.test(size), 'ohne Viewport-Einheit passt sich die Zone nicht an');
  assert.ok(size.includes('--joystick-scale'), 'die Einstellung muss einfliessen');
  // Selbst die groesste Stufe darf die Karte nicht verdraengen.
  assert.ok(size.includes('38dvh'), `harte Obergrenze in dvh fehlt: "${size}"`);
  assert.strictEqual(resolve('.drive-zone .drive-control', 'height').value, 'var(--joystick-size)');
  assert.strictEqual(resolve('.drive-zone .drive-control', 'align-self').value, 'center',
    'ohne align-self streckt das Grid den Joystick');
  assert.strictEqual(resolve('.drive-zone', 'align-content').value, 'center',
    'sonst zieht die Fahrzone ihre eigenen Zeilen auseinander');
});

test('Auf breiten Fenstern steht die Fahrzone neben der Karte', () => {
  const wide = { media: 'min-width: 760px' };
  assert.strictEqual(resolve('.app-frame', 'display', wide).value, 'grid');
  const areas = resolve('.app-frame', 'grid-template-areas', wide).value || '';
  assert.ok(areas.includes('map') && areas.includes('drive'), 'Bereiche muessen benannt sein');
  // Benannte Bereiche statt Reihenfolge: sonst verschiebt die ausgeblendete Update-Leiste alles.
  for (const [selector, area] of [['.app-frame > .map-stage', 'map'], ['.app-frame > .drive-zone', 'drive'],
    ['.app-frame > .appbar', 'bar'], ['.app-frame > .update-bar', 'update']]) {
    assert.strictEqual(resolve(selector, 'grid-area', wide).value, area, `${selector} braucht einen festen Bereich`);
  }
  const columns = resolve('.app-frame', 'grid-template-columns', wide).value || '';
  assert.ok(/minmax\(0,\s*1fr\)/.test(columns), 'die Karte bekommt die freie Breite');
});

test('Punkte tragen die Farbe ihres Elements, die Fuellung die RTK-Qualitaet', () => {
  // Die Qualitaetsregeln setzten frueher auch stroke mit !important — dadurch sahen Punkte
  // von Perimeter, Ausschluss, Wegpunkten und Dock voellig gleich aus.
  const strokes = {};
  for (const cls of ['point-perimeter', 'point-exclusion', 'point-waypoint', 'point-dock']) {
    const value = resolve(`.${cls}`, 'stroke').value;
    assert.ok(value, `${cls} braucht eine eigene Randfarbe`);
    strokes[cls] = value;
  }
  assert.strictEqual(new Set(Object.values(strokes)).size, 4, `Randfarben muessen sich unterscheiden: ${JSON.stringify(strokes)}`);
  for (const quality of ['quality-excellent', 'quality-good', 'quality-warning', 'quality-bad']) {
    assert.strictEqual(resolve(`.map-point.${quality}`, 'stroke').value, null,
      `${quality} darf den Rand nicht ueberschreiben`);
    assert.ok(resolve(`.map-point.${quality}`, 'fill').value, `${quality} faerbt die Fuellung`);
  }
});

test('Statusanzeige und Joystick ueberlappen in keiner Groessenstufe', () => {
  // Drei Spalten: der Joystick sitzt fest in der Mitte, die Anzeige in einer Aussenspalte.
  const columns = (resolve('.drive-zone', 'grid-template-columns').value || '').replace(/\s+/g, ' ');
  assert.strictEqual(columns, 'minmax(0, 1fr) auto minmax(0, 1fr)');
  assert.strictEqual(resolve('.drive-zone .drive-control', 'grid-column').value, '2');
  assert.strictEqual(resolve('.drive-side', 'grid-column').value, '1', 'Standard: Anzeige links');
  assert.strictEqual(resolve(':root[data-handed="left"] .drive-side', 'grid-column').value, '3');
  // Die Aussenspalten duerfen den Joystick nicht wegdruecken.
  assert.strictEqual(resolve('.drive-side', 'min-width').value, '0');
  assert.strictEqual(resolve('.drive-meta', 'min-width').value, '0');
});

test('Beide Haendigkeiten sind exakt gespiegelt und erzeugen keinen Zeilenumbruch', () => {
  // Ursache des frueheren Sprungs: ohne grid-row rutschte die linke Anzeige in eine zweite
  // Zeile, weil der Platzierungszeiger nach dem Joystick schon hinter Spalte 1 stand.
  for (const selector of ['.drive-zone .drive-control', '.drive-side']) {
    assert.strictEqual(resolve(selector, 'grid-row').value, '1', `${selector} braucht eine feste Zeile`);
  }
  const right = [resolve('.drive-side', 'grid-column').value,
    resolve('.drive-mode-side', 'align-self').value, resolve('.drive-meta', 'text-align').value];
  const left = [resolve(':root[data-handed="left"] .drive-side', 'grid-column').value,
    resolve(':root[data-handed="left"] .drive-mode-side', 'align-self').value,
    resolve(':root[data-handed="left"] .drive-meta', 'text-align').value];
  assert.strictEqual(right.join(','), '1,flex-start,right', 'Rechtshaender: Anzeige links vom Joystick');
  assert.strictEqual(left.join(','), '3,flex-end,left', 'Linkshaender: exakt gespiegelt');
});

test('Die seitliche Anzeige gilt auch im breiten Fenster', () => {
  const wide = { media: 'min-width: 760px' };
  // Kein Zurueckfallen auf „Anzeige unter dem Joystick“: Handy und Desktop verhalten sich gleich.
  assert.strictEqual(resolve('.drive-zone', 'grid-template-columns', wide).value, null,
    'die Spaltenaufteilung darf im breiten Fenster nicht ueberschrieben werden');
  assert.strictEqual(resolve('.drive-side', 'grid-column', wide).value, null);
  assert.strictEqual(resolve('.drive-zone .drive-control', 'grid-column', wide).value, null);
  // Dafuer ist die Seitenspalte breit genug fuer Joystick und Anzeige nebeneinander.
  const column = (resolve('.app-frame', '--drive-column', wide).value || '').replace(/\s+/g, ' ');
  assert.ok(/clamp\(300px/.test(column), `Fahrspalte muss breiter sein: "${column}"`);
});

test('Der Menueinhalt hat auf jedem Bildschirm dieselbe Spaltenbreite', () => {
  // Ohne Begrenzung ziehen sich die Einstellungszeilen im breiten Fenster ueber den halben
  // Bildschirm und sehen dort anders aus als am Handy.
  const maxWidth = resolve('.menu-scroll', 'max-width').value;
  assert.ok(maxWidth && maxWidth.endsWith('px'), `Menue braucht eine Maximalbreite, hat "${maxWidth}"`);
  assert.strictEqual(resolve('.menu-scroll', 'margin-inline').value, 'auto', 'und muss zentriert stehen');
});

test('Struktur: der Scrollcontainer ist direktes Kind der Menueseite', () => {
  const page = html.slice(html.indexOf('<section class="menu-page"'), html.indexOf('</section>', html.indexOf('<section class="menu-page"')));
  const head = page.slice(0, page.indexOf('<div class="menu-scroll"'));
  // Zwischen Seitenanfang und Scrollcontainer darf nur die Kopfzeile stehen (kein Wrapper,
  // der die Flex-Kette unterbricht).
  const openTags = [...head.matchAll(/<(section|div|main|form)\b/g)].map((m) => m[1]);
  assert.deepStrictEqual(openTags, ['section'], `unerwartete Verschachtelung vor .menu-scroll: ${openTags.join(', ')}`);
  assert.ok(head.includes('class="menu-bar"'), 'Kopfzeile fehlt');
});

test('Struktur: alle Menueabschnitte sind direkte Kinder ihres Akkordeon-Containers', () => {
  // bindAccordion() arbeitet mit container.children — Abschnitte in einem Zwischen-DIV
  // wuerden stillschweigend nicht mehr zuklappen.
  const scroll = html.slice(html.indexOf('<div class="menu-scroll"'));
  const topLevel = (scroll.match(/^<details class="menu-section"/gm) || []).length;
  assert.strictEqual(topLevel, 6, `sechs Top-Level-Abschnitte erwartet, gefunden: ${topLevel}`);
  const sub = (scroll.match(/^<details class="menu-subsection"/gm) || []).length;
  assert.strictEqual(sub, 3, `drei Unterabschnitte erwartet, gefunden: ${sub}`);
  const settings = scroll.slice(scroll.indexOf('id="menuSettings"'));
  assert.ok(settings.indexOf('id="settingsSections"') < settings.indexOf('<details class="menu-subsection"'),
    'die Unterabschnitte muessen in #settingsSections liegen');
});

let failed = 0;

test('Die Import-Hinweiszeile startet ausgeblendet und liegt beim Import-Knopf', () => {
  const zeile = html.match(/<small[^>]*id="importNotice"[^>]*>/);
  assert.ok(zeile, '#importNotice fehlt im Markup');
  assert.ok(/\bhidden\b/.test(zeile[0]),
    'ohne `hidden` im Markup blitzt die Meldung beim Laden kurz auf');
  assert.ok(/aria-live/.test(zeile[0]), 'die Meldung muss vorgelesen werden');
  // Sie gehoert neben den Import-Knopf, nicht irgendwohin: dieselbe Ueberlegung wie bei
  // #cassandraSkippedHint neben den Export-Knoepfen.
  const abstand = html.indexOf(zeile[0]) - html.indexOf('id="importInput"');
  assert.ok(abstand > 0 && abstand < 400,
    `#importNotice steht nicht beim Import-Knopf (Abstand ${abstand} Zeichen)`);
});

test('Die Zeile zur Zonenstaffel steht bei den Geschwindigkeitsfeldern und ist sichtbar abgesetzt', () => {
  const zeile = html.match(/<small[^>]*id="driveZoneOrderHint"[^>]*>/);
  assert.ok(zeile, '#driveZoneOrderHint fehlt im Markup');
  assert.ok(/\bhidden\b/.test(zeile[0]),
    'ohne `hidden` im Markup steht beim Laden eine leere, aber abgesetzte Zeile da');
  // Sie gehoert zu den Geschwindigkeitsfeldern, nicht irgendwohin — dieselbe Ueberlegung wie bei
  // #cassandraSkippedHint neben den Export-Knoepfen.
  const abstand = html.indexOf(zeile[0]) - html.indexOf('id="cursorSpeedInput"');
  assert.ok(abstand > 0 && abstand < 900,
    `#driveZoneOrderHint steht nicht bei den Geschwindigkeitsfeldern (Abstand ${abstand} Zeichen)`);

  // **Der ganze Zweck ist Sichtbarkeit.** `.menu-body .view-note` (0,2,0) faerbt jede Notiz
  // gedaempft; die Warnfassung muss sich elementbezogen durchsetzen, sonst sieht der Hinweis aus
  // wie die Erklaerzeile darueber und geht unter.
  const note = { ancestors: ['menu-body'], tag: 'small' };
  const warn = effectiveStyle({ ...note, classes: ['view-note', 'is-warning'] }, 'color');
  const plain = effectiveStyle({ ...note, classes: ['view-note'] }, 'color');
  assert.ok(/var\(--warn\)/.test(warn.value || ''),
    `der Hinweis traegt nicht die Warnfarbe, sondern "${warn.value}" aus "${warn.selector}"`);
  assert.notStrictEqual(warn.value, plain.value, 'Warnfassung und Grundregel duerfen nicht gleich aussehen');
  // Und die Farbe kommt aus dem Token, das es in Hell und Dunkel gibt.
  assert.ok(resolve(':root', '--warn').value, '--warn fehlt in der Hell-Palette');
});

test('Das aktive Ende der Erweiterung blinkt und traegt eine eigene Tokenfarbe', () => {
  // Farbe: der erste gewaehlte Punkt (das aktive Ende) unterscheidet sich vom nur vorgemerkten
  // zweiten, der die Warnfarbe behaelt. Beide ausdruecklich aus Tokens — eine feste Farbe
  // folgte Hell/Dunkel nicht.
  const aktiv = resolve('.map-point.extend-pick-active', 'stroke');
  const zweiter = resolve('.map-point.extend-pick-point', 'stroke');
  assert.ok(aktiv.value, 'das aktive Ende hat keine eigene Farbe');
  assert.notStrictEqual(aktiv.value, zweiter.value,
    `beide Markierungen sehen gleich aus (${aktiv.value})`);
  for (const [was, wert] of [['aktives Ende', aktiv.value], ['zweiter Punkt', zweiter.value]]) {
    assert.ok(/^var\(--/.test(wert), `${was}: keine Tokenfarbe, sondern "${wert}"`);
  }
  assert.ok(!/#/.test(aktiv.value), `das aktive Ende traegt eine feste Farbe: "${aktiv.value}"`);
  assert.ok(resolve(':root', '--shell-info').value, '--shell-info fehlt in der Grundpalette');
  assert.ok(resolve(':root[data-theme="light"]', '--shell-info').value, '--shell-info fehlt in der Hell-Palette');
  // Der Ring gehoert zum Punkt und darf nicht in der anderen Farbe stehenbleiben.
  const ring = resolve('.extend-pick-ring.extend-pick-ring-active', 'stroke');
  assert.strictEqual(ring.value, aktiv.value, `der Ring des aktiven Endes ist "${ring.value}"`);

  // Blinken: nur das aktive Ende, und die Bewegung faellt bei prefers-reduced-motion weg.
  const anim = resolve('.map-point.extend-pick-active', 'animation');
  assert.ok(/extend-pick-blink/.test(anim.value || ''), `kein Blinken gesetzt: "${anim.value}"`);
  assert.ok(/extend-pick-blink/.test(resolve('.extend-pick-ring.extend-pick-ring-active', 'animation').value || ''),
    'der Ring des aktiven Endes blinkt nicht mit');
  assert.ok(!resolve('.map-point.extend-pick-point', 'animation').value,
    'der vorgemerkte zweite Punkt darf nicht mitblinken');
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'styles.css'), 'utf8');
  const frames = css.slice(css.indexOf('@keyframes extend-pick-blink'));
  const block = frames.slice(0, frames.indexOf('}\n') + 1);
  assert.ok(/opacity/.test(block), 'das Blinken laeuft nicht ueber die Deckkraft');
  assert.ok(!/(stroke|fill|color)\s*:/.test(block),
    'das Blinken darf die Farbe nicht antasten — sie ist die eigentliche Aussage');

  for (const sel of ['.map-point.extend-pick-active', '.extend-pick-ring.extend-pick-ring-active']) {
    const ruhig = resolve(sel, 'animation', { media: 'prefers-reduced-motion: reduce' });
    assert.strictEqual(ruhig.value, 'none', `${sel}: Bewegung nicht abbestellbar ("${ruhig.value}")`);
  }
  // Die Farbe bleibt dabei: unter reduced motion wird nichts umgefaerbt.
  assert.ok(!resolve('.map-point.extend-pick-active', 'stroke',
    { media: 'prefers-reduced-motion: reduce' }).value,
    'unter prefers-reduced-motion wird die Farbe des aktiven Endes angetastet');
});

for (const c of cases) {
  try { c.fn(); } catch (error) {
    failed += 1;
    console.error(`FAIL ${c.name}\n     ${error.message}`);
    if (process.env.LAYOUT_TEST_STACK) console.error(error.stack);
  }
}
if (failed) { console.error(`layout tests: ${failed}/${cases.length} FEHLGESCHLAGEN`); process.exit(1); }
console.log(`layout tests: OK (${cases.length} Faelle)`);

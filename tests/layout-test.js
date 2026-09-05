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

test('Alle Kartenknoepfe liegen auf einer gemeinsamen rechten Achse', () => {
  const stack = { right: resolve('.map-fab-stack', 'right').value, width: resolve('.map-fab-stack', 'width').value };
  const cluster = { right: resolve('.capture-cluster', 'right').value, width: resolve('.capture-cluster', 'width').value };
  assert.strictEqual(stack.right, cluster.right, 'oben und unten muessen denselben Rechtsabstand haben');
  assert.strictEqual(stack.width, cluster.width, 'gleiche Spaltenbreite haelt 48-px- und 92-px-Knopf auf einer Mittelachse');
  assert.ok(stack.width, 'ohne feste Spaltenbreite richten sich verschieden breite Knoepfe unterschiedlich aus');
  for (const selector of ['.map-fab-stack', '.capture-cluster']) {
    assert.strictEqual(resolve(selector, 'justify-items').value, 'center', `${selector} muss seine Knoepfe zentrieren`);
  }
});

test('Knopfbeschriftungen laufen nicht ueber den Bildschirmrand', () => {
  // Die Beschriftungen sind breiter als ihre Knoepfe; ohne Umbruch und Breitenbegrenzung
  // ragen sie rechts aus dem Bild ("Letzten Punkt" wird zu "Punkt").
  assert.notStrictEqual(resolve('.fab-label', 'white-space').value, 'nowrap');
  assert.ok(resolve('.fab-label', 'max-width').value, 'Beschriftung braucht eine Breitenbegrenzung');
});

test('Die Hinweiszeilen stehen untereinander und meiden die Knopfspalte', () => {
  assert.strictEqual(resolve('.map-hud', 'display').value, 'grid', 'zwei Zeilen untereinander');
  const columnWidth = parseInt(resolve('.map-fab-stack', 'width').value, 10);
  const columnRight = parseInt(resolve('.map-fab-stack', 'right').value, 10);
  const maxWidth = resolve('.map-hud', 'max-width').value || '';
  const reserved = Number((maxWidth.match(/-\s*(\d+)px/) || [])[1] || 0);
  assert.ok(reserved >= columnWidth + columnRight,
    `max-width muss mindestens ${columnWidth + columnRight}px fuer die Knopfspalte freilassen, laesst ${reserved}px`);
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
  const size = (resolve('.drive-zone .joystick-base', '--joystick-size').value || '').replace(/\s+/g, ' ');
  assert.ok(size.startsWith('clamp('), `Joystick-Groesse muss anteilig begrenzt sein, ist "${size}"`);
  assert.ok(/dvh|vh|vw/.test(size), 'ohne Viewport-Einheit passt sich die Zone nicht an');
  assert.ok(size.includes('--joystick-scale'), 'die Einstellung muss einfliessen');
  // Selbst die groesste Stufe darf die Karte nicht verdraengen.
  assert.ok(size.includes('38dvh'), `harte Obergrenze in dvh fehlt: "${size}"`);
  assert.strictEqual(resolve('.drive-zone .joystick-base', 'height').value, 'var(--joystick-size)');
  assert.strictEqual(resolve('.drive-zone .joystick-base', 'align-self').value, 'center',
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
  assert.strictEqual(resolve('.drive-zone .joystick-base', 'grid-column').value, '2');
  assert.strictEqual(resolve('.drive-meta', 'grid-column').value, '1', 'Standard: Anzeige links');
  assert.strictEqual(resolve('.drive-zone[data-label-side="right"] .drive-meta', 'grid-column').value, '3');
  // Die Aussenspalten duerfen den Joystick nicht wegdruecken.
  assert.strictEqual(resolve('.drive-meta', 'min-width').value, '0');
});

test('Beide Haendigkeiten sind exakt gespiegelt und erzeugen keinen Zeilenumbruch', () => {
  // Ursache des frueheren Sprungs: ohne grid-row rutschte die linke Anzeige in eine zweite
  // Zeile, weil der Platzierungszeiger nach dem Joystick schon hinter Spalte 1 stand.
  for (const selector of ['.drive-zone .joystick-base', '.drive-meta',
    '.drive-zone[data-label-side="right"] .drive-meta']) {
    assert.strictEqual(resolve(selector, 'grid-row').value, '1', `${selector} braucht eine feste Zeile`);
  }
  const left = { column: resolve('.drive-meta', 'grid-column').value, justify: resolve('.drive-meta', 'justify-self').value, align: resolve('.drive-meta', 'text-align').value };
  const right = { column: resolve('.drive-zone[data-label-side="right"] .drive-meta', 'grid-column').value,
    justify: resolve('.drive-zone[data-label-side="right"] .drive-meta', 'justify-self').value,
    align: resolve('.drive-zone[data-label-side="right"] .drive-meta', 'text-align').value };
  assert.deepStrictEqual([left.column, left.justify, left.align], ['1', 'end', 'right']);
  assert.deepStrictEqual([right.column, right.justify, right.align], ['3', 'start', 'left']);
});

test('Die seitliche Anzeige gilt auch im breiten Fenster', () => {
  const wide = { media: 'min-width: 760px' };
  // Kein Zurueckfallen auf „Anzeige unter dem Joystick“: Handy und Desktop verhalten sich gleich.
  assert.strictEqual(resolve('.drive-zone', 'grid-template-columns', wide).value, null,
    'die Spaltenaufteilung darf im breiten Fenster nicht ueberschrieben werden');
  assert.strictEqual(resolve('.drive-meta', 'grid-column', wide).value, null);
  assert.strictEqual(resolve('.drive-zone .joystick-base', 'grid-column', wide).value, null);
  // Dafuer ist die Seitenspalte breit genug fuer Joystick und Anzeige nebeneinander.
  const columns = (resolve('.app-frame', 'grid-template-columns', wide).value || '').replace(/\s+/g, ' ');
  assert.ok(/clamp\(300px/.test(columns), `Fahrspalte muss breiter sein: "${columns}"`);
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
for (const c of cases) {
  try { c.fn(); } catch (error) {
    failed += 1;
    console.error(`FAIL ${c.name}\n     ${error.message}`);
    if (process.env.LAYOUT_TEST_STACK) console.error(error.stack);
  }
}
if (failed) { console.error(`layout tests: ${failed}/${cases.length} FEHLGESCHLAGEN`); process.exit(1); }
console.log(`layout tests: OK (${cases.length} Faelle)`);

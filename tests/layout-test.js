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
  // Der Aufnahme-Cluster ist unveraendert unten rechts geblieben.
  assert.strictEqual(resolve('.capture-cluster', 'position').value, 'absolute');
  assert.strictEqual(resolve('.capture-cluster', 'right').value, '12px');
  assert.strictEqual(resolve('.capture-cluster', 'bottom').value, '12px');
  const area = html.slice(html.indexOf('id="mapCanvasArea"'));
  assert.ok(area.includes('id="captureCluster"'), 'der Aufnahme-Cluster gehoert in die Zeichenflaeche');
  assert.ok(!area.includes('id="mapSummary"'),
    'die Karteninfo liegt nicht mehr als Overlay auf der Karte');
  assert.ok(!html.includes('class="map-hud"'), 'der Overlay-Kasten ist restlos entfernt');
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
  const tools = ['deletePointBtn', 'insertBeforeBtn', 'insertAfterBtn', 'undoBtn', 'closeAndNewBtn',
    'extendBtn', 'fitViewBtn'];
  assert.ok(!bar.includes('id="driveModeBtn"'),
    'der Steuerungs-Umschalter sitzt jetzt in der Ecke des Fahrfelds, nicht mehr in der Leiste');
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

test('Der Rueckgaengig-Knopf steht als Werkzeug in der Leiste und startet ausgegraut', () => {
  const bar = html.slice(html.indexOf('id="mapToolbar"'), html.indexOf('id="mapCanvasArea"'));
  assert.ok(bar.includes('id="undoFabWrap"'), 'der Schalter fuer die Sichtbarkeit bleibt erhalten');
  assert.ok(/disabled=""[^>]*id="undoBtn"/.test(html), 'bei leerem Verlauf startet der Knopf ausgegraut');
  assert.ok(resolve('.map-tool[disabled]', 'opacity').value, 'ausgegraut muss sichtbar anders aussehen');
  // Eigenes Symbol, nicht die Muelltonne des Loesch-Werkzeugs.
  const undo = bar.slice(bar.indexOf('id="undoBtn"'), bar.indexOf('id="undoBtn"') + 400);
  assert.ok(!undo.includes('M4 7h16'), 'der Rueckgaengig-Knopf traegt nicht das Loesch-Symbol');
});

test('Die Karteninfo sitzt in der Leiste und schneidet ab, statt die Werkzeuge zu verdraengen', () => {
  // Frueher lag sie als halbtransparenter Kasten auf der Karte. In der Leiste darf sie den
  // Werkzeugen keinen Platz wegnehmen: sie schrumpft (min-width: 0) und kuerzt je Zeile.
  assert.strictEqual(resolve('.map-toolbar', 'justify-content').value, 'space-between',
    'Karteninfo und Werkzeuge stehen an den beiden Enden der Zeile');
  assert.strictEqual(resolve('.map-info', 'flex').value, '1 1 auto', 'die Info nimmt den Rest');
  assert.strictEqual(resolve('.map-info', 'min-width').value, '0',
    'ohne min-width:0 kann ein langer Kartenname die Werkzeuge aus der Leiste schieben');
  assert.strictEqual(resolve('.map-tools', 'flex').value, '0 0 auto', 'die Werkzeuge geben nicht nach');
  assert.strictEqual(resolve('.map-info', 'display').value, 'grid', 'zwei Zeilen untereinander');
  assert.strictEqual(resolve('.info-line', 'white-space').value, 'nowrap');
  assert.strictEqual(resolve('.info-line', 'text-overflow').value, 'ellipsis');
  assert.strictEqual(resolve('.info-line', 'overflow').value, 'hidden');
  // Und im Markup steht sie in der Leiste, vor den Werkzeugen.
  const bar = html.slice(html.indexOf('id="mapToolbar"'), html.indexOf('id="mapCanvasArea"'));
  assert.ok(bar.indexOf('id="mapInfo"') >= 0 && bar.indexOf('id="mapInfo"') < bar.indexOf('id="mapTools"'),
    'die Karteninfo steht als erstes Kind der Leiste');
});

test('Linkshaender spiegelt jedes mit dem Daumen bediente Element', () => {
  // Der Sinn der Einstellung ist Konsistenz: es darf nicht die Haelfte umschalten und der Rest
  // stehen bleiben. Geprueft wird deshalb jede gespiegelte Stelle gegen ihre Grundregel.
  const mirrored = [
    // [Selektor rechts (Grundregel), Selektor links, Eigenschaft, erwartet rechts, erwartet links]
    ['.map-toolbar', ':root[data-handed="left"] .map-toolbar', 'flex-direction', null, 'row-reverse'],
    ['.map-info', ':root[data-handed="left"] .map-info', 'text-align', 'left', 'right'],
    ['.capture-cluster', ':root[data-handed="left"] .capture-cluster', 'right', '12px', 'auto'],
    ['.capture-cluster', ':root[data-handed="left"] .capture-cluster', 'left', null, '12px'],
    ['.drive-meta', ':root[data-handed="left"] .drive-meta', 'grid-column', '1', '3'],
    ['.drive-meta', ':root[data-handed="left"] .drive-meta', 'justify-self', 'end', 'start'],
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
  assert.strictEqual(resolve('.capture-cluster', 'right').value, '12px', 'Aufnahme-Knopf unten rechts');
  assert.strictEqual(resolve('.drive-meta', 'grid-column').value, '1', 'Fahrtanzeige links');
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

test('Der Steuerungs-Umschalter steht neben dem Fahrfeld und spiegelt mit', () => {
  // Joystick und Tastenkreuz teilen sich ein gemeinsames Feld; nur dieses traegt Groesse und
  // Gitterplatz. Dadurch liegt der Umschalter in beiden Modi an derselben Stelle.
  const field = html.slice(html.indexOf('id="driveControlArea"'), html.indexOf('class="drive-meta"'));
  for (const id of ['driveJoystick', 'driveButtons', 'driveModeBtn']) {
    assert.ok(field.includes(`id="${id}"`), `${id} gehoert in das gemeinsame Fahrfeld`);
  }
  assert.strictEqual(resolve('.drive-zone .drive-control', 'position').value, 'relative',
    'ohne Bezugsrahmen haengt der Umschalter an der Fahrzone statt am Feld');
  assert.strictEqual(resolve('.drive-mode-corner', 'position').value, 'absolute');
  assert.strictEqual(resolve('.drive-mode-corner', 'top').value, '0');
  // Vollstaendig **ausserhalb** des Kreises: `right: 100%` setzt die rechte Kante des Knopfes an
  // die linke Kante des Feldes, es kann also nichts ueberlappen. `left: 0` tat das noch.
  assert.strictEqual(resolve('.drive-mode-corner', 'right').value, '100%',
    'der Knopf darf den Kreis nicht mehr ueberlappen');
  assert.strictEqual(resolve(':root[data-handed="left"] .drive-mode-corner', 'left').value, '100%',
    'Linkshaender: gespiegelt auf die andere Seite');
  assert.strictEqual(resolve(':root[data-handed="left"] .drive-mode-corner', 'right').value, 'auto',
    'ohne Zuruecksetzen von right waere der Knopf ueber die ganze Breite gespannt');
  // Der Platz daneben ist reserviert, sonst laeuft der Knopf in die Fahrtanzeige.
  const gap = resolve('.drive-zone .drive-control', 'margin').value || '';
  assert.ok(gap.includes('var(--drive-toggle-gap)'), `das Feld braucht Platz fuer den Knopf: ${gap}`);
  assert.ok((resolve(':root[data-handed="left"] .drive-zone .drive-control', 'margin').value || '')
    .includes('var(--drive-toggle-gap)'), 'auch auf der gespiegelten Seite');
  // Beide Steuerungen fuellen das Feld, damit die Ecke fuer beide dieselbe ist.
  for (const selector of ['.drive-zone .joystick-base', '.drive-zone .drive-pad']) {
    assert.strictEqual(resolve(selector, 'width').value, '100%', `${selector} fuellt das Feld`);
    assert.strictEqual(resolve(selector, 'height').value, '100%');
  }
  assert.strictEqual((field.match(/drive-mode-icon/g) || []).length, 2, 'Joystick- und Steuerkreuz-Symbol');
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
  assert.strictEqual(resolve('.drive-meta', 'grid-column').value, '1', 'Standard: Anzeige links');
  assert.strictEqual(resolve(':root[data-handed="left"] .drive-meta', 'grid-column').value, '3');
  // Die Aussenspalten duerfen den Joystick nicht wegdruecken.
  assert.strictEqual(resolve('.drive-meta', 'min-width').value, '0');
});

test('Beide Haendigkeiten sind exakt gespiegelt und erzeugen keinen Zeilenumbruch', () => {
  // Ursache des frueheren Sprungs: ohne grid-row rutschte die linke Anzeige in eine zweite
  // Zeile, weil der Platzierungszeiger nach dem Joystick schon hinter Spalte 1 stand.
  for (const selector of ['.drive-zone .drive-control', '.drive-meta',
    ':root[data-handed="left"] .drive-meta']) {
    assert.strictEqual(resolve(selector, 'grid-row').value, '1', `${selector} braucht eine feste Zeile`);
  }
  const right = ['grid-column', 'justify-self', 'text-align'].map((p) => resolve('.drive-meta', p).value);
  const left = ['grid-column', 'justify-self', 'text-align']
    .map((p) => resolve(':root[data-handed="left"] .drive-meta', p).value);
  assert.strictEqual(right.join(','), '1,end,right', 'Rechtshaender: Anzeige links vom Joystick');
  assert.strictEqual(left.join(','), '3,start,left', 'Linkshaender: exakt gespiegelt');
});

test('Die seitliche Anzeige gilt auch im breiten Fenster', () => {
  const wide = { media: 'min-width: 760px' };
  // Kein Zurueckfallen auf „Anzeige unter dem Joystick“: Handy und Desktop verhalten sich gleich.
  assert.strictEqual(resolve('.drive-zone', 'grid-template-columns', wide).value, null,
    'die Spaltenaufteilung darf im breiten Fenster nicht ueberschrieben werden');
  assert.strictEqual(resolve('.drive-meta', 'grid-column', wide).value, null);
  assert.strictEqual(resolve('.drive-zone .drive-control', 'grid-column', wide).value, null);
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

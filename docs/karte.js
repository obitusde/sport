/**
 * karte.js – Ansicht „Karte“ (Heatmap aller Spuren) und Spur in der Detailansicht
 * Version: 0.14.0 (2026-11-18)
 *
 * - Grundkarte: graue Landeskarte von swisstopo (WMTS, Web-Mercator), etwas blasser, damit
 *   die Spuren vorne stehen; umschaltbar auf die farbige Landeskarte oder OpenStreetMap.
 *   Auf hochauflösenden Bildschirmen werden swisstopo-Kacheln der nächsten Zoomstufe in
 *   halber Größe gezeigt (schärfer, Schrift nicht übergroß).
 * - Ebene „Wanderwege (Schweiz)“ von swisstopo: zeigt alle offiziellen Wanderwege. Zusammen
 *   mit den eigenen Spuren sieht man, wo man noch nicht gewandert ist.
 * - Spuren: grobe Polylines (30 m) aller Aktivitäten von der Web-App (Aktion „spuren“).
 *   Eine Spur kann aus mehreren Teilen bestehen (Leerzeichen dazwischen), wenn der Filter
 *   in Spuren.gs eine Zugfahrt oder einen GPS-Sprung herausgeschnitten hat.
 * - Heatmap nach Häufigkeit: Ein Raster von 30 m (Web-Mercator) zählt, wie viele
 *   verschiedene Aktivitäten durch jedes Feld gehen (die nächsten Nachbarfelder zählen mit,
 *   weil das GPS jedes Mal etwas daneben liegt). Danach richtet sich die Linie: 1× dünn, 2–4× mittel,
 *   ab 5× dick. Alle Linien haben einen weißen Rand. Antippen zeigt alle Aktivitäten an
 *   dieser Stelle.
 * - Detailansicht: feine Spur (5 m) einer Aktivität (Aktion „spur“) mit Start und Ziel.
 * - Vollbild für beide Karten (Zurück-Taste schließt es).
 * - Ab 0.11.0: Angetippte Spuren werden gelb markiert (in der Liste des Popups lässt sich eine
 *   einzelne wählen); das Popup zeigt Höhenmeter auf und ab. Weit herausgezoomt werden die
 *   Linien breiter und jede Spur bekommt einen Punkt, damit man sieht, wo man war.
 * - Ab 0.12.0: Filter „Nur Touren“ (touren.js), im Popup ein Knopf zur Tour. Die Spuren werden
 *   beim Start aus dem Zwischenspeicher gelesen (für die Touren), vom Netz erst beim Öffnen
 *   der Karte oder einer Tour.
 * - Ab 0.13.0: Kartenwahl (grau, farbig, OpenStreetMap) auch auf der Detail- und der
 *   Tour-Karte; die Wahl gilt für alle Karten und bleibt gespeichert. Liegt eine Spur nicht
 *   ganz in der Schweiz, beginnen Detail- und Tour-Karte mit OpenStreetMap (swisstopo zeigt
 *   außerhalb nichts).
 * - Ab 0.14.0: Ebene „Fotos“ (Fotoschatz, fotos.js) auf Detail- und Tour-Karte.
 * - Die Spuren werden beim Öffnen der Karte neu geladen (zuerst aus dem Cache gezeigt).
 * Leaflet 1.9.4 wird erst beim ersten Öffnen einer Karte von cdnjs geladen (mit SRI-Prüfsumme).
 * Nutzt Funktionen und Konstanten aus app.js (wird vor app.js geladen, aber erst später aufgerufen).
 */
'use strict';

const LEAFLET = {
  js: { url: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js', sri: 'sha512-BwHfrr4c9kmRkLw6iXFdzcdWV/PGkVgiIyIWLLlTSXzWQzxuSg4DiQUCpauz/EWjgk5TYQqX/kvn9pG1NpYfqg==' },
  css: { url: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css', sri: 'sha512-Zcn6bjR/8RZbLEpLIeOwNtzREBAJnUKESxces60Mpoj+2okopSAcSUIUOseddDm0cxnGQzxIR7vJgsLZbdLE3w==' }
};
const KACHELN = {
  swisstopo: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
  swisstopoGrau: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg',
  wanderwege: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swisstlm3d-wanderwege/default/current/3857/{z}/{x}/{y}.png',
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
};
const KARTE_SPORTARTEN = ['wandern', 'rad', 'ski', 'laufen'];
/** Kräftigere Linienfarben als in der übrigen App, damit die Spuren auf der Karte auffallen. */
const LINIEN_FARBE = { wandern: '#0f7a33', rad: '#1650c7', ski: '#5b2fc4', laufen: '#d63c12' };
/** Linienbreite je Häufigkeitsstufe (1×, 2–4×, ab 5×). */
const LINIEN_BREITE = { 1: 2.5, 2: 4, 3: 6.5 };
const HEAT_ZELLE = 30;      // Rastergröße in Web-Mercator-Metern (in der Schweiz ca. 21 m)
const HEAT_SCHRITT = 20;    // Abstand der Stichproben entlang der Linie
const HEAT_STUECK = 150;    // längere Abschnitte werden für die Einfärbung unterteilt
const DATEN_CACHE = 'sport-daten';
const RETINA = (window.devicePixelRatio || 1) >= 1.5;
const MARKIERUNG_FARBE = '#ffc400';
/** Ab dieser Zoomstufe und kleiner bekommt jede Spur einen Punkt. */
const PUNKTE_BIS_ZOOM = 11;

/** Linien werden beim Herauszoomen breiter, damit sie sichtbar bleiben. */
function breitenFaktor(zoom) {
  return zoom <= 7 ? 2.4 : zoom <= 8 ? 2.1 : zoom <= 9 ? 1.8 : zoom <= 10 ? 1.55 : zoom <= 11 ? 1.3 : zoom <= 12 ? 1.15 : 1;
}

const karteZustand = {
  filter: { wandern: true, rad: true, ski: true, laufen: false },
  nurTouren: false,
  jahr: 'alle',
  grundkarte: (() => { try { return localStorage.getItem('sport.grundkarte') || 'grau'; } catch (e) { return 'grau'; } })(),
  wanderwege: false,
  sicht: null,        // {mitte, zoom} der letzten Ansicht
  spuren: null,       // [{id, sportart, jahr, datum, pfad, teile}]
  offen: null,        // Aktivitäten, deren Spur noch geladen oder neu berechnet wird
  laedt: false,
  veraltet: false,    // true: beim nächsten Zeichnen neu laden
  fehler: null,
  karte: null,        // Leaflet-Karte der Ansicht „Karte“
  detailKarte: null,
  tourKarte: null,
  vollbild: null,     // null, 'karte' oder 'detail'
  feineSpuren: new Map(),
  heat: null,         // {schluessel, linien, spuren}
  ebenen: [],         // [{ebene, breite}] Linien der Heatmap, Breite wird je Zoom angepasst
  punkte: null,       // Ebene mit einem Punkt je Spur (weit herausgezoomt)
  markierung: null,   // Ebene mit den gelb markierten Spuren
  markierungPopup: null
};

let leafletVersprechen = null;

function leafletLaden() {
  if (window.L) return Promise.resolve();
  if (!leafletVersprechen) {
    leafletVersprechen = new Promise((ok, fehler) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET.css.url;
      css.integrity = LEAFLET.css.sri;
      css.crossOrigin = 'anonymous';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = LEAFLET.js.url;
      js.integrity = LEAFLET.js.sri;
      js.crossOrigin = 'anonymous';
      js.onload = () => ok();
      js.onerror = () => {
        leafletVersprechen = null;
        fehler(new Error('Kartenbibliothek konnte nicht geladen werden (offline?).'));
      };
      document.head.appendChild(js);
    });
  }
  return leafletVersprechen;
}

/** Google-Polyline (Präzision 1e-5) → [[lat, lon], …] */
function polylineDekodieren(text) {
  const punkte = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const zahl = () => {
    let ergebnis = 0;
    let verschiebung = 0;
    let b;
    do {
      b = text.charCodeAt(i++) - 63;
      ergebnis |= (b & 0x1f) << verschiebung;
      verschiebung += 5;
    } while (b >= 0x20);
    return (ergebnis & 1) ? ~(ergebnis >> 1) : (ergebnis >> 1);
  };
  while (i < text.length) {
    lat += zahl();
    lon += zahl();
    punkte.push([lat / 1e5, lon / 1e5]);
  }
  return punkte;
}

/** Mehrteilige Spur (Polylines durch Leerzeichen getrennt) → [[[lat, lon], …], …] */
function spurTeile(pfad) {
  return String(pfad || '').split(' ').filter(Boolean).map(polylineDekodieren).filter(t => t.length >= 2);
}

/** Kachel-Ebene; swisstopo auf hochauflösenden Bildschirmen schärfer (halbe Kachelgröße). */
function kachelEbene(url, optionen) {
  const o = Object.assign({ maxNativeZoom: 18, maxZoom: 19 }, optionen);
  if (RETINA && url.indexOf('geo.admin.ch') >= 0) Object.assign(o, { tileSize: 128, zoomOffset: 1, maxNativeZoom: 17 });
  return L.tileLayer(url, o);
}

/** Liegen die Grenzen (ungefähr) ganz in der Schweiz? */
function inDerSchweiz(grenzen) {
  return grenzen && grenzen.isValid() && grenzen.getSouth() >= 45.75 && grenzen.getNorth() <= 47.9 &&
    grenzen.getWest() >= 5.85 && grenzen.getEast() <= 10.6;
}

/**
 * Grundkarten (grau, farbig, OSM) und Wanderwege mit Auswahl oben rechts. Die Wahl wird für
 * alle Karten gespeichert. deckkraft: wie stark die Landeskarte grau erscheint.
 */
function kartenEbenen(karte, start, deckkraft, fotoEbeneZusatz) {
  const grundkarten = {
    grau: kachelEbene(KACHELN.swisstopoGrau, { opacity: deckkraft || 0.6, attribution: '© swisstopo' }),
    farbe: kachelEbene(KACHELN.swisstopo, { opacity: 0.75, attribution: '© swisstopo' }),
    osm: kachelEbene(KACHELN.osm, { maxNativeZoom: 19, opacity: 0.75, attribution: '© OpenStreetMap-Mitwirkende' })
  };
  const wanderwege = kachelEbene(KACHELN.wanderwege, { opacity: 0.9, attribution: 'Wanderwege © swisstopo' });
  (grundkarten[start] || grundkarten.grau).addTo(karte);
  if (karteZustand.wanderwege) wanderwege.addTo(karte);
  const zusatz = { 'Wanderwege (Schweiz)': wanderwege };
  if (fotoEbeneZusatz) zusatz.Fotos = fotoEbeneZusatz;
  L.control.layers({
    'Landeskarte grau': grundkarten.grau, 'Landeskarte farbig': grundkarten.farbe, 'OpenStreetMap': grundkarten.osm
  }, zusatz).addTo(karte);
  karte.on('baselayerchange', e => {
    karteZustand.grundkarte = Object.keys(grundkarten).find(k => grundkarten[k] === e.layer) || 'grau';
    try { localStorage.setItem('sport.grundkarte', karteZustand.grundkarte); } catch (err) { /* egal */ }
  });
  karte.on('overlayadd', e => { if (e.layer === wanderwege) karteZustand.wanderwege = true; });
  karte.on('overlayremove', e => { if (e.layer === wanderwege) karteZustand.wanderwege = false; });
}

// ---------------------------------------------------------------------------
// Daten
// ---------------------------------------------------------------------------

function spurenAuspacken(daten) {
  karteZustand.offen = typeof daten.offen === 'number' ? daten.offen : null;
  karteZustand.spuren = (daten.spuren || []).map(z => ({
    id: z[0], sportart: z[1], datum: z[2], jahr: Number(String(z[2]).slice(0, 4)), pfad: z[3], teile: null
  }));
}

/**
 * Lädt die Spuren: zuerst aus dem Zwischenspeicher, dann vom Netz.
 * @param {boolean} erzwingen auch laden, wenn schon Spuren da sind
 * @param {boolean} nurCache nur aus dem Zwischenspeicher (vom Netz nur, wenn dort nichts liegt)
 */
async function spurenLaden(erzwingen, nurCache) {
  if (karteZustand.laedt || (karteZustand.spuren && !erzwingen)) return;
  karteZustand.laedt = true;
  karteZustand.fehler = null;
  // Zuerst aus dem Cache (schnell, offline)
  if (!karteZustand.spuren) {
    try {
      const cache = await caches.open(DATEN_CACHE);
      const r = await cache.match('spuren.json');
      if (r) {
        spurenAuspacken(await r.json());
        if (nurCache) {
          karteZustand.laedt = false;
          spurenGeladen();
          return;
        }
        spurenGeladen();
      }
    } catch (e) { /* kein Cache verfügbar */ }
  }
  try {
    const daten = await api('spuren');
    spurenAuspacken(daten);
    try {
      const cache = await caches.open(DATEN_CACHE);
      await cache.put('spuren.json', new Response(JSON.stringify({ spuren: daten.spuren, offen: daten.offen })));
    } catch (e) { /* nicht schlimm */ }
  } catch (e) {
    karteZustand.fehler = e.message;
  } finally {
    karteZustand.laedt = false;
    spurenGeladen();
  }
}

/** Nach dem Laden der Spuren die Ansichten neu zeichnen, die sie brauchen. */
function spurenGeladen() {
  const a = zustand.ansicht;
  if (a === 'karte' || a === 'tour' || a === 'detail' || a === 'erfolge' ||
    (a === 'historie' && typeof historieZustand !== 'undefined' && historieZustand.modus === 'touren')) zeichnen();
}

function gefilterteSpuren() {
  const touren = karteZustand.nurTouren ? tourenErgebnis() : null;
  return (karteZustand.spuren || []).filter(s =>
    karteZustand.filter[s.sportart] && (karteZustand.jahr === 'alle' || s.jahr === Number(karteZustand.jahr)) &&
    (!touren || touren.proAktivitaet.has(s.id)));
}

// ---------------------------------------------------------------------------
// Heatmap nach Häufigkeit
// ---------------------------------------------------------------------------

const MERC = 6378137;
function mercator(p) {
  return [p[1] * Math.PI / 180 * MERC, Math.log(Math.tan(Math.PI / 4 + p[0] * Math.PI / 360)) * MERC];
}
/**
 * Schlüssel eines Rasterfelds als kleine Ganzzahl (schnell in einer Map). Er wiederholt sich
 * alle ca. 1000 km; zwei so weit entfernte Felder teilen sich den Zähler, was praktisch
 * nie sichtbar ist.
 */
function zellSchluessel(xi, yi) {
  return ((xi & 0x7fff) << 16) | (yi & 0xffff);
}

/**
 * Zählt pro Rasterfeld die verschiedenen Spuren und teilt jede Spur in Stücke mit einer
 * Häufigkeitsstufe. Ergebnis: linien[stufe][sportart] = [[[lat, lon], …], …].
 */
function heatBerechnen(liste) {
  const zaehler = new Map(); // Schlüssel → Anzahl * 65536 + letzte Spur
  const projiziert = liste.map((s, t) => {
    if (!s.teile) s.teile = spurTeile(s.pfad);
    const marke = t % 65536;
    return s.teile.map(teil => {
      const m = teil.map(mercator);
      let letzter = -1;
      for (let i = 1; i < m.length; i++) {
        const ax = m[i - 1][0];
        const ay = m[i - 1][1];
        const dx = m[i][0] - ax;
        const dy = m[i][1] - ay;
        const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / HEAT_SCHRITT));
        for (let k = 0; k <= n; k++) {
          const key = zellSchluessel(Math.floor((ax + dx * k / n) / HEAT_ZELLE), Math.floor((ay + dy * k / n) / HEAT_ZELLE));
          if (key === letzter) continue;
          letzter = key;
          const v = zaehler.get(key);
          if (v === undefined) zaehler.set(key, 65536 + marke);
          else if (v % 65536 !== marke) zaehler.set(key, (Math.floor(v / 65536) + 1) * 65536 + marke);
        }
      }
      return m;
    });
  });
  // Höchste Anzahl im Feld und in den drei Nachbarfeldern, die dem Punkt am nächsten liegen
  // (deckt etwa ±15 m GPS-Abweichung ab). Ergebnisse je Feld und Viertel zwischengespeichert.
  const merker = [new Map(), new Map(), new Map(), new Map()];
  const anzahl = (x, y) => {
    const fx = x / HEAT_ZELLE;
    const fy = y / HEAT_ZELLE;
    const xi = Math.floor(fx);
    const yi = Math.floor(fy);
    const nx = fx - xi < 0.5 ? -1 : 1;
    const ny = fy - yi < 0.5 ? -1 : 1;
    const key = zellSchluessel(xi, yi);
    const m = merker[(nx > 0 ? 1 : 0) + (ny > 0 ? 2 : 0)];
    const gemerkt = m.get(key);
    if (gemerkt !== undefined) return gemerkt;
    let max = 0;
    [key, zellSchluessel(xi + nx, yi), zellSchluessel(xi, yi + ny), zellSchluessel(xi + nx, yi + ny)].forEach(k => {
      const v = zaehler.get(k);
      if (v !== undefined && v >= (max + 1) * 65536) max = Math.floor(v / 65536);
    });
    m.set(key, max);
    return max;
  };
  const stufe = c => c >= 5 ? 3 : c >= 2 ? 2 : 1;
  const linien = { 1: {}, 2: {}, 3: {} };
  liste.forEach((s, t) => {
    s.teile.forEach((teil, nr) => {
      const m = projiziert[t][nr];
      let aktuell = null;
      let stufeAktuell = 0;
      const abschliessen = () => {
        if (aktuell && aktuell.length >= 2) {
          (linien[stufeAktuell][s.sportart] = linien[stufeAktuell][s.sportart] || []).push(aktuell);
        }
      };
      for (let i = 1; i < teil.length; i++) {
        const a = teil[i - 1];
        const b = teil[i];
        const ma = m[i - 1];
        const mb = m[i];
        const ex = mb[0] - ma[0];
        const ey = mb[1] - ma[1];
        const laenge = Math.sqrt(ex * ex + ey * ey); // Math.hypot ist deutlich langsamer
        const stuecke = Math.max(1, Math.ceil(laenge / HEAT_STUECK));
        for (let k = 0; k < stuecke; k++) {
          const f0 = k / stuecke;
          const f1 = (k + 1) / stuecke;
          const fm = (f0 + f1) / 2;
          const st = stufe(anzahl(ma[0] + (mb[0] - ma[0]) * fm, ma[1] + (mb[1] - ma[1]) * fm));
          const p0 = k === 0 ? a : [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0];
          const p1 = k === stuecke - 1 ? b : [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1];
          if (st !== stufeAktuell) {
            abschliessen();
            aktuell = [p0];
            stufeAktuell = st;
          }
          aktuell.push(p1);
        }
      }
      abschliessen();
    });
  });
  return linien;
}

function heatHolen(liste) {
  const schluessel = liste.length + ':' + liste.reduce((n, s) => n + s.pfad.length, 0) + ':' +
    KARTE_SPORTARTEN.map(sa => karteZustand.filter[sa] ? 1 : 0).join('') + ':' + karteZustand.jahr + ':' + karteZustand.nurTouren;
  if (!karteZustand.heat || karteZustand.heat.schluessel !== schluessel || karteZustand.heat.spuren !== karteZustand.spuren) {
    karteZustand.heat = { schluessel, spuren: karteZustand.spuren, linien: heatBerechnen(liste) };
  }
  return karteZustand.heat.linien;
}

// ---------------------------------------------------------------------------
// Vollbild
// ---------------------------------------------------------------------------

function karteVollbild(welche) {
  if (karteZustand.vollbild) {
    history.back(); // popstate in app.js schließt das Vollbild
    return;
  }
  karteZustand.vollbild = welche;
  history.pushState({ vollbild: welche }, '');
  zeichnen();
}

const SYMBOL_VOLLBILD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const SYMBOL_VOLLBILD_AUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

/** Leaflet-Knopf für Vollbild (unter den Zoom-Knöpfen). */
function vollbildKnopf(welche) {
  const Knopf = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const rahmen = L.DomUtil.create('div', 'leaflet-bar');
      const knopf = L.DomUtil.create('a', 'vollbild-knopf', rahmen);
      const an = karteZustand.vollbild === welche;
      knopf.href = '#';
      knopf.setAttribute('role', 'button');
      knopf.setAttribute('aria-label', an ? 'Vollbild beenden' : 'Vollbild');
      knopf.title = an ? 'Vollbild beenden' : 'Vollbild';
      knopf.innerHTML = an ? SYMBOL_VOLLBILD_AUS : SYMBOL_VOLLBILD;
      L.DomEvent.disableClickPropagation(rahmen);
      L.DomEvent.on(knopf, 'click', ev => {
        L.DomEvent.stop(ev);
        karteVollbild(welche);
      });
      return rahmen;
    }
  });
  return new Knopf();
}

function vollbildAnwenden(flaeche, welche) {
  const an = karteZustand.vollbild === welche;
  flaeche.classList.toggle('vollbild', an);
  document.body.classList.toggle('vollbild-aktiv', !!karteZustand.vollbild);
}

// ---------------------------------------------------------------------------
// Ansicht „Karte“
// ---------------------------------------------------------------------------

function ansichtKarte() {
  if ((!karteZustand.spuren || karteZustand.veraltet) && !karteZustand.laedt) {
    karteZustand.veraltet = false;
    spurenLaden(!!karteZustand.spuren);
  }
  const jahre = Array.from(new Set((karteZustand.spuren || []).map(s => s.jahr))).sort((a, b) => b - a);
  const liste = gefilterteSpuren();
  const proId = new Map(zustand.aktivitaeten.map(a => [a.id, a]));
  const kmSumme = liste.reduce((s, x) => s + ((proId.get(x.id) || {}).km || 0), 0);

  let info;
  if (karteZustand.fehler && !karteZustand.spuren) info = `<span class="hinweis-fehler">${esc(karteZustand.fehler)}</span>`;
  else if (!karteZustand.spuren) info = 'Lade Spuren …';
  else info = `<b>${liste.length}</b> ${liste.length === 1 ? 'Spur' : 'Spuren'} · ${km(kmSumme)}` +
    (karteZustand.offen ? ` · <span class="leise">${karteZustand.offen} werden noch geladen oder bereinigt</span>` : '') +
    (karteZustand.laedt ? ' · <span class="leise">aktualisiere …</span>' : '');

  return `<div class="titel-zeile"><h1>Karte</h1>${HILFE_KNOPF}</div>
    <div class="filter-reihe">
      ${KARTE_SPORTARTEN.map(sa => `<button type="button" class="chip ${karteZustand.filter[sa] ? 'an' : ''}" style="--farbe: var(--${sa})"
        data-aktion="karte-filter" data-sportart="${sa}" aria-pressed="${karteZustand.filter[sa]}">${SPORT_NAME[sa]}</button>`).join('')}
      <button type="button" class="chip ${karteZustand.nurTouren ? 'an' : ''}" style="--farbe: var(--text-2)"
        data-aktion="karte-touren" aria-pressed="${karteZustand.nurTouren}">Nur Touren</button>
      <select data-karte="jahr" aria-label="Jahr">
        <option value="alle" ${karteZustand.jahr === 'alle' ? 'selected' : ''}>Alle Jahre</option>
        ${jahre.map(j => `<option value="${j}" ${String(karteZustand.jahr) === String(j) ? 'selected' : ''}>${j}</option>`).join('')}
      </select>
    </div>
    <div id="karte" class="karte-flaeche" role="region" aria-label="Karte mit deinen Spuren"></div>
    <p class="karte-info">${info}</p>
    <div class="legende-linien" aria-hidden="true">
      <span><i style="height:${LINIEN_BREITE[1]}px"></i>1×</span>
      <span><i style="height:${LINIEN_BREITE[2]}px"></i>2–4×</span>
      <span><i style="height:${LINIEN_BREITE[3]}px"></i>5× und öfter</span>
    </div>
    <p class="leise klein-text">Je öfter du eine Strecke gegangen oder gefahren bist, desto dicker die Linie. Oben rechts lassen sich die <b>Wanderwege der Schweiz</b> einblenden: So siehst du, wo du noch nicht gewandert bist. Linie antippen für Details.</p>`;
}

/** Wird nach jedem Zeichnen der Ansicht „Karte“ aufgerufen. */
async function karteNachZeichnen() {
  const flaeche = document.getElementById('karte');
  if (!flaeche) return;
  vollbildAnwenden(flaeche, 'karte');
  try {
    await leafletLaden();
  } catch (e) {
    flaeche.innerHTML = `<p class="leer">${esc(e.message)}</p>`;
    return;
  }
  if (!document.body.contains(flaeche)) return; // inzwischen neu gezeichnet
  if (karteZustand.karte) {
    karteZustand.karte.remove();
    karteZustand.karte = null;
  }
  const karte = L.map(flaeche, { preferCanvas: true, maxZoom: 19 }); // ganze Zoomstufen: keine hellen Kachelkanten
  karteZustand.karte = karte;
  kartenEbenen(karte, karteZustand.grundkarte, 0.6);
  vollbildKnopf('karte').addTo(karte);

  // Grenzen je Spur für Antippen und Zoom
  const liste = gefilterteSpuren();
  const grenzen = L.latLngBounds([]);
  liste.forEach(s => {
    if (!s.teile) s.teile = spurTeile(s.pfad);
    if (!s.grenzen) {
      s.grenzen = L.latLngBounds([]);
      s.teile.forEach(t => s.grenzen.extend(L.latLngBounds(t)));
    }
    if (s.grenzen.isValid()) grenzen.extend(s.grenzen);
  });

  karte.on('click', e => karteAngetippt(karte, liste, e));
  const vollbildVerlassen = () => {
    if (karteZustand.vollbild) {
      karteZustand.vollbild = null;
      document.body.classList.remove('vollbild-aktiv');
      history.replaceState(null, '');
    }
  };
  karte.on('popupopen', e => {
    e.popup.getElement().querySelectorAll('.popup-knopf').forEach(knopf => {
      knopf.addEventListener('click', () => {
        vollbildVerlassen();
        detailOeffnen(knopf.dataset.id);
      });
    });
    e.popup.getElement().querySelectorAll('.popup-tour').forEach(knopf => {
      knopf.addEventListener('click', ev => {
        ev.stopPropagation();
        vollbildVerlassen();
        tourOeffnen(knopf.dataset.tour);
      });
    });
  });
  if (karteZustand.sicht) karte.setView(karteZustand.sicht.mitte, karteZustand.sicht.zoom);
  else if (grenzen.isValid()) karte.fitBounds(grenzen, { padding: [16, 16] });
  else karte.setView([46.8, 8.2], 8); // Schweiz
  karte.on('moveend', () => { karteZustand.sicht = { mitte: karte.getCenter(), zoom: karte.getZoom() }; });

  // Linien erst nach dem ersten Bild berechnen, damit die Karte sofort erscheint.
  // Pro Stufe zuerst der weiße Rand, dann die Farbe; dicke Linien obenauf.
  setTimeout(() => {
    if (karteZustand.karte !== karte) return;
    const zeichner = L.canvas({ padding: 0.5 });
    const linien = heatHolen(liste);
    const faktor = breitenFaktor(karte.getZoom());
    karteZustand.ebenen = [];
    [1, 2, 3].forEach(st => {
      const alle = [].concat(...Object.values(linien[st]));
      if (!alle.length) return;
      const rand = L.polyline(alle, { renderer: zeichner, color: '#fff', weight: (LINIEN_BREITE[st] + 3) * faktor, opacity: 0.95, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(karte);
      karteZustand.ebenen.push({ ebene: rand, breite: LINIEN_BREITE[st] + 3 });
      Object.keys(linien[st]).forEach(sa => {
        const linie = L.polyline(linien[st][sa], { renderer: zeichner, color: LINIEN_FARBE[sa] || '#555', weight: LINIEN_BREITE[st] * faktor, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(karte);
        karteZustand.ebenen.push({ ebene: linie, breite: LINIEN_BREITE[st] });
      });
    });
    // Ein Punkt je Spur (Mitte der Strecke), nur weit herausgezoomt
    karteZustand.punkte = L.layerGroup(liste.filter(sp => sp.teile.length).map(sp => {
      const teil = sp.teile.reduce((a, b) => (b.length > a.length ? b : a));
      return L.circleMarker(teil[Math.floor(teil.length / 2)], {
        renderer: zeichner, radius: 4.5, color: '#fff', weight: 1.5, fillColor: LINIEN_FARBE[sp.sportart] || '#555', fillOpacity: 1, interactive: false
      });
    }));
    const zoomAnpassen = () => {
      const f = breitenFaktor(karte.getZoom());
      karteZustand.ebenen.forEach(x => x.ebene.setStyle({ weight: x.breite * f }));
      const zeigen = karte.getZoom() <= PUNKTE_BIS_ZOOM;
      if (zeigen && !karte.hasLayer(karteZustand.punkte)) karteZustand.punkte.addTo(karte);
      if (!zeigen && karte.hasLayer(karteZustand.punkte)) karte.removeLayer(karteZustand.punkte);
      if (karteZustand.markierung) karteZustand.markierung.eachLayer(l => l.bringToFront());
    };
    zoomAnpassen();
    karte.on('zoomend', zoomAnpassen);
  }, 30);
}

/** Markiert Spuren gelb (über allen anderen Linien); leere Liste entfernt die Markierung. */
function spurenMarkieren(karte, spuren) {
  if (karteZustand.markierung) {
    karte.removeLayer(karteZustand.markierung);
    karteZustand.markierung = null;
  }
  if (!spuren.length) return;
  const f = breitenFaktor(karte.getZoom());
  const ebenen = [];
  spuren.forEach(sp => {
    ebenen.push(L.polyline(sp.teile, { color: '#2b2100', weight: 9 * f, opacity: 0.75, interactive: false, lineCap: 'round', lineJoin: 'round' }));
    ebenen.push(L.polyline(sp.teile, { color: MARKIERUNG_FARBE, weight: 5 * f, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }));
  });
  karteZustand.markierung = L.layerGroup(ebenen).addTo(karte);
}

/** Zeigt alle Aktivitäten, deren Spur nahe am angetippten Punkt liegt. */
function karteAngetippt(karte, liste, e) {
  const toleranz = 14; // Pixel
  const p = karte.latLngToLayerPoint(e.latlng);
  const ecke = karte.layerPointToLatLng(p.add([toleranz, toleranz]));
  const dLat = Math.abs(ecke.lat - e.latlng.lat);
  const dLon = Math.abs(ecke.lng - e.latlng.lng);
  const treffer = [];
  liste.forEach(s => {
    const g = s.grenzen;
    if (!g || !g.isValid() || e.latlng.lat < g.getSouth() - dLat || e.latlng.lat > g.getNorth() + dLat ||
      e.latlng.lng < g.getWest() - dLon || e.latlng.lng > g.getEast() + dLon) return;
    const nah = s.teile.some(t => {
      let vorher = karte.latLngToLayerPoint(t[0]);
      for (let i = 1; i < t.length; i++) {
        const jetzt = karte.latLngToLayerPoint(t[i]);
        if (L.LineUtil.pointToSegmentDistance(p, vorher, jetzt) <= toleranz) return true;
        vorher = jetzt;
      }
      return false;
    });
    if (nah) treffer.push(s);
  });
  if (!treffer.length) {
    spurenMarkieren(karte, []);
    return;
  }
  treffer.sort((a, b) => (a.datum < b.datum ? 1 : -1));
  const proId = new Map(zustand.aktivitaeten.map(a => [a.id, a]));
  const max = 20;
  const zeilen = treffer.slice(0, max).map(s => {
    const a = proId.get(s.id) || {};
    const hoehe = a.hm || a.hmAb ? `<br><span class="leise">↑ ${zahlFormat0.format(a.hm || 0)} m${typeof a.hmAb === 'number' ? ' · ↓ ' + zahlFormat0.format(a.hmAb) + ' m' : ''}</span>` : '';
    return `<li class="popup-eintrag" data-id="${esc(s.id)}"><b>${esc(a.name || SPORT_NAME[s.sportart])}</b><br>
      <span class="leise">${esc(datumLang(lokalesDatum(s.datum)))}${a.km ? ' · ' + km(a.km) : ''}${a.min ? ' · ' + dauer(a.min) : ''}</span>${hoehe}
      ${tourPopupZeile(s.id)}
      <button type="button" class="knopf klein popup-knopf" data-id="${esc(s.id)}">Details</button></li>`;
  }).join('');
  const popup = L.popup({ maxWidth: 290 })
    .setLatLng(e.latlng)
    .setContent(`${treffer.length > 1 ? `<b>Hier warst du ${treffer.length}×</b><br><span class="leise klein-text">Antippen markiert eine einzelne Route.</span>` : ''}<ul class="popup-liste">${zeilen}</ul>` +
      (treffer.length > max ? `<span class="leise">und ${treffer.length - max} weitere</span>` : ''))
    .openOn(karte);
  // Erst nach openOn markieren: Das Schließen des alten Popups entfernt sonst die neue Markierung
  karteZustand.markierungPopup = popup;
  spurenMarkieren(karte, treffer);
  const element = popup.getElement();
  if (element) {
    element.querySelectorAll('.popup-eintrag').forEach(li => {
      li.addEventListener('click', ev => {
        if (ev.target.closest('.popup-knopf, .popup-tour')) return;
        const sp = treffer.find(x => x.id === li.dataset.id);
        if (!sp) return;
        element.querySelectorAll('.popup-eintrag').forEach(x => x.classList.toggle('gewaehlt', x === li));
        spurenMarkieren(karte, [sp]);
      });
    });
  }
  popup.on('remove', () => {
    if (karteZustand.markierungPopup !== popup) return;
    karteZustand.markierungPopup = null;
    spurenMarkieren(karte, []);
  });
}

// ---------------------------------------------------------------------------
// Spur in der Detailansicht
// ---------------------------------------------------------------------------

function detailSpurHtml(a) {
  if (!a.gps || KARTE_SPORTARTEN.indexOf(a.sportart) < 0 || a.unplausibel) return '';
  return `<section class="karte karte-detail-rahmen"><div id="detail-karte" class="detail-karte" role="region" aria-label="Spur dieser Aktivität"></div></section>
    <p id="detail-karte-hinweis" class="leise klein-text detail-karte-hinweis"></p>`;
}

async function detailKarteNachZeichnen(id) {
  const flaeche = document.getElementById('detail-karte');
  if (!flaeche) return;
  vollbildAnwenden(flaeche, 'detail');
  try {
    await leafletLaden();
    let spur = karteZustand.feineSpuren.get(id);
    if (spur === undefined) {
      const d = await api('spur', { id: id });
      spur = d.fein ? { fein: d.fein, entferntKm: d.entferntKm } : null;
      karteZustand.feineSpuren.set(id, spur);
    }
    if (!document.body.contains(flaeche)) return;
    if (!spur) {
      flaeche.innerHTML = '<p class="leer">Die Spur ist noch nicht geladen. Sie wird im Hintergrund nachgeholt.</p>';
      flaeche.classList.add('leer-karte');
      return;
    }
    if (karteZustand.detailKarte) karteZustand.detailKarte.remove();
    const a = zustand.aktivitaeten.find(x => x.id === id) || {};
    const teile = spurTeile(spur.fein);
    if (!teile.length) return;
    const karte = L.map(flaeche, { scrollWheelZoom: false, maxZoom: 19 });
    karteZustand.detailKarte = karte;
    const fotos = fotosZustand.fotos ? fotoEbene(karte, aktivitaetFotos(a)) : null;
    kartenEbenen(karte, inDerSchweiz(L.latLngBounds([].concat(...teile))) ? karteZustand.grundkarte : 'osm', 0.7, fotos);
    if (fotos) fotos.addTo(karte);
    vollbildKnopf('detail').addTo(karte);
    L.polyline(teile, { color: '#fff', weight: 8, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(karte);
    const linie = L.polyline(teile, { color: LINIEN_FARBE[a.sportart] || LINIEN_FARBE.wandern, weight: 4.5, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(karte);
    const start = teile[0][0];
    const letztes = teile[teile.length - 1];
    L.circleMarker(start, { radius: 7, color: '#fff', weight: 2, fillColor: '#2f9e63', fillOpacity: 1 }).bindTooltip('Start').addTo(karte);
    L.circleMarker(letztes[letztes.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#c23b3b', fillOpacity: 1 }).bindTooltip('Ziel').addTo(karte);
    karte.fitBounds(linie.getBounds(), { padding: [20, 20] });
    const hinweis = document.getElementById('detail-karte-hinweis');
    if (hinweis && spur.entferntKm >= 0.1) {
      hinweis.textContent = 'Bereinigt: ' + km(spur.entferntKm) + ' mit unrealistischem Tempo oder GPS-Sprüngen ausgeblendet (z. B. Zug).';
    }
  } catch (e) {
    if (document.body.contains(flaeche)) flaeche.innerHTML = `<p class="leer">${esc(e.message)}</p>`;
  }
}

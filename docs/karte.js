/**
 * karte.js – Ansicht „Karte“ (Heatmap aller Spuren) und Spur in der Detailansicht
 * Version: 0.9.0 (2026-11-18)
 *
 * - Grundkarte: graue Landeskarte von swisstopo (WMTS, Web-Mercator), damit die farbigen Spuren
 *   gut sichtbar sind; umschaltbar auf die farbige Landeskarte oder OpenStreetMap.
 * - Ebene „Wanderwege (Schweiz)“ von swisstopo: zeigt alle offiziellen Wanderwege. Zusammen
 *   mit den eigenen Spuren sieht man, wo man noch nicht gewandert ist.
 * - Spuren: grobe Polylines (30 m) aller Aktivitäten von der Web-App (Aktion „spuren“),
 *   halbtransparent übereinander gezeichnet: Wo man oft war, wird die Linie kräftiger
 *   (Heatmap-Effekt). Filter nach Sportart und Jahr. Antippen öffnet die Aktivität.
 * - Detailansicht: feine Spur (5 m) einer Aktivität (Aktion „spur“) mit Start und Ziel.
 * Leaflet 1.9.4 wird erst beim ersten Öffnen einer Karte von cdnjs geladen (mit SRI-Prüfsumme).
 * Die Spuren werden zusätzlich im Cache des Browsers gespeichert (offline nutzbar).
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
const DATEN_CACHE = 'sport-daten';

const karteZustand = {
  filter: { wandern: true, rad: true, ski: true, laufen: false },
  jahr: 'alle',
  grundkarte: 'grau',
  wanderwege: false,
  sicht: null,        // {mitte, zoom} der letzten Ansicht
  spuren: null,       // [{id, sportart, jahr, pfad, punkte}]
  offen: null,        // Aktivitäten, deren Spur noch nachgeladen wird
  laedt: false,
  fehler: null,
  karte: null,        // Leaflet-Karte der Ansicht „Karte“
  detailKarte: null,
  feineSpuren: new Map()
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

function sportFarbe(sportart) {
  return getComputedStyle(document.documentElement).getPropertyValue('--' + sportart).trim() || '#888';
}

// ---------------------------------------------------------------------------
// Daten
// ---------------------------------------------------------------------------

function spurenAuspacken(daten) {
  karteZustand.offen = typeof daten.offen === 'number' ? daten.offen : null;
  karteZustand.spuren = (daten.spuren || []).map(z => ({
    id: z[0], sportart: z[1], datum: z[2], jahr: Number(String(z[2]).slice(0, 4)), pfad: z[3], punkte: null
  }));
}

async function spurenLaden(erzwingen) {
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
        if (zustand.ansicht === 'karte') zeichnen();
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
    if (zustand.ansicht === 'karte') zeichnen();
  }
}

function gefilterteSpuren() {
  return (karteZustand.spuren || []).filter(s =>
    karteZustand.filter[s.sportart] && (karteZustand.jahr === 'alle' || s.jahr === Number(karteZustand.jahr)));
}

// ---------------------------------------------------------------------------
// Ansicht „Karte“
// ---------------------------------------------------------------------------

function ansichtKarte() {
  if (!karteZustand.spuren && !karteZustand.laedt) spurenLaden(false);
  const jahre = Array.from(new Set((karteZustand.spuren || []).map(s => s.jahr))).sort((a, b) => b - a);
  const liste = gefilterteSpuren();
  const proId = new Map(zustand.aktivitaeten.map(a => [a.id, a]));
  const kmSumme = liste.reduce((s, x) => s + ((proId.get(x.id) || {}).km || 0), 0);

  let info;
  if (karteZustand.fehler && !karteZustand.spuren) info = `<span class="hinweis-fehler">${esc(karteZustand.fehler)}</span>`;
  else if (!karteZustand.spuren) info = 'Lade Spuren …';
  else info = `<b>${liste.length}</b> ${liste.length === 1 ? 'Spur' : 'Spuren'} · ${km(kmSumme)}` +
    (karteZustand.offen ? ` · <span class="leise">${karteZustand.offen} werden noch nachgeladen</span>` : '');

  return `<div class="titel-zeile"><h1>Karte</h1>${HILFE_KNOPF}</div>
    <div class="filter-reihe">
      ${KARTE_SPORTARTEN.map(sa => `<button type="button" class="chip ${karteZustand.filter[sa] ? 'an' : ''}" style="--farbe: var(--${sa})"
        data-aktion="karte-filter" data-sportart="${sa}" aria-pressed="${karteZustand.filter[sa]}">${SPORT_NAME[sa]}</button>`).join('')}
      <select data-karte="jahr" aria-label="Jahr">
        <option value="alle" ${karteZustand.jahr === 'alle' ? 'selected' : ''}>Alle Jahre</option>
        ${jahre.map(j => `<option value="${j}" ${String(karteZustand.jahr) === String(j) ? 'selected' : ''}>${j}</option>`).join('')}
      </select>
    </div>
    <div id="karte" class="karte-flaeche" role="region" aria-label="Karte mit deinen Spuren"></div>
    <p class="karte-info">${info}</p>
    <p class="leise klein-text">Wo du oft warst, sind die Linien kräftiger. Oben rechts in der Karte lassen sich die <b>Wanderwege der Schweiz</b> einblenden: So siehst du, wo du noch nicht gewandert bist. Linie antippen für Details.</p>`;
}

/** Wird nach jedem Zeichnen der Ansicht „Karte“ aufgerufen. */
async function karteNachZeichnen() {
  const flaeche = document.getElementById('karte');
  if (!flaeche) return;
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
  const karte = L.map(flaeche, { preferCanvas: true, zoomSnap: 0.5 });
  karteZustand.karte = karte;
  const grundkarten = {
    grau: L.tileLayer(KACHELN.swisstopoGrau, { maxNativeZoom: 18, maxZoom: 19, attribution: '© swisstopo' }),
    farbe: L.tileLayer(KACHELN.swisstopo, { maxNativeZoom: 18, maxZoom: 19, attribution: '© swisstopo' }),
    osm: L.tileLayer(KACHELN.osm, { maxZoom: 19, attribution: '© OpenStreetMap-Mitwirkende' })
  };
  const wanderwege = L.tileLayer(KACHELN.wanderwege, { maxNativeZoom: 18, maxZoom: 19, opacity: 0.9, attribution: 'Wanderwege © swisstopo' });
  (grundkarten[karteZustand.grundkarte] || grundkarten.grau).addTo(karte);
  if (karteZustand.wanderwege) wanderwege.addTo(karte);
  L.control.layers({
    'Landeskarte grau': grundkarten.grau, 'Landeskarte farbig': grundkarten.farbe, 'OpenStreetMap': grundkarten.osm
  }, { 'Wanderwege (Schweiz)': wanderwege }).addTo(karte);
  karte.on('baselayerchange', e => {
    karteZustand.grundkarte = Object.keys(grundkarten).find(k => grundkarten[k] === e.layer) || 'grau';
  });
  karte.on('overlayadd', () => { karteZustand.wanderwege = true; });
  karte.on('overlayremove', () => { karteZustand.wanderwege = false; });

  const zeichner = L.canvas({ padding: 0.5, tolerance: 6 });
  const grenzen = L.latLngBounds([]);
  const proId = new Map(zustand.aktivitaeten.map(a => [a.id, a]));
  const farben = {};
  gefilterteSpuren().forEach(s => {
    if (!s.punkte) s.punkte = polylineDekodieren(s.pfad);
    if (s.punkte.length < 2) return;
    farben[s.sportart] = farben[s.sportart] || sportFarbe(s.sportart);
    const linie = L.polyline(s.punkte, { renderer: zeichner, color: farben[s.sportart], weight: 4, opacity: 0.55 });
    const a = proId.get(s.id);
    linie.bindPopup(`<b>${esc(a ? (a.name || SPORT_NAME[a.sportart]) : SPORT_NAME[s.sportart])}</b><br>
      ${esc(datumLang(lokalesDatum(s.datum)))}${a && a.km ? ' · ' + km(a.km) : ''}<br>
      <button type="button" class="knopf klein popup-knopf" data-id="${esc(s.id)}">Details</button>`);
    linie.addTo(karte);
    grenzen.extend(linie.getBounds());
  });
  karte.on('popupopen', e => {
    const knopf = e.popup.getElement().querySelector('.popup-knopf');
    if (knopf) knopf.addEventListener('click', () => detailOeffnen(knopf.dataset.id));
  });
  if (karteZustand.sicht) karte.setView(karteZustand.sicht.mitte, karteZustand.sicht.zoom);
  else if (grenzen.isValid()) karte.fitBounds(grenzen, { padding: [16, 16] });
  else karte.setView([46.8, 8.2], 8); // Schweiz
  karte.on('moveend', () => { karteZustand.sicht = { mitte: karte.getCenter(), zoom: karte.getZoom() }; });
}

// ---------------------------------------------------------------------------
// Spur in der Detailansicht
// ---------------------------------------------------------------------------

function detailSpurHtml(a) {
  if (!a.gps || KARTE_SPORTARTEN.indexOf(a.sportart) < 0 || a.unplausibel) return '';
  return `<h2>Spur</h2><section class="karte karte-detail-rahmen"><div id="detail-karte" class="detail-karte" role="region" aria-label="Spur dieser Aktivität"></div></section>`;
}

async function detailKarteNachZeichnen(id) {
  const flaeche = document.getElementById('detail-karte');
  if (!flaeche) return;
  try {
    await leafletLaden();
    let fein = karteZustand.feineSpuren.get(id);
    if (fein === undefined) {
      const d = await api('spur', { id: id });
      fein = d.fein || null;
      karteZustand.feineSpuren.set(id, fein);
    }
    if (!document.body.contains(flaeche)) return;
    if (!fein) {
      flaeche.innerHTML = '<p class="leer">Die Spur ist noch nicht geladen. Sie wird im Hintergrund nachgeholt.</p>';
      flaeche.classList.add('leer-karte');
      return;
    }
    if (karteZustand.detailKarte) karteZustand.detailKarte.remove();
    const karte = L.map(flaeche, { zoomSnap: 0.5, scrollWheelZoom: false });
    karteZustand.detailKarte = karte;
    L.tileLayer(KACHELN.swisstopoGrau, { maxNativeZoom: 18, maxZoom: 19, attribution: '© swisstopo' }).addTo(karte);
    const a = zustand.aktivitaeten.find(x => x.id === id) || {};
    const punkte = polylineDekodieren(fein);
    const linie = L.polyline(punkte, { color: sportFarbe(a.sportart || 'wandern'), weight: 4, opacity: 0.9 }).addTo(karte);
    L.circleMarker(punkte[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#2f9e63', fillOpacity: 1 }).bindTooltip('Start').addTo(karte);
    L.circleMarker(punkte[punkte.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#c23b3b', fillOpacity: 1 }).bindTooltip('Ziel').addTo(karte);
    karte.fitBounds(linie.getBounds(), { padding: [20, 20] });
  } catch (e) {
    if (document.body.contains(flaeche)) flaeche.innerHTML = `<p class="leer">${esc(e.message)}</p>`;
  }
}

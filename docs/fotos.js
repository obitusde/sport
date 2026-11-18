/**
 * fotos.js – Fotos aus dem Fotoschatz in Touren und Aktivitäten
 * Version: 0.14.0 (2026-11-18)
 *
 * Der Fotoschatz (eigene App, obitusde/fotoschatz) legt Bilder und ein Inhaltsverzeichnis
 * index-<Schlüssel>.json in Cloudflare R2 ab. Jedes Foto hat Aufnahmezeit (t, lokal), Ordner
 * (f) und meist GPS (la, lo). Die Sport-App liest dieses Verzeichnis mit Christofs eigenem
 * Fotoschatz-Link und zeigt:
 * - auf der Tour-Seite: Fotos aus dem Zeitraum der Tour als kleine Punkte auf der Karte
 *   (zusammengefasst, abschaltbar) und als schmaler Bildstreifen, Link in den Fotoschatz;
 * - in der Detailansicht: Fotos während der Aktivität.
 * Der Link wird nur auf dem Gerät gespeichert (localStorage „sport.fotoschatz“), nie im Repo
 * oder Sheet. Im Browser kann er aus dem Fotoschatz übernommen werden (gleiche Herkunft
 * obitusde.github.io, Schlüssel „fotoschatz.links“), in der Android-App wird er eingefügt.
 * Das Verzeichnis (einige MB) liegt im Cache „sport-daten“ und wird höchstens einmal am Tag
 * neu geladen. Die öffentliche R2-Adresse ist kein Geheimnis (siehe Fotoschatz CLAUDE.md).
 * Link in den Fotoschatz: …/fotoschatz/?f=<Ordner>&b=<Bild-id>#<Link>. Ältere
 * Fotoschatz-Fassungen ignorieren ?f und ?b und öffnen die Ordnerliste.
 */
'use strict';

const FOTOSCHATZ_APP = 'https://obitusde.github.io/fotoschatz/';
const FOTOSCHATZ_R2 = 'https://pub-6f47b0d5f2154b4fbdd0ac01fe7b6f8e.r2.dev';
const FOTOSCHATZ_LINK_RE = /^[A-Za-z0-9]{32,}(-[A-Za-z0-9]{16,})?$/;
const FOTOS_SPEICHER = 'sport.fotoschatz';
const FOTOS_STAND = 'sport.fotoschatz.stand';
const FOTOS_CACHE_DATEI = 'fotoschatz-index.json';
const FOTOS_ALTER_MS = 24 * 60 * 60 * 1000;
const FOTO_PUNKT_RASTER = 44; // Pixel: Fotos näher beisammen werden ein Punkt mit Zahl

const fotosZustand = {
  fotos: null,        // [{t: Date, id, h, f, la, lo, de, ort}] nach Zeit sortiert
  laedt: false,
  fehler: null,
  anzahl: 0,
  betrachter: null    // {liste, nr}
};

function fotoschatzLink() {
  try { return localStorage.getItem(FOTOS_SPEICHER) || ''; } catch (e) { return ''; }
}

/** Link aus einer eingefügten Adresse oder dem reinen Geheimnis. */
function fotoschatzLinkAus(text) {
  const t = String(text || '').trim();
  const roh = decodeURIComponent(t.indexOf('#') >= 0 ? t.slice(t.indexOf('#') + 1) : t).split('/')[0].trim();
  return FOTOSCHATZ_LINK_RE.test(roh) ? roh : '';
}

/** Links, die der Fotoschatz in diesem Browser gespeichert hat (nur im Browser, nicht in der APK). */
function fotoschatzLinksImBrowser() {
  try {
    const liste = JSON.parse(localStorage.getItem('fotoschatz.links') || '[]');
    return Array.isArray(liste) ? liste.filter(x => typeof x === 'string' && FOTOSCHATZ_LINK_RE.test(x)) : [];
  } catch (e) {
    return [];
  }
}

function fotoschatzBasis(link) {
  return FOTOSCHATZ_R2 + '/' + link.split('-')[0];
}

const fotoThumb = p => fotoschatzBasis(fotoschatzLink()) + '/thumb/' + p.id + '.' + p.h + '.webp';
const fotoBild = p => fotoschatzBasis(fotoschatzLink()) + '/img/' + p.id + '.' + p.h + '.jpg';

function fotoschatzOrdnerLink(ordner, bild) {
  const link = fotoschatzLink();
  const teile = [];
  if (ordner) teile.push('f=' + encodeURIComponent(ordner));
  if (bild) teile.push('b=' + encodeURIComponent(bild));
  return FOTOSCHATZ_APP + (teile.length ? '?' + teile.join('&') : '') + '#' + link;
}

function fotosAuspacken(index) {
  const parse = t => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):?(\d{2})?/.exec(t || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
  };
  fotosZustand.fotos = (index.photos || []).map(p => ({
    t: parse(p.t), id: p.id, h: p.h, f: p.f, de: p.de || '',
    la: typeof p.la === 'number' ? p.la : null, lo: typeof p.lo === 'number' ? p.lo : null,
    ort: [p.sl, p.ci].filter(Boolean).join(', ')
  })).filter(p => p.t && p.id && p.h).sort((x, y) => x.t - y.t);
  fotosZustand.anzahl = fotosZustand.fotos.length;
}

/**
 * Lädt das Fotoschatz-Verzeichnis: zuerst aus dem Cache, vom Netz, wenn keines da ist, es
 * älter als einen Tag ist oder erzwingen gesetzt ist.
 */
async function fotosLaden(erzwingen) {
  const link = fotoschatzLink();
  if (!link || fotosZustand.laedt) return;
  if (fotosZustand.fotos && !erzwingen) return;
  fotosZustand.laedt = true;
  fotosZustand.fehler = null;
  let stand = 0;
  try { stand = Number(localStorage.getItem(FOTOS_STAND)) || 0; } catch (e) { /* egal */ }
  try {
    if (!erzwingen) {
      try {
        const cache = await caches.open(DATEN_CACHE);
        const r = await cache.match(FOTOS_CACHE_DATEI);
        if (r) {
          fotosAuspacken(await r.json());
          fotosGeladen();
          if (Date.now() - stand < FOTOS_ALTER_MS) return;
        }
      } catch (e) { /* kein Cache */ }
    }
    const key = link.split('-')[1];
    const antwort = await fetch(fotoschatzBasis(link) + '/' + (key ? 'index-' + key : 'index') + '.json', { cache: 'no-cache' });
    if (antwort.status === 403 || antwort.status === 404) throw new Error('Der Fotoschatz-Link gilt nicht (mehr).');
    if (!antwort.ok) throw new Error('Fotoschatz nicht erreichbar (HTTP ' + antwort.status + ').');
    const text = await antwort.text();
    fotosAuspacken(JSON.parse(text));
    try {
      const cache = await caches.open(DATEN_CACHE);
      await cache.put(FOTOS_CACHE_DATEI, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
      localStorage.setItem(FOTOS_STAND, String(Date.now()));
    } catch (e) { /* nicht schlimm */ }
  } catch (e) {
    fotosZustand.fehler = e.message === 'Failed to fetch' ? 'Fotoschatz nicht erreichbar.' : e.message;
  } finally {
    fotosZustand.laedt = false;
    fotosGeladen();
  }
}

function fotosGeladen() {
  if (['tour', 'detail', 'einstellungen'].indexOf(zustand.ansicht) >= 0) zeichnen();
}

/** Fotos zwischen von und bis (Date). */
function fotosZwischen(von, bis) {
  const f = fotosZustand.fotos;
  if (!f) return [];
  // Binäre Suche nach dem ersten Foto ab „von“
  let lo = 0;
  let hi = f.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (f[m].t < von) lo = m + 1; else hi = m;
  }
  const ergebnis = [];
  for (let i = lo; i < f.length && f[i].t <= bis; i++) ergebnis.push(f[i]);
  return ergebnis;
}

function aktivitaetEnde(a) {
  return new Date(a.datum.getTime() + ((a.minGesamt || a.min || 0) * 60000));
}

/** Fotos einer Tour: ab 1 h vor der ersten bis 3 h nach dem Ende der letzten Aktivität. */
function tourFotos(t) {
  const aktivitaeten = t.teile.map(tt => tt.x.a);
  const letzte = aktivitaeten[aktivitaeten.length - 1];
  return fotosZwischen(new Date(aktivitaeten[0].datum.getTime() - 3600000), new Date(aktivitaetEnde(letzte).getTime() + 3 * 3600000));
}

/** Fotos während einer Aktivität (±15 Minuten). */
function aktivitaetFotos(a) {
  return fotosZwischen(new Date(a.datum.getTime() - 900000), new Date(aktivitaetEnde(a).getTime() + 900000));
}

/** Ordner mit den meisten Fotos zuerst. */
function fotoOrdner(fotos) {
  const n = new Map();
  fotos.forEach(p => n.set(p.f, (n.get(p.f) || 0) + 1));
  return Array.from(n.entries()).sort((x, y) => y[1] - x[1]).map(([f]) => f);
}

// ---------------------------------------------------------------------------
// Anzeige: Bildstreifen, Karte, Betrachter
// ---------------------------------------------------------------------------

/** Abschnitt „Fotos“ (Tour-Seite oder Detailansicht). tagNull: Datum des ersten Tourtags. */
function fotosHtml(fotos, tagNull) {
  if (!fotoschatzLink()) return '';
  if (!fotosZustand.fotos) {
    fotosLaden(false);
    return fotosZustand.fehler ? `<p class="leise klein-text">Fotos: ${esc(fotosZustand.fehler)}</p>` : '<p class="leise klein-text">Lade Fotos aus dem Fotoschatz …</p>';
  }
  if (!fotos.length) return '';
  const ordner = fotoOrdner(fotos);
  let html = `<div class="fotos-kopf"><h2>Fotos <span class="leise">${fotos.length}</span></h2>
    <a class="knopf klein" href="${esc(fotoschatzOrdnerLink(ordner[0]))}" target="_blank" rel="noopener">Im Fotoschatz öffnen</a></div>
    <div class="foto-streifen" role="list">`;
  let tagVorher = '';
  fotos.forEach((p, i) => {
    const tag = schluessel(p.t);
    if (tagNull && tag !== tagVorher) {
      const nr = Math.round((new Date(p.t.getFullYear(), p.t.getMonth(), p.t.getDate()) - new Date(tagNull.getFullYear(), tagNull.getMonth(), tagNull.getDate())) / 86400000) + 1;
      html += `<span class="foto-tag">Tag ${nr}</span>`;
      tagVorher = tag;
    }
    html += `<button type="button" class="foto-mini" role="listitem" data-foto-nr="${i}" aria-label="Foto ${i + 1}"><img loading="lazy" src="${esc(fotoThumb(p))}" alt=""></button>`;
  });
  html += '</div>';
  if (ordner.length > 1) {
    html += `<p class="leise klein-text">Ordner im Fotoschatz: ${ordner.slice(0, 4).map(o => `<a href="${esc(fotoschatzOrdnerLink(o))}" target="_blank" rel="noopener">${esc(o)}</a>`).join(', ')}</p>`;
  }
  fotosZustand.liste = fotos;
  return html;
}

/** Fotos als kleine, zusammengefasste Punkte auf einer Leaflet-Karte (abschaltbare Ebene). */
function fotoEbene(karte, fotos) {
  const mitGps = fotos.map((p, i) => ({ p, i })).filter(x => x.p.la !== null && x.p.lo !== null);
  const ebene = L.layerGroup();
  if (!mitGps.length) return null;
  const zeichnenFotos = () => {
    ebene.clearLayers();
    const gruppen = new Map();
    mitGps.forEach(x => {
      const pt = karte.project([x.p.la, x.p.lo], karte.getZoom());
      const key = Math.floor(pt.x / FOTO_PUNKT_RASTER) + ',' + Math.floor(pt.y / FOTO_PUNKT_RASTER);
      if (!gruppen.has(key)) gruppen.set(key, []);
      gruppen.get(key).push(x);
    });
    gruppen.forEach(liste => {
      const la = liste.reduce((s, x) => s + x.p.la, 0) / liste.length;
      const lo = liste.reduce((s, x) => s + x.p.lo, 0) / liste.length;
      const n = liste.length;
      L.marker([la, lo], {
        icon: L.divIcon({ className: 'foto-punkt', html: `<span>${n > 1 ? n : ''}</span>`, iconSize: n > 1 ? [22, 22] : [12, 12] }),
        keyboard: false, title: n > 1 ? n + ' Fotos' : 'Foto'
      }).on('click', () => fotoBetrachter(fotos, liste[0].i)).addTo(ebene);
    });
  };
  karte.whenReady(zeichnenFotos); // erst wenn die Karte einen Ausschnitt hat
  karte.on('zoomend', zeichnenFotos);
  return ebene;
}

function fotoBetrachter(liste, nr) {
  if (!liste || !liste.length) return;
  if (!fotosZustand.betrachter) history.pushState({ foto: true }, '');
  fotosZustand.betrachter = { liste, nr: Math.max(0, Math.min(liste.length - 1, nr)) };
  betrachterZeichnen();
}

function betrachterZeichnen() {
  let box = document.getElementById('foto-betrachter');
  const b = fotosZustand.betrachter;
  if (!b) {
    if (box) box.remove();
    document.body.classList.remove('vollbild-aktiv');
    return;
  }
  if (!box) {
    box = document.createElement('div');
    box.id = 'foto-betrachter';
    box.className = 'foto-betrachter';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Foto');
    document.body.appendChild(box);
    let startX = null;
    box.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', e => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) fotoBlaettern(dx < 0 ? 1 : -1);
    });
  }
  document.body.classList.add('vollbild-aktiv');
  const p = b.liste[b.nr];
  const zeit = TAGE_KURZ[(p.t.getDay() + 6) % 7] + ' ' + p.t.getDate() + '. ' + MONATE[p.t.getMonth()] + ' ' + p.t.getFullYear() + ', ' + uhrzeit(p.t);
  box.innerHTML = `<img src="${esc(fotoBild(p))}" alt="${esc(p.de)}">
    <div class="foto-leiste">
      <button type="button" class="rund" data-foto-aktion="zu" aria-label="Schließen">×</button>
      <span class="foto-text"><b>${b.nr + 1} / ${b.liste.length}</b> · ${esc(zeit)}${p.ort ? ' · ' + esc(p.ort) : ''}${p.de ? '<br>' + esc(p.de) : ''}</span>
      <a class="knopf klein" href="${esc(fotoschatzOrdnerLink(p.f, p.id))}" target="_blank" rel="noopener">Fotoschatz</a>
    </div>
    ${b.nr > 0 ? '<button type="button" class="foto-pfeil links" data-foto-aktion="zurueck" aria-label="Vorheriges Foto">‹</button>' : ''}
    ${b.nr < b.liste.length - 1 ? '<button type="button" class="foto-pfeil rechts" data-foto-aktion="weiter" aria-label="Nächstes Foto">›</button>' : ''}`;
}

function fotoBlaettern(richtung) {
  const b = fotosZustand.betrachter;
  if (!b) return;
  const nr = b.nr + richtung;
  if (nr < 0 || nr >= b.liste.length) return;
  b.nr = nr;
  betrachterZeichnen();
}

/** Schließt den Betrachter (über die Zurück-Taste, damit der Verlauf stimmt). */
function betrachterSchliessen() {
  if (fotosZustand.betrachter) history.back();
}

/** Wird von popstate in app.js zuerst gefragt. */
function betrachterZurueck() {
  if (!fotosZustand.betrachter) return false;
  fotosZustand.betrachter = null;
  betrachterZeichnen();
  return true;
}

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------

function fotoschatzEinstellungenHtml() {
  const link = fotoschatzLink();
  if (link) {
    const stand = (() => { try { return Number(localStorage.getItem(FOTOS_STAND)) || 0; } catch (e) { return 0; } })();
    if (!fotosZustand.fotos && !fotosZustand.laedt && !fotosZustand.fehler) fotosLaden(false);
    return `<h2>Fotoschatz</h2><section class="karte">
      <p style="margin-top:0">Verbunden${fotosZustand.fotos ? ' · ' + zahlFormat0.format(fotosZustand.anzahl) + ' Fotos' : ''}${stand ? ' · Stand ' + esc(zeitpunkt(new Date(stand).toISOString())) : ''}</p>
      ${fotosZustand.laedt ? '<p class="leise">Lade Fotoschatz …</p>' : ''}
      ${fotosZustand.fehler ? `<p class="hinweis-fehler">${esc(fotosZustand.fehler)}</p>` : ''}
      <p class="leise klein-text">Fotos aus dem Zeitraum einer Tour oder Aktivität erscheinen auf deren Seite und als Punkte auf der Karte. Der Link ist nur auf diesem Gerät gespeichert.</p>
      <div class="knopfreihe">
        <button class="knopf" data-foto-aktion="neu-laden" ${fotosZustand.laedt ? 'disabled' : ''}>Fotos neu laden</button>
        <button class="knopf" data-foto-aktion="trennen">Trennen</button>
      </div>
    </section>`;
  }
  const imBrowser = fotoschatzLinksImBrowser();
  return `<h2>Fotoschatz</h2><section class="karte">
    <p class="leise klein-text" style="margin-top:0">Zeigt Fotos aus deinem Fotoschatz auf Tour- und Aktivitätsseiten. Dafür braucht die App einmal deinen persönlichen Fotoschatz-Link. Er wird nur auf diesem Gerät gespeichert.</p>
    ${imBrowser.length ? `<button class="knopf haupt" data-foto-aktion="uebernehmen">Link aus dem Fotoschatz dieses Browsers übernehmen</button><p class="leise klein-text">oder einen Link einfügen:</p>` : ''}
    <label class="feld"><span>Fotoschatz-Link</span>
      <input type="url" data-foto-feld placeholder="https://obitusde.github.io/fotoschatz/#…" autocomplete="off"></label>
    <button class="knopf" data-foto-aktion="verbinden">Verbinden</button>
    ${fotosZustand.fehler ? `<p class="hinweis-fehler">${esc(fotosZustand.fehler)}</p>` : ''}
  </section>`;
}

function fotoschatzVerbinden(link) {
  if (!link) {
    fotosZustand.fehler = 'Das ist kein gültiger Fotoschatz-Link.';
    zeichnen();
    return;
  }
  try { localStorage.setItem(FOTOS_SPEICHER, link); } catch (e) { /* privat */ }
  fotosZustand.fotos = null;
  fotosZustand.fehler = null;
  fotosLaden(true).then(() => meldung(fotosZustand.fehler ? 'Fehler: ' + fotosZustand.fehler : 'Fotoschatz verbunden: ' + zahlFormat0.format(fotosZustand.anzahl) + ' Fotos.'));
  zeichnen();
}

document.addEventListener('click', ereignis => {
  const mini = ereignis.target.closest('[data-foto-nr]');
  if (mini) {
    fotoBetrachter(fotosZustand.liste, Number(mini.dataset.fotoNr));
    return;
  }
  const ziel = ereignis.target.closest('[data-foto-aktion]');
  if (!ziel) return;
  switch (ziel.dataset.fotoAktion) {
    case 'zu': betrachterSchliessen(); break;
    case 'weiter': fotoBlaettern(1); break;
    case 'zurueck': fotoBlaettern(-1); break;
    case 'neu-laden': fotosLaden(true); zeichnen(); break;
    case 'uebernehmen': {
      const liste = fotoschatzLinksImBrowser();
      fotoschatzVerbinden(liste[0] || '');
      break;
    }
    case 'verbinden': {
      const feld = document.querySelector('[data-foto-feld]');
      fotoschatzVerbinden(fotoschatzLinkAus(feld && feld.value));
      break;
    }
    case 'trennen':
      if (!confirm('Fotoschatz trennen? Die Fotos verschwinden aus der Sport-App, im Fotoschatz bleibt alles.')) return;
      try {
        localStorage.removeItem(FOTOS_SPEICHER);
        localStorage.removeItem(FOTOS_STAND);
        caches.open(DATEN_CACHE).then(c => c.delete(FOTOS_CACHE_DATEI)).catch(() => {});
      } catch (e) { /* egal */ }
      fotosZustand.fotos = null;
      fotosZustand.fehler = null;
      zeichnen();
      break;
  }
});

document.addEventListener('keydown', e => {
  if (!fotosZustand.betrachter) return;
  if (e.key === 'ArrowRight') fotoBlaettern(1);
  if (e.key === 'ArrowLeft') fotoBlaettern(-1);
  if (e.key === 'Escape') betrachterSchliessen();
});

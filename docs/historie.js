/**
 * historie.js – Ansicht „Historie“: alle Aktivitäten durchsuchen und filtern
 * Version: 0.15.0 (2026-11-19)
 *
 * Suche (Name, Ort, Sportart, Jahr; Umlaute egal), Filter nach Sportart, Jahr, Ort und
 * Länge, Sortierung nach Datum, Distanz, Höhenmeter oder Dauer. Oben eine Summe der
 * gefundenen Aktivitäten. Nach Datum sortiert gruppiert die Liste nach Monaten.
 * Es werden zuerst 100 Treffer gezeigt, „Mehr anzeigen“ lädt weitere.
 * Tippen auf einen Eintrag öffnet die Detailansicht; „Zurück“ führt hierher zurück.
 * Die Suche zeichnet nur die Trefferliste neu, damit die Tastatur offen bleibt.
 * Ab 0.12.0: Umschalter „Aktivitäten | Touren“; Touren (touren.js) mit Suche, Sportart und Jahr.
 * Ab 0.15.0: dritter Reiter „Routen“ (gleiche Routen mit Rangliste, routen.js).
 * Nutzt Funktionen und Konstanten aus app.js (wird vor app.js geladen, aber erst später aufgerufen).
 */
'use strict';

const HISTORIE_LAENGEN = [
  { key: 'alle', name: 'Jede Länge' },
  { key: '0-5', name: 'bis 5 km', von: 0, bis: 5 },
  { key: '5-10', name: '5–10 km', von: 5, bis: 10 },
  { key: '10-20', name: '10–20 km', von: 10, bis: 20 },
  { key: '20-50', name: '20–50 km', von: 20, bis: 50 },
  { key: '50-', name: 'über 50 km', von: 50, bis: Infinity }
];
const HISTORIE_SORTIERUNG = [
  { key: 'neu', name: 'Neueste zuerst' },
  { key: 'alt', name: 'Älteste zuerst' },
  { key: 'km', name: 'Längste Distanz' },
  { key: 'hm', name: 'Meiste Höhenmeter' },
  { key: 'min', name: 'Längste Dauer' }
];
const HISTORIE_SEITE = 100;

const historieZustand = {
  modus: 'aktivitaeten', // oder 'touren', 'routen'
  suche: '',
  sportarten: new Set(), // leer = alle
  jahr: 'alle',
  ort: 'alle',
  laenge: 'alle',
  sortierung: 'neu',
  anzahl: HISTORIE_SEITE
};

/** Kleinbuchstaben ohne Akzente: „Zürich“ → „zurich“. */
function suchText(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function historieGefiltert() {
  const h = historieZustand;
  const woerter = suchText(h.suche).split(/\s+/).filter(Boolean);
  const laenge = HISTORIE_LAENGEN.find(x => x.key === h.laenge);
  const liste = zustand.aktivitaeten.filter(a => {
    if (h.sportarten.size && !h.sportarten.has(a.sportart)) return false;
    if (h.jahr !== 'alle' && a.datum.getFullYear() !== Number(h.jahr)) return false;
    if (h.ort !== 'alle' && (a.ort || '') !== h.ort) return false;
    if (laenge && laenge.key !== 'alle' && !((a.km || 0) >= laenge.von && (a.km || 0) < laenge.bis)) return false;
    if (woerter.length) {
      const heu = suchText([a.name, a.ort, SPORT_NAME[a.sportart], a.typ, a.datum.getFullYear(), MONATE[a.datum.getMonth()]].join(' '));
      if (!woerter.every(w => heu.indexOf(w) >= 0)) return false;
    }
    return true;
  });
  const nach = {
    neu: (x, y) => y.datum - x.datum,
    alt: (x, y) => x.datum - y.datum,
    km: (x, y) => (y.km || 0) - (x.km || 0),
    hm: (x, y) => (y.hm || 0) - (x.hm || 0),
    min: (x, y) => (y.min || 0) - (x.min || 0)
  };
  return liste.sort(nach[h.sortierung] || nach.neu);
}

/** Orte, die mindestens zweimal vorkommen, nach Häufigkeit. */
function historieOrte() {
  const zaehler = new Map();
  zustand.aktivitaeten.forEach(a => { if (a.ort) zaehler.set(a.ort, (zaehler.get(a.ort) || 0) + 1); });
  return Array.from(zaehler.entries()).filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
}

function historieEintrag(a, mitMonat) {
  const tag = TAGE_KURZ[(a.datum.getDay() + 6) % 7] + ' ' + a.datum.getDate() + '.' + (mitMonat ? '' : (a.datum.getMonth() + 1) + '.' + a.datum.getFullYear());
  const werte = [SPORT_NAME[a.sportart] || a.sportart];
  if (wertListe(a)) werte.push(wertListe(a));
  return `<button type="button" class="eintrag" data-aktion="detail" data-id="${esc(a.id)}" style="--farbe: var(--${esc(a.sportart)})">
    <span class="eintrag-marke" aria-hidden="true"></span>
    <span class="eintrag-text">
      <span class="eintrag-name">${esc(a.name || SPORT_NAME[a.sportart] || a.typ)}</span>
      <span class="eintrag-werte">${esc(werte.join(' · '))}${a.unplausibel ? ' · <span class="warnung">zählt nicht</span>' : ''}</span>
      ${a.ort ? `<span class="eintrag-werte eintrag-ort">${esc(a.ort)}</span>` : ''}
    </span>
    <span class="eintrag-zeit">${tag}</span>
    <svg class="eintrag-pfeil" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
  </button>`;
}

function historieErgebnisHtml() {
  if (!zustand.aktivitaeten.length) return '<div class="karte leer">Noch keine Daten geladen.</div>';
  if (historieZustand.modus === 'touren') return tourenListeHtml(historieZustand);
  if (historieZustand.modus === 'routen') return routenListeHtml(historieZustand);
  const liste = historieGefiltert();
  const zaehlende = liste.filter(zaehlt);
  const kmSumme = zaehlende.reduce((s, a) => s + (a.km || 0), 0);
  const hmSumme = zaehlende.reduce((s, a) => s + (a.hm || 0), 0);
  const minSumme = zaehlende.reduce((s, a) => s + (a.min || 0), 0);
  let html = `<p class="historie-summe"><b>${zahlFormat0.format(liste.length)}</b> ${liste.length === 1 ? 'Aktivität' : 'Aktivitäten'}` +
    (liste.length ? ` · ${km(kmSumme)} · ${zahlFormat0.format(hmSumme)} hm · ${dauer(minSumme)}` : '') + '</p>';
  if (!liste.length) return html + '<div class="karte leer">Nichts gefunden. Suche oder Filter ändern.</div>';

  const sichtbar = liste.slice(0, historieZustand.anzahl);
  const nachDatum = historieZustand.sortierung === 'neu' || historieZustand.sortierung === 'alt';
  html += '<div class="liste">';
  let monat = '';
  sichtbar.forEach(a => {
    if (nachDatum) {
      const m = MONATE[a.datum.getMonth()] + ' ' + a.datum.getFullYear();
      if (m !== monat) {
        monat = m;
        html += `<div class="liste-tag">${m}</div>`;
      }
    }
    html += historieEintrag(a, nachDatum);
  });
  html += '</div>';
  if (liste.length > sichtbar.length) {
    html += `<button type="button" class="knopf voll" data-hist-aktion="mehr">Mehr anzeigen (noch ${zahlFormat0.format(liste.length - sichtbar.length)})</button>`;
  }
  return html;
}

function ansichtHistorie() {
  const h = historieZustand;
  const jahre = Array.from(new Set(zustand.aktivitaeten.map(a => a.datum.getFullYear()))).sort((x, y) => y - x);
  const orte = historieOrte();
  const vorhanden = new Set(zustand.aktivitaeten.map(a => a.sportart));
  const option = (wert, text, aktuell) => `<option value="${esc(wert)}" ${String(aktuell) === String(wert) ? 'selected' : ''}>${esc(text)}</option>`;
  const gefiltert = h.suche || h.sportarten.size || h.jahr !== 'alle' || h.ort !== 'alle' || h.laenge !== 'alle' || h.sortierung !== 'neu';
  const touren = h.modus !== 'aktivitaeten'; // Touren und Routen: weniger Filter
  const sportFuerModus = h.modus === 'touren' ? TOUR_SPORTARTEN : h.modus === 'routen' ? ROUTE_SPORTARTEN : null;
  const reiter = (modus, text) => `<button type="button" class="${h.modus === modus ? 'an' : ''}" data-hist-aktion="modus" data-modus="${modus}" aria-pressed="${h.modus === modus}">${text}</button>`;
  const platzhalter = { aktivitaeten: 'Suchen: Name, Ort, Jahr …', touren: 'Tour suchen: Name, Ort, Jahr …', routen: 'Route suchen: Name, Ort …' };
  return `<h1>Historie</h1>
    <div class="umschalter" role="group" aria-label="Anzeigen">
      ${reiter('aktivitaeten', 'Aktivitäten')}${reiter('touren', 'Touren')}${reiter('routen', 'Routen')}
    </div>
    <input type="search" class="historie-suche" data-hist="suche" placeholder="${platzhalter[h.modus]}" value="${esc(h.suche)}" aria-label="Suchen" enterkeyhint="search">
    <div class="filter-reihe">
      ${SPORTARTEN.filter(s => vorhanden.has(s.key) && (!sportFuerModus || sportFuerModus.indexOf(s.key) >= 0)).map(s => `<button type="button" class="chip ${h.sportarten.has(s.key) ? 'an' : ''}" style="--farbe: var(--${s.key})"
        data-hist-aktion="sport" data-sportart="${s.key}" aria-pressed="${h.sportarten.has(s.key)}">${s.name}</button>`).join('')}
    </div>
    <div class="historie-filter ${touren ? 'nur-jahr' : ''}">
      <select data-hist="jahr" aria-label="Jahr">${option('alle', 'Alle Jahre', h.jahr)}${jahre.map(j => option(j, j, h.jahr)).join('')}</select>
      ${touren ? '' : `<select data-hist="laenge" aria-label="Länge">${HISTORIE_LAENGEN.map(x => option(x.key, x.name, h.laenge)).join('')}</select>
      <select data-hist="ort" aria-label="Ort">${option('alle', 'Alle Orte', h.ort)}${orte.map(([o, n]) => option(o, o + ' (' + n + ')', h.ort)).join('')}</select>
      <select data-hist="sortierung" aria-label="Sortierung">${HISTORIE_SORTIERUNG.map(x => option(x.key, x.name, h.sortierung)).join('')}</select>`}
    </div>
    ${gefiltert ? '<button type="button" class="knopf klein" data-hist-aktion="zuruecksetzen">Filter zurücksetzen</button>' : ''}
    <div id="historie-ergebnis">${historieErgebnisHtml()}</div>`;
}

function historieErgebnisNeu() {
  const ziel = document.getElementById('historie-ergebnis');
  if (ziel) ziel.innerHTML = historieErgebnisHtml();
}

let historieSucheZeit = null;
document.addEventListener('input', ereignis => {
  const feld = ereignis.target.closest('[data-hist="suche"]');
  if (!feld) return;
  clearTimeout(historieSucheZeit);
  historieSucheZeit = setTimeout(() => {
    historieZustand.suche = feld.value;
    historieZustand.anzahl = HISTORIE_SEITE;
    historieErgebnisNeu();
  }, 200);
});

document.addEventListener('change', ereignis => {
  const feld = ereignis.target.closest('select[data-hist]');
  if (!feld) return;
  historieZustand[feld.dataset.hist] = feld.value;
  historieZustand.anzahl = HISTORIE_SEITE;
  zeichnen();
});

document.addEventListener('click', ereignis => {
  const ziel = ereignis.target.closest('[data-hist-aktion]');
  if (!ziel) return;
  switch (ziel.dataset.histAktion) {
    case 'sport': {
      const sa = ziel.dataset.sportart;
      if (historieZustand.sportarten.has(sa)) historieZustand.sportarten.delete(sa);
      else historieZustand.sportarten.add(sa);
      historieZustand.anzahl = HISTORIE_SEITE;
      zeichnen();
      break;
    }
    case 'modus':
      historieZustand.modus = ziel.dataset.modus;
      historieZustand.anzahl = HISTORIE_SEITE;
      if (historieZustand.modus !== 'aktivitaeten') spurenLaden(false);
      zeichnen();
      break;
    case 'mehr':
      historieZustand.anzahl += HISTORIE_SEITE;
      historieErgebnisNeu();
      break;
    case 'zuruecksetzen':
      Object.assign(historieZustand, { suche: '', jahr: 'alle', ort: 'alle', laenge: 'alle', sortierung: 'neu', anzahl: HISTORIE_SEITE });
      historieZustand.sportarten.clear();
      zeichnen();
      break;
  }
});

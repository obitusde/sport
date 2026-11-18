/**
 * form.js – Ansicht „Form“: Wo stehe ich sportlich? Relative Werte statt absoluter.
 * Version: 0.9.0 (2026-11-18)
 *
 * Alles wird mit dem eigenen Schnitt verglichen:
 * - Formstand: Ø der letzten 4 abgeschlossenen Wochen gegenüber dem Ø der letzten
 *   52 abgeschlossenen Wochen (100 % = dein Schnitt).
 * - Sportpunkte pro Woche (26 Wochen) mit Ziel und Schnitt als Linien.
 * - Laufökonomie: Meter pro Herzschlag (Geschwindigkeit ÷ Ø-Puls) von Läufen draußen
 *   ab 3 km mit Puls. Anschaulich als „Pace bei Puls 150“. Vergleich der letzten
 *   3 Monate mit den 3 Monaten davor und mit dem Vorjahr.
 * - Dieses Jahr bis heute gegenüber dem Vorjahr bis zum gleichen Tag.
 * - Aktive Stunden pro Jahr.
 * Ab 0.8.0: Schritte pro Tag vom Handy (letzte 28 Tage gegenüber bis zu 365 Tagen davor).
 * Ab 0.9.0: „Punkte“ = Sportpunkte + Alltagspunkte (wie das Aktivziel).
 * Unrealistische Aktivitäten (siehe plausibilitaet in app.js) zählen nicht für km und Zeit.
 * Nutzt Hilfsfunktionen und Konstanten aus app.js (wird vor app.js geladen, aber erst
 * nach dem Laden aufgerufen).
 */
'use strict';

/** Abgeschlossene Wochen (Montage) vor der laufenden Woche, älteste zuerst. */
function letzteWochen(n) {
  const diese = montag(new Date());
  const liste = [];
  for (let i = n; i >= 1; i--) liste.push(tagePlus(diese, -7 * i));
  return liste;
}

function mittel(werte) {
  return werte.length ? werte.reduce((s, x) => s + x, 0) / werte.length : 0;
}

function median(werte) {
  if (!werte.length) return null;
  const s = werte.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Verhältnis als „112 %“. */
function prozent(v) {
  return zahlFormat0.format(v * 100) + ' %';
}

/** Verhältnis als Veränderung, z. B. „+12 %“ oder „−8 %“. */
function veraenderung(v) {
  const p = Math.round((v - 1) * 100);
  return (p > 0 ? '+' : p < 0 ? '−' : '±') + Math.abs(p) + ' %';
}

function formKlasse(v) {
  if (v >= 1.05) return 'gut';
  if (v >= 0.95) return 'neutral';
  return 'tief';
}

function formText(v) {
  if (v >= 1.2) return 'deutlich über deinem Schnitt';
  if (v >= 1.05) return 'über deinem Schnitt';
  if (v >= 0.95) return 'in deinem Schnitt';
  if (v >= 0.8) return 'etwas unter deinem Schnitt';
  return 'deutlich unter deinem Schnitt';
}

/** Durchschnittliche Sportpunkte pro Woche der letzten 12 Monate (ab 2023). */
function punkteSchnitt() {
  const wochen = letzteWochen(52).filter(w => w >= PUNKTE_START);
  return wochen.length >= 4 ? mittel(wochen.map(w => woche(w).pkt)) : null;
}

const FORM_METRIKEN = [
  { key: 'pkt', name: 'Punkte', wert: w => w.pkt, format: x => zahlFormat0.format(x) + ' Pkt', abPunkte: true },
  { key: 'zeit', name: 'Aktive Zeit', wert: w => w.min, format: x => dauer(x) },
  { key: 'laeufe', name: 'Läufe', wert: w => w.laeufe, format: x => dezimal1.format(x) },
  { key: 'laufen', name: 'Lauf-km', wert: w => w.km.laufen, format: x => km(x) },
  { key: 'rad', name: 'Rad-km', wert: w => w.km.rad, format: x => km(x) },
  { key: 'wandern', name: 'Wander-km', wert: w => w.km.wandern, format: x => km(x) }
];

/** Letzte 4 Wochen gegenüber den letzten 52 Wochen, je Kennzahl. */
function formVergleich() {
  const w52 = letzteWochen(52);
  const w4 = w52.slice(-4);
  return FORM_METRIKEN.map(m => {
    const basis = m.abPunkte ? w52.filter(w => w >= PUNKTE_START) : w52;
    const kurz = m.abPunkte ? w4.filter(w => w >= PUNKTE_START) : w4;
    if (basis.length < 8 || !kurz.length) return null;
    const schnitt = mittel(basis.map(w => m.wert(woche(w))));
    const jetzt = mittel(kurz.map(w => m.wert(woche(w))));
    if (!schnitt) return null;
    return Object.assign({}, m, { schnitt, jetzt, verhaeltnis: jetzt / schnitt });
  }).filter(Boolean).concat(schritteVergleich() || []);
}

/** Schritte pro Tag: letzte 28 Tage (ohne heute) gegenüber bis zu 365 Tagen davor. */
function schritteVergleich() {
  if (!zustand.schritte || !zustand.schritte.size) return null;
  const heute = tagePlus(new Date(), 0);
  const jetzt = schritteZeitraum(tagePlus(heute, -28), heute);
  const basis = schritteZeitraum(tagePlus(heute, -28 - 365), tagePlus(heute, -28));
  if (jetzt.length < 7 || basis.length < 14) return null;
  const s = mittel(basis);
  if (!s) return null;
  return [{ key: 'schritte', name: 'Schritte pro Tag', format: x => zahlFormat0.format(x), jetzt: mittel(jetzt), schnitt: s, verhaeltnis: mittel(jetzt) / s }];
}

/** Eine Zeile „Kennzahl – relativer Wert“ mit Balken (Mitte = 100 %). */
function vergleichZeile(name, unter, v) {
  const breite = Math.min(v, 2) / 2 * 100;
  return `<div class="vgl">
    <div class="vgl-text"><span class="vgl-name">${esc(name)}</span><small>${unter}</small></div>
    <div class="vgl-skala" aria-hidden="true"><span class="vgl-balken ${formKlasse(v)}" style="width:${breite.toFixed(1)}%"></span><span class="vgl-mitte"></span></div>
    <div class="vgl-wert ${formKlasse(v)}">${prozent(v)}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Diagramme (SVG, Farben über CSS-Klassen, damit hell und dunkel passen)
// ---------------------------------------------------------------------------

function punkteDiagramm() {
  const diese = montag(new Date());
  const wochen = letzteWochen(26).concat([diese]).filter(w => w >= PUNKTE_START);
  if (wochen.length < 4) return '';
  const werte = wochen.map(w => woche(w).pkt);
  const ziel = Number(zustand.einstellungen.wochenzielPunkte) || 0;
  const schnitt = punkteSchnitt() || 0;
  const max = Math.max(...werte, ziel, schnitt, 1) * 1.12;
  const B = 340;
  const H = 150;
  const oben = 8;
  const unten = 18;
  const bw = B / wochen.length;
  const y = v => oben + (H - unten - oben) * (1 - v / max);

  let svg = '';
  wochen.forEach((w, i) => {
    const v = werte[i];
    const klasse = w.getTime() === diese.getTime() ? 'bar-jetzt' : (ziel && v >= ziel ? 'bar-ja' : 'bar-nein');
    svg += `<rect class="${klasse}" x="${(i * bw + 1).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(H - unten - y(v)).toFixed(1)}" rx="2"><title>KW ${kalenderwoche(w)}: ${v} Punkte</title></rect>`;
    if (i === 0 || w.getMonth() !== wochen[i - 1].getMonth()) {
      svg += `<text class="achse" x="${(i * bw + 1).toFixed(1)}" y="${H - 4}">${MONATE[w.getMonth()].slice(0, 3)}</text>`;
    }
  });
  if (ziel) svg += `<line class="linie-ziel" x1="0" x2="${B}" y1="${y(ziel).toFixed(1)}" y2="${y(ziel).toFixed(1)}"/>`;
  if (schnitt) svg += `<line class="linie-schnitt" x1="0" x2="${B}" y1="${y(schnitt).toFixed(1)}" y2="${y(schnitt).toFixed(1)}"/>`;
  return `<svg class="diagramm" viewBox="0 0 ${B} ${H}" role="img" aria-label="Sportpunkte pro Woche der letzten 26 Wochen">${svg}</svg>
    <div class="legende"><span><i class="lg-ja"></i>Ziel erreicht</span><span><i class="lg-nein"></i>nicht erreicht</span><span><i class="lg-jetzt"></i>diese Woche</span>
      ${ziel ? `<span><i class="lg-ziel"></i>Ziel ${ziel}</span>` : ''}${schnitt ? `<span><i class="lg-schnitt"></i>dein Schnitt ${zahlFormat0.format(schnitt)}</span>` : ''}</div>`;
}

/** Laufökonomie: Meter pro Herzschlag. */
function laufoekonomie() {
  const laeufe = zustand.aktivitaeten.filter(a => a.sportart === 'laufen' && a.typ !== 'treadmill_running' &&
    zaehlt(a) && a.km >= 3 && a.min && a.puls >= 80);
  const wert = a => (a.km * 1000 / a.min) / a.puls;
  const morgen = tagePlus(new Date(), 1);
  const fenster = (vonTage, bisTage) => laeufe
    .filter(a => a.datum >= tagePlus(morgen, -vonTage) && a.datum < tagePlus(morgen, -bisTage))
    .map(wert);
  const jetzt = fenster(91, 0);
  const davor = fenster(182, 91);
  const vorjahr = fenster(365 + 91, 365);

  // Monatswerte der letzten 24 Monate (Median, mindestens 2 Läufe)
  const heute = new Date();
  const monate = [];
  for (let i = 23; i >= 0; i--) {
    const start = new Date(heute.getFullYear(), heute.getMonth() - i, 1);
    const ende = new Date(heute.getFullYear(), heute.getMonth() - i + 1, 1);
    const werte = laeufe.filter(a => a.datum >= start && a.datum < ende).map(wert);
    monate.push({ datum: start, wert: werte.length >= 2 ? median(werte) : null, anzahl: werte.length });
  }
  const basisWerte = monate.slice(-12).map(m => m.wert).filter(v => v !== null);
  const basis = basisWerte.length ? mittel(basisWerte) : null;
  return {
    jetzt: median(jetzt), nJetzt: jetzt.length,
    davor: median(davor), nDavor: davor.length,
    vorjahr: median(vorjahr), nVorjahr: vorjahr.length,
    monate, basis
  };
}

/** Pace bei Puls 150 aus Metern pro Herzschlag. */
function paceBei150(mProSchlag) {
  return pace(1000 / (mProSchlag * 150) * 60);
}

function oekonomieDiagramm(lo) {
  const punkte = lo.monate.map((m, i) => ({ i, m, idx: m.wert !== null && lo.basis ? m.wert / lo.basis * 100 : null }))
    .filter(p => p.idx !== null);
  if (punkte.length < 3) return '';
  const B = 340;
  const H = 140;
  const oben = 10;
  const unten = 18;
  const min = Math.min(...punkte.map(p => p.idx), 100) - 3;
  const max = Math.max(...punkte.map(p => p.idx), 100) + 3;
  const x = i => 6 + i * (B - 12) / 23;
  const y = v => oben + (H - unten - oben) * (1 - (v - min) / (max - min));
  let svg = `<line class="linie-schnitt" x1="0" x2="${B}" y1="${y(100).toFixed(1)}" y2="${y(100).toFixed(1)}"/>`;
  svg += `<polyline class="linie-wert" points="${punkte.map(p => x(p.i).toFixed(1) + ',' + y(p.idx).toFixed(1)).join(' ')}"/>`;
  punkte.forEach(p => {
    svg += `<circle class="punkt-wert" cx="${x(p.i).toFixed(1)}" cy="${y(p.idx).toFixed(1)}" r="3"><title>${MONATE[p.m.datum.getMonth()]} ${p.m.datum.getFullYear()}: ${zahlFormat0.format(p.idx)} (${p.m.anzahl} Läufe)</title></circle>`;
  });
  lo.monate.forEach((m, i) => {
    if (m.datum.getMonth() % 3 === 0) {
      const text = MONATE[m.datum.getMonth()].slice(0, 3) + (m.datum.getMonth() === 0 ? ' ' + String(m.datum.getFullYear()).slice(2) : '');
      svg += `<text class="achse" x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="middle">${text}</text>`;
    }
  });
  return `<svg class="diagramm" viewBox="0 0 ${B} ${H}" role="img" aria-label="Laufökonomie pro Monat, 100 entspricht dem Schnitt der letzten 12 Monate">${svg}</svg>
    <div class="legende"><span><i class="lg-wert"></i>Laufökonomie pro Monat (höher = fitter)</span><span><i class="lg-schnitt"></i>dein Schnitt der letzten 12 Monate</span></div>`;
}

/** Dieses Jahr bis heute gegenüber dem Vorjahr bis zum gleichen Tag. */
function jahresVergleich() {
  const heute = new Date();
  const j = heute.getFullYear();
  const summe = jahr => {
    const von = new Date(jahr, 0, 1);
    const bis = new Date(jahr, heute.getMonth(), heute.getDate() + 1);
    const s = { pkt: 0, zeit: 0, laeufe: 0, laufen: 0, rad: 0, wandern: 0 };
    zustand.aktivitaeten.forEach(a => {
      if (a.datum < von || a.datum >= bis) return;
      if (typeof a.pkt === 'number') s.pkt += a.pkt;
      if (a.sportart === 'laufen') s.laeufe++;
      if (!zaehlt(a)) return;
      s.zeit += a.min || 0;
      if (a.km && s[a.sportart] !== undefined) s[a.sportart] += a.km;
    });
    return s;
  };
  const jetzt = summe(j);
  const vorher = summe(j - 1);
  const zeilen = [
    { name: 'Sportpunkte', key: 'pkt', format: x => zahlFormat0.format(x), nur: j - 1 >= 2023 }, // ohne Alltag: Schritte erst ab 2026
    { name: 'Aktive Zeit', key: 'zeit', format: x => zahlFormat0.format(x / 60) + ' h', nur: true },
    { name: 'Läufe', key: 'laeufe', format: x => zahlFormat0.format(x), nur: true },
    { name: 'Lauf-km', key: 'laufen', format: x => km(x), nur: true },
    { name: 'Rad-km', key: 'rad', format: x => km(x), nur: true },
    { name: 'Wander-km', key: 'wandern', format: x => km(x), nur: true }
  ].filter(z => z.nur && vorher[z.key] > 0);
  return { jahr: j, zeilen: zeilen.map(z => Object.assign(z, { jetzt: jetzt[z.key], vorher: vorher[z.key], verhaeltnis: jetzt[z.key] / vorher[z.key] })) };
}

/** Aktive Stunden pro Jahr (ohne unrealistische Aktivitäten). */
function stundenProJahr() {
  const m = new Map();
  zustand.aktivitaeten.forEach(a => {
    if (!zaehlt(a) || !a.min) return;
    const j = a.datum.getFullYear();
    m.set(j, (m.get(j) || 0) + a.min / 60);
  });
  return Array.from(m.entries()).sort((x, y) => y[0] - x[0]);
}

// ---------------------------------------------------------------------------
// Ansicht
// ---------------------------------------------------------------------------

function ansichtForm() {
  let html = '<div class="titel-zeile"><h1>Form</h1>' + HILFE_KNOPF + '</div>';
  if (!zustand.aktivitaeten.length) return html + '<div class="karte leer">Noch keine Daten geladen.</div>';

  // 1. Formstand
  const vgl = formVergleich();
  const haupt = vgl.find(m => m.key === 'pkt') || vgl.find(m => m.key === 'zeit');
  if (haupt) {
    html += `<section class="karte form-kopf ${formKlasse(haupt.verhaeltnis)}">
      <div class="leise">Letzte 4 Wochen</div>
      <div class="form-zahl">${prozent(haupt.verhaeltnis)}</div>
      <div class="form-text">${formText(haupt.verhaeltnis)}</div>
      <div class="leise klein-text">${haupt.name}: ${haupt.format(haupt.jetzt)} pro Woche, dein Schnitt der letzten 12 Monate: ${haupt.format(haupt.schnitt)}. 100 % = dein Schnitt.</div>
    </section>`;
  }

  // 2. Vergleich je Kennzahl
  if (vgl.length) {
    html += '<h2>Letzte 4 Wochen gegenüber deinem Schnitt</h2><section class="karte">' +
      vgl.map(m => vergleichZeile(m.name, m.format(m.jetzt) + (m.key === 'schritte' ? ' pro Tag' : ' pro Woche') + ' · Schnitt ' + m.format(m.schnitt), m.verhaeltnis)).join('') +
      '</section>';
  }

  // 3. Sportpunkte pro Woche
  const diagramm = punkteDiagramm();
  if (diagramm) html += '<h2>Sportpunkte pro Woche</h2><section class="karte">' + diagramm + '</section>';

  // 4. Laufökonomie
  const lo = laufoekonomie();
  html += '<h2>Laufökonomie</h2><section class="karte">';
  if (lo.nJetzt >= 3 && lo.jetzt) {
    const vDavor = lo.nDavor >= 3 && lo.davor ? lo.jetzt / lo.davor : null;
    const vVorjahr = lo.nVorjahr >= 3 && lo.vorjahr ? lo.jetzt / lo.vorjahr : null;
    html += `<div class="oeko-kopf">
        <div><div class="form-zahl klein">${paceBei150(lo.jetzt)}</div><div class="leise">bei Puls 150 · letzte 3 Monate (${lo.nJetzt} Läufe)</div></div>
      </div>`;
    if (vDavor) html += vergleichZeile('gegenüber den 3 Monaten davor', 'damals ' + paceBei150(lo.davor) + ' · ' + veraenderung(vDavor), vDavor);
    if (vVorjahr) html += vergleichZeile('gegenüber dem Vorjahr', 'damals ' + paceBei150(lo.vorjahr) + ' · ' + veraenderung(vVorjahr), vVorjahr);
    html += oekonomieDiagramm(lo);
    html += '<p class="leise klein-text">Mehr Tempo pro Herzschlag = fitter. Hitze, Hügel und Müdigkeit drücken den Wert.</p>';
  } else {
    html += `<p class="leise" style="margin:0">Zu wenige Läufe mit Puls in den letzten 3 Monaten (${lo.nJetzt}). Ab 3 Läufen draußen über 3 km erscheint hier dein Wert.</p>`;
  }
  html += '</section>';

  // 5. Dieses Jahr bis heute
  const jv = jahresVergleich();
  if (jv.zeilen.length) {
    html += `<h2>${jv.jahr} bis heute gegenüber ${jv.jahr - 1}</h2><section class="karte">` +
      jv.zeilen.map(z => vergleichZeile(z.name, z.format(z.jetzt) + ' · ' + (jv.jahr - 1) + ': ' + z.format(z.vorher), z.verhaeltnis)).join('') +
      '</section><p class="leise klein-text">Jeweils vom 1. Januar bis zum heutigen Datum.</p>';
  }

  // 6. Aktive Stunden pro Jahr
  const sj = stundenProJahr();
  if (sj.length) {
    const max = Math.max(...sj.map(x => x[1]));
    const schnitt = mittel(sj.filter(x => x[0] !== jv.jahr).map(x => x[1]));
    html += '<h2>Aktive Stunden pro Jahr</h2><section class="karte jahre-balken">' + sj.map(([j, h]) => `
      <div class="jb-zeile">
        <span class="jb-jahr">${j}</span>
        <span class="jb-skala"><span class="${j === jv.jahr ? 'jetzt' : ''}" style="width:${(h / max * 100).toFixed(1)}%"></span></span>
        <span class="jb-wert">${zahlFormat0.format(h)} h${j === jv.jahr ? '<small>bis heute</small>' : ''}</span>
      </div>`).join('') +
      (schnitt ? `<p class="leise klein-text">Schnitt der ganzen Jahre: ${zahlFormat0.format(schnitt)} h.</p>` : '') + '</section>';
  }
  return html;
}

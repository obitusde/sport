/**
 * app.js – Sport-App
 * Version: 0.9.0 (2026-11-18)
 *
 * Ansichten: Woche, Einstellungen.
 * Die App holt die Aktivitäten als Liste von der Apps-Script-Web-App und rechnet
 * Woche, Laufziel und Serie selbst. Die letzten Daten liegen im localStorage,
 * damit die App sofort und auch offline etwas zeigt.
 * Web-App-URL und Token werden nur im localStorage dieses Geräts gespeichert.
 *
 * Änderungen 0.3.1: Knopf „Von Garmin holen“ (Wochenansicht oben und Einstellungen):
 * startet den Sammler über die Web-App, lädt danach neu und meldet die Anzahl neuer
 * Aktivitäten. Ersetzt „Jetzt neu laden“. Distanz immer mit einer Nachkommastelle,
 * abgerundet (4,96 km → „4,9 km“).
 * Änderungen 0.4.0: Detailansicht beim Tippen auf eine Aktivität (Tempo, Puls und
 * Pulszonen, Trainingseffekt, Intensitätsminuten, Laufstil, Bestzeiten). Details werden
 * beim ersten Öffnen von der Web-App geholt und auf dem Gerät gespeichert.
 * Änderungen 0.5.0: Sportpunkte (Garmins Intensitätsminuten, ab 2023, Lücken geschätzt „≈“),
 * Aktivziel mit eigener Serie, Ansicht „Erfolge“ (Serien-Abzeichen, Bestmarken, Jahres-km,
 * Allrounder), Karte „Erfolge dieser Woche“ mit Wochenbilanz, Trainingseffekt mit Garmins
 * deutschen Begriffen, „Unknown“ ausgeblendet.
 * Änderungen 0.6.0: Unrealistische Aktivitäten (zu schnell oder zu lang für die Sportart)
 * zählen nicht für km, Höhenmeter, Bestmarken und Vergleiche. Halbmarathon-Bestzeit entfernt.
 * Jahrestabelle in „Erfolge“ ersetzt durch klare Jahres-Abzeichen. Neue Ansicht „Form“
 * (form.js) mit relativen Werten, neue Erklär-Seite (hilfe.js). Zurück aus Detail und
 * Erklärungen führt in die vorherige Ansicht.
 * Änderungen 0.7.0: Zusammenspiel mit der Android-App (window.SportApp): Verbindung wird an
 * die App weitergegeben, Benachrichtigungen sind in den Einstellungen konfigurierbar
 * (Erinnerung, Wochenrückblick, Erfolge, Test, Vorschau), Update-Prüfung. Im Browser
 * zeigen die Einstellungen stattdessen den Link zur APK.
 * Änderungen 0.8.0: Schritte vom Handy (Android-App): Tageswerte in der Wochenansicht,
 * Karte „Schritte“ mit Vergleich zum eigenen Schnitt, Einstellungen „Schrittzähler“
 * (Status, Erlauben, Prüfen, Übertragen). Quelle: Web-App (Aktion „schritte“), in der
 * App ergänzt um die frischesten Werte direkt vom Handy.
 * Änderungen 0.9.0: Alltagspunkte aus Handy-Schritten (ohne Schritte während Aktivitäten)
 * zählen zum Aktivziel; Formel und Werte einstellbar (alltagPunkte, alltagFrei,
 * alltagProPunkt). Neue Ansicht „Karte“ (karte.js) und Spur in der Detailansicht.
 */
'use strict';

const APP_VERSION = '0.9.0';

const SPEICHER = {
  url: 'sport.url',
  token: 'sport.token',
  daten: 'sport.daten',
  einstellungen: 'sport.einstellungen',
  status: 'sport.status',
  schritte: 'sport.schritte',
  details: 'sport.details'
};

/** Sportarten in Anzeigereihenfolge. */
const SPORTARTEN = [
  { key: 'laufen', name: 'Laufen' },
  { key: 'rad', name: 'Rad' },
  { key: 'wandern', name: 'Wandern' },
  { key: 'ski', name: 'Ski' },
  { key: 'schwimmen', name: 'Schwimmen' },
  { key: 'andere', name: 'Andere' }
];
const SPORT_NAME = Object.fromEntries(SPORTARTEN.map(s => [s.key, s.name]));

const TAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'];

// Distanz immer mit einer Nachkommastelle und Komma, z. B. „4,9 km“
const kmFormat = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const zahlFormat0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });
const dezimal1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dezimal2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Standardwerte der Einstellungen (gleich wie EINSTELLUNGEN in gas/WebApp.gs). */
const STANDARD_EINSTELLUNGEN = {
  wochenzielLaeufe: 2, wochenzielPunkte: 150, alltagPunkte: 1, alltagFrei: 3000, alltagProPunkt: 200
};
/** Tage mit mehr Schritten gelten als unrealistisch (gleich wie SCHRITTE_MAX in gas/Schritte.gs). */
const SCHRITTE_MAX = 50000;

const zustand = {
  ansicht: 'woche',
  wocheVersatz: 0,
  aktivitaeten: [],
  datenStand: null,
  einstellungen: Object.assign({}, STANDARD_EINSTELLUNGEN),
  index: null, // Wochenindex, wird bei neuen Daten verworfen
  schritte: new Map(), // Datum (YYYY-MM-DD) → Schritte vom Handy
  schritteServer: [],
  status: null,
  webAppVersion: null,
  laedt: false, // false, 'garmin' (Sammler läuft) oder 'daten' (Liste wird geladen)
  fehler: null,
  vorherigeAnsicht: 'woche',
  detailId: null,
  detailLaedt: false,
  detailFehler: null
};

// ---------------------------------------------------------------------------
// Speicher (localStorage kann fehlen oder gesperrt sein)
// ---------------------------------------------------------------------------

function lesen(schluessel, ersatz) {
  try {
    const wert = localStorage.getItem(schluessel);
    return wert === null ? ersatz : JSON.parse(wert);
  } catch (e) {
    return ersatz;
  }
}

function schreiben(schluessel, wert) {
  try {
    if (wert === null || wert === undefined) localStorage.removeItem(schluessel);
    else localStorage.setItem(schluessel, JSON.stringify(wert));
  } catch (e) {
    // z. B. privater Modus oder Speicher voll: App läuft ohne Zwischenspeicher weiter
  }
}

function verbindung() {
  return { url: lesen(SPEICHER.url, ''), token: lesen(SPEICHER.token, '') };
}

// ---------------------------------------------------------------------------
// Web-App
// ---------------------------------------------------------------------------

async function api(aktion, parameter) {
  const v = verbindung();
  if (!v.url || !v.token) throw new Error('Verbindung fehlt. Bitte in den Einstellungen eintragen.');
  let url;
  try {
    url = new URL(v.url);
  } catch (e) {
    throw new Error('Die Web-App-URL ist ungültig.');
  }
  url.searchParams.set('token', v.token);
  url.searchParams.set('aktion', aktion);
  Object.entries(parameter || {}).forEach(([k, w]) => url.searchParams.set(k, String(w)));

  let antwort;
  try {
    antwort = await fetch(url.toString(), { redirect: 'follow', cache: 'no-store' });
  } catch (e) {
    throw new Error('Keine Verbindung zur Web-App.');
  }
  let daten;
  try {
    daten = await antwort.json();
  } catch (e) {
    throw new Error('Die Web-App hat keine gültige Antwort geschickt (HTTP ' + antwort.status + ').');
  }
  if (!daten.ok) throw new Error(daten.fehler === 'nicht berechtigt' ? 'Token falsch.' : daten.fehler);
  return daten;
}

function setzeAktivitaeten(liste) {
  zustand.aktivitaeten = liste.sort((x, y) => x.datum - y.datum);
  zustand.index = null;
}

/**
 * Grenzen für realistische Aktivitäten: Ø-Geschwindigkeit (km/h, über die Bewegungszeit)
 * und Distanz. Darüber war meist die Aufzeichnung im Auto oder Zug noch an.
 */
const GRENZEN = {
  laufen: { kmh: 22, km: 60 },
  wandern: { kmh: 8, km: 70 },
  rad: { kmh: 45, km: 400 },
  schwimmen: { kmh: 6, km: 15 }
};

/** Grund, warum eine Aktivität unrealistisch ist, sonst null. */
function plausibilitaet(a) {
  const g = GRENZEN[a.sportart];
  if (!g || !a.km) return null;
  if (a.km > g.km) return 'länger als ' + g.km + ' km';
  if (a.min) {
    const kmh = a.km / (a.min / 60);
    if (kmh > g.kmh) return 'Ø ' + dezimal1.format(kmh) + ' km/h, mehr als ' + g.kmh + ' km/h';
  }
  return null;
}

/** Zählt die Aktivität für Distanz, Höhenmeter, Bestmarken und Vergleiche? */
function zaehlt(a) {
  return !a.unplausibel;
}

/** Wandelt die kompakte Liste in Objekte um. */
function auspacken(daten) {
  const s = daten.spalten;
  return daten.zeilen.map(z => {
    const o = {};
    s.forEach((name, i) => { o[name] = z[i]; });
    o.datum = lokalesDatum(o.start);
    o.unplausibel = plausibilitaet(o);
    return o;
  }).filter(a => a.datum);
}

/** „2026-11-17T08:30“ → Date in lokaler Zeit (ohne Zeitzonen-Umrechnung). */
function lokalesDatum(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(text || ''));
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

async function allesLaden() {
  if (zustand.laedt) return;
  const v = verbindung();
  if (!v.url || !v.token) return;
  zustand.laedt = 'daten';
  zustand.fehler = null;
  zeichnen();
  try {
    const [liste, einst, status, schritte] = await Promise.all([
      api('aktivitaeten'),
      api('einstellungen'),
      api('status'),
      api('schritte').catch(() => ({ tage: null })) // ältere Web-App ohne Schritte
    ]);
    if (Array.isArray(schritte.tage)) {
      zustand.schritteServer = schritte.tage;
      schreiben(SPEICHER.schritte, schritte.tage);
    }
    schritteZusammenfuehren();
    setzeAktivitaeten(auspacken(liste));
    zustand.datenStand = new Date().toISOString();
    zustand.einstellungen = einst.einstellungen;
    zustand.status = status;
    zustand.webAppVersion = liste.version;
    schreiben(SPEICHER.daten, { spalten: liste.spalten, zeilen: liste.zeilen, stand: zustand.datenStand, version: liste.version });
    schreiben(SPEICHER.einstellungen, einst.einstellungen);
    verbindungAnApp();
    schreiben(SPEICHER.status, status);
  } catch (e) {
    zustand.fehler = e.message;
  } finally {
    zustand.laedt = false;
    zeichnen();
  }
}

/** Startet den Sammler (Garmin → Sheet), lädt danach neu und meldet das Ergebnis. */
async function vonGarminHolen() {
  if (zustand.laedt) return;
  zustand.laedt = 'garmin';
  zustand.fehler = null;
  zeichnen();
  let neu;
  try {
    neu = (await api('sammeln')).neu;
  } catch (e) {
    zustand.laedt = false;
    zustand.fehler = e.message;
    zeichnen();
    meldung('Fehler: ' + e.message);
    return;
  }
  zustand.laedt = false;
  await allesLaden();
  if (zustand.fehler) {
    meldung('Fehler: ' + zustand.fehler);
  } else {
    meldung(neu === 0 ? 'Keine neuen Aktivitäten bei Garmin.'
      : neu === 1 ? '1 neue Aktivität geholt.' : neu + ' neue Aktivitäten geholt.');
  }
}

function ausSpeicherLaden() {
  const daten = lesen(SPEICHER.daten, null);
  if (daten && Array.isArray(daten.zeilen)) {
    setzeAktivitaeten(auspacken(daten));
    zustand.datenStand = daten.stand || null;
    zustand.webAppVersion = daten.version || null;
  }
  zustand.einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, lesen(SPEICHER.einstellungen, {}));
  zustand.status = lesen(SPEICHER.status, null);
  zustand.schritteServer = lesen(SPEICHER.schritte, []);
  schritteZusammenfuehren();
}

// ---------------------------------------------------------------------------
// Android-App (window.SportApp, nur in der APK vorhanden)
// ---------------------------------------------------------------------------

const APK_SEITE = 'https://github.com/obitusde/sport/releases/latest';
const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

function inApp() {
  return typeof window.SportApp !== 'undefined';
}

/** Gibt Web-App-URL und Token an die Android-App weiter (für den Hintergrund-Job). */
function verbindungAnApp() {
  const v = verbindung();
  if (inApp() && v.url && v.token) {
    try { window.SportApp.verbindungSetzen(v.url, v.token); } catch (e) { /* ältere App-Version */ }
  }
}

function appBenachrichtigungen() {
  try {
    return JSON.parse(window.SportApp.benachrichtigungenLesen());
  } catch (e) {
    return null;
  }
}

/** Liest die Formularfelder der Benachrichtigungen und speichert sie in der App. */
function benachrichtigungenSpeichern() {
  const k = appBenachrichtigungen() || {};
  document.querySelectorAll('[data-nb]').forEach(feld => {
    const [art, schluessel] = feld.dataset.nb.split('.');
    k[art] = k[art] || {};
    k[art][schluessel] = feld.type === 'checkbox' ? feld.checked : Number(feld.value);
  });
  const ok = window.SportApp.benachrichtigungenSetzen(JSON.stringify(k));
  meldung(ok ? 'Benachrichtigungen gespeichert.' : 'Nicht gespeichert.');
  zeichnen();
}

// Rückmeldungen der Android-App
window.nativeMeldung = text => meldung(text);
window.nativeGeaendert = () => zeichnen();
window.nativeSchritte = () => { schritteZusammenfuehren(); zeichnen(); };

/** Schritte-Status direkt vom Handy oder null. */
function schritteNativ() {
  if (!inApp()) return null;
  try { return JSON.parse(window.SportApp.schritteStatus()); } catch (e) { return null; }
}

/** Schritte aus dem Sheet, überschrieben mit den frischeren Werten vom Handy. */
function schritteZusammenfuehren() {
  const m = new Map();
  const abzug = new Map(); // Schritte während Aktivitäten (vom Server berechnet)
  (zustand.schritteServer || []).forEach(z => {
    m.set(z[0], z[1]);
    if (typeof z[2] === 'number') abzug.set(z[0], Math.max(0, z[1] - z[2]));
  });
  const nativ = schritteNativ();
  if (nativ && nativ.tage) Object.entries(nativ.tage).forEach(([tag, n]) => m.set(tag, n));
  zustand.schritte = m;
  const alltag = new Map();
  m.forEach((n, tag) => {
    const a = Math.max(0, n - (abzug.get(tag) || 0));
    alltag.set(tag, { alltag: a, pkt: alltagPunkte(a, n), unplausibel: n > SCHRITTE_MAX });
  });
  zustand.alltag = alltag;
  zustand.index = null;
}

/**
 * Alltagspunkte eines Tages: max(0, Alltagsschritte − frei) / Schritte pro Punkt, abgerundet.
 * Gleiche Formel wie alltagPunkte_ in gas/Schritte.gs.
 */
function alltagPunkte(alltag, schritte) {
  const e = zustand.einstellungen;
  if (!Number(e.alltagPunkte) || schritte > SCHRITTE_MAX || !Number(e.alltagProPunkt)) return 0;
  return Math.floor(Math.max(0, alltag - Number(e.alltagFrei)) / Number(e.alltagProPunkt));
}

/** Schritte der Tage im Zeitraum [von, bis), nur Tage mit Wert. */
function schritteZeitraum(von, bis) {
  const werte = [];
  for (let d = tagePlus(von, 0); d < bis; d = tagePlus(d, 1)) {
    const v = zustand.schritte.get(schluessel(d));
    if (v !== undefined && v <= SCHRITTE_MAX) werte.push(v);
  }
  return werte;
}

function schritteKurz(n) {
  return n >= 1000 ? dezimal1.format(n / 1000) + 'k' : String(n);
}

function schritteHtml() {
  if (!inApp()) return '';
  const s = schritteNativ();
  if (!s) return '';
  const tage = Object.keys(s.tage || {}).length;
  return `<h2>Schrittzähler</h2>
  <section class="karte">
    ${!s.sensor ? '<div class="hinweis-box">Dieses Handy hat keinen Schrittzähler-Sensor.</div>'
      : !s.erlaubt ? '<div class="hinweis-box">Die App darf deine Schritte noch nicht zählen. <button class="knopf klein" data-aktion="schritte-erlauben">Erlauben</button></div>' : ''}
    <table class="tabelle">
      <tr><td>Heute gezählt</td><td>${zahlFormat0.format(s.heute || 0)} Schritte</td></tr>
      <tr><td>Tage mit Werten</td><td>${tage}</td></tr>
      <tr><td>Zuletzt übertragen</td><td>${s.gesendet ? zeitpunkt(new Date(s.gesendet).toISOString()) : '–'}</td></tr>
    </table>
    <div class="knopfreihe" style="margin-top:12px">
      <button class="knopf" data-aktion="schritte-pruefen">Schrittzähler prüfen</button>
      <button class="knopf" data-aktion="schritte-senden" ${s.erlaubt ? '' : 'disabled'}>Jetzt übertragen</button>
    </div>
    <p class="leise klein-text">Gezählt wird, wenn du das Handy dabei hast, ab der Installation. Die Schritte der Uhr zählen nicht dazu. Akku: praktisch kein Verbrauch.</p>
  </section>`;
}

function benachrichtigungenHtml() {
  if (!inApp()) {
    return `<h2>Benachrichtigungen</h2>
    <section class="karte">
      <p style="margin:0 0 10px">Benachrichtigungen und Schrittzähler gibt es in der Android-App.</p>
      <a class="knopf haupt" href="${APK_SEITE}" target="_blank" rel="noopener">Android-App herunterladen</a>
      <p class="leise klein-text">Auf der Seite die Datei „sport-….apk“ antippen und öffnen. Beim ersten Mal fragt Android, ob der Browser Apps installieren darf.</p>
    </section>`;
  }
  const k = appBenachrichtigungen();
  if (!k) return '';
  let erlaubt = true;
  try { erlaubt = window.SportApp.benachrichtigungenErlaubt(); } catch (e) { /* ältere App-Version */ }
  const tagWahl = (art) => `<select data-nb="${art}.tag" aria-label="Wochentag">${WOCHENTAGE.map((t, i) =>
    `<option value="${i + 1}" ${k[art].tag === i + 1 ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const stundeWahl = (art) => `<select data-nb="${art}.stunde" aria-label="Uhrzeit">${Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}" ${k[art].stunde === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select>`;
  const schalter = (art, titel, unter) => `<label class="schalter-zeile">
      <span><b>${titel}</b><small>${unter}</small></span>
      <input type="checkbox" data-nb="${art}.an" ${k[art].an ? 'checked' : ''}>
    </label>`;

  return `<h2>Benachrichtigungen</h2>
  <section class="karte">
    ${erlaubt ? '' : `<div class="hinweis-box">Benachrichtigungen sind für die App ausgeschaltet. <button class="knopf klein" data-aktion="nb-erlauben">Erlauben</button></div>`}
    ${schalter('erinnerung', 'Erinnerung', 'Nur wenn ein Wochenziel noch offen ist')}
    <div class="zeit-wahl ${k.erinnerung.an ? '' : 'aus'}">${tagWahl('erinnerung')} ${stundeWahl('erinnerung')}</div>
    ${schalter('rueckblick', 'Wochenrückblick', 'Ziele, Serien, Vergleich mit deinem Schnitt')}
    <div class="zeit-wahl ${k.rueckblick.an ? '' : 'aus'}">${tagWahl('rueckblick')} ${stundeWahl('rueckblick')}</div>
    ${schalter('erfolge', 'Erfolge', 'Neue Bestzeiten, Bestmarken und Jahres-Abzeichen nach dem Import')}
    <div class="knopfreihe" style="margin-top:12px">
      <button class="knopf" data-aktion="nb-test">Test</button>
      <button class="knopf" data-aktion="nb-vorschau" data-art="erinnerung">Vorschau Erinnerung</button>
      <button class="knopf" data-aktion="nb-vorschau" data-art="rueckblick">Vorschau Rückblick</button>
    </div>
    <p class="leise klein-text">Die App prüft etwa alle 30 Minuten. Benachrichtigungen kommen deshalb bis zu einer halben Stunde nach der eingestellten Zeit. Am Montag bis Donnerstag fasst der Rückblick die vergangene Woche zusammen, sonst die laufende.</p>
  </section>`;
}

function appVersionText() {
  if (!inApp()) return 'Browser';
  try { return 'Android ' + window.SportApp.appVersion(); } catch (e) { return 'Android'; }
}

// ---------------------------------------------------------------------------
// Rechnen
// ---------------------------------------------------------------------------

/** Montag 00:00 der Woche, in der d liegt. */
function montag(d) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

function tagePlus(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function schluessel(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** ISO-Kalenderwoche. */
function kalenderwoche(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const tag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - tag);
  const jahresbeginn = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - jahresbeginn) / 86400000 + 1) / 7);
}

/** Erster Montag mit Sportpunkten (Intensitätsminuten gibt es ab 2023). */
const PUNKTE_START = new Date(2023, 0, 2);
const SERIEN_STUFEN = [4, 12, 26, 52];
const JAHRES_STUFEN = { laufen: [100, 250, 500, 1000], rad: [1000, 2500, 5000, 10000], wandern: [100, 250, 500, 1000] };
const BESTZEIT_DISTANZEN = [
  { name: '1 km', km: 1, feld: 's1k' },
  { name: '5 km', km: 5, feld: 's5k' },
  { name: '10 km', km: 10, feld: 's10k' }
];
const LEERE_WOCHE = { laeufe: 0, pkt: 0, sport: 0, alltag: 0, hatPkt: false, geschaetzt: false, sportarten: new Set(), min: 0, km: { laufen: 0, rad: 0, wandern: 0 } };

/** Wochen (Schlüssel = Montag als YYYY-MM-DD) mit Läufen, Sportpunkten und Sportarten. */
function wochenIndex() {
  if (zustand.index) return zustand.index;
  const m = new Map();
  zustand.aktivitaeten.forEach(a => {
    const k = schluessel(montag(a.datum));
    let w = m.get(k);
    if (!w) {
      w = { laeufe: 0, pkt: 0, sport: 0, alltag: 0, hatPkt: false, geschaetzt: false, sportarten: new Set(), min: 0, km: { laufen: 0, rad: 0, wandern: 0 } };
      m.set(k, w);
    }
    if (a.sportart === 'laufen') w.laeufe++;
    if (zaehlt(a)) {
      w.min += a.min || 0;
      if (a.km && w.km[a.sportart] !== undefined) w.km[a.sportart] += a.km;
    }
    if (typeof a.pkt === 'number') {
      w.pkt += a.pkt;
      w.sport += a.pkt;
      w.hatPkt = true;
      if (a.pktGeschaetzt) w.geschaetzt = true;
    }
    if (a.sportart !== 'andere') w.sportarten.add(a.sportart);
  });
  // Alltagspunkte aus Handy-Schritten
  (zustand.alltag || new Map()).forEach((x, tag) => {
    if (!x.pkt) return;
    const k = schluessel(montag(lokalesDatum(tag)));
    let w = m.get(k);
    if (!w) {
      w = { laeufe: 0, pkt: 0, sport: 0, alltag: 0, hatPkt: false, geschaetzt: false, sportarten: new Set(), min: 0, km: { laufen: 0, rad: 0, wandern: 0 } };
      m.set(k, w);
    }
    w.pkt += x.pkt;
    w.alltag += x.pkt;
    w.hatPkt = true;
  });
  zustand.index = m;
  return m;
}

function woche(montagDatum) {
  return wochenIndex().get(schluessel(montagDatum)) || LEERE_WOCHE;
}

/**
 * Wertet eine Serie aus: Wochen in Folge, in denen erfuellt(woche) gilt.
 * Die laufende Woche zählt mit, sobald sie erfüllt ist; solange sie offen ist, bricht
 * sie die Serie nicht. Rückwirkend gilt das aktuelle Ziel.
 * @return {{aktuell, aktuellErreicht, laengste, laengsteBis, erreicht}} erreicht: Stufe → Montag
 */
function serieAuswerten(erfuellt, ab) {
  const diese = montag(new Date());
  let lauf = 0;
  let laengste = 0;
  let laengsteBis = null;
  const erreicht = {};
  const zaehlen = w => {
    lauf++;
    if (lauf > laengste) { laengste = lauf; laengsteBis = w; }
    SERIEN_STUFEN.forEach(s => { if (lauf === s && !erreicht[s]) erreicht[s] = w; });
  };
  for (let w = montag(ab); w < diese; w = tagePlus(w, 7)) {
    if (erfuellt(woche(w))) zaehlen(w);
    else lauf = 0;
  }
  const vorher = lauf;
  const aktuellErreicht = erfuellt(woche(diese));
  if (aktuellErreicht) zaehlen(diese);
  return { aktuell: vorher + (aktuellErreicht ? 1 : 0), aktuellErreicht, laengste, laengsteBis, erreicht };
}

function serieLaufen() {
  const ziel = Number(zustand.einstellungen.wochenzielLaeufe) || 0;
  if (!ziel || !zustand.aktivitaeten.length) return null;
  return serieAuswerten(w => w.laeufe >= ziel, zustand.aktivitaeten[0].datum);
}

function seriePunkte() {
  const ziel = Number(zustand.einstellungen.wochenzielPunkte) || 0;
  if (!ziel) return null;
  return serieAuswerten(w => w.pkt >= ziel, PUNKTE_START);
}

/** Bestmarken über alle Jahre. Jede: {titel, wert, datum, id, hinweis}. */
function bestmarken() {
  const liste = zustand.aktivitaeten.filter(zaehlt);
  const laeufe = liste.filter(a => a.sportart === 'laufen');
  // Laufband-Distanzen sind ungenau: für Bestzeiten nur Läufe draußen
  const draussen = laeufe.filter(a => a.typ !== 'treadmill_running');
  const ergebnis = { zeiten: [], weitere: [] };

  BESTZEIT_DISTANZEN.forEach(dist => {
    let best = null;
    draussen.forEach(a => {
      const kandidaten = [];
      if (typeof a[dist.feld] === 'number' && a[dist.feld] > 0) kandidaten.push({ zeit: a[dist.feld], schnitt: false });
      if (a.km >= dist.km && a.min) kandidaten.push({ zeit: a.min * 60 / a.km * dist.km, schnitt: true });
      kandidaten.forEach(k => {
        if (k.zeit / dist.km < 150) return; // schneller als 2:30 /km: GPS-Fehler
        if (!best || k.zeit < best.zeit) best = { zeit: k.zeit, schnitt: k.schnitt, a: a };
      });
    });
    if (best) {
      ergebnis.zeiten.push({
        titel: 'Schnellste ' + dist.name,
        wert: zeitAusSekunden(best.zeit),
        unter: pace(best.zeit / dist.km) + (best.schnitt ? ' · Ø des ganzen Laufs' : ''),
        datum: best.a.datum, id: best.a.id
      });
    }
  });

  const laengste = (sportart, titel) => {
    let best = null;
    liste.forEach(a => { if (a.sportart === sportart && a.km && (!best || a.km > best.km)) best = a; });
    if (best) ergebnis.weitere.push({ titel, wert: km(best.km), unter: best.name || '', datum: best.datum, id: best.id });
  };
  laengste('laufen', 'Längster Lauf');
  laengste('rad', 'Längste Radtour');
  laengste('wandern', 'Längste Wanderung');

  // Meiste Höhenmeter an einem Tag (alle Sportarten)
  const proTag = new Map();
  liste.forEach(a => {
    if (!a.hm) return;
    const k = schluessel(a.datum);
    const t = proTag.get(k) || { hm: 0, datum: a.datum };
    t.hm += a.hm;
    proTag.set(k, t);
  });
  let hmBest = null;
  proTag.forEach(t => { if (!hmBest || t.hm > hmBest.hm) hmBest = t; });
  if (hmBest) ergebnis.weitere.push({ titel: 'Meiste Höhenmeter an einem Tag', wert: zahlFormat0.format(hmBest.hm) + ' m', unter: '', datum: hmBest.datum });

  // Meiste Punkte (Sport + Alltag) in einer Woche
  let pktBest = null;
  wochenIndex().forEach((w, k) => { if (w.hatPkt && (!pktBest || w.pkt > pktBest.pkt)) pktBest = { pkt: w.pkt, datum: lokalesDatum(k), geschaetzt: w.geschaetzt }; });
  if (pktBest) {
    ergebnis.weitere.push({ titel: 'Meiste Punkte in einer Woche', wert: (pktBest.geschaetzt ? '≈ ' : '') + pktBest.pkt,
      unter: '', datum: pktBest.datum, datumText: 'KW ' + kalenderwoche(pktBest.datum) + '/' + pktBest.datum.getFullYear() });
  }
  return ergebnis;
}

/** Kilometer pro Jahr und Sportart. */
function jahresKm() {
  const m = new Map();
  zustand.aktivitaeten.forEach(a => {
    if (!JAHRES_STUFEN[a.sportart] || !a.km || !zaehlt(a)) return;
    const j = a.datum.getFullYear();
    const x = m.get(j) || { laufen: 0, rad: 0, wandern: 0 };
    x[a.sportart] += a.km;
    m.set(j, x);
  });
  return m;
}

/** Höchste erreichte Stufe oder 0. */
function stufeErreicht(sportart, kmWert) {
  return JAHRES_STUFEN[sportart].filter(s => kmWert >= s).pop() || 0;
}

/** Wochen mit mindestens 3 Sportarten (ohne „andere“). */
function allrounderWochen() {
  const wochen = [];
  wochenIndex().forEach((w, k) => { if (w.sportarten.size >= 3) wochen.push(lokalesDatum(k)); });
  return wochen.sort((x, y) => x - y);
}

/** Was in einer Woche erreicht wurde: Bilanz, neue Abzeichen, Bestmarken, Jahres-km. */
function wochenErfolge(w) {
  const punkte = [];
  const istDiese = zustand.wocheVersatz === 0;

  // Wochenbilanz nach Sportpunkten
  if (w.start >= PUNKTE_START && w.pkt > 0) {
    let n = 0;
    let gefunden = null;
    for (let x = tagePlus(w.start, -7); x >= PUNKTE_START; x = tagePlus(x, -7)) {
      n++;
      if (woche(x).pkt >= w.pkt) { gefunden = x; break; }
    }
    const vorsatz = istDiese ? 'Bisher beste Woche' : 'Beste Woche';
    if (!gefunden) punkte.push({ text: vorsatz + ' seit Beginn der Sportpunkte (2023)', stark: true });
    else if (n > 8) punkte.push({ text: vorsatz + ' seit ' + MONATE[gefunden.getMonth()] + ' ' + gefunden.getFullYear(), stark: true });
    else if (n >= 4) punkte.push({ text: vorsatz + ' seit ' + n + ' Wochen', stark: true });
    const vor = woche(tagePlus(w.start, -7));
    if (vor.hatPkt) {
      const diff = w.pkt - vor.pkt;
      if (diff > 0) punkte.push({ text: '+' + diff + ' Sportpunkte gegenüber der Vorwoche' });
    }
  }

  // Erstmals erreichte Serien-Stufen in dieser Woche
  const k = schluessel(w.start);
  [[serieLaufen(), 'Laufziel'], [seriePunkte(), 'Aktivziel']].forEach(([s, name]) => {
    if (!s) return;
    SERIEN_STUFEN.forEach(stufe => {
      if (s.erreicht[stufe] && schluessel(s.erreicht[stufe]) === k) {
        punkte.push({ text: 'Abzeichen: ' + stufe + ' Wochen ' + name + ' in Folge', stark: true });
      }
    });
  });

  // Bestmarken aus dieser Woche
  const b = bestmarken();
  b.zeiten.concat(b.weitere).forEach(x => {
    if (x.datum >= w.start && x.datum < tagePlus(w.start, 7)) punkte.push({ text: 'Bestmarke: ' + x.titel + ' – ' + x.wert, stark: true });
  });

  // Jahres-km-Stufen, die in dieser Woche überschritten wurden
  const jahr = w.ende.getFullYear();
  const jahresbeginn = new Date(jahr, 0, 1);
  Object.keys(JAHRES_STUFEN).forEach(sa => {
    let vorher = 0;
    let nachher = 0;
    zustand.aktivitaeten.forEach(a => {
      if (a.sportart !== sa || !a.km || !zaehlt(a) || a.datum < jahresbeginn || a.datum.getFullYear() !== jahr) return;
      if (a.datum < w.start) vorher += a.km;
      if (a.datum < tagePlus(w.start, 7)) nachher += a.km;
    });
    const s = stufeErreicht(sa, nachher);
    if (s && s > stufeErreicht(sa, vorher)) punkte.push({ text: 'Jahres-Abzeichen: ' + zahlFormat0.format(s) + ' km ' + SPORT_NAME[sa] + ' ' + jahr, stark: true });
  });

  if (w.sportarten.size >= 3) punkte.push({ text: 'Allrounder-Woche: ' + w.sportarten.size + ' Sportarten' });
  return punkte;
}

/** Alles, was die Wochenansicht braucht. */
function wochendaten(versatz) {
  const heute = new Date();
  const start = tagePlus(montag(heute), versatz * 7);
  const ende = tagePlus(start, 7);
  const liste = zustand.aktivitaeten
    .filter(a => a.datum >= start && a.datum < ende)
    .sort((x, y) => x.datum - y.datum);

  const summen = {};
  liste.forEach(a => {
    const s = summen[a.sportart] || (summen[a.sportart] = { anzahl: 0, km: 0, min: 0, hm: 0, pkt: 0, hatPkt: false, geschaetzt: false });
    s.anzahl++;
    if (zaehlt(a)) {
      s.km += a.km || 0;
      s.min += a.min || 0;
      s.hm += a.hm || 0;
    }
    if (typeof a.pkt === 'number') {
      s.pkt += a.pkt;
      s.hatPkt = true;
      if (a.pktGeschaetzt) s.geschaetzt = true;
    }
  });

  const tage = [];
  for (let i = 0; i < 7; i++) {
    const tag = tagePlus(start, i);
    tage.push({
      datum: tag,
      aktivitaeten: liste.filter(a => schluessel(a.datum) === schluessel(tag)),
      heute: schluessel(tag) === schluessel(heute),
      zukunft: tag > heute
    });
  }

  const ziel = Number(zustand.einstellungen.wochenzielLaeufe) || 0;
  const laeufe = summen.laufen ? summen.laufen.anzahl : 0;
  // Verbleibende Tage inklusive heute, nur für die laufende Woche
  const restTage = versatz === 0 ? 7 - ((heute.getDay() + 6) % 7) : 0;
  const wi = woche(start);
  return {
    start, ende: tagePlus(start, 6), liste, summen, tage, ziel, laeufe, restTage,
    pkt: wi.pkt, sport: wi.sport, alltag: wi.alltag, hatPkt: wi.hatPkt, geschaetzt: wi.geschaetzt, sportarten: wi.sportarten,
    zielPunkte: Number(zustand.einstellungen.wochenzielPunkte) || 0
  };
}

// ---------------------------------------------------------------------------
// Formatieren
// ---------------------------------------------------------------------------

function esc(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Abgerundet auf 0,1 km: 4,96 km wird „4,9 km“, damit „5,0 km“ nur bei vollen 5 km erscheint. */
function km(wert) {
  return kmFormat.format(Math.floor(wert * 10 + 1e-6) / 10) + ' km';
}

function dauer(min) {
  const m = Math.round(min || 0);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ' h';
}

function uhrzeit(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function zeitraum(start, ende) {
  if (start.getMonth() === ende.getMonth()) {
    return start.getDate() + '.–' + ende.getDate() + '. ' + MONATE[ende.getMonth()] + ' ' + ende.getFullYear();
  }
  return start.getDate() + '. ' + MONATE[start.getMonth()] + ' – ' + ende.getDate() + '. ' +
    MONATE[ende.getMonth()] + ' ' + ende.getFullYear();
}

function wertListe(a) {
  const teile = [];
  if (a.km) teile.push(km(a.km));
  if (a.min) teile.push(dauer(a.min));
  if (a.hm) teile.push(zahlFormat0.format(a.hm) + ' hm');
  return teile.join(' · ');
}

function zeitpunkt(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  return d.toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' });
}

// ---------------------------------------------------------------------------
// Ansichten
// ---------------------------------------------------------------------------

const PFEIL_LINKS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const PFEIL_RECHTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

function ansichtWoche() {
  const v = verbindung();
  if (!v.url || !v.token) {
    return `<div class="karte leer">
      <p><b>Willkommen!</b><br>Trage zuerst unter Einstellungen die Web-App-URL und das Token ein.</p>
      <button class="knopf haupt" data-aktion="zu-einstellungen">Zu den Einstellungen</button>
    </div>`;
  }

  const w = wochendaten(zustand.wocheVersatz);
  const titel = zustand.wocheVersatz === 0 ? 'Diese Woche'
    : zustand.wocheVersatz === -1 ? 'Letzte Woche'
      : 'Vor ' + (-zustand.wocheVersatz) + ' Wochen';

  let html = `<header class="kopf">
    <button class="rund" data-aktion="woche-zurueck" aria-label="Vorherige Woche">${PFEIL_LINKS}</button>
    <div class="kopf-text">
      <h1>${titel}</h1>
      <span class="leise">KW ${kalenderwoche(w.start)} · ${zeitraum(w.start, w.ende)}</span>
    </div>
    <button class="rund" data-aktion="woche-vor" aria-label="Nächste Woche" ${zustand.wocheVersatz >= 0 ? 'disabled' : ''}>${PFEIL_RECHTS}</button>
  </header>`;

  html += aktualisierenZeile();
  html += zielKarte(w);
  html += punkteKarte(w);
  html += schritteKarte(w);
  html += erfolgeKarte(w);
  html += tagesKarte(w);

  html += '<h2>Sport in dieser Woche</h2>';
  const vorhanden = SPORTARTEN.filter(s => w.summen[s.key]);
  if (!vorhanden.length) {
    html += '<div class="karte leer">Noch keine Aktivität in dieser Woche.</div>';
  } else {
    html += '<div class="summen">' + vorhanden.map(s => {
      const x = w.summen[s.key];
      const werte = [];
      if (x.km) werte.push('<b>' + km(x.km) + '</b>');
      if (x.min) werte.push(dauer(x.min));
      if (x.hm) werte.push(zahlFormat0.format(x.hm) + ' hm');
      if (x.hatPkt) werte.push((x.geschaetzt ? '≈ ' : '') + x.pkt + ' Pkt');
      return `<div class="summe" style="--farbe: var(--${s.key})">
        <div class="summe-kopf"><span class="summe-name">${s.name}</span><span class="summe-anzahl">${x.anzahl}×</span></div>
        <div class="summe-werte">${werte.join(' · ') || '–'}</div>
      </div>`;
    }).join('') + '</div>';

    html += '<h2>Aktivitäten</h2><div class="liste">';
    w.tage.filter(t => t.aktivitaeten.length).forEach(t => {
      html += `<div class="liste-tag">${TAGE_KURZ[(t.datum.getDay() + 6) % 7]} ${t.datum.getDate()}. ${MONATE[t.datum.getMonth()]}</div>`;
      t.aktivitaeten.forEach(a => {
        html += `<button type="button" class="eintrag" data-aktion="detail" data-id="${esc(a.id)}" style="--farbe: var(--${esc(a.sportart)})">
          <span class="eintrag-marke" aria-hidden="true"></span>
          <span class="eintrag-text">
            <span class="eintrag-name">${esc(a.name || SPORT_NAME[a.sportart] || a.typ)}</span>
            <span class="eintrag-werte">${esc(SPORT_NAME[a.sportart] || a.sportart)}${wertListe(a) ? ' · ' + wertListe(a) : ''}${a.unplausibel ? ' · <span class="warnung">zählt nicht</span>' : ''}</span>
          </span>
          <span class="eintrag-zeit">${uhrzeit(a.datum)}</span>
          <svg class="eintrag-pfeil" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </button>`;
      });
    });
    html += '</div>';
  }

  html += standZeile();
  return html;
}

function zielKarte(w) {
  if (!w.ziel) {
    return `<section class="karte"><div class="ziel-zeile"><div class="ziel-zahl">${w.laeufe} <small>Läufe</small></div></div>
      <p class="leise">Kein Wochenziel gesetzt (Einstellungen).</p></section>`;
  }
  const punkte = [];
  for (let i = 0; i < Math.max(w.ziel, w.laeufe); i++) {
    const klasse = i < Math.min(w.laeufe, w.ziel) ? 'voll' : (i < w.laeufe ? 'extra' : '');
    punkte.push(`<span class="ziel-punkt ${klasse}"></span>`);
  }
  const fehlt = Math.max(0, w.ziel - w.laeufe);
  let text;
  let klasse;
  if (!fehlt) {
    text = w.laeufe > w.ziel ? 'Ziel erreicht, ' + (w.laeufe - w.ziel) + ' Lauf extra' : 'Ziel erreicht';
    klasse = 'gut';
  } else if (zustand.wocheVersatz === 0) {
    text = 'Noch ' + fehlt + (fehlt === 1 ? ' Lauf' : ' Läufe') + ' · ' +
      (w.restTage === 1 ? 'nur noch heute' : w.restTage + ' Tage übrig (mit heute)');
    klasse = 'offen';
  } else {
    text = 'Ziel verfehlt, ' + fehlt + (fehlt === 1 ? ' Lauf' : ' Läufe') + ' zu wenig';
    klasse = 'verfehlt';
  }

  const serieHtml = zustand.wocheVersatz === 0 ? serieZeile(serieLaufen(), 'Laufziel') : '';

  return `<section class="karte" aria-label="Laufziel">
    <div class="ziel-zeile">
      <div class="ziel-zahl">${w.laeufe} <small>von ${w.ziel} Läufen</small></div>
      <span class="ziel-art">Laufziel</span>
    </div>
    <div class="ziel-punkte">${punkte.join('')}</div>
    <div class="ziel-text ${klasse}">${text}</div>
    ${serieHtml}
  </section>`;
}

function serieZeile(s, name) {
  if (!s) return '';
  const unter = s.aktuellErreicht ? 'inklusive dieser Woche'
    : s.aktuell ? 'diese Woche noch offen' : 'starte diese Woche eine neue Serie';
  return `<div class="serie">
    <span class="serie-zahl">${s.aktuell}</span>
    <div><b>${s.aktuell === 1 ? 'Woche' : 'Wochen'} ${name} in Folge</b><br><span class="leise">${unter}${s.laengste > s.aktuell ? ' · Rekord ' + s.laengste : ''}</span></div>
  </div>`;
}

/** Aktivziel: Sportpunkte der Woche. */
function punkteKarte(w) {
  if (w.ende < PUNKTE_START) {
    return '<section class="karte" style="margin-top:12px"><p class="leise" style="margin:0">Punkte gibt es ab 2023 (Intensitätsminuten von Garmin).</p></section>';
  }
  const ziel = w.zielPunkte;
  const ca = w.geschaetzt ? '<span class="ca">≈</span>' : '';
  if (!ziel) {
    return `<section class="karte" style="margin-top:12px"><div class="ziel-zeile"><div class="ziel-zahl">${ca}${w.pkt} <small>Punkte</small></div><span class="ziel-art">Aktivziel</span></div>
      <p class="leise">Kein Aktivziel gesetzt (Einstellungen).</p></section>`;
  }
  const anteil = Math.min(1, w.pkt / ziel);
  const fehlt = Math.max(0, ziel - w.pkt);
  let text;
  let klasse;
  if (!fehlt) {
    text = w.pkt > ziel ? 'Ziel erreicht, ' + (w.pkt - ziel) + ' Punkte extra' : 'Ziel erreicht';
    klasse = 'gut';
  } else if (zustand.wocheVersatz === 0) {
    text = 'Noch ' + fehlt + ' Punkte · ' + (w.restTage === 1 ? 'nur noch heute' : w.restTage + ' Tage übrig (mit heute)');
    klasse = 'offen';
  } else {
    text = 'Ziel verfehlt, ' + fehlt + ' Punkte zu wenig';
    klasse = 'verfehlt';
  }
  return `<section class="karte" aria-label="Aktivziel" style="margin-top:12px">
    <div class="ziel-zeile">
      <div class="ziel-zahl">${ca}${w.pkt} <small>von ${ziel} Punkten</small></div>
      <span class="ziel-art">Aktivziel</span>
    </div>
    <div class="balken" style="--farbe: var(--aktiv)"><span style="width:${(anteil * 100).toFixed(1)}%"></span></div>
    <div class="ziel-text ${klasse}">${text}</div>
    ${w.alltag ? `<p class="leise klein-text">${w.sport} Sportpunkte + ${w.alltag} Alltagspunkte (Schritte)</p>` : ''}
    ${schnittZeile(w)}
    ${w.geschaetzt ? '<p class="leise klein-text">≈ enthält geschätzte Punkte für Aktivitäten ohne Intensitätsminuten.</p>' : ''}
    ${zustand.wocheVersatz === 0 ? serieZeile(seriePunkte(), 'Aktivziel') : ''}
  </section>`;
}

/** „Dein Schnitt: 165 Punkte pro Woche · diese Woche bisher 58 %“ */
function schnittZeile(w) {
  const s = punkteSchnitt();
  if (!s) return '';
  const v = w.pkt / s;
  const wann = zustand.wocheVersatz === 0 ? 'diese Woche bisher' : 'diese Woche';
  return `<p class="leise klein-text">Dein Schnitt (12 Monate): ${zahlFormat0.format(s)} Punkte pro Woche · ${wann} <b class="${formKlasse(v)}-text">${prozent(v)}</b></p>`;
}

function erfolgeKarte(w) {
  const punkte = wochenErfolge(w);
  if (!punkte.length) return '';
  return `<section class="karte erfolge-woche" aria-label="Erfolge dieser Woche" style="margin-top:12px">
    <div class="erfolge-titel">${SYMBOL_POKAL} Erfolge dieser Woche</div>
    <ul>${punkte.map(p => `<li class="${p.stark ? 'stark' : ''}">${esc(p.text)}</li>`).join('')}</ul>
  </section>`;
}

/** Schritte der Woche (abgeschlossene Tage) im Vergleich zum Schnitt der 90 Tage davor. */
function schritteKarte(w) {
  if (!zustand.schritte.size) return '';
  // Nur abgeschlossene Tage: der heutige Tag ist noch nicht fertig
  const heuteBeginn = tagePlus(new Date(), 0);
  const ende = tagePlus(w.start, 7) < heuteBeginn ? tagePlus(w.start, 7) : heuteBeginn;
  const woche = schritteZeitraum(w.start, ende);
  const heute = zustand.schritte.get(schluessel(new Date()));
  if (!woche.length) {
    if (zustand.wocheVersatz !== 0 || heute === undefined) return '';
    return `<section class="karte" aria-label="Schritte" style="margin-top:12px">
      <div class="ziel-zeile"><div class="ziel-zahl klein">${zahlFormat0.format(heute)} <small>Schritte heute bisher</small></div><span class="ziel-art">Schritte</span></div>
    </section>`;
  }
  const schnittWoche = mittel(woche);
  const basis = schritteZeitraum(tagePlus(w.start, -90), w.start);
  let vergleich = '<span class="leise">Vergleich mit deinem Schnitt ab einer Woche Daten.</span>';
  if (basis.length >= 7) {
    const v = schnittWoche / mittel(basis);
    vergleich = `<span class="leise">dein Schnitt: ${zahlFormat0.format(mittel(basis))} pro Tag ·</span> <b class="${formKlasse(v)}-text">${prozent(v)}</b>`;
  }
  return `<section class="karte" aria-label="Schritte" style="margin-top:12px">
    <div class="ziel-zeile">
      <div class="ziel-zahl klein">${zahlFormat0.format(schnittWoche)} <small>Schritte pro Tag</small></div>
      <span class="ziel-art">Schritte</span>
    </div>
    <p class="klein-text" style="margin-top:6px">${vergleich}${zustand.wocheVersatz === 0 && heute !== undefined ? '<br><span class="leise">heute bisher ' + zahlFormat0.format(heute) + '</span>' : ''}${w.alltag ? '<br><span class="leise">Alltagspunkte diese Woche: ' + w.alltag + '</span>' : ''}</p>
  </section>`;
}

function tagesKarte(w) {
  return `<section class="karte" aria-label="Tage der Woche" style="margin-top:12px">
    <div class="tage">${w.tage.map((t, i) => `
      <div class="tag ${t.heute ? 'heute' : ''} ${t.zukunft ? 'zukunft' : ''}">
        <div class="tag-name">${TAGE_KURZ[i]}</div>
        <div class="tag-nr">${t.datum.getDate()}</div>
        <div class="tag-punkte">${t.aktivitaeten.map(a =>
    `<span class="punkt" style="background: var(--${esc(a.sportart)})" title="${esc(SPORT_NAME[a.sportart] || a.sportart)}"></span>`).join('')}</div>
        ${zustand.schritte.has(schluessel(t.datum)) ? `<div class="tag-schritte" title="Schritte">${schritteKurz(zustand.schritte.get(schluessel(t.datum)))}</div>` : ''}
      </div>`).join('')}
    </div>
  </section>`;
}

const SYMBOL_AKTUALISIEREN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>';

function ladeText() {
  return zustand.laedt === 'garmin' ? 'Hole neue Aktivitäten von Garmin …' : 'Lade Daten …';
}

/** „2026-11-17 03:12:00“ → „17.11. 03:12“ */
function kurzZeit(text) {
  const m = /^\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(String(text || ''));
  return m ? (+m[2]) + '.' + (+m[1]) + '. ' + m[3] : '–';
}

/** Zeile oben in der Wochenansicht: Stand der Daten und Knopf „Von Garmin holen“. */
function aktualisierenZeile() {
  const text = zustand.laedt ? ladeText()
    : zustand.fehler ? '<span class="hinweis-fehler">' + esc(zustand.fehler) + '</span>'
      : 'Import ' + esc(kurzZeit(zustand.status && zustand.status.letzterImport));
  return `<div class="aktualisieren">
    <span class="leise">${text}</span>
    <button class="knopf klein" data-aktion="von-garmin" ${zustand.laedt ? 'disabled' : ''}>
      <span class="${zustand.laedt ? 'dreht' : ''}">${SYMBOL_AKTUALISIEREN}</span> Von Garmin holen</button>
  </div>`;
}

function standZeile() {
  if (zustand.laedt) return '<p class="leise stand">' + ladeText() + '</p>';
  return '<p class="leise stand">Daten auf diesem Gerät: ' + zeitpunkt(zustand.datenStand) + '</p>';
}

const HILFE_KNOPF = '<button class="rund klein-rund" data-aktion="hilfe" aria-label="Erklärungen">?</button>';
const SYMBOL_POKAL = '<svg class="pokal" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';

function datumLang(d) {
  return d.getDate() + '. ' + MONATE[d.getMonth()] + ' ' + d.getFullYear();
}

function abzeichenReihe(s, farbe) {
  return '<div class="abzeichen">' + SERIEN_STUFEN.map(stufe => {
    const am = s && s.erreicht[stufe];
    const unter = am ? 'KW ' + kalenderwoche(am) + '/' + am.getFullYear()
      : s ? 'noch ' + (stufe - s.aktuell) : '–';
    return `<div class="abz ${am ? 'erreicht' : ''}" style="--farbe: var(--${farbe})">
      <span class="abz-kreis">${stufe}</span>
      <span class="abz-text">Wochen<small>${unter}</small></span>
    </div>`;
  }).join('') + '</div>';
}

function bestmarkeZeile(x) {
  const inhalt = `<span class="bm-titel">${esc(x.titel)}<small>${esc(x.unter || '')}${x.unter ? ' · ' : ''}${esc(x.datumText || datumLang(x.datum))}</small></span>
    <span class="bm-wert">${esc(x.wert)}</span>`;
  return x.id ? `<button type="button" class="bestmarke" data-aktion="detail" data-id="${esc(x.id)}">${inhalt}</button>`
    : `<div class="bestmarke">${inhalt}</div>`;
}

function ansichtErfolge() {
  if (!zustand.aktivitaeten.length) return '<h1>Erfolge</h1><div class="karte leer">Noch keine Daten geladen.</div>';
  const sl = serieLaufen();
  const sp = seriePunkte();
  const serieKarte = (s, name, ziel, farbe, einheit) => `<section class="karte">
    <div class="ziel-zeile"><b>${name}</b><span class="leise">${ziel ? ziel + ' ' + einheit + ' pro Woche' : 'kein Ziel gesetzt'}</span></div>
    ${s ? `<p class="serie-werte"><span><b>${s.aktuell}</b> aktuelle Serie</span><span><b>${s.laengste}</b> längste Serie${s.laengsteBis ? ' (bis KW ' + kalenderwoche(s.laengsteBis) + '/' + s.laengsteBis.getFullYear() + ')' : ''}</span></p>` + abzeichenReihe(s, farbe) : ''}
  </section>`;

  let html = '<div class="titel-zeile"><h1>Erfolge</h1>' + HILFE_KNOPF + '</div><h2>Serien</h2>';
  html += serieKarte(sl, 'Laufziel', zustand.einstellungen.wochenzielLaeufe, 'laufen', 'Läufe');
  html += serieKarte(sp, 'Aktivziel', zustand.einstellungen.wochenzielPunkte, 'aktiv', 'Sportpunkte');
  html += '<p class="leise klein-text">Aktivziel ab 2023. Rückwirkend gilt das aktuelle Ziel.</p>';

  const b = bestmarken();
  if (b.zeiten.length) html += '<h2>Bestzeiten Laufen</h2><section class="karte liste-karte">' + b.zeiten.map(bestmarkeZeile).join('') + '</section>' +
    '<p class="leise klein-text">Ohne Laufband. „Ø des ganzen Laufs“: Garmin hat für diesen Lauf keinen schnellsten Abschnitt, gerechnet wird mit der Durchschnitts-Pace.</p>';
  if (b.weitere.length) html += '<h2>Bestmarken</h2><section class="karte liste-karte">' + b.weitere.map(bestmarkeZeile).join('') + '</section>';

  // Jahres-Abzeichen für das laufende Jahr
  const jetzt = new Date().getFullYear();
  const aktuell = jahresKm().get(jetzt) || { laufen: 0, rad: 0, wandern: 0 };
  html += '<h2>Jahres-Abzeichen ' + jetzt + '</h2><section class="karte">' + Object.keys(JAHRES_STUFEN).map(sa => {
    const wert = aktuell[sa];
    const stufen = JAHRES_STUFEN[sa];
    const naechste = stufen.find(s => wert < s);
    const anteil = naechste ? wert / naechste : 1;
    const erreicht = stufen.filter(s => wert >= s);
    return `<div class="jahr-zeile" style="--farbe: var(--${sa})">
      <div class="ziel-zeile"><b>${SPORT_NAME[sa]} ${km(wert)}</b>
        <span class="stufen">${stufen.map(s => `<span class="stufe ${wert >= s ? 'an' : ''}">${zahlFormat0.format(s)}</span>`).join('')}</span></div>
      <div class="balken"><span style="width:${(anteil * 100).toFixed(1)}%"></span></div>
      <div class="leise klein-text">${naechste ? 'Noch ' + km(naechste - wert) + ' bis zum Abzeichen ' + zahlFormat0.format(naechste) + ' km' : 'Alle Abzeichen geschafft'}${erreicht.length ? ' · geschafft: ' + erreicht.map(s => zahlFormat0.format(s)).join(', ') + ' km' : ''}</div>
    </div>`;
  }).join('') + '</section>';
  html += '<p class="leise klein-text">Jedes Jahr startet bei null. Den Vergleich mit früheren Jahren findest du unter „Form“.</p>';

  const ar = allrounderWochen();
  html += `<h2>Allrounder</h2><section class="karte"><p style="margin:0"><b>${ar.length}</b> ${ar.length === 1 ? 'Woche' : 'Wochen'} mit mindestens 3 Sportarten${ar.length ? ' · zuletzt KW ' + kalenderwoche(ar[ar.length - 1]) + '/' + ar[ar.length - 1].getFullYear() : ''}</p></section>`;
  return html;
}

function zaehlerHtml(wert, aktionMinus, aktionPlus, min, max, text, unter) {
  const v = verbindung();
  return `<div class="zaehler">
      <button class="rund" data-aktion="${aktionMinus}" aria-label="Verringern" ${wert <= min || !v.token ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button>
      <span class="zaehler-wert">${wert}</span>
      <button class="rund" data-aktion="${aktionPlus}" aria-label="Erhöhen" ${wert >= max || !v.token ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      <span>${text}<br><span class="leise">${unter}</span></span>
    </div>`;
}

function ansichtEinstellungen() {
  const v = verbindung();
  const st = zustand.status;
  const ziel = Number(zustand.einstellungen.wochenzielLaeufe) || 0;
  const zielPunkte = Number(zustand.einstellungen.wochenzielPunkte) || 0;

  return `<h1>Einstellungen</h1>

  <button class="knopf voll" data-aktion="hilfe">So funktioniert die App</button>

  <h2>Wochenziele</h2>
  <section class="karte">
    ${zaehlerHtml(ziel, 'ziel-minus', 'ziel-plus', 0, 14, 'Läufe pro Woche', 'Laufziel, Montag bis Sonntag')}
  </section>
  <section class="karte">
    ${zaehlerHtml(zielPunkte, 'punkte-minus', 'punkte-plus', 0, 1000, 'Punkte pro Woche', 'Aktivziel: Sport + Alltag · Garmin/WHO: 150')}
  </section>
  <section class="karte">
    <label class="schalter-zeile">
      <span><b>Alltagspunkte aus Schritten</b><small>Handy-Schritte außerhalb aufgezeichneter Aktivitäten zählen zum Aktivziel</small></span>
      <input type="checkbox" data-einst="alltagPunkte" ${Number(zustand.einstellungen.alltagPunkte) ? 'checked' : ''} ${v.token ? '' : 'disabled'}>
    </label>
    <div class="${Number(zustand.einstellungen.alltagPunkte) ? '' : 'aus'}">
      ${zaehlerHtml(Number(zustand.einstellungen.alltagFrei), 'frei-minus', 'frei-plus', 0, 20000, 'Schritte frei pro Tag', 'Grundbewegung ohne Punkte · Standard 3000')}
      ${zaehlerHtml(Number(zustand.einstellungen.alltagProPunkt), 'propunkt-minus', 'propunkt-plus', 20, 2000, 'Schritte pro Punkt', 'Standard 200 · 7000–8000 Schritte/Tag ≈ 150 pro Woche')}
    </div>
  </section>

  ${benachrichtigungenHtml()}
  ${schritteHtml()}

  <h2>Verbindung</h2>
  <section class="karte">
    <form id="verbindung-form" autocomplete="off">
      <label class="feld"><span>Web-App-URL</span>
        <input name="url" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(v.url)}" required></label>
      <label class="feld"><span>Token</span>
        <input name="token" type="password" placeholder="WEBAPP_TOKEN" value="${esc(v.token)}" required></label>
      <div class="knopfreihe">
        <button class="knopf haupt" type="submit">Speichern und laden</button>
        ${v.token ? '<button class="knopf" type="button" data-aktion="verbindung-loeschen">Verbindung löschen</button>' : ''}
      </div>
    </form>
  </section>

  <h2>Daten</h2>
  <section class="karte">
    <table class="tabelle">
      <tr><td>Aktivitäten</td><td>${zustand.aktivitaeten.length}</td></tr>
      <tr><td>Auf diesem Gerät geladen</td><td>${zeitpunkt(zustand.datenStand)}</td></tr>
      <tr><td>Letzter Garmin-Import</td><td>${st && st.letzterImport ? esc(st.letzterImport) + ' (' + st.letzterImportNeu + ' neu)' : '–'}</td></tr>
      ${st && st.letzterFehler ? `<tr><td>Letzter Fehler</td><td class="hinweis-fehler">${esc(st.letzterFehler)}</td></tr>` : ''}
      <tr><td>Version Oberfläche / Web-App</td><td>${APP_VERSION} / ${esc(zustand.webAppVersion || '–')}</td></tr>
      <tr><td>Läuft als</td><td>${esc(appVersionText())}</td></tr>
    </table>
    <div class="knopfreihe" style="margin-top:12px">
      <button class="knopf" data-aktion="von-garmin" ${zustand.laedt || !v.token ? 'disabled' : ''}>${zustand.laedt ? ladeText() : 'Von Garmin holen'}</button>
      ${inApp() ? '<button class="knopf" data-aktion="app-update">Nach App-Update suchen</button>' : ''}
    </div>
    ${zustand.fehler ? `<p class="hinweis-fehler">${esc(zustand.fehler)}</p>` : ''}
  </section>`;
}

// ---------------------------------------------------------------------------
// Detailansicht
// ---------------------------------------------------------------------------

const ZONEN = [
  { name: 'Zone 1', text: 'Aufwärmen' },
  { name: 'Zone 2', text: 'Leicht' },
  { name: 'Zone 3', text: 'Aerob' },
  { name: 'Zone 4', text: 'Schwelle' },
  { name: 'Zone 5', text: 'Maximum' }
];

/** Garmin-Trainingseffekt-Labels mit Garmins deutschen Begriffen (Werte laut diagnoseZusatzwerte). */
const TE_LABEL = {
  RECOVERY: 'Erholung', AEROBIC_BASE: 'Basis', TEMPO: 'Tempo', LACTATE_THRESHOLD: 'Schwelle',
  VO2MAX: 'VO2max', ANAEROBIC_CAPACITY: 'Anaerob', SPEED: 'Sprint'
};

function teLabel(label) {
  if (!label || label === 'UNKNOWN') return '';
  return TE_LABEL[label] || label.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

/** Garmin-Skala für den Trainingseffekt (0–5). */
function teText(wert) {
  if (wert >= 5) return 'Überlastend';
  if (wert >= 4) return 'Stark verbessernd';
  if (wert >= 3) return 'Verbessernd';
  if (wert >= 2) return 'Erhaltend';
  if (wert >= 1) return 'Geringer Effekt';
  return 'Kein Effekt';
}


/** Sekunden → „4:52“ bzw. „1:04:12“. */
function zeitAusSekunden(s) {
  const g = Math.round(s);
  const h = Math.floor(g / 3600);
  const m = Math.floor((g % 3600) / 60);
  const sek = String(g % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + sek : m + ':' + sek;
}

/** Pace in min/km aus Sekunden pro km. */
function pace(sekProKm) {
  return zeitAusSekunden(sekProKm) + ' /km';
}

function gespeicherteDetails() {
  return lesen(SPEICHER.details, {});
}

/** Merkt sich die aktuelle Ansicht, damit „Zurück“ dorthin führt. */
function unterseiteOeffnen(ansicht, zustandFuerHistory) {
  if (zustand.ansicht !== 'detail' && zustand.ansicht !== 'hilfe') zustand.vorherigeAnsicht = zustand.ansicht;
  zustand.ansicht = ansicht;
  history.pushState(zustandFuerHistory, '');
  window.scrollTo(0, 0);
}

async function detailOeffnen(id) {
  unterseiteOeffnen('detail', { detail: id });
  zustand.detailId = id;
  zustand.detailFehler = null;
  if (gespeicherteDetails()[id]) {
    zeichnen();
    return;
  }
  zustand.detailLaedt = true;
  zeichnen();
  try {
    const antwort = await api('details', { id: id });
    // Nur gefüllte Details merken; leere kommen evtl. nach „detailsNachtragen“ noch
    if (Object.keys(antwort.details || {}).length) {
      const alle = gespeicherteDetails();
      alle[id] = antwort.details;
      schreiben(SPEICHER.details, alle);
    }
  } catch (e) {
    zustand.detailFehler = e.message;
  } finally {
    zustand.detailLaedt = false;
    if (zustand.detailId === id) zeichnen();
  }
}

function kennzahl(wert, name) {
  return `<div class="kz"><div class="kz-wert">${wert}</div><div class="kz-name">${name}</div></div>`;
}

function zeile(name, wert) {
  return `<tr><td>${name}</td><td>${wert}</td></tr>`;
}

function ansichtDetail() {
  const a = zustand.aktivitaeten.find(x => x.id === zustand.detailId);
  const zurueck = `<button class="knopf klein zurueck" data-aktion="zurueck">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg> Zurück</button>`;
  if (!a) return zurueck + '<div class="karte leer">Aktivität nicht gefunden.</div>';

  const d = gespeicherteDetails()[a.id] || {};
  const lauf = a.sportart === 'laufen' || a.sportart === 'wandern';
  const datumText = TAGE_KURZ[(a.datum.getDay() + 6) % 7] + ' ' + a.datum.getDate() + '. ' +
    MONATE[a.datum.getMonth()] + ' ' + a.datum.getFullYear() + ', ' + uhrzeit(a.datum);

  let html = zurueck + `<header class="detail-kopf" style="--farbe: var(--${esc(a.sportart)})">
    <span class="detail-marke" aria-hidden="true"></span>
    <div><h1>${esc(a.name || SPORT_NAME[a.sportart])}</h1>
    <span class="leise">${esc(SPORT_NAME[a.sportart] || a.sportart)} · ${datumText}${d.ort ? ' · ' + esc(d.ort) : ''}</span></div>
  </header>`;

  if (a.unplausibel) {
    html += `<div class="hinweis-box">Diese Aktivität ist unrealistisch (${esc(a.unplausibel)}). Vermutlich lief die Aufzeichnung im Auto oder Zug weiter. Sie zählt nicht für Kilometer, Höhenmeter, Bestmarken und Vergleiche, Sportpunkte zählen weiter.</div>`;
  }

  // Kennzahlen
  const kz = [];
  if (a.km) kz.push(kennzahl(km(a.km), 'Distanz'));
  if (a.min) kz.push(kennzahl(dauer(a.min), 'Bewegungszeit'));
  if (a.km && a.min) {
    if (a.sportart === 'schwimmen') kz.push(kennzahl(zeitAusSekunden(a.min * 60 / (a.km * 10)) + ' /100 m', 'Ø Tempo'));
    else if (lauf) kz.push(kennzahl(pace(a.min * 60 / a.km), 'Ø Pace'));
    else kz.push(kennzahl(dezimal1.format(a.km / (a.min / 60)) + ' km/h', 'Ø Geschwindigkeit'));
  }
  if (a.hm) kz.push(kennzahl(zahlFormat0.format(a.hm) + (d.hmAb ? ' / ' + zahlFormat0.format(d.hmAb) : '') + ' m', d.hmAb ? 'Höhenmeter auf / ab' : 'Höhenmeter'));
  if (a.puls) kz.push(kennzahl(a.puls + (d.pulsMax ? ' / ' + d.pulsMax : ''), d.pulsMax ? 'Puls Ø / max' : 'Ø Puls'));
  if (d.kalorien) kz.push(kennzahl(zahlFormat0.format(d.kalorien) + ' kcal', 'Kalorien'));
  if (typeof a.pkt === 'number') kz.push(kennzahl((a.pktGeschaetzt ? '≈ ' : '') + a.pkt, a.pktGeschaetzt ? 'Sportpunkte (geschätzt)' : 'Sportpunkte'));
  if (a.minGesamt && a.min && a.minGesamt - a.min >= 1) kz.push(kennzahl(dauer(a.minGesamt), 'Gesamtzeit'));
  if (d.vMaxMs && !lauf) kz.push(kennzahl(dezimal1.format(d.vMaxMs * 3.6) + ' km/h', 'Max. Geschwindigkeit'));
  html += '<div class="kennzahlen">' + kz.join('') + '</div>';
  html += detailSpurHtml(a);

  if (zustand.detailLaedt) return html + '<p class="leise stand">Lade Details …</p>';
  if (zustand.detailFehler) return html + `<p class="hinweis-fehler stand">${esc(zustand.detailFehler)}</p>`;
  if (!Object.keys(d).length) {
    return html + '<p class="leise stand">Für diese Aktivität gibt es keine weiteren Daten von Garmin.</p>';
  }

  // Pulszonen
  if (d.zonenMin && d.zonenMin.some(z => z > 0)) {
    const summe = d.zonenMin.reduce((s, z) => s + z, 0);
    const max = Math.max(...d.zonenMin);
    html += '<h2>Pulszonen</h2><section class="karte zonen">' + d.zonenMin.map((z, i) => `
      <div class="zone">
        <span class="zone-name">${ZONEN[i].name}<small>${ZONEN[i].text}</small></span>
        <span class="zone-balken"><span style="width:${max ? (z / max * 100).toFixed(1) : 0}%; background: var(--zone${i + 1})"></span></span>
        <span class="zone-wert">${dauer(z)}<small>${summe ? Math.round(z / summe * 100) : 0} %</small></span>
      </div>`).join('') + '</section>';
  }

  // Training
  const training = [];
  if (typeof d.teAerob === 'number') training.push(zeile('Trainingseffekt aerob', dezimal1.format(d.teAerob) + ' · ' + teText(d.teAerob)));
  if (typeof d.teAnaerob === 'number') training.push(zeile('Trainingseffekt anaerob', dezimal1.format(d.teAnaerob) + ' · ' + teText(d.teAnaerob)));
  if (teLabel(d.teLabel)) training.push(zeile('Haupt-Nutzen', esc(teLabel(d.teLabel))));
  if (typeof d.belastung === 'number') training.push(zeile('Trainingsbelastung', zahlFormat0.format(d.belastung)));
  if (typeof d.imModerat === 'number' || typeof d.imIntensiv === 'number') {
    const mod = d.imModerat || 0;
    const int = d.imIntensiv || 0;
    training.push(zeile('Intensitätsminuten', `${mod} moderat + ${int} intensiv`));
  }
  if (typeof d.bodyBattery === 'number') training.push(zeile('Body Battery', (d.bodyBattery > 0 ? '+' : '') + d.bodyBattery));
  if (training.length) html += '<h2>Training</h2><section class="karte"><table class="tabelle">' + training.join('') + '</table></section>';

  // Laufstil (nur Laufen)
  const stil = [];
  if (a.sportart === 'laufen') {
    if (d.kadenzLauf) stil.push(zeile('Schrittfrequenz', d.kadenzLauf + ' Schritte/min'));
    if (d.schrittlaengeCm) stil.push(zeile('Schrittlänge', dezimal2.format(d.schrittlaengeCm / 100) + ' m'));
    if (d.bodenkontaktMs) stil.push(zeile('Bodenkontaktzeit', d.bodenkontaktMs + ' ms'));
    if (d.vertOszCm) stil.push(zeile('Vertikale Bewegung', dezimal1.format(d.vertOszCm) + ' cm'));
    if (d.vertVerhaeltnis) stil.push(zeile('Vertikales Verhältnis', dezimal1.format(d.vertVerhaeltnis) + ' %'));
    if (d.vGapMs) stil.push(zeile('Pace steigungsbereinigt', pace(1000 / d.vGapMs)));
    if (d.leistungW) stil.push(zeile('Ø Leistung', d.leistungW + ' W'));
  } else if (a.sportart === 'rad') {
    if (d.kadenzRad) stil.push(zeile('Trittfrequenz', d.kadenzRad + ' U/min'));
    if (d.leistungW) stil.push(zeile('Ø Leistung', d.leistungW + ' W' + (d.leistungNormW ? ' (normiert ' + d.leistungNormW + ' W)' : '')));
  }
  if (typeof d.tempMin === 'number' && typeof d.tempMax === 'number') {
    stil.push(zeile('Temperatur', d.tempMin === d.tempMax ? d.tempMin + ' °C' : d.tempMin + ' bis ' + d.tempMax + ' °C'));
  }
  if (d.schritte && a.sportart !== 'rad') stil.push(zeile('Schritte', zahlFormat0.format(d.schritte)));
  if (stil.length) html += `<h2>${a.sportart === 'laufen' ? 'Laufstil' : 'Weitere Werte'}</h2><section class="karte"><table class="tabelle">${stil.join('')}</table></section>`;

  // Bestzeiten in dieser Aktivität (Laufen)
  if (a.sportart === 'laufen') {
    const splits = [['1 km', d.split1kS, 1], ['5 km', d.split5kS, 5], ['10 km', d.split10kS, 10],
      ['Halbmarathon', d.split21kS, 21.0975], ['Marathon', d.split42kS, 42.195]]
      .filter(s => typeof s[1] === 'number' && s[1] > 0)
      .map(s => zeile('Schnellste ' + s[0], zeitAusSekunden(s[1]) + ' <span class="leise">(' + pace(s[1] / s[2]) + ')</span>'));
    if (splits.length) html += '<h2>Schnellste Abschnitte</h2><section class="karte"><table class="tabelle">' + splits.join('') + '</table></section>';
  }
  return html;
}

// ---------------------------------------------------------------------------
// Zeichnen und Ereignisse
// ---------------------------------------------------------------------------

function zeichnen() {
  const inhalt = document.getElementById('inhalt');
  const ansichten = {
    einstellungen: ansichtEinstellungen, erfolge: ansichtErfolge, form: ansichtForm, karte: ansichtKarte,
    detail: ansichtDetail, hilfe: ansichtHilfe, woche: ansichtWoche
  };
  inhalt.innerHTML = (ansichten[zustand.ansicht] || ansichtWoche)();
  if (zustand.ansicht === 'karte') karteNachZeichnen();
  if (zustand.ansicht === 'detail' && zustand.detailId) detailKarteNachZeichnen(zustand.detailId);
  // Detail und Erklärungen gehören zur Ansicht, aus der sie geöffnet wurden
  const reiter = (zustand.ansicht === 'detail' || zustand.ansicht === 'hilfe') ? zustand.vorherigeAnsicht : zustand.ansicht;
  document.querySelectorAll('.leiste-knopf').forEach(k => {
    const aktiv = k.dataset.ansicht === reiter;
    k.classList.toggle('aktiv', aktiv);
    if (aktiv) k.setAttribute('aria-current', 'page');
    else k.removeAttribute('aria-current');
  });
}

let meldungZeit = null;
function meldung(text) {
  const m = document.getElementById('meldung');
  m.textContent = text;
  m.hidden = false;
  clearTimeout(meldungZeit);
  meldungZeit = setTimeout(() => { m.hidden = true; }, 3500);
}

let zielSpeichernZeit = null;

/** Ändert eine Einstellung um delta (zwischen min und max) und speichert sie. */
function zielAendern(schluessel, delta, max, name, min) {
  const alt = Number(zustand.einstellungen[schluessel]) || 0;
  const neu = Math.min(max, Math.max(min || 0, alt + delta));
  if (neu === alt) return;
  einstellungAendern(schluessel, neu, name);
}

/** Setzt eine Einstellung sofort in der App und speichert sie kurz danach im Sheet. */
function einstellungAendern(schluessel, neu, name) {
  zustand.einstellungen[schluessel] = neu;
  schritteZusammenfuehren(); // Alltagspunkte hängen von den Einstellungen ab
  zeichnen();
  // Mehrfaches Tippen zusammenfassen
  clearTimeout(zielSpeichernZeit);
  zielSpeichernZeit = setTimeout(async () => {
    try {
      const antwort = await api('einstellungSetzen', { schluessel: schluessel, wert: zustand.einstellungen[schluessel] });
      zustand.einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, antwort.einstellungen);
      schreiben(SPEICHER.einstellungen, zustand.einstellungen);
      schritteZusammenfuehren();
      meldung(name + ' gespeichert: ' + antwort.einstellungen[schluessel]);
    } catch (e) {
      zustand.einstellungen = Object.assign({}, zustand.einstellungen, lesen(SPEICHER.einstellungen, {}));
      meldung('Nicht gespeichert: ' + e.message);
    }
    zeichnen();
  }, 700);
}

document.addEventListener('click', ereignis => {
  const ziel = ereignis.target.closest('[data-ansicht], [data-aktion]');
  if (!ziel) return;
  if (ziel.dataset.ansicht) {
    zustand.ansicht = ziel.dataset.ansicht;
    if (zustand.ansicht === 'woche') zustand.wocheVersatz = 0;
    zeichnen();
    window.scrollTo(0, 0);
    return;
  }
  switch (ziel.dataset.aktion) {
    case 'detail': detailOeffnen(ziel.dataset.id); break;
    case 'zurueck': history.back(); break;
    case 'nb-test': window.SportApp.testBenachrichtigung(); meldung('Test läuft …'); break;
    case 'nb-vorschau': window.SportApp.vorschau(ziel.dataset.art); meldung('Vorschau wird geholt …'); break;
    case 'nb-erlauben': window.SportApp.benachrichtigungenAnfragen(); break;
    case 'schritte-erlauben': window.SportApp.schritteAnfragen(); break;
    case 'schritte-pruefen': window.SportApp.schritteDiagnose(); meldung('Prüfe Schrittzähler …'); break;
    case 'schritte-senden': window.SportApp.schritteAktualisieren(); meldung('Übertrage Schritte …'); break;
    case 'app-update': window.SportApp.updatePruefen(); meldung('Suche nach Update …'); break;
    case 'hilfe': unterseiteOeffnen('hilfe', { hilfe: true }); zeichnen(); break;
    case 'woche-zurueck': zustand.wocheVersatz--; zeichnen(); break;
    case 'woche-vor': zustand.wocheVersatz = Math.min(0, zustand.wocheVersatz + 1); zeichnen(); break;
    case 'zu-einstellungen': zustand.ansicht = 'einstellungen'; zeichnen(); break;
    case 'ziel-minus': zielAendern('wochenzielLaeufe', -1, 14, 'Laufziel'); break;
    case 'ziel-plus': zielAendern('wochenzielLaeufe', 1, 14, 'Laufziel'); break;
    case 'punkte-minus': zielAendern('wochenzielPunkte', -10, 1000, 'Aktivziel'); break;
    case 'punkte-plus': zielAendern('wochenzielPunkte', 10, 1000, 'Aktivziel'); break;
    case 'frei-minus': zielAendern('alltagFrei', -500, 20000, 'Schritte frei'); break;
    case 'frei-plus': zielAendern('alltagFrei', 500, 20000, 'Schritte frei'); break;
    case 'propunkt-minus': zielAendern('alltagProPunkt', -25, 2000, 'Schritte pro Punkt', 20); break;
    case 'propunkt-plus': zielAendern('alltagProPunkt', 25, 2000, 'Schritte pro Punkt', 20); break;
    case 'karte-filter':
      karteZustand.filter[ziel.dataset.sportart] = !karteZustand.filter[ziel.dataset.sportart];
      zeichnen();
      break;
    case 'von-garmin': vonGarminHolen(); break;
    case 'verbindung-loeschen':
      if (confirm('Verbindung und gespeicherte Daten auf diesem Gerät löschen?')) {
        Object.values(SPEICHER).forEach(k => schreiben(k, null));
        setzeAktivitaeten([]);
        zustand.status = null;
        zustand.datenStand = null;
        zeichnen();
      }
      break;
  }
});

// Benachrichtigungs-Einstellungen sofort speichern
document.addEventListener('change', ereignis => {
  if (ereignis.target.closest('[data-nb]') && inApp()) benachrichtigungenSpeichern();
  const einst = ereignis.target.closest('[data-einst]');
  if (einst) einstellungAendern(einst.dataset.einst, einst.checked ? 1 : 0, 'Alltagspunkte');
  if (ereignis.target.closest('[data-karte="jahr"]')) {
    karteZustand.jahr = ereignis.target.value;
    karteZustand.sicht = null; // auf die Spuren des Jahres zoomen
    zeichnen();
  }
});

document.addEventListener('submit', async ereignis => {
  if (ereignis.target.id !== 'verbindung-form') return;
  ereignis.preventDefault();
  const form = new FormData(ereignis.target);
  schreiben(SPEICHER.url, String(form.get('url') || '').trim());
  schreiben(SPEICHER.token, String(form.get('token') || '').trim());
  await allesLaden();
  if (zustand.fehler) {
    meldung('Fehler: ' + zustand.fehler);
  } else {
    meldung('Verbunden, ' + zustand.aktivitaeten.length + ' Aktivitäten geladen.');
    zustand.ansicht = 'woche';
    zeichnen();
  }
});

// Zurück-Taste (Handy) bzw. Knopf „Zurück“ schließt die Detailansicht
window.addEventListener('popstate', () => {
  if (zustand.ansicht === 'detail' || zustand.ansicht === 'hilfe') {
    zustand.ansicht = zustand.vorherigeAnsicht || 'woche';
    zustand.detailId = null;
    zeichnen();
  }
});

// Beim Zurückkehren in die App neu laden, wenn die Daten älter als 10 Minuten sind
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const alter = zustand.datenStand ? Date.now() - new Date(zustand.datenStand).getTime() : Infinity;
  if (alter > 10 * 60 * 1000) allesLaden();
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

ausSpeicherLaden();
verbindungAnApp();
if (!verbindung().token) zustand.ansicht = 'einstellungen';
zeichnen();
allesLaden();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline-Funktion fehlt dann, App läuft trotzdem */ });
}

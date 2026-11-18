/**
 * touren.js – Mehrtagestouren erkennen und anzeigen
 * Version: 0.14.2 (2026-11-18)
 *
 * Erkennung (entschieden mit Christof 2026-11-18), nur Wandern oder nur Rad pro Tour:
 * - Etappe = Aktivität von A nach B. Die nächste Etappe beginnt höchstens TOUR_ANSCHLUSS_KM
 *   vom Ende der vorherigen entfernt, mit höchstens TOUR_PAUSE_TAGE Pausentagen dazwischen.
 * - Zug zwischen zwei Aufzeichnungen: Die nächste Etappe darf bis TOUR_SPRUNG_KM entfernt
 *   beginnen, am selben Tag oder am nächsten Tag, wenn die Tour schon einen normalen
 *   Anschluss hat. Wird als „Lücke“ angezeigt.
 * - Rundtour (Start ≈ Ende) nahe am letzten Etappenende = „Ausflug“ (z. B. zwei Nächte am
 *   selben Ort). Andere Rundtouren gehören nie zu einer Tour, unterbrechen sie aber nicht.
 * - Pendeln: Orte, an denen besonders viele Aktivitäten beginnen oder enden (Zuhause,
 *   Arbeit), werden aus den Daten berechnet. Aktivitäten zwischen zwei solchen Orten
 *   gehören nie zu einer Tour. Keine Orte im Code.
 * - Gültig ist eine Tour mit mindestens 2 Etappen an verschiedenen Tagen, mindestens einem
 *   normalen Anschluss und mindestens TOUR_AUSDEHNUNG_KM Entfernung vom Start.
 * Start- und Endpunkt kommen aus den Spuren (karte.js), die Korrekturen (Name, aufgelöst,
 * Aktivität ohne Tour, Aktivität von Hand zu einer Tour) aus der Web-App (gas/Touren.gs).
 * Eine Tour wird über die activityId ihrer ersten erkannten Etappe angesprochen.
 *
 * Änderungen 0.13.0 (Feedback zu echten Touren: Ferien in Albenga, Tagesausflüge ab Zuhause):
 * - Übernachtung an einem häufigen Ort (Zuhause, Arbeit) beendet eine Tour; am Anfang und am
 *   Ende darf eine Tour zu Hause liegen.
 * - Eine Tour braucht mindestens eine Übernachtung unterwegs.
 * - Lücke am nächsten Tag nur, wenn die Tour schon eine Übernachtung unterwegs hat.
 * - Die Mindestentfernung von 20 km muss ein zusammenhängend gefahrenes Stück schaffen
 *   (Lücken zählen nicht).
 * - Mehr als zwei Nächte am selben Ort = Ferien-Standort, keine Tour.
 * - Orte unterwegs: Ortsliste aus GeoNames (daten/orte.txt, offline, die Spur verlässt das
 *   Handy nicht). Etappe „Start → Ziel, über …“ und Zeile „über …“ für die ganze Tour; der
 *   automatische Name ist „Ort beim ersten Punkt → Ort beim letzten Punkt“.
 * Änderungen 0.14.0: Fotos aus dem Fotoschatz (fotos.js) auf der Tour-Seite (Bildstreifen,
 *   Link in den Fotoschatz) und als abschaltbare Ebene „Fotos“ auf der Tour-Karte.
 * Änderungen 0.14.1: Die Tour-Karte lädt nach dem ersten Bild die feinen Spuren (5 m) der
 *   Etappen nach (vorher nur grob, 30 m, und dadurch eckig).
 * Nutzt Funktionen und Konstanten aus app.js und karte.js.
 */
'use strict';

const TOUR_SPORTARTEN = ['wandern', 'rad'];
const TOUR_ANSCHLUSS_KM = 3;
const TOUR_PAUSE_TAGE = 2;
const TOUR_SPRUNG_KM = 200;
const TOUR_RUNDE_KM = 1.5;
const TOUR_AUSDEHNUNG_KM = 20;
const HAEUFIG_ZELLE_KM = 0.5;
const HAEUFIG_MIN = 15;
const STANDORT_NAECHTE = 3;  // so viele Nächte am selben Ort = Ferien-Standort
const ORT_NAH_KM = 1.5;      // Orte so nah an der Spur gelten als „über“
const ORT_ZIEL_KM = 8;       // nächster Ort für Start und Ziel einer Etappe
/** Farben der Tage auf der Tour-Karte (wiederholen sich nach 8 Tagen). */
const TAG_FARBEN = ['#d63c12', '#1650c7', '#0f7a33', '#8a2fc4', '#c27c00', '#0a8a8a', '#c4307a', '#4d5bd6'];

const tourenZustand = {
  korrekturen: [],    // [[art, schluessel, wert], …] aus der Web-App
  cache: null,        // {schluessel, ergebnis}
  speichert: false
};

function abstandKm(p, q) {
  const breite = (p[0] + q[0]) / 2 * Math.PI / 180;
  const dx = (q[1] - p[1]) * 111.32 * Math.cos(breite);
  const dy = (q[0] - p[0]) * 110.54;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Tage seit 2000 (Kalendertag in lokaler Zeit). */
function tagNummer(d) {
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(2000, 0, 1)) / 86400000);
}

function korrekturenAuswerten() {
  const k = { name: new Map(), aufgeloest: new Set(), ohne: new Set(), zu: new Map() };
  tourenZustand.korrekturen.forEach(([art, schluessel, wert]) => {
    if (art === 'name') k.name.set(schluessel, wert);
    else if (art === 'aufgeloest') k.aufgeloest.add(schluessel);
    else if (art === 'ohne') k.ohne.add(schluessel);
    else if (art === 'zu') k.zu.set(schluessel, wert);
  });
  return k;
}

/**
 * Erkennt alle Touren. Liefert {touren: [...], proAktivitaet: Map id → {tour, nr, art}} oder
 * null, solange die Spuren noch nicht geladen sind. Ergebnis wird zwischengespeichert.
 */
function tourenErgebnis() {
  if (!karteZustand.spuren) return null;
  const schluessel = karteZustand.spuren.length + ':' + zustand.aktivitaeten.length + ':' + JSON.stringify(tourenZustand.korrekturen) + ':' + !!orteDaten.liste;
  const c = tourenZustand.cache;
  if (c && c.schluessel === schluessel && c.spuren === karteZustand.spuren && c.aktivitaeten === zustand.aktivitaeten) return c.ergebnis;
  const ergebnis = tourenErkennen();
  tourenZustand.cache = { schluessel, spuren: karteZustand.spuren, aktivitaeten: zustand.aktivitaeten, ergebnis };
  return ergebnis;
}

function tourenErkennen() {
  const spurProId = new Map(karteZustand.spuren.map(s => [s.id, s]));
  const k = korrekturenAuswerten();

  // Start und Ende jeder Aktivität mit Spur
  const alle = [];
  zustand.aktivitaeten.forEach(a => {
    const s = spurProId.get(a.id);
    if (!s) return;
    if (!s.teile) s.teile = spurTeile(s.pfad);
    if (!s.teile.length) return;
    const letzte = s.teile[s.teile.length - 1];
    const start = s.teile[0][0];
    const ende = letzte[letzte.length - 1];
    alle.push({ a, start, ende, tag: tagNummer(a.datum), runde: abstandKm(start, ende) < TOUR_RUNDE_KM });
  });

  // Häufige Orte (Zuhause, Arbeit): Raster 500 m, gezählt über alle Sportarten
  const zelle = p => [Math.floor(p[0] * 110.54 / HAEUFIG_ZELLE_KM), Math.floor(p[1] * 111.32 * Math.cos(p[0] * Math.PI / 180) / HAEUFIG_ZELLE_KM)];
  const zaehler = new Map();
  alle.forEach(x => {
    const zellen = new Set([zelle(x.start).join(','), zelle(x.ende).join(',')]);
    zellen.forEach(z => zaehler.set(z, (zaehler.get(z) || 0) + 1));
  });
  const haeufig = p => {
    const [zx, zy] = zelle(p);
    let summe = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) summe += zaehler.get((zx + i) + ',' + (zy + j)) || 0;
    return summe >= HAEUFIG_MIN;
  };

  // Ketten je Sportart
  const ketten = [];
  TOUR_SPORTARTEN.forEach(sportart => {
    const liste = alle.filter(x => x.a.sportart === sportart && zaehlt(x.a) && !k.ohne.has(x.a.id) &&
      !(!x.runde && haeufig(x.start) && haeufig(x.ende))).sort((x, y) => x.a.datum - y.a.datum);
    let kette = null;
    const neueKette = x => ({ sportart, teile: [{ x, art: 'etappe' }], punkt: x.ende, letzterTag: x.tag, anschluesse: 0, naechte: [] });
    liste.forEach(x => {
      if (x.runde) {
        if (kette && x.tag - kette.letzterTag <= TOUR_PAUSE_TAGE + 1 && abstandKm(kette.punkt, x.start) <= TOUR_ANSCHLUSS_KM) {
          kette.teile.push({ x, art: 'ausflug' });
          kette.letzterTag = x.tag;
        }
        return;
      }
      if (kette) {
        const d = abstandKm(kette.punkt, x.start);
        const pause = x.tag - kette.letzterTag;
        const zuHause = haeufig(kette.punkt);
        if (pause <= TOUR_PAUSE_TAGE + 1 && d <= TOUR_ANSCHLUSS_KM && !(pause >= 1 && zuHause)) {
          // Normaler Anschluss; über Nacht nur, wenn nicht zu Hause übernachtet
          kette.teile.push({ x, art: 'etappe' });
          kette.anschluesse++;
          if (pause >= 1) kette.naechte.push(kette.punkt);
          kette.punkt = x.ende;
          kette.letzterTag = x.tag;
          return;
        }
        if (d > TOUR_ANSCHLUSS_KM && d <= TOUR_SPRUNG_KM && !zuHause &&
          (pause === 0 || (pause === 1 && kette.naechte.length >= 1))) {
          // Lücke (z. B. Zug zwischen zwei Aufzeichnungen)
          kette.teile.push({ x, art: 'etappe', sprung: true });
          if (pause >= 1) kette.naechte.push(kette.punkt);
          kette.punkt = x.ende;
          kette.letzterTag = x.tag;
          return;
        }
        ketten.push(kette);
      }
      kette = neueKette(x);
    });
    if (kette) ketten.push(kette);
  });

  // Gültige Ketten werden Touren
  const touren = [];
  ketten.forEach(kt => {
    const etappen = kt.teile.filter(t => t.art === 'etappe');
    if (etappen.length < 2 || kt.anschluesse < 1 || !kt.naechte.length) return;
    if (new Set(etappen.map(t => t.x.tag)).size < 2) return;
    // Ferien-Standort: mehr als zwei Nächte am selben Ort
    if (kt.naechte.some(p => kt.naechte.filter(q => abstandKm(p, q) <= TOUR_ANSCHLUSS_KM).length >= STANDORT_NAECHTE)) return;
    // Mindestentfernung innerhalb eines zusammenhängend gefahrenen Stücks (ohne Lücken)
    let weite = 0;
    let anfang = null;
    etappen.forEach(t => {
      if (!anfang || t.sprung) anfang = t.x.start;
      weite = Math.max(weite, abstandKm(anfang, t.x.start), abstandKm(anfang, t.x.ende));
    });
    if (weite < TOUR_AUSDEHNUNG_KM) return;
    touren.push({ schluessel: etappen[0].x.a.id, sportart: kt.sportart, teile: kt.teile.slice() });
  });

  // Von Hand hinzugefügte Aktivitäten
  const proSchluessel = new Map(touren.map(t => [t.schluessel, t]));
  const proX = new Map(alle.map(x => [x.a.id, x]));
  k.zu.forEach((tourSchluessel, id) => {
    const ziel = proSchluessel.get(tourSchluessel);
    const x = proX.get(id) || (() => {
      const a = zustand.aktivitaeten.find(y => y.id === id);
      return a ? { a, start: null, ende: null, tag: tagNummer(a.datum), runde: false } : null;
    })();
    if (!ziel || !x) return;
    touren.forEach(t => { t.teile = t.teile.filter(tt => tt.x.a.id !== id); });
    ziel.teile.push({ x, art: x.runde ? 'ausflug' : 'etappe', manuell: true });
  });

  // Zusammenfassen, Lücken, Namen
  const proAktivitaet = new Map();
  const ergebnis = [];
  touren.forEach(t => {
    if (k.aufgeloest.has(t.schluessel)) return;
    t.teile.sort((x, y) => x.x.a.datum - y.x.a.datum);
    let vorher = null;
    let nr = 0;
    t.teile.forEach(tt => {
      if (tt.art === 'etappe') {
        nr++;
        tt.nr = nr;
        tt.luecke = vorher && vorher.ende && tt.x.start ? abstandKm(vorher.ende, tt.x.start) : 0;
        if (tt.luecke <= TOUR_ANSCHLUSS_KM) tt.luecke = 0;
        vorher = tt.x;
      }
    });
    const aktivitaeten = t.teile.map(tt => tt.x.a);
    const erste = aktivitaeten[0];
    const letzte = aktivitaeten[aktivitaeten.length - 1];
    const etappen = t.teile.filter(tt => tt.art === 'etappe');
    const tage = new Set(t.teile.map(tt => tt.x.tag));
    const vonTag = t.teile[0].x.tag;
    const bisTag = t.teile[t.teile.length - 1].x.tag;
    const letzteEtappe = etappen.length ? etappen[etappen.length - 1].x.a : letzte;
    // Orte unterwegs (nur wenn die Ortsliste geladen ist)
    const spurProIdOrte = orteDaten.liste ? new Map(karteZustand.spuren.map(sp => [sp.id, sp])) : null;
    let ueber = [];
    if (spurProIdOrte) {
      t.teile.forEach(tt => {
        const sp = spurProIdOrte.get(tt.x.a.id);
        tt.orte = sp && sp.teile && sp.teile.length ? etappenOrte(sp.teile) : null;
      });
      ueber = tourUeber(t.teile);
    }
    const startOrt = etappen.length && etappen[0].orte && etappen[0].orte.start;
    const zielOrt = etappen.length && etappen[etappen.length - 1].orte && etappen[etappen.length - 1].orte.ziel;
    const autoName = startOrt && zielOrt && startOrt !== zielOrt ? startOrt + ' → ' + zielOrt
      : erste.ort && letzteEtappe.ort && erste.ort !== letzteEtappe.ort ? erste.ort + ' → ' + letzteEtappe.ort
        : (t.sportart === 'rad' ? 'Radtour ' : 'Wandertour ') + MONATE[erste.datum.getMonth()] + ' ' + erste.datum.getFullYear();
    const tour = Object.assign(t, {
      name: k.name.get(t.schluessel) || autoName,
      autoName,
      ueber,
      von: erste.datum,
      bis: letzte.datum,
      tage: bisTag - vonTag + 1,
      aktiveTage: tage.size,
      pausentage: bisTag - vonTag + 1 - tage.size,
      etappen: etappen.length,
      ausfluege: t.teile.length - etappen.length,
      luecken: etappen.filter(tt => tt.luecke > 0).length,
      lueckenKm: etappen.reduce((s, tt) => s + (tt.luecke || 0), 0),
      km: aktivitaeten.reduce((s, a) => s + (a.km || 0), 0),
      hm: aktivitaeten.reduce((s, a) => s + (a.hm || 0), 0),
      hmAb: aktivitaeten.reduce((s, a) => s + (a.hmAb || 0), 0),
      min: aktivitaeten.reduce((s, a) => s + (a.min || 0), 0)
    });
    t.teile.forEach(tt => proAktivitaet.set(tt.x.a.id, { tour, nr: tt.nr || null, art: tt.art, manuell: !!tt.manuell }));
    ergebnis.push(tour);
  });
  ergebnis.sort((x, y) => y.von - x.von);
  return { touren: ergebnis, proAktivitaet };
}

// ---------------------------------------------------------------------------
// Orte unterwegs (GeoNames, daten/orte.txt)
// ---------------------------------------------------------------------------

const orteDaten = { liste: null, raster: null, versprechen: null };
const ORT_RASTER = 0.1; // Grad

/** Lädt die Ortsliste einmal; danach werden Touren mit Orten neu berechnet. */
function orteLaden() {
  if (orteDaten.liste || orteDaten.versprechen) return orteDaten.versprechen || Promise.resolve();
  orteDaten.versprechen = fetch('daten/orte.txt').then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }).then(text => {
    const liste = [];
    const raster = new Map();
    text.split('\n').forEach(zeile => {
      if (!zeile || zeile[0] === '#') return;
      const [name, la, lo, ew] = zeile.split('|');
      const o = { name, la: Number(la), lo: Number(lo), ew: Number(ew) };
      const key = Math.floor(o.la / ORT_RASTER) + ',' + Math.floor(o.lo / ORT_RASTER);
      if (!raster.has(key)) raster.set(key, []);
      raster.get(key).push(o);
      liste.push(o);
    });
    orteDaten.liste = liste;
    orteDaten.raster = raster;
    tourenZustand.cache = null;
    if (['tour', 'historie', 'detail', 'erfolge'].indexOf(zustand.ansicht) >= 0) zeichnen();
  }).catch(() => { orteDaten.versprechen = null; });
  return orteDaten.versprechen;
}

/** Orte im Umkreis (km) eines Punkts. */
function orteUm(p, km) {
  const r = Math.ceil(km / 111 / ORT_RASTER) + 1;
  const bx = Math.floor(p[0] / ORT_RASTER);
  const by = Math.floor(p[1] / ORT_RASTER);
  const treffer = [];
  for (let i = -r; i <= r; i++) {
    for (let j = -r; j <= r; j++) {
      (orteDaten.raster.get((bx + i) + ',' + (by + j)) || []).forEach(o => {
        const d = abstandKm(p, [o.la, o.lo]);
        if (d <= km) treffer.push({ o, d });
      });
    }
  }
  return treffer;
}

function naechsterOrt(p) {
  const t = orteUm(p, ORT_ZIEL_KM);
  if (!t.length) return null;
  // Nächster Ort, größere Orte leicht bevorzugt (Stadtrand statt Nachbardorf)
  t.sort((x, y) => (x.d - Math.log10(x.o.ew) * 0.3) - (y.d - Math.log10(y.o.ew) * 0.3));
  return t[0].o.name;
}

/** Start, Ziel und Orte unterwegs einer Spur (in Reihenfolge der Durchfahrt). */
function etappenOrte(teile) {
  const start = teile[0][0];
  const letztes = teile[teile.length - 1];
  const ende = letztes[letztes.length - 1];
  const gesehen = new Map(); // Name → {o, reihenfolge}
  let n = 0;
  teile.forEach(teil => {
    for (let i = 0; i < teil.length; i++) {
      const a = teil[i];
      const b = teil[i + 1] || a;
      const schritte = Math.max(1, Math.ceil(abstandKm(a, b) / 0.5));
      for (let s = 0; s < schritte; s++) {
        const p = [a[0] + (b[0] - a[0]) * s / schritte, a[1] + (b[1] - a[1]) * s / schritte];
        n++;
        orteUm(p, ORT_NAH_KM).forEach(({ o }) => { if (!gesehen.has(o.name)) gesehen.set(o.name, { o, reihenfolge: n }); });
      }
    }
  });
  const startOrt = naechsterOrt(start);
  const zielOrt = naechsterOrt(ende);
  // Ohne Start- und Zielort und ohne Orte direkt daneben (Vororte)
  const unterwegs = Array.from(gesehen.values()).filter(x => x.o.name !== startOrt && x.o.name !== zielOrt &&
    abstandKm([x.o.la, x.o.lo], start) > 3 && abstandKm([x.o.la, x.o.lo], ende) > 3);
  const groesste = unterwegs.slice().sort((x, y) => y.o.ew - x.o.ew).slice(0, 3);
  return {
    start: startOrt, ziel: zielOrt,
    ueber: groesste.sort((x, y) => x.reihenfolge - y.reihenfolge).map(x => x.o.name),
    alle: unterwegs
  };
}

/** Die 5 größten Orte der ganzen Tour (ohne Start und Ziel), in Reihenfolge der Durchfahrt. */
function tourUeber(teile) {
  const etappen = teile.filter(tt => tt.art === 'etappe' && tt.orte);
  if (!etappen.length) return [];
  const start = etappen[0].orte.start;
  const ziel = etappen[etappen.length - 1].orte.ziel;
  const kandidaten = [];
  etappen.forEach((tt, i) => {
    tt.orte.alle.forEach(x => kandidaten.push({ name: x.o.name, ew: x.o.ew, pos: i * 1e6 + x.reihenfolge }));
    if (i < etappen.length - 1 && tt.orte.ziel) {
      const o = orteDaten.liste.find(y => y.name === tt.orte.ziel);
      kandidaten.push({ name: tt.orte.ziel, ew: o ? o.ew : 0, pos: i * 1e6 + 9e5 });
    }
  });
  const eindeutig = new Map();
  kandidaten.forEach(c => { if (c.name !== start && c.name !== ziel && !eindeutig.has(c.name)) eindeutig.set(c.name, c); });
  return Array.from(eindeutig.values()).sort((x, y) => y.ew - x.ew).slice(0, 5).sort((x, y) => x.pos - y.pos).map(c => c.name);
}

function tourFinden(schluessel) {
  const e = tourenErgebnis();
  return e ? e.touren.find(t => t.schluessel === schluessel) || null : null;
}

// ---------------------------------------------------------------------------
// Korrekturen speichern
// ---------------------------------------------------------------------------

async function tourKorrektur(art, schluessel, wert, text) {
  if (tourenZustand.speichert) return;
  tourenZustand.speichert = true;
  try {
    const antwort = await api('tourSetzen', { art, schluessel, wert: wert || '' });
    tourenZustand.korrekturen = antwort.korrekturen || [];
    schreiben(SPEICHER.touren, tourenZustand.korrekturen);
    meldung(text);
  } catch (e) {
    meldung('Nicht gespeichert: ' + (e.message.indexOf('unbekannte aktion') >= 0 ? 'Die Web-App ist noch nicht aktualisiert.' : e.message));
  } finally {
    tourenZustand.speichert = false;
    zeichnen();
  }
}

// ---------------------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------------------

function zeitraumText(von, bis) {
  if (schluessel(von) === schluessel(bis)) return datumLang(von);
  if (von.getFullYear() === bis.getFullYear() && von.getMonth() === bis.getMonth()) {
    return von.getDate() + '.–' + bis.getDate() + '. ' + MONATE[von.getMonth()] + ' ' + von.getFullYear();
  }
  if (von.getFullYear() === bis.getFullYear()) {
    return von.getDate() + '. ' + MONATE[von.getMonth()] + ' – ' + bis.getDate() + '. ' + MONATE[bis.getMonth()] + ' ' + bis.getFullYear();
  }
  return datumLang(von) + ' – ' + datumLang(bis);
}

function tourZahlen(t) {
  const teile = [t.tage + (t.tage === 1 ? ' Tag' : ' Tage'), t.etappen + (t.etappen === 1 ? ' Etappe' : ' Etappen')];
  if (t.ausfluege) teile.push(t.ausfluege + (t.ausfluege === 1 ? ' Ausflug' : ' Ausflüge'));
  if (t.luecken) teile.push(t.luecken + (t.luecken === 1 ? ' Lücke' : ' Lücken'));
  return teile.join(' · ');
}

/** Karte einer Tour in Listen (Historie, Erfolge). */
function tourEintrag(t) {
  return `<button type="button" class="eintrag tour-eintrag" data-tour-aktion="oeffnen" data-tour="${esc(t.schluessel)}" style="--farbe: var(--${t.sportart})">
    <span class="eintrag-marke" aria-hidden="true"></span>
    <span class="eintrag-text">
      <span class="eintrag-name">${esc(t.name)}</span>
      <span class="eintrag-werte">${esc(zeitraumText(t.von, t.bis))}</span>
      ${t.ueber && t.ueber.length ? `<span class="eintrag-werte">über ${esc(t.ueber.slice(0, 3).join(', '))}</span>` : ''}
      <span class="eintrag-werte">${esc(tourZahlen(t))}</span>
      <span class="eintrag-werte"><b>${km(t.km)}</b> · ↑ ${zahlFormat0.format(t.hm)} m · ${dauer(t.min)}</span>
    </span>
    <svg class="eintrag-pfeil" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
  </button>`;
}

/** Liste der Touren für die Historie (Filter Suche, Sportart, Jahr). */
function tourenListeHtml(filter) {
  orteLaden();
  const e = tourenErgebnis();
  if (!e) {
    spurenLaden(false);
    return '<div class="karte leer">Lade Spuren für die Touren …</div>';
  }
  const woerter = suchText(filter.suche).split(/\s+/).filter(Boolean);
  const liste = e.touren.filter(t => {
    if (filter.sportarten.size && !filter.sportarten.has(t.sportart)) return false;
    if (filter.jahr !== 'alle' && t.von.getFullYear() !== Number(filter.jahr) && t.bis.getFullYear() !== Number(filter.jahr)) return false;
    if (woerter.length) {
      const heu = suchText([t.name, t.autoName, (t.ueber || []).join(' '), SPORT_NAME[t.sportart], t.von.getFullYear(), MONATE[t.von.getMonth()]]
        .concat(t.teile.map(tt => tt.x.a.name + ' ' + (tt.x.a.ort || ''))).join(' '));
      if (!woerter.every(w => heu.indexOf(w) >= 0)) return false;
    }
    return true;
  });
  const kmSumme = liste.reduce((s, t) => s + t.km, 0);
  let html = `<p class="historie-summe"><b>${liste.length}</b> ${liste.length === 1 ? 'Tour' : 'Touren'}${liste.length ? ' · ' + km(kmSumme) + ' · ' + liste.reduce((s, t) => s + t.tage, 0) + ' Tage unterwegs' : ''}</p>`;
  if (!liste.length) {
    return html + `<div class="karte leer">${e.touren.length ? 'Keine Tour passt zu Suche oder Filter.' : 'Noch keine Mehrtagestouren erkannt.'}${karteZustand.offen ? ' Es werden noch ' + karteZustand.offen + ' Spuren geladen.' : ''}</div>`;
  }
  return html + '<div class="liste">' + liste.map(tourEintrag).join('') + '</div>' +
    '<p class="leise klein-text">Touren erkennt die App automatisch: Etappen, die ungefähr dort beginnen, wo die vorherige aufgehört hat. Korrigieren kannst du auf der Seite der Tour.</p>';
}

function tourOeffnen(schluessel) {
  unterseiteOeffnen('tour', { tour: schluessel });
  zustand.tourSchluessel = schluessel;
  zeichnen();
}

function ansichtTour() {
  orteLaden();
  const zurueck = `<button class="knopf klein zurueck" data-aktion="zurueck">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg> Zurück</button>`;
  const e = tourenErgebnis();
  if (!e) {
    spurenLaden(false);
    return zurueck + '<div class="karte leer">Lade Spuren …</div>';
  }
  const t = tourFinden(zustand.tourSchluessel);
  if (!t) return zurueck + '<div class="karte leer">Diese Tour gibt es nicht mehr (aufgelöst oder geändert).</div>';

  let html = zurueck + `<header class="detail-kopf" style="--farbe: var(--${t.sportart})">
    <span class="detail-marke" aria-hidden="true"></span>
    <div><h1>${esc(t.name)}</h1>
    <span class="leise">${t.sportart === 'rad' ? 'Radtour' : 'Wandertour'} · ${esc(zeitraumText(t.von, t.bis))}</span>
    ${t.ueber && t.ueber.length ? `<span class="leise tour-ueber">über ${esc(t.ueber.join(', '))}</span>` : ''}</div>
  </header>`;
  html += `<section class="karte karte-detail-rahmen"><div id="tour-karte" class="detail-karte" role="region" aria-label="Karte der Tour"></div></section>`;
  html += '<div class="kennzahlen">' + [
    kennzahl(km(t.km), 'Distanz'),
    kennzahl(t.tage + (t.tage === 1 ? ' Tag' : ' Tage'), t.pausentage ? t.pausentage + (t.pausentage === 1 ? ' Pausentag' : ' Pausentage') : 'ohne Pause'),
    kennzahl('↑ ' + zahlFormat0.format(t.hm) + ' m', t.hmAb ? '↓ ' + zahlFormat0.format(t.hmAb) + ' m' : 'Höhenmeter'),
    kennzahl(dauer(t.min), 'Bewegungszeit'),
    kennzahl(String(t.etappen), t.etappen === 1 ? 'Etappe' : 'Etappen'),
    kennzahl(km(t.km / Math.max(1, t.aktiveTage)), 'Ø pro Tag unterwegs')
  ].join('') + '</div>';
  html += fotosHtml(tourFotos(t), t.von);
  if (t.luecken) html += `<p class="leise klein-text">${t.luecken === 1 ? 'Eine Lücke' : t.luecken + ' Lücken'} zwischen Etappen (zusammen ${km(t.lueckenKm)}), z. B. mit dem Zug. Dort ist auf der Karte keine Linie gezogen.</p>`;

  // Etappenliste mit Pausentagen
  html += '<h2>Etappen</h2><div class="liste">';
  let tagVorher = null;
  t.teile.forEach(tt => {
    const a = tt.x.a;
    if (tagVorher !== null) {
      for (let tag = tagVorher + 1; tag < tt.x.tag; tag++) html += '<div class="tour-pause">Pausentag</div>';
    }
    tagVorher = tt.x.tag;
    const tagNr = tt.x.tag - t.teile[0].x.tag + 1;
    const farbe = TAG_FARBEN[(tagNr - 1) % TAG_FARBEN.length];
    const werte = [];
    if (a.km) werte.push(km(a.km));
    if (a.hm || a.hmAb) werte.push('↑ ' + zahlFormat0.format(a.hm || 0) + (typeof a.hmAb === 'number' ? ' ↓ ' + zahlFormat0.format(a.hmAb) : '') + ' m');
    if (a.min) werte.push(dauer(a.min));
    const marke = tt.art === 'ausflug' ? 'Ausflug' : 'Etappe ' + tt.nr;
    html += `<div class="tour-zeile">
      <button type="button" class="eintrag" data-aktion="detail" data-id="${esc(a.id)}" style="--farbe: ${farbe}">
        <span class="eintrag-marke" aria-hidden="true"></span>
        <span class="eintrag-text">
          <span class="eintrag-werte">Tag ${tagNr} · ${TAGE_KURZ[(a.datum.getDay() + 6) % 7]} ${a.datum.getDate()}. ${MONATE[a.datum.getMonth()]} · ${marke}${tt.manuell ? ' · von Hand' : ''}</span>
          <span class="eintrag-name">${esc(tt.orte && tt.orte.start && tt.orte.ziel && tt.art === 'etappe' ? tt.orte.start + ' → ' + tt.orte.ziel : a.name || SPORT_NAME[a.sportart])}</span>
          ${tt.orte && tt.orte.ueber.length ? `<span class="eintrag-werte">über ${esc(tt.orte.ueber.join(', '))}</span>` : ''}
          ${tt.orte && tt.orte.start && tt.art === 'etappe' && a.name ? `<span class="eintrag-werte">${esc(a.name)}</span>` : ''}
          <span class="eintrag-werte">${esc(werte.join(' · '))}</span>
          ${tt.luecke ? `<span class="eintrag-werte tour-luecke">Lücke davor: ${km(tt.luecke)} (z. B. Zug)</span>` : ''}
        </span>
        <svg class="eintrag-pfeil" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
      </button>
      <button type="button" class="rund klein-rund tour-entfernen" data-tour-aktion="entfernen" data-id="${esc(a.id)}" aria-label="Aus der Tour entfernen" title="Aus der Tour entfernen">×</button>
    </div>`;
  });
  html += '</div>';
  html += `<div class="knopfreihe" style="margin-top:12px">
      <button class="knopf" data-tour-aktion="umbenennen">Umbenennen</button>
      <button class="knopf" data-tour-aktion="aufloesen">Tour auflösen</button>
    </div>
    <p class="leise klein-text">„×“ nimmt eine Aktivität aus der Tour. Fehlt eine, öffne sie und tippe auf „Zu Tour hinzufügen“.</p>`;
  return html;
}

async function tourKarteNachZeichnen() {
  const flaeche = document.getElementById('tour-karte');
  if (!flaeche) return;
  vollbildAnwenden(flaeche, 'tour');
  const t = tourFinden(zustand.tourSchluessel);
  if (!t) return;
  try {
    await leafletLaden();
  } catch (e) {
    flaeche.innerHTML = `<p class="leer">${esc(e.message)}</p>`;
    return;
  }
  if (!document.body.contains(flaeche)) return;
  if (karteZustand.tourKarte) karteZustand.tourKarte.remove();
  const karte = L.map(flaeche, { scrollWheelZoom: false, maxZoom: 19 });
  karteZustand.tourKarte = karte;
  const spurProId = new Map(karteZustand.spuren.map(s => [s.id, s]));
  const alleGrenzen = L.latLngBounds([]);
  t.teile.forEach(tt => {
    const s = spurProId.get(tt.x.a.id);
    if (s && s.teile) s.teile.forEach(teil => alleGrenzen.extend(L.latLngBounds(teil)));
  });
  kartenEbenen(karte, inDerSchweiz(alleGrenzen) ? karteZustand.grundkarte : 'osm', 0.7);
  vollbildKnopf('tour').addTo(karte);
  if (fotosZustand.fotos) fotoEbene(karte, tourFotos(t));
  const grenzen = L.latLngBounds([]);
  const feineLinien = [];
  const ersterTag = t.teile[0].x.tag;
  t.teile.forEach(tt => {
    const s = spurProId.get(tt.x.a.id);
    if (!s || !s.teile || !s.teile.length) return;
    const farbe = TAG_FARBEN[(tt.x.tag - ersterTag) % TAG_FARBEN.length];
    const rand = L.polyline(s.teile, { color: '#fff', weight: 8, opacity: 0.95, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(karte);
    const linie = L.polyline(s.teile, { color: farbe, weight: 4.5, opacity: 1, lineCap: 'round', lineJoin: 'round', dashArray: tt.art === 'ausflug' ? '6 7' : null })
      .bindTooltip(tt.art === 'ausflug' ? 'Ausflug' : 'Etappe ' + tt.nr + ' · Tag ' + (tt.x.tag - ersterTag + 1))
      .on('click', () => detailOeffnen(tt.x.a.id))
      .addTo(karte);
    grenzen.extend(linie.getBounds());
    feineLinien.push({ id: tt.x.a.id, rand, linie });
    if (tt.art === 'etappe') {
      L.marker(s.teile[0][0], {
        icon: L.divIcon({ className: 'etappen-nr', html: `<span style="background:${farbe}">${tt.nr}</span>`, iconSize: [22, 22] }),
        interactive: false
      }).addTo(karte);
    }
  });
  const etappen = t.teile.filter(tt => tt.art === 'etappe');
  const letzte = etappen.length && spurProId.get(etappen[etappen.length - 1].x.a.id);
  if (letzte && letzte.teile && letzte.teile.length) {
    const lt = letzte.teile[letzte.teile.length - 1];
    L.circleMarker(lt[lt.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#c23b3b', fillOpacity: 1 }).bindTooltip('Ziel').addTo(karte);
  }
  if (grenzen.isValid()) karte.fitBounds(grenzen, { padding: [24, 24] });
  else karte.setView([46.8, 8.2], 8);
  // Feine Spuren nachladen, je drei gleichzeitig
  const warteschlange = feineLinien.slice();
  const arbeiter = async () => {
    while (warteschlange.length) {
      const x = warteschlange.shift();
      try {
        const spur = await feineSpurHolen(x.id);
        if (karteZustand.tourKarte !== karte) return;
        const teile = spur ? spurTeile(spur.fein) : [];
        if (teile.length) {
          x.rand.setLatLngs(teile);
          x.linie.setLatLngs(teile);
        }
      } catch (e) { /* grobe Spur bleibt */ }
    }
  };
  [arbeiter(), arbeiter(), arbeiter()];
}

/** Hinweis in der Detailansicht: Etappe einer Tour oder „Zu Tour hinzufügen“. */
function tourHinweisHtml(a) {
  if (TOUR_SPORTARTEN.indexOf(a.sportart) < 0) return '';
  const e = tourenErgebnis();
  if (!e) return '';
  const p = e.proAktivitaet.get(a.id);
  if (p) {
    return `<button type="button" class="hinweis-tour" data-tour-aktion="oeffnen" data-tour="${esc(p.tour.schluessel)}" style="--farbe: var(--${p.tour.sportart})">
      <span>${p.art === 'ausflug' ? 'Ausflug' : 'Etappe ' + p.nr + ' von ' + p.tour.etappen} der Tour</span>
      <b>${esc(p.tour.name)}</b>
      <small>${esc(zeitraumText(p.tour.von, p.tour.bis))} · ${km(p.tour.km)}</small>
    </button>`;
  }
  const nah = e.touren.filter(t => t.sportart === a.sportart &&
    a.datum >= tagePlus(t.von, -14) && a.datum <= tagePlus(t.bis, 15));
  if (!nah.length) return '';
  return `<div class="tour-hinzu">
    <select data-tour-auswahl aria-label="Tour wählen">${nah.map(t => `<option value="${esc(t.schluessel)}">${esc(t.name)} (${esc(zeitraumText(t.von, t.bis))})</option>`).join('')}</select>
    <button class="knopf klein" data-tour-aktion="hinzufuegen" data-id="${esc(a.id)}">Zu Tour hinzufügen</button>
  </div>`;
}

/** Popup der Karte: Zeile „Etappe 3/9 · Tourname“. */
function tourPopupZeile(id) {
  const e = tourenErgebnis();
  const p = e && e.proAktivitaet.get(id);
  if (!p) return '';
  return `<br><button type="button" class="knopf klein popup-tour" data-tour="${esc(p.tour.schluessel)}">${p.art === 'ausflug' ? 'Ausflug' : 'Etappe ' + p.nr + '/' + p.tour.etappen} · ${esc(p.tour.name)}</button>`;
}

/** Abschnitt „Touren“ in den Erfolgen. */
function tourenErfolgeHtml() {
  const e = tourenErgebnis();
  if (!e || !e.touren.length) return '';
  const laengste = e.touren.reduce((x, y) => (y.km > x.km ? y : x));
  const meisteTage = e.touren.reduce((x, y) => (y.tage > x.tage ? y : x));
  let html = `<h2>Touren</h2><p class="leise klein-text" style="margin-top:0">${e.touren.length} Mehrtagestouren mit zusammen ${km(e.touren.reduce((s, t) => s + t.km, 0))} und ${e.touren.reduce((s, t) => s + t.tage, 0)} Tagen unterwegs.</p>`;
  html += '<div class="liste">' + tourEintrag(laengste) + (meisteTage !== laengste ? tourEintrag(meisteTage) : '') + '</div>';
  return html;
}

document.addEventListener('click', ereignis => {
  const ziel = ereignis.target.closest('[data-tour-aktion]');
  if (!ziel) return;
  const t = tourFinden(zustand.tourSchluessel);
  switch (ziel.dataset.tourAktion) {
    case 'oeffnen':
      tourOeffnen(ziel.dataset.tour);
      break;
    case 'umbenennen': {
      if (!t) return;
      const neu = prompt('Name der Tour (leer = automatischer Name):', t.name === t.autoName ? '' : t.name);
      if (neu === null) return;
      tourKorrektur('name', t.schluessel, neu.trim(), neu.trim() ? 'Name gespeichert.' : 'Automatischer Name.');
      break;
    }
    case 'aufloesen':
      if (!t || !confirm('Tour „' + t.name + '“ auflösen? Die Aktivitäten bleiben, sie gehören dann nur zu keiner Tour mehr.')) return;
      tourKorrektur('aufgeloest', t.schluessel, '1', 'Tour aufgelöst.');
      break;
    case 'entfernen': {
      const id = ziel.dataset.id;
      const e = tourenErgebnis();
      const p = e && e.proAktivitaet.get(id);
      if (!p || !confirm('Diese Aktivität aus der Tour nehmen?')) return;
      if (p.manuell) tourKorrektur('zu', id, '', 'Aus der Tour genommen.');
      else tourKorrektur('ohne', id, '1', 'Aus der Tour genommen.');
      break;
    }
    case 'hinzufuegen': {
      const auswahl = document.querySelector('[data-tour-auswahl]');
      if (!auswahl) return;
      const id = ziel.dataset.id;
      const k = korrekturenAuswerten();
      const weiter = () => tourKorrektur('zu', id, auswahl.value, 'Zur Tour hinzugefügt.');
      if (k.ohne.has(id)) {
        // „ohne“ zuerst aufheben, dann hinzufügen
        tourKorrektur('ohne', id, '', 'Gespeichert.').then(weiter);
      } else {
        weiter();
      }
      break;
    }
  }
});

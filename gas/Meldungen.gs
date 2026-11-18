/**
 * Meldungen.gs – Texte für die Benachrichtigungen der Android-App
 * Version: 0.7.0 (2026-11-18)
 *
 * Aufruf über die Web-App: aktion=meldung&art=<art>
 *   test        feste Test-Meldung (Diagnose der ganzen Kette)
 *   erinnerung  Stand der laufenden Woche; null, wenn beide Ziele erreicht sind
 *   rueckblick  Wochenrückblick mit Serien und Vergleich zum Schnitt: Montag bis Donnerstag
 *               die vergangene Woche, Freitag bis Sonntag die laufende Woche
 *   erfolge     neue Bestzeiten, Bestmarken und Jahres-Abzeichen von Aktivitäten, die nach
 *               „seit“ (Millisekunden) importiert wurden; null, wenn nichts Neues
 * Antwort: {meldung: {titel, text}} oder {meldung: null}.
 *
 * Die Regeln entsprechen der App (docs/app.js): Woche Montag bis Sonntag, Serien mit
 * offener laufender Woche, Sportpunkte ab 2023, Grenzen für unrealistische Aktivitäten,
 * Bestzeiten ohne Laufband und nicht schneller als 2:30 /km. Bei Änderungen beide Stellen
 * gleich halten. Die Texte enthalten nur Zusammenfassungen, keine Rohdaten.
 */

const MELDUNG_GRENZEN = {
  laufen: { kmh: 22, km: 60 },
  wandern: { kmh: 8, km: 70 },
  rad: { kmh: 45, km: 400 },
  schwimmen: { kmh: 6, km: 15 }
};
const MELDUNG_SERIEN_STUFEN = [4, 12, 26, 52];
const MELDUNG_JAHRES_STUFEN = { laufen: [100, 250, 500, 1000], rad: [1000, 2500, 5000, 10000], wandern: [100, 250, 500, 1000] };
const MELDUNG_BESTZEITEN = [{ name: '1 km', km: 1, feld: 's1k' }, { name: '5 km', km: 5, feld: 's5k' }, { name: '10 km', km: 10, feld: 's10k' }];
const MELDUNG_SPORT_NAME = { laufen: 'Laufen', rad: 'Rad', wandern: 'Wandern', ski: 'Ski', schwimmen: 'Schwimmen', andere: 'Andere' };

function meldung_(p) {
  if (p.art === 'test') {
    return { titel: 'Sport-App', text: 'Test-Benachrichtigung: Die Verbindung zur Web-App funktioniert.' };
  }
  const liste = meldungAktivitaeten_();
  const einst = einstellungenLesen_();
  switch (p.art) {
    case 'erinnerung': return meldungErinnerung_(liste, einst, new Date());
    case 'rueckblick': return meldungRueckblick_(liste, einst, new Date());
    case 'erfolge': return meldungErfolge_(liste, Number(p.seit) || 0, new Date());
    default: throw new Error('unbekannte art: ' + p.art);
  }
}

// ---------------------------------------------------------------------------
// Daten
// ---------------------------------------------------------------------------

/** Aktivitäten als Objekte (aus der kompakten Liste) mit Datum, Plausibilität und Importzeit. */
function meldungAktivitaeten_() {
  const kompakt = aktivitaetenKompakt_();
  const importiert = {};
  const b = tabelle_().getSheetByName(BLATT_AKTIVITAETEN);
  if (b && b.getLastRow() >= 2) {
    const n = b.getLastRow() - 1;
    const ids = b.getRange(2, SPALTEN.indexOf('activityId') + 1, n, 1).getValues();
    const zeiten = b.getRange(2, SPALTEN.indexOf('importiert_am') + 1, n, 1).getValues();
    ids.forEach(function (z, i) {
      if (zeiten[i][0] instanceof Date) importiert[String(z[0])] = zeiten[i][0].getTime();
    });
  }
  return kompakt.zeilen.map(function (z) {
    const a = {};
    kompakt.spalten.forEach(function (name, i) { a[name] = z[i]; });
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(a.start));
    a.datum = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
    a.importiert = importiert[a.id] || 0;
    a.zaehlt = meldungPlausibel_(a);
    return a;
  }).filter(function (a) { return a.datum; });
}

function meldungPlausibel_(a) {
  const g = MELDUNG_GRENZEN[a.sportart];
  if (!g || !a.km) return true;
  if (a.km > g.km) return false;
  return !(a.min && a.km / (a.min / 60) > g.kmh);
}

function meldungMontag_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}

function meldungTagePlus_(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function meldungSchluessel_(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

/** Läufe und Sportpunkte pro Woche (Schlüssel = Montag). */
function meldungWochen_(liste) {
  const m = {};
  liste.forEach(function (a) {
    const k = meldungSchluessel_(meldungMontag_(a.datum));
    const w = m[k] || (m[k] = { laeufe: 0, pkt: 0 });
    if (a.sportart === 'laufen') w.laeufe++;
    if (typeof a.pkt === 'number') w.pkt += a.pkt;
  });
  return m;
}

function meldungWoche_(wochen, montag) {
  return wochen[meldungSchluessel_(montag)] || { laeufe: 0, pkt: 0 };
}

/** Serie wie in der App: Wochen in Folge, laufende Woche zählt mit, sobald erfüllt. */
function meldungSerie_(wochen, erfuellt, ab, heute) {
  const diese = meldungMontag_(heute);
  let lauf = 0;
  for (let w = meldungMontag_(ab); w < diese; w = meldungTagePlus_(w, 7)) {
    lauf = erfuellt(meldungWoche_(wochen, w)) ? lauf + 1 : 0;
  }
  const aktuellErreicht = erfuellt(meldungWoche_(wochen, diese));
  return { vorher: lauf, aktuell: lauf + (aktuellErreicht ? 1 : 0), aktuellErreicht: aktuellErreicht };
}

function meldungKw_(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const tag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - tag);
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
}

function meldungKm_(wert) {
  return (Math.floor(wert * 10 + 1e-6) / 10).toFixed(1).replace('.', ',') + ' km';
}

function meldungZeit_(s) {
  const g = Math.round(s);
  const h = Math.floor(g / 3600);
  const m = Math.floor((g % 3600) / 60);
  const sek = ('0' + (g % 60)).slice(-2);
  return h ? h + ':' + ('0' + m).slice(-2) + ':' + sek : m + ':' + sek;
}

// ---------------------------------------------------------------------------
// Meldungen
// ---------------------------------------------------------------------------

function meldungErinnerung_(liste, einst, heute) {
  const wochen = meldungWochen_(liste);
  const w = meldungWoche_(wochen, meldungMontag_(heute));
  const teile = [];
  let offen = false;
  if (einst.wochenzielLaeufe > 0) {
    teile.push('Läufe: ' + w.laeufe + ' von ' + einst.wochenzielLaeufe + (w.laeufe >= einst.wochenzielLaeufe ? ' ✓' : ''));
    if (w.laeufe < einst.wochenzielLaeufe) offen = true;
  }
  if (einst.wochenzielPunkte > 0) {
    teile.push('Sportpunkte: ' + w.pkt + ' von ' + einst.wochenzielPunkte + (w.pkt >= einst.wochenzielPunkte ? ' ✓' : ''));
    if (w.pkt < einst.wochenzielPunkte) offen = true;
  }
  if (!offen) return null;
  const rest = 7 - ((heute.getDay() + 6) % 7);
  return {
    titel: 'Diese Woche noch offen',
    text: teile.join(' · ') + '\n' + (rest === 1 ? 'Nur noch heute.' : 'Noch ' + rest + ' Tage (mit heute).')
  };
}

function meldungRueckblick_(liste, einst, jetzt) {
  const wochen = meldungWochen_(liste);
  // Mo–Do: vergangene Woche zusammenfassen, Fr–So: laufende Woche
  const wochentag = (jetzt.getDay() + 6) % 7;
  const montag = wochentag <= 3 ? meldungTagePlus_(meldungMontag_(jetzt), -7) : meldungMontag_(jetzt);
  const heute = wochentag <= 3 ? meldungTagePlus_(montag, 6) : jetzt;
  const w = meldungWoche_(wochen, montag);
  const zeilen = [];

  const serieText = function (name, s) {
    if (s.aktuellErreicht) {
      const stufe = MELDUNG_SERIEN_STUFEN.indexOf(s.aktuell) >= 0 ? ' – Abzeichen!' : '';
      return name + ': ' + s.aktuell + (s.aktuell === 1 ? ' Woche' : ' Wochen') + ' in Folge' + stufe;
    }
    return s.vorher ? name + ': Serie von ' + s.vorher + ' Wochen gerissen' : null;
  };

  if (einst.wochenzielLaeufe > 0) {
    zeilen.push('Läufe: ' + w.laeufe + ' von ' + einst.wochenzielLaeufe + (w.laeufe >= einst.wochenzielLaeufe ? ' ✓' : ''));
  }
  if (einst.wochenzielPunkte > 0) {
    zeilen.push('Sportpunkte: ' + w.pkt + ' von ' + einst.wochenzielPunkte + (w.pkt >= einst.wochenzielPunkte ? ' ✓' : ''));
  }
  if (einst.wochenzielLaeufe > 0 && liste.length) {
    const t = serieText('Laufziel', meldungSerie_(wochen, function (x) { return x.laeufe >= einst.wochenzielLaeufe; }, liste[0].datum, heute));
    if (t) zeilen.push(t);
  }
  if (einst.wochenzielPunkte > 0) {
    const t = serieText('Aktivziel', meldungSerie_(wochen, function (x) { return x.pkt >= einst.wochenzielPunkte; }, new Date(2023, 0, 2), heute));
    if (t) zeilen.push(t);
  }

  // Sportpunkte im Vergleich zum Schnitt der letzten 52 abgeschlossenen Wochen (ab 2023)
  const werte = [];
  for (let i = 1; i <= 52; i++) {
    const m = meldungTagePlus_(montag, -7 * i);
    if (m >= new Date(2023, 0, 2)) werte.push(meldungWoche_(wochen, m).pkt);
  }
  if (werte.length >= 4) {
    const schnitt = werte.reduce(function (s, x) { return s + x; }, 0) / werte.length;
    if (schnitt > 0) zeilen.push('Sportpunkte: ' + Math.round(w.pkt / schnitt * 100) + ' % deines Schnitts');
  }
  return { titel: 'Wochenrückblick KW ' + meldungKw_(montag), text: zeilen.join('\n') };
}

function meldungErfolge_(liste, seit, heute) {
  if (!seit) return null;
  const neu = function (a) { return a.importiert > seit; };
  const zaehlt = liste.filter(function (a) { return a.zaehlt; });
  const zeilen = [];

  // Bestzeiten Laufen (draußen)
  const draussen = zaehlt.filter(function (a) { return a.sportart === 'laufen' && a.typ !== 'treadmill_running'; });
  MELDUNG_BESTZEITEN.forEach(function (dist) {
    let best = null;
    let altBest = null;
    draussen.forEach(function (a) {
      const kandidaten = [];
      if (typeof a[dist.feld] === 'number' && a[dist.feld] > 0) kandidaten.push(a[dist.feld]);
      if (a.km >= dist.km && a.min) kandidaten.push(a.min * 60 / a.km * dist.km);
      kandidaten.forEach(function (zeit) {
        if (zeit / dist.km < 150) return;
        if (!best || zeit < best.zeit) best = { zeit: zeit, a: a };
        if (!neu(a) && (!altBest || zeit < altBest)) altBest = zeit;
      });
    });
    if (best && neu(best.a) && altBest && best.zeit < altBest) {
      zeilen.push('Neue Bestzeit ' + dist.name + ': ' + meldungZeit_(best.zeit) + ' (' + meldungZeit_(best.zeit / dist.km) + ' /km)');
    }
  });

  // Längste Aktivität je Sportart
  [['laufen', 'Längster Lauf'], ['rad', 'Längste Radtour'], ['wandern', 'Längste Wanderung']].forEach(function (x) {
    let best = null;
    let altBest = 0;
    zaehlt.forEach(function (a) {
      if (a.sportart !== x[0] || !a.km) return;
      if (!best || a.km > best.km) best = a;
      if (!neu(a) && a.km > altBest) altBest = a.km;
    });
    if (best && neu(best) && altBest && best.km > altBest) zeilen.push('Neue Bestmarke – ' + x[1] + ': ' + meldungKm_(best.km));
  });

  // Jahres-Abzeichen, die durch neue Aktivitäten erreicht wurden
  const jahr = heute.getFullYear();
  Object.keys(MELDUNG_JAHRES_STUFEN).forEach(function (sa) {
    let vorher = 0;
    let nachher = 0;
    zaehlt.forEach(function (a) {
      if (a.sportart !== sa || !a.km || a.datum.getFullYear() !== jahr) return;
      nachher += a.km;
      if (!neu(a)) vorher += a.km;
    });
    const stufen = MELDUNG_JAHRES_STUFEN[sa];
    const erreichtNeu = stufen.filter(function (s) { return nachher >= s && vorher < s; });
    if (erreichtNeu.length) {
      zeilen.push('Jahres-Abzeichen: ' + erreichtNeu[erreichtNeu.length - 1] + ' km ' + MELDUNG_SPORT_NAME[sa] + ' ' + jahr);
    }
  });

  if (!zeilen.length) return null;
  return { titel: zeilen.length === 1 ? 'Neuer Erfolg' : 'Neue Erfolge', text: zeilen.join('\n') };
}

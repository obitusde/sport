/**
 * Schritte.gs – Schritte pro Tag vom Handy (Android-App) und Alltagspunkte
 * Version: 0.9.0 (2026-11-18)
 *
 * Aktionen der Web-App:
 *   schritteSetzen  GET: daten = JSON {"2026-11-18": 5234, …}
 *                   POST (ab 0.9.0): {"daten": {…}, "abschnitte": [[von ms, bis ms, schritte], …]}
 *                   Tage werden überschrieben bzw. ergänzt (das Handy ist die Quelle).
 *   schritte        alle Tage: {tage: [[datum, schritte, alltag, alltagPunkte, unplausibel], …]}
 *
 * Blatt „Schritte“: datum (Text YYYY-MM-DD), schritte, aktualisiert, alltag.
 * Blatt „Schrittabschnitte“: von, bis (ms), schritte – nur die letzten 35 Tage.
 *
 * Alltagsschritte = Handy-Schritte des Tages minus Handy-Schritte während aufgezeichneter
 * Garmin-Aktivitäten (Start bis Start + Gesamtzeit; Abschnitte anteilig nach Überlappung,
 * abgezogen am Starttag der Aktivität). Die Uhr bringt für diese Zeit schon Sportpunkte.
 * Ohne Abschnitte (Tage vor 0.9.0) gilt alltag = schritte.
 *
 * Alltagspunkte (Einstellungen, Standardwerte nach Empfehlungen):
 *   max(0, Alltagsschritte − alltagFrei) / alltagProPunkt, abgerundet; nur wenn alltagPunkte = 1.
 *   Standard 3000 frei, 1 Punkt pro 200 Schritte: Bei 7000–8000 Schritten pro Tag ergibt das
 *   140–175 Punkte pro Woche, also etwa das Aktivziel von 150 (Studien setzen 7000–8000
 *   Schritte pro Tag mit 150 Minuten moderater Bewegung pro Woche gleich).
 * Tage über SCHRITTE_MAX gelten als unrealistisch: keine Alltagspunkte, nicht im Schnitt.
 * Gleiche Formel in docs/app.js (alltagPunkte) – bei Änderungen beide anpassen.
 */

const BLATT_SCHRITTE = 'Schritte';
const BLATT_SCHRITTABSCHNITTE = 'Schrittabschnitte';
const SCHRITTE_SPALTEN = ['datum', 'schritte', 'aktualisiert', 'alltag'];
const SCHRITTE_MAX = 50000;
const ABSCHNITTE_TAGE = 35;

function schritteBlatt_() {
  const ss = tabelle_();
  let b = ss.getSheetByName(BLATT_SCHRITTE);
  if (!b) {
    b = ss.insertSheet(BLATT_SCHRITTE);
    b.getRange('A:A').setNumberFormat('@'); // Datum als Text, damit Sheets nichts umwandelt
    b.getRange(1, 1, 1, SCHRITTE_SPALTEN.length).setValues([SCHRITTE_SPALTEN]).setFontWeight('bold');
    b.setFrozenRows(1);
  } else if (b.getRange(1, 4).getValue() !== 'alltag') {
    b.getRange(1, 4).setValue('alltag').setFontWeight('bold'); // Blatt aus 0.8.0 ergänzen
  }
  return b;
}

function abschnitteBlatt_() {
  const ss = tabelle_();
  let b = ss.getSheetByName(BLATT_SCHRITTABSCHNITTE);
  if (!b) {
    b = ss.insertSheet(BLATT_SCHRITTABSCHNITTE);
    b.getRange(1, 1, 1, 3).setValues([['von', 'bis', 'schritte']]).setFontWeight('bold');
    b.setFrozenRows(1);
  }
  return b;
}

/** p.daten (Text oder Objekt) und optional p.abschnitte (Array) speichern. */
function schritteSetzen_(p) {
  let daten = p.daten || {};
  if (typeof daten === 'string') {
    try {
      daten = JSON.parse(daten || '{}');
    } catch (e) {
      throw new Error('daten ist kein JSON');
    }
  }
  const neu = {};
  Object.keys(daten).forEach(function (k) {
    const n = Number(daten[k]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isInteger(n) && n >= 0 && n <= 150000) neu[k] = n;
  });
  const abschnitte = (Array.isArray(p.abschnitte) ? p.abschnitte : []).filter(function (a) {
    return Array.isArray(a) && a.length === 3 && a[0] > 0 && a[1] >= a[0] && a[2] >= 0 && a[2] <= 150000;
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const b = schritteBlatt_();
    const zeile = {};
    if (b.getLastRow() >= 2) {
      b.getRange(2, 1, b.getLastRow() - 1, 1).getValues().forEach(function (z, i) { zeile[String(z[0])] = i + 2; });
    }
    const jetzt = new Date();
    const anhaengen = [];
    Object.keys(neu).sort().forEach(function (k) {
      if (zeile[k]) b.getRange(zeile[k], 2, 1, 2).setValues([[neu[k], jetzt]]);
      else anhaengen.push([k, neu[k], jetzt, '']);
    });
    if (anhaengen.length) {
      b.getRange(b.getLastRow() + 1, 1, anhaengen.length, 4).setValues(anhaengen);
      b.getRange(2, 1, b.getLastRow() - 1, 4).sort({ column: 1, ascending: true });
    }
    if (abschnitte.length) abschnitteErsetzen_(abschnitte);
    alltagBerechnen_();
    return { gespeichert: Object.keys(neu).length, abschnitte: abschnitte.length };
  } finally {
    lock.releaseLock();
  }
}

/** Ersetzt alle gespeicherten Abschnitte ab dem frühesten neuen; entfernt Abschnitte älter als 35 Tage. */
function abschnitteErsetzen_(neu) {
  const b = abschnitteBlatt_();
  const ab = Math.min.apply(null, neu.map(function (a) { return a[0]; }));
  const grenze = Date.now() - ABSCHNITTE_TAGE * 86400000;
  const alt = b.getLastRow() >= 2 ? b.getRange(2, 1, b.getLastRow() - 1, 3).getValues() : [];
  const behalten = alt.filter(function (a) { return Number(a[0]) < ab && Number(a[1]) >= grenze; })
    .map(function (a) { return [Number(a[0]), Number(a[1]), Number(a[2])]; });
  const alle = behalten.concat(neu.map(function (a) { return [Number(a[0]), Number(a[1]), Number(a[2])]; }))
    .sort(function (x, y) { return x[0] - y[0]; });
  if (b.getLastRow() >= 2) b.getRange(2, 1, b.getLastRow() - 1, 3).clearContent();
  if (alle.length) b.getRange(2, 1, alle.length, 3).setValues(alle);
}

/**
 * Berechnet die Spalte „alltag“ für alle Tage mit Abschnitten neu. Aktivitäten werden
 * später importiert als die Schritte (nachts), darum läuft das auch beim Lesen.
 */
function alltagBerechnen_() {
  const b = schritteBlatt_();
  if (b.getLastRow() < 2) return;
  const ab = abschnitteBlatt_();
  const abschnitte = ab.getLastRow() >= 2 ? ab.getRange(2, 1, ab.getLastRow() - 1, 3).getValues() : [];
  if (!abschnitte.length) return;
  const erster = Math.min.apply(null, abschnitte.map(function (a) { return Number(a[0]); }));

  // Aktivitätsfenster seit dem ersten Abschnitt
  const fenster = [];
  const akt = tabelle_().getSheetByName(BLATT_AKTIVITAETEN);
  if (akt && akt.getLastRow() >= 2) {
    const iStart = SPALTEN.indexOf('start');
    const iGesamt = SPALTEN.indexOf('dauer_gesamt_min');
    akt.getRange(2, 1, akt.getLastRow() - 1, SPALTEN.length).getValues().forEach(function (z) {
      if (!(z[iStart] instanceof Date)) return;
      const von = z[iStart].getTime();
      const bis = von + (Number(z[iGesamt]) || 0) * 60000;
      if (bis >= erster && bis > von) fenster.push({ von: von, bis: bis, tag: schritteTag_(z[iStart]) });
    });
  }

  // Abzug pro Tag (Starttag der Aktivität)
  const abzug = {};
  const tageMitAbschnitten = {};
  abschnitte.forEach(function (a) {
    const von = Number(a[0]);
    const bis = Number(a[1]);
    const n = Number(a[2]);
    tageMitAbschnitten[schritteTag_(new Date(von))] = true;
    tageMitAbschnitten[schritteTag_(new Date(bis))] = true;
    if (!n || bis <= von) return;
    fenster.forEach(function (f) {
      const ueberlappung = Math.min(bis, f.bis) - Math.max(von, f.von);
      if (ueberlappung > 0) abzug[f.tag] = (abzug[f.tag] || 0) + n * ueberlappung / (bis - von);
    });
  });

  const werte = b.getRange(2, 1, b.getLastRow() - 1, 4).getValues();
  let geaendert = false;
  werte.forEach(function (z) {
    const tag = String(z[0]);
    if (!tageMitAbschnitten[tag] && z[3] !== '') return; // ältere Tage bleiben, wie sie sind
    const alltag = Math.max(0, Math.round(Number(z[1]) - (abzug[tag] || 0)));
    if (z[3] !== alltag) {
      z[3] = alltag;
      geaendert = true;
    }
  });
  if (geaendert) b.getRange(2, 1, werte.length, 4).setValues(werte);
}

function schritteTag_(d) {
  return Utilities.formatDate(d, ZEITZONE, 'yyyy-MM-dd');
}

/** Alltagspunkte eines Tages nach den Einstellungen. */
function alltagPunkte_(alltag, schritte, einst) {
  if (!einst.alltagPunkte || schritte > SCHRITTE_MAX || !einst.alltagProPunkt) return 0;
  return Math.floor(Math.max(0, alltag - einst.alltagFrei) / einst.alltagProPunkt);
}

function schritteLesen_() {
  const b = tabelle_().getSheetByName(BLATT_SCHRITTE);
  if (!b || b.getLastRow() < 2) return { tage: [] };
  try {
    alltagBerechnen_();
  } catch (e) {
    log_('Alltag konnte nicht berechnet werden: ' + e.message);
  }
  const einst = einstellungenLesen_();
  const breite = Math.min(4, b.getLastColumn());
  return {
    tage: b.getRange(2, 1, b.getLastRow() - 1, breite).getValues()
      .filter(function (z) { return /^\d{4}-\d{2}-\d{2}$/.test(String(z[0])); })
      .map(function (z) {
        const schritte = Number(z[1]) || 0;
        const alltag = z[3] === '' || z[3] === undefined ? schritte : Number(z[3]);
        return [String(z[0]), schritte, alltag, alltagPunkte_(alltag, schritte, einst), schritte > SCHRITTE_MAX];
      })
  };
}

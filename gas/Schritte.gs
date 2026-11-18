/**
 * Schritte.gs – Schritte pro Tag vom Handy (Android-App) im Blatt „Schritte“
 * Version: 0.8.0 (2026-11-18)
 *
 * Aktionen der Web-App:
 *   schritteSetzen  daten = JSON {"2026-11-18": 5234, …}; überschreibt bzw. ergänzt Tage
 *                   (das Handy ist die Quelle, es schickt jeweils die letzten 14 Tage)
 *   schritte        alle Tage: {tage: [["2026-11-18", 5234], …]} aufsteigend
 * Spalten: datum (Text YYYY-MM-DD), schritte, aktualisiert.
 * Schritte der Garmin-Uhr werden nicht dazugezählt (keine Doppelzählung).
 */

const BLATT_SCHRITTE = 'Schritte';

function schritteBlatt_() {
  const ss = tabelle_();
  let b = ss.getSheetByName(BLATT_SCHRITTE);
  if (!b) {
    b = ss.insertSheet(BLATT_SCHRITTE);
    b.getRange(1, 1, 1, 3).setValues([['datum', 'schritte', 'aktualisiert']]).setFontWeight('bold');
    b.setFrozenRows(1);
    b.getRange('A:A').setNumberFormat('@'); // Datum als Text, damit Sheets nichts umwandelt
  }
  return b;
}

function schritteSetzen_(p) {
  let daten;
  try {
    daten = JSON.parse(p.daten || '{}');
  } catch (e) {
    throw new Error('daten ist kein JSON');
  }
  const neu = {};
  Object.keys(daten).forEach(function (k) {
    const n = Number(daten[k]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isInteger(n) && n >= 0 && n <= 150000) neu[k] = n;
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
      else anhaengen.push([k, neu[k], jetzt]);
    });
    if (anhaengen.length) {
      b.getRange(b.getLastRow() + 1, 1, anhaengen.length, 3).setValues(anhaengen);
      b.getRange(2, 1, b.getLastRow() - 1, 3).sort({ column: 1, ascending: true });
    }
    return { gespeichert: Object.keys(neu).length };
  } finally {
    lock.releaseLock();
  }
}

function schritteLesen_() {
  const b = tabelle_().getSheetByName(BLATT_SCHRITTE);
  if (!b || b.getLastRow() < 2) return { tage: [] };
  return {
    tage: b.getRange(2, 1, b.getLastRow() - 1, 2).getValues()
      .filter(function (z) { return /^\d{4}-\d{2}-\d{2}$/.test(String(z[0])); })
      .map(function (z) { return [String(z[0]), Number(z[1]) || 0]; })
  };
}

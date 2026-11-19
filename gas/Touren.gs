/**
 * Touren.gs – Korrekturen an den automatisch erkannten Mehrtagestouren
 * Version: 0.15.0 (2026-11-19)
 *
 * Die Touren selbst erkennt die App (docs/touren.js) aus Datum, Sportart und Start- und
 * Endpunkt der Spuren. Hier liegen nur die Korrekturen von Christof, damit sie auf allen
 * Geräten gleich sind. Blatt „Touren“: art, schluessel, wert, geaendert.
 *
 *   art          schluessel                     wert
 *   name         Tour (activityId der 1. Etappe)  Name der Tour
 *   aufgeloest   Tour                           „keine Tour“: „1“ oder (ab 0.15.0) die
 *                                               activityIds aller Etappen, mit Komma
 *   ohne         activityId                     „1“ = Aktivität gehört nie zu einer Tour
 *   zu           activityId                     Tour, zu der die Aktivität von Hand gehört
 *   von          Tour                           Startort (statt des automatischen)       ab 0.15.0
 *   nach         Tour                           Zielort (statt des automatischen)        ab 0.15.0
 *   neu          activityId                     „1“ = von Hand angelegte Tour, beginnt   ab 0.15.0
 *                                               mit dieser Aktivität
 *   routenname   Route (activityId der ersten   Name einer gleichen Route (routen.js)    ab 0.15.0
 *                Fahrt)
 *
 * Aktionen der Web-App: touren (alle Korrekturen), tourSetzen (art, schluessel, wert;
 * leerer wert löscht die Korrektur).
 */

const BLATT_TOUREN = 'Touren';
const TOUREN_SPALTEN = ['art', 'schluessel', 'wert', 'geaendert'];
const TOUREN_ARTEN = ['name', 'aufgeloest', 'ohne', 'zu', 'von', 'nach', 'neu', 'routenname'];

function tourenBlatt_() {
  const ss = tabelle_();
  let b = ss.getSheetByName(BLATT_TOUREN);
  if (!b) {
    b = ss.insertSheet(BLATT_TOUREN);
    b.getRange(1, 1, 1, TOUREN_SPALTEN.length).setValues([TOUREN_SPALTEN]).setFontWeight('bold');
    b.setFrozenRows(1);
  }
  return b;
}

/** Alle Korrekturen: {korrekturen: [[art, schluessel, wert], …]} */
function tourenLesen_() {
  const b = tabelle_().getSheetByName(BLATT_TOUREN);
  if (!b || b.getLastRow() < 2) return { korrekturen: [] };
  return {
    korrekturen: b.getRange(2, 1, b.getLastRow() - 1, 3).getValues()
      .filter(function (z) { return z[0] && z[1] !== '' && z[2] !== ''; })
      .map(function (z) { return [String(z[0]), String(z[1]), String(z[2])]; })
  };
}

/** Setzt oder löscht eine Korrektur und liefert danach alle. */
function tourSetzen_(p) {
  const art = String(p.art || '');
  const schluessel = String(p.schluessel || '');
  const wert = String(p.wert === undefined || p.wert === null ? '' : p.wert).trim();
  if (TOUREN_ARTEN.indexOf(art) < 0) throw new Error('unbekannte Korrektur: ' + art);
  if (!/^\d+$/.test(schluessel)) throw new Error('ungültiger Schlüssel');
  if (art === 'aufgeloest') {
    if (wert && !/^\d+(,\d+)*$/.test(wert)) throw new Error('ungültige Liste');
    if (wert.length > 2000) throw new Error('Liste zu lang');
  } else if (wert.length > 100) {
    throw new Error('Text zu lang (höchstens 100 Zeichen)');
  }
  if (art === 'zu' && wert && !/^\d+$/.test(wert)) throw new Error('ungültige Tour');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Gerade beschäftigt. Bitte gleich nochmal versuchen.');
  try {
    const b = tourenBlatt_();
    let zeile = 0;
    if (b.getLastRow() >= 2) {
      b.getRange(2, 1, b.getLastRow() - 1, 2).getValues().forEach(function (z, n) {
        if (String(z[0]) === art && String(z[1]) === schluessel) zeile = n + 2;
      });
    }
    if (!wert) {
      if (zeile) b.deleteRow(zeile);
    } else {
      if (!zeile) {
        zeile = b.getLastRow() + 1;
        b.getRange(zeile, 1, 1, 2).setValues([[art, schluessel]]);
        b.getRange(zeile, 2).setNumberFormat('0');
      }
      // Wert als reiner Text, sonst macht Sheets aus „123,456“ eine Zahl
      b.getRange(zeile, 3).setNumberFormat('@');
      b.getRange(zeile, 3, 1, 2).setValues([[wert, new Date()]]);
    }
  } finally {
    lock.releaseLock();
  }
  return tourenLesen_();
}

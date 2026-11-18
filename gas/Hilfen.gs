/**
 * Hilfen.gs – allgemeine Hilfsfunktionen
 * Version: 0.11.0 (2026-11-18)
 *
 * Änderungen 0.11.0: log_ kann Zeilen zusätzlich sammeln (protokollMitschneiden_), damit die
 * Wartung in der App das Protokoll einer Diagnose anzeigen kann.
 */

const ZEITZONE = 'Europe/Zurich';

/** Baut den Query-String aus einem Objekt. */
function query_(params) {
  if (!params) return '';
  const teile = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  });
  return teile.length ? '?' + teile.join('&') : '';
}

/** Kopfzeilen einer Antwort mit kleingeschriebenen Namen. */
function kopfzeilen_(antwort) {
  const roh = antwort.getAllHeaders();
  const k = {};
  Object.keys(roh).forEach(function (n) { k[n.toLowerCase()] = String(roh[n]); });
  return k;
}

/** Typ eines Werts für Diagnose-Logs, z. B. „number“ oder „array[4]“. */
function typ_(wert) {
  if (wert === null) return 'null';
  if (Array.isArray(wert)) return 'array[' + wert.length + ']';
  return typeof wert;
}

/** Datum als YYYY-MM-DD in Europe/Zurich. */
function datum_(d) {
  return Utilities.formatDate(d, ZEITZONE, 'yyyy-MM-dd');
}

/** Rundet auf die gegebene Anzahl Stellen; Nicht-Zahlen bleiben unverändert. */
function runden_(zahl, stellen) {
  if (typeof zahl !== 'number' || isNaN(zahl)) return zahl;
  const f = Math.pow(10, stellen);
  return Math.round(zahl * f) / f;
}

/** Gesammelte Protokollzeilen, solange protokollMitschneiden_ läuft (sonst null). */
let PROTOKOLL_PUFFER = null;

function log_(text) {
  console.log(text);
  if (PROTOKOLL_PUFFER) PROTOKOLL_PUFFER.push(String(text));
}

/** Führt fn aus und liefert alle dabei geloggten Zeilen (Fehler als letzte Zeile). */
function protokollMitschneiden_(fn) {
  PROTOKOLL_PUFFER = [];
  try {
    fn();
  } catch (e) {
    PROTOKOLL_PUFFER.push('FEHLER: ' + e.message);
  }
  const zeilen = PROTOKOLL_PUFFER;
  PROTOKOLL_PUFFER = null;
  return zeilen;
}

/** Loggt lange Texte in Stücken, damit das Protokoll nichts abschneidet. */
function logLang_(text) {
  for (let i = 0; i < text.length; i += 4000) {
    console.log(text.substring(i, i + 4000));
  }
}

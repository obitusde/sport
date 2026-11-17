/**
 * WebApp.gs – v0.3: Schnittstelle für die App (JSON)
 * Version: 0.3.1 (2026-11-17)
 *
 * Aufruf: GET <webapp-url>?token=<WEBAPP_TOKEN>&aktion=<aktion>&...
 *
 * | aktion            | Liefert                                                        |
 * |-------------------|----------------------------------------------------------------|
 * | aktivitaeten      | alle Aktivitäten kompakt: {spalten:[…], zeilen:[[…], …]}       |
 * | einstellungen     | Einstellungen aus dem Blatt „Konfiguration“                     |
 * | einstellungSetzen | ändert eine Einstellung (schluessel, wert), liefert alle neu    |
 * | status            | letzter Import, letzter Fehler, Anzahl Aktivitäten             |
 * | sammeln           | holt neue Aktivitäten von Garmin ins Sheet: {neu, proSportart} |
 *
 * Jede Antwort ist JSON: {ok: true, version, …} oder {ok: false, fehler}.
 * Ohne gültiges Token liefert die Web-App keine Daten.
 *
 * Voraussetzung: Script Properties WEBAPP_TOKEN und SHEET_ID (legt sammeln() an).
 * Diagnose: webAppTesten() im Script-Editor ausführen, loggt nur Größen und Zählungen.
 *
 * Änderungen 0.3.1: Aktion „sammeln“ für den Knopf „Von Garmin holen“ (ohne Fehler-Mail,
 * der Fehler geht direkt an die App).
 */

const WEBAPP_VERSION = '0.3.1';
const BLATT_KONFIGURATION = 'Konfiguration';

/**
 * Einstellungen mit Standardwert und Prüfung. Neue Einstellungen nur hier ergänzen.
 * Die App darf nur diese Schlüssel ändern.
 */
const EINSTELLUNGEN = {
  wochenzielLaeufe: {
    standard: 2,
    beschreibung: 'Läufe pro Woche (Montag bis Sonntag)',
    pruefen: function (w) {
      const n = Number(w);
      if (!Number.isInteger(n) || n < 0 || n > 14) throw new Error('wochenzielLaeufe muss eine ganze Zahl von 0 bis 14 sein.');
      return n;
    }
  }
};

/** Spalten der kompakten Aktivitätsliste für die App. */
const APP_SPALTEN = ['id', 'start', 'sportart', 'typ', 'name', 'km', 'min', 'minGesamt', 'hm', 'puls', 'gps'];

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------

function doGet(e) {
  const p = (e && e.parameter) || {};
  let antwort;
  try {
    if (!tokenGueltig_(p.token)) {
      antwort = { ok: false, fehler: 'nicht berechtigt' };
    } else {
      antwort = aktionAusfuehren_(p);
    }
  } catch (fehler) {
    antwort = { ok: false, fehler: fehler.message };
  }
  return ContentService.createTextOutput(JSON.stringify(antwort)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Diagnose: ruft alle lesenden Aktionen mit dem gespeicherten Token auf und loggt
 * nur Größen und Zählungen. Prüft außerdem, dass ein falsches Token abgewiesen wird.
 */
function webAppTesten() {
  log_('===== Web-App ' + WEBAPP_VERSION + ' Test =====');
  const token = PropertiesService.getScriptProperties().getProperty('WEBAPP_TOKEN');
  if (!token) {
    log_('FEHLER: Script Property WEBAPP_TOKEN fehlt.');
    return;
  }
  log_('WEBAPP_TOKEN vorhanden, Länge ' + token.length + ' Zeichen' +
    (token.length < 20 ? ' (WARNUNG: kürzer als 20 Zeichen)' : '') + '.');

  const falsch = JSON.parse(doGet({ parameter: { token: 'falsch', aktion: 'status' } }).getContent());
  log_('Falsches Token: ok=' + falsch.ok + ', fehler=' + falsch.fehler);

  ['status', 'einstellungen', 'aktivitaeten'].forEach(function (aktion) {
    const t0 = Date.now();
    const text = doGet({ parameter: { token: token, aktion: aktion } }).getContent();
    const daten = JSON.parse(text);
    let info = 'ok=' + daten.ok + ', ' + runden_(text.length / 1024, 1) + ' KB, ' + (Date.now() - t0) + ' ms';
    if (!daten.ok) info += ', fehler=' + daten.fehler;
    if (aktion === 'aktivitaeten' && daten.ok) info += ', Zeilen: ' + daten.zeilen.length + ', Spalten: ' + daten.spalten.join(',');
    if (aktion === 'einstellungen' && daten.ok) info += ', Schlüssel: ' + Object.keys(daten.einstellungen).join(',');
    log_(aktion + ': ' + info);
  });
  log_('Web-App-URL der aktuellen Bereitstellung: ' + (ScriptApp.getService().getUrl() || 'noch nicht bereitgestellt'));
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

function aktionAusfuehren_(p) {
  const basis = { ok: true, version: WEBAPP_VERSION };
  switch (p.aktion) {
    case 'aktivitaeten':
      return Object.assign(basis, aktivitaetenKompakt_());
    case 'einstellungen':
      return Object.assign(basis, { einstellungen: einstellungenLesen_() });
    case 'einstellungSetzen':
      einstellungSchreiben_(p.schluessel, p.wert);
      return Object.assign(basis, { einstellungen: einstellungenLesen_() });
    case 'status':
      return Object.assign(basis, statusDaten_());
    case 'sammeln': {
      const e = sammelnIntern_(false, { mail: false });
      if (e.fehler) throw new Error(e.fehler);
      return Object.assign(basis, { neu: e.neu, proSportart: e.proSportart });
    }
    default:
      throw new Error('unbekannte aktion: ' + p.aktion);
  }
}

/** Alle Aktivitäten aus dem Sheet, kompakt für die App. */
function aktivitaetenKompakt_() {
  const b = tabelle_().getSheetByName(BLATT_AKTIVITAETEN);
  if (!b || b.getLastRow() < 2) return { spalten: APP_SPALTEN, zeilen: [] };
  const werte = b.getRange(2, 1, b.getLastRow() - 1, SPALTEN.length).getValues();
  const i = {};
  SPALTEN.forEach(function (name, n) { i[name] = n; });
  const zahl = function (w) { return (w === '' || w === null) ? null : Number(w); };

  const zeilen = werte.map(function (z) {
    const start = z[i.start] instanceof Date
      ? Utilities.formatDate(z[i.start], ZEITZONE, "yyyy-MM-dd'T'HH:mm")
      : String(z[i.start]);
    return [
      String(z[i.activityId]),
      start,
      z[i.sportart],
      z[i.garminTyp],
      z[i.name],
      zahl(z[i.distanz_km]),
      zahl(z[i.dauer_min]),
      zahl(z[i.dauer_gesamt_min]),
      zahl(z[i.hoehenmeter]),
      zahl(z[i.puls_avg]),
      z[i.hat_gps] === true
    ];
  });
  return { spalten: APP_SPALTEN, zeilen: zeilen };
}

function statusDaten_() {
  const props = PropertiesService.getScriptProperties();
  const b = tabelle_().getSheetByName(BLATT_AKTIVITAETEN);
  return {
    letzterImport: props.getProperty('LETZTER_IMPORT') || null,
    letzterImportNeu: Number(props.getProperty('LETZTER_IMPORT_NEU') || 0),
    letzterFehler: props.getProperty('LETZTER_FEHLER') || null,
    anzahlAktivitaeten: b ? Math.max(b.getLastRow() - 1, 0) : 0
  };
}

// ---------------------------------------------------------------------------
// Einstellungen im Blatt „Konfiguration“ (Spalten: schluessel, wert, beschreibung)
// ---------------------------------------------------------------------------

/** Liest alle Einstellungen; fehlende werden mit Standardwert angelegt. */
function einstellungenLesen_() {
  const b = konfigurationsBlatt_();
  const vorhanden = {};
  if (b.getLastRow() >= 2) {
    b.getRange(2, 1, b.getLastRow() - 1, 2).getValues().forEach(function (z) {
      if (z[0] !== '') vorhanden[String(z[0])] = z[1];
    });
  }
  const ergebnis = {};
  Object.keys(EINSTELLUNGEN).forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(vorhanden, k)) {
      try {
        ergebnis[k] = EINSTELLUNGEN[k].pruefen(vorhanden[k]);
      } catch (e) {
        ergebnis[k] = EINSTELLUNGEN[k].standard;
      }
    } else {
      b.appendRow([k, EINSTELLUNGEN[k].standard, EINSTELLUNGEN[k].beschreibung]);
      ergebnis[k] = EINSTELLUNGEN[k].standard;
    }
  });
  return ergebnis;
}

/** Ändert eine Einstellung nach Prüfung. */
function einstellungSchreiben_(schluessel, wert) {
  const def = EINSTELLUNGEN[schluessel];
  if (!def) throw new Error('unbekannte Einstellung: ' + schluessel);
  const geprueft = def.pruefen(wert);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    einstellungenLesen_(); // stellt sicher, dass die Zeile existiert
    const b = konfigurationsBlatt_();
    const schluesselSpalte = b.getRange(2, 1, b.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < schluesselSpalte.length; i++) {
      if (String(schluesselSpalte[i][0]) === schluessel) {
        b.getRange(i + 2, 2).setValue(geprueft);
        return;
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function konfigurationsBlatt_() {
  const ss = tabelle_();
  let b = ss.getSheetByName(BLATT_KONFIGURATION);
  if (!b) {
    b = ss.insertSheet(BLATT_KONFIGURATION);
    b.getRange(1, 1, 1, 3).setValues([['schluessel', 'wert', 'beschreibung']]).setFontWeight('bold');
    b.setFrozenRows(1);
  }
  return b;
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

/** Das Sheet „Sport-Daten“; muss von sammeln() angelegt worden sein. */
function tabelle_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Sheet fehlt: zuerst sammeln() ausführen.');
  return SpreadsheetApp.openById(id);
}

/** Vergleicht das Token ohne frühen Abbruch. */
function tokenGueltig_(token) {
  const soll = PropertiesService.getScriptProperties().getProperty('WEBAPP_TOKEN');
  if (!soll || typeof token !== 'string' || token.length !== soll.length) return false;
  let unterschied = 0;
  for (let i = 0; i < soll.length; i++) unterschied |= soll.charCodeAt(i) ^ token.charCodeAt(i);
  return unterschied === 0;
}

/**
 * WebApp.gs – Schnittstelle für die App (JSON)
 * Version: 0.11.0 (2026-11-18)
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
 * | details           | Zusatzwerte einer Aktivität (id): {id, details: {…}}            |
 * | meldung           | Text einer Benachrichtigung (art, seit), siehe Meldungen.gs      |
 * | schritteSetzen    | Schritte pro Tag vom Handy speichern (daten), siehe Schritte.gs  |
 * | schritte          | alle Tage: {tage: [[datum, schritte, alltag, punkte, unplausibel]]} |
 * | spuren            | alle groben Spuren für die Karte: {spuren: [[id, sportart, datum, polyline]], offen} |
 * | spur              | feine Spur einer Aktivität (id): {fein, entferntKm}             |
 * | abgleich          | Zeitraum mit Garmin vergleichen (von, bis, uebernehmen=1), siehe Abgleich.gs |
 * | wartung           | Diagnose oder Einrichtung starten (art), liefert das Protokoll  |
 *
 * Jede Antwort ist JSON: {ok: true, version, …} oder {ok: false, fehler}.
 * Ohne gültiges Token liefert die Web-App keine Daten.
 *
 * Voraussetzung: Script Properties WEBAPP_TOKEN und SHEET_ID (legt sammeln() an).
 * Diagnose: webAppTesten() im Script-Editor ausführen, loggt nur Größen und Zählungen.
 *
 * Änderungen 0.3.1: Aktion „sammeln“ für den Knopf „Von Garmin holen“ (ohne Fehler-Mail,
 * der Fehler geht direkt an die App).
 * Änderungen 0.4.0: Aktion „details“ für die Detailansicht der App.
 * Änderungen 0.5.0: Die kompakte Liste enthält Sportpunkte (pkt, pktGeschaetzt) und die
 *   schnellsten Abschnitte (s1k, s5k, s10k, s21k). Neue Einstellung wochenzielPunkte.
 *
 * Sportpunkte (siehe PROJEKT.md): Garmins Intensitätsminuten, moderat ×1, intensiv ×2.
 * - Nur für Aktivitäten ab PUNKTE_AB_JAHR (2023), davor null.
 * - Fehlen die Intensitätsminuten (z. B. ohne Puls), wird geschätzt:
 *   Bewegungsminuten × persönlicher Faktor der Sportart. Der Faktor ist
 *   Summe Punkte / Summe Minuten aller Aktivitäten dieser Sportart mit echten Werten
 *   ab 2023 (ohne Werte für die Sportart: Faktor über alle Sportarten).
 * Änderungen 0.7.0: Aktion „meldung“ für die Benachrichtigungen der Android-App.
 *   Unrealistische Aktivitäten (meldungPlausibel_ in Meldungen.gs) bekommen keine
 *   geschätzten Sportpunkte mehr, nur echte Intensitätsminuten.
 * Änderungen 0.8.0: Aktionen „schritteSetzen“ und „schritte“ (Schrittzähler der Android-App).
 * Änderungen 0.9.0: POST (doPost) mit JSON-Rumpf für größere Daten (Schrittabschnitte);
 *   Einstellungen alltagPunkte, alltagFrei, alltagProPunkt; Aktionen „spuren“ und „spur“;
 *   „sammeln“ lädt auch die Spuren neuer Aktivitäten (höchstens 20 Sekunden).
 * Änderungen 0.10.0: Aktion „abgleich“ (Abgleich.gs); „spur“ liefert entferntKm (Kilometer,
 *   die der Spur-Filter als Zugfahrt oder GPS-Sprung entfernt hat).
 * Änderungen 0.11.0: Liste enthält hmAb (Höhenmeter abwärts) und ort (Garmins Ortsname) aus
 *   der Spalte „details“. Aktion „wartung“: startet eine feste Auswahl von Diagnosen und
 *   Einrichtungen (WARTUNG) und liefert deren Protokoll, damit dafür kein PC nötig ist.
 */

const WEBAPP_VERSION = '0.11.0';

/**
 * Wartung aus der App: nur diese Funktionen sind erlaubt. Alle loggen nur Zählungen.
 */
const WARTUNG = {
  spurenStand: { text: 'Stand der Spuren', fn: function () { spurenStand(); } },
  spurFilter: { text: 'Spur-Filter prüfen (10 offene Spuren)', fn: function () { diagnoseSpurFilter(10); } },
  spurenNeu: { text: 'Spuren nachladen (Zeitgeber)', fn: function () { spurenZeitgeberEinrichten(); spurenStand(); } },
  abgleich: { text: 'Abgleich-Diagnose (30 Tage)', fn: function () { diagnoseAbgleich(); } },
  status: { text: 'Status des Sammlers', fn: function () { statusZeigen(); } }
};
const PUNKTE_AB_JAHR = 2023;
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
  },
  wochenzielPunkte: {
    standard: 150,
    beschreibung: 'Punkte pro Woche (Sportpunkte + Alltagspunkte)',
    pruefen: function (w) {
      const n = Number(w);
      if (!Number.isInteger(n) || n < 0 || n > 3000) throw new Error('wochenzielPunkte muss eine ganze Zahl von 0 bis 3000 sein.');
      return n;
    }
  },
  alltagPunkte: {
    standard: 1,
    beschreibung: 'Alltagspunkte aus Handy-Schritten zählen (1 = ja, 0 = nein)',
    pruefen: function (w) {
      const n = Number(w);
      if (n !== 0 && n !== 1) throw new Error('alltagPunkte muss 0 oder 1 sein.');
      return n;
    }
  },
  alltagFrei: {
    standard: 3000,
    beschreibung: 'Schritte pro Tag ohne Punkte (Grundbewegung)',
    pruefen: function (w) {
      const n = Number(w);
      if (!Number.isInteger(n) || n < 0 || n > 20000) throw new Error('alltagFrei muss eine ganze Zahl von 0 bis 20000 sein.');
      return n;
    }
  },
  alltagProPunkt: {
    standard: 200,
    beschreibung: 'Schritte pro Alltagspunkt',
    pruefen: function (w) {
      const n = Number(w);
      if (!Number.isInteger(n) || n < 20 || n > 2000) throw new Error('alltagProPunkt muss eine ganze Zahl von 20 bis 2000 sein.');
      return n;
    }
  }
};

/** Spalten der kompakten Aktivitätsliste für die App. */
const APP_SPALTEN = ['id', 'start', 'sportart', 'typ', 'name', 'km', 'min', 'minGesamt', 'hm', 'puls', 'gps',
  'pkt', 'pktGeschaetzt', 's1k', 's5k', 's10k', 's21k', 'hmAb', 'ort'];

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------

function doGet(e) {
  return antwort_((e && e.parameter) || {});
}

/** POST: Token und Aktion in der URL, weitere Daten als JSON im Rumpf. */
function doPost(e) {
  const p = Object.assign({}, (e && e.parameter) || {});
  try {
    const rumpf = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    Object.keys(rumpf).forEach(function (k) {
      if (k !== 'token' && k !== 'aktion') p[k] = rumpf[k];
    });
  } catch (fehler) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, fehler: 'Rumpf ist kein JSON' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return antwort_(p);
}

function antwort_(p) {
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
    if (aktion === 'aktivitaeten' && daten.ok) {
      info += ', Zeilen: ' + daten.zeilen.length + ', Spalten: ' + daten.spalten.join(',');
      const iPkt = daten.spalten.indexOf('pkt');
      const iGes = daten.spalten.indexOf('pktGeschaetzt');
      const mitPkt = daten.zeilen.filter(function (z) { return z[iPkt] !== null; });
      info += ', mit Sportpunkten: ' + mitPkt.length + ' (davon geschätzt: ' +
        mitPkt.filter(function (z) { return z[iGes]; }).length + ')';
      info += ', Faktoren Punkte/min: ' + JSON.stringify(daten.punkteFaktoren);
    }
    if (aktion === 'einstellungen' && daten.ok) info += ', Schlüssel: ' + Object.keys(daten.einstellungen).join(',');
    log_(aktion + ': ' + info);
    if (aktion === 'aktivitaeten' && daten.ok && daten.zeilen.length) {
      const id = daten.zeilen[daten.zeilen.length - 1][0];
      const det = JSON.parse(doGet({ parameter: { token: token, aktion: 'details', id: id } }).getContent());
      log_('details (neueste Aktivität): ok=' + det.ok + (det.ok ? ', Felder: ' + Object.keys(det.details).join(',') : ', fehler=' + det.fehler));
    }
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
    case 'schritteSetzen':
      return Object.assign(basis, schritteSetzen_(p));
    case 'schritte':
      return Object.assign(basis, schritteLesen_());
    case 'spuren':
      return Object.assign(basis, spurenFuerKarte_());
    case 'spur':
      return Object.assign(basis, { id: String(p.id) }, spurFein_(p.id));
    case 'meldung':
      return Object.assign(basis, { meldung: meldung_(p) });
    case 'details':
      return Object.assign(basis, { id: String(p.id), details: detailsLesen_(p.id) });
    case 'abgleich':
      return Object.assign(basis, abgleich_(p.von, p.bis, String(p.uebernehmen) === '1'));
    case 'wartung': {
      const w = WARTUNG[p.art];
      if (!w) throw new Error('unbekannte Wartung: ' + p.art);
      return Object.assign(basis, { art: p.art, titel: w.text, protokoll: protokollMitschneiden_(w.fn) });
    }
    case 'sammeln': {
      const e = sammelnIntern_(false, { mail: false, spurenSekunden: 20 });
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
  const json = function (text) {
    try {
      return text ? JSON.parse(text) : {};
    } catch (e) {
      return {};
    }
  };
  const details = werte.map(function (z) { return json(z[i.details]); });
  const jahr = function (z) {
    return z[i.start] instanceof Date ? z[i.start].getFullYear() : Number(String(z[i.start]).substring(0, 4));
  };
  const echtePunkte = function (d) {
    if (typeof d.imModerat !== 'number' && typeof d.imIntensiv !== 'number') return null;
    return (d.imModerat || 0) + 2 * (d.imIntensiv || 0);
  };

  // Persönliche Faktoren (Punkte pro Bewegungsminute) je Sportart aus echten Werten ab 2023
  const summen = { alle: { pkt: 0, min: 0 } };
  werte.forEach(function (z, n) {
    const p = echtePunkte(details[n]);
    const min = zahl(z[i.dauer_min]);
    if (jahr(z) < PUNKTE_AB_JAHR || p === null || !min) return;
    const s = summen[z[i.sportart]] || (summen[z[i.sportart]] = { pkt: 0, min: 0 });
    s.pkt += p;
    s.min += min;
    summen.alle.pkt += p;
    summen.alle.min += min;
  });
  const faktoren = {};
  Object.keys(summen).forEach(function (k) {
    if (summen[k].min > 0) faktoren[k] = runden_(summen[k].pkt / summen[k].min, 3);
  });

  const zeilen = werte.map(function (z, n) {
    const start = z[i.start] instanceof Date
      ? Utilities.formatDate(z[i.start], ZEITZONE, "yyyy-MM-dd'T'HH:mm")
      : String(z[i.start]);
    const d = details[n];
    let pkt = null;
    let geschaetzt = false;
    if (jahr(z) >= PUNKTE_AB_JAHR) {
      pkt = echtePunkte(d);
      const plausibel = meldungPlausibel_({ sportart: z[i.sportart], km: zahl(z[i.distanz_km]), min: zahl(z[i.dauer_min]) });
      if (pkt === null && plausibel) {
        const faktor = faktoren[z[i.sportart]] !== undefined ? faktoren[z[i.sportart]] : faktoren.alle;
        const min = zahl(z[i.dauer_min]);
        if (faktor !== undefined && min) {
          pkt = Math.round(min * faktor);
          geschaetzt = true;
        }
      }
    }
    const split = function (s) { return typeof s === 'number' && s > 0 ? s : null; };
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
      z[i.hat_gps] === true,
      pkt,
      geschaetzt,
      split(d.split1kS),
      split(d.split5kS),
      split(d.split10kS),
      split(d.split21kS),
      typeof d.hmAb === 'number' ? d.hmAb : null,
      d.ort || null
    ];
  });
  return { spalten: APP_SPALTEN, zeilen: zeilen, punkteAbJahr: PUNKTE_AB_JAHR, punkteFaktoren: faktoren };
}

/** Liest die Spalte „details“ einer Aktivität. Leeres Objekt, wenn nichts da ist. */
function detailsLesen_(id) {
  if (!/^\d+$/.test(String(id || ''))) throw new Error('ungültige id');
  const b = tabelle_().getSheetByName(BLATT_AKTIVITAETEN);
  if (!b || b.getLastRow() < 2) throw new Error('Aktivität nicht gefunden');
  const treffer = b.getRange(2, 1, b.getLastRow() - 1, 1)
    .createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!treffer) throw new Error('Aktivität nicht gefunden');
  const text = b.getRange(treffer.getRow(), SPALTEN.indexOf('details') + 1).getValue();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    return {};
  }
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

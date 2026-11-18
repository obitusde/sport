/**
 * Sammler.gs – Aktivitäten von Garmin ins Sheet „Aktivitaeten" übernehmen
 * Version: 0.9.0 (2026-11-18)
 *
 * Funktionen zum Ausführen im Script-Editor:
 * - sammelnTrockenlauf()  Diagnose: holt die Daten, schreibt nichts, loggt nur Zählungen
 * - sammeln()             holt neue Aktivitäten und schreibt sie ins Sheet
 * - zeitgeberEinrichten() richtet den täglichen Lauf um ca. 03:00 Europe/Zurich ein
 * - statusZeigen()        loggt letzten Import, letzten Fehler, Sheet-Link und Zeitgeber
 * - sportartenNeuBerechnen() setzt die Sportart aller Zeilen neu aus dem Garmin-Typ
 * - detailsNachtragen()   füllt die Spalte „details“ für alle Aktivitäten (einmalig nach v0.4)
 *
 * Ablauf von sammeln():
 * - Beim ersten Lauf (Sheet leer) wird die ganze Historie geholt.
 * - Danach jeweils die letzten NACHLAUF_TAGE Tage, damit spät synchronisierte
 *   Aktivitäten nicht verloren gehen. Doppelte werden über activityId erkannt.
 * - Danach wird die Sportart aller Zeilen aus garminTyp neu berechnet. So wirken
 *   Änderungen an SPORTARTEN auch für bereits importierte Aktivitäten.
 * - Fehler landen in der Script Property LETZTER_FEHLER und lösen eine Mail aus.
 *
 * Änderungen 0.2.1: neue Sportart „schwimmen“, Sportart wird bei jedem Lauf nachberechnet.
 * Änderungen 0.2.2: sammelnIntern_ liefert ein Ergebnis zurück und kann ohne Fehler-Mail
 *   laufen. Die Web-App nutzt das für den Knopf „Von Garmin holen“ in der App.
 * Änderungen 0.4.0: neue Spalte „details“ (JSON mit Puls, Pulszonen, Trainingseffekt,
 *   Intensitätsminuten, Laufstil, Bestzeiten …), detailsNachtragen(). Eine bestehende
 *   Kopfzeile ohne „details“ wird automatisch ergänzt.
 * Änderungen 0.9.0: Nach dem Import werden die GPS-Spuren neuer Aktivitäten geladen
 *   (Spuren.gs, Standard höchstens 60 Sekunden, aus der App 20 Sekunden).
 *
 * Das Sheet „Sport-Daten" legt das Skript beim ersten Lauf selbst an und merkt sich
 * die ID in der Script Property SHEET_ID. Ein bestehendes Sheet kann genutzt werden,
 * indem man SHEET_ID vorher von Hand setzt.
 *
 * Noch nicht enthalten: GPS-Spuren (spur_datei bleibt leer), bis die FIT-Diagnose
 * geklärt hat, wie die Spur gelesen wird. Nachträgliche Änderungen in Garmin
 * (z. B. geänderter Typ) werden nicht übernommen.
 */

const SHEET_NAME = 'Sport-Daten';
const BLATT_AKTIVITAETEN = 'Aktivitaeten';
const NACHLAUF_TAGE = 14;
const ZEITGEBER_STUNDE = 3;

const SPALTEN = ['activityId', 'start', 'sportart', 'garminTyp', 'name', 'distanz_km', 'dauer_min',
  'dauer_gesamt_min', 'hoehenmeter', 'puls_avg', 'geraet', 'hat_gps', 'spur_datei', 'importiert_am', 'details'];

/**
 * Zuordnung Garmin-Typ → Sportart. Alles, was hier nicht steht, wird „andere“.
 * Festgelegt am 2026-11-17 anhand der Historie (siehe PROJEKT.md, Abschnitt 4).
 */
const SPORTARTEN = {
  laufen: ['running', 'treadmill_running', 'trail_running', 'track_running'],
  rad: ['cycling', 'road_biking', 'gravel_cycling', 'mountain_biking', 'indoor_cycling',
    'e_bike_fitness', 'e_bike_mountain'],
  wandern: ['hiking', 'walking', 'casual_walking', 'speed_walking', 'snow_shoe_ws'],
  ski: ['resort_skiing', 'resort_skiing_snowboarding_ws', 'backcountry_skiing',
    'cross_country_skiing_ws', 'skate_skiing_ws'],
  schwimmen: ['open_water_swimming', 'lap_swimming']
};

/** Garmin-Typen, die gar nicht ins Sheet kommen (overland = Autofahrten). */
const AUSGESCHLOSSEN = ['overland', 'incident_detected'];

// ---------------------------------------------------------------------------
// Öffentliche Funktionen
// ---------------------------------------------------------------------------

/** Holt neue Aktivitäten und schreibt sie ins Sheet. Wird vom Zeitgeber aufgerufen. */
function sammeln() {
  sammelnIntern_(false);
}

/** Diagnose: wie sammeln(), schreibt aber nichts und loggt nur Zählungen. */
function sammelnTrockenlauf() {
  sammelnIntern_(true);
}

/** Richtet den täglichen Zeitgeber ein (ersetzt einen bestehenden). */
function zeitgeberEinrichten() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sammeln') {
      ScriptApp.deleteTrigger(t);
      log_('Alten Zeitgeber für sammeln() entfernt.');
    }
  });
  ScriptApp.newTrigger('sammeln')
    .timeBased()
    .everyDays(1)
    .atHour(ZEITGEBER_STUNDE)
    .inTimezone(ZEITZONE)
    .create();
  log_('Zeitgeber eingerichtet: sammeln() täglich zwischen ' + ZEITGEBER_STUNDE + ' und ' +
    (ZEITGEBER_STUNDE + 1) + ' Uhr (' + ZEITZONE + ').');
}

/** Setzt die Sportart aller Zeilen neu aus dem Garmin-Typ (z. B. nach Änderung von SPORTARTEN). */
function sportartenNeuBerechnen() {
  const b = blattOhneAnlegen_();
  if (!b) {
    log_('Kein Sheet vorhanden.');
    return;
  }
  sportartenAktualisieren_(b, false);
}

/** Loggt den aktuellen Stand. */
function statusZeigen() {
  const p = PropertiesService.getScriptProperties();
  log_('Letzter Import: ' + (p.getProperty('LETZTER_IMPORT') || '-') +
    ', neue Aktivitäten: ' + (p.getProperty('LETZTER_IMPORT_NEU') || '-'));
  log_('Letzter Fehler: ' + (p.getProperty('LETZTER_FEHLER') || '-'));
  const id = p.getProperty('SHEET_ID');
  if (id) {
    const ss = SpreadsheetApp.openById(id);
    const b = ss.getSheetByName(BLATT_AKTIVITAETEN);
    log_('Sheet: ' + ss.getUrl());
    log_('Zeilen mit Aktivitäten: ' + (b ? Math.max(b.getLastRow() - 1, 0) : 0));
  } else {
    log_('Sheet: noch nicht angelegt (SHEET_ID fehlt).');
  }
  const zeitgeber = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'sammeln';
  });
  log_('Zeitgeber für sammeln(): ' + zeitgeber.length);
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

/**
 * @param {boolean} trocken true = nichts schreiben, nur loggen
 * @param {{mail: (boolean|undefined), spurenSekunden: (number|undefined)}=} optionen
 *   mail: false = keine Fehler-Mail (Standard: Mail); spurenSekunden: Zeit für Spuren (Standard 60)
 * @return {{neu: number, proSportart: Object, ausgeschlossen: number, fehler: (string|null)}}
 */
function sammelnIntern_(trocken, optionen) {
  optionen = optionen || {};
  const ergebnis = { neu: 0, proSportart: {}, ausgeschlossen: 0, fehler: null };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    log_('Ein anderer Lauf ist noch aktiv. Abbruch.');
    ergebnis.fehler = 'Ein anderer Abruf läuft gerade. Bitte gleich nochmal versuchen.';
    return ergebnis;
  }
  const props = PropertiesService.getScriptProperties();
  const jetzt = new Date();
  const t0 = Date.now();

  try {
    log_('===== Sammler v0.9.0 ' + (trocken ? 'TROCKENLAUF (schreibt nichts)' : 'gestartet') + ' =====');
    const blatt = trocken ? blattOhneAnlegen_() : blatt_();
    const bekannt = bekannteIds_(blatt);
    const voll = bekannt.size === 0;

    let aktivitaeten;
    if (voll) {
      log_('Sheet leer oder nicht vorhanden: hole die ganze Historie.');
      aktivitaeten = garminAktivitaeten_();
    } else {
      const von = datum_(new Date(jetzt.getTime() - NACHLAUF_TAGE * 24 * 60 * 60 * 1000));
      log_(bekannt.size + ' Aktivitäten bereits im Sheet. Hole die letzten ' + NACHLAUF_TAGE + ' Tage.');
      aktivitaeten = garminAktivitaeten_(von, datum_(jetzt));
    }
    log_('Von Garmin geladen: ' + aktivitaeten.length);

    const neu = [];
    const proSportart = {};
    const andereTypen = {};
    let ausgeschlossen = 0;
    aktivitaeten.forEach(function (a) {
      const id = String(a.activityId);
      if (bekannt.has(id)) return;
      bekannt.add(id);
      const typ = typKey_(a);
      if (AUSGESCHLOSSEN.indexOf(typ) >= 0) {
        ausgeschlossen++;
        return;
      }
      const sportart = sportart_(typ);
      if (sportart === 'andere') andereTypen[typ] = (andereTypen[typ] || 0) + 1;
      proSportart[sportart] = (proSportart[sportart] || 0) + 1;
      neu.push(zeile_(a, sportart, jetzt));
    });

    log_('Neu: ' + neu.length + ' (' + Object.keys(proSportart).map(function (s) {
      return s + '=' + proSportart[s];
    }).join(', ') + '), ausgeschlossen: ' + ausgeschlossen);
    if (Object.keys(andereTypen).length) {
      log_('Als „andere“ eingeordnet: ' + Object.keys(andereTypen).map(function (t) {
        return t + '=' + andereTypen[t];
      }).join(', '));
    }

    if (trocken) {
      if (blatt) sportartenAktualisieren_(blatt, true);
      log_('Trockenlauf: nichts geschrieben.');
    } else {
      if (neu.length) schreiben_(blatt, neu);
      sportartenAktualisieren_(blatt, false);
      try {
        spurenNachladen(optionen.spurenSekunden || 60, 30);
      } catch (spurFehler) {
        log_('Spuren konnten nicht geladen werden: ' + spurFehler.message);
      }
      props.setProperties({
        LETZTER_IMPORT: Utilities.formatDate(jetzt, ZEITZONE, 'yyyy-MM-dd HH:mm:ss'),
        LETZTER_IMPORT_NEU: String(neu.length),
        LETZTER_FEHLER: ''
      });
    }
    ergebnis.neu = neu.length;
    ergebnis.proSportart = proSportart;
    ergebnis.ausgeschlossen = ausgeschlossen;
    log_('===== Fertig in ' + Math.round((Date.now() - t0) / 1000) + ' s =====');
  } catch (e) {
    log_('FEHLER: ' + e.message);
    ergebnis.fehler = e.message;
    if (!trocken) {
      props.setProperty('LETZTER_FEHLER', Utilities.formatDate(jetzt, ZEITZONE, 'yyyy-MM-dd HH:mm:ss') +
        ' ' + e.message);
      if (optionen.mail !== false) fehlerMail_(e);
    }
  } finally {
    lock.releaseLock();
  }
  return ergebnis;
}

/** Ordnet einem Garmin-Typ die Sportart zu. */
function sportart_(typ) {
  const arten = Object.keys(SPORTARTEN);
  for (let i = 0; i < arten.length; i++) {
    if (SPORTARTEN[arten[i]].indexOf(typ) >= 0) return arten[i];
  }
  return 'andere';
}

/** Baut eine Sheet-Zeile in der Reihenfolge von SPALTEN. */
function zeile_(a, sportart, jetzt) {
  const zahl = function (wert, faktor, stellen) {
    return (typeof wert === 'number') ? runden_(wert * faktor, stellen) : '';
  };
  const bewegt = (typeof a.movingDuration === 'number') ? a.movingDuration : a.duration;
  return [
    a.activityId,
    a.startTimeLocal ? Utilities.parseDate(a.startTimeLocal, ZEITZONE, 'yyyy-MM-dd HH:mm:ss') : '',
    sportart,
    typKey_(a),
    a.activityName || '',
    zahl(a.distance, 1 / 1000, 2),
    zahl(bewegt, 1 / 60, 1),
    zahl(a.elapsedDuration, 1 / 60, 1),
    zahl(a.elevationGain, 1, 0),
    zahl(a.averageHR, 1, 0),
    a.manufacturer || '',
    hatGps_(a),
    '',
    jetzt,
    JSON.stringify(details_(a))
  ];
}

/**
 * Zusatzwerte einer Aktivität für die Detailansicht, kompakt als Objekt.
 * Nur Felder, die Garmin liefert, kommen hinein. Einheiten laut Swagger-Doku.
 * @param {Object} a SummarizedActivityDTO
 * @return {Object}
 */
function details_(a) {
  const d = {};
  const setze = function (schluessel, wert, stellen) {
    if (typeof wert === 'number' && isFinite(wert)) d[schluessel] = runden_(wert, stellen);
    else if (typeof wert === 'string' && wert) d[schluessel] = wert;
  };
  setze('pulsMax', a.maxHR, 0);                                   // Schläge/min
  const zonen = [1, 2, 3, 4, 5].map(function (i) { return a['hrTimeInZone_' + i]; });
  if (zonen.some(function (z) { return typeof z === 'number'; })) {
    d.zonenMin = zonen.map(function (z) { return typeof z === 'number' ? runden_(z / 60, 1) : 0; });
  }
  setze('teAerob', a.aerobicTrainingEffect, 1);
  setze('teAnaerob', a.anaerobicTrainingEffect, 1);
  setze('teLabel', a.trainingEffectLabel);
  setze('belastung', a.activityTrainingLoad, 0);
  setze('imModerat', a.moderateIntensityMinutes, 0);              // Minuten
  setze('imIntensiv', a.vigorousIntensityMinutes, 0);             // Minuten
  setze('kadenzLauf', a.averageRunningCadenceInStepsPerMinute, 0); // Schritte/min
  setze('kadenzRad', a.averageBikingCadenceInRevPerMinute, 0);    // U/min
  setze('schrittlaengeCm', a.avgStrideLength, 0);
  setze('bodenkontaktMs', a.avgGroundContactTime, 0);
  setze('vertOszCm', a.avgVerticalOscillation, 1);
  setze('vertVerhaeltnis', a.avgVerticalRatio, 1);                // %
  setze('kalorien', a.calories, 0);
  setze('hmAb', a.elevationLoss, 0);
  setze('hoeheMax', a.maxElevation, 0);
  setze('vSchnittMs', a.averageSpeed, 3);                         // m/s
  setze('vMaxMs', a.maxSpeed, 3);                                 // m/s
  setze('vGapMs', a.avgGradeAdjustedSpeed, 3);                    // m/s, steigungsbereinigt
  setze('split1kS', a.fastestSplit_1000, 0);                      // Sekunden
  setze('split5kS', a.fastestSplit_5000, 0);
  setze('split10kS', a.fastestSplit_10000, 0);
  setze('split21kS', a.fastestSplit_21098, 0);
  setze('split42kS', a.fastestSplit_42195, 0);
  setze('bodyBattery', a.differenceBodyBattery, 0);
  setze('leistungW', a.avgPower, 0);
  setze('leistungNormW', a.normPower, 0);
  setze('schritte', a.steps, 0);
  setze('tempMin', a.minTemperature, 0);                          // °C
  setze('tempMax', a.maxTemperature, 0);
  setze('ort', a.locationName);
  return d;
}

/**
 * Füllt die Spalte „details“ für alle Aktivitäten im Sheet. Holt dafür die ganze
 * Historie von Garmin (ca. 25 s). Kann gefahrlos mehrfach laufen.
 */
function detailsNachtragen() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    log_('Ein anderer Lauf ist noch aktiv. Abbruch.');
    return;
  }
  try {
    log_('===== Details nachtragen =====');
    const b = blatt_();
    const n = b.getLastRow() - 1;
    if (n < 1) {
      log_('Sheet ist leer.');
      return;
    }
    const proId = {};
    garminAktivitaeten_().forEach(function (a) { proId[String(a.activityId)] = JSON.stringify(details_(a)); });
    const ids = b.getRange(2, 1, n, 1).getValues();
    let gefunden = 0;
    const werte = ids.map(function (z) {
      const json = proId[String(z[0])];
      if (json) gefunden++;
      return [json || '{}'];
    });
    b.getRange(2, SPALTEN.indexOf('details') + 1, n, 1).setValues(werte);
    log_('Details geschrieben: ' + gefunden + ' von ' + n + ' Zeilen' +
      (gefunden < n ? ' (' + (n - gefunden) + ' nicht mehr bei Garmin gefunden)' : '') + '.');
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

/** Liefert das Blatt „Aktivitaeten“ und legt Sheet und Blatt bei Bedarf an. */
function blatt_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create(SHEET_NAME);
    ss.setSpreadsheetTimeZone(ZEITZONE);
    props.setProperty('SHEET_ID', ss.getId());
    log_('Neues Sheet angelegt: ' + ss.getUrl());
  }

  let b = ss.getSheetByName(BLATT_AKTIVITAETEN);
  if (!b) {
    const blaetter = ss.getSheets();
    const leeresErstes = blaetter.length === 1 && blaetter[0].getLastRow() === 0;
    b = leeresErstes ? blaetter[0].setName(BLATT_AKTIVITAETEN) : ss.insertSheet(BLATT_AKTIVITAETEN);
  }

  if (b.getLastRow() === 0) {
    b.getRange(1, 1, 1, SPALTEN.length).setValues([SPALTEN]).setFontWeight('bold');
    b.setFrozenRows(1);
  } else {
    const kopf = b.getRange(1, 1, 1, SPALTEN.length).getValues()[0];
    // Neue Spalten am Ende (z. B. „details“ ab v0.4) automatisch ergänzen
    const vorhanden = kopf.filter(function (k) { return k !== ''; }).length;
    const passtBisher = kopf.slice(0, vorhanden).join('|') === SPALTEN.slice(0, vorhanden).join('|');
    if (passtBisher && vorhanden < SPALTEN.length && kopf.slice(vorhanden).every(function (k) { return k === ''; })) {
      b.getRange(1, vorhanden + 1, 1, SPALTEN.length - vorhanden)
        .setValues([SPALTEN.slice(vorhanden)]).setFontWeight('bold');
      log_('Kopfzeile ergänzt um: ' + SPALTEN.slice(vorhanden).join(', '));
    } else if (kopf.join('|') !== SPALTEN.join('|')) {
      throw new Error('Kopfzeile im Blatt „' + BLATT_AKTIVITAETEN + '“ passt nicht zu den erwarteten Spalten.');
    }
  }
  return b;
}

/** Wie blatt_(), legt aber nichts an. Liefert null, wenn es nichts gibt. */
function blattOhneAnlegen_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) return null;
  return SpreadsheetApp.openById(id).getSheetByName(BLATT_AKTIVITAETEN);
}

/** activityIds, die schon im Blatt stehen. */
function bekannteIds_(b) {
  const ids = new Set();
  if (!b || b.getLastRow() < 2) return ids;
  b.getRange(2, 1, b.getLastRow() - 1, 1).getValues().forEach(function (z) {
    if (z[0] !== '') ids.add(String(z[0]));
  });
  return ids;
}

/**
 * Berechnet die Sportart aller Zeilen aus garminTyp neu und schreibt Änderungen zurück.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} b
 * @param {boolean} trocken nur zählen, nichts schreiben
 */
function sportartenAktualisieren_(b, trocken) {
  const n = b.getLastRow() - 1;
  if (n < 1) return;
  const spalteSportart = SPALTEN.indexOf('sportart') + 1;
  const spalteTyp = SPALTEN.indexOf('garminTyp') + 1;
  const sportarten = b.getRange(2, spalteSportart, n, 1).getValues();
  const typen = b.getRange(2, spalteTyp, n, 1).getValues();
  const geaendert = {};
  let anzahl = 0;
  const neu = sportarten.map(function (z, i) {
    const soll = sportart_(String(typen[i][0]));
    if (z[0] !== soll) {
      anzahl++;
      const schluessel = z[0] + '→' + soll;
      geaendert[schluessel] = (geaendert[schluessel] || 0) + 1;
    }
    return [soll];
  });
  if (!anzahl) return;
  log_('Sportart ' + (trocken ? 'würde sich ändern' : 'geändert') + ' bei ' + anzahl + ' Zeilen: ' +
    Object.keys(geaendert).map(function (k) { return k + '=' + geaendert[k]; }).join(', '));
  if (!trocken) b.getRange(2, spalteSportart, n, 1).setValues(neu);
}

/** Hängt Zeilen an, setzt Formate und sortiert nach Startzeit. */
function schreiben_(b, zeilen) {
  b.getRange(b.getLastRow() + 1, 1, zeilen.length, SPALTEN.length).setValues(zeilen);
  const n = b.getLastRow() - 1;
  b.getRange(2, SPALTEN.indexOf('activityId') + 1, n, 1).setNumberFormat('0');
  b.getRange(2, SPALTEN.indexOf('start') + 1, n, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  b.getRange(2, SPALTEN.indexOf('importiert_am') + 1, n, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  b.getRange(2, 1, n, SPALTEN.length).sort({ column: SPALTEN.indexOf('start') + 1, ascending: true });
  log_(zeilen.length + ' Zeilen geschrieben, jetzt ' + n + ' Aktivitäten im Sheet.');
}

// ---------------------------------------------------------------------------
// Fehler-Mail
// ---------------------------------------------------------------------------

/** Schickt eine Mail an den Besitzer des Skripts. Enthält keine Schlüssel oder Tokens. */
function fehlerMail_(e) {
  try {
    const an = Session.getEffectiveUser().getEmail();
    if (!an) {
      log_('Keine Mail-Adresse verfügbar, Fehler-Mail entfällt.');
      return;
    }
    const text = [
      'Der Sport-Sammler ist mit einem Fehler abgebrochen.',
      '',
      'Zeitpunkt: ' + Utilities.formatDate(new Date(), ZEITZONE, 'yyyy-MM-dd HH:mm'),
      'Fehler: ' + e.message,
      '',
      'Häufige Ursache: Der Garmin-API-Schlüssel ist abgelaufen oder gelöscht.',
      'Dann unter https://connect.garmin.com/app/settings/personalApiToken einen neuen Schlüssel',
      'erzeugen und im Apps-Script-Projekt die Skripteigenschaft GARMIN_API_KEY ersetzen.',
      '',
      'Ausführungen: https://script.google.com/home/projects/' + ScriptApp.getScriptId() + '/executions'
    ].join('\n');
    MailApp.sendEmail(an, 'Sport-Sammler: Fehler beim Garmin-Abruf', text);
    log_('Fehler-Mail verschickt.');
  } catch (mailFehler) {
    log_('Fehler-Mail konnte nicht verschickt werden: ' + mailFehler.message);
  }
}

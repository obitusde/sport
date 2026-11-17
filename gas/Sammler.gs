/**
 * Sammler.gs – v0.2: Aktivitäten von Garmin ins Sheet „Aktivitaeten" übernehmen
 * Version: 0.2.0 (2026-11-17)
 *
 * Funktionen zum Ausführen im Script-Editor:
 * - sammelnTrockenlauf()  Diagnose: holt die Daten, schreibt nichts, loggt nur Zählungen
 * - sammeln()             holt neue Aktivitäten und schreibt sie ins Sheet
 * - zeitgeberEinrichten() richtet den täglichen Lauf um ca. 03:00 Europe/Zurich ein
 * - statusZeigen()        loggt letzten Import, letzten Fehler, Sheet-Link und Zeitgeber
 *
 * Ablauf von sammeln():
 * - Beim ersten Lauf (Sheet leer) wird die ganze Historie geholt.
 * - Danach jeweils die letzten NACHLAUF_TAGE Tage, damit spät synchronisierte
 *   Aktivitäten nicht verloren gehen. Doppelte werden über activityId erkannt.
 * - Fehler landen in der Script Property LETZTER_FEHLER und lösen eine Mail aus.
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
  'dauer_gesamt_min', 'hoehenmeter', 'puls_avg', 'geraet', 'hat_gps', 'spur_datei', 'importiert_am'];

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
    'cross_country_skiing_ws', 'skate_skiing_ws']
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
 */
function sammelnIntern_(trocken) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    log_('Ein anderer Lauf ist noch aktiv. Abbruch.');
    return;
  }
  const props = PropertiesService.getScriptProperties();
  const jetzt = new Date();
  const t0 = Date.now();

  try {
    log_('===== Sammler v0.2.0 ' + (trocken ? 'TROCKENLAUF (schreibt nichts)' : 'gestartet') + ' =====');
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
      log_('Trockenlauf: nichts geschrieben.');
    } else {
      if (neu.length) schreiben_(blatt, neu);
      props.setProperties({
        LETZTER_IMPORT: Utilities.formatDate(jetzt, ZEITZONE, 'yyyy-MM-dd HH:mm:ss'),
        LETZTER_IMPORT_NEU: String(neu.length),
        LETZTER_FEHLER: ''
      });
    }
    log_('===== Fertig in ' + Math.round((Date.now() - t0) / 1000) + ' s =====');
  } catch (e) {
    log_('FEHLER: ' + e.message);
    if (!trocken) {
      props.setProperty('LETZTER_FEHLER', Utilities.formatDate(jetzt, ZEITZONE, 'yyyy-MM-dd HH:mm:ss') +
        ' ' + e.message);
      fehlerMail_(e);
    }
  } finally {
    lock.releaseLock();
  }
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
    jetzt
  ];
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
    if (kopf.join('|') !== SPALTEN.join('|')) {
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

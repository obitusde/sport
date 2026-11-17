/**
 * Diagnose.gs – Diagnose der Garmin Connect Personal API
 * Version: 0.1.3 (2026-11-17)
 *
 * Nur Diagnose: Alle Funktionen loggen, nichts wird gespeichert.
 * Nutzt Garmin.gs und Hilfen.gs.
 *
 * Start: Im Script-Editor diagnoseAlles() ausführen und das Ausführungsprotokoll lesen.
 *
 * Datenschutz:
 * - API-Schlüssel und Zugriffstoken werden nie geloggt.
 * - Mit WERTE_LOGGEN = false loggt die Diagnose nur Struktur und Zählungen:
 *   Feldnamen, Typen, Anzahlen, Garmin-Typen, aber keine Koordinaten, Zeiten oder Messwerte.
 * - Mit WERTE_LOGGEN = true kommen Beispielwerte dazu. Nur für den eigenen Blick.
 *
 * Änderungen 0.1.1:
 * - FIT-Download probiert mehrere Accept-Köpfe (0.1.0 bekam HTTP 406 mit application/json).
 * - Beispiel-Aktivität ist eine mit startLatitude (hasPolyline fehlt in der Liste).
 * - metadataDTO.fileFormat wird mit Wert geloggt (nur Dateiformat, keine persönlichen Daten).
 * - Token, Abruf und Hilfsfunktionen liegen jetzt in Garmin.gs und Hilfen.gs.
 * - diagnoseAlles() ohne Historie (ist geklärt), diagnoseHistorie() bleibt einzeln aufrufbar.
 *
 * Änderungen 0.1.2: diagnoseDetails() zählt, wie oft Garmin die Zusatzwerte für die
 * Detailansicht und die Intensitätsminuten liefert (pro Sportart und Jahr), und listet
 * die vorkommenden Trainingseffekt-Labels. Nur Zählungen, keine Werte.
 * Änderungen 0.1.3: diagnoseDetails() heißt jetzt diagnoseZusatzwerte() (Verwechslung
 * mit diagnoseDetail()).
 */

const WERTE_LOGGEN = false;

/** Accept-Köpfe, die der FIT-Download der Reihe nach probiert. */
const FIT_ACCEPT_KANDIDATEN = ['*/*', 'application/octet-stream', 'application/x-zip-compressed', 'application/zip'];

// ---------------------------------------------------------------------------
// Gesamtablauf
// ---------------------------------------------------------------------------

/** Führt Token, Liste, Detail und FIT-Diagnose nacheinander aus. */
function diagnoseAlles() {
  log_('===== Diagnose v0.1.1 gestartet, WERTE_LOGGEN = ' + WERTE_LOGGEN + ' =====');

  if (!diagnoseToken()) {
    log_('Abbruch: kein Zugriffstoken.');
    return;
  }

  let liste = [];
  try {
    liste = diagnoseListe();
  } catch (e) {
    log_('FEHLER in diagnoseListe: ' + e.message);
  }

  // Für Detail und FIT eine Aktivität mit GPS (Startkoordinate vorhanden)
  const mitGps = liste.filter(hatGps_);
  const beispiel = mitGps.length ? mitGps[0] : liste[0];
  if (beispiel) {
    log_('Beispiel-Aktivität für Detail und FIT: Typ ' + typKey_(beispiel) + ', GPS ' + hatGps_(beispiel) +
      (WERTE_LOGGEN ? ', ID ' + beispiel.activityId : ''));
    try {
      diagnoseDetail(beispiel.activityId);
    } catch (e) {
      log_('FEHLER in diagnoseDetail: ' + e.message);
    }
    try {
      diagnoseFit(beispiel.activityId);
    } catch (e) {
      log_('FEHLER in diagnoseFit: ' + e.message);
    }
  } else {
    log_('Keine Aktivität in den letzten 30 Tagen. Detail und FIT werden übersprungen.');
  }

  log_('===== Diagnose beendet =====');
}

// ---------------------------------------------------------------------------
// 1. Zugriffstoken
// ---------------------------------------------------------------------------

/**
 * Holt ein frisches Zugriffstoken und loggt nur das Ergebnis (nie den Wert).
 * @return {boolean} Token erhalten
 */
function diagnoseToken() {
  log_('--- 1. Zugriffstoken ---');
  const t0 = Date.now();
  try {
    const token = garminToken_(true);
    log_('Token erhalten in ' + (Date.now() - t0) + ' ms, Länge ' + token.length + ' Zeichen.');
    return true;
  } catch (e) {
    log_('FEHLER: ' + e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. Aktivitäten der letzten 30 Tage
// ---------------------------------------------------------------------------

/**
 * Listet die Aktivitäten der letzten 30 Tage.
 * @return {Object[]} Aktivitäten (SummarizedActivityDTO)
 */
function diagnoseListe() {
  log_('--- 2. Aktivitäten der letzten 30 Tage ---');
  const heute = new Date();
  const vor30 = new Date(heute.getTime() - 30 * 24 * 60 * 60 * 1000);
  const params = { startDate: datum_(vor30), endDate: datum_(heute), start: 0, limit: 99 };

  const liste = garminJson_(PFAD_LISTE, params);
  if (!Array.isArray(liste)) {
    log_('WARNUNG: Antwort ist keine Liste, sondern ' + typ_(liste));
    return [];
  }
  log_('Anzahl Aktivitäten: ' + liste.length);
  if (!liste.length) return liste;

  const felder = Object.keys(liste[0]);
  log_('Erste Aktivität hat ' + felder.length + ' Felder (nur gefüllte Felder kommen mit):');
  logLang_(felder.map(function (k) { return k + ':' + typ_(liste[0][k]); }).join(', '));

  // Felder, die das Sheet „Aktivitaeten" braucht
  const wichtig = ['activityId', 'startTimeLocal', 'activityType', 'distance', 'movingDuration',
    'elapsedDuration', 'elevationGain', 'averageHR', 'manufacturer'];
  liste.forEach(function (a, i) {
    let zeile = (i + 1) + '. ' + typKey_(a) + ' | GPS ' + hatGps_(a);
    if (WERTE_LOGGEN) {
      zeile += ' | ' + a.startTimeLocal + ' | ' + runden_(a.distance / 1000, 2) + ' km | ' +
        runden_(a.movingDuration / 60, 1) + ' min bewegt | ' + runden_(a.elapsedDuration / 60, 1) +
        ' min gesamt | ' + runden_(a.elevationGain, 0) + ' hm | Puls ' + a.averageHR +
        ' | ' + a.manufacturer + ' | ID ' + a.activityId;
    } else {
      const fehlend = wichtig.filter(function (k) { return a[k] === undefined || a[k] === null; });
      zeile += ' | fehlende Felder: ' + (fehlend.join(', ') || 'keine');
    }
    log_(zeile);
  });
  return liste;
}

// ---------------------------------------------------------------------------
// 3. Eine Aktivität im Detail
// ---------------------------------------------------------------------------

/**
 * Lädt eine Aktivität im Detail und loggt den Aufbau.
 * @param {number|string} activityId
 */
function diagnoseDetail(activityId) {
  log_('--- 3. Aktivität im Detail ---');
  const d = garminJson_(PFAD_DETAIL + activityId, null);
  if (!d || typeof d !== 'object') {
    log_('WARNUNG: Keine Detaildaten.');
    return;
  }
  log_('Oberste Ebene: ' + Object.keys(d).map(function (k) { return k + ':' + typ_(d[k]); }).join(', '));

  const meta = d.metadataDTO || {};
  log_('metadataDTO.fileFormat = ' + JSON.stringify(meta.fileFormat));
  log_('metadataDTO.isOriginal = ' + meta.isOriginal + ', manualActivity = ' + meta.manualActivity);

  if (WERTE_LOGGEN) {
    ['summaryDTO', 'metadataDTO'].forEach(function (teil) {
      log_(teil + ':');
      logLang_(JSON.stringify(d[teil]));
    });
  }
}

// ---------------------------------------------------------------------------
// 4. Originaldatei (ZIP mit FIT) laden und auswerten
// ---------------------------------------------------------------------------

/**
 * Lädt die Originaldatei einer Aktivität, entpackt das ZIP und scannt die FIT-Datei
 * auf GPS-Punkte. Prüft damit, ob die FIT-Auswertung in Apps Script machbar ist.
 * @param {number|string} activityId
 */
function diagnoseFit(activityId) {
  log_('--- 4. Originaldatei (FIT) ---');
  let antwort = null;
  for (let i = 0; i < FIT_ACCEPT_KANDIDATEN.length; i++) {
    log_('Versuch mit Accept: ' + FIT_ACCEPT_KANDIDATEN[i]);
    antwort = garminAbruf_(PFAD_DATEI + activityId, null, { accept: FIT_ACCEPT_KANDIDATEN[i] });
    if (antwort.getResponseCode() === 200) break;
  }
  if (antwort.getResponseCode() !== 200) {
    log_('Download mit keinem Accept-Kopf möglich.');
    return;
  }

  const blob = antwort.getBlob();
  const groesse = blob.getBytes().length;
  log_('Content-Type: ' + (kopfzeilen_(antwort)['content-type'] || '-') + ', Größe: ' +
    runden_(groesse / 1024, 1) + ' KB, Content-Disposition vorhanden: ' +
    !!kopfzeilen_(antwort)['content-disposition']);

  let dateien;
  try {
    blob.setContentType('application/zip');
    dateien = Utilities.unzip(blob);
    log_('ZIP entpackt: ' + dateien.length + ' Datei(en)');
  } catch (e) {
    log_('Entpacken fehlgeschlagen (' + e.message + '). Versuche die Antwort direkt als FIT zu lesen.');
    dateien = [blob.setName('antwort.fit')];
  }

  dateien.forEach(function (datei) {
    const bytes = datei.getBytes();
    const endung = (String(datei.getName() || '').match(/\.[^.]+$/) || ['ohne Endung'])[0];
    log_('Datei mit Endung ' + endung + ', ' + runden_(bytes.length / 1024, 1) + ' KB');
    if (!istFit_(bytes)) {
      log_('  keine FIT-Datei, übersprungen');
      return;
    }
    const t0 = Date.now();
    try {
      const s = fitScannen_(bytes);
      log_('  FIT-Kopf: ' + s.kopfGroesse + ' Byte, Protokoll ' + s.protokoll + ', Profil ' + s.profil +
        ', Datenteil ' + runden_(s.datenGroesse / 1024, 1) + ' KB, Signatur „' + s.signatur + '“');
      log_('  Gescannt in ' + (Date.now() - t0) + ' ms: ' + s.definitionen + ' Definitionen, ' +
        s.nachrichten + ' Datennachrichten');
      log_('  Nachrichten nach Typ: ' + Object.keys(s.typen).map(function (g) {
        return (FIT_NAMEN[g] || g) + '=' + s.typen[g];
      }).join(', '));
      log_('  record-Nachrichten: ' + s.records + ', davon mit GPS-Position: ' + s.mitPosition +
        ', mit Höhe: ' + s.mitHoehe);
      if (s.ende < s.erwartetesEnde) {
        log_('  WARNUNG: Scan endete vorzeitig bei Byte ' + s.ende + ' von ' + s.erwartetesEnde);
      }
      if (WERTE_LOGGEN && s.erste) {
        log_('  erster Punkt: ' + s.erste.join(', ') + ' | letzter Punkt: ' + s.letzte.join(', '));
      }
    } catch (e) {
      log_('  FIT-Scan fehlgeschlagen nach ' + (Date.now() - t0) + ' ms: ' + e.message);
    }
  });
}

/** Bekannte globale FIT-Nachrichtennummern (Auszug aus dem FIT-Profil). */
const FIT_NAMEN = {
  0: 'file_id', 12: 'sport', 18: 'session', 19: 'lap', 20: 'record', 21: 'event',
  22: 'source', 23: 'device_info', 34: 'activity', 49: 'file_creator', 78: 'hrv',
  101: 'length', 104: 'device_aux_battery_info', 113: 'segment_lap', 216: 'time_in_zone'
};

/** Prüft die FIT-Signatur „.FIT“ in Byte 8 bis 11. */
function istFit_(bytes) {
  return bytes.length > 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
}

/**
 * Minimaler FIT-Scanner: liest Kopf, Definitionen und Datennachrichten.
 * Zählt Nachrichten und wertet nur record-Nachrichten (global 20) für
 * position_lat (Feld 0), position_long (Feld 1) und altitude (Feld 2) aus.
 * Verkettete FIT-Dateien und Prüfsummen werden nicht beachtet.
 * @param {number[]} rohBytes Bytes aus Blob.getBytes() (vorzeichenbehaftet)
 * @return {Object} Statistik
 */
function fitScannen_(rohBytes) {
  const b = new Uint8Array(rohBytes.length);
  for (let i = 0; i < rohBytes.length; i++) b[i] = rohBytes[i] & 0xff;

  const kopfGroesse = b[0];
  const s = {
    kopfGroesse: kopfGroesse,
    protokoll: b[1],
    profil: b[2] + b[3] * 256,
    datenGroesse: b[4] + b[5] * 256 + b[6] * 65536 + b[7] * 16777216,
    signatur: String.fromCharCode(b[8], b[9], b[10], b[11]),
    definitionen: 0,
    nachrichten: 0,
    typen: {},
    records: 0,
    mitPosition: 0,
    mitHoehe: 0,
    erste: null,
    letzte: null
  };
  if (s.signatur !== '.FIT') throw new Error('keine FIT-Signatur');

  const defs = {};
  let pos = kopfGroesse;
  const ende = Math.min(kopfGroesse + s.datenGroesse, b.length);
  s.erwartetesEnde = ende;

  while (pos < ende) {
    const kopf = b[pos++];
    if (kopf & 0x80) {
      // Kompakter Zeitstempel-Kopf: lokaler Typ in Bit 5–6
      pos = fitDaten_(b, pos, defs[(kopf >> 5) & 0x03], s);
      continue;
    }
    const lokal = kopf & 0x0f;
    if (kopf & 0x40) {
      // Definitionsnachricht
      const little = b[pos + 1] === 0;
      const global = little ? b[pos + 2] + b[pos + 3] * 256 : b[pos + 2] * 256 + b[pos + 3];
      const anzahl = b[pos + 4];
      pos += 5;
      const felder = {};
      let groesse = 0;
      for (let i = 0; i < anzahl; i++) {
        felder[b[pos]] = { versatz: groesse, groesse: b[pos + 1] };
        groesse += b[pos + 1];
        pos += 3;
      }
      if (kopf & 0x20) {
        // Entwicklerfelder
        const anzahlDev = b[pos++];
        for (let i = 0; i < anzahlDev; i++) {
          groesse += b[pos + 1];
          pos += 3;
        }
      }
      defs[lokal] = { global: global, little: little, felder: felder, groesse: groesse };
      s.definitionen++;
    } else {
      pos = fitDaten_(b, pos, defs[lokal], s);
    }
  }
  s.ende = pos;
  return s;
}

/** Liest eine Datennachricht und gibt die neue Position zurück. */
function fitDaten_(b, pos, def, s) {
  if (!def) throw new Error('Datennachricht ohne Definition bei Byte ' + pos);
  s.nachrichten++;
  s.typen[def.global] = (s.typen[def.global] || 0) + 1;
  if (def.global === 20) {
    s.records++;
    const lat = def.felder[0];
    const lon = def.felder[1];
    if (lat && lon && lat.groesse === 4 && lon.groesse === 4) {
      const la = int32_(b, pos + lat.versatz, def.little);
      const lo = int32_(b, pos + lon.versatz, def.little);
      if (la !== 0x7fffffff && lo !== 0x7fffffff) {
        s.mitPosition++;
        const punkt = [runden_(la * 180 / 2147483648, 6), runden_(lo * 180 / 2147483648, 6)];
        if (!s.erste) s.erste = punkt;
        s.letzte = punkt;
      }
    }
    const hoehe = def.felder[2];
    if (hoehe && hoehe.groesse === 2) {
      const h = def.little ? b[pos + hoehe.versatz] + b[pos + hoehe.versatz + 1] * 256
        : b[pos + hoehe.versatz] * 256 + b[pos + hoehe.versatz + 1];
      if (h !== 0xffff) s.mitHoehe++;
    }
  }
  return pos + def.groesse;
}

/** Liest eine vorzeichenbehaftete 32-Bit-Zahl. */
function int32_(b, p, little) {
  return little
    ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24))
    : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]);
}

// ---------------------------------------------------------------------------
// 5. Historie (einzeln aufrufbar)
// ---------------------------------------------------------------------------

/** Zählt alle Aktivitäten pro Jahr und Garmin-Typ. */
function diagnoseHistorie() {
  log_('--- 5. Historie ---');
  const t0 = Date.now();
  const alle = garminAktivitaeten_();
  const proJahr = {};
  const proTyp = {};
  alle.forEach(function (a) {
    const jahr = String(a.startTimeLocal || '????').substring(0, 4);
    proJahr[jahr] = (proJahr[jahr] || 0) + 1;
    proTyp[typKey_(a)] = (proTyp[typKey_(a)] || 0) + 1;
  });
  log_('Aktivitäten gesamt: ' + alle.length + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s');
  log_('Pro Jahr: ' + Object.keys(proJahr).sort().map(function (j) { return j + '=' + proJahr[j]; }).join(', '));
  log_('Pro Garmin-Typ: ' + Object.keys(proTyp).sort(function (x, y) { return proTyp[y] - proTyp[x]; })
    .map(function (t) { return t + '=' + proTyp[t]; }).join(', '));
}

// ---------------------------------------------------------------------------
// 6. Zusatzwerte für die Detailansicht und Intensitätsminuten (v0.4)
// ---------------------------------------------------------------------------

/**
 * Zählt über die ganze Historie, wie oft die Zusatzwerte vorhanden sind.
 * Loggt nur Anzahlen und die Namen der Trainingseffekt-Labels.
 */
function diagnoseZusatzwerte() {
  log_('--- 6. Zusatzwerte (Details) ---');
  const alle = garminAktivitaeten_();
  log_('Aktivitäten: ' + alle.length);

  const felder = ['averageHR', 'maxHR', 'hrTimeInZone_1', 'aerobicTrainingEffect', 'trainingEffectLabel',
    'activityTrainingLoad', 'moderateIntensityMinutes', 'vigorousIntensityMinutes',
    'averageRunningCadenceInStepsPerMinute', 'avgStrideLength', 'avgGroundContactTime',
    'avgGradeAdjustedSpeed', 'fastestSplit_1000', 'fastestSplit_5000', 'calories', 'differenceBodyBattery'];

  const proSportart = {};
  const imProJahr = {};
  const labels = {};
  alle.forEach(function (a) {
    const sa = sportart_(typKey_(a));
    const s = proSportart[sa] || (proSportart[sa] = { gesamt: 0 });
    s.gesamt++;
    felder.forEach(function (f) {
      if (a[f] !== undefined && a[f] !== null) s[f] = (s[f] || 0) + 1;
    });
    const jahr = String(a.startTimeLocal || '????').substring(0, 4);
    const j = imProJahr[jahr] || (imProJahr[jahr] = { gesamt: 0, mitIm: 0, mitPuls: 0 });
    j.gesamt++;
    if (typeof a.moderateIntensityMinutes === 'number' || typeof a.vigorousIntensityMinutes === 'number') j.mitIm++;
    if (typeof a.averageHR === 'number') j.mitPuls++;
    if (a.trainingEffectLabel) labels[a.trainingEffectLabel] = (labels[a.trainingEffectLabel] || 0) + 1;
  });

  Object.keys(proSportart).forEach(function (sa) {
    const s = proSportart[sa];
    log_(sa + ' (' + s.gesamt + '): ' + felder.map(function (f) { return f + '=' + (s[f] || 0); }).join(', '));
  });
  log_('Intensitätsminuten pro Jahr (mit IM / mit Puls / gesamt): ' + Object.keys(imProJahr).sort().map(function (j) {
    return j + '=' + imProJahr[j].mitIm + '/' + imProJahr[j].mitPuls + '/' + imProJahr[j].gesamt;
  }).join(', '));
  log_('Trainingseffekt-Labels: ' + (Object.keys(labels).map(function (l) { return l + '=' + labels[l]; }).join(', ') || 'keine'));
}

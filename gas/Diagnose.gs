/**
 * Diagnose.gs – v0.1: Diagnose der Garmin Connect Personal API
 * Version: 0.1.0 (2026-11-17)
 *
 * Nur Diagnose: Alle Funktionen loggen, nichts wird gespeichert.
 *
 * Voraussetzung: Script Property GARMIN_API_KEY (Projekteinstellungen → Skripteigenschaften).
 * Start: Im Script-Editor die Funktion diagnoseAlles() ausführen und die Ausgabe
 * im Ausführungsprotokoll lesen. Die Einzelfunktionen lassen sich auch einzeln starten.
 *
 * Datenschutz:
 * - Der API-Schlüssel und das Zugriffstoken werden nie geloggt.
 * - Mit WERTE_LOGGEN = false loggt die Diagnose nur Struktur und Zählungen:
 *   Feldnamen, Typen, Anzahlen, Garmin-Typen, aber keine Koordinaten, Zeiten oder Messwerte.
 *   So kann das Protokoll geteilt werden, ohne Aktivitätsdaten preiszugeben.
 * - Mit WERTE_LOGGEN = true kommen Beispielwerte dazu. Nur für den eigenen Blick.
 *
 * Grundlage: Swagger-Doku der Personal API (Stand 2026-11-17).
 * - Liste:   GET /activitylist-service/activities/search/activities
 * - Detail:  GET /activity-service/activity/{activityId}
 * - Datei:   GET /download-service/files/activity/{activityId} (ZIP mit Originaldatei)
 * Annahmen, die diese Diagnose prüft:
 * - Aufbau der Token-Antwort (in der Doku nicht beschrieben)
 * - Aufruf der Endpunkte mit „Authorization: Bearer <token>“ (laut FAQ OAuth2-Token)
 * - GPS-Spur nur in der FIT-Datei (die Doku kennt keinen Endpunkt für Spuren)
 */

const WERTE_LOGGEN = false;

const GARMIN_BASIS = 'https://personal.connectapi.garmin.com';
const GARMIN_TOKEN_URL = GARMIN_BASIS + '/personalapitoken-service/personal-api/personal-api-key/token';
const PFAD_LISTE = '/activitylist-service/activities/search/activities';
const PFAD_DETAIL = '/activity-service/activity/';
const PFAD_DATEI = '/download-service/files/activity/';
const ZEITZONE = 'Europe/Zurich';
const TOKEN_CACHE_SCHLUESSEL = 'garminZugriffstoken';
const TOKEN_CACHE_SEKUNDEN = 6 * 60 * 60; // CacheService erlaubt höchstens 6 Stunden

// ---------------------------------------------------------------------------
// Gesamtablauf
// ---------------------------------------------------------------------------

/** Führt alle Diagnosen nacheinander aus. */
function diagnoseAlles() {
  log_('===== Diagnose v0.1.0 gestartet, WERTE_LOGGEN = ' + WERTE_LOGGEN + ' =====');

  const token = diagnoseToken();
  if (!token) {
    log_('Abbruch: kein Zugriffstoken.');
    return;
  }

  let liste = [];
  try {
    liste = diagnoseListe();
  } catch (e) {
    log_('FEHLER in diagnoseListe: ' + e.message);
  }

  // Für Detail und FIT bevorzugt eine Aktivität mit GPS-Spur
  const mitSpur = liste.filter(function (a) { return a.hasPolyline === true; });
  const beispiel = mitSpur.length ? mitSpur[0] : liste[0];
  if (beispiel) {
    log_('Beispiel-Aktivität für Detail und FIT: Typ ' + typKey_(beispiel) +
      ', hasPolyline ' + beispiel.hasPolyline + (WERTE_LOGGEN ? ', ID ' + beispiel.activityId : ''));
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

  try {
    diagnoseHistorie();
  } catch (e) {
    log_('FEHLER in diagnoseHistorie: ' + e.message);
  }

  log_('===== Diagnose beendet =====');
}

// ---------------------------------------------------------------------------
// 1. Zugriffstoken
// ---------------------------------------------------------------------------

/**
 * Holt ein frisches Zugriffstoken und loggt den Aufbau der Antwort (ohne Tokenwert).
 * Legt das Token für die übrigen Diagnosen im Script-Cache ab.
 * @return {string|null} Zugriffstoken oder null
 */
function diagnoseToken() {
  log_('--- 1. Zugriffstoken ---');
  const apiKey = PropertiesService.getScriptProperties().getProperty('GARMIN_API_KEY');
  if (!apiKey) {
    log_('FEHLER: Script Property GARMIN_API_KEY fehlt.');
    return null;
  }

  const t0 = Date.now();
  const antwort = UrlFetchApp.fetch(GARMIN_TOKEN_URL, {
    method: 'post',
    headers: { Authorization: 'ApiKey ' + apiKey },
    muteHttpExceptions: true
  });
  const code = antwort.getResponseCode();
  const text = antwort.getContentText();
  log_('HTTP ' + code + ' in ' + (Date.now() - t0) + ' ms, Content-Type: ' +
    (kopfzeilen_(antwort)['content-type'] || '-') + ', Länge: ' + text.length + ' Zeichen');
  ratenKopfzeilenLoggen_(antwort);

  if (code !== 200) {
    // Fehlertexte enthalten kein Token, Kürzen schützt trotzdem vor langen Antworten
    log_('Antwort (gekürzt): ' + text.substring(0, 300));
    return null;
  }

  let token = null;
  let daten = null;
  try {
    daten = JSON.parse(text);
  } catch (e) {
    daten = null;
  }

  if (daten && typeof daten === 'object') {
    log_('Antwort ist JSON mit Feldern: ' + Object.keys(daten).map(function (k) {
      return k + ' (' + typ_(daten[k]) + ')';
    }).join(', '));
    // Unkritische Felder mit Wert zeigen, alles mit „token“, „key“ oder „secret“ im Namen maskieren
    Object.keys(daten).forEach(function (k) {
      if (/token|key|secret|jwt/i.test(k) && k !== 'token_type' && k !== 'tokenType') return;
      if (typeof daten[k] === 'number' || typeof daten[k] === 'boolean' ||
          (typeof daten[k] === 'string' && daten[k].length < 60)) {
        log_('  ' + k + ' = ' + daten[k]);
      }
    });
    const kandidaten = ['access_token', 'accessToken', 'token'];
    for (let i = 0; i < kandidaten.length; i++) {
      if (typeof daten[kandidaten[i]] === 'string') {
        token = daten[kandidaten[i]];
        log_('Token gefunden im Feld „' + kandidaten[i] + '“, Länge ' + token.length + ' Zeichen.');
        break;
      }
    }
    if (!token) log_('WARNUNG: Kein bekanntes Token-Feld gefunden. Feldnamen oben prüfen.');
  } else if (/^\S+$/.test(text.trim())) {
    token = text.trim();
    log_('Antwort ist kein JSON, sondern reiner Text ohne Leerzeichen. Wird als Token verwendet, Länge ' +
      token.length + ' Zeichen.');
  } else {
    log_('WARNUNG: Antwort ist weder JSON noch ein einzelnes Token.');
  }

  if (token) {
    CacheService.getScriptCache().put(TOKEN_CACHE_SCHLUESSEL, token, TOKEN_CACHE_SEKUNDEN);
  }
  return token;
}

/** Liefert das Token aus dem Cache oder holt ein neues. */
function token_() {
  const gecacht = CacheService.getScriptCache().get(TOKEN_CACHE_SCHLUESSEL);
  return gecacht || diagnoseToken();
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
  const params = {
    startDate: datum_(vor30),
    endDate: datum_(heute),
    start: 0,
    limit: 99
  };
  log_('Zeitraum ' + params.startDate + ' bis ' + params.endDate);

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
    'elapsedDuration', 'duration', 'elevationGain', 'averageHR', 'manufacturer', 'hasPolyline'];
  liste.forEach(function (a, i) {
    let zeile = (i + 1) + '. ' + typKey_(a);
    if (WERTE_LOGGEN) {
      zeile += ' | ' + a.startTimeLocal + ' | ' + runden_(a.distance / 1000, 2) + ' km | ' +
        runden_(a.movingDuration / 60, 1) + ' min bewegt | ' + runden_(a.elapsedDuration / 60, 1) +
        ' min gesamt | ' + runden_(a.elevationGain, 0) + ' hm | Puls ' + a.averageHR +
        ' | ' + a.manufacturer + ' | Spur ' + a.hasPolyline + ' | ID ' + a.activityId;
    } else {
      const fehlend = wichtig.filter(function (k) { return a[k] === undefined || a[k] === null; });
      zeile += ' | hasPolyline ' + a.hasPolyline + ' | fehlende Felder: ' + (fehlend.join(', ') || 'keine');
    }
    log_(zeile);
  });

  log_('Aufbau activityType (Beispiel): ' + JSON.stringify(liste[0].activityType));
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

  ['summaryDTO', 'metadataDTO', 'activityTypeDTO', 'timeZoneUnitDTO'].forEach(function (teil) {
    const o = d[teil];
    if (!o || typeof o !== 'object') {
      log_(teil + ': nicht vorhanden');
      return;
    }
    log_(teil + ' (' + Object.keys(o).length + ' Felder):');
    if (WERTE_LOGGEN) {
      logLang_(JSON.stringify(o));
    } else {
      logLang_(Object.keys(o).map(function (k) { return k + ':' + typ_(o[k]); }).join(', '));
    }
  });

  // Hinweise auf das Aufzeichnungsgerät
  const meta = d.metadataDTO || {};
  const geraeteFelder = Object.keys(meta).filter(function (k) { return /device|manufacturer|product/i.test(k); });
  log_('Geräte-Felder in metadataDTO: ' + (geraeteFelder.join(', ') || 'keine'));
  if (WERTE_LOGGEN) {
    geraeteFelder.forEach(function (k) { log_('  ' + k + ' = ' + JSON.stringify(meta[k])); });
  }
  log_('splitSummaries: ' + (Array.isArray(d.splitSummaries) ? d.splitSummaries.length + ' Einträge' : 'keine'));
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
  const antwort = garminAbruf_(PFAD_DATEI + activityId, null);
  if (antwort.getResponseCode() !== 200) return;

  const blob = antwort.getBlob();
  const groesse = blob.getBytes().length;
  log_('Content-Type: ' + (kopfzeilen_(antwort)['content-type'] || '-') + ', Größe: ' +
    runden_(groesse / 1024, 1) + ' KB, Dateiname laut Kopfzeile: ' +
    (kopfzeilen_(antwort)['content-disposition'] || '-'));

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
    log_('Datei: ' + datei.getName() + ', ' + runden_(bytes.length / 1024, 1) + ' KB');
    if (!/\.fit$/i.test(datei.getName() || '') && !istFit_(bytes)) {
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
 * Verkettete FIT-Dateien und Prüfsummen werden in v0.1 nicht beachtet.
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
// 5. Historie: Wie weit reicht die API zurück?
// ---------------------------------------------------------------------------

/**
 * Blättert durch alle Aktivitäten (ohne Datumsfilter) und zählt pro Jahr und
 * Garmin-Typ. Klärt, wie weit die Historie reicht, und liefert die Grundlage
 * für die Zuordnung Garmin-Typ → Sportart.
 */
function diagnoseHistorie() {
  log_('--- 5. Historie ---');
  const proSeite = 99;
  const maxSeiten = 60; // Schutz: höchstens ca. 6000 Aktivitäten
  const proJahr = {};
  const proTyp = {};
  let gesamt = 0;
  let aeltestes = null;
  let seiten = 0;

  for (let seite = 0; seite < maxSeiten; seite++) {
    const liste = garminJson_(PFAD_LISTE, { start: seite * proSeite, limit: proSeite, sortOrder: 'desc' }, true);
    seiten++;
    if (!Array.isArray(liste) || !liste.length) break;
    liste.forEach(function (a) {
      gesamt++;
      const jahr = String(a.startTimeLocal || '????').substring(0, 4);
      proJahr[jahr] = (proJahr[jahr] || 0) + 1;
      const t = typKey_(a);
      proTyp[t] = (proTyp[t] || 0) + 1;
      if (a.startTimeLocal && (!aeltestes || a.startTimeLocal < aeltestes)) aeltestes = a.startTimeLocal;
    });
    if (liste.length < proSeite) break;
    Utilities.sleep(300); // Ratenlimits sind unbekannt, deshalb kurze Pause
  }

  log_('Seiten abgerufen: ' + seiten + ', Aktivitäten gesamt: ' + gesamt);
  log_('Älteste Aktivität: Jahr ' + (aeltestes ? aeltestes.substring(0, 4) : '-') +
    (WERTE_LOGGEN && aeltestes ? ' (' + aeltestes + ')' : ''));
  log_('Pro Jahr: ' + Object.keys(proJahr).sort().map(function (j) { return j + '=' + proJahr[j]; }).join(', '));
  log_('Pro Garmin-Typ: ' + Object.keys(proTyp).sort(function (x, y) { return proTyp[y] - proTyp[x]; })
    .map(function (t) { return t + '=' + proTyp[t]; }).join(', '));
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/**
 * Ruft einen Garmin-Endpunkt mit dem Zugriffstoken auf und loggt Status und Ratenkopfzeilen.
 * @param {string} pfad
 * @param {Object|null} params Query-Parameter
 * @param {boolean=} leise nur Fehler loggen
 * @return {GoogleAppsScript.URL_Fetch.HTTPResponse}
 */
function garminAbruf_(pfad, params, leise) {
  const url = GARMIN_BASIS + pfad + query_(params);
  const t0 = Date.now();
  const antwort = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token_(), Accept: 'application/json' },
    muteHttpExceptions: true
  });
  const code = antwort.getResponseCode();
  if (!leise || code !== 200) {
    // Pfad ohne IDs loggen, wenn keine Werte geloggt werden sollen
    const anzeigePfad = WERTE_LOGGEN ? pfad : pfad.replace(/\/\d+(?=\/|$)/g, '/{id}');
    log_('GET ' + anzeigePfad + query_(params) + ' → HTTP ' + code + ' in ' + (Date.now() - t0) + ' ms');
    ratenKopfzeilenLoggen_(antwort);
  }
  if (code === 401) log_('  Hinweis: 401 heißt Token ungültig oder falsches Format im Authorization-Kopf.');
  if (code === 429) log_('  Hinweis: 429 heißt Ratenlimit erreicht.');
  if (code !== 200) log_('  Antwort (gekürzt): ' + antwort.getContentText().substring(0, 300));
  return antwort;
}

/** Wie garminAbruf_, liefert aber das geparste JSON (oder null). */
function garminJson_(pfad, params, leise) {
  const antwort = garminAbruf_(pfad, params, leise);
  if (antwort.getResponseCode() !== 200) return null;
  try {
    return JSON.parse(antwort.getContentText());
  } catch (e) {
    log_('WARNUNG: Antwort ist kein JSON: ' + e.message);
    return null;
  }
}

/** Baut den Query-String. */
function query_(params) {
  if (!params) return '';
  const teile = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  });
  return teile.length ? '?' + teile.join('&') : '';
}

/** Kopfzeilen mit kleingeschriebenen Namen. */
function kopfzeilen_(antwort) {
  const roh = antwort.getAllHeaders();
  const k = {};
  Object.keys(roh).forEach(function (n) { k[n.toLowerCase()] = String(roh[n]); });
  return k;
}

/** Loggt Kopfzeilen, die nach Ratenlimit aussehen. */
function ratenKopfzeilenLoggen_(antwort) {
  const k = kopfzeilen_(antwort);
  const treffer = Object.keys(k).filter(function (n) { return /rate|limit|retry|quota/i.test(n); });
  if (treffer.length) {
    log_('  Ratenkopfzeilen: ' + treffer.map(function (n) { return n + '=' + k[n]; }).join(', '));
  }
}

function typKey_(a) {
  return (a && a.activityType && a.activityType.typeKey) || '?';
}

function typ_(wert) {
  if (wert === null) return 'null';
  if (Array.isArray(wert)) return 'array[' + wert.length + ']';
  return typeof wert;
}

function datum_(d) {
  return Utilities.formatDate(d, ZEITZONE, 'yyyy-MM-dd');
}

function runden_(zahl, stellen) {
  if (typeof zahl !== 'number' || isNaN(zahl)) return zahl;
  const f = Math.pow(10, stellen);
  return Math.round(zahl * f) / f;
}

function log_(text) {
  console.log(text);
}

/** Loggt lange Texte in Stücken, damit das Protokoll nichts abschneidet. */
function logLang_(text) {
  for (let i = 0; i < text.length; i += 4000) {
    console.log(text.substring(i, i + 4000));
  }
}

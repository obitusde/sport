/**
 * Garmin.gs – Zugriff auf die Garmin Connect Personal API
 * Version: 0.2.0 (2026-11-17)
 *
 * Gemeinsam genutzt von Diagnose.gs und Sammler.gs.
 * Voraussetzung: Script Property GARMIN_API_KEY.
 *
 * Gesichert durch Diagnose v0.1.0 (2026-11-17):
 * - Die Token-Antwort ist reiner Text (Content-Type text/plain), kein JSON.
 * - Aufrufe mit „Authorization: Bearer <token>“ funktionieren.
 * - Die Liste liefert nur gefüllte Felder, hasPolyline fehlt z. B. meist.
 * - Die Historie reicht über die Liste ohne Datumsfilter vollständig zurück.
 * - Der Download der Originaldatei verlangt einen passenden Accept-Kopf
 *   (mit „application/json“ antwortet Garmin mit HTTP 406).
 *
 * Datenschutz: API-Schlüssel und Token werden nie geloggt. Aktivitäts-IDs in
 * geloggten Pfaden werden durch {id} ersetzt.
 */

const GARMIN_BASIS = 'https://personal.connectapi.garmin.com';
const GARMIN_TOKEN_URL = GARMIN_BASIS + '/personalapitoken-service/personal-api/personal-api-key/token';
const PFAD_LISTE = '/activitylist-service/activities/search/activities';
const PFAD_DETAIL = '/activity-service/activity/';
const PFAD_DATEI = '/download-service/files/activity/';
const LISTE_PRO_SEITE = 99;
const LISTE_MAX_SEITEN = 100; // Schutz: höchstens ca. 9900 Aktivitäten pro Abruf
const TOKEN_CACHE_SCHLUESSEL = 'garminZugriffstoken';
const TOKEN_CACHE_SEKUNDEN = 6 * 60 * 60; // CacheService erlaubt höchstens 6 Stunden

/**
 * Liefert ein Zugriffstoken, aus dem Cache oder frisch von Garmin.
 * @param {boolean=} erzwingen immer ein neues Token holen
 * @return {string}
 * @throws {Error} wenn kein Token geholt werden kann
 */
function garminToken_(erzwingen) {
  const cache = CacheService.getScriptCache();
  if (!erzwingen) {
    const gecacht = cache.get(TOKEN_CACHE_SCHLUESSEL);
    if (gecacht) return gecacht;
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty('GARMIN_API_KEY');
  if (!apiKey) throw new Error('Script Property GARMIN_API_KEY fehlt.');

  const antwort = UrlFetchApp.fetch(GARMIN_TOKEN_URL, {
    method: 'post',
    headers: { Authorization: 'ApiKey ' + apiKey },
    muteHttpExceptions: true
  });
  const code = antwort.getResponseCode();
  if (code !== 200) {
    throw new Error('Garmin-Token: HTTP ' + code + '. Ist der Garmin-API-Schlüssel abgelaufen oder gelöscht? ' +
      'Antwort: ' + antwort.getContentText().substring(0, 200));
  }

  let token = antwort.getContentText().trim();
  // Rückfall, falls Garmin die Antwort künftig als JSON liefert
  if (token.charAt(0) === '{') {
    const daten = JSON.parse(token);
    token = daten.access_token || daten.accessToken || daten.token || '';
  }
  if (!token || /\s/.test(token)) throw new Error('Garmin-Token: unerwartetes Antwortformat.');

  cache.put(TOKEN_CACHE_SCHLUESSEL, token, TOKEN_CACHE_SEKUNDEN);
  return token;
}

/**
 * Ruft einen Garmin-Endpunkt auf. Bei HTTP 401 wird einmal mit frischem Token wiederholt.
 * @param {string} pfad
 * @param {Object|null} params Query-Parameter
 * @param {{accept: (string|undefined), leise: (boolean|undefined)}=} optionen
 *   accept: Accept-Kopf (Standard application/json), leise: nur Fehler loggen
 * @return {GoogleAppsScript.URL_Fetch.HTTPResponse}
 */
function garminAbruf_(pfad, params, optionen) {
  optionen = optionen || {};
  const url = GARMIN_BASIS + pfad + query_(params);
  const anzeige = pfad.replace(/\/\d+(?=\/|$)/g, '/{id}') + query_(params);

  let antwort = null;
  for (let versuch = 1; versuch <= 2; versuch++) {
    const t0 = Date.now();
    antwort = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + garminToken_(versuch === 2),
        Accept: optionen.accept || 'application/json'
      },
      muteHttpExceptions: true
    });
    const code = antwort.getResponseCode();
    if (!optionen.leise || code !== 200) {
      log_('GET ' + anzeige + ' → HTTP ' + code + ' in ' + (Date.now() - t0) + ' ms');
      ratenKopfzeilenLoggen_(antwort);
    }
    if (code !== 401) break;
    log_('  HTTP 401: Token ungültig, hole ein neues und versuche es noch einmal.');
  }

  const code = antwort.getResponseCode();
  if (code === 429) log_('  Hinweis: 429 heißt Ratenlimit erreicht.');
  if (code !== 200) log_('  Antwort (gekürzt): ' + antwort.getContentText().substring(0, 300));
  return antwort;
}

/**
 * Wie garminAbruf_, liefert aber das geparste JSON.
 * @return {*} JSON oder null bei Fehler
 */
function garminJson_(pfad, params, optionen) {
  const antwort = garminAbruf_(pfad, params, optionen);
  if (antwort.getResponseCode() !== 200) return null;
  try {
    return JSON.parse(antwort.getContentText());
  } catch (e) {
    log_('WARNUNG: Antwort ist kein JSON: ' + e.message);
    return null;
  }
}

/**
 * Holt alle Aktivitäten, seitenweise, aufsteigend nach Startzeit.
 * Ohne Datumsangaben kommt die ganze Historie.
 * @param {string=} vonDatum YYYY-MM-DD (inklusiv)
 * @param {string=} bisDatum YYYY-MM-DD (inklusiv)
 * @return {Object[]} SummarizedActivityDTO
 * @throws {Error} wenn eine Seite nicht geladen werden kann
 */
function garminAktivitaeten_(vonDatum, bisDatum) {
  const alle = [];
  for (let seite = 0; seite < LISTE_MAX_SEITEN; seite++) {
    const params = { start: seite * LISTE_PRO_SEITE, limit: LISTE_PRO_SEITE, sortOrder: 'asc' };
    if (vonDatum) params.startDate = vonDatum;
    if (bisDatum) params.endDate = bisDatum;
    const liste = garminJson_(PFAD_LISTE, params, { leise: true });
    if (!Array.isArray(liste)) throw new Error('Aktivitätsliste konnte nicht geladen werden (Seite ' + (seite + 1) + ').');
    Array.prototype.push.apply(alle, liste);
    if (liste.length < LISTE_PRO_SEITE) return alle;
    Utilities.sleep(300); // Ratenlimits sind unbekannt, deshalb kurze Pause
  }
  log_('WARNUNG: Höchstzahl an Seiten erreicht, Liste womöglich unvollständig.');
  return alle;
}

/** Garmin-Typ einer Aktivität, z. B. „running“. */
function typKey_(a) {
  return (a && a.activityType && a.activityType.typeKey) || '?';
}

/** GPS vorhanden, erkennbar an der Startkoordinate. */
function hatGps_(a) {
  return a.startLatitude !== undefined && a.startLatitude !== null;
}

/** Loggt Kopfzeilen, die nach Ratenlimit aussehen. */
function ratenKopfzeilenLoggen_(antwort) {
  const k = kopfzeilen_(antwort);
  const treffer = Object.keys(k).filter(function (n) { return /rate|limit|retry|quota/i.test(n); });
  if (treffer.length) {
    log_('  Ratenkopfzeilen: ' + treffer.map(function (n) { return n + '=' + k[n]; }).join(', '));
  }
}

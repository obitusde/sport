/**
 * Spuren.gs – GPS-Spuren für die Karte (Heatmap) und die Detailansicht
 * Version: 0.12.0 (2026-11-18)
 *
 * Quelle: Originaldatei der Aktivität (ZIP mit FIT), Garmin-Endpunkt
 * /download-service/files/activity/{id} mit „Accept: *\/*“ (siehe Diagnose 0.1.1).
 * Aus den record-Nachrichten (Feld 0/1, Semicircles) werden die Punkte gelesen, mit
 * Douglas-Peucker vereinfacht und als Google-Polyline (Präzision 1e-5) gespeichert:
 *   grob  Toleranz 30 m – für die Heatmap aller Spuren
 *   fein  Toleranz 5 m (bei sehr langen Spuren größer, max. 45 000 Zeichen) – Detailansicht
 * Blatt „Spuren“: activityId, sportart, start, status (ok | keine | fehler <HTTP>), punkte,
 * grob, fein, bearbeitet. Gespeichert werden Spuren für SPUREN_SPORTARTEN, nur Aktivitäten
 * mit GPS, ohne unrealistische (z. B. Autofahrt mit weiterlaufender Aufzeichnung).
 * Entscheidung 0.9.0: Spuren im Sheet statt als einzelne Drive-Dateien (schneller, ein Abruf).
 *
 * Funktionen im Script-Editor:
 *   diagnoseSpuren()          lädt 3 Spuren, loggt nur Größen und Zeiten, speichert nichts
 *   spurenNachladen()         verarbeitet ältere Aktivitäten, bis ca. 4,5 Minuten um sind
 *   spurenZeitgeberEinrichten() alle 10 Minuten nachladen, bis alles da ist (löscht sich dann)
 * sammeln() lädt Spuren neuer Aktivitäten automatisch mit.
 *
 * Aktionen der Web-App: spuren (alle grob), spur (id, fein).
 *
 * Änderungen 0.10.0: Filter für Zugfahrten und GPS-Sprünge (spurFiltern_). Die FIT-Punkte
 *   tragen jetzt ihren Zeitstempel (Feld 253, auch kompakte Zeitstempel). Teile mit
 *   unrealistischem Tempo (über 60 Sekunden gemessen) und Sprünge werden herausgeschnitten,
 *   die Spur besteht dann aus mehreren Teilen. Mehrere Polylines sind durch ein Leerzeichen
 *   getrennt (kommt in Polylines nie vor). Neue Spalten „version“ und „entfernt_km“:
 *   Spuren mit älterer Version gelten als offen und werden vom Zeitgeber neu berechnet.
 *   Neue Diagnose: diagnoseSpurFilter() lädt die neuesten Spuren und loggt nur, was der
 *   Filter entfernen würde.
 * Änderungen 0.10.1: Die Diagnose meldete bei allen Spuren „keine“. diagnoseSpurFilter
 *   loggt jetzt den Grund (HTTP, Dateigröße, FIT gefunden, Punkte, Zeitstempel, Lesefehler,
 *   was der Filter entfernt). Schutz: Eine vorhandene gute Spur wird nicht mehr durch ein
 *   Ergebnis ohne Spur ersetzt; liefern 5 solche Spuren hintereinander nichts, bricht das
 *   Nachladen ab (dann stimmt beim Abruf vermutlich etwas nicht).
 * Änderungen 0.11.0: Ältere Aktivitäten haben statt FIT oft eine GPX- oder TCX-Datei im ZIP
 *   (Diagnose 0.10.1: „1 Datei im ZIP, keine FIT-Datei“). xmlPunkte_ liest Punkte und Zeit aus
 *   GPX (trkpt) und TCX (Trackpoint). SPUR_VERSION 3: Nur Einträge ohne Spur (keine, fehler)
 *   werden noch einmal versucht; vorhandene gute Spuren (Version 2) bleiben, damit nicht
 *   wieder die ganze Historie von Garmin geladen wird. spurenStand() loggt eine Übersicht
 *   (für die Wartung in der App).
 * Änderungen 0.12.0: diagnoseSpurFilter listet auch erfolgreiche Spuren (Dateityp, Punkte),
 *   damit ein leeres Protokoll nicht missverständlich ist.
 */

const BLATT_SPUREN = 'Spuren';
const SPUREN_SPALTEN = ['activityId', 'sportart', 'start', 'status', 'punkte', 'grob', 'fein', 'bearbeitet', 'version', 'entfernt_km'];
/**
 * Version der Spur-Berechnung. Ältere Einträge werden neu berechnet, außer gute Spuren ab
 * SPUR_VERSION_OK (der Filter hat sich seitdem nicht geändert).
 */
const SPUR_VERSION = 3;
const SPUR_VERSION_OK = 2;
/**
 * Filter je Sportart: kmh = höchstes Tempo über 60 Sekunden (null = kein Tempofilter, Ski
 * hat Lifte und schnelle Abfahrten), luecke = größter Abstand zweier Punkte in Metern,
 * sprung = Tempo zwischen zwei Punkten, ab dem ein Punkt als GPS-Sprung gilt.
 */
const SPUR_FILTER = {
  wandern: { kmh: 15, luecke: 400, sprung: 100 },
  laufen: { kmh: 30, luecke: 400, sprung: 100 },
  rad: { kmh: 80, luecke: 1000, sprung: 160 },
  ski: { kmh: null, luecke: 1500, sprung: 200 }
};
const SPUR_FENSTER_S = 60;
const SPUR_MIN_TEIL_M = 150;
const SPUREN_SPORTARTEN = ['wandern', 'rad', 'ski', 'laufen'];
const SPUR_TOLERANZ_GROB = 30;
const SPUR_TOLERANZ_FEIN = 5;
const SPUR_MAX_ZEICHEN = 45000;

// ---------------------------------------------------------------------------
// Öffentliche Funktionen
// ---------------------------------------------------------------------------

/** Diagnose: drei neueste Kandidaten laden und auswerten, nichts speichern. */
function diagnoseSpuren() {
  log_('===== Diagnose Spuren =====');
  const kandidaten = spurKandidaten_().slice(0, 3);
  log_('Offene Aktivitäten mit GPS: ' + spurKandidaten_().length);
  kandidaten.forEach(function (k) {
    const t0 = Date.now();
    const s = spurLaden_(k.id, k.sportart);
    log_(k.sportart + ': Status ' + s.status + ', Punkte ' + s.punkte + ', grob ' + (s.grob || '').length +
      ' Zeichen, fein ' + (s.fein || '').length + ' Zeichen, ' + (Date.now() - t0) + ' ms');
  });
}

/**
 * Diagnose: lädt die neuesten Spuren (Standard 40), wendet den Filter an und loggt nur
 * Zählungen und entfernte Kilometer, keine Orte oder Koordinaten. Speichert nichts.
 */
function diagnoseSpurFilter(anzahl) {
  anzahl = anzahl || 40;
  log_('===== Diagnose Spur-Filter (neueste ' + anzahl + ') =====');
  const kandidaten = spurKandidaten_().slice(0, anzahl);
  let mitSchnitt = 0;
  let ohneZeit = 0;
  kandidaten.forEach(function (k, n) {
    const s = spurLaden_(k.id, k.sportart);
    if (s.status !== 'ok') {
      log_((n + 1) + '. ' + k.sportart + ': Status ' + s.status + ' – ' + (s.grund || '') +
        (s.punkte ? ', ' + s.punkte + ' Punkte, mit Zeit ' + s.mitZeit + ', ' + s.teile + ' Teile, Sprünge ' + s.spruenge +
          ', zu schnell ' + runden_(s.schnellKm || 0, 1) + ' km' : ''));
      return;
    }
    if (!s.mitZeit) ohneZeit++;
    const quelle = s.format || 'FIT';
    if (s.entferntKm > 0 || s.teile > 1) {
      mitSchnitt++;
      log_((n + 1) + '. ' + k.sportart + ' (' + quelle + ', ' + s.punkte + ' Punkte): ' + s.teile + ' Teil(e), entfernt ' + runden_(s.entferntKm, 1) +
        ' km (zu schnell ' + runden_(s.schnellKm, 1) + ' km, Sprünge/Lücken ' + s.spruenge + ')' +
        (s.mitZeit ? '' : ', ohne Zeitstempel'));
    } else {
      log_((n + 1) + '. ' + k.sportart + ' (' + quelle + ', ' + s.punkte + ' Punkte): ok, nichts entfernt' + (s.mitZeit ? '' : ', ohne Zeitstempel'));
    }
    Utilities.sleep(150);
  });
  log_('Geprüft: ' + kandidaten.length + ', davon mit Schnitt: ' + mitSchnitt + ', ohne Zeitstempel: ' + ohneZeit);
}

/** Übersicht: Anzahl Spuren je Status, offene, bereinigte, Zeitgeber. Nur Zählungen. */
function spurenStand() {
  const b = tabelle_().getSheetByName(BLATT_SPUREN);
  const zaehler = {};
  let bereinigt = 0;
  let entferntKm = 0;
  if (b && b.getLastRow() >= 2) {
    const breite = Math.min(b.getLastColumn(), SPUREN_SPALTEN.length);
    b.getRange(2, 1, b.getLastRow() - 1, breite).getValues().forEach(function (z) {
      const status = String(z[3]).indexOf('fehler') === 0 ? 'fehler' : String(z[3]);
      zaehler[status] = (zaehler[status] || 0) + 1;
      if (Number(z[9]) >= 0.1) {
        bereinigt++;
        entferntKm += Number(z[9]);
      }
    });
  }
  log_('Spuren: ' + Object.keys(zaehler).map(function (k) { return k + ' ' + zaehler[k]; }).join(', '));
  log_('Mit Filter bereinigt: ' + bereinigt + ' Spuren, zusammen ' + runden_(entferntKm, 1) + ' km ausgeblendet');
  log_('Noch zu laden oder neu zu berechnen: ' + spurKandidaten_().length);
  const zeitgeber = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'spurenNachladenAutomatisch'; });
  log_('Zeitgeber zum Nachladen: ' + (zeitgeber.length ? 'aktiv' : 'aus'));
}

/** Lädt fehlende Spuren, solange Zeit bleibt. Liefert {verarbeitet, offen}. */
function spurenNachladen(sekunden, maxAnzahl) {
  const budget = (sekunden || 270) * 1000;
  const t0 = Date.now();
  const kandidaten = spurKandidaten_();
  const b = spurenBlatt_();
  const puffer = [];
  let verarbeitet = 0;
  let abbruch = '';
  let ohneSpurFolge = 0;
  const altStatus = {};
  if (b.getLastRow() >= 2) {
    b.getRange(2, 4, b.getLastRow() - 1, 1).getValues().forEach(function (z, n) { altStatus[n + 2] = z[0]; });
  }
  for (let i = 0; i < kandidaten.length; i++) {
    if (Date.now() - t0 > budget || (maxAnzahl && verarbeitet >= maxAnzahl)) break;
    const k = kandidaten[i];
    const s = spurLaden_(k.id, k.sportart);
    if (s.status === 'fehler 429') {
      abbruch = 'Ratenlimit von Garmin erreicht';
      break;
    }
    // Hatte die Aktivität schon eine gute Spur und liefert jetzt keine mehr, stimmt eher
    // beim Abruf etwas nicht. Nach 5 solchen Fällen hintereinander abbrechen.
    const warGut = k.zeile && altStatus[k.zeile] === 'ok';
    ohneSpurFolge = (s.status !== 'ok' && warGut) ? ohneSpurFolge + 1 : 0;
    if (ohneSpurFolge >= 5) {
      abbruch = '5 vorhandene Spuren hintereinander ohne neues Ergebnis (letzte: ' + (s.grund || s.status) + ')';
      break;
    }
    const werte = [k.id, k.sportart, k.start, s.status, s.punkte, s.grob, s.fein, new Date(), SPUR_VERSION,
      s.status === 'ok' ? runden_(s.entferntKm, 2) : ''];
    if (warGut && s.status !== 'ok') {
      // Gute ältere Spur behalten; nur als bearbeitet markieren
      b.getRange(k.zeile, 8, 1, 2).setValues([[new Date(), SPUR_VERSION]]);
    } else if (k.zeile) {
      b.getRange(k.zeile, 1, 1, SPUREN_SPALTEN.length).setValues([werte]); // ältere Version ersetzen
    } else {
      puffer.push(werte);
      if (puffer.length >= 20) spurenSchreiben_(b, puffer);
    }
    verarbeitet++;
    Utilities.sleep(150);
  }
  spurenSchreiben_(b, puffer);
  const offen = kandidaten.length - verarbeitet;
  log_('Spuren: ' + verarbeitet + ' verarbeitet, ' + offen + ' offen' + (abbruch ? ' (' + abbruch + ')' : '') +
    ', ' + Math.round((Date.now() - t0) / 1000) + ' s');
  return { verarbeitet: verarbeitet, offen: offen };
}

function spurenZeitgeberEinrichten() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'spurenNachladenAutomatisch') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('spurenNachladenAutomatisch').timeBased().everyMinutes(10).create();
  log_('Zeitgeber eingerichtet: Spuren werden alle 10 Minuten nachgeladen, bis alle da sind.');
}

/** Vom Zeitgeber aufgerufen; entfernt den Zeitgeber, wenn nichts mehr offen ist. */
function spurenNachladenAutomatisch() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  let ergebnis;
  try {
    ergebnis = spurenNachladen(270);
  } finally {
    lock.releaseLock();
  }
  if (ergebnis && ergebnis.offen === 0) {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'spurenNachladenAutomatisch') ScriptApp.deleteTrigger(t);
    });
    log_('Alle Spuren geladen, Zeitgeber entfernt.');
  }
}

// ---------------------------------------------------------------------------
// Web-App
// ---------------------------------------------------------------------------

/** Alle groben Spuren: {spuren: [[id, sportart, YYYY-MM-DD, polyline], …], offen}. */
function spurenFuerKarte_() {
  const b = tabelle_().getSheetByName(BLATT_SPUREN);
  const spuren = [];
  if (b && b.getLastRow() >= 2) {
    b.getRange(2, 1, b.getLastRow() - 1, 6).getValues().forEach(function (z) {
      if (z[3] !== 'ok' || !z[5]) return;
      const start = z[2] instanceof Date ? Utilities.formatDate(z[2], ZEITZONE, 'yyyy-MM-dd') : String(z[2]).substring(0, 10);
      spuren.push([String(z[0]), z[1], start, z[5]]);
    });
  }
  return { spuren: spuren, offen: spurKandidaten_().length };
}

/** Feine Spur einer Aktivität: {fein} oder {fein: null}. */
function spurFein_(id) {
  if (!/^\d+$/.test(String(id || ''))) throw new Error('ungültige id');
  const b = tabelle_().getSheetByName(BLATT_SPUREN);
  if (!b || b.getLastRow() < 2) return { fein: null };
  const treffer = b.getRange(2, 1, b.getLastRow() - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!treffer) return { fein: null };
  const z = b.getRange(treffer.getRow(), 1, 1, SPUREN_SPALTEN.length).getValues()[0];
  return {
    fein: z[3] === 'ok' ? (z[6] || z[5]) : null, status: z[3],
    entferntKm: typeof z[9] === 'number' ? z[9] : null
  };
}

// ---------------------------------------------------------------------------
// Laden und Auswerten
// ---------------------------------------------------------------------------

function spurenBlatt_() {
  const ss = tabelle_();
  let b = ss.getSheetByName(BLATT_SPUREN);
  if (!b) {
    b = ss.insertSheet(BLATT_SPUREN);
    b.getRange(1, 1, 1, SPUREN_SPALTEN.length).setValues([SPUREN_SPALTEN]).setFontWeight('bold');
    b.setFrozenRows(1);
  } else if (b.getRange(1, 1, 1, SPUREN_SPALTEN.length).getValues()[0].join('|') !== SPUREN_SPALTEN.join('|')) {
    // Neue Spalten (ab 0.10.0) in der Kopfzeile ergänzen
    b.getRange(1, 1, 1, SPUREN_SPALTEN.length).setValues([SPUREN_SPALTEN]).setFontWeight('bold');
  }
  return b;
}

function spurenSchreiben_(b, puffer) {
  if (!puffer.length) return;
  b.getRange(b.getLastRow() + 1, 1, puffer.length, SPUREN_SPALTEN.length).setValues(puffer);
  b.getRange(b.getLastRow() - puffer.length + 1, 1, puffer.length, 1).setNumberFormat('0');
  puffer.length = 0;
}

/**
 * Aktivitäten mit GPS in SPUREN_SPORTARTEN ohne aktuelle Spur, neueste zuerst. Hat eine
 * Aktivität schon eine Spur älterer Version, steht deren Zeilennummer in „zeile“.
 */
function spurKandidaten_() {
  const akt = tabelle_().getSheetByName(BLATT_AKTIVITAETEN);
  if (!akt || akt.getLastRow() < 2) return [];
  const vorhanden = {};
  const b = tabelle_().getSheetByName(BLATT_SPUREN);
  if (b && b.getLastRow() >= 2) {
    const breite = Math.min(b.getLastColumn(), SPUREN_SPALTEN.length);
    b.getRange(2, 1, b.getLastRow() - 1, breite).getValues().forEach(function (z, n) {
      const version = Number(z[8]) || 0;
      vorhanden[String(z[0])] = { zeile: n + 2, aktuell: version >= SPUR_VERSION || (z[3] === 'ok' && version >= SPUR_VERSION_OK) };
    });
  }
  const i = {};
  SPALTEN.forEach(function (n, k) { i[n] = k; });
  return akt.getRange(2, 1, akt.getLastRow() - 1, SPALTEN.length).getValues()
    .filter(function (z) {
      const v = vorhanden[String(z[i.activityId])];
      return z[i.hat_gps] === true && SPUREN_SPORTARTEN.indexOf(z[i.sportart]) >= 0 && !(v && v.aktuell) &&
        meldungPlausibel_({ sportart: z[i.sportart], km: Number(z[i.distanz_km]) || 0, min: Number(z[i.dauer_min]) || 0 });
    })
    .map(function (z) {
      const v = vorhanden[String(z[i.activityId])];
      return { id: String(z[i.activityId]), sportart: z[i.sportart], start: z[i.start], zeile: v ? v.zeile : null };
    })
    .sort(function (x, y) { return (y.start instanceof Date ? y.start.getTime() : 0) - (x.start instanceof Date ? x.start.getTime() : 0); });
}

/**
 * Lädt die FIT-Datei, filtert Zugfahrten und Sprünge und liefert
 * {status, punkte, grob, fein, teile, entferntKm, schnellKm, spruenge, mitZeit}.
 */
function spurLaden_(id, sportart) {
  const leer = function (status, punkte) {
    return { status: status, punkte: punkte || 0, grob: '', fein: '', teile: 0, entferntKm: 0, schnellKm: 0, spruenge: 0, mitZeit: false };
  };
  let antwort;
  try {
    antwort = garminAbruf_(PFAD_DATEI + id, null, { accept: '*/*', leise: true });
  } catch (e) {
    return leer('fehler netz');
  }
  if (antwort.getResponseCode() !== 200) return leer('fehler ' + antwort.getResponseCode());
  const grund = ['HTTP 200, ' + antwort.getBlob().getBytes().length + ' Byte, Typ ' + (antwort.getBlob().getContentType() || '?')];
  let dateien;
  try {
    const blob = antwort.getBlob().setContentType('application/zip');
    dateien = Utilities.unzip(blob);
    grund.push(dateien.length + ' Datei(en) im ZIP');
  } catch (e) {
    dateien = [antwort.getBlob()];
    grund.push('kein ZIP');
  }
  let punkte = [];
  let fitGefunden = 0;
  let format = null;
  dateien.forEach(function (d) {
    const bytes = d.getBytes();
    if (!punkte.length && bytes.length > 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54) {
      fitGefunden++;
      try {
        punkte = fitPunkte_(bytes);
      } catch (e) {
        grund.push('Lesefehler: ' + e.message);
        punkte = [];
      }
    }
  });
  grund.push(fitGefunden ? 'FIT gefunden' : 'keine FIT-Datei');
  if (!fitGefunden) {
    // Ältere Aktivitäten: GPX oder TCX (Text/XML)
    dateien.forEach(function (d) {
      if (punkte.length) return;
      try {
        const name = String(d.getName() || '');
        const endung = name.indexOf('.') >= 0 ? name.split('.').pop().toLowerCase() : '?';
        const x = xmlPunkte_(d.getDataAsString('UTF-8'));
        grund.push('Datei .' + endung + (x.format ? ' (' + x.format + ', ' + x.punkte.length + ' Punkte)' : ' (kein GPX/TCX)'));
        punkte = x.punkte;
        format = x.format;
      } catch (e) {
        grund.push('Lesefehler: ' + e.message);
      }
    });
  }
  if (punkte.length < 2) {
    const r = leer('keine', punkte.length);
    r.grund = grund.join(', ');
    return r;
  }
  const f = spurFiltern_(punkte, sportart);
  const ergebnis = {
    status: 'ok', punkte: punkte.length, grob: '', fein: '', teile: f.teile.length,
    entferntKm: f.entferntM / 1000, schnellKm: f.schnellM / 1000, spruenge: f.spruenge, mitZeit: f.mitZeit,
    format: format || 'FIT'
  };
  if (!f.teile.length) {
    ergebnis.status = 'keine';
    ergebnis.grund = grund.join(', ') + ', Filter hat alles entfernt';
    return ergebnis;
  }
  const kodieren = function (toleranz) {
    return f.teile.map(function (t) { return polylineKodieren_(vereinfachen_(t, toleranz)); }).join(' ');
  };
  ergebnis.grob = kodieren(SPUR_TOLERANZ_GROB);
  let toleranz = SPUR_TOLERANZ_FEIN;
  let fein = kodieren(toleranz);
  while (fein.length > SPUR_MAX_ZEICHEN && toleranz < 200) {
    toleranz *= 2;
    fein = kodieren(toleranz);
  }
  ergebnis.fein = fein.length > SPUR_MAX_ZEICHEN ? '' : fein;
  return ergebnis;
}

/** Abstand in Metern (lokal eben, genügt für kurze Strecken). */
function spurAbstand_(p, q) {
  const breite = (p[0] + q[0]) / 2 * Math.PI / 180;
  const dx = (q[1] - p[1]) * 111320 * Math.cos(breite);
  const dy = (q[0] - p[0]) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Entfernt aus einer Spur [[lat, lon, sekunden|null], …]:
 * 1. Sprünge und Lücken: Abstand zum Vorgänger größer als „luecke“ oder über 50 m mit
 *    einem Tempo über „sprung“ km/h. Dort wird die Linie unterbrochen (keine gerade Linie
 *    über die Lücke, z. B. nach einer Pause im Zug); ein einzelner Ausreißer bleibt als
 *    kurzes Stück übrig und fällt in Schritt 3 weg.
 * 2. Zu schnelle Abschnitte: Luftlinie über mindestens SPUR_FENSTER_S Sekunden schneller
 *    als „kmh“ (Zug, Bus, Auto). Die Punkte dieses Zeitfensters fallen weg.
 * 3. Teile kürzer als SPUR_MIN_TEIL_M (Reste am Bahnhof, Ausreißer).
 * @return {{teile: Array, entferntM: number, schnellM: number, spruenge: number, mitZeit: boolean}}
 */
function spurFiltern_(punkte, sportart) {
  const g = SPUR_FILTER[sportart] || SPUR_FILTER.wandern;
  const mitZeit = punkte.filter(function (p) { return p[2] !== null && p[2] !== undefined; }).length > punkte.length * 0.9;
  let gesamtM = 0;
  for (let i = 1; i < punkte.length; i++) gesamtM += spurAbstand_(punkte[i - 1], punkte[i]);

  // 1. Sprünge und Lücken
  let spruenge = 0;
  let stuecke = [];
  let aktuell = [punkte[0]];
  for (let i = 1; i < punkte.length; i++) {
    const p = punkte[i - 1];
    const q = punkte[i];
    const d = spurAbstand_(p, q);
    const dt = mitZeit && p[2] !== null && q[2] !== null ? q[2] - p[2] : null;
    const sprung = d > g.luecke || (d > 50 && dt !== null && (dt <= 0 || d / dt * 3.6 > g.sprung));
    if (sprung) {
      spruenge++;
      stuecke.push(aktuell);
      aktuell = [];
    }
    aktuell.push(q);
  }
  stuecke.push(aktuell);

  // 2. Zu schnelle Abschnitte
  let schnellM = 0;
  if (mitZeit && g.kmh) {
    const grenzeMs = g.kmh / 3.6;
    const neu = [];
    stuecke.forEach(function (st) {
      const n = st.length;
      const markierung = new Int32Array(n + 1);
      let j = 0;
      for (let i = 0; i < n; i++) {
        if (j < i) j = i;
        while (j < n - 1 && st[j][2] - st[i][2] < SPUR_FENSTER_S) j++;
        const dt = st[j][2] - st[i][2];
        if (dt >= SPUR_FENSTER_S && spurAbstand_(st[i], st[j]) / dt > grenzeMs) {
          markierung[i]++;
          markierung[j + 1]--;
        }
      }
      let zaehler = 0;
      let teil = [];
      for (let i = 0; i < n; i++) {
        zaehler += markierung[i];
        if (zaehler > 0) {
          if (i > 0) schnellM += spurAbstand_(st[i - 1], st[i]);
          if (teil.length) neu.push(teil);
          teil = [];
        } else {
          teil.push(st[i]);
        }
      }
      if (teil.length) neu.push(teil);
    });
    stuecke = neu;
  }

  // 3. Kurze Reste weglassen
  const teile = [];
  let behaltenM = 0;
  stuecke.forEach(function (st) {
    let laenge = 0;
    for (let i = 1; i < st.length; i++) laenge += spurAbstand_(st[i - 1], st[i]);
    if (st.length >= 2 && laenge >= SPUR_MIN_TEIL_M) {
      behaltenM += laenge;
      teile.push(st.map(function (p) { return [p[0], p[1]]; }));
    }
  });
  return { teile: teile, entferntM: Math.max(0, gesamtM - behaltenM), schnellM: schnellM, spruenge: spruenge, mitZeit: mitZeit };
}

/**
 * Liest GPS-Punkte [lat, lon, sekunden|null] aus GPX (trkpt mit lat/lon und time) oder
 * TCX (Trackpoint mit Position/LatitudeDegrees, LongitudeDegrees und Time). Einfache
 * Textsuche statt XML-Parser: schneller und unempfindlich gegen Namensräume.
 * @return {{format: (string|null), punkte: Array}}
 */
function xmlPunkte_(text) {
  const punkte = [];
  const zeit = function (t) {
    const ms = t ? Date.parse(String(t).trim()) : NaN;
    return isNaN(ms) ? null : Math.round(ms / 1000);
  };
  const zahl = function (t) {
    const z = parseFloat(t);
    return isFinite(z) ? z : null;
  };
  if (/<(?:\w+:)?gpx[\s>]/i.test(text)) {
    const re = /<(?:\w+:)?trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?trkpt>)/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const lat = /\blat\s*=\s*["']([^"']+)["']/i.exec(m[1]);
      const lon = /\blon\s*=\s*["']([^"']+)["']/i.exec(m[1]);
      const t = m[2] ? /<(?:\w+:)?time>([^<]+)</i.exec(m[2]) : null;
      const la = lat ? zahl(lat[1]) : null;
      const lo = lon ? zahl(lon[1]) : null;
      if (la !== null && lo !== null && (la !== 0 || lo !== 0)) punkte.push([la, lo, t ? zeit(t[1]) : null]);
    }
    return { format: 'GPX', punkte: punkte };
  }
  if (/<(?:\w+:)?TrainingCenterDatabase[\s>]/i.test(text)) {
    const re = /<(?:\w+:)?Trackpoint>([\s\S]*?)<\/(?:\w+:)?Trackpoint>/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const lat = /<(?:\w+:)?LatitudeDegrees>([^<]+)</i.exec(m[1]);
      const lon = /<(?:\w+:)?LongitudeDegrees>([^<]+)</i.exec(m[1]);
      const t = /<(?:\w+:)?Time>([^<]+)</i.exec(m[1]);
      const la = lat ? zahl(lat[1]) : null;
      const lo = lon ? zahl(lon[1]) : null;
      if (la !== null && lo !== null && (la !== 0 || lo !== 0)) punkte.push([la, lo, t ? zeit(t[1]) : null]);
    }
    return { format: 'TCX', punkte: punkte };
  }
  return { format: null, punkte: punkte };
}

/**
 * Liest alle GPS-Punkte [lat, lon, sekunden] aus den record-Nachrichten (global 20) einer
 * FIT-Datei. Sekunden = FIT-Zeitstempel (Feld 253) oder null. Kompakte Zeitstempel-Köpfe
 * (Bit 7) tragen 5 Bit Versatz zum letzten vollen Zeitstempel (FIT-Protokoll).
 * Gleicher Aufbau wie fitScannen_ in Diagnose.gs.
 */
function fitPunkte_(rohBytes) {
  const b = new Uint8Array(rohBytes.length);
  for (let i = 0; i < rohBytes.length; i++) b[i] = rohBytes[i] & 0xff;
  const kopf0 = b[0];
  const datenGroesse = b[4] + b[5] * 256 + b[6] * 65536 + b[7] * 16777216;
  const ende = Math.min(kopf0 + datenGroesse, b.length);
  const defs = {};
  const punkte = [];
  const faktor = 180 / 2147483648;
  let letzteZeit = null;
  const int32 = function (p, little) {
    return little ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24))
      : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]);
  };
  const uint32 = function (p, little) { return int32(p, little) >>> 0; };
  const daten = function (pos, def, kompaktZeit) {
    if (!def) throw new Error('Datennachricht ohne Definition');
    let zeit = kompaktZeit;
    if (def.zeit >= 0) {
      const z = uint32(pos + def.zeit, def.little);
      if (z !== 0xffffffff) {
        letzteZeit = z;
        zeit = z;
      }
    }
    if (def.global === 20 && def.lat >= 0 && def.lon >= 0) {
      const la = int32(pos + def.lat, def.little);
      const lo = int32(pos + def.lon, def.little);
      if (la !== 0x7fffffff && lo !== 0x7fffffff && (la !== 0 || lo !== 0)) {
        punkte.push([la * faktor, lo * faktor, zeit === undefined ? null : zeit]);
      }
    }
    return pos + def.groesse;
  };
  let pos = kopf0;
  while (pos < ende) {
    const kopf = b[pos++];
    if (kopf & 0x80) {
      let zeit;
      if (letzteZeit !== null) {
        const versatz = kopf & 0x1f;
        zeit = (letzteZeit & ~0x1f) + versatz;
        if (versatz < (letzteZeit & 0x1f)) zeit += 0x20;
        zeit = zeit >>> 0;
        letzteZeit = zeit;
      }
      pos = daten(pos, defs[(kopf >> 5) & 0x03], zeit);
      continue;
    }
    const lokal = kopf & 0x0f;
    if (kopf & 0x40) {
      const little = b[pos + 1] === 0;
      const global = little ? b[pos + 2] + b[pos + 3] * 256 : b[pos + 2] * 256 + b[pos + 3];
      const anzahl = b[pos + 4];
      pos += 5;
      const def = { global: global, little: little, groesse: 0, lat: -1, lon: -1, zeit: -1 };
      for (let i = 0; i < anzahl; i++) {
        if (b[pos] === 0 && b[pos + 1] === 4) def.lat = def.groesse;
        if (b[pos] === 1 && b[pos + 1] === 4) def.lon = def.groesse;
        if (b[pos] === 253 && b[pos + 1] === 4) def.zeit = def.groesse;
        def.groesse += b[pos + 1];
        pos += 3;
      }
      if (kopf & 0x20) {
        const anzahlDev = b[pos++];
        for (let i = 0; i < anzahlDev; i++) {
          def.groesse += b[pos + 1];
          pos += 3;
        }
      }
      defs[lokal] = def;
    } else {
      pos = daten(pos, defs[lokal]);
    }
  }
  return punkte;
}

/** Douglas-Peucker in Metern (lokale Projektion), iterativ. */
function vereinfachen_(punkte, toleranzMeter) {
  const n = punkte.length;
  if (n <= 2) return punkte.slice();
  const lat0 = punkte[0][0] * Math.PI / 180;
  const mx = 111320 * Math.cos(lat0);
  const my = 110540;
  const xy = punkte.map(function (p) { return [p[1] * mx, p[0] * my]; });
  const behalten = new Uint8Array(n);
  behalten[0] = 1;
  behalten[n - 1] = 1;
  const stapel = [[0, n - 1]];
  const t2 = toleranzMeter * toleranzMeter;
  while (stapel.length) {
    const [a, e] = stapel.pop();
    const ax = xy[a][0];
    const ay = xy[a][1];
    const dx = xy[e][0] - ax;
    const dy = xy[e][1] - ay;
    const laenge2 = dx * dx + dy * dy;
    let maxD = -1;
    let maxI = -1;
    for (let i = a + 1; i < e; i++) {
      let px = xy[i][0] - ax;
      let py = xy[i][1] - ay;
      let d2;
      if (laenge2 === 0) {
        d2 = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / laenge2));
        px -= t * dx;
        py -= t * dy;
        d2 = px * px + py * py;
      }
      if (d2 > maxD) { maxD = d2; maxI = i; }
    }
    if (maxD > t2) {
      behalten[maxI] = 1;
      stapel.push([a, maxI], [maxI, e]);
    }
  }
  return punkte.filter(function (_, i) { return behalten[i]; });
}

/** Google-Polyline-Kodierung, Präzision 1e-5. */
function polylineKodieren_(punkte) {
  let text = '';
  let latAlt = 0;
  let lonAlt = 0;
  const zahl = function (v) {
    let x = v < 0 ? ~(v << 1) : (v << 1);
    let s = '';
    while (x >= 0x20) {
      s += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    return s + String.fromCharCode(x + 63);
  };
  punkte.forEach(function (p) {
    const la = Math.round(p[0] * 1e5);
    const lo = Math.round(p[1] * 1e5);
    text += zahl(la - latAlt) + zahl(lo - lonAlt);
    latAlt = la;
    lonAlt = lo;
  });
  return text;
}

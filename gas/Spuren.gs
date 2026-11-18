/**
 * Spuren.gs – GPS-Spuren für die Karte (Heatmap) und die Detailansicht
 * Version: 0.9.0 (2026-11-18)
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
 */

const BLATT_SPUREN = 'Spuren';
const SPUREN_SPALTEN = ['activityId', 'sportart', 'start', 'status', 'punkte', 'grob', 'fein', 'bearbeitet'];
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
    const s = spurLaden_(k.id);
    log_(k.sportart + ': Status ' + s.status + ', Punkte ' + s.punkte + ', grob ' + (s.grob || '').length +
      ' Zeichen, fein ' + (s.fein || '').length + ' Zeichen, ' + (Date.now() - t0) + ' ms');
  });
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
  for (let i = 0; i < kandidaten.length; i++) {
    if (Date.now() - t0 > budget || (maxAnzahl && verarbeitet >= maxAnzahl)) break;
    const k = kandidaten[i];
    const s = spurLaden_(k.id);
    if (s.status === 'fehler 429') {
      abbruch = 'Ratenlimit von Garmin erreicht';
      break;
    }
    puffer.push([k.id, k.sportart, k.start, s.status, s.punkte, s.grob, s.fein, new Date()]);
    verarbeitet++;
    if (puffer.length >= 20) spurenSchreiben_(b, puffer);
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
  const z = b.getRange(treffer.getRow(), 1, 1, 7).getValues()[0];
  return { fein: z[3] === 'ok' ? (z[6] || z[5]) : null, status: z[3] };
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
  }
  return b;
}

function spurenSchreiben_(b, puffer) {
  if (!puffer.length) return;
  b.getRange(b.getLastRow() + 1, 1, puffer.length, SPUREN_SPALTEN.length).setValues(puffer);
  b.getRange(b.getLastRow() - puffer.length + 1, 1, puffer.length, 1).setNumberFormat('0');
  puffer.length = 0;
}

/** Aktivitäten mit GPS in SPUREN_SPORTARTEN ohne Eintrag im Blatt „Spuren“, neueste zuerst. */
function spurKandidaten_() {
  const akt = tabelle_().getSheetByName(BLATT_AKTIVITAETEN);
  if (!akt || akt.getLastRow() < 2) return [];
  const vorhanden = {};
  const b = tabelle_().getSheetByName(BLATT_SPUREN);
  if (b && b.getLastRow() >= 2) {
    b.getRange(2, 1, b.getLastRow() - 1, 1).getValues().forEach(function (z) { vorhanden[String(z[0])] = true; });
  }
  const i = {};
  SPALTEN.forEach(function (n, k) { i[n] = k; });
  return akt.getRange(2, 1, akt.getLastRow() - 1, SPALTEN.length).getValues()
    .filter(function (z) {
      return z[i.hat_gps] === true && SPUREN_SPORTARTEN.indexOf(z[i.sportart]) >= 0 && !vorhanden[String(z[i.activityId])] &&
        meldungPlausibel_({ sportart: z[i.sportart], km: Number(z[i.distanz_km]) || 0, min: Number(z[i.dauer_min]) || 0 });
    })
    .map(function (z) { return { id: String(z[i.activityId]), sportart: z[i.sportart], start: z[i.start] }; })
    .sort(function (x, y) { return (y.start instanceof Date ? y.start.getTime() : 0) - (x.start instanceof Date ? x.start.getTime() : 0); });
}

/** Lädt die FIT-Datei und liefert {status, punkte, grob, fein}. */
function spurLaden_(id) {
  let antwort;
  try {
    antwort = garminAbruf_(PFAD_DATEI + id, null, { accept: '*/*', leise: true });
  } catch (e) {
    return { status: 'fehler netz', punkte: 0, grob: '', fein: '' };
  }
  if (antwort.getResponseCode() !== 200) return { status: 'fehler ' + antwort.getResponseCode(), punkte: 0, grob: '', fein: '' };
  let dateien;
  try {
    const blob = antwort.getBlob().setContentType('application/zip');
    dateien = Utilities.unzip(blob);
  } catch (e) {
    dateien = [antwort.getBlob()];
  }
  let punkte = [];
  dateien.forEach(function (d) {
    const bytes = d.getBytes();
    if (!punkte.length && bytes.length > 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54) {
      try {
        punkte = fitPunkte_(bytes);
      } catch (e) {
        punkte = [];
      }
    }
  });
  if (punkte.length < 2) return { status: 'keine', punkte: punkte.length, grob: '', fein: '' };
  const grob = polylineKodieren_(vereinfachen_(punkte, SPUR_TOLERANZ_GROB));
  let toleranz = SPUR_TOLERANZ_FEIN;
  let fein = polylineKodieren_(vereinfachen_(punkte, toleranz));
  while (fein.length > SPUR_MAX_ZEICHEN && toleranz < 200) {
    toleranz *= 2;
    fein = polylineKodieren_(vereinfachen_(punkte, toleranz));
  }
  return { status: 'ok', punkte: punkte.length, grob: grob, fein: fein.length > SPUR_MAX_ZEICHEN ? '' : fein };
}

/**
 * Liest alle GPS-Punkte [lat, lon] aus den record-Nachrichten (global 20) einer FIT-Datei.
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
  const int32 = function (p, little) {
    return little ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24))
      : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]);
  };
  const daten = function (pos, def) {
    if (!def) throw new Error('Datennachricht ohne Definition');
    if (def.global === 20 && def.lat >= 0 && def.lon >= 0) {
      const la = int32(pos + def.lat, def.little);
      const lo = int32(pos + def.lon, def.little);
      if (la !== 0x7fffffff && lo !== 0x7fffffff && (la !== 0 || lo !== 0)) punkte.push([la * faktor, lo * faktor]);
    }
    return pos + def.groesse;
  };
  let pos = kopf0;
  while (pos < ende) {
    const kopf = b[pos++];
    if (kopf & 0x80) {
      pos = daten(pos, defs[(kopf >> 5) & 0x03]);
      continue;
    }
    const lokal = kopf & 0x0f;
    if (kopf & 0x40) {
      const little = b[pos + 1] === 0;
      const global = little ? b[pos + 2] + b[pos + 3] * 256 : b[pos + 2] * 256 + b[pos + 3];
      const anzahl = b[pos + 4];
      pos += 5;
      const def = { global: global, little: little, groesse: 0, lat: -1, lon: -1 };
      for (let i = 0; i < anzahl; i++) {
        if (b[pos] === 0 && b[pos + 1] === 4) def.lat = def.groesse;
        if (b[pos] === 1 && b[pos + 1] === 4) def.lon = def.groesse;
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

/**
 * Abgleich.gs – Aktivitäten eines Zeitraums mit Garmin abgleichen
 * Version: 0.10.0 (2026-11-18)
 *
 * Wofür: Wer bei Garmin eine Aktivität nachträglich ändert (Sportart, Name, gekürzt) oder
 * löscht, bekommt das mit sammeln() nicht mit, weil sammeln() nur neue Aktivitäten
 * übernimmt. Der Abgleich holt einen Zeitraum neu und vergleicht ihn mit dem Sheet.
 * Er läuft nie automatisch, nur auf Knopfdruck in der App (Einstellungen).
 *
 * Ablauf:
 *   1. „Prüfen“ (uebernehmen = false): liefert die Liste der Unterschiede, ändert nichts.
 *   2. „Übernehmen“ (uebernehmen = true): rechnet den Vergleich neu und
 *      - ersetzt geänderte Zeilen (importiert_am bleibt),
 *      - löscht Zeilen, die es bei Garmin nicht mehr gibt,
 *      - ergänzt Aktivitäten, die im Sheet fehlen.
 *      Spuren gelöschter Aktivitäten werden entfernt; bei geänderter Strecke (Start, Distanz,
 *      Dauer, Sportart, GPS) wird die Spur gelöscht und neu geladen.
 * Maßgeblich ist das Datum der Aktivität (Startzeit lokal), nicht das Datum der Änderung.
 * Garmin wird mit einem Tag Rand abgefragt, damit die Zeitzone keine Aktivität am Rand
 * fälschlich als gelöscht erscheinen lässt.
 *
 * Diagnose im Script-Editor: diagnoseAbgleich() prüft die letzten 30 Tage und loggt nur
 * Anzahlen, nichts wird geändert.
 */

/** Felder, die verglichen werden (Reihenfolge wie in der App angezeigt). */
const ABGLEICH_FELDER = ['start', 'sportart', 'garminTyp', 'name', 'distanz_km', 'dauer_min', 'dauer_gesamt_min',
  'hoehenmeter', 'puls_avg', 'hat_gps', 'details'];
/** Änderungen an diesen Feldern bedeuten: Spur neu laden. */
const ABGLEICH_SPUR_FELDER = ['start', 'sportart', 'distanz_km', 'dauer_min', 'dauer_gesamt_min', 'hat_gps'];
const ABGLEICH_MAX_TAGE = 4000;

/** Diagnose: letzte 30 Tage prüfen, nur Anzahlen loggen. */
function diagnoseAbgleich() {
  const heute = new Date();
  const von = Utilities.formatDate(new Date(heute.getTime() - 30 * 86400000), ZEITZONE, 'yyyy-MM-dd');
  const bis = Utilities.formatDate(heute, ZEITZONE, 'yyyy-MM-dd');
  log_('===== Diagnose Abgleich ' + von + ' bis ' + bis + ' =====');
  const e = abgleich_(von, bis, false);
  const zaehlen = function (art) { return e.aenderungen.filter(function (x) { return x.art === art; }).length; };
  log_('Bei Garmin: ' + e.garmin + ', im Sheet: ' + e.sheet + ', geändert: ' + zaehlen('geaendert') +
    ', gelöscht: ' + zaehlen('geloescht') + ', fehlt im Sheet: ' + zaehlen('neu'));
  const felder = {};
  e.aenderungen.forEach(function (x) {
    (x.felder || []).forEach(function (f) { felder[f.feld] = (felder[f.feld] || 0) + 1; });
  });
  if (Object.keys(felder).length) {
    log_('Geänderte Felder: ' + Object.keys(felder).map(function (k) { return k + '=' + felder[k]; }).join(', '));
  }
}

/**
 * Vergleicht den Zeitraum mit Garmin und übernimmt auf Wunsch die Änderungen.
 * @param {string} von YYYY-MM-DD (inklusiv)
 * @param {string} bis YYYY-MM-DD (inklusiv)
 * @param {boolean} uebernehmen
 * @return {{von, bis, garmin, sheet, aenderungen: Array, uebernommen: boolean}}
 */
function abgleich_(von, bis, uebernehmen) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(von)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(bis))) {
    throw new Error('Zeitraum ungültig (erwartet JJJJ-MM-TT).');
  }
  if (von > bis) throw new Error('„Von“ liegt nach „Bis“.');
  const tage = (Utilities.parseDate(bis, ZEITZONE, 'yyyy-MM-dd') - Utilities.parseDate(von, ZEITZONE, 'yyyy-MM-dd')) / 86400000;
  if (tage > ABGLEICH_MAX_TAGE) throw new Error('Zeitraum zu lang (höchstens ' + ABGLEICH_MAX_TAGE + ' Tage).');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Ein anderer Abruf läuft gerade. Bitte gleich nochmal versuchen.');
  try {
    const jetzt = new Date();
    const tagVorher = Utilities.formatDate(new Date(Utilities.parseDate(von, ZEITZONE, 'yyyy-MM-dd').getTime() - 86400000), ZEITZONE, 'yyyy-MM-dd');
    const tagNachher = Utilities.formatDate(new Date(Utilities.parseDate(bis, ZEITZONE, 'yyyy-MM-dd').getTime() + 2 * 86400000), ZEITZONE, 'yyyy-MM-dd');
    const imZeitraum = function (datum) { return datum >= von && datum <= bis; };

    // Garmin
    const garmin = {};
    garminAktivitaeten_(tagVorher, tagNachher).forEach(function (a) {
      const datum = String(a.startTimeLocal || '').substring(0, 10);
      if (imZeitraum(datum)) garmin[String(a.activityId)] = a;
    });

    // Sheet
    const b = blatt_();
    const n = Math.max(b.getLastRow() - 1, 0);
    const werte = n ? b.getRange(2, 1, n, SPALTEN.length).getValues() : [];
    const i = {};
    SPALTEN.forEach(function (name, k) { i[name] = k; });
    const sheet = {};
    werte.forEach(function (z, k) {
      const datum = z[i.start] instanceof Date ? Utilities.formatDate(z[i.start], ZEITZONE, 'yyyy-MM-dd') : String(z[i.start]).substring(0, 10);
      if (imZeitraum(datum)) sheet[String(z[i.activityId])] = { zeile: k + 2, werte: z };
    });

    // Vergleich
    const aenderungen = [];
    Object.keys(garmin).forEach(function (id) {
      const a = garmin[id];
      const typ = typKey_(a);
      const vorhanden = sheet[id];
      if (AUSGESCHLOSSEN.indexOf(typ) >= 0) {
        if (vorhanden) aenderungen.push(abgleichEintrag_('geloescht', id, vorhanden.werte, i, null, 'Typ wird nicht importiert'));
        return;
      }
      const neu = zeile_(a, sportart_(typ), jetzt);
      if (!vorhanden) {
        aenderungen.push(abgleichEintrag_('neu', id, neu, i, neu));
        return;
      }
      const felder = [];
      ABGLEICH_FELDER.forEach(function (feld) {
        const alt = abgleichWert_(feld, vorhanden.werte[i[feld]]);
        const jetztWert = abgleichWert_(feld, neu[i[feld]]);
        if (alt !== jetztWert) {
          felder.push(feld === 'details' ? { feld: feld } : { feld: feld, alt: alt, neu: jetztWert });
        }
      });
      if (felder.length) {
        const eintrag = abgleichEintrag_('geaendert', id, vorhanden.werte, i, neu);
        eintrag.felder = felder;
        eintrag.zeile = vorhanden.zeile;
        eintrag.spurNeu = felder.some(function (f) { return ABGLEICH_SPUR_FELDER.indexOf(f.feld) >= 0; });
        aenderungen.push(eintrag);
      }
    });
    Object.keys(sheet).forEach(function (id) {
      if (!garmin[id]) aenderungen.push(abgleichEintrag_('geloescht', id, sheet[id].werte, i, null));
    });
    aenderungen.forEach(function (x) {
      if (x.art === 'geloescht') x.zeile = sheet[x.id].zeile;
    });
    aenderungen.sort(function (x, y) { return x.datum < y.datum ? -1 : x.datum > y.datum ? 1 : 0; });

    if (uebernehmen && aenderungen.length) {
      abgleichAnwenden_(b, aenderungen, sheet);
      try {
        spurenNachladen(20, 10);
      } catch (spurFehler) {
        log_('Spuren konnten nicht geladen werden: ' + spurFehler.message);
      }
    }

    // Interne Felder nicht an die App schicken
    const fuerApp = aenderungen.map(function (x) {
      return { art: x.art, id: x.id, datum: x.datum, name: x.name, sportart: x.sportart, km: x.km, felder: x.felder, grund: x.grund };
    });
    return { von: von, bis: bis, garmin: Object.keys(garmin).length, sheet: Object.keys(sheet).length, aenderungen: fuerApp, uebernommen: !!uebernehmen };
  } finally {
    lock.releaseLock();
  }
}

/** Vergleichbarer Wert eines Feldes (Text), damit Datum, Zahl und Text gleich behandelt werden. */
function abgleichWert_(feld, wert) {
  if (wert === null || wert === undefined) return '';
  if (feld === 'start') {
    return wert instanceof Date ? Utilities.formatDate(wert, ZEITZONE, 'yyyy-MM-dd HH:mm') : String(wert).substring(0, 16).replace('T', ' ');
  }
  if (feld === 'details') {
    try {
      const o = typeof wert === 'string' ? (wert ? JSON.parse(wert) : {}) : wert;
      return JSON.stringify(Object.keys(o).sort().reduce(function (r, k) { r[k] = o[k]; return r; }, {}));
    } catch (e) {
      return String(wert);
    }
  }
  if (feld === 'hat_gps') return String(wert === true || wert === 'TRUE' || wert === 'true');
  if (typeof wert === 'number') return String(wert);
  if (wert === '') return '';
  const zahl = Number(wert);
  if (['distanz_km', 'dauer_min', 'dauer_gesamt_min', 'hoehenmeter', 'puls_avg'].indexOf(feld) >= 0 && isFinite(zahl)) return String(zahl);
  return String(wert).trim();
}

/** Kurzbeschreibung einer Aktivität für die App. */
function abgleichEintrag_(art, id, z, i, neu, grund) {
  const quelle = neu || z;
  return {
    art: art, id: id,
    datum: abgleichWert_('start', quelle[i.start]),
    name: String(z[i.name] || ''),
    sportart: String(quelle[i.sportart] || ''),
    km: Number(z[i.distanz_km]) || 0,
    neueZeile: neu,
    grund: grund || null
  };
}

/** Schreibt die Änderungen ins Sheet und räumt die Spuren auf. */
function abgleichAnwenden_(b, aenderungen, sheet) {
  const iImportiert = SPALTEN.indexOf('importiert_am');
  const iSpurDatei = SPALTEN.indexOf('spur_datei');
  const spurenWeg = {};

  // 1. Geänderte Zeilen ersetzen (Zeilennummern stimmen noch, gelöscht wird erst danach)
  aenderungen.filter(function (x) { return x.art === 'geaendert'; }).forEach(function (x) {
    const alt = sheet[x.id].werte;
    const neu = x.neueZeile.slice();
    neu[iImportiert] = alt[iImportiert];
    neu[iSpurDatei] = alt[iSpurDatei];
    b.getRange(x.zeile, 1, 1, SPALTEN.length).setValues([neu]);
    if (x.spurNeu) spurenWeg[x.id] = true;
  });

  // 2. Gelöschte Zeilen entfernen, von unten nach oben
  aenderungen.filter(function (x) { return x.art === 'geloescht'; })
    .sort(function (x, y) { return y.zeile - x.zeile; })
    .forEach(function (x) {
      b.deleteRow(x.zeile);
      spurenWeg[x.id] = true;
    });

  // 3. Fehlende ergänzen (schreiben_ sortiert danach nach Startzeit)
  const neu = aenderungen.filter(function (x) { return x.art === 'neu'; }).map(function (x) { return x.neueZeile; });
  if (neu.length) schreiben_(b, neu);
  else if (aenderungen.some(function (x) { return x.art === 'geaendert'; })) {
    // Startzeit kann sich geändert haben: Reihenfolge wiederherstellen
    const n = b.getLastRow() - 1;
    if (n > 1) b.getRange(2, 1, n, SPALTEN.length).sort({ column: SPALTEN.indexOf('start') + 1, ascending: true });
  }

  // 4. Spuren entfernen; geänderte werden danach neu geladen
  const ids = Object.keys(spurenWeg);
  const s = tabelle_().getSheetByName(BLATT_SPUREN);
  if (ids.length && s && s.getLastRow() >= 2) {
    const zeilen = [];
    s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().forEach(function (z, k) {
      if (spurenWeg[String(z[0])]) zeilen.push(k + 2);
    });
    zeilen.sort(function (x, y) { return y - x; }).forEach(function (z) { s.deleteRow(z); });
  }
  log_('Abgleich übernommen: ' + aenderungen.length + ' Änderungen, ' + ids.length + ' Spuren entfernt.');
}

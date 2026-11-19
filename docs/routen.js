/**
 * routen.js – gleiche Routen erkennen und vergleichen (Rangliste)
 * Version: 0.15.0 (2026-11-19)
 *
 * Idee (Christof 2026-11-19): Läufe oder Radfahrten auf immer derselben Strecke (z. B. der
 * Arbeitsweg) zusammenfassen und die Zeiten vergleichen, wie Segmente bei Strava, aber für
 * die ganze Aktivität. Alles wird im Gerät aus den groben Spuren berechnet (karte.js), es
 * verlässt nichts das Handy.
 *
 * Gleich ist eine Route, wenn (je Sportart):
 * - Start und Ziel höchstens ROUTE_ENDE_KM auseinanderliegen (Richtung zählt: hin und zurück
 *   sind zwei Routen; bei Rundtouren ist die Richtung egal),
 * - die Distanz höchstens ROUTE_LAENGE_ANTEIL abweicht und
 * - die Spur im Mittel höchstens ROUTE_ABWEICHUNG_KM und an fast allen Stellen höchstens
 *   ROUTE_MAX_KM neben der ersten Fahrt der Route liegt (kleine Umwege sind erlaubt).
 * Eine Route braucht mindestens ROUTE_MIN_FAHRTEN Fahrten.
 *
 * Rangliste nach Bewegungszeit (Garmin „movingDuration“): Stillstand, z. B. an der Ampel,
 * zählt nicht, damit der Vergleich fair ist. Die Gesamtzeit steht klein daneben.
 * Name: „Start → Ziel“ bzw. „Runde ab …“ aus der Ortsliste (touren.js), änderbar
 * (Korrektur „routenname“ im Blatt „Touren“, Schlüssel = activityId der ersten Fahrt).
 * Nutzt Funktionen und Konstanten aus app.js, karte.js und touren.js.
 */
'use strict';

const ROUTE_SPORTARTEN = ['laufen', 'rad', 'wandern'];
const ROUTE_ENDE_KM = 0.3;
const ROUTE_LAENGE_ANTEIL = 0.1;
const ROUTE_ABWEICHUNG_KM = 0.12;
const ROUTE_MAX_KM = 0.35;
const ROUTE_MAX_AUSREISSER = 0.1;  // so viele Stichproben dürfen weiter weg liegen
const ROUTE_PROBEN = 40;           // Stichproben entlang der Spur
const ROUTE_MIN_FAHRTEN = 2;
const ROUTE_MIN_KM = 1;
const ROUTE_ZELLE_KM = 0.5;

const routenZustand = { cache: null };

/** Gleichmäßig verteilte Punkte entlang einer (mehrteiligen) Spur. */
function routeProben(teile, anzahl) {
  const punkte = [].concat(...teile);
  const laenge = [0];
  for (let i = 1; i < punkte.length; i++) laenge.push(laenge[i - 1] + abstandKm(punkte[i - 1], punkte[i]));
  const gesamt = laenge[laenge.length - 1];
  const proben = [];
  let j = 0;
  for (let n = 0; n < anzahl; n++) {
    const ziel = gesamt * n / (anzahl - 1);
    while (j < punkte.length - 2 && laenge[j + 1] < ziel) j++;
    const abschnitt = laenge[j + 1] - laenge[j] || 1;
    const f = Math.min(1, Math.max(0, (ziel - laenge[j]) / abschnitt));
    const a = punkte[j];
    const b = punkte[Math.min(j + 1, punkte.length - 1)];
    proben.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return proben;
}

/** Liegt Spur x nahe genug an Spur y? (Abstand jeder Stichprobe zur nächsten der anderen) */
function routeAehnlich(x, y) {
  let summe = 0;
  let weit = 0;
  for (const p of x.proben) {
    let min = Infinity;
    for (const q of y.dicht) {
      const d = abstandKm(p, q);
      if (d < min) min = d;
    }
    summe += min;
    if (min > ROUTE_MAX_KM) weit++;
  }
  return summe / x.proben.length <= ROUTE_ABWEICHUNG_KM && weit <= x.proben.length * ROUTE_MAX_AUSREISSER;
}

/** Alle Routen: {routen: [...], proAktivitaet: Map id → {route, rang}} oder null ohne Spuren. */
function routenErgebnis() {
  if (!karteZustand.spuren) return null;
  const schluessel = karteZustand.spuren.length + ':' + zustand.aktivitaeten.length + ':' + JSON.stringify(tourenZustand.korrekturen) + ':' + !!orteDaten.liste;
  const c = routenZustand.cache;
  if (c && c.schluessel === schluessel && c.spuren === karteZustand.spuren && c.aktivitaeten === zustand.aktivitaeten) return c.ergebnis;
  const ergebnis = routenErkennen();
  routenZustand.cache = { schluessel, spuren: karteZustand.spuren, aktivitaeten: zustand.aktivitaeten, ergebnis };
  return ergebnis;
}

function routenErkennen() {
  const spurProId = new Map(karteZustand.spuren.map(s => [s.id, s]));
  const k = korrekturenAuswerten();
  const zelle = p => Math.floor(p[0] * 110.54 / ROUTE_ZELLE_KM) + ',' + Math.floor(p[1] * 111.32 * Math.cos(p[0] * Math.PI / 180) / ROUTE_ZELLE_KM);
  const nachbarn = p => {
    const zx = Math.floor(p[0] * 110.54 / ROUTE_ZELLE_KM);
    const zy = Math.floor(p[1] * 111.32 * Math.cos(p[0] * Math.PI / 180) / ROUTE_ZELLE_KM);
    const liste = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) liste.push((zx + i) + ',' + (zy + j));
    return liste;
  };

  const gruppen = [];
  const proZelle = new Map(); // Sportart + Startzelle → Gruppen
  zustand.aktivitaeten.slice().sort((x, y) => x.datum - y.datum).forEach(a => {
    if (ROUTE_SPORTARTEN.indexOf(a.sportart) < 0 || !zaehlt(a) || !(a.km >= ROUTE_MIN_KM)) return;
    const s = spurProId.get(a.id);
    if (!s) return;
    if (!s.teile) s.teile = spurTeile(s.pfad);
    if (!s.teile.length) return;
    if (!s.proben) {
      s.proben = routeProben(s.teile, ROUTE_PROBEN);
      s.dicht = null;
    }
    const x = { a, proben: s.proben, start: s.proben[0], ende: s.proben[s.proben.length - 1], s };
    x.runde = abstandKm(x.start, x.ende) < ROUTE_ENDE_KM;
    // Passende Gruppe suchen: gleiche Sportart, Start und Ziel nah, Distanz ähnlich, Spur ähnlich
    let treffer = null;
    for (const z of nachbarn(x.start)) {
      for (const g of proZelle.get(a.sportart + ':' + z) || []) {
        const r = g.erste;
        if (abstandKm(r.start, x.start) > ROUTE_ENDE_KM || abstandKm(r.ende, x.ende) > ROUTE_ENDE_KM) continue;
        if (Math.abs(a.km - r.a.km) > r.a.km * ROUTE_LAENGE_ANTEIL) continue;
        if (!r.s.dicht) r.s.dicht = routeProben(r.s.teile, ROUTE_PROBEN * 2);
        if (!x.s.dicht) x.s.dicht = routeProben(x.s.teile, ROUTE_PROBEN * 2);
        if (!routeAehnlich(x, { dicht: r.s.dicht }) || !routeAehnlich({ proben: r.proben }, { dicht: x.s.dicht })) continue;
        treffer = g;
        break;
      }
      if (treffer) break;
    }
    if (treffer) {
      treffer.fahrten.push(a);
    } else {
      const g = { erste: x, sportart: a.sportart, fahrten: [a] };
      gruppen.push(g);
      const key = a.sportart + ':' + zelle(x.start);
      if (!proZelle.has(key)) proZelle.set(key, []);
      proZelle.get(key).push(g);
    }
  });

  const routen = [];
  const proAktivitaet = new Map();
  gruppen.forEach(g => {
    if (g.fahrten.length < ROUTE_MIN_FAHRTEN) return;
    const schluessel = g.erste.a.id;
    const rangliste = g.fahrten.filter(a => a.min > 0).sort((x, y) => x.min - y.min || x.datum - y.datum);
    const kmListe = g.fahrten.map(a => a.km).sort((x, y) => x - y);
    let autoName = g.erste.a.name || SPORT_NAME[g.sportart];
    if (orteDaten.liste) {
      const von = naechsterOrt(g.erste.start);
      const nach = naechsterOrt(g.erste.ende);
      if (g.erste.runde && von) autoName = 'Runde ab ' + von;
      else if (von && nach && von !== nach) autoName = von + ' → ' + nach;
      else if (von) autoName = SPORT_NAME[g.sportart] + ' bei ' + von + ', ' + km(g.erste.a.km);
    }
    const route = {
      schluessel,
      sportart: g.sportart,
      name: k.routenname.get(schluessel) || autoName,
      autoName,
      runde: g.erste.runde,
      fahrten: g.fahrten.slice().sort((x, y) => y.datum - x.datum),
      rangliste,
      beste: rangliste[0] || null,
      km: kmListe[Math.floor(kmListe.length / 2)],
      letzte: g.fahrten.reduce((x, y) => (y.datum > x.datum ? y : x)).datum
    };
    routen.push(route);
    g.fahrten.forEach(a => proAktivitaet.set(a.id, { route, rang: rangliste.indexOf(a) + 1 || null }));
  });
  routen.sort((x, y) => y.fahrten.length - x.fahrten.length || y.letzte - x.letzte);
  return { routen, proAktivitaet };
}

function routeFinden(schluessel) {
  const e = routenErgebnis();
  return e ? e.routen.find(r => r.schluessel === schluessel) || null : null;
}

/** Tempo als Text: Pace beim Laufen und Wandern, sonst km/h. */
function routeTempo(a) {
  if (!a.km || !a.min) return '';
  if (a.sportart === 'rad') return dezimal1.format(a.km / (a.min / 60)) + ' km/h';
  return pace(a.min * 60 / a.km);
}

/** Zeit genauer als dauer(): h:mm:ss bzw. mm:ss */
function routeZeit(min) {
  return zeitAusSekunden(Math.round(min * 60));
}

function routeEintrag(r) {
  const beste = r.beste ? 'Bestzeit ' + routeZeit(r.beste.min) + ' (' + r.beste.datum.getDate() + '.' + (r.beste.datum.getMonth() + 1) + '.' + r.beste.datum.getFullYear() + ')' : '';
  return `<button type="button" class="eintrag" data-route-aktion="oeffnen" data-route="${esc(r.schluessel)}" style="--farbe: var(--${r.sportart})">
    <span class="eintrag-marke" aria-hidden="true"></span>
    <span class="eintrag-text">
      <span class="eintrag-name">${esc(r.name)}</span>
      <span class="eintrag-werte"><b>${r.fahrten.length}×</b> · ${SPORT_NAME[r.sportart]} · ${km(r.km)}</span>
      ${beste ? `<span class="eintrag-werte">${esc(beste)}</span>` : ''}
    </span>
    <svg class="eintrag-pfeil" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
  </button>`;
}

/** Liste der Routen für die Historie (Filter Suche, Sportart, Jahr). */
function routenListeHtml(filter) {
  orteLaden();
  const e = routenErgebnis();
  if (!e) {
    spurenLaden(false);
    return '<div class="karte leer">Lade Spuren für die Routen …</div>';
  }
  const woerter = suchText(filter.suche).split(/\s+/).filter(Boolean);
  const liste = e.routen.filter(r => {
    if (filter.sportarten.size && !filter.sportarten.has(r.sportart)) return false;
    if (filter.jahr !== 'alle' && !r.fahrten.some(a => a.datum.getFullYear() === Number(filter.jahr))) return false;
    if (woerter.length) {
      const heu = suchText([r.name, r.autoName, SPORT_NAME[r.sportart]].concat(r.fahrten.map(a => a.name + ' ' + (a.ort || ''))).join(' '));
      if (!woerter.every(w => heu.indexOf(w) >= 0)) return false;
    }
    return true;
  });
  let html = `<p class="historie-summe"><b>${liste.length}</b> ${liste.length === 1 ? 'Route' : 'Routen'}, die du mehrmals gemacht hast</p>`;
  if (!liste.length) {
    return html + `<div class="karte leer">${e.routen.length ? 'Keine Route passt zu Suche oder Filter.' : 'Noch keine gleichen Routen gefunden.'}</div>`;
  }
  return html + '<div class="liste">' + liste.map(routeEintrag).join('') + '</div>' +
    '<p class="leise klein-text">Gleiche Routen erkennt die App an Start, Ziel, Distanz und Verlauf der Spur. Verglichen wird die Bewegungszeit: Halte, z. B. an der Ampel, zählen nicht.</p>';
}

function routeOeffnen(schluessel) {
  unterseiteOeffnen('route', { route: schluessel });
  zustand.routeSchluessel = schluessel;
  zeichnen();
}

/** Hinweis in der Detailansicht: „Gleiche Route · 14× · Platz 3“. */
function routeHinweisHtml(a) {
  const e = routenErgebnis();
  const p = e && e.proAktivitaet.get(a.id);
  if (!p) return '';
  const r = p.route;
  const platz = p.rang ? 'Platz ' + p.rang + ' von ' + r.rangliste.length : '';
  const abstand = p.rang > 1 && r.beste ? ' · +' + routeZeit(a.min - r.beste.min) + ' zur Bestzeit' : p.rang === 1 && r.rangliste.length > 1 ? ' · Bestzeit!' : '';
  return `<button type="button" class="hinweis-tour hinweis-route" data-route-aktion="oeffnen" data-route="${esc(r.schluessel)}" style="--farbe: var(--${r.sportart})">
    <span>Gleiche Route, ${r.fahrten.length}× gemacht</span>
    <b>${esc(r.name)}</b>
    <small>${esc(platz + abstand)}</small>
  </button>`;
}

function ansichtRoute() {
  orteLaden();
  const zurueck = `<button class="knopf klein zurueck" data-aktion="zurueck">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg> Zurück</button>`;
  const e = routenErgebnis();
  if (!e) {
    spurenLaden(false);
    return zurueck + '<div class="karte leer">Lade Spuren …</div>';
  }
  const r = routeFinden(zustand.routeSchluessel);
  if (!r) return zurueck + '<div class="karte leer">Diese Route gibt es nicht mehr.</div>';
  const jahre = new Set(r.fahrten.map(a => a.datum.getFullYear()));
  let html = zurueck + `<header class="detail-kopf" style="--farbe: var(--${r.sportart})">
    <span class="detail-marke" aria-hidden="true"></span>
    <div><h1>${esc(r.name)}</h1>
    <span class="leise">${SPORT_NAME[r.sportart]} · ${r.runde ? 'Rundtour · ' : ''}${km(r.km)} · ${r.fahrten.length}× seit ${Math.min(...jahre)}</span></div>
  </header>`;
  html += `<section class="karte karte-detail-rahmen"><div id="route-karte" class="detail-karte" role="region" aria-label="Karte der Route"></div></section>`;
  if (r.beste) {
    const zeiten = r.rangliste.map(a => a.min);
    const mitte = zeiten[Math.floor(zeiten.length / 2)];
    html += '<div class="kennzahlen">' + [
      kennzahl(routeZeit(r.beste.min), 'Bestzeit'),
      kennzahl(routeTempo(r.beste), r.sportart === 'rad' ? 'Ø bei der Bestzeit' : 'Pace bei der Bestzeit'),
      kennzahl(routeZeit(mitte), 'Mittlere Zeit'),
      kennzahl(String(r.fahrten.length), r.fahrten.length === 1 ? 'Fahrt' : (r.sportart === 'rad' ? 'Fahrten' : 'Mal'))
    ].join('') + '</div>';
  }
  html += '<h2>Rangliste</h2><p class="leise klein-text" style="margin-top:0">Nach Bewegungszeit: Halte (z. B. an der Ampel) zählen nicht. Die Gesamtzeit mit Halten steht grau daneben.</p><div class="liste">';
  r.rangliste.forEach((a, i) => {
    const werte = [routeTempo(a)];
    if (i > 0) werte.push('+' + routeZeit(a.min - r.beste.min));
    if (a.puls) werte.push('Puls ' + a.puls);
    const gesamt = a.minGesamt && a.minGesamt - a.min >= 0.5 ? ` <span class="leise">(${routeZeit(a.minGesamt)} mit Halten)</span>` : '';
    html += `<button type="button" class="eintrag rang-eintrag ${i === 0 ? 'rang-beste' : ''}" data-aktion="detail" data-id="${esc(a.id)}" style="--farbe: var(--${r.sportart})">
      <span class="rang-platz">${i + 1}</span>
      <span class="eintrag-text">
        <span class="eintrag-name">${routeZeit(a.min)}${gesamt}</span>
        <span class="eintrag-werte">${esc(werte.filter(Boolean).join(' · '))}</span>
      </span>
      <span class="eintrag-zeit">${TAGE_KURZ[(a.datum.getDay() + 6) % 7]} ${a.datum.getDate()}.${a.datum.getMonth() + 1}.${a.datum.getFullYear()}</span>
      <svg class="eintrag-pfeil" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
    </button>`;
  });
  html += '</div>';
  const ohneZeit = r.fahrten.filter(a => !(a.min > 0));
  if (ohneZeit.length) html += `<p class="leise klein-text">${ohneZeit.length} ohne Zeit, nicht in der Rangliste.</p>`;
  html += `<div class="knopfreihe" style="margin-top:12px"><button class="knopf" data-route-aktion="umbenennen">Umbenennen</button></div>`;
  return html;
}

async function routeKarteNachZeichnen() {
  const flaeche = document.getElementById('route-karte');
  if (!flaeche) return;
  vollbildAnwenden(flaeche, 'route');
  const r = routeFinden(zustand.routeSchluessel);
  if (!r) return;
  try {
    await leafletLaden();
  } catch (e) {
    flaeche.innerHTML = `<p class="leer">${esc(e.message)}</p>`;
    return;
  }
  if (!document.body.contains(flaeche)) return;
  if (karteZustand.routeKarte) karteZustand.routeKarte.remove();
  const karte = L.map(flaeche, { scrollWheelZoom: false, maxZoom: 19 });
  karteZustand.routeKarte = karte;
  const spurProId = new Map(karteZustand.spuren.map(s => [s.id, s]));
  const grenzen = L.latLngBounds([]);
  r.fahrten.forEach(a => {
    const s = spurProId.get(a.id);
    if (s && s.teile) s.teile.forEach(t => grenzen.extend(L.latLngBounds(t)));
  });
  kartenEbenen(karte, { sportart: r.sportart, schweiz: inDerSchweiz(grenzen), deckkraft: 0.7 });
  vollbildKnopf('route').addTo(karte);
  // Alle Fahrten dünn, die Bestzeit kräftig darüber
  r.fahrten.forEach(a => {
    if (r.beste && a.id === r.beste.id) return;
    const s = spurProId.get(a.id);
    if (s && s.teile) L.polyline(s.teile, { color: '#555', weight: 2, opacity: 0.35, interactive: false }).addTo(karte);
  });
  const beste = r.beste || r.fahrten[0];
  const s = spurProId.get(beste.id);
  if (s && s.teile && s.teile.length) {
    const rand = L.polyline(s.teile, { color: '#fff', weight: 8, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(karte);
    const linie = L.polyline(s.teile, { color: LINIEN_FARBE[r.sportart], weight: 4.5, opacity: 1, lineCap: 'round', lineJoin: 'round' })
      .bindTooltip(r.beste ? 'Bestzeit ' + routeZeit(r.beste.min) : '').addTo(karte);
    const start = s.teile[0][0];
    const lt = s.teile[s.teile.length - 1];
    L.circleMarker(start, { radius: 7, color: '#fff', weight: 2, fillColor: '#2f9e63', fillOpacity: 1 }).bindTooltip('Start').addTo(karte);
    if (!r.runde) L.circleMarker(lt[lt.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#c23b3b', fillOpacity: 1 }).bindTooltip('Ziel').addTo(karte);
    if (grenzen.isValid()) karte.fitBounds(grenzen, { padding: [20, 20] });
    // Feine Spur der Bestzeit nachladen
    feineSpurHolen(beste.id).then(spur => {
      const teile = spur ? spurTeile(spur.fein) : [];
      if (teile.length && karteZustand.routeKarte === karte) {
        rand.setLatLngs(teile);
        linie.setLatLngs(teile);
      }
    }).catch(() => { /* grobe Spur bleibt */ });
  } else {
    karte.setView([46.8, 8.2], 8);
  }
}

document.addEventListener('click', ereignis => {
  const ziel = ereignis.target.closest('[data-route-aktion]');
  if (!ziel) return;
  switch (ziel.dataset.routeAktion) {
    case 'oeffnen':
      routeOeffnen(ziel.dataset.route);
      break;
    case 'umbenennen': {
      const r = routeFinden(zustand.routeSchluessel);
      if (!r) return;
      const neu = prompt('Name der Route (leer = automatischer Name):', r.name === r.autoName ? '' : r.name);
      if (neu === null) return;
      tourKorrektur('routenname', r.schluessel, neu.trim(), neu.trim() ? 'Name gespeichert.' : 'Automatischer Name.');
      break;
    }
  }
});

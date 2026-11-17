/**
 * hilfe.js – Erklär-Seite „So funktioniert die App“
 * Version: 0.6.0 (2026-11-17)
 *
 * Erreichbar über das „?“ in „Form“ und „Erfolge“ sowie über die Einstellungen.
 * Werte wie Ziele und Grenzen werden aus app.js gelesen, damit der Text stimmt,
 * wenn sich etwas ändert.
 */
'use strict';

function ansichtHilfe() {
  const zielL = Number(zustand.einstellungen.wochenzielLaeufe) || 0;
  const zielP = Number(zustand.einstellungen.wochenzielPunkte) || 0;
  const grenzen = Object.keys(GRENZEN).map(sa =>
    `${SPORT_NAME[sa]}: mehr als ${GRENZEN[sa].kmh} km/h im Schnitt oder länger als ${GRENZEN[sa].km} km`).join('<br>');
  const abschnitt = (titel, inhalt) => `<h2>${titel}</h2><section class="karte hilfe">${inhalt}</section>`;

  return `<button class="knopf klein zurueck" data-aktion="zurueck">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg> Zurück</button>
    <h1>So funktioniert die App</h1>

    ${abschnitt('Das Wichtigste in Kürze', `
      <p>Deine Uhr schickt alles an Garmin Connect. Jede Nacht um 3 Uhr holt die App neue Aktivitäten ab, tagsüber auf Knopfdruck mit „Von Garmin holen“.</p>
      <p>Die App misst dich an <b>zwei Wochenzielen</b> (Montag bis Sonntag) und vor allem an <b>dir selbst</b>: Unter „Form“ siehst du, ob du gerade mehr oder weniger machst als sonst.</p>`)}

    ${abschnitt('Sportpunkte', `
      <p>Sportpunkte machen verschiedene Sportarten vergleichbar. Sie sind Garmins <b>Intensitätsminuten</b>: Die Uhr zählt anhand deines Pulses, wie lange du dich angestrengt hast.</p>
      <ul>
        <li><b>Moderate Minute</b> (z. B. zügiges Wandern, lockeres Radeln) = 1 Punkt</li>
        <li><b>Intensive Minute</b> (z. B. Laufen, steil bergauf) = 2 Punkte</li>
      </ul>
      <p>Darum zählt eine lange Wanderung oder ein Skitag oft so viel wie mehrere Läufe, ein gemütlicher Spaziergang dagegen wenig.</p>
      <p><b>≈ geschätzt:</b> Hat Garmin für eine Aktivität keine Intensitätsminuten (z. B. ohne Pulsmessung), schätzt die App sie aus der Dauer: Minuten × dein persönlicher Durchschnitt für diese Sportart.</p>
      <p>Sportpunkte gibt es <b>ab 2023</b>. Davor hat Garmin keine Intensitätsminuten gespeichert.</p>`)}

    ${abschnitt('Die zwei Wochenziele', `
      <p><b>Laufziel:</b> ${zielL} ${zielL === 1 ? 'Lauf' : 'Läufe'} pro Woche. Laufband zählt mit.</p>
      <p><b>Aktivziel:</b> ${zielP} Sportpunkte pro Woche, egal mit welcher Sportart. 150 ist die Empfehlung von Garmin und der WHO.</p>
      <p>Beide Ziele änderst du unter Einstellungen. Sie gelten auf allen Geräten.</p>`)}

    ${abschnitt('Serien und Abzeichen', `
      <p>Eine <b>Serie</b> zählt, wie viele Wochen hintereinander du ein Ziel erreicht hast. Die laufende Woche bricht die Serie nicht, solange sie noch nicht vorbei ist. Sobald du das Ziel erreichst, zählt sie mit.</p>
      <p><b>Serien-Abzeichen</b> gibt es für 4, 12, 26 und 52 Wochen in Folge. Rückwirkend gilt dein aktuelles Ziel.</p>
      <p><b>Jahres-Abzeichen</b> gibt es für Kilometer im laufenden Kalenderjahr: Laufen und Wandern 100, 250, 500, 1000 km, Rad 1000, 2500, 5000, 10000 km. Jedes Jahr beginnt bei null.</p>
      <p><b>Allrounder:</b> eine Woche mit mindestens 3 verschiedenen Sportarten.</p>`)}

    ${abschnitt('Form: relative Werte', `
      <p>Unter „Form“ zählt nicht, wie viel du absolut machst, sondern wie viel <b>im Vergleich zu dir selbst</b>.</p>
      <p><b>100 % = dein Schnitt</b> der letzten 12 Monate. Verglichen werden die letzten 4 abgeschlossenen Wochen. 120 % heißt: ein Fünftel mehr als sonst.</p>
      <p>Grün: über deinem Schnitt (ab 105 %). Grau: im Schnitt. Orange: darunter (unter 95 %).</p>
      <p><b>Dieses Jahr bis heute</b> vergleicht vom 1. Januar bis heute mit dem gleichen Zeitraum im Vorjahr.</p>`)}

    ${abschnitt('Laufökonomie (Fitness-Stand)', `
      <p>Wie viel Tempo bekommst du pro Herzschlag? Je fitter du bist, desto schneller läufst du bei gleichem Puls.</p>
      <p>Die App rechnet für jeden Lauf <b>Geschwindigkeit ÷ Ø-Puls</b> und zeigt das anschaulich als <b>Pace bei Puls 150</b>. Sinkt diese Pace (z. B. von 6:10 auf 5:55 /km), bist du fitter geworden.</p>
      <p>Gezählt werden Läufe draußen ab 3 km mit Pulsmessung. Hitze, Hügel, Müdigkeit und Intervalle verfälschen einzelne Läufe, darum zählt der Median über mehrere Läufe.</p>
      <p>Einen VO2max-Wert liefert Garmin über die Schnittstelle leider nicht.</p>`)}

    ${abschnitt('Bestzeiten und Bestmarken', `
      <p><b>Bestzeiten</b> (1 km, 5 km, 10 km) kommen aus Garmins schnellsten Abschnitten eines Laufs. Hat Garmin keinen, nimmt die App die Durchschnitts-Pace eines Laufs, der mindestens so lang war („Ø des ganzen Laufs“). Laufband zählt hier nicht.</p>
      <p><b>Bestmarken</b>: längster Lauf, längste Radtour, längste Wanderung, meiste Höhenmeter an einem Tag, meiste Sportpunkte in einer Woche.</p>`)}

    ${abschnitt('Unrealistische Aktivitäten', `
      <p>Manchmal läuft die Aufzeichnung im Auto oder Zug weiter. Solche Aktivitäten erkennt die App an diesen Grenzen:</p>
      <p class="leise">${grenzen}</p>
      <p>Sie bleiben in der Liste („zählt nicht“), zählen aber nicht für Kilometer, Höhenmeter, Zeit, Bestmarken und Vergleiche. Sportpunkte zählen weiter, weil sie auf dem Puls beruhen.</p>`)}

    ${abschnitt('Werte in der Detailansicht', `
      <p><b>Pulszonen:</b> wie lange du in welchem Pulsbereich warst, von Zone 1 (Aufwärmen) bis Zone 5 (Maximum).</p>
      <p><b>Trainingseffekt</b> (0 bis 5): wie stark eine Einheit deine Ausdauer (aerob) und deine Spritzigkeit (anaerob) verbessert. Ab 3 verbessernd, ab 4 stark verbessernd.</p>
      <p><b>Trainingsbelastung:</b> Garmins Maß für die Anstrengung einer Einheit. <b>Body Battery:</b> wie viel Energie dich die Einheit gekostet hat.</p>`)}
  `;
}

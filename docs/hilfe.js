/**
 * hilfe.js – Erklär-Seite „So funktioniert die App“
 * Version: 0.14.2 (2026-11-18)
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
      <p>Die Einstellungen findest du unten in der Leiste unter <b>„Optionen“</b> (Zahnrad).</p>
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

    ${abschnitt('Alltagspunkte aus Schritten', `
      <p>Auch Bewegung im Alltag zählt: Die Android-App zählt die Schritte des Handys. Schritte, die während einer aufgezeichneten Garmin-Aktivität gezählt wurden, zieht die App ab – dafür gibt es schon Sportpunkte von der Uhr.</p>
      <p>Aus den übrigen <b>Alltagsschritten</b> werden Punkte: Die ersten <b>${zahlFormat0.format(Number(zustand.einstellungen.alltagFrei))} Schritte</b> am Tag zählen nicht (Grundbewegung), danach gibt es <b>1 Punkt pro ${zahlFormat0.format(Number(zustand.einstellungen.alltagProPunkt))} Schritte</b>. ${Number(zustand.einstellungen.alltagPunkte) ? '' : '<b>Zurzeit ausgeschaltet.</b>'}</p>
      <p>Warum diese Zahlen: Studien setzen 7000–8000 Schritte pro Tag ungefähr mit den empfohlenen 150 Minuten moderater Bewegung pro Woche gleich (WHO, z. B. Tudor-Locke 2011). Mit den Standardwerten ergeben 7000–8000 Schritte täglich 140–175 Alltagspunkte pro Woche, also etwa das Aktivziel von 150. Zügiges Gehen mit rund 100 Schritten pro Minute gilt als moderate Bewegung; Garmin und Google Fit („Herzpunkte“) zählen nach dem gleichen Prinzip.</p>
      <p>Alle Werte lassen sich unter Einstellungen ändern oder ganz ausschalten. Tage mit mehr als ${zahlFormat0.format(SCHRITTE_MAX)} Schritten gelten als unrealistisch und zählen nicht.</p>`)}

    ${abschnitt('Die zwei Wochenziele', `
      <p><b>Laufziel:</b> ${zielL} ${zielL === 1 ? 'Lauf' : 'Läufe'} pro Woche. Laufband zählt mit.</p>
      <p><b>Aktivziel:</b> ${zielP} Punkte pro Woche: Sportpunkte (jede Sportart) plus Alltagspunkte (Schritte). 150 ist die Empfehlung von Garmin und der WHO.</p>
      <p>Beide Ziele änderst du unter Einstellungen. Sie gelten auf allen Geräten.</p>`)}

    ${abschnitt('Serien und Abzeichen', `
      <p>Eine <b>Serie</b> zählt, wie viele Wochen hintereinander du ein Ziel erreicht hast. Die laufende Woche bricht die Serie nicht, solange sie noch nicht vorbei ist. Sobald du das Ziel erreichst, zählt sie mit.</p>
      <p><b>Serien-Abzeichen</b> gibt es für 4, 12, 26 und 52 Wochen in Folge. Rückwirkend gilt dein aktuelles Ziel.</p>
      <p><b>Jahres-Abzeichen</b> messen dich an deinen eigenen Vorjahren (Kilometer, bei Ski Skitage, jedes Jahr beginnt bei null):</p>
      <ul>
        <li><b>Bronze:</b> halb so viel wie in einem normalen Jahr (50 % deines Schnitts der letzten 3 Jahre)</li>
        <li><b>Silber:</b> ein normales Jahr (dein Schnitt der letzten 3 Jahre)</li>
        <li><b>Gold:</b> mehr als sonst (dein bestes der letzten 3 Jahre, mindestens 15 % über dem Schnitt)</li>
        <li><b>Rekord:</b> dein bestes Jahr überhaupt (nur wenn es höher liegt als Gold)</li>
      </ul>
      <p>Die <b>Hochrechnung</b> nimmt deinen Stand von heute und rechnet dazu, was in den letzten 3 Jahren im Schnitt von heute bis Silvester noch dazukam. So zählt die Saison mit: Skitage kommen im Winter, Wanderungen eher im Sommer. Ohne Vorjahre gelten feste Einstiegswerte.</p>
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
      <p><b>Bestmarken</b>: längster Lauf, längste Radtour, längste Wanderung, meiste Höhenmeter an einem Tag, meiste Sportpunkte in einer Woche. Bei den Höhenmetern zählt Pistenski nicht mit, weil Garmin dort die Liftfahrten mitrechnet; Skitouren zählen.</p>`)}

    ${abschnitt('Unrealistische Aktivitäten', `
      <p>Manchmal läuft die Aufzeichnung im Auto oder Zug weiter. Solche Aktivitäten erkennt die App an diesen Grenzen:</p>
      <p class="leise">${grenzen}</p>
      <p>Sie bleiben in der Liste („zählt nicht“), zählen aber nicht für Kilometer, Höhenmeter, Zeit, Bestmarken und Vergleiche. Sportpunkte zählen weiter, weil sie auf dem Puls beruhen.</p>`)}

    ${abschnitt('Android-App und Benachrichtigungen', `
      <p>Die Android-App zeigt dieselbe Oberfläche wie die Webseite und kann zusätzlich Benachrichtigungen schicken. Sie wird in GitHub gebaut; neue Versionen meldet sie selbst („Update verfügbar“).</p>
      <p><b>Erinnerung:</b> zur eingestellten Zeit, aber nur, wenn ein Wochenziel noch offen ist. <b>Wochenrückblick:</b> Ziele, Serien und Vergleich mit deinem Schnitt; Montag bis Donnerstag über die vergangene Woche, sonst über die laufende. <b>Erfolge:</b> neue Bestzeiten, Bestmarken und Jahres-Abzeichen, sobald neue Aktivitäten importiert sind.</p>
      <p>Die App prüft etwa alle 30 Minuten im Hintergrund. Einstellen kannst du alles unter Einstellungen → Benachrichtigungen.</p>`)}

    ${abschnitt('Schritte vom Handy', `
      <p>Die Android-App liest den eingebauten Schrittzähler des Handys. Er zählt ohnehin ständig mit und braucht praktisch keinen Akku; GPS wird nicht verwendet.</p>
      <p>Gezählt wird nur, wenn du das Handy dabei hast, und erst ab der Installation. Die Schritte der Garmin-Uhr zählen nicht dazu, damit nichts doppelt zählt.</p>
      <p>In der Wochenansicht siehst du die Schritte pro Tag und den Wochenschnitt im Vergleich zu den 90 Tagen davor; unter „Form“ die letzten 28 Tage im Vergleich zu deinem Schnitt (ab 3 Wochen Daten). Schritte zählen nicht als Sportpunkte.</p>`)}

    ${abschnitt('Karte', `
      <p>Die Karte zeigt alle aufgezeichneten Spuren von Wanderungen, Radfahrten, Skitagen und (zuschaltbar) Läufen als <b>Heatmap</b>: Je öfter du eine Strecke gegangen oder gefahren bist, desto dicker die Linie (1×, 2–4×, 5× und öfter). Die App legt dafür ein Raster von etwa 25 m über die Karte und zählt, wie viele verschiedene Aktivitäten durch jedes Feld gehen. Antippen zeigt alle Aktivitäten an dieser Stelle.</p>
      <p><b>Zug und GPS-Sprünge:</b> Teile einer Spur, in denen du für die Sportart unrealistisch schnell warst (über eine Minute gemessen, z. B. Wandern schneller als 15 km/h), schneidet die App heraus. Ebenso Sprünge und Lücken, etwa wenn die Uhr im Zug pausiert war. Dort ist die Linie unterbrochen statt quer über die Landschaft gezogen. In der Detailansicht steht, wie viele Kilometer ausgeblendet sind.</p>
      <p>Tippst du auf eine Linie, werden alle Routen an dieser Stelle <b>gelb markiert</b>. In der Liste darunter markiert ein Tippen eine einzelne Route; dort stehen auch Distanz, Dauer und Höhenmeter auf (↑) und ab (↓).</p>
      <p>Weit herausgezoomt werden die Linien breiter und jede Route bekommt einen <b>Punkt</b>, damit du auch kurze Touren findest. Beim Hineinzoomen verschwinden die Punkte.</p>
      <p>Das Symbol mit den vier Ecken öffnet die Karte im <b>Vollbild</b>; die Zurück-Taste schließt es.</p>
      <p>Über das Symbol oben rechts in der Karte blendest du die <b>offiziellen Wanderwege der Schweiz</b> (swisstopo) ein: So siehst du, wo es Wege gibt, auf denen du noch nicht warst. Als Grundkarte gibt es die Landeskarte von swisstopo oder OpenStreetMap.</p>
      <p>Die Spuren kommen aus den Originaldateien der Uhr (FIT), bei älteren oder importierten Aktivitäten aus GPX- oder TCX-Dateien. Beim ersten Mal lädt die App die ganze Historie im Hintergrund nach; das kann ein paar Stunden dauern. Unrealistische Aktivitäten (z. B. Autofahrt mit laufender Aufzeichnung) erscheinen nicht.</p>`)}

    ${abschnitt('Historie', `
      <p>Unter „Historie“ findest du alle Aktivitäten seit Beginn. Die Suche durchsucht Name, Ort, Sportart, Jahr und Monat (Umlaute egal, mehrere Wörter möglich, z. B. „Leytron 2025“).</p>
      <p>Filtern kannst du nach Sportart (mehrere wählbar), Jahr, Länge und Ort (Garmins Ortsname, Orte ab zwei Aktivitäten), sortieren nach Datum, Distanz, Höhenmeter oder Dauer. Oben steht die Summe der Treffer. Tippen öffnet die Details, „Zurück“ führt an dieselbe Stelle der Liste.</p>`)}

    ${abschnitt('Mehrtagestouren', `
      <p>Die App erkennt Wander- und Radtouren über mehrere Tage automatisch: Eine <b>Etappe</b> beginnt ungefähr dort (bis 3 km), wo die vorherige aufgehört hat, mit höchstens 2 Pausentagen dazwischen. Eine Tour hat nur eine Sportart, mindestens zwei Etappen an verschiedenen Tagen, mindestens <b>eine Übernachtung unterwegs</b> und entfernt sich am Stück mindestens 20 km vom Start.</p>
      <p>Keine Tour sind: Ausflüge, zwischen denen du <b>zu Hause</b> geschlafen hast (Start und Ende einer Tour dürfen zu Hause liegen), und Ferien an einem <b>Standort</b> (mehr als zwei Nächte am selben Ort).</p>
      <ul>
        <li><b>Ausflug:</b> eine Rundtour am Etappenort, z. B. wenn du zweimal am selben Ort übernachtest.</li>
        <li><b>Lücke:</b> Zwischen zwei Aufzeichnungen am selben Tag (oder am nächsten Tag, wenn du schon unterwegs übernachtet hast) darf die nächste Etappe auch weiter weg beginnen, z. B. nach einem Stück mit dem Zug. Auf der Karte ist dort keine Linie.</li>
        <li><b>Pendeln</b> zählt nie: Fahrten zwischen zwei Orten, an denen du sehr oft startest oder ankommst (z. B. Zuhause und Arbeit), gehören zu keiner Tour.</li>
      </ul>
      <p><b>Orte:</b> Start und Ziel jeder Etappe und die größeren Orte unterwegs („über …“) kommen aus einer Ortsliste in der App (GeoNames, CC BY 4.0). Deine Spuren verlassen dafür das Handy nicht. Die Karte lässt sich oben rechts umschalten; außerhalb der Schweiz beginnt sie mit OpenStreetMap.</p>
      <p>Touren findest du unter Historie → „Touren“, in den Erfolgen und auf der Karte (Filter „Nur Touren“). Die Tour-Seite zeigt alle Etappen auf einer Karte, jeden Tag in einer eigenen Farbe, dazu Summen und die Etappenliste mit Pausentagen.</p>
      <p><b>Korrigieren:</b> Auf der Tour-Seite umbenennen, mit „×“ eine Aktivität herausnehmen oder die ganze Tour auflösen. Fehlt eine Aktivität, öffne sie und tippe auf „Zu Tour hinzufügen“. Die Korrekturen gelten auf allen Geräten.</p>`)}

    ${abschnitt('Fotos aus dem Fotoschatz', `
      <p>Ist der Fotoschatz verbunden (Optionen → Fotoschatz), zeigt die App Fotos aus dem Zeitraum einer Tour bzw. während einer Aktivität: als schmalen Bildstreifen unter der Karte und als kleine Punkte mit Kamera-Symbol (bzw. Anzahl) auf der Karte. Ein Punkt öffnet ein Vorschaufenster auf der Karte, bei mehreren Fotos mit ‹ › zum Blättern; × oder Tippen daneben schließt es, Tippen aufs Bild zeigt es groß. Der Kamera-Knopf links auf der Karte blendet die Fotos ein und aus. Im großen Bild blättert Wischen, „Fotoschatz“ öffnet es dort.</p>
      <p>Der Fotoschatz-Link wird nur auf diesem Gerät gespeichert. Im Browser lässt er sich aus dem Fotoschatz übernehmen, in der Android-App wird er einmal eingefügt. Das Verzeichnis der Fotos lädt die App höchstens einmal am Tag neu.</p>`)}

    ${abschnitt('Mit Garmin abgleichen', `
      <p>Die App übernimmt neue Aktivitäten von Garmin automatisch, spätere Änderungen aber nicht. Hast du bei Garmin eine Aktivität geändert (z. B. Sportart, Name, gekürzt) oder gelöscht, gehe zu Einstellungen → „Mit Garmin abgleichen“.</p>
      <p>Wähle den Zeitraum, in dem die Aktivität <b>stattfand</b>, und tippe auf „Prüfen“. Die App zeigt, was sich unterscheidet, ändert aber noch nichts. Erst mit „Übernehmen“ werden Änderungen ersetzt, gelöschte Aktivitäten entfernt und fehlende ergänzt. Hat sich die Strecke geändert, wird auch die Spur neu geladen. Der Abgleich läuft nie automatisch.</p>`)}

    ${abschnitt('Wartung', `
      <p>Unter Optionen → „Wartung“ startest du Diagnosen und Einrichtungen von Apps Script direkt aus der App, ohne PC. Das Protokoll erscheint darunter und lässt sich kopieren. Es enthält nur Zählungen, keine Orte.</p>
      <ul>
        <li><b>Stand der Spuren:</b> wie viele Spuren geladen, ohne GPS oder fehlerhaft sind, wie viele bereinigt wurden und ob noch nachgeladen wird</li>
        <li><b>Spur-Filter prüfen:</b> lädt 10 noch offene Spuren zur Probe und zeigt, was passiert (speichert nichts)</li>
        <li><b>Spuren nachladen:</b> startet den Zeitgeber, der fehlende Spuren alle 10 Minuten nachlädt und sich danach selbst beendet</li>
        <li><b>Abgleich-Diagnose:</b> vergleicht die letzten 30 Tage mit Garmin (ändert nichts)</li>
        <li><b>Status Sammler:</b> letzter Import, letzter Fehler, Zeitgeber</li>
      </ul>`)}

    ${abschnitt('Werte in der Detailansicht', `
      <p><b>Pulszonen:</b> wie lange du in welchem Pulsbereich warst, von Zone 1 (Aufwärmen) bis Zone 5 (Maximum).</p>
      <p><b>Trainingseffekt</b> (0 bis 5): wie stark eine Einheit deine Ausdauer (aerob) und deine Spritzigkeit (anaerob) verbessert. Ab 3 verbessernd, ab 4 stark verbessernd.</p>
      <p><b>Trainingsbelastung:</b> Garmins Maß für die Anstrengung einer Einheit. <b>Body Battery:</b> wie viel Energie dich die Einheit gekostet hat.</p>`)}
  `;
}

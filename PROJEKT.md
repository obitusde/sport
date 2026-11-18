# PROJEKT.md – Sport-Tracker (Arbeitstitel „sport")

Version: 0.14.2 (2026-11-18) – v0.14 Fotos aus dem Fotoschatz

Dieses Dokument ist die Grundlage für die Entwicklung mit Claude Code. Es beschreibt Ziele, Architektur, Arbeitsweise und Fahrplan. Claude Code liest es vor jeder Arbeit und hält es aktuell.

---

## 1. Ziele

Christof läuft, fährt Rad und wandert. Er zeichnet mit einer Garmin Epix (Gen 2) und einem Garmin-Fahrradtacho auf und synchronisiert wie gewohnt mit Garmin Connect. Die Statistiken in Garmin Connect findet er nicht anschaulich, vor allem fehlt der Verlauf über die Zeit. Er macht keine Wettkämpfe.

Die App soll:

1. **Automatische Liste:** Jede Aktivität mit Datum, Sportart, km, Zeit und Höhenmetern, ohne Zutun.
2. **Wochenübersicht:** Was in dieser Woche gemacht wurde und was noch fehlt.
3. **Motivation:** Wochenziel für Läufe (1–2 pro Woche) mit Fortschrittsanzeige und Wochen-Serie.
4. **Verlauf:** Wochen, Monate und Jahre im Vergleich, getrennt nach Laufen, Rad und Wandern.
5. **Karte:** Alle Wanderungen (optional Läufe und Fahrten) mit voller GPS-Spur auf einer Karte, filterbar nach Sportart und Jahr.
6. **Ohne PC entwickelbar:** Änderungen vom Handy aus über Claude Code, Deployment vollautomatisch.

---

## 2. Architektur

```
Epix / Tacho → Garmin Connect (unverändert)
                     ↓
          Garmin Connect Personal API
                     ↓  1x täglich (ca. 03:00 Europe/Zurich)
   Apps Script „Sammler"
     • Zugriffstoken holen (24 h gültig)
     • neue Aktivitäten → Sheet „Aktivitaeten"
     • GPS-Spuren aus den FIT-Dateien → Blatt „Spuren“ (ab v0.9, statt Drive)
                     ↓
   Apps Script Web-App (doGet, prüft Web-App-Token)
     • liefert Liste, Wochenwerte, Spuren als JSON
                     ↓
   PWA auf GitHub Pages
     • Ansichten: Woche · Form · Erfolge · Einstellungen (+ Detail, Erklärungen)
                     ↑ (eingebettet)
   Android-App (APK, in GitHub gebaut, ab v0.7)
     • zeigt die PWA im WebView, Brücke window.SportApp
     • Hintergrund-Job ~30 min: Benachrichtigungen (Text von der Web-App), Update-Prüfung
     • Schrittzähler des Handys (v0.8) → Blatt „Schritte“
```

### Bausteine

| Baustein | Technik | Aufgabe |
|---|---|---|
| Datenquelle | Garmin Connect Personal API | Aktivitäten (JSON-Zusammenfassung, FIT-Datei) |
| Sammler | Google Apps Script, Zeitgeber täglich | Abrufen, Doppelte vermeiden, speichern |
| Datenbank | Google Sheet | Eine Zeile pro Aktivität, Konfiguration |
| Spuren | Google Drive, privater Ordner | Volle GPS-Spur pro Aktivität als GeoJSON |
| Schnittstelle | Apps Script Web-App | JSON für die PWA, nur mit Web-App-Token |
| Oberfläche | PWA auf GitHub Pages | Anzeige, offline-fähig (Service Worker) |
| Karte | Leaflet + swisstopo- oder OSM-Kacheln | Spuren anzeigen, Heatmap-Effekt durch Überlagerung |
| Android-App | Kotlin ohne Zusatzbibliotheken, WebView, JobScheduler, GitHub Action | Benachrichtigungen, Updates, (v0.8) Schritte |

### Garmin Connect Personal API (Stand November 2026)

- Seit 21.10.2026 für Einzelpersonen kostenlos und ohne Antrag.
- Doku: https://developer.garmin.com/gc-developer-program/personal/personal-api/
- FAQ: https://developer.garmin.com/gc-developer-program/personal/personal-faq/
- Swagger (Endpunkte): https://developer.garmin.com/gc-developer-program/personal/swagger-docs/
- GitHub-Ressourcen: https://github.com/garmin
- Schlüssel erzeugen: https://connect.garmin.com/app/settings/personalApiToken (Laufzeit wählbar, hier 1 Jahr)
- Token holen:
  ```
  POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token
  Header: Authorization: ApiKey <api-key>
  ```
- Zugriffstoken gilt 24 Stunden (oder bis der Schlüssel abläuft), kein Refresh-Token. Bei jedem Lauf neu holen.
- Schlüssel-Laufzeit wählbar: 30, 90, 180 Tage oder 1 Jahr. Garmin mailt etwa eine Woche vor Ablauf.
- Nur Abfragen, keine Push-Benachrichtigung. Deshalb täglicher Zeitgeber.
- Garmin entfernt in API-Dateien möglicherweise berechnete Werte (VO2max, Erholungszeit). Für dieses Projekt unwichtig.

**Laut Swagger-Doku (OpenAPI 3.0.1, gelesen am 2026-11-17)**, Server `https://personal.connectapi.garmin.com`:

| Endpunkt | Zweck |
|---|---|
| `GET /activitylist-service/activities/search/activities` | Liste (`SummarizedActivityDTO[]`). Parameter u. a. `startDate`, `endDate` (YYYY-MM-DD, lokale Startzeit, inklusiv), `start` (Versatz, Standard 0), `limit` (Standard 99), `sortOrder` (`asc`/`desc`), `activityType` (nur Eltern-Typ), `excludeChildren` (Standard true) |
| `GET /activity-service/activity/{activityId}` | Details (`ActivitySummaryDTO`: `summaryDTO`, `metadataDTO`, `activityTypeDTO`, `splitSummaries` …) |
| `GET /download-service/files/activity/{activityId}` | Originaldatei als ZIP (`application/x-zip-compressed`), also die FIT-Datei |

- Die Liste enthält alle Felder fürs Sheet: `activityId`, `startTimeLocal`, `activityType.typeKey`, `distance` (m), `movingDuration`, `elapsedDuration`, `elevationGain`, `averageHR`, `manufacturer`, `hasPolyline`, `startLatitude/-Longitude`.
- `activityType` hat `typeId`, `typeKey` (z. B. `running`) und `parentTypeId` (17 = selbst Eltern-Typ).
- **Kein Endpunkt für die GPS-Spur.** Die volle Spur gibt es nur in der FIT-Datei.
- Die Doku beschreibt weder die Token-Antwort noch Ratenlimits noch die Länge der Historie.

**Ergebnis der Diagnose v0.1.0 (2026-11-17, aus Apps Script):**

- Token-Antwort ist reiner Text (`text/plain`, ca. 1140 Zeichen), kein JSON.
- Aufrufe mit `Authorization: Bearer <token>` funktionieren, ca. 300 ms pro Aufruf.
- Die Liste liefert nur gefüllte Felder. `hasPolyline` fehlt, GPS erkennt man an `startLatitude`.
- `metadataDTO` enthält nur `manufacturer`, kein Gerätemodell.
- Historie vollständig über die Liste: 2740 Aktivitäten von 2012 bis heute, 28 Seiten à 99 in ca. 21 s.
- Keine Ratenlimit-Kopfzeilen, kein Fehler bei 28 Abrufen am Stück (mit 300 ms Pause).
- Download der Originaldatei mit `Accept: application/json` → HTTP 406, mit `Accept: */*` → HTTP 200.

**Ergebnis der Diagnose v0.1.1 (2026-11-17):**

- `metadataDTO.fileFormat` = `{"formatId":7,"formatKey":"fit"}`.
- Download: ZIP (`application/x-zip-compressed`, Beispiel 64 KB) mit einer `.fit`-Datei (151 KB). `Utilities.unzip` funktioniert.
- FIT-Scan in Apps Script in 19 ms: 1856 `record`-Nachrichten, davon 1849 mit GPS-Position.
- Feld 2 `altitude` ist leer. Die Epix schreibt die Höhe vermutlich in `enhanced_altitude` (Feld 78), das wird beim Spur-Bau geprüft.
- Viele Nachrichtentypen ohne Bedeutung für uns (z. B. 160, 233), der Scanner überspringt sie korrekt.
- Bedingungen: Christof liest beim Erzeugen des Schlüssels die Nutzungsbedingungen. Keine Garmin-Daten an ein Sprachmodell (OpenRouter o. Ä.) schicken, bevor geklärt ist, dass das erlaubt ist.

### Entscheidungen

- **Abruf 1x täglich** reicht.
- **Volle GPS-Spuren werden gespeichert**, ohne Abschneiden um den Wohnort, weil sie privat in Drive liegen. Kürzen rund ums Zuhause nur bei Funktionen zum Teilen.
- **Keine Aktivitäts- oder GPS-Daten im Repo.** Das Repo und GitHub Pages sind öffentlich.
- **FIT-Auswertung in Apps Script** (entschieden nach Diagnose 0.1.1): Die GPS-Spur steckt nur in der FIT-Datei. Der eigene FIT-Scanner liest sie in Millisekunden. Keine GitHub Action nötig, die Daten verlassen Google nicht.
- **Woche beginnt am Montag.**
- **Wochenziel Läufe** wird in der App unter Einstellungen festgelegt, Standard 2 pro Woche. Gespeichert im Sheet „Konfiguration“, damit es auf allen Geräten gilt.
- **Die App rechnet** (entschieden 2026-11-17): Die Web-App liefert die ganze Aktivitätsliste kompakt (ca. 2700 Zeilen). Woche, Laufziel, Serie und später der Verlauf werden in der App berechnet. Die App speichert die letzten Daten im localStorage und zeigt sie sofort und offline.
- **Wochen-Serie:** Wochen in Folge mit erreichtem Laufziel. Die laufende Woche zählt mit, sobald das Ziel erreicht ist, und bricht die Serie nicht, solange sie offen ist. Rückwirkend gilt das aktuelle Wochenziel.
- **Aktualisieren:** Nachts automatisch (3–4 Uhr), tagsüber nur von Hand über den Knopf „Von Garmin holen“ in der App. Kein stündlicher Abruf.
- **Distanz in der App:** immer eine Nachkommastelle mit Komma, abgerundet (4,96 km → „4,9 km“).
- **Detailansicht** (v0.4): Beim Tippen auf eine Aktivität holt die App die Spalte `details` über die Web-App und merkt sie sich auf dem Gerät. Die Liste bleibt dadurch klein.
- **Sportpunkte = Garmins Intensitätsminuten** (entschieden 2026-11-17): moderate Minuten ×1, intensive ×2, aus den Aktivitäten (`moderateIntensityMinutes`, `vigorousIntensityMinutes`). Pulsbasiert, dadurch sportartübergreifend vergleichbar: Eine lange Wanderung oder ein Skitag zählt wie entsprechend viele Läufe. Minuten im Alltag ohne Aktivität zählen nicht.
- **Sportpunkte erst ab 2023** (Diagnose: Intensitätsminuten gibt es erst ab 2023, davor meist nicht einmal Puls). Ab 2023 fehlende Werte (ca. 240 Aktivitäten) werden geschätzt: Bewegungsminuten × persönlicher Faktor der Sportart (Summe Punkte / Summe Minuten der Aktivitäten mit echten Werten ab 2023), in der App mit „≈“ markiert. Berechnet in `gas/WebApp.gs`.
- **Bestzeiten Laufen:** schnellste 1 km, 5 km, 10 km, Halbmarathon aus Garmins schnellsten Abschnitten; fehlen diese, zählt die Durchschnitts-Pace eines Laufs, der mindestens so lang war. Ohne Laufband, ohne unplausible Werte (schneller als 2:30 /km).
- **Jahres-km-Stufen:** Laufen und Wandern 100, 250, 500, 1000 km; Rad 1000, 2500, 5000, 10000 km. Nur fürs laufende Jahr als Abzeichen; die frühere Jahrestabelle mit Stufen war unverständlich und ist entfernt (Feedback 2026-11-17).
- **Unrealistische Aktivitäten** (Feedback: „Wanderung“ mit 795,7 km): Ø-Geschwindigkeit über die Bewegungszeit oder Distanz über einer Grenze je Sportart (Laufen 22 km/h / 60 km, Wandern 8 km/h / 70 km, Rad 45 km/h / 400 km, Schwimmen 6 km/h / 15 km). Solche Aktivitäten bleiben sichtbar („zählt nicht“), zählen aber nicht für km, Höhenmeter, Zeit, Bestmarken und Vergleiche. Sportpunkte zählen weiter (pulsbasiert). Berechnet in der App (`plausibilitaet` in `docs/app.js`).
- **Relative Werte vor absoluten** (Feedback 2026-11-17): Die Ansicht „Form“ vergleicht mit dem eigenen Schnitt. 100 % = Ø der letzten 52 abgeschlossenen Wochen, verglichen mit den letzten 4 abgeschlossenen Wochen. Grün ab 105 %, orange unter 95 %. Dazu „Jahr bis heute“ gegenüber dem Vorjahr bis zum gleichen Tag.
- **Laufökonomie** = Geschwindigkeit ÷ Ø-Puls (Meter pro Herzschlag) für Läufe draußen ab 3 km mit Puls, Median; angezeigt als „Pace bei Puls 150“. Vergleich letzte 3 Monate gegenüber den 3 Monaten davor und dem Vorjahr, Monatsverlauf über 24 Monate (100 = Ø 12 Monate).
- **Bestzeiten** nur 1 km, 5 km, 10 km (Halbmarathon entfernt).
- **Erklär-Seite** in der App („So funktioniert die App“, `docs/hilfe.js`), erreichbar über „?“ und die Einstellungen.
- **Zwei Wochenziele mit eigener Serie:** Laufziel (Standard 2 Läufe) und Aktivziel (Standard 150 Sportpunkte, wie Garmin/WHO), beide in der App einstellbar.
- **Gamification:** Abzeichen für Serien (4, 12, 26, 52 Wochen), Bestmarken (längster Lauf, schnellster 5er, meiste Höhenmeter an einem Tag), Jahres-Abzeichen (ab v0.10 persönlich, siehe unten), Allrounder (3 Sportarten in einer Woche), Wochenbilanz („beste Woche seit …“).
- **Fitness-Stand = Laufökonomie-Trend:** Tempo im Verhältnis zum Puls über Monate, als Diagramm im Verlauf, als kurze Zeile in der Wochenansicht. VO2max liefert die API nicht.
- **Android-App als Hülle** (entschieden 2026-11-18): APK mit WebView um die bestehende PWA, damit die Oberfläche eine Codebasis bleibt und ohne neue APK aktualisiert wird. Nativ nur: Benachrichtigungen, Update-Prüfung, (v0.8) Schrittzähler. Gebaut von `.github/workflows/android.yml`; versionCode = Laufnummer der Action; Release-Tag `apk-<Laufnummer>`. Update-Prüfung über die GitHub-API (`releases/latest`), Installation per Download im Browser.
- **Benachrichtigungen:** konfigurierbar in der App (Einstellungen): Erinnerung (Standard Do 18 Uhr, nur wenn ein Ziel offen ist), Wochenrückblick (Standard So 19 Uhr; Mo–Do über die Vorwoche), Erfolge (Bestzeiten, Bestmarken, Jahres-Abzeichen neuer Importe). Hintergrund-Job etwa alle 30 Minuten; Texte rechnet die Web-App (`gas/Meldungen.gs`), damit die Logik nicht in Kotlin doppelt steht.
- **Schrittzähler** (entschieden 2026-11-18): Hardware-Sensor `TYPE_STEP_COUNTER` des Handys, kein GPS, keine Gesundheits-App. Gelesen etwa alle 30 Minuten im Hintergrund-Job und beim Öffnen der App; Differenz zum letzten Stand wird auf Kalendertage verteilt (über Mitternacht anteilig). Übertragung der letzten 14 Tage höchstens alle 2 Stunden (beim Öffnen alle 10 Minuten). Uhr-Schritte zählen nicht dazu. Schritte sind keine Sportpunkte. Anzeige: Tageswerte in der Wochenansicht, Wochenschnitt (nur abgeschlossene Tage) gegenüber 90 Tagen davor, unter „Form“ 28 Tage gegenüber bis zu 365 Tagen davor, Zeile im Wochenrückblick.
- **Alltagspunkte** (entschieden 2026-11-18): Handy-Schritte außerhalb aufgezeichneter Garmin-Aktivitäten (Abzug über Messabschnitte des Handys) zählen zum Aktivziel. Formel: max(0, Alltagsschritte − frei) / Schritte pro Punkt, Standard 3000 frei und 200 Schritte pro Punkt; einstellbar in der App (`alltagPunkte`, `alltagFrei`, `alltagProPunkt`). Begründung: Tudor-Locke u. a. 2011 (IJBNPA 8:79): 100 Schritte/min ≈ moderate Intensität, 7000–8000 Schritte/Tag ≈ Empfehlung von 150 Min. pro Woche; mit den Standardwerten ergeben 7000–8000 Schritte 140–175 Punkte pro Woche. Tage über 50 000 Schritte gelten als unrealistisch. „Punkte“ = Sportpunkte + Alltagspunkte (Aktivziel, Serie, Form, Benachrichtigungen).
- **Karte** (entschieden 2026-11-18): Heatmap aller Spuren (Wandern, Rad, Ski, Laufen zuschaltbar) auf der grauen Landeskarte von swisstopo (umschaltbar: farbig, OpenStreetMap), Ebene „Wanderwege (Schweiz)“ von swisstopo, um unbegangene Wege zu sehen. Leaflet 1.9.4 von cdnjs mit SRI-Prüfsumme, erst beim Öffnen geladen. Spuren im Browser-Cache „sport-daten“. Spur in der Detailansicht.
- **Karte ab v0.10** (entschieden 2026-11-18): Heatmap nach Häufigkeit statt Überlagerung: Raster 30 m (Web-Mercator, in der Schweiz ca. 21 m), gezählt werden verschiedene Aktivitäten pro Feld, die nächsten Nachbarfelder zählen mit. Linienbreite 1× / 2–4× / ab 5×, kräftigere Farben, weißer Rand, Grundkarte blasser (grau 60 %), swisstopo-Kacheln auf hochauflösenden Bildschirmen in halber Größe (Schrift nicht übergroß), ganze Zoomstufen (keine Kachelkanten). Antippen listet alle Aktivitäten an der Stelle. Vollbild für beide Karten, Detail-Karte oben und größer. Spuren werden beim Öffnen der Karte neu geladen.
- **Spur-Filter** (entschieden 2026-11-18): Zugfahrten und GPS-Sprünge werden aus den Spuren herausgeschnitten und nicht angezeigt. Tempo über 60 Sekunden (Luftlinie) über der Grenze der Sportart (Wandern 15, Laufen 30, Rad 80 km/h, Ski ohne Tempogrenze), Abstand zweier Punkte über 400 m (Rad 1000, Ski 1500 m) oder ein Sprung über 50 m mit unrealistischem Tempo unterbricht die Linie; Reste unter 150 m fallen weg. Zeitstempel aus den FIT-Records (Feld 253). Mehrere Teile durch Leerzeichen getrennt. Kilometer der Aktivität bleiben unverändert (Garmin-Wert).
- **Abgleich mit Garmin** (entschieden 2026-11-18): nur auf Knopfdruck, nicht automatisch. Zeitraum = Datum der Aktivität. Erst „Prüfen“ (zeigt geändert / gelöscht / fehlt), dann „Übernehmen“. Spur wird bei geänderter Strecke neu geladen.
- **Jahres-Abzeichen persönlich** (entschieden 2026-11-18): Bronze = 50 % des Schnitts der letzten 3 Jahre, Silber = Schnitt, Gold = bestes dieser Jahre (mind. 15 % über Schnitt), Rekord = bestes Jahr überhaupt (nur wenn höher als Gold); auf schöne Zahlen gerundet. Ski in Skitagen. Ohne Vorjahr feste Einstiegswerte. Hochrechnung bis Jahresende mit der Saison der Vorjahre. Gleiche Regeln in `docs/app.js` und `gas/Meldungen.gs`.
- **v0.11** (entschieden 2026-11-18): Angetippte Spuren gelb markieren (einzelne in der Popup-Liste wählbar), Popup mit Höhenmetern auf/ab. Weit herausgezoomt breitere Linien (Faktor bis 2,4) und ein Punkt je Spur bis Zoom 11. Neuer Reiter „Historie“ (Suche, Filter Sportart/Jahr/Länge/Ort, Sortierung); der Reiter „Einstellungen“ heißt in der Leiste „Optionen“ (Platz für sechs Reiter). Wartung per Knopf in der App statt Script-Editor (Aktion `wartung`, feste Auswahl, Protokoll in der App). GPX/TCX aus dem ZIP lesen, wenn keine FIT-Datei drin ist (ältere/importierte Aktivitäten); nur Spuren ohne Ergebnis werden dafür erneut geladen, nicht die ganze Historie.
- **Mehrtagestouren** (entschieden 2026-11-18, v0.12): automatisch erkannt in der App (`docs/touren.js`), sofort angezeigt, korrigierbar. Nur eine Sportart (Wandern oder Rad). Etappe beginnt bis 3 km vom Ende der vorherigen, bis 2 Pausentage dazwischen. Rundtour am Etappenort = Ausflug (z. B. zwei Nächte am selben Ort). Lücke (Zug zwischen zwei Aufzeichnungen) bis 200 km am selben Tag oder am nächsten Tag, wenn die Tour schon einen normalen Anschluss hat. Pendeln ausgeschlossen: Orte mit mindestens 15 Starts/Enden (Raster 500 m, aus den Daten berechnet, keine Orte im Code) – Aktivitäten zwischen zwei solchen Orten gehören zu keiner Tour. Gültig ab 2 Etappen an verschiedenen Tagen, mindestens einem normalen Anschluss und 20 km Entfernung vom Start. Korrekturen (Name, aufgelöst, Aktivität ohne Tour, Aktivität von Hand zu Tour) im Blatt „Touren“. Anzeige: Historie → Touren, Tour-Seite (Karte mit Tagesfarben, Etappenliste mit Pausentagen), Hinweis in der Detailansicht, Karte „Nur Touren“, Erfolge.
- **Tour-Regeln ab v0.13** (Feedback 2026-11-18 mit echten Fällen: Lugano → Melide und Avignon → Aix richtig; Ferien in Albenga mit Sprung nach Aosta und Tagesausflüge ab Zuhause falsch): Übernachtung an einem häufigen Ort beendet die Tour; mindestens eine Übernachtung unterwegs; Lücke am nächsten Tag nur nach einer Übernachtung unterwegs; 20 km Entfernung am Stück ohne Lücken; mehr als zwei Nächte am selben Ort = Ferien-Standort.
- **Orte unterwegs** (v0.13): Ortsliste `docs/daten/orte.txt` aus GeoNames cities1000 (CC BY 4.0): Schweiz/Liechtenstein ab 1000, IT/FR/DE/AT ab 3000, übriges Europa ab 10 000, Welt ab 100 000 Einwohnern (ca. 22 000 Orte, 330 KB gezippt), wird erst auf Tour-Seiten geladen. Kein Online-Dienst, die Spuren verlassen das Gerät nicht. Etappe „Start → Ziel, über …“ (bis 3 größte Orte im Umkreis von 1,5 km der Spur, ohne Orte bis 3 km um Start und Ziel); Tour „über …“ (5 größte Orte); automatischer Name aus erstem und letztem Punkt.
- **Kartenwahl** (v0.13): grau / farbig / OpenStreetMap auf allen Karten, gespeichert im Gerät (`sport.grundkarte`); Detail- und Tour-Karte beginnen außerhalb der Schweiz mit OpenStreetMap.
- **Fotoschatz-Verknüpfung** (entschieden 2026-11-18, v0.14, `docs/fotos.js`): Fotos aus dem Zeitraum einer Tour (1 h vor bis 3 h nach) bzw. einer Aktivität (±15 min) als Bildstreifen und als dezente, zusammengefasste Punkte auf der Karte (Ebene „Fotos“, abschaltbar), Betrachter mit Blättern, Link in den Fotoschatz. Quelle: `index-<Schlüssel>.json` aus R2 mit Christofs Fotoschatz-Link; der Link liegt nur im Gerät (`sport.fotoschatz`), im Browser übernehmbar aus `fotoschatz.links` (gleiche Herkunft), in der APK eingefügt. Verzeichnis im Cache, höchstens täglich neu. Link-Format `…/fotoschatz/?f=<Ordner>&b=<Bild-id>#<Link>`; die Auswertung von `f`/`b` muss im Fotoschatz-Repo gebaut werden (Prompt an Christof übergeben, diese Sitzung hat dort keinen Schreibzugriff). Android 0.14.0: Im WebView bleibt nur `/sport/`, der Fotoschatz öffnet im Browser.
- **Bestmarke Höhenmeter ohne Pistenski** (Garmin zählt die Liftfahrten mit), Skitouren zählen.
- **Keine geschätzten Sportpunkte für unrealistische Aktivitäten** (nur echte Intensitätsminuten), seit Web-App 0.7.0.
- **App ohne Build-Schritt:** schlichtes HTML/CSS/JavaScript in `/docs`, GitHub Pages veröffentlicht direkt.
- **Deployment per GitHub Action schon ab v0.1** (statt erst v0.2). Die Skript-ID steht als Repo-Variable `GAS_SCRIPT_ID`, die Action erzeugt daraus `gas/.clasp.json`. clasp-Version fest: `@google/clasp@3.4.1`.
- **Diagnose-Protokolle ohne Werte:** Die Diagnose loggt standardmäßig nur Struktur und Zählungen (`WERTE_LOGGEN = false`), damit das Protokoll keine Aktivitätsdaten enthält.
- **Historie:** Die API reicht bis 2012 zurück. Ein Import aus dem Garmin-Datenexport ist nicht nötig. Der erste Lauf des Sammlers holt die ganze Historie.
- **Sheet legt der Sammler selbst an** („Sport-Daten“, ID in Script Property `SHEET_ID`).
- **Täglicher Abruf der letzten 14 Tage**, damit spät synchronisierte Aktivitäten nicht fehlen. Doppelte über `activityId`. Spätere Änderungen in Garmin (z. B. Typ, gelöscht) übernimmt ab v0.10 der Abgleich auf Knopfdruck.
- **Code-Aufteilung in Apps Script:** `Garmin.gs` (API-Zugriff), `Hilfen.gs`, `Diagnose.gs`, `Sammler.gs`.

---

## 3. Sicherheit und Schlüssel

| Schlüssel | Herkunft | Gültigkeit | Ablage |
|---|---|---|---|
| Garmin API-Schlüssel | Garmin Connect, von Christof erzeugt | 1 Jahr | nur Apps Script, Script Properties `GARMIN_API_KEY` |
| Garmin Zugriffstoken | täglich vom Sammler geholt | 24 Stunden | nur zur Laufzeit / CacheService |
| Web-App-Token | von Christof festgelegt | bis zur Änderung | Script Properties `WEBAPP_TOKEN`, einmalig in der PWA eingeben (localStorage) |
| clasp-Zugang | einmalig eingerichtet | langfristig | GitHub-Secret `CLASPRC_JSON` |
| Skript-ID | Apps-Script-Projekt | dauerhaft | GitHub-Variable `GAS_SCRIPT_ID` (kein Geheimnis) |
| Web-App-Bereitstellung | erste Bereitstellung (ab v0.3) | dauerhaft | GitHub-Variable `GAS_DEPLOYMENT_ID` |
| Android-Signatur-Schlüssel | von Claude in der Sitzung erzeugt (PKCS12, Alias `sport`), an Christof als Datei übergeben | 100 Jahre | GitHub-Secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORT`; Sicherungskopie bei Christof. Ohne ihn keine Updates der installierten App |
| Web-App-URL und Token in der Android-App | aus der Web-Oberfläche über die Brücke | bis zur Änderung | privater App-Speicher (SharedPreferences) |

Regeln:
- Kein Schlüssel und kein Token im Code, im Repo, in Logs oder in Commit-Nachrichten.
- Die PWA spricht nie direkt mit Garmin.
- Die Web-App antwortet ohne gültiges Web-App-Token mit einem Fehler und liefert keine Daten.
- Bei Fehlern beim Garmin-Abruf (z. B. abgelaufener Schlüssel) schickt der Sammler eine Mail an Christof.

---

## 4. Datenmodell

### Sheet „Aktivitaeten" (eine Zeile pro Aktivität)

| Spalte | Inhalt |
|---|---|
| activityId | Garmin-ID, eindeutig, verhindert Doppelte |
| start | Startzeit lokal (Europe/Zurich) |
| sportart | `laufen`, `rad`, `wandern`, `ski`, `schwimmen`, `andere` |
| garminTyp | Original-Typ von Garmin (`activityType.typeKey`) |
| name | Name der Aktivität in Garmin |
| distanz_km | Distanz (Garmin: `distance` in m) |
| dauer_min | Bewegungszeit (`movingDuration` in s, sonst `duration`) |
| dauer_gesamt_min | Gesamtzeit (`elapsedDuration` in s) |
| hoehenmeter | Aufstieg (`elevationGain` in m) |
| puls_avg | Durchschnittspuls, falls vorhanden |
| geraet | Hersteller laut Garmin (`manufacturer`), ein Gerätemodell liefert die API nicht |
| hat_gps | `true`, wenn eine Startkoordinate vorhanden ist |
| spur_datei | Drive-Datei-ID der GeoJSON-Spur (ab v0.7, bis dahin leer) |
| importiert_am | Zeitpunkt des Imports |
| details | JSON mit Zusatzwerten für die Detailansicht (ab v0.4), siehe unten |

### Spalte „details“ (JSON, nur vorhandene Werte)

| Schlüssel | Garmin-Feld | Einheit |
|---|---|---|
| pulsMax | maxHR | Schläge/min |
| zonenMin | hrTimeInZone_1…5 | Minuten je Zone |
| teAerob, teAnaerob, teLabel | aerobicTrainingEffect, anaerobicTrainingEffect, trainingEffectLabel | 0–5, Text |
| belastung | activityTrainingLoad | – |
| imModerat, imIntensiv | moderateIntensityMinutes, vigorousIntensityMinutes | Minuten |
| kadenzLauf, kadenzRad | averageRunningCadenceInStepsPerMinute, averageBikingCadenceInRevPerMinute | Schritte/min, U/min |
| schrittlaengeCm, bodenkontaktMs, vertOszCm, vertVerhaeltnis | avgStrideLength, avgGroundContactTime, avgVerticalOscillation, avgVerticalRatio | cm, ms, cm, % |
| kalorien, hmAb, hoeheMax | calories, elevationLoss, maxElevation | kcal, m, m |
| vSchnittMs, vMaxMs, vGapMs | averageSpeed, maxSpeed, avgGradeAdjustedSpeed | m/s |
| split1kS … split42kS | fastestSplit_1000, _5000, _10000, _21098, _42195 | Sekunden |
| bodyBattery, leistungW, leistungNormW, schritte | differenceBodyBattery, avgPower, normPower, steps | –, W, W, – |
| tempMin, tempMax, ort | minTemperature, maxTemperature, locationName | °C, Text |

### Zuordnung Garmin-Typ → Sportart (festgelegt 2026-11-17)

| Sportart | Garmin-Typen |
|---|---|
| laufen | `running`, `treadmill_running`, `trail_running`, `track_running` |
| rad | `cycling`, `road_biking`, `gravel_cycling`, `mountain_biking`, `indoor_cycling`, `e_bike_fitness`, `e_bike_mountain` |
| wandern | `hiking`, `walking`, `casual_walking`, `speed_walking`, `snow_shoe_ws` |
| ski | `resort_skiing`, `resort_skiing_snowboarding_ws`, `backcountry_skiing`, `cross_country_skiing_ws`, `skate_skiing_ws` |
| schwimmen | `open_water_swimming`, `lap_swimming` |
| andere | alle übrigen |
| nicht importiert | `overland` (Autofahrten), `incident_detected` |

Laufband-Läufe zählen fürs Laufziel. Indoor-Fahrten zählen zu Rad, haben aber keine Spur. Steht in `Sammler.gs` (`SPORTARTEN`, `AUSGESCHLOSSEN`). Der Sammler berechnet bei jedem Lauf die Sportart aller Zeilen aus `garminTyp` neu, Änderungen an der Zuordnung wirken also auch rückwirkend (nicht für ausgeschlossene Typen, die gar nicht im Sheet stehen).

### Sheet „Konfiguration"

- Wochenziel Läufe (Standard 2, einstellbar in der App)
- Wochenbeginn: Montag
- Weitere Einstellungen nach Bedarf

### Sheet „Spuren" (ab v0.9)

| Spalte | Inhalt |
|---|---|
| activityId, sportart, start | Aktivität |
| status | `ok`, `keine` (keine GPS-Punkte), `fehler <HTTP>` |
| punkte | Anzahl GPS-Punkte in der FIT-Datei |
| grob | Google-Polyline, Douglas-Peucker 30 m (Heatmap) |
| fein | Google-Polyline, 5 m (bei sehr langen Spuren größer, max. 45 000 Zeichen) (Detailansicht) |
| bearbeitet | Zeitpunkt |
| version | Version der Berechnung (v0.10: 2, ab v0.11: 3). Ältere werden vom Zeitgeber neu berechnet, außer gute Spuren ab Version 2 |
| entfernt_km | vom Spur-Filter entfernte Kilometer (Zug, GPS-Sprünge) |

Mehrteilige Spuren (nach dem Filter): Polylines durch ein Leerzeichen getrennt. Nur Wandern, Rad, Ski, Laufen mit GPS, ohne unrealistische Aktivitäten. Ersetzt den geplanten Drive-Ordner „Sport-Spuren“ (ein Abruf statt tausender Dateien).

### Sheet „Touren" (ab v0.12)

| Spalte | Inhalt |
|---|---|
| art | `name`, `aufgeloest`, `ohne`, `zu` |
| schluessel | Tour (activityId der ersten erkannten Etappe) bzw. activityId |
| wert | Name, `1` oder bei `zu` die Tour |
| geaendert | Zeitpunkt |

Nur Korrekturen; die Touren selbst rechnet die App.

### Sheet „Schrittabschnitte" (ab v0.9)

von, bis (ms), schritte: Messabschnitte des Handys der letzten 35 Tage. Daraus werden die Schritte während Garmin-Aktivitäten abgezogen.

### Sheet „Schritte" (ab v0.8)

| Spalte | Inhalt |
|---|---|
| datum | Tag als Text `YYYY-MM-DD` (Europe/Zurich) |
| schritte | Schritte des Handys an diesem Tag |
| aktualisiert | Zeitpunkt der letzten Übertragung |
| alltag | Alltagsschritte: Schritte minus Schritte während Garmin-Aktivitäten (ab v0.9) |

Die Android-App schickt jeweils die letzten 14 Tage; vorhandene Tage werden überschrieben (das Handy ist die Quelle).

### Drive-Ordner „Sport-Spuren"

- Eine GeoJSON-Datei pro Aktivität, volle Auflösung.
- Für die Karte liefert die Web-App eine vereinfachte Version (weniger Punkte), damit die Karte schnell lädt.

---

## 5. Schnittstelle der Web-App

`GET <webapp-url>?token=<WEBAPP_TOKEN>&aktion=<aktion>&...` (Code: `gas/WebApp.gs`)

| aktion | Liefert |
|---|---|
| `aktivitaeten` | alle Aktivitäten kompakt: `spalten` = `id, start, sportart, typ, name, km, min, minGesamt, hm, puls, gps, pkt, pktGeschaetzt, s1k, s5k, s10k, s21k, hmAb, ort` (ab v0.11 mit `hmAb` und `ort` aus `details`), `zeilen` = Liste von Listen. `start` als lokale Zeit `YYYY-MM-DDTHH:mm`. `pkt` = Sportpunkte (null vor 2023), `s…` = schnellste Abschnitte in Sekunden. Dazu `punkteAbJahr` und `punkteFaktoren` (Punkte pro Bewegungsminute je Sportart) |
| `einstellungen` | `einstellungen` aus dem Blatt „Konfiguration“, fehlende werden mit Standardwert angelegt |
| `einstellungSetzen` | ändert `schluessel` auf `wert` (nur bekannte Schlüssel, geprüft), liefert alle Einstellungen |
| `status` | `letzterImport`, `letzterImportNeu`, `letzterFehler`, `anzahlAktivitaeten` |
| `sammeln` | startet den Sammler sofort (ohne Fehler-Mail), liefert `neu` und `proSportart`. Für den Knopf „Von Garmin holen“ |
| `details` | Zusatzwerte einer Aktivität (`id`) aus der Spalte `details`: `{id, details: {…}}`, leeres Objekt, wenn nichts da ist |
| `meldung` | Text einer Benachrichtigung: `art` = `test`, `erinnerung`, `rueckblick`, `erfolge` (mit `seit` in ms). `{meldung: {titel, text}}` oder `{meldung: null}` (`gas/Meldungen.gs`) |
| `schritteSetzen` | Schritte pro Tag vom Handy speichern: `daten` = JSON `{"YYYY-MM-DD": Zahl}` (`gas/Schritte.gs`) |
| `schritte` | alle Tage: `{tage: [["YYYY-MM-DD", schritte, alltag, alltagPunkte, unplausibel], …]}` |
| `spuren` | alle groben Spuren: `{spuren: [[id, sportart, "YYYY-MM-DD", polyline], …], offen}` (`gas/Spuren.gs`) |
| `spur` | feine Spur einer Aktivität (`id`): `{fein, entferntKm}` |
| `touren` | Korrekturen an den Mehrtagestouren: `{korrekturen: [[art, schluessel, wert], …]}` (`gas/Touren.gs`) |
| `tourSetzen` | eine Korrektur setzen (`art`, `schluessel`, `wert`; leerer `wert` löscht), liefert alle |
| `wartung` | startet eine erlaubte Diagnose oder Einrichtung (`art` = `spurenStand`, `spurFilter`, `spurenNeu`, `abgleich`, `status`): `{titel, protokoll: [Zeilen]}` |
| `abgleich` | Zeitraum mit Garmin vergleichen (`von`, `bis` als `YYYY-MM-DD`, `uebernehmen=1` zum Übernehmen): `{garmin, sheet, aenderungen: [{art: geaendert/geloescht/neu, id, datum, name, sportart, km, felder: [{feld, alt, neu}]}], uebernommen}` (`gas/Abgleich.gs`) |

Ab v0.9 auch **POST** (`doPost`): Token und Aktion in der URL, Daten als JSON im Rumpf (z. B. `schritteSetzen` mit `daten` und `abschnitte`).

Antwort immer JSON: `{ok: true, version, …}` oder `{ok: false, fehler}`. Ohne gültiges Token: `{ok: false, fehler: "nicht berechtigt"}`.
Die Web-App läuft als Christof („Ausführen als: Ich“) mit Zugriff „Jeder“; geschützt ist sie allein durch das Token.

---

## 6. Repo-Struktur (geplant)

```
/PROJEKT.md                     dieses Dokument
/CLAUDE.md                      kurze Arbeitsanweisung für Claude Code, verweist auf PROJEKT.md
/gas/                           Apps-Script-Code (.gs) + appsscript.json
/gas/Garmin.gs                  Zugriff auf die Garmin-API (Token, Abruf, Liste)
/gas/Hilfen.gs                  allgemeine Hilfsfunktionen
/gas/Diagnose.gs                Diagnose der Garmin-API (nur Logs)
/gas/Sammler.gs                 v0.2: Sammler, Sheet, Zeitgeber, Fehler-Mail
/gas/WebApp.gs                  v0.3: Schnittstelle für die App (doGet)
/gas/Meldungen.gs               v0.7: Texte für die Benachrichtigungen
/gas/Schritte.gs                v0.8: Blatt „Schritte“, Aktionen schritteSetzen und schritte; v0.9: Alltagsschritte und -punkte
/gas/Spuren.gs                  v0.9: GPS-Spuren aus FIT, Vereinfachung, Polyline, Nachladen, Aktionen spuren und spur; v0.10: Filter für Zug und GPS-Sprünge
/gas/Abgleich.gs                v0.10: Zeitraum mit Garmin abgleichen (Prüfen, Übernehmen)
/gas/Touren.gs                  v0.12: Korrekturen an den Mehrtagestouren (Blatt „Touren“)
/android/                       Android-App (Kotlin): MainActivity (WebView), Bruecke, PruefJob, Pruefung, Melder, Update, Netz, Speicher, Schritte
/.github/workflows/android.yml  APK bauen, signieren, als Release „apk-<Laufnummer>“ veröffentlichen
/docs/                          App auf GitHub Pages: index.html, app.js, form.js (Ansicht „Form“), karte.js (Karte), historie.js (Historie), touren.js (Mehrtagestouren), fotos.js (Fotoschatz), daten/orte.txt (Ortsliste GeoNames), hilfe.js (Erklärungen), style.css, sw.js, manifest.json, icons/
/.github/workflows/deploy-gas.yml  Deployment nach Apps Script per clasp
```

`gas/.clasp.json` liegt nicht im Repo, die Action erzeugt sie aus `GAS_SCRIPT_ID`.

---

## 7. Entwicklung ohne PC

### Ablauf

1. Christof beschreibt am Handy in Claude Code, was sich ändern soll.
2. Claude Code ändert die Dateien, erhöht die Versionsnummern und pusht direkt nach `main`.
3. GitHub Pages veröffentlicht die PWA automatisch.
4. Eine GitHub Action überträgt den Ordner `/gas` per `clasp push` nach Apps Script und aktualisiert die bestehende Web-App-Bereitstellung per `clasp deploy -i <DEPLOYMENT_ID>`, damit die Web-App-URL gleich bleibt.

### Einmalige Einrichtung (darf am PC geschehen)

Für v0.1:

1. ~~Garmin API-Schlüssel erzeugen~~ (erledigt).
2. Apps-Script-API im Google-Konto aktivieren: https://script.google.com/home/usersettings
3. Neues Apps-Script-Projekt anlegen (https://script.google.com, Name z. B. „sport-sammler“). Unter Projekteinstellungen die **Skript-ID** kopieren.
4. Im selben Projekt unter Projekteinstellungen → Skripteigenschaften `GARMIN_API_KEY` mit dem Garmin-Schlüssel anlegen.
5. Am PC (Node.js nötig): `npx @google/clasp@3.4.1 login` ausführen und mit dem Google-Konto anmelden. Danach den Inhalt von `~/.clasprc.json` kopieren.
6. GitHub → Repo `sport` → Settings → Secrets and variables → Actions:
   - Secret `CLASPRC_JSON` = Inhalt von `~/.clasprc.json`
   - Variable `GAS_SCRIPT_ID` = Skript-ID aus Schritt 3
7. GitHub → Actions → „Apps Script deployen“ → „Run workflow“. Danach liegt `Diagnose.gs` im Apps-Script-Projekt.
8. Im Script-Editor `diagnoseAlles` auswählen, ausführen, Berechtigung erteilen und das Ausführungsprotokoll lesen.

Für v0.2 (im Script-Editor, jeweils Funktion auswählen und „Ausführen“; neue Berechtigungen für Sheets, Mail und Zeitgeber bestätigen):

1. `sammelnTrockenlauf`: schreibt nichts, loggt nur, wie viele Aktivitäten pro Sportart kämen.
2. `sammeln`: legt das Sheet „Sport-Daten“ an und importiert die ganze Historie. Der Link steht im Protokoll.
3. `zeitgeberEinrichten`: ab dann läuft `sammeln` täglich zwischen 3 und 4 Uhr.
4. `statusZeigen`: zeigt jederzeit letzten Import, letzten Fehler, Sheet-Link und Zeitgeber.

Für v0.3:

1. Skripteigenschaft `WEBAPP_TOKEN` anlegen: ein selbst ausgedachtes, langes Passwort (mind. 20 Zeichen, nur Buchstaben und Ziffern).
2. Im Script-Editor `webAppTesten` ausführen (prüft Token und Daten, loggt nur Größen).
3. Script-Editor → „Bereitstellen“ → „Neue Bereitstellung“ → Typ „Web-App“, Ausführen als „Ich“, Zugriff „Jeder“ → „Bereitstellen“. Web-App-URL und Bereitstellungs-ID kopieren.
4. GitHub → Settings → Secrets and variables → Actions → Variables: `GAS_DEPLOYMENT_ID` = Bereitstellungs-ID. Ab dann aktualisiert die Action die Web-App bei jeder Änderung an `gas/`.
5. GitHub → Settings → Pages: Source „Deploy from a branch“, Branch `main`, Ordner `/docs` → Save. App-Adresse: https://obitusde.github.io/sport/
6. App am Handy öffnen, unter Einstellungen Web-App-URL und Token eintragen, „Zum Startbildschirm hinzufügen“.

Für v0.4 (Script-Editor):

1. `diagnoseZusatzwerte` (bis 0.1.2: `diagnoseDetails`) ausführen und das Protokoll an Claude schicken (nur Zählungen).
2. `detailsNachtragen` ausführen (ca. 30 s): füllt die neue Spalte `details` für alle Aktivitäten.
3. In der App auf eine Aktivität tippen.

Für v0.7 (Android-App):

1. Datei `android-schluessel.txt` (von Claude) öffnen und die zwei Secrets in GitHub anlegen: `ANDROID_KEYSTORE_PASSWORT` und `ANDROID_KEYSTORE_B64`. Datei sicher aufbewahren.
2. GitHub → Actions → „Android-App bauen“ → „Run workflow“. Danach gibt es unter Releases eine Datei `sport-0.7.0-<Nummer>.apk`.
3. Am Handy https://github.com/obitusde/sport/releases/latest öffnen, APK herunterladen, öffnen, Installation aus dieser Quelle erlauben, installieren.
4. App öffnen, Benachrichtigungen erlauben. Verbindung ist evtl. neu einzutragen (die App hat einen eigenen Speicher). Unter Einstellungen → Benachrichtigungen „Test“ tippen.

Für v0.14 (Fotoschatz): App-Update installieren (Optionen → „Nach App-Update suchen“), dann Optionen → Fotoschatz → Link einfügen (in der App) bzw. „Link übernehmen“ (im Browser).

Für v0.13: nichts einzurichten, App neu öffnen.

Für v0.12 (Mehrtagestouren): nichts einzurichten. App neu öffnen, Historie → „Touren“. Erkannt wird nur, was eine Spur hat.

Für v0.11 (Historie, Markierung, Wartung, GPX/TCX):

1. Nichts zu installieren; App einmal ganz schließen und neu öffnen.
2. In der App: Optionen → Wartung → „Spur-Filter prüfen“. Zeigt bei 10 offenen Spuren, ob GPX/TCX gelesen wird.
3. Wenn das gut aussieht: Optionen → Wartung → „Spuren nachladen“. Lädt nur die Spuren ohne Ergebnis neu.

Für v0.10 (Karte, Spur-Filter, Abgleich, Jahres-Abzeichen):

1. Nichts zu installieren (keine neue APK). Die App lädt die neue Oberfläche beim nächsten Öffnen; sonst einmal ganz schließen und neu öffnen.
2. Script-Editor: `diagnoseSpurFilter` (Datei `Spuren.gs`) ausführen. Lädt die 40 neuesten Spuren und loggt nur, wie viele Kilometer der Filter entfernen würde (keine Orte).
3. Script-Editor: `spurenZeitgeberEinrichten` ausführen. Alle Spuren werden mit dem Filter neu berechnet (ca. 1–2 Stunden); bis dahin zeigt die Karte die alten Spuren.
4. Optional: `diagnoseAbgleich` (Datei `Abgleich.gs`) prüft die letzten 30 Tage und loggt nur Anzahlen.

Für v0.9 (Alltagspunkte und Karte):

1. App-Update installieren (Einstellungen → „Nach App-Update suchen“).
2. Script-Editor: `diagnoseSpuren` (Datei `Spuren.gs`) ausführen, loggt nur Größen.
3. Script-Editor: `spurenZeitgeberEinrichten` ausführen. Lädt alle 10 Minuten Spuren nach (ca. 250 pro Lauf) und entfernt sich selbst, wenn alles da ist (bei ca. 2700 Aktivitäten ein paar Stunden).
4. Einstellungen → Alltagspunkte prüfen bzw. anpassen.

Für v0.8 (Schrittzähler):

1. Warten, bis „Android-App bauen“ grün ist; die installierte App meldet das Update (oder Einstellungen → „Nach App-Update suchen“). APK herunterladen und installieren.
2. App öffnen, „Körperliche Aktivität“ erlauben.
3. Einstellungen → Schrittzähler → „Schrittzähler prüfen“: zeigt Sensor, Berechtigung, Zählerstand.

Für v0.5: nichts einzurichten. Optional `webAppTesten` ausführen: loggt, wie viele Aktivitäten Sportpunkte haben, wie viele davon geschätzt sind, und die persönlichen Faktoren.

---

## 8. Arbeitsregeln für Claude Code

- Sprache: Deutsch (Code-Kommentare, Commit-Nachrichten, Texte in der App).
- **Diagnose zuerst:** Neue Funktionen zuerst als Testfunktion, die nur loggt. Erst danach Produktivcode.
- **Versionsnummer bei jeder Änderung:** im Kopf jeder Datei und in der Änderungsliste unten.
- Immer vollständige Dateien schreiben, keine Ausschnitte.
- Direkt nach `main` pushen ist erlaubt. Jede Änderung muss über die Git-Historie rückgängig zu machen sein.
- Bei Unsicherheit ehrlich sagen, was unbekannt ist. Garmin-Endpunkte und -Felder nicht raten, sondern in der Swagger-Doku nachsehen oder per Diagnose prüfen.
- Keine Schlüssel, Tokens oder Aktivitätsdaten ins Repo.
- Architektur vor dem Coden besprechen, wenn sich etwas Grundsätzliches ändert.
- **Erst Feedback sammeln, dann bauen:** Vorschläge besprechen, eine neue Version erst bauen, wenn Christof sie freigibt („los“).
- Dieses Dokument nach jeder Version aktualisieren (Stand, Entscheidungen, Änderungsliste).

---

## 9. Fahrplan

| Version | Inhalt | Ergebnis |
|---|---|---|
| v0.1 | Diagnose: Token holen, Aktivitäten der letzten 30 Tage listen, eine Aktivität im Detail und als FIT laden, FIT auf GPS scannen, Historie zählen, alles loggen. Deployment per GitHub Action | Klarheit über Endpunkte, Felder, GPS, Historie |
| v0.2 | Sammler + Sheet + Zeitgeber + Fehler-Mail | Ziel 1 erfüllt |
| v0.3 | Web-App + PWA: Wochenansicht, Laufziel, Wochen-Serie | Ziele 2 und 3 |
| v0.4 | Detailansicht: Pace, Puls und Pulszonen, Trainingseffekt, Intensitätsminuten, Laufstil, schnellste Abschnitte. Spalte `details` mit Nachtrag, Diagnose der Intensitätsminuten | Mehr Einblick pro Aktivität |
| v0.5 | Sportpunkte (Intensitätsminuten), Aktivziel 150 mit Serie, Abzeichen und Bestmarken | Motivation über alle Sportarten |
| v0.6 | Form: relative Werte gegenüber dem eigenen Schnitt, Sportpunkte pro Woche, Laufökonomie, Jahr bis heute, aktive Stunden pro Jahr; Erklär-Seite; Filter für unrealistische Aktivitäten | Ziel 4, Fitness-Stand |
| v0.7 | Android-App: Hülle um die PWA, Benachrichtigungen (konfigurierbar), Updates über GitHub-Releases | Benachrichtigungen |
| v0.8 | Schrittzähler des Handys: Diagnose, Blatt „Schritte“, Anzeige in Woche und Form | Bewegung im Alltag |
| v0.9 | Alltagspunkte aus Schritten (einstellbar, ohne Schritte während Aktivitäten); Karte mit allen Spuren als Heatmap, Wanderwege-Ebene, Filter nach Sportart und Jahr, Spur in der Detailansicht, Historie nachladen | Ziel 5, Alltag zählt |
| v0.14 | Fotos aus dem Fotoschatz auf Tour- und Aktivitätsseiten (Bildstreifen, Kartenpunkte, Betrachter, Link) | Erinnerungen mit Bildern |
| v0.13 | Tour-Regeln nach echten Beispielen (keine Ferien-Standorte, keine Tagesausflüge ab Zuhause), Orte unterwegs, Kartenwahl auf allen Karten | Touren stimmen |
| v0.12 | Mehrtagestouren: automatisch erkannt (Etappen, Pausentage, Ausflüge, Zug-Lücken, ohne Pendeln), Tour-Seite, in Historie, Details, Karte und Erfolgen; korrigierbar | Erinnerungen an Touren |
| v0.11 | Route antippen markiert sie, Höhenmeter auf/ab im Popup, Spuren weit herausgezoomt sichtbar, Reiter „Historie“ zum Suchen und Filtern, Wartung per Knopf, GPX/TCX für ältere Aktivitäten | Alles finden, ohne PC warten |
| v0.10 | Feedback zu v0.9: Einstellungen neu gesetzt, Karte lädt beim Öffnen neu, Abgleich mit Garmin nach Zeitraum, Spuren besser sichtbar, Heatmap nach Häufigkeit, Detail-Karte größer mit Vollbild, Filter für Zug und GPS-Sprünge, persönliche Jahres-Abzeichen mit Hochrechnung, Höhenmeter ohne Pistenski | Karte und Abzeichen alltagstauglich |

### Ideen für später

- Erinnerung, z. B. Donnerstagabend „Diese Woche noch kein Lauf" (Mail oder Handy-Benachrichtigung).
- Wochenrückblick am Sonntag mit Vergleich zur Vorwoche.
- Rekorde und Meilensteine (längste Wanderung, meiste Höhenmeter, km pro Jahr).
- Kilometer pro Laufschuh und Fahrrad.
- Wander-Sammelkarte: besuchte Kantone/Regionen.
- Jahresrückblick zum Teilen (dann mit gekürzten Spuren um den Wohnort).
- LLM-Kommentar über OpenRouter, nur wenn Garmins Bedingungen es erlauben.

---

## 10. Offene Fragen

- Repo-Name: `sport` oder anders?
- Was sagen Garmins Nutzungsbedingungen zur Weitergabe an KI-Dienste? Davon hängt auch ab, ob Diagnose-Protokolle mit Werten (`WERTE_LOGGEN = true`) mit Claude geteilt werden dürfen.

---

## 11. Änderungsliste

| Version | Datum | Änderung |
|---|---|---|
| 0.14.2 | 2026-11-18 | Feedback: Vorschaubilder machten die Karte zu voll. Jetzt kleine Punkte (Kamera-Symbol bzw. Anzahl, weiß mit blauem Rand, Tippfläche 36 px); Antippen öffnet ein Vorschaufenster auf der Karte mit Blättern, Bild antippen = groß; Kamera-Knopf „Fotos an/aus“ auf Tour- und Detail-Karte, Wahl gespeichert (`sport.fotosKarte`). `docs/fotos.js`, `docs/karte.js`, `docs/touren.js`, `docs/style.css`, `docs/hilfe.js` 0.14.2 |
| 0.14.1 | 2026-11-18 | Feedback: Foto-Marker auf der Karte als Vorschaubilder (36 px, Zahl bei mehreren) statt kleiner Punkte (`docs/fotos.js`, `docs/style.css`); Tour-Karte lädt die feinen Spuren (5 m) der Etappen nach, vorher grob und eckig (`docs/touren.js`, `docs/karte.js` mit `feineSpurHolen`). Die große Karte bleibt bei groben Spuren (alle Spuren auf einmal) |
| 0.14.0 | 2026-11-18 | v0.14 Fotoschatz: `docs/fotos.js` (neu), `docs/touren.js`, `docs/karte.js` (Ebene „Fotos“), `docs/app.js` (Detail, Einstellungen, Betrachter), `docs/style.css`, `docs/hilfe.js`, `docs/sw.js`, `docs/index.html` 0.14.0; `android/` 0.14.0 (nur `/sport/` im WebView). Apps Script unverändert |
| 0.13.0 | 2026-11-18 | v0.13: `docs/touren.js` 0.13.0 (neue Regeln: Übernachtung zu Hause beendet Tour, mindestens eine Übernachtung unterwegs, Lücke am Folgetag nur nach Übernachtung unterwegs, Entfernung ohne Lücken, Ferien-Standort; Orte unterwegs), `docs/daten/orte.txt` (neu, GeoNames), `docs/karte.js` 0.13.0 (Kartenwahl auf allen Karten, OSM außerhalb der Schweiz), `docs/app.js`, `docs/hilfe.js`, `docs/style.css`, `docs/sw.js`, `docs/index.html` 0.13.0. Apps Script und Android unverändert |
| 0.12.0 | 2026-11-18 | v0.12 Mehrtagestouren: `docs/touren.js` (neu: Erkennung, Tour-Seite, Korrekturen), `gas/Touren.gs` (neu: Blatt „Touren“, Aktionen `touren`, `tourSetzen`), `gas/WebApp.gs` 0.12.0, `gas/Spuren.gs` 0.12.0 (Diagnose listet auch erfolgreiche Spuren). Oberfläche 0.12.0: `docs/app.js` (Unterseiten als Stapel, Tour-Hinweis in den Details, Touren in Erfolgen), `docs/historie.js` (Umschalter Aktivitäten/Touren), `docs/karte.js` (Filter „Nur Touren“, Tour im Popup, Spuren beim Start aus dem Zwischenspeicher), `docs/style.css`, `docs/hilfe.js`, `docs/sw.js`, `docs/index.html`. Android unverändert |
| 0.11.0 | 2026-11-18 | v0.11: `gas/Spuren.gs` 0.11.0 (GPX/TCX mit `xmlPunkte_`, `SPUR_VERSION` 3 nur für Spuren ohne Ergebnis, `spurenStand`), `gas/WebApp.gs` 0.11.0 (Spalten `hmAb`, `ort`, Aktion `wartung`), `gas/Hilfen.gs` 0.11.0 (Protokoll mitschneiden). Oberfläche 0.11.0: `docs/historie.js` (neu, Reiter „Historie“), `docs/karte.js` (Markierung, Höhenmeter im Popup, Breite je Zoom, Punkte je Spur), `docs/app.js` (Wartung, Scroll-Position, Tausender mit Apostroph auch bei km), `docs/index.html` (sechs Reiter, „Optionen“), `docs/style.css`, `docs/hilfe.js`, `docs/sw.js`. Android unverändert |
| 0.10.1 | 2026-11-18 | `gas/Spuren.gs` 0.10.1: `diagnoseSpurFilter` meldete bei 40 von 40 Spuren „keine“; die Diagnose loggt jetzt den Grund (HTTP, Größe, ZIP, FIT gefunden, Lesefehler, Filter). Schutz: Gute vorhandene Spuren werden nicht durch ein Ergebnis ohne Spur ersetzt, nach 5 solchen Fällen hintereinander bricht das Nachladen ab |
| 0.10.0 | 2026-11-18 | v0.10: `gas/Spuren.gs` 0.10.0 (Spur-Filter für Zug und GPS-Sprünge, Zeitstempel aus FIT, Spalten `version` und `entfernt_km`, Neuberechnung älterer Spuren, `diagnoseSpurFilter`), `gas/Abgleich.gs` 0.10.0 (neu, `diagnoseAbgleich`), `gas/WebApp.gs` 0.10.0 (Aktion `abgleich`), `gas/Meldungen.gs` 0.10.0 (persönliche Jahres-Abzeichen), `gas/Sammler.gs` 0.10.0 (nur Kommentare). Oberfläche 0.10.0: `docs/karte.js` (Heatmap nach Häufigkeit, Sichtbarkeit, Vollbild, Neuladen), `docs/app.js` (Jahres-Abzeichen, Abgleich, Einstellungen, Detail-Karte oben), `docs/style.css`, `docs/hilfe.js`, `docs/sw.js`, `docs/index.html`. Android unverändert (0.9.0) |
| 0.9.0 | 2026-11-18 | v0.9: Alltagspunkte (`gas/Schritte.gs` 0.9.0 mit Schrittabschnitten und Abzug während Aktivitäten, `gas/WebApp.gs` 0.9.0 mit `doPost`, Einstellungen `alltagPunkte`/`alltagFrei`/`alltagProPunkt`, Aktionen `spuren`/`spur`; `gas/Meldungen.gs` 0.9.0 Punkte inkl. Alltag). Spuren (`gas/Spuren.gs` 0.9.0 neu, `gas/Sammler.gs` 0.9.0 lädt Spuren neuer Aktivitäten). Android 0.9.0 (Messabschnitte, Übertragung per POST). Oberfläche 0.9.0: Karte (`docs/karte.js` neu), Spur in der Detailansicht, Alltagspunkte in Woche/Form/Einstellungen, Erklär-Seite. Entscheidung: Spuren im Sheet statt Drive. Umgebung der Cloud-Sitzung: freier Internetzugang auf Wunsch von Christof |
| 0.8.0 | 2026-11-18 | v0.8 Schrittzähler: `android/` 0.8.0 (`Schritte.kt` neu, Berechtigung ACTIVITY_RECOGNITION, Lesen im Job und beim Öffnen, Übertragung, Diagnose über die Brücke), `gas/Schritte.gs` 0.8.0 (neu), `gas/WebApp.gs` 0.8.0, `gas/Meldungen.gs` 0.8.0 (Schritte im Rückblick). Oberfläche 0.8.0: Schritte pro Tag in der Tagesleiste, Karte „Schritte“, Vergleich unter „Form“, Einstellungen „Schrittzähler“, Erklär-Seite |
| 0.7.0 | 2026-11-18 | v0.7 Android-App: `android/` (Kotlin, WebView-Hülle, Brücke `SportApp`, Hintergrund-Job, Benachrichtigungen, Update-Prüfung) 0.7.0, `.github/workflows/android.yml` 0.7.0 (Probe-Build ohne Secrets, sonst signiertes Release). `gas/Meldungen.gs` 0.7.0 (Aktion `meldung`), `gas/WebApp.gs` 0.7.0 (keine Schätzpunkte für unrealistische Aktivitäten). Oberfläche 0.7.0: Benachrichtigungen in den Einstellungen (in der App) bzw. Download-Link (im Browser), Update-Knopf, Erklär-Seite ergänzt |
| 0.6.0 | 2026-11-17 | v0.6 nach Feedback: unrealistische Aktivitäten werden erkannt und zählen nicht für km/Zeit/Bestmarken; Halbmarathon-Bestzeit entfernt; Jahrestabelle durch Jahres-Abzeichen fürs laufende Jahr ersetzt; neue Ansicht „Form“ (`docs/form.js` 0.6.0) mit Formstand, Vergleich je Kennzahl, Sportpunkte-Diagramm, Laufökonomie, Jahr bis heute, aktive Stunden pro Jahr; Erklär-Seite (`docs/hilfe.js` 0.6.0); Wochenansicht zeigt Anteil am eigenen Schnitt; Zurück führt in die vorherige Ansicht. App 0.6.0 (`app.js`, `style.css`, `sw.js`, `index.html`). Keine Änderung an Apps Script |
| 0.5.0 | 2026-11-17 | v0.5 Sportpunkte und Erfolge: `gas/WebApp.gs` 0.5.0 (Sportpunkte ab 2023 mit Schätzung, schnellste Abschnitte in der Liste, Einstellung `wochenzielPunkte`, Standard 150), `gas/Diagnose.gs` 0.1.3 (`diagnoseZusatzwerte`). App 0.5.0: Aktivziel mit Serie in der Wochenansicht, Karte „Erfolge dieser Woche“ (Wochenbilanz, neue Abzeichen, Bestmarken, Jahres-km, Allrounder), Ansicht „Erfolge“ (Serien-Abzeichen 4/12/26/52, Bestzeiten, Bestmarken, Jahres-Kilometer, Allrounder), zweites Ziel in den Einstellungen, Sportpunkte in der Detailansicht, Trainingseffekt mit Garmins deutschen Begriffen, „Unknown“ ausgeblendet |
| 0.4.0 | 2026-11-17 | v0.4 Detailansicht: `gas/Sammler.gs` 0.4.0 (Spalte `details`, `details_`, `detailsNachtragen`, Kopfzeile wird automatisch ergänzt), `gas/WebApp.gs` 0.4.0 (Aktion `details`), `gas/Diagnose.gs` 0.1.2 (`diagnoseDetails`), App 0.4.0 (`app.js`, `style.css`, `sw.js`). Entscheidungen zu Sportpunkten, zwei Zielen, Gamification und Fitness-Stand eingetragen, Fahrplan v0.4–v0.7 neu. Arbeitsregel „erst Feedback sammeln“. Rest des alten Schnittstellen-Entwurfs in Abschnitt 5 entfernt |
| 0.1 | 2026-11-16 | Erste Projektbeschreibung aus der Planung im Chat |
| 0.3.1 | 2026-11-17 | Knopf „Von Garmin holen“ in der App (Wochenansicht und Einstellungen), Rückmeldung mit Anzahl neuer Aktivitäten. `gas/WebApp.gs` 0.3.1 (Aktion `sammeln`), `gas/Sammler.gs` 0.2.2 (liefert Ergebnis, Fehler-Mail abschaltbar), App 0.3.1 (`app.js`, `style.css`, `sw.js`). Distanz abgerundet mit einer Nachkommastelle |
| 0.3.0 | 2026-11-17 | v0.3: `gas/WebApp.gs` 0.3.0 (doGet mit Token, Aktionen aktivitaeten, einstellungen, einstellungSetzen, status, Diagnose `webAppTesten`), `appsscript.json` mit Web-App-Einstellungen. App in `/docs` 0.3.0: Wochenansicht (Laufziel, was noch fehlt, Serie, Tage, Sport je Sportart, Aktivitäten, frühere Wochen), Einstellungen (Wochenziel, Verbindung, Datenstand), offline-fähig. Entscheidungen: App rechnet, Einstellungen im Sheet. Abschnitt 5 festgelegt |
| 0.2.1 | 2026-11-17 | FIT-Ergebnis eingetragen, FIT-Auswertung bleibt in Apps Script. Sportart `schwimmen` neu, `gas/Sammler.gs` 0.2.1 berechnet die Sportart bei jedem Lauf neu. Woche ab Montag, Wochenziel Standard 2, einstellbar in der App. Erster Import: 2736 Aktivitäten |
| 0.2.0 | 2026-11-17 | Diagnose-Ergebnisse eingetragen. Zuordnung Garmin-Typ → Sportart mit `ski`, `overland` ausgeschlossen. Sheet-Spalten `name` und `hat_gps` ergänzt. Neu: `gas/Sammler.gs` 0.2.0, `gas/Garmin.gs` 0.2.0, `gas/Hilfen.gs` 0.2.0. `gas/Diagnose.gs` 0.1.1 (FIT-Download mit anderem Accept-Kopf). `appsscript.json` mit Berechtigungen für Sheets, Mail, Zeitgeber. v0.6 angepasst, Historie kommt über die API |
| 0.1.1 | 2026-11-17 | Swagger-Doku ausgewertet (Endpunkte, Felder, keine GPS-Spur außer FIT). Neu: `gas/Diagnose.gs` 0.1.0, `gas/appsscript.json`, `.github/workflows/deploy-gas.yml` 0.1.0, `CLAUDE.md` 0.1.0, `.gitignore`. Deployment per Action schon ab v0.1, Einrichtungsschritte präzisiert |

# PROJEKT.md – Sport-Tracker (Arbeitstitel „sport")

Version: 0.1 (2026-11-16) – Projektbeschreibung, noch kein Code

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
     • volle GPS-Spur → Drive (GeoJSON, privat)
                     ↓
   Apps Script Web-App (doGet, prüft Web-App-Token)
     • liefert Liste, Wochenwerte, Spuren als JSON
                     ↓
   PWA auf GitHub Pages
     • Ansichten: Woche · Verlauf · Karte · Liste
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
- Zugriffstoken gilt 24 Stunden, kein Refresh-Token. Bei jedem Lauf neu holen.
- Nur Abfragen, keine Push-Benachrichtigung. Deshalb täglicher Zeitgeber.
- Bekannt aus Berichten: Aktivitäten als JSON und als FIT-Datei. Garmin entfernt in API-Dateien möglicherweise berechnete Werte (VO2max, Erholungszeit). Für dieses Projekt unwichtig.
- **Unbekannt, wird in v0.1 geklärt:** genaue Endpunkte und Felder, ob die GPS-Spur im JSON steckt oder nur in der FIT-Datei, wie weit die Historie zurückreicht, Ratenlimits, ob Abrufe aus Apps Script funktionieren.
- Bedingungen: Christof liest beim Erzeugen des Schlüssels die Nutzungsbedingungen. Keine Garmin-Daten an ein Sprachmodell (OpenRouter o. Ä.) schicken, bevor geklärt ist, dass das erlaubt ist.

### Entscheidungen

- **Abruf 1x täglich** reicht.
- **Volle GPS-Spuren werden gespeichert**, ohne Abschneiden um den Wohnort, weil sie privat in Drive liegen. Kürzen rund ums Zuhause nur bei Funktionen zum Teilen.
- **Keine Aktivitäts- oder GPS-Daten im Repo.** Das Repo und GitHub Pages sind öffentlich.
- **FIT-Auswertung:** Falls die GPS-Spur nur in der FIT-Datei steckt, wird in v0.1 entschieden, ob die FIT-Datei in Apps Script (JavaScript-FIT-Parser) oder in einer GitHub Action (Python, z. B. `fitdecode`) ausgewertet wird.
- **Historie:** Falls die API nicht weit genug zurückreicht, einmaliger Import aus dem Garmin-Datenexport („Deine Daten exportieren", ZIP mit FIT-Dateien).

---

## 3. Sicherheit und Schlüssel

| Schlüssel | Herkunft | Gültigkeit | Ablage |
|---|---|---|---|
| Garmin API-Schlüssel | Garmin Connect, von Christof erzeugt | 1 Jahr | nur Apps Script, Script Properties `GARMIN_API_KEY` |
| Garmin Zugriffstoken | täglich vom Sammler geholt | 24 Stunden | nur zur Laufzeit / CacheService |
| Web-App-Token | von Christof festgelegt | bis zur Änderung | Script Properties `WEBAPP_TOKEN`, einmalig in der PWA eingeben (localStorage) |
| clasp-Zugang | einmalig eingerichtet | langfristig | GitHub-Secret `CLASPRC_JSON` |

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
| sportart | `laufen`, `rad`, `wandern`, `andere` |
| garminTyp | Original-Typ von Garmin |
| distanz_km | Distanz |
| dauer_min | Bewegungszeit |
| dauer_gesamt_min | Gesamtzeit |
| hoehenmeter | Aufstieg |
| puls_avg | Durchschnittspuls, falls vorhanden |
| geraet | Aufzeichnungsgerät |
| spur_datei | Drive-Datei-ID der GeoJSON-Spur |
| importiert_am | Zeitpunkt des Imports |

Die genaue Zuordnung Garmin-Typ → Sportart wird nach v0.1 anhand echter Daten festgelegt.

### Sheet „Konfiguration"

- Wochenziel Läufe (offen: 1 oder 2)
- Wochenbeginn (offen: Montag angenommen)
- Weitere Einstellungen nach Bedarf

### Drive-Ordner „Sport-Spuren"

- Eine GeoJSON-Datei pro Aktivität, volle Auflösung.
- Für die Karte liefert die Web-App eine vereinfachte Version (weniger Punkte), damit die Karte schnell lädt.

---

## 5. Schnittstelle der Web-App (Entwurf)

`GET <webapp-url>?token=<WEBAPP_TOKEN>&aktion=<aktion>&...`

| aktion | Liefert |
|---|---|
| `aktivitaeten` | Liste, optional `von`, `bis`, `sportart` |
| `woche` | Summen der aktuellen Woche und Stand des Laufziels |
| `verlauf` | Summen pro Woche/Monat/Jahr |
| `spuren` | vereinfachte Spuren als GeoJSON, optional `sportart`, `jahr` |
| `spur` | volle Spur einer Aktivität (`id`) |
| `status` | letzter Import, Fehler, Ablaufdatum Garmin-Schlüssel (falls bekannt) |

Antwort immer JSON. Endgültig festgelegt in v0.2.

---

## 6. Repo-Struktur (geplant)

```
/PROJEKT.md          dieses Dokument
/CLAUDE.md           kurze Arbeitsanweisung für Claude Code, verweist auf PROJEKT.md
/gas/                Apps-Script-Code (.gs) + appsscript.json + .clasp.json
/docs/  oder /       PWA (index.html, app.js, style.css, manifest.json, sw.js)
/.github/workflows/  Deployment nach Apps Script
```

---

## 7. Entwicklung ohne PC

### Ablauf

1. Christof beschreibt am Handy in Claude Code, was sich ändern soll.
2. Claude Code ändert die Dateien, erhöht die Versionsnummern und pusht direkt nach `main`.
3. GitHub Pages veröffentlicht die PWA automatisch.
4. Eine GitHub Action überträgt den Ordner `/gas` per `clasp push` nach Apps Script und aktualisiert die bestehende Web-App-Bereitstellung per `clasp deploy -i <DEPLOYMENT_ID>`, damit die Web-App-URL gleich bleibt.

### Einmalige Einrichtung (darf am PC geschehen)

- Apps-Script-API im Google-Konto aktivieren: https://script.google.com/home/usersettings
- Apps-Script-Projekt anlegen, `scriptId` in `/gas/.clasp.json` eintragen.
- `clasp login` einmal ausführen, Inhalt von `~/.clasprc.json` als GitHub-Secret `CLASPRC_JSON` speichern.
- Web-App einmal bereitstellen, Deployment-ID als GitHub-Secret oder Variable `GAS_DEPLOYMENT_ID` speichern.
- GitHub Pages für das Repo aktivieren.
- Script Properties `GARMIN_API_KEY` und `WEBAPP_TOKEN` setzen (geht auch am Handy im Script-Editor).
- Zeitgeber für den Sammler anlegen (kann auch per Code eingerichtet werden).

Falls Christof das Action-Deployment schon für ein anderes Projekt nutzt, wird es von dort übernommen.

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
- Dieses Dokument nach jeder Version aktualisieren (Stand, Entscheidungen, Änderungsliste).

---

## 9. Fahrplan

| Version | Inhalt | Ergebnis |
|---|---|---|
| v0.1 | Diagnose: Token holen, Aktivitäten der letzten 30 Tage listen, eine Aktivität im Detail und als FIT laden, alles loggen | Klarheit über Endpunkte, Felder, GPS, Historie |
| v0.2 | Sammler + Sheet + Zeitgeber + Fehler-Mail, Deployment per GitHub Action | Ziel 1 erfüllt |
| v0.3 | Web-App + PWA: Wochenansicht, Laufziel, Wochen-Serie | Ziele 2 und 3 |
| v0.4 | Verlauf: Wochen/Monate/Jahre | Ziel 4 |
| v0.5 | Karte mit allen Spuren, Filter nach Sportart und Jahr | Ziel 5 |
| v0.6 | Historie importieren (API oder Garmin-Export) | Vollständige Daten |

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

- Wochenziel: mindestens 1 Lauf oder 2 Läufe?
- Wochenbeginn: Montag?
- Repo-Name: `sport` oder anders?
- Ist das clasp-Action-Deployment bereits in einem anderen Projekt eingerichtet?
- Was sagen Garmins Nutzungsbedingungen zur Weitergabe an KI-Dienste?

---

## 11. Änderungsliste

| Version | Datum | Änderung |
|---|---|---|
| 0.1 | 2026-11-16 | Erste Projektbeschreibung aus der Planung im Chat |

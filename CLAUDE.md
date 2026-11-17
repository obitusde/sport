# CLAUDE.md – Arbeitsanweisung für Claude Code

Version: 0.1.0 (2026-11-17)

Vor jeder Arbeit `PROJEKT.md` lesen. Dort stehen Ziele, Architektur, Entscheidungen, Fahrplan und Arbeitsregeln (Abschnitt 8). Kurzfassung:

- Sprache Deutsch: Code-Kommentare, Commit-Nachrichten, Texte in der App.
- Erst Architektur und Vorgehen besprechen, Code erst nach Freigabe durch Christof.
- Neue Funktionen zuerst als Diagnose-Funktion, die nur loggt.
- Versionsnummer bei jeder Änderung im Kopf jeder Datei und in der Änderungsliste von `PROJEKT.md`.
- Garmin-Endpunkte und -Felder nicht raten. Quelle ist die Swagger-Doku (siehe `PROJEKT.md`, Abschnitt 2) oder eine Diagnose.
- Keine Schlüssel, Tokens oder Aktivitäts-/GPS-Daten ins Repo, in Logs oder in Commit-Nachrichten. Repo und GitHub Pages sind öffentlich.
- Keine Garmin-Daten an ein Sprachmodell schicken, solange die Nutzungsbedingungen das nicht klar erlauben.
- Direkt nach `main` pushen ist erlaubt. Änderungen an `gas/` werden per GitHub Action nach Apps Script übertragen.
- `PROJEKT.md` nach jeder Version aktualisieren.

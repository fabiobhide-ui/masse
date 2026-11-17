# MASSE Web

Persönlicher Trainings- und Ernährungstracker für den Muskelaufbau, als Web-App fürs iPhone.
Ohne App Store, ohne Mac, ohne Konto: Alle Daten bleiben lokal auf dem Gerät.

Die Web-App basiert auf der Logik der nativen iOS-Version (Double Progression, Tagesmittel beim
Gewicht, Snapshots der Nährwerte usw.).

## Funktionen

- **Heute:** Kalorien und Makros mit Restmengen, Schnellaktionen (Gewicht, Essen, Masseshake,
  Training), Streaks (Protein-/Kalorienziel, Trainingswochen), abends Vorschläge zum Schließen der
  Kalorienlücke, Wochenrückblick (Mo–Mi), Zielprognose, Supplemente, nächste Einheit
- **Training:** Wochenplan (4× Gym, 3× Volleyball), Sätze mit Gewicht, Wiederholungen und RIR,
  Aufwärmsätze, Pausentimer, Double Progression, Supersätze, Rekorde (🏆 beim Satz),
  Übungsverlauf, Scheibenrechner, Sätze pro Muskelgruppe, Deload-Hinweis, Planeditor, Historie
- **Ernährung:** Foto-Analyse per KI (eigener Anthropic-API-Schlüssel, nur auf dem Gerät gespeichert),
  eigener Lebensmittelkatalog, Favoriten, Gerichte aus mehreren Zutaten,
  Mahlzeiten-Vorlagen, Protein pro Mahlzeit, Barcode-Scanner, optional Open Food Facts,
  Vortag übernehmen
- **Fortschritt:** Gewicht mit 7-Tage-Mittel und Prognose, Wochenrückblick, Kalender,
  Bestleistungen, Kalorien, Protein, Makros, Volumen, geschätztes 1RM, Körpermaße, Fotos
- **Mehr:** Ziele, Hell/Dunkel/Automatisch, Supplemente, Sicherung mit Erinnerung
  (wöchentlich/14 Tage/aus), CSV-Export

## Auf dem iPhone installieren

1. Die Adresse der App in **Safari** öffnen.
2. Unten auf **Teilen** tippen → **„Zum Home-Bildschirm“**.
3. MASSE startet dann wie eine App im Vollbild und funktioniert auch offline.

**Wichtig:** Die Daten liegen im Speicher der Web-App auf dem iPhone. Wer die App vom
Home-Bildschirm löscht oder in Safari die Websitedaten entfernt, verliert sie. Deshalb regelmäßig
unter **Mehr → Sicherung exportieren** eine Sicherung anlegen (z. B. in iCloud Drive).

## Veröffentlichen (Hosting)

Die App besteht nur aus statischen Dateien, ohne Build-Schritt. Jeder statische Hoster funktioniert,
solange er **HTTPS** anbietet (nötig für Kamera und Offline-Betrieb), z. B. GitHub Pages:
Repository → Settings → Pages → Branch `main`, Ordner `/ (root)`.

Nach Änderungen an Dateien die `VERSION` in `sw.js` erhöhen, damit installierte Apps das Update
laden. Die App zeigt dann „Neue Version verfügbar → Aktualisieren“.

## Entwicklung

```bash
python3 -m http.server 8000      # lokal starten: http://localhost:8000
npm test                         # Tests des Rechenkerns (Node)
node tests/e2e.mjs               # Browser-Test aller Abläufe (Playwright)
```

| Datei | Inhalt |
|---|---|
| `js/core.js` | Rechenkern: Makros, Double Progression, Gewichtsstatistik, Barcode, Validierung |
| `js/seed.js` | Startdaten: Ziele, Trainingsplan, Masseshake, Supplemente |
| `js/app.js` | Oberfläche |
| `js/db.js` | Lokale Speicherung (IndexedDB) mit vorheriger Version als Sicherheitsnetz |
| `js/charts.js` | SVG-Diagramme |
| `js/scanner.js` | Barcode-Scanner (ZXing/WebAssembly, lokal mitgeliefert) |
| `sw.js` | Service Worker für den Offline-Betrieb |

## Bewusste Grenzen gegenüber der iOS-Version

Keine Widgets, keine Apple-Health-Anbindung, keine Face-ID-Sperre und keine Erinnerungen.
Der Pausentimer piept nur, solange die App geöffnet ist.

## Lizenzen

Barcode-Erkennung: [barcode-detector](https://github.com/Sec-ant/barcode-detector) (MIT) und
[zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (MIT, basiert auf zxing-cpp, Apache-2.0),
siehe `vendor/`. Lebensmitteldaten: Open Food Facts, Lizenz ODbL.
KI-Foto-Analyse: [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
1.9.0 (Apache-2.0), als Browser-Bundle in `vendor/anthropic-sdk.js`.

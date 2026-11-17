// End-to-End-Test im Browser (iPhone-Größe). Start: node tests/e2e.mjs [screenshot-ordner]
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 8765;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await sleep(800);

const browser = await chromium.launch({ args: ['--disable-gpu'] });
const context = await browser.newContext({ ...devices['iPhone 15'], deviceScaleFactor: 2, locale: 'de-DE', timezoneId: 'Europe/Berlin', acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !(m.text().includes('401') && m.location().url.includes('api.anthropic.com'))) errors.push('console: ' + m.text() + ' @ ' + m.location().url); });

let step = 0;
const ok = msg => console.log(`✓ ${++step}. ${msg}`);
const shot = async name => {
  if (!shots) return;
  for (let i = 0; i < 3; i++) {
    try { await page.screenshot({ path: `${shots}/${name}.png`, animations: 'disabled', caret: 'initial', timeout: 6000 }); return; } catch { /* erneut */ }
  }
  console.log(`  (Screenshot ${name} übersprungen)`);
};
const sheet = () => page.locator('.sheet-wrap').last();
const expectText = async (loc, text) => {
  await loc.filter({ hasText: text }).first().waitFor({ timeout: 4000 }).catch(async () => {
    throw new Error(`Text „${text}“ nicht gefunden. Inhalt: ${(await loc.first().innerText()).slice(0, 400)}`);
  });
};
const confirm = async () => { await page.locator('.dialog [data-r="1"]').click(); };
const state = () => page.evaluate(() => window.__masse.state);
const C_portionKcal = e => e.food.macros.calories * e.amount / e.food.basisAmount;

try {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('.hero');
  await expectText(page.locator('#main'), '3.400 kcal');
  await shot('01-heute-leer');
  ok('App startet, Dashboard mit Ziel 3.400 kcal');

  await page.click('[data-act="quickShake"]');
  await expectText(page.locator('.big'), '684');
  ok('Masseshake per Schnellaktion: 684 kcal');

  await page.click('.quick [data-act="addWeight"]');
  await sheet().locator('input[name="kg"]').fill('63,4');
  await sheet().locator('button.primary').click();
  await expectText(page.locator('#main'), '63,4 kg');
  ok('Gewicht 63,4 kg eingetragen');

  await page.click('.chip >> nth=0');
  await expectText(page.locator('.chip.on'), 'Kreatin');
  ok('Supplement abgehakt');
  await shot('02-heute-daten');

  // Training
  await page.click('[data-tab="training"]');
  await expectText(page.locator('#main'), 'Oberkörper A');
  await shot('03-training');
  const startA = page.locator('.plan', { hasText: 'Oberkörper A' }).locator('[data-act="startWorkout"]');
  await startA.click();
  await sheet().locator('.ex').first().waitFor();
  await expectText(sheet().locator('.ex').first(), 'Schrägbankdrücken KH');
  const firstEx = sheet().locator('.ex').first();
  // Wiederholungen auf 10 setzen und alle 3 Sätze abhaken
  for (let j = 0; j < 3; j++) {
    const repInput = firstEx.locator('.set').nth(j).locator('input').nth(1);
    await repInput.fill('10'); await repInput.dispatchEvent('change');
    await sleep(80);
    await firstEx.locator('.set').nth(j).locator('.ck').click();
    await sleep(120);
  }
  await expectText(sheet().locator('[data-rest-label]'), 'Pause');
  await shot('04-workout');
  const w = await state();
  if (w.activeWorkout.exercises[0].sets.filter(s => s.completed && s.reps === 10).length !== 3) throw new Error('Sätze nicht gespeichert');
  ok('Training gestartet, 3 Sätze erfasst, Pausentimer läuft');

  await page.reload();
  await page.waitForSelector('.hero, .title');
  const persisted = await state();
  if (!persisted.activeWorkout) throw new Error('Laufendes Training nach Neuladen verloren');
  ok('Laufendes Training übersteht Neuladen');

  await sleep(300);
  if (!(await page.locator('.sheet-wrap').count())) { await page.click('[data-tab="training"]'); await page.click('[data-act="openWorkout"]'); }
  await sheet().locator('[data-act="finishWorkout"]').click();
  await confirm();
  await page.waitForFunction(() => window.__masse.state.workouts.length === 1);
  await expectText(page.locator('#main'), 'Volumen');
  ok('Training abgeschlossen und in Historie');

  // Double Progression
  await startA.click();
  await sheet().locator('.suggest').first().waitFor();
  await expectText(sheet().locator('.suggest').first(), '19,5 kg');
  await sheet().locator('[data-act="applySugg"]').first().click();
  await sleep(150);
  const sv = await state();
  if (sv.activeWorkout.exercises[0].sets[0].weight !== 19.5) throw new Error('Vorschlag nicht übernommen');
  if (sv.activeWorkout.exercises[1].sets[0].weight !== 45) throw new Error('Andere Übung wurde verändert');
  ok('Double Progression schlägt 19,5 kg vor und übernimmt erst nach Bestätigung');
  await sheet().locator('.ex').first().locator('.set').first().locator('.ck').click();
  await expectText(page.locator('#toast'), 'Neuer Rekord');
  await sheet().locator('.set.is-pr').first().waitFor();
  ok('Neuer Rekord erkannt (Hinweis + Pokal am Satz)');
  await sheet().locator('.ex').first().locator('[data-act="exHistory"]').click();
  await expectText(sheet(), '17,5');
  await sheet().locator('header [data-act="closeSheet"]').click();
  ok('Übungsverlauf zeigt die letzte Einheit');
  await sheet().locator('[data-act="discardWorkout"]').click();
  await confirm();
  await page.waitForFunction(() => window.__masse.state.activeWorkout === null);
  ok('Training verworfen');

  await page.click('.quick [data-act="plateCalc"]');
  const tot = sheet().locator('input[name="total"]');
  await tot.fill('100'); await tot.dispatchEvent('input');
  await expectText(sheet().locator('#plate-out'), 'Je Seite: 40 kg');
  await shot('10-scheiben');
  await sheet().locator('header [data-act="closeSheet"]').click();
  ok('Scheibenrechner: 100 kg → 25 + 15 kg pro Seite');
  await page.click('.quick [data-act="showRecords"]');
  await expectText(sheet(), 'Schrägbankdrücken KH');
  await sheet().locator('header [data-act="closeSheet"]').click();
  ok('Rekordliste');

  // Plan bearbeiten
  await page.locator('.plan', { hasText: 'Unterkörper B' }).locator('[data-act="editPlan"]').click();
  await sheet().locator('[data-act="exAdd"]').click();
  const last = sheet().locator('.exedit').last();
  await last.locator('input').first().fill('Klimmzüge');
  await sheet().locator('.exedit').first().locator('input[data-path="exercises.0.supersetNext"]').check();
  await sheet().locator('form button.primary').click();
  await page.waitForFunction(() => window.__masse.state.plans.find(p => p.name === 'Unterkörper B').exercises.some(e => e.name === 'Klimmzüge'));
  ok('Trainingsplan bearbeitet (Übung hinzugefügt)');
  const ub = (await state()).plans.find(p => p.name === 'Unterkörper B');
  if (!ub.exercises[0].supersetNext || ub.exercises.at(-1).muscle !== 'Rücken') throw new Error('Supersatz/Muskelgruppe nicht gespeichert');
  await page.locator('.plan', { hasText: 'Unterkörper B' }).locator('[data-act="startWorkout"]').click();
  await sheet().locator('.superset').first().waitFor();
  await expectText(sheet().locator('.ss-label'), 'Supersatz');
  await shot('11-supersatz');
  await sheet().locator('[data-act="discardWorkout"]').click();
  await confirm();
  await page.waitForFunction(() => window.__masse.state.activeWorkout === null);
  ok('Supersatz angelegt und im Training gruppiert; Muskelgruppe automatisch erkannt');

  // Ernährung
  await page.click('[data-tab="food"]');
  await page.click('.quick [data-act="openLibrary"]');
  await sheet().locator('[data-act="newFood"]').click();
  const f = sheet();
  await f.locator('input[name="name"]').fill('Basmatireis');
  await f.locator('input[name="calories"]').fill('350');
  await f.locator('input[name="protein"]').fill('8,5');
  await f.locator('input[name="carbs"]').fill('77');
  await f.locator('input[name="fat"]').fill('0,6');
  await f.locator('button.primary').click();
  await sheet().locator('input[name="amount"]').fill('150');
  await sheet().locator('input[name="amount"]').dispatchEvent('input');
  await expectText(sheet().locator('#amount-preview'), '525');
  await shot('05-menge');
  await sheet().locator('button.primary').click();
  await expectText(page.locator('#main'), 'Basmatireis');
  ok('Lebensmittel angelegt und 150 g eingetragen (525 kcal)');
  await shot('06-ernaehrung');

  await page.locator('.li', { hasText: 'Basmatireis' }).click();
  await sheet().locator('input[name="amount"]').fill('200');
  await sheet().locator('button.primary').click();
  await page.waitForFunction(() => window.__masse.state.foodEntries.some(e => e.amount === 200));
  ok('Eintrag bearbeitet');

  await page.click('.quick [data-act="newDish"]');
  const dsh = sheet();
  await dsh.locator('input[data-path="name"]').fill('Reis-Bowl');
  await dsh.locator('input[data-path="name"]').dispatchEvent('input');
  for (const q of ['Basmati', 'Masseshake']) {
    await sheet().locator('#dish-q').fill(q); await sheet().locator('#dish-q').dispatchEvent('input');
    await sheet().locator('#dish-results [data-act="dishAdd"]').first().click();
  }
  const por = sheet().locator('input[data-path="portions"]');
  await por.fill('2'); await por.dispatchEvent('input');
  await expectText(sheet().locator('#dish-preview'), '517');
  await shot('12-gericht');
  await sheet().locator('form[data-form="saveDish"] button.primary').click();
  await sheet().locator('input[name="amount"]').waitFor();
  await sheet().locator('button.primary').click();
  await expectText(page.locator('#main'), 'Reis-Bowl');
  ok('Gericht aus 2 Zutaten: 517 kcal pro Portion berechnet und eingetragen');

  await expectText(page.locator('#main'), 'Protein pro Mahlzeit');
  const nBefore = (await state()).foodEntries.length;
  const mealBtn = page.locator('[data-act="saveTemplate"]').first();
  const meal = await mealBtn.getAttribute('data-meal');
  const inMeal = (await state()).foodEntries.filter(e => e.meal === meal).length;
  await mealBtn.click();
  await sheet().locator('input[name="name"]').fill('Testvorlage');
  await sheet().locator('button.primary').click();
  await page.locator('.tpl-row .chip', { hasText: 'Testvorlage' }).click();
  await sheet().locator('[data-act="applyTemplate"]').click();
  await page.waitForFunction(n => window.__masse.state.foodEntries.length === n, nBefore + inMeal);
  ok(`Mahlzeit als Vorlage gespeichert und mit einem Tipp erneut eingetragen (${inMeal} Lebensmittel)`);

  // Foto → Text ablesen (echte Texterkennung, ohne KI)
  const lp = await context.newPage();
  await lp.setContent(`<div id="l" style="font:15px Arial;width:340px;padding:14px;border:2px solid #000;background:#fff;color:#000"><b>Nährwerte</b>
    <table style="width:100%"><tr><td></td><td align="right"><b>pro 100 g</b></td></tr><tr><td>Energie</td><td align="right">1580 kJ / 377 kcal</td></tr>
    <tr><td>Fett</td><td align="right">7,0 g</td></tr><tr><td>davon gesättigte Fettsäuren</td><td align="right">1,2 g</td></tr>
    <tr><td>Kohlenhydrate</td><td align="right">58,7 g</td></tr><tr><td>davon Zucker</td><td align="right">1,1 g</td></tr><tr><td>Eiweiß</td><td align="right">13,5 g</td></tr></table></div>`);
  const labelPng = await lp.locator('#l').screenshot();
  await lp.close();
  await page.click('.quick [data-act="aiPhoto"]');
  await expectText(sheet().locator('.seg .on'), 'Text ablesen');
  await sheet().locator('input[data-change="aiPick"]').setInputFiles({ name: 'etikett.png', mimeType: 'image/png', buffer: labelPng });
  await sheet().locator('form[data-form="saveFood"]').waitFor({ timeout: 30000 });
  const fv = n => sheet().locator(`input[name="${n}"]`).inputValue();
  const got = [await fv('calories'), await fv('protein'), await fv('carbs'), await fv('fat'), await fv('basisAmount')].join('|');
  if (got !== '377|13,5|58,7|7|100') throw new Error('Texterkennung falsch: ' + got);
  await shot('17-text-erkannt');
  await sheet().locator('input[name="name"]').fill('Haferflocken (Etikett)');
  await sheet().locator('form[data-form="saveFood"] button.primary').click();
  await sheet().locator('input[name="amount"]').fill('60');
  await sheet().locator('button.primary').click();
  await expectText(page.locator('#main'), 'Haferflocken (Etikett)');
  ok('Foto einer Nährwerttabelle: Werte per Texterkennung abgelesen (377 kcal, 13,5 P, 58,7 KH, 7 F) und eingetragen');

  // KI-Foto (Anthropic-API simuliert)
  await page.click('.quick [data-act="aiPhoto"]');
  await sheet().locator('[data-act="aiMode"][data-v="ai"]').click();
  await expectText(sheet(), 'API-Schlüssel');
  await sheet().locator('[data-act="aiSettings"]').click();
  await page.locator('#ai-card').waitFor();
  await page.fill('#ai-card input[name="key"]', 'falsch');
  await page.click('#ai-card button.primary');
  await expectText(page.locator('#toast'), 'sk-ant-');
  await page.fill('#ai-card input[name="key"]', 'sk-ant-api03-TESTKEY_abcdefghijklmnopqrstuvwxyz');
  await page.click('#ai-card button.primary');
  await expectText(page.locator('#ai-card'), 'Gespeichert');
  if (JSON.stringify(await state()).includes('TESTKEY')) throw new Error('API-Schlüssel landet im App-Zustand/Sicherung');
  ok('API-Schlüssel geprüft und nur im Gerätespeicher abgelegt');

  const aiCalls = [];
  let aiMode = 'auth';
  await page.route('https://api.anthropic.com/**', async route => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    aiCalls.push({ headers: req.headers(), body: req.postDataJSON() });
    if (aiMode === 'auth') return route.fulfill({ status: 401, contentType: 'application/json', headers: cors, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
    const result = { is_food: true, comment: 'Öl in der Pfanne geschätzt.', items: [
      { name: 'Basmatireis gekocht', amount: 250, unit: 'g', calories: 325, protein: 6.8, carbs: 70, fat: 0.8, confidence: 'hoch' },
      { name: 'Hähnchenbrust gebraten', amount: 150, unit: 'g', calories: 248, protein: 46, carbs: 0, fat: 6, confidence: 'mittel' },
      { name: 'Currysoße', amount: 80, unit: 'g', calories: 96, protein: 1.5, carbs: 7, fat: 7, confidence: 'niedrig' },
    ] };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
      content: [{ type: 'text', text: JSON.stringify(result) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1600, output_tokens: 420 } }) });
  });
  await page.click('[data-tab="food"]');
  await page.click('.quick [data-act="aiPhoto"]');
  await sheet().locator('input[data-change="aiPick"]').setInputFiles({ name: 'teller.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGP4z8DwHwwYYAwAZfoL9VZrzoUAAAAASUVORK5CYII=', 'base64') });
  await sheet().locator('img.ai-photo').waitFor();
  await sheet().locator('textarea[data-input="aiNotes"]').fill('ca. 250 g Reis, mit Öl gebraten');
  await sheet().locator('textarea[data-input="aiNotes"]').dispatchEvent('input');
  await shot('15-ki-foto');
  await sheet().locator('[data-act="aiAnalyze"]').click();
  await expectText(sheet().locator('.card.warn'), 'API-Schlüssel wurde abgelehnt');
  ok('Ungültiger Schlüssel: verständliche Fehlermeldung, nichts gespeichert');

  aiMode = 'ok';
  await sheet().locator('[data-act="aiAnalyze"]').click();
  await sheet().locator('.ai-item').first().waitFor({ timeout: 8000 });
  const call = aiCalls.at(-1);
  if (call.headers.authorization !== 'Bearer sk-ant-api03-TESTKEY_abcdefghijklmnopqrstuvwxyz' || call.headers['anthropic-dangerous-direct-browser-access'] !== 'true') throw new Error('Schlüssel/Browser-Header nicht gesendet');
  if (!String(call.headers['anthropic-beta'] ?? '').includes('server-side-fallback-2026-07-01')) throw new Error('Fallback-Beta fehlt');
  if (call.body.model !== 'claude-opus-5-5' || call.body.fallbacks !== 'default' || call.body.output_config?.format?.type !== 'json_schema') throw new Error('Anfrage falsch: ' + JSON.stringify(call.body).slice(0, 300));
  const blocks = call.body.messages[0].content;
  if (blocks[0].type !== 'image' || blocks[0].source.media_type !== 'image/jpeg' || !blocks[1].text.includes('mit Öl gebraten')) throw new Error('Bild/Notiz fehlen in der Anfrage');
  await expectText(sheet().locator('#ai-total'), '669 kcal');
  await shot('16-ki-ergebnis');
  ok('KI-Antwort: 3 Komponenten, 669 kcal; Anfrage mit Bild, Notiz, JSON-Schema und Fallback');

  const amt = sheet().locator('.ai-item').first().locator('[data-f="amount"]');
  await amt.fill('500'); await amt.dispatchEvent('input');
  if ((await sheet().locator('.ai-item').first().locator('[data-f="calories"]').inputValue()) !== '650') throw new Error('Nährwerte skalieren nicht mit der Menge');
  await sheet().locator('.ai-item').nth(2).locator('[data-act="aiRemove"]').click();
  await expectText(sheet().locator('#ai-total'), '898 kcal');
  const nAi = (await state()).foodEntries.length;
  await sheet().locator('[data-act="aiSave"]').click();
  await page.waitForFunction(n => window.__masse.state.foodEntries.length === n + 2, nAi);
  const rice = (await state()).foodEntries.find(e => e.food.name === 'Basmatireis gekocht');
  if (rice.amount !== 500 || Math.round(C_portionKcal(rice)) !== 650) throw new Error('Gespeicherter Eintrag falsch');
  await expectText(page.locator('#main'), 'Hähnchenbrust gebraten');
  ok('Menge geändert (Werte skaliert), Komponente entfernt, 2 Einträge gespeichert');
  await page.unroute('https://api.anthropic.com/**');

  // Barcode: Open Food Facts wird im Test simuliert
  let offCalls = 0;
  await page.route('https://world.openfoodfacts.org/api/v2/product/**', route => {
    offCalls++;
    const url = route.request().url();
    const body = url.includes('4006381333931')
      ? { status: 1, product: { code: '4006381333931', product_name_de: 'Testmüsli', brands: 'Marke X', product_quantity_unit: 'g', nutriments: { 'energy-kcal_100g': 380, proteins_100g: 10, carbohydrates_100g: 60, fat_100g: 8 } } }
      : { status: 1, product: { code: '96385074', product_name: 'Skyr Natur', nutriments: { 'energy-kcal_100g': 63, proteins_100g: 11 } } };
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  const scanCode = async code => {
    await page.click('.quick [data-act="scan"]');
    await sheet().locator('input[name="code"]').fill(code);
    await sheet().locator('form.row button').click();
  };
  const closeAll = async () => { while (await page.locator('.sheet-wrap').count()) await page.locator('.sheet-wrap').last().locator('header [data-act="closeSheet"]').click(); };

  await scanCode('4006381333931');
  await page.locator('.dialog').waitFor();
  await page.locator('.dialog [data-r="0"]').click();
  await sheet().locator('input[name="barcode"]').waitFor();
  if ((await sheet().locator('input[name="barcode"]').inputValue()) !== '4006381333931') throw new Error('Barcode nicht übernommen');
  if (offCalls !== 0) throw new Error('Ohne Zustimmung wurde online gesucht');
  ok('Unbekannter Barcode: App fragt nach Online-Suche; bei „Abbrechen“ manuelle Erfassung, keine Anfrage');
  await closeAll();

  await scanCode('4006381333931');
  await confirm();
  await sheet().locator('input[name="amount"]').waitFor();
  await expectText(sheet().locator('.card.flat'), 'Testmüsli');
  await sheet().locator('input[name="amount"]').fill('80');
  await sheet().locator('button.primary').click();
  await expectText(page.locator('#main'), 'Testmüsli');
  ok('Online gefunden: Werte übernommen und 80 g eingetragen');

  await scanCode('4006381333931');
  await sheet().locator('input[name="amount"]').waitFor();
  if (offCalls !== 1) throw new Error('Gespeichertes Produkt wurde erneut online gesucht');
  ok('Zweiter Scan desselben Produkts: sofort aus dem eigenen Katalog');
  await closeAll();

  await sleep(4200);
  await scanCode('96385074');
  await sheet().locator('input[name="calories"]').waitFor();
  const v = n => sheet().locator(`input[name="${n}"]`).inputValue();
  if ((await v('name')) !== 'Skyr Natur' || (await v('calories')) !== '63' || (await v('protein')) !== '11' || (await v('carbs')) !== '' || (await v('barcode')) !== '96385074')
    throw new Error('Teilweise Vorbelegung falsch');
  await shot('09-teilweise');
  await sheet().locator('input[name="carbs"]').fill('4');
  await sheet().locator('input[name="fat"]').fill('0,2');
  await sheet().locator('button.primary').click();
  await sheet().locator('input[name="amount"]').waitFor();
  const skyr = (await state()).foods.find(f => f.barcode === '96385074');
  if (!skyr || skyr.macros.carbs !== 4 || !skyr.source.includes('Open Food Facts')) throw new Error('Ergänztes Produkt nicht gespeichert');
  ok('Unvollständiges Produkt: vorhandene Werte vorbelegt, Rest ergänzt und gespeichert');
  await closeAll();
  await page.unroute('https://world.openfoodfacts.org/api/v2/product/**');

  await page.click('[data-act="foodDay"][data-d="-1"]');
  await expectText(page.locator('.daynav'), 'Gestern');
  await page.click('[data-act="foodDay"][data-d="1"]');
  ok('Tageswechsel in der Ernährung');

  // Fortschritt
  await page.click('[data-tab="progress"]');
  await page.locator('svg.chart').first().waitFor();
  await page.setInputFiles('input[data-change="addPhoto"]', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGP4z8DwHwwYYAwAZfoL9VZrzoUAAAAASUVORK5CYII=', 'base64') });
  await page.waitForFunction(() => window.__masse.state.photos.length === 1);
  await page.setInputFiles('input[data-change="addPhoto"]', { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGP4z8DwHwwYYAwAZfoL9VZrzoUAAAAASUVORK5CYII=', 'base64') });
  await page.waitForFunction(() => window.__masse.state.photos.length === 2);
  await page.click('[data-act="compareMode"]');
  await page.locator('.ph').nth(0).click();
  await page.locator('.ph').nth(1).click();
  await sheet().locator('.compare').waitFor();
  ok('Fortschritt: Diagramme, 2 Fotos gespeichert und verglichen');
  await sheet().locator('header [data-act="closeSheet"]').click();
  await page.click('[data-act="addMeasure"]');
  await sheet().locator('input[name="waist"]').fill('78,5');
  await sheet().locator('button.primary').click();
  await expectText(page.locator('.table'), '78,5');
  ok('Körpermaße eingetragen');
  await expectText(page.locator('.review'), 'Wochenrückblick');
  await page.click('[data-act="reviewWeek"][data-d="-7"]');
  await page.locator('.cal .cd.today').scrollIntoViewIfNeeded();
  await shot('13-kalender');
  await page.click('.cal .cd.today');
  await expectText(page.locator('.daynav'), 'Heute');
  ok('Wochenrückblick mit Wochenwechsel; Kalendertag öffnet die Ernährung');
  await page.click('[data-tab="progress"]');
  await page.evaluate(() => document.querySelector('#main').scrollTo(0, 0));
  await shot('07-fortschritt');

  await page.click('[data-tab="more"]');
  await page.click('[data-act="setTheme"][data-v="light"]');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 4000 }).catch(() => { throw new Error('Helles Design nicht aktiv'); });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (bg !== 'rgb(242, 244, 246)') throw new Error('Heller Hintergrund fehlt: ' + bg);
  for (const tab of ['home', 'training', 'food', 'progress']) { await page.click(`[data-tab="${tab}"]`); await shot(`hell-${tab}`); }
  await page.click('[data-tab="more"]');
  await page.click('[data-act="setTheme"][data-v="dark"]');
  await page.click('[data-act="setBackupDays"][data-v="14"]');
  await page.waitForFunction(() => window.__masse.state.profile.backupDays === 14);
  const pr = (await state()).profile;
  if (pr.theme !== 'dark' || pr.backupDays !== 14) throw new Error('Darstellung/Erinnerung nicht gespeichert');
  ok('Hell/Dunkel umschaltbar, Sicherungs-Erinnerung einstellbar');

  // Mehr: Ziele, Backup, Reset, Import
  await page.click('[data-tab="more"]');
  await page.fill('input[name="calories"]', '3500');
  await page.click('form[data-form="saveProfile"] button.primary');
  await page.waitForFunction(() => window.__masse.state.profile.goals.calories === 3500);
  ok('Ziele geändert');
  await shot('08-mehr');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.card [data-act="exportBackup"]')]);
  const backupPath = path.join(shots || '/tmp', 'backup.json');
  await dl.saveAs(backupPath);
  const before = await state();
  ok(`Sicherung exportiert (${dl.suggestedFilename()})`);

  await page.click('[data-act="resetAll"]'); await confirm(); await confirm();
  await page.waitForFunction(() => window.__masse.state.weights.length === 0);
  ok('Alle Daten gelöscht');

  await page.click('[data-tab="more"]');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.card [data-act="importBackup"]')]);
  await chooser.setFiles(backupPath);
  await confirm();
  await page.waitForFunction(() => window.__masse.state.weights.length === 1);
  const after = await state();
  for (const k of ['foodEntries', 'weights', 'workouts', 'photos', 'measurements', 'plans'])
    if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) throw new Error(`Wiederherstellung unvollständig: ${k}`);
  if (after.profile.goals.calories !== 3500) throw new Error('Ziele nicht wiederhergestellt');
  ok('Sicherung vollständig wiederhergestellt (inkl. Fotos und Training)');

  // Offline
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8000 }).catch(() => {});
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8000 });
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#tabbar button');
  const offState = await state();
  if (offState.weights.length !== 1) throw new Error('Offline: Daten fehlen');
  await page.click('[data-tab="home"]');
  await page.click('[data-act="quickShake"]');
  await page.waitForFunction(n => window.__masse.state.foodEntries.length === n, offState.foodEntries.length + 1);
  await context.setOffline(false);
  ok('Offline: App lädt aus dem Cache, Eingaben funktionieren');

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  await page.clock.setFixedTime(new Date(`${today}T19:00:00+01:00`));
  await page.click('[data-tab="more"]');
  await page.fill('input[name="calories"]', '6000');
  await page.click('form[data-form="saveProfile"] button.primary');
  await page.waitForFunction(() => window.__masse.state.profile.goals.calories === 6000);
  await page.click('[data-tab="home"]');
  await expectText(page.locator('#main'), 'Vorschläge aus deinen Favoriten');
  const nFill = (await state()).foodEntries.length;
  if (await page.locator('[data-act="applyFill"]').count()) {
    await page.locator('[data-act="applyFill"]').first().click();
    await page.waitForFunction(n => window.__masse.state.foodEntries.length > n, nFill);
  }
  await shot('14-luecke');
  ok('Abends: Kalorienlücke mit Vorschlägen aus den Favoriten');

  // Breite prüfen: kein horizontales Scrollen
  for (const tab of ['home', 'training', 'food', 'progress', 'more']) {
    await page.click(`[data-tab="${tab}"]`);
    const overflow = await page.evaluate(() => document.querySelector('#main').scrollWidth > document.querySelector('#main').clientWidth);
    if (overflow) throw new Error(`Horizontaler Überlauf im Tab ${tab}`);
  }
  ok('Kein horizontaler Überlauf in allen Tabs');

  if (errors.length) throw new Error('Browserfehler:\n' + errors.join('\n'));
  console.log(`\nAlle ${step} Schritte bestanden.`);
} catch (e) {
  await shot('fehler');
  console.error('\n✗ FEHLER:', e.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as O from '../js/ocr.js';

// Echte Tesseract-Ausgaben aus Testbildern (inkl. typischer Fehler wie „g“ → „9“)
const LABEL = 'Nährwerte\npro Portion\npro 100 g (40 g)\nEnergie 1580 kJ/ 632 kJ/151\n377 kcal kcal\nFett 7,09 2,89\ndavon gesättigte\nFettsäuren 9 129 0,59\nKohlenhydrate 58,79 23,59\ndavon Zucker 1.19 0,49\nBallaststoffe 109g 4,0 g\nEiweiß 13,59 5,49\nSalz 0,02 g 0,01 g';
const DIARY = 'Heute\nGegessen\n1.845 kcal\nKohlenhydrate 210 /4959g\nProtein 98/1309g\nFett 61/100 g';

test('Zahlen: Komma, Tausenderpunkt, OCR-O, Kleiner-als', () => {
  assert.equal(O.parseNumber('1.580'), 1580);
  assert.equal(O.parseNumber('7,0'), 7);
  assert.equal(O.parseNumber('7.5'), 7.5);
  assert.equal(O.parseNumber('<0,5'), 0.5);
  assert.equal(O.parseNumber('1O,5'), 10.5);
  assert.ok(Number.isNaN(O.parseNumber('g')));
});

test('Etikett: kcal statt kJ, „davon“-Zeilen ignoriert, „7,09“ → 7,0', () => {
  const r = O.parseNutritionText(LABEL);
  assert.deepEqual(r.macros, { calories: 377, protein: 13.5, carbs: 58.7, fat: 7 });
  assert.deepEqual(r.basis, { amount: 100, unit: 'g' });
  assert.ok(r.warnings.some(w => w.includes('korrigiert')));
});

test('App-Screenshot: Tagessumme als Portion, „98/1309g“ → 98', () => {
  const r = O.parseNutritionText(DIARY);
  assert.deepEqual(r.macros, { calories: 1845, protein: 98, carbs: 210, fat: 61 });
  assert.deepEqual(r.basis, { amount: 1, unit: 'Portion' });
});

test('Produkt-Screenshot mit Name, englisches Etikett mit ml, nur kJ', () => {
  const s = O.parseNutritionText('Skyr Natur\n100g\nKalorien 63 kcal\nProtein 11,0 g\nKohlenhydrate 4,0 g\nFett 0,2g');
  assert.equal(s.name, 'Skyr Natur'); assert.equal(s.macros.protein, 11); assert.equal(s.warnings.length, 0);
  const e = O.parseNutritionText('Nutrition Facts per 100 ml\nEnergy 268 kJ / 64 kcal\nFat 3.5 g\nof which saturates 2.3 g\nCarbohydrate 4.8 g\nof which sugars 4.8 g\nProtein 3.4 g');
  assert.deepEqual(e.macros, { calories: 64, protein: 3.4, carbs: 4.8, fat: 3.5 }); assert.equal(e.basis.unit, 'ml');
  const kj = O.parseNutritionText('je 100 ml\nBrennwert 268 kJ\nFett 3,5 g\nKohlenhydrate 4,8 g\nEiweiß 3,4 g');
  assert.ok(Math.abs(kj.macros.calories - 64.05) < 0.1);
});

test('Fehlende Werte und berechnete Kalorien', () => {
  const r = O.parseNutritionText('pro 100 g\nFett 10 g\nKohlenhydrate 20 g\nEiweiß 5 g');
  assert.equal(r.macros.calories, 190); assert.ok(r.warnings[0].includes('berechnet'));
  const p = O.parseNutritionText('Eiweiß 12 g');
  assert.deepEqual(p.missing.sort(), ['calories', 'carbs', 'fat']);
  assert.match(O.summary(p), /Erkannt: Protein · fehlt: Kalorien, Kohlenhydrate, Fett/);
});

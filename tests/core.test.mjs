import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/core.js';
import { seedState } from '../js/seed.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const day = (y, m, d, h = 8) => new Date(y, m - 1, d, h);

test('Startdaten: Vorgaben, 4 Gym + 3 Volleyball, 27 Übungen, keine Messungen', () => {
  const s = seedState();
  assert.deepEqual(s.profile.goals, C.macros(3400, 130, 495, 100));
  assert.equal(s.plans.filter(p => p.volleyball).length, 3);
  assert.equal(s.plans.filter(p => !p.volleyball).length, 4);
  assert.equal(s.plans.reduce((n, p) => n + p.exercises.length, 0), 27);
  assert.equal(s.weights.length, 0);
  assert.equal(s.workouts.length, 0);
  assert.equal(s.profile.onlineFoodEnabled, false);
  const squat = s.plans.flatMap(p => p.exercises).find(e => e.name === 'Kniebeugen');
  assert.equal(squat.seedWeight, null, 'keine erfundene Gesamtlast');
  C.validateState(s);
});

test('Portion und Restmenge', () => {
  const f = C.newFood('Reis', C.macros(350, 7, 77, 1));
  const p = C.portion(f, 150);
  close(p.calories, 525); close(p.carbs, 115.5);
  assert.deepEqual(C.remaining(C.macros(4000, 50, 0, 0), C.macros(3400, 130, 495, 100)), C.macros(0, 80, 495, 100));
  assert.throws(() => C.portion(f, 0));
  assert.throws(() => C.portion(f, -5));
  assert.throws(() => C.portion({ ...f, basisAmount: 0 }, 10));
  assert.throws(() => C.portion(f, 1e9), /zu groß/);
  assert.throws(() => C.newFoodEntry(f, NaN));
});

test('Tagesfilter und unveränderliche Historie', () => {
  const f = C.newFood('Brot', C.macros(250, 9, 45, 3));
  const e1 = C.newFoodEntry(f, 100, day(2026, 11, 10));
  const e2 = C.newFoodEntry(f, 200, day(2026, 11, 11));
  f.macros.calories = 999; // Katalog ändert sich später
  const t = C.nutritionTotal([e1, e2], day(2026, 11, 10, 22));
  close(t.calories, 250);
  close(C.nutritionTotal([e1, e2], day(2026, 11, 11)).calories, 500);
});

const ex = (o = {}) => C.exercise('Bank', 3, 8, 10, { weight: 50, ...o });
const done = (w, r, o = {}) => ({ ...C.trainingSet(w, r), completed: true, ...o });

test('Double Progression', () => {
  const e = ex();
  assert.equal(C.suggestion({ exercise: e, sets: [done(50, 10), done(50, 10), done(50, 11)] }), 52.5);
  assert.equal(C.suggestion({ exercise: e, sets: [done(50, 10), done(50, 10), done(50, 9)] }), null, 'Satz unter Ziel');
  assert.equal(C.suggestion({ exercise: e, sets: [done(50, 10), done(50, 10)] }), null, 'fehlender Satz');
  assert.equal(C.suggestion({ exercise: e, sets: [done(50, 10), done(50, 10), done(47.5, 10)] }), null, 'gemischte Last');
  assert.equal(C.suggestion({ exercise: e, sets: [done(50, 10), done(50, 10), { ...C.trainingSet(50, 10) }] }), null, 'unvollständig');
  assert.equal(C.suggestion({ exercise: e, sets: [done(20, 5, { warmup: true }), done(50, 10), done(50, 10), done(50, 10)] }), 52.5, 'Aufwärmen ignoriert');
  assert.equal(C.suggestion({ exercise: ex({ step: 2 }), sets: [done(17.5, 10), done(17.5, 10), done(17.5, 10)] }), 19.5, 'eigene Stufe');
  assert.equal(C.suggestion({ exercise: ex({ timed: true }), sets: [done(0, 60), done(0, 60), done(0, 60)] }), null);
  assert.equal(C.suggestion({ exercise: ex({ basis: 'bodyweight' }), sets: [done(1, 10), done(1, 10), done(1, 10)] }), null);
});

test('Volumen und e1RM', () => {
  const w = { exercises: [
    { exercise: ex({ basis: 'perHand' }), sets: [done(20, 10), done(20, 10, { warmup: true }), C.trainingSet(20, 10)] },
    { exercise: ex({ timed: true, basis: 'bodyweight' }), sets: [done(0, 60)] },
    { exercise: ex(), sets: [done(50, 8)] },
  ] };
  close(C.volume(w), 20 * 10 * 2 + 50 * 8);
  close(C.estimated1RM(100, 10), 100 * (1 + 10 / 30));
  assert.equal(C.estimated1RM(100, 1), 100);
  assert.equal(C.estimated1RM(100, 13), null);
  assert.equal(C.estimated1RM(0, 5), null);
});

test('Neue Einheit übernimmt vorherige Sätze ohne automatische Steigerung', () => {
  const s = seedState();
  const p = s.plans.find(x => x.name === 'Oberkörper A');
  const first = C.beginWorkout(p, [], day(2026, 11, 3));
  assert.equal(first.exercises[0].sets.length, 3);
  assert.equal(first.exercises[0].sets[0].weight, 17.5);
  assert.equal(first.exercises[0].sets[0].reps, 8);
  first.exercises[0].sets.forEach(x => { x.completed = true; x.reps = 10; x.rir = 1; });
  first.ended = day(2026, 11, 3, 18).toISOString();
  const second = C.beginWorkout(p, [first], day(2026, 11, 10));
  const s0 = second.exercises[0].sets[0];
  assert.equal(s0.weight, 17.5); assert.equal(s0.reps, 10); assert.equal(s0.rir, 1);
  assert.equal(s0.completed, false);
  assert.notEqual(s0.id, first.exercises[0].sets[0].id);
  assert.equal(C.suggestion(C.previousPerformance(p.exercises[0].id, [first])), 19.5);
});

test('Gewicht: Tagesmittel, gleitendes Mittel, fehlende Tage', () => {
  const w = [
    { id: 'a', date: day(2026, 11, 1, 7).toISOString(), kg: 63 },
    { id: 'b', date: day(2026, 11, 1, 21).toISOString(), kg: 64 },
    { id: 'c', date: day(2026, 11, 3).toISOString(), kg: 64 },
  ];
  const d = C.dailyWeights(w);
  assert.equal(d.length, 2); close(d[0].kg, 63.5);
  close(C.weightMean(w, day(2026, 11, 3)), (63.5 + 64) / 2);
  assert.equal(C.weightMean(w, day(2026, 10, 20)), null);
  assert.equal(C.latestWeight(w).kg, 64);
  assert.equal(C.gainPerWeek(w), null, 'zu kurzer Zeitraum');
});

test('Gewicht: Plateau benötigt genug Daten', () => {
  const today = day(2026, 11, 14);
  const flat = Array.from({ length: 14 }, (_, i) => ({ id: String(i), date: C.addDays(today, -13 + i).toISOString(), kg: 65 }));
  assert.equal(C.weightStalled(flat, today), true);
  const rising = flat.map((e, i) => ({ ...e, kg: 65 + i * 0.05 }));
  assert.equal(C.weightStalled(rising, today), false);
  assert.equal(C.weightStalled(flat.slice(10), today), false);
  close(C.gainPerWeek(rising), 0.05 * 7);
});

test('Wochenplan: nächste Einheit (auch über Sommerzeit)', () => {
  const s = seedState();
  // Dienstag 17.11.2026 10:00 → Oberkörper A Dienstag 16:45
  const n = C.nextSession(s.plans, new Date(2026, 10, 17, 10));
  assert.equal(n[0].name, 'Oberkörper A');
  assert.equal(n[1].getHours(), 16); assert.equal(n[1].getMinutes(), 45);
  // Samstag 24.10.2026 12:00 → Volleyball Montag 26.10. 19:00 (nach Zeitumstellung)
  const v = C.nextSession(s.plans, new Date(2026, 9, 24, 12));
  assert.equal(v[0].name, 'Volleyball'); assert.equal(v[1].getDate(), 26); assert.equal(v[1].getHours(), 19);
});

test('Barcode-Prüfziffer und UPC-Normalisierung', () => {
  assert.equal(C.normalizeBarcode('4006381333931'), '4006381333931');
  assert.equal(C.normalizeBarcode('96385074'), '96385074');
  assert.equal(C.normalizeBarcode('036000291452'), '0036000291452');
  assert.throws(() => C.normalizeBarcode('4006381333932'), /Prüfziffer/);
  assert.throws(() => C.normalizeBarcode('12345'));
  assert.throws(() => C.normalizeBarcode('40063813339a1'));
});

test('Open-Food-Facts-Produkt: vollständig, kJ-Umrechnung, fehlende Werte', () => {
  const f = C.productToFood({ code: '4006381333931', product_name_de: 'Haferflocken', brands: 'X',
    nutriments: { 'energy-kcal_100g': 372, proteins_100g: 13.5, carbohydrates_100g: 58.7, fat_100g: 7 } });
  assert.equal(f.name, 'Haferflocken'); close(f.macros.calories, 372); assert.equal(f.unit, 'g');
  const kj = C.productToFood({ product_name: 'Milch', product_quantity_unit: 'L',
    nutriments: { 'energy-kj_100g': 268, proteins_100g: '3.4', carbohydrates_100g: 4.8, fat_100g: 3.5 } });
  close(kj.macros.calories, 268 / 4.184); assert.equal(kj.unit, 'ml');
  assert.throws(() => C.productToFood({ product_name: 'X', nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1 } }));
  assert.throws(() => C.productToFood({ product_name: '', nutriments: { 'energy-kcal_100g': 1, proteins_100g: 1, carbohydrates_100g: 1, fat_100g: 1 } }));
});

test('Backup-Validierung', () => {
  const s = seedState();
  const copy = JSON.parse(JSON.stringify(s));
  assert.doesNotThrow(() => C.validateState(copy));
  assert.throws(() => C.validateState({ ...copy, schemaVersion: 99 }), /Datenversion/);
  assert.throws(() => C.validateState({ ...copy, foods: [copy.foods[0], copy.foods[0]] }), /Doppelte/);
  assert.throws(() => C.validateState({ ...copy, weights: [{ id: 'x', date: '', kg: -1 }] }));
  assert.throws(() => C.validateState(null));
});

test('CSV: Quoting und Formelschutz', () => {
  assert.equal(C.csvField('a;b'), '"a;b"');
  assert.equal(C.csvField('Er sagte "hi"'), '"Er sagte ""hi"""');
  assert.equal(C.csvField('x"\ny'), '"x""\ny"');
  assert.equal(C.csvField('=SUMME(A1)'), "'=SUMME(A1)");
  assert.equal(C.csvField('-2.5'), '-2.5');
  assert.equal(C.csvField('@x'), "'@x");
  assert.ok(C.csv([['a', 1]]).startsWith('﻿a;1'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/ai.js';

test('Anfrage: Bild, Notiz, strukturierte Ausgabe, Fallback nur bei Opus', () => {
  const r = A.buildRequest({ imageBase64: 'AAAA', notes: '  ca. 200 g Reis ' });
  assert.equal(r.model, 'claude-opus-5-5');
  assert.equal(r.messages[0].content[0].type, 'image');
  assert.match(r.messages[0].content[1].text, /Notizen von mir: ca\. 200 g Reis$/);
  assert.equal(r.output_config.format.type, 'json_schema');
  assert.equal(r.fallbacks, 'default'); assert.deepEqual(r.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(r.thinking, undefined, 'Opus 5.5: thinking nicht deaktivieren');
  const h = A.buildRequest({ model: 'claude-haiku-5-5', imageBase64: 'AAAA' });
  assert.equal(h.fallbacks, undefined); assert.equal(h.betas, undefined);
  assert.throws(() => A.buildRequest({}), /Foto/);
});

test('Antwort: wird geprüft und bereinigt', () => {
  const ok = A.parseResult(JSON.stringify({ is_food: true, comment: 'Öl geschätzt', items: [
    { name: 'Reis', amount: 250, unit: 'g', calories: 325, protein: 6.5, carbs: 70, fat: 1, confidence: 'hoch' },
    { name: 'Kaputt', amount: 0, unit: 'g', calories: 10, protein: 1, carbs: 1, fat: 1, confidence: 'hoch' },
    { name: 'Soße', amount: 50, unit: 'Liter', calories: 'x', protein: 1, carbs: 1, fat: 1, confidence: 'egal' },
    { name: 'Saft', amount: 200, unit: 'ml', calories: 90, protein: 1, carbs: 20, fat: 0, confidence: 'egal' },
  ] }));
  assert.equal(ok.items.length, 2);
  assert.equal(ok.items[1].confidence, 'mittel');
  assert.equal(ok.comment, 'Öl geschätzt');
  assert.throws(() => A.parseResult('{"is_food":false,"items":[],"comment":""}'), /kein Essen/);
  assert.throws(() => A.parseResult('{kaputt'), /unvollständig/);
  assert.throws(() => A.parseResult('{"is_food":true,"items":[],"comment":""}'), /keine Lebensmittel/);
});

test('Menge ändern skaliert Nährwerte', () => {
  const r = A.rescaleItem({ name: 'Reis', amount: 200, unit: 'g', calories: 260, protein: 5, carbs: 56, fat: 0.6 }, 300);
  assert.equal(r.calories, 390); assert.equal(r.protein, 7.5);
  assert.equal(A.keyLooksValid('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), true);
  assert.equal(A.keyLooksValid('hallo'), false);
});

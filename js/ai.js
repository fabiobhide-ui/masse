// KI-Schätzung von Nährwerten aus einem Essensfoto über die Anthropic-API.
// Der API-Schlüssel gehört dem Nutzer und liegt nur auf diesem Gerät (nicht in Sicherungen).
import { FitnessError } from './core.js';

export const AI_MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 – am genauesten'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 – günstiger und schneller'],
];
export const DEFAULT_MODEL = AI_MODELS[0][0];
// Server-seitige Ausweichmodelle bei einer Ablehnung (Haiku 5.5 bietet das nicht an).
const FALLBACK_MODELS = new Set(['claude-opus-5-5']);
export const UNITS = ['g', 'ml', 'Stück'];

export const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_food', 'items', 'comment'],
  properties: {
    is_food: { type: 'boolean', description: 'false, wenn auf dem Bild kein Essen oder Getränk zu erkennen ist' },
    comment: { type: 'string', description: 'Ein bis zwei kurze Sätze auf Deutsch: Annahmen und größte Unsicherheiten' },
    items: {
      type: 'array',
      description: 'Jede erkennbare Komponente einzeln (z. B. Reis, Hähnchen, Soße)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'amount', 'unit', 'calories', 'protein', 'carbs', 'fat', 'confidence'],
        properties: {
          name: { type: 'string', description: 'Kurzer deutscher Name, z. B. „Basmatireis gekocht“' },
          amount: { type: 'number', description: 'Geschätzte Menge auf dem Bild' },
          unit: { type: 'string', enum: UNITS },
          calories: { type: 'number', description: 'kcal für die gesamte geschätzte Menge' },
          protein: { type: 'number', description: 'Gramm für die gesamte Menge' },
          carbs: { type: 'number', description: 'Gramm für die gesamte Menge' },
          fat: { type: 'number', description: 'Gramm für die gesamte Menge' },
          confidence: { type: 'string', enum: ['hoch', 'mittel', 'niedrig'] },
        },
      },
    },
  },
};

export const SYSTEM_PROMPT = `Du schätzt Nährwerte von Mahlzeiten anhand eines Fotos für eine Ernährungs-App zum Muskelaufbau.
Gehe so vor:
- Erkenne jede Komponente einzeln (Beilage, Fleisch/Fisch, Gemüse, Soße, Getränk). Fasse nur zusammen, was sich nicht trennen lässt.
- Schätze die Menge über Tellergröße (Standard ca. 26 cm), Besteck, Verpackungen und typische Portionen. Gekochte Beilagen als gekochtes Gewicht.
- Rechne mit üblichen Nährwerten pro 100 g und gib die Werte für die gesamte geschätzte Menge an.
- Unsichtbares Fett (Öl, Butter, Soßen, Dressing) wird oft unterschätzt: plane es realistisch ein, wenn die Zubereitung darauf hindeutet.
- Notizen des Nutzers haben Vorrang vor deiner Schätzung (z. B. Mengenangaben, Zutaten, „ohne Öl“).
- Für Verpackungen mit lesbarer Nährwerttabelle nimm deren Werte.
- Antworte nur mit dem verlangten JSON. Alle Texte auf Deutsch.`;

export function buildRequest({ model = DEFAULT_MODEL, imageBase64, mediaType = 'image/jpeg', notes = '' }) {
  if (!imageBase64) throw new FitnessError('Bitte zuerst ein Foto aufnehmen.');
  const text = notes.trim()
    ? `Schätze die Nährwerte dieser Mahlzeit. Notizen von mir: ${notes.trim().slice(0, 500)}`
    : 'Schätze die Nährwerte dieser Mahlzeit.';
  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
      { type: 'text', text },
    ] }],
  };
  if (FALLBACK_MODELS.has(model)) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
  return params;
}

const num = v => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : NaN);
/** Prüft und bereinigt die Antwort der KI. */
export function parseResult(text) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new FitnessError('Die Antwort der KI war unvollständig. Bitte erneut versuchen.'); }
  if (!data || !Array.isArray(data.items)) throw new FitnessError('Die Antwort der KI war unvollständig. Bitte erneut versuchen.');
  if (data.is_food === false) throw new FitnessError('Auf dem Foto wurde kein Essen erkannt. Versuche es mit einem deutlicheren Bild.');
  const items = data.items.slice(0, 15).map(it => ({
    name: String(it?.name ?? '').trim().slice(0, 80),
    amount: num(it?.amount),
    unit: UNITS.includes(it?.unit) ? it.unit : 'g',
    calories: num(it?.calories), protein: num(it?.protein), carbs: num(it?.carbs), fat: num(it?.fat),
    confidence: ['hoch', 'mittel', 'niedrig'].includes(it?.confidence) ? it.confidence : 'mittel',
  })).filter(it => it.name && it.amount > 0 && [it.calories, it.protein, it.carbs, it.fat].every(Number.isFinite) && it.calories < 5000);
  if (!items.length) throw new FitnessError('Die KI konnte keine Lebensmittel bestimmen. Ergänze eine Notiz und versuche es erneut.');
  return { items, comment: String(data.comment ?? '').trim().slice(0, 400) };
}

/** Menge ändern und Nährwerte anteilig mitskalieren. */
export function rescaleItem(item, amount) {
  if (!(amount > 0) || !(item.amount > 0)) return { ...item, amount };
  const f = amount / item.amount;
  return { ...item, amount, calories: item.calories * f, protein: item.protein * f, carbs: item.carbs * f, fat: item.fat * f };
}

export const keyLooksValid = k => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(String(k ?? '').trim());

let sdk = null;
export async function analyzeFood({ apiKey, model, imageBase64, mediaType, notes }) {
  if (!keyLooksValid(apiKey)) throw new FitnessError('Bitte unter „Mehr“ einen gültigen API-Schlüssel eintragen.');
  sdk ??= (await import('../vendor/anthropic-sdk.js')).default;
  const Anthropic = sdk;
  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120_000 });
  const params = buildRequest({ model, imageBase64, mediaType, notes });
  let res;
  try {
    res = params.betas ? await client.beta.messages.create(params) : await client.messages.create(params);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new FitnessError('Der API-Schlüssel wurde abgelehnt. Bitte unter „Mehr“ prüfen.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new FitnessError('Dieser API-Schlüssel darf das Modell nicht nutzen. Prüfe dein Konto auf console.anthropic.com.');
    if (e instanceof Anthropic.RateLimitError) throw new FitnessError('Zu viele Anfragen oder kein Guthaben mehr. Bitte später erneut versuchen bzw. Guthaben prüfen.');
    if (e instanceof Anthropic.BadRequestError) throw new FitnessError(`Anfrage abgelehnt: ${e.message}`);
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new FitnessError('Die Analyse hat zu lange gedauert. Bitte erneut versuchen.');
    if (e instanceof Anthropic.APIConnectionError) throw new FitnessError('Keine Verbindung zur KI. Bist du online?');
    if (e instanceof Anthropic.APIError) throw new FitnessError(`Die KI ist gerade nicht erreichbar (Fehler ${e.status ?? '?'}). Bitte später erneut versuchen.`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new FitnessError('Die KI hat die Analyse dieses Bildes abgelehnt.');
  if (res.stop_reason === 'max_tokens') throw new FitnessError('Die Antwort der KI war zu lang. Bitte erneut versuchen.');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { ...parseResult(text), model: res.model, usage: res.usage };
}

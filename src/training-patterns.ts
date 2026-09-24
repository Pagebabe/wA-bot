import type { Profile, StoredMessage } from './store.js';

export type LeadIntent =
  | 'greeting'
  | 'price'
  | 'scheduling'
  | 'duration'
  | 'location'
  | 'media'
  | 'arrival'
  | 'other';

export type TrainingSignals = {
  intents: LeadIntent[];
  hasTemporalWish: boolean;
  hasDuration: boolean;
  arrivalNow: boolean;
  nextMissing: 'time' | 'duration' | null;
};

function normalize(input: string): string {
  return input.toLocaleLowerCase('de-DE').replace(/\s+/g, ' ').trim();
}

export function detectLeadIntents(input: string): LeadIntent[] {
  const text = normalize(input);
  const intents = new Set<LeadIntent>();
  if (!text) return ['other'];
  if (/^(hi|hey|hallo|hello|guten (morgen|tag|abend)|moin)\b/.test(text)) intents.add('greeting');
  if (/\b(preis|preise|kostet|kosten|wieviel|wie viel|euro|€)\b/.test(text)) intents.add('price');
  if (/\b(wann|heute|morgen|jetzt|gleich|später|uhr|termin|zeit|kommen|komme|vorbei)\b/.test(text)) intents.add('scheduling');
  if (/\b(15|20|30|45|60|90)\s*(min|minuten?|minute|minutes?|std|stunde[n]?|hours?)?\b|\b(halbe|eine|1)\s+stunde\b|\b(one|half)\s+hour\b/.test(text)) intents.add('duration');
  if (/\b(adresse|wo|zimmer|etage|stock|klingel|klingeln|klopfen|eingang|tür)\b/.test(text)) intents.add('location');
  if (/\b(foto|fotos|bild|bilder|video)\b/.test(text)) intents.add('media');
  if (/\b(bin da|angekommen|vor der tür|unten|stehe davor|ich bin hier)\b/.test(text)) intents.add('arrival');
  return intents.size ? [...intents] : ['other'];
}

function hasSpecificTemporalWish(text: string): boolean {
  const t = normalize(text);
  return /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/.test(t)
    || /\b(heute|morgen|jetzt|gleich)\b/.test(t)
    || /\bin\s+\d{1,3}\s*(min|minuten?|std|stunden?)\b/.test(t);
}

function hasDuration(text: string): boolean {
  const t = normalize(text);
  return /\b(15|20|30|45|60|90)\s*(min|minuten?|minute|minutes?|std|stunde[n]?|hours?)\b/.test(t)
    || /\b(halbe|eine|1)\s+stunde\b/.test(t);
}

function isArrival(text: string): boolean {
  return /\b(bin da|angekommen|vor der tür|stehe davor|ich bin hier)\b/.test(normalize(text));
}

export function analyzeTrainingSignals(messages: StoredMessage[]): TrainingSignals {
  const leadMessages = messages
    .filter((message) => message.sender === 'lead' && typeof message.text === 'string')
    .map((message) => String(message.text || '').trim())
    .filter(Boolean);
  const latest = leadMessages.at(-1) || '';
  const joined = leadMessages.slice(-12).join(' \n ');
  const temporal = hasSpecificTemporalWish(joined);
  const duration = hasDuration(joined);
  return {
    intents: detectLeadIntents(latest),
    hasTemporalWish: temporal,
    hasDuration: duration,
    arrivalNow: isArrival(latest),
    nextMissing: temporal ? (duration ? null : 'duration') : 'time',
  };
}

function profileFacts(profile: Profile): string[] {
  const facts: string[] = [];
  if (profile.price_text) facts.push(`Preis/Dauer: ${String(profile.price_text).trim()}`);
  if (profile.hours_text) facts.push(`Zeiten: ${String(profile.hours_text).trim()}`);
  const address = profile.share_location?.address || profile.location;
  if (address) facts.push(`Hinterlegter Ort: ${String(address).trim()}`);
  return facts;
}

export function buildTrainingGuidance(profile: Profile, messages: StoredMessage[]): string {
  const signals = analyzeTrainingSignals(messages);
  const facts = profileFacts(profile);
  const rules = [
    'Ablaufhilfe aus den ausgewerteten historischen Chats:',
    'Die wiederkehrenden Themen sind Termin/Zeit, Preis/Dauer, Ort/Anfahrt und Medienfragen.',
    `Aktuell erkannte Intents: ${signals.intents.join(', ')}.`,
    'Historische Muster sind nur Ablaufhilfe, niemals Faktenquelle.',
    'Preise, Ort und Zeiten dürfen ausschließlich aus den bestätigten Profildaten stammen.',
    'Frage nicht erneut nach Informationen, die im aktuellen Verlauf bereits genannt wurden.',
    'Stelle höchstens eine konkrete Rückfrage pro Antwort.',
    'Wenn ein konkreter Zeitwunsch und eine Dauer vorliegen, ist der Lead übergabebereit: hot=true, reply leer.',
    'Wenn der Kontakt bereits angekommen ist oder unmittelbar vor Ort wartet, sofort hot=true und reply leer.',
    'Wenn nur ein Zeitwunsch fehlt, frage nach Tag/Uhrzeit. Wenn nur die Dauer fehlt, frage nach der gewünschten Dauer.',
    'Bei Ortsfragen dürfen Zimmer, Etage, Klingel oder Zugang nicht erfunden werden.',
    'Bei Medienfragen verspreche keine Datei, die nicht als Profilmedium hinterlegt ist.',
  ];
  if (signals.nextMissing === 'time') rules.push('Nächster fehlender Slot: Zeitwunsch.');
  if (signals.nextMissing === 'duration') rules.push('Nächster fehlender Slot: Dauer.');
  if (signals.nextMissing === null) rules.push('Zeitwunsch und Dauer sind vorhanden; nicht weiter qualifizieren, sondern übergeben.');
  rules.push('Bestätigte Profildaten:');
  rules.push(...(facts.length ? facts.map((fact) => `- ${fact}`) : ['- Keine verwertbaren Preis-/Zeit-/Ortsdaten hinterlegt.']));
  return rules.join('\n');
}

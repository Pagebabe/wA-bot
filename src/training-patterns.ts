import type { Profile, StoredMessage } from './store.js';

export type LeadIntent =
  | 'greeting'
  | 'price'
  | 'scheduling'
  | 'duration'
  | 'location'
  | 'media'
  | 'arrival'
  | 'commitment'
  | 'abort'
  | 'hesitation'
  | 'other';

export type TrainingSignals = {
  intents: LeadIntent[];
  hasTemporalWish: boolean;
  hasDayMention: boolean;
  hasDuration: boolean;
  hasActiveCommitment: boolean;
  commitmentNow: boolean;
  arrivalNow: boolean;
  abortNow: boolean;
  hesitationNow: boolean;
  hasAbort: boolean;
  nextMissing: 'time' | 'duration' | 'confirmation' | null;
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
  if (/\b(15|20|30|45|60|90)\s*(min|minuten?|minute|minutes?|std|stunde[n]?|hours?)\b|\b(halbe|eine|1)\s+stunde\b|\b(one|half)\s+hour\b/.test(text.replace(/\bin\s+\d{1,3}\s*(min|minuten?|minute|minutes?|std|stunden?|hours?)\b/g, ''))) intents.add('duration');
  if (/\b(adresse|wo|zimmer|etage|stock|klingel|klingeln|klopfen|eingang|tür)\b/.test(text)) intents.add('location');
  if (/\b(foto|fotos|bild|bilder|video)\b/.test(text)) intents.add('media');
  if (/\b(bin da|angekommen|vor der tür|stehe davor|ich bin hier|bin unten|stehe unten)\b/.test(text)) intents.add('arrival');
  if (/\b(ich komme|komme vorbei|ich will kommen|ich möchte kommen|passt mir|passt gut|bis gleich|bis später|fest einplanen|termin bestätigen)\b/.test(text)) intents.add('commitment');
  if (/\b(Doch nicht|kann nicht|schaffe es nicht|absagen|stornieren|anderes mal|kein interesse|nein danke|lass mal|vergiss es|bin raus|heute nicht)\b/i.test(text)) intents.add('abort');
  if (/\b(überlege noch|ich überlege|vielleicht|weiß noch nicht|weiss noch nicht|muss noch (schauen|gucken|überlegen)|mal sehen|mal schauen|ich melde mich)\b/.test(text)) intents.add('hesitation');
  return intents.size ? [...intents] : ['other'];
}

function hasSpecificTemporalWish(text: string): boolean {
  const t = normalize(text);
  return /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/.test(t)
    || /\b([01]?\d|2[0-3])\s*uhr\b/.test(t)
    || /\b(jetzt|gleich)\b/.test(t)
    || /\bin\s+\d{1,3}\s*(min|minuten?|minute|minutes?|std|stunden?|hours?)\b/.test(t);
}

function hasDayMention(text: string): boolean {
  return /\b(heute|morgen|today|tomorrow|später|later)\b/.test(normalize(text));
}

function hasDuration(text: string): boolean {
  const t = normalize(text).replace(
    /\bin\s+\d{1,3}\s*(min|minuten?|minute|minutes?|std|stunden?|hours?)\b/g,
    ' ',
  );
  return /\b(15|20|30|45|60|90)\s*(min|minuten?|minute|minutes?|std|stunde[n]?|hours?)\b/.test(t)
    || /\b(halbe|eine|1)\s+stunde\b/.test(t)
    || /\b(one|half)\s+hour\b/.test(t);
}

function isArrival(text: string): boolean {
  return /\b(bin da|angekommen|vor der tür|stehe davor|ich bin hier|bin unten|stehe unten)\b/.test(normalize(text));
}

function isAbort(text: string): boolean {
  const t = normalize(text);
  return /\b(doch nicht|kann nicht|schaffe es nicht|schaffe ich nicht|absagen|absage|stornieren|storno|anderes mal|kein interesse|nein danke|lass mal|vergiss es|bin raus|heute nicht|wird nichts)\b/.test(t);
}

function isHesitation(text: string): boolean {
  const t = normalize(text);
  return /\b(überlege noch|ich überlege|vielleicht|weiß noch nicht|weiss noch nicht|muss noch (schauen|gucken|überlegen)|mal sehen|mal schauen|ich melde mich|bin noch unsicher|noch unsicher)\b/.test(t);
}

function isStrongCommitment(text: string): boolean {
  const t = normalize(text);
  return /\b(ich komme|komme vorbei|ich will kommen|ich möchte kommen|passt mir|passt gut|bis gleich|bis später|fest einplanen|termin bestätigen|ja ich komme|ok ich komme|okay ich komme|ja.*weitergeben|yes.*i will come|i will come|i'm coming|im coming|see you soon)\b/.test(t);
}

function isAffirmative(text: string): boolean {
  return /^(ja|jap|jo|yes|ok|okay|passt|perfekt|super|gerne|gern)[.! ]*$/.test(normalize(text));
}

function previousPromptAskedForConfirmation(messages: StoredMessage[], latestLeadIndex: number): boolean {
  for (let i = latestLeadIndex - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || typeof message.text !== 'string') continue;
    if (message.sender === 'lead') break;
    const t = normalize(String(message.text || ''));
    if (/\b(fest|bestätig|weitergeben|einplanen|passt das|soll ich|termin so)\b/.test(t)) return true;
  }
  return false;
}

export function analyzeTrainingSignals(messages: StoredMessage[]): TrainingSignals {
  const leadMessages = messages
    .filter((message) => message.sender === 'lead' && typeof message.text === 'string')
    .map((message) => String(message.text || '').trim())
    .filter(Boolean);
  const latest = leadMessages.at(-1) || '';
  const joined = leadMessages.slice(-12).join(' \n ');
  const temporal = hasSpecificTemporalWish(joined);
  const dayMention = hasDayMention(joined);
  const duration = hasDuration(joined);

  const leadIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.sender === 'lead' && typeof message.text === 'string' && String(message.text || '').trim());
  const latestLeadIndex = leadIndexes.at(-1)?.index ?? -1;
  const latestAbort = [...leadIndexes].reverse().find(({ message }) => isAbort(String(message.text || '')));
  const latestStrongCommit = [...leadIndexes].reverse().find(({ message, index }) => {
    const text = String(message.text || '');
    return isStrongCommitment(text) || (isAffirmative(text) && previousPromptAskedForConfirmation(messages, index));
  });
  const commitmentNow = latestLeadIndex >= 0 && (
    isStrongCommitment(latest)
    || (isAffirmative(latest) && previousPromptAskedForConfirmation(messages, latestLeadIndex))
  );
  const abortNow = isAbort(latest);
  const latestAbortIndex = latestAbort?.index ?? -1;
  const latestCommitIndex = latestStrongCommit?.index ?? -1;
  const activeCommitment = latestCommitIndex >= 0 && latestCommitIndex > latestAbortIndex;

  return {
    intents: detectLeadIntents(latest),
    hasTemporalWish: temporal,
    hasDayMention: dayMention,
    hasDuration: duration,
    hasActiveCommitment: activeCommitment,
    commitmentNow,
    arrivalNow: isArrival(latest),
    abortNow,
    hesitationNow: isHesitation(latest),
    hasAbort: latestAbortIndex >= 0,
    nextMissing: temporal ? (duration ? (activeCommitment ? null : 'confirmation') : 'duration') : 'time',
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
    'Zeitwunsch plus Dauer allein reicht NICHT für HOT. Dafür braucht es zusätzlich eine klare aktive Zusage des Kontakts.',
    'Eine Frage wie „Kann ich kommen?“ oder „Ich könnte kommen“ ist noch keine verbindliche Zusage.',
    'Wenn Zeitwunsch und Dauer vorliegen, aber die Zusage fehlt, frage knapp nach Bestätigung.',
    'Wenn der Kontakt bereits angekommen ist oder unmittelbar vor Ort wartet, sofort hot=true und reply leer.',
    'Bei einer aktuellen Absage oder einem Abbruch nicht HOT setzen und nicht weiter drängen.',
    'Bei Unsicherheit wie „ich überlege noch“ oder „vielleicht“ nicht wiederholt auf Bestätigung drängen; freundlich offenlassen.',
    'Wenn nur ein Zeitwunsch fehlt, frage nach Tag/Uhrzeit. Wenn nur die Dauer fehlt, frage nach der gewünschten Dauer.',
    'Bei Ortsfragen dürfen Zimmer, Etage, Klingel oder Zugang nicht erfunden werden.',
    'Bei Medienfragen verspreche keine Datei, die nicht als Profilmedium hinterlegt ist.',
  ];
  if (signals.nextMissing === 'time') rules.push('Nächster fehlender Slot: Zeitwunsch.');
  if (signals.nextMissing === 'duration') rules.push('Nächster fehlender Slot: Dauer.');
  if (signals.nextMissing === 'confirmation') rules.push('Zeitwunsch und Dauer sind vorhanden; nächste Aktion ist eine klare Bestätigung/Zusage.');
  if (signals.nextMissing === null) rules.push('Zeitwunsch, Dauer und aktive Zusage sind vorhanden; jetzt an einen Menschen übergeben.');
  if (signals.abortNow) rules.push('Aktueller Zustand: Abbruch/Absage. Nicht weiter qualifizieren.');
  if (signals.hesitationNow) rules.push('Aktueller Zustand: unentschlossen. Kein Druck und keine erneute Bestätigungsfrage.');
  rules.push('Bestätigte Profildaten:');
  rules.push(...(facts.length ? facts.map((fact) => `- ${fact}`) : ['- Keine verwertbaren Preis-/Zeit-/Ortsdaten hinterlegt.']));
  return rules.join('\n');
}

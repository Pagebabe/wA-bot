import type { Conversation, Profile, StoredMessage } from './store.js';
import { qualifyLead, type LlmSettings } from './ai.js';
import { analyzeTrainingSignals } from './training-patterns.js';

export type SimulationScenario = {
  id: string;
  persona: 'cambodia' | 'kenya';
  turns: string[];
};

export type SimulationCaseResult = {
  id: string;
  persona: SimulationScenario['persona'];
  passed: boolean;
  hotAtTurn: number | null;
  eligibleAtTurn: number | null;
  falsePositive: boolean;
  error: string | null;
};

export type SimulationSummary = {
  total: number;
  passed: number;
  failed: number;
  falsePositives: number;
  errors: number;
  cases: SimulationCaseResult[];
};

export function buildSimulationScenarios(): SimulationScenario[] {
  const rows: Array<[string, string[]]> = [
    ['preis-heute', ['Hi, was kostet es?', 'Heute gegen 19:30', '30 Minuten']],
    ['direkt-komplett', ['Hallo, ich würde heute um 20:00 für 30 Minuten kommen.']],
    ['smalltalk-dann-termin', ['Hey, wie gehts?', 'Was kostet 60 Minuten?', 'Morgen 18:30 passt mir.']],
    ['ort-zuerst', ['Wo genau bist du?', 'Heute 21 Uhr', '30 Minuten']],
    ['bild-zuerst', ['Hast du ein aktuelles Bild?', 'Ich könnte heute um 20:15', '30 Minuten']],
    ['nur-heute', ['Hast du heute Zeit?', '19:00 Uhr wäre gut', '60 Minuten']],
    ['kurzfristig', ['Kann ich in 20 Minuten kommen?', '30 Minuten']],
    ['morgen-eine-stunde', ['Was kostet eine Stunde?', 'Morgen um 17:30.']],
    ['zeit-korrigiert', ['Heute 19:30', 'Doch lieber 20:10', '30 Minuten']],
    ['spaeter', ['Ich schaffe es heute später', '21:00 Uhr', '30 Minuten']],
    ['angekommen', ['Hi', 'Ich bin da.']],
    ['preis-und-zeit', ['Wie viel kostet 30 Minuten heute um 18:45?']],
    ['wann-frei', ['Wann hast du heute Zeit?', '20:30 wäre gut', '30 Minuten']],
    ['adresse-dann-termin', ['Schickst du mir die Adresse?', 'Morgen 19 Uhr', '60 Minuten']],
    ['knapp', ['20:00?', '30 min']],
    ['fehlerhaftes-deutsch', ['hallo hast du heute zeit', 'ich komme 19.40', 'halbe stunde']],
    ['englisch-gemischt', ['Hi, are you available today?', '20:00 today', '30 minutes']],
    ['preis-fragmentiert', ['Preis?', 'Heute', '19:15', '30 min']],
    ['erst-dauer', ['30 Minuten', 'Heute um 18:00']],
    ['erst-zeit', ['Morgen 20 Uhr', 'Eine Stunde']],
    ['ort-und-preis', ['Wo bist du und was kostet es?', 'Heute 21:15', '30 Minuten']],
    ['termin-verschiebung', ['Heute 18:30 für 30 Minuten', 'Kann ich doch 19:00 kommen?']],
    ['spaet-aber-konkret', ['Ich bin erst später frei', '22:00', '30 Minuten']],
    ['kurze-fragefolge', ['Hi', 'Preis', 'heute 20:30', '30 min']],
    ['morgen-frueh', ['Morgen 10:30', '60 Minuten']],
    ['sofort', ['Kann ich jetzt kommen?', '30 Minuten']],
    ['adresse-klingel', ['Welche Adresse und wo klingeln?', 'Heute 19:45', '30 Minuten']],
    ['bild-und-preis', ['Bild und Preis bitte', 'Morgen 18:00', '30 Minuten']],
    ['eine-stunde-heute', ['Heute Abend eine Stunde', '20:15']],
    ['sehr-kurz', ['19:30 heute, 30 Minuten']],
  ];
  return rows.map(([id, turns], index) => ({
    id,
    persona: index % 2 === 0 ? 'cambodia' : 'kenya',
    turns,
  }));
}

function msg(id: string, conversationId: string, sender: 'lead' | 'ai', text: string, step: number): StoredMessage {
  return {
    id,
    conversation_id: conversationId,
    direction: sender === 'lead' ? 'in' : 'out',
    sender,
    kind: 'text',
    text,
    created_at: new Date(Date.now() + step * 1000).toISOString(),
  };
}

export async function runTrainingSimulation(
  settings: LlmSettings,
  profile: Profile,
  onCase?: (row: SimulationCaseResult) => void,
): Promise<SimulationSummary> {
  const scenarios = buildSimulationScenarios();
  const results: SimulationCaseResult[] = [];

  for (const scenario of scenarios) {
    const conversationId = `simulation-${scenario.id}`;
    const conversation = {
      id: conversationId,
      profile_id: profile.id,
      wa_jid: `${scenario.id}@simulation.invalid`,
      contact_name: `Simulation ${scenario.persona}`,
      state: 'AI_ACTIVE',
      hot_score: null,
      hot_reason: null,
      ai_turns: 0,
      unread_count: 0,
      last_message_preview: '',
      last_message_at: new Date().toISOString(),
    } as Conversation;

    const messages: StoredMessage[] = [];
    let hotAtTurn: number | null = null;
    let eligibleAtTurn: number | null = null;
    let falsePositive = false;
    let error: string | null = null;

    for (let i = 0; i < scenario.turns.length; i += 1) {
      messages.push(msg(`${conversationId}-lead-${i}`, conversationId, 'lead', scenario.turns[i], messages.length));
      const signals = analyzeTrainingSignals(messages);
      const eligible = signals.arrivalNow || (signals.hasTemporalWish && signals.hasDuration);
      if (eligible && eligibleAtTurn === null) eligibleAtTurn = i + 1;

      try {
        const result = await qualifyLead(settings, profile, conversation, messages);
        if (result.hot) {
          hotAtTurn = i + 1;
          if (!eligible) falsePositive = true;
          break;
        }
        if (result.reply) {
          messages.push(msg(`${conversationId}-ai-${i}`, conversationId, 'ai', result.reply, messages.length));
        }
      } catch (err) {
        error = err instanceof Error ? err.message.slice(0, 240) : 'unknown simulation error';
        break;
      }
    }

    const passed = !error && !falsePositive && hotAtTurn !== null && eligibleAtTurn !== null && hotAtTurn >= eligibleAtTurn;
    const row = { id: scenario.id, persona: scenario.persona, passed, hotAtTurn, eligibleAtTurn, falsePositive, error };
    results.push(row);
    onCase?.(row);
  }

  return {
    total: results.length,
    passed: results.filter((row) => row.passed).length,
    failed: results.filter((row) => !row.passed).length,
    falsePositives: results.filter((row) => row.falsePositive).length,
    errors: results.filter((row) => row.error).length,
    cases: results,
  };
}

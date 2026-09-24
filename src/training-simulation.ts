import type { Conversation, Profile, StoredMessage } from './store.js';
import { qualifyLead, type LlmSettings } from './ai.js';
import { analyzeTrainingSignals } from './training-patterns.js';

export type SimulationOutcome = 'arrived' | 'aborted' | 'stalled';

export type SimulationScenario = {
  id: string;
  persona: 'cambodia' | 'kenya';
  turns: string[];
  outcome: SimulationOutcome;
};

export type SimulationTranscriptMessage = {
  sender: 'lead' | 'ai' | 'human';
  text: string;
};

export type SimulationCaseResult = {
  id: string;
  persona: SimulationScenario['persona'];
  expectedOutcome: SimulationOutcome;
  actualOutcome: SimulationOutcome | 'hot-only' | 'error';
  passed: boolean;
  hotAtTurn: number | null;
  falsePositive: boolean;
  moderatorApprovals: number;
  error: string | null;
  transcript: SimulationTranscriptMessage[];
};

export type SimulationSummary = {
  total: number;
  passed: number;
  failed: number;
  falsePositives: number;
  errors: number;
  arrived: number;
  aborted: number;
  stalled: number;
  moderatorApprovals: number;
  cases: SimulationCaseResult[];
};

export function buildSimulationScenarios(): SimulationScenario[] {
  const rows: Array<[string, SimulationOutcome, string[]]> = [
    ['preis-heute-confirm', 'arrived', ['Hi, was kostet es?', 'Heute gegen 19:30', '30 Minuten', 'Ja, ich komme.']],
    ['direkt-noch-fragend', 'arrived', ['Hallo, könnte ich heute um 20:00 für 30 Minuten kommen?', 'Ja, passt mir.']],
    ['smalltalk-dann-termin', 'arrived', ['Hey, wie gehts?', 'Was kostet 60 Minuten?', 'Morgen 18:30 passt', 'Ja ich komme.']],
    ['ort-zuerst', 'arrived', ['Wo genau bist du?', 'Heute 21 Uhr', '30 Minuten', 'Okay, ich komme vorbei.']],
    ['bild-zuerst', 'arrived', ['Hast du ein aktuelles Bild?', 'Ich könnte heute um 20:15', '30 Minuten', 'Passt gut, bis gleich.']],
    ['nur-heute', 'arrived', ['Hast du heute Zeit?', '19:00 Uhr wäre gut', '60 Minuten', 'Ja, passt mir.']],
    ['kurzfristig', 'arrived', ['Kann ich in 20 Minuten kommen?', '30 Minuten', 'Ja ich komme.']],
    ['morgen-eine-stunde', 'arrived', ['Was kostet eine Stunde?', 'Morgen um 17:30.', 'Ja, bitte so weitergeben.']],
    ['zeit-korrigiert', 'arrived', ['Heute 19:30', '30 Minuten', 'Doch lieber 20:10', 'Ja, ich komme.']],
    ['adresse-dann-termin', 'arrived', ['Schickst du mir die Adresse?', 'Morgen 19 Uhr', '60 Minuten', 'Passt, ich komme vorbei.']],
    ['englisch-gemischt', 'arrived', ['Hi, are you available today?', '20:00 today', '30 minutes', 'Yes, I will come.']],
    ['sehr-kurz', 'arrived', ['19:30 heute, 30 Minuten', 'Ja ich komme.']],

    ['preis-abbruch', 'aborted', ['Preis?', 'Heute 20 Uhr', '30 Minuten', 'Doch nicht, sorry.']],
    ['zeit-abbruch', 'aborted', ['Heute 19:00?', '60 Minuten', 'Schaffe ich nicht.']],
    ['bild-abbruch', 'aborted', ['Hast du ein Bild?', 'Nein danke, passt doch nicht.']],
    ['ort-abbruch', 'aborted', ['Wo bist du?', 'Anderes Mal.']],
    ['spaeter-abbruch', 'aborted', ['Ich könnte später', '21:30', '30 Minuten', 'Wird nichts heute.']],
    ['reschedule-abbruch', 'aborted', ['Heute 18:30', '30 Minuten', 'Kann ich doch 19:00?', 'Doch nicht.']],
    ['dauer-abbruch', 'aborted', ['30 Minuten', 'Heute 22:00', 'Nein danke.']],
    ['nach-bedenkzeit-absage', 'aborted', ['Heute 20 Uhr', '60 Minuten', 'Ich überlege noch.', 'Sorry, kann doch nicht.']],

    ['nur-preis-stall', 'stalled', ['Was kostet 30 Minuten?']],
    ['nur-bild-stall', 'stalled', ['Hast du ein Foto?']],
    ['nur-ort-stall', 'stalled', ['Wo bist du genau?']],
    ['zeit-ohne-dauer-stall', 'stalled', ['Heute 20:30 wäre gut']],
    ['dauer-ohne-zeit-stall', 'stalled', ['30 Minuten bitte']],
    ['zeit-dauer-keine-zusage', 'stalled', ['Heute 20:00', '30 Minuten']],
    ['frage-kann-ich-kommen', 'stalled', ['Kann ich heute um 21:00 für 30 Minuten kommen?']],
    ['vielleicht-stall', 'stalled', ['Vielleicht heute später', '30 Minuten']],
    ['unentschlossen-stall', 'stalled', ['Was kostet es?', 'Vielleicht morgen']],
    ['termin-ohne-bestaetigung', 'stalled', ['Morgen 18 Uhr', '60 Minuten', 'Ich überlege noch.']],
  ];

  return rows.map(([id, outcome, turns], index) => ({
    id,
    outcome,
    persona: index % 2 === 0 ? 'cambodia' : 'kenya',
    turns,
  }));
}

function msg(
  id: string,
  conversationId: string,
  sender: 'lead' | 'ai' | 'human',
  text: string,
  step: number,
): StoredMessage {
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

async function simulationPace(signals: ReturnType<typeof analyzeTrainingSignals>): Promise<void> {
  const needsExternalLlm =
    !signals.abortNow
    && !signals.arrivalNow
    && !signals.hasTemporalWish
    && !signals.hasDuration;
  if (needsExternalLlm) await new Promise((resolve) => setTimeout(resolve, 6500));
}

function appendPostHotArrival(
  messages: StoredMessage[],
  conversationId: string,
  scenario: SimulationScenario,
): void {
  if (scenario.outcome !== 'arrived') return;
  messages.push(msg(
    `${conversationId}-human-handoff`,
    conversationId,
    'human',
    'Perfekt, ist notiert. Bis gleich 😊',
    messages.length,
  ));
  messages.push(msg(
    `${conversationId}-lead-arrival`,
    conversationId,
    'lead',
    scenario.persona === 'cambodia' ? 'Bin da.' : 'I am here now.',
    messages.length,
  ));
}

export async function runTrainingSimulation(
  settings: LlmSettings,
  profile: Profile,
  onCase?: (row: SimulationCaseResult) => void,
  limit = 30,
): Promise<SimulationSummary> {
  const normalizedLimit = Math.max(1, Math.min(30, Math.floor(Number(limit) || 30)));
  const scenarios = buildSimulationScenarios().slice(0, normalizedLimit);
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
    let falsePositive = false;
    let moderatorApprovals = 0;
    let error: string | null = null;
    let actualOutcome: SimulationCaseResult['actualOutcome'] = 'stalled';

    for (let i = 0; i < scenario.turns.length; i += 1) {
      messages.push(msg(`${conversationId}-lead-${i}`, conversationId, 'lead', scenario.turns[i], messages.length));
      const signals = analyzeTrainingSignals(messages);

      try {
        await simulationPace(signals);
        const result = await qualifyLead(settings, profile, conversation, messages);

        // Synthetic training mode: every candidate passes through the same moderator gate,
        // then is auto-approved here only inside the simulator. No WhatsApp send occurs.
        moderatorApprovals += 1;

        if (result.hot) {
          hotAtTurn = i + 1;
          if (scenario.outcome !== 'arrived') falsePositive = true;
          actualOutcome = 'hot-only';
          appendPostHotArrival(messages, conversationId, scenario);
          if (scenario.outcome === 'arrived') actualOutcome = 'arrived';
          break;
        }

        if (result.reply) {
          messages.push(msg(`${conversationId}-ai-${i}`, conversationId, 'ai', result.reply, messages.length));
        }

        if (signals.abortNow) {
          actualOutcome = 'aborted';
          break;
        }
      } catch (err) {
        error = err instanceof Error ? err.message.slice(0, 240) : 'unknown simulation error';
        actualOutcome = 'error';
        break;
      }
    }

    if (!error && scenario.outcome === 'stalled' && hotAtTurn === null) actualOutcome = 'stalled';
    if (!error && scenario.outcome === 'aborted' && actualOutcome !== 'aborted' && hotAtTurn === null) {
      const finalSignals = analyzeTrainingSignals(messages);
      if (finalSignals.abortNow) actualOutcome = 'aborted';
    }

    const passed = !error && !falsePositive && actualOutcome === scenario.outcome;
    const transcript = messages
      .filter((message) => ['lead', 'ai', 'human'].includes(message.sender) && typeof message.text === 'string')
      .map((message) => ({
        sender: message.sender as 'lead' | 'ai' | 'human',
        text: String(message.text || ''),
      }));

    const row: SimulationCaseResult = {
      id: scenario.id,
      persona: scenario.persona,
      expectedOutcome: scenario.outcome,
      actualOutcome,
      passed,
      hotAtTurn,
      falsePositive,
      moderatorApprovals,
      error,
      transcript,
    };
    results.push(row);
    onCase?.(row);
  }

  return {
    total: results.length,
    passed: results.filter((row) => row.passed).length,
    failed: results.filter((row) => !row.passed).length,
    falsePositives: results.filter((row) => row.falsePositive).length,
    errors: results.filter((row) => row.error).length,
    arrived: results.filter((row) => row.actualOutcome === 'arrived').length,
    aborted: results.filter((row) => row.actualOutcome === 'aborted').length,
    stalled: results.filter((row) => row.actualOutcome === 'stalled').length,
    moderatorApprovals: results.reduce((sum, row) => sum + row.moderatorApprovals, 0),
    cases: results,
  };
}

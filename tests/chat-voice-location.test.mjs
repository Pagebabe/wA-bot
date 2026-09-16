import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  normalizePromptIdentity,
  SAVED_REPLIES,
} from "../dist/chat-policy.js";
import { synthesizeVoice } from "../dist/ai.js";
import { inboundAudio, inboundText } from "../dist/whatsapp-message.js";
import { autocompletePlaces, getPlaceDetails } from "../dist/places.js";

function profile(name) {
  return {
    id: name,
    name,
    status: "online",
    bot_enabled: true,
    hot_threshold: 0.8,
    max_ai_turns: 8,
    handoff_behavior: "stop",
    voice_mode: "off",
    system_prompt: "legacy must be ignored",
    qualification_prompt: "legacy must be ignored",
    response_style: "legacy",
    location: "Köln",
    desired_location: "Innenstadt",
    price_text: "80 €",
    hours_text: "10–22",
  };
}

test("all profiles share one central prompt and only identity varies", () => {
  const a = buildSystemPrompt(profile("Anna"));
  const changed = profile("Mia");
  changed.location = "Berlin";
  changed.desired_location = "Charlottenburg";
  changed.price_text = "999 €";
  changed.hours_text = "nachts";
  changed.hot_threshold = 0.1;
  const b = buildSystemPrompt(changed);
  assert.equal(
    normalizePromptIdentity(a, "Anna"),
    normalizePromptIdentity(b, "Mia"),
  );
  assert.doesNotMatch(a, /legacy must be ignored/);
  assert.ok(SAVED_REPLIES.length >= 10);
});

test("wrapped WhatsApp voice and text messages are unwrapped", () => {
  const wrappedVoice = {
    ephemeralMessage: {
      message: {
        viewOnceMessageV2: {
          message: { audioMessage: { mimetype: "audio/ogg", ptt: true } },
        },
      },
    },
  };
  assert.equal(inboundAudio(wrappedVoice).ptt, true);
  assert.equal(
    inboundText({
      editedMessage: { message: { extendedTextMessage: { text: "Hallo" } } },
    }),
    "Hallo",
  );
});

test("ElevenLabs voice requests WhatsApp-compatible Opus 48 kHz with Eleven v3 defaults", async () => {
  const original = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url: String(url), options };
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  };
  try {
    const result = await synthesizeVoice(
      { tts_api_key: "key", tts_voice_id: "voice" },
      "Hallo",
    );
    assert.match(seen.url, /output_format=opus_48000_64/);
    const body = JSON.parse(seen.options.body);
    assert.equal(body.model_id, "eleven_v3");
    assert.deepEqual(body.voice_settings, { stability: 0.5 });
    assert.equal(result.mime, "audio/ogg; codecs=opus");
    assert.equal(result.buffer.length, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test("ElevenLabs Flash fallback keeps its supported tuning fields", async () => {
  const original = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(new Uint8Array([1]), { status: 200 });
  };
  try {
    await synthesizeVoice(
      { tts_api_key: "key", tts_voice_id: "voice", tts_model: "eleven_flash_v2_5" },
      "Hallo",
    );
    assert.equal(body.model_id, "eleven_flash_v2_5");
    assert.equal(body.voice_settings.similarity_boost, 0.78);
    assert.equal(body.voice_settings.use_speaker_boost, true);
  } finally {
    globalThis.fetch = original;
  }
});

test("OpenAI-compatible voice requests Opus with the documented response field", async () => {
  const original = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(new Uint8Array([1]), { status: 200 });
  };
  try {
    await synthesizeVoice(
      { llm_api_key_encrypted: "key", llm_base_url: "https://api.openai.com" },
      "Hallo",
    );
    assert.equal(body.response_format, "opus");
    assert.equal(body.format, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("Google Places returns selected address with verified coordinates", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes("places:autocomplete")
      ? new Response(
          JSON.stringify({
            suggestions: [
              {
                placePrediction: {
                  placeId: "p1",
                  text: { text: "Teststraße 1, Köln" },
                },
              },
            ],
          }),
          { status: 200 },
        )
      : new Response(
          JSON.stringify({
            id: "p1",
            displayName: { text: "Studio" },
            formattedAddress: "Teststraße 1, Köln",
            location: { latitude: 50.9, longitude: 7 },
          }),
          { status: 200 },
        );
  try {
    assert.deepEqual(await autocompletePlaces("Teststraße", "key"), [
      { placeId: "p1", text: "Teststraße 1, Köln" },
    ]);
    assert.deepEqual(await getPlaceDetails("p1", "key"), {
      placeId: "p1",
      label: "Studio",
      address: "Teststraße 1, Köln",
      latitude: 50.9,
      longitude: 7,
    });
  } finally {
    globalThis.fetch = original;
  }
});

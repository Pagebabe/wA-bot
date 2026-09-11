# Canonical Project Plan — wA-bot Beta

## 1. Product goal

A browser-based operations cockpit for multiple WhatsApp numbers where inbound leads are automatically pre-qualified by AI until they become HOT, then immediately handed to a human operator with audible/visual alarm and full chat history.

Beta is intentionally **not** an autonomous booking system. Appointment booking stays human-owned in v1, but the architecture must leave that extension open.

## 2. Scope agreed from product interview

### In scope for beta
- Multiple WhatsApp numbers / profiles in one browser application.
- Add/remove/reconnect profiles without code changes.
- Per-profile business data: name, number/session, media, location, prices, availability/time information, and arbitrary profile notes.
- Per-profile bot configuration and reusable presets.
- Configurable LLM provider/model per profile or preset.
- Configurable prompt, tone, qualification logic, HOT rules, handoff behavior, and voice behavior.
- Unified inbox with three primary operational views: AI-active, HOT, human-active.
- Immediate HOT alarm until human accepts takeover.
- Full chat transcript visible at takeover.
- Optional AI-generated summary is secondary, not required to operate.
- Incoming text and voice messages.
- Speech-to-text adapter for incoming voice.
- Text-to-speech adapter for outgoing voice.
- Human can type text and optionally send generated voice.
- AI can optionally send generated voice when enabled by profile policy.
- Audit trail for state transitions and operator takeover.
- Account/session health and reconnect status visible.
- Docker-friendly local development and Railway deployment.

### Explicitly out of beta
- Fully autonomous appointment booking.
- Multi-operator assignment logic beyond one active human operator.
- Advanced workforce scheduling.
- Billing/subscription system.
- Public multi-tenant SaaS administration.

## 3. Architectural audit / corrections

### A. Do not put Chatwoot in the critical path for beta
Earlier discussion considered Chatwoot. That would add a second UI, second permissions model, and duplicated inbox state. Because the intended product already requires a custom browser cockpit and fine-grained per-profile bot controls, beta should own the inbox directly.

### B. Keep Evolution API as a replaceable transport adapter
Using an unofficial WhatsApp Web transport is acceptable for a controlled beta, but it is the highest operational risk: session breakage, policy enforcement, reconnect behavior, and upstream changes can interrupt service. The application therefore must not couple business logic to Evolution-specific payloads. All inbound/outbound events pass through an internal WhatsApp adapter interface.

### C. Do not promise a specific Evolution version before deployment validation
The repo should pin the actual tested image/tag only after the first reproducible integration test. Never hardcode an unverified version from conversation memory.

### D. One web application first, microservices only where justified
Start with a modular monolith for app/API/orchestration, plus infrastructure services (Postgres, Redis, WhatsApp transport). This is easier to test and operate than splitting bot, inbox, profile, and API into premature microservices.

### E. Redis is useful but not the system of record
Postgres owns durable state. Redis is for pub/sub, distributed locks, ephemeral queues, reconnect coordination, and alarm fan-out.

### F. Voice is an adapter, not a core dependency
Beta works without TTS. Voice provider outages must degrade to text, never block the lead pipeline.

## 4. Core state machine

Primary conversation states:

- `NEW` — conversation first observed.
- `AI_ACTIVE` — AI currently owns pre-qualification.
- `HOT` — qualified and awaiting human takeover; alarm active.
- `HUMAN_ACTIVE` — operator owns conversation.
- `CLOSED` — conversation completed/archived.

Operational exception flags:
- `PAUSED`
- `WA_OFFLINE`
- `AI_ERROR`
- `VOICE_ERROR`

Rules:
- `HOT` must be idempotent; duplicate model/webhook events cannot create duplicate alarms.
- Human takeover creates a durable event before stopping AI sends.
- AI cannot resume after takeover unless profile policy explicitly allows resume/manual-return.
- Every outbound message records owner: `AI`, `HUMAN`, or `SYSTEM`.

## 5. Data model

### users
- id
- role (`admin`, `operator`)
- name
- auth identity
- created_at

### profiles
- id
- name
- active
- location
- prices_json
- availability_json
- notes
- bot_preset_id
- whatsapp_connection_id
- created_at / updated_at

### profile_media
- id
- profile_id
- type
- storage_url
- metadata_json

### whatsapp_connections
- id
- profile_id
- provider
- external_instance_id
- status
- phone_number
- last_seen_at
- reconnect_required
- provider_metadata_json

### bot_presets
- id
- name
- system_prompt
- model_provider
- model_name
- temperature/settings_json
- qualification_policy_json
- handoff_policy_json
- voice_policy_json
- disclosure_policy_json
- created_at / updated_at

### conversations
- id
- profile_id
- external_chat_id
- contact_phone
- contact_name
- state
- state_version
- hot_reason_json
- current_owner
- last_message_at
- created_at / updated_at

### messages
- id
- conversation_id
- external_message_id
- direction
- owner
- kind (`text`, `voice`, `image`, `other`)
- body
- media_url
- transcription
- provider_payload_json
- sent_at / received_at

### conversation_events
- id
- conversation_id
- event_type
- actor_type
- actor_id
- payload_json
- created_at

### ai_runs
- id
- conversation_id
- provider
- model
- prompt_version
- input_snapshot_json
- output_json
- decision_json
- latency_ms
- error
- created_at

## 6. Internal adapter contracts

### WhatsAppAdapter
- connectProfile(profile)
- disconnectProfile(profile)
- getConnectionStatus(profile)
- sendText(conversation, text)
- sendVoice(conversation, audio)
- normalizeInboundEvent(providerPayload)

### LlmAdapter
- generateReply(context, preset)
- evaluateQualification(context, preset)

Return structured decision:
```json
{
  "reply": "...",
  "status": "CONTINUE|HOT|PAUSE",
  "reason": "...",
  "confidence": 0.0,
  "signals": []
}
```

### SpeechToTextAdapter
- transcribe(audio)

### TextToSpeechAdapter
- synthesize(text, voiceConfig)

## 7. HOT behavior

When a decision becomes HOT:
1. Write `HOT` transition atomically.
2. Stop autonomous AI sending for the conversation.
3. Emit real-time HOT event.
4. UI moves card to HOT queue.
5. Browser alarm loops until acknowledged/taken over.
6. Operator clicks `Übernehmen`.
7. Durable takeover event is written.
8. State moves to `HUMAN_ACTIVE`.
9. Alarm stops for that conversation.

Browser notifications should be used where permission exists; in-app audio/visual alarm remains required because browser notification permission may be denied.

## 8. Profile configuration model

Global defaults + per-profile override.

Editable groups:
- Identity/business data.
- Model/provider.
- Prompt/instructions.
- Tone and brevity.
- Qualification targets.
- HOT thresholds/signals.
- Forbidden claims/topics.
- Max autonomous turns/time.
- AI behavior after human takeover.
- Text/voice mode.
- Voice provider/voice.
- AI disclosure text/policy.
- Failure fallback behavior.

Presets can be duplicated, then edited per profile.

## 9. Compliance and safety requirements

Beta must include:
- Authentication; app is not a public anonymous inbox.
- Secrets only in environment variables/secret store.
- Audit events for operator and AI actions.
- Configurable retention/deletion path for conversations and media.
- Ability to disable AI globally and per profile.
- Clear status when WhatsApp session is disconnected.
- No voice cloning/impersonation of a real person without rights/authorization.
- AI interaction disclosure capability; exact production wording and legal applicability must be reviewed for deployment jurisdiction and use case.

## 10. Reliability requirements

- Idempotency on inbound provider message IDs.
- Database transactions around state changes.
- Retry with bounded exponential backoff for external sends.
- Dead-letter/error state for permanently failed events.
- Health endpoints for app and transport.
- Reconnect workflow for WhatsApp sessions.
- No message send if conversation is already human-owned unless owner is HUMAN.
- Structured logging with conversation/profile correlation IDs.

## 11. UI beta

### Main cockpit
Left sidebar:
- Profiles / numbers with online/offline state.
- Global settings.

Main content:
- `KI-Chats`
- `HOT 🔥`
- `Übernommen`

Conversation pane:
- Header with profile + contact + connection health.
- Full chronological transcript.
- Composer for human messages.
- Voice-generation button when enabled.
- Clear owner/state indicator.

HOT card:
- Profile
- Contact
- Last message
- HOT reason/signals
- `Übernehmen` primary action

Profile editor:
- Profile details
- WhatsApp QR/reconnect
- Bot preset
- Advanced bot settings
- Voice settings
- Test playground

### Test playground
Mandatory before real beta traffic:
- Paste/simulate incoming messages.
- Run selected preset/model.
- Show proposed reply + structured HOT decision.
- No real WhatsApp send unless explicitly switched to live mode.

## 12. Delivery gates

### G0 — Repository baseline
- Canonical docs committed.
- App skeleton.
- Environment example.
- Dockerfile.
- CI/typecheck/tests baseline.

### G1 — Core app online
- Railway service builds.
- Health endpoint returns healthy.
- Postgres connectivity proven.
- Basic authenticated shell UI.

### G2 — One WhatsApp profile E2E
- QR/session connection.
- Receive real inbound message.
- Persist message.
- Send manual reply from cockpit.

### G3 — Multi-profile
- At least two independent sessions.
- Correct profile routing.
- Reconnect tested.

### G4 — AI pre-qualification
- Preset/editor.
- LLM adapter.
- Deterministic schema validation.
- Simulation tests.
- AI_ACTIVE real chat.

### G5 — HOT handoff
- HOT decision.
- Alarm.
- Operator takeover.
- AI stops.
- Race/duplicate-event tests.

### G6 — Voice
- Inbound voice transcription.
- Human generated voice.
- Optional AI generated voice.
- Text fallback.

### G7 — Beta hardening
- Failure injection.
- Session reconnect.
- retention controls.
- audit log.
- backup/restore check.
- acceptance checklist.

## 13. Beta acceptance criteria

Beta is accepted only when:
- Multiple profiles can be configured without code changes.
- A profile can be connected/reconnected from UI.
- Inbound WhatsApp text appears in correct conversation.
- AI can pre-qualify using a selected preset/model.
- Profile settings can change HOT behavior without deployment.
- HOT alarm is immediate and persistent until takeover.
- Human takeover prevents further autonomous messages.
- Operator can reply from browser.
- Incoming voice can be transcribed.
- Generated voice can be sent when configured.
- External-provider failures visibly degrade instead of silently losing chats.
- Critical state transition tests pass.

## 14. Active line

G0 -> G1 -> G2 -> G3 -> G4 -> G5 -> G6 -> G7

Never skip a gate merely because later UI work looks easier. The first real technical risk to retire is G2: one real WhatsApp session end-to-end.

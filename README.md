# wA-bot

Multi-number WhatsApp lead qualification cockpit.

## Beta goal

Inbound WhatsApp chats are connected per profile, automatically pre-qualified by a configurable AI, escalated to a human as a HOT lead with an immediate alarm, and handed off without losing conversation context.

## Architecture principles

- WhatsApp transport is an adapter: start with Evolution API / WhatsApp Web, keep a migration path to the official WhatsApp Cloud API.
- Custom inbox instead of Chatwoot in the critical path.
- One profile = phone/session + business data + bot preset + qualification rules + voice settings.
- LLM, speech-to-text, and text-to-speech are provider adapters, not hard-wired.
- Human handoff is a first-class state transition; the bot must not continue after handoff unless the profile policy explicitly allows it.
- All external services are container/deployment-portable so Railway is a host, not a lock-in.

## Beta states

`NEW -> AI_ACTIVE -> HOT -> HUMAN_ACTIVE -> CLOSED`

Additional failure states are tracked separately (`PAUSED`, `WA_OFFLINE`, `AI_ERROR`).

## Planned services

1. `web` — browser UI + API + webhook receiver + bot orchestration.
2. `evolution` — WhatsApp transport for beta.
3. `postgres` — application and message state.
4. `redis` — event fan-out, locks, queues, reconnect coordination.

## Important beta guardrails

- The unofficial WhatsApp Web route can break or be restricted by WhatsApp; account health and reconnect status must therefore be visible in the UI.
- AI-to-user communication must support an AI-disclosure notice; in the EU this is a compliance requirement for many chatbot interactions.
- Voice output may be natural-sounding but must not impersonate a real person without authorization.
- Secrets never belong in the repository.

## Delivery order

1. Architecture + data model + deployment skeleton.
2. Multi-session WhatsApp connection and QR onboarding.
3. Unified inbox and profile management.
4. AI pre-qualification engine and HOT detection rules.
5. HOT alarm + human takeover.
6. Voice input/output adapters.
7. Reliability, reconnect, retention, audit log, and beta acceptance tests.

See `docs/PROJECT_PLAN.md` for the canonical build plan.

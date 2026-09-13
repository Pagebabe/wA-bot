# Evolution API migration

## Goal

Move WhatsApp transport out of the wA-bot business core without changing the lead pipeline, HOT handoff, profile configuration, audit logic or browser inbox.

The application now has a provider adapter. `WHATSAPP_PROVIDER=baileys` keeps the existing direct Baileys transport. `WHATSAPP_PROVIDER=evolution` routes connection lifecycle, inbound webhooks and outbound messages through Evolution API.

## Why this is safer operationally

wA-bot should own CRM and automation state, not hundreds of WhatsApp Web sockets. Evolution API centralizes instance lifecycle, QR pairing, reconnection and provider-specific behavior behind a REST/webhook boundary. The adapter is deliberately narrow so a later move from Evolution/Baileys to the official WhatsApp Cloud API does not require rewriting the lead engine.

Evolution API itself supports both Baileys-based WhatsApp Web and the official WhatsApp Cloud API. Using Evolution in Baileys mode does not remove WhatsApp policy or account-risk considerations; it only improves transport isolation and operations.

## Configuration

Keep the current transport until the Evolution service is independently healthy:

```env
WHATSAPP_PROVIDER=baileys
```

For Evolution mode configure all of the following:

```env
WHATSAPP_PROVIDER=evolution
EVOLUTION_BASE_URL=https://evolution.example.com
EVOLUTION_API_KEY=<secret>
EVOLUTION_WEBHOOK_SECRET=<different-secret>
PUBLIC_BASE_URL=https://web.example.com
```

`EVOLUTION_WEBHOOK_SECRET` is sent by Evolution as `x-wa-bot-secret` and is checked with a constant-time comparison before webhook data is processed.

## Instance mapping

One wA-bot profile maps deterministically to one Evolution instance:

`wab_<profile-id>`

No new database mapping table is required for the first migration stage. If instance names later become user-editable, introduce a durable `whatsapp_connections` table rather than overloading the profile table.

## Supported adapter operations

- connect / QR pairing
- connection status
- linked account identity cache
- inbound text webhook normalization
- inbound voice transcription when Evolution supplies webhook base64
- outbound text
- outbound HTTPS image
- outbound native location
- outbound voice audio
- logout/unlink
- startup restore/status refresh

The existing direct Baileys provider remains available as rollback.

## Webhook reliability guard

Evolution deployments have had reports of per-instance webhook configuration becoming empty after a provider/container restart. To avoid a silent inbound outage, wA-bot verifies the expected webhook configuration periodically and reapplies it only when it has drifted. The watchdog interval is five minutes; with 200 instances that is about 0.67 status checks per second on average.

Expected Evolution events:

- `MESSAGES_UPSERT`
- `CONNECTION_UPDATE`
- `QRCODE_UPDATED`

The webhook uses one URL rather than per-event URLs.

## Rollout order

1. Deploy code with `WHATSAPP_PROVIDER=baileys` and confirm the existing account still works.
2. Deploy Evolution API as a separate service with its own persistent database/Redis according to the tested Evolution release.
3. Configure the four Evolution variables plus `PUBLIC_BASE_URL` in wA-bot.
4. Switch one non-critical profile to Evolution in a staging/controlled environment and pair it by QR.
5. Run live E2E: inbound text -> persistence -> AI -> HOT -> human takeover -> text/image/location send.
6. Test provider restart and verify webhook reconciliation restores inbound delivery.
7. Test unlink/reconnect.
8. Only then migrate additional profiles in batches.
9. Keep direct Baileys rollback until several days of stable operation have been observed.

## Scale notes

Do not create 100 or 200 sessions in one burst. Scale the transport progressively and measure CPU, memory, reconnect behavior, webhook latency and message error rate. Redis/Postgres persistence and transport health should be monitored independently from wA-bot's application database.

Do not add proxy rotation, fake activity, artificial account warm-up or any logic intended to evade WhatsApp enforcement. Transport scaling and policy compliance are separate problems.

## Current activation gate

The adapter can be merged and deployed safely while the production provider remains `baileys`. Activating `evolution` requires a reachable Evolution service, API key, webhook secret and public callback URL. Those are deployment secrets/infrastructure, not repository defaults.

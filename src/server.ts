import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
});

const env = envSchema.parse(process.env);

app.get('/health', async () => ({
  ok: true,
  service: 'wa-bot',
  version: '0.1.0',
  env: env.NODE_ENV,
}));

app.get('/api/status', async () => ({
  product: 'wA-bot',
  gate: 'G0',
  nextGate: 'G1',
  components: {
    web: 'online',
    postgres: env.DATABASE_URL ? 'configured' : 'not-configured',
    redis: env.REDIS_URL ? 'configured' : 'not-configured',
    whatsapp: 'not-configured',
    llm: 'not-configured',
    voice: 'not-configured',
  },
}));

app.get('/', async (_request, reply) => {
  reply.type('text/html').send(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>wA-bot Beta</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#0b1014;color:#eef3f5}.wrap{max-width:1100px;margin:0 auto;padding:28px}.top{display:flex;justify-content:space-between;align-items:center}.badge{background:#163221;border:1px solid #2c6b46;padding:7px 10px;border-radius:999px}.grid{display:grid;grid-template-columns:220px 1fr;gap:18px;margin-top:24px}.panel{background:#121a20;border:1px solid #27323a;border-radius:14px;padding:16px}.profile{padding:12px;border-radius:10px;background:#172229;margin:8px 0}.cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}.col{min-height:360px}.hot{border-color:#7d2f2f}.muted{color:#97a6af}.item{padding:12px;background:#182128;border-radius:10px;margin-top:10px}.fire{font-size:18px}@media(max-width:800px){.grid,.cols{grid-template-columns:1fr}}
</style>
</head>
<body><div class="wrap">
<div class="top"><div><h1>wA-bot</h1><div class="muted">Multi-WhatsApp KI-Vorqualifizierung</div></div><div class="badge">G0 · Grundsystem</div></div>
<div class="grid"><aside class="panel"><b>Profile</b><div class="profile">Profil A · offline</div><div class="profile">Profil B · offline</div><div class="muted">+ Profil hinzufügen</div></aside>
<main class="cols"><section class="panel col"><b>KI-Chats</b><div class="item muted">Noch keine Chats</div></section><section class="panel col hot"><b class="fire">HOT 🔥</b><div class="item muted">Alarm-Warteschlange</div></section><section class="panel col"><b>Übernommen</b><div class="item muted">Menschliche Chats</div></section></main></div>
</div></body></html>`);
});

await app.listen({ port: env.PORT, host: '0.0.0.0' });

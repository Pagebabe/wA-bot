import { readFileSync, writeFileSync } from 'node:fs';

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`prepare-evolution-provider: pattern missing: ${label}`);
  return source.replace(before, after);
}

const path = 'src/server.ts';
let source = readFileSync(path, 'utf8');

source = replaceRequired(
  source,
  "  unlinkWhatsApp,\n} from './whatsapp.js';",
  "  unlinkWhatsApp,\n  handleEvolutionWebhook,\n  isEvolutionWebhookAuthorized,\n  whatsappProviderName,\n} from './whatsapp-provider.js';",
  'provider import',
);

source = replaceRequired(
  source,
  "  if (request.url === '/health') return;",
  "  if (request.url === '/health' || request.url === '/api/evolution/webhook') return;",
  'webhook auth exemption',
);

source = replaceRequired(
  source,
  "app.get('/health', async () => ({ ok: true, service: 'wa-bot', version: '0.4.0' }));",
  "app.post('/api/evolution/webhook', async (request, reply) => {\n  const secret = request.headers['x-wa-bot-secret'];\n  if (!isEvolutionWebhookAuthorized(secret)) return reply.code(401).send({ error: 'Ungültiger Webhook-Schlüssel' });\n  await handleEvolutionWebhook(request.body);\n  return { ok: true };\n});\n\napp.get('/health', async () => ({ ok: true, service: 'wa-bot', version: '0.4.0', whatsappProvider: whatsappProviderName() }));",
  'evolution webhook route',
);

writeFileSync(path, source);
console.log('prepare-evolution-provider: provider adapter and authenticated Evolution webhook wired');

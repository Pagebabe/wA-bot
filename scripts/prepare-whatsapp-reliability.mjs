import { readFileSync, writeFileSync } from 'node:fs';

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`prepare-whatsapp-reliability: pattern missing: ${label}`);
  return source.replace(before, after);
}

const path = 'src/whatsapp.ts';
let source = readFileSync(path, 'utf8');

source = replaceRequired(
  source,
  "async function authWrite(profileId: string, items: Array<{ key: string; value: string | null }>) {\n  await gateway('auth_set', { profile_id: profileId, items });\n}",
  "const authWriteQueues = new Map<string, Promise<void>>();\n\nasync function authWrite(profileId: string, items: Array<{ key: string; value: string | null }>) {\n  const previous = authWriteQueues.get(profileId) || Promise.resolve();\n  const current = previous.catch(() => undefined).then(async () => {\n    await gateway('auth_set', { profile_id: profileId, items });\n  });\n  authWriteQueues.set(profileId, current);\n  try {\n    await current;\n  } finally {\n    if (authWriteQueues.get(profileId) === current) authWriteQueues.delete(profileId);\n  }\n}",
  'serialize auth writes',
);

source = replaceRequired(
  source,
  "      const code = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;\n      const loggedOut = code === DisconnectReason.loggedOut;\n      session.status = loggedOut ? 'offline' : 'error';\n      await setProfileStatus(profile.id, session.status);",
  "      const code = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;\n      const loggedOut = code === DisconnectReason.loggedOut;\n      const restartRequired = code === DisconnectReason.restartRequired;\n      session.status = loggedOut ? 'offline' : restartRequired ? 'connecting' : 'error';\n      await setProfileStatus(profile.id, session.status);",
  'treat restart-required as reconnecting state',
);

source = replaceRequired(
  source,
  "        }, 2500);",
  "        }, restartRequired ? 250 : 2500);",
  'fast restart-required reconnect',
);

writeFileSync(path, source);
console.log('prepare-whatsapp-reliability: serialized auth writes and restart-required reconnect hardening applied');

import webpush from 'web-push';
import { gateway } from './store.js';

type StoredSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
};

type PushSettings = {
  vapid_public_key?: string | null;
  vapid_private_key?: string | null;
  push_subscriptions?: StoredSubscription[] | null;
};

let configuredPublicKey: string | null = null;

async function getSettings(): Promise<PushSettings> {
  return (await gateway<{ data: PushSettings }>('get_settings')).data || {};
}

async function ensureVapid(): Promise<PushSettings> {
  let settings = await getSettings();
  if (!settings.vapid_public_key || !settings.vapid_private_key) {
    const generated = webpush.generateVAPIDKeys();
    settings = (await gateway<{ data: PushSettings }>('save_settings', {
      data: {
        vapid_public_key: generated.publicKey,
        vapid_private_key: generated.privateKey,
        push_subscriptions: settings.push_subscriptions || [],
      },
    })).data;
  }
  if (configuredPublicKey !== settings.vapid_public_key) {
    webpush.setVapidDetails(
      'mailto:admin@wa-bot.local',
      String(settings.vapid_public_key),
      String(settings.vapid_private_key),
    );
    configuredPublicKey = String(settings.vapid_public_key);
  }
  return settings;
}

export async function getVapidPublicKey(): Promise<string> {
  const settings = await ensureVapid();
  return String(settings.vapid_public_key);
}

export async function savePushSubscription(subscription: StoredSubscription): Promise<void> {
  const settings = await ensureVapid();
  const existing = Array.isArray(settings.push_subscriptions) ? settings.push_subscriptions : [];
  const next = [...existing.filter((x) => x.endpoint !== subscription.endpoint), subscription];
  await gateway('save_settings', { data: { push_subscriptions: next } });
}

export async function notifyHotLead(input: { conversationId: string; contactName: string; profileName: string; preview: string }): Promise<void> {
  const settings = await ensureVapid();
  const subscriptions = Array.isArray(settings.push_subscriptions) ? settings.push_subscriptions : [];
  if (!subscriptions.length) return;
  const payload = JSON.stringify({
    title: `🔥 HOT Lead · ${input.profileName}`,
    body: `${input.contactName}: ${input.preview}`.slice(0, 180),
    conversationId: input.conversationId,
    url: '/',
  });
  const keep: StoredSubscription[] = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub as any, payload, { TTL: 300, urgency: 'high' as any });
      keep.push(sub);
    } catch (error: any) {
      if (![404, 410].includes(Number(error?.statusCode))) keep.push(sub);
    }
  }
  if (keep.length !== subscriptions.length) {
    await gateway('save_settings', { data: { push_subscriptions: keep } });
  }
}

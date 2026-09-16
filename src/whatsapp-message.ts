const WRAPPERS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
] as const;

export function unwrapWhatsAppMessage(input: any): any {
  let message = input?.message || input || null;
  const visited = new Set<any>();
  while (message && typeof message === "object" && !visited.has(message)) {
    visited.add(message);
    const wrapper = WRAPPERS.find(
      (key) =>
        message?.[key]?.message && typeof message[key].message === "object",
    );
    if (!wrapper) break;
    message = message[wrapper].message;
  }
  return message;
}

export function inboundText(input: any): string | null {
  const message = unwrapWhatsAppMessage(input);
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.buttonsResponseMessage?.selectedDisplayText ||
    message?.listResponseMessage?.title ||
    null
  );
}

export function inboundAudio(input: any): any | null {
  return unwrapWhatsAppMessage(input)?.audioMessage || null;
}

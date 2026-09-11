import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';

export type AdminAuthSettings = {
  admin_password_salt?: string | null;
  admin_password_hash?: string | null;
  admin_password_iterations?: number | null;
};

export function verifyBasicAuthorization(header: string | undefined, settings: AdminAuthSettings): boolean {
  if (!header?.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return false;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    if (username !== 'admin' || !password) return false;
    const salt = settings.admin_password_salt;
    const expectedHex = settings.admin_password_hash;
    const iterations = Number(settings.admin_password_iterations || 210000);
    if (!salt || !expectedHex) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = pbkdf2Sync(password, Buffer.from(salt, 'hex'), iterations, expected.length, 'sha256');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

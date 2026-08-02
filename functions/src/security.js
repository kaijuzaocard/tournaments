import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export function requireHmacSecret(value) {
  const secret = String(value || '');
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('HMAC_SECRET_UNAVAILABLE');
  return secret;
}

export function hmac(secret, purpose, value, encoding = 'base64url') {
  return createHmac('sha256', requireHmacSecret(secret))
    .update(`${purpose}\u0000${value}`, 'utf8')
    .digest(encoding);
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function deterministicCredentials(secret, requestId, fingerprint) {
  const seed = `${requestId}:${fingerprint}`;
  return {
    registrationId: `reg_${hmac(secret, 'registration-id', seed).slice(0, 32)}`,
    managementToken: hmac(secret, 'management-token', seed),
  };
}

export function hashManagementToken(secret, token) {
  return hmac(secret, 'management-token-hash', token);
}

export function tokensEqual(expected, actual) {
  const left = Buffer.from(String(expected || ''), 'utf8');
  const right = Buffer.from(String(actual || ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function normalizeTrustedIp(rawValue) {
  let candidate = String(rawValue || '').trim();
  if (!candidate) throw new Error('CLIENT_IP_UNAVAILABLE');
  if (candidate.startsWith('::ffff:') && isIP(candidate.slice(7)) === 4) candidate = candidate.slice(7);
  if (isIP(candidate) === 4) return candidate;
  if (isIP(candidate) === 6) {
    const hostname = new URL(`http://[${candidate}]`).hostname;
    return hostname.slice(1, -1).toLowerCase();
  }
  throw new Error('CLIENT_IP_UNAVAILABLE');
}

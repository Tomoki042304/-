// Server-only envelope encryption. Store keys as Cloudflare Secrets, never in frontend files.
const encoder = new TextEncoder(), decoder = new TextDecoder();
const bytes = text => Uint8Array.from(atob(text), x => x.charCodeAt(0));
const base64 = data => btoa(String.fromCharCode(...new Uint8Array(data)));
async function keyFor(env, id, usage) {
  const keys = JSON.parse(env.PII_ENCRYPTION_KEYS || '{}');
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id || '') || typeof keys[id] !== 'string') throw Error('PII_KEY_UNAVAILABLE');
  const raw = bytes(keys[id]);
  if (raw.length !== 32) throw Error('PII_KEY_INVALID');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]);
}
export async function encryptPii(env, storageKey, value) {
  const kid = env.PII_ACTIVE_KEY_ID;
  const key = await keyFor(env, kid, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(JSON.stringify(['ikigai-pii', 1, kid, storageKey]));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:aad, tagLength:128}, key, encoder.encode(JSON.stringify(value)));
  return {format:'ikigai-pii', version:1, kid, iv:base64(iv), ciphertext:base64(encrypted)};
}
export async function decryptPii(env, storageKey, envelope) {
  if (envelope?.format !== 'ikigai-pii' || envelope.version !== 1) throw Error('PII_FORMAT_INVALID');
  const key = await keyFor(env, envelope.kid, 'decrypt');
  const iv = bytes(envelope.iv);
  if (iv.length !== 12) throw Error('PII_FORMAT_INVALID');
  const aad = encoder.encode(JSON.stringify(['ikigai-pii', 1, envelope.kid, storageKey]));
  const plaintext = await crypto.subtle.decrypt({name:'AES-GCM', iv, additionalData:aad, tagLength:128}, key, bytes(envelope.ciphertext));
  return JSON.parse(decoder.decode(plaintext));
}

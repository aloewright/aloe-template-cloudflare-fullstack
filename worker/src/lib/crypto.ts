/* AGPL-3.0-or-later */
export type EncryptedToken = { cipher: string; iv: string };

const toB64 = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf)));

const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

async function deriveKey(keyMaterial: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyMaterial));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(
  plaintext: string,
  keyMaterial: string,
): Promise<EncryptedToken> {
  const key = await deriveKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { cipher: toB64(cipher), iv: toB64(iv.buffer) };
}

export async function decryptToken(enc: EncryptedToken, keyMaterial: string): Promise<string> {
  const key = await deriveKey(keyMaterial);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(enc.iv) },
    key,
    fromB64(enc.cipher),
  );
  return new TextDecoder().decode(plain);
}

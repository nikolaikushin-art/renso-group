/**
 * Renso Group CRM — local persistence (demo / offline).
 * Keys are namespaced under renso. to avoid collisions with any prior app data.
 */

const PREFIX = "renso.";

function key(name: string): string {
  return PREFIX + name;
}

export function loadValue<T>(name: string): T | null {
  try {
    const raw = localStorage.getItem(key(name));
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveValue<T>(name: string, value: T): void {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    // quota or private mode — ignore
  }
}

export function removeValue(name: string): void {
  try {
    localStorage.removeItem(key(name));
  } catch {
    // ignore
  }
}

/** Simple credential helpers for demo sign-in (not production auth). */
interface StoredCredential {
  salt: string;
  hash: string;
  isTemporary: boolean;
}

type CredentialMap = Record<string, StoredCredential>;

const CREDENTIALS_KEY = "credentials";

const normalise = (email: string): string => email.trim().toLowerCase();

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export const credentials = {
  isEmpty(): boolean {
    const map = loadValue<CredentialMap>(CREDENTIALS_KEY);
    return map === null || Object.keys(map).length === 0;
  },

  async set(email: string, password: string, isTemporary = false): Promise<void> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(password, salt);
    const map = loadValue<CredentialMap>(CREDENTIALS_KEY) ?? {};
    map[normalise(email)] = { salt: toHex(salt.buffer), hash, isTemporary };
    saveValue(CREDENTIALS_KEY, map);
  },

  async verify(email: string, password: string): Promise<boolean> {
    const map = loadValue<CredentialMap>(CREDENTIALS_KEY) ?? {};
    const record = map[normalise(email)];
    if (!record) return false;
    const hash = await derive(password, fromHex(record.salt));
    return hash === record.hash;
  },

  isTemporary(email: string): boolean {
    const map = loadValue<CredentialMap>(CREDENTIALS_KEY) ?? {};
    return map[normalise(email)]?.isTemporary ?? false;
  },

  remove(email: string): void {
    const map = loadValue<CredentialMap>(CREDENTIALS_KEY) ?? {};
    delete map[normalise(email)];
    saveValue(CREDENTIALS_KEY, map);
  },

  has(email: string): boolean {
    const map = loadValue<CredentialMap>(CREDENTIALS_KEY) ?? {};
    return map[normalise(email)] !== undefined;
  },
};

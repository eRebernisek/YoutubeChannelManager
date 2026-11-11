/** JSON helpers over localStorage that never throw (private mode, blocked storage, bad JSON). */

const PREFIX = 'ycm.';

export function readJson<T>(key: string, fallback: T, store: Storage = localStorage): T {
  try {
    const raw = store.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown, store: Storage = localStorage): void {
  try {
    store.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: settings simply won't persist.
  }
}

export function removeKey(key: string, store: Storage = localStorage): void {
  try {
    store.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

/** Every app key in localStorage, without the prefix (used by settings export). */
export function allKeys(store: Storage = localStorage): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k.slice(PREFIX.length));
    }
  } catch {
    // ignore
  }
  return keys;
}

type Entry<T> = { at: number; value: T };

export function createKeyedCache<T>(ttlMs: number, now: () => number = Date.now) {
  const map = new Map<string, Entry<T>>();
  return {
    get(key: string): T | undefined {
      const entry = map.get(key);
      if (!entry || now() - entry.at >= ttlMs) {
        if (entry) map.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: T) {
      map.set(key, { at: now(), value });
    },
    delete(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}

export function createSingleCache<T>(ttlMs: number, now: () => number = Date.now) {
  let entry: Entry<T> | null = null;
  return {
    get(): T | undefined {
      if (!entry || now() - entry.at >= ttlMs) {
        entry = null;
        return undefined;
      }
      return entry.value;
    },
    set(value: T) {
      entry = { at: now(), value };
    },
    clear() {
      entry = null;
    },
  };
}

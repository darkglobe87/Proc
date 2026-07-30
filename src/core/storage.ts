/**
 * Persistence for high scores, unlocks and settings.
 *
 * Every access is guarded: a WebView with storage disabled, a full quota, or
 * corrupted JSON from an older build must never take the game down. When
 * localStorage is unavailable we fall back to memory, so the session still works
 * and only persistence is lost.
 */

const PREFIX = 'mirage:';

const memoryFallback = new Map<string, string>();

let backendChecked = false;
let hasLocalStorage = false;

function localStorageAvailable(): boolean {
  if (backendChecked) return hasLocalStorage;
  backendChecked = true;
  try {
    const probe = `${PREFIX}__probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    hasLocalStorage = true;
  } catch {
    hasLocalStorage = false;
  }
  return hasLocalStorage;
}

function readRaw(key: string): string | null {
  if (!localStorageAvailable()) return memoryFallback.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function writeRaw(key: string, value: string): void {
  memoryFallback.set(key, value);
  if (!localStorageAvailable()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota exceeded or storage revoked mid-session: memory copy still holds.
  }
}

/** Reads a stored value, returning `fallback` if absent or unparseable. */
export function load<T>(key: string, fallback: T): T {
  const raw = readRaw(PREFIX + key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Written by an incompatible build — treat as absent.
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  try {
    writeRaw(PREFIX + key, JSON.stringify(value));
  } catch {
    // Value contained something non-serialisable; nothing useful to do here.
  }
}

export function remove(key: string): void {
  memoryFallback.delete(PREFIX + key);
  if (!localStorageAvailable()) return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // Ignore.
  }
}

/**
 * Reads, transforms and writes back in one step. Used for counters like the
 * personal best, where read-modify-write is the whole operation.
 */
export function update<T>(key: string, fallback: T, mutate: (current: T) => T): T {
  const next = mutate(load(key, fallback));
  save(key, next);
  return next;
}

/** True when values will survive a restart. The settings screen surfaces this. */
export function isPersistent(): boolean {
  return localStorageAvailable();
}

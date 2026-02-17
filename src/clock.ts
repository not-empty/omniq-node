// src/clock.ts

/**
 * Current time in milliseconds since Unix epoch.
 * Mirrors Python: int(time.time() * 1000)
 */
export function nowMs(): number {
  return Date.now();
}

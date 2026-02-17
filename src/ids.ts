// src/ids.ts

import { ulid } from "ulid";

/**
 * Generate a new ULID string.
 * Mirrors Python:
 *   str(ulid.new())
 */
export function newUlid(): string {
  return ulid();
}

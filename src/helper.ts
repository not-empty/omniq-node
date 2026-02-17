// src/helper.ts

/**
 * Base key prefix for a queue.
 * Ensures Redis Cluster hash-tagging via {...}.
 */
export function queueBase(queueName: string): string {
  if (queueName.includes("{") && queueName.includes("}")) {
    return queueName;
  }
  return `{${queueName}}`;
}

/**
 * Anchor key used by Lua scripts.
 */
export function queueAnchor(queueName: string): string {
  return `${queueBase(queueName)}:meta`;
}

/**
 * Convert any value to string.
 * Mirrors Python as_str().
 */
export function asStr(v: unknown): string {
  if (v === null || v === undefined) return "";

  if (v instanceof Uint8Array) {
    return new TextDecoder("utf-8").decode(v);
  }

  return String(v);
}

/**
 * Anchor for child coordination.
 * Ensures:
 * - No { or }
 * - Max length constraint
 * - Stable cluster slot via {cc:key}
 */
export function childsAnchor(key: string, maxLen = 128): string {
  const k = (key ?? "").trim();

  if (!k) {
    throw new Error("childs_anchor key is required");
  }

  if (k.includes("{") || k.includes("}")) {
    throw new Error("childs_anchor key must not contain '{' or '}'");
  }

  if (k.length > maxLen) {
    throw new Error(`childs_anchor key too long (max ${maxLen} chars)`);
  }

  return `{cc:${k}}:meta`;
}

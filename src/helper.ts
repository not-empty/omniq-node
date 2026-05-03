const QUEUE_NAME_MAX_LEN = 128;
const QUEUE_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function validateQueueName(queueName: string, maxLen = QUEUE_NAME_MAX_LEN): string {
  const value = queueName == null ? "" : String(queueName);

  if (value === "") {
    throw new Error("queue name is required");
  }

  if (value !== value.trim()) {
    throw new Error("queue name must not have leading or trailing whitespace");
  }

  if (value.length > maxLen) {
    throw new Error(`queue name too long (max ${maxLen} chars)`);
  }

  if (!QUEUE_NAME_RE.test(value)) {
    throw new Error("queue name contains invalid characters; allowed: letters, numbers, '.', '_', '-'");
  }

  return value;
}

export function queueBase(queueName: string): string {
  const value = validateQueueName(queueName);
  return `{${value}}`;
}

export function queueAnchor(queueName: string): string {
  return `${queueBase(queueName)}:meta`;
}

export function asStr(v: unknown): string {
  if (v === null || v === undefined) return "";

  if (v instanceof Uint8Array) {
    return new TextDecoder("utf-8").decode(v);
  }

  return String(v);
}

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

export function isPlainObject(x: any): x is Record<string, any> {
  if (x === null || typeof x !== "object") return false;
  if (Array.isArray(x)) return false;

  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

export function queueBase(queueName: string): string {
  if (queueName.includes("{") && queueName.includes("}")) {
    return queueName;
  }
  return `{${queueName}}`;
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
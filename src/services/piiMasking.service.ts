import crypto from "crypto";

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IPV4_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const GUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const TOKEN_REGEX = /\b(?:eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{24,})\b/g;

const hashValue = (value: string, salt: string): string => {
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 18);
};

const maskString = (value: string, salt: string): string => {
  return value
    .replace(EMAIL_REGEX, (match) => `email_${hashValue(match, salt)}`)
    .replace(IPV4_REGEX, (match) => `ip_${hashValue(match, salt)}`)
    .replace(GUID_REGEX, (match) => `id_${hashValue(match, salt)}`)
    .replace(TOKEN_REGEX, (match) => `secret_${hashValue(match, salt)}`);
};

export class PiiMaskingService {
  public constructor(private readonly salt: string) {}

  public mask(input: unknown): unknown {
    if (input === null || input === undefined) {
      return input;
    }

    if (typeof input === "string") {
      return maskString(input, this.salt);
    }

    if (typeof input === "number" || typeof input === "boolean") {
      return input;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.mask(item));
    }

    if (typeof input === "object") {
      const record = input as Record<string, unknown>;
      const maskedEntries = Object.entries(record).map(([key, value]) => [key, this.mask(value)]);
      return Object.fromEntries(maskedEntries);
    }

    return String(input);
  }
}

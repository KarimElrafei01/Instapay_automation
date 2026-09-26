import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { WebhookUrlValidator } from "../domain/ports.js";

type AddressLookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string }>>;

export class HttpsWebhookUrlValidator implements WebhookUrlValidator {
  public constructor(private readonly lookup: AddressLookup = defaultLookup) {}

  public async validate(value: string): Promise<string> {
    const url = parseWebhookUrl(value);
    if (isIP(url.hostname) !== 0 && !isPublicAddress(url.hostname)) {
      throw new Error("Webhook URL does not resolve to a public address.");
    }
    const addresses = await this.lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
      throw new Error("Webhook URL does not resolve to a public address.");
    }
    return url.toString();
  }
}

function parseWebhookUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid webhook URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Webhook URL must use HTTPS.");
  }
  return url;
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return isPublicIpv4Address(address);
  }
  if (isIP(address) === 6) {
    return isPublicIpv6Address(address);
  }
  return false;
}

function isPublicIpv4Address(address: string): boolean {
  const [first, second] = address.split(".").map(Number);
  if (first === undefined || second === undefined) {
    return false;
  }
  return first !== 0 && first !== 10 && first !== 127 && first < 224
    && !(first === 100 && second >= 64 && second <= 127)
    && !(first === 169 && second === 254)
    && !(first === 172 && second >= 16 && second <= 31)
    && !(first === 192 && (second === 0 || second === 168))
    && !(first === 198 && (second === 18 || second === 19 || second === 51))
    && !(first === 203 && second === 0);
}

function isPublicIpv6Address(address: string): boolean {
  const canonical = address.toLowerCase();
  return canonical !== "::" && canonical !== "::1"
    && !canonical.startsWith("::ffff:")
    && !canonical.startsWith("2001:db8:")
    && !canonical.startsWith("fc") && !canonical.startsWith("fd")
    && !canonical.startsWith("fe8") && !canonical.startsWith("fe9")
    && !canonical.startsWith("fea") && !canonical.startsWith("feb")
    && !canonical.startsWith("ff");
}

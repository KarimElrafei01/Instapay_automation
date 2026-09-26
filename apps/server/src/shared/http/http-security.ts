export type RateLimitPolicy = "authentication" | "device" | "proof-upload";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function normalizedRequestPath(url: string): string {
  return new URL(url, "http://request.invalid").pathname;
}

export function shouldProtectAgainstCsrf(input: { method: string; url: string }): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return false;
  return !normalizedRequestPath(input.url).startsWith("/v1/device/");
}

export function rateLimitPolicyForRequest(input: { method: string; url: string }): RateLimitPolicy | null {
  const path = normalizedRequestPath(input.url);
  if (input.method === "POST" && (path === "/v1/owner/auth/otp/request" || path === "/v1/owner/auth/otp/verify")) {
    return "authentication";
  }
  if (input.method === "POST" && path.startsWith("/v1/device/")) return "device";
  if (input.method === "POST" && /\/test-proof$/.test(path)) return "proof-upload";
  return null;
}

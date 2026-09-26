import { describe, expect, it } from "vitest";
import { rateLimitPolicyForRequest, shouldProtectAgainstCsrf } from "./http-security.js";

describe("HTTP security routing", () => {
  it("requires a CSRF token for browser state changes but not safe methods", () => {
    expect(shouldProtectAgainstCsrf({ method: "POST", url: "/v1/owner/stores" })).toBe(true);
    expect(shouldProtectAgainstCsrf({ method: "GET", url: "/v1/security/csrf-token" })).toBe(false);
  });

  it("exempts signed device ingress from browser-only CSRF checks", () => {
    expect(shouldProtectAgainstCsrf({ method: "POST", url: "/v1/device/receiving-sources/source/test-alert" })).toBe(false);
  });

  it("assigns stricter limits to sensitive HTTP routes", () => {
    expect(rateLimitPolicyForRequest({ method: "POST", url: "/v1/owner/auth/otp/request" })).toBe("authentication");
    expect(rateLimitPolicyForRequest({ method: "POST", url: "/v1/device/receiving-sources/source/test-alert" })).toBe("device");
    expect(rateLimitPolicyForRequest({ method: "POST", url: "/v1/owner/receiving-source/source/test-proof" })).toBe("proof-upload");
    expect(rateLimitPolicyForRequest({ method: "GET", url: "/health/live" })).toBeNull();
  });
});

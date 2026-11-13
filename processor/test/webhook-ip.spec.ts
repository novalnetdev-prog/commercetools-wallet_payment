import { webhookCallerIp } from "../src/utils/webhook-ip";

describe("existing webhook IP formatting helper (behavior preserved)", () => {
  test("uses socket IP when no forwarded header is present", () => {
    expect(webhookCallerIp("192.0.2.10")).toBe("192.0.2.10");
  });
  test("uses socket IP for malformed forwarded header", () => {
    expect(webhookCallerIp("192.0.2.10", "not-an-ip"))
      .toBe("192.0.2.10");
  });
  test("retains existing handling for a proxy chain", () => {
    expect(webhookCallerIp("192.0.2.10", "198.51.100.5, 203.0.113.6"))
      .toBe("198.51.100.5");
  });
});

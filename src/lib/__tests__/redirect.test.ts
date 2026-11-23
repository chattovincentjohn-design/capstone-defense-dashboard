import { describe, expect, it } from "vitest";
import { isPublicPath, safeNextPath } from "../redirect";

describe("safeNextPath", () => {
  it.each([
    ["/reset-password", "/reset-password"],
    ["/defense/abc?x=1", "/defense/abc?x=1"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    ["javascript:alert(1)", "/"],
    [null, "/"],
    ["", "/"],
  ])("%s → %s", (input, expected) => expect(safeNextPath(input)).toBe(expected));
});

describe("isPublicPath", () => {
  it("allows sign-in and reset pages, protects the rest", () => {
    for (const p of ["/login", "/forgot-password", "/reset-password", "/auth/confirm"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/", "/admin", "/defense/x", "/account", "/authors", "/login-bypass"]) expect(isPublicPath(p)).toBe(false);
  });
});

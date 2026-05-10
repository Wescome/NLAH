import { describe, expect, it } from "vitest";
import { sanitizedCredentialEnv, sanitizeCredentialValue } from "../src/credential_env.js";

describe("credential env", () => {
  it("strips common smart quote wrappers from credential values", () => {
    expect(sanitizeCredentialValue("\u201Csk-test\u201D")).toBe("sk-test");
    expect(sanitizeCredentialValue("\u2018token\u2019")).toBe("token");
  });

  it("returns sanitized known credential variables without exposing unknown env", () => {
    const env = sanitizedCredentialEnv({
      OPENAI_API_KEY: "\u201Csk-test\u201D",
      GEMINI_API_KEY: '"gemini-test"',
      OFOX_API_KEY: "\u201Cofx-test\u201D",
      UNRELATED_VALUE: "keep-out"
    });

    expect(env).toEqual({
      OPENAI_API_KEY: "sk-test",
      GEMINI_API_KEY: "gemini-test",
      OFOX_API_KEY: "ofx-test"
    });
  });
});

import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalCredentialEnv, sanitizedCredentialEnv, sanitizeCredentialValue } from "../src/credential_env.js";

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

  it("loads ignored local credential files without overwriting existing env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nlah-credential-env-"));
    const envPath = path.join(root, ".env.local");
    const target: NodeJS.ProcessEnv = {
      OPENAI_API_KEY: "existing"
    };
    await writeFile(
      envPath,
      [
        "# local only",
        "OFOX_API_KEY=\u201Cofx-local\u201D",
        "OPENAI_API_KEY=should-not-overwrite",
        "UNRELATED_VALUE=keep-out"
      ].join("\n"),
      "utf8"
    );

    await expect(loadLocalCredentialEnv(envPath, target)).resolves.toEqual(["OFOX_API_KEY"]);
    expect(target).toEqual({
      OPENAI_API_KEY: "existing",
      OFOX_API_KEY: "ofx-local"
    });
  });
});

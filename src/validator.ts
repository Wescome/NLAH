import path from "node:path";
import { compileHarness, loadHarness } from "./compiler.js";

export type ValidationStatus = "VALID" | "INVALID";

export type ValidationReport = {
  status: ValidationStatus;
  harnessPath: string;
  errors: string[];
  warnings: string[];
  stageOrder?: string[];
  startState?: string;
  terminalStates?: string[];
};

export async function validateHarnessFile(harnessPath: string): Promise<ValidationReport> {
  const resolvedHarnessPath = path.resolve(harnessPath);

  try {
    const compiled = compileHarness(await loadHarness(resolvedHarnessPath));
    return {
      status: "VALID",
      harnessPath: resolvedHarnessPath,
      errors: [],
      warnings: [],
      stageOrder: compiled.stageOrder,
      startState: compiled.startState,
      terminalStates: compiled.terminalStates
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "INVALID",
      harnessPath: resolvedHarnessPath,
      errors: [message],
      warnings: []
    };
  }
}

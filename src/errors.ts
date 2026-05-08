export class NlahError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NlahError";
    this.code = code;
  }
}

export class SchemaValidationError extends NlahError {
  constructor(message: string) {
    super("SCHEMA_VALIDATION_ERROR", message);
    this.name = "SchemaValidationError";
  }
}

export class CompilerError extends NlahError {
  constructor(message: string) {
    super("COMPILER_ERROR", message);
    this.name = "CompilerError";
  }
}

export class ArtifactError extends NlahError {
  constructor(message: string) {
    super("ARTIFACT_ERROR", message);
    this.name = "ArtifactError";
  }
}

export class GateError extends NlahError {
  constructor(message: string) {
    super("GATE_ERROR", message);
    this.name = "GateError";
  }
}

export class ContextError extends NlahError {
  constructor(message: string) {
    super("CONTEXT_ERROR", message);
    this.name = "ContextError";
  }
}

export class RuntimeError extends NlahError {
  constructor(message: string) {
    super("RUNTIME_ERROR", message);
    this.name = "RuntimeError";
  }
}

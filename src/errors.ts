export class NlahError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NlahError";
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new NlahError(message);
  }
}

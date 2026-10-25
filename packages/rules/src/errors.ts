export type RuleErrorCode =
  | 'invalid'
  | 'not_found'
  | 'insufficient_funds'
  | 'storage_full'
  | 'no_builder'
  | 'requirement'
  | 'limit_reached'
  | 'blocked'
  | 'busy'
  | 'capacity'
  | 'conflict';

/** A rule violation the player can understand; never an internal error. */
export class RuleError extends Error {
  readonly code: RuleErrorCode;
  constructor(code: RuleErrorCode, message: string) {
    super(message);
    this.name = 'RuleError';
    this.code = code;
  }
}

export function fail(code: RuleErrorCode, message: string): never {
  throw new RuleError(code, message);
}

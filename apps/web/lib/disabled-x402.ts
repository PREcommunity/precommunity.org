function x402Disabled(): never {
  throw new Error('The optional x402 payment integration is disabled in precommunity.');
}

export class x402Client {
  constructor() {
    x402Disabled();
  }
}

export class UptoEvmScheme {
  constructor() {
    x402Disabled();
  }
}

export class ExactSvmScheme {
  constructor() {
    x402Disabled();
  }
}

export function registerExactEvmScheme(): never {
  return x402Disabled();
}

export function registerExactSvmScheme(): never {
  return x402Disabled();
}

export function toClientEvmSigner(): never {
  return x402Disabled();
}

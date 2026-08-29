import { encodeQR } from 'qr';
import { describe, expect, it } from 'vitest';

describe('RainbowKit QR compatibility', () => {
  it('renders the borderless QR grid requested by cuer', () => {
    const grid = encodeQR('wc:test', 'raw', {
      border: 0,
      ecc: 'medium',
      scale: 1,
    });

    expect(grid.length).toBeGreaterThan(0);
    expect(grid.every((row) => row.length === grid.length)).toBe(true);
  });
});

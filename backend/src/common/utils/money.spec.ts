import Decimal from 'decimal.js';
import { allocateByWeight, formatINR, round2, sum } from './money';

/**
 * Money is split constantly in this application — electricity between
 * tenants, a month's rent across days, a deposit against several charges. The
 * one rule that must never break is that the parts add back to the whole.
 */
describe('allocateByWeight', () => {
  it('splits evenly when weights are equal', () => {
    const parts = allocateByWeight('300', [1, 1, 1]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['100.00', '100.00', '100.00']);
  });

  it('never loses a paisa to rounding', () => {
    // 100 / 3 does not divide cleanly; the remainder has to land somewhere.
    const parts = allocateByWeight('100', [1, 1, 1]);
    expect(sum(parts).toFixed(2)).toBe('100.00');
    expect(parts.map((p) => p.toFixed(2)).sort()).toEqual([
      '33.33',
      '33.33',
      '33.34',
    ]);
  });

  it('never invents a paisa either', () => {
    for (const total of ['0.01', '0.05', '7.77', '1250', '9999.99']) {
      for (const weights of [[1, 2], [3, 3, 3], [1, 1, 1, 1, 1, 1, 7]]) {
        const parts = allocateByWeight(total, weights);
        expect(sum(parts).toFixed(2)).toBe(round2(total).toFixed(2));
      }
    }
  });

  it('weights proportionally', () => {
    const parts = allocateByWeight('1000', [3, 1]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['750.00', '250.00']);
  });

  it('falls back to an even split rather than dividing by zero', () => {
    const parts = allocateByWeight('90', [0, 0, 0]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['30.00', '30.00', '30.00']);
  });

  it('handles a single recipient', () => {
    expect(allocateByWeight('123.45', [5])[0].toFixed(2)).toBe('123.45');
  });

  it('returns nothing when there is nobody to pay', () => {
    expect(allocateByWeight('100', [])).toEqual([]);
  });
});

describe('formatINR', () => {
  it('groups in the Indian style', () => {
    expect(formatINR('1234567.5')).toBe('₹12,34,567.50');
    expect(formatINR('100000')).toBe('₹1,00,000.00');
    expect(formatINR('999')).toBe('₹999.00');
  });

  it('marks negatives, which is how an amount payable reads', () => {
    expect(formatINR(new Decimal('-4500'))).toBe('-₹4,500.00');
  });
});

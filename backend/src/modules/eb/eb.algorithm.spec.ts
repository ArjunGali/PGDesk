import { computeEbCycle, EbCalculationError } from './eb.algorithm';

describe('computeEbCycle', () => {
  const base = {
    ratePerUnit: '12.50',
    periodDays: 30,
    maxPlausibleUnitsPerDay: 60,
    splitMethod: 'OCCUPIED_DAYS' as const,
    endIsReset: false,
  };

  it('bills the difference between readings at the configured rate', () => {
    const result = computeEbCycle({
      ...base,
      startReading: '1000',
      endReading: '1120',
      occupants: [{ stayId: 'a', occupiedDays: 30 }],
    });

    expect(result.unitsConsumed.toFixed(2)).toBe('120.00');
    expect(result.totalAmount.toFixed(2)).toBe('1500.00');
    expect(result.shares[0].amount.toFixed(2)).toBe('1500.00');
  });

  it('splits by occupied days so a mid-month arrival pays a smaller share', () => {
    const result = computeEbCycle({
      ...base,
      startReading: '0',
      endReading: '100',
      occupants: [
        { stayId: 'full', occupiedDays: 30 },
        { stayId: 'half', occupiedDays: 15 },
      ],
    });

    // 100 units x 12.50 = 1250, split 30:15 => 833.33 / 416.67
    expect(result.totalAmount.toFixed(2)).toBe('1250.00');
    expect(result.shares.map((s) => s.amount.toFixed(2))).toEqual([
      '833.33',
      '416.67',
    ]);
  });

  it('always allocates exactly the total, with no rounding drift', () => {
    const result = computeEbCycle({
      ...base,
      startReading: '0',
      endReading: '10',
      occupants: [
        { stayId: 'a', occupiedDays: 10 },
        { stayId: 'b', occupiedDays: 10 },
        { stayId: 'c', occupiedDays: 10 },
      ],
    });

    const allocated = result.shares.reduce(
      (acc, s) => acc.plus(s.amount),
      result.unallocatedAmount,
    );
    expect(allocated.toFixed(2)).toBe(result.totalAmount.toFixed(2));
  });

  it('divides evenly when the split method is EQUAL', () => {
    const result = computeEbCycle({
      ...base,
      splitMethod: 'EQUAL',
      startReading: '0',
      endReading: '80',
      occupants: [
        { stayId: 'a', occupiedDays: 30 },
        { stayId: 'b', occupiedDays: 3 },
      ],
    });

    expect(result.shares.map((s) => s.amount.toFixed(2))).toEqual([
      '500.00',
      '500.00',
    ]);
  });

  it('ignores tenants who were not there during the period', () => {
    const result = computeEbCycle({
      ...base,
      startReading: '500',
      endReading: '540',
      occupants: [
        { stayId: 'present', occupiedDays: 30 },
        { stayId: 'left-earlier', occupiedDays: 0 },
      ],
    });

    expect(result.shares).toHaveLength(1);
    expect(result.shares[0].stayId).toBe('present');
  });

  it('refuses a reading that goes backwards instead of guessing', () => {
    expect(() =>
      computeEbCycle({
        ...base,
        startReading: '900',
        endReading: '880',
        occupants: [{ stayId: 'a', occupiedDays: 30 }],
      }),
    ).toThrow(EbCalculationError);
  });

  it('treats a flagged reset as the full consumption and says so', () => {
    const result = computeEbCycle({
      ...base,
      endIsReset: true,
      startReading: '9800',
      endReading: '45',
      occupants: [{ stayId: 'a', occupiedDays: 30 }],
    });

    expect(result.unitsConsumed.toFixed(2)).toBe('45.00');
    expect(result.warnings.join(' ')).toMatch(/reset or replaced/i);
  });

  it('warns about implausible usage but still computes it', () => {
    const result = computeEbCycle({
      ...base,
      startReading: '0',
      endReading: '5000',
      occupants: [{ stayId: 'a', occupiedDays: 30 }],
    });

    expect(result.warnings.join(' ')).toMatch(/units per day/i);
    expect(result.totalAmount.toFixed(2)).toBe('62500.00');
  });

  it('holds the charge on the property when the room was empty', () => {
    const result = computeEbCycle({
      ...base,
      startReading: '0',
      endReading: '20',
      occupants: [],
    });

    expect(result.shares).toHaveLength(0);
    expect(result.unallocatedAmount.toFixed(2)).toBe('250.00');
  });

  it('rejects a zero or missing rate rather than billing nothing', () => {
    expect(() =>
      computeEbCycle({
        ...base,
        ratePerUnit: '0',
        startReading: '0',
        endReading: '100',
        occupants: [{ stayId: 'a', occupiedDays: 30 }],
      }),
    ).toThrow(/rate per unit/i);
  });
});

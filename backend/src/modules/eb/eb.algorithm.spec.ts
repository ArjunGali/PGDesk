import { computeEbCycle, EbCalculationError } from './eb.algorithm';

describe('computeEbCycle', () => {
  const base = {
    ratePerUnit: '12.50',
    periodDays: 30,
    maxPlausibleUnitsPerDay: 60,
    splitMethod: 'OCCUPIED_DAYS' as const,
    endIsReset: false,
  };

  // The rule the property actually uses. A tenant carries one bed's worth of
  // the room from the day they become responsible for it; empty beds are the
  // owner's cost, not the other tenants'.
  const capacityBase = {
    ratePerUnit: '12.50',
    periodDays: 30,
    maxPlausibleUnitsPerDay: 60,
    splitMethod: 'ROOM_CAPACITY' as const,
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

  describe('ROOM_CAPACITY — one bed\'s share per tenant', () => {
    it('charges half a 2-sharing room to a lone tenant and leaves the rest with the owner', () => {
      // The example from the specification: a daily tenant in a 2-sharing room
      // is still split by 2 from their check-in, even with the other bed empty.
      const result = computeEbCycle({
        ...capacityBase,
        roomCapacity: 2,
        startReading: '0',
        endReading: '100',
        occupants: [{ stayId: 'alone', occupiedDays: 30 }],
      });

      expect(result.totalAmount.toFixed(2)).toBe('1250.00');
      expect(result.shares).toHaveLength(1);
      expect(result.shares[0].amount.toFixed(2)).toBe('625.00');
      // The empty bed is the owner's cost, not the tenant's.
      expect(result.unallocatedAmount.toFixed(2)).toBe('625.00');
      expect(result.warnings.join(' ')).toMatch(/stays with the property/i);
    });

    it('pro-rates a mid-month check-in from the check-in date', () => {
      // Responsible for 20 of 30 days in a 2-sharing room: 1/2 x 20/30.
      const result = computeEbCycle({
        ...capacityBase,
        roomCapacity: 2,
        startReading: '0',
        endReading: '100',
        occupants: [{ stayId: 'joined-late', occupiedDays: 20 }],
      });

      // 1250 x 0.5 x (20/30) = 416.67
      expect(result.shares[0].amount.toFixed(2)).toBe('416.67');
      expect(result.unallocatedAmount.toFixed(2)).toBe('833.33');
    });

    it('does not penalise one tenant for the other bed being empty part of the month', () => {
      const full = computeEbCycle({
        ...capacityBase,
        roomCapacity: 2,
        startReading: '0',
        endReading: '100',
        occupants: [
          { stayId: 'a', occupiedDays: 30 },
          { stayId: 'b', occupiedDays: 30 },
        ],
      });
      const partial = computeEbCycle({
        ...capacityBase,
        roomCapacity: 2,
        startReading: '0',
        endReading: '100',
        occupants: [
          { stayId: 'a', occupiedDays: 30 },
          { stayId: 'b', occupiedDays: 10 },
        ],
      });

      // A's bill is identical either way — that is the point of the rule.
      expect(full.shares[0].amount.toFixed(2)).toBe('625.00');
      expect(partial.shares[0].amount.toFixed(2)).toBe('625.00');
      // And with both beds full for the whole month, nothing is left over.
      expect(full.unallocatedAmount.toFixed(2)).toBe('0.00');
    });

    it('splits a 3-sharing room into thirds', () => {
      const result = computeEbCycle({
        ...capacityBase,
        roomCapacity: 3,
        startReading: '1000',
        endReading: '1240',
        occupants: [
          { stayId: 'a', occupiedDays: 30 },
          { stayId: 'b', occupiedDays: 30 },
          { stayId: 'c', occupiedDays: 30 },
        ],
      });

      expect(result.totalAmount.toFixed(2)).toBe('3000.00');
      expect(result.shares.map((s) => s.amount.toFixed(2))).toEqual([
        '1000.00',
        '1000.00',
        '1000.00',
      ]);
      expect(result.unallocatedAmount.toFixed(2)).toBe('0.00');
    });

    it('never loses or invents money: shares plus the owner share equal the total', () => {
      const result = computeEbCycle({
        ...capacityBase,
        roomCapacity: 3,
        periodDays: 31,
        startReading: '0',
        endReading: '77',
        occupants: [
          { stayId: 'a', occupiedDays: 31 },
          { stayId: 'b', occupiedDays: 7 },
          { stayId: 'c', occupiedDays: 19 },
        ],
      });

      const total = result.shares
        .reduce((acc, s) => acc.plus(s.amount), result.unallocatedAmount)
        .toFixed(2);
      expect(total).toBe(result.totalAmount.toFixed(2));
    });

    it('caps a tenant at the period length rather than over-charging them', () => {
      const result = computeEbCycle({
        ...capacityBase,
        roomCapacity: 2,
        periodDays: 30,
        startReading: '0',
        endReading: '100',
        // A stay that began before the period should not exceed a full share.
        occupants: [{ stayId: 'long-stayer', occupiedDays: 45 }],
      });

      expect(result.shares[0].amount.toFixed(2)).toBe('625.00');
      expect(result.unallocatedAmount.isNegative()).toBe(false);
    });

    it('flags an over-full room but still charges each tenant one bed share', () => {
      const result = computeEbCycle({
        ...capacityBase,
        roomCapacity: 2,
        startReading: '0',
        endReading: '100',
        occupants: [
          { stayId: 'a', occupiedDays: 30 },
          { stayId: 'b', occupiedDays: 30 },
          { stayId: 'c', occupiedDays: 30 },
        ],
      });

      expect(result.warnings.join(' ')).toMatch(/3 tenants were responsible/i);
      expect(result.shares.every((s) => s.amount.toFixed(2) === '625.00')).toBe(true);
      expect(result.unallocatedAmount.toFixed(2)).toBe('0.00');
    });

    it('refuses to guess when the meter is not attached to a room', () => {
      expect(() =>
        computeEbCycle({
          ...capacityBase,
          roomCapacity: null,
          startReading: '0',
          endReading: '100',
          occupants: [{ stayId: 'a', occupiedDays: 30 }],
        }),
      ).toThrow(/sharing capacity/i);
    });
  });
});
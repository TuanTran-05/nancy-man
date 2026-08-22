import { describe, expect, it } from 'vitest';
import {
  FIXED_AVAILABILITY_SLOTS,
  buildSelectionKey,
  getFixedAvailabilitySlot,
  isAvailabilityDayKey,
  isAvailabilityPairKey,
  normalizeAvailabilitySelections,
  validateAvailabilitySlotInput,
} from './teacherAvailability';

describe('teacher availability domain helpers', () => {
  it('accepts only configured paired days', () => {
    expect(isAvailabilityPairKey('tue_thu')).toBe(true);
    expect(isAvailabilityPairKey('wed_fri')).toBe(true);
    expect(isAvailabilityPairKey('sat_sun')).toBe(true);
    expect(isAvailabilityPairKey('sun_mon')).toBe(true);
    expect(isAvailabilityPairKey('mon_wed')).toBe(false);
    expect(isAvailabilityPairKey('')).toBe(false);
  });

  it('accepts only configured individual days', () => {
    expect(isAvailabilityDayKey('mon')).toBe(true);
    expect(isAvailabilityDayKey('tue')).toBe(true);
    expect(isAvailabilityDayKey('sun')).toBe(true);
    expect(isAvailabilityDayKey('tue_thu')).toBe(false);
    expect(isAvailabilityDayKey('')).toBe(false);
  });

  it('builds stable day-slot selection keys', () => {
    expect(buildSelectionKey({ dayKey: 'tue', slotId: 'slot-1800' })).toBe('tue:slot-1800');
  });

  it('normalizes day selections by dropping duplicates and sorting', () => {
    expect(
      normalizeAvailabilitySelections([
        { dayKey: 'wed', slotId: 'slot-1900' },
        { dayKey: 'tue', slotId: 'slot-1800' },
        { dayKey: 'tue', slotId: 'slot-1800' },
      ])
    ).toEqual({
      selections: [
        { dayKey: 'tue', slotId: 'slot-1800' },
        { dayKey: 'wed', slotId: 'slot-1900' },
      ],
      selectionKeys: ['tue:slot-1800', 'wed:slot-1900'],
    });
  });

  it('expands legacy pair selections into individual days', () => {
    expect(normalizeAvailabilitySelections([{ pairKey: 'tue_thu', slotId: 'slot-1800' }])).toEqual({
      selections: [
        { dayKey: 'tue', slotId: 'slot-1800' },
        { dayKey: 'thu', slotId: 'slot-1800' },
      ],
      selectionKeys: ['tue:slot-1800', 'thu:slot-1800'],
    });
  });

  it('rejects invalid day or pair keys during normalization', () => {
    expect(() =>
      normalizeAvailabilitySelections([{ pairKey: 'mon_wed' as any, slotId: 'slot-1' }])
    ).toThrow('Invalid availability pair');
    expect(() =>
      normalizeAvailabilitySelections([{ dayKey: 'noday' as any, slotId: 'slot-1' }])
    ).toThrow('Invalid availability day');
  });

  it('validates slot time and allowed pairs', () => {
    expect(
      validateAvailabilitySlotInput({
        label: '18:00-19:30',
        startTime: '18:00',
        endTime: '19:30',
        allowedPairs: ['tue_thu', 'wed_fri'],
      })
    ).toEqual(null);
    expect(
      validateAvailabilitySlotInput({
        label: 'Bad',
        startTime: '21:00',
        endTime: '20:00',
        allowedPairs: ['tue_thu'],
      })
    ).toBe('endTime must be after startTime');
    expect(
      validateAvailabilitySlotInput({
        label: 'Bad',
        startTime: '18:00',
        endTime: '19:00',
        allowedPairs: ['mon_wed' as any],
      })
    ).toBe('Invalid allowedPairs');
  });

  it('defines fixed teaching shifts for availability registration', () => {
    expect(FIXED_AVAILABILITY_SLOTS.map((slot) => `${slot.id}:${slot.label}`)).toEqual([
      'A1:A1',
      'A2:A2',
      'B1:B1',
      'B2:B2',
      'C:C',
      'D:D',
    ]);
    expect(getFixedAvailabilitySlot('A1')).toMatchObject({
      startTime: '07:30',
      endTime: '09:45',
      allowedPairs: ['sat_sun'],
    });
    expect(getFixedAvailabilitySlot('C')).toMatchObject({
      startTime: '16:30',
      endTime: '18:45',
      allowedPairs: ['tue_thu', 'wed_fri', 'sat_sun', 'sun_mon'],
    });
  });
});

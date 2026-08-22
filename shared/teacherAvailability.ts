export const AVAILABILITY_PAIR_KEYS = ['tue_thu', 'wed_fri', 'sat_sun', 'sun_mon'] as const;
export const AVAILABILITY_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type AvailabilityPairKey = (typeof AVAILABILITY_PAIR_KEYS)[number];
export type AvailabilityDayKey = (typeof AVAILABILITY_DAY_KEYS)[number];

export interface AvailabilitySelection {
  dayKey?: AvailabilityDayKey;
  pairKey?: AvailabilityPairKey;
  slotId: string;
}

export interface AvailabilitySlotInput {
  label: string;
  startTime: string;
  endTime: string;
  allowedPairs: AvailabilityPairKey[];
}

export interface FixedAvailabilitySlot extends AvailabilitySlotInput {
  id: string;
  active: true;
  sortOrder: number;
}

const ALL_PAIR_KEYS: AvailabilityPairKey[] = [...AVAILABILITY_PAIR_KEYS];

export const FIXED_AVAILABILITY_SLOTS: FixedAvailabilitySlot[] = [
  {
    id: 'A1',
    label: 'A1',
    startTime: '07:30',
    endTime: '09:45',
    allowedPairs: ['sat_sun'],
    active: true,
    sortOrder: 1,
  },
  {
    id: 'A2',
    label: 'A2',
    startTime: '09:45',
    endTime: '12:00',
    allowedPairs: ['sat_sun'],
    active: true,
    sortOrder: 2,
  },
  {
    id: 'B1',
    label: 'B1',
    startTime: '12:00',
    endTime: '14:15',
    allowedPairs: ['sat_sun'],
    active: true,
    sortOrder: 3,
  },
  {
    id: 'B2',
    label: 'B2',
    startTime: '14:15',
    endTime: '16:30',
    allowedPairs: ['sat_sun'],
    active: true,
    sortOrder: 4,
  },
  {
    id: 'C',
    label: 'C',
    startTime: '16:30',
    endTime: '18:45',
    allowedPairs: ALL_PAIR_KEYS,
    active: true,
    sortOrder: 5,
  },
  {
    id: 'D',
    label: 'D',
    startTime: '18:45',
    endTime: '21:00',
    allowedPairs: ALL_PAIR_KEYS,
    active: true,
    sortOrder: 6,
  },
];

const DAY_ORDER = new Map<AvailabilityDayKey, number>(
  AVAILABILITY_DAY_KEYS.map((dayKey, index) => [dayKey, index])
);
const PAIR_DAY_KEYS: Record<AvailabilityPairKey, AvailabilityDayKey[]> = {
  tue_thu: ['tue', 'thu'],
  wed_fri: ['wed', 'fri'],
  sat_sun: ['sat', 'sun'],
  sun_mon: ['sun', 'mon'],
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isAvailabilityPairKey(value: unknown): value is AvailabilityPairKey {
  return typeof value === 'string' && AVAILABILITY_PAIR_KEYS.includes(value as AvailabilityPairKey);
}

export function isAvailabilityDayKey(value: unknown): value is AvailabilityDayKey {
  return typeof value === 'string' && AVAILABILITY_DAY_KEYS.includes(value as AvailabilityDayKey);
}

export function getAvailabilityDayKeysForPair(pairKey: AvailabilityPairKey): AvailabilityDayKey[] {
  return PAIR_DAY_KEYS[pairKey];
}

export function getAvailabilityDayKeysForPairs(
  pairKeys: AvailabilityPairKey[]
): AvailabilityDayKey[] {
  const allowed = new Set<AvailabilityDayKey>();
  for (const pairKey of pairKeys) {
    for (const dayKey of getAvailabilityDayKeysForPair(pairKey)) {
      allowed.add(dayKey);
    }
  }
  return AVAILABILITY_DAY_KEYS.filter((dayKey) => allowed.has(dayKey));
}

export function buildSelectionKey(selection: AvailabilitySelection): string {
  if (isAvailabilityDayKey(selection.dayKey)) {
    return `${selection.dayKey}:${selection.slotId}`;
  }
  return `${selection.pairKey}:${selection.slotId}`;
}

export function getFixedAvailabilitySlot(slotId: string): FixedAvailabilitySlot | null {
  return FIXED_AVAILABILITY_SLOTS.find((slot) => slot.id === slotId) || null;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function normalizeAvailabilitySelections(input: AvailabilitySelection[]): {
  selections: AvailabilitySelection[];
  selectionKeys: string[];
} {
  const byKey = new Map<string, AvailabilitySelection>();

  for (const selection of input) {
    const slotId = String(selection.slotId || '').trim();
    if (!slotId) throw new Error('Missing slotId');

    if ('dayKey' in selection) {
      if (!isAvailabilityDayKey(selection.dayKey)) {
        throw new Error('Invalid availability day');
      }
      const normalized = { dayKey: selection.dayKey, slotId };
      byKey.set(buildSelectionKey(normalized), normalized);
      continue;
    }

    if (!isAvailabilityPairKey(selection.pairKey)) {
      throw new Error('Invalid availability pair');
    }

    for (const dayKey of getAvailabilityDayKeysForPair(selection.pairKey)) {
      const normalized = { dayKey, slotId };
      byKey.set(buildSelectionKey(normalized), normalized);
    }
  }

  const selections = [...byKey.values()].sort((a, b) => {
    const dayDiff =
      (DAY_ORDER.get(a.dayKey as AvailabilityDayKey) || 0) -
      (DAY_ORDER.get(b.dayKey as AvailabilityDayKey) || 0);
    if (dayDiff !== 0) return dayDiff;
    return a.slotId.localeCompare(b.slotId);
  });

  return {
    selections,
    selectionKeys: selections.map(buildSelectionKey),
  };
}

export function validateAvailabilitySlotInput(input: AvailabilitySlotInput): string | null {
  if (!String(input.label || '').trim()) return 'Missing label';
  if (!TIME_RE.test(input.startTime)) return 'Invalid startTime';
  if (!TIME_RE.test(input.endTime)) return 'Invalid endTime';
  if (timeToMinutes(input.endTime) <= timeToMinutes(input.startTime)) {
    return 'endTime must be after startTime';
  }
  if (!Array.isArray(input.allowedPairs) || input.allowedPairs.length === 0) {
    return 'Missing allowedPairs';
  }
  if (!input.allowedPairs.every(isAvailabilityPairKey)) return 'Invalid allowedPairs';
  return null;
}

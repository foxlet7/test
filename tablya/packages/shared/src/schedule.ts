export interface ScheduleSlot {
  /** 0 = Sunday .. 6 = Saturday */
  dayOfWeek: number;
  /** minutes from midnight, local kitchen time */
  openMinute: number;
  closeMinute: number;
}

export type KitchenAvailability = 'OPEN' | 'CLOSED' | 'TEMPORARILY_UNAVAILABLE' | 'FULLY_BOOKED';

export interface AvailabilityInput {
  slots: ScheduleSlot[];
  /** IANA timezone, e.g. Asia/Riyadh */
  timezone: string;
  pausedUntil?: Date | null;
  acceptingOrders: boolean;
  activeOrderCount: number;
  maxConcurrentOrders?: number | null;
  now?: Date;
}

export function localMinutes(now: Date, timezone: string): { dayOfWeek: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    dayOfWeek: days.indexOf(get('weekday')),
    minute: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10),
  };
}

/** Handles slots that cross midnight (closeMinute <= openMinute means closes next day). */
export function isWithinSchedule(slots: ScheduleSlot[], now: Date, timezone: string): boolean {
  const { dayOfWeek, minute } = localMinutes(now, timezone);
  const prev = (dayOfWeek + 6) % 7;
  return slots.some((s) => {
    const crosses = s.closeMinute <= s.openMinute;
    if (s.dayOfWeek === dayOfWeek) {
      return crosses ? minute >= s.openMinute : minute >= s.openMinute && minute < s.closeMinute;
    }
    return crosses && s.dayOfWeek === prev && minute < s.closeMinute;
  });
}

export function kitchenAvailability(i: AvailabilityInput): KitchenAvailability {
  const now = i.now ?? new Date();
  if (!i.acceptingOrders) return 'TEMPORARILY_UNAVAILABLE';
  if (i.pausedUntil && i.pausedUntil > now) return 'TEMPORARILY_UNAVAILABLE';
  if (!isWithinSchedule(i.slots, now, i.timezone)) return 'CLOSED';
  if (i.maxConcurrentOrders != null && i.activeOrderCount >= i.maxConcurrentOrders)
    return 'FULLY_BOOKED';
  return 'OPEN';
}

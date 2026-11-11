import { Injectable, computed, signal } from '@angular/core';
import { DAILY_QUOTA, QUOTA_COSTS, QuotaMethod } from './quota-costs';
import { readJson, writeJson } from './storage';
import { quotaDay } from './time.util';

interface QuotaLog {
  day: string;
  total: number;
  byMethod: Record<string, number>;
}

const LOG_KEY = 'quota.log';
const OVERRIDES_KEY = 'quota.overrides';

/**
 * Estimates the YouTube quota used today. The quota belongs to the Google Cloud project, so this
 * log is shared by every channel (spec §2.1). It's an estimate: other tools using the same project
 * aren't counted.
 */
@Injectable({ providedIn: 'root' })
export class QuotaService {
  private readonly log = signal<QuotaLog>(this.load());
  readonly overrides = signal<Partial<Record<QuotaMethod, number>>>(readJson(OVERRIDES_KEY, {}));

  readonly limit = DAILY_QUOTA;
  readonly used = computed(() => this.current().total);
  readonly remaining = computed(() => Math.max(0, this.limit - this.used()));
  readonly byMethod = computed(() =>
    Object.entries(this.current().byMethod).sort((a, b) => b[1] - a[1]),
  );

  constructor() {
    // Roll the day over even when the tab stays open past Pacific midnight.
    setInterval(() => this.log.set(this.current()), 60_000);
  }

  cost(method: QuotaMethod): number {
    return this.overrides()[method] ?? QUOTA_COSTS[method];
  }

  record(method: QuotaMethod, times = 1): void {
    const units = this.cost(method) * times;
    const log = this.current();
    const next: QuotaLog = {
      day: log.day,
      total: log.total + units,
      byMethod: { ...log.byMethod, [method]: (log.byMethod[method] ?? 0) + units },
    };
    this.log.set(next);
    writeJson(LOG_KEY, next);
  }

  /** True when `units` more would still fit in today's quota. */
  fits(units: number): boolean {
    return this.used() + units <= this.limit;
  }

  setOverrides(overrides: Partial<Record<QuotaMethod, number>>): void {
    this.overrides.set(overrides);
    writeJson(OVERRIDES_KEY, overrides);
  }

  private current(): QuotaLog {
    const log = this.log();
    return log.day === quotaDay() ? log : { day: quotaDay(), total: 0, byMethod: {} };
  }

  private load(): QuotaLog {
    const log = readJson<QuotaLog | null>(LOG_KEY, null);
    return log && log.day === quotaDay() ? log : { day: quotaDay(), total: 0, byMethod: {} };
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClockService } from './clock.service.js';

/**
 * Phase D correction: the LLM must never invent "now" when resolving a
 * relative date expression ("demain", "dans une minute", "lundi prochain",
 * ...) — it previously did exactly that, producing wrong/past dates for
 * create_task/create_reminder. This service is the single place that
 * computes a real, request-time reference and phrases it for the system
 * prompt, so every agent call injects the same, always-fresh value.
 *
 * Timezone strategy (explicit, documented, never silently chosen by the
 * model): `User` has no `timezone` column yet, so there is no real
 * per-user timezone to use. The reference is always given in UTC AND in
 * `app.defaultTimezone` (env `MORA_DEFAULT_TIMEZONE`, defaults to `'UTC'`)
 * — when a per-user timezone is added in a later phase, only this service
 * needs to change to use it instead of the default.
 */
@Injectable()
export class TimeContextService {
  private readonly defaultTimezone: string;

  constructor(
    private readonly clock: ClockService,
    configService: ConfigService,
  ) {
    this.defaultTimezone = configService.get<string>('app.defaultTimezone') ?? 'UTC';
  }

  /** The raw current instant — computed fresh on every call, never cached, never hardcoded. */
  now(): Date {
    return this.clock.now();
  }

  get timezone(): string {
    return this.defaultTimezone;
  }

  /**
   * A system-prompt-ready line giving the LLM an unambiguous, explicit
   * temporal anchor plus a hard instruction on how to use it. Computed at
   * call time from `this.now()` — never a stale/hardcoded string.
   */
  describeNow(): string {
    const now = this.now();
    const isoUtc = now.toISOString();
    const localized = new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: this.defaultTimezone,
    }).format(now);

    return (
      `Référence temporelle actuelle (fournie par le backend, à utiliser obligatoirement) : ` +
      `${isoUtc} en UTC, soit ${localized} dans le fuseau horaire par défaut "${this.defaultTimezone}". ` +
      "Résous TOUTE expression temporelle relative (aujourd'hui, demain, ce soir, dans une minute, " +
      'lundi prochain, etc.) à partir de cette référence exacte — ne devine et n\'invente jamais une ' +
      "autre date ou un autre fuseau horaire. Si tu appelles un tool avec un champ de date/heure " +
      "(dueAt, remindAt), calcule-le précisément à partir de cette référence, au format ISO 8601 UTC."
    );
  }
}

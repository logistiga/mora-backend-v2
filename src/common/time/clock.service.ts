import { Injectable } from '@nestjs/common';

/**
 * Single source of "now" for anything that needs to reason about the
 * current time (Phase D: resolving relative date expressions for the LLM).
 * Injectable so it can be overridden with a fixed clock in tests
 * (`Test.createTestingModule().overrideProvider(ClockService)` or a plain
 * `new Xyz(fakeClock)` in unit tests) — this is what makes the date/time
 * regression tests deterministic instead of racing the real wall clock.
 */
@Injectable()
export class ClockService {
  now(): Date {
    return new Date();
  }
}

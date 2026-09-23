import { Module } from '@nestjs/common';
import { ClockService } from './clock.service.js';
import { TimeContextService } from './time-context.service.js';

@Module({
  providers: [ClockService, TimeContextService],
  exports: [ClockService, TimeContextService],
})
export class TimeModule {}

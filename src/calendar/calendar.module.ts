import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TimeModule } from '../common/time/time.module.js';
import { CalendarController } from './calendar.controller.js';
import { CALENDAR_PROVIDER } from './calendar-provider.token.js';
import { CalendarService } from './calendar.service.js';
import { MoraCalendarProvider } from './mora-calendar.provider.js';
import { CalendarProviderRouter } from './calendar-provider.router.js';
import { GoogleModule } from '../google/google.module.js';
import { SkillsModule } from '../skills/skills.module.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' }), TimeModule, GoogleModule, SkillsModule],
  controllers: [CalendarController],
  providers: [MoraCalendarProvider, CalendarProviderRouter, { provide: CALENDAR_PROVIDER, useExisting: CalendarProviderRouter }, CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}

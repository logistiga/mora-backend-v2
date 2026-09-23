import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TimeModule } from '../common/time/time.module.js';
import { CalendarController } from './calendar.controller.js';
import { CALENDAR_PROVIDER } from './calendar-provider.token.js';
import { CalendarService } from './calendar.service.js';
import { MoraCalendarProvider } from './mora-calendar.provider.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' }), TimeModule],
  controllers: [CalendarController],
  providers: [{ provide: CALENDAR_PROVIDER, useClass: MoraCalendarProvider }, CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}

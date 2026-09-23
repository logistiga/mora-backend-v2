import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CalendarService } from './calendar.service.js';
import { CreateEventDto } from './dto/create-event.dto.js';
import { ListEventsQueryDto } from './dto/list-events.dto.js';
import { UpdateEventDto } from './dto/update-event.dto.js';

@ApiTags('calendar')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('events')
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListEventsQueryDto) {
    return this.calendarService.listEvents(
      user.id,
      query.scope ?? 'personal',
      query.space ?? 'personal',
      new Date(query.from),
      new Date(query.to),
    );
  }

  @Get('events/:id')
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const event = await this.calendarService.getEvent(user.id, id);
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  @Post('events')
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEventDto) {
    return this.calendarService.createEvent({
      userId: user.id,
      scope: dto.scope,
      space: dto.space,
      title: dto.title,
      description: dto.description,
      location: dto.location,
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(dto.endsAt),
      participants: dto.participantContactIds?.map((contactId) => ({ contactId })),
    });
  }

  @Patch('events/:id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.calendarService.updateEvent(user.id, id, {
      title: dto.title,
      description: dto.description,
      location: dto.location,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
    });
  }

  @Post('events/:id/cancel')
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.calendarService.cancelEvent(user.id, id);
  }

  @Get('free-slots')
  async freeSlots(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEventsQueryDto & { durationMinutes?: string },
  ) {
    return this.calendarService.findFreeSlots(
      user.id,
      query.scope ?? 'personal',
      query.space ?? 'personal',
      new Date(query.from),
      new Date(query.to),
      query.durationMinutes ? parseInt(query.durationMinutes, 10) : 30,
    );
  }
}

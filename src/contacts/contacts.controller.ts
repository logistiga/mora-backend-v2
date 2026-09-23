import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { ContactService } from './contact.service.js';
import { AddContactIdentityDto } from './dto/add-contact-identity.dto.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { ListContactsQueryDto } from './dto/list-contacts.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';

@ApiTags('contacts')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactService: ContactService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListContactsQueryDto) {
    return this.contactService.list(user.id, query);
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contactService.getById(user.id, id);
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateContactDto) {
    return this.contactService.create(user.id, dto);
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.contactService.update(user.id, id, dto);
  }

  @Post(':id/identities')
  async addIdentity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddContactIdentityDto,
  ) {
    return this.contactService.addIdentity(user.id, id, dto);
  }
}

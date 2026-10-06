import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { ContactService } from './contact.service.js';
import { ContactRemoteSyncService, type RemoteContactSnapshot } from './contact-remote-sync.service.js';
import { AddContactIdentityDto } from './dto/add-contact-identity.dto.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { ListContactsQueryDto } from './dto/list-contacts.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';

@ApiTags('contacts')
@ApiSecurity('api-key')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('contacts')
export class ContactsController {
  constructor(
    private readonly contactService: ContactService,
    private readonly remoteSync: ContactRemoteSyncService,
  ) {}

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
    const updated = await this.contactService.update(user.id, id, dto);
    await this.mirrorToGoogle(user.id, id);
    return updated;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const removed = await this.contactService.remove(user.id, id);
    if (removed.googleResourceName) {
      await this.remoteSync.enqueueDelete(user.id, removed.googleResourceName);
    }
    return { id, deleted: true };
  }

  @Post(':id/identities')
  async addIdentity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddContactIdentityDto,
  ) {
    const updated = await this.contactService.addIdentity(user.id, id, dto);
    await this.mirrorToGoogle(user.id, id);
    return updated;
  }

  @Delete(':id/identities/:identityId')
  async removeIdentity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('identityId') identityId: string,
  ) {
    await this.contactService.removeIdentity(user.id, id, identityId);
    await this.mirrorToGoogle(user.id, id);
    return { id: identityId, deleted: true };
  }

  /** Queues the current state of a contact for Google, if that contact already lives in the Google address book. */
  private async mirrorToGoogle(userId: string, contactId: string): Promise<void> {
    const contact = await this.contactService.getById(userId, contactId);
    if (!contact.googleResourceName) return;
    const snapshot: RemoteContactSnapshot = {
      userId,
      googleResourceName: contact.googleResourceName,
      name: contact.name,
      company: contact.company ?? null,
      phones: contact.identities.filter((i) => i.type === 'whatsapp').map((i) => i.valueNormalized),
      emails: contact.identities.filter((i) => i.type === 'email').map((i) => i.valueNormalized),
    };
    await this.remoteSync.enqueueUpdate(snapshot);
  }
}

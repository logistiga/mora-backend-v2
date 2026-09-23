import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Contact, Prisma } from '../generated/prisma/client.js';
import { normalizeIdentityValue, type ContactIdentityType } from './contact.types.js';
import type { AddContactIdentityDto } from './dto/add-contact-identity.dto.js';
import type { CreateContactDto } from './dto/create-contact.dto.js';
import type { ListContactsQueryDto } from './dto/list-contacts.dto.js';
import type { UpdateContactDto } from './dto/update-contact.dto.js';

const LIST_LIMIT = 200;

@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateContactDto): Promise<Contact> {
    return this.prisma.contact.create({
      data: {
        userId,
        name: dto.name,
        firstName: dto.firstName,
        lastName: dto.lastName,
        company: dto.company,
        jobTitle: dto.jobTitle,
        scope: dto.scope,
        space: dto.space,
        relationship: dto.relationship,
        trustLevel: dto.trustLevel ?? 'unknown',
        notes: dto.notes,
        tags: dto.tags ?? [],
      },
    });
  }

  async list(userId: string, query: ListContactsQueryDto): Promise<Contact[]> {
    const where: Prisma.ContactWhereInput = { userId };
    if (query.scope) where.scope = query.scope;
    if (query.space) where.space = query.space;
    if (query.trustLevel) where.trustLevel = query.trustLevel;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { company: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.contact.findMany({ where, orderBy: { updatedAt: 'desc' }, take: LIST_LIMIT });
  }

  async getById(userId: string, id: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id }, include: { identities: true } });
    if (!contact) throw new NotFoundException('Contact not found');
    if (contact.userId !== userId) throw new ForbiddenException('This contact does not belong to you');
    return contact;
  }

  async update(userId: string, id: string, dto: UpdateContactDto): Promise<Contact> {
    await this.getById(userId, id);
    return this.prisma.contact.update({
      where: { id },
      data: {
        name: dto.name,
        company: dto.company,
        relationship: dto.relationship,
        trustLevel: dto.trustLevel,
        notes: dto.notes,
        tags: dto.tags,
      },
    });
  }

  /** A given WhatsApp number/email can only ever belong to one contact per user (AGENTS §22) — this is the actual reconciliation mechanism. */
  async addIdentity(userId: string, contactId: string, dto: AddContactIdentityDto) {
    await this.getById(userId, contactId);
    const valueNormalized = normalizeIdentityValue(dto.type, dto.value);

    const existing = await this.prisma.contactIdentity.findUnique({
      where: { userId_type_valueNormalized: { userId, type: dto.type, valueNormalized } },
    });
    if (existing && existing.contactId !== contactId) {
      throw new ConflictException('This identity is already attached to a different contact');
    }
    if (existing) return existing;

    return this.prisma.contactIdentity.create({
      data: { userId, contactId, type: dto.type, valueNormalized, displayValue: dto.value },
    });
  }

  /** Used by WhatsApp/Email inbound pipelines to resolve an incoming sender to a known contact (AGENTS §28/§36). */
  async findByIdentity(userId: string, type: ContactIdentityType, rawValue: string): Promise<Contact | null> {
    const valueNormalized = normalizeIdentityValue(type, rawValue);
    const identity = await this.prisma.contactIdentity.findUnique({
      where: { userId_type_valueNormalized: { userId, type, valueNormalized } },
      include: { contact: true },
    });
    return identity?.contact ?? null;
  }

  async touchLastInteraction(contactId: string): Promise<void> {
    await this.prisma.contact.update({ where: { id: contactId }, data: { lastInteractionAt: new Date() } });
  }
}

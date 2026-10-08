import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppSendToContactTool } from './whatsapp-send-to-contact.tool.js';

const context = { userId: 'u1', scope: 'personal', space: 'personal', route: 'personal' } as never;

function contact(id: string, name: string, trustLevel = 'known', company: string | null = null) {
  return { id, name, company, trustLevel };
}

describe('WhatsAppSendToContactTool', () => {
  let contactService: { list: ReturnType<typeof vi.fn> };
  let prisma: { contactIdentity: { findFirst: ReturnType<typeof vi.fn> } };
  let messageService: { sendToContact: ReturnType<typeof vi.fn> };
  let tool: WhatsAppSendToContactTool;

  beforeEach(() => {
    contactService = { list: vi.fn(async () => []) };
    prisma = { contactIdentity: { findFirst: vi.fn(async () => null) } };
    messageService = { sendToContact: vi.fn(async () => ({ id: 'm1' })) };
    tool = new WhatsAppSendToContactTool(prisma as never, contactService as never, messageService as never);
  });

  it('reports contact_not_found and sends nothing when no contact matches', async () => {
    const result = await tool.execute(context, { name: 'Mustapha', text: 'Bonjour' });

    expect(result).toMatchObject({ ok: false, errorCode: 'contact_not_found' });
    expect(messageService.sendToContact).not.toHaveBeenCalled();
  });

  it('reports contact_no_whatsapp when the only match has no WhatsApp number', async () => {
    contactService.list.mockResolvedValue([contact('c1', 'Mustapha')]);

    const result = await tool.execute(context, { name: 'Mustapha', text: 'Bonjour' });

    expect(result).toMatchObject({ ok: false, errorCode: 'contact_no_whatsapp' });
    expect(messageService.sendToContact).not.toHaveBeenCalled();
  });

  it('asks which contact to use when several contacts share the name, and sends nothing', async () => {
    contactService.list.mockResolvedValue([contact('c1', 'Mustapha', 'known', 'Logistiga'), contact('c2', 'Mustapha', 'known', 'Piston')]);
    prisma.contactIdentity.findFirst.mockImplementation(async ({ where }: { where: { contactId: string } }) => ({
      valueNormalized: where.contactId === 'c1' ? '+24101112233' : '+24104445566',
    }));

    const result = await tool.execute(context, { name: 'Mustapha', text: 'Bonjour' });

    expect(result).toMatchObject({ ok: false, errorCode: 'ambiguous_contact' });
    expect(result.data).toEqual({
      candidates: [
        { name: 'Mustapha', company: 'Logistiga', numberLast4: '2233' },
        { name: 'Mustapha', company: 'Piston', numberLast4: '5566' },
      ],
    });
    // Phone numbers stay out of what the assistant sees: only the last 4 digits.
    expect(JSON.stringify(result)).not.toContain('+24101112233');
    expect(messageService.sendToContact).not.toHaveBeenCalled();
  });

  it('prefers the exact name when a partial match also exists', async () => {
    contactService.list.mockResolvedValue([contact('c1', 'Mustapha Benali'), contact('c2', 'Mustapha')]);
    prisma.contactIdentity.findFirst.mockResolvedValue({ valueNormalized: '+24107778899' });

    const result = await tool.execute(context, { name: 'mustapha', text: 'Bonjour' });

    expect(result.ok).toBe(true);
    expect(messageService.sendToContact).toHaveBeenCalledWith('u1', 'c2', 'Bonjour');
  });

  it('sends to the single matching contact', async () => {
    contactService.list.mockResolvedValue([contact('c1', 'Mustapha Benali')]);
    prisma.contactIdentity.findFirst.mockResolvedValue({ valueNormalized: '+24107778899' });

    const result = await tool.execute(context, { name: 'Mustapha', text: 'Bonjour' });

    expect(result).toMatchObject({ ok: true, data: { sentTo: 'Mustapha Benali', numberLast4: '8899' } });
    expect(messageService.sendToContact).toHaveBeenCalledWith('u1', 'c1', 'Bonjour');
  });

  it('refuses a blocked contact', async () => {
    contactService.list.mockResolvedValue([contact('c1', 'Mustapha', 'blocked')]);
    prisma.contactIdentity.findFirst.mockResolvedValue({ valueNormalized: '+24107778899' });

    const result = await tool.execute(context, { name: 'Mustapha', text: 'Bonjour' });

    expect(result).toMatchObject({ ok: false, errorCode: 'contact_blocked' });
    expect(messageService.sendToContact).not.toHaveBeenCalled();
  });
});

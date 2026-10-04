import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { EvolutionWebhookDto } from './evolution-webhook.dto.js';

async function validateProductionStyle(body: unknown): Promise<string[]> {
  const instance = plainToInstance(EvolutionWebhookDto, body, { enableImplicitConversion: true });
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('EvolutionWebhookDto (production ValidationPipe rules)', () => {
  it('accepts a real Evolution v2.3.1 payload with its top-level metadata fields', async () => {
    const errors = await validateProductionStyle({
      event: 'messages.update',
      instance: 'Mora',
      data: { keyId: 'ABC', status: 'READ', remoteJid: '24162222111@s.whatsapp.net', fromMe: true },
      sender: '24161004434@s.whatsapp.net',
      date_time: '2026-10-04T21:00:00.000Z',
      server_url: 'https://whatsapp.logistiga.tech',
      destination: 'https://mora-v2-staging.logistiga.tech/api/v1/webhooks/whatsapp/x',
      apikey: 'not-logged',
    });
    expect(errors).toEqual([]);
  });

  it('still rejects an unknown field that Evolution does not send', async () => {
    const errors = await validateProductionStyle({ event: 'messages.update', data: {}, surprise: 'x' });
    expect(errors.join(' ')).toMatch(/surprise/);
  });

  it('still rejects a payload whose data is not an object', async () => {
    const errors = await validateProductionStyle({ event: 'messages.update', data: 'oops' });
    expect(errors.length).toBeGreaterThan(0);
  });
});

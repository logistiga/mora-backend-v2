import { describe, expect, it } from 'vitest';
import { buildGoogleContactBody } from './google-contacts-push.service.js';

describe('buildGoogleContactBody', () => {
  it('maps name, company, WhatsApp numbers and e-mails onto the People API fields', () => {
    expect(
      buildGoogleContactBody({
        name: '  Mustapha Benali ',
        company: 'Logistiga',
        identities: [
          { type: 'whatsapp', valueNormalized: '+24107778899' },
          { type: 'email', valueNormalized: 'm@example.com' },
        ],
      }),
    ).toEqual({
      names: [{ givenName: 'Mustapha Benali' }],
      organizations: [{ name: 'Logistiga' }],
      phoneNumbers: [{ value: '+24107778899' }],
      emailAddresses: [{ value: 'm@example.com' }],
    });
  });

  it('omits fields that are empty', () => {
    expect(buildGoogleContactBody({ name: 'Amina', company: null, identities: [] })).toEqual({
      names: [{ givenName: 'Amina' }],
    });
  });
});

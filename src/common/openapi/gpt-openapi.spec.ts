import { describe, expect, it } from 'vitest';
import {
  countOperations,
  GPT_OPERATIONS,
  selectGptOperations,
} from './gpt-openapi.util.js';

const fullDoc = {
  openapi: '3.0.0',
  components: {
    securitySchemes: {
      bearer: { type: 'http' },
      'api-key': { type: 'apiKey' },
    },
  },
  paths: {
    '/api/v1/whatsapp/messages': { get: {}, post: {} },
    '/api/v1/contacts': { get: {}, post: {} },
    '/api/v1/contacts/{id}': { get: {}, patch: {}, delete: {} },
    '/api/v1/google/account': { delete: {} },
    '/api/v1/webhooks/whatsapp/{accountId}': { post: {} },
    '/api/v1/skills': { get: {} },
  },
};

describe('selectGptOperations', () => {
  it('keeps only the allowed operations and drops deletes and webhooks', () => {
    const doc = selectGptOperations(fullDoc, 'api/v1');
    expect(doc.paths['/api/v1/whatsapp/messages']).toEqual({
      get: {},
      post: {},
    });
    expect(doc.paths['/api/v1/contacts/{id}']).toEqual({ get: {}, patch: {} });
    expect(doc.paths['/api/v1/google/account']).toBeUndefined();
    expect(doc.paths['/api/v1/webhooks/whatsapp/{accountId}']).toBeUndefined();
  });

  it('keeps the security schemes so the API key can be configured in ChatGPT', () => {
    const doc = selectGptOperations(fullDoc, 'api/v1');
    expect(
      Object.keys(
        (doc.components as { securitySchemes: object }).securitySchemes,
      ),
    ).toEqual(['bearer', 'api-key']);
  });

  it('stays within the action limit of a custom GPT', () => {
    expect(GPT_OPERATIONS.length).toBeLessThanOrEqual(30);
    expect(
      countOperations(selectGptOperations(fullDoc, 'api/v1')),
    ).toBeLessThanOrEqual(30);
  });

  it('never exposes a destructive operation', () => {
    expect(GPT_OPERATIONS.some(([method]) => method === 'delete')).toBe(false);
  });
});

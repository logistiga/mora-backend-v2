type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Operations exposed to a ChatGPT custom GPT. Custom GPTs accept a limited
 * number of actions, so only what the assistant needs is listed: WhatsApp,
 * Google (status, contacts, Docs), the calendar, contacts and skills. Deletes,
 * account creation, OAuth and webhooks are deliberately absent.
 */
export const GPT_OPERATIONS: ReadonlyArray<readonly [HttpMethod, string]> = [
  ['get', '/whatsapp/conversations'],
  ['get', '/whatsapp/conversations/{id}/messages'],
  ['get', '/whatsapp/messages'],
  ['get', '/whatsapp/messages/{id}'],
  ['post', '/whatsapp/messages'],
  ['get', '/google/status'],
  ['post', '/google/contacts/sync'],
  ['get', '/google/docs'],
  ['get', '/google/docs/{id}'],
  ['get', '/calendar/events'],
  ['get', '/calendar/events/{id}'],
  ['post', '/calendar/events'],
  ['post', '/calendar/events/{id}/cancel'],
  ['get', '/calendar/free-slots'],
  ['get', '/contacts'],
  ['get', '/contacts/{id}'],
  ['post', '/contacts'],
  ['post', '/contacts/{id}/identities'],
  ['patch', '/contacts/{id}'],
  ['get', '/skills'],
];

type PathItems = Record<string, Record<string, unknown>>;

/** Keeps only the allowed operations, under the global API prefix, and drops paths left empty. */
export function selectGptOperations<T extends { paths?: object }>(
  doc: T,
  prefix: string,
): T {
  const allowed = new Map<string, Set<string>>();
  for (const [method, path] of GPT_OPERATIONS) {
    const full = `/${prefix}${path}`;
    if (!allowed.has(full)) allowed.set(full, new Set());
    allowed.get(full)!.add(method);
  }

  const paths: PathItems = {};
  for (const [path, item] of Object.entries((doc.paths ?? {}) as PathItems)) {
    const methods = allowed.get(path);
    if (!methods) continue;
    const kept = Object.fromEntries(
      Object.entries(item).filter(([method]) => methods.has(method)),
    );
    if (Object.keys(kept).length > 0) paths[path] = kept;
  }
  return { ...doc, paths };
}

export function countOperations(doc: { paths?: object }): number {
  return Object.values((doc.paths ?? {}) as PathItems).reduce(
    (n, item) => n + Object.keys(item).length,
    0,
  );
}

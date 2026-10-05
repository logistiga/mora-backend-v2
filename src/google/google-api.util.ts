import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Calls a Google REST endpoint with the user's token. A 403 with "has not been
 * used ... or it is disabled" means the API is not enabled in the Google Cloud
 * project, which the user must fix; it is reported as such, not as a crash.
 */
export async function googleRequest<T>(
  url: string,
  accessToken: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 403 && /has not been used|is disabled/i.test(text)) {
      throw new ServiceUnavailableException('API Google désactivée dans le projet Google Cloud : activez-la puis réessayez.');
    }
    throw new ServiceUnavailableException(`Google API ${res.status}`);
  }
  return (await res.json()) as T;
}

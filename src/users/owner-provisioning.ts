import * as bcrypt from 'bcrypt';
import { UserRole } from '../generated/prisma/client.js';
import type { PrismaClient } from '../generated/prisma/client.js';

const BCRYPT_ROUNDS = 12;
export const MIN_OWNER_PASSWORD_LENGTH = 12;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface OwnerInput {
  email: string;
  password?: string;
  displayName?: string;
}

export interface OwnerResult {
  id: string;
  email: string;
  created: boolean;
  promoted: boolean;
}

/**
 * Mora v2 is a private, single-owner app with public sign-up disabled, so
 * the owner account is provisioned from the server side only (CLI, never an
 * HTTP route):
 * - no account with that email → created as ADMIN (password required);
 * - existing account → promoted to ADMIN and re-activated. Its password is
 *   left untouched, so re-running this never silently rotates credentials.
 */
export async function upsertOwner(
  prisma: Pick<PrismaClient, 'user'>,
  input: OwnerInput,
  hash: (value: string, rounds: number) => Promise<string> = bcrypt.hash,
): Promise<OwnerResult> {
  const email = input.email?.trim() ?? '';
  if (!EMAIL.test(email)) {
    throw new Error('MORA_OWNER_EMAIL must be a valid email address');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const promoted = existing.role !== UserRole.ADMIN;
    if (promoted || !existing.isActive) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: UserRole.ADMIN, isActive: true },
      });
    }
    return { id: existing.id, email, created: false, promoted };
  }

  if (!input.password || input.password.length < MIN_OWNER_PASSWORD_LENGTH) {
    throw new Error(
      `MORA_OWNER_PASSWORD is required to create the owner and must be at least ${MIN_OWNER_PASSWORD_LENGTH} characters`,
    );
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(input.password, BCRYPT_ROUNDS),
      displayName: input.displayName?.trim() || 'Owner',
      role: UserRole.ADMIN,
    },
  });
  return { id: user.id, email, created: true, promoted: true };
}

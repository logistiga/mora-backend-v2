/**
 * Creates or promotes the private owner account (role ADMIN). Server-side
 * only — there is deliberately no HTTP route for this.
 *
 *   dev:   MORA_OWNER_EMAIL=… MORA_OWNER_PASSWORD=… npm run owner:upsert
 *   image: docker compose … exec api npm run owner:upsert:prod
 *          (with MORA_OWNER_EMAIL / MORA_OWNER_PASSWORD in the environment)
 *
 * Never prints the password. The owner must log in again afterwards so the
 * new role is in their access token.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { upsertOwner } from '../users/owner-provisioning.js';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const result = await upsertOwner(prisma, {
      email: process.env.MORA_OWNER_EMAIL ?? '',
      password: process.env.MORA_OWNER_PASSWORD,
      displayName: process.env.MORA_OWNER_DISPLAY_NAME,
    });
    const action = result.created ? 'created' : result.promoted ? 'promoted to ADMIN' : 'already ADMIN';
    // eslint-disable-next-line no-console
    console.log(`Owner ${result.email} (${result.id}): ${action}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`owner:upsert failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

// Local/dev seeding only. Never put real personal information here.
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const email = 'dev.user@example.test';
  const passwordHash = await bcrypt.hash('dev-password-change-me', 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      displayName: 'Dev User',
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded user ${user.email} (${user.id})`);

  await prisma.$disconnect();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed', error);
  process.exit(1);
});

import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';

/** Creates (or returns) the Gmail mailbox that rides on the user's Google grant. */
@Injectable()
export class GoogleGmailAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: GoogleOAuthService,
  ) {}

  async connectMailbox(userId: string): Promise<{ id: string; address: string; provider: string }> {
    const status = await this.oauth.getStatus(userId);
    if (!status.connected || !status.googleEmail) {
      throw new BadRequestException('Connect a Google account first');
    }
    const existing = await this.prisma.emailAccount.findFirst({
      where: { userId, provider: 'gmail', address: status.googleEmail },
    });
    const account =
      existing ??
      (await this.prisma.emailAccount.create({
        data: {
          userId,
          label: `Gmail (${status.googleEmail})`,
          address: status.googleEmail,
          provider: 'gmail',
          status: 'configured',
        },
      }));
    return { id: account.id, address: account.address, provider: account.provider };
  }
}

import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { User } from '../generated/prisma/client.js';
import { CreateUserDto } from './dto/create-user.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    return this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: dto.passwordHash,
        displayName: dto.displayName,
      },
    });
  }
}

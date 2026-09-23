import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, Task } from '../generated/prisma/client.js';
import type { CreateTaskDto } from './dto/create-task.dto.js';
import type { ListTasksQueryDto } from './dto/list-tasks.dto.js';
import type { UpdateTaskDto } from './dto/update-task.dto.js';

const LIST_LIMIT = 100;

/**
 * Every method takes `userId` explicitly and every query/mutation is scoped
 * by it — there is no "list all tasks" path. `userId` always comes from the
 * authenticated request (CurrentUser decorator) or from ToolContext (which
 * itself is only ever built server-side from the authenticated user), never
 * from client-supplied input (AGENTS Phase D §13).
 */
@Injectable()
export class TaskService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    dto: CreateTaskDto,
    source: 'manual' | 'tool' = 'manual',
    sourceConversationId?: string,
  ): Promise<Task> {
    return this.prisma.task.create({
      data: {
        userId,
        scope: dto.scope,
        space: dto.space,
        title: dto.title,
        description: dto.description,
        priority: dto.priority ?? 'normal',
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        source,
        sourceConversationId,
      },
    });
  }

  async list(userId: string, query: ListTasksQueryDto): Promise<Task[]> {
    const where: Prisma.TaskWhereInput = { userId };
    if (query.scope) where.scope = query.scope;
    if (query.space) where.space = query.space;
    if (query.status) where.status = query.status;

    return this.prisma.task.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: LIST_LIMIT,
    });
  }

  async getById(userId: string, id: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.userId !== userId) throw new ForbiddenException('This task does not belong to you');
    return task;
  }

  async update(userId: string, id: string, dto: UpdateTaskDto): Promise<Task> {
    await this.getById(userId, id);
    return this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        priority: dto.priority,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        completedAt: dto.status === 'completed' ? new Date() : undefined,
      },
    });
  }

  async complete(userId: string, id: string): Promise<Task> {
    await this.getById(userId, id);
    return this.prisma.task.update({
      where: { id },
      data: { status: 'completed', completedAt: new Date() },
    });
  }

  async cancel(userId: string, id: string): Promise<Task> {
    await this.getById(userId, id);
    return this.prisma.task.update({ where: { id }, data: { status: 'cancelled' } });
  }
}

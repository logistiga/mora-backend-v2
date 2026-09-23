import { Injectable } from '@nestjs/common';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '../../tasks/task.types.js';
import { TaskService } from '../../tasks/task.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class UpdateTaskInput {
  @IsUUID()
  taskId: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}

@Injectable()
export class UpdateTaskTool implements MoraTool<UpdateTaskInput> {
  readonly name = 'update_task';
  readonly description = "Modifie une tâche existante de l'utilisateur.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      taskId: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string', enum: TASK_STATUSES },
      priority: { type: 'string', enum: TASK_PRIORITIES },
      dueAt: { type: 'string' },
    },
    required: ['taskId'],
    additionalProperties: false as const,
  };

  constructor(private readonly taskService: TaskService) {}

  validate(input: unknown): ToolValidationResult<UpdateTaskInput> {
    return validateWithDto(UpdateTaskInput, input);
  }

  async execute(context: ToolContext, input: UpdateTaskInput): Promise<ToolResult> {
    const existing = await this.taskService.getById(context.userId, input.taskId);
    if (existing.scope !== context.scope || existing.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch', errorMessage: 'Task is outside this conversation\'s scope/space' };
    }
    const updated = await this.taskService.update(context.userId, input.taskId, {
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      dueAt: input.dueAt,
    });
    return { ok: true, data: updated };
  }
}

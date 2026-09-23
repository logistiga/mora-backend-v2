import { Injectable } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { TASK_STATUSES, type TaskStatus } from '../../tasks/task.types.js';
import { TaskService } from '../../tasks/task.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class ListTasksInput {
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;
}

@Injectable()
export class ListTasksTool implements MoraTool<ListTasksInput> {
  readonly name = 'list_tasks';
  readonly description = "Liste les tâches de l'utilisateur dans le scope/space de la conversation en cours.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { status: { type: 'string', enum: TASK_STATUSES } },
    additionalProperties: false as const,
  };

  constructor(private readonly taskService: TaskService) {}

  validate(input: unknown): ToolValidationResult<ListTasksInput> {
    return validateWithDto(ListTasksInput, input);
  }

  async execute(context: ToolContext, input: ListTasksInput): Promise<ToolResult> {
    const tasks = await this.taskService.list(context.userId, {
      scope: context.scope,
      space: context.space,
      status: input.status,
    });
    return { ok: true, data: tasks };
  }
}

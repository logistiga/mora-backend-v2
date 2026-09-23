import { Injectable } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { TaskService } from '../../tasks/task.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class CompleteTaskInput {
  @IsUUID()
  taskId: string;
}

@Injectable()
export class CompleteTaskTool implements MoraTool<CompleteTaskInput> {
  readonly name = 'complete_task';
  readonly description = "Marque une tâche de l'utilisateur comme terminée.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { taskId: { type: 'string', format: 'uuid' } },
    required: ['taskId'],
    additionalProperties: false as const,
  };

  constructor(private readonly taskService: TaskService) {}

  validate(input: unknown): ToolValidationResult<CompleteTaskInput> {
    return validateWithDto(CompleteTaskInput, input);
  }

  async execute(context: ToolContext, input: CompleteTaskInput): Promise<ToolResult> {
    const existing = await this.taskService.getById(context.userId, input.taskId);
    if (existing.scope !== context.scope || existing.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch', errorMessage: 'Task is outside this conversation\'s scope/space' };
    }
    const completed = await this.taskService.complete(context.userId, input.taskId);
    return { ok: true, data: completed };
  }
}

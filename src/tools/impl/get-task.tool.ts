import { Injectable } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { TaskService } from '../../tasks/task.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class GetTaskInput {
  @IsUUID()
  taskId: string;
}

@Injectable()
export class GetTaskTool implements MoraTool<GetTaskInput> {
  readonly name = 'get_task';
  readonly description = 'Récupère une tâche précise par son id.';
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { taskId: { type: 'string', format: 'uuid' } },
    required: ['taskId'],
    additionalProperties: false as const,
  };

  constructor(private readonly taskService: TaskService) {}

  validate(input: unknown): ToolValidationResult<GetTaskInput> {
    return validateWithDto(GetTaskInput, input);
  }

  async execute(context: ToolContext, input: GetTaskInput): Promise<ToolResult> {
    const task = await this.taskService.getById(context.userId, input.taskId);
    // Ownership alone isn't enough: a Personal conversation must not read a
    // Professional task even for the same user (AGENTS Phase D §28).
    if (task.scope !== context.scope || task.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch', errorMessage: 'Task is outside this conversation\'s scope/space' };
    }
    return { ok: true, data: task };
  }
}

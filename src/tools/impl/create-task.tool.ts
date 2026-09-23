import { Injectable } from '@nestjs/common';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TASK_PRIORITIES, type TaskPriority } from '../../tasks/task.types.js';
import { TaskService } from '../../tasks/task.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

// scope/space are intentionally NOT part of the tool's input schema: they
// always come from ToolContext (the conversation's own routed scope/space),
// never from LLM-supplied arguments — this is what makes cross-scope
// hopping structurally impossible for this tool, not just policy (AGENTS
// Phase D §6, §28).
class CreateTaskInput {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}

@Injectable()
export class CreateTaskTool implements MoraTool<CreateTaskInput> {
  readonly name = 'create_task';
  readonly description = 'Crée une nouvelle tâche pour l\'utilisateur, dans le scope/space de la conversation en cours.';
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Titre court de la tâche' },
      description: { type: 'string', description: 'Détails optionnels' },
      priority: { type: 'string', enum: TASK_PRIORITIES },
      dueAt: { type: 'string', description: 'Date/heure ISO 8601, optionnelle' },
    },
    required: ['title'],
    additionalProperties: false as const,
  };

  constructor(private readonly taskService: TaskService) {}

  validate(input: unknown): ToolValidationResult<CreateTaskInput> {
    return validateWithDto(CreateTaskInput, input);
  }

  async execute(context: ToolContext, input: CreateTaskInput): Promise<ToolResult> {
    const task = await this.taskService.create(
      context.userId,
      {
        scope: context.scope,
        space: context.space,
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueAt: input.dueAt,
      },
      'tool',
      context.conversationId,
    );
    return { ok: true, data: task };
  }
}

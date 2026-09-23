import { Module, type OnModuleInit } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { RemindersModule } from '../reminders/reminders.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { CancelReminderTool } from './impl/cancel-reminder.tool.js';
import { CompleteTaskTool } from './impl/complete-task.tool.js';
import { CreateReminderTool } from './impl/create-reminder.tool.js';
import { CreateTaskTool } from './impl/create-task.tool.js';
import { DraftActionTool } from './impl/draft-action.tool.js';
import { GetProfileFactsTool } from './impl/get-profile-facts.tool.js';
import { GetTaskTool } from './impl/get-task.tool.js';
import { ListPendingActionsTool } from './impl/list-pending-actions.tool.js';
import { ListRemindersTool } from './impl/list-reminders.tool.js';
import { ListTasksTool } from './impl/list-tasks.tool.js';
import { SearchMemoriesTool } from './impl/search-memories.tool.js';
import { UpdateTaskTool } from './impl/update-task.tool.js';
import { PermissionService } from './permission.service.js';
import { ToolExecutorService } from './tool-executor.service.js';
import { ToolRegistryService } from './tool-registry.service.js';
import { ToolsController } from './tools.controller.js';
import type { MoraTool } from './tool.types.js';

const TOOL_PROVIDERS = [
  CreateTaskTool,
  ListTasksTool,
  GetTaskTool,
  UpdateTaskTool,
  CompleteTaskTool,
  CreateReminderTool,
  ListRemindersTool,
  CancelReminderTool,
  SearchMemoriesTool,
  GetProfileFactsTool,
  ListPendingActionsTool,
  DraftActionTool,
];

/**
 * Owns the Tool Registry and every concrete MoraTool implementation for
 * Phase D. Every tool registers itself here at module init (see
 * onModuleInit below) — nothing outside this module constructs a tool
 * instance directly, so ToolRegistryService.list()/get() is always the
 * single source of truth for "what tools exist" (AGENTS Phase D §4).
 */
@Module({
  imports: [
    TasksModule,
    RemindersModule,
    MemoryModule,
    AuditModule,
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
  ],
  controllers: [ToolsController],
  providers: [ToolRegistryService, PermissionService, ToolExecutorService, ...TOOL_PROVIDERS],
  exports: [ToolRegistryService, PermissionService, ToolExecutorService],
})
export class ToolsModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly createTaskTool: CreateTaskTool,
    private readonly listTasksTool: ListTasksTool,
    private readonly getTaskTool: GetTaskTool,
    private readonly updateTaskTool: UpdateTaskTool,
    private readonly completeTaskTool: CompleteTaskTool,
    private readonly createReminderTool: CreateReminderTool,
    private readonly listRemindersTool: ListRemindersTool,
    private readonly cancelReminderTool: CancelReminderTool,
    private readonly searchMemoriesTool: SearchMemoriesTool,
    private readonly getProfileFactsTool: GetProfileFactsTool,
    private readonly listPendingActionsTool: ListPendingActionsTool,
    private readonly draftActionTool: DraftActionTool,
  ) {}

  onModuleInit(): void {
    const tools: MoraTool[] = [
      this.createTaskTool,
      this.listTasksTool,
      this.getTaskTool,
      this.updateTaskTool,
      this.completeTaskTool,
      this.createReminderTool,
      this.listRemindersTool,
      this.cancelReminderTool,
      this.searchMemoriesTool,
      this.getProfileFactsTool,
      this.listPendingActionsTool,
      this.draftActionTool,
    ];
    for (const tool of tools) {
      this.registry.register(tool);
    }
  }
}

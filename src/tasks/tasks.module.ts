import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TaskService } from './task.service.js';
import { TasksController } from './tasks.controller.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' })],
  controllers: [TasksController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TasksModule {}

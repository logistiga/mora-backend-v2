import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { WhatsAppMissionService } from './whatsapp-mission.service.js';
import {
  MISSION_SWEEP_EVERY_MS,
  MISSION_SWEEP_JOB,
  MISSION_SWEEP_SCHEDULER_ID,
  MISSION_TURN_JOB,
  WHATSAPP_MISSION_QUEUE,
} from './whatsapp-mission.constants.js';

/**
 * Handles mission turns and the periodic deadline sweep. Concurrency is 1 so
 * two replies from the same contact can never run two turns at once.
 */
@Processor(WHATSAPP_MISSION_QUEUE, { concurrency: 1 })
export class WhatsAppMissionProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppMissionProcessor.name);

  constructor(
    @InjectQueue(WHATSAPP_MISSION_QUEUE) private readonly queue: Queue,
    private readonly missions: WhatsAppMissionService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(MISSION_SWEEP_SCHEDULER_ID, { every: MISSION_SWEEP_EVERY_MS }, { name: MISSION_SWEEP_JOB });
  }

  async process(job: Job<{ conversationId?: string }>): Promise<void> {
    if (job.name === MISSION_SWEEP_JOB) {
      await this.missions.sweep();
      return;
    }
    if (job.name === MISSION_TURN_JOB && job.data.conversationId) {
      try {
        await this.missions.runTurn(job.data.conversationId);
      } catch (error) {
        this.logger.warn(`WhatsApp mission turn failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        throw error;
      }
    }
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ConversationSummaryService } from '../../conversation-summary.service.js';
import {
  CONVERSATION_SUMMARY_QUEUE,
  type ConversationSummaryJobData,
} from '../memory-queue.constants.js';

@Processor(CONVERSATION_SUMMARY_QUEUE)
export class ConversationSummaryProcessor extends WorkerHost {
  private readonly logger = new Logger(ConversationSummaryProcessor.name);

  constructor(private readonly summaryService: ConversationSummaryService) {
    super();
  }

  async process(job: Job<ConversationSummaryJobData>): Promise<{ summarized: boolean }> {
    const { conversationId, userId, scope, space } = job.data;
    const result = await this.summaryService.summarize(conversationId, userId, scope, space);
    this.logger.debug(`Conversation summary for ${conversationId} (${scope}/${space}): ${result ? 'updated' : 'skipped'}`);
    return { summarized: Boolean(result) };
  }
}

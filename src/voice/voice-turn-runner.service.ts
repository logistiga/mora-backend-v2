import { Injectable, Logger } from '@nestjs/common';
import { MoraOrchestratorService } from '../orchestrator/mora-orchestrator.service.js';
import { PendingActionService } from '../pending-actions/pending-action.service.js';
import { UsersService } from '../users/users.service.js';
import { VoiceConfirmationService } from './voice-confirmation.service.js';
import { VoiceProviderFactoryService } from './providers/voice-provider-factory.service.js';
import { VoiceProfileService } from './voice-profile.service.js';
import { VoiceTurnService } from './voice-turn.service.js';
import { splitIntoSentenceChunks } from './tts/sentence-buffer.util.js';
import type { VoiceRuntimeState } from './voice-runtime.registry.js';
import type { VoiceTurnLatency } from './voice.types.js';

export interface VoiceTurnEvents {
  onAssistantThinkingStarted(): void;
  onAssistantSpeakingStarted(): void;
  onAudioChunk(chunk: Buffer): void;
  onAssistantSpeakingEnded(): void;
  onPendingConfirmation(payload: { pendingActionId: string; tool: string; securityLevel: string; summary: string }): void;
  onActionExecuted(payload: { pendingActionId: string; toolName: string }): void;
  onClarificationNeeded(payload: { candidateCount: number }): void;
  onLatencyMetrics(payload: VoiceTurnLatency): void;
  onError(code: string, message: string): void;
}

/**
 * The core Phase F integration point (AGENTS §0, §18-§20): runs ONE voice
 * turn by calling the EXISTING MoraOrchestratorService.handleMessage()
 * unmodified — no parallel routing/memory/document/tool logic is built
 * here. Voice-specific work is limited to (a) binding a spoken "oui"/"non"
 * to the session's currently open pendingActionId, never guessing across
 * multiple, and (b) streaming the returned response text out through TTS.
 */
@Injectable()
export class VoiceTurnRunnerService {
  private readonly logger = new Logger(VoiceTurnRunnerService.name);

  constructor(
    private readonly orchestrator: MoraOrchestratorService,
    private readonly usersService: UsersService,
    private readonly pendingActionService: PendingActionService,
    private readonly confirmationService: VoiceConfirmationService,
    private readonly providerFactory: VoiceProviderFactoryService,
    private readonly voiceProfileService: VoiceProfileService,
    private readonly voiceTurnService: VoiceTurnService,
  ) {}

  async run(
    state: VoiceRuntimeState,
    turnId: string,
    transcript: string,
    latencySoFar: VoiceTurnLatency,
    events: VoiceTurnEvents,
  ): Promise<void> {
    const turnStarted = Date.now();

    if (!transcript.trim()) {
      await this.voiceTurnService.fail(turnId, 'empty_transcript');
      return;
    }

    // --- Confirmation binding (AGENTS §23) -------------------------------
    if (state.openPendingActionIds.size > 0) {
      const intent = this.confirmationService.classify(transcript);
      if (intent === 'affirm' || intent === 'deny') {
        if (state.openPendingActionIds.size > 1) {
          // Never guess which one — ask for clarification instead (AGENTS §23,
          // explicit test: two pending actions + "oui" must never approve both).
          events.onClarificationNeeded({ candidateCount: state.openPendingActionIds.size });
          await this.voiceTurnService.complete(turnId, {
            transcript,
            responseText: 'Vous avez plusieurs actions en attente. Laquelle voulez-vous confirmer ?',
            latency: latencySoFar,
          });
          return;
        }

        const [pendingActionId] = [...state.openPendingActionIds];
        state.openPendingActionIds.delete(pendingActionId);

        if (intent === 'affirm') {
          const outcome = await this.pendingActionService.approve(state.userId, pendingActionId);
          if (outcome.status === 'executed') {
            events.onActionExecuted({ pendingActionId, toolName: outcome.pendingAction.toolName });
            await this.speak(
              state,
              outcome.toolResultOk ? "C'est fait." : "L'action a échoué.",
              events,
              latencySoFar,
            );
            await this.voiceTurnService.complete(turnId, {
              transcript,
              responseText: outcome.toolResultOk ? "C'est fait." : "L'action a échoué.",
              pendingActionId,
              latency: latencySoFar,
            });
          } else {
            await this.speak(state, 'Cette action a déjà été traitée ou a expiré.', events, latencySoFar);
            await this.voiceTurnService.complete(turnId, {
              transcript,
              responseText: 'Cette action a déjà été traitée ou a expiré.',
              pendingActionId,
              latency: latencySoFar,
            });
          }
        } else {
          await this.pendingActionService.reject(state.userId, pendingActionId);
          await this.speak(state, "D'accord, j'annule.", events, latencySoFar);
          await this.voiceTurnService.complete(turnId, {
            transcript,
            responseText: "D'accord, j'annule.",
            pendingActionId,
            latency: latencySoFar,
          });
        }
        return;
      }
      // intent === 'none': fall through to a normal new message below.
    }

    // --- Normal turn: full reuse of the existing Orchestrator -----------
    events.onAssistantThinkingStarted();
    const fullUser = await this.usersService.findById(state.userId);
    const llmStarted = Date.now();

    let result;
    try {
      result = await this.orchestrator.handleMessage({
        user: { id: state.userId, email: fullUser?.email ?? '', displayName: fullUser?.displayName ?? 'Utilisateur' },
        message: transcript,
        conversationId: state.conversationId,
      });
    } catch (error) {
      this.logger.error(`Orchestrator call failed for voice turn ${turnId}: ${String(error)}`);
      events.onError('orchestrator_failed', "Une erreur est survenue.");
      await this.voiceTurnService.fail(turnId, 'orchestrator_failed');
      return;
    }
    const llmLatencyMs = Date.now() - llmStarted;

    if (result.action?.type === 'confirmation_required') {
      state.openPendingActionIds.add(result.action.pendingActionId);
      events.onPendingConfirmation({
        pendingActionId: result.action.pendingActionId,
        tool: result.action.tool,
        securityLevel: result.action.securityLevel,
        summary: result.action.summary,
      });
    }

    const latency: VoiceTurnLatency = { ...latencySoFar, llmLatencyMs };
    await this.speak(state, result.response, events, latency);

    latency.totalLatencyMs = Date.now() - turnStarted;
    events.onLatencyMetrics(latency);

    await this.voiceTurnService.complete(turnId, {
      transcript,
      responseText: result.response,
      pendingActionId: result.action?.pendingActionId,
      latency,
    });
  }

  /** Streams `text` out via TTS, sentence by sentence, honoring interruption (barge-in). */
  private async speak(
    state: VoiceRuntimeState,
    text: string,
    events: VoiceTurnEvents,
    latency: VoiceTurnLatency,
  ): Promise<void> {
    const tts = await this.providerFactory.createTts(state.userId, { scope: state.scope, space: state.space });
    if (!tts) {
      // No TTS configured — still return the text via transcript.final /
      // response text already sent; the client can read it, but there is no
      // audio (honest degradation, AGENTS §33/§Phase F §33).
      this.logger.warn(`No TTS provider available for user ${state.userId}; response returned as text only`);
      return;
    }

    const profile = await this.voiceProfileService.getDefault(state.userId);
    const voiceId = profile?.voiceId ?? 'alloy';
    const speed = profile?.speed ?? 1.0;

    const controller = new AbortController();
    state.ttsAbortController = controller;

    events.onAssistantSpeakingStarted();
    const chunks = splitIntoSentenceChunks(text);
    const speakStarted = Date.now();
    let firstByteRecorded = false;

    try {
      for (const chunk of chunks) {
        if (controller.signal.aborted) break;
        for await (const audioChunk of tts.synthesizeStream({
          text: chunk,
          voiceId,
          language: state.language,
          speed,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) break;
          if (!firstByteRecorded) {
            latency.ttsFirstByteMs = Date.now() - speakStarted;
            firstByteRecorded = true;
          }
          events.onAudioChunk(audioChunk);
        }
        if (controller.signal.aborted) break;
      }
    } finally {
      if (state.ttsAbortController === controller) state.ttsAbortController = null;
      events.onAssistantSpeakingEnded();
    }
  }
}

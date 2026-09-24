import { Injectable, Logger } from '@nestjs/common';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MoraOrchestratorService } from '../orchestrator/mora-orchestrator.service.js';
import { PendingActionService } from '../pending-actions/pending-action.service.js';
import { UsersService } from '../users/users.service.js';
import { VoiceConfirmationService } from './voice-confirmation.service.js';
import { VoiceProviderFactoryService } from './providers/voice-provider-factory.service.js';
import { VoiceProfileService } from './voice-profile.service.js';
import { VoiceTurnService } from './voice-turn.service.js';
import { splitIntoSentenceChunks } from './tts/sentence-buffer.util.js';
import { voiceDebug } from './voice-debug-log.util.js';
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
 *
 * CONCURRENCY (Phase G real-mic bug fix): every entry point takes the
 * `generationId` the caller (VoiceGateway) minted for THIS turn. Before any
 * externally-visible effect (emitting an event, calling speak(), completing
 * the VoiceTurn row), the code re-checks `state.generationId === generationId`.
 * If a NEWER turn has started in the meantime (the caller bumped the
 * generation), this run is stale and silently abandons itself — it must
 * never emit audio, never mark a turn "completed" over a fresher one, and
 * never let a late Orchestrator/TTS response reach the client. This is what
 * guarantees at most one active assistant generation per session.
 */
@Injectable()
export class VoiceTurnRunnerService {
  private readonly logger = new Logger(VoiceTurnRunnerService.name);

  constructor(
    private readonly orchestrator: MoraOrchestratorService,
    private readonly usersService: UsersService,
    private readonly pendingActionService: PendingActionService,
    private readonly conversationsService: ConversationsService,
    private readonly confirmationService: VoiceConfirmationService,
    private readonly providerFactory: VoiceProviderFactoryService,
    private readonly voiceProfileService: VoiceProfileService,
    private readonly voiceTurnService: VoiceTurnService,
  ) {}

  async run(
    state: VoiceRuntimeState,
    turnId: string,
    generationId: string,
    transcript: string,
    latencySoFar: VoiceTurnLatency,
    events: VoiceTurnEvents,
  ): Promise<void> {
    const turnStarted = Date.now();
    const isStale = () => state.generationId !== generationId;
    const recentInterruption = state.recentInterruption;
    state.recentInterruption = false;

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
          if (isStale()) return;
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
          // approve() has real side effects (tool execution) regardless of
          // staleness — that part must never be skipped or duplicated. Only
          // the SPEAKING/completion of a stale generation's turn is guarded.
          if (outcome.status === 'executed') {
            if (!isStale()) events.onActionExecuted({ pendingActionId, toolName: outcome.pendingAction.toolName });
            const responseText = outcome.toolResultOk ? "C'est fait." : "L'action a échoué.";
            if (!isStale()) await this.speak(state, generationId, responseText, events, latencySoFar);
            await this.voiceTurnService.complete(turnId, { transcript, responseText, pendingActionId, latency: latencySoFar });
          } else {
            const responseText = 'Cette action a déjà été traitée ou a expiré.';
            if (!isStale()) await this.speak(state, generationId, responseText, events, latencySoFar);
            await this.voiceTurnService.complete(turnId, { transcript, responseText, pendingActionId, latency: latencySoFar });
          }
        } else {
          await this.pendingActionService.reject(state.userId, pendingActionId);
          const responseText = "D'accord, j'annule.";
          if (!isStale()) await this.speak(state, generationId, responseText, events, latencySoFar);
          await this.voiceTurnService.complete(turnId, { transcript, responseText, pendingActionId, latency: latencySoFar });
        }
        return;
      }
      // intent === 'none': fall through to a normal new message below.
    }

    // --- Normal turn: full reuse of the existing Orchestrator -----------
    if (!isStale()) events.onAssistantThinkingStarted();
    const fullUser = await this.usersService.findById(state.userId);
    const llmStarted = Date.now();

    let result;
    try {
      result = await this.orchestrator.handleMessage({
        user: { id: state.userId, email: fullUser?.email ?? '', displayName: fullUser?.displayName ?? 'Utilisateur' },
        message: transcript,
        conversationId: state.conversationId,
        channel: 'voice',
        recentInterruption,
      });
    } catch (error) {
      this.logger.error(`Orchestrator call failed for voice turn ${turnId}: ${String(error)}`);
      if (!isStale()) events.onError('orchestrator_failed', 'Une erreur est survenue.');
      await this.voiceTurnService.fail(turnId, 'orchestrator_failed');
      return;
    }
    const llmLatencyMs = Date.now() - llmStarted;
    state.currentAssistantMessageId = result.messageId;
    state.currentPendingActionId = result.action?.type === 'confirmation_required' ? result.action.pendingActionId : null;

    // A NEWER turn may have started while we were awaiting the Orchestrator
    // (e.g. the user barged in). The Orchestrator call itself already ran
    // and its side effects (message persistence, tool execution) already
    // happened — that cannot be undone and is correct either way — but this
    // stale response must never be spoken or presented as the "current" one.
    if (isStale()) {
      voiceDebug('stale_generation_abandoned', {
        sessionId: state.sessionId,
        turnId,
        capturedGenerationId: generationId,
        currentGenerationId: state.generationId,
        stage: 'orchestrator_result',
      });
      if (result.action?.type === 'confirmation_required') {
        await this.pendingActionService.cancel(state.userId, result.action.pendingActionId, 'voice_interrupted');
      }
      await this.conversationsService.markMessageInterrupted(result.messageId, {
        channel: 'voice',
        turnId,
        interruptedStage: 'orchestrator_result',
      });
      state.currentAssistantMessageId = null;
      state.currentPendingActionId = null;
      await this.voiceTurnService.interrupt(turnId);
      return;
    }

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
    await this.speak(state, generationId, result.response, events, latency);

    latency.totalLatencyMs = Date.now() - turnStarted;
    if (!isStale()) events.onLatencyMetrics(latency);

    await this.voiceTurnService.complete(turnId, {
      transcript,
      responseText: result.response,
      pendingActionId: result.action?.pendingActionId,
      latency,
    });
    state.currentAssistantMessageId = null;
    state.currentPendingActionId = null;
  }

  /**
   * Streams `text` out via TTS, sentence by sentence, honoring interruption
   * (barge-in). `generationId` is re-checked before every single chunk —
   * belt-and-suspenders alongside the AbortController: even if a TTS
   * provider kept streaming bytes after abort() (a slow/misbehaving
   * provider), a chunk whose generation is no longer current is dropped
   * and never reaches `events.onAudioChunk`.
   */
  private async speak(
    state: VoiceRuntimeState,
    generationId: string,
    text: string,
    events: VoiceTurnEvents,
    latency: VoiceTurnLatency,
  ): Promise<void> {
    const isStale = () => state.generationId !== generationId;
    if (isStale()) return;

    const tts = await this.providerFactory.createTts(state.userId, { scope: state.scope, space: state.space });
    if (!tts) {
      // No TTS configured — still return the text via transcript.final /
      // response text already sent; the client can read it, but there is no
      // audio (honest degradation, AGENTS §33/§Phase F §33).
      this.logger.warn(`No TTS provider available for user ${state.userId}; response returned as text only`);
      return;
    }
    if (isStale()) return; // superseded while awaiting the profile/provider lookup above

    const profile = await this.voiceProfileService.getDefault(state.userId);
    const voiceId = profile?.voiceId ?? 'alloy';
    const speed = profile?.speed ?? 1.0;
    if (isStale()) return;

    const controller = new AbortController();
    state.ttsAbortController = controller;

    events.onAssistantSpeakingStarted();
    const chunks = splitIntoSentenceChunks(text);
    const speakStarted = Date.now();
    let firstByteRecorded = false;

    let droppedChunkCount = 0;
    try {
      for (const chunk of chunks) {
        if (controller.signal.aborted || isStale()) break;
        for await (const audioChunk of tts.synthesizeStream({
          text: chunk,
          voiceId,
          language: state.language,
          speed,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted || isStale()) {
            // drop any chunk from a superseded generation, no matter what the provider still sends
            droppedChunkCount += 1;
            break;
          }
          if (!firstByteRecorded) {
            latency.ttsFirstByteMs = Date.now() - speakStarted;
            firstByteRecorded = true;
          }
          events.onAudioChunk(audioChunk);
        }
        if (controller.signal.aborted || isStale()) break;
      }
    } finally {
      if (droppedChunkCount > 0) {
        voiceDebug('stale_chunk_dropped', { sessionId: state.sessionId, generationId, currentGenerationId: state.generationId, droppedChunkCount });
      }
      if (state.ttsAbortController === controller) state.ttsAbortController = null;
      if (!isStale()) events.onAssistantSpeakingEnded();
    }
  }
}

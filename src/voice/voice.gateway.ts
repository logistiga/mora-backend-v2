import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AvatarStateService } from '../avatar/avatar-state.service.js';
import type { AvatarChannel, AvatarState } from '../avatar/avatar.types.js';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { AppConfig } from '../config/configuration.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import type { JwtAccessPayload } from '../auth/entities/token-payload.interface.js';
import { EndOfTurnService } from './vad/end-of-turn.service.js';
import { VoiceProviderFactoryService } from './providers/voice-provider-factory.service.js';
import { PRE_SPEECH_BUFFER_FRAMES, VoiceRuntimeRegistry } from './voice-runtime.registry.js';
import { VoiceSessionService } from './voice-session.service.js';
import { VoiceTurnRunnerService, type VoiceTurnEvents } from './voice-turn-runner.service.js';
import { VoiceTurnService } from './voice-turn.service.js';
import { PendingActionService } from '../pending-actions/pending-action.service.js';
import { voiceDebug } from './voice-debug-log.util.js';
import { VOICE_AUDIO_FORMAT, VOICE_PROTOCOL_VERSION, type ClientToServerEventType } from './voice.types.js';

const MAX_FRAME_BYTES = 32 * 1024; // one PCM16 frame must never approach this — real frames are a few KB
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // no client activity for 10 min -> close (AGENTS §26)
const RECONNECTABLE_SESSION_STATES = new Set([
  'listening',
  'paused',
  'thinking',
  'assistant_speaking',
  'transcribing',
  'interrupted',
  'user_speaking',
]);

interface ServerEvent {
  event: string;
  data?: unknown;
}

/**
 * Native WebSocket transport (AGENTS Phase F §5 — see the Phase F report for
 * the full justification: Socket.IO's rooms/fallback-transport machinery
 * and WebRTC/LiveKit's media-server complexity are unnecessary for a single
 * bidirectional audio+event stream between one browser tab and this
 * backend; a raw `ws` server is the simplest transport that is robust
 * enough for the MVP, wrapped behind `VoiceTransportInterface`-shaped
 * methods here so a future WebRTC/LiveKit transport can replace this file
 * without touching VoiceSessionService/VoiceTurnRunnerService/etc).
 *
 * Implemented as a plain Nest provider attaching a `ws.Server` to the
 * existing HTTP server (not `@nestjs/websockets` decorators) because this
 * protocol mixes JSON control frames and raw binary PCM16 audio frames on
 * the same socket — the decorator-based adapter assumes JSON-only framing.
 */
@Injectable()
export class VoiceGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceGateway.name);
  private wss?: WebSocketServer;
  private readonly sockets = new Map<string, WebSocket>(); // sessionId -> socket

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly sessionService: VoiceSessionService,
    private readonly turnService: VoiceTurnService,
    private readonly runtimeRegistry: VoiceRuntimeRegistry,
    private readonly turnRunner: VoiceTurnRunnerService,
    private readonly providerFactory: VoiceProviderFactoryService,
    private readonly endOfTurn: EndOfTurnService,
    private readonly conversationsService: ConversationsService,
    private readonly pendingActionService: PendingActionService,
    private readonly avatarState: AvatarStateService,
  ) {}

  onModuleInit(): void {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocketServer({ server: httpServer, path: '/voice/ws' });
    this.wss.on('connection', (socket, request) => this.handleConnection(socket, request));
    this.logger.log('Voice WebSocket gateway attached at /voice/ws');
  }

  onModuleDestroy(): void {
    this.wss?.close();
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const auth = this.authenticate(request);
    if (!auth) {
      socket.close(4001, 'unauthorized');
      return;
    }
    const connectionId = randomUUID();
    voiceDebug('websocket_connected', { connectionId, userId: auth.userId });

    let sessionId: string | null = null;
    let lastActivityAt = Date.now();
    const idleCheck = setInterval(() => {
      if (Date.now() - lastActivityAt > IDLE_TIMEOUT_MS) {
        this.sendEvent(socket, { event: 'error', data: { code: 'idle_timeout', message: 'Session idle timeout' } });
        socket.close(4002, 'idle_timeout');
      }
    }, 30_000);

    socket.on('message', (raw, isBinary) => {
      lastActivityAt = Date.now();
      void this.handleMessage(socket, auth.userId, connectionId, isBinary, raw as Buffer, sessionId, (id) => {
        sessionId = id;
      });
    });

    socket.on('close', (code, reason) => {
      voiceDebug('websocket_disconnected', { connectionId, sessionId, code, reason: reason?.toString() });
      clearInterval(idleCheck);
      if (sessionId) {
        this.sockets.delete(sessionId);
        this.runtimeRegistry.destroy(sessionId);
      }
    });

    socket.on('error', (error) => {
      this.logger.warn(`Voice socket error: ${String(error)}`);
    });
  }

  private authenticate(request: IncomingMessage): { userId: string } | null {
    try {
      const url = new URL(request.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) return null;
      const jwtConfig = this.configService.get<AppConfig['jwt']>('app.jwt')!;
      const payload = this.jwtService.verify<JwtAccessPayload>(token, { secret: jwtConfig.accessSecret });
      if (payload.type !== 'access') return null;
      return { userId: payload.sub };
      // Token is never logged, not even on failure (AGENTS §27).
    } catch {
      return null;
    }
  }

  private async handleMessage(
    socket: WebSocket,
    userId: string,
    connectionId: string,
    isBinary: boolean,
    raw: Buffer,
    currentSessionId: string | null,
    setSessionId: (id: string) => void,
  ): Promise<void> {
    if (isBinary) {
      if (!currentSessionId) return; // audio before session.start is ignored, not fatal
      if (raw.length > MAX_FRAME_BYTES || raw.length % 2 !== 0) {
        this.sendEvent(socket, { event: 'error', data: { code: 'invalid_frame', message: 'Invalid audio frame' } });
        return;
      }
      this.handleAudioFrame(socket, currentSessionId, raw);
      return;
    }

    let parsed: { event: ClientToServerEventType; data?: Record<string, unknown> };
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      this.sendEvent(socket, { event: 'error', data: { code: 'invalid_json', message: 'Malformed control message' } });
      return;
    }

    switch (parsed.event) {
      case 'session.start': {
        const requestedId = String(parsed.data?.sessionId ?? '');
        const session = await this.sessionService.getById(requestedId);
        if (!session || session.userId !== userId) {
          this.sendEvent(socket, { event: 'error', data: { code: 'session_not_found', message: 'Unknown or unauthorized session' } });
          socket.close(4003, 'session_not_found');
          return;
        }
        if (this.sessionService.isExpired(session)) {
          this.sendEvent(socket, { event: 'error', data: { code: 'session_expired', message: 'Session exceeded max duration' } });
          socket.close(4004, 'session_expired');
          return;
        }
        // One socket = one session; reject a second concurrent socket for the same session.
        if (this.sockets.has(session.id)) {
          this.sendEvent(socket, { event: 'error', data: { code: 'session_already_connected', message: 'Session already has an active connection' } });
          socket.close(4005, 'already_connected');
          return;
        }

        voiceDebug('session_start_received', {
          connectionId,
          sessionId: session.id,
          userId,
          previousStatus: session.status,
        });
        const isReconnect = RECONNECTABLE_SESSION_STATES.has(session.status);
        setSessionId(session.id);
        this.sockets.set(session.id, socket);
        this.runtimeRegistry.create({
          sessionId: session.id,
          userId,
          scope: session.scope as 'personal' | 'professional',
          space: session.space,
          language: session.language,
          conversationId: session.conversationId,
        });
        // BUG FIX (Phase G real-mic reconnection test): on a genuine first
        // connect, `session.status` is 'created' and this transition is
        // legal. On a RECONNECT to a session that was already 'listening'
        // (e.g. the previous socket just dropped without an explicit
        // session.end), this would be an illegal self-transition
        // (listening -> listening) and threw an unhandled
        // BadRequestException, killing the reconnect. Skip the transition
        // entirely when already in a resumable, non-terminal state.
        if (session.status !== 'listening') {
          await this.sessionService.transition(session.id, 'listening').catch(() => undefined);
        }
        if (isReconnect) {
          this.emitAvatarState(socket, this.runtimeRegistry.get(session.id), 'listening', 'voice', false, undefined, 'reconnecting');
        }
        this.sendEvent(socket, {
          event: 'session.ready',
          data: { sessionId: session.id, state: 'listening', protocolVersion: VOICE_PROTOCOL_VERSION, audioFormat: VOICE_AUDIO_FORMAT },
        });
        this.emitAvatarState(socket, this.runtimeRegistry.get(session.id), 'listening');
        voiceDebug('session_ready_sent', { connectionId, sessionId: session.id, language: session.language });
        break;
      }

      case 'audio.end': {
        if (currentSessionId) await this.finalizeTurn(socket, currentSessionId);
        break;
      }

      case 'session.interrupt': {
        if (currentSessionId) this.interrupt(currentSessionId);
        break;
      }

      case 'session.pause': {
        if (currentSessionId) {
          await this.sessionService.transition(currentSessionId, 'paused').catch(() => undefined);
          this.sendEvent(socket, { event: 'session.state_changed', data: { state: 'paused' } });
          this.emitAvatarState(socket, this.runtimeRegistry.get(currentSessionId), 'paused');
        }
        break;
      }

      case 'session.resume': {
        if (currentSessionId) {
          await this.sessionService.transition(currentSessionId, 'listening').catch(() => undefined);
          this.sendEvent(socket, { event: 'session.state_changed', data: { state: 'listening' } });
          this.emitAvatarState(socket, this.runtimeRegistry.get(currentSessionId), 'listening');
        }
        break;
      }

      case 'session.end': {
        if (currentSessionId) {
          await this.sessionService.end(userId, currentSessionId).catch(() => undefined);
          this.emitAvatarState(socket, this.runtimeRegistry.get(currentSessionId), 'disconnected');
          this.sendEvent(socket, { event: 'session.ended' });
          socket.close(1000, 'ended');
        }
        break;
      }

      default:
        this.sendEvent(socket, { event: 'error', data: { code: 'unknown_event', message: 'Unknown event type' } });
    }
  }

  private handleAudioFrame(socket: WebSocket, sessionId: string, frame: Buffer): void {
    const state = this.runtimeRegistry.get(sessionId);
    if (!state) return;

    if (!this.runtimeRegistry.registerFrame(sessionId)) {
      this.sendEvent(socket, { event: 'error', data: { code: 'audio_flood', message: 'Too much audio for one turn' } });
      return;
    }

    if (!state.sttSession) {
      this.providerFactory
        .createStt(state.userId, { scope: state.scope, space: state.space })
        .then((stt) => {
          if (stt && !state.sttSession) {
            state.sttSession = stt.startSession({ language: state.language });
            state.sttGenerationId ??= state.generationId;
          }
        })
        .catch((error) => this.logger.warn(`Failed to start STT session: ${String(error)}`));
    }

    // BUG FIX (Phase G real-mic investigation — proven root cause of STT
    // foreign-language hallucinations): only push frames to the STT session
    // while the user is CONFIRMED speaking. Previously every frame was
    // pushed unconditionally, including all silence between utterances —
    // a real session logged 308s of accumulated audio for a 3s VAD-detected
    // utterance, and Whisper is documented to hallucinate (including in
    // random other languages) on long near-silent inputs. A small rolling
    // pre-speech buffer (PRE_SPEECH_BUFFER_FRAMES) is flushed the moment
    // speech_started fires, so the first word is never clipped.
    if (state.isUserSpeaking) {
      state.sttSession?.pushAudio(frame);
      state.sttPushedFrameCount += 1;
    } else {
      state.preSpeechBuffer.push(frame);
      if (state.preSpeechBuffer.length > PRE_SPEECH_BUFFER_FRAMES) state.preSpeechBuffer.shift();
    }

    const now = Date.now();
    const vadEvent = state.vad.process(frame, now);
    if (vadEvent?.type === 'speech_started') {
      const inputGenerationId = this.runtimeRegistry.newGeneration(sessionId) ?? state.generationId;
      state.sttGenerationId = inputGenerationId;
      state.isUserSpeaking = true;
      state.speechEndedAtMs = null;
      for (const bufferedFrame of state.preSpeechBuffer) state.sttSession?.pushAudio(bufferedFrame);
      state.preSpeechBuffer = [];
      voiceDebug('user_audio_start', {
        sessionId,
        assistantWasSpeaking: Boolean(state.ttsAbortController),
        turnWasActive: Boolean(state.currentTurnId),
        generationId: inputGenerationId,
      });
      // Implicit barge-in (Phase G real-mic bug fix, AGENTS §20): the user
      // does NOT have to say "stop" — simply starting to speak again while
      // the assistant is still speaking or still generating IS the
      // interruption. This is what stops the previous response's audio the
      // moment new speech begins, rather than only once the client
      // explicitly sends session.interrupt.
      if (state.ttsAbortController || state.currentTurnId) {
        voiceDebug('implicit_barge_in_triggered', { sessionId, generationId: inputGenerationId });
        this.interrupt(sessionId, false);
      }
    } else if (vadEvent?.type === 'speech_ended') {
      state.isUserSpeaking = false;
      state.speechEndedAtMs = now;
      voiceDebug('user_audio_stop', { sessionId, generationId: state.generationId });
      // EndOfTurn: don't finalize immediately on the VAD event itself — wait
      // the confirm-silence window (AGENTS §17) via a short delayed check.
      setTimeout(() => {
        if (state.speechEndedAtMs && this.endOfTurn.isTurnOver(state.speechEndedAtMs, Date.now())) {
          void this.finalizeTurn(socket, sessionId);
        }
      }, 350);
    }
  }

  private async finalizeTurn(socket: WebSocket, sessionId: string): Promise<void> {
    const state = this.runtimeRegistry.get(sessionId);
    if (!state || !state.sttSession) return;
    const sttSession = state.sttSession;
    const sttGenerationId = state.sttGenerationId;
    state.sttSession = null;
    state.sttGenerationId = null;
    state.preSpeechBuffer = []; // never let stale pre-roll from this turn leak into the next one's onset
    const frameCount = state.framesSinceLastFinalize; // total received since last finalize (flood-guard metric — includes silence)
    const sttPushedFrameCount = state.sttPushedFrameCount; // what was ACTUALLY sent to STT (speech + small pre-roll only)
    state.sttPushedFrameCount = 0;
    this.runtimeRegistry.resetTurnFrameCount(sessionId);
    const isCurrentInputGeneration = () => Boolean(sttGenerationId && this.runtimeRegistry.isCurrentGeneration(sessionId, sttGenerationId));

    await this.sessionService.transition(sessionId, 'transcribing').catch(() => undefined);
    const sttStarted = Date.now();
    voiceDebug('stt_request_start', {
      sessionId,
      framesReceivedTotal: frameCount,
      framesSentToStt: sttPushedFrameCount,
      approxDurationSentMs: sttPushedFrameCount * VOICE_AUDIO_FORMAT.recommendedChunkMs,
      languageHint: state.language,
    });
    const transcript = await sttSession.finalize();
    const sttLatencyMs = Date.now() - sttStarted;
    voiceDebug('stt_final', { sessionId, transcriptLength: transcript.length, sttLatencyMs });
    // Requested explicitly for this debug pass: the actual transcript TEXT
    // (not just its length) — this is conversation content, not a secret,
    // and is exactly what's needed to diagnose language/hallucination
    // issues. Still never any raw audio.
    voiceDebug('transcript.final', { sessionId, languageHint: state.language, text: transcript, sttLatencyMs });

    if (!isCurrentInputGeneration()) {
      voiceDebug('stale_stt_finalize_dropped', {
        sessionId,
        capturedGenerationId: sttGenerationId,
        currentGenerationId: state.generationId,
        transcriptLength: transcript.length,
      });
      return;
    }

    if (!transcript.trim()) {
      await this.sessionService.transition(sessionId, 'listening').catch(() => undefined);
      return;
    }

    this.sendEvent(socket, { event: 'transcript.final', data: { text: transcript } });
    await this.sessionService.transition(sessionId, 'thinking').catch(() => undefined);
    if (!isCurrentInputGeneration()) {
      voiceDebug('stale_stt_finalize_dropped', {
        sessionId,
        capturedGenerationId: sttGenerationId,
        currentGenerationId: state.generationId,
        stage: 'after_thinking_transition',
      });
      return;
    }

    // CONCURRENCY GUARD (Phase G real-mic bug fix — root cause of the
    // multi-response audio overlap): a previous turn's LLM/TTS may still be
    // running at this point (its STT/finalize step above can itself take
    // seconds, during which the user may have already barged in via
    // handleAudioFrame's speech_started branch, or simply not been caught
    // yet). Defense in depth — stop it HERE too, unconditionally, before
    // starting a new one. stopActiveGeneration() is idempotent: a no-op if
    // nothing is active.
    this.stopActiveGeneration(sessionId);
    const generationId = sttGenerationId;
    if (!generationId || !isCurrentInputGeneration()) return;

    const turn = await this.turnService.start(sessionId);
    if (!isCurrentInputGeneration()) {
      await this.turnService.interrupt(turn.id).catch(() => undefined);
      voiceDebug('stale_stt_finalize_dropped', {
        sessionId,
        capturedGenerationId: generationId,
        currentGenerationId: state.generationId,
        stage: 'after_turn_start',
        turnId: turn.id,
      });
      return;
    }
    state.currentTurnId = turn.id;
    voiceDebug('assistant_generation_start', { sessionId, turnId: turn.id, generationId });

    let audioChunkCount = 0;
    const events: VoiceTurnEvents = {
      onAssistantThinkingStarted: () => {
        this.sendEvent(socket, { event: 'assistant.thinking.started' });
        this.emitAvatarState(socket, state, 'thinking');
        this.emitAssistantExpression(socket, 'thinking', 'voice');
      },
      onAssistantSpeakingStarted: (payload) => {
        voiceDebug('tts_request_start', { sessionId, turnId: turn.id, generationId });
        void this.sessionService.transition(sessionId, 'assistant_speaking').catch(() => undefined);
        this.sendEvent(socket, { event: 'assistant.speaking.started' });
        this.emitAvatarState(socket, state, 'speaking', payload.channel);
        this.emitAssistantExpression(socket, 'speaking', payload.channel);
        this.sendEvent(socket, {
          event: 'avatar.lipsync',
          data: this.avatarState.buildLipSyncPlan({
            text: payload.text,
            channel: payload.channel,
            voiceSpeed: payload.voiceSpeed,
            enabled: payload.lipSyncEnabled,
          }),
        });
      },
      onAudioChunk: (chunk) => {
        audioChunkCount += 1;
        if (socket.readyState === WebSocket.OPEN) socket.send(chunk, { binary: true });
      },
      onAssistantSpeakingEnded: () => {
        voiceDebug('tts_playback_summary', { sessionId, turnId: turn.id, generationId, audioChunkCount });
        this.sendEvent(socket, { event: 'assistant.speaking.ended' });
        void this.sessionService.transition(sessionId, 'listening').catch(() => undefined);
        this.emitAvatarState(socket, state, 'listening');
        this.emitAssistantExpression(socket, 'listening', 'voice');
      },
      onPendingConfirmation: (payload) => {
        this.sendEvent(socket, { event: 'action.pending_confirmation', data: payload });
        this.emitAvatarState(socket, state, 'confirming', 'voice', true);
        this.emitAssistantExpression(socket, 'confirming', 'voice', true);
      },
      onActionExecuted: (payload) => this.sendEvent(socket, { event: 'action.executed', data: payload }),
      onClarificationNeeded: (payload) => {
        this.sendEvent(socket, { event: 'action.clarification_needed', data: payload });
        this.emitAvatarState(socket, state, 'confirming', 'voice', true);
      },
      onLatencyMetrics: (payload) => this.sendEvent(socket, { event: 'latency.metrics', data: payload }),
      onError: (code, message) => {
        this.sendEvent(socket, { event: 'error', data: { code, message } });
        this.emitAvatarState(socket, state, 'error', 'voice', false, code);
        this.emitAssistantExpression(socket, 'error', 'voice', false, code);
      },
    };

    await this.turnRunner.run(state, turn.id, generationId, transcript, { sttLatencyMs }, events);
    // Only clear currentTurnId if it's STILL this turn — a newer turn may
    // have already started (and overwritten it) while this run() was
    // finishing up its own stale-generation abandonment; never clobber it.
    if (state.currentTurnId === turn.id) state.currentTurnId = null;
  }

  /**
   * Stops whatever the session's assistant is currently doing (TTS audio +
   * the turn record) WITHOUT bumping the generation itself — callers decide
   * whether/when to mint a new one. Idempotent: safe to call when nothing is
   * active. This is the single place that guarantees an old response's
   * audio is torn down before anything new can start.
   */
  private stopActiveGeneration(sessionId: string): void {
    const state = this.runtimeRegistry.get(sessionId);
    if (!state) return;
    const hadActiveTts = Boolean(state.ttsAbortController);
    const hadActiveTurn = state.currentTurnId;
    state.ttsAbortController?.abort();
    state.ttsAbortController = null;
    if (state.currentTurnId) {
      void this.turnService.interrupt(state.currentTurnId);
      state.currentTurnId = null;
    }
    if (state.currentAssistantMessageId) {
      void this.conversationsService.markMessageInterrupted(state.currentAssistantMessageId, {
        reason: 'voice_interrupted',
        channel: 'voice',
      });
      state.currentAssistantMessageId = null;
    }
    if (state.currentPendingActionId) {
      state.openPendingActionIds.delete(state.currentPendingActionId);
      void this.pendingActionService.cancel(state.userId, state.currentPendingActionId, 'voice_interrupted');
      state.currentPendingActionId = null;
    }
    if (hadActiveTts || hadActiveTurn) {
      voiceDebug('assistant_generation_abort', { sessionId, abortedTurnId: hadActiveTurn, hadActiveTts, generationId: state.generationId });
    }
  }

  private interrupt(sessionId: string, bumpGeneration = true): void {
    const state = this.runtimeRegistry.get(sessionId);
    if (!state) return;
    state.recentInterruption = true;
    voiceDebug('interrupt_received', { sessionId, generationId: state.generationId });
    // Barge-in (AGENTS §20, Phase G §B/§D): stop the old generation's audio
    // AND invalidate its generationId in one atomic (synchronous) step, so
    // no late TTS chunk or Orchestrator response belonging to it can ever
    // reach the client, no matter what the provider does afterward.
    this.stopActiveGeneration(sessionId);
    if (bumpGeneration) this.runtimeRegistry.newGeneration(sessionId);

    void this.sessionService
      .transition(sessionId, 'interrupted')
      .then(() => this.sessionService.transition(sessionId, 'listening').catch(() => undefined))
      .catch(() => undefined);
    const socket = this.sockets.get(sessionId);
    if (socket) {
      this.sendEvent(socket, { event: 'session.interrupted' });
      this.emitAvatarState(socket, state, 'interrupted');
      this.emitAssistantExpression(socket, 'interrupted', 'voice');
      this.emitAvatarState(socket, state, 'listening');
    }
  }

  private sendEvent(socket: WebSocket, payload: ServerEvent): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }

  private emitAvatarState(
    socket: WebSocket,
    state: ReturnType<VoiceRuntimeRegistry['get']>,
    avatarState: AvatarState,
    channel: AvatarChannel = 'voice',
    pendingConfirmation = false,
    errorCode?: string,
    connection: 'connected' | 'reconnecting' | 'disconnected' = 'connected',
  ): void {
    this.sendEvent(socket, {
      event: 'avatar.state',
      data: this.avatarState.buildState({
        state: avatarState,
        channel,
        sessionId: state?.sessionId,
        conversationId: state?.conversationId,
        scope: state?.scope,
        space: state?.space,
        pendingConfirmation,
        errorCode,
        connection,
      }),
    });
  }

  private emitAssistantExpression(
    socket: WebSocket,
    avatarState: AvatarState,
    channel: AvatarChannel,
    pendingConfirmation = false,
    errorCode?: string,
  ): void {
    this.sendEvent(socket, {
      event: 'assistant.expression',
      data: this.avatarState.buildExpression({ state: avatarState, channel, pendingConfirmation, errorCode }),
    });
  }
}

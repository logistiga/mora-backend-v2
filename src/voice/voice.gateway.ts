import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { AppConfig } from '../config/configuration.js';
import type { JwtAccessPayload } from '../auth/entities/token-payload.interface.js';
import { EndOfTurnService } from './vad/end-of-turn.service.js';
import { VoiceProviderFactoryService } from './providers/voice-provider-factory.service.js';
import { VoiceRuntimeRegistry } from './voice-runtime.registry.js';
import { VoiceSessionService } from './voice-session.service.js';
import { VoiceTurnRunnerService, type VoiceTurnEvents } from './voice-turn-runner.service.js';
import { VoiceTurnService } from './voice-turn.service.js';
import { VOICE_AUDIO_FORMAT, VOICE_PROTOCOL_VERSION, type ClientToServerEventType } from './voice.types.js';

const MAX_FRAME_BYTES = 32 * 1024; // one PCM16 frame must never approach this — real frames are a few KB
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // no client activity for 10 min -> close (AGENTS §26)

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
      void this.handleMessage(socket, auth.userId, isBinary, raw as Buffer, sessionId, (id) => {
        sessionId = id;
      });
    });

    socket.on('close', () => {
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
        await this.sessionService.transition(session.id, 'listening');
        this.sendEvent(socket, {
          event: 'session.ready',
          data: { sessionId: session.id, state: 'listening', protocolVersion: VOICE_PROTOCOL_VERSION, audioFormat: VOICE_AUDIO_FORMAT },
        });
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
        }
        break;
      }

      case 'session.resume': {
        if (currentSessionId) {
          await this.sessionService.transition(currentSessionId, 'listening').catch(() => undefined);
          this.sendEvent(socket, { event: 'session.state_changed', data: { state: 'listening' } });
        }
        break;
      }

      case 'session.end': {
        if (currentSessionId) {
          await this.sessionService.end(userId, currentSessionId).catch(() => undefined);
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
          if (stt && !state.sttSession) state.sttSession = stt.startSession({ language: state.language });
        })
        .catch((error) => this.logger.warn(`Failed to start STT session: ${String(error)}`));
    }
    state.sttSession?.pushAudio(frame);

    const now = Date.now();
    const vadEvent = state.vad.process(frame, now);
    if (vadEvent?.type === 'speech_started') {
      state.isUserSpeaking = true;
      state.speechEndedAtMs = null;
    } else if (vadEvent?.type === 'speech_ended') {
      state.isUserSpeaking = false;
      state.speechEndedAtMs = now;
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
    state.sttSession = null;
    this.runtimeRegistry.resetTurnFrameCount(sessionId);

    await this.sessionService.transition(sessionId, 'transcribing').catch(() => undefined);
    const sttStarted = Date.now();
    const transcript = await sttSession.finalize();
    const sttLatencyMs = Date.now() - sttStarted;

    if (!transcript.trim()) {
      await this.sessionService.transition(sessionId, 'listening').catch(() => undefined);
      return;
    }

    this.sendEvent(socket, { event: 'transcript.final', data: { text: transcript } });
    await this.sessionService.transition(sessionId, 'thinking').catch(() => undefined);

    const turn = await this.turnService.start(sessionId);
    state.currentTurnId = turn.id;

    const events: VoiceTurnEvents = {
      onAssistantThinkingStarted: () => this.sendEvent(socket, { event: 'assistant.thinking.started' }),
      onAssistantSpeakingStarted: () => {
        void this.sessionService.transition(sessionId, 'assistant_speaking').catch(() => undefined);
        this.sendEvent(socket, { event: 'assistant.speaking.started' });
      },
      onAudioChunk: (chunk) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(chunk, { binary: true });
      },
      onAssistantSpeakingEnded: () => {
        this.sendEvent(socket, { event: 'assistant.speaking.ended' });
        void this.sessionService.transition(sessionId, 'listening').catch(() => undefined);
      },
      onPendingConfirmation: (payload) => this.sendEvent(socket, { event: 'action.pending_confirmation', data: payload }),
      onActionExecuted: (payload) => this.sendEvent(socket, { event: 'action.executed', data: payload }),
      onClarificationNeeded: (payload) => this.sendEvent(socket, { event: 'action.clarification_needed', data: payload }),
      onLatencyMetrics: (payload) => this.sendEvent(socket, { event: 'latency.metrics', data: payload }),
      onError: (code, message) => this.sendEvent(socket, { event: 'error', data: { code, message } }),
    };

    await this.turnRunner.run(state, turn.id, transcript, { sttLatencyMs }, events);
    state.currentTurnId = null;
  }

  private interrupt(sessionId: string): void {
    const state = this.runtimeRegistry.get(sessionId);
    if (!state) return;
    // Barge-in (AGENTS §20): abort TTS immediately, clear any unplayed audio
    // (nothing is buffered server-side beyond the in-flight fetch stream, so
    // aborting the controller IS clearing it), mark the turn interrupted.
    state.ttsAbortController?.abort();
    state.ttsAbortController = null;
    if (state.currentTurnId) {
      void this.turnService.interrupt(state.currentTurnId);
    }
    void this.sessionService
      .transition(sessionId, 'interrupted')
      .then(() => this.sessionService.transition(sessionId, 'listening').catch(() => undefined))
      .catch(() => undefined);
    const socket = this.sockets.get(sessionId);
    if (socket) this.sendEvent(socket, { event: 'session.interrupted' });
  }

  private sendEvent(socket: WebSocket, payload: ServerEvent): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }
}

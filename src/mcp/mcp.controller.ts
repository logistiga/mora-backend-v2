import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { McpService } from './mcp.service.js';

const PROTOCOL = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

/**
 * Remote MCP endpoint (Streamable HTTP, JSON-RPC over POST). Authenticated like
 * every other route: a Mora API key (X-Api-Key or Bearer mora_…) or a session.
 * Notifications get 202 with no body, as the protocol requires.
 */
@ApiTags('mcp')
@ApiBearerAuth()
@ApiSecurity('api-key')
@UseGuards(JwtAccessGuard)
@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@CurrentUser() user: AuthenticatedUser, @Body() body: JsonRpcRequest, @Res({ passthrough: true }) res: Response) {
    const id = body?.id ?? null;
    const isNotification = body?.id === undefined;

    if (isNotification) {
      res.status(HttpStatus.ACCEPTED);
      return undefined;
    }

    try {
      switch (body.method) {
        case 'initialize':
          return rpcResult(id, {
            protocolVersion: PROTOCOL,
            capabilities: { tools: {} },
            serverInfo: { name: 'mora', version: '1.0.0' },
          });
        case 'tools/list':
          return rpcResult(id, { tools: this.mcp.listTools() });
        case 'tools/call': {
          const tool = this.mcp.findTool(body.params?.name ?? '');
          if (!tool) return rpcError(id, -32602, `Unknown tool: ${body.params?.name ?? ''}`);
          try {
            const data = await tool.run(user.id, body.params?.arguments ?? {});
            return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
          } catch (err) {
            // Tool failures go back to the model as a tool error, never as a stack trace.
            return rpcResult(id, { isError: true, content: [{ type: 'text', text: messageOf(err) }] });
          }
        }
        default:
          return rpcError(id, -32601, `Method not found: ${body.method ?? ''}`);
      }
    } catch (err) {
      return rpcError(id, -32603, messageOf(err));
    }
  }

  @Get()
  @ApiSecurity('api-key')
  @UseGuards(JwtAccessGuard)
  stream(@Res({ passthrough: true }) res: Response) {
    // No server-initiated stream is offered, so GET is not supported.
    res.status(HttpStatus.METHOD_NOT_ALLOWED);
    return undefined;
  }
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

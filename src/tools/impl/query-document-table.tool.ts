import { Injectable } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { DocumentTableQueryService } from '../../documents/document-table-query.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class QueryDocumentTableInput {
  @IsUUID()
  tableId: string;

  @IsOptional()
  @IsString()
  groupBy?: string;

  @IsOptional()
  @IsString()
  aggregateColumn?: string;

  @IsOptional()
  @IsIn(['sum', 'count', 'avg', 'max', 'min'])
  aggregateFn?: 'sum' | 'count' | 'avg' | 'max' | 'min';

  @IsOptional()
  @IsString()
  filterColumn?: string;

  @IsOptional()
  @IsString()
  filterValue?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}

/**
 * The controlled analytical layer (AGENTS Phase E §15/§16): a closed
 * group-by/aggregate spec, never raw SQL from the LLM. Scope/space checked
 * against the table's parent document before anything executes.
 */
@Injectable()
export class QueryDocumentTableTool implements MoraTool<QueryDocumentTableInput> {
  readonly name = 'query_document_table';
  readonly description = "Exécute une requête analytique contrôlée (group-by/aggregate) sur un tableau extrait d'un document (CSV/XLSX).";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      tableId: { type: 'string', format: 'uuid' },
      groupBy: { type: 'string' },
      aggregateColumn: { type: 'string' },
      aggregateFn: { type: 'string', enum: ['sum', 'count', 'avg', 'max', 'min'] },
      filterColumn: { type: 'string' },
      filterValue: { type: 'string' },
      sortDir: { type: 'string', enum: ['asc', 'desc'] },
    },
    required: ['tableId'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly tableQuery: DocumentTableQueryService,
    private readonly prisma: PrismaService,
  ) {}

  validate(input: unknown): ToolValidationResult<QueryDocumentTableInput> {
    return validateWithDto(QueryDocumentTableInput, input);
  }

  async execute(context: ToolContext, input: QueryDocumentTableInput): Promise<ToolResult> {
    const table = await this.prisma.documentTable.findUnique({
      where: { id: input.tableId },
      include: { document: { select: { scope: true, space: true } } },
    });
    if (!table) return { ok: false, errorCode: 'not_found' };
    if (table.document.scope !== context.scope || table.document.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }

    try {
      const result = await this.tableQuery.query(context.userId, input);
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, errorCode: 'invalid_query', errorMessage: error instanceof Error ? error.message : 'invalid query' };
    }
  }
}

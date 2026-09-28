import { describe, expect, it } from 'vitest';
import { TOOL_USAGE_RULES } from '../agents/agent-prompts.js';
import { SearchDocumentContentTool } from './impl/search-document-content.tool.js';
import { SearchDocumentsTool } from './impl/search-documents.tool.js';

describe('document tool guidance (regression, stabilization K)', () => {
  it('advertises search_documents as metadata-only and points to the content tool', () => {
    const tool = new SearchDocumentsTool({} as never);
    expect(tool.description).toMatch(/MÉTADONNÉES/);
    expect(tool.description).toContain('search_document_content');
  });

  it('advertises search_document_content as the tool for questions about document content', () => {
    const tool = new SearchDocumentContentTool({} as never);
    expect(tool.description).toMatch(/CONTENU/);
    expect(tool.description).toMatch(/provenance/);
  });

  it('forbids concluding "nothing found" without a content search', () => {
    expect(TOOL_USAGE_RULES).toContain('search_document_content');
    expect(TOOL_USAGE_RULES).toMatch(/Source : <titre du document>/);
  });
});

import { Injectable, NotFoundException } from '@nestjs/common';
import { GoogleOAuthService } from './google-oauth.service.js';
import { googleRequest } from './google-api.util.js';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DOCS_API = 'https://docs.googleapis.com/v1/documents';
const DOC_MIME = 'application/vnd.google-apps.document';
const MAX_TEXT_CHARS = 20000;

export interface GoogleDocSummary {
  id: string;
  title: string;
  modifiedTime?: string;
  webViewLink?: string;
}

interface DocParagraphElement {
  textRun?: { content?: string };
}
interface DocStructuralElement {
  paragraph?: { elements?: DocParagraphElement[] };
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: DocStructuralElement[] }> }> };
}

/** Lists and reads the user's Google Docs (read-only). Document text is capped to keep it bounded. */
@Injectable()
export class GoogleDocsService {
  constructor(private readonly oauth: GoogleOAuthService) {}

  async listDocuments(userId: string, limit = 20): Promise<GoogleDocSummary[]> {
    const token = await this.oauth.getAccessToken(userId);
    const query = new URLSearchParams({
      q: `mimeType='${DOC_MIME}' and trashed=false`,
      pageSize: String(Math.min(Math.max(limit, 1), 100)),
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name,modifiedTime,webViewLink)',
    });
    const response = await googleRequest<{ files?: Array<{ id: string; name: string; modifiedTime?: string; webViewLink?: string }> }>(
      `${DRIVE_FILES}?${query.toString()}`,
      token,
    );
    return (response.files ?? []).map((f) => ({
      id: f.id,
      title: f.name,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
    }));
  }

  async readDocument(userId: string, documentId: string): Promise<{ id: string; title: string; text: string; truncated: boolean }> {
    const token = await this.oauth.getAccessToken(userId);
    if (!/^[A-Za-z0-9_-]{10,}$/.test(documentId)) throw new NotFoundException('Document not found');
    const doc = await googleRequest<{ documentId: string; title?: string; body?: { content?: DocStructuralElement[] } }>(
      `${DOCS_API}/${encodeURIComponent(documentId)}`,
      token,
    );
    const text = extractText(doc.body?.content ?? []);
    return {
      id: doc.documentId,
      title: doc.title ?? '(sans titre)',
      text: text.slice(0, MAX_TEXT_CHARS),
      truncated: text.length > MAX_TEXT_CHARS,
    };
  }
}

function extractText(elements: DocStructuralElement[]): string {
  let out = '';
  for (const el of elements) {
    if (el.paragraph?.elements) {
      for (const pe of el.paragraph.elements) out += pe.textRun?.content ?? '';
    }
    if (el.table?.tableRows) {
      for (const row of el.table.tableRows) {
        for (const cell of row.tableCells ?? []) out += extractText(cell.content ?? []);
      }
    }
  }
  return out;
}

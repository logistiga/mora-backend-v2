export const DOCUMENT_STATUSES = [
  'uploaded',
  'queued',
  'processing',
  'ready',
  'needs_review',
  'failed',
  'archived',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_SCOPES = ['personal', 'professional'] as const;

export const SUPPORTED_MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

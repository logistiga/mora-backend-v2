import type { Document } from '../generated/prisma/client.js';

/**
 * Public shape of a document. Storage internals (`storageProvider`,
 * `storageKey`, the generated on-disk `filename`) and the dedup `checksum`
 * describe how Mora stores the file, not what the user uploaded, and
 * `userId` is already implied by the bearer token — none of them belong in
 * a client payload.
 */
export interface DocumentPublicView {
  id: string;
  scope: string;
  space: string;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  documentType: string | null;
  title: string | null;
  language: string | null;
  source: string;
  status: string;
  classificationConfidence: number | null;
  needsReview: boolean;
  summary: string | null;
  keyPoints: unknown;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
}

export function toDocumentPublicView(document: Document): DocumentPublicView {
  return {
    id: document.id,
    scope: document.scope,
    space: document.space,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    extension: document.extension,
    sizeBytes: document.sizeBytes,
    documentType: document.documentType,
    title: document.title,
    language: document.language,
    source: document.source,
    status: document.status,
    classificationConfidence: document.classificationConfidence,
    needsReview: document.needsReview,
    summary: document.summary,
    keyPoints: document.keyPoints,
    errorMessage: document.errorMessage,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    processedAt: document.processedAt,
  };
}

export const VISION_ALLOWED_SOURCE_TYPES = ['upload', 'camera', 'screenshot', 'voice_snapshot', 'document'] as const;
export type VisionSourceType = (typeof VISION_ALLOWED_SOURCE_TYPES)[number];

export const VISION_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type VisionMimeType = (typeof VISION_ALLOWED_MIME_TYPES)[number];

export interface VisionAssetSummary {
  assetId: string;
  sourceType: VisionSourceType;
  summary: string;
  extractedText: string;
  structuredData: Record<string, unknown> | null;
  width: number | null;
  height: number | null;
}

export interface VisionContextNoteInput {
  sourceType: VisionSourceType;
  originalFilename: string;
  summary: string;
  extractedText: string;
  structuredData: Record<string, unknown> | null;
  width: number | null;
  height: number | null;
}

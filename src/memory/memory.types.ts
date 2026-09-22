export type MemoryScope = 'personal' | 'professional';
export type ProfessionalMemorySpace = 'general' | 'logistiga' | 'piston' | 'code';
export type MemorySpace = 'personal' | ProfessionalMemorySpace;

export type MemoryKind =
  | 'fact'
  | 'preference'
  | 'person'
  | 'company'
  | 'decision'
  | 'procedure'
  | 'event'
  | 'project'
  | 'habit';

export type MemoryStatus = 'active' | 'pending' | 'archived' | 'superseded';
export type MemorySource = 'manual' | 'extraction';

export const MEMORY_KINDS: MemoryKind[] = [
  'fact',
  'preference',
  'person',
  'company',
  'decision',
  'procedure',
  'event',
  'project',
  'habit',
];

export const MEMORY_STATUSES: MemoryStatus[] = ['active', 'pending', 'archived', 'superseded'];
export const MEMORY_SCOPES: MemoryScope[] = ['personal', 'professional'];
export const MEMORY_SPACES: MemorySpace[] = ['personal', 'general', 'logistiga', 'piston', 'code'];

export interface MemoryCandidate {
  kind: MemoryKind;
  content: string;
  importance: number; // 0..1
  confidence: number; // 0..1
}

/** A retrieved memory plus how/why it was ranked (never returned bare). */
export interface RetrievedMemory {
  id: string;
  content: string;
  kind: string;
  importance: number;
  confidence: number;
  score: number;
  mode: 'semantic' | 'text';
}

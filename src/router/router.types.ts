export type MoraRoute = 'direct' | 'personal' | 'professional' | 'hybrid';
export type MoraScope = 'direct' | 'personal' | 'professional' | 'hybrid';
export type ProfessionalSpace = 'general' | 'logistiga' | 'piston' | 'code';
export type MoraSpace = 'direct' | 'personal' | 'hybrid' | ProfessionalSpace;
export type MoraComplexity = 'low' | 'medium' | 'high';
export type MoraSecurityLevel = 'low' | 'medium' | 'high';
export type RouterMethod = 'rules' | 'llm-fallback' | 'default-fallback';

export interface RouterDecisionResult {
  route: MoraRoute;
  scope: MoraScope;
  space: MoraSpace;
  intent: string;
  complexity: MoraComplexity;
  securityLevel: MoraSecurityLevel;
  confidence: number;
  method: RouterMethod;
}

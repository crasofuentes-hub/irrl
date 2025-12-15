/**
 * IRRL Core Types
 */

export type ContentId = string;
export type EntityId = string;
export type RealmId = string;
export type ResolverId = string;

export interface RealmRules {
  minVerifications: number;
  requiredResolvers: ResolverId[];
  optionalResolvers: ResolverId[];
  decayHalfLife: string;
  minScore: number;
  maxTransitiveDepth: number;
  transitiveDecayFactor: number;
  customRules?: Record<string, unknown>;
}

export interface Realm {
  id: RealmId;
  name: string;
  description: string;
  parent: RealmId | null;
  domain: string;
  rules: RealmRules;
  publicKey: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: EntityId;
}

export type AttestationStatus = "pending" | "verified" | "failed" | "revoked" | "expired";

export interface Attestation {
  id: ContentId;
  realmId: RealmId;
  attester: EntityId;
  subject: EntityId;
  claim: string;
  resolverId: ResolverId;
  evidence: Record<string, unknown>;
  references: ContentId[];
  signature: string;
  status: AttestationStatus;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttestationInput {
  realmId: RealmId;
  subject: EntityId;
  claim: string;
  resolverId: ResolverId;
  evidence: Record<string, unknown>;
  references?: ContentId[];
  expiresAt?: Date | null;
}

export interface ResolverMetadata {
  id: ResolverId;
  version: string;
  name: string;
  description: string;
  author: EntityId;
  evidenceSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  domains: string[];
  deterministic: boolean;
  avgVerificationTime: number;
}

export type VerificationStatus = "verified" | "failed" | "error";

export interface VerificationResult {
  status: VerificationStatus;
  output: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  outputHash: string;
  error?: string;
  verifiedAt: Date;
  resolverVersion: string;
}

export interface Resolver {
  metadata: ResolverMetadata;
  canResolve(claim: string, evidence: Record<string, unknown>): boolean;
  verify(evidence: Record<string, unknown>): Promise<VerificationResult>;
  validateEvidence(evidence: Record<string, unknown>): { valid: boolean; errors?: string[] };
}

export interface VerificationRun {
  id: ContentId;
  attestationId: ContentId;
  resolverId: ResolverId;
  resolverVersion: string;
  status: VerificationStatus;
  output: Record<string, unknown>;
  outputHash: string;
  snapshot: Record<string, unknown>;
  durationMs: number;
  triggeredBy: EntityId;
  createdAt: Date;
}

export interface Evaluation {
  id: ContentId;
  fromEntity: EntityId;
  toEntity: EntityId;
  realmId: RealmId;
  domain: string;
  score: number;
  weight: number;
  rationale: string;
  supportingAttestations: ContentId[];
  signature: string;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface ReputationScore {
  subject: EntityId;
  realmId: RealmId;
  domain: string;
  score: number;
  confidence: number;
  evaluationCount: number;
  attestationCount: number;
  breakdown: {
    directEvaluations: number;
    transitiveEvaluations: number;
    attestationBonus: number;
    decayPenalty: number;
  };
  computedAt: Date;
  validUntil: Date;
}

export interface TrustPath {
  path: EntityId[];
  scores: number[];
  finalTrust: number;
  decayApplied: number;
}

export interface TransitiveTrustResult {
  from: EntityId;
  to: EntityId;
  domain: string;
  score: number;
  confidence: number;
  paths: TrustPath[];
  bestPath: TrustPath;
  metadata: {
    maxDepth: number;
    decayFactor: number;
    pathsExplored: number;
    computationTimeMs: number;
  };
}

export interface TransitiveTrustQuery {
  from: EntityId;
  to: EntityId;
  domain: string;
  realmId?: RealmId;
  maxDepth?: number;
  decayFactor?: number;
  minConfidence?: number;
}

export interface ReputationProof {
  version: "IRRL-Proof-v1";
  subject: EntityId;
  realmId: RealmId;
  domain: string;
  reputation: ReputationScore;
  issuer: string;
  issuedAt: Date;
  validUntil: Date;
  evidenceMerkleRoot: string;
  signature: string;
}

export type AuditEventType = 
  | "realm.created" | "realm.updated"
  | "attestation.created" | "attestation.verified" | "attestation.revoked"
  | "evaluation.created" | "reputation.computed"
  | "proof.generated" | "proof.verified"
  | "resolver.registered" | "resolver.updated";

export interface AuditEvent {
  id: ContentId;
  type: AuditEventType;
  actor: EntityId;
  entityIds: ContentId[];
  payload: Record<string, unknown>;
  previousHash: string;
  hash: string;
  timestamp: Date;
}

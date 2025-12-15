# IRRL — Architecture Document

## Overview

IRRL (Interoperable Reputation & Resolution Layer) is designed as a minimal, extensible infrastructure layer for contextual trust computation. This document describes the technical architecture, design decisions, and implementation details.

## Design Principles

### 1. Simplicity Over Complexity
- PostgreSQL over blockchain (unless you need immutability guarantees)
- REST over GraphQL (for v1, GraphQL planned for v2)
- TypeScript for type safety without ceremony

### 2. Extensibility Over Features
- Resolver system allows custom verification logic
- Realm hierarchy allows domain-specific rules
- Pluggable storage adapters (planned)

### 3. Auditability Over Performance
- Every operation is logged
- Cryptographic chain ensures integrity
- Reproducible computations

### 4. Portability Over Lock-in
- Standard cryptographic proofs
- Export/import capabilities
- No proprietary formats

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                │
│  SDK (TypeScript/Python) │ REST API │ CLI (planned)                     │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                              API LAYER                                   │
│  Express.js │ Validation │ Rate Limiting │ Auth (planned)               │
├─────────────────────────────────────────────────────────────────────────┤
│  Routes:                                                                 │
│  /realms │ /attestations │ /verify │ /trust │ /proofs │ /resolvers      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                            SERVICE LAYER                                 │
├───────────────┬───────────────┬───────────────┬────────────────────────┤
│    Realms     │  Attestations │    Trust      │        Proofs          │
│   Service     │    Service    │   Service     │       Service          │
├───────────────┴───────────────┴───────────────┴────────────────────────┤
│                         CORE COMPONENTS                                  │
├───────────────┬───────────────┬───────────────┬────────────────────────┤
│  Trust Graph  │   Resolver    │    Crypto     │      Audit Log         │
│    Engine     │    Registry   │    Utils      │       Manager          │
└───────────────┴───────────────┴───────────────┴────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                          PERSISTENCE LAYER                               │
│                           PostgreSQL 14+                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  Tables:                                                                 │
│  realms │ entities │ attestations │ verification_runs │ evaluations     │
│  reputation_cache │ resolvers │ proofs │ audit_log                      │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Realms

Realms are hierarchical trust contexts. They define:
- Domain (what kind of trust)
- Rules (how trust is computed)
- Inheritance (from parent realms)

```
technology/
├── software/
│   ├── frontend/
│   │   ├── react
│   │   └── vue
│   └── backend/
│       ├── nodejs
│       └── python
└── ai/
    ├── agents/
    │   ├── coding-agents
    │   └── research-agents
    └── models/
```

**Key Design Decisions:**
- Materialized path for efficient hierarchy queries
- JSONB rules for flexible configuration
- Each realm has its own Ed25519 keypair

### 2. Attestations

Attestations are signed claims with evidence. They link:
- Subject (who/what is being attested)
- Claim (what is being claimed)
- Evidence (data for verification)
- Resolver (how to verify)

```typescript
interface Attestation {
  id: ContentId;           // SHA-256 hash of content
  realmId: RealmId;
  attester: EntityId;
  subject: EntityId;
  claim: string;
  resolverId: ResolverId;
  evidence: JSONB;
  references: ContentId[]; // Other attestations as evidence
  signature: Ed25519Sig;
  status: "pending" | "verified" | "failed" | "revoked" | "expired";
  expiresAt: Timestamp | null;
}
```

**Key Design Decisions:**
- Content-addressable IDs (deterministic, verifiable)
- References create evidence graphs
- Signatures use Ed25519 (fast, secure, small)

### 3. Resolvers

Resolvers are verification plugins. They define:
- Evidence schema (what data is needed)
- Verification logic (how to verify)
- Output schema (what results look like)

```typescript
interface Resolver {
  id: string;
  version: string;
  evidenceSchema: JSONSchema;
  outputSchema: JSONSchema;
  
  canResolve(claim: string, evidence: any): boolean;
  verify(evidence: any): Promise<VerificationResult>;
}
```

**Built-in Resolvers:**
| Resolver | Purpose |
|----------|---------|
| `http-snapshot` | Verify URL content with hash |
| `github-activity` | Verify GitHub contributions |
| `dns-txt` | Verify domain ownership |
| `task-completion` | Verify task metrics |
| `prediction-accuracy` | Verify prediction track record |

### 4. Trust Graph Engine

The trust graph computes transitive trust between entities.

**Algorithm: Modified Dijkstra with Decay**

```
Input: from, to, domain, maxDepth, decayFactor
Output: score, confidence, paths

1. If direct edge exists: return direct trust
2. BFS from 'from' node:
   - For each neighbor N at depth D:
     - accumulatedTrust = parentTrust * edgeScore * decayFactor
     - If accumulatedTrust < minConfidence: prune
     - If N == to: record path
3. Aggregate all paths:
   - bestPath = max(paths by finalTrust)
   - aggregateScore = bestPath + Σ(otherPaths * 0.5^rank)
4. Compute confidence from path diversity and consistency
```

**Decay Functions:**
- Exponential: `trust * decay^depth`
- Linear: `trust * (1 - decay*depth)`
- Custom: configurable per realm

### 5. Reputation Computation

Reputation aggregates evaluations and attestations with temporal decay.

```typescript
function computeReputation(subject, realm, domain) {
  // 1. Get evaluations
  const evaluations = getEvaluations(subject, realm, domain);
  
  // 2. Apply temporal decay
  for (const eval of evaluations) {
    eval.weight *= Math.pow(0.5, ageDays / halfLifeDays);
  }
  
  // 3. Compute weighted average
  const rawScore = weightedAverage(evaluations);
  
  // 4. Add attestation bonus
  const verifiedAttestations = getVerifiedAttestations(subject, realm);
  const attestationBonus = computeBonus(verifiedAttestations);
  
  // 5. Apply decay penalty for staleness
  const decayPenalty = computeStalenesssPenalty(evaluations);
  
  // 6. Compute Sybil resistance score
  const sybilScore = computeSybilResistance(evaluations, attestations);
  
  return {
    score: clamp(rawScore + attestationBonus - decayPenalty, min, max),
    confidence: computeConfidence(evaluations, sybilScore),
    breakdown: { rawScore, attestationBonus, decayPenalty }
  };
}
```

### 6. Portable Proofs

Proofs are cryptographically signed snapshots of reputation.

```typescript
interface ReputationProof {
  version: "IRRL-Proof-v1";
  subject: EntityId;
  realmId: RealmId;
  domain: string;
  reputation: ReputationScore;
  issuer: string;
  issuedAt: Timestamp;
  validUntil: Timestamp;
  evidenceMerkleRoot: string;  // Merkle root of supporting evidence
  signature: Ed25519Sig;
}
```

**Verification Process:**
1. Verify signature against issuer's public key
2. Check expiration
3. Optionally verify evidence inclusion via Merkle proofs

### 7. Audit Log

Append-only, cryptographically chained log of all operations.

```typescript
interface AuditEvent {
  id: ContentId;
  type: AuditEventType;
  actor: EntityId;
  entityIds: ContentId[];
  payload: JSONB;
  previousHash: string;  // Chain link
  hash: string;          // SHA-256 of this event
  timestamp: Timestamp;
}
```

**Chain Integrity:**
- Each event references the previous event's hash
- Tampering breaks the chain
- Periodic verification via `verifyChain()`

## Data Model

### Entity-Relationship Diagram

```
┌─────────────┐       ┌─────────────────┐       ┌─────────────┐
│   realms    │       │  attestations   │       │  resolvers  │
├─────────────┤       ├─────────────────┤       ├─────────────┤
│ id (PK)     │◄──────│ realm_id (FK)   │       │ id (PK)     │
│ parent_id   │───┐   │ resolver_id─────│───────►│ version     │
│ path        │   │   │ attester_id     │       │ name        │
│ name        │   │   │ subject_id      │       │ schemas     │
│ domain      │   │   │ claim           │       └─────────────┘
│ rules       │   │   │ evidence        │
│ public_key  │   │   │ status          │       ┌─────────────┐
└─────────────┘   │   └─────────────────┘       │ evaluations │
                  │           │                 ├─────────────┤
                  │           │                 │ from_entity │
                  │   ┌───────▼───────┐         │ to_entity   │
                  │   │verification_  │         │ realm_id────│───┐
                  │   │    runs       │         │ score       │   │
                  │   ├───────────────┤         │ weight      │   │
                  │   │ attestation_id│         └─────────────┘   │
                  │   │ resolver_id   │                           │
                  │   │ status        │         ┌─────────────┐   │
                  │   │ output        │         │ reputation  │   │
                  │   │ snapshot      │         │   _cache    │   │
                  │   └───────────────┘         ├─────────────┤   │
                  │                             │ subject_id  │   │
                  └─────────────────────────────│ realm_id────│───┘
                                                │ score       │
                                                │ confidence  │
                                                └─────────────┘
```

## Security Considerations

### Cryptographic Primitives
- **Hashing:** SHA-256 for content addressing
- **Signatures:** Ed25519 for attestations and proofs
- **Merkle Trees:** For evidence inclusion proofs

### Attack Vectors & Mitigations

| Attack | Mitigation |
|--------|------------|
| Sybil (fake accounts) | Evaluator diversity scoring, verification cost |
| Collusion | Graph analysis, temporal spread detection |
| Replay | Timestamps, nonces, expiration |
| Tampering | Cryptographic signatures, audit chain |
| Impersonation | Ed25519 signatures on all operations |

### Anti-Sybil Scoring

```typescript
function computeSybilResistance(evaluations, attestations, graph) {
  return {
    evaluatorDiversity: uniqueEvaluators / threshold,
    verificationDepth: avgVerifications / threshold,
    temporalSpread: timeRange / threshold,
    crossRealmConsistency: uniqueRealms / threshold
  };
}
```

## Performance Considerations

### Caching Strategy
- Reputation scores cached with configurable TTL (default: 5 min)
- Cache invalidated on new evaluations
- Proofs cached until expiration

### Query Optimization
- Materialized paths for realm hierarchy
- Indexes on all foreign keys
- JSONB GIN indexes for evidence queries

### Scalability Path
1. **Vertical:** Increase PostgreSQL resources
2. **Horizontal:** Read replicas for queries
3. **Distributed:** Federation between IRRL instances (planned)

## API Design

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /realms | Create realm |
| GET | /realms/:id | Get realm |
| GET | /realms/:id/tree | Get realm hierarchy |
| POST | /attestations | Create attestation |
| GET | /attestations/:id | Get attestation |
| GET | /attestations/:id/graph | Get evidence graph |
| POST | /verify/:id | Verify attestation |
| POST | /trust/evaluations | Create evaluation |
| POST | /trust/transitive | Compute transitive trust |
| GET | /trust/reputation/:subject | Get reputation |
| POST | /proofs/generate | Generate portable proof |
| POST | /proofs/verify | Verify proof |
| GET | /resolvers | List resolvers |
| POST | /resolvers/:id/test | Test resolver |

### Response Format

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    requestId: string;
    timestamp: Date;
    durationMs: number;
  };
}
```

## Deployment

### Requirements
- Node.js 18+
- PostgreSQL 14+
- ~512MB RAM minimum
- ~1GB disk for small deployments

### Environment Variables
See `.env.example` for complete list.

### Docker (Planned)
```yaml
services:
  irrl-api:
    image: irrl/api:latest
    environment:
      DATABASE_URL: postgres://...
    ports:
      - "3000:3000"
  
  postgres:
    image: postgres:14
    volumes:
      - pgdata:/var/lib/postgresql/data
```

## Future Roadmap

### v2.1
- [ ] GraphQL API
- [ ] WebSocket subscriptions
- [ ] Batch operations

### v2.2
- [ ] Zero-knowledge proofs for privacy
- [ ] Resolver marketplace
- [ ] Multi-instance federation

### v3.0
- [ ] Blockchain anchoring (optional)
- [ ] Cross-chain proof verification
- [ ] Decentralized resolver registry

---

*Last updated: December 2025*

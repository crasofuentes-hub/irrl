-- IRRL Database Schema v2.0

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Realms (Trust Contexts)
CREATE TABLE realms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    parent_id TEXT REFERENCES realms(id) ON DELETE SET NULL,
    path TEXT NOT NULL UNIQUE,
    depth INTEGER NOT NULL DEFAULT 0,
    domain TEXT NOT NULL,
    rules JSONB NOT NULL DEFAULT '{"minVerifications":1,"requiredResolvers":[],"optionalResolvers":[],"decayHalfLife":"180d","minScore":0,"maxTransitiveDepth":5,"transitiveDecayFactor":0.8}'::jsonb,
    public_key TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_realms_parent ON realms(parent_id);
CREATE INDEX idx_realms_domain ON realms(domain);

-- Attestations
CREATE TABLE attestations (
    id TEXT PRIMARY KEY,
    realm_id TEXT NOT NULL REFERENCES realms(id),
    attester_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    claim TEXT NOT NULL,
    claim_hash TEXT NOT NULL,
    resolver_id TEXT NOT NULL,
    evidence JSONB NOT NULL,
    evidence_hash TEXT NOT NULL,
    reference_ids TEXT[] DEFAULT '{}',
    signature TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed','revoked','expired')),
    expires_at TIMESTAMPTZ,
    verification_count INTEGER NOT NULL DEFAULT 0,
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_attestations_realm ON attestations(realm_id);
CREATE INDEX idx_attestations_subject ON attestations(subject_id);
CREATE INDEX idx_attestations_status ON attestations(status);

-- Verification Runs
CREATE TABLE verification_runs (
    id TEXT PRIMARY KEY,
    attestation_id TEXT NOT NULL REFERENCES attestations(id) ON DELETE CASCADE,
    resolver_id TEXT NOT NULL,
    resolver_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('verified','failed','error')),
    output JSONB NOT NULL,
    output_hash TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    duration_ms INTEGER NOT NULL,
    triggered_by TEXT NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_verification_runs_attestation ON verification_runs(attestation_id);

-- Evaluations (Trust Edges)
CREATE TABLE evaluations (
    id TEXT PRIMARY KEY,
    from_entity_id TEXT NOT NULL,
    to_entity_id TEXT NOT NULL,
    realm_id TEXT NOT NULL REFERENCES realms(id),
    domain TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    weight NUMERIC(3,2) NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1),
    rationale TEXT,
    supporting_attestation_ids TEXT[] DEFAULT '{}',
    signature TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_active_evaluation UNIQUE (from_entity_id, to_entity_id, realm_id, domain)
);
CREATE INDEX idx_evaluations_from ON evaluations(from_entity_id);
CREATE INDEX idx_evaluations_to ON evaluations(to_entity_id);
CREATE INDEX idx_evaluations_realm ON evaluations(realm_id);

-- Reputation Cache
CREATE TABLE reputation_cache (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL,
    realm_id TEXT NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    score NUMERIC(5,2) NOT NULL,
    confidence NUMERIC(3,2) NOT NULL,
    evaluation_count INTEGER NOT NULL,
    attestation_count INTEGER NOT NULL,
    breakdown JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ NOT NULL,
    CONSTRAINT unique_reputation_cache UNIQUE (subject_id, realm_id, domain)
);
CREATE INDEX idx_reputation_cache_subject ON reputation_cache(subject_id);

-- Resolvers
CREATE TABLE resolvers (
    id TEXT NOT NULL,
    version TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    author_id TEXT NOT NULL,
    evidence_schema JSONB NOT NULL,
    output_schema JSONB NOT NULL,
    domains TEXT[] DEFAULT '{}',
    deterministic BOOLEAN NOT NULL DEFAULT true,
    avg_verification_time_ms INTEGER,
    active BOOLEAN NOT NULL DEFAULT true,
    deprecated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, version)
);

-- Proofs
CREATE TABLE proofs (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL,
    realm_id TEXT NOT NULL REFERENCES realms(id),
    domain TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT 'IRRL-Proof-v1',
    reputation_data JSONB NOT NULL,
    evidence_merkle_root TEXT NOT NULL,
    signature TEXT NOT NULL,
    issuer TEXT NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ NOT NULL,
    verification_count INTEGER NOT NULL DEFAULT 0,
    last_verified_at TIMESTAMPTZ
);
CREATE INDEX idx_proofs_subject ON proofs(subject_id);

-- Audit Log
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    content_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    entity_ids TEXT[] DEFAULT '{}',
    payload JSONB NOT NULL,
    previous_hash TEXT NOT NULL,
    hash TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_log_type ON audit_log(event_type);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC);

-- Triggers
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER update_realms_updated_at BEFORE UPDATE ON realms FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_attestations_updated_at BEFORE UPDATE ON attestations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_resolvers_updated_at BEFORE UPDATE ON resolvers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION compute_realm_path() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN NEW.path = NEW.id; NEW.depth = 0;
  ELSE SELECT path || '/' || NEW.id, depth + 1 INTO NEW.path, NEW.depth FROM realms WHERE id = NEW.parent_id;
  END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER compute_realm_path_trigger BEFORE INSERT ON realms FOR EACH ROW EXECUTE FUNCTION compute_realm_path();

-- Initial Data
INSERT INTO realms (id, name, description, domain, path, public_key, created_by) VALUES
('technology', 'Technology', 'Technology trust contexts', 'technology', 'technology', 'pending', 'system'),
('ai', 'Artificial Intelligence', 'AI systems trust contexts', 'ai', 'ai', 'pending', 'system'),
('finance', 'Finance', 'Financial trust contexts', 'finance', 'finance', 'pending', 'system');

INSERT INTO realms (id, name, description, parent_id, domain, path, public_key, created_by) VALUES
('ai-agents', 'AI Agents', 'Autonomous AI agents', 'ai', 'agents', 'ai/ai-agents', 'pending', 'system'),
('coding-agents', 'Coding Agents', 'AI agents for software development', 'ai-agents', 'coding', 'ai/ai-agents/coding-agents', 'pending', 'system');

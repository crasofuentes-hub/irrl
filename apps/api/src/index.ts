import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { env, validateEnv } from "./env";
import { healthCheck, closePool } from "./db/pool";
import { registerBuiltInResolvers } from "./resolvers";
import { auditLog } from "./audit/auditLog";
import { realmsRouter } from "./routes/realms.routes";
import { attestationsRouter } from "./routes/attestations.routes";
import { verifyRouter } from "./routes/verify.routes";
import { trustRouter } from "./routes/trust.routes";
import { proofsRouter } from "./routes/proofs.routes";
import { resolversRouter } from "./routes/resolvers.routes";

const app = express();
validateEnv();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGINS === "*" ? true : env.CORS_ORIGINS.split(",") }));
app.use(express.json({ limit: "10mb" }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

app.get("/", (_req: Request, res: Response) => {
  res.json({ name: "IRRL - Interoperable Reputation & Resolution Layer", version: "2.0.0", health: "/health" });
});

app.get("/health", async (_req: Request, res: Response) => {
  const dbOk = await healthCheck();
  res.status(dbOk ? 200 : 503).json({ status: dbOk ? "healthy" : "unhealthy", timestamp: new Date().toISOString(), services: { database: dbOk ? "connected" : "disconnected" } });
});

app.get("/info", (_req: Request, res: Response) => {
  res.json({ version: "2.0.0", features: { transitiveTrust: true, temporalDecay: true, cryptographicProofs: true, hierarchicalRealms: true, antiSybil: true },
    endpoints: { realms: "/realms", attestations: "/attestations", verify: "/verify", trust: "/trust", proofs: "/proofs", resolvers: "/resolvers" } });
});

app.use("/realms", realmsRouter);
app.use("/attestations", attestationsRouter);
app.use("/verify", verifyRouter);
app.use("/trust", trustRouter);
app.use("/proofs", proofsRouter);
app.use("/resolvers", resolversRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Resource not found" } });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Error:", err);
  res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: env.NODE_ENV === "production" ? "Internal error" : err.message } });
});

async function runMigrations(): Promise<void> {
  const { query } = await import("./db/pool");
  const result = await query("SELECT to_regclass('public.realms')");
  if (result[0]?.to_regclass) { console.log("Tables exist"); return; }
  console.log("Creating tables...");
  await query(`CREATE TABLE IF NOT EXISTS realms (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, parent_id TEXT, path TEXT NOT NULL UNIQUE, depth INTEGER DEFAULT 0, domain TEXT NOT NULL, rules JSONB DEFAULT '{}', public_key TEXT NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await query(`CREATE TABLE IF NOT EXISTS attestations (id TEXT PRIMARY KEY, realm_id TEXT NOT NULL REFERENCES realms(id), attester_id TEXT NOT NULL, subject_id TEXT NOT NULL, claim TEXT NOT NULL, claim_hash TEXT NOT NULL, resolver_id TEXT NOT NULL, evidence JSONB NOT NULL, evidence_hash TEXT NOT NULL, reference_ids TEXT[] DEFAULT '{}', signature TEXT NOT NULL, status TEXT DEFAULT 'pending', expires_at TIMESTAMPTZ, verification_count INTEGER DEFAULT 0, last_verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await query(`CREATE TABLE IF NOT EXISTS verification_runs (id TEXT PRIMARY KEY, attestation_id TEXT NOT NULL REFERENCES attestations(id), resolver_id TEXT NOT NULL, resolver_version TEXT NOT NULL, status TEXT NOT NULL, output JSONB NOT NULL, output_hash TEXT NOT NULL, snapshot JSONB NOT NULL, duration_ms INTEGER NOT NULL, triggered_by TEXT NOT NULL, error_message TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await query(`CREATE TABLE IF NOT EXISTS evaluations (id TEXT PRIMARY KEY, from_entity_id TEXT NOT NULL, to_entity_id TEXT NOT NULL, realm_id TEXT NOT NULL REFERENCES realms(id), domain TEXT NOT NULL, score INTEGER NOT NULL, weight NUMERIC(3,2) DEFAULT 1.0, rationale TEXT, supporting_attestation_ids TEXT[] DEFAULT '{}', signature TEXT NOT NULL, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (from_entity_id, to_entity_id, realm_id, domain))`);
  await query(`CREATE TABLE IF NOT EXISTS reputation_cache (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, realm_id TEXT NOT NULL REFERENCES realms(id), domain TEXT NOT NULL, score NUMERIC(5,2) NOT NULL, confidence NUMERIC(3,2) NOT NULL, evaluation_count INTEGER NOT NULL, attestation_count INTEGER NOT NULL, breakdown JSONB NOT NULL, computed_at TIMESTAMPTZ DEFAULT NOW(), valid_until TIMESTAMPTZ NOT NULL, UNIQUE (subject_id, realm_id, domain))`);
  await query(`CREATE TABLE IF NOT EXISTS resolvers (id TEXT NOT NULL, version TEXT NOT NULL, name TEXT NOT NULL, description TEXT, author_id TEXT NOT NULL, evidence_schema JSONB NOT NULL, output_schema JSONB NOT NULL, domains TEXT[] DEFAULT '{}', deterministic BOOLEAN DEFAULT true, avg_verification_time_ms INTEGER, active BOOLEAN DEFAULT true, deprecated_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, version))`);
  await query(`CREATE TABLE IF NOT EXISTS proofs (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, realm_id TEXT NOT NULL REFERENCES realms(id), domain TEXT NOT NULL, version TEXT DEFAULT 'IRRL-Proof-v1', reputation_data JSONB NOT NULL, evidence_merkle_root TEXT NOT NULL, signature TEXT NOT NULL, issuer TEXT NOT NULL, issued_at TIMESTAMPTZ DEFAULT NOW(), valid_until TIMESTAMPTZ NOT NULL, verification_count INTEGER DEFAULT 0, last_verified_at TIMESTAMPTZ)`);
  await query(`CREATE TABLE IF NOT EXISTS audit_log (id BIGSERIAL PRIMARY KEY, content_id TEXT NOT NULL UNIQUE, event_type TEXT NOT NULL, actor_id TEXT NOT NULL, entity_ids TEXT[] DEFAULT '{}', payload JSONB NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL, timestamp TIMESTAMPTZ DEFAULT NOW())`);
  await query(`INSERT INTO realms (id, name, description, domain, path, public_key, created_by) VALUES ('technology', 'Technology', 'Tech trust', 'technology', 'technology', 'pending', 'system'), ('ai', 'AI', 'AI trust', 'ai', 'ai', 'pending', 'system'), ('finance', 'Finance', 'Finance trust', 'finance', 'finance', 'pending', 'system') ON CONFLICT DO NOTHING`);
  console.log("Tables created!");
}

async function start(): Promise<void> {
  try {
    await runMigrations();
    await auditLog.initialize();
    registerBuiltInResolvers();
    app.listen(env.PORT, env.HOST, () => {
      console.log(`IRRL running on http://${env.HOST}:${env.PORT}`);
    });
  } catch (e) { console.error("Failed to start:", e); process.exit(1); }
}

async function shutdown(): Promise<void> {
  console.log("\nShutting down...");
  await closePool();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
start();

export { app };
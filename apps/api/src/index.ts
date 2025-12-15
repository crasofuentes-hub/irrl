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

async function start(): Promise<void> {
  try {
    await auditLog.initialize();
    registerBuiltInResolvers();
    app.listen(env.PORT, env.HOST, () => {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║  IRRL - Interoperable Reputation & Resolution Layer          ║
║  Version 2.0.0                                               ║
║  Server: http://${env.HOST}:${env.PORT}                               ║
║  "No decide la verdad. Registra por qué se confía."          ║
╚══════════════════════════════════════════════════════════════╝`);
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

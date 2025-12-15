import { Router, Request, Response } from "express";
import { query, queryOne } from "../db/pool";
import { contentId } from "../crypto";
import { logAttestationVerified } from "../audit/auditLog";
import { Attestation, VerificationRun } from "../core/types";
import { resolverRegistry } from "../resolvers";

export const verifyRouter = Router();

verifyRouter.post("/:attestationId", async (req: Request, res: Response) => {
  try {
    const { attestationId } = req.params;
    const { force = false } = req.body;

    const att = await queryOne<Attestation>("SELECT * FROM attestations WHERE id = $1", [attestationId]);
    if (!att) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Attestation not found" } });

    if (!force && att.status === "verified") {
      const last = await queryOne<VerificationRun>("SELECT * FROM verification_runs WHERE attestation_id = $1 ORDER BY created_at DESC LIMIT 1", [attestationId]);
      return res.json({ success: true, data: { attestation: att, verification: last, cached: true } });
    }

    const resolver = resolverRegistry.get(att.resolverId);
    if (!resolver) return res.status(400).json({ success: false, error: { code: "RESOLVER_NOT_FOUND", message: `Resolver ${att.resolverId} not found` } });

    const evidence = typeof att.evidence === "string" ? JSON.parse(att.evidence) : att.evidence;
    const start = Date.now();
    const result = await resolver.verify(evidence);
    const duration = Date.now() - start;

    const verId = contentId({ attestationId, ts: Date.now(), hash: result.outputHash });
    await query(`INSERT INTO verification_runs (id, attestation_id, resolver_id, resolver_version, status, output, output_hash, snapshot, duration_ms, triggered_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [verId, attestationId, resolver.metadata.id, resolver.metadata.version, result.status, JSON.stringify(result.output), result.outputHash, JSON.stringify(result.snapshot), duration, "api"]);

    const newStatus = result.status === "verified" ? "verified" : result.status === "failed" ? "failed" : "pending";
    await query("UPDATE attestations SET status = $1, verification_count = verification_count + 1, last_verified_at = NOW(), updated_at = NOW() WHERE id = $2", [newStatus, attestationId]);

    await logAttestationVerified("api", attestationId, { verificationId: verId, status: result.status, duration });
    const updated = await queryOne<Attestation>("SELECT * FROM attestations WHERE id = $1", [attestationId]);

    res.json({ success: true, data: { attestation: updated, verification: { id: verId, ...result, durationMs: duration }, cached: false } });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to verify" } }); }
});

verifyRouter.get("/:attestationId/history", async (req: Request, res: Response) => {
  try {
    const { attestationId } = req.params;
    const { limit = "20" } = req.query;
    const att = await queryOne<{ id: string }>("SELECT id FROM attestations WHERE id = $1", [attestationId]);
    if (!att) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Attestation not found" } });
    const vers = await query<VerificationRun>("SELECT * FROM verification_runs WHERE attestation_id = $1 ORDER BY created_at DESC LIMIT $2", [attestationId, parseInt(limit as string)]);
    res.json({ success: true, data: vers });
  } catch (e) { res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to get history" } }); }
});

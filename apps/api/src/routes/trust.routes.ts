import { Router, Request, Response } from "express";
import { query, queryOne } from "../db/pool";
import { contentId, signObject, generateKeyPair } from "../crypto";
import { logEvaluationCreated } from "../audit/auditLog";
import { Evaluation, TransitiveTrustQuery } from "../core/types";
import { TrustGraph, computeReputationWithDecay, computeSybilResistance } from "../graph/trustGraph";

export const trustRouter = Router();
const instanceKeys = generateKeyPair();

trustRouter.post("/evaluations", async (req: Request, res: Response) => {
  try {
    const { from, to, realmId, domain, score, weight = 1.0, rationale, supportingAttestations } = req.body;
    if (!from || !to || !realmId || !domain || score === undefined)
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Missing required fields" } });
    if (score < 0 || score > 100) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "score must be 0-100" } });

    const realm = await queryOne<{ id: string }>("SELECT id FROM realms WHERE id = $1", [realmId]);
    if (!realm) return res.status(400).json({ success: false, error: { code: "INVALID_REALM", message: "Realm not found" } });

    const data = { from, to, realmId, domain, score, ts: Date.now() };
    const evalId = contentId(data);
    const signature = signObject(data, instanceKeys.privateKey);

    const existing = await queryOne<{ id: string }>("SELECT id FROM evaluations WHERE from_entity_id = $1 AND to_entity_id = $2 AND realm_id = $3 AND domain = $4", [from, to, realmId, domain]);
    if (existing) {
      await query("UPDATE evaluations SET score = $1, weight = $2, rationale = $3, supporting_attestation_ids = $4, signature = $5 WHERE id = $6",
        [score, weight, rationale || null, supportingAttestations || [], signature, existing.id]);
      const updated = await queryOne<Evaluation>("SELECT * FROM evaluations WHERE id = $1", [existing.id]);
      return res.json({ success: true, data: updated, updated: true });
    }

    await query(`INSERT INTO evaluations (id, from_entity_id, to_entity_id, realm_id, domain, score, weight, rationale, supporting_attestation_ids, signature)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [evalId, from, to, realmId, domain, score, weight, rationale || null, supportingAttestations || [], signature]);

    const evaluation = await queryOne<Evaluation>("SELECT * FROM evaluations WHERE id = $1", [evalId]);
    await logEvaluationCreated("api", evalId, from, to, { score, domain, realmId });
    await query("DELETE FROM reputation_cache WHERE subject_id = $1 AND realm_id = $2", [to, realmId]);
    res.status(201).json({ success: true, data: evaluation, updated: false });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to create evaluation" } }); }
});

trustRouter.get("/evaluations", async (req: Request, res: Response) => {
  try {
    const { from, to, realm, domain, limit = "50" } = req.query;
    let sql = "SELECT * FROM evaluations WHERE 1=1";
    const params: unknown[] = [];
    let idx = 1;
    if (from) { sql += ` AND from_entity_id = $${idx}`; params.push(from); idx++; }
    if (to) { sql += ` AND to_entity_id = $${idx}`; params.push(to); idx++; }
    if (realm) { sql += ` AND realm_id = $${idx}`; params.push(realm); idx++; }
    if (domain) { sql += ` AND domain = $${idx}`; params.push(domain); idx++; }
    sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
    params.push(parseInt(limit as string));
    const evals = await query(sql, params);
    res.json({ success: true, data: evals });
  } catch (e) { res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to get evaluations" } }); }
});

trustRouter.post("/transitive", async (req: Request, res: Response) => {
  try {
    const q: TransitiveTrustQuery = req.body;
    if (!q.from || !q.to || !q.domain) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "from, to, domain required" } });
    
    let sql = "SELECT * FROM evaluations WHERE domain = $1";
    const params: unknown[] = [q.domain];
    if (q.realmId) { sql += " AND realm_id = $2"; params.push(q.realmId); }
    
    const rows = await query<{ id: string; from_entity_id: string; to_entity_id: string; realm_id: string; domain: string; score: number; weight: number; rationale: string; supporting_attestation_ids: string[]; signature: string; created_at: Date; expires_at: Date | null }>(sql, params);
    const evals: Evaluation[] = rows.map(r => ({ id: r.id, fromEntity: r.from_entity_id, toEntity: r.to_entity_id, realmId: r.realm_id, domain: r.domain, score: r.score, weight: r.weight, rationale: r.rationale, supportingAttestations: r.supporting_attestation_ids, signature: r.signature, createdAt: r.created_at, expiresAt: r.expires_at }));
    
    const graph = new TrustGraph();
    graph.loadFromEvaluations(evals);
    const result = graph.computeTransitiveTrust(q);
    res.json({ success: true, data: result });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to compute trust" } }); }
});

trustRouter.get("/reputation/:subject", async (req: Request, res: Response) => {
  try {
    const { subject } = req.params;
    const { realm, domain, refresh = "false" } = req.query;
    if (!realm || !domain) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "realm and domain required" } });

    if (refresh !== "true") {
      const cached = await queryOne<{ score: number; confidence: number; evaluation_count: number; attestation_count: number; breakdown: Record<string, unknown> }>(
        "SELECT * FROM reputation_cache WHERE subject_id = $1 AND realm_id = $2 AND domain = $3 AND valid_until > NOW()", [subject, realm, domain]);
      if (cached) return res.json({ success: true, data: cached, cached: true });
    }

    const rows = await query<{ id: string; from_entity_id: string; to_entity_id: string; realm_id: string; domain: string; score: number; weight: number; rationale: string; supporting_attestation_ids: string[]; signature: string; created_at: Date; expires_at: Date | null }>(
      "SELECT * FROM evaluations WHERE to_entity_id = $1 AND realm_id = $2 AND domain = $3", [subject, realm, domain]);
    if (!rows.length) return res.json({ success: true, data: null, message: "No evaluations found" });

    const evals: Evaluation[] = rows.map(r => ({ id: r.id, fromEntity: r.from_entity_id, toEntity: r.to_entity_id, realmId: r.realm_id, domain: r.domain, score: r.score, weight: r.weight, rationale: r.rationale, supportingAttestations: r.supporting_attestation_ids, signature: r.signature, createdAt: r.created_at, expiresAt: r.expires_at }));
    const atts = await query<{ verification_count: number; created_at: Date }>("SELECT verification_count, created_at FROM attestations WHERE subject_id = $1 AND realm_id = $2", [subject, realm]);

    const realmData = await queryOne<{ rules: { decayHalfLife?: string; minScore?: number } }>("SELECT rules FROM realms WHERE id = $1", [realm]);
    const halfLife = parseInt((realmData?.rules?.decayHalfLife || "180d").replace("d", "")) || 180;

    const timestamps = evals.map(e => e.createdAt.getTime());
    const result = computeReputationWithDecay({ evaluations: evals, attestationCount: atts.length, verifiedAttestationCount: atts.filter(a => a.verification_count > 0).length, oldestEvaluationDate: new Date(Math.min(...timestamps)), newestEvaluationDate: new Date(Math.max(...timestamps)) }, { halfLifeDays: halfLife, minScore: realmData?.rules?.minScore || 0, maxScore: 100 });

    const graph = new TrustGraph();
    graph.loadFromEvaluations(evals);
    const sybil = computeSybilResistance(evals, atts.map(a => ({ verificationCount: a.verification_count })), graph);

    const cacheId = contentId({ subject, realm, domain, ts: Date.now() });
    const validUntil = new Date(Date.now() + 5 * 60 * 1000);
    await query(`INSERT INTO reputation_cache (id, subject_id, realm_id, domain, score, confidence, evaluation_count, attestation_count, breakdown, valid_until)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (subject_id, realm_id, domain) DO UPDATE SET score = $5, confidence = $6, evaluation_count = $7, attestation_count = $8, breakdown = $9, computed_at = NOW(), valid_until = $10`,
      [cacheId, subject, realm, domain, result.score, result.confidence, evals.length, atts.length, JSON.stringify(result.breakdown), validUntil]);

    res.json({ success: true, data: { reputation: { subject, realmId: realm, domain, score: result.score, confidence: result.confidence, evaluationCount: evals.length, attestationCount: atts.length, breakdown: result.breakdown }, sybilResistance: sybil }, cached: false });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to get reputation" } }); }
});

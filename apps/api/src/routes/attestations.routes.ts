import { Router, Request, Response } from "express";
import { query, queryOne } from "../db/pool";
import { contentId, sha256, signObject, generateKeyPair } from "../crypto";
import { logAttestationCreated } from "../audit/auditLog";
import { Attestation, AttestationInput } from "../core/types";
import { resolverRegistry } from "../resolvers";

export const attestationsRouter = Router();
const instanceKeys = generateKeyPair();

attestationsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const input: AttestationInput = req.body;
    if (!input.realmId || !input.subject || !input.claim || !input.resolverId || !input.evidence)
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Missing required fields" } });

    const realm = await queryOne<{ id: string }>("SELECT id FROM realms WHERE id = $1", [input.realmId]);
    if (!realm) return res.status(400).json({ success: false, error: { code: "INVALID_REALM", message: "Realm not found" } });

    const resolver = resolverRegistry.get(input.resolverId);
    if (!resolver) return res.status(400).json({ success: false, error: { code: "INVALID_RESOLVER", message: "Resolver not found" } });

    const validation = resolver.validateEvidence(input.evidence);
    if (!validation.valid) return res.status(400).json({ success: false, error: { code: "INVALID_EVIDENCE", message: "Evidence invalid", details: validation.errors } });

    const data = { realmId: input.realmId, subject: input.subject, claim: input.claim, resolverId: input.resolverId, evidence: input.evidence, references: input.references || [], ts: Date.now() };
    const attId = contentId(data);
    const signature = signObject(data, instanceKeys.privateKey);

    await query(`INSERT INTO attestations (id, realm_id, attester_id, subject_id, claim, claim_hash, resolver_id, evidence, evidence_hash, reference_ids, signature, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [attId, input.realmId, "api", input.subject, input.claim, sha256(input.claim), input.resolverId, JSON.stringify(input.evidence), sha256(JSON.stringify(input.evidence)), input.references || [], signature, input.expiresAt || null]);

    const att = await queryOne<Attestation>("SELECT * FROM attestations WHERE id = $1", [attId]);
    await logAttestationCreated("api", attId, data);
    res.status(201).json({ success: true, data: att });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to create attestation" } }); }
});

attestationsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const att = await queryOne<Attestation>("SELECT * FROM attestations WHERE id = $1", [req.params.id]);
    if (!att) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Attestation not found" } });
    res.json({ success: true, data: att });
  } catch (e) { res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to get attestation" } }); }
});

attestationsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { realm, subject, status, limit = "50", offset = "0" } = req.query;
    let sql = "SELECT * FROM attestations WHERE 1=1";
    const params: unknown[] = [];
    let idx = 1;
    if (realm) { sql += ` AND realm_id = $${idx}`; params.push(realm); idx++; }
    if (subject) { sql += ` AND subject_id = $${idx}`; params.push(subject); idx++; }
    if (status) { sql += ` AND status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit as string), parseInt(offset as string));
    const atts = await query<Attestation>(sql, params);
    res.json({ success: true, data: atts });
  } catch (e) { res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to list attestations" } }); }
});

attestationsRouter.post("/:id/revoke", async (req: Request, res: Response) => {
  try {
    const att = await queryOne<Attestation>("SELECT * FROM attestations WHERE id = $1", [req.params.id]);
    if (!att) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Attestation not found" } });
    if (att.status === "revoked") return res.status(400).json({ success: false, error: { code: "ALREADY_REVOKED", message: "Already revoked" } });
    await query("UPDATE attestations SET status = 'revoked', updated_at = NOW() WHERE id = $1", [req.params.id]);
    const updated = await queryOne<Attestation>("SELECT * FROM attestations WHERE id = $1", [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (e) { res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to revoke" } }); }
});

/**
 * IRRL Proofs Routes
 * Generate and verify portable cryptographic proofs
 */

import { Router, Request, Response } from "express";
import { query, queryOne } from "../db/pool";
import { 
  contentId, 
  generateKeyPair, 
  generateSignedProof, 
  verifySignedProof,
  getMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof
} from "../crypto";
import { logProofGenerated } from "../audit/auditLog";
import { ReputationProof } from "../core/types";

export const proofsRouter = Router();

// Instance keys (in production, load from secure storage)
const instanceKeys = generateKeyPair();
const ISSUER_ID = "irrl-instance-001";

// ============================================================================
// GENERATE REPUTATION PROOF
// ============================================================================

proofsRouter.post("/generate", async (req: Request, res: Response) => {
  try {
    const { subject, realmId, domain, validForDays = 7 } = req.body;

    if (!subject || !realmId || !domain) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "subject, realmId, and domain are required" },
      });
    }

    // Get reputation data
    const reputation = await queryOne<{
      score: number;
      confidence: number;
      evaluation_count: number;
      attestation_count: number;
      breakdown: Record<string, unknown>;
    }>(
      `SELECT score, confidence, evaluation_count, attestation_count, breakdown 
       FROM reputation_cache 
       WHERE subject_id = $1 AND realm_id = $2 AND domain = $3`,
      [subject, realmId, domain]
    );

    if (!reputation) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "No reputation data found. Compute reputation first." },
      });
    }

    // Get supporting evidence (attestation IDs)
    const attestations = await query<{ id: string }>(
      "SELECT id FROM attestations WHERE subject_id = $1 AND realm_id = $2 AND status = 'verified'",
      [subject, realmId]
    );

    const attestationIds = attestations.map(a => a.id);
    
    // Get evaluations for Merkle tree
    const evaluations = await query<{ id: string }>(
      "SELECT id FROM evaluations WHERE to_entity_id = $1 AND realm_id = $2 AND domain = $3",
      [subject, realmId, domain]
    );

    const evaluationIds = evaluations.map(e => e.id);

    // Build Merkle tree of evidence
    const evidenceLeaves = [...attestationIds, ...evaluationIds];
    const evidenceMerkleRoot = evidenceLeaves.length > 0 
      ? getMerkleRoot(evidenceLeaves)
      : "empty";

    // Create proof
    const issuedAt = new Date();
    const validUntil = new Date(Date.now() + validForDays * 24 * 60 * 60 * 1000);

    const proofData: Omit<ReputationProof, "signature"> = {
      version: "IRRL-Proof-v1",
      subject,
      realmId,
      domain,
      reputation: {
        subject,
        realmId,
        domain,
        score: reputation.score,
        confidence: reputation.confidence,
        evaluationCount: reputation.evaluation_count,
        attestationCount: reputation.attestation_count,
        breakdown: {
          directEvaluations: (reputation.breakdown as any)?.directEvaluations || 0,
          transitiveEvaluations: (reputation.breakdown as any)?.transitiveEvaluations || 0,
          attestationBonus: (reputation.breakdown as any)?.attestationBonus || 0,
          decayPenalty: (reputation.breakdown as any)?.decayPenalty || 0,
        },
        computedAt: issuedAt,
        validUntil,
      },
      issuer: ISSUER_ID,
      issuedAt,
      validUntil,
      evidenceMerkleRoot,
    };

    // Sign the proof
    const signedProof = generateSignedProof(
      proofData as Record<string, unknown>,
      instanceKeys.privateKey,
      instanceKeys.publicKey,
      "IRRL-Proof-v1"
    );

    // Store proof
    const proofId = contentId({ subject, realmId, domain, issuedAt: issuedAt.toISOString() });
    
    await query(
      `INSERT INTO proofs 
       (id, subject_id, realm_id, domain, version, reputation_data, evidence_merkle_root, signature, issuer, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        proofId,
        subject,
        realmId,
        domain,
        "IRRL-Proof-v1",
        JSON.stringify(proofData.reputation),
        evidenceMerkleRoot,
        signedProof.signature,
        ISSUER_ID,
        validUntil,
      ]
    );

    // Log generation
    await logProofGenerated("api", proofId, subject, realmId);

    res.status(201).json({
      success: true,
      data: {
        proofId,
        proof: signedProof,
        evidenceCount: evidenceLeaves.length,
      },
    });
  } catch (error) {
    console.error("Generate proof error:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to generate proof" },
    });
  }
});

// ============================================================================
// VERIFY PROOF
// ============================================================================

proofsRouter.post("/verify", async (req: Request, res: Response) => {
  try {
    const { proof } = req.body;

    if (!proof || !proof.data || !proof.signature || !proof.publicKey) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid proof format" },
      });
    }

    // Verify signature
    const signatureValid = verifySignedProof(proof);

    // Check expiration
    const validUntil = new Date(proof.data.validUntil);
    const expired = validUntil < new Date();

    // Check issuer (in production, verify against known issuers)
    const issuerTrusted = proof.data.issuer === ISSUER_ID;

    const result = {
      valid: signatureValid && !expired && issuerTrusted,
      signatureValid,
      expired,
      issuerTrusted,
      proofData: signatureValid ? proof.data : null,
    };

    if (!result.valid) {
      const errors: string[] = [];
      if (!signatureValid) errors.push("Invalid signature");
      if (expired) errors.push("Proof has expired");
      if (!issuerTrusted) errors.push("Untrusted issuer");
      
      return res.json({
        success: true,
        data: { ...result, errors },
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Verify proof error:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to verify proof" },
    });
  }
});

// ============================================================================
// GET PROOF
// ============================================================================

proofsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const proof = await queryOne<{
      id: string;
      subject_id: string;
      realm_id: string;
      domain: string;
      version: string;
      reputation_data: Record<string, unknown>;
      evidence_merkle_root: string;
      signature: string;
      issuer: string;
      issued_at: Date;
      valid_until: Date;
    }>("SELECT * FROM proofs WHERE id = $1", [id]);

    if (!proof) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Proof not found" },
      });
    }

    // Increment verification count
    await query(
      "UPDATE proofs SET verification_count = verification_count + 1, last_verified_at = NOW() WHERE id = $1",
      [id]
    );

    res.json({
      success: true,
      data: {
        id: proof.id,
        subject: proof.subject_id,
        realmId: proof.realm_id,
        domain: proof.domain,
        version: proof.version,
        reputation: proof.reputation_data,
        evidenceMerkleRoot: proof.evidence_merkle_root,
        signature: proof.signature,
        issuer: proof.issuer,
        issuedAt: proof.issued_at,
        validUntil: proof.valid_until,
        expired: new Date(proof.valid_until) < new Date(),
      },
    });
  } catch (error) {
    console.error("Get proof error:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to get proof" },
    });
  }
});

// ============================================================================
// GENERATE EVIDENCE INCLUSION PROOF
// ============================================================================

proofsRouter.post("/evidence-proof", async (req: Request, res: Response) => {
  try {
    const { proofId, evidenceId } = req.body;

    if (!proofId || !evidenceId) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "proofId and evidenceId are required" },
      });
    }

    // Get the proof
    const proof = await queryOne<{
      subject_id: string;
      realm_id: string;
      domain: string;
      evidence_merkle_root: string;
    }>("SELECT subject_id, realm_id, domain, evidence_merkle_root FROM proofs WHERE id = $1", [proofId]);

    if (!proof) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Proof not found" },
      });
    }

    // Rebuild evidence list
    const attestations = await query<{ id: string }>(
      "SELECT id FROM attestations WHERE subject_id = $1 AND realm_id = $2 AND status = 'verified' ORDER BY id",
      [proof.subject_id, proof.realm_id]
    );

    const evaluations = await query<{ id: string }>(
      "SELECT id FROM evaluations WHERE to_entity_id = $1 AND realm_id = $2 AND domain = $3 ORDER BY id",
      [proof.subject_id, proof.realm_id, proof.domain]
    );

    const evidenceLeaves = [...attestations.map(a => a.id), ...evaluations.map(e => e.id)];

    // Find the evidence in the list
    const leafIndex = evidenceLeaves.indexOf(evidenceId);

    if (leafIndex === -1) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Evidence not found in proof" },
      });
    }

    // Generate Merkle proof
    const merkleProof = generateMerkleProof(evidenceLeaves, leafIndex);

    if (!merkleProof) {
      return res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Failed to generate Merkle proof" },
      });
    }

    // Verify it matches the stored root
    const valid = merkleProof.root === proof.evidence_merkle_root;

    res.json({
      success: true,
      data: {
        merkleProof,
        valid,
        evidenceId,
        proofId,
      },
    });
  } catch (error) {
    console.error("Generate evidence proof error:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to generate evidence proof" },
    });
  }
});

// ============================================================================
// VERIFY EVIDENCE INCLUSION
// ============================================================================

proofsRouter.post("/verify-evidence", async (req: Request, res: Response) => {
  try {
    const { merkleProof, expectedRoot } = req.body;

    if (!merkleProof || !expectedRoot) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "merkleProof and expectedRoot are required" },
      });
    }

    const valid = verifyMerkleProof(merkleProof) && merkleProof.root === expectedRoot;

    res.json({
      success: true,
      data: {
        valid,
        leaf: merkleProof.leaf,
        root: merkleProof.root,
        matchesExpected: merkleProof.root === expectedRoot,
      },
    });
  } catch (error) {
    console.error("Verify evidence error:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to verify evidence" },
    });
  }
});

// ============================================================================
// LIST PROOFS
// ============================================================================

proofsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { subject, realm, includeExpired = "false", limit = "20" } = req.query;

    let sql = "SELECT * FROM proofs WHERE 1=1";
    const params: unknown[] = [];
    let paramIndex = 1;

    if (subject) {
      sql += ` AND subject_id = $${paramIndex}`;
      params.push(subject);
      paramIndex++;
    }

    if (realm) {
      sql += ` AND realm_id = $${paramIndex}`;
      params.push(realm);
      paramIndex++;
    }

    if (includeExpired !== "true") {
      sql += " AND valid_until > NOW()";
    }

    sql += ` ORDER BY issued_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit as string, 10));

    const proofs = await query(sql, params);

    res.json({
      success: true,
      data: proofs,
    });
  } catch (error) {
    console.error("List proofs error:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to list proofs" },
    });
  }
});

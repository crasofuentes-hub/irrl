import { query, queryOne } from "../db/pool";
import { sha256, contentId } from "../crypto";
import { AuditEvent, AuditEventType } from "../core/types";
import { env } from "../env";

class AuditLogManager {
  private lastHash = "genesis";
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const last = await queryOne<{ hash: string }>("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1");
    if (last) this.lastHash = last.hash;
    this.initialized = true;
  }

  async log(type: AuditEventType, actor: string, entityIds: string[], payload: Record<string, unknown>): Promise<AuditEvent> {
    if (!env.ENABLE_AUDIT_LOG) {
      return { id: contentId({ type, ts: Date.now() }), type, actor, entityIds, payload, previousHash: "disabled", hash: "disabled", timestamp: new Date() };
    }
    await this.initialize();
    const timestamp = new Date();
    const content = { type, actor, entityIds: entityIds.sort(), payload, timestamp: timestamp.toISOString(), previousHash: this.lastHash };
    const eventId = contentId(content);
    const eventHash = sha256(JSON.stringify(content));
    await query(
      `INSERT INTO audit_log (content_id, event_type, actor_id, entity_ids, payload, previous_hash, hash, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [eventId, type, actor, entityIds, JSON.stringify(payload), this.lastHash, eventHash, timestamp]
    );
    this.lastHash = eventHash;
    return { id: eventId, type, actor, entityIds, payload, previousHash: content.previousHash, hash: eventHash, timestamp };
  }

  async verifyChain(): Promise<{ valid: boolean; checkedEvents: number }> {
    const events = await query<{ id: number; previous_hash: string; hash: string; event_type: string; actor_id: string; entity_ids: string[]; payload: Record<string, unknown>; timestamp: Date }>(
      "SELECT * FROM audit_log ORDER BY id ASC"
    );
    if (!events.length) return { valid: true, checkedEvents: 0 };
    let prev = events[0].previous_hash;
    for (const e of events) {
      if (e.previous_hash !== prev && e.id !== events[0].id) return { valid: false, checkedEvents: events.indexOf(e) };
      const content = { type: e.event_type, actor: e.actor_id, entityIds: e.entity_ids.sort(), payload: e.payload, timestamp: e.timestamp.toISOString(), previousHash: e.previous_hash };
      if (sha256(JSON.stringify(content)) !== e.hash) return { valid: false, checkedEvents: events.indexOf(e) };
      prev = e.hash;
    }
    return { valid: true, checkedEvents: events.length };
  }
}

export const auditLog = new AuditLogManager();

export async function logRealmCreated(actor: string, realmId: string, data: Record<string, unknown>) {
  await auditLog.log("realm.created", actor, [realmId], { realm: data });
}
export async function logAttestationCreated(actor: string, id: string, data: Record<string, unknown>) {
  await auditLog.log("attestation.created", actor, [id], { attestation: data });
}
export async function logAttestationVerified(actor: string, id: string, result: Record<string, unknown>) {
  await auditLog.log("attestation.verified", actor, [id], { verification: result });
}
export async function logEvaluationCreated(actor: string, id: string, from: string, to: string, data: Record<string, unknown>) {
  await auditLog.log("evaluation.created", actor, [id, from, to], { evaluation: data });
}
export async function logProofGenerated(actor: string, id: string, subject: string, realm: string) {
  await auditLog.log("proof.generated", actor, [id, subject, realm], { proofId: id, subject, realm });
}

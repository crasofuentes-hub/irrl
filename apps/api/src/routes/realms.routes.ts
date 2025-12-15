import { Router, Request, Response } from "express";
import { query, queryOne } from "../db/pool";
import { contentId, generateKeyPair } from "../crypto";
import { logRealmCreated } from "../audit/auditLog";
import { Realm, RealmRules } from "../core/types";

export const realmsRouter = Router();

realmsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { name, description, parent, domain, rules } = req.body;
    if (!name || !domain) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "name and domain required" } });
    
    const realmId = contentId({ name, domain, ts: Date.now() }).replace("cid_", "realm_");
    const { publicKey } = generateKeyPair();
    
    let parentId: string | null = null;
    if (parent) {
      const p = await queryOne<{ id: string }>("SELECT id FROM realms WHERE id = $1 OR path = $1", [parent]);
      if (!p) return res.status(400).json({ success: false, error: { code: "INVALID_PARENT", message: "Parent not found" } });
      parentId = p.id;
    }
    
    const defaultRules: RealmRules = { minVerifications: 1, requiredResolvers: [], optionalResolvers: [], decayHalfLife: "180d", minScore: 0, maxTransitiveDepth: 5, transitiveDecayFactor: 0.8 };
    const merged = { ...defaultRules, ...rules };
    
    await query(`INSERT INTO realms (id, name, description, parent_id, domain, rules, public_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [realmId, name, description || "", parentId, domain, JSON.stringify(merged), publicKey, "api"]);
    
    const realm = await queryOne<Realm>("SELECT * FROM realms WHERE id = $1", [realmId]);
    await logRealmCreated("api", realmId, { name, domain, parent });
    res.status(201).json({ success: true, data: realm });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to create realm" } }); }
});

realmsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const realm = await queryOne<Realm>("SELECT * FROM realms WHERE id = $1 OR path = $1", [req.params.id]);
    if (!realm) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Realm not found" } });
    res.json({ success: true, data: realm });
  } catch (e) { res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to get realm" } }); }
});

realmsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { domain, parent, limit = "50", offset = "0" } = req.query;
    let sql = "SELECT * FROM realms WHERE 1=1";
    const params: unknown[] = [];
    let idx = 1;
    if (domain) { sql += ` AND domain = $${idx}`; params.push(domain); idx++; }
    if (parent === "null") sql += " AND parent_id IS NULL";
    else if (parent) { sql += ` AND parent_id = $${idx}`; params.push(parent); idx++; }
    sql += ` ORDER BY path ASC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit as string), parseInt(offset as string));
    const realms = await query<Realm>(sql, params);
    res.json({ success: true, data: realms });
  } catch (e) { res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to list realms" } }); }
});

realmsRouter.get("/:id/children", async (req: Request, res: Response) => {
  try {
    const parent = await queryOne<{ id: string; path: string }>("SELECT id, path FROM realms WHERE id = $1 OR path = $1", [req.params.id]);
    if (!parent) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Parent not found" } });
    const children = req.query.recursive === "true"
      ? await query<Realm>("SELECT * FROM realms WHERE path LIKE $1 AND id != $2 ORDER BY path", [`${parent.path}/%`, parent.id])
      : await query<Realm>("SELECT * FROM realms WHERE parent_id = $1 ORDER BY name", [parent.id]);
    res.json({ success: true, data: children });
  } catch (e) { res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to get children" } }); }
});

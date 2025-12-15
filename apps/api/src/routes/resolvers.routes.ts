/**
 * IRRL Resolvers Routes
 * Manage verification resolvers
 */

import { Router, Request, Response } from "express";
import { query, queryOne } from "../db/pool";
import { resolverRegistry } from "../resolvers";
import { ResolverMetadata } from "../core/types";

export const resolversRouter = Router();

// ============================================================================
// LIST RESOLVERS
// ============================================================================

resolversRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { domain, active = "true" } = req.query;

    // Get from registry (in-memory)
    let resolvers = resolverRegistry.list();

    // Filter by domain if specified
    if (domain) {
      resolvers = resolvers.filter(r => 
        r.domains.includes(domain as string) || r.domains.includes("*")
      );
    }

    // Also get from database (custom resolvers)
    let dbResolvers = await query<ResolverMetadata>(
      `SELECT id, version, name, description, author_id as author, 
              evidence_schema as "evidenceSchema", output_schema as "outputSchema",
              domains, deterministic, avg_verification_time_ms as "avgVerificationTime"
       FROM resolvers WHERE active = $1`,
      [active === "true"]
    );

    if (domain) {
      dbResolvers = dbResolvers.filter(r => 
        r.domains.includes(domain as string) || r.domains.includes("*")
      );
    }

    // Merge and deduplicate
    const allResolvers = [...resolvers];
    for (const dbResolver of dbResolvers) {
      if (!allResolvers.find(r => r.id === dbResolver.id)) {
        allResolvers.push(dbResolver);
      }
    }

    res.json({
      success: true,
      data: allResolvers,
    });
  } catch (error) {
    console.error("List resolvers error:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to list resolvers" },
    });
  }
});

// ============================================================================
// GET RESOLVER
// ============================================================================

resolversRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { version } = req.query;

    // Check in-memory registry first
    const registryResolver = version 
      ? resolverRegistry.get(`${id}@${version}`)
      : resolverRegistry.get(id);

    if (registryResolver) {
      return res.json({
        success: true,
        data: {
          ...registryResolver.metadata,
          source: "builtin",
        },
      });
    }

    // Check database
    let sql = "SELECT * FROM resolvers WHERE id = $1";
    const params: unknown[] = [id];

    if (version) {
      sql += " AND version = $2";
      params.push(version);
    } else {
      sql += " ORDER BY created_at DESC LIMIT 1";
    }

    const dbResolver = await queryOne<{
      id: string;
      version: string;
      name: string;
      description: string;
      author_id: string;
      evidence_schema: Record<string, unknown>;
      output_schema: Record<string, unknown>;
      domains: string[];
      deterministic: boolean;
      avg_verification_time_ms: number;
      active: boolean;
      created_at: Date;
    }>(sql, params);

    if (!dbResolver) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Resolver not found" },
      });
    }

    res.json({
      success: true,
      data: {
        id: dbResolver.id,
        version: dbResolver.version,
        name: dbResolver.name,
        description: dbResolver.description,
        author: dbResolver.author_id,
        evidenceSchema: dbResolver.evidence_schema,
        outputSchema: dbResolver.output_schema,
        domains: dbResolver.domains,
        deterministic: dbResolver.deterministic,
        avgVerificationTime: dbResolver.avg_verification_time_ms,
        active: dbResolver.active,
        createdAt: dbResolver.created_at,
        source: "database",
      },
    });
  } catch (error) {
    console.error("Get resolver error:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to get resolver" },
    });
  }
});

// ============================================================================
// REGISTER CUSTOM RESOLVER
// ============================================================================

resolversRouter.post("/", async (req: Request, res: Response) => {
  try {
    const {
      id,
      version,
      name,
      description,
      evidenceSchema,
      outputSchema,
      domains = [],
      deterministic = true,
    } = req.body;

    // Validate required fields
    if (!id || !version || !name || !evidenceSchema) {
      return res.status(400).json({
        success: false,
        error: { 
          code: "VALIDATION_ERROR", 
          message: "id, version, name, and evidenceSchema are required" 
        },
      });
    }

    // Check if already exists
    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM resolvers WHERE id = $1 AND version = $2",
      [id, version]
    );

    if (existing) {
      return res.status(409).json({
        success: false,
        error: { code: "ALREADY_EXISTS", message: "Resolver with this id and version already exists" },
      });
    }

    // Insert
    await query(
      `INSERT INTO resolvers 
       (id, version, name, description, author_id, evidence_schema, output_schema, domains, deterministic)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        version,
        name,
        description || "",
        "api", // In production, get from auth
        JSON.stringify(evidenceSchema),
        JSON.stringify(outputSchema || {}),
        domains,
        deterministic,
      ]
    );

    const resolver = await queryOne(
      "SELECT * FROM resolvers WHERE id = $1 AND version = $2",
      [id, version]
    );

    res.status(201).json({
      success: true,
      data: resolver,
    });
  } catch (error) {
    console.error("Register resolver error:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to register resolver" },
    });
  }
});

// ============================================================================
// DEPRECATE RESOLVER
// ============================================================================

resolversRouter.post("/:id/deprecate", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { version } = req.body;

    let sql = "UPDATE resolvers SET active = false, deprecated_at = NOW() WHERE id = $1";
    const params: unknown[] = [id];

    if (version) {
      sql += " AND version = $2";
      params.push(version);
    }

    await query(sql, params);

    res.json({
      success: true,
      message: version 
        ? `Resolver ${id}@${version} deprecated`
        : `All versions of resolver ${id} deprecated`,
    });
  } catch (error) {
    console.error("Deprecate resolver error:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to deprecate resolver" },
    });
  }
});

// ============================================================================
// TEST RESOLVER
// ============================================================================

resolversRouter.post("/:id/test", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { evidence } = req.body;

    if (!evidence) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "evidence is required" },
      });
    }

    // Get resolver from registry
    const resolver = resolverRegistry.get(id);

    if (!resolver) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Resolver not found in registry (only built-in resolvers can be tested)" },
      });
    }

    // Validate evidence
    const validation = resolver.validateEvidence(evidence);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: { 
          code: "INVALID_EVIDENCE", 
          message: "Evidence does not match schema",
          details: { errors: validation.errors },
        },
      });
    }

    // Run verification
    const startTime = Date.now();
    const result = await resolver.verify(evidence);
    const durationMs = Date.now() - startTime;

    res.json({
      success: true,
      data: {
        resolverId: id,
        resolverVersion: resolver.metadata.version,
        status: result.status,
        output: result.output,
        outputHash: result.outputHash,
        snapshot: result.snapshot,
        durationMs,
        error: result.error,
      },
    });
  } catch (error) {
    console.error("Test resolver error:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to test resolver" },
    });
  }
});

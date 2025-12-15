import Ajv from "ajv";
import { sha256 } from "../crypto";
import { Resolver, ResolverMetadata, VerificationResult } from "../core/types";

const ajv = new Ajv({ allErrors: true });

class ResolverRegistry {
  private resolvers: Map<string, Resolver> = new Map();
  register(r: Resolver): void {
    this.resolvers.set(`${r.metadata.id}@${r.metadata.version}`, r);
    this.resolvers.set(r.metadata.id, r);
  }
  get(id: string): Resolver | null { return this.resolvers.get(id) || null; }
  list(): ResolverMetadata[] {
    const seen = new Set<string>();
    return [...this.resolvers.values()].filter(r => { if (seen.has(r.metadata.id)) return false; seen.add(r.metadata.id); return true; }).map(r => r.metadata);
  }
}

export const resolverRegistry = new ResolverRegistry();

export abstract class BaseResolver implements Resolver {
  abstract metadata: ResolverMetadata;
  private _validator: ReturnType<typeof ajv.compile> | null = null;
  get validator() { if (!this._validator) this._validator = ajv.compile(this.metadata.evidenceSchema); return this._validator; }
  canResolve(_claim: string, evidence: Record<string, unknown>): boolean { return this.validateEvidence(evidence).valid; }
  validateEvidence(evidence: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const valid = this.validator(evidence);
    return valid ? { valid: true } : { valid: false, errors: this.validator.errors?.map(e => `${e.instancePath} ${e.message}`) };
  }
  abstract verify(evidence: Record<string, unknown>): Promise<VerificationResult>;
  protected createResult(status: "verified" | "failed" | "error", output: Record<string, unknown>, snapshot: Record<string, unknown>, error?: string): VerificationResult {
    return { status, output, snapshot, outputHash: sha256(JSON.stringify(output)), error, verifiedAt: new Date(), resolverVersion: this.metadata.version };
  }
}

export class HttpSnapshotResolver extends BaseResolver {
  metadata: ResolverMetadata = {
    id: "http-snapshot", version: "2.0.0", name: "HTTP Snapshot", description: "Verifies URL content",
    author: "irrl-core", evidenceSchema: { type: "object", required: ["url"], properties: { url: { type: "string" }, expectedHash: { type: "string" } } },
    outputSchema: { type: "object", properties: { contentHash: { type: "string" }, status: { type: "number" } } },
    domains: ["*"], deterministic: false, avgVerificationTime: 500,
  };
  async verify(evidence: Record<string, unknown>): Promise<VerificationResult> {
    try {
      const url = evidence.url as string;
      const res = await fetch(url);
      const content = await res.text();
      const hash = sha256(content);
      const expected = evidence.expectedHash as string | undefined;
      return this.createResult(expected && hash !== expected ? "failed" : "verified", { contentHash: hash, status: res.status }, { url, fetchedAt: new Date().toISOString() });
    } catch (e) { return this.createResult("error", {}, { url: evidence.url }, e instanceof Error ? e.message : "Error"); }
  }
}

export class GitHubActivityResolver extends BaseResolver {
  metadata: ResolverMetadata = {
    id: "github-activity", version: "2.0.0", name: "GitHub Activity", description: "Verifies GitHub contributions",
    author: "irrl-core", evidenceSchema: { type: "object", required: ["username"], properties: { username: { type: "string" }, minCommits: { type: "number" } } },
    outputSchema: { type: "object", properties: { eventCount: { type: "number" }, commitCount: { type: "number" } } },
    domains: ["technology", "software"], deterministic: false, avgVerificationTime: 1000,
  };
  async verify(evidence: Record<string, unknown>): Promise<VerificationResult> {
    try {
      const username = evidence.username as string;
      const minCommits = (evidence.minCommits as number) || 0;
      const res = await fetch(`https://api.github.com/users/${username}/events/public`, { headers: { Accept: "application/vnd.github.v3+json" } });
      if (!res.ok) return this.createResult("error", {}, { username }, `GitHub API error: ${res.status}`);
      const events = await res.json() as Array<{ type: string; created_at: string }>;
      const pushEvents = events.filter(e => e.type === "PushEvent").length;
      return this.createResult(pushEvents >= minCommits ? "verified" : "failed", { eventCount: events.length, commitCount: pushEvents }, { username, sampled: events.slice(0, 5) });
    } catch (e) { return this.createResult("error", {}, { username: evidence.username }, e instanceof Error ? e.message : "Error"); }
  }
}

export class TaskCompletionResolver extends BaseResolver {
  metadata: ResolverMetadata = {
    id: "task-completion", version: "1.0.0", name: "Task Completion", description: "Verifies task metrics",
    author: "irrl-core", evidenceSchema: { type: "object", required: ["taskIds", "successRate"], properties: { taskIds: { type: "array", items: { type: "string" } }, successRate: { type: "number" } } },
    outputSchema: { type: "object", properties: { verifiedTasks: { type: "number" }, meetsThreshold: { type: "boolean" } } },
    domains: ["ai", "agents"], deterministic: false, avgVerificationTime: 100,
  };
  async verify(evidence: Record<string, unknown>): Promise<VerificationResult> {
    const taskIds = evidence.taskIds as string[];
    const successRate = evidence.successRate as number;
    return this.createResult("verified", { verifiedTasks: taskIds.length, actualSuccessRate: successRate, meetsThreshold: true, note: "Self-reported" }, { taskIds, selfReported: true });
  }
}

export function registerBuiltInResolvers(): void {
  resolverRegistry.register(new HttpSnapshotResolver());
  resolverRegistry.register(new GitHubActivityResolver());
  resolverRegistry.register(new TaskCompletionResolver());
  console.log("Built-in resolvers registered");
}

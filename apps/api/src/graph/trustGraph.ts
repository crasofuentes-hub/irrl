import { EntityId, RealmId, TransitiveTrustQuery, TransitiveTrustResult, TrustPath, Evaluation } from "../core/types";

interface TrustEdge {
  from: EntityId; to: EntityId; domain: string; realmId: RealmId;
  score: number; weight: number; timestamp: Date;
}

export class TrustGraph {
  private edges: TrustEdge[] = [];
  private adjacency: Map<string, TrustEdge[]> = new Map();

  addEdge(eval_: Evaluation): void {
    const edge: TrustEdge = {
      from: eval_.fromEntity, to: eval_.toEntity, domain: eval_.domain,
      realmId: eval_.realmId, score: eval_.score / 100, weight: eval_.weight, timestamp: eval_.createdAt,
    };
    this.edges.push(edge);
    const key = `${edge.from}:${edge.domain}`;
    if (!this.adjacency.has(key)) this.adjacency.set(key, []);
    this.adjacency.get(key)!.push(edge);
  }

  loadFromEvaluations(evals: Evaluation[]): void {
    for (const e of evals) this.addEdge(e);
  }

  getDirectTrust(from: EntityId, to: EntityId, domain: string): number | null {
    const edges = this.adjacency.get(`${from}:${domain}`)?.filter(e => e.to === to);
    if (!edges?.length) return null;
    let sum = 0, weight = 0;
    for (const e of edges) { sum += e.score * e.weight; weight += e.weight; }
    return weight > 0 ? sum / weight : null;
  }

  computeTransitiveTrust(q: TransitiveTrustQuery): TransitiveTrustResult {
    const start = Date.now();
    const { from, to, domain, maxDepth = 5, decayFactor = 0.8, minConfidence = 0.1 } = q;
    
    const direct = this.getDirectTrust(from, to, domain);
    if (direct !== null) {
      const path: TrustPath = { path: [from, to], scores: [direct], finalTrust: direct, decayApplied: 0 };
      return { from, to, domain, score: direct, confidence: 1, paths: [path], bestPath: path,
        metadata: { maxDepth, decayFactor, pathsExplored: 1, computationTimeMs: Date.now() - start } };
    }

    const allPaths: TrustPath[] = [];
    const queue: Array<{ node: EntityId; path: EntityId[]; scores: number[]; trust: number; depth: number }> = [];
    
    for (const edge of this.adjacency.get(`${from}:${domain}`) || []) {
      queue.push({ node: edge.to, path: [from, edge.to], scores: [edge.score], trust: edge.score, depth: 1 });
    }

    const visited = new Set<string>();
    let explored = 0;

    while (queue.length > 0 && explored < 5000) {
      const cur = queue.shift()!;
      explored++;
      const vkey = `${cur.node}:${cur.depth}`;
      if (visited.has(vkey)) continue;
      visited.add(vkey);

      if (cur.node === to) {
        const final = cur.trust * Math.pow(decayFactor, cur.depth - 1);
        allPaths.push({ path: cur.path, scores: cur.scores, finalTrust: final, decayApplied: 1 - Math.pow(decayFactor, cur.depth - 1) });
        continue;
      }
      if (cur.depth >= maxDepth) continue;
      if (cur.trust * Math.pow(decayFactor, cur.depth) < minConfidence) continue;

      for (const edge of this.adjacency.get(`${cur.node}:${domain}`) || []) {
        if (cur.path.includes(edge.to)) continue;
        queue.push({
          node: edge.to, path: [...cur.path, edge.to], scores: [...cur.scores, edge.score],
          trust: cur.trust * edge.score * decayFactor, depth: cur.depth + 1,
        });
      }
    }

    if (allPaths.length === 0) {
      return { from, to, domain, score: 0, confidence: 0, paths: [], 
        bestPath: { path: [], scores: [], finalTrust: 0, decayApplied: 0 },
        metadata: { maxDepth, decayFactor, pathsExplored: explored, computationTimeMs: Date.now() - start } };
    }

    allPaths.sort((a, b) => b.finalTrust - a.finalTrust);
    let score = allPaths[0].finalTrust;
    for (let i = 1; i < Math.min(allPaths.length, 5); i++) score += allPaths[i].finalTrust * Math.pow(0.5, i);
    score = Math.min(score, 1);

    return { from, to, domain, score, confidence: Math.min(1, allPaths.length / 3),
      paths: allPaths.slice(0, 10), bestPath: allPaths[0],
      metadata: { maxDepth, decayFactor, pathsExplored: explored, computationTimeMs: Date.now() - start } };
  }
}

export function computeReputationWithDecay(
  input: { evaluations: Evaluation[]; attestationCount: number; verifiedAttestationCount: number; 
           oldestEvaluationDate: Date; newestEvaluationDate: Date },
  config: { halfLifeDays: number; minScore: number; maxScore: number }
) {
  const now = new Date();
  let sum = 0, weight = 0;
  for (const e of input.evaluations) {
    const ageDays = (now.getTime() - e.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const w = e.weight * Math.pow(0.5, ageDays / config.halfLifeDays);
    sum += e.score * w; weight += w;
  }
  const raw = weight > 0 ? sum / weight : 50;
  const bonus = input.verifiedAttestationCount > 0 ? 
    (input.verifiedAttestationCount / input.attestationCount) * 10 * Math.min(input.verifiedAttestationCount / 5, 1) : 0;
  const staleDays = (now.getTime() - input.newestEvaluationDate.getTime()) / (1000 * 60 * 60 * 24);
  const penalty = Math.max(0, (staleDays - config.halfLifeDays) * 0.1);
  const score = Math.max(config.minScore, Math.min(config.maxScore, raw + bonus - penalty));
  const confidence = Math.min(1, input.evaluations.length / 10) * Math.pow(0.5, staleDays / config.halfLifeDays);
  return { score: Math.round(score * 10) / 10, confidence: Math.round(confidence * 100) / 100,
    breakdown: { rawScore: Math.round(raw * 10) / 10, attestationBonus: Math.round(bonus * 10) / 10, decayPenalty: Math.round(penalty * 10) / 10 } };
}

export function computeSybilResistance(evals: Evaluation[], attestations: Array<{ verificationCount: number }>, _graph: TrustGraph) {
  const unique = new Set(evals.map(e => e.fromEntity)).size;
  const avgVerif = attestations.length > 0 ? attestations.reduce((s, a) => s + a.verificationCount, 0) / attestations.length : 0;
  const timestamps = evals.map(e => e.createdAt.getTime());
  const spread = timestamps.length > 1 ? (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24) : 0;
  const realms = new Set(evals.map(e => e.realmId)).size;
  const warnings: string[] = [];
  if (unique < 3) warnings.push("Low evaluator diversity");
  if (avgVerif < 2) warnings.push("Low verification depth");
  if (spread < 7) warnings.push("Suspicious temporal clustering");
  return {
    score: Math.round((Math.min(1, unique/10)*0.35 + Math.min(1, avgVerif/3)*0.25 + Math.min(1, spread/90)*0.2 + Math.min(1, (realms-1)/3)*0.2) * 100) / 100,
    factors: { evaluatorDiversity: Math.min(1, unique/10), verificationDepth: Math.min(1, avgVerif/3), temporalSpread: Math.min(1, spread/90), crossRealmConsistency: Math.min(1, (realms-1)/3) },
    warnings
  };
}

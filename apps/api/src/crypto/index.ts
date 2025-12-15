import crypto from "crypto";

export function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function contentId(obj: Record<string, unknown>): string {
  const canonical = JSON.stringify(obj, Object.keys(obj).sort());
  return `cid_${sha256(canonical)}`;
}

export interface KeyPair { publicKey: string; privateKey: string; }

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey: publicKey.toString(), privateKey: privateKey.toString() };
}

export function sign(data: string | Buffer, privateKey: string): string {
  return crypto.sign(null, Buffer.from(data), privateKey).toString("base64");
}

export function verify(data: string | Buffer, signature: string, publicKey: string): boolean {
  try {
    return crypto.verify(null, Buffer.from(data), publicKey, Buffer.from(signature, "base64"));
  } catch { return false; }
}

export function signObject(obj: Record<string, unknown>, privateKey: string): string {
  return sign(JSON.stringify(obj, Object.keys(obj).sort()), privateKey);
}

export function verifyObject(obj: Record<string, unknown>, signature: string, publicKey: string): boolean {
  return verify(JSON.stringify(obj, Object.keys(obj).sort()), signature, publicKey);
}

export function getMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return sha256("empty");
  let hashes = leaves.map(l => sha256(l));
  while (hashes.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = hashes[i + 1] || left;
      next.push(sha256(left + right));
    }
    hashes = next;
  }
  return hashes[0];
}

export interface MerkleProof {
  root: string;
  leaf: string;
  leafIndex: number;
  siblings: Array<{ hash: string; position: "left" | "right" }>;
}

export function generateMerkleProof(leaves: string[], idx: number): MerkleProof | null {
  if (idx < 0 || idx >= leaves.length) return null;
  const siblings: MerkleProof["siblings"] = [];
  let hashes = leaves.map(l => sha256(l));
  let index = idx;
  while (hashes.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i], right = hashes[i + 1] || left;
      if (i === index || i + 1 === index) {
        siblings.push(i === index ? { hash: right, position: "right" } : { hash: left, position: "left" });
      }
      next.push(sha256(left + right));
    }
    hashes = next;
    index = Math.floor(index / 2);
  }
  return { root: hashes[0], leaf: sha256(leaves[idx]), leafIndex: idx, siblings };
}

export function verifyMerkleProof(proof: MerkleProof): boolean {
  let hash = proof.leaf;
  for (const s of proof.siblings) {
    hash = s.position === "left" ? sha256(s.hash + hash) : sha256(hash + s.hash);
  }
  return hash === proof.root;
}

export function generateSignedProof(data: Record<string, unknown>, privateKey: string, publicKey: string, version = "IRRL-Proof-v1") {
  const timestamp = new Date().toISOString();
  const proofData = { ...data, timestamp, version };
  return { data: proofData, signature: signObject(proofData, privateKey), publicKey, timestamp, version };
}

export function verifySignedProof(proof: { data: Record<string, unknown>; signature: string; publicKey: string }): boolean {
  return verifyObject(proof.data, proof.signature, proof.publicKey);
}

export function randomId(prefix = "id"): string {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

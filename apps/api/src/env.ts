import { config } from "dotenv";
config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing: ${key}`);
  return value;
}

function optionalEnv(key: string, def: string): string {
  return process.env[key] || def;
}

function optionalEnvInt(key: string, def: number): number {
  return process.env[key] ? parseInt(process.env[key]!, 10) : def;
}

function optionalEnvBool(key: string, def: boolean): boolean {
  const v = process.env[key];
  return v ? v.toLowerCase() === "true" : def;
}

export const env = {
  NODE_ENV: optionalEnv("NODE_ENV", "development"),
  PORT: optionalEnvInt("PORT", 3000),
  HOST: optionalEnv("HOST", "0.0.0.0"),
  DATABASE_URL: requireEnv("DATABASE_URL"),
  DB_POOL_SIZE: optionalEnvInt("DB_POOL_SIZE", 10),
  JWT_SECRET: optionalEnv("JWT_SECRET", "change-me"),
  CORS_ORIGINS: optionalEnv("CORS_ORIGINS", "*"),
  ENABLE_AUDIT_LOG: optionalEnvBool("ENABLE_AUDIT_LOG", true),
  LOG_QUERIES: optionalEnvBool("LOG_QUERIES", false),
  GITHUB_TOKEN: optionalEnv("GITHUB_TOKEN", ""),
};

export function validateEnv(): void {
  if (env.NODE_ENV === "production" && env.JWT_SECRET === "change-me") {
    throw new Error("JWT_SECRET must be set in production");
  }
}

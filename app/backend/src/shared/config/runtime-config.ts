import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  DATABASE_SERVICE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(1),
  CRM_URL: z.string().url(),
  PROVIDER_URL: z.string().url(),
  CRM_TIMEOUT_MS: z.coerce.number().int().positive().default(1500),
  CRM_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  CRM_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  CRM_LEASE_MS: z.coerce.number().int().min(1000).default(15000),
  CRM_POLL_MS: z.coerce.number().int().min(100).default(1000),
  CRM_RETRY_BASE_MS: z.coerce.number().int().min(100).default(1000),
  CRM_RETRY_MAX_MS: z.coerce.number().int().min(1000).default(60000)
});

export type runtimeConfig = {
  port: number;
  databaseUrl: string;
  databaseServiceUrl: string;
  jwtSecret: string;
  webhookSecret: string;
  crmUrl: string;
  providerUrl: string;
  crmTimeoutMs: number;
  crmMaxAttempts: number;
  crmBatchSize: number;
  crmLeaseMs: number;
  crmPollMs: number;
  crmRetryBaseMs: number;
  crmRetryMaxMs: number;
};

export function loadRuntimeConfig(env: NodeJS.ProcessEnv): runtimeConfig {
  const parsed = envSchema.parse(env);
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    databaseServiceUrl: parsed.DATABASE_SERVICE_URL,
    jwtSecret: parsed.JWT_SECRET,
    webhookSecret: parsed.WEBHOOK_SECRET,
    crmUrl: parsed.CRM_URL,
    providerUrl: parsed.PROVIDER_URL,
    crmTimeoutMs: parsed.CRM_TIMEOUT_MS,
    crmMaxAttempts: parsed.CRM_MAX_ATTEMPTS,
    crmBatchSize: parsed.CRM_BATCH_SIZE,
    crmLeaseMs: parsed.CRM_LEASE_MS,
    crmPollMs: parsed.CRM_POLL_MS,
    crmRetryBaseMs: parsed.CRM_RETRY_BASE_MS,
    crmRetryMaxMs: parsed.CRM_RETRY_MAX_MS
  };
}

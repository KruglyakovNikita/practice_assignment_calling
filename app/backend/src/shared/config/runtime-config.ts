import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  DATABASE_SERVICE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(1),
  CRM_URL: z.string().url(),
  PROVIDER_URL: z.string().url(),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  CRM_TIMEOUT_MS: z.coerce.number().int().positive().default(1500),
  CRM_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  CRM_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  CRM_LEASE_MS: z.coerce.number().int().min(1000).default(15000),
  CRM_POLL_MS: z.coerce.number().int().min(100).default(1000),
  CRM_RETRY_BASE_MS: z.coerce.number().int().min(100).default(1000),
  CRM_RETRY_MAX_MS: z.coerce.number().int().min(1000).default(60000),
  ANALYSIS_POLL_MS: z.coerce.number().int().min(50).default(200),
  ANALYSIS_LEASE_MS: z.coerce.number().int().min(3000).default(30000),
  ANALYSIS_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),
  ANALYSIS_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  ANALYSIS_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  ANALYSIS_RECOVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  ANALYSIS_SSE_POLL_MS: z.coerce.number().int().min(50).default(150)
});

export type runtimeConfig = {
  port: number;
  databaseUrl: string;
  databaseServiceUrl: string;
  jwtSecret: string;
  webhookSecret: string;
  crmUrl: string;
  providerUrl: string;
  corsOrigin: string;
  crmTimeoutMs: number;
  crmMaxAttempts: number;
  crmBatchSize: number;
  crmLeaseMs: number;
  crmPollMs: number;
  crmRetryBaseMs: number;
  crmRetryMaxMs: number;
  analysisPollMs: number;
  analysisLeaseMs: number;
  analysisConcurrency: number;
  analysisProviderTimeoutMs: number;
  analysisProviderMaxRetries: number;
  analysisRecoveryBatchSize: number;
  analysisSsePollMs: number;
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
    corsOrigin: parsed.CORS_ORIGIN,
    crmTimeoutMs: parsed.CRM_TIMEOUT_MS,
    crmMaxAttempts: parsed.CRM_MAX_ATTEMPTS,
    crmBatchSize: parsed.CRM_BATCH_SIZE,
    crmLeaseMs: parsed.CRM_LEASE_MS,
    crmPollMs: parsed.CRM_POLL_MS,
    crmRetryBaseMs: parsed.CRM_RETRY_BASE_MS,
    crmRetryMaxMs: parsed.CRM_RETRY_MAX_MS,
    analysisPollMs: parsed.ANALYSIS_POLL_MS,
    analysisLeaseMs: parsed.ANALYSIS_LEASE_MS,
    analysisConcurrency: parsed.ANALYSIS_CONCURRENCY,
    analysisProviderTimeoutMs: parsed.ANALYSIS_PROVIDER_TIMEOUT_MS,
    analysisProviderMaxRetries: parsed.ANALYSIS_PROVIDER_MAX_RETRIES,
    analysisRecoveryBatchSize: parsed.ANALYSIS_RECOVERY_BATCH_SIZE,
    analysisSsePollMs: parsed.ANALYSIS_SSE_POLL_MS
  };
}

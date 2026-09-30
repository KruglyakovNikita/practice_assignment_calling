import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import type { runtimeConfig } from '../config/runtime-config';
import { RUNTIME_CONFIG } from '../config/config.module';
import { ADMIN_DB_POOL, APP_DB_POOL } from './tokens';

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(APP_DB_POOL) private readonly appPool: Pool,
    @Inject(ADMIN_DB_POOL) private readonly adminPool: Pool
  ) {}

  // After the HTTP server has drained in-flight requests and workers have stopped (onModuleDestroy).
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.appPool.end(), this.adminPool.end()]);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: APP_DB_POOL,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: runtimeConfig) =>
        // Keep backends alive: a fresh one pays ~70 ms loading tz data on its first claim.
        new Pool({ connectionString: config.databaseUrl, max: 20, idleTimeoutMillis: 0 })
    },
    {
      provide: ADMIN_DB_POOL,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: runtimeConfig) => new Pool({ connectionString: config.databaseServiceUrl, max: 20 })
    },
    DatabaseLifecycle
  ],
  exports: [APP_DB_POOL, ADMIN_DB_POOL]
})
export class DatabaseModule {}

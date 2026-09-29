import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import type { runtimeConfig } from '../config/runtime-config';
import { RUNTIME_CONFIG } from '../config/config.module';
import { ADMIN_DB_POOL, APP_DB_POOL } from './tokens';

@Injectable()
class DatabaseLifecycle implements OnModuleDestroy {
  constructor(
    @Inject(APP_DB_POOL) private readonly appPool: Pool,
    @Inject(ADMIN_DB_POOL) private readonly adminPool: Pool
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.appPool.end(), this.adminPool.end()]);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: APP_DB_POOL,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: runtimeConfig) => new Pool({ connectionString: config.databaseUrl, max: 20 })
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

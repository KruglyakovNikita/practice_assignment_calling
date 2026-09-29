import { Global, Module } from '@nestjs/common';
import { loadRuntimeConfig } from './runtime-config';

export const RUNTIME_CONFIG = Symbol('RUNTIME_CONFIG');

@Global()
@Module({
  providers: [{ provide: RUNTIME_CONFIG, useFactory: () => loadRuntimeConfig(process.env) }],
  exports: [RUNTIME_CONFIG]
})
export class ConfigModule {}

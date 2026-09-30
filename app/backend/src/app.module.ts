import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AnalysesModule } from './analyses/analyses.module';
import { CallsModule } from './calls/calls.module';
import { CrmModule } from './crm/crm.module';
import { DevTokenController } from './dev/dev-token.controller';
import { HealthController } from './health/health.controller';
import { ConfigModule } from './shared/config/config.module';
import { DatabaseModule } from './shared/database/database.module';
import { correlationIdMiddleware } from './shared/http/correlation-id.middleware';
import { requestLogMiddleware } from './shared/http/request-log.middleware';

@Module({
  imports: [ConfigModule, DatabaseModule, CallsModule, CrmModule, AnalysesModule],
  controllers: [HealthController, DevTokenController]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationIdMiddleware, requestLogMiddleware).forRoutes('*');
  }
}

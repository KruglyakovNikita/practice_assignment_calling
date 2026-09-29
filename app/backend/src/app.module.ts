import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CallsModule } from './calls/calls.module';
import { CrmModule } from './crm/crm.module';
import { HealthController } from './health/health.controller';
import { ConfigModule } from './shared/config/config.module';
import { DatabaseModule } from './shared/database/database.module';
import { correlationIdMiddleware } from './shared/http/correlation-id.middleware';
import { requestLogMiddleware } from './shared/http/request-log.middleware';

@Module({
  imports: [ConfigModule, DatabaseModule, CallsModule, CrmModule],
  controllers: [HealthController]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationIdMiddleware, requestLogMiddleware).forRoutes('*');
  }
}

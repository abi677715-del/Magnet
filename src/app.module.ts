import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CommonModule } from './common/common.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { LeadsModule } from './leads/leads.module';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  imports: [// Rate limits are skipped only when jest sets NODE_ENV=test; a test below proves they bite otherwise.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }], skipIf: () => process.env.NODE_ENV === 'test' }), CommonModule, DiscoveryModule, LeadsModule],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

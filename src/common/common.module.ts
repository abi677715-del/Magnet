import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit.service';
import { AuthService } from './auth.service';
import { AuthGuard, AdminGuard } from './auth.guard';

@Global()
@Module({
  providers: [PrismaService, AuditService, AuthService, AuthGuard, AdminGuard],
  exports: [PrismaService, AuditService, AuthService, AuthGuard, AdminGuard],
})
export class CommonModule {}

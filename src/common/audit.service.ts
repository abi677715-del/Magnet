import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/** Every decision a person makes about a lead is written down: who, what, when. */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  log(actor: string, action: string, leadId?: string, meta?: Prisma.InputJsonValue) {
    return this.prisma.auditLog.create({ data: { actor, action, leadId, meta } });
  }
}

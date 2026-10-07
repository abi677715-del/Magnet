import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * One shared key for the team (ADMIN_API_KEY). Fails closed: if the key is
 * missing or too short, nothing is allowed in, rather than everything.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_API_KEY ?? '';
    if (expected.length < 16) {
      throw new UnauthorizedException('Server is not configured: set ADMIN_API_KEY (16+ characters).');
    }
    const req = context.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!given || !timingSafeEqual(digest(given), digest(expected))) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    // Who is acting, for the audit log. Informational only — the key is the real credential.
    const actor = String(req.headers['x-actor'] ?? 'manager').replace(/[^\w .@-]/g, '').slice(0, 60) || 'manager';
    req.actor = actor;
    return true;
  }
}

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';

export const bearer = (req: any): string => {
  const header: string = req.headers['authorization'] ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
};

/** Lets in the shared ADMIN_API_KEY or a signed-in, approved team member. Sets req.actor / req.role / req.principal. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const principal = await this.auth.authenticate(bearer(req), req.headers['x-actor']);
    if (!principal) throw new UnauthorizedException('Please sign in.');
    req.principal = principal;
    req.actor = principal.actor;
    req.role = principal.role;
    return true;
  }
}

/** Use after AuthGuard: only admins. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest().role !== UserRole.ADMIN) throw new ForbiddenException('Admins only.');
    return true;
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit.service';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';

const SESSION_DAYS = 7;
const digest = (s: string) => createHash('sha256').update(s).digest();
const tokenHash = (token: string) => digest(token).toString('hex');

/** Who is making a request. `key` is the shared ADMIN_API_KEY (always an admin); `user` is a signed-in team member. */
export interface Principal {
  kind: 'key' | 'user';
  actor: string;
  role: UserRole;
  user?: User;
}

export const publicUser = (u: User) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
  createdAt: u.createdAt, decidedBy: u.decidedBy, decidedAt: u.decidedAt, lastLoginAt: u.lastLoginAt,
});

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async register(input: { name: string; email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('An account with this email already exists. Sign in, or ask an admin if it is still waiting for approval.');
    }
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.prisma.user.create({ data: { email, name: input.name.trim(), passwordHash } });
      await this.audit.log(user.name, 'USER_REGISTERED', undefined, { userId: user.id, email });
      return { status: user.status, message: 'Registration received. An admin has to approve it before you can sign in.' };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('An account with this email already exists.');
      throw err;
    }
  }

  async login(emailInput: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: emailInput.trim().toLowerCase() } });
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedException('Wrong email or password.');
    // The account state is only revealed to someone who proved they know the password.
    if (user.status === UserStatus.PENDING) throw new ForbiddenException('Your registration is waiting for an admin to approve it.');
    if (user.status === UserStatus.REJECTED) throw new ForbiddenException('Your registration was declined. Ask an admin if you think this is a mistake.');
    if (user.status === UserStatus.DISABLED) throw new ForbiddenException('This account has been switched off. Ask an admin.');

    const token = randomBytes(32).toString('hex');
    await this.prisma.session.create({ data: { tokenHash: tokenHash(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000) } });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }); // tidy up old sessions as we go
    await this.audit.log(user.name, 'USER_LOGIN', undefined, { userId: user.id });
    return { token, user: publicUser(user) };
  }

  async logout(token: string) {
    await this.prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  }

  /** Resolves a bearer token to who is acting, or null. Fails closed: a missing/short ADMIN_API_KEY never matches. */
  async authenticate(token: string, actorHint?: string): Promise<Principal | null> {
    if (!token) return null;
    const key = process.env.ADMIN_API_KEY ?? '';
    if (key.length >= 16) {
      const a = digest(token), b = digest(key);
      if (timingSafeEqual(a, b)) {
        const actor = String(actorHint ?? 'admin').replace(/[^\w .@-]/g, '').slice(0, 60) || 'admin';
        return { kind: 'key', actor, role: UserRole.ADMIN };
      }
    }
    const session = await this.prisma.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
    if (!session || session.expiresAt < new Date() || session.user.status !== UserStatus.APPROVED) return null;
    return { kind: 'user', actor: session.user.name, role: session.user.role, user: session.user };
  }

  // ---- admin ----

  async listUsers(status?: UserStatus) {
    const users = await this.prisma.user.findMany({ where: status ? { status } : {}, orderBy: [{ createdAt: 'desc' }] });
    return users.map(publicUser);
  }

  private async mustFind(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private guardSelf(by: Principal, target: User, what: string) {
    if (by.user && by.user.id === target.id) throw new BadRequestException(`You cannot ${what} your own account.`);
  }

  async setStatus(by: Principal, id: string, status: UserStatus) {
    const user = await this.mustFind(id);
    if (status !== UserStatus.APPROVED) this.guardSelf(by, user, 'switch off');
    await this.prisma.user.update({ where: { id }, data: { status, decidedBy: by.actor, decidedAt: new Date() } });
    if (status !== UserStatus.APPROVED) await this.prisma.session.deleteMany({ where: { userId: id } }); // sign them out everywhere now
    await this.audit.log(by.actor, `USER_${status}`, undefined, { userId: id, email: user.email });
    return publicUser(await this.mustFind(id));
  }

  async setRole(by: Principal, id: string, role: UserRole) {
    const user = await this.mustFind(id);
    if (role !== UserRole.ADMIN) this.guardSelf(by, user, 'remove admin rights from');
    if (role === UserRole.ADMIN && user.status !== UserStatus.APPROVED) throw new BadRequestException('Approve this person before making them an admin.');
    await this.prisma.user.update({ where: { id }, data: { role } });
    await this.audit.log(by.actor, `USER_ROLE_${role}`, undefined, { userId: id, email: user.email });
    return publicUser(await this.mustFind(id));
  }

  /** For a forgotten password: the admin sets a new one and the person is signed out everywhere. */
  async resetPassword(by: Principal, id: string, password: string) {
    const user = await this.mustFind(id);
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
    await this.prisma.session.deleteMany({ where: { userId: id } });
    await this.audit.log(by.actor, 'USER_PASSWORD_RESET', undefined, { userId: id, email: user.email });
    return { ok: true };
  }
}

import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole, UserStatus } from '@prisma/client';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { AdminGuard, AuthGuard, bearer } from '../common/auth.guard';
import { AuthService, Principal } from '../common/auth.service';

class RegisterDto {
  @IsString() @Length(2, 60) name: string;
  @IsEmail() @MaxLength(120) email: string;
  @IsString() @Length(8, 100, { message: 'password must be at least 8 characters' }) password: string;
}
class LoginDto {
  @IsEmail() @MaxLength(120) email: string;
  @IsString() @MaxLength(100) password: string;
}
class ResetDto {
  @IsString() @Length(8, 100, { message: 'password must be at least 8 characters' }) password: string;
}

@Controller()
export class AuthController {
  constructor(private auth: AuthService) {}

  // Public, and rate-limited hard: these are what someone guessing passwords or flooding sign-ups would hit.
  @Post('auth/register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('auth/login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('auth/logout')
  @UseGuards(AuthGuard)
  async logout(@Req() req: any) {
    await this.auth.logout(bearer(req));
    return { ok: true };
  }

  @Get('auth/me')
  @UseGuards(AuthGuard)
  me(@Req() req: any) {
    const p: Principal = req.principal;
    return p.user
      ? { name: p.user.name, email: p.user.email, role: p.role, viaKey: false }
      : { name: 'Admin key', email: null, role: p.role, viaKey: true };
  }

  // ---- admin: confirm registrations and manage the team ----

  @Get('admin/users')
  @UseGuards(AuthGuard, AdminGuard)
  users(@Query('status') status?: string) {
    const valid = status && (Object.values(UserStatus) as string[]).includes(status) ? (status as UserStatus) : undefined;
    return this.auth.listUsers(valid);
  }

  @Post('admin/users/:id/approve')
  @UseGuards(AuthGuard, AdminGuard)
  approve(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.setStatus(req.principal, id, UserStatus.APPROVED);
  }

  @Post('admin/users/:id/reject')
  @UseGuards(AuthGuard, AdminGuard)
  reject(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.setStatus(req.principal, id, UserStatus.REJECTED);
  }

  @Post('admin/users/:id/disable')
  @UseGuards(AuthGuard, AdminGuard)
  disable(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.setStatus(req.principal, id, UserStatus.DISABLED);
  }

  @Post('admin/users/:id/make-admin')
  @UseGuards(AuthGuard, AdminGuard)
  makeAdmin(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.setRole(req.principal, id, UserRole.ADMIN);
  }

  @Post('admin/users/:id/remove-admin')
  @UseGuards(AuthGuard, AdminGuard)
  removeAdmin(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.setRole(req.principal, id, UserRole.USER);
  }

  @Post('admin/users/:id/reset-password')
  @UseGuards(AuthGuard, AdminGuard)
  reset(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetDto) {
    return this.auth.resetPassword(req.principal, id, dto.password);
  }
}

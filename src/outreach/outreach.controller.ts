import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import { ApiKeyGuard } from '../common/api-key.guard';
import { OutreachService } from './outreach.service';
import { verifyUnsubscribeToken } from './compliance';

class EditDto {
  @IsString() @Length(3, 150) subject: string;
  @IsString() @Length(40, 3500) body: string;
}

@Controller()
@UseGuards(ApiKeyGuard)
export class OutreachController {
  constructor(private outreach: OutreachService) {}

  @Post('leads/:id/outreach/draft')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  draft(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.outreach.createDraft(req.actor, id);
  }

  @Get('outreach/:id')
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.outreach.view(id);
  }

  @Patch('outreach/:id')
  edit(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditDto) {
    return this.outreach.edit(req.actor, id, dto.subject, dto.body);
  }

  @Post('outreach/:id/approve')
  approve(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.outreach.approve(req.actor, id);
  }

  @Post('outreach/:id/send')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  send(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.outreach.send(req.actor, id);
  }
}

const page = (title: string, message: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1>${title}</h1><p>${message}</p></body></html>`;

/** Public on purpose: a recipient must be able to opt out without a login. */
@Controller('unsubscribe')
export class UnsubscribeController {
  constructor(private outreach: OutreachService) {}

  @Get(':token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async viaLink(@Param('token') token: string) {
    const email = verifyUnsubscribeToken(token);
    if (!email) return page('Link not valid', 'This unsubscribe link is invalid or incomplete. Reply to the email and ask us to remove you, and we will.');
    await this.outreach.unsubscribe(email);
    return page('You are unsubscribed', 'We will not contact you again. Sorry to have bothered you.');
  }

  // Mail apps with a one-tap unsubscribe button POST here (RFC 8058).
  @Post(':token')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async oneClick(@Param('token') token: string) {
    const email = verifyUnsubscribeToken(token);
    if (!email) return { ok: false };
    await this.outreach.unsubscribe(email);
    return { ok: true };
  }
}

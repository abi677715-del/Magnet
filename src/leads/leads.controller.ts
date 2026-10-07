import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LeadStatus, Platform } from '@prisma/client';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { ApiKeyGuard } from '../common/api-key.guard';
import { ClassificationService } from '../classification/classification.service';
import { LeadsService } from './leads.service';

class NoteDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
class EnrichDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsEmail() contactEmail?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^[A-Za-z]{2}$/, { message: 'country must be a 2-letter code' }) country?: string | null;
  @IsOptional() @IsString() @MaxLength(3000) bio?: string;
  @IsOptional() @IsString() @Length(1, 120) displayName?: string;
}

@Controller()
@UseGuards(ApiKeyGuard)
export class LeadsController {
  constructor(
    private leads: LeadsService,
    private classification: ClassificationService,
  ) {}

  private parseQuery(query: Record<string, string | undefined>) {
    const int = (v?: string) => (v !== undefined && /^\d{1,9}$/.test(v) ? Number(v) : undefined);
    const bool = (v?: string) => (v === 'true' ? true : undefined);
    const { status, platform } = query;
    return {
      status: status && (Object.values(LeadStatus) as string[]).includes(status) ? (status as LeadStatus) : undefined,
      platform: platform && (Object.values(Platform) as string[]).includes(platform) ? (platform as Platform) : undefined,
      minScore: int(query.minScore),
      priority: bool(query.priority),
      needsAttention: bool(query.needsAttention),
      q: query.q?.slice(0, 100),
      limit: int(query.limit),
      offset: int(query.offset),
    };
  }

  @Get('leads')
  list(@Query() query: Record<string, string | undefined>) {
    return this.leads.list(this.parseQuery(query));
  }

  /** Same filters as the list; downloads a spreadsheet. */
  @Get('leads/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="partner-leads.csv"')
  export(@Query() query: Record<string, string | undefined>) {
    return this.leads.exportCsv(this.parseQuery(query));
  }

  @Get('leads/stats')
  stats() {
    return this.leads.stats();
  }

  @Get('leads/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.get(id);
  }

  @Patch('leads/:id')
  enrich(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnrichDto) {
    return this.leads.enrich(req.actor, id, dto);
  }

  @Post('leads/:id/approve')
  approve(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.leads.approve(req.actor, id, dto.note);
  }

  @Post('leads/:id/reject')
  reject(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.leads.reject(req.actor, id, dto.note);
  }

  // Scoring spends money on every call, so it's rate-limited harder than the rest.
  @Post('leads/:id/rescore')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async rescore(@Param('id', ParseUUIDPipe) id: string) {
    await this.classification.scoreLead(id);
    return this.leads.get(id);
  }

  @Post('classification/run')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  run(@Body() body: { limit?: number }) {
    return this.classification.scorePending(Number(body?.limit) || 25);
  }
}

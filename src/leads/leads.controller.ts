import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PartnerStage, Platform } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { ApiKeyGuard } from '../common/api-key.guard';
import { LeadsService } from './leads.service';

class EnrichDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsEmail() contactEmail?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^[A-Za-z]{2}$/, { message: 'country must be a 2-letter code' }) country?: string | null;
  @IsOptional() @IsString() @MaxLength(3000) bio?: string;
  @IsOptional() @IsString() @Length(1, 120) displayName?: string;
}

class StageDto {
  @IsEnum(PartnerStage) stage: PartnerStage;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@Controller()
@UseGuards(ApiKeyGuard)
export class LeadsController {
  constructor(private leads: LeadsService) {}

  private parseQuery(query: Record<string, string | undefined>) {
    const int = (v?: string) => (v !== undefined && /^\d{1,9}$/.test(v) ? Number(v) : undefined);
    const { platform, since, stage } = query;
    const sinceDate = since ? new Date(since) : undefined;
    return {
      platform: platform && (Object.values(Platform) as string[]).includes(platform) ? (platform as Platform) : undefined,
      stage: stage && (Object.values(PartnerStage) as string[]).includes(stage) ? (stage as PartnerStage) : undefined,
      since: sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : undefined,
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

  @Post('leads/:id/stage')
  setStage(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StageDto) {
    return this.leads.setStage(req.actor, id, dto.stage, dto.note);
  }

  @Delete('leads/:id')
  remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.remove(req.actor, id);
  }
}

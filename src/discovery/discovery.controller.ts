import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Allow, ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { ApiKeyGuard } from '../common/api-key.guard';
import { AuditService } from '../common/audit.service';
import { DiscoveryService } from './discovery.service';
import { AiDiscoveryService } from './ai-discovery.service';
import { SEGMENTS, SegmentKey } from './ai-discovery';

class YoutubeSearchDto {
  @IsString() @Length(2, 120) query: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @IsString() @Length(2, 2) regionCode?: string;
  @IsOptional() @IsString() @Length(2, 5) language?: string;
}
class AiSearchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(11) @IsIn(Object.keys(SEGMENTS), { each: true }) segments: SegmentKey[];
  @IsOptional() @IsString() @Length(2, 2) country?: string;
  @IsOptional() @IsString() @MaxLength(40) language?: string;
  @IsOptional() @IsString() @MaxLength(200) focus?: string;
  @IsOptional() @IsInt() @Min(3) @Max(25) limit?: number;
}
class UrlsDto {
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(500, { each: true }) urls: string[];
}
class ImportDto {
  @IsIn(['csv', 'json']) format: 'csv' | 'json';
  @Allow() data: unknown; // whitelist validation would otherwise strip it; the shape is checked in the handler
}

@Controller('discovery')
@UseGuards(ApiKeyGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class DiscoveryController {
  constructor(
    private discovery: DiscoveryService,
    private aiDiscovery: AiDiscoveryService,
    private audit: AuditService,
  ) {}

  /** Claude searches the public web for partners. Starts a background job; poll GET /discovery/ai/:id. */
  @Post('ai')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  startAi(@Req() req: any, @Body() dto: AiSearchDto) {
    return this.aiDiscovery.start(req.actor, {
      segments: [...new Set(dto.segments)],
      country: dto.country?.toUpperCase(),
      language: dto.language,
      focus: dto.focus,
      limit: dto.limit ?? 15,
    });
  }

  @Get('ai/segments')
  segments() {
    return SEGMENTS;
  }

  @Get('ai/:id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  aiStatus(@Param('id') id: string) {
    return this.aiDiscovery.get(id);
  }

  @Post('youtube')
  async youtube(@Req() req: any, @Body() dto: YoutubeSearchDto) {
    const result = await this.discovery.searchYoutube(dto.query, dto.limit ?? 15, { regionCode: dto.regionCode, language: dto.language });
    await this.audit.log(req.actor, 'DISCOVERY_YOUTUBE', undefined, { query: dto.query, found: result.found });
    return result;
  }

  @Post('urls')
  async urls(@Req() req: any, @Body() dto: UrlsDto) {
    const results = await this.discovery.addUrls(dto.urls);
    await this.audit.log(req.actor, 'DISCOVERY_URLS', undefined, { count: dto.urls.length });
    return { results };
  }

  @Post('import')
  async import(@Req() req: any, @Body() dto: ImportDto) {
    if (dto.format === 'csv' && (typeof dto.data !== 'string' || dto.data.length > 2_000_000)) {
      throw new BadRequestException('CSV data must be text under 2 MB');
    }
    if (dto.format === 'json' && !Array.isArray(dto.data)) throw new BadRequestException('JSON data must be a list of leads');
    const result = await this.discovery.importFile(dto.format, dto.data);
    await this.audit.log(req.actor, 'DISCOVERY_IMPORT', undefined, { created: result.created, updated: result.updated });
    return result;
  }
}

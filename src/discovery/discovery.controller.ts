import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { ApiKeyGuard } from '../common/api-key.guard';
import { AuditService } from '../common/audit.service';
import { DiscoveryService } from './discovery.service';
import { AiDiscoveryService } from './ai-discovery.service';
import { SEGMENTS, SegmentKey } from './ai-discovery';

class AiSearchDto {
  /** Leave out to search every category. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsIn(Object.keys(SEGMENTS), { each: true }) segments?: SegmentKey[];
  @IsOptional() @IsString() @Length(2, 2) country?: string;
  @IsOptional() @IsString() @MaxLength(40) language?: string;
  @IsOptional() @IsString() @MaxLength(200) focus?: string;
  @IsOptional() @IsInt() @Min(3) @Max(25) limit?: number;
}
class UrlsDto {
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(500, { each: true }) urls: string[];
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
      segments: dto.segments?.length ? [...new Set(dto.segments)] : (Object.keys(SEGMENTS) as SegmentKey[]),
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

  @Post('urls')
  async urls(@Req() req: any, @Body() dto: UrlsDto) {
    const results = await this.discovery.addUrls(dto.urls);
    await this.audit.log(req.actor, 'DISCOVERY_URLS', undefined, { count: dto.urls.length });
    return { results };
  }
}

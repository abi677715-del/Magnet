import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { AuthGuard } from '../common/auth.guard';
import { AuditService } from '../common/audit.service';
import { DiscoveryService } from './discovery.service';
import { AiDiscoveryService } from './ai-discovery.service';
import { Platform } from '@prisma/client';
import { PLATFORM_SEGMENTS, SEGMENTS, SegmentKey } from './ai-discovery';
import { effectiveTopics, TOPIC_KEYS, TOPICS } from './topics';

class AiSearchDto {
  /** Leave out to search every category. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsIn(Object.keys(SEGMENTS), { each: true }) segments?: SegmentKey[];
  @IsOptional() @IsIn(Object.values(Platform)) platform?: Platform;
  @IsOptional() @IsString() @Length(2, 2) country?: string;
  @IsOptional() @IsString() @MaxLength(40) language?: string;
  /** Leave out (or tick all) for no topic restriction. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsIn(TOPIC_KEYS, { each: true }) topics?: string[];
  @IsOptional() @IsString() @MaxLength(200) focus?: string;
  @IsOptional() @IsInt() @Min(3) @Max(25) limit?: number;
}
@Controller('discovery')
@UseGuards(AuthGuard)
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
      segments: dto.platform ? PLATFORM_SEGMENTS[dto.platform] : dto.segments?.length ? [...new Set(dto.segments)] : (Object.keys(SEGMENTS) as SegmentKey[]),
      platform: dto.platform,
      country: dto.country?.toUpperCase(),
      language: dto.language,
      topics: effectiveTopics(dto.topics),
      focus: dto.focus,
      limit: dto.limit ?? 15,
    });
  }

  @Get('ai/topics')
  topics() {
    return TOPICS;
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
}

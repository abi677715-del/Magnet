import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { IngestService } from './ingest.service';
import { YoutubeProvider } from './providers/youtube.provider';
import { WebProvider } from './providers/web.provider';
import { AiDiscoveryService } from './ai-discovery.service';
import { AI_DISCOVERER, AnthropicDiscoverer } from './ai-discovery';

@Module({
  controllers: [DiscoveryController],
  providers: [DiscoveryService, IngestService, YoutubeProvider, WebProvider, AiDiscoveryService, { provide: AI_DISCOVERER, useFactory: () => new AnthropicDiscoverer() }],
  exports: [IngestService],
})
export class DiscoveryModule {}

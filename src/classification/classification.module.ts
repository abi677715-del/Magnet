import { Module } from '@nestjs/common';
import { ClassificationService, CLASSIFIER_LLM } from './classification.service';
import { AnthropicClassifier } from './llm';

@Module({
  providers: [ClassificationService, { provide: CLASSIFIER_LLM, useFactory: () => new AnthropicClassifier() }],
  exports: [ClassificationService],
})
export class ClassificationModule {}

import { Module } from '@nestjs/common';
import { AnthropicDrafter } from './drafter';
import { MAILER, ResendMailer } from './mailer';
import { DRAFTER, OutreachService } from './outreach.service';
import { OutreachController, UnsubscribeController } from './outreach.controller';

@Module({
  controllers: [OutreachController, UnsubscribeController],
  providers: [
    OutreachService,
    { provide: DRAFTER, useFactory: () => new AnthropicDrafter() },
    { provide: MAILER, useClass: ResendMailer },
  ],
})
export class OutreachModule {}

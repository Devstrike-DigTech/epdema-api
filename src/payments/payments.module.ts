import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TiersModule } from '../tiers/tiers.module';
import { SegmentsModule } from '../segments/segments.module';
import { PaymentsController } from './payments.controller';
import { PaystackWebhookController } from './paystack-webhook.controller';
import { PaymentsService } from './payments.service';
import { PaystackAdapter } from './paystack.adapter';

@Module({
  imports: [EventsModule, TiersModule, SegmentsModule],
  controllers: [PaymentsController, PaystackWebhookController],
  providers: [PaymentsService, PaystackAdapter],
  exports: [PaymentsService],
})
export class PaymentsModule {}

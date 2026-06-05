import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser, type CurrentUserPayload } from '../auth/current-user.decorator';
import { PaymentsService } from './payments.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { serializePayment } from './payments.serializer';
import { PaymentDto, PaymentIntentResponseDto } from './payments.responses';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('intents')
  // Tighter limit than the global 60/min: 10/min/user on intents.
  // Phase 5.7·F — overrides the `medium` named scope; this is the
  // payment-flow burst protection (Paystack init is expensive).
  @Throttle({ medium: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    operationId: 'payments_createIntent',
    summary: 'Create (or replay) a payment intent',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID v4 generated client-side.' })
  @ApiCreatedResponse({
    type: PaymentIntentResponseDto,
    description:
      'Created (or replayed) a payment intent. Returns a Paystack checkout URL for paid ' +
      'tiers; free tier short-circuits to status=success with no URL.',
  })
  async createIntent(
    @CurrentUser() user: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: CreatePaymentIntentDto,
  ) {
    return this.payments.createIntent(user.id, user.email, idempotencyKey, dto);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'payments_get', summary: 'Get a payment by ID' })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Payment UUID.',
  })
  @ApiQuery({
    name: 'reconcile',
    required: false,
    example: 'true',
    description:
      'When "true" or "1", calls Paystack verify if the payment is still pending. Use on the return page.',
  })
  @ApiOkResponse({
    type: PaymentDto,
    description: 'Get a payment owned by the authenticated user.',
  })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('reconcile') reconcile?: string,
  ) {
    const payment = await this.payments.getOwned(user.id, id, {
      reconcile: reconcile === 'true' || reconcile === '1',
    });
    return serializePayment(payment);
  }

  @Get('by-reference/:reference')
  @ApiOperation({
    operationId: 'payments_getByReference',
    summary: 'Look up a payment by Paystack reference',
  })
  @ApiParam({
    name: 'reference',
    example: 'ref_3f8c2e1a4b9d',
    description: 'Paystack reference echoed back on the return-page redirect.',
  })
  @ApiQuery({
    name: 'reconcile',
    required: false,
    example: 'true',
    description:
      'When "true" or "1", calls Paystack verify if the payment is still pending. Use on the return page.',
  })
  @ApiOkResponse({
    type: PaymentDto,
    description:
      'Look up a payment by Paystack reference (used by the return page since Paystack only echoes `reference` in the redirect).',
  })
  async getByReference(
    @CurrentUser() user: CurrentUserPayload,
    @Param('reference') reference: string,
    @Query('reconcile') reconcile?: string,
  ) {
    const payment = await this.payments.getOwnedByReference(user.id, reference, {
      reconcile: reconcile === 'true' || reconcile === '1',
    });
    return serializePayment(payment);
  }
}

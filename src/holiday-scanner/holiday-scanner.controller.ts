import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser, type CurrentUserPayload } from '../auth/current-user.decorator';
import { HolidayScannerService } from './holiday-scanner.service';
import { HolidayScanResponseDto } from './holiday-scanner.responses';

@ApiTags('holiday-scanner')
@ApiBearerAuth()
@Controller('events/:eventId/holiday-scan')
export class HolidayScannerController {
  constructor(private readonly scanner: HolidayScannerService) {}

  @Post()
  @HttpCode(200)
  // Defense-in-depth on top of the per-date one-shot enforcement.
  @Throttle({ short: { ttl: 30_000, limit: 1 } })
  @ApiOperation({
    operationId: 'holidayScanner_scan',
    summary: 'Run the holiday & conflict scan for an event (admin, add-on required)',
  })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiOkResponse({
    type: HolidayScanResponseDto,
    description:
      'Generates a fresh scan against the current event.scheduledDate. ' +
      "Returns 403 when the event doesn't have the `holiday_scanner` add-on; " +
      '409 when a scan already exists for this date (re-run after changing ' +
      'the date, or buy the add-on again to re-roll).',
  })
  async scan(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.scanner.scan({ eventId, actorUserId: user.id });
  }

  @Get()
  @ApiOperation({
    operationId: 'holidayScanner_latest',
    summary: 'Read the most recent holiday-scan result (no new model call)',
  })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiOkResponse({
    type: HolidayScanResponseDto,
    description:
      'Returns the most recent persisted scan (warnings + scannedDate) so ' +
      "the event detail page can surface them without re-rolling Claude. " +
      "When nothing's been scanned yet, returns `{ warnings: [], scannedDate: '', costCents: 0 }`.",
  })
  async latest(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    const result = await this.scanner.latest(eventId, user.id);
    return result ?? { warnings: [], scannedDate: '', costCents: 0 };
  }
}

import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { SegmentsController } from './segments.controller';
import { SegmentsService } from './segments.service';
import { ProposalsController } from './proposals/proposals.controller';
import { ProposalsService } from './proposals/proposals.service';
import { ObjectionsController } from './objections/objections.controller';
import { ObjectionsService } from './objections/objections.service';
import { SegmentSuggestionsController } from './suggestions/suggestions.controller';
import { SegmentSuggestionService } from './suggestions/segment-suggestion.service';

@Module({
  imports: [EventsModule],
  controllers: [
    SegmentsController,
    ProposalsController,
    ObjectionsController,
    SegmentSuggestionsController,
  ],
  providers: [
    SegmentsService,
    ProposalsService,
    ObjectionsService,
    SegmentSuggestionService,
  ],
  exports: [SegmentsService],
})
export class SegmentsModule {}

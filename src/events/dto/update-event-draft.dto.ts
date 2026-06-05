import { PartialType } from '@nestjs/swagger';
import { CreateEventDraftDto } from './create-event-draft.dto';

export class UpdateEventDraftDto extends PartialType(CreateEventDraftDto) {}

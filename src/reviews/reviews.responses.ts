import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewerSummaryDto {
  @ApiProperty({ example: 'usr_2N9k8x...' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: 'Bola Adesina' })
  name!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: null })
  image!: string | null;
}

export class EventReviewDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'usr_2N9k8x...' })
  reviewerId!: string;

  @ApiProperty({ example: 'usr_creator...' })
  revieweeId!: string;

  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  rating!: number;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    description:
      'Free-form comment. Surfaced only when the viewer is the reviewee or has admin rights on the event — null otherwise.',
  })
  comment!: string | null;

  @ApiProperty({ example: '2026-06-25T10:14:00.000Z' })
  createdAt!: string;
}

export class EventReviewWithReviewerDto extends EventReviewDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Reviewer profile snippet — null for non-privileged viewers.',
    type: () => ReviewerSummaryDto,
  })
  reviewer!: ReviewerSummaryDto | null;
}

export class EventReviewsListResponseDto {
  @ApiProperty({ type: [EventReviewWithReviewerDto] })
  reviews!: EventReviewWithReviewerDto[];

  @ApiProperty({
    example: true,
    description:
      'Whether the viewer can see all reviews (admin/creator) vs only their own row. Lets the UI decide whether to render the full list or just the "you reviewed" card.',
  })
  isPrivileged!: boolean;
}

export class EventRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: "Bola's surprise 30th" })
  title!: string;
  @ApiPropertyOptional({ nullable: true, type: 'string', example: '2026-07-25' })
  scheduledDate!: string | null;
}

export class ReviewGivenDto extends EventReviewDto {
  @ApiProperty({ type: () => EventRefDto })
  event!: EventRefDto;
}

export class ReviewReceivedDto extends EventReviewDto {
  @ApiProperty({ type: () => EventRefDto })
  event!: EventRefDto;

  @ApiPropertyOptional({ nullable: true, type: () => ReviewerSummaryDto })
  reviewer!: ReviewerSummaryDto | null;
}

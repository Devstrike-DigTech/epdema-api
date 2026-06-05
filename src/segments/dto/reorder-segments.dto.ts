import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Bulk reorder — atomic. Must include EVERY segment of the event in the new
 * order, otherwise the server rejects (prevents partial / inconsistent state).
 */
export class ReorderSegmentsDto {
  @ApiProperty({
    type: [String],
    description: 'Segment IDs in their new order. Must list every segment of the event exactly once.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  orderedIds!: string[];
}

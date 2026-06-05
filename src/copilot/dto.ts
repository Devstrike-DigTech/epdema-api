import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class DraftEventDto {
  @ApiProperty({
    description:
      "Free-form description of the event the user wants to plan. The copilot reads this and proposes title + type + date + initial segments.",
    example:
      "30th birthday for my partner Bola, surprise-style, ~40 close friends, modest budget, somewhere in Lekki, last Saturday of July.",
    minLength: 10,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(10, { message: 'Tell me a bit more about the event (10+ chars).' })
  @MaxLength(2000)
  description!: string;
}

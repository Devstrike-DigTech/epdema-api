import { ApiProperty } from '@nestjs/swagger';

/**
 * Swagger-only response classes for the health controller. The controller
 * returns a plain object shaped like these classes — we never instantiate
 * them. Their sole job is to give the OpenAPI spec a typed body schema so
 * codegen produces real types instead of `unknown`.
 */

export class HealthChecksDto {
  @ApiProperty({ enum: ['ok', 'fail'], example: 'ok' })
  postgres!: 'ok' | 'fail';

  @ApiProperty({ enum: ['ok', 'fail'], example: 'ok' })
  redis!: 'ok' | 'fail';
}

export class HealthResponseDto {
  @ApiProperty({
    enum: ['ok', 'degraded'],
    example: 'ok',
    description: 'Overall status — "degraded" when any dependency check fails.',
  })
  status!: 'ok' | 'degraded';

  @ApiProperty({
    example: '2026-06-02T12:34:56.789Z',
    description: 'ISO-8601 timestamp at which the check was performed.',
  })
  timestamp!: string;

  @ApiProperty({
    example: 12345.678,
    description: 'Process uptime in seconds (from `process.uptime()`).',
  })
  uptime!: number;

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto;
}

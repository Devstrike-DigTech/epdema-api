import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../infra/redis/redis.service';
import { Public } from '../auth/public.decorator';
import { HealthResponseDto } from './health.responses';

interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptime: number;
  checks: {
    postgres: 'ok' | 'fail';
    redis: 'ok' | 'fail';
  };
}

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ operationId: 'health_check', summary: 'Liveness + dependency check' })
  @ApiOkResponse({
    type: HealthResponseDto,
    description: 'Liveness + dependency check (Postgres + Redis).',
  })
  async health(): Promise<HealthResponse> {
    const [pg, rd] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.client.ping(),
    ]);

    const checks = {
      postgres: pg.status === 'fulfilled' ? ('ok' as const) : ('fail' as const),
      redis: rd.status === 'fulfilled' ? ('ok' as const) : ('fail' as const),
    };

    return {
      status: checks.postgres === 'ok' && checks.redis === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    };
  }
}

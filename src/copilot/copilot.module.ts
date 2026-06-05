import { Module } from '@nestjs/common';

import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';

/**
 * Phase 6·C — pre-creation event copilot. Production+ users get a
 * "Help me plan this" mode on `/events/new` that calls this controller.
 *
 * Composition is intentionally small — `AiAdapter`, `AuditService` and
 * `PrismaService` are all global so we don't import them here.
 */
@Module({
  controllers: [CopilotController],
  providers: [CopilotService],
  exports: [CopilotService],
})
export class CopilotModule {}

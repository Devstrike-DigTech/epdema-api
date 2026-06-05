import { Module } from '@nestjs/common';

import { MembersModule } from '../members/members.module';
import { VibePackController } from './vibe-pack.controller';
import { VibePackService } from './vibe-pack.service';

@Module({
  imports: [MembersModule],
  controllers: [VibePackController],
  providers: [VibePackService],
})
export class VibePackModule {}

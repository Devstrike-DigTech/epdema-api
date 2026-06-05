import { Module } from '@nestjs/common';

import { MembersModule } from '../members/members.module';
import { HolidayScannerController } from './holiday-scanner.controller';
import { HolidayScannerService } from './holiday-scanner.service';

@Module({
  imports: [MembersModule],
  controllers: [HolidayScannerController],
  providers: [HolidayScannerService],
})
export class HolidayScannerModule {}

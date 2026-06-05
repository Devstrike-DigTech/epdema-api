import { Module } from '@nestjs/common';

import { BrandModule } from '../brand/brand.module';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';

@Module({
  imports: [BrandModule],
  controllers: [ShareController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}

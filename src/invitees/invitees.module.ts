import { Module } from '@nestjs/common';

import { BrandModule } from '../brand/brand.module';
import { InviteesController } from './invitees.controller';
import { RsvpController } from './rsvp.controller';
import { InviteesService } from './invitees.service';

@Module({
  imports: [BrandModule],
  controllers: [InviteesController, RsvpController],
  providers: [InviteesService],
  exports: [InviteesService],
})
export class InviteesModule {}

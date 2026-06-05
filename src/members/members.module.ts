import { Global, Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { InvitationsController } from './invitations.controller';
import { MembersService } from './members.service';

/**
 * @Global so SegmentsService / ProposalsService / etc. can inject
 * MembersService for the central `assertMemberOrThrow` authz check.
 */
@Global()
@Module({
  controllers: [MembersController, InvitationsController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}

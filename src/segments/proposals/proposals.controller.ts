import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../../auth/current-user.decorator';
import { ProposalsService } from './proposals.service';
import { CreateProposalDto } from './dto';
import { serializeProposal } from './serializers';
import { ProposalResponseDto } from './proposals.responses';

const SEGMENT_ID_PARAM = {
  name: 'segmentId',
  format: 'uuid',
  description: 'Parent segment UUID.',
} as const;

const PROPOSAL_ID_PARAM = {
  name: 'proposalId',
  format: 'uuid',
  description: 'Proposal UUID.',
} as const;

@ApiTags('proposals')
@ApiBearerAuth()
@Controller()
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get('segments/:segmentId/proposals')
  @ApiOperation({ operationId: 'proposals_list', summary: 'List live proposals on a segment' })
  @ApiParam(SEGMENT_ID_PARAM)
  @ApiOkResponse({
    type: [ProposalResponseDto],
    description: 'List live proposals for a segment.',
  })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
  ) {
    const proposals = await this.proposals.listForSegment(user.id, segmentId);
    return proposals.map(serializeProposal);
  }

  @Post('segments/:segmentId/proposals')
  @ApiOperation({ operationId: 'proposals_create', summary: 'Create a proposal on a segment' })
  @ApiParam(SEGMENT_ID_PARAM)
  @ApiCreatedResponse({
    type: ProposalResponseDto,
    description: 'Create a proposal on a segment.',
  })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
    @Body() dto: CreateProposalDto,
  ) {
    const proposal = await this.proposals.create(user.id, segmentId, dto);
    return serializeProposal(proposal);
  }

  @Post('proposals/:proposalId/withdraw')
  @HttpCode(200)
  @ApiOperation({ operationId: 'proposals_withdraw', summary: 'Withdraw a proposal (proposer)' })
  @ApiParam(PROPOSAL_ID_PARAM)
  @ApiOkResponse({
    type: ProposalResponseDto,
    description: 'Withdraw a proposal (proposer only).',
  })
  async withdraw(
    @CurrentUser() user: CurrentUserPayload,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ) {
    const proposal = await this.proposals.withdraw(user.id, proposalId);
    return serializeProposal(proposal);
  }
}

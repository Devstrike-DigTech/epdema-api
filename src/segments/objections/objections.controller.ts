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
import { ObjectionsService } from './objections.service';
import { CreateObjectionDto } from './dto';
import { serializeObjection } from './serializers';
import { ObjectionResponseDto } from './objections.responses';

const PROPOSAL_ID_PARAM = {
  name: 'proposalId',
  format: 'uuid',
  description: 'Parent proposal UUID.',
} as const;

const OBJECTION_ID_PARAM = {
  name: 'objectionId',
  format: 'uuid',
  description: 'Objection UUID.',
} as const;

@ApiTags('objections')
@ApiBearerAuth()
@Controller()
export class ObjectionsController {
  constructor(private readonly objections: ObjectionsService) {}

  @Get('proposals/:proposalId/objections')
  @ApiOperation({ operationId: 'objections_list', summary: 'List live objections on a proposal' })
  @ApiParam(PROPOSAL_ID_PARAM)
  @ApiOkResponse({
    type: [ObjectionResponseDto],
    description: 'List live objections against a proposal.',
  })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ) {
    const objections = await this.objections.listForProposal(user.id, proposalId);
    return objections.map(serializeObjection);
  }

  @Post('proposals/:proposalId/objections')
  @ApiOperation({ operationId: 'objections_create', summary: 'Raise an objection on a proposal' })
  @ApiParam(PROPOSAL_ID_PARAM)
  @ApiCreatedResponse({
    type: ObjectionResponseDto,
    description: 'Raise an objection against a proposal.',
  })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() dto: CreateObjectionDto,
  ) {
    const objection = await this.objections.create(user.id, proposalId, dto);
    return serializeObjection(objection);
  }

  @Post('objections/:objectionId/withdraw')
  @HttpCode(200)
  @ApiOperation({ operationId: 'objections_withdraw', summary: 'Withdraw an objection (objector)' })
  @ApiParam(OBJECTION_ID_PARAM)
  @ApiOkResponse({
    type: ObjectionResponseDto,
    description: 'Withdraw an objection (objector only).',
  })
  async withdraw(
    @CurrentUser() user: CurrentUserPayload,
    @Param('objectionId', ParseUUIDPipe) objectionId: string,
  ) {
    const objection = await this.objections.withdraw(user.id, objectionId);
    return serializeObjection(objection);
  }
}

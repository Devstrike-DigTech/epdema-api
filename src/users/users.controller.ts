import { Body, Controller, Get, HttpCode, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type CurrentUserPayload } from '../auth/current-user.decorator';
import { UsersService } from './users.service';
import { CurrentUserResponseDto, UserProfileDto } from './users.responses';
import { UpdateProfileDto } from './dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ operationId: 'users_me', summary: 'Get the authenticated user' })
  @ApiOkResponse({
    type: CurrentUserResponseDto,
    description: 'Authenticated user + EPDEMA profile (auto-created on first call).',
  })
  async me(@CurrentUser() user: CurrentUserPayload) {
    const profile = await this.users.findOrCreateProfile(user.id);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      profile,
    };
  }

  /**
   * Phase 7·F — partial update for the authenticated user's profile. Used
   * by the settings UI to toggle `ratingVisible` (the headline gating for
   * public rating display) and edit display fields. Upsert semantics:
   * absent fields are not modified.
   */
  @Patch('me/profile')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'users_updateProfile',
    summary: 'Update the authenticated user’s profile (partial)',
  })
  @ApiOkResponse({
    type: UserProfileDto,
    description:
      'Returns the updated profile. Setting `ratingVisible=false` hides the ' +
      'creator’s rating from the public share page immediately — no cache ' +
      'invalidation needed, the share serializer re-reads on every request.',
  })
  async updateProfile(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.users.updateProfile(user.id, dto);
  }
}

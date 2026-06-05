import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../auth/current-user.decorator';
import { BrandService } from './brand.service';
import { UpdateBrandDto } from './dto';
import { BrandResponseDto } from './brand.responses';

/**
 * Path-param shorthand: every route below is nested under `:eventId`; the
 * `@ApiParam` decorator with `format: 'uuid'` makes Swagger render a UUID
 * picker in the docs UI and stops codegen from typing it as plain string.
 */
const EVENT_ID_PARAM = {
  name: 'eventId',
  format: 'uuid',
  description: 'Event UUID.',
} as const;

@ApiTags('brand')
@ApiBearerAuth()
@Controller('events/:eventId/brand')
export class BrandController {
  constructor(private readonly brand: BrandService) {}

  @Get()
  @ApiOperation({ operationId: 'brand_get', summary: 'Read the event brand (admin)' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: BrandResponseDto,
    description:
      "Read the event's brand (admin only). Returns null fields when nothing " +
      'has been configured yet — clients should fall back to default chrome.',
  })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.brand.getForAdmin(user.id, eventId);
  }

  @Put()
  @ApiOperation({ operationId: 'brand_updateColors', summary: 'Update brand colors (admin)' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({
    type: BrandResponseDto,
    description:
      'Update brand colors (admin only, Production+ tier gated). Pass each ' +
      'color as a hex string with leading "#". Omit a field to leave it ' +
      'unchanged; pass null to clear it.',
  })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.brand.updateColors(user.id, eventId, dto);
  }

  // ── Logo ────────────────────────────────────────────────────────────

  @Post('logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  @ApiOperation({ operationId: 'brand_uploadLogo', summary: 'Upload a logo (admin)' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({
    type: BrandResponseDto,
    description:
      'Upload a logo (admin, Production+). PNG / JPEG / WebP / SVG, max 2 MB. ' +
      'The previous logo is deleted from storage after the new one persists.',
  })
  async uploadLogo(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.brand.uploadAsset(user.id, eventId, 'logo', file);
  }

  @Delete('logo')
  @HttpCode(200)
  @ApiOperation({ operationId: 'brand_removeLogo', summary: 'Remove the logo (admin)' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({ type: BrandResponseDto, description: 'Remove the logo (admin).' })
  async removeLogo(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.brand.removeAsset(user.id, eventId, 'logo');
  }

  // ── Cover image ────────────────────────────────────────────────────

  @Post('cover')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 6 * 1024 * 1024 } }))
  @ApiOperation({ operationId: 'brand_uploadCover', summary: 'Upload a cover image (admin)' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({
    type: BrandResponseDto,
    description:
      'Upload a cover image (admin, Production+). PNG / JPEG / WebP, max 6 MB.',
  })
  async uploadCover(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.brand.uploadAsset(user.id, eventId, 'cover', file);
  }

  @Delete('cover')
  @HttpCode(200)
  @ApiOperation({ operationId: 'brand_removeCover', summary: 'Remove the cover image (admin)' })
  @ApiParam(EVENT_ID_PARAM)
  @ApiOkResponse({ type: BrandResponseDto, description: 'Remove the cover image (admin).' })
  async removeCover(
    @CurrentUser() user: CurrentUserPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.brand.removeAsset(user.id, eventId, 'cover');
  }
}

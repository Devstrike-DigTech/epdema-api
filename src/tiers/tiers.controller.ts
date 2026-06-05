import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { TiersService } from './tiers.service';
import { serializeTier, serializeAddon } from './serializers';
import { AddonDto, TierDto } from './tiers.responses';

@ApiTags('catalog')
@Controller()
export class TiersController {
  constructor(private readonly tiers: TiersService) {}

  @Public()
  @Get('tiers')
  @ApiOperation({ operationId: 'tiers_list', summary: 'List active tiers' })
  @ApiOkResponse({
    type: [TierDto],
    description: 'List active tiers (Free → Marquee) with prices in kobo.',
  })
  async listTiers() {
    const tiers = await this.tiers.listTiers();
    return tiers.map(serializeTier);
  }

  @Public()
  @Get('addons')
  @ApiOperation({ operationId: 'tiers_listAddons', summary: 'List active add-ons' })
  @ApiOkResponse({
    type: [AddonDto],
    description: 'List active à-la-carte add-ons.',
  })
  async listAddons() {
    const addons = await this.tiers.listAddons();
    return addons.map(serializeAddon);
  }
}

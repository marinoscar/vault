import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '@marinoscar/platform-api/identity';

import { ScanTargetsService } from './scan-targets.service';

/**
 * `GET /api/secrets/scan/targets` (issue #213, IDOC-10): the model card scanning and document
 * scanning run on, with the capabilities the model catalogue declares for it. The web combines
 * it with the public AI config (`GET /api/ai/config`) through the shared rule
 * (`isScanAvailable` of `@marinoscar/vault-contract/secrets`) to decide whether to offer a scan.
 * Model ids only: never a key, a base URL or any other provider setting. Needs `ai:use` (every
 * scan route does); not behind the kill switch, because the rule answers "no" while AI is off.
 *
 * @stability experimental
 */
@ApiTags('Secrets')
@Controller('secrets/scan')
export class ScanTargetsController {
  constructor(private readonly scanTargets: ScanTargetsService) {}

  @Get('targets')
  @Auth({ permissions: ['ai:use'] })
  @ApiOperation({
    summary: 'The models card and document scanning run on',
    description:
      'For `card_extract` and `document_extract`: the provider and model id the scan runs on and the ' +
      'capabilities the model catalogue declares for it (`null` when the model is not an enabled ' +
      'catalogue model), or `null` when no model is chosen. Combined with `GET /api/ai/config` it ' +
      'tells whether scanning is available. Needs `ai:use`.',
  })
  @ApiResponse({ status: 200, description: '{ card_extract, document_extract }' })
  async targets() {
    return { data: await this.scanTargets.targets() };
  }
}

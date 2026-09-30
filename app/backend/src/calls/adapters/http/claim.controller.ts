import { BadRequestException, Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import type { requestContext } from '../../../shared/http/request-context';
import { ClaimNextContactUseCase } from '../../application/use-cases/claim-next-contact.use-case';

const claimSchema = z.object({ campaign_id: z.guid() });

@Controller('rpc')
export class ClaimController {
  constructor(private readonly claimNextContact: ClaimNextContactUseCase) {}

  @Post('claim_next_contact')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async claim(@Body() body: unknown, @Req() req: requestContext): Promise<unknown> {
    const parsed = claimSchema.safeParse(body);
    if (!parsed.success || !req.principal) {
      throw new BadRequestException({ code: 'INVALID_REQUEST' });
    }

    const contact = await this.claimNextContact.execute({
      orgId: req.principal.orgId,
      campaignId: parsed.data.campaign_id,
      tenantToken: req.principal.token
    });

    return {
      contact: contact ? {
        id: contact.id,
        phone_e164: contact.phoneE164,
        attempt_id: contact.attemptId
      } : null
    };
  }
}

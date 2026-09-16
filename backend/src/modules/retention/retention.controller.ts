import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { RetentionService } from './retention.service';

class EraseDto {
  @IsString() @IsNotEmpty() reason: string;
  /** Typed confirmation, so erasure cannot happen on a stray tap. */
  @IsString() @IsIn(['ERASE'], { message: 'Type ERASE to confirm' })
  confirm: string;
}

@Controller('retention')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  /** Former tenants and their export/erasure state. */
  @Get('vacated')
  @RequirePermissions(PERMISSIONS.TENANT_VIEW)
  listVacated() {
    return this.retention.listVacated();
  }

  /**
   * The archive carries the tenant's Aadhaar in full — it is the copy that has
   * to survive the erasure — so it needs the same permission as seeing the
   * number on screen. Without that, a role the UI shows a masked number to
   * could read the real one out of the spreadsheet.
   */
  @Get('tenants/:id/export')
  @RequirePermissions(
    PERMISSIONS.TENANT_VIEW,
    PERMISSIONS.TENANT_VIEW_SENSITIVE,
    PERMISSIONS.EXPORT_RUN,
  )
  async export(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const chosen = format === 'pdf' ? 'pdf' : 'xlsx';
    const { buffer, fileName } = await this.retention.export(id, chosen, user.id);

    res.setHeader(
      'Content-Type',
      chosen === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  /** What erasing would remove and keep, and whether it is allowed yet. */
  @Get('tenants/:id/erasure-preview')
  @RequirePermissions(PERMISSIONS.TENANT_ERASE)
  preview(@Param('id') id: string) {
    return this.retention.erasurePreview(id);
  }

  @Post('tenants/:id/erase')
  @RequirePermissions(PERMISSIONS.TENANT_ERASE)
  erase(
    @Param('id') id: string,
    @Body() dto: EraseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.retention.erase(id, dto.reason, user.id);
  }
}

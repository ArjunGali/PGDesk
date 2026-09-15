import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('monthly')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  monthly(
    @CurrentUser() user: AuthenticatedUser,
    @Query('month') month?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reports.monthlySummary(
      month ? new Date(month) : new Date(),
      branchId,
      user.branchIds,
    );
  }

  @Get('collections')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  collections(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reports.collections(new Date(from), new Date(to), branchId);
  }

  @Get('occupancy')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  occupancy(
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.reports.occupancy(
      new Date(from),
      new Date(to),
      user?.branchIds ?? [],
    );
  }

  @Get('movements')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  movements(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reports.movements(new Date(from), new Date(to), branchId);
  }

  @Get('eb')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  eb(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reports.ebSummary(new Date(from), new Date(to), branchId);
  }
}

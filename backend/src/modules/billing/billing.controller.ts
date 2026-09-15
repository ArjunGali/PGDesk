import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { BillingService } from './billing.service';

class GenerateInvoiceDto {
  @IsString() @IsNotEmpty() stayId: string;
  @IsDateString() periodStart: string;
  @IsDateString() periodEnd: string;
  @IsOptional() @IsBoolean() issue?: boolean;
}

class MonthlyRunDto {
  /** Any date inside the month to bill. */
  @IsDateString() month: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsBoolean() issue?: boolean;
}

class CancelInvoiceDto {
  @IsString() @IsNotEmpty() reason: string;
}

class AdjustmentDto {
  @IsString() @IsNotEmpty() description: string;
  @IsNumberString() amount: string;
  @IsString() @IsNotEmpty() reason: string;
}

class InvoiceQueryDto {
  @IsOptional() @IsString() stayId?: string;
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() overdueOnly?: string;
  @IsOptional() @Type(() => Number) @IsInt() page?: number;
  @IsOptional() @Type(() => Number) @IsInt() pageSize?: number;
}

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.INVOICE_VIEW)
  list(@Query() query: InvoiceQueryDto) {
    return this.billing.listInvoices({
      ...query,
      status: query.status
        ? (query.status.split(',') as InvoiceStatus[])
        : undefined,
      overdueOnly: query.overdueOnly === 'true',
    });
  }

  @Get('invoices/:id')
  @RequirePermissions(PERMISSIONS.INVOICE_VIEW)
  getOne(@Param('id') id: string) {
    return this.billing.getInvoice(id);
  }

  /** Dry run: what a bill would contain, without creating it. */
  @Get('billing/preview')
  @RequirePermissions(PERMISSIONS.INVOICE_VIEW)
  async preview(
    @Query('stayId') stayId: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
  ) {
    const computed = await this.billing.computeCharges(
      stayId,
      new Date(periodStart),
      new Date(periodEnd),
    );
    return {
      ...computed,
      total: computed.total.toFixed(2),
      lines: computed.lines.map((l) => ({
        ...l,
        quantity: l.quantity.toFixed(3),
        unitAmount: l.unitAmount.toFixed(2),
        amount: l.amount.toFixed(2),
      })),
      segments: computed.segments.map((s) => ({
        ...s,
        baseWithFood: s.baseWithFood.toFixed(2),
        foodDifference: s.foodDifference.toFixed(2),
        rentComponent: s.rentComponent.toFixed(2),
      })),
    };
  }

  @Post('invoices/generate')
  @RequirePermissions(PERMISSIONS.INVOICE_MANAGE)
  generate(
    @Body() dto: GenerateInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billing.generateInvoice(
      dto.stayId,
      new Date(dto.periodStart),
      new Date(dto.periodEnd),
      user.id,
      { issue: dto.issue },
    );
  }

  @Post('invoices/monthly-run')
  @RequirePermissions(PERMISSIONS.INVOICE_MANAGE)
  monthlyRun(@Body() dto: MonthlyRunDto, @CurrentUser() user: AuthenticatedUser) {
    return this.billing.generateMonthlyRun(new Date(dto.month), user.id, {
      branchId: dto.branchId,
      issue: dto.issue,
    });
  }

  @Post('invoices/:id/issue')
  @RequirePermissions(PERMISSIONS.INVOICE_MANAGE)
  issue(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.billing.issueInvoice(id, user.id);
  }

  @Post('invoices/:id/cancel')
  @RequirePermissions(PERMISSIONS.INVOICE_MANAGE)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billing.cancelInvoice(id, dto.reason, user.id);
  }

  @Post('invoices/:id/adjustments')
  @RequirePermissions(PERMISSIONS.ADJUSTMENT_MANAGE)
  addAdjustment(
    @Param('id') id: string,
    @Body() dto: AdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billing.addAdjustment(id, dto, user.id);
  }

  /** Payments screen: everyone with money outstanding. */
  @Get('payments/pending')
  @RequirePermissions(PERMISSIONS.PAYMENT_VIEW)
  pending(
    @Query('branchId') branchId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billing.pendingPayments(branchId, user.branchIds);
  }

  @Get('stays/:id/outstanding')
  @RequirePermissions(PERMISSIONS.INVOICE_VIEW)
  async outstanding(@Param('id') id: string) {
    const result = await this.billing.outstandingForStay(id);
    return {
      ...result,
      totalBilled: result.totalBilled.toFixed(2),
      totalPaid: result.totalPaid.toFixed(2),
      balance: result.balance.toFixed(2),
    };
  }
}

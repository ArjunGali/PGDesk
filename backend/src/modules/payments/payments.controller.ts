import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DepositEntryType, PaymentMethod, PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
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
import { PaymentsService } from './payments.service';

class RecordPaymentDto {
  @IsString() @IsNotEmpty() stayId: string;
  @IsNumberString() amount: string;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  /** Required for CASH_AND_UPI; the parts must add up to `amount`. */
  @IsOptional() @IsNumberString() cashAmount?: string;
  @IsOptional() @IsNumberString() upiAmount?: string;
  @IsDateString() paidAt: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() invoiceIds?: string[];
  /** Confirms a second, genuinely separate payment of the same amount. */
  @IsOptional() @IsBoolean() allowDuplicate?: boolean;
}

class VerifyPaymentDto {
  @IsOptional() @IsArray() invoiceIds?: string[];
}

class RejectPaymentDto {
  @IsString() @IsNotEmpty() reason: string;
}

class ReversePaymentDto {
  @IsString() @IsNotEmpty() reason: string;
}

class DepositEntryDto {
  @IsString() @IsNotEmpty() stayId: string;
  @IsEnum(DepositEntryType) type: DepositEntryType;
  @IsNumberString() amount: string;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @IsDateString() occurredAt: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
}

class PaymentQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() stayId?: string;
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() page?: number;
  @IsOptional() @Type(() => Number) @IsInt() pageSize?: number;
}

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  @RequirePermissions(PERMISSIONS.PAYMENT_VIEW)
  list(@Query() query: PaymentQueryDto) {
    return this.payments.listPayments({
      ...query,
      status: query.status
        ? (query.status.split(',') as PaymentStatus[])
        : undefined,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  @Post('payments')
  @RequirePermissions(PERMISSIONS.PAYMENT_RECORD)
  record(@Body() dto: RecordPaymentDto, @CurrentUser() user: AuthenticatedUser) {
    // Someone who can approve has their own entry approved on the spot;
    // everyone else's waits for a second pair of eyes.
    const canApprove =
      user.isOwner || user.permissions.includes(PERMISSIONS.PAYMENT_APPROVE);
    return this.payments.record(dto, user.id, { canApprove });
  }

  /** The approve queue: money collected but not yet counted against bills. */
  @Get('payments/awaiting-approval')
  @RequirePermissions(PERMISSIONS.PAYMENT_VIEW)
  awaitingApproval(@Query('branchId') branchId?: string) {
    return this.payments.awaitingApproval(branchId);
  }

  @Post('payments/:id/verify')
  @RequirePermissions(PERMISSIONS.PAYMENT_APPROVE)
  verify(
    @Param('id') id: string,
    @Body() dto: VerifyPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.verify(id, user.id, dto.invoiceIds);
  }

  @Post('payments/:id/reject')
  @RequirePermissions(PERMISSIONS.PAYMENT_APPROVE)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.reject(id, dto.reason, user.id);
  }

  @Post('payments/:id/reverse')
  @RequirePermissions(PERMISSIONS.PAYMENT_REVERSE)
  reverse(
    @Param('id') id: string,
    @Body() dto: ReversePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.reverse(id, dto.reason, user.id);
  }

  @Get('stays/:id/deposit')
  @RequirePermissions(PERMISSIONS.DEPOSIT_VIEW)
  depositLedger(@Param('id') id: string) {
    return this.payments.depositLedger(id);
  }

  @Post('deposits')
  @RequirePermissions(PERMISSIONS.DEPOSIT_MANAGE)
  addDepositEntry(
    @Body() dto: DepositEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.addDepositEntry(dto, user.id);
  }
}

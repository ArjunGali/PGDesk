import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DepositEntryType, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
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
  @IsDateString() paidAt: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() invoiceIds?: string[];
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
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  @Post('payments')
  @RequirePermissions(PERMISSIONS.PAYMENT_RECORD)
  record(@Body() dto: RecordPaymentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.record(dto, user.id);
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

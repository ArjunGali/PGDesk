import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { EbService } from './eb.service';

class CreateMeterDto {
  @IsOptional() @IsString() roomId?: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() serialNo?: string;
}

class RecordReadingDto {
  @IsString() @IsNotEmpty() meterId: string;
  @IsDateString() readingDate: string;
  @IsNumberString() value: string;
  @IsOptional() @IsBoolean() isReset?: boolean;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() photoPath?: string;
}

class CycleDto {
  @IsString() @IsNotEmpty() meterId: string;
  @IsDateString() periodStart: string;
  @IsDateString() periodEnd: string;
  @IsOptional() @IsNumberString() startValue?: string;
  @IsOptional() @IsNumberString() endValue?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() acknowledgeWarnings?: boolean;
}

class CancelCycleDto {
  @IsString() @IsNotEmpty() reason: string;
}

@Controller('eb')
export class EbController {
  constructor(private readonly eb: EbService) {}

  @Get('meters')
  @RequirePermissions(PERMISSIONS.EB_VIEW)
  listMeters(@Query('branchId') branchId?: string) {
    return this.eb.listMeters(branchId);
  }

  @Post('meters')
  @RequirePermissions(PERMISSIONS.EB_MANAGE)
  createMeter(@Body() dto: CreateMeterDto) {
    return this.eb.createMeter(dto);
  }

  @Get('meters/:id/readings')
  @RequirePermissions(PERMISSIONS.EB_VIEW)
  listReadings(@Param('id') id: string, @Query('take') take?: string) {
    return this.eb.listReadings(id, take ? Number(take) : 24);
  }

  @Post('readings')
  @RequirePermissions(PERMISSIONS.EB_MANAGE)
  recordReading(
    @Body() dto: RecordReadingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eb.recordReading(dto, user.id);
  }

  /** What the E.B. Calculations screen shows before anything is committed. */
  @Get('cycles/preview')
  @RequirePermissions(PERMISSIONS.EB_VIEW)
  preview(
    @Query('meterId') meterId: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
    @Query('startValue') startValue?: string,
    @Query('endValue') endValue?: string,
  ) {
    return this.eb.previewCycle({
      meterId,
      periodStart,
      periodEnd,
      startValue,
      endValue,
    });
  }

  @Get('cycles')
  @RequirePermissions(PERMISSIONS.EB_VIEW)
  listCycles(
    @Query('meterId') meterId?: string,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.eb.listCycles({
      meterId,
      branchId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Post('cycles/finalise')
  @RequirePermissions(PERMISSIONS.EB_MANAGE)
  finalise(@Body() dto: CycleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.eb.finaliseCycle(dto, user.id);
  }

  @Post('cycles/:id/cancel')
  @RequirePermissions(PERMISSIONS.EB_MANAGE)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelCycleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eb.cancelCycle(id, dto.reason, user.id);
  }
}

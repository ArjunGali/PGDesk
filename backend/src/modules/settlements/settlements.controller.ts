import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ChargeKind } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { SettlementsService } from './settlements.service';

class ManualLineDto {
  @IsOptional() @IsEnum(ChargeKind) kind?: ChargeKind;
  @IsString() @IsNotEmpty() description: string;
  @IsNumberString() amount: string;
  @IsString() @IsNotEmpty() reason: string;
}

class ReasonDto {
  @IsString() @IsNotEmpty() reason: string;
}

@Controller()
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('stays/:id/settlement')
  @RequirePermissions(PERMISSIONS.SETTLEMENT_VIEW)
  getByStay(@Param('id') id: string) {
    return this.settlements.getByStay(id);
  }

  @Post('settlements/:id/lines')
  @RequirePermissions(PERMISSIONS.ADJUSTMENT_MANAGE)
  addLine(
    @Param('id') id: string,
    @Body() dto: ManualLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settlements.addManualLine(id, dto, user.id);
  }

  @Delete('settlement-lines/:id')
  @RequirePermissions(PERMISSIONS.ADJUSTMENT_MANAGE)
  removeLine(
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settlements.removeManualLine(id, dto.reason, user.id);
  }

  @Post('settlements/:id/finalise')
  @RequirePermissions(PERMISSIONS.SETTLEMENT_MANAGE)
  finalise(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settlements.finalise(id, user.id);
  }

  @Get('deposits/pending-refunds')
  @RequirePermissions(PERMISSIONS.DEPOSIT_VIEW)
  pendingRefunds() {
    return this.settlements.pendingRefunds();
  }
}

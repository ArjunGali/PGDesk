import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AcType, PricingScope } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';
import { PricingService } from './pricing.service';

class CreatePricingRuleDto {
  @IsEnum(PricingScope) scope: PricingScope;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() roomId?: string;
  @IsOptional() @IsString() stayId?: string;
  @IsOptional() @Type(() => Number) @IsInt() capacity?: number;
  @IsOptional() @IsEnum(AcType) acType?: AcType;
  @IsOptional() @IsString() variant?: string;

  /** Monthly rent including food. */
  @IsNumberString() amountWithFood: string;

  @IsDateString() effectiveFrom: string;
  @IsOptional() @IsString() reason?: string;
}

class ResolveQueryDto {
  @IsOptional() @IsString() stayId?: string;
  @IsOptional() @IsString() roomId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @Type(() => Number) @IsInt() capacity?: number;
  @IsOptional() @IsEnum(AcType) acType?: AcType;
  @IsOptional() @IsString() variant?: string;
  @IsOptional() @IsString() foodIncluded?: string;
  @IsOptional() @IsDateString() on?: string;
}

@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
  ) {}

  @Get('rules')
  @RequirePermissions(PERMISSIONS.PRICING_VIEW)
  listRules(
    @Query('scope') scope?: PricingScope,
    @Query('branchId') branchId?: string,
    @Query('roomId') roomId?: string,
    @Query('stayId') stayId?: string,
    @Query('includeExpired') includeExpired?: string,
  ) {
    return this.pricing.listRules({
      scope,
      branchId,
      roomId,
      stayId,
      includeExpired: includeExpired === 'true',
    });
  }

  /** Preview which rule would apply — used by the pricing screen. */
  @Get('resolve')
  @RequirePermissions(PERMISSIONS.PRICING_VIEW)
  resolve(@Query() query: ResolveQueryDto) {
    return this.pricing.resolveRent({
      stayId: query.stayId,
      roomId: query.roomId,
      branchId: query.branchId,
      capacity: query.capacity,
      acType: query.acType,
      variant: query.variant,
      foodIncluded: query.foodIncluded !== 'false',
      on: query.on ? new Date(query.on) : new Date(),
    });
  }

  @Post('rules')
  @RequirePermissions(PERMISSIONS.PRICING_MANAGE)
  async createRule(
    @Body() dto: CreatePricingRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const rule = await this.pricing.createRule({
      ...dto,
      effectiveFrom: new Date(dto.effectiveFrom),
      createdById: user.id,
    });
    await this.audit.record({
      actorId: user.id,
      action: 'pricing.rule_create',
      entityType: 'PricingRule',
      entityId: rule.id,
      after: rule,
      reason: dto.reason,
    });
    return rule;
  }
}

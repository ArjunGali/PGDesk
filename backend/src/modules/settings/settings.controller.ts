import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SettingType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from './settings.service';

class UpdateSettingDto {
  @IsString()
  @IsNotEmpty()
  value: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

class CreateSettingDto {
  @IsString() @IsNotEmpty() key: string;
  @IsString() value: string;
  @IsEnum(SettingType) type: SettingType;
  @IsString() @IsNotEmpty() group: string;
  @IsString() @IsNotEmpty() label: string;
  @IsOptional() @IsString() description?: string;
}

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_VIEW)
  list(@Query('group') group?: string) {
    return this.settings.list(group);
  }

  @Get('groups')
  @RequirePermissions(PERMISSIONS.SETTINGS_VIEW)
  groups() {
    return this.settings.groups();
  }

  @Get(':key/history')
  @RequirePermissions(PERMISSIONS.SETTINGS_VIEW)
  history(@Param('key') key: string) {
    return this.settings.history(key);
  }

  @Patch(':key')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const before = await this.settings.getString(key).catch(() => null);
    await this.settings.set(key, dto.value, user.id, dto.reason);
    await this.audit.record({
      actorId: user.id,
      action: 'settings.update',
      entityType: 'AppSetting',
      entityId: key,
      before: { value: before },
      after: { value: dto.value },
      reason: dto.reason,
    });
    return { key, value: dto.value };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async create(
    @Body() dto: CreateSettingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const created = await this.settings.create(dto);
    await this.audit.record({
      actorId: user.id,
      action: 'settings.create',
      entityType: 'AppSetting',
      entityId: created.key,
      after: created,
    });
    return created;
  }

  @Delete(':key')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async remove(
    @Param('key') key: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.settings.remove(key);
    await this.audit.record({
      actorId: user.id,
      action: 'settings.delete',
      entityType: 'AppSetting',
      entityId: key,
    });
    return { ok: true };
  }
}

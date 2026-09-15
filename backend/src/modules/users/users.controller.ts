import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';
import { UsersService } from './users.service';

class CreateProfileDto {
  @IsString() @IsNotEmpty() username: string;
  /** Optional: leave blank and the person chooses their PIN on first use. */
  @IsOptional() @Matches(/^\d{4,8}$/, { message: 'A PIN must be 4 to 8 digits' })
  pin?: string;
  @IsString() @IsNotEmpty() fullName: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsArray() roleIds?: string[];
  @IsOptional() @IsArray() branchIds?: string[];
  @IsOptional() @IsString() avatarColor?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

class UpdateProfileDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsArray() roleIds?: string[];
  @IsOptional() @IsArray() branchIds?: string[];
  @IsOptional() @IsString() avatarColor?: string;
  @IsOptional() @IsBoolean() showOnProfileScreen?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

class CreateRoleDto {
  @IsString() @IsNotEmpty() key: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() permissionKeys: string[];
}

class UpdateRolePermissionsDto {
  @IsArray() permissionKeys: string[];
}

@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get('users')
  @RequirePermissions(PERMISSIONS.USER_VIEW)
  list() {
    return this.users.list();
  }

  @Get('users/:id')
  @RequirePermissions(PERMISSIONS.USER_VIEW)
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Post('users')
  @RequirePermissions(PERMISSIONS.PROFILE_MANAGE)
  async create(
    @Body() dto: CreateProfileDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const user = await this.users.create(dto);
    await this.audit.record({
      actorId: actor.id,
      action: 'user.create',
      entityType: 'User',
      entityId: user.id,
      after: { username: user.username, fullName: user.fullName },
    });
    return user;
  }

  @Patch('users/:id')
  @RequirePermissions(PERMISSIONS.PROFILE_MANAGE)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProfileDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const before = await this.users.findOne(id);
    const user = await this.users.update(id, dto);
    await this.audit.record({
      actorId: actor.id,
      action: 'user.update',
      entityType: 'User',
      entityId: id,
      before,
      after: dto,
    });
    return user;
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.USER_VIEW)
  listRoles() {
    return this.users.listRoles();
  }

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.USER_VIEW)
  listPermissions() {
    return this.users.listPermissions();
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.PROFILE_MANAGE)
  async createRole(
    @Body() dto: CreateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const role = await this.users.createRole(dto);
    await this.audit.record({
      actorId: actor.id,
      action: 'role.create',
      entityType: 'Role',
      entityId: role.id,
      after: dto,
    });
    return role;
  }

  @Patch('roles/:id/permissions')
  @RequirePermissions(PERMISSIONS.PROFILE_MANAGE)
  async updateRolePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateRolePermissionsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const role = await this.users.updateRolePermissions(id, dto.permissionKeys);
    await this.audit.record({
      actorId: actor.id,
      action: 'role.permissions_update',
      entityType: 'Role',
      entityId: id,
      after: dto,
    });
    return role;
  }
}

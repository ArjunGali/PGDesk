import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';
import { UsersService } from './users.service';

class CreateUserDto {
  @IsString() @IsNotEmpty() username: string;
  @IsString() @MinLength(8) password: string;
  @IsString() @IsNotEmpty() fullName: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsArray() roleIds?: string[];
  @IsOptional() @IsArray() branchIds?: string[];
}

class UpdateUserDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsArray() roleIds?: string[];
  @IsOptional() @IsArray() branchIds?: string[];
  @IsOptional() @IsString() @MinLength(8) password?: string;
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
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  async create(
    @Body() dto: CreateUserDto,
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
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
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
      after: { ...dto, password: dto.password ? '[changed]' : undefined },
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
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
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
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
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

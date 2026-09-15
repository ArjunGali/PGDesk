import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PERMISSION_CATALOGUE } from '../../common/permissions';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  /** Keeps the permission table in step with the shipped catalogue. */
  async onModuleInit(): Promise<void> {
    await this.prisma.permission.createMany({
      data: PERMISSION_CATALOGUE.map((p) => ({
        key: p.key,
        group: p.group,
        description: p.description,
      })),
      skipDuplicates: true,
    });
  }

  async findAuthenticated(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: UserStatus.ACTIVE },
      include: {
        roles: {
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
        branchScopes: true,
      },
    });
    if (!user) return null;

    const permissions = new Set<string>();
    for (const userRole of user.roles) {
      for (const rp of userRole.role.permissions) {
        permissions.add(rp.permission.key);
      }
    }

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      isOwner: user.isOwner,
      permissions: [...permissions],
      branchIds: user.branchScopes.map((s) => s.branchId),
    };
  }

  async list() {
    return this.prisma.user.findMany({
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        mobile: true,
        status: true,
        isOwner: true,
        lastLoginAt: true,
        createdAt: true,
        roles: { include: { role: { select: { id: true, key: true, name: true } } } },
        branchScopes: { select: { branchId: true } },
      },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        mobile: true,
        status: true,
        isOwner: true,
        lastLoginAt: true,
        createdAt: true,
        roles: { include: { role: true } },
        branchScopes: { select: { branchId: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(input: {
    username: string;
    password: string;
    fullName: string;
    email?: string;
    mobile?: string;
    roleIds?: string[];
    branchIds?: string[];
  }) {
    if (input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    return this.prisma.user.create({
      data: {
        username: input.username.trim().toLowerCase(),
        passwordHash: await bcrypt.hash(input.password, 12),
        fullName: input.fullName,
        email: input.email || null,
        mobile: input.mobile || null,
        roles: input.roleIds?.length
          ? { create: input.roleIds.map((roleId) => ({ roleId })) }
          : undefined,
        branchScopes: input.branchIds?.length
          ? { create: input.branchIds.map((branchId) => ({ branchId })) }
          : undefined,
      },
      select: { id: true, username: true, fullName: true },
    });
  }

  async update(
    id: string,
    input: {
      fullName?: string;
      email?: string | null;
      mobile?: string | null;
      status?: UserStatus;
      roleIds?: string[];
      branchIds?: string[];
      password?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    if (user.isOwner && input.status === UserStatus.DISABLED) {
      const otherOwners = await this.prisma.user.count({
        where: { isOwner: true, status: UserStatus.ACTIVE, id: { not: id } },
      });
      if (otherOwners === 0) {
        throw new BadRequestException(
          'This is the only active owner account and cannot be disabled',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        if (input.roleIds.length) {
          await tx.userRole.createMany({
            data: input.roleIds.map((roleId) => ({ userId: id, roleId })),
          });
        }
      }
      if (input.branchIds) {
        await tx.userBranchScope.deleteMany({ where: { userId: id } });
        if (input.branchIds.length) {
          await tx.userBranchScope.createMany({
            data: input.branchIds.map((branchId) => ({ userId: id, branchId })),
          });
        }
      }
      return tx.user.update({
        where: { id },
        data: {
          fullName: input.fullName,
          email: input.email,
          mobile: input.mobile,
          status: input.status,
          passwordHash: input.password
            ? await bcrypt.hash(input.password, 12)
            : undefined,
        },
        select: { id: true, username: true, fullName: true, status: true },
      });
    });
  }

  // --- Roles -------------------------------------------------------------

  async listRoles() {
    return this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });
  }

  async createRole(input: {
    key: string;
    name: string;
    description?: string;
    permissionKeys: string[];
  }) {
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: input.permissionKeys } },
    });
    return this.prisma.role.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description,
        permissions: {
          create: permissions.map((p) => ({ permissionId: p.id })),
        },
      },
    });
  }

  async updateRolePermissions(roleId: string, permissionKeys: string[]) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
    });
    return this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId, permissionId: p.id })),
      });
      return tx.role.findUnique({
        where: { id: roleId },
        include: { permissions: { include: { permission: true } } },
      });
    });
  }
}

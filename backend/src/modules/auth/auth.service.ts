import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(username: string, password: string, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    });

    // Same message and comparable timing whether the user exists or not.
    const hash = user?.passwordHash ?? (await bcrypt.hash('unused', 10));
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok || user.status !== UserStatus.ACTIVE) {
      await this.audit.record({
        actorId: user?.id,
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user?.id,
        ipAddress: ip,
      });
      throw new UnauthorizedException('Incorrect username or password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ipAddress: ip,
    });

    const tokens = await this.issueTokens(user.id, user.username);
    const profile = await this.users.findAuthenticated(user.id);
    return { ...tokens, user: profile };
  }

  async refresh(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt < new Date() ||
      stored.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException('Please sign in again');
    }

    // Rotate: the presented token is spent the moment it is used.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(stored.userId, stored.user.username);
    const profile = await this.users.findAuthenticated(stored.userId);
    return { ...tokens, user: profile };
  }

  async logout(refreshToken?: string, userId?: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return;
    }
    if (userId) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, 12) },
    });
    // Signing out other devices is the point of a password change.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId: userId,
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: userId,
    });
  }

  private async issueTokens(
    userId: string,
    username: string,
  ): Promise<AuthTokens> {
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN', '12h');
    const accessToken = await this.jwt.signAsync(
      { sub: userId, username },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn,
      },
    );

    const refreshToken = randomBytes(48).toString('hex');
    const days = parseDays(
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d'),
    );
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken, expiresIn };
  }
}

/** Refresh tokens are stored hashed: a database leak must not grant sessions. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseDays(value: string): number {
  const match = /^(\d+)\s*d$/i.exec(value.trim());
  return match ? Number(match[1]) : 30;
}

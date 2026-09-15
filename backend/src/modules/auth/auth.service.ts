import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assertPinFormat } from '../../common/utils/pin';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

/** A profile as it appears on the "Who's using the app?" screen. */
export interface ProfileSummary {
  id: string;
  fullName: string;
  roleNames: string[];
  isOwner: boolean;
  avatarPath: string | null;
  avatarColor: string | null;
  /** False when the profile has never set a PIN; the app prompts to create one. */
  hasPin: boolean;
  /** Set while the profile is locked out after too many wrong PINs. */
  lockedUntil: Date | null;
}

/**
 * How many wrong PINs before a profile is held for a while.
 *
 * A 4-digit PIN has 10,000 combinations, which is nothing to a script but a
 * lot to a person tapping a keypad. Throttling is what makes a short PIN
 * acceptable at all, so the limit and the delay are deliberate and fixed
 * rather than configurable — an owner should not be able to weaken it by
 * accident.
 */
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The first screen. Public, because there is nobody signed in yet — it
   * deliberately exposes only what a profile picker needs, never a PIN hash,
   * a permission list or a contact detail.
   */
  async listProfiles(): Promise<ProfileSummary[]> {
    const users = await this.prisma.user.findMany({
      where: { status: UserStatus.ACTIVE, showOnProfileScreen: true },
      orderBy: [{ sortOrder: 'asc' }, { fullName: 'asc' }],
      select: {
        id: true,
        fullName: true,
        isOwner: true,
        avatarPath: true,
        avatarColor: true,
        pinHash: true,
        lockedUntil: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });

    const now = new Date();
    return users.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      roleNames: user.roles.map((r) => r.role.name),
      isOwner: user.isOwner,
      avatarPath: user.avatarPath,
      avatarColor: user.avatarColor,
      hasPin: user.pinHash !== null,
      lockedUntil:
        user.lockedUntil && user.lockedUntil > now ? user.lockedUntil : null,
    }));
  }

  /**
   * Unlocks a profile with its app PIN.
   *
   * This is app-level authentication: no device biometrics, no Android
   * fingerprint API. The PIN is verified here, on the server, so a tampered
   * client cannot simply skip the screen — the tokens only come from a correct
   * PIN.
   */
  async unlockProfile(userId: string, pin: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('That profile is not available');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const seconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      throw new ForbiddenException(
        `Too many incorrect attempts. Try again in ${formatWait(seconds)}.`,
      );
    }

    if (!user.pinHash) {
      throw new BadRequestException(
        'This profile has no PIN yet. Ask the owner to set one.',
      );
    }

    const ok = await bcrypt.compare(pin, user.pinHash);
    if (!ok) {
      const attempts = user.failedPinAttempts + 1;
      const locked = attempts >= MAX_PIN_ATTEMPTS;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedPinAttempts: locked ? 0 : attempts,
          lockedUntil: locked
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
            : null,
        },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'auth.pin_failed',
        entityType: 'User',
        entityId: user.id,
        after: { attempts, lockedOut: locked },
        ipAddress: ip,
      });

      throw new UnauthorizedException(
        locked
          ? `Incorrect PIN. This profile is locked for ${LOCKOUT_MINUTES} minutes.`
          : `Incorrect PIN. ${MAX_PIN_ATTEMPTS - attempts} attempt${
              MAX_PIN_ATTEMPTS - attempts === 1 ? '' : 's'
            } left.`,
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedPinAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'auth.unlock',
      entityType: 'User',
      entityId: user.id,
      ipAddress: ip,
    });

    const tokens = await this.issueTokens(user.id, user.username);
    const profile = await this.users.findAuthenticated(user.id);
    return { ...tokens, user: profile };
  }

  /** Sets a PIN on a profile that has none — the first-run path. */
  async setInitialPin(userId: string, pin: string) {
    assertPinFormat(pin);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new NotFoundException('Profile not found');
    }
    if (user.pinHash) {
      throw new BadRequestException(
        'This profile already has a PIN. Change it from Settings instead.',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: await bcrypt.hash(pin, 10), failedPinAttempts: 0 },
    });
    await this.audit.record({
      actorId: userId,
      action: 'auth.pin_set',
      entityType: 'User',
      entityId: userId,
    });

    return this.unlockProfile(userId, pin);
  }

  /** Changes your own PIN; the current one is required. */
  async changePin(userId: string, currentPin: string, newPin: string) {
    assertPinFormat(newPin);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (user.pinHash && !(await bcrypt.compare(currentPin, user.pinHash))) {
      throw new UnauthorizedException('Your current PIN is incorrect');
    }
    if (user.pinHash && (await bcrypt.compare(newPin, user.pinHash))) {
      throw new BadRequestException('The new PIN must be different');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: await bcrypt.hash(newPin, 10), failedPinAttempts: 0, lockedUntil: null },
    });
    // Changing a PIN signs the profile out everywhere else.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId: userId,
      action: 'auth.pin_changed',
      entityType: 'User',
      entityId: userId,
    });
    return { ok: true };
  }

  /**
   * Resets another profile's PIN. Restricted to the manage-profiles permission
   * at the controller, because it hands someone else's access away.
   */
  async resetPin(targetUserId: string, newPin: string, actorId: string) {
    assertPinFormat(newPin);
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('Profile not found');

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        pinHash: await bcrypt.hash(newPin, 10),
        failedPinAttempts: 0,
        lockedUntil: null,
      },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId,
      action: 'auth.pin_reset',
      entityType: 'User',
      entityId: targetUserId,
      reason: 'PIN reset by an administrator',
    });
    return { ok: true };
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
      throw new UnauthorizedException('Please choose your profile again');
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

  private async issueTokens(
    userId: string,
    username: string,
  ): Promise<AuthTokens> {
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN', '12h');
    const accessToken = await this.jwt.signAsync(
      { sub: userId, username },
      { secret: this.config.getOrThrow<string>('JWT_SECRET'), expiresIn },
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

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

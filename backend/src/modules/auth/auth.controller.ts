import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { AuthService } from './auth.service';

const PIN_PATTERN = /^\d{4,8}$/;

class UnlockDto {
  @IsString() @IsNotEmpty() profileId: string;
  @Matches(PIN_PATTERN, { message: 'A PIN must be 4 to 8 digits' })
  pin: string;
}

class SetPinDto {
  @IsString() @IsNotEmpty() profileId: string;
  @Matches(PIN_PATTERN, { message: 'A PIN must be 4 to 8 digits' })
  pin: string;
}

class ChangePinDto {
  @IsString() @IsNotEmpty() currentPin: string;
  @Matches(PIN_PATTERN, { message: 'A PIN must be 4 to 8 digits' })
  newPin: string;
}

class ResetPinDto {
  @Matches(PIN_PATTERN, { message: 'A PIN must be 4 to 8 digits' })
  newPin: string;
}

class RefreshDto {
  @IsString() @IsNotEmpty() refreshToken: string;
}

/**
 * There is no login endpoint and no password.
 *
 * The app opens on a profile list, the chosen profile is unlocked with an
 * app-managed PIN, and that is the whole of authentication.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** The first screen: who is using the app? */
  @Public()
  @Get('profiles')
  listProfiles() {
    return this.auth.listProfiles();
  }

  @Public()
  @Post('unlock')
  unlock(@Body() dto: UnlockDto, @Req() req: Request) {
    return this.auth.unlockProfile(dto.profileId, dto.pin, req.ip);
  }

  /** First run for a profile that has not chosen a PIN yet. */
  @Public()
  @Post('set-pin')
  setInitialPin(@Body() dto: SetPinDto) {
    return this.auth.setInitialPin(dto.profileId, dto.pin);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  async logout(
    @Body() dto: Partial<RefreshDto>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.auth.logout(dto.refreshToken, user.id);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Post('change-pin')
  changePin(
    @Body() dto: ChangePinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auth.changePin(user.id, dto.currentPin, dto.newPin);
  }

  /** Handing someone else access needs the manage-profiles permission. */
  @Post('profiles/:id/reset-pin')
  @RequirePermissions(PERMISSIONS.PROFILE_MANAGE)
  resetPin(
    @Param('id') id: string,
    @Body() dto: ResetPinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auth.resetPin(id, dto.newPin, user.id);
  }
}

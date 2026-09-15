import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '../permissions';

export const PERMISSIONS_KEY = 'requiredPermissions';

/** Route needs every listed permission (owners bypass the check). */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

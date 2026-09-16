import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { PERMISSIONS, type PermissionKey } from '../permissions';
import { PermissionsGuard } from './permissions.guard';

/**
 * Hiding a button is not a security control. Everything the UI refuses has to
 * be refused again here, because the API is reachable directly — from a
 * browser, from curl, from a second copy of the app on someone else's phone.
 *
 * These tests do two things: check the guard itself decides correctly, and
 * walk every controller in the codebase to make sure no route was left
 * unguarded by accident.
 */

function contextFor(user: AuthenticatedUser | undefined) {
  const handler = () => undefined;
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function reflectorReturning(values: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => values[key],
  } as unknown as Reflector;
}

function userWith(permissions: PermissionKey[], isOwner = false): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Test',
    roleKey: 'staff',
    isOwner,
    permissions,
    branchIds: [],
  } as unknown as AuthenticatedUser;
}

describe('PermissionsGuard', () => {
  it('lets a public route through with no user at all', () => {
    const guard = new PermissionsGuard(reflectorReturning({ [IS_PUBLIC_KEY]: true }));
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('refuses a guarded route when there is no authenticated user', () => {
    const guard = new PermissionsGuard(
      reflectorReturning({ [PERMISSIONS_KEY]: [PERMISSIONS.TENANT_VIEW] }),
    );
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });

  it('refuses a user who is missing the permission', () => {
    const guard = new PermissionsGuard(
      reflectorReturning({ [PERMISSIONS_KEY]: [PERMISSIONS.TENANT_VIEW_SENSITIVE] }),
    );
    expect(() =>
      guard.canActivate(contextFor(userWith([PERMISSIONS.TENANT_VIEW]))),
    ).toThrow(/tenant.view_sensitive/);
  });

  it('requires every listed permission, not just one of them', () => {
    const guard = new PermissionsGuard(
      reflectorReturning({
        [PERMISSIONS_KEY]: [PERMISSIONS.TENANT_VIEW, PERMISSIONS.EXPORT_RUN],
      }),
    );
    expect(() =>
      guard.canActivate(contextFor(userWith([PERMISSIONS.TENANT_VIEW]))),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(
        contextFor(userWith([PERMISSIONS.TENANT_VIEW, PERMISSIONS.EXPORT_RUN])),
      ),
    ).toBe(true);
  });

  it('lets the owner through whatever the route asks for', () => {
    const guard = new PermissionsGuard(
      reflectorReturning({ [PERMISSIONS_KEY]: [PERMISSIONS.TENANT_ERASE] }),
    );
    expect(guard.canActivate(contextFor(userWith([], true)))).toBe(true);
  });

  it('does not let a non-owner inherit anything from the owner bypass', () => {
    const guard = new PermissionsGuard(
      reflectorReturning({ [PERMISSIONS_KEY]: [PERMISSIONS.TENANT_ERASE] }),
    );
    expect(() => guard.canActivate(contextFor(userWith([], false)))).toThrow(
      ForbiddenException,
    );
  });
});

/**
 * The only routes allowed to be reachable without a token. Everything needed
 * to get *to* the PIN screen, and nothing else — adding to this list should
 * take an argument.
 */
const EXPECTED_PUBLIC_ROUTES = [
  'HealthController.check',
  'AuthController.listProfiles',
  'AuthController.unlock',
  'AuthController.setInitialPin',
  'AuthController.refresh',
];

/**
 * Routes that need a valid token but no permission, because they act on the
 * caller's own account and take no identifier from the request. Changing
 * someone *else's* PIN is a different route and needs profile.manage.
 */
const EXPECTED_SELF_SERVICE_ROUTES = [
  'AuthController.me',
  'AuthController.logout',
  'AuthController.changePin',
];

describe('every route is guarded', () => {
  const controllers = loadControllers();

  it('finds the controllers to check', () => {
    // A silent zero here would make every assertion below vacuously true.
    expect(controllers.length).toBeGreaterThan(10);
  });

  it('declares permissions on every route that is not explicitly public', () => {
    const unguarded: string[] = [];
    const publicRoutes: string[] = [];

    for (const { name, cls } of controllers) {
      for (const method of routeMethods(cls)) {
        const handler = cls.prototype[method];
        const label = `${name}.${method}`;
        if (Reflect.getMetadata(IS_PUBLIC_KEY, handler)) {
          publicRoutes.push(label);
          continue;
        }
        const required = Reflect.getMetadata(PERMISSIONS_KEY, handler);
        if (!Array.isArray(required) || required.length === 0) {
          // Not public, so JwtAuthGuard has already demanded a token. These
          // are allowed to ask for nothing further; everything else is a hole.
          if (!EXPECTED_SELF_SERVICE_ROUTES.includes(label)) unguarded.push(label);
        }
      }
    }

    expect(unguarded).toEqual([]);
    expect(publicRoutes.sort()).toEqual([...EXPECTED_PUBLIC_ROUTES].sort());
  });

  it('asks for the sensitive-data permission on the export that carries a full Aadhaar', () => {
    const controller = controllers.find((c) => c.name === 'RetentionController');
    expect(controller).toBeDefined();
    const required = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller!.cls.prototype.export,
    );
    // The archive is the readable copy taken before erasure. A role the UI
    // shows a masked number to must not be able to read the real one out of
    // the spreadsheet.
    expect(required).toContain(PERMISSIONS.TENANT_VIEW_SENSITIVE);
  });

  it('only names permissions that actually exist', () => {
    const known = new Set<string>(Object.values(PERMISSIONS));
    const unknown: string[] = [];

    for (const { name, cls } of controllers) {
      for (const method of routeMethods(cls)) {
        const required = Reflect.getMetadata(PERMISSIONS_KEY, cls.prototype[method]);
        if (!Array.isArray(required)) continue;
        for (const permission of required) {
          if (!known.has(permission)) unknown.push(`${name}.${method}: ${permission}`);
        }
      }
    }

    expect(unknown).toEqual([]);
  });
});

/** Every exported class from every *.controller.ts under src/modules. */
function loadControllers(): Array<{ name: string; cls: new (...args: never[]) => object }> {
  const found: Array<{ name: string; cls: new (...args: never[]) => object }> = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.endsWith('.controller.ts')) continue;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const module = require(path) as Record<string, unknown>;
      for (const [name, value] of Object.entries(module)) {
        if (typeof value === 'function' && name.endsWith('Controller')) {
          found.push({ name, cls: value as new (...args: never[]) => object });
        }
      }
    }
  };

  walk(join(__dirname, '..', '..', 'modules'));
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Prototype methods that Nest has registered as HTTP routes. */
function routeMethods(cls: new (...args: never[]) => object): string[] {
  return Object.getOwnPropertyNames(cls.prototype).filter((method) => {
    if (method === 'constructor') return false;
    const handler = (cls.prototype as Record<string, unknown>)[method];
    if (typeof handler !== 'function') return false;
    // Nest stores the HTTP verb on every route handler and nothing else.
    return Reflect.hasMetadata('method', handler);
  });
}

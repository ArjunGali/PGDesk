import { UserStatus } from '@prisma/client';
import type { TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from '../modules/auth/auth.service';
import {
  createTestModule,
  resetData,
  setUpTestDatabase,
  tearDownTestDatabase,
} from './integration-harness';

/**
 * A four-digit PIN is only a reasonable credential because of what surrounds
 * it: it is hashed, never logged, the guessable ones are refused, and guessing
 * is throttled. These tests hold those four things in place.
 */
describe('PIN and session security (integration)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let auth: AuthService;

  const PIN = '7392';

  beforeAll(async () => {
    await setUpTestDatabase();
    module = await createTestModule();
    await module.init();
    prisma = module.get(PrismaService);
    auth = module.get(AuthService);
  }, 120_000);

  afterAll(async () => {
    await module?.close();
    await tearDownTestDatabase();
  });

  beforeEach(async () => {
    await resetData(prisma);
  });

  async function makeProfile(
    overrides: { pin?: string | null; fullName?: string } = {},
  ) {
    const pin = overrides.pin === undefined ? PIN : overrides.pin;
    return prisma.user.create({
      data: {
        username: `user_${Math.random().toString(36).slice(2, 10)}`,
        fullName: overrides.fullName ?? 'Test Profile',
        status: UserStatus.ACTIVE,
        pinHash: pin === null ? null : await bcrypt.hash(pin, 10),
      },
    });
  }

  // --- Hashing -----------------------------------------------------------

  it('stores a PIN as a bcrypt hash, never as the digits', async () => {
    const user = await makeProfile({ pin: null });
    await auth.setInitialPin(user.id, PIN);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.pinHash).not.toBeNull();
    expect(stored.pinHash).not.toContain(PIN);
    expect(stored.pinHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(await bcrypt.compare(PIN, stored.pinHash!)).toBe(true);
  });

  it('leaves no column in the row containing the PIN in readable form', async () => {
    const user = await makeProfile({ pin: null });
    await auth.setInitialPin(user.id, PIN);

    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "User" WHERE id = '${user.id}'`,
    );
    const asText = JSON.stringify(rows);
    expect(rows).toHaveLength(1);
    expect(asText).not.toContain(PIN);
  });

  it('hashes two identical PINs differently, so the hash does not identify the PIN', async () => {
    const a = await makeProfile({ pin: null, fullName: 'A' });
    const b = await makeProfile({ pin: null, fullName: 'B' });
    await auth.setInitialPin(a.id, PIN);
    await auth.setInitialPin(b.id, PIN);

    const [first, second] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: a.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: b.id } }),
    ]);
    expect(first.pinHash).not.toEqual(second.pinHash);
  });

  it('re-hashes on change and refuses the wrong current PIN', async () => {
    const user = await makeProfile();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    await expect(auth.changePin(user.id, '1097', '8461')).rejects.toThrow(
      /current PIN is incorrect/i,
    );

    await auth.changePin(user.id, PIN, '8461');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pinHash).not.toEqual(before.pinHash);
    expect(await bcrypt.compare('8461', after.pinHash!)).toBe(true);
    expect(await bcrypt.compare(PIN, after.pinHash!)).toBe(false);
  });

  // --- Weak PINs ---------------------------------------------------------

  it.each(['1234', '0000', '9876', '111', 'abcd'])(
    'refuses %s when setting a PIN',
    async (weak) => {
      const user = await makeProfile({ pin: null });
      await expect(auth.setInitialPin(user.id, weak)).rejects.toThrow();
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.pinHash).toBeNull();
    },
  );

  // --- Throttling --------------------------------------------------------

  it('counts wrong attempts and locks the profile after five', async () => {
    const user = await makeProfile();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(auth.unlockProfile(user.id, '1097')).rejects.toThrow(
        /Incorrect PIN/,
      );
      const during = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(during.failedPinAttempts).toBe(attempt);
      expect(during.lockedUntil).toBeNull();
    }

    await expect(auth.unlockProfile(user.id, '1097')).rejects.toThrow(/locked/i);
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil).not.toBeNull();
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses even the correct PIN while the profile is locked', async () => {
    const user = await makeProfile();
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() + 60_000) },
    });

    await expect(auth.unlockProfile(user.id, PIN)).rejects.toThrow(
      /Too many incorrect attempts/,
    );
  });

  it('clears the counter once the right PIN is entered', async () => {
    const user = await makeProfile();
    await expect(auth.unlockProfile(user.id, '1097')).rejects.toThrow();

    const result = await auth.unlockProfile(user.id, PIN);
    expect(result.accessToken).toEqual(expect.any(String));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failedPinAttempts).toBe(0);
    expect(after.lockedUntil).toBeNull();
    expect(after.lastLoginAt).not.toBeNull();
  });

  it('issues no token for a wrong PIN', async () => {
    const user = await makeProfile();
    await expect(auth.unlockProfile(user.id, '1097')).rejects.toThrow();
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  // --- What the profile list gives away ----------------------------------

  it('never returns a PIN hash to the profile picker', async () => {
    await makeProfile({ fullName: 'Has a PIN' });
    await makeProfile({ pin: null, fullName: 'No PIN yet' });

    const profiles = await auth.listProfiles();
    expect(profiles).toHaveLength(2);
    expect(JSON.stringify(profiles)).not.toContain('$2');
    for (const profile of profiles) {
      expect(profile).not.toHaveProperty('pinHash');
      expect(profile).not.toHaveProperty('username');
      expect(typeof profile.hasPin).toBe('boolean');
    }
  });

  // --- Sessions ----------------------------------------------------------

  it('stores refresh tokens hashed, so a copied database grants no sessions', async () => {
    const user = await makeProfile();
    const { refreshToken } = await auth.unlockProfile(user.id, PIN);

    const stored = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).not.toEqual(refreshToken);
    expect(refreshToken.length).toBeGreaterThan(20);
    expect(JSON.stringify(stored)).not.toContain(refreshToken);
  });

  it('revokes every session when the PIN changes', async () => {
    const user = await makeProfile();
    await auth.unlockProfile(user.id, PIN);
    await auth.changePin(user.id, PIN, '8461');

    const live = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(live).toBe(0);
  });

  it('records the unlock in the audit trail without the PIN', async () => {
    const user = await makeProfile();
    await auth.unlockProfile(user.id, PIN);

    const entries = await prisma.auditLog.findMany({ where: { actorId: user.id } });
    expect(entries.some((e) => e.action === 'auth.unlock')).toBe(true);
    expect(JSON.stringify(entries)).not.toContain(PIN);
  });
});

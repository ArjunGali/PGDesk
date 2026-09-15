/**
 * Initial data for a fresh install.
 *
 * Everything here is DATA, not configuration baked into the application:
 * branches, floors, rooms, prices, the E.B. rate, the common charge, the food
 * difference and the notice period are all rows the owner can change later
 * from Settings. The seed just gives them a working starting point that
 * matches the two branches described in the specification.
 *
 * Re-running is safe: every write is an upsert or is skipped when the record
 * already exists. It will never overwrite a value the owner has since changed.
 */
import { AcType, PrismaClient, PricingScope, SettingType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  DEFAULT_ROLES,
  PERMISSION_CATALOGUE,
} from '../src/common/permissions';
import { SETTING_DEFINITIONS } from '../src/modules/settings/setting-keys';

const prisma = new PrismaClient();

/**
 * Initial prices are backdated deliberately.
 *
 * During onboarding the owner enters tenants who checked in months or years
 * ago, and every bill for those stays has to resolve a rate for its own dates.
 * A rule dated "today" would leave all of that history unpriced. When prices
 * actually change, the owner adds a new dated rule from Settings → Pricing;
 * this one stays as the opening rate.
 */
const EFFECTIVE_FROM = new Date(2020, 0, 1);

async function main(): Promise<void> {
  console.log('Seeding PG Management…\n');

  await seedSettings();
  const roleIds = await seedPermissionsAndRoles();
  await seedOwner(roleIds.owner);
  await seedFloorTypes();
  await seedDocumentTypes();
  await seedExpenseCategories();
  await seedCustomFields();

  const ekkatuthangal = await seedEkkatuthangal();
  const alandur = await seedAlandur();

  console.log('\nSeed complete.');
  console.log(`  Ekkatuthangal: ${ekkatuthangal} room(s) created`);
  console.log(`  Alandur: ${alandur} floor(s) created (rooms to be added in the app)`);
  console.log(
    '\nSign in with the owner account, then review Settings → Pricing, E.B. and Charges.',
  );
}

// ---------------------------------------------------------------------------

async function seedSettings(): Promise<void> {
  let created = 0;
  for (const definition of SETTING_DEFINITIONS) {
    const existing = await prisma.appSetting.findUnique({
      where: { key: definition.key },
    });
    if (existing) continue;
    await prisma.appSetting.create({
      data: {
        key: definition.key,
        value: definition.defaultValue,
        type: definition.type,
        group: definition.group,
        label: definition.label,
        description: definition.description,
        isSystem: definition.isSystem,
      },
    });
    created += 1;
  }
  console.log(`Settings: ${created} created, ${SETTING_DEFINITIONS.length - created} already present`);
}

async function seedPermissionsAndRoles(): Promise<Record<string, string>> {
  await prisma.permission.createMany({
    data: PERMISSION_CATALOGUE.map((p) => ({
      key: p.key,
      group: p.group,
      description: p.description,
    })),
    skipDuplicates: true,
  });

  const allPermissions = await prisma.permission.findMany();
  const byKey = new Map(allPermissions.map((p) => [p.key, p.id]));
  const roleIds: Record<string, string> = {};

  for (const definition of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { key: definition.key },
      create: {
        key: definition.key,
        name: definition.name,
        description: definition.description,
        isSystem: true,
      },
      update: { name: definition.name, description: definition.description },
    });
    roleIds[definition.key] = role.id;

    const permissionKeys =
      definition.permissions === 'ALL'
        ? allPermissions.map((p) => p.key)
        : definition.permissions;

    await prisma.rolePermission.createMany({
      data: permissionKeys
        .map((key) => byKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  console.log(
    `Permissions: ${allPermissions.length} · Roles: ${DEFAULT_ROLES.map((r) => r.name).join(', ')}`,
  );
  return roleIds;
}

async function seedOwner(ownerRoleId: string): Promise<void> {
  const username = (process.env.SEED_OWNER_USERNAME ?? 'owner').toLowerCase();
  const password = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe@123';

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`Owner account: "${username}" already exists, left unchanged`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      username,
      fullName: 'Owner',
      passwordHash: await bcrypt.hash(password, 12),
      isOwner: true,
      roles: { create: [{ roleId: ownerRoleId }] },
    },
  });

  console.log(`Owner account: "${user.username}" created`);
  if (!process.env.SEED_OWNER_PASSWORD) {
    console.log(
      '  !! Using the default password "ChangeMe@123" — change it immediately after signing in.',
    );
  }
}

async function seedFloorTypes(): Promise<void> {
  const types = [
    { key: 'basement', name: 'Basement', sortOrder: -1 },
    { key: 'ground', name: 'Ground Floor', sortOrder: 0 },
    { key: 'first', name: 'First Floor', sortOrder: 1 },
    { key: 'second', name: 'Second Floor', sortOrder: 2 },
    { key: 'third', name: 'Third Floor', sortOrder: 3 },
    { key: 'terrace', name: 'Terrace', sortOrder: 90 },
  ];
  for (const type of types) {
    await prisma.floorType.upsert({
      where: { key: type.key },
      create: { ...type, isSystem: true },
      update: {},
    });
  }
  console.log(`Floor types: ${types.length}`);
}

async function seedDocumentTypes(): Promise<void> {
  const types = [
    { key: 'aadhaar', name: 'Aadhaar', required: true, sortOrder: 0 },
    { key: 'office_id', name: 'Office ID', required: false, sortOrder: 1 },
    { key: 'offer_letter', name: 'Offer Letter', required: false, sortOrder: 2 },
    { key: 'signature', name: 'Signature', required: true, sortOrder: 3 },
    { key: 'photo', name: 'Photograph', required: false, sortOrder: 4 },
    { key: 'other', name: 'Other', required: false, sortOrder: 90 },
  ];
  for (const type of types) {
    await prisma.documentType.upsert({
      where: { key: type.key },
      create: type,
      update: {},
    });
  }
  console.log(`Document types: ${types.length}`);
}

async function seedExpenseCategories(): Promise<void> {
  const categories = [
    { key: 'groceries', name: 'Groceries & Food', sortOrder: 0 },
    { key: 'electricity', name: 'Electricity Bill', sortOrder: 1 },
    { key: 'water', name: 'Water', sortOrder: 2 },
    { key: 'maintenance', name: 'Maintenance & Repairs', sortOrder: 3 },
    { key: 'salaries', name: 'Staff Salaries', sortOrder: 4 },
    { key: 'internet', name: 'Internet & Wi-Fi', sortOrder: 5 },
    { key: 'rent', name: 'Building Rent', sortOrder: 6 },
    { key: 'cleaning', name: 'Cleaning & Housekeeping', sortOrder: 7 },
    { key: 'other', name: 'Other', sortOrder: 90 },
  ];
  for (const category of categories) {
    await prisma.expenseCategory.upsert({
      where: { key: category.key },
      create: category,
      update: {},
    });
  }
  console.log(`Expense categories: ${categories.length}`);
}

/** Example custom fields — the owner adds their own without a migration. */
async function seedCustomFields(): Promise<void> {
  const fields = [
    { key: 'college_name', label: 'College Name', sortOrder: 0 },
    { key: 'parent_name', label: 'Parent / Guardian Name', sortOrder: 1 },
    { key: 'vehicle_number', label: 'Vehicle Number', sortOrder: 2 },
  ];
  for (const field of fields) {
    await prisma.customFieldDefinition.upsert({
      where: { key: field.key },
      create: field,
      update: {},
    });
  }
  console.log(`Custom tenant fields: ${fields.length} example(s)`);
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

interface RoomSpec {
  name: string;
  capacity: number;
  acType: AcType;
  variant?: string;
}

async function seedEkkatuthangal(): Promise<number> {
  const branch = await prisma.branch.upsert({
    where: { name: 'Ekkatuthangal' },
    create: { name: 'Ekkatuthangal', code: 'EKK', sortOrder: 0 },
    update: {},
  });

  // Ground: 1 x 6 sharing, 1 x 5 sharing, 2 x 3 sharing, 1 x 1 sharing
  // First:  1 x 5 sharing, 1 x 4 sharing, 1 x 3 sharing, 1 x 1 sharing
  const layout: Array<{ floorKey: string; floorName: string; rooms: RoomSpec[] }> = [
    {
      floorKey: 'ground',
      floorName: 'Ground Floor',
      rooms: [
        { name: 'G1', capacity: 6, acType: AcType.AC },
        { name: 'G2', capacity: 5, acType: AcType.AC },
        { name: 'G3', capacity: 3, acType: AcType.AC },
        { name: 'G4', capacity: 3, acType: AcType.AC },
        { name: 'G5', capacity: 1, acType: AcType.AC },
      ],
    },
    {
      floorKey: 'first',
      floorName: 'First Floor',
      rooms: [
        { name: 'F1', capacity: 5, acType: AcType.AC },
        { name: 'F2', capacity: 4, acType: AcType.AC },
        { name: 'F3', capacity: 3, acType: AcType.AC },
        { name: 'F4', capacity: 1, acType: AcType.AC },
      ],
    },
  ];

  const roomCount = await createFloorsAndRooms(branch.id, layout);

  // Ekkatuthangal is AC only today. Prices include food.
  await createSharingPrices(branch.id, [
    { capacity: 1, acType: AcType.AC, amount: '14000' },
    { capacity: 3, acType: AcType.AC, amount: '12000' },
    { capacity: 4, acType: AcType.AC, amount: '9500' },
    { capacity: 5, acType: AcType.AC, amount: '9000' },
    { capacity: 6, acType: AcType.AC, amount: '9000' },
  ]);

  console.log(`Branch "Ekkatuthangal": ${roomCount} room(s), 5 sharing price(s)`);
  return roomCount;
}

async function seedAlandur(): Promise<number> {
  const branch = await prisma.branch.upsert({
    where: { name: 'Alandur' },
    create: { name: 'Alandur', code: 'ALD', sortOrder: 1 },
    update: {},
  });

  // Three floors plus a terrace. Room layout is entered in the app.
  const layout = [
    { floorKey: 'ground', floorName: 'Ground Floor', rooms: [] },
    { floorKey: 'first', floorName: 'First Floor', rooms: [] },
    { floorKey: 'second', floorName: 'Second Floor', rooms: [] },
    { floorKey: 'terrace', floorName: 'Terrace', rooms: [] },
  ];
  await createFloorsAndRooms(branch.id, layout);

  await createSharingPrices(branch.id, [
    { capacity: 2, acType: AcType.AC, amount: '13000' },
    { capacity: 2, acType: AcType.NON_AC, amount: '11500' },
    { capacity: 2, acType: AcType.AC, amount: '15000', variant: 'Big Room' },
    { capacity: 3, acType: AcType.AC, amount: '11000' },
    { capacity: 3, acType: AcType.NON_AC, amount: '9500' },
    { capacity: 4, acType: AcType.AC, amount: '9500' },
    { capacity: 4, acType: AcType.NON_AC, amount: '8000' },
    { capacity: 5, acType: AcType.AC, amount: '8500' },
  ]);

  console.log(`Branch "Alandur": ${layout.length} floor(s), 8 sharing price(s)`);
  return layout.length;
}

async function createFloorsAndRooms(
  branchId: string,
  layout: Array<{ floorKey: string; floorName: string; rooms: RoomSpec[] }>,
): Promise<number> {
  let roomCount = 0;

  for (const [index, spec] of layout.entries()) {
    const floorType = await prisma.floorType.findUnique({
      where: { key: spec.floorKey },
    });

    const floor = await prisma.floor.upsert({
      where: { branchId_name: { branchId, name: spec.floorName } },
      create: {
        branchId,
        name: spec.floorName,
        floorTypeId: floorType?.id,
        sortOrder: floorType?.sortOrder ?? index,
      },
      update: {},
    });

    for (const [roomIndex, room] of spec.rooms.entries()) {
      const existing = await prisma.room.findUnique({
        where: { floorId_name: { floorId: floor.id, name: room.name } },
      });
      if (existing) continue;

      const created = await prisma.room.create({
        data: {
          floorId: floor.id,
          name: room.name,
          capacity: room.capacity,
          acType: room.acType,
          variant: room.variant,
          sortOrder: roomIndex,
          beds: {
            create: Array.from({ length: room.capacity }, (_, i) => ({
              label: String.fromCharCode(65 + i),
              sortOrder: i,
            })),
          },
        },
      });

      // One electricity meter per room, which is how the split is computed.
      await prisma.ebMeter.create({
        data: { roomId: created.id, name: `${spec.floorName} · ${room.name}` },
      });

      roomCount += 1;
    }
  }

  return roomCount;
}

async function createSharingPrices(
  branchId: string,
  prices: Array<{
    capacity: number;
    acType: AcType;
    amount: string;
    variant?: string;
  }>,
): Promise<void> {
  for (const price of prices) {
    const existing = await prisma.pricingRule.findFirst({
      where: {
        scope: PricingScope.SHARING,
        branchId,
        capacity: price.capacity,
        acType: price.acType,
        variant: price.variant ?? null,
      },
    });
    if (existing) continue;

    await prisma.pricingRule.create({
      data: {
        scope: PricingScope.SHARING,
        branchId,
        capacity: price.capacity,
        acType: price.acType,
        variant: price.variant ?? null,
        amountWithFood: price.amount,
        effectiveFrom: EFFECTIVE_FROM,
        reason: 'Initial pricing from the system specification',
      },
    });
  }
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

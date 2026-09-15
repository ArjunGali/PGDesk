import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { SettingType } from '@prisma/client';
import Decimal from 'decimal.js';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { money } from '../../common/utils/money';
import {
  SETTING_DEFINITIONS,
  SettingDefinition,
  SettingKey,
} from './setting-keys';

/**
 * Resolves configurable business values.
 *
 * Two hard rules:
 *  1. Reads come from the database. A missing key is an error, not a default —
 *     otherwise a stray fallback in code silently becomes business policy.
 *  2. Every write is recorded in AppSettingHistory, so a bill issued in March
 *     can still be explained with March's rates.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.syncDefinitions();
    await this.refreshCache();
  }

  /**
   * Inserts any setting the current build knows about but the database does
   * not. Existing values are never touched — an upgrade must not reset the
   * owner's configured rates.
   */
  async syncDefinitions(): Promise<void> {
    const existing = await this.prisma.appSetting.findMany({
      select: { key: true },
    });
    const known = new Set(existing.map((s) => s.key));
    const missing = SETTING_DEFINITIONS.filter((d) => !known.has(d.key));
    if (missing.length === 0) return;

    await this.prisma.appSetting.createMany({
      data: missing.map((d) => ({
        key: d.key,
        value: d.defaultValue,
        type: d.type,
        group: d.group,
        label: d.label,
        description: d.description,
        isSystem: d.isSystem,
      })),
      skipDuplicates: true,
    });
    this.logger.log(`Initialised ${missing.length} new setting(s)`);
  }

  async refreshCache(): Promise<void> {
    const rows = await this.prisma.appSetting.findMany();
    this.cache = new Map(rows.map((r) => [r.key, r.value]));
  }

  private async raw(key: SettingKey | string): Promise<string> {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    if (!row) {
      throw new NotFoundException(
        `Setting "${key}" is not configured. Add it under Settings before using this feature.`,
      );
    }
    this.cache.set(key, row.value);
    return row.value;
  }

  async getString(key: SettingKey | string): Promise<string> {
    return this.raw(key);
  }

  async getNumber(key: SettingKey | string): Promise<number> {
    const value = Number(await this.raw(key));
    if (Number.isNaN(value)) {
      throw new BadRequestException(`Setting "${key}" is not a valid number`);
    }
    return value;
  }

  async getInt(key: SettingKey | string): Promise<number> {
    const value = await this.getNumber(key);
    return Math.trunc(value);
  }

  async getMoney(key: SettingKey | string): Promise<Decimal> {
    return money(await this.raw(key));
  }

  async getBoolean(key: SettingKey | string): Promise<boolean> {
    const value = (await this.raw(key)).toLowerCase();
    return value === 'true' || value === '1' || value === 'yes';
  }

  /**
   * The value that was in force at a past moment. Used when a historical
   * document has to be reproduced exactly as it was issued.
   */
  async getValueAt(key: SettingKey | string, at: Date): Promise<string> {
    const change = await this.prisma.appSettingHistory.findFirst({
      where: { key, effectiveAt: { lte: at } },
      orderBy: { effectiveAt: 'desc' },
    });
    if (change) return change.newValue;

    // No change recorded on or before `at`: the oldest known value applies,
    // which is the value the setting was created with.
    const firstChange = await this.prisma.appSettingHistory.findFirst({
      where: { key },
      orderBy: { effectiveAt: 'asc' },
    });
    if (firstChange?.oldValue != null) return firstChange.oldValue;
    return this.raw(key);
  }

  async getMoneyAt(key: SettingKey | string, at: Date): Promise<Decimal> {
    return money(await this.getValueAt(key, at));
  }

  async getIntAt(key: SettingKey | string, at: Date): Promise<number> {
    return Math.trunc(Number(await this.getValueAt(key, at)));
  }

  async list(group?: string) {
    const rows = await this.prisma.appSetting.findMany({
      where: group ? { group } : undefined,
      orderBy: [{ group: 'asc' }, { label: 'asc' }],
    });
    const definitionByKey = new Map<string, SettingDefinition>(
      SETTING_DEFINITIONS.map((d) => [d.key, d]),
    );
    return rows.map((row) => ({
      ...row,
      options: definitionByKey.get(row.key)?.options ?? null,
    }));
  }

  async groups(): Promise<string[]> {
    const rows = await this.prisma.appSetting.findMany({
      distinct: ['group'],
      select: { group: true },
      orderBy: { group: 'asc' },
    });
    return rows.map((r) => r.group);
  }

  async set(
    key: string,
    value: string,
    actorId?: string,
    reason?: string,
  ): Promise<void> {
    const setting = await this.prisma.appSetting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException(`Unknown setting "${key}"`);

    this.validate(setting.type, key, value);
    if (setting.value === value) return;

    await this.prisma.$transaction([
      this.prisma.appSetting.update({ where: { key }, data: { value } }),
      this.prisma.appSettingHistory.create({
        data: {
          settingId: setting.id,
          key,
          oldValue: setting.value,
          newValue: value,
          reason,
          changedById: actorId,
        },
      }),
    ]);
    this.cache.set(key, value);
  }

  /** Creates a new owner-defined setting that the shipped registry does not know about. */
  async create(input: {
    key: string;
    value: string;
    type: SettingType;
    group: string;
    label: string;
    description?: string;
  }) {
    this.validate(input.type, input.key, input.value);
    const created = await this.prisma.appSetting.create({
      data: { ...input, isSystem: false },
    });
    this.cache.set(created.key, created.value);
    return created;
  }

  async remove(key: string): Promise<void> {
    const setting = await this.prisma.appSetting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException(`Unknown setting "${key}"`);
    if (setting.isSystem) {
      throw new BadRequestException(
        'This setting is required by the application and cannot be deleted. Change its value instead.',
      );
    }
    await this.prisma.appSetting.delete({ where: { key } });
    this.cache.delete(key);
  }

  async history(key: string) {
    return this.prisma.appSettingHistory.findMany({
      where: { key },
      orderBy: { effectiveAt: 'desc' },
      include: { changedBy: { select: { id: true, fullName: true } } },
    });
  }

  private validate(type: SettingType, key: string, value: string): void {
    switch (type) {
      case SettingType.NUMBER:
      case SettingType.MONEY: {
        if (value.trim() === '' || Number.isNaN(Number(value))) {
          throw new BadRequestException(`"${key}" must be a number`);
        }
        if (type === SettingType.MONEY && Number(value) < 0) {
          throw new BadRequestException(`"${key}" cannot be negative`);
        }
        break;
      }
      case SettingType.INTEGER: {
        if (!/^-?\d+$/.test(value.trim())) {
          throw new BadRequestException(`"${key}" must be a whole number`);
        }
        break;
      }
      case SettingType.BOOLEAN: {
        if (!['true', 'false'].includes(value.toLowerCase())) {
          throw new BadRequestException(`"${key}" must be true or false`);
        }
        break;
      }
      case SettingType.JSON: {
        try {
          JSON.parse(value);
        } catch {
          throw new BadRequestException(`"${key}" must be valid JSON`);
        }
        break;
      }
      default:
        break;
    }
  }

  /** Reads a setting inside an existing transaction without touching the cache. */
  async rawInTx(db: Db, key: string): Promise<string> {
    const row = await db.appSetting.findUnique({ where: { key } });
    if (!row) throw new NotFoundException(`Setting "${key}" is not configured`);
    return row.value;
  }
}

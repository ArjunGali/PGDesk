import { SettingType } from '@prisma/client';

/**
 * The registry of configurable business values.
 *
 * IMPORTANT: the `defaultValue` below is *seed data only* — the value the
 * owner starts with on a fresh install. At runtime the settings service reads
 * the database and throws if a key is absent; it never silently falls back to
 * a number written in code. That is what keeps rent, E.B. rate, common charge,
 * food difference and notice period out of the application logic.
 */
export const SETTING_KEYS = {
  ORG_NAME: 'org.name',
  CURRENCY_CODE: 'org.currency_code',

  /** Monthly amount a room's rent drops by when the tenant opts out of food. */
  FOOD_DIFFERENCE_MONTHLY: 'pricing.food_difference_monthly',
  /** Per-month charge covering Wi-Fi, washing machine, refrigerator, etc. */
  COMMON_CHARGE_MONTHLY: 'charges.common_monthly',
  /** Electricity rate per unit. */
  EB_RATE_PER_UNIT: 'eb.rate_per_unit',
  /** Days of notice a tenant must give before vacating. */
  NOTICE_PERIOD_DAYS: 'stay.notice_period_days',

  /** Day of the month a monthly bill falls due. */
  BILLING_DUE_DAY: 'billing.due_day_of_month',
  /** How a partial month is charged: DAILY (pro-rata) or FULL_MONTH. */
  BILLING_PRORATION: 'billing.proration_method',
  /** Divisor for pro-rata: ACTUAL_DAYS uses the real month length. */
  BILLING_PRORATION_BASIS: 'billing.proration_basis',
  /** Fixed divisor used when the basis is FIXED_DAYS. */
  BILLING_PRORATION_FIXED_DAYS: 'billing.proration_fixed_days',
  /** Whether the common charge is pro-rated for partial months too. */
  COMMON_CHARGE_PRORATE: 'charges.common_prorate',
  /** Daily-stay tariff falls back to this when no daily price is configured. */
  DAILY_STAY_DEFAULT_RATE: 'pricing.daily_stay_default_rate',

  /** How an E.B. cycle is divided between the tenants of a room. */
  EB_SPLIT_METHOD: 'eb.split_method',
  /** Minimum units billed when a reading pair produces an implausible value. */
  EB_MAX_PLAUSIBLE_UNITS: 'eb.max_plausible_units_per_day',

  /** Bell: how many days ahead an upcoming checkout is surfaced. */
  NOTIFY_UPCOMING_CHECKOUT_DAYS: 'notify.upcoming_checkout_days',
  /** Bell: days after the due date before a bill is flagged as pending. */
  NOTIFY_PAYMENT_GRACE_DAYS: 'notify.payment_grace_days',
  /** Bell: warn this many days before a notice period expires. */
  NOTIFY_NOTICE_EXPIRY_DAYS: 'notify.notice_expiry_days',

  /** Deposit expressed as a number of months of rent, used as a suggestion. */
  DEPOSIT_DEFAULT_MONTHS: 'deposit.default_months',

  /** Invoice/receipt number prefixes. */
  INVOICE_PREFIX: 'billing.invoice_prefix',
  RECEIPT_PREFIX: 'billing.receipt_prefix',

  /** Tenant fields that must be filled before a profile counts as complete. */
  TENANT_REQUIRED_FIELDS: 'tenant.required_fields',

  /** Collected money waits for approval before it counts against bills. */
  PAYMENT_REQUIRE_VERIFICATION: 'payments.require_verification',
  /** UPI handle shown with the QR on the collection screen. */
  PAYMENT_UPI_ID: 'payments.upi_id',
  /** Payee name shown under the QR. */
  PAYMENT_UPI_PAYEE_NAME: 'payments.upi_payee_name',
  /** Minutes within which an identical payment is treated as a double entry. */
  PAYMENT_DUPLICATE_WINDOW_MINUTES: 'payments.duplicate_window_minutes',

  /** What a notice-period shortfall is charged on. */
  NOTICE_CHARGE_BASIS: 'stay.notice_charge_basis',

  /** Erasing a vacated tenant requires an export to exist first. */
  TENANT_ERASURE_REQUIRES_EXPORT: 'tenant.erasure_requires_export',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export interface SettingDefinition {
  key: SettingKey;
  type: SettingType;
  group: string;
  label: string;
  description: string;
  /** Initial value for a fresh install. Not a runtime fallback. */
  defaultValue: string;
  isSystem: boolean;
  /** Allowed values for enum-like settings, surfaced to the settings screen. */
  options?: string[];
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: SETTING_KEYS.ORG_NAME,
    type: SettingType.STRING,
    group: 'general',
    label: 'Business name',
    description: 'Shown on bills, receipts and exported documents',
    defaultValue: 'PG Management',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.CURRENCY_CODE,
    type: SettingType.STRING,
    group: 'general',
    label: 'Currency',
    description: 'Currency code used across the application',
    defaultValue: 'INR',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.FOOD_DIFFERENCE_MONTHLY,
    type: SettingType.MONEY,
    group: 'pricing',
    label: 'Food charge difference (per month)',
    description:
      'Room rents are stored inclusive of food. A tenant without food pays the room rent minus this amount.',
    defaultValue: '2000',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.COMMON_CHARGE_MONTHLY,
    type: SettingType.MONEY,
    group: 'charges',
    label: 'Common charge (per month)',
    description:
      'Covers shared facilities such as Wi-Fi, washing machine and refrigerator',
    defaultValue: '150',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.COMMON_CHARGE_PRORATE,
    type: SettingType.BOOLEAN,
    group: 'charges',
    label: 'Pro-rate common charge for part months',
    description:
      'When off, a tenant staying any part of a month pays the full common charge',
    defaultValue: 'true',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.EB_RATE_PER_UNIT,
    type: SettingType.MONEY,
    group: 'eb',
    label: 'E.B. rate per unit',
    description:
      'Rate applied to units consumed. Changing this never alters an already finalised E.B. cycle.',
    defaultValue: '12.50',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.EB_SPLIT_METHOD,
    type: SettingType.STRING,
    group: 'eb',
    label: 'E.B. split rule',
    description:
      "ROOM_CAPACITY charges each tenant one bed's share of the room (1/sharing) for the days they were responsible, so an empty bed costs the owner rather than the other tenants. OCCUPIED_DAYS divides the whole room bill between whoever was present, weighted by days. EQUAL divides it evenly between them.",
    defaultValue: 'ROOM_CAPACITY',
    isSystem: true,
    options: ['ROOM_CAPACITY', 'OCCUPIED_DAYS', 'EQUAL'],
  },
  {
    key: SETTING_KEYS.EB_MAX_PLAUSIBLE_UNITS,
    type: SettingType.NUMBER,
    group: 'eb',
    label: 'Maximum plausible units per day',
    description:
      'A reading pair implying more than this per day is flagged for review instead of being billed silently',
    defaultValue: '60',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.NOTICE_PERIOD_DAYS,
    type: SettingType.INTEGER,
    group: 'stay',
    label: 'Notice period (days)',
    description:
      'Notice a tenant must give before vacating. The value in force on the notice date is recorded with the notice.',
    defaultValue: '30',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.BILLING_DUE_DAY,
    type: SettingType.INTEGER,
    group: 'billing',
    label: 'Rent due day',
    description: 'Day of the month by which the monthly bill should be paid',
    defaultValue: '5',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.BILLING_PRORATION,
    type: SettingType.STRING,
    group: 'billing',
    label: 'Part-month billing',
    description:
      'DAILY charges only the days stayed; FULL_MONTH charges a whole month regardless',
    defaultValue: 'DAILY',
    isSystem: true,
    options: ['DAILY', 'FULL_MONTH'],
  },
  {
    key: SETTING_KEYS.BILLING_PRORATION_BASIS,
    type: SettingType.STRING,
    group: 'billing',
    label: 'Daily rate basis',
    description:
      'ACTUAL_DAYS divides the monthly rent by the real length of that month; FIXED_DAYS uses a constant divisor',
    defaultValue: 'ACTUAL_DAYS',
    isSystem: true,
    options: ['ACTUAL_DAYS', 'FIXED_DAYS'],
  },
  {
    key: SETTING_KEYS.BILLING_PRORATION_FIXED_DAYS,
    type: SettingType.INTEGER,
    group: 'billing',
    label: 'Fixed daily divisor',
    description: 'Used only when the daily rate basis is FIXED_DAYS',
    defaultValue: '30',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.DAILY_STAY_DEFAULT_RATE,
    type: SettingType.MONEY,
    group: 'pricing',
    label: 'Default daily stay rate',
    description:
      'Per-day tariff used for daily stays when no specific price is configured. Daily stays never include food.',
    defaultValue: '600',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.DEPOSIT_DEFAULT_MONTHS,
    type: SettingType.NUMBER,
    group: 'stay',
    label: 'Default deposit (months of rent)',
    description: 'Suggested deposit when adding a tenant. Always editable.',
    defaultValue: '1',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.NOTIFY_UPCOMING_CHECKOUT_DAYS,
    type: SettingType.INTEGER,
    group: 'notifications',
    label: 'Upcoming checkout warning (days)',
    description: 'How far ahead checkouts appear under the bell',
    defaultValue: '7',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.NOTIFY_PAYMENT_GRACE_DAYS,
    type: SettingType.INTEGER,
    group: 'notifications',
    label: 'Payment grace (days)',
    description: 'Days after the due date before a bill is flagged as pending',
    defaultValue: '0',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.NOTIFY_NOTICE_EXPIRY_DAYS,
    type: SettingType.INTEGER,
    group: 'notifications',
    label: 'Notice expiry warning (days)',
    description: 'Warn this many days before a notice period ends',
    defaultValue: '5',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.INVOICE_PREFIX,
    type: SettingType.STRING,
    group: 'billing',
    label: 'Bill number prefix',
    description: 'Prefix for generated bill numbers',
    defaultValue: 'INV',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.RECEIPT_PREFIX,
    type: SettingType.STRING,
    group: 'billing',
    label: 'Receipt number prefix',
    description: 'Prefix for generated payment receipt numbers',
    defaultValue: 'RCPT',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.PAYMENT_REQUIRE_VERIFICATION,
    type: SettingType.BOOLEAN,
    group: 'payments',
    label: 'Payments need approval',
    description:
      'When on, money recorded by someone without the approve permission waits for approval before it counts against a bill. Someone who can approve has their own entries approved automatically.',
    defaultValue: 'true',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.PAYMENT_UPI_ID,
    type: SettingType.STRING,
    group: 'payments',
    label: 'UPI ID',
    description: 'Shown as a QR code when collecting a UPI payment. Leave blank to hide the QR.',
    defaultValue: '',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.PAYMENT_UPI_PAYEE_NAME,
    type: SettingType.STRING,
    group: 'payments',
    label: 'UPI payee name',
    description: 'Name shown in the tenant\'s UPI app alongside the amount',
    defaultValue: '',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.PAYMENT_DUPLICATE_WINDOW_MINUTES,
    type: SettingType.INTEGER,
    group: 'payments',
    label: 'Duplicate payment window (minutes)',
    description:
      'An identical amount recorded for the same tenant within this many minutes is refused as a probable double entry. Set to 0 to allow it.',
    defaultValue: '10',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.NOTICE_CHARGE_BASIS,
    type: SettingType.STRING,
    group: 'stay',
    label: 'Notice shortfall charged on',
    description:
      'RENT_ONLY charges the remaining notice days at the rent excluding food. RENT_AND_FOOD includes the food component for tenants who take food.',
    defaultValue: 'RENT_ONLY',
    isSystem: true,
    options: ['RENT_ONLY', 'RENT_AND_FOOD'],
  },
  {
    key: SETTING_KEYS.TENANT_ERASURE_REQUIRES_EXPORT,
    type: SettingType.BOOLEAN,
    group: 'tenant',
    label: 'Export before erasing a tenant',
    description:
      'When on, a vacated tenant\'s records must be exported before their personal data can be erased. Erasure is irreversible.',
    defaultValue: 'true',
    isSystem: true,
  },
  {
    key: SETTING_KEYS.TENANT_REQUIRED_FIELDS,
    type: SettingType.JSON,
    group: 'tenant',
    label: 'Required tenant fields',
    description:
      'Fields a tenant profile needs before it stops being flagged as incomplete. A profile can always be saved without them.',
    defaultValue: '["mobile","emergencyContact","permanentAddress"]',
    isSystem: true,
  },
];

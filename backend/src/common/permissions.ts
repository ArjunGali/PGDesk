/**
 * Permission catalogue. Roles are data (see the seed), but the permission keys
 * themselves are part of the application contract, so they live in code and are
 * synced into the database at boot.
 */
export const PERMISSIONS = {
  // Property
  BRANCH_VIEW: 'branch.view',
  BRANCH_MANAGE: 'branch.manage',
  ROOM_VIEW: 'room.view',
  ROOM_MANAGE: 'room.manage',

  // Tenants
  TENANT_VIEW: 'tenant.view',
  TENANT_CREATE: 'tenant.create',
  TENANT_EDIT: 'tenant.edit',
  TENANT_ARCHIVE: 'tenant.archive',
  /** Export a vacated tenant's records and erase their personal data. */
  TENANT_ERASE: 'tenant.erase',
  TENANT_ASSIGN: 'tenant.assign',
  TENANT_VACATE: 'tenant.vacate',
  /** Seeing an Aadhaar number in full rather than its last four digits. */
  TENANT_VIEW_SENSITIVE: 'tenant.view_sensitive',

  // Documents
  DOCUMENT_VIEW: 'document.view',
  DOCUMENT_MANAGE: 'document.manage',
  DOCUMENT_VERIFY: 'document.verify',

  // Money
  PRICING_VIEW: 'pricing.view',
  PRICING_MANAGE: 'pricing.manage',
  INVOICE_VIEW: 'invoice.view',
  INVOICE_MANAGE: 'invoice.manage',
  PAYMENT_VIEW: 'payment.view',
  PAYMENT_RECORD: 'payment.record',
  /** Approving collected money so it counts against bills. */
  PAYMENT_APPROVE: 'payment.approve',
  PAYMENT_REVERSE: 'payment.reverse',
  DEPOSIT_VIEW: 'deposit.view',
  DEPOSIT_MANAGE: 'deposit.manage',
  SETTLEMENT_VIEW: 'settlement.view',
  SETTLEMENT_MANAGE: 'settlement.manage',
  ADJUSTMENT_MANAGE: 'adjustment.manage',

  // Electricity
  EB_VIEW: 'eb.view',
  EB_MANAGE: 'eb.manage',

  // Expenses
  EXPENSE_VIEW: 'expense.view',
  EXPENSE_MANAGE: 'expense.manage',

  // Reporting and admin
  REPORT_VIEW: 'report.view',
  EXPORT_RUN: 'export.run',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',
  USER_VIEW: 'user.view',
  USER_MANAGE: 'user.manage',
  /** Creating profiles, assigning roles and resetting PINs. */
  PROFILE_MANAGE: 'profile.manage',
  AUDIT_VIEW: 'audit.view',
  BACKUP_MANAGE: 'backup.manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOGUE: Array<{
  key: PermissionKey;
  group: string;
  description: string;
}> = [
  { key: PERMISSIONS.BRANCH_VIEW, group: 'Property', description: 'View branches, floors and rooms' },
  { key: PERMISSIONS.BRANCH_MANAGE, group: 'Property', description: 'Add, edit, disable or archive branches and floors' },
  { key: PERMISSIONS.ROOM_VIEW, group: 'Property', description: 'View rooms and bed occupancy' },
  { key: PERMISSIONS.ROOM_MANAGE, group: 'Property', description: 'Add or edit rooms and beds' },
  { key: PERMISSIONS.TENANT_VIEW, group: 'Tenants', description: 'View tenant profiles and stays' },
  { key: PERMISSIONS.TENANT_CREATE, group: 'Tenants', description: 'Add a new tenant and start a stay' },
  { key: PERMISSIONS.TENANT_EDIT, group: 'Tenants', description: 'Edit tenant details and stay settings' },
  { key: PERMISSIONS.TENANT_ARCHIVE, group: 'Tenants', description: 'Archive tenant records' },
  { key: PERMISSIONS.TENANT_ERASE, group: 'Tenants', description: 'Export a vacated tenant and erase their personal data' },
  { key: PERMISSIONS.TENANT_ASSIGN, group: 'Tenants', description: 'Assign beds, switch and swap rooms' },
  { key: PERMISSIONS.TENANT_VACATE, group: 'Tenants', description: 'Record notice and vacate tenants' },
  { key: PERMISSIONS.TENANT_VIEW_SENSITIVE, group: 'Tenants', description: 'See Aadhaar and other sensitive numbers in full' },
  { key: PERMISSIONS.DOCUMENT_VIEW, group: 'Documents', description: 'View tenant documents' },
  { key: PERMISSIONS.DOCUMENT_MANAGE, group: 'Documents', description: 'Upload and delete tenant documents' },
  { key: PERMISSIONS.DOCUMENT_VERIFY, group: 'Documents', description: 'Mark documents verified or rejected' },
  { key: PERMISSIONS.PRICING_VIEW, group: 'Money', description: 'View pricing rules' },
  { key: PERMISSIONS.PRICING_MANAGE, group: 'Money', description: 'Create and edit pricing rules and overrides' },
  { key: PERMISSIONS.INVOICE_VIEW, group: 'Money', description: 'View bills' },
  { key: PERMISSIONS.INVOICE_MANAGE, group: 'Money', description: 'Generate, issue and cancel bills' },
  { key: PERMISSIONS.PAYMENT_VIEW, group: 'Money', description: 'View payments' },
  { key: PERMISSIONS.PAYMENT_RECORD, group: 'Money', description: 'Record payments received' },
  { key: PERMISSIONS.PAYMENT_APPROVE, group: 'Money', description: 'Approve or reject collected payments' },
  { key: PERMISSIONS.PAYMENT_REVERSE, group: 'Money', description: 'Reverse a recorded payment' },
  { key: PERMISSIONS.DEPOSIT_VIEW, group: 'Money', description: 'View deposits' },
  { key: PERMISSIONS.DEPOSIT_MANAGE, group: 'Money', description: 'Collect, refund and adjust deposits' },
  { key: PERMISSIONS.SETTLEMENT_VIEW, group: 'Money', description: 'View final settlements' },
  { key: PERMISSIONS.SETTLEMENT_MANAGE, group: 'Money', description: 'Prepare and finalise settlements' },
  { key: PERMISSIONS.ADJUSTMENT_MANAGE, group: 'Money', description: 'Make manual financial adjustments' },
  { key: PERMISSIONS.EB_VIEW, group: 'Electricity', description: 'View meters, readings and E.B. charges' },
  { key: PERMISSIONS.EB_MANAGE, group: 'Electricity', description: 'Record readings and finalise E.B. cycles' },
  { key: PERMISSIONS.EXPENSE_VIEW, group: 'Expenses', description: 'View expenses' },
  { key: PERMISSIONS.EXPENSE_MANAGE, group: 'Expenses', description: 'Record and edit expenses' },
  { key: PERMISSIONS.REPORT_VIEW, group: 'Admin', description: 'View reports' },
  { key: PERMISSIONS.EXPORT_RUN, group: 'Admin', description: 'Export data to PDF, Excel or CSV' },
  { key: PERMISSIONS.SETTINGS_VIEW, group: 'Admin', description: 'View settings' },
  { key: PERMISSIONS.SETTINGS_MANAGE, group: 'Admin', description: 'Change settings' },
  { key: PERMISSIONS.USER_VIEW, group: 'Admin', description: 'View users and roles' },
  { key: PERMISSIONS.USER_MANAGE, group: 'Admin', description: 'Create users and assign roles' },
  { key: PERMISSIONS.PROFILE_MANAGE, group: 'Admin', description: 'Manage profiles, roles and PINs' },
  { key: PERMISSIONS.AUDIT_VIEW, group: 'Admin', description: 'View the audit trail' },
  { key: PERMISSIONS.BACKUP_MANAGE, group: 'Admin', description: 'Run and download backups' },
];

/**
 * The four profiles the specification names, as starting points.
 *
 * These are seed data, not rules: every role's permissions are editable from
 * Settings, and new roles can be created. Only Owner is special in code —
 * `isOwner` bypasses permission checks so the property can never be locked out
 * of its own system.
 */
export const DEFAULT_ROLES: Array<{
  key: string;
  name: string;
  description: string;
  permissions: PermissionKey[] | 'ALL';
}> = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Full access to everything, including settings, profiles and audit',
    permissions: 'ALL',
  },
  {
    key: 'admin',
    name: 'Admin',
    description:
      'Runs the property day to day: everything except erasing tenant data and managing profiles',
    permissions: [
      PERMISSIONS.BRANCH_VIEW, PERMISSIONS.BRANCH_MANAGE,
      PERMISSIONS.ROOM_VIEW, PERMISSIONS.ROOM_MANAGE,
      PERMISSIONS.TENANT_VIEW, PERMISSIONS.TENANT_CREATE, PERMISSIONS.TENANT_EDIT,
      PERMISSIONS.TENANT_ASSIGN, PERMISSIONS.TENANT_VACATE, PERMISSIONS.TENANT_ARCHIVE,
      PERMISSIONS.TENANT_VIEW_SENSITIVE,
      PERMISSIONS.DOCUMENT_VIEW, PERMISSIONS.DOCUMENT_MANAGE, PERMISSIONS.DOCUMENT_VERIFY,
      PERMISSIONS.PRICING_VIEW, PERMISSIONS.PRICING_MANAGE,
      PERMISSIONS.INVOICE_VIEW, PERMISSIONS.INVOICE_MANAGE,
      PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_RECORD, PERMISSIONS.PAYMENT_APPROVE,
      PERMISSIONS.PAYMENT_REVERSE,
      PERMISSIONS.DEPOSIT_VIEW, PERMISSIONS.DEPOSIT_MANAGE,
      PERMISSIONS.SETTLEMENT_VIEW, PERMISSIONS.SETTLEMENT_MANAGE,
      PERMISSIONS.ADJUSTMENT_MANAGE,
      PERMISSIONS.EB_VIEW, PERMISSIONS.EB_MANAGE,
      PERMISSIONS.EXPENSE_VIEW, PERMISSIONS.EXPENSE_MANAGE,
      PERMISSIONS.REPORT_VIEW, PERMISSIONS.EXPORT_RUN,
      PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.USER_VIEW, PERMISSIONS.AUDIT_VIEW,
    ],
  },
  {
    key: 'manager',
    name: 'Manager',
    description:
      'Tenants, rooms and collections. Can approve payments but not change settings or pricing.',
    permissions: [
      PERMISSIONS.BRANCH_VIEW, PERMISSIONS.ROOM_VIEW, PERMISSIONS.ROOM_MANAGE,
      PERMISSIONS.TENANT_VIEW, PERMISSIONS.TENANT_CREATE, PERMISSIONS.TENANT_EDIT,
      PERMISSIONS.TENANT_ASSIGN, PERMISSIONS.TENANT_VACATE,
      PERMISSIONS.DOCUMENT_VIEW, PERMISSIONS.DOCUMENT_MANAGE, PERMISSIONS.DOCUMENT_VERIFY,
      PERMISSIONS.PRICING_VIEW,
      PERMISSIONS.INVOICE_VIEW, PERMISSIONS.INVOICE_MANAGE,
      PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_RECORD, PERMISSIONS.PAYMENT_APPROVE,
      PERMISSIONS.DEPOSIT_VIEW, PERMISSIONS.DEPOSIT_MANAGE,
      PERMISSIONS.SETTLEMENT_VIEW, PERMISSIONS.SETTLEMENT_MANAGE,
      PERMISSIONS.EB_VIEW, PERMISSIONS.EB_MANAGE,
      PERMISSIONS.EXPENSE_VIEW, PERMISSIONS.EXPENSE_MANAGE,
      PERMISSIONS.REPORT_VIEW, PERMISSIONS.EXPORT_RUN,
      PERMISSIONS.SETTINGS_VIEW,
    ],
  },
  {
    key: 'staff',
    name: 'Staff',
    description:
      'Front desk: sees tenants and rooms, collects payments for approval, records meter readings.',
    permissions: [
      PERMISSIONS.BRANCH_VIEW, PERMISSIONS.ROOM_VIEW,
      PERMISSIONS.TENANT_VIEW, PERMISSIONS.TENANT_CREATE, PERMISSIONS.TENANT_EDIT,
      PERMISSIONS.DOCUMENT_VIEW, PERMISSIONS.DOCUMENT_MANAGE,
      PERMISSIONS.INVOICE_VIEW,
      // Staff collect money; someone with approve has to confirm it.
      PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_RECORD,
      PERMISSIONS.EB_VIEW, PERMISSIONS.EB_MANAGE,
      PERMISSIONS.EXPENSE_VIEW,
    ],
  },
];

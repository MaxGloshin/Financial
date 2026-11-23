import { z } from 'zod';
import type {
  Account,
  AppSettings,
  AuditLog,
  Budget,
  Category,
  Debt,
  Goal,
  LedgerEntry,
  PlannedInflow,
  PlannedPayment,
  Transaction,
} from '../domain/types.ts';
import { defaultCategories, ensureBaseData } from './defaults.ts';
import { settingsDefaults } from '../domain/finance.ts';
import { APP_VERSION } from '../lib/appMeta.ts';
import { base64ToBytes, bytesToBase64 } from '../lib/base64.ts';
import type { FinanceDB } from './db.ts';
import { auditRecord } from './audit.ts';

export const BACKUP_FORMAT = 'personal-finance-backup';
export const ENCRYPTED_BACKUP_FORMAT = 'personal-finance-backup-encrypted';
export const BACKUP_FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 210_000;

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export class BackupPasswordRequiredError extends BackupError {
  constructor() {
    super('Файл зашифрован. Введите пароль.');
    this.name = 'BackupPasswordRequiredError';
  }
}

const isoString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Некорректная дата ISO');

const dateKey = z
  .string()
  .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), 'Некорректная дата');

const money = z.number().int();
const optionalMoney = money.optional();

const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  type: z.enum(['cash', 'debit', 'savings', 'credit']),
  openingBalanceMinor: money,
  openingBalanceAt: isoString,
  currency: z.literal('RUB'),
  creditLimitMinor: optionalMoney,
  statementDay: z.number().int().min(1).max(31).optional(),
  paymentDueDay: z.number().int().min(1).max(31).optional(),
  color: z.string().optional(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  createdAt: isoString,
  updatedAt: isoString,
});

const categorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  kind: z.enum(['expense', 'income']),
  icon: z.string(),
  color: z.string().optional(),
  sortOrder: z.number().int(),
  isSystem: z.boolean(),
  createdAt: isoString,
  updatedAt: isoString,
});

const transactionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'expense',
    'income',
    'transfer',
    'credit_payment',
    'debt_payment',
    'refund',
    'adjustment',
  ]),
  amountMinor: money,
  occurredAt: isoString,
  description: z.string().max(500),
  accountId: z.string().optional(),
  fromAccountId: z.string().optional(),
  toAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  debtId: z.string().optional(),
  clientRequestId: z.string().min(1),
  source: z.enum(['manual', 'template', 'demo', 'import']),
  createdAt: isoString,
  updatedAt: isoString,
  deletedAt: z.string().nullable().optional(),
  rev: z.number().int().min(1),
});

const entrySchema = z.object({
  id: z.string().min(1),
  transactionId: z.string().min(1),
  accountId: z.string().nullable(),
  categoryId: z.string().nullable(),
  amountMinor: money.refine((value) => value !== 0, 'Проводка не может быть нулевой'),
});

const debtSchema = z.object({
  id: z.string().min(1),
  direction: z.enum(['owed_to_me', 'i_owe']),
  counterparty: z.string().min(1).max(120),
  amountMinor: money,
  paidMinor: money,
  dueDate: z.string().nullable().optional(),
  note: z.string().optional(),
  status: z.enum(['open', 'paid']),
  createdAt: isoString,
  updatedAt: isoString,
  deletedAt: z.string().nullable().optional(),
});

const goalSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  targetMinor: money,
  savedMinor: money,
  deadline: z.string().nullable().optional(),
  note: z.string().optional(),
  color: z.string().optional(),
  createdAt: isoString,
  updatedAt: isoString,
  deletedAt: z.string().nullable().optional(),
});

const plannedPaymentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  amountMinor: money,
  dayOfMonth: z.number().int().min(1).max(31),
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  active: z.boolean(),
  note: z.string().optional(),
  createdAt: isoString,
  updatedAt: isoString,
  deletedAt: z.string().nullable().optional(),
});

const plannedInflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  amountMinor: money,
  expectedDate: dateKey,
  confidence: z.enum(['confirmed', 'likely', 'possible']),
  createdAt: isoString,
  updatedAt: isoString,
  deletedAt: z.string().nullable().optional(),
});

const budgetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amountMinor: money,
  updatedAt: isoString,
});

const settingsSchema = z.object({
  id: z.literal('app'),
  onboardingComplete: z.boolean(),
  currency: z.literal('RUB'),
  monthlyBudgetMinor: money,
  defaultAccountId: z.string().optional(),
  lastCategoryId: z.string().optional(),
  theme: z.enum(['system', 'light', 'dark']),
  lastBackupAt: z.string().optional(),
  lastBackupFormat: z.number().int().optional(),
  createdAt: isoString,
  updatedAt: isoString,
});

const auditSchema = z.object({
  id: z.string().min(1),
  at: isoString,
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});

export const backupDataSchema = z.object({
  accounts: z.array(accountSchema),
  categories: z.array(categorySchema),
  transactions: z.array(transactionSchema),
  entries: z.array(entrySchema),
  debts: z.array(debtSchema),
  goals: z.array(goalSchema),
  plannedPayments: z.array(plannedPaymentSchema),
  plannedInflows: z.array(plannedInflowSchema),
  budgets: z.array(budgetSchema),
  settings: z.array(settingsSchema).max(1),
  audit: z.array(auditSchema),
});

export type BackupData = {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  entries: LedgerEntry[];
  debts: Debt[];
  goals: Goal[];
  plannedPayments: PlannedPayment[];
  plannedInflows: PlannedInflow[];
  budgets: Budget[];
  settings: AppSettings[];
  audit: AuditLog[];
};

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  appVersion: string;
  exportedAt: string;
  counts: Record<string, number>;
  data: BackupData;
  checksum: string;
};

export type EncryptedBackupFile = {
  format: typeof ENCRYPTED_BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  appVersion: string;
  exportedAt: string;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: string;
  };
  cipher: {
    name: 'AES-GCM';
    iv: string;
  };
  payload: string;
};

const encryptedSchema = z.object({
  format: z.literal(ENCRYPTED_BACKUP_FORMAT),
  formatVersion: z.number().int(),
  appVersion: z.string(),
  exportedAt: isoString,
  kdf: z.object({
    name: z.literal('PBKDF2'),
    hash: z.literal('SHA-256'),
    iterations: z.number().int().min(10_000).max(5_000_000),
    salt: z.string(),
  }),
  cipher: z.object({
    name: z.literal('AES-GCM'),
    iv: z.string(),
  }),
  payload: z.string(),
});

const backupFileSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.number().int(),
  appVersion: z.string(),
  exportedAt: isoString,
  counts: z.record(z.string(), z.number().int().nonnegative()),
  data: backupDataSchema,
  checksum: z.string().min(16),
});

export function backupCounts(data: BackupData): Record<string, number> {
  return {
    accounts: data.accounts.length,
    categories: data.categories.length,
    transactions: data.transactions.length,
    entries: data.entries.length,
    debts: data.debts.length,
    goals: data.goals.length,
    plannedPayments: data.plannedPayments.length,
    plannedInflows: data.plannedInflows.length,
    budgets: data.budgets.length,
    settings: data.settings.length,
    audit: data.audit.length,
  };
}

export async function readAllData(database: FinanceDB): Promise<BackupData> {
  return database.transaction(
    'r',
    [
      database.accounts,
      database.categories,
      database.transactions,
      database.entries,
      database.debts,
      database.goals,
      database.plannedPayments,
      database.plannedInflows,
      database.budgets,
      database.settings,
      database.audit,
    ],
    async () => {
      const [
        accounts,
        categories,
        transactions,
        entries,
        debts,
        goals,
        plannedPayments,
        plannedInflows,
        budgets,
        settings,
        audit,
      ] = await Promise.all([
        database.accounts.toArray(),
        database.categories.toArray(),
        database.transactions.toArray(),
        database.entries.toArray(),
        database.debts.toArray(),
        database.goals.toArray(),
        database.plannedPayments.toArray(),
        database.plannedInflows.toArray(),
        database.budgets.toArray(),
        database.settings.toArray(),
        database.audit.orderBy('at').toArray(),
      ]);
      return {
        accounts,
        categories,
        transactions,
        entries,
        debts,
        goals,
        plannedPayments,
        plannedInflows,
        budgets,
        settings,
        audit,
      };
    },
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

/**
 * Serializes JSON with object keys sorted, so the checksum does not depend on
 * key order. Without this, re-validating an already parsed (and possibly
 * re-ordered by schema parsing) backup would report a false mismatch.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export async function computeChecksum(data: BackupData): Promise<string> {
  return sha256(stableStringify(data));
}

export async function exportBackup(database: FinanceDB): Promise<BackupFile> {
  const data = await readAllData(database);
  const checksum = await computeChecksum(data);
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: backupCounts(data),
    data,
    checksum,
  };
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file, null, 2);
}

export function backupFilename(encrypted: boolean, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`;
  return `finance-backup-${stamp}${encrypted ? '.enc' : ''}.json`;
}

function assertSupportedVersion(formatVersion: number): void {
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupError(
      'Файл создан более новой версией приложения. Обновите приложение и повторите импорт.',
    );
  }
  if (formatVersion < 1) throw new BackupError('Неподдерживаемая версия формата резервной копии');
}

function assertUniqueIds(records: Array<{ id: string }>, label: string): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) throw new BackupError(`Дублирующийся ID в разделе ${label}: ${record.id}`);
    seen.add(record.id);
  }
}

export function validateReferentialIntegrity(data: BackupData): void {
  assertUniqueIds(data.accounts, 'счета');
  assertUniqueIds(data.categories, 'категории');
  assertUniqueIds(data.transactions, 'операции');
  assertUniqueIds(data.entries, 'проводки');
  assertUniqueIds(data.debts, 'долги');
  assertUniqueIds(data.goals, 'цели');
  assertUniqueIds(data.plannedPayments, 'плановые платежи');
  assertUniqueIds(data.plannedInflows, 'поступления');

  const accountIds = new Set(data.accounts.map((item) => item.id));
  const categoryIds = new Set(data.categories.map((item) => item.id));
  const transactionIds = new Set(data.transactions.map((item) => item.id));
  const debtIds = new Set(data.debts.map((item) => item.id));
  const budgetMonths = new Set<string>();

  for (const budget of data.budgets) {
    if (budgetMonths.has(budget.month)) throw new BackupError(`Дублирующийся бюджет: ${budget.month}`);
    budgetMonths.add(budget.month);
  }

  const checkAccount = (id: string | undefined, where: string) => {
    if (id && !accountIds.has(id)) throw new BackupError(`В копии нет счёта ${id} (${where})`);
  };
  const checkCategory = (id: string | undefined, where: string) => {
    if (id && !categoryIds.has(id)) throw new BackupError(`В копии нет категории ${id} (${where})`);
  };

  for (const tx of data.transactions) {
    checkAccount(tx.accountId, `операция ${tx.id}`);
    checkAccount(tx.fromAccountId, `операция ${tx.id}`);
    checkAccount(tx.toAccountId, `операция ${tx.id}`);
    checkCategory(tx.categoryId, `операция ${tx.id}`);
    if (tx.debtId && !debtIds.has(tx.debtId)) {
      throw new BackupError(`В копии нет долга ${tx.debtId} (операция ${tx.id})`);
    }
    if (tx.kind !== 'adjustment' && !Number.isSafeInteger(tx.amountMinor)) {
      throw new BackupError(`Некорректная сумма операции ${tx.id}`);
    }
    if (tx.kind !== 'adjustment' && tx.amountMinor <= 0) {
      throw new BackupError(`Сумма операции ${tx.id} должна быть больше нуля`);
    }
  }

  for (const entry of data.entries) {
    if (!transactionIds.has(entry.transactionId)) {
      throw new BackupError(`Проводка ${entry.id} ссылается на отсутствующую операцию`);
    }
    if (entry.accountId && !accountIds.has(entry.accountId)) {
      throw new BackupError(`Проводка ${entry.id} ссылается на отсутствующий счёт`);
    }
    if (entry.categoryId && !categoryIds.has(entry.categoryId)) {
      throw new BackupError(`Проводка ${entry.id} ссылается на отсутствующую категорию`);
    }
    if (!entry.accountId && !entry.categoryId) {
      throw new BackupError(`Проводка ${entry.id} не имеет счёта или категории`);
    }
  }

  for (const debt of data.debts) {
    if (debt.paidMinor < 0 || debt.paidMinor > debt.amountMinor) {
      throw new BackupError(`Некорректная выплата по долгу ${debt.id}`);
    }
    if (debt.amountMinor <= 0) throw new BackupError(`Некорректная сумма долга ${debt.id}`);
  }

  for (const goal of data.goals) {
    if (goal.targetMinor <= 0 || goal.savedMinor < 0) {
      throw new BackupError(`Некорректная цель ${goal.id}`);
    }
  }

  for (const payment of data.plannedPayments) {
    if (payment.amountMinor <= 0) throw new BackupError(`Некорректный платёж ${payment.id}`);
    checkAccount(payment.accountId, `платёж ${payment.id}`);
    checkCategory(payment.categoryId, `платёж ${payment.id}`);
  }

  for (const inflow of data.plannedInflows) {
    if (inflow.amountMinor <= 0) throw new BackupError(`Некорректное поступление ${inflow.id}`);
  }

  if (data.settings.length > 1) throw new BackupError('В копии больше одной записи настроек');
  if (data.settings.length === 1 && data.settings[0]!.id !== 'app') {
    throw new BackupError('Некорректная запись настроек');
  }
}

export async function validateBackupFile(value: unknown): Promise<BackupFile> {
  if (typeof value !== 'object' || value === null) throw new BackupError('Некорректный файл копии');
  const raw = value as {
    format?: unknown;
    formatVersion?: unknown;
    checksum?: unknown;
    counts?: unknown;
    data?: unknown;
  };
  if (raw.format !== BACKUP_FORMAT) throw new BackupError('Неизвестный формат файла копии');
  if (typeof raw.formatVersion !== 'number') throw new BackupError('Не указана версия формата');
  assertSupportedVersion(raw.formatVersion);

  // Verify the checksum against the raw payload (before zod can reorder keys).
  if (typeof raw.checksum !== 'string' || typeof raw.data !== 'object' || raw.data === null) {
    throw new BackupError('Некорректная контрольная сумма копии');
  }
  const checksum = await sha256(stableStringify(raw.data));
  if (checksum !== raw.checksum) {
    throw new BackupError('Контрольная сумма не совпадает. Файл повреждён или изменён.');
  }

  const parsed = backupFileSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BackupError(
      `Структура файла неверна${issue ? `: ${issue.path.join('.')} — ${issue.message}` : ''}`,
    );
  }
  const file = parsed.data as unknown as BackupFile;
  const expected = backupCounts(file.data);
  for (const [key, count] of Object.entries(expected)) {
    if (file.counts[key] !== count) {
      throw new BackupError(`Не совпадает количество записей в разделе ${key}`);
    }
  }
  validateReferentialIntegrity(file.data);
  return file;
}

export type ParsedBackup =
  | { kind: 'plain'; file: BackupFile }
  | { kind: 'encrypted'; envelope: EncryptedBackupFile };

export function parseBackupJson(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('Это не JSON-файл резервной копии');
  }
  if (typeof raw !== 'object' || raw === null) throw new BackupError('Некорректный файл копии');
  const format = (raw as { format?: unknown }).format;
  if (format === ENCRYPTED_BACKUP_FORMAT) {
    const parsed = encryptedSchema.safeParse(raw);
    if (!parsed.success) throw new BackupError('Повреждённый зашифрованный файл копии');
    const envelope = parsed.data as unknown as EncryptedBackupFile;
    assertSupportedVersion(envelope.formatVersion);
    return { kind: 'encrypted', envelope };
  }
  if (format !== BACKUP_FORMAT) {
    throw new BackupError('Неизвестный формат файла. Ожидается резервная копия «Моих финансов».');
  }
  return { kind: 'plain', file: raw as BackupFile };
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackup(
  file: BackupFile,
  password: string,
): Promise<EncryptedBackupFile> {
  if (password.length < 8) throw new BackupError('Пароль должен быть не короче 8 символов');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(file));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext,
  );
  return {
    format: ENCRYPTED_BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    cipher: {
      name: 'AES-GCM',
      iv: bytesToBase64(iv),
    },
    payload: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptBackup(
  envelope: EncryptedBackupFile,
  password: string,
): Promise<BackupFile> {
  try {
    const salt = base64ToBytes(envelope.kdf.salt);
    const iv = base64ToBytes(envelope.cipher.iv);
    const key = await deriveKey(password, salt, envelope.kdf.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      base64ToBytes(envelope.payload) as BufferSource,
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext));
    return await validateBackupFile(parsed);
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('Неверный пароль или повреждённый файл');
  }
}

export async function readBackup(
  text: string,
  password?: string,
): Promise<{ file: BackupFile; wasEncrypted: boolean }> {
  const parsed = parseBackupJson(text);
  if (parsed.kind === 'plain') {
    return { file: await validateBackupFile(parsed.file), wasEncrypted: false };
  }
  if (!password) throw new BackupPasswordRequiredError();
  return { file: await decryptBackup(parsed.envelope, password), wasEncrypted: true };
}

export type ImportMode = 'replace' | 'merge';

export type ImportResult = {
  mode: ImportMode;
  added: Record<string, number>;
  skipped: Record<string, number>;
  warnings: string[];
};

type TableLike = {
  bulkGet: (keys: string[]) => Promise<Array<unknown | undefined>>;
  bulkPut: (items: never[]) => Promise<unknown>;
  bulkAdd: (items: never[]) => Promise<unknown>;
  clear: () => Promise<void>;
  toArray: () => Promise<unknown[]>;
};

async function mergeTable<T extends Record<string, unknown>>(
  database: FinanceDB,
  name: string,
  records: T[],
  key: keyof T & string,
  skip?: (record: T, existing: unknown[]) => boolean,
): Promise<{ added: number; skipped: number }> {
  const table = database.table(name) as unknown as TableLike;
  const keys = records.map((record) => String(record[key]));
  const existingRows = await table.bulkGet(keys);
  const existingSet = new Set(keys.filter((_, index) => existingRows[index] !== undefined));
  const all = (await table.toArray()) as T[];
  const toAdd: T[] = [];
  let skipped = 0;
  for (const record of records) {
    const recordKey = String(record[key]);
    if (existingSet.has(recordKey)) {
      skipped++;
      continue;
    }
    if (skip?.(record, all)) {
      skipped++;
      continue;
    }
    existingSet.add(recordKey);
    toAdd.push(record);
  }
  if (toAdd.length > 0) await table.bulkAdd(toAdd as never[]);
  return { added: toAdd.length, skipped };
}

export async function importBackup(
  database: FinanceDB,
  file: BackupFile,
  mode: ImportMode,
): Promise<ImportResult> {
  const result: ImportResult = { mode, added: {}, skipped: {}, warnings: [] };
  // Re-validate even when the caller already did, so a corrupted object can never
  // reach the database through a programmatic import.
  const validated = await validateBackupFile(file);
  const data = validated.data;

  await database.transaction(
    'rw',
    [
      database.accounts,
      database.categories,
      database.transactions,
      database.entries,
      database.debts,
      database.goals,
      database.plannedPayments,
      database.plannedInflows,
      database.budgets,
      database.settings,
      database.audit,
    ],
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          database.accounts.clear(),
          database.categories.clear(),
          database.transactions.clear(),
          database.entries.clear(),
          database.debts.clear(),
          database.goals.clear(),
          database.plannedPayments.clear(),
          database.plannedInflows.clear(),
          database.budgets.clear(),
          database.settings.clear(),
          database.audit.clear(),
        ]);
        await database.accounts.bulkPut(data.accounts);
        await database.categories.bulkPut(data.categories);
        await database.transactions.bulkPut(data.transactions);
        await database.entries.bulkPut(data.entries);
        await database.debts.bulkPut(data.debts);
        await database.goals.bulkPut(data.goals);
        await database.plannedPayments.bulkPut(data.plannedPayments);
        await database.plannedInflows.bulkPut(data.plannedInflows);
        await database.budgets.bulkPut(data.budgets);
        await database.settings.bulkPut(data.settings);
        await database.audit.bulkPut(data.audit);
        for (const key of Object.keys(backupCounts(data))) {
          result.added[key] = data[key as keyof BackupData].length;
        }
      } else {
        const existingClientIds = new Set(
          (await database.transactions.toArray()).map((tx) => tx.clientRequestId),
        );
        const tables: Array<[string, Array<Record<string, unknown>>, string]> = [
          ['accounts', data.accounts as unknown as Array<Record<string, unknown>>, 'id'],
          ['categories', data.categories as unknown as Array<Record<string, unknown>>, 'id'],
          ['debts', data.debts as unknown as Array<Record<string, unknown>>, 'id'],
          ['goals', data.goals as unknown as Array<Record<string, unknown>>, 'id'],
          ['plannedPayments', data.plannedPayments as unknown as Array<Record<string, unknown>>, 'id'],
          ['plannedInflows', data.plannedInflows as unknown as Array<Record<string, unknown>>, 'id'],
          ['budgets', data.budgets as unknown as Array<Record<string, unknown>>, 'month'],
        ];
        for (const [name, records, key] of tables) {
          const stats = await mergeTable(database, name, records, key);
          result.added[name] = stats.added;
          result.skipped[name] = stats.skipped;
        }
        const txStats = await mergeTable(
          database,
          'transactions',
          data.transactions as unknown as Array<Record<string, unknown>>,
          'id',
          (record) => existingClientIds.has(String(record.clientRequestId)),
        );
        result.added.transactions = txStats.added;
        result.skipped.transactions = txStats.skipped;
        if (txStats.skipped > 0) {
          result.warnings.push(
            `${txStats.skipped} операций пропущено: такие записи или их ключи уже есть в базе.`,
          );
        }

        // Entries and audit rows are only added when their transaction exists and the entry id is new.
        const knownTx = new Set((await database.transactions.toArray()).map((tx) => tx.id));
        const entryStats = await mergeTable(
          database,
          'entries',
          data.entries.filter((entry) => knownTx.has(entry.transactionId)) as unknown as Array<
            Record<string, unknown>
          >,
          'id',
        );
        result.added.entries = entryStats.added;
        result.skipped.entries =
          entryStats.skipped + (data.entries.length - entryStats.added - entryStats.skipped);

        const auditStats = await mergeTable(
          database,
          'audit',
          data.audit as unknown as Array<Record<string, unknown>>,
          'id',
        );
        result.added.audit = auditStats.added;
        result.skipped.audit = auditStats.skipped;

        const settings = await database.settings.get('app');
        if (!settings && data.settings[0]) {
          await database.settings.add(data.settings[0]);
          result.added.settings = 1;
        } else {
          result.skipped.settings = data.settings.length;
        }
      }

      // Never show onboarding over imported financial data.
      const settings = await database.settings.get('app');
      const hasAccounts = (await database.accounts.count()) > 0;
      if (settings && hasAccounts && !settings.onboardingComplete) {
        await database.settings.put({ ...settings, onboardingComplete: true });
      }
      if (!settings && hasAccounts) {
        await database.settings.put({ ...settingsDefaults(), onboardingComplete: true });
      }
      if ((await database.categories.count()) === 0) {
        await database.categories.bulkAdd(defaultCategories());
        result.warnings.push('В копии не было категорий — добавлены стандартные.');
      }

      await database.audit.add(
        auditRecord('backup.import', 'settings', 'app', undefined, {
          mode,
          formatVersion: file.formatVersion,
          exportedAt: file.exportedAt,
          added: result.added,
          skipped: result.skipped,
        }),
      );
    },
  );

  return result;
}

/** Ensures an imported empty database is still usable. */
export async function ensureAfterImport(database: FinanceDB): Promise<void> {
  await ensureBaseData(database);
}

export type BackupStatus = {
  lastBackupAt: string | null;
  ageDays: number | null;
  needsWarning: boolean;
  label: string;
};

export function backupStatus(settings: AppSettings, now = new Date()): BackupStatus {
  if (!settings.lastBackupAt) {
    return {
      lastBackupAt: null,
      ageDays: null,
      needsWarning: true,
      label: 'Резервная копия ещё не создавалась',
    };
  }
  const then = new Date(settings.lastBackupAt);
  const ageDays = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  return {
    lastBackupAt: settings.lastBackupAt,
    ageDays,
    needsWarning: ageDays >= 7,
    label:
      ageDays <= 0
        ? 'Копия создана сегодня'
        : ageDays === 1
          ? 'Копия создана вчера'
          : `Копии ${ageDays} дн.`,
  };
}

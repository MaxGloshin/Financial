import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FinanceDB } from '@/db/db.ts';
import { createAccount } from '@/db/accounts.ts';
import { DEFAULT_CATEGORY_IDS } from '@/db/defaults.ts';
import {
  createDebt,
  createGoal,
  createPlannedInflow,
  createPlannedPayment,
  setBudget,
} from '@/db/planning.ts';
import { createTransaction } from '@/db/transactions.ts';
import {
  BackupError,
  ENCRYPTED_BACKUP_FORMAT,
  backupCounts,
  computeChecksum,
  encryptBackup,
  exportBackup,
  importBackup,
  parseBackupJson,
  readBackup,
  serializeBackup,
  validateBackupFile,
  type BackupFile,
} from '@/db/backup.ts';
import { moneyOverview } from '@/domain/finance.ts';
import { addDays, monthKey, todayKey } from '@/lib/dates.ts';
import { openTestDb, readSnapshot } from '@/test/helpers.ts';

async function seed(database: FinanceDB) {
  const cash = await createAccount(database, {
    name: 'Наличные',
    type: 'cash',
    openingBalanceMinor: 5_000_00,
  });
  const debit = await createAccount(database, {
    name: 'Дебетовая карта',
    type: 'debit',
    openingBalanceMinor: 100_000_00,
  });
  const credit = await createAccount(database, {
    name: 'Кредитка',
    type: 'credit',
    openingBalanceMinor: -10_000_00,
    creditLimitMinor: 50_000_00,
    paymentDueDay: 20,
  });

  await createTransaction(database, {
    kind: 'income',
    amountMinor: 30_000_00,
    accountId: debit.id,
    categoryId: DEFAULT_CATEGORY_IDS.salary,
    description: 'Зарплата',
    clientRequestId: 'backup-income',
  });
  await createTransaction(database, {
    kind: 'expense',
    amountMinor: 7_000_00,
    accountId: debit.id,
    categoryId: DEFAULT_CATEGORY_IDS.groceries,
    description: 'Продукты',
    clientRequestId: 'backup-expense',
  });
  await createTransaction(database, {
    kind: 'transfer',
    amountMinor: 10_000_00,
    fromAccountId: debit.id,
    toAccountId: cash.id,
    clientRequestId: 'backup-transfer',
  });
  await createTransaction(database, {
    kind: 'credit_payment',
    amountMinor: 3_000_00,
    fromAccountId: debit.id,
    toAccountId: credit.id,
    clientRequestId: 'backup-credit-payment',
  });
  await createDebt(database, {
    direction: 'owed_to_me',
    counterparty: 'Друг',
    amountMinor: 15_000_00,
    dueDate: addDays(todayKey(), 20),
  });
  await createGoal(database, { name: 'Отпуск', targetMinor: 100_000_00, savedMinor: 20_000_00 });
  await createPlannedPayment(database, {
    name: 'Аренда',
    amountMinor: 30_000_00,
    dayOfMonth: 5,
    accountId: debit.id,
  });
  await createPlannedInflow(database, {
    name: 'Зарплата',
    amountMinor: 30_000_00,
    expectedDate: addDays(todayKey(), 10),
    confidence: 'likely',
  });
  await setBudget(database, monthKey(), 50_000_00);
}

async function plainFile(database: FinanceDB): Promise<BackupFile> {
  return exportBackup(database);
}

describe('backup and restore', () => {
  let source: FinanceDB;
  let target: FinanceDB;

  beforeEach(async () => {
    source = await openTestDb();
    target = await openTestDb();
    await seed(source);
  });

  afterEach(async () => {
    await source.delete();
    await target.delete();
  });

  it('exports a versioned backup with a valid checksum and complete data', async () => {
    const file = await plainFile(source);
    expect(file.format).toBe('personal-finance-backup');
    expect(file.formatVersion).toBe(1);
    expect(file.appVersion).toBeTruthy();
    expect(file.data.transactions).toHaveLength(4);
    expect(file.data.entries).toHaveLength(8);
    expect(file.counts).toEqual(backupCounts(file.data));

    const loaded = await readBackup(serializeBackup(file));
    expect(loaded.wasEncrypted).toBe(false);
    expect(loaded.file.data.transactions).toHaveLength(4);
    expect(loaded.file.data.debts).toHaveLength(1);
    expect(loaded.file.data.goals).toHaveLength(1);
    expect(loaded.file.data.settings).toHaveLength(1);
  });

  it('restores into another database with identical balances and no duplicates', async () => {
    const file = await plainFile(source);
    const result = await importBackup(target, file, 'replace');
    expect(result.mode).toBe('replace');
    expect(result.added.transactions).toBe(4);
    expect(result.added.accounts).toBe(3);

    const sourceSnapshot = await readSnapshot(source);
    const targetSnapshot = await readSnapshot(target);
    expect(moneyOverview(targetSnapshot).ownFundsMinor).toBe(
      moneyOverview(sourceSnapshot).ownFundsMinor,
    );
    expect(targetSnapshot.transactions).toHaveLength(4);
    expect(targetSnapshot.debts).toHaveLength(1);
    expect(targetSnapshot.goals).toHaveLength(1);
    expect(targetSnapshot.budgets).toHaveLength(1);
    expect(targetSnapshot.plannedPayments).toHaveLength(1);
    expect(targetSnapshot.plannedInflows).toHaveLength(1);
    expect(targetSnapshot.settings.onboardingComplete).toBe(true);

    // Replacing again must not duplicate anything.
    await importBackup(target, file, 'replace');
    expect(await target.transactions.count()).toBe(4);
    expect(await target.entries.count()).toBe(8);
  });

  it('skips existing records on merge and reports warnings', async () => {
    const file = await plainFile(source);
    await importBackup(target, file, 'replace');

    const merged = await importBackup(target, file, 'merge');
    expect(merged.added.transactions).toBe(0);
    expect(merged.skipped.transactions).toBe(4);
    expect(merged.warnings.length).toBeGreaterThan(0);
    expect(await target.transactions.count()).toBe(4);
    expect(await target.entries.count()).toBe(8);
  });

  it('round-trips a password-encrypted backup without storing the password', async () => {
    const file = await plainFile(source);
    const envelope = await encryptBackup(file, 'correct horse battery');
    expect(envelope.format).toBe(ENCRYPTED_BACKUP_FORMAT);
    expect(envelope.kdf.iterations).toBeGreaterThanOrEqual(210_000);
    expect(JSON.stringify(envelope)).not.toContain('correct horse battery');

    const parsed = parseBackupJson(JSON.stringify(envelope));
    expect(parsed.kind).toBe('encrypted');
    if (parsed.kind === 'encrypted') {
      expect(parsed.envelope.payload).not.toContain('Зарплата');
    }

    const loaded = await readBackup(JSON.stringify(envelope), 'correct horse battery');
    expect(loaded.wasEncrypted).toBe(true);
    expect(loaded.file.data.transactions).toHaveLength(4);
    expect(loaded.file.checksum).toBe(file.checksum);

    await expect(readBackup(JSON.stringify(envelope), 'wrong password')).rejects.toThrow(
      'Неверный пароль',
    );
    await expect(readBackup(JSON.stringify(envelope))).rejects.toThrow('Введите пароль');
  });

  it('rejects damaged, tampered and future-version files', async () => {
    const file = await plainFile(source);
    const raw = JSON.parse(serializeBackup(file)) as Record<string, unknown>;
    const data = raw.data as { accounts: Array<{ openingBalanceMinor: number }> };
    data.accounts[0]!.openingBalanceMinor += 1;
    await expect(readBackup(JSON.stringify(raw))).rejects.toThrow('Контрольная сумма');

    const future = { ...JSON.parse(serializeBackup(file)), formatVersion: 2 };
    await expect(readBackup(JSON.stringify(future))).rejects.toThrow('более новой версией');

    await expect(readBackup('{not json')).rejects.toThrow(BackupError);
    await expect(readBackup('{}')).rejects.toThrow('Неизвестный формат');
  });

  it('keeps the checksum valid when a file is validated twice', async () => {
    // Regression: a naive JSON.stringify checksum breaks after the object is
    // parsed and re-serialized, which made real imports fail as "damaged".
    const file = await plainFile(source);
    const validatedOnce = await validateBackupFile(file);
    const validatedTwice = await validateBackupFile(validatedOnce);
    expect(validatedTwice.checksum).toBe(file.checksum);
    expect(validatedTwice.data.transactions).toHaveLength(4);
  });

  it('detects broken references before importing', async () => {
    const file = await plainFile(source);
    const brokenData = {
      ...file.data,
      transactions: file.data.transactions.map((transaction, index) =>
        index === 0 ? { ...transaction, accountId: 'missing-account' } : transaction,
      ),
    };
    const broken: BackupFile = {
      ...file,
      data: brokenData,
      counts: backupCounts(brokenData),
      checksum: await computeChecksum(brokenData),
    };
    await expect(validateBackupFile(broken)).rejects.toThrow('нет счёта');
    await expect(importBackup(target, broken, 'replace')).rejects.toThrow('нет счёта');

    // A modified object without a matching checksum is refused too.
    const tampered: BackupFile = {
      ...file,
      data: brokenData,
    };
    await expect(importBackup(target, tampered, 'replace')).rejects.toThrow('Контрольная сумма');
    expect(await target.transactions.count()).toBe(0);
  });
});

import type { AppSettings } from '../domain/types.ts';
import { settingsDefaults } from '../domain/finance.ts';
import { nowIso } from '../lib/dates.ts';
import type { FinanceDB } from './db.ts';
import { auditRecord } from './audit.ts';

export async function getSettings(database: FinanceDB): Promise<AppSettings> {
  return (await database.settings.get('app')) ?? settingsDefaults();
}

export async function updateSettings(
  database: FinanceDB,
  patch: Partial<Omit<AppSettings, 'id' | 'createdAt' | 'currency'>>,
): Promise<AppSettings> {
  return database.transaction('rw', database.settings, database.audit, async () => {
    const current = (await database.settings.get('app')) ?? settingsDefaults();
    if (patch.monthlyBudgetMinor !== undefined) {
      if (!Number.isSafeInteger(patch.monthlyBudgetMinor) || patch.monthlyBudgetMinor < 0) {
        throw new Error('Бюджет должен быть неотрицательной суммой в копейках');
      }
    }
    if (patch.theme !== undefined && !['system', 'light', 'dark'].includes(patch.theme)) {
      throw new Error('Неизвестная тема');
    }
    const next: AppSettings = {
      ...current,
      ...patch,
      id: 'app',
      currency: 'RUB',
      updatedAt: nowIso(),
    };
    await database.settings.put(next);
    await database.audit.add(
      auditRecord('settings.update', 'settings', 'app', snapshotSettings(current), snapshotSettings(next)),
    );
    return next;
  });
}

function snapshotSettings(settings: AppSettings) {
  return {
    onboardingComplete: settings.onboardingComplete,
    monthlyBudgetMinor: settings.monthlyBudgetMinor,
    defaultAccountId: settings.defaultAccountId,
    theme: settings.theme,
    lastBackupAt: settings.lastBackupAt,
  };
}

export async function markBackupDone(database: FinanceDB, formatVersion: number): Promise<void> {
  await database.transaction('rw', database.settings, async () => {
    const current = (await database.settings.get('app')) ?? settingsDefaults();
    await database.settings.put({
      ...current,
      lastBackupAt: nowIso(),
      lastBackupFormat: formatVersion,
      updatedAt: nowIso(),
    });
  });
}

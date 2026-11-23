import type { Db } from '../db.ts';
import { nowIso } from '../lib/ids.ts';
import { audit } from '../lib/audit.ts';

export type AppSettings = {
  budgetTargetMinor: number;
  budgetIsTentative: boolean;
  bufferMinor: number;
  lockTimeoutMinutes: number;
  theme: string;
  currency: string;
};

const DEFAULTS: AppSettings = {
  budgetTargetMinor: 600_000,
  budgetIsTentative: true,
  bufferMinor: 200_000,
  lockTimeoutMinutes: 15,
  theme: 'system',
  currency: 'RUB',
};

export function getSettings(db: Db, userId: string): AppSettings {
  const rows = db
    .prepare('SELECT key, value FROM app_settings WHERE user_id = ?')
    .all(userId) as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((row) => [row.key, row.value]));

  const numberValue = (key: string, fallback: number) => {
    const raw = map.get(key);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };

  return {
    budgetTargetMinor: numberValue('budget_target_minor', DEFAULTS.budgetTargetMinor),
    budgetIsTentative: map.get('budget_is_tentative') !== '0',
    bufferMinor: numberValue('buffer_minor', DEFAULTS.bufferMinor),
    lockTimeoutMinutes: numberValue('lock_timeout_minutes', DEFAULTS.lockTimeoutMinutes),
    theme: map.get('theme') ?? DEFAULTS.theme,
    currency: map.get('currency') ?? DEFAULTS.currency,
  };
}

export type SettingsPatch = Partial<{
  budgetTargetMinor: number;
  budgetIsTentative: boolean;
  bufferMinor: number;
  lockTimeoutMinutes: number;
  theme: string;
}>;

export function updateSettings(db: Db, userId: string, patch: SettingsPatch): AppSettings {
  const before = getSettings(db, userId);
  const entries: Array<[string, string]> = [];

  if (patch.budgetTargetMinor !== undefined) {
    if (!Number.isSafeInteger(patch.budgetTargetMinor) || patch.budgetTargetMinor < 0) {
      throw new Error('Бюджет должен быть неотрицательным целым числом копеек');
    }
    entries.push(['budget_target_minor', String(patch.budgetTargetMinor)]);
  }
  if (patch.budgetIsTentative !== undefined) {
    entries.push(['budget_is_tentative', patch.budgetIsTentative ? '1' : '0']);
  }
  if (patch.bufferMinor !== undefined) {
    if (!Number.isSafeInteger(patch.bufferMinor) || patch.bufferMinor < 0) {
      throw new Error('Резерв должен быть неотрицательным целым числом копеек');
    }
    entries.push(['buffer_minor', String(patch.bufferMinor)]);
  }
  if (patch.lockTimeoutMinutes !== undefined) {
    const allowed = [5, 15, 30, 60, 0];
    if (!allowed.includes(patch.lockTimeoutMinutes)) {
      throw new Error('Таймаут блокировки: 5, 15, 30, 60 минут или 0 (никогда)');
    }
    entries.push(['lock_timeout_minutes', String(patch.lockTimeoutMinutes)]);
  }
  if (patch.theme !== undefined) {
    if (!['system', 'light', 'dark'].includes(patch.theme)) throw new Error('Неизвестная тема');
    entries.push(['theme', patch.theme]);
  }

  const now = nowIso();
  for (const [key, value] of entries) {
    db.prepare(
      `INSERT INTO app_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(userId, key, value, now);
  }

  const after = getSettings(db, userId);
  if (entries.length > 0) {
    audit(db, {
      userId,
      action: 'settings.update',
      entity: 'settings',
      entityId: null,
      before,
      after,
    });
  }
  return after;
}

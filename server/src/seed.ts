import { newId, nowIso } from './lib/ids.ts';
import type { Db } from './db.ts';

type CategorySeed = {
  name: string;
  kind: 'income' | 'expense' | 'adjustment';
  icon: string;
  color: string;
  target?: number;
};

const CATEGORIES: CategorySeed[] = [
  { name: 'Пенсия', kind: 'income', icon: '🏛️', color: '#127A52' },
  { name: 'Подработка', kind: 'income', icon: '🧰', color: '#127A52' },
  { name: 'Подарок', kind: 'income', icon: '🎁', color: '#127A52' },
  { name: 'Прочий доход', kind: 'income', icon: '➕', color: '#127A52' },
  { name: 'Продукты', kind: 'expense', icon: '🛒', color: '#A63D33', target: 300_000 },
  { name: 'Кафе', kind: 'expense', icon: '☕', color: '#A63D33', target: 150_000 },
  { name: 'Транспорт', kind: 'expense', icon: '🚌', color: '#A63D33', target: 100_000 },
  { name: 'Дом', kind: 'expense', icon: '🏠', color: '#A63D33', target: 150_000 },
  { name: 'Здоровье', kind: 'expense', icon: '💊', color: '#A63D33', target: 100_000 },
  { name: 'Связь', kind: 'expense', icon: '📱', color: '#A63D33', target: 50_000 },
  { name: 'Развлечения', kind: 'expense', icon: '🎮', color: '#A63D33', target: 50_000 },
  { name: 'Одежда', kind: 'expense', icon: '👕', color: '#A63D33', target: 50_000 },
  { name: 'Другое', kind: 'expense', icon: '•', color: '#A63D33', target: 50_000 },
  { name: 'Стартовый баланс', kind: 'adjustment', icon: '⚖️', color: '#6B6B76' },
  { name: 'Корректировка', kind: 'adjustment', icon: '✏️', color: '#6B6B76' },
];

type AccountSeed = {
  name: string;
  type: 'cash' | 'debit' | 'credit' | 'receivable' | 'asset_illiquid';
  opening: number;
  creditLimit?: number;
  statementDay?: number;
  paymentDueDay?: number;
  isLiquid: 0 | 1;
  note?: string;
};

const ACCOUNTS: AccountSeed[] = [
  { name: 'Наличные', type: 'cash', opening: 500_000, isLiquid: 1 },
  { name: 'Т-Банк Black', type: 'debit', opening: 400_000, isLiquid: 1 },
  {
    name: 'Т-Банк Platinum',
    type: 'credit',
    opening: -4_100_000,
    creditLimit: 10_000_000,
    statementDay: 29,
    paymentDueDay: 22,
    isLiquid: 0,
  },
  { name: 'Долг родственника', type: 'receivable', opening: 1_500_000, isLiquid: 1 },
  {
    name: 'Steam-инвентарь',
    type: 'asset_illiquid',
    opening: 750_000,
    isLiquid: 0,
    note: 'Оценка 5 000–10 000 ₽. Неликвид, не входит в доступные средства.',
  },
];

const SEED_AT = '2026-11-21T09:00:00.000Z';

export function seedUserData(db: Db, userId: string, lockTimeoutMinutes = 15): void {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?').get(userId);
  if (Number(existing?.count ?? 0) > 0) return;

  const now = nowIso();
  const categoryIds = new Map<string, string>();
  CATEGORIES.forEach((category, index) => {
    const id = newId();
    categoryIds.set(category.name, id);
    db.prepare(
      `INSERT INTO categories (id, user_id, name, kind, icon, color, is_system, sort_order, monthly_target_minor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      userId,
      category.name,
      category.kind,
      category.icon,
      category.color,
      category.name === 'Стартовый баланс' || category.name === 'Корректировка' ? 1 : 0,
      index,
      category.target ?? null,
      now,
    );
  });

  const accountIds = new Map<string, string>();
  ACCOUNTS.forEach((account, index) => {
    const id = newId();
    accountIds.set(account.name, id);
    db.prepare(
      `INSERT INTO accounts
       (id, user_id, name, type, currency, credit_limit_minor, statement_day, payment_due_day, is_liquid, sort_order, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'RUB', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      userId,
      account.name,
      account.type,
      account.creditLimit ?? null,
      account.statementDay ?? null,
      account.paymentDueDay ?? null,
      account.isLiquid,
      index,
      account.note ?? null,
      now,
      now,
    );
  });

  const openingCategoryId = categoryIds.get('Стартовый баланс')!;
  for (const account of ACCOUNTS) {
    if (account.opening === 0) continue;
    const accountId = accountIds.get(account.name)!;
    const txId = newId();
    db.prepare(
      `INSERT INTO transactions
       (id, user_id, kind, occurred_at, description, source, review_status, created_at, updated_at, rev)
       VALUES (?, ?, 'adjustment', ?, ?, 'seed', 'ok', ?, ?, 1)`,
    ).run(txId, userId, SEED_AT, 'Стартовый баланс (введено вручную)', now, now);
    db.prepare(
      'INSERT INTO ledger_entries (id, transaction_id, account_id, category_id, amount_minor) VALUES (?, ?, ?, NULL, ?)',
    ).run(newId(), txId, accountId, account.opening);
    db.prepare(
      'INSERT INTO ledger_entries (id, transaction_id, account_id, category_id, amount_minor) VALUES (?, NULL, ?, ?, ?)',
    ).run(newId(), txId, openingCategoryId, -account.opening);
  }

  const debitId = accountIds.get('Т-Банк Black')!;
  const transportId = categoryIds.get('Транспорт')!;
  const cafeId = categoryIds.get('Кафе')!;
  db.prepare(
    `INSERT INTO templates (id, user_id, name, kind, amount_minor, account_id, category_id, icon, sort_order, usage_count, created_at)
     VALUES (?, ?, ?, 'expense', ?, ?, ?, ?, 0, 0, ?)`,
  ).run(newId(), userId, 'Проезд 60 ₽', 6_000, debitId, transportId, '🚌', now);
  db.prepare(
    `INSERT INTO templates (id, user_id, name, kind, amount_minor, account_id, category_id, icon, sort_order, usage_count, created_at)
     VALUES (?, ?, ?, 'expense', ?, ?, ?, ?, 1, 0, ?)`,
  ).run(newId(), userId, 'Кофе 250 ₽', 25_000, debitId, cafeId, '☕', now);

  db.prepare(
    `INSERT INTO planned_inflows (id, user_id, name, amount_minor, expected_date, window_start, window_end, confidence, note, created_at)
     VALUES (?, ?, 'Пенсия', ?, NULL, 21, 31, 'confirmed', 'Сумма известна, точный день — нет', ?)`,
  ).run(newId(), userId, 1_300_000, now);
  db.prepare(
    `INSERT INTO planned_inflows (id, user_id, name, amount_minor, expected_date, window_start, window_end, confidence, note, created_at)
     VALUES (?, ?, 'Возможный подарок', ?, NULL, NULL, NULL, 'possible', 'Не гарантирован, в бюджет не входит', ?)`,
  ).run(newId(), userId, 1_500_000, now);

  const creditId = accountIds.get('Т-Банк Platinum')!;
  db.prepare(
    `INSERT INTO credit_statements
     (id, user_id, account_id, period_start, period_end, due_date, grace_end_date, total_due_minor, min_payment_minor, paid_minor, status, note, created_at, updated_at, rev)
     VALUES (?, ?, ?, '2026-10-29', '2026-11-29', '2026-12-22', NULL, NULL, NULL, 0, 'open', 'Сумма к оплате не указана', ?, ?, 1)`,
  ).run(newId(), userId, creditId, now, now);

  const settings: Array<[string, string]> = [
    ['budget_target_minor', '600000'],
    ['budget_is_tentative', '1'],
    ['buffer_minor', '200000'],
    ['lock_timeout_minutes', String(lockTimeoutMinutes)],
    ['theme', 'system'],
    ['currency', 'RUB'],
  ];
  for (const [key, value] of settings) {
    db.prepare(
      'INSERT INTO app_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
    ).run(userId, key, value, now);
  }
}

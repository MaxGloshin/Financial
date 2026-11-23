import type { Category } from '../domain/types.ts';
import { settingsDefaults } from '../domain/finance.ts';
import type { FinanceDB } from './db.ts';

const EXPENSE_ICONS = [
  'shopping-basket',
  'home',
  'bus',
  'utensils',
  'heart-pulse',
  'smartphone',
  'clapperboard',
  'shirt',
  'repeat',
  'graduation-cap',
  'paw-print',
  'circle-ellipsis',
];

const INCOME_ICONS = ['wallet', 'laptop', 'gift', 'piggy-bank', 'circle-plus'];

const EXPENSE_NAMES = [
  'Продукты',
  'Жильё',
  'Транспорт',
  'Кафе',
  'Здоровье',
  'Связь',
  'Развлечения',
  'Одежда',
  'Подписки',
  'Образование',
  'Питомцы',
  'Прочее',
];

const INCOME_NAMES = ['Зарплата', 'Фриланс', 'Подарки', 'Проценты', 'Прочее'];

const COLORS = [
  '#10b981',
  '#3b82f6',
  '#f59e0b',
  '#f97316',
  '#f43f5e',
  '#8b5cf6',
  '#ec4899',
  '#d946ef',
  '#06b6d4',
  '#6366f1',
  '#84cc16',
  '#64748b',
];

function categoryId(index: number): string {
  return `c0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

export function defaultCategories(now = new Date().toISOString()): Category[] {
  const expenses: Category[] = EXPENSE_NAMES.map((name, index) => ({
    id: categoryId(index),
    name,
    kind: 'expense',
    icon: EXPENSE_ICONS[index]!,
    color: COLORS[index]!,
    sortOrder: index,
    isSystem: true,
    createdAt: now,
    updatedAt: now,
  }));
  const income: Category[] = INCOME_NAMES.map((name, index) => ({
    id: categoryId(EXPENSE_NAMES.length + index),
    name,
    kind: 'income',
    icon: INCOME_ICONS[index]!,
    color: COLORS[(EXPENSE_NAMES.length + index) % COLORS.length]!,
    sortOrder: index,
    isSystem: true,
    createdAt: now,
    updatedAt: now,
  }));
  return [...expenses, ...income];
}

export const DEFAULT_CATEGORY_IDS = {
  groceries: categoryId(0),
  housing: categoryId(1),
  transport: categoryId(2),
  cafe: categoryId(3),
  health: categoryId(4),
  communication: categoryId(5),
  entertainment: categoryId(6),
  clothes: categoryId(7),
  subscriptions: categoryId(8),
  education: categoryId(9),
  pets: categoryId(10),
  otherExpense: categoryId(11),
  salary: categoryId(12),
  freelance: categoryId(13),
  gifts: categoryId(14),
  interest: categoryId(15),
  otherIncome: categoryId(16),
} as const;

/** Creates settings and the default category list on a fresh database. */
export async function ensureBaseData(database: FinanceDB): Promise<void> {
  await database.transaction('rw', database.settings, database.categories, async () => {
    const settings = await database.settings.get('app');
    if (!settings) {
      await database.settings.add(settingsDefaults());
    }
    const count = await database.categories.count();
    if (count === 0) {
      await database.categories.bulkAdd(defaultCategories());
    }
  });
}

import type { Category, CategoryKind } from '../domain/types.ts';
import { nowIso } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import type { FinanceDB } from './db.ts';
import { auditRecord } from './audit.ts';

export type CategoryInput = {
  name: string;
  kind: CategoryKind;
  icon?: string;
  color?: string;
};

export async function createCategory(
  database: FinanceDB,
  input: CategoryInput,
): Promise<Category> {
  if (!input.name.trim()) throw new Error('Введите название категории');
  if (!['expense', 'income'].includes(input.kind)) throw new Error('Неизвестный тип категории');
  return database.transaction('rw', database.categories, database.audit, async () => {
    const count = await database.categories.where('kind').equals(input.kind).count();
    const now = nowIso();
    const category: Category = {
      id: newId(),
      name: input.name.trim().slice(0, 60),
      kind: input.kind,
      icon: input.icon ?? (input.kind === 'income' ? 'wallet' : 'circle-ellipsis'),
      color: input.color ?? '#64748b',
      sortOrder: count,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    };
    await database.categories.add(category);
    await database.audit.add(
      auditRecord('category.create', 'category', category.id, undefined, {
        name: category.name,
        kind: category.kind,
      }),
    );
    return category;
  });
}

export async function updateCategory(
  database: FinanceDB,
  id: string,
  patch: Partial<CategoryInput>,
): Promise<Category> {
  return database.transaction('rw', database.categories, database.audit, async () => {
    const existing = await database.categories.get(id);
    if (!existing) throw new Error('Категория не найдена');
    const next: Category = {
      ...existing,
      name: (patch.name ?? existing.name).trim().slice(0, 60),
      icon: patch.icon ?? existing.icon,
      color: patch.color ?? existing.color,
      updatedAt: nowIso(),
    };
    if (!next.name) throw new Error('Введите название категории');
    await database.categories.put(next);
    await database.audit.add(
      auditRecord('category.update', 'category', id, { name: existing.name }, { name: next.name }),
    );
    return next;
  });
}

export async function deleteCategory(database: FinanceDB, id: string): Promise<void> {
  await database.transaction('rw', database.categories, database.entries, database.audit, async () => {
    const existing = await database.categories.get(id);
    if (!existing) throw new Error('Категория не найдена');
    if (existing.isSystem) throw new Error('Системную категорию нельзя удалить');
    const used = await database.entries.where('categoryId').equals(id).count();
    if (used > 0) throw new Error('По категории есть операции — удалить нельзя');
    await database.categories.delete(id);
    await database.audit.add(
      auditRecord('category.delete', 'category', id, { name: existing.name }, undefined),
    );
  });
}

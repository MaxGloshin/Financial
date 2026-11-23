import type { AuditLog } from '../domain/types.ts';
import { nowIso } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';

export function auditRecord(
  action: string,
  entity: string,
  entityId: string | null,
  before?: unknown,
  after?: unknown,
): AuditLog {
  return {
    id: newId(),
    at: nowIso(),
    action,
    entity,
    entityId,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  };
}

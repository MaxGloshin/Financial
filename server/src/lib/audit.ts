import { newId, nowIso } from '../lib/ids.ts';
import type { Db } from '../db.ts';

export type AuditInput = {
  userId: string;
  actor?: string;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
};

export function audit(db: Db, input: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_log (id, user_id, at, actor, action, entity, entity_id, before_json, after_json, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    input.userId,
    nowIso(),
    input.actor ?? 'user',
    input.action,
    input.entity,
    input.entityId ?? null,
    input.before === undefined ? null : JSON.stringify(input.before),
    input.after === undefined ? null : JSON.stringify(input.after),
    input.requestId ?? null,
  );
}

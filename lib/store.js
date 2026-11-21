// Opslag-interface plus een in-memory variant voor lokaal draaien en tests.
//
// @typedef {{ id: string, data: object, upd: number, deleted: boolean }} Row
// @typedef {{
//   init(): Promise<void>,
//   list(): Promise<Row[]>,
//   upsert(id: string, data: object, upd: number, deleted: boolean, opts?: { synced?: boolean }): Promise<boolean>,
//   unsynced(limit: number, opts?: { costs?: boolean }): Promise<Row[]>,  // nog niet in de spreadsheet
//   markSynced(id: string, upd: number): Promise<void>,
//   ping(): Promise<void>,
// }} Store

/** @returns {Store} */
export function memoryStore() {
  const rows = new Map();
  return {
    async init() {},
    async ping() {},
    async list() {
      return [...rows.values()].map(({ sheetUpd, ...r }) => ({ ...r }));
    },
    async upsert(id, data, upd, deleted, { synced = false } = {}) {
      const cur = rows.get(id);
      if (cur && cur.upd >= upd) return false;
      rows.set(id, { id, data, upd, deleted, sheetUpd: Math.max(cur?.sheetUpd ?? 0, synced ? upd : 0) });
      return true;
    },
    async unsynced(limit, { costs = true } = {}) {
      return [...rows.values()].filter((r) => r.sheetUpd < r.upd && r.data?.type !== 'park' && r.id !== 'parkeerplek' && (costs || r.data?.type !== 'kost')).sort((a, b) => a.upd - b.upd).slice(0, limit)
        .map(({ sheetUpd, ...r }) => ({ ...r }));
    },
    async markSynced(id, upd) {
      const r = rows.get(id);
      if (r) r.sheetUpd = Math.max(r.sheetUpd, upd);
    },
  };
}

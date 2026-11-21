// Opslag-interface plus een in-memory variant voor lokaal draaien en tests.
//
// @typedef {{ id: string, data: object, upd: number, deleted: boolean }} Row
// @typedef {{
//   init(): Promise<void>,
//   list(): Promise<Row[]>,
//   upsert(id: string, data: object, upd: number, deleted: boolean): Promise<boolean>,
//   ping(): Promise<void>,
// }} Store

/** @returns {Store} */
export function memoryStore() {
  const rows = new Map();
  return {
    async init() {},
    async ping() {},
    async list() {
      return [...rows.values()].map((r) => ({ ...r }));
    },
    async upsert(id, data, upd, deleted) {
      const cur = rows.get(id);
      if (cur && cur.upd >= upd) return false;
      rows.set(id, { id, data, upd, deleted });
      return true;
    },
  };
}

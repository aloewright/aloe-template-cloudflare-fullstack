/* AGPL-3.0-or-later */
export type AudioRow = {
  id: string;
  r2_key: string;
  name: string;
  content_type: string;
  size: number;
  created_at: string;
};

export interface AudioStore {
  list(): Promise<AudioRow[]>;
  insert(row: AudioRow): Promise<void>;
  get(id: string): Promise<AudioRow | null>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const COLS = "id, r2_key, name, content_type, size, created_at";

// D1-backed store. Uses raw prepared statements (no ORM) so it stays
// self-contained and easy to fake in tests.
export function makeAudioStore(db: D1Database): AudioStore {
  return {
    async list() {
      const res = await db
        .prepare(`SELECT ${COLS} FROM audio_files ORDER BY created_at DESC`)
        .all();
      return res.results as unknown as AudioRow[];
    },
    async insert(row) {
      await db
        .prepare(`INSERT INTO audio_files (${COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(row.id, row.r2_key, row.name, row.content_type, row.size, row.created_at)
        .run();
    },
    async get(id) {
      return (await db
        .prepare(`SELECT ${COLS} FROM audio_files WHERE id = ?1`)
        .bind(id)
        .first()) as AudioRow | null;
    },
    async rename(id, name) {
      await db.prepare(`UPDATE audio_files SET name = ?1 WHERE id = ?2`).bind(name, id).run();
    },
    async remove(id) {
      await db.prepare(`DELETE FROM audio_files WHERE id = ?1`).bind(id).run();
    },
  };
}

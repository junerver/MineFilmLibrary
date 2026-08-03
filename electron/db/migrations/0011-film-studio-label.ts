import type Database from 'better-sqlite3';

// 0011 — 影片制作商/发行商独立字段。
//
// 此前 javbus 刮削把「制作商: XXX」「发行商: YYY」拼进 notes 文本；既无法按厂商聚合，
// 也无法在厂商页直接列出。本迁移：
//   1. 给 films 加 studio / label 两列（TEXT，可空）。
//   2. 扫描存量 notes，把「制作商:」「发行商:」（兼容繁体 製作/發行、全/半角冒号）
//      行的值解析回填到对应列（仅当列为 NULL，保证幂等），并把这两行从 notes 中移除，
//      保留其余行（发行日期 / 片长 / 来源 / 用户手写）。notes 清理后若为空则置 NULL。
//
// 解析用一次性 JS 扫描而非纯 SQL（SQLite 无内置正则替换）。
export function up(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(films)').all() as { name: string }[];
  const names = new Set(cols.map(c => c.name));
  if (!names.has('studio')) db.exec('ALTER TABLE films ADD COLUMN studio TEXT');
  if (!names.has('label')) db.exec('ALTER TABLE films ADD COLUMN label TEXT');

  // 匹配整行「制作商: 值」/「发行商: 值」，兼容繁简与全/半角冒号、行尾空白。
  // 值取到行末（不含换行）。
  const STUDIO_RE = /^[ \t]*[制製]作商[：:]\s*(.+?)[ \t]*$/m;
  const LABEL_RE = /^[ \t]*[发發]行商[：:]\s*(.+?)[ \t]*$/m;
  // 用于从 notes 中剔除「制作商: ...\n」「发行商: ...\n」整行（含其换行符）。
  const STRIP_STUDIO_RE = /[ \t]*[制製]作商[：:]\s*.+[ \t]*(?:\r?\n)?/g;
  const STRIP_LABEL_RE = /[ \t]*[发發]行商[：:]\s*.+[ \t]*(?:\r?\n)?/g;

  // 仅扫描 notes 中含关键字的行，避免全表处理。
  const rows = db.prepare(
    'SELECT id, notes, studio, label FROM films WHERE notes IS NOT NULL AND (notes LIKE ? OR notes LIKE ?)',
  ).all('%制作商:%', '%发行商:%') as {
    id: number; notes: string; studio: string | null; label: string | null
  }[];

  const updStudio = db.prepare('UPDATE films SET studio=? WHERE id=? AND studio IS NULL');
  const updLabel = db.prepare('UPDATE films SET label=? WHERE id=? AND label IS NULL');
  const updNotes = db.prepare('UPDATE films SET notes=? WHERE id=?');

  for (const r of rows) {
    const notes = r.notes ?? '';
    let nextStudio = r.studio;
    let nextLabel = r.label;

    if (nextStudio == null) {
      const m = notes.match(STUDIO_RE);
      if (m && m[1]) nextStudio = m[1].trim() || null;
    }
    if (nextLabel == null) {
      const m = notes.match(LABEL_RE);
      if (m && m[1]) nextLabel = m[1].trim() || null;
    }

    // 清理 notes 中这两行；保留其余内容。
    let nextNotes = notes.replace(STRIP_STUDIO_RE, '').replace(STRIP_LABEL_RE, '');
    // 收敛多余空行 / 首尾空白。空串归一成 NULL。
    nextNotes = nextNotes.replace(/\n{3,}/g, '\n\n').trim();
    const nextNotesVal: string | null = nextNotes.length > 0 ? nextNotes : null;

    // 只在确有变化时写库，减少无谓 UPDATE。
    if (nextStudio !== r.studio) updStudio.run(nextStudio, r.id);
    if (nextLabel !== r.label) updLabel.run(nextLabel, r.id);
    if (nextNotesVal !== notes) updNotes.run(nextNotesVal, r.id);
  }

  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(11);
}

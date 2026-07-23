import { ipcMain, shell } from 'electron';
import { getDb } from '../db';
import { nowMs } from '../db/dao';
import { addActorAlias, listActorAliases, removeActorAlias, mergeActors, resolveActorIdByName } from '../db/queries';
import { normalizeActorPageUrl, scrapeJavbusActorPage } from '../scraper/javbus';
import type { ActorRow } from '../util/types';

export function registerActorIpc() {
  ipcMain.handle('actors:list', () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT a.id, a.name, a.raw_dir_name, a.category, a.notes,
        a.birthday, a.age, a.height, a.cup, a.bust, a.waist, a.hips, a.measurements, a.hobby,
        a.javbus_url, NULL AS javbus_data_json, a.javbus_scraped_at,
        a.created_at, a.updated_at, COUNT(fa.film_id) film_count
      FROM actors a
      LEFT JOIN film_actors fa ON fa.actor_id=a.id
      GROUP BY a.id
      ORDER BY a.name
    `).all() as ActorRow[];
    // 一次群查所有别名，按 actor_id 在 JS 端聚合，避免 N+1。
    const allAliases = db.prepare('SELECT alias, actor_id FROM actor_aliases').all() as { alias: string; actor_id: number }[];
    const byActor = new Map<number, string[]>();
    for (const a of allAliases) {
      const arr = byActor.get(a.actor_id);
      if (arr) arr.push(a.alias);
      else byActor.set(a.actor_id, [a.alias]);
    }
    for (const r of rows) r.aliases = byActor.get(r.id) ?? [];
    return rows;
  });
  ipcMain.handle('actors:create', (_e, name: string, rawDirName?: string, category?: string, notes?: string) => {
    const now = nowMs();
    const r = getDb().prepare('INSERT INTO actors(name, raw_dir_name, category, notes, created_at, updated_at) VALUES(?,?,?,?,?,?)').run(name, rawDirName ?? null, category ?? null, notes ?? null, now, now);
    return Number(r.lastInsertRowid);
  });
  ipcMain.handle('actors:update', (_e, id: number, patch: {
    name?: string;
    category?: string | null;
    notes?: string | null;
    javbus_url?: string | null;
    birthday?: string | null;
    age?: string | null;
    height?: string | null;
    cup?: string | null;
    bust?: string | null;
    waist?: string | null;
    hips?: string | null;
    measurements?: string | null;
    hobby?: string | null;
  }) => {
    const sets: string[] = []; const args: any[] = [];
    if (patch.name !== undefined) { sets.push('name=?'); args.push(patch.name); }
    if (patch.category !== undefined) { sets.push('category=?'); args.push(patch.category); }
    if (patch.notes !== undefined) { sets.push('notes=?'); args.push(patch.notes); }
    for (const key of ['birthday', 'age', 'height', 'cup', 'bust', 'waist', 'hips', 'measurements', 'hobby'] as const) {
      if (patch[key] !== undefined) { sets.push(`${key}=?`); args.push(patch[key]); }
    }
    if (patch.javbus_url !== undefined) {
      const javbusUrl = patch.javbus_url?.trim() ? normalizeActorPageUrl(patch.javbus_url) : null;
      sets.push('javbus_url=?', 'javbus_data_json=NULL', 'javbus_scraped_at=NULL');
      args.push(javbusUrl);
    }
    if (!sets.length) return false;
    sets.push('updated_at=?'); args.push(nowMs()); args.push(id);
    getDb().prepare(`UPDATE actors SET ${sets.join(',')} WHERE id=?`).run(...args);
    return true;
  });
  ipcMain.handle('actors:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM actors WHERE id=?').run(id);
    return true;
  });
  ipcMain.handle('actors:films', (_e, actorId: number) => {
    return getDb().prepare(`SELECT f.* FROM films f JOIN film_actors fa ON fa.film_id=f.id WHERE fa.actor_id=? AND f.is_deleted=0`).all(actorId);
  });

  ipcMain.handle('actors:getJavbusData', (_e, actorId: number) => {
    const row = getDb().prepare('SELECT javbus_data_json FROM actors WHERE id=?').get(actorId) as { javbus_data_json: string | null } | undefined;
    if (!row?.javbus_data_json) return null;
    try { return JSON.parse(row.javbus_data_json); }
    catch { return null; }
  });

  ipcMain.handle('actors:scrapeJavbus', async (_e, actorId: number) => {
    const db = getDb();
    const actor = db.prepare('SELECT id, name, javbus_url FROM actors WHERE id=?').get(actorId) as { id: number; name: string; javbus_url: string | null } | undefined;
    if (!actor) throw new Error('演员不存在');
    if (!actor.javbus_url) throw new Error('请先配置该演员的 JavBus 主页地址');
    const scraped = await scrapeJavbusActorPage(actor.javbus_url);
    const scrapedAt = nowMs();
    db.prepare(`UPDATE actors
      SET javbus_url=?, javbus_data_json=?, javbus_scraped_at=?, updated_at=?,
        birthday=COALESCE(NULLIF(?, ''), birthday),
        age=COALESCE(NULLIF(?, ''), age),
        height=COALESCE(NULLIF(?, ''), height),
        cup=COALESCE(NULLIF(?, ''), cup),
        bust=COALESCE(NULLIF(?, ''), bust),
        waist=COALESCE(NULLIF(?, ''), waist),
        hips=COALESCE(NULLIF(?, ''), hips),
        measurements=COALESCE(NULLIF(?, ''), measurements),
        hobby=COALESCE(NULLIF(?, ''), hobby)
      WHERE id=?`
    ).run(
      scraped.pageUrl,
      JSON.stringify(scraped),
      scrapedAt,
      scrapedAt,
      scraped.profile.birthday,
      scraped.profile.age,
      scraped.profile.height,
      scraped.profile.cup,
      scraped.profile.bust,
      scraped.profile.waist,
      scraped.profile.hips,
      scraped.profile.measurements,
      scraped.profile.hobby,
      actorId,
    );
    // 网页显示名可能是本地演员的另一种写法。只有在该名称尚未归属其他演员时
    // 才加入别名，避免把一个已有 canonical 演员的名称抢到当前演员名下。
    const scrapedName = scraped.profile.name?.trim();
    if (scrapedName && scrapedName !== actor.name && resolveActorIdByName(db, scrapedName) == null) {
      addActorAlias(db, actorId, scrapedName);
    }
    return { ...scraped, scrapedAt };
  });

  ipcMain.handle('actors:openExternal', async (_e, rawUrl: string) => {
    let url: URL;
    try { url = new URL(String(rawUrl ?? '')); }
    catch { throw new Error('无效的外部链接'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只允许打开 http/https 链接');
    await shell.openExternal(url.href);
    return true;
  });

  // 自动补全用：按 q 在 name 或 alias 上做前缀 LIKE 匹配。
  // 命中 alias 时也带回 canonical actor 的 id+name，方便前端选中后直接落 actor_id。
  // 上限 20 防止输入很短时把整个库都拉回来。
  ipcMain.handle('actors:quickFind', (_e, q: string) => {
    const term = (q ?? '').trim();
    if (!term) return [];
    const like = `%${term}%`;
    return getDb().prepare(
      `SELECT DISTINCT a.id, a.name FROM actors a
         LEFT JOIN actor_aliases al ON al.actor_id = a.id
         WHERE a.name LIKE ? OR al.alias LIKE ?
         ORDER BY a.name LIMIT 20`
    ).all(like, like) as { id: number; name: string }[];
  });

  // —— 别名 + 合并 ——
  ipcMain.handle('actors:addAlias', (_e, actorId: number, alias: string) => {
    return addActorAlias(getDb(), actorId, alias);
  });
  ipcMain.handle('actors:removeAlias', (_e, alias: string) => {
    return removeActorAlias(getDb(), alias);
  });
  ipcMain.handle('actors:listAliases', (_e, actorId: number) => {
    return listActorAliases(getDb(), actorId);
  });
  ipcMain.handle('actors:merge', (_e, fromId: number, toId: number) => {
    mergeActors(getDb(), fromId, toId);
    return true;
  });
}

import type Database from 'better-sqlite3';
import { applyScanFallback } from './index';
import type { ScanAddedFilm } from './index';

export interface ScanFallbackStats {
  scrape_skipped: number;
  fallback_applied: number;
  fallback_fail: number;
}

export interface ScanFallbackProgress {
  stage: 'fallback';
  current: number;
  total: number;
  film: ScanAddedFilm;
}

/**
 * 批量刮削结束后，只给本次新入库且仍未刮削的影片应用目录兜底。
 * 已入库待续刮影片不重复套目录规则，避免覆盖后续人工维护的元数据。
 */
export function applyUnScrapedAddedFilmFallbacks(
  db: Database.Database,
  films: ScanAddedFilm[],
  onProgress?: (progress: ScanFallbackProgress) => void,
): ScanFallbackStats {
  const stats: ScanFallbackStats = {
    scrape_skipped: 0,
    fallback_applied: 0,
    fallback_fail: 0,
  };

  for (let index = 0; index < films.length; index++) {
    const film = films[index];
    if (!film.initializeMetadata) {
      stats.scrape_skipped++;
      continue;
    }

    const row = db.prepare('SELECT scraped_at FROM films WHERE id=?').get(film.filmId) as
      { scraped_at: number | null } | undefined;
    if (!row || row.scraped_at != null) continue;
    if (!film.code) stats.scrape_skipped++;

    onProgress?.({
      stage: 'fallback',
      current: index + 1,
      total: films.length,
      film,
    });
    try {
      if (applyScanFallback(db, film)) stats.fallback_applied++;
    } catch {
      stats.fallback_fail++;
    }
  }

  return stats;
}

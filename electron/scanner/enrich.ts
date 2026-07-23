import type Database from 'better-sqlite3';
import { applyScanFallback } from './index';
import type { ScanAddedFilm } from './index';

export interface ScanEnrichmentStats {
  scrape_ok: number;
  scrape_fail: number;
  scrape_skipped: number;
  fallback_applied: number;
  fallback_fail: number;
}

export interface ScanEnrichmentProgress {
  stage: 'scrape' | 'fallback';
  current: number;
  total: number;
  film: ScanAddedFilm;
  error?: string;
}

/** 扫描新增影片逐条刮削；失败只对该片应用目录识别兜底，不中断整次扫描。 */
export async function enrichAddedFilms(
  db: Database.Database,
  films: ScanAddedFilm[],
  scrapeFilm: (filmId: number) => Promise<unknown>,
  onProgress?: (progress: ScanEnrichmentProgress) => void,
): Promise<ScanEnrichmentStats> {
  const stats: ScanEnrichmentStats = {
    scrape_ok: 0,
    scrape_fail: 0,
    scrape_skipped: 0,
    fallback_applied: 0,
    fallback_fail: 0,
  };

  for (let index = 0; index < films.length; index++) {
    const film = films[index];
    const current = index + 1;
    let scrapeError: string | undefined;
    onProgress?.({ stage: 'scrape', current, total: films.length, film });

    // 同编号已经存在时只保留本次扫描写入的路径、编号和文件清单。
    // 自动刮削/目录兜底只用于该编号第一次进入整个影片库的记录。
    if (!film.initializeMetadata) {
      stats.scrape_skipped++;
      continue;
    }

    if (!film.code) {
      stats.scrape_skipped++;
      scrapeError = '未识别到编号';
    } else {
      try {
        await scrapeFilm(film.filmId);
        stats.scrape_ok++;
        continue;
      } catch (error: unknown) {
        stats.scrape_fail++;
        scrapeError = String((error as Error)?.message ?? error);
      }
    }

    onProgress?.({ stage: 'fallback', current, total: films.length, film, error: scrapeError });
    try {
      if (applyScanFallback(db, film)) stats.fallback_applied++;
    } catch {
      stats.fallback_fail++;
    }
  }

  return stats;
}

import { registerLibraryIpc } from './library';
import { registerActorIpc } from './actors';
import { registerGenreIpc } from './genres';
import { registerTagIpc } from './tags';
import { registerStudioIpc } from './studios';
import { registerScannerIpc } from './scanner';
import { registerFileIpc } from './files';
import { registerCoverIpc } from './cover';
import { registerExportIpc } from './export';
import { registerSettingsIpc } from './settings';
import { registerScrapeIpc } from './scrape';

export function registerAllIpc() {
  registerLibraryIpc();
  registerActorIpc();
  registerGenreIpc();
  registerTagIpc();
  registerStudioIpc();
  registerScannerIpc();
  registerFileIpc();
  registerCoverIpc();
  registerExportIpc();
  registerSettingsIpc();
  registerScrapeIpc();
}

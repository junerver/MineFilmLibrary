import { registerLibraryIpc } from './library';
import { registerActorIpc } from './actors';
import { registerGenreIpc } from './genres';
import { registerScannerIpc } from './scanner';
import { registerFileIpc } from './files';
import { registerCoverIpc } from './cover';
import { registerExportIpc } from './export';
import { registerSettingsIpc } from './settings';

export function registerAllIpc() {
  registerLibraryIpc();
  registerActorIpc();
  registerGenreIpc();
  registerScannerIpc();
  registerFileIpc();
  registerCoverIpc();
  registerExportIpc();
  registerSettingsIpc();
}

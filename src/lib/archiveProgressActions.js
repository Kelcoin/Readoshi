import { lrrApi } from './api';
import { removeHistoryItem, saveHistory } from './history';
import { clearArchiveProgressMarker, clearArchiveReadingProgress, markArchiveProgressCleared } from './archiveProgress';
import { clearReaderSnapshot, updateArchiveProgressInSessionSnapshots } from './sessionState';
import { dispatchReadingProgressChanged } from './readingProgress';
import { rememberArchiveProgressInCatalog } from './archiveMetadataCache';

export async function clearConfiguredArchiveReadingProgress(archive) {
  const result = await clearArchiveReadingProgress(archive, {
    api: lrrApi,
    removeHistory: removeHistoryItem,
    saveHistoryEntry: saveHistory,
  });
  const id = archive?.arcid || archive?.id;
  if (result.fallback) clearArchiveProgressMarker(id);
  else markArchiveProgressCleared(id);
  clearReaderSnapshot(id);
  updateArchiveProgressInSessionSnapshots(id, result.page);
  rememberArchiveProgressInCatalog(id, result.page);
  dispatchReadingProgressChanged({
    archiveId: id,
    page: result.page,
    total: archive?.pagecount,
    timestamp: Date.now(),
    cleared: true,
  });
  return result;
}

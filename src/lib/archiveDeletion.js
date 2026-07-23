import { clearArchiveSearchResponseCache, lrrApi } from './api';
import { removeArchivesFromCatalog } from './archiveMetadataCache';
import { extractEhGalleryUrl, getEhCookie, hasReadyEhFavoriteSync, removeEhFavorite, shouldSyncEhFavorite } from './ehFavoriteSync';
import { getSyncToken, getWorkerUrl } from './worker-config';

export async function deleteArchiveWithFavoriteSync(archive, { syncEnabled = false, confirmationEnabled = true } = {}) {
  const archiveId = archive?.arcid || archive?.id;
  if (!archiveId) throw new Error('档案 ID 缺失');
  if (shouldSyncEhFavorite(syncEnabled, confirmationEnabled)) {
    if (!hasReadyEhFavoriteSync()) throw new Error('E-Hentai 收藏同步配置无效，已停止删除档案');
    let galleryUrl = extractEhGalleryUrl(archive);
    if (!galleryUrl) {
      try { galleryUrl = extractEhGalleryUrl({ ...archive, ...await lrrApi.getArchive(archiveId) }); } catch {}
    }
    if (galleryUrl) await removeEhFavorite({ galleryUrl, cookie: getEhCookie(), workerUrl: getWorkerUrl(), token: getSyncToken() });
  }
  await lrrApi.deleteArchive(archiveId);
  removeArchivesFromCatalog(archiveId);
  clearArchiveSearchResponseCache();
  return archiveId;
}

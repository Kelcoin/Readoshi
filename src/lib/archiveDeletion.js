import { lrrApi } from './api';
import { extractEhGalleryUrl, getEhCookie, removeEhFavorite, shouldSyncEhFavorite } from './ehFavoriteSync';
import { getSyncToken, getWorkerUrl } from './worker-config';

export async function deleteArchiveWithFavoriteSync(archive, { syncEnabled = false, confirmationEnabled = true } = {}) {
  const archiveId = archive?.arcid || archive?.id;
  if (!archiveId) throw new Error('归档 ID 缺失');
  if (shouldSyncEhFavorite(syncEnabled, confirmationEnabled)) {
    let galleryUrl = extractEhGalleryUrl(archive);
    if (!galleryUrl) {
      try { galleryUrl = extractEhGalleryUrl({ ...archive, ...await lrrApi.getArchive(archiveId) }); } catch {}
    }
    if (galleryUrl) await removeEhFavorite({ galleryUrl, cookie: getEhCookie(), workerUrl: getWorkerUrl(), token: getSyncToken() });
  }
  await lrrApi.deleteArchive(archiveId);
  return archiveId;
}

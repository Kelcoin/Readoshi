export const READER_STAGE_STATUS = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
});

const createResourceState = (ready) => ({
  status: ready ? READER_STAGE_STATUS.READY : READER_STAGE_STATUS.LOADING,
  error: null,
});

export function createReaderRenderState({ hasMetadata = false, hasManifest = false, hasSelection = false } = {}) {
  return {
    metadata: createResourceState(hasMetadata),
    manifest: createResourceState(hasManifest),
    selection: createResourceState(hasSelection),
  };
}

export function readerRenderReducer(state, action) {
  if (action.type === 'reset') {
    return createReaderRenderState({
      hasMetadata: action.hasMetadata,
      hasManifest: action.hasManifest,
      hasSelection: action.hasSelection,
    });
  }

  if (!Object.hasOwn(state, action.resource)) return state;
  if (action.type === 'start') {
    return { ...state, [action.resource]: createResourceState(false) };
  }
  if (action.type === 'ready') {
    return { ...state, [action.resource]: createResourceState(true) };
  }
  if (action.type === 'error') {
    return {
      ...state,
      [action.resource]: { status: READER_STAGE_STATUS.ERROR, error: action.error || null },
    };
  }
  return state;
}

export function getReaderCapabilities(state, pageCount) {
  const canShowMetadata = state.metadata.status === READER_STAGE_STATUS.READY;
  const manifestReady = state.manifest.status === READER_STAGE_STATUS.READY;
  const selectionReady = state.selection.status === READER_STAGE_STATUS.READY;
  return {
    canShowMetadata,
    canShowPageCount: manifestReady,
    canNavigate: manifestReady && selectionReady && pageCount > 0,
    canRenderPage: manifestReady && selectionReady && pageCount > 0,
  };
}

export function isRetryableReaderBootstrapError(error) {
  if (error?.name === 'AbortError') return false;
  const status = Number(error?.status);
  if (!Number.isFinite(status) || status <= 0) return true;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function loadReaderBootstrapResource(
  load,
  { attempts = 3, isActive = () => true, wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay)) } = {},
) {
  const attemptLimit = Math.max(1, Math.floor(Number(attempts) || 1));
  let lastError = null;
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      lastError = error;
      const canRetry = attempt + 1 < attemptLimit
        && isActive()
        && isRetryableReaderBootstrapError(error);
      if (!canRetry) throw error;
      await wait(attempt === 0 ? 180 : 450);
      if (!isActive()) throw error;
    }
  }
  throw lastError;
}

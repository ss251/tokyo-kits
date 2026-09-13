import { loadWorldIdConfig } from '../../world-id-verify/server/config';
import { WorldIdError, WorldIdStore } from '../../world-id-verify/server/store';
import { createWorldIdService, type WorldIdService } from '../../world-id-verify/server/verify';

const state = globalThis as typeof globalThis & { tokyoWorldIdService?: WorldIdService };
export function worldIdService(): WorldIdService {
  if (!state.tokyoWorldIdService) {
    let config;
    try { config = loadWorldIdConfig(); } catch { throw new WorldIdError('world_id_not_configured', 503); }
    state.tokyoWorldIdService = createWorldIdService(config, new WorldIdStore(config.databasePath));
  }
  return state.tokyoWorldIdService;
}

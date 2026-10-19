import { env } from '../config/env.js';
import { MemoryRepository } from './memory-repository.js';
import { PostgresRepository } from './postgres-repository.js';
import type { ItineraryRepository } from './repository.js';

export const accountId = env.GOOGLE_ALLOWED_EMAIL?.toLowerCase() ?? 'local-default';
export const repository: ItineraryRepository = env.DATABASE_URL && env.NODE_ENV!=='test'
  ? new PostgresRepository(env.DATABASE_URL, accountId)
  : new MemoryRepository();

export async function initializeRepository(): Promise<void> {
  if (repository instanceof PostgresRepository) {
    await repository.pool.query('INSERT INTO accounts(id) VALUES($1) ON CONFLICT(id) DO NOTHING',[accountId]);
  }
}

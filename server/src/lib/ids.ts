import { v7 as uuidv7 } from 'uuid';

/**
 * UUID v7: monotonic, lex-sortable. Used for all PKs so:
 *   - Index pages stay sequential (B-tree friendly)
 *   - Time-of-creation is recoverable from the id
 */
export function newId(): string {
  return uuidv7();
}

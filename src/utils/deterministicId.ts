import 'react-native-get-random-values';
import { v5 as uuidv5 } from 'uuid';

// Fixed namespace so a stable slug always maps to the same recipe UUID across
// installs. Supabase's recipes.id is a `uuid` column — slug ids pass offline
// but fail every server push — so anything that needs a deterministic recipe
// id (catalog meals, seed recipes) derives a UUIDv5 from its slug.
// NEVER change this namespace or an existing slug; doing so orphans synced rows.
const RECIPE_ID_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

export function deterministicRecipeId(slug: string): string {
  return uuidv5(slug, RECIPE_ID_NAMESPACE);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

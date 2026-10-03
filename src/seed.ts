/** 内置牌例：3,3,8,8（分数解）与 1,1,1,1（明显无解） */

import type { Store } from "./db.js";

export function seedDefaults(store: Store): void {
  store.upsertDeck("classic-3388", "经典 3,3,8,8", [3, 3, 8, 8]);
  store.upsertDeck("ones-1111", "四个 1（无解示例）", [1, 1, 1, 1]);
}

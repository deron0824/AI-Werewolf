/**
 * 规则纯函数集（无状态、可单测，对应 PRD 验收要点 3/4）
 * 女巫边界 / 双狼仲裁 / 发言顺序 / 计票 / 屠城胜负判定。
 */

import { Phase, Role, type GameState, type GameConfig, type VoteRecord, type Winner } from '@werewolf/shared';

/** 洗牌发牌（Fisher-Yates，可注入随机源以便单测） */
export function shuffleRoles(roles: Role[], rng: () => number = Math.random): Role[] {
  const arr = [...roles];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 女巫用药约束校验（返回 null=合法，否则为拒绝原因）。
 *
 * 用药语义（Bug-2 修复，QA Round1）：
 * - 解药/毒药各自整局限一瓶（saveUsed/poisonUsed 为全历史推导，只约束各自药瓶）；
 * - 「同夜不可双药」由引擎结构性保证（collectWitchAction 每夜只收集一个动作，
 *   用救或用毒二选一），rules 层【不做跨夜历史互限】——第 1 夜用毒后，
 *   之后任何夜晚解药仍可用，反之亦然。
 */
export function witchConstraints(
  actionType: 'witch_save' | 'witch_poison' | 'skip',
  targetSeat: number | undefined,
  witchSeat: number,
  potionState: { saveUsed: boolean; poisonUsed: boolean },
  knifeTargetSeat: number | null,
  rules: GameConfig['rules'],
): string | null {
  if (actionType === 'skip') return null;
  if (actionType === 'witch_save') {
    if (potionState.saveUsed) return '解药已用完';
    if (knifeTargetSeat === null) return '无刀口可救';
    // 女巫不可自救（含首夜被刀）
    if (rules.witchNoSelfSave && targetSeat === witchSeat) return '女巫不可自救';
    // 解药只能救当晚刀口
    if (targetSeat !== undefined && knifeTargetSeat !== null && targetSeat !== knifeTargetSeat) {
      return '解药只能救当晚刀口目标';
    }
    return null;
  }
  // witch_poison：毒药整局限一瓶；跨夜不受解药使用史限制
  if (potionState.poisonUsed) return '毒药已用完';
  if (targetSeat === undefined || targetSeat === null) return '毒药必须指定目标';
  return null;
}

/** 双狼刀口仲裁：一致即用之；不一致随机取狼方提交之一；全部空刀则空刀 */
export function arbitrateWolfKill(
  targets: (number | null)[],
  rng: () => number = Math.random,
): number | null {
  const valid = targets.filter((t): t is number => t !== null);
  if (valid.length === 0) return null;
  const unique = new Set(valid);
  if (unique.size === 1) return valid[0];
  return valid[Math.floor(rng() * valid.length)];
}

/** 发言顺序：从 startSeat 的下一位存活玩家起按座位号循环 */
export function speechOrder(
  players: { seat: number; alive: boolean }[],
  startSeat: number,
): number[] {
  const aliveSeats = players.filter((p) => p.alive).map((p) => p.seat).sort((a, b) => a - b);
  if (aliveSeats.length === 0) return [];
  let fromIndex: number;
  const startIndex = aliveSeats.indexOf(startSeat);
  if (startIndex >= 0) {
    // startSeat 存活：从其下一位开始（环形）
    fromIndex = (startIndex + 1) % aliveSeats.length;
  } else {
    // startSeat 是死者座位（PRD：从死者下一位开始）：环形查找第一个座位号 > startSeat 的存活位；
    // 找不到（死者为最大座位）则回绕到最小存活位
    const next = aliveSeats.find((s) => s > startSeat);
    fromIndex = next !== undefined ? aliveSeats.indexOf(next) : 0;
  }
  const order: number[] = [];
  for (let i = 0; i < aliveSeats.length; i++) {
    order.push(aliveSeats[(fromIndex + i) % aliveSeats.length]);
  }
  return order;
}

/** 计票：返回按票数排序的 tally 明细 */
export function tallyVotes(votes: VoteRecord[]): { seat: number; count: number }[] {
  const counter = new Map<number, number>();
  for (const v of votes) {
    counter.set(v.targetSeat, (counter.get(v.targetSeat) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([seat, count]) => ({ seat, count }))
    .sort((a, b) => b.count - a.count || a.seat - b.seat);
}

/**
 * 平票处理：最高票唯一 → 出局该席位；多人同票 → 进 PK（返回 null + pkSeats）；
 * 无任何选票（理论不出现）→ 平安日。
 */
export function resolveTally(
  tally: { seat: number; count: number }[],
): { exiledSeat: number | null; pkSeats: number[] } {
  if (tally.length === 0 || tally[0].count === 0) {
    return { exiledSeat: null, pkSeats: [] };
  }
  const top = tally[0].count;
  const leaders = tally.filter((t) => t.count === top).map((t) => t.seat);
  if (leaders.length === 1) {
    return { exiledSeat: leaders[0], pkSeats: [] };
  }
  return { exiledSeat: null, pkSeats: leaders };
}

/** 屠城胜负判定（P0-4：好人人数 ≤ 狼人存活人数即狼胜；狼全灭好人胜） */
export function checkWin(
  players: { role: Role | null; alive: boolean }[],
  rules: GameConfig['rules'],
): { winner: Winner; reason: string } {
  const aliveWolves = players.filter((p) => p.alive && p.role === Role.WEREWOLF).length;
  const aliveGood = players.filter((p) => p.alive && p.role !== Role.WEREWOLF).length;
  if (aliveWolves === 0) {
    return { winner: 'VILLAGER', reason: '所有狼人已被放逐/死亡，好人阵营获胜！' };
  }
  if (rules.slaughterWin && aliveGood <= aliveWolves) {
    return { winner: 'WEREWOLF', reason: `好人仅剩 ${aliveGood} 人，不超过存活狼人数（${aliveWolves}），狼人阵营屠城获胜！` };
  }
  return { winner: null, reason: '' };
}

/** 昨夜死亡座位集合 → 白天发言起始座位（死者座位最大者的下一位；平安夜取最小存活座位） */
export function speechStartSeat(deathSeats: number[], aliveSeats: number[]): number {
  if (deathSeats.length > 0) {
    return Math.max(...deathSeats);
  }
  if (aliveSeats.length > 0) {
    return Math.min(...aliveSeats);
  }
  return 1;
}

/** 阶段是否允许该角色提交某类型夜间行动（引擎权限校验用） */
export function phaseAllowsAction(
  phase: Phase,
  role: Role | null,
  actionType: string,
): boolean {
  if (role === null) return false;
  switch (phase) {
    case Phase.NIGHT_WOLF:
      return role === Role.WEREWOLF && actionType === 'wolf_kill';
    case Phase.NIGHT_SEER:
      return role === Role.SEER && actionType === 'seer_check';
    case Phase.NIGHT_WITCH:
      if (role !== Role.WITCH) return false;
      return ['witch_save', 'witch_poison', 'skip'].includes(actionType);
    default:
      return false;
  }
}

/** 全量 GameState 便捷查询：某座位玩家 */
export function seatPlayer(state: GameState, seat: number) {
  return state.players.find((p) => p.seat === seat) ?? null;
}

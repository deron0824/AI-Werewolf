/**
 * Rules 纯函数单测（vitest）：女巫边界 / 双狼仲裁 / 发言顺序 / 计票 / 屠城判定。
 * 对应 PRD 验收要点 3/4。
 */

import { describe, expect, it } from 'vitest';

import { Role } from '@werewolf/shared';

import { ACTIVE_GAME_CONFIG } from '@werewolf/shared';
import {
  arbitrateWolfKill,
  checkWin,
  resolveTally,
  speechOrder,
  speechStartSeat,
  tallyVotes,
  witchConstraints,
} from '../src/game/rules';

const RULES = ACTIVE_GAME_CONFIG.rules;

describe('witchConstraints 女巫用药边界', () => {
  it('解药已用完 → 拒绝再救', () => {
    const reason = witchConstraints('witch_save', 3, 5, { saveUsed: true, poisonUsed: false }, 3, RULES);
    expect(reason).toContain('解药已用完');
  });

  it('跨夜不互限：前夜已用毒，本夜解药仍可用（Bug-2 回归）', () => {
    const reason = witchConstraints('witch_save', 3, 5, { saveUsed: false, poisonUsed: true }, 3, RULES);
    expect(reason).toBeNull();
  });

  it('跨夜不互限：第1夜用毒 → 第2夜可用解药（补单测，QA Round1）', () => {
    const reason = witchConstraints('witch_save', 4, 5, { saveUsed: false, poisonUsed: true }, 4, RULES);
    expect(reason).toBeNull();
  });

  it('跨夜不互限：第1夜用解药 → 第2夜可用毒（补单测，QA Round1）', () => {
    const reason = witchConstraints('witch_poison', 2, 5, { saveUsed: true, poisonUsed: false }, null, RULES);
    expect(reason).toBeNull();
  });

  it('整局各一瓶：解药与毒药用过即不可再用（跨药瓶互不影响）', () => {
    expect(witchConstraints('witch_save', 3, 5, { saveUsed: true, poisonUsed: false }, 3, RULES)).toContain('解药已用完');
    expect(witchConstraints('witch_poison', 2, 5, { saveUsed: false, poisonUsed: true }, null, RULES)).toContain('毒药已用完');
  });

  it('女巫不可自救（含首夜被刀）', () => {
    const reason = witchConstraints('witch_save', 5, 5, { saveUsed: false, poisonUsed: false }, 5, RULES);
    expect(reason).toContain('不可自救');
  });

  it('解药只能救当晚刀口', () => {
    const reason = witchConstraints('witch_save', 2, 5, { saveUsed: false, poisonUsed: false }, 3, RULES);
    expect(reason).toContain('只能救当晚刀口');
  });

  it('毒药已用完 → 拒绝再毒', () => {
    const reason = witchConstraints('witch_poison', 2, 5, { saveUsed: false, poisonUsed: true }, null, RULES);
    expect(reason).toContain('毒药已用完');
  });

  it('正常用药：救刀口合法', () => {
    const reason = witchConstraints('witch_save', 3, 5, { saveUsed: false, poisonUsed: false }, 3, RULES);
    expect(reason).toBeNull();
  });

  it('跳过永远合法', () => {
    const reason = witchConstraints('skip', undefined, 5, { saveUsed: true, poisonUsed: true }, null, RULES);
    expect(reason).toBeNull();
  });
});

describe('arbitrateWolfKill 双狼仲裁', () => {
  it('目标一致即用之', () => {
    expect(arbitrateWolfKill([3, 3])).toBe(3);
  });

  it('不一致随机取狼方提交之一（用固定随机源验证）', () => {
    const pick = arbitrateWolfKill([3, 5], () => 0.99); // floor(0.99*2)=1 → 取第二个提交
    expect(pick).toBe(5);
  });

  it('全部空刀 → 空刀', () => {
    expect(arbitrateWolfKill([null, null])).toBeNull();
  });

  it('一狼空刀一狼给目标 → 取有目标者', () => {
    expect(arbitrateWolfKill([null, 4])).toBe(4);
  });
});

describe('speechOrder 发言顺序', () => {
  const players = [
    { seat: 1, alive: false },
    { seat: 2, alive: true },
    { seat: 3, alive: true },
    { seat: 4, alive: true },
    { seat: 5, alive: true },
    { seat: 6, alive: true },
  ];

  it('从死者下一位开始并循环', () => {
    expect(speechOrder(players, 1)).toEqual([2, 3, 4, 5, 6]);
    expect(speechOrder(players, 5)).toEqual([6, 2, 3, 4, 5]);
  });

  it('起始位不在存活列表时从最小存活位开始', () => {
    expect(speechOrder(players, 1)).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('speechStartSeat 发言起始座位', () => {
  it('有死者取最大死者座位', () => {
    expect(speechStartSeat([2, 5], [1, 3, 4, 6])).toBe(5);
  });

  it('平安夜取最小存活座位', () => {
    expect(speechStartSeat([], [2, 3, 4])).toBe(2);
  });
});

describe('tallyVotes / resolveTally 计票与平票', () => {
  it('计票并按票数降序', () => {
    const votes = [
      { dayNumber: 1, isPK: false, voterSeat: 1, targetSeat: 3 },
      { dayNumber: 1, isPK: false, voterSeat: 2, targetSeat: 3 },
      { dayNumber: 1, isPK: false, voterSeat: 3, targetSeat: 5 },
      { dayNumber: 1, isPK: false, voterSeat: 4, targetSeat: 5 },
      { dayNumber: 1, isPK: false, voterSeat: 5, targetSeat: 2 },
      { dayNumber: 1, isPK: false, voterSeat: 6, targetSeat: 2 },
    ];
    expect(tallyVotes(votes)).toEqual([
      { seat: 2, count: 2 },
      { seat: 3, count: 2 },
      { seat: 5, count: 2 },
    ]);
  });

  it('最高票唯一 → 出局', () => {
    const tally = [
      { seat: 3, count: 3 },
      { seat: 5, count: 2 },
    ];
    expect(resolveTally(tally)).toEqual({ exiledSeat: 3, pkSeats: [] });
  });

  it('平票 → 进入 PK', () => {
    const tally = [
      { seat: 2, count: 2 },
      { seat: 3, count: 2 },
      { seat: 5, count: 1 },
    ];
    expect(resolveTally(tally)).toEqual({ exiledSeat: null, pkSeats: [2, 3] });
  });

  it('全员弃票 → 平安日', () => {
    expect(resolveTally([])).toEqual({ exiledSeat: null, pkSeats: [] });
  });
});

describe('checkWin 屠城胜负判定', () => {
  const mk = (aliveWolves: number, aliveGood: number) => [
    ...Array.from({ length: aliveWolves }, () => ({ role: Role.WEREWOLF, alive: true })),
    ...Array.from({ length: aliveGood }, () => ({ role: Role.VILLAGER, alive: true })),
  ];

  it('狼全灭 → 好人胜', () => {
    const result = checkWin([{ role: Role.WEREWOLF, alive: false }, { role: Role.VILLAGER, alive: true }], RULES);
    expect(result.winner).toBe('VILLAGER');
  });

  it('好人数 ≤ 狼人数 → 狼胜（屠城）', () => {
    const result = checkWin([...mk(2, 2), { role: Role.VILLAGER, alive: false }], RULES);
    expect(result.winner).toBe('WEREWOLF');
  });

  it('好人数 > 狼人数 → 未分胜负', () => {
    const result = checkWin(mk(2, 3), RULES);
    expect(result.winner).toBeNull();
  });
});

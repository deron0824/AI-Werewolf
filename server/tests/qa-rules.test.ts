/**
 * QA 补充边界测试（第 1 轮，测试人：Edward/严过关）
 * 覆盖工程师 rules.test.ts 未覆盖的边界：
 *   - 屠城判定边界（好人数 == 狼人数即狼胜）
 *   - 平票 PK 后再平票 = 平安日（resolveTally 幂等性）
 *   - 遗言规则开关（仅首夜死者 + 被放逐者有遗言，配置层校验）
 *   - 女巫毒药独立边界（毒药必须指定目标；历史夜晚用了解药不影响本夜用毒）
 *   - AI 女巫毒药不乱用（decideNightByRules 永不主动用毒、被刀不毒人复仇）
 *   - 发言顺序 PRD 合同（从死者下一位开始）——集成期望，验证 engine+rules 组合
 */

import { describe, expect, it } from 'vitest';

import { Role, SIX_PLAYER_CONFIG, type GameStateView } from '@werewolf/shared';

import {
  arbitrateWolfKill,
  checkWin,
  resolveTally,
  speechOrder,
  speechStartSeat,
  tallyVotes,
  witchConstraints,
} from '../src/game/rules';
import { decideNightByRules } from '../src/llm/templates';

const RULES = SIX_PLAYER_CONFIG.rules;

/** 构造最小 GameStateView（decideNightByRules 只用到这些字段） */
function witchView(opts: {
  selfSeat: number;
  aliveSeats: number[];
  knifeTarget?: number | null;
  saveUsed?: boolean;
  poisonUsed?: boolean;
}): GameStateView {
  return {
    roomId: 'r',
    dayNumber: 1,
    isNight: true,
    phase: 'NIGHT_WITCH' as never,
    players: opts.aliveSeats.map((seat) => ({
      seat,
      name: `P${seat}`,
      avatarId: 'ai',
      isHuman: false,
      alive: true,
    })),
    self: { seat: opts.selfSeat, name: '女巫', role: Role.WITCH, alive: true },
    speeches: [],
    voteSummary: { votedCount: 0, totalVoters: 0, tally: [], exiledSeat: null, isPK: false },
    wolfTeammates: undefined,
    witchKnifeTarget: opts.knifeTarget ?? null,
    potions: { saveUsed: opts.saveUsed ?? false, poisonUsed: opts.poisonUsed ?? false },
  };
}

describe('QA 补充：屠城胜负判定边界（PRD §2.3：好人数 ≤ 狼人数即狼胜）', () => {
  it('边界：好人数 == 狼人数（2v2）→ 狼胜', () => {
    const players = [
      { role: Role.WEREWOLF, alive: true },
      { role: Role.WEREWOLF, alive: true },
      { role: Role.VILLAGER, alive: true },
      { role: Role.VILLAGER, alive: true },
      { role: Role.SEER, alive: false },
      { role: Role.WITCH, alive: false },
    ];
    expect(checkWin(players, RULES).winner).toBe('WEREWOLF');
  });

  it('边界：1狼1民（1v1）→ 狼胜', () => {
    const players = [
      { role: Role.WEREWOLF, alive: true },
      { role: Role.SEER, alive: true },
      { role: Role.VILLAGER, alive: false },
    ];
    expect(checkWin(players, RULES).winner).toBe('WEREWOLF');
  });

  it('好人数比狼多 1（2狼 vs 3好人）→ 未分胜负', () => {
    const players = [
      { role: Role.WEREWOLF, alive: true },
      { role: Role.WEREWOLF, alive: true },
      { role: Role.VILLAGER, alive: true },
      { role: Role.VILLAGER, alive: true },
      { role: Role.SEER, alive: true },
      { role: Role.WITCH, alive: false },
    ];
    expect(checkWin(players, RULES).winner).toBeNull();
  });

  it('狼全灭（含被毒死）→ 好人胜', () => {
    const players = [
      { role: Role.WEREWOLF, alive: false },
      { role: Role.WEREWOLF, alive: false },
      { role: Role.VILLAGER, alive: true },
      { role: Role.SEER, alive: true },
    ];
    const r = checkWin(players, RULES);
    expect(r.winner).toBe('VILLAGER');
    expect(r.reason).toContain('好人阵营获胜');
  });

  it('非屠城板（slaughterWin=false）下 1v1 不判狼胜', () => {
    const players = [
      { role: Role.WEREWOLF, alive: true },
      { role: Role.SEER, alive: true },
    ];
    const rules = { ...RULES, slaughterWin: false };
    expect(checkWin(players, rules).winner).toBeNull();
  });
});

describe('QA 补充：平票 PK 与二次平票（PRD：再平票则平安日）', () => {
  it('三人同票 → 进入 PK（exiledSeat=null，pkSeats=平票者）', () => {
    const tally = [
      { seat: 2, count: 2 },
      { seat: 4, count: 2 },
      { seat: 5, count: 1 },
    ];
    expect(resolveTally(tally)).toEqual({ exiledSeat: null, pkSeats: [2, 4] });
  });

  it('PK 再投票仍平票 → resolveTally 仍返回 null（引擎据此判平安日，不得再递归 PK）', () => {
    const pkTally = [
      { seat: 2, count: 2 },
      { seat: 4, count: 2 },
    ];
    const outcome = resolveTally(pkTally);
    expect(outcome.exiledSeat).toBeNull();
    // 引擎层合同：二次 PK 座位不允许再次触发第三轮 PK（平安日兜底在 runVoteFlow）
    expect(outcome.pkSeats.length).toBeGreaterThan(0);
  });

  it('唯一最高票 → 出局该席位', () => {
    const tally = [
      { seat: 3, count: 3 },
      { seat: 1, count: 2 },
    ];
    expect(resolveTally(tally)).toEqual({ exiledSeat: 3, pkSeats: [] });
  });

  it('全弃票（tally 为空）→ 平安日', () => {
    expect(resolveTally([])).toEqual({ exiledSeat: null, pkSeats: [] });
  });

  it('tallyVotes 按票数降序、同票按座位升序（确定性）', () => {
    const votes = [
      { dayNumber: 1, isPK: false, voterSeat: 1, targetSeat: 5 },
      { dayNumber: 1, isPK: false, voterSeat: 2, targetSeat: 3 },
      { dayNumber: 1, isPK: false, voterSeat: 3, targetSeat: 5 },
      { dayNumber: 1, isPK: false, voterSeat: 4, targetSeat: 3 },
      { dayNumber: 1, isPK: false, voterSeat: 5, targetSeat: 5 },
      { dayNumber: 1, isPK: false, voterSeat: 6, targetSeat: 1 },
    ];
    expect(tallyVotes(votes)).toEqual([
      { seat: 5, count: 3 },
      { seat: 3, count: 2 },
      { seat: 1, count: 1 },
    ]);
  });
});

describe('QA 补充：遗言规则配置（仅首夜死者 + 被放逐者有遗言）', () => {
  it('6 人局默认板开启 firstNightLastWordsOnly', () => {
    expect(SIX_PLAYER_CONFIG.rules.firstNightLastWordsOnly).toBe(true);
  });

  it('6 人局默认板开启 pkOnTie 与 witchNoSelfSave / witchOnePotionPerNight', () => {
    expect(SIX_PLAYER_CONFIG.rules.pkOnTie).toBe(true);
    expect(SIX_PLAYER_CONFIG.rules.witchNoSelfSave).toBe(true);
    expect(SIX_PLAYER_CONFIG.rules.witchOnePotionPerNight).toBe(true);
    expect(SIX_PLAYER_CONFIG.rules.slaughterWin).toBe(true);
  });
});

describe('QA 补充：女巫毒药独立边界', () => {
  it('毒药必须指定目标（缺 target → 拒绝）', () => {
    const reason = witchConstraints('witch_poison', undefined, 5, { saveUsed: true, poisonUsed: false }, null, RULES);
    expect(reason).toContain('毒药必须指定目标');
  });

  it('历史夜晚已用解药，本夜仍可用毒（一瓶药限制只约束同夜）', () => {
    const reason = witchConstraints('witch_poison', 3, 5, { saveUsed: true, poisonUsed: false }, null, RULES);
    expect(reason).toBeNull();
  });

  it('无刀口时不可用解药（空刀夜）', () => {
    const reason = witchConstraints('witch_save', 3, 5, { saveUsed: false, poisonUsed: false }, null, RULES);
    expect(reason).toContain('无刀口可救');
  });
});

describe('QA 补充：AI 女巫毒药不乱用（decideNightByRules）', () => {
  it('AI 女巫永不主动用毒（毒药谨慎不用）', () => {
    for (let i = 0; i < 50; i++) {
      const action = decideNightByRules(
        witchView({ selfSeat: 5, aliveSeats: [1, 2, 3, 4, 5, 6], knifeTarget: 3 }),
      );
      expect(action.type).not.toBe('witch_poison');
    }
  });

  it('AI 女巫被刀（刀口=自己）→ 不可自救 → skip，不得转而毒人', () => {
    for (let i = 0; i < 50; i++) {
      const action = decideNightByRules(
        witchView({ selfSeat: 5, aliveSeats: [1, 2, 3, 4, 5, 6], knifeTarget: 5 }),
      );
      expect(action.type).toBe('skip');
    }
  });

  it('解药已用 → AI 女巫 skip（不再告知刀口场景为 null，也不毒人）', () => {
    const action = decideNightByRules(
      witchView({ selfSeat: 5, aliveSeats: [1, 2, 3, 4, 5, 6], knifeTarget: null, saveUsed: true }),
    );
    expect(action.type).toBe('skip');
  });

  it('刀口已知且非自己 → 用解药救刀口', () => {
    const action = decideNightByRules(
      witchView({ selfSeat: 5, aliveSeats: [1, 2, 3, 4, 5, 6], knifeTarget: 3 }),
    );
    expect(action).toEqual({ type: 'witch_save', targetSeat: 3 });
  });
});

describe('QA 补充：发言顺序（PRD §2.3：从死者下一位开始）', () => {
  const players = [1, 2, 3, 4, 5, 6].map((seat) => ({
    seat,
    alive: seat !== 3 && seat !== 6,
  }));

  it('首夜死 3 号与 6 号 → 发言从最大死者(6)的下一位存活者(1)开始', () => {
    // 死者 {3,6}，存活 [1,2,4,5]。PRD：从死者下一位开始 → 6 的下一位存活 = 1
    const start = speechStartSeat([3, 6], [1, 2, 4, 5]);
    const order = speechOrder(players, start);
    expect(order[0]).toBe(1);
  });

  it('白天死 1 号 → 发言从 2 号开始', () => {
    const alivePlayers = players.map((p) => ({ seat: p.seat, alive: p.seat !== 1 }));
    const order = speechOrder(alivePlayers, speechStartSeat([1], [2, 3, 4, 5, 6]));
    expect(order[0]).toBe(2);
  });

  it('仅死 3 号 → PRD 要求发言从死者(3)下一位存活者(4)开始', () => {
    const start = speechStartSeat([3], [1, 2, 4, 5, 6]);
    const order = speechOrder(players, start);
    expect(order[0]).toBe(4);
  });

  it('平安夜 → 法官指定起始位；引擎合同为最小存活座位的下一位（全员存活时=2 号）', () => {
    const allAlive = [1, 2, 3, 4, 5, 6].map((seat) => ({ seat, alive: true }));
    const order = speechOrder(allAlive, speechStartSeat([], [1, 2, 3, 4, 5, 6]));
    expect(order[0]).toBe(2);
  });
});

describe('QA 补充：双狼仲裁补充边界', () => {
  it('一狼空刀一狼给目标 → 结果必为已提交的目标之一或空刀', () => {
    for (let i = 0; i < 50; i++) {
      const t = arbitrateWolfKill([null, 4]);
      expect(t === null || t === 4).toBe(true);
    }
  });

  it('双狼一致目标 → 直接采用', () => {
    expect(arbitrateWolfKill([4, 4])).toBe(4);
  });

  it('双狼均空刀 → 空刀', () => {
    expect(arbitrateWolfKill([null, null])).toBeNull();
  });
});

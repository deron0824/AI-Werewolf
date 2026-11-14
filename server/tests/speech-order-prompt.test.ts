/**
 * 发言顺序上下文测试（迭代8）：
 * 用户实测问题——AI 后置位发言仍说"听听 X 号怎么说"（X 已发言过），
 * 根因是 prompt 缺少"顺序 + 谁已说完/还没说"的显式上下文。
 * 本测试锁定 promptBuilder 的顺序信息合同：
 *   1. 发言史按天分组、每条带"第 N 个发言"序号；
 *   2. 今天的已发言/未发言名单按"当天发言轮"口径（遗言不计入）；
 *   3. 发言 prompt 显式声明"你是今天第 N 个发言 + 紧邻上一位是谁"。
 */

import { describe, expect, it } from 'vitest';

import { Role, type GameStateView, type Player, type SpeechEntry } from '@werewolf/shared';

import { buildSpeechPrompt } from '../src/ai/promptBuilder';

function makePlayer(seat: number, isHuman: boolean, role: Role | null): Player {
  return {
    id: `p${seat}`,
    seat,
    name: `P${seat}`,
    avatarId: 'a1',
    isHuman,
    persona: { label: '稳健', trait: '说话有条理' },
    role,
    alive: true,
    roleRevealed: false,
  };
}

function makeEntry(seat: number, dayNumber: number, content: string, extra?: Partial<SpeechEntry>): SpeechEntry {
  return { seat, name: `P${seat}`, avatarId: 'a1', content, isAI: !extra || extra.isAI !== false, dayNumber, ...extra };
}

function makeView(opts: {
  dayNumber: number;
  speeches: SpeechEntry[];
  aliveSeats?: number[];
}): GameStateView {
  const aliveSeats = opts.aliveSeats ?? [1, 2, 3, 4, 5, 6];
  return {
    roomId: 'r',
    dayNumber: opts.dayNumber,
    isNight: false,
    phase: 'DAY_SPEECH' as never,
    players: aliveSeats.map((seat) => ({
      seat,
      name: `P${seat}`,
      avatarId: 'a1',
      isHuman: seat === 1,
      alive: true,
    })),
    self: { seat: 3, name: 'P3', role: Role.VILLAGER, alive: true },
    speeches: opts.speeches,
    voteSummary: { votedCount: 0, totalVoters: 0, tally: [], exiledSeat: null, isPK: false },
    difficulty: 'medium',
  } as unknown as GameStateView;
}

describe('发言顺序上下文（迭代8：prompt 顺序信息合同）', () => {
  const p3 = makePlayer(3, false, Role.VILLAGER);

  it('第一天 1 号（真人）已发言、轮到 3 号 AI：prompt 含顺序序号、已发言名单、你是第 2 个发言', () => {
    const view = makeView({
      dayNumber: 1,
      speeches: [makeEntry(1, 1, '我是一号，我觉得二号有点奇怪', { isAI: false })],
    });
    const prompt = buildSpeechPrompt(p3, view, '请发言。');
    // 发言史带顺序序号
    expect(prompt.user).toContain('第 1 个发言 1号(真人)：');
    // 已发言名单（真人已说完了，不能再"听听他的发言"）
    expect(prompt.user).toContain('已经发完言的玩家：1号');
    expect(prompt.user).toContain('严禁再对他们说');
    // 未发言名单含 3 号自己
    expect(prompt.user).toContain('今天还没有发言的玩家：2号、3号、4号、5号、6号');
    // 发言位置：紧邻上一位
    expect(prompt.user).toContain('你是今天第 2 个发言的玩家');
    expect(prompt.user).toContain('紧邻你之前发言的是 1 号');
  });

  it('第二天尚未有人发言：昨日发言单独分组，今天的名单全部未发言（修复"本局口径"顺序错乱）', () => {
    const view = makeView({
      dayNumber: 2,
      speeches: [
        makeEntry(1, 1, '第一天的发言'),
        makeEntry(2, 1, '第一天的发言2'),
      ],
    });
    const prompt = buildSpeechPrompt(p3, view, '请发言。');
    // 昨天的发言单独成组、有序号
    expect(prompt.user).toContain('第 1 天发言记录（按发言先后顺序）：');
    expect(prompt.user).toContain('第 1 个发言 1号：');
    // 今天口径：还没有任何人发言（旧实现会因"本局已发言"而漏掉该提示）
    expect(prompt.user).toContain('还没有任何人发言');
    expect(prompt.user).toContain('你是今天第 1 个发言的玩家');
    expect(prompt.user).toContain('你是今天第一个发言的玩家');
  });

  it('遗言不计入今天的发言轮：放逐遗言后仍有"尚未发言"名单', () => {
    const view = makeView({
      dayNumber: 1,
      speeches: [
        makeEntry(1, 1, '我是一号'),
        makeEntry(5, 1, '我死了……', { isLastWords: true }),
      ],
      aliveSeats: [1, 2, 3, 4, 6],
    });
    const prompt = buildSpeechPrompt(p3, view, '请发言。');
    // 5 号遗言在记录里带（遗言）标注，但不进"已发完言"名单
    expect(prompt.user).toContain('（遗言）');
    expect(prompt.user).not.toContain('已经发完言的玩家：5号');
    // 今天已发言只有 1 号；未发言含 2/3/4/6（5 已出局不在存活名单）
    expect(prompt.user).toContain('已经发完言的玩家：1号');
    expect(prompt.user).toContain('今天还没有发言的玩家：2号、3号、4号、6号');
  });

  it('跨天混合顺序：第 2 天已发言 1 号后，第 1 天发言仍带序号可见（历史可引用）', () => {
    const view = makeView({
      dayNumber: 2,
      speeches: [
        makeEntry(1, 1, '第一天发言甲'),
        makeEntry(1, 2, '第二天的发言'),
        makeEntry(2, 2, '第二天的发言2'),
      ],
    });
    const prompt = buildSpeechPrompt(p3, view, '请发言。');
    expect(prompt.user).toContain('第 1 天发言记录（按发言先后顺序）：\n第 1 个发言 1号：第一天发言甲');
    expect(prompt.user).toContain('今天（第 2 天）发言记录（按发言先后顺序）：');
    expect(prompt.user).toContain('第 2 个发言 2号：');
    expect(prompt.user).toContain('已经发完言的玩家：1号、2号');
    expect(prompt.user).toContain('你是今天第 3 个发言的玩家');
    expect(prompt.user).toContain('紧邻你之前发言的是 2 号');
  });
});

/**
 * 平安日 dayNumber 递增回归测试（P0 Bug-3 修复）：
 * 平票 → PK 发言 → PK 再平票 → 平安日（无人出局）路径必须与放逐路径对齐地递增
 * state.dayNumber，否则次日 NightRecord.dayNumber 会与当天重复（复盘/视图错乱）。
 *
 * 剧本（Math.random=0 发牌：座位1=狼 座位2=预言家 座位3=女巫 座位4=民 座位5=民 座位6=狼）：
 *  - 座位 1 为真人（狼牌），所有真人行动靠 SPEED_MODE=0 的 100ms 超时自动弃权/跳过；
 *  - 第 1 夜狼刀 2 号（预言家）；
 *  - 第 1 天投票：AI 3→4、4→3、5→4、6→3 → 3 号与 4 号各 2 票平票 → PK；
 *  - PK 投票：AI 5→3、6→4（真人 1 弃权）→ 再平票 → 平安日（dayNumber 1→2）；
 *  - 第 2 夜空刀（避免黎明触发屠城判定），第 2 天放逐 6 号狼（dayNumber 2→3）；
 *  - 第 3 夜空刀（真人狼超时），第 3 天放逐 1 号真人狼 → 好人胜。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// config 在 import 时读 env，必须 hoisted：
// SPEED_MODE=0 → lastWordsTimeLimitMs=100ms、humanActionTimeoutMs=100ms；
// SPEECH_TIME_LIMIT_MS 单独压低真人发言限时。
vi.hoisted(() => {
  process.env.SPEED_MODE = '0';
  process.env.SPEECH_TIME_LIMIT_MS = '200';
});

import { Phase, Role, SIX_PLAYER_CONFIG, type GameState, type Player } from '@werewolf/shared';

import { GameRecord } from '../src/game/GameRecord';
import { JudgeEngine, type JudgeHost } from '../src/game/JudgeEngine';
import type { AIEngine } from '../src/ai/AIEngine';

/** AI 投票决策队列：按"天1普通轮(3,4,5,6) → PK轮(5,6) → 天2(3,4,5,6) → 天3(3,4,5)"的确定顺序出队 */
const VOTE_QUEUE: number[] = [4, 3, 4, 3, 3, 4, 6, 6, 6, 1, 1, 1, 1];

function buildEngine(humanSeats: number[]): {
  engine: JudgeEngine;
  state: GameState;
  broadcastLog: { event: string; payload: unknown }[];
  randomSpy: ReturnType<typeof vi.spyOn>;
} {
  const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  const broadcastLog: { event: string; payload: unknown }[] = [];
  const mk = (seat: number): Player => ({
    id: `p${seat}`,
    seat,
    name: `P${seat}`,
    avatarId: 'human',
    isHuman: humanSeats.includes(seat),
    persona: { label: '稳健', trait: '测试桩' },
    role: null,
    alive: true,
    roleRevealed: false,
  });
  const state: GameState = {
    roomId: 'peace-room',
    roomCode: '0000',
    dayNumber: 0,
    isNight: false,
    phase: Phase.LOBBY,
    players: [1, 2, 3, 4, 5, 6].map(mk),
    speeches: [],
    votes: [],
    nights: [],
    winner: null,
    started: false,
    currentSpeakerSeat: null,
    voteCandidates: [],
    winnerReason: '',
    difficulty: 'medium',
  };
  const host: JudgeHost = {
    getState: () => state,
    getConfig: () => SIX_PLAYER_CONFIG,
    broadcast: (event, payload) => broadcastLog.push({ event, payload }),
    emitPrivate: () => undefined,
    syncViews: () => undefined,
    buildView: () => ({ dayNumber: state.dayNumber }),
    onGameOver: () => undefined,
  };
  const stubAI = {
    async decideNight(
      player: Player,
      view: { dayNumber?: number },
    ): Promise<{ type: string; targetSeat?: number }> {
      if (player.role === Role.WEREWOLF) {
        // 第 1 夜刀 2 号（预言家）；之后空刀（黎明好人人数必须 > 存活狼数，否则屠城判狼胜提前终局）
        return view.dayNumber === 1 ? { type: 'wolf_kill', targetSeat: 2 } : { type: 'skip' };
      }
      if (player.role === Role.SEER) {
        return { type: 'seer_check', targetSeat: 4 };
      }
      return { type: 'skip' };
    },
    async decideVote(): Promise<{ targetSeat: number }> {
      const target = VOTE_QUEUE.shift();
      if (target === undefined) throw new Error('投票队列耗尽：剧本与实际投票轮次不一致');
      return { targetSeat: target };
    },
    async generateSpeech(): Promise<string> {
      return '测试桩发言内容';
    },
    async generateLastWords(): Promise<string> {
      return '测试桩遗言内容';
    },
  };
  const engine = new JudgeEngine(host, SIX_PLAYER_CONFIG, stubAI as unknown as AIEngine, new GameRecord());
  return { engine, state, broadcastLog, randomSpy };
}

describe('平安日 dayNumber 递增（P0 Bug-3）', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterAll(() => {
    randomSpy.mockRestore();
  });

  it('平票→PK→再平票的平安日后，夜晚记录 dayNumber 正确递增且不重复，完整终局', async () => {
    const { engine, state, broadcastLog } = buildEngine([1]);
    engine.start();
    await engine.awaitFinished();

    // 发牌符合剧本预期（座位1真人狼、座位2 AI 预言家、座位6 AI 狼）
    expect(state.players[0].role).toBe(Role.WEREWOLF);
    expect(state.players[1].role).toBe(Role.SEER);
    expect(state.players[5].role).toBe(Role.WEREWOLF);

    // 引擎未卡死：平安日流程走完后完整跑完并以好人阵营终局
    expect(state.winner).toBe('VILLAGER');
    expect(state.phase).toBe(Phase.GAME_OVER);

    // 关键断言：三夜记录 dayNumber 严格递增且无重复。
    // 修复前：第 1 天平安日不递增 → 第 2 夜 dayNumber 仍为 1（与第 1 夜重复）。
    const nightDays = state.nights.map((n) => n.dayNumber);
    expect(nightDays).toEqual([1, 2, 3]);
    expect(new Set(nightDays).size).toBe(nightDays.length);

    // 法官播报：平票进 PK + PK 再平票平安日（1 号最后被放逐时狼全灭即终局，
    // exileSeat 在遗言前 tryFinishGame 返回，故无遗言环节——该路径由 lastwords-timeout.test.ts 覆盖）
    const judgeTexts = broadcastLog
      .filter((b) => b.event === 'judge:say')
      .map((b) => (b.payload as { text: string }).text);
    expect(judgeTexts.some((t) => t.includes('票数相同，进入 PK 发言环节'))).toBe(true);
    expect(judgeTexts).toContain('再次平票，当日为平安日，无人出局。入夜。');

    // 两处 broadcast('vote:result') 存档位点均触发：普通轮与 PK 轮的 isPK 标记与计票正确。
    // exiledSeat 已回填 resolveTally 结果：放逐轮携带被放逐座位，平票/PK 再平票轮为 null。
    const voteResults = broadcastLog
      .filter((b) => b.event === 'vote:result')
      .map((b) => {
        const p = b.payload as { isPK: boolean; exiledSeat: number | null; tally: { seat: number; count: number }[] };
        return { isPK: p.isPK, exiledSeat: p.exiledSeat, tally: p.tally };
      });
    expect(voteResults).toEqual([
      { isPK: false, exiledSeat: null, tally: [{ seat: 3, count: 2 }, { seat: 4, count: 2 }] }, // 第 1 天平票
      { isPK: true, exiledSeat: null, tally: [{ seat: 3, count: 1 }, { seat: 4, count: 1 }] }, // PK 再平票
      { isPK: false, exiledSeat: 6, tally: [{ seat: 6, count: 3 }, { seat: 1, count: 1 }] }, // 第 2 天放逐 6 号狼
      { isPK: false, exiledSeat: 1, tally: [{ seat: 1, count: 3 }] }, // 第 3 天放逐 1 号真人狼
    ]);

    // 投票记录的 dayNumber 与所属天数一致（PK 轮投票归当天，不因平安日错位）
    const votesByDay = new Map<number, { isPK: boolean[] }>();
    for (const v of state.votes) {
      const bucket = votesByDay.get(v.dayNumber) ?? { isPK: [] };
      bucket.isPK.push(v.isPK);
      votesByDay.set(v.dayNumber, bucket);
    }
    expect(votesByDay.get(1)).toEqual({ isPK: [false, false, false, false, true, true] });
    expect(votesByDay.get(2)).toEqual({ isPK: [false, false, false, false] });
    expect(votesByDay.get(3)).toEqual({ isPK: [false, false, false] });
  });
});

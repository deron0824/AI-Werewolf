/**
 * 遗言超时防死锁回归测试（P0 Bug-1 修复）：
 * 真人玩家浏览器崩溃/断线不提交遗言时，法官限时后跳过并继续推进，引擎不再永久卡死。
 * SPEED_MODE=0 下 lastWordsTimeLimitMs 经 speedMul 取 100ms 最小值，测试不被拖慢。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// config 在 import 时读 env，必须 hoisted：
// SPEED_MODE=0 → lastWordsTimeLimitMs=100ms、humanActionTimeoutMs=100ms；
// SPEECH_TIME_LIMIT_MS 不受倍率影响，单独压低真人发言限时。
vi.hoisted(() => {
  process.env.SPEED_MODE = '0';
  process.env.SPEECH_TIME_LIMIT_MS = '200';
});

import { Phase, Role, SIX_PLAYER_CONFIG, type GameConfig, type GameState, type Player } from '@werewolf/shared';

import { GameRecord } from '../src/game/GameRecord';
import { JudgeEngine, type JudgeHost } from '../src/game/JudgeEngine';
import type { AIEngine } from '../src/ai/AIEngine';

/** 固定随机源（Math.random=0 发牌：座位1=狼 座位2=预言家 座位3=女巫 座位4=民 座位5=民 座位6=狼） */
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
    roomId: 'lw-room',
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
    getConfig: (): GameConfig => SIX_PLAYER_CONFIG,
    broadcast: (event, payload) => broadcastLog.push({ event, payload }),
    emitPrivate: () => undefined,
    syncViews: () => undefined,
    buildView: () => ({ dayNumber: state.dayNumber }),
    onGameOver: () => undefined,
  };
  // 脚本化 AI（夜1 刀5/验4/女巫skip；白天发言；投票：白天1 投1号真人 → 放逐 → 遗言等待；
  // 夜2 刀3；白天2 投6 → 狼全灭好人胜）
  const stubAI = {
    async decideNight(player: Player, view: { dayNumber?: number }): Promise<{ type: string; targetSeat?: number }> {
      if (player.role === Role.WEREWOLF) {
        return view.dayNumber === 1 ? { type: 'wolf_kill', targetSeat: 5 } : { type: 'wolf_kill', targetSeat: 3 };
      }
      if (player.role === Role.SEER) {
        return { type: 'seer_check', targetSeat: 4 };
      }
      return { type: 'skip' };
    },
    async decideVote(_player: Player, view: { dayNumber?: number }): Promise<{ targetSeat: number }> {
      return { targetSeat: view.dayNumber === 1 ? 1 : 6 };
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

describe('遗言超时防死锁（P0 Bug-1）', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterAll(() => {
    randomSpy.mockRestore();
  });

  it('真人遗言超时后引擎继续推进不卡死（超时播报 + 完整终局）', async () => {
    const { engine, state, broadcastLog } = buildEngine([1]);
    engine.start();
    await engine.awaitFinished();

    // 超时播报已发出
    const judgeTexts = broadcastLog
      .filter((b) => b.event === 'judge:say')
      .map((b) => (b.payload as { text: string }).text);
    expect(judgeTexts).toContain('请 1 号留遗言。');
    expect(judgeTexts).toContain('1 号遗言超时，跳过。');

    // 引擎未卡死：完整跑完并以好人阵营终局（夜2 刀3 → 白2 投6 放逐狼6）
    expect(state.winner).toBe('VILLAGER');
    expect(state.phase).toBe(Phase.GAME_OVER);
    expect(state.dayNumber).toBeGreaterThanOrEqual(2);
  });

  it('pendingLastWordsSeat getter：等待期间返回座位号，超时后归 null', async () => {
    const { engine } = buildEngine([1]);
    engine.start();

    // 等待进入真人遗言等待窗口（投票放逐 1 号真人后；真人发言/投票限时均为 100~200ms，很快到达）
    await vi.waitFor(
      () => {
        expect(engine.pendingLastWordsSeat).toBe(1);
      },
      { timeout: 10_000, interval: 20 },
    );

    // 超时（100ms）后等待器作废，getter 归 null
    await vi.waitFor(
      () => {
        expect(engine.pendingLastWordsSeat).toBeNull();
      },
      { timeout: 10_000, interval: 20 },
    );

    // 迟到的遗言提交被正确拒绝（等待器已作废，JudgeEngine.ts submitLastWords 只认存活的 lastWordsWaiter）
    const late = engine.submitLastWords('p1', '迟到的遗言');
    expect(late.ok).toBe(false);

    await engine.awaitFinished();

    // 终局后同样拒绝（无待提交的遗言窗口）
    expect(engine.submitLastWords('p1', '终局后迟到遗言').ok).toBe(false);
  });
});

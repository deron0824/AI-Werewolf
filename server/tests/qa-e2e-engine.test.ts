/**
 * QA 引擎级确定性集成测试：固定发牌 + 脚本化 AI，驱动「好人胜」完整路径。
 * （随机 e2e 多局均狼胜，无法稳定覆盖好人胜终局，此测试补齐该路径。）
 * 同时回归：放逐→遗言→入夜循环、game:over 广播、复盘记录 winner。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// 提前压低 AI 打字延迟（config 在 import 时读 env，必须 hoisted）
vi.hoisted(() => {
  process.env.SPEED_MODE = '0';
});

import { Phase, Role, SIX_PLAYER_CONFIG, type GameConfig, type GameState, type Player } from '@werewolf/shared';

import { GameRecord } from '../src/game/GameRecord';
import { JudgeEngine, type JudgeHost } from '../src/game/JudgeEngine';
import type { AIEngine } from '../src/ai/AIEngine';

describe('QA 引擎级集成：好人胜完整路径（确定性）', () => {
  let broadcastLog: { event: string; payload: unknown }[] = [];
  let state: GameState;
  let engine: JudgeEngine;
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // 固定随机源（Math.random=0，洗牌仍有相邻交换，实际发牌见下方剧本注释）
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    broadcastLog = [];
    const mk = (seat: number): Player => ({
      id: `p${seat}`,
      seat,
      name: `AI${seat}`,
      avatarId: `ai-${seat}`,
      isHuman: false,
      persona: { label: '稳健', trait: '测试桩' },
      role: null,
      alive: true,
      roleRevealed: false,
    });
    state = {
      roomId: 'qa-room',
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
      emitPrivate: (playerId, event, payload) => broadcastLog.push({ event: `${event}(private→${playerId})`, payload }),
      syncViews: () => undefined,
      buildView: () => ({ dayNumber: state.dayNumber }),
      onGameOver: () => undefined,
    };
    // 脚本化 AI（Math.random=0 时洗牌仍发生相邻交换，实际发牌结果：
    // 座位1=狼 座位2=预言家 座位3=女巫 座位4=民 座位5=民 座位6=狼）：
    // 夜1 双狼刀 5（民），预言家验 4，女巫 skip → 死 5
    // 白1 全体投 1 → 狼 1 被放逐（好人 3 狼 1，未终局）→ 入夜
    // 夜2 狼 6 刀 3（女巫）→ 死 3（好人 2 狼 1）
    // 白2 全体投 6 → 狼 6 被放逐 → 狼全灭 → 好人胜
    const stubAI = {
      async decideNight(player: Player, view: { dayNumber?: number }): Promise<{ type: string; targetSeat?: number }> {
        if (player.role === Role.WEREWOLF) {
          return view.dayNumber === 1 ? { type: 'wolf_kill', targetSeat: 5 } : { type: 'wolf_kill', targetSeat: 3 };
        }
        if (player.role === Role.SEER) {
          return { type: 'seer_check', targetSeat: 4 };
        }
        return { type: 'skip' }; // 女巫
      },
      async decideVote(_player: Player, view: { dayNumber?: number }): Promise<{ targetSeat: number }> {
        return { targetSeat: view.dayNumber === 1 ? 1 : 6 };
      },
      async generateSpeech(): Promise<string> { return '测试桩发言内容'; },
      async generateLastWords(): Promise<string> { return '测试桩遗言内容'; },
    };
    const record = new GameRecord();
    engine = new JudgeEngine(host, SIX_PLAYER_CONFIG, stubAI as unknown as AIEngine, record);
  });

  afterAll(() => {
    randomSpy.mockRestore();
  });

  it('固定剧本跑完整局并以好人阵营获胜终局', async () => {
    engine.start();
    await engine.awaitFinished();

    // 终局状态
    expect(state.winner).toBe('VILLAGER');
    expect(state.phase).toBe(Phase.GAME_OVER);
    expect(state.players.filter((p) => p.role === Role.WEREWOLF && p.alive)).toHaveLength(0);

    // 关键广播序列：开局 → 死讯 → 投票 → 放逐 → game:over
    const events = broadcastLog.map((b) => b.event);
    expect(events).toContain('game:over');
    const over = broadcastLog.find((b) => b.event === 'game:over')!.payload as { winner: string; reason: string; recordUrl: string };
    expect(over.winner).toBe('VILLAGER');
    expect(over.recordUrl).toBe('/api/rooms/qa-room/record');

    // 两夜记录：夜1死5（刀，未被救）、夜2死3
    expect(state.nights).toHaveLength(2);
    expect(state.nights[0].deathSeats).toEqual([5]);
    expect(state.nights[0].witchSavedSeat).toBeNull();
    expect(state.nights[1].deathSeats).toEqual([3]);

    // 两次放逐（1 号、2 号狼），遗言已广播
    const exiles = broadcastLog.filter((b) => b.event === 'death:announce' && (b.payload as { cause: string }).cause === 'exile');
    expect(exiles).toHaveLength(2);

    // 预言家查验结果只走私发，不出现在广播
    const checkPublic = broadcastLog.filter((b) => b.event === 'check:result');
    expect(checkPublic).toHaveLength(0);
    const checkPrivate = broadcastLog.filter((b) => b.event.startsWith('check:result(private→p2)'));
    expect(checkPrivate.length).toBeGreaterThanOrEqual(1);

    // 胜负判定时机：第 2 天放逐后（好人 2 vs 狼 0）
    expect(state.dayNumber).toBe(2);
    expect(state.winnerReason).toContain('好人阵营获胜');
  });
});

/**
 * 迭代 2 回归单测（vitest）：
 * F1 补位满员 / F6 生命周期守卫与原子重开（连续重开 2 局 + 复盘归档保留）/ F4 真人发言超时“过”。
 * 全程进程内（mock io / 桩 AIEngine），不占用 3000/5173 端口、不触碰 dev 服务。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// config 在 import 时读 env，必须 hoisted：
// SPEED_MODE=0 压低 AI 延迟；SPEECH_TIME_LIMIT_MS=50 让发言超时可测（不受 SPEED_MODE 影响）
vi.hoisted(() => {
  process.env.SPEED_MODE = '0';
  process.env.SPEECH_TIME_LIMIT_MS = '50';
});

import { Phase, Role, SIX_PLAYER_CONFIG, type GameConfig, type GameState, type Player } from '@werewolf/shared';

import { Room, type AIRosterEntry } from '../src/room/Room';
import { RoomManager } from '../src/room/RoomManager';
import { JudgeEngine, type JudgeHost } from '../src/game/JudgeEngine';
import { GameRecord } from '../src/game/GameRecord';
import type { AIEngine } from '../src/ai/AIEngine';
import type { LLMPipeline } from '../src/llm/LLMPipeline';

// ============ 公共桩 ============

interface BroadcastEntry {
  event: string;
  payload: unknown;
}

/** mock SocketIOServer：广播全部落入内存日志 */
function mockIO(log: BroadcastEntry[]): never {
  return {
    to: () => ({
      emit: (event: string, payload: unknown) => log.push({ event, payload }),
    }),
  } as never;
}

/** 桩 AIEngine：脚本化决策（与发牌剧本配套，见各用例注释） */
function scriptedAI(): AIEngine {
  return {
    async decideNight(player: Player, view: { dayNumber?: number }) {
      if (player.role === Role.WEREWOLF) {
        return view.dayNumber === 1 ? { type: 'wolf_kill', targetSeat: 5 } : { type: 'wolf_kill', targetSeat: 2 };
      }
      if (player.role === Role.SEER) {
        return { type: 'seer_check', targetSeat: 4 };
      }
      return { type: 'skip' };
    },
    async decideVote(_player: Player, view: { dayNumber?: number }) {
      return { targetSeat: view.dayNumber === 1 ? 6 : 1 };
    },
    async generateSpeech(): Promise<string> {
      return 'AI 桩发言内容';
    },
    async generateLastWords(): Promise<string> {
      return 'AI 桩遗言内容';
    },
  } as unknown as AIEngine;
}

const ROSTER: AIRosterEntry[] = [
  { name: '锋哥', avatarId: 'ai-1', persona: { label: '激进', trait: '桩' } },
  { name: '老稳', avatarId: 'ai-2', persona: { label: '稳健', trait: '桩' } },
  { name: '戏精', avatarId: 'ai-3', persona: { label: '演技派', trait: '桩' } },
  { name: '随风', avatarId: 'ai-4', persona: { label: '跟风', trait: '桩' } },
  { name: '快嘴', avatarId: 'ai-5', persona: { label: '速攻', trait: '桩' } },
  { name: '老学究', avatarId: 'ai-6', persona: { label: '逻辑流', trait: '桩' } },
];

function mkHostPlayer(name: string): Player {
  return {
    id: 'host-1',
    seat: 1,
    name,
    avatarId: 'human',
    isHuman: true,
    persona: { label: '真人', trait: '由真人玩家操作' },
    role: null,
    alive: true,
    roleRevealed: false,
  };
}

/** 构造测试用 Room（已 attachAI，等价于 RoomManager.createRoom 的装配） */
function mkRoom(roomId: string, roomCode: string, log: BroadcastEntry[], ai: AIEngine): Room {
  const room = new Room(roomId, roomCode, mkHostPlayer('真人甲'), mockIO(log), ai, {} as LLMPipeline, SIX_PLAYER_CONFIG);
  room.attachAI(ai);
  return room;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ============ F1 补位满员 ============

describe('F1 席位自动补满（拍板①⑥）', () => {
  it('建房时 AI 预览占 3-6 号座，2 号位为第二真人预留席', () => {
    const log: BroadcastEntry[] = [];
    const manager = new RoomManager(mockIO(log), {} as AIEngine, {} as LLMPipeline);
    const identity = manager.createRoom('真人甲');
    const room = manager.getRoom(identity.roomId)!;
    // 房主 1 号座；AI 预览 3-6 号座；2 号座空缺
    expect(room.players.map((p) => p.seat).sort((a, b) => a - b)).toEqual([1, 3, 4, 5, 6]);
    const aiSeats = room.players.filter((p) => !p.isHuman).map((p) => p.seat).sort((a, b) => a - b);
    expect(aiSeats).toEqual([3, 4, 5, 6]);
    // 第二真人按加入顺序拿到 2 号座（预留席）
    const joined = manager.joinByCode(identity.roomCode, '真人乙');
    expect(joined.ok).toBe(true);
    expect((joined as { ok: true; identity: { seat: number } }).identity.seat).toBe(2);
  });

  it('仅 1 真人开局 → fillAI 补满 6 席（补位 AI 不与预览 AI 重名重头像）', () => {
    const log: BroadcastEntry[] = [];
    const room = mkRoom('r1', '0001', log, scriptedAI());
    // 还原建房预览：AI 占 3-6 号座（与 RoomManager.createRoom 一致）
    room.addAI('锋哥', 'ai-1', { label: '激进', trait: '桩' }, 3);
    room.addAI('老稳', 'ai-2', { label: '稳健', trait: '桩' }, 4);
    room.addAI('戏精', 'ai-3', { label: '演技派', trait: '桩' }, 5);
    room.addAI('随风', 'ai-4', { label: '跟风', trait: '桩' }, 6);
    room.fillAI(ROSTER);
    expect(room.players).toHaveLength(6);
    const seats = room.players.map((p) => p.seat).sort((a, b) => a - b);
    expect(seats).toEqual([1, 2, 3, 4, 5, 6]);
    // 席位 2 的补位 AI 来自未上场的花名册条目（快嘴 ai-5），不与预览 AI 重复
    const seat2 = room.players.find((p) => p.seat === 2)!;
    expect(seat2.isHuman).toBe(false);
    expect(seat2.avatarId).toBe('ai-5');
    const avatarIds = room.players.map((p) => p.avatarId);
    expect(new Set(avatarIds).size).toBe(avatarIds.length);
    // 全员均为合法座位（禁止空位开局的前置条件成立）
    expect(room.players.every((p) => p.seat >= 1 && p.seat <= SIX_PLAYER_CONFIG.seatCount)).toBe(true);
  });

  it('2 真人开局 → 补 4 AI 共 6 席（回归不劣化）', () => {
    const log: BroadcastEntry[] = [];
    const room = mkRoom('r2', '0002', log, scriptedAI());
    room.addAI('锋哥', 'ai-1', { label: '激进', trait: '桩' }, 3);
    room.addAI('老稳', 'ai-2', { label: '稳健', trait: '桩' }, 4);
    room.addAI('戏精', 'ai-3', { label: '演技派', trait: '桩' }, 5);
    room.addAI('随风', 'ai-4', { label: '跟风', trait: '桩' }, 6);
    const joined = room.addHuman('真人乙');
    if ('error' in joined) throw new Error(joined.error);
    expect(joined.player.seat).toBe(2);
    room.fillAI(ROSTER);
    expect(room.players).toHaveLength(6);
    const humans = room.players.filter((p) => p.isHuman);
    expect(humans.map((p) => p.seat).sort((a, b) => a - b)).toEqual([1, 2]);
  });
});

// ============ F6 生命周期守卫 ============

describe('F6 房间生命周期守卫（WAITING/RUNNING/FINISHED）', () => {
  it('WAITING 状态：game:start 可开局且切 RUNNING；重复开局被拒', () => {
    const log: BroadcastEntry[] = [];
    const room = mkRoom('r3', '0003', log, scriptedAI());
    expect(room.status).toBe('WAITING');
    const started = room.startGame(ROSTER);
    expect(started.ok).toBe(true);
    expect(room.status).toBe('RUNNING');
    const again = room.startGame(ROSTER);
    expect(again.ok).toBe(false);
    expect(again.message).toContain('对局进行中');
  });

  it('RUNNING 状态 restart 被拒（错误码 2003）；WAITING 状态 restart 被拒', () => {
    const log: BroadcastEntry[] = [];
    const room = mkRoom('r4', '0004', log, scriptedAI());
    const waiting = room.restart(ROSTER);
    expect(waiting.ok).toBe(false);
    expect(waiting.message).toContain('尚未有已结束的对局');
    room.startGame(ROSTER);
    const running = room.restart(ROSTER);
    expect(running.ok).toBe(false);
    expect(running.message).toContain('2003');
  });

  it('FINISHED 状态 game:start 被拒（封死双路径，提示先重开）', () => {
    const log: BroadcastEntry[] = [];
    const room = mkRoom('r5', '0005', log, scriptedAI());
    room.startGame(ROSTER);
    room.onGameOver(); // 模拟终局（引擎广播 game:over 后的回调）
    expect(room.status).toBe('FINISHED');
    const result = room.startGame(ROSTER);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('请先重开一局');
  });

  it('FINISHED → restart 原子重开：广播 game:restart + 立即开局 RUNNING + rejoinToken 跨局保留 + 旧局复盘可下载', () => {
    const log: BroadcastEntry[] = [];
    const room = mkRoom('r6', '0006', log, scriptedAI());
    const joined = room.addHuman('乙');
    if ('error' in joined) throw new Error(joined.error);
    room.startGame(ROSTER);
    // 模拟一局真实终局：引擎在广播 game:over / onGameOver 之前已置 winner 与发言记录
    // （构造非平凡记录，保证归档断言真正区分新旧局）
    const finishedState = room.getState();
    finishedState.winner = 'WEREWOLF';
    finishedState.winnerReason = '测试终局：狼人屠城获胜';
    room.record.logSpeech({ seat: 3, name: 'AI3', avatarId: 'ai-3', content: '旧局发言内容', isAI: true, dayNumber: 1 });
    room.onGameOver();
    expect(room.status).toBe('FINISHED');
    const oldRecord = room.exportRecord();
    expect(oldRecord).not.toBeNull();
    expect(oldRecord!.winner).toBe('WEREWOLF');
    expect(oldRecord!.speeches).toHaveLength(1);

    const restartLogLen = log.length;
    const result = room.restart(ROSTER);
    expect(result.ok).toBe(true);
    // 广播了 game:restart 且载荷不含任何私密字段
    const restartEvents = log.slice(restartLogLen).filter((b) => b.event === 'game:restart');
    expect(restartEvents).toHaveLength(1);
    expect(JSON.stringify(restartEvents[0].payload)).not.toMatch(/WEREWOLF|WITCH|SEER|knifeTarget|check/i);
    // 立即开局：RUNNING + 发牌完成
    expect(room.status).toBe('RUNNING');
    expect(room.getState().dayNumber).toBeGreaterThanOrEqual(1);
    expect(room.getState().players.every((p) => p.role !== null)).toBe(true);
    // 状态已清零重发
    expect(room.getState().speeches).toHaveLength(0);
    expect(room.getState().winner).toBeNull();
    // rejoinToken 跨局保留（第二真人免刷新可回新局）
    const rebind = room.bindSocket({ emit: () => undefined } as never, joined.player.id, joined.rejoinToken);
    expect(rebind.ok).toBe(true);
    // 旧局复盘归档保留（拍板③ + Bug-1 修复回归）：
    // 新局已开局（未分胜负）时，下载接口必须【回退返回旧局归档】，而非新局空记录
    const afterRestartRecord = room.exportRecord();
    expect(afterRestartRecord).not.toBeNull();
    // 强断言：返回的是旧局完整数据（winner 非空、发言逐条与旧局一致），新局此刻 winner=null 且 speeches=0
    expect(afterRestartRecord!.winner).not.toBeNull();
    expect(afterRestartRecord!.winner).toBe(oldRecord!.winner);
    expect(afterRestartRecord!.speeches).toEqual(oldRecord!.speeches);
    expect(afterRestartRecord!.speeches.length).toBeGreaterThan(0);
  });
});

// ============ F6 连续重开 2 局（全流程） ============

/**
 * 剧本（Math.random 固定为 0，发牌确定：座1=狼 座2=预言家 座3=女巫 座4=民 座5=民 座6=狼）：
 * 真人甲=座1（狼）。夜1 双狼刀 5；白1 超时过 → 全体投 6 放逐；夜2 甲刀 2；白2 全体投 1 → 狼全灭好人胜。
 * 真人甲的行动由自动轮询器代打（夜间刀口/投票/遗言），白天发言故意不提交以触发超时。
 */
async function driveRoomToFinish(room: Room, humanId: string, log: BroadcastEntry[], timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const submittedLastWords = new Set<string>();
  while (Date.now() < deadline) {
    if (room.status === 'FINISHED') return;
    const state: GameState = room.getState();
    const human = state.players.find((p) => p.id === humanId)!;
    // 遗言：法官播报“请 X 号留遗言”且 X 是真人甲
    const lastWordsSeat = log
      .filter((b) => b.event === 'judge:say')
      .map((b) => (b.payload as { text: string }).text)
      .reverse()
      .map((text) => text.match(/请\s*(\d+)\s*号留遗言/)?.[1])
      .find((s) => s !== undefined);
    if (lastWordsSeat && Number(lastWordsSeat) === human.seat && human.isHuman && !submittedLastWords.has(`${state.dayNumber}-${lastWordsSeat}`)) {
      submittedLastWords.add(`${state.dayNumber}-${lastWordsSeat}`);
      room.submitLastWords(humanId, '真人甲的遗言：注意票型。');
    }
    switch (state.phase) {
      case Phase.NIGHT_WOLF:
        if (human.role === Role.WEREWOLF && human.alive) {
          room.submitNightAction(humanId, { type: 'wolf_kill', targetSeat: state.dayNumber === 1 ? 5 : 2 } as never);
        }
        break;
      case Phase.DAY_VOTE:
      case Phase.DAY_PK: {
        const candidates = (state.voteCandidates ?? []).filter((s) => s !== human.seat);
        if (human.alive && candidates.length > 0) {
          const target = state.dayNumber === 1 ? 6 : candidates[0];
          if (candidates.includes(target)) room.submitVote(humanId, target);
        }
        break;
      }
      default:
        break;
    }
    await sleep(5);
  }
  throw new Error('driveRoomToFinish 超时：对局未在时限内终局');
}

describe('F6 连续重开 2 局不失败（全流程闭环）', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // 固定随机源：发牌结果确定（座1=狼 座2=预言家 座3=女巫 座4=民 座5=民 座6=狼）
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterAll(() => {
    randomSpy.mockRestore();
  });

  it('连续 restart 两次均成功开局并跑满全流程，状态每次完整重置', async () => {
    const log: BroadcastEntry[] = [];
    const room = mkRoom('r7', '0007', log, scriptedAI());
    room.startGame(ROSTER);
    expect(room.status).toBe('RUNNING');

    // 第 1 局
    await driveRoomToFinish(room, 'host-1', log);
    expect(room.status).toBe('FINISHED');
    expect(room.getState().winner).toBe('VILLAGER');
    const game1Record = room.exportRecord();
    expect(game1Record).not.toBeNull();
    const game1SpeechCount = game1Record!.speeches.length;
    expect(game1SpeechCount).toBeGreaterThan(0);

    // 第 1 次重开 → 立即开局 → 跑满
    const r1 = room.restart(ROSTER);
    expect(r1.ok).toBe(true);
    expect(room.status).toBe('RUNNING');
    expect(room.getState().speeches).toHaveLength(0);
    // Bug-1 修复回归：新局进行中（未分胜负）下载接口回退返回第 1 局归档，而非新局空记录
    const archivedAfterRestart = room.exportRecord();
    expect(archivedAfterRestart!.winner).not.toBeNull();
    expect(archivedAfterRestart!.speeches).toEqual(game1Record!.speeches);
    await driveRoomToFinish(room, 'host-1', log);
    expect(room.status).toBe('FINISHED');
    expect(room.getState().winner).toBe('VILLAGER');

    // 第 2 次重开 → 依然成功（连续重开不失败）
    const r2 = room.restart(ROSTER);
    expect(r2.ok).toBe(true);
    expect(room.status).toBe('RUNNING');
    await driveRoomToFinish(room, 'host-1', log);
    expect(room.status).toBe('FINISHED');
    expect(room.getState().winner).toBe('VILLAGER');

    // 全程广播了 2 次 game:restart，且每次载荷均为空对象（安全红线）
    const restarts = log.filter((b) => b.event === 'game:restart');
    expect(restarts).toHaveLength(2);
    // 终局后拿到的是当前局（第 3 局）完整复盘
    expect(room.exportRecord()).not.toBeNull();
    expect(room.exportRecord()!.speeches.length).toBeGreaterThan(0);
    expect(room.exportRecord()!.winner).toBe('VILLAGER');
  });
});

// ============ F4 真人发言超时 ============

describe('F4 真人发言超时自动“过”+ 法官播报', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterAll(() => {
    randomSpy.mockRestore();
  });

  it('真人发言超时：judge:say 播报超时、不广播空发言、流程继续不卡死', async () => {
    const log: BroadcastEntry[] = [];
    const room = mkRoom('r8', '0008', log, scriptedAI());
    room.startGame(ROSTER);

    // 等待进入白天发言（真人甲=座1 是首个发言者），期间只代打夜间行动与投票（与连续重开剧本一致）
    await driveRoomToFinish(room, 'host-1', log);

    // 法官播报了超时（全员可见，拍板④）
    const timeoutSays = log
      .filter((b) => b.event === 'judge:say')
      .map((b) => (b.payload as { text: string }).text)
      .filter((text) => text.includes('思考超时，跳过发言'));
    expect(timeoutSays.length).toBeGreaterThanOrEqual(1);
    expect(timeoutSays[0]).toContain('1 号');

    // 超时不广播空发言（speech:new 中不应有真人甲的空内容条目）
    const humanSpeeches = log
      .filter((b) => b.event === 'speech:new')
      .map((b) => b.payload as { seat: number; content: string })
      .filter((s) => s.seat === 1);
    expect(humanSpeeches.every((s) => s.content.trim().length > 0)).toBe(true);

    // 服务端权威 deadline：游戏终局后归 null
    expect(room.getState().speechDeadlineMs ?? null).toBeNull();
    expect(room.status).toBe('FINISHED');
  });

  it('纯引擎级：超时后迟到的发言提交被正确拒绝（等待器已作废）', async () => {
    const log: BroadcastEntry[] = [];
    const state: GameState = {
      roomId: 'r9',
      roomCode: '0009',
      dayNumber: 1,
      isNight: false,
      phase: Phase.DAY_SPEECH,
      players: [
        { id: 'p1', seat: 1, name: '甲', avatarId: 'human', isHuman: true, persona: { label: '真人', trait: '桩' }, role: Role.VILLAGER, alive: true, roleRevealed: false },
        { id: 'p2', seat: 2, name: 'AI2', avatarId: 'ai-2', isHuman: false, persona: { label: '稳健', trait: '桩' }, role: Role.SEER, alive: true, roleRevealed: false },
        { id: 'p3', seat: 3, name: 'AI3', avatarId: 'ai-3', isHuman: false, persona: { label: '演技派', trait: '桩' }, role: Role.WITCH, alive: true, roleRevealed: false },
        { id: 'p4', seat: 4, name: 'AI4', avatarId: 'ai-4', isHuman: false, persona: { label: '跟风', trait: '桩' }, role: Role.WEREWOLF, alive: true, roleRevealed: false },
      ],
      speeches: [],
      votes: [],
      nights: [{ dayNumber: 1, knifeTargetSeat: null, seerCheckSeat: null, seerCheckResult: null, witchSavedSeat: null, witchPoisonSeat: null, deathSeats: [] }],
      winner: null,
      started: true,
      currentSpeakerSeat: null,
      voteCandidates: [],
      winnerReason: '',
      difficulty: 'medium',
    };
    const host: JudgeHost = {
      getState: () => state,
      getConfig: (): GameConfig => SIX_PLAYER_CONFIG,
      broadcast: (event, payload) => log.push({ event, payload }),
      emitPrivate: () => undefined,
      syncViews: () => undefined,
      buildView: (playerId) => ({ self: state.players.find((p) => p.id === playerId), dayNumber: state.dayNumber }),
      onGameOver: () => undefined,
    };
    const ai = {
      async decideNight() {
        return { type: 'skip' as const };
      },
      async decideVote() {
        return { targetSeat: 2 };
      },
      async generateSpeech(): Promise<string> {
        return 'AI 桩发言';
      },
      async generateLastWords(): Promise<string> {
        return 'AI 桩遗言';
      },
    };
    const engine = new JudgeEngine(host, SIX_PLAYER_CONFIG, ai as unknown as AIEngine, new GameRecord());
    // 平安夜发言从座1起：座1 真人不提交 → 50ms 超时“过”；后续 AI 自动推进直至终局
    engine.start();
    await engine.awaitFinished();
    // 超时播报已发
    const timeoutTexts = log
      .filter((b) => b.event === 'judge:say')
      .map((b) => (b.payload as { text: string }).text)
      .filter((t) => t.includes('思考超时'));
    expect(timeoutTexts.length).toBeGreaterThanOrEqual(1);
    // 迟到的发言提交被拒绝（等待器已作废，不会污染下一轮）
    const late = engine.submitSpeech('p1', '迟到的发言');
    expect(late.ok).toBe(false);
    // 流程未被超时卡死：直至终局（狼=座1 被放逐，好人胜）
    expect(state.phase).toBe(Phase.GAME_OVER);
    expect(state.winner).toBe('VILLAGER');
  });
});

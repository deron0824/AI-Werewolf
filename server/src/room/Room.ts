/**
 * Room —— 单房间：成员、socket 绑定、广播分发、按角色裁剪视图（信息隔离收口）。
 * 实现 JudgeHost 接口供裁判状态机回调。
 */

import * as crypto from 'node:crypto';

import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { AIDifficulty } from '@werewolf/shared';
import {
  Phase,
  Role,
  type GameConfig,
  type GameState,
  type GameStateView,
  type GameRecordJSON,
  type Persona,
  type Player,
  type RoomStatus,
  type ServerToClientEvents,
  type ClientToServerEvents,
  type SocketData,
} from '@werewolf/shared';

import type { AIEngine } from '../ai/AIEngine';
import type { LLMPipeline } from '../llm/LLMPipeline';
import { JudgeEngine } from '../game/JudgeEngine';
import { GameRecord } from '../game/GameRecord';

/** AI 花名册条目（由 RoomManager 传入，Room 不持有花名册真相源） */
export interface AIRosterEntry {
  name: string;
  avatarId: string;
  persona: Persona;
}

/** 房间频道名（Socket.IO room = 游戏房间，天然隔离广播） */
function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}

export class Room {
  readonly roomId: string;
  readonly roomCode: string;
  readonly config: GameConfig;
  readonly record: GameRecord;
  private state: GameState;
  private engine: JudgeEngine;
  /** 房间生命周期三态（迭代2 F6）：WAITING=大厅 / RUNNING=对局中 / FINISHED=胜负已分 */
  private roomStatus: RoomStatus = 'WAITING';
  /** 上几局归档复盘（拍板③：重开不删旧局数据，复盘下载仍可取旧局） */
  private archivedRecords: GameRecordJSON[] = [];
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
  /** playerId → socket 集合（同一浏览器多标签兼容） */
  private sockets = new Map<string, Set<Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>>>();
  /** playerId → rejoinToken（断线重连凭证） */
  private rejoinTokens = new Map<string, string>();
  private hostPlayerId: string;

  constructor(
    roomId: string,
    roomCode: string,
    hostPlayer: Player,
    io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>,
    aiEngine: AIEngine,
    pipeline: LLMPipeline,
    config: GameConfig,
  ) {
    this.roomId = roomId;
    this.roomCode = roomCode;
    this.config = config;
    this.io = io;
    this.hostPlayerId = hostPlayer.id;
    this.record = new GameRecord();
    this.state = {
      roomId,
      roomCode,
      dayNumber: 0,
      isNight: false,
      phase: Phase.LOBBY,
      players: [hostPlayer],
      speeches: [],
      votes: [],
      nights: [],
      winner: null,
      started: false,
      currentSpeakerSeat: null,
      speechDeadlineMs: null,
      voteCandidates: [],
      winnerReason: '',
      difficulty: 'medium',
    };
    this.engine = new JudgeEngine(this, config, aiEngine, this.record);
    void pipeline; // Pipeline 状态经 LLMPipeline.onStatus 全局广播，房间内无需实例
  }

  // ============ 成员管理 ============

  get isStarted(): boolean {
    return this.state.started;
  }

  /** 房间生命周期（RoomManager / 视图守卫用） */
  get status(): RoomStatus {
    return this.roomStatus;
  }

  get hostId(): string {
    return this.hostPlayerId;
  }

  get players(): Player[] {
    return this.state.players;
  }

  get humanCount(): number {
    return this.state.players.filter((p) => p.isHuman).length;
  }

  /** 加入真人玩家（分配最小空闲座位） */
  addHuman(name: string): { player: Player; rejoinToken: string } | { error: string; code: number } {
    if (this.state.started) {
      return { error: '本局已开局，无法加入', code: 1003 };
    }
    const humans = this.humanCount;
    if (humans >= 2) {
      return { error: '真人席位已满（Demo 固定 2 真人 + 4 AI）', code: 1002 };
    }
    const usedSeats = new Set(this.state.players.map((p) => p.seat));
    let seat = 1;
    while (usedSeats.has(seat)) seat += 1;
    const player: Player = {
      id: crypto.randomUUID(),
      seat,
      name,
      avatarId: 'human',
      isHuman: true,
      persona: { label: '真人', trait: '由真人玩家操作' },
      role: null,
      alive: true,
      roleRevealed: false,
    };
    this.state.players.push(player);
    const token = crypto.randomUUID();
    this.rejoinTokens.set(player.id, token);
    this.syncViews();
    return { player, rejoinToken: token };
  }

  /**
   * 填充一个 AI 玩家（名字/头像/性格由 RoomManager 传入）。
   * @param seat 指定座位号（建房预览占 3-6 号座 / fillAI 补空座）；缺省取最小空闲座
   */
  addAI(name: string, avatarId: string, persona: Persona, seat?: number): Player {
    const usedSeats = new Set(this.state.players.map((p) => p.seat));
    let target = seat;
    if (target === undefined) {
      target = 1;
      while (usedSeats.has(target)) target += 1;
    }
    if (usedSeats.has(target)) {
      throw new Error(`座位 ${target} 已被占用，无法重复入座`);
    }
    const player: Player = {
      id: crypto.randomUUID(),
      seat: target,
      name,
      avatarId,
      isHuman: false,
      persona,
      role: null,
      alive: true,
      roleRevealed: false,
    };
    this.state.players.push(player);
    return player;
  }

  /**
   * 开局前补满 AI（迭代2 F1）：按座位号顺序，把全部非真人空座用花名册补满到
   * config.seatCount。真人数量与座位不变（1、2 号位）；任何真人数量开局后席位恒满员。
   * 优先使用尚未上场的花名册条目（避免补位 AI 与预览 AI 重名重头像）；不足时循环复用。
   */
  fillAI(roster: AIRosterEntry[]): void {
    const usedAvatars = new Set(this.state.players.map((p) => p.avatarId));
    const fresh = roster.filter((r) => !usedAvatars.has(r.avatarId));
    const pool = fresh.length > 0 ? fresh : roster;
    const usedSeats = new Set(this.state.players.map((p) => p.seat));
    let idx = 0;
    for (let seat = 1; seat <= this.config.seatCount; seat++) {
      if (usedSeats.has(seat)) continue;
      const entry = pool[idx % pool.length];
      idx += 1;
      this.addAI(entry.name, entry.avatarId, entry.persona, seat);
    }
  }

  /** socket 绑定（含断线重连：带 token 校验） */
  bindSocket(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>,
    playerId: string,
    rejoinToken?: string,
  ): { ok: boolean; message?: string; seat?: number } {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, message: '玩家不在本房间' };
    const expectToken = this.rejoinTokens.get(playerId);
    if (expectToken !== undefined && rejoinToken !== undefined && rejoinToken !== expectToken) {
      return { ok: false, message: '重连凭证无效' };
    }
    if (!this.sockets.has(playerId)) this.sockets.set(playerId, new Set());
    this.sockets.get(playerId)!.add(socket as never);
    this.syncViews();
    return { ok: true, seat: player.seat };
  }

  handleDisconnect(playerId: string, socket: Socket): void {
    const set = this.sockets.get(playerId);
    if (!set) return;
    set.delete(socket as never);
    if (set.size === 0) this.sockets.delete(playerId);
    // Demo 不做“离场判定”：真人断线保留席位，凭 rejoinToken 重连恢复（P1-5）
  }

  hasLiveConnection(playerId: string): boolean {
    const set = this.sockets.get(playerId);
    return set !== undefined && set.size > 0;
  }

  isHost(playerId: string): boolean {
    return playerId === this.hostPlayerId;
  }

  // ============ JudgeHost 实现 ============

  getState(): GameState {
    return this.state;
  }

  getConfig(): GameConfig {
    return this.config;
  }

  // ============ 广播 / 私发 / 视图裁剪 ============

  broadcast(event: keyof ServerToClientEvents, payload: unknown): void {
    // 通过对象属性访问调用 emit 保持 this 绑定；payload 结构由 shared/events 协议约束
    (this.io.to(roomChannel(this.roomId)) as unknown as { emit: (ev: string, p: unknown) => void }).emit(
      event,
      payload,
    );
  }

  emitPrivate(playerId: string, event: keyof ServerToClientEvents, payload: unknown): void {
    const set = this.sockets.get(playerId);
    if (!set) return;
    for (const socket of set) {
      (socket as unknown as { emit: (ev: string, p: unknown) => void }).emit(event, payload);
    }
  }

  /** 给全部连接重发各自裁剪视图 */
  syncViews(): void {
    for (const player of this.state.players) {
      if (!player.isHuman) continue;
      const view = this.buildView(player.id);
      this.emitPrivate(player.id, 'state:sync', view);
    }
  }

  /**
   * 按角色裁剪视图（反作弊边界）：
   * 广播安全字段全员一致；狼队友/查验记录/药水状态只出现在对应角色自己的视图。
   */
  buildView(playerId: string): GameStateView {
    const state = this.state;
    const self = state.players.find((p) => p.id === playerId) ?? null;
    const playersPublic = state.players.map((p) => {
      const view: GameStateView['players'][number] = {
        seat: p.seat,
        name: p.name,
        avatarId: p.avatarId,
        isHuman: p.isHuman,
        alive: p.alive,
      };
      if (p.roleRevealed && p.role !== null) view.role = p.role;
      return view;
    });
    if (!self) {
      // 未绑定玩家：只给公开视图（兜底，self 用占位）
      return {
        roomId: state.roomId,
        dayNumber: state.dayNumber,
        isNight: state.isNight,
        phase: state.phase,
        players: playersPublic,
        self: { seat: 0, name: '（观战）', role: null, alive: false },
        speeches: state.speeches,
        voteSummary: { votedCount: 0, totalVoters: 0, tally: [], exiledSeat: null, isPK: false },
        roomStatus: this.roomStatus,
        speechDeadlineMs: null,
        selfCanVote: false,
        difficulty: state.difficulty,
      };
    }
    const view: GameStateView = {
      roomId: state.roomId,
      dayNumber: state.dayNumber,
      isNight: state.isNight,
      phase: state.phase,
      players: playersPublic,
      self: { seat: self.seat, name: self.name, role: self.role, alive: self.alive },
      speeches: state.speeches,
      voteSummary: {
        votedCount: 0,
        totalVoters: state.phase === Phase.DAY_VOTE || state.phase === Phase.DAY_PK
          ? state.players.filter((p) => p.alive && !(state.phase === Phase.DAY_PK && (state.voteCandidates ?? []).includes(p.seat))).length
          : 0,
        tally: [],
        exiledSeat: null,
        isPK: state.phase === Phase.DAY_PK,
      },
      currentSpeakerSeat: state.currentSpeakerSeat ?? null,
      isMySpeechTurn:
        state.currentSpeakerSeat === self.seat &&
        self.alive &&
        (state.phase === Phase.DAY_SPEECH || state.phase === Phase.DAY_PK),
      voteCandidates:
        state.phase === Phase.DAY_VOTE || state.phase === Phase.DAY_PK ? (state.voteCandidates ?? []) : undefined,
      selfCanVote:
        self.alive &&
        (state.phase === Phase.DAY_VOTE ||
          (state.phase === Phase.DAY_PK && !(state.voteCandidates ?? []).includes(self.seat))),
      winner: state.winner,
      winnerReason: state.winnerReason,
      roomStatus: this.roomStatus,
      speechDeadlineMs: state.speechDeadlineMs ?? null,
      difficulty: state.difficulty,
    };
    // 私密字段按角色注入
    if (self.role === Role.WEREWOLF) {
      view.wolfTeammates = state.players
        .filter((p) => p.role === Role.WEREWOLF && p.seat !== self.seat)
        .map((p) => p.seat);
    }
    if (self.role === Role.SEER) {
      view.checkRecords = state.nights
        .filter((n) => n.seerCheckSeat !== null)
        .map((n) => ({
          dayNumber: n.dayNumber,
          targetSeat: n.seerCheckSeat as number,
          result: n.seerCheckResult as 'WEREWOLF' | 'GOOD',
        }));
    }
    if (self.role === Role.WITCH) {
      const saveUsed = state.nights.some((n) => n.witchSavedSeat !== null);
      const poisonUsed = state.nights.some((n) => n.witchPoisonSeat !== null);
      view.potions = { saveUsed, poisonUsed };
      // 仅解药未用时才告知刀口（PRD §2.3）
      const lastNight = state.nights[state.nights.length - 1] ?? null;
      view.witchKnifeTarget =
        !saveUsed && lastNight && lastNight.dayNumber === state.dayNumber ? lastNight.knifeTargetSeat : null;
    }
    return view;
  }

  // ============ 游戏流程控制 ============

  /**
   * 开局（迭代2 F6 守卫）：仅 WAITING 可开局。
   * FINISHED 状态必须先走 restart 原子重开；RUNNING 状态拒绝重复开局（封死双路径）。
   * 开局前置步骤 fillAI 补满全部空座（禁止空位开局）。
   * 迭代4 F2：开局时把花名册人设随机洗牌分配给全部 AI（人设不绑定昵称/座位，玩几轮才能品出性格）。
   */
  startGame(roster: AIRosterEntry[]): { ok: boolean; message?: string } {
    if (this.roomStatus === 'RUNNING') {
      return { ok: false, message: '对局进行中，无法重复开局' };
    }
    if (this.roomStatus === 'FINISHED') {
      return { ok: false, message: '请先重开一局' };
    }
    this.fillAI(roster);
    this.shuffleAIPersonas(roster);
    this.roomStatus = 'RUNNING';
    this.engine.start();
    return { ok: true };
  }

  /**
   * 迭代4 F2 —— 人设随机洗牌：把花名册的全部人设随机重新分配给本局所有 AI 玩家，
   * 与昵称/头像/座位解绑（UI 不展示人设标签，真人只能从发言风格里逐步推断）。
   */
  private shuffleAIPersonas(roster: AIRosterEntry[]): void {
    const personas: Persona[] = roster.map((r) => r.persona);
    for (let i = personas.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [personas[i], personas[j]] = [personas[j], personas[i]];
    }
    let idx = 0;
    for (const p of this.state.players.filter((pl) => !pl.isHuman)) {
      p.persona = personas[idx % personas.length];
      idx += 1;
    }
  }

  /**
   * 迭代4 F3 —— 房主设置 AI 难度：仅大厅（WAITING）可改，开局后锁定；重开保留不重置。
   */
  setDifficulty(difficulty: AIDifficulty): { ok: boolean; message?: string } {
    if (this.roomStatus !== 'WAITING') {
      return { ok: false, message: '只能在大厅（开局前）调整 AI 难度' };
    }
    this.state.difficulty = difficulty;
    this.syncViews();
    return { ok: true };
  }

  /**
   * 原子重开（迭代2 F6）：仅 FINISHED 可调（RUNNING 拒绝，错误码 2003）。
   * 执行顺序：重置状态与记录 → 重建 JudgeEngine → 广播 game:restart → 立即发牌开新局。
   * rejoinToken / sockets 绑定不销毁（跨局永久有效，直到房间销毁）。
   * 上局复盘已在对局结束时归档（拍板③），旧局数据仍可下载。
   */
  restart(roster: AIRosterEntry[]): { ok: boolean; message?: string } {
    if (this.roomStatus === 'RUNNING') {
      return { ok: false, message: '对局进行中，无法重开（2003）' };
    }
    if (this.roomStatus !== 'FINISHED') {
      return { ok: false, message: '尚未有已结束的对局，无需重开' };
    }
    this.resetGameState();
    this.engine = new JudgeEngine(this, this.config, this.engineRef!.ai, this.record);
    // 先广播重开事件（前端清空全部会话级状态、关闭胜负弹窗），紧随其后的开局播报即新局起点
    this.broadcast('game:restart', { ok: true });
    this.syncViews();
    // 立即开局：重置后 roomStatus=WAITING，startGame 守卫天然放行
    return this.startGame(roster);
  }

  /** 重置 GameState（restart 用）：成员名单保留，对局数据全部归零 */
  private resetGameState(): void {
    this.record.reset();
    this.state.dayNumber = 0;
    this.state.isNight = false;
    this.state.phase = Phase.LOBBY;
    this.state.speeches = [];
    this.state.votes = [];
    this.state.nights = [];
    this.state.winner = null;
    this.state.started = false;
    this.state.currentSpeakerSeat = null;
    this.state.speechDeadlineMs = null;
    this.state.voteCandidates = [];
    this.state.winnerReason = '';
    for (const p of this.state.players) {
      p.role = null;
      p.alive = true;
      p.roleRevealed = false;
    }
    this.roomStatus = 'WAITING';
  }

  /**
   * 对局结束回调（JudgeHost 实现，由 JudgeEngine.tryFinishGame 在广播 game:over 后调用）：
   * 生命周期切到 FINISHED + 归档本局复盘快照（拍板③：重开后旧局复盘仍可下载）。
   */
  onGameOver(): void {
    this.roomStatus = 'FINISHED';
    const snapshot = this.record.export(this.state, this.config);
    if (snapshot !== null) {
      this.archivedRecords.push(snapshot);
    }
  }

  /** 引擎访问（RoomManager 转发玩家行动） */
  get engineRef(): { ai: AIEngine } | null {
    // JudgeEngine 私有字段不可访问，AIEngine 引用由构造参数缓存
    return this._aiRef;
  }

  private _aiRef: { ai: AIEngine } | null = null;

  /** 引用注入（RoomManager 构造后调用一次） */
  attachAI(ai: AIEngine): void {
    this._aiRef = { ai };
  }

  // ============ 行动转发 ============

  submitNightAction(playerId: string, action: { type: never; targetSeat?: number }): { ok: boolean; message?: string } {
    return this.engine.submitAction(playerId, action as never);
  }

  submitSpeech(playerId: string, content: string): { ok: boolean; message?: string } {
    return this.engine.submitSpeech(playerId, content);
  }

  submitVote(playerId: string, targetSeat: number): { ok: boolean; message?: string } {
    return this.engine.submitVote(playerId, targetSeat);
  }

  submitLastWords(playerId: string, content: string): { ok: boolean; message?: string } {
    return this.engine.submitLastWords(playerId, content);
  }

  /**
   * 复盘导出（拍板③：重开不删除旧局数据，复盘列表/下载仍可拿旧局）。
   * Bug-1 修复（QA Round1）：当前局【未分胜负】（RUNNING / 刚重开未终局）时不导出半程空记录，
   * 回退返回最近一局归档——避免 game:over 弹窗的下载地址在新局期间下到空 JSON；
   * 当前局已终局（winner 非空）则正常导出当前局。
   */
  exportRecord(): GameRecordJSON | null {
    const current = this.record.export(this.state, this.config);
    if (current !== null && this.state.winner !== null) return current;
    return this.archivedRecords.length > 0 ? this.archivedRecords[this.archivedRecords.length - 1] : null;
  }
}

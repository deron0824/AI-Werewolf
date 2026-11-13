/**
 * JudgeEngine —— 裁判状态机（核心）+ PhaseGate 阶段等待器
 *
 * 显式阶段状态机：LOBBY → NIGHT(狼→验→药) → DAWN → DAY_SPEECH → DAY_VOTE →
 * DAY_PK? → DAY_EXILE → NIGHT… → GAME_OVER。每阶段通过 PhaseGate 等待
 * 全部存活玩家的行动（真人 = socket 上行，AI = AIEngine 异步返回），
 * 收集齐/超时后由 Rules 纯函数计算下一状态并广播。
 */

import {
  Phase,
  Role,
  type Action,
  type GameConfig,
  type GameState,
  type NightRecord,
  type Player,
  type PotionState,
  type VoteRecord,
  type ServerToClientEvents,
} from '@werewolf/shared';

import { config as appConfig } from '../config';
import { sanitizeLogText } from '../security/secrets';
import type { AIEngine } from '../ai/AIEngine';
import { GameRecord } from './GameRecord';
import {
  arbitrateWolfKill,
  checkWin,
  phaseAllowsAction,
  resolveTally,
  seatPlayer,
  speechOrder,
  speechStartSeat,
  tallyVotes,
  witchConstraints,
} from './rules';
import { stageToPhase } from './phases';

/** PhaseGate —— 阶段等待器：收集全部指定座位的行动（真人 = socket 上行，AI = 异步返回），
 *  收集齐或超时后把 Map<seat, T> 交给裁判状态机。永不卡死的基石。 */
export class PhaseGate<T> {
  private pendingSeats = new Set<number>();
  private results = new Map<number, T | null>();
  private completion: ((m: Map<number, T | null>) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;

  /** 等待 seats 集合全部 resolve；timeoutMs <= 0 表示无限等待 */
  awaitActions(seats: number[], timeoutMs: number): Promise<Map<number, T | null>> {
    this.clearTimer();
    this.pendingSeats = new Set(seats);
    this.results = new Map(seats.map((s) => [s, null]));
    return new Promise((resolve) => {
      if (seats.length === 0) {
        resolve(this.results);
        return;
      }
      this.completion = resolve;
      if (timeoutMs > 0) {
        this.timer = setTimeout(() => this.complete(), timeoutMs);
      }
    });
  }

  /** 提交某座位行动；非待收座位返回 false（引擎据此拒绝越权行动） */
  resolve(seat: number, value: T): boolean {
    if (!this.pendingSeats.has(seat)) return false;
    this.pendingSeats.delete(seat);
    this.results.set(seat, value);
    if (this.pendingSeats.size === 0) this.complete();
    return true;
  }

  isPending(seat: number): boolean {
    return this.pendingSeats.has(seat);
  }

  private complete(): void {
    this.clearTimer();
    const done = this.completion;
    this.completion = null;
    if (done) done(this.results);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** 裁判宿主接口（由 Room 实现，避免引擎依赖具体房间实现） */
export interface JudgeHost {
  /** 权威状态 */
  getState(): GameState;
  getConfig(): GameConfig;
  /** 广播（payload 结构由调用处按 shared/events 协议保证） */
  broadcast(event: keyof ServerToClientEvents, payload: unknown): void;
  /** 定向私发 */
  emitPrivate(playerId: string, event: keyof ServerToClientEvents, payload: unknown): void;
  /** 给全部连接重发各自裁剪视图（state:sync） */
  syncViews(): void;
  /** 取玩家 id → 视图（供 AIEngine 反作弊注入） */
  buildView(playerId: string): unknown;
  /** 对局结束回调（引擎在广播 game:over 后调用；Room 借此切换生命周期为 FINISHED 并归档复盘） */
  onGameOver(): void;
}

export class JudgeEngine {
  private host: JudgeHost;
  private config: GameConfig;
  private ai: AIEngine;
  private record: GameRecord;

  /** 当前等待中的行动门 */
  private actionGate: PhaseGate<Action> | null = null;
  private voteGate: PhaseGate<{ targetSeat: number }> | null = null;
  /** 发言等待器（真人当前发言轮） */
  private speechWaiter: { seat: number; resolve: (content: string) => void } | null = null;
  /** 真人发言限时计时器（超时自动视为“过”，迭代2 F4） */
  private speechTimeoutTimer: NodeJS.Timeout | null = null;
  /**
   * 迭代5 F2 —— 下一 AI 发言预取：当前发言展示期间，后台已开始生成下一位 AI 的发言陈词，
   * 轮到该 AI 时直接取现成结果（等待只剩打字动效），消除 AI 之间“展示完才开始想”的串行等待。
   * 迭代5修正（玩法正确性）：仅当紧邻下一位存活发言者就是 AI 时才预取——
   * 若中间隔着尚未发言的真人，禁止预取（AI 必须听到真人发言后再响应），此时回退 aiWithTyping 现场生成。
   */
  private speechPrefetch: { seat: number; promise: Promise<string> } | null = null;
  /** 遗言等待器 */
  private lastWordsWaiter: { seat: number; resolve: (content: string) => void } | null = null;

  /** 本轮投票实时进度（真人投票提交时也广播） */
  private voteProgressState: { votedCount: number; totalVoters: number } | null = null;

  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(host: JudgeHost, config: GameConfig, ai: AIEngine, record: GameRecord) {
    this.host = host;
    this.config = config;
    this.ai = ai;
    this.record = record;
  }

  // ============ 对外：启动 / 提交接口 ============

  /** 启动一局（发牌 → 夜昼循环 → 胜负）。fire-and-forget，异常被捕获不阻塞房间。 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop().catch((err) => {
      console.error('[judge] 状态机异常：', String(err));
    });
  }

  /** 等待本局结束（Room 销毁/重开时可 await） */
  awaitFinished(): Promise<void> {
    return this.loopPromise ?? Promise.resolve();
  }

  /** 提交夜间行动（引擎校验阶段权限） */
  submitAction(playerId: string, action: Action): { ok: boolean; message?: string } {
    const state = this.host.getState();
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, message: '玩家不存在' };
    if (player.role === null || !player.alive) return { ok: false, message: '你当前无法行动' };
    if (!phaseAllowsAction(state.phase, player.role, action.type)) {
      return { ok: false, message: '当前阶段你没有该行动权限' };
    }
    if (action.type !== 'skip' && action.targetSeat === undefined) {
      return { ok: false, message: '该行动必须指定目标座位' };
    }
    if (this.actionGate?.isPending(player.seat)) {
      const accepted = this.actionGate.resolve(player.seat, action);
      if (accepted) return { ok: true };
    }
    return { ok: false, message: '现在不是行动收集窗口' };
  }

  /** 提交发言 */
  submitSpeech(playerId: string, content: string): { ok: boolean; message?: string } {
    const state = this.host.getState();
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, message: '玩家不存在' };
    const trimmed = content.trim();
    if (!trimmed) return { ok: false, message: '发言不能为空' };
    if (trimmed.length > appConfig.speech.maxLength) {
      return { ok: false, message: `发言不能超过 ${appConfig.speech.maxLength} 字` };
    }
    if (!this.speechWaiter || this.speechWaiter.seat !== player.seat) {
      return { ok: false, message: '当前不是你的发言轮次' };
    }
    this.speechWaiter.resolve(trimmed);
    this.speechWaiter = null;
    return { ok: true };
  }

  /** 提交投票 */
  submitVote(playerId: string, targetSeat: number): { ok: boolean; message?: string } {
    const state = this.host.getState();
    const player = state.players.find((p) => p.id === playerId);
    if (!player || !player.alive) return { ok: false, message: '死者无投票权' };
    // 迭代6修复：目标必须在候选内（普通轮=存活玩家；PK 轮=平票者），且不能投自己
    const candidates = state.voteCandidates ?? [];
    if (state.phase === Phase.DAY_VOTE || state.phase === Phase.DAY_PK) {
      if (!candidates.includes(targetSeat)) {
        return {
          ok: false,
          message:
            state.phase === Phase.DAY_PK ? 'PK 投票只能投给平票的玩家' : '只能投给存活的玩家',
        };
      }
      if (targetSeat === player.seat) return { ok: false, message: '不能投给自己' };
    }
    if (this.voteGate?.isPending(player.seat)) {
      const accepted = this.voteGate.resolve(player.seat, { targetSeat });
      if (accepted) {
        this.bumpVoteProgress();
        return { ok: true };
      }
    }
    return { ok: false, message: '当前不在投票窗口或你已投票' };
  }

  /** 提交遗言 */
  submitLastWords(playerId: string, content: string): { ok: boolean; message?: string } {
    const player = this.host.getState().players.find((p) => p.id === playerId);
    if (!player) return { ok: false, message: '玩家不存在' };
    const trimmed = content.trim();
    if (!trimmed) return { ok: false, message: '遗言不能为空' };
    if (!this.lastWordsWaiter || this.lastWordsWaiter.seat !== player.seat) {
      return { ok: false, message: '当前没有待提交的遗言' };
    }
    this.lastWordsWaiter.resolve(trimmed);
    this.lastWordsWaiter = null;
    return { ok: true };
  }

  // ============ 内部：状态机主循环 ============

  private state(): GameState {
    return this.host.getState();
  }

  private setPhase(phase: Phase): void {
    const state = this.state();
    state.phase = phase;
    state.isNight = phase === Phase.NIGHT_WOLF || phase === Phase.NIGHT_SEER || phase === Phase.NIGHT_WITCH;
    this.host.broadcast('phase:change', {
      dayNumber: state.dayNumber,
      phase,
      isNight: state.isNight,
      deadline: null,
    });
    this.host.syncViews();
  }

  private say(text: string): void {
    this.host.broadcast('judge:say', { text });
    this.record.logTimeline(text);
  }

  private async runLoop(): Promise<void> {
    this.dealCards();
    while (this.running && this.state().winner === null) {
      await this.runNight();
      if (this.state().winner !== null) break;
      await this.runDawnAndDay();
    }
    this.running = false;
  }

  /** 发牌：洗角色牌 → 按座位赋角色 → 狼私发队友揭示 */
  private dealCards(): void {
    const state = this.state();
    const deck = this.config.roles;
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // 按座位顺序发牌，真人优先拿到靠前的自然座位
    const sorted = [...state.players].sort((a, b) => a.seat - b.seat);
    sorted.forEach((p, i) => {
      p.role = shuffled[i] ?? null;
    });
    state.started = true;
    state.dayNumber = 1;
    state.winner = null;
    state.speeches = [];
    state.votes = [];
    state.nights = [];
    this.record.start();
    this.setPhase(Phase.LOBBY);
    this.say(`游戏开始！本局板子：${this.config.name}。身份已随机发放。`);

    // 拍板③：狼牌持有者私收 wolf:teammates
    for (const wolf of sorted.filter((p) => p.role === Role.WEREWOLF)) {
      this.host.emitPrivate(wolf.id, 'wolf:teammates', {
        seats: sorted.filter((p) => p.role === Role.WEREWOLF && p.seat !== wolf.seat).map((p) => p.seat),
      });
    }
  }

  /** 一整夜：按 config.nightOrder 依序唤醒 → 结算 */
  private async runNight(): Promise<void> {
    const state = this.state();
    const night: NightRecord = {
      dayNumber: state.dayNumber,
      knifeTargetSeat: null,
      seerCheckSeat: null,
      seerCheckResult: null,
      witchSavedSeat: null,
      witchPoisonSeat: null,
      deathSeats: [],
    };
    // 先入状态：女巫环节的裁剪视图需要实时刀口（witchKnifeTarget）
    state.nights.push(night);
    for (const stage of this.config.nightOrder) {
      await this.runNightStage(stage, night);
      if (this.state().winner !== null) return;
    }
    // 结算死亡
    night.deathSeats = this.resolveNightDeaths(night);
    this.record.logNight(night);
  }

  /** 夜晚单环节：按 stage 等待对应角色行动 */
  private async runNightStage(stage: string, night: NightRecord): Promise<void> {
    const state = this.state();
    const phase = stageToPhase(stage);
    this.setPhase(phase);
    switch (stage) {
      case 'WEREWOLF':
        await this.stageWolf(night);
        break;
      case 'SEER':
        await this.stageSeer(night);
        break;
      case 'WITCH':
        await this.stageWitch(night);
        break;
      default:
        // 配置了未知环节：跳过（配置扩展点保护）
        break;
    }
    void state;
  }

  /** 狼人环节：所有存活狼提交刀口，Rules 仲裁 */
  private async stageWolf(night: NightRecord): Promise<void> {
    const state = this.state();
    const wolves = state.players.filter((p) => p.alive && p.role === Role.WEREWOLF);
    if (wolves.length === 0) return;
    this.say('天黑请闭眼。狼人请睁眼，请统一你们的刀口（可空刀）。');
    night.knifeTargetSeat = await this.collectNightActions(wolves, 'wolf_kill', (p) =>
      this.ai.decideNight(p, this.host.buildView(p.id) as never),
    );
    if (night.knifeTargetSeat !== null) {
      this.say('狼人已统一刀口，请闭眼。');
    } else {
      this.say('狼人选择空刀，请闭眼。');
    }
  }

  /** 预言家环节：验一人，私发结果 */
  private async stageSeer(night: NightRecord): Promise<void> {
    const state = this.state();
    const seers = state.players.filter((p) => p.alive && p.role === Role.SEER);
    if (seers.length === 0) return;
    this.say('预言家请睁眼，请选择你要查验的玩家。');
    const target = await this.collectNightActions(seers, 'seer_check', (p) =>
      this.ai.decideNight(p, this.host.buildView(p.id) as never),
    );
    if (target === null) {
      this.say('预言家未查验，请闭眼。');
      return;
    }
    const targetPlayer = seatPlayer(state, target);
    const result = targetPlayer?.role === Role.WEREWOLF ? 'WEREWOLF' : 'GOOD';
    night.seerCheckSeat = target;
    night.seerCheckResult = result;
    for (const seer of seers) {
      this.host.emitPrivate(seer.id, 'check:result', { targetSeat: target, result });
    }
    this.say('预言家已查验完毕，请闭眼。');
  }

  /** 女巫环节：解药未用时告知刀口，校验用药边界 */
  private async stageWitch(night: NightRecord): Promise<void> {
    const state = this.state();
    const witches = state.players.filter((p) => p.alive && p.role === Role.WITCH);
    if (witches.length === 0) return;
    this.say('女巫请睁眼。');
    const potionState = this.currentPotionState(state);
    // PRD：仅解药未用时才告知刀口
    const knifeKnown = night.knifeTargetSeat !== null && !potionState.saveUsed ? night.knifeTargetSeat : null;
    for (const witch of witches) {
      this.host.emitPrivate(witch.id, 'witch:info', { knifeTargetSeat: knifeKnown });
    }
    const action = await this.collectWitchAction(witches, potionState, knifeKnown);
    if (action.type === 'witch_save') {
      potionState.saveUsed = true;
      night.witchSavedSeat = night.knifeTargetSeat;
      this.say('女巫已作出选择，请闭眼。');
    } else if (action.type === 'witch_poison' && action.targetSeat !== undefined) {
      potionState.poisonUsed = true;
      night.witchPoisonSeat = action.targetSeat;
      this.say('女巫已作出选择，请闭眼。');
    } else {
      this.say('女巫未用药，请闭眼。');
    }
  }

  /** 女巫行动收集（含用药边界校验与 AI 兜底） */
  private async collectWitchAction(
    witches: { id: string; seat: number; isHuman: boolean; name: string }[],
    potionState: PotionState,
    knifeKnown: number | null,
  ): Promise<Action> {
    const state = this.state();
    const witch = witches[0];
    const gate = new PhaseGate<Action>();
    // 必须挂到 this.actionGate：submitAction() 只认它，否则真人女巫的行动会被拒收并永久死锁
    this.actionGate = gate;
    const timeoutMs = witch.isHuman ? appConfig.humanActionTimeoutMs : 0;
    const waitPromise = gate.awaitActions([witch.seat], timeoutMs);
    if (!witch.isHuman) {
      // AI 女巫：decideNight 产出 witch_save/witch_poison/skip
      const view = this.host.buildView(witch.id) as never;
      this.ai
        .decideNight(state.players.find((p) => p.seat === witch.seat)!, view)
        .then((action) => gate.resolve(witch.seat, action))
        .catch(() => gate.resolve(witch.seat, { type: 'skip' }));
    }
    const results = await waitPromise;
    this.actionGate = null;
    const raw = results.get(witch.seat) ?? { type: 'skip' as const };
    // 边界校验：拒绝即降级为 skip
    const reason = witchConstraints(
      raw.type === 'witch_save' || raw.type === 'witch_poison' ? raw.type : 'skip',
      raw.targetSeat,
      witch.seat,
      potionState,
      knifeKnown,
      this.config.rules,
    );
    if (reason !== null) {
      console.warn(sanitizeLogText(`[judge] 女巫行动被拒绝（${reason}），按未用药处理`));
      return { type: 'skip' };
    }
    return raw;
  }

  /** 通用夜间行动收集：全部门内座位（真人无限等待/AI 异步） */
  private async collectNightActions(
    actors: Player[],
    actionType: 'wolf_kill' | 'seer_check',
    aiDecide: (player: Player) => Promise<Action>,
  ): Promise<number | null> {
    const gate = new PhaseGate<Action>();
    this.actionGate = gate;
    const seats = actors.map((a) => a.seat);
    const hasHuman = actors.some((a) => a.isHuman);
    const timeoutMs = hasHuman ? appConfig.humanActionTimeoutMs : 0;
    const waitPromise = gate.awaitActions(seats, timeoutMs);
    // AI 座位异步决策后 resolve
    for (const actor of actors.filter((a) => !a.isHuman)) {
      aiDecide(actor)
        .then((action) => {
          const safe = this.sanitizeNightAction(actionType, action);
          gate.resolve(actor.seat, safe);
        })
        .catch(() => {
          gate.resolve(actor.seat, { type: actionType === 'wolf_kill' ? 'wolf_kill' : 'seer_check' } as Action);
        });
    }
    const results = await waitPromise;
    this.actionGate = null;
    if (actionType === 'wolf_kill') {
      // 双狼仲裁（拍板③：目标一致即用之，不一致随机取狼方提交之一）
      const targets = actors.map((a) => {
        const r = results.get(a.seat);
        return r && r.type === 'wolf_kill' && r.targetSeat !== undefined ? r.targetSeat : null;
      });
      return arbitrateWolfKill(targets);
    }
    const seerResult = results.get(actors[0]?.seat ?? 0);
    return seerResult && seerResult.type === 'seer_check' && seerResult.targetSeat !== undefined
      ? seerResult.targetSeat
      : null;
  }

  /** AI 夜间行动清洗：非法目标/类型 → 兜底 */
  private sanitizeNightAction(actionType: 'wolf_kill' | 'seer_check', action: Action): Action {
    const state = this.state();
    const aliveSeats = state.players.filter((p) => p.alive).map((p) => p.seat);
    if (actionType === 'wolf_kill' && action.type === 'wolf_kill' && action.targetSeat !== undefined) {
      return aliveSeats.includes(action.targetSeat) ? action : { type: 'wolf_kill' };
    }
    if (actionType === 'seer_check' && action.type === 'seer_check' && action.targetSeat !== undefined) {
      return aliveSeats.includes(action.targetSeat) ? action : { type: 'seer_check' };
    }
    return { type: actionType };
  }

  /** 夜晚死亡结算：刀口（未被救）+ 毒杀 */
  private resolveNightDeaths(night: NightRecord): number[] {
    const state = this.state();
    const deaths = new Set<number>();
    if (night.knifeTargetSeat !== null && night.witchSavedSeat !== night.knifeTargetSeat) {
      deaths.add(night.knifeTargetSeat);
    }
    if (night.witchPoisonSeat !== null) {
      deaths.add(night.witchPoisonSeat);
    }
    for (const seat of deaths) {
      const p = seatPlayer(state, seat);
      if (p) p.alive = false;
    }
    return [...deaths];
  }

  /** 女巫药水状态（从历史夜晚记录推导） */
  private currentPotionState(state: GameState): PotionState {
    const saveUsed = state.nights.some((n) => n.witchSavedSeat !== null);
    const poisonUsed = state.nights.some((n) => n.witchPoisonSeat !== null);
    return { saveUsed, poisonUsed };
  }

  // ============ 白天 ============

  /** 天亮：死讯播报 → 首夜遗言 → 白天发言 → 投票 → 放逐 → 胜负/入夜 */
  private async runDawnAndDay(): Promise<void> {
    const state = this.state();
    const night = state.nights[state.nights.length - 1];
    this.setPhase(Phase.DAWN);

    // 死讯播报（UNCLEAR #5：夜里死亡统一播报，不区分刀/毒）
    if (night.deathSeats.length === 0) {
      this.say(`天亮了。昨夜是平安夜，无人死亡。第 ${state.dayNumber} 天白天开始。`);
    } else {
      const seatsText = night.deathSeats.map((s) => `${s} 号`).join('、');
      this.say(`天亮了。昨夜死亡的是 ${seatsText}。第 ${state.dayNumber} 天白天开始。`);
      this.host.broadcast('death:announce', { seats: night.deathSeats, cause: 'wolf' });
    }
    this.host.syncViews();
    if (this.tryFinishGame()) return;

    // 仅第一夜死者有遗言（PRD §2.3）
    if (
      this.config.rules.firstNightLastWordsOnly &&
      state.dayNumber === 1 &&
      night.deathSeats.length > 0
    ) {
      await this.collectLastWords(night.deathSeats);
      if (this.tryFinishGame()) return;
    }

    // 白天发言
    await this.runDaySpeeches(night.deathSeats, false);
    if (this.state().winner !== null) return;

    // 投票放逐（含 PK 流程）
    await this.runVoteFlow();
  }

  /** 收集死者遗言（真人等待输入 / AI 生成，带打字动效） */
  private async collectLastWords(seats: number[]): Promise<void> {
    const state = this.state();
    for (const seat of seats) {
      const player = seatPlayer(state, seat);
      if (!player) continue;
      this.say(`请 ${seat} 号留遗言。`);
      let content = '';
      if (player.isHuman) {
        content = await this.waitForLastWords(seat);
      } else {
        content = await this.aiWithTyping(player.seat, () =>
          this.ai.generateLastWords(player, this.host.buildView(player.id) as never),
        );
      }
      if (content) {
        const entry = {
          seat: player.seat,
          name: player.name,
          avatarId: player.avatarId,
          content,
          isAI: player.isHuman === false,
          isLastWords: true,
        };
        this.host.broadcast('speech:new', entry);
        this.record.logSpeech(entry);
        state.speeches.push(entry);
        // 迭代5 F1：遗言落定即同步视图（真人遗言提交后立即过轮）
        this.host.syncViews();
        // 迭代3 F1：AI 遗言按字幕流式时长推进节奏（真人遗言自己打字，无需等待）
        if (player.isHuman === false) await this.paceSpeechDisplay(content.length);
      }
    }
  }

  /** 白天按序发言 */
  private async runDaySpeeches(deathSeats: number[], isPK: boolean, pkSeats: number[] = []): Promise<void> {
    const state = this.state();
    const aliveSeats = state.players.filter((p) => p.alive).map((p) => p.seat);
    const startSeat = speechStartSeat(deathSeats, aliveSeats);
    const order = isPK ? pkSeats : speechOrder(state.players, startSeat);
    this.setPhase(Phase.DAY_SPEECH);
    this.speechPrefetch = null;
    // 迭代5 F2：相位一开始就预取第一位 AI 的发言，AI 开口不等 LLM 首字
    this.startPrefetchForNext(order, 0, state);
    for (let idx = 0; idx < order.length; idx++) {
      const seat = order[idx];
      const player = seatPlayer(state, seat);
      if (!player || !player.alive) continue;
      state.currentSpeakerSeat = seat;
      let content = '';
      if (player.isHuman) {
        // 迭代2 F4：真人发言限时（服务端权威计时）。deadline 随 syncViews 下发，前端仅展示不判定
        const limitMs = appConfig.speech.timeLimitMs;
        state.speechDeadlineMs = limitMs > 0 ? Date.now() + limitMs : null;
        this.host.syncViews();
        const { content: spoken, timedOut } = await this.waitForSpeechWithTimeout(seat, limitMs);
        content = spoken;
        state.speechDeadlineMs = null;
        if (timedOut) {
          // 超时由法官向全员播报（拍板④），随后自动视为“过”，流程继续不卡死
          this.say(`${seat} 号思考超时，跳过发言。`);
        }
      } else {
        state.speechDeadlineMs = null;
        // 经独立方法读取预取（跨函数边界，规避 TS 对本方法内属性赋值的收窄误判）
        const prefetched = this.takePrefetchFor(seat);
        if (prefetched) {
          // 迭代5 F2：命中预取——陈词已备好，只保留约 0.6s 打字动效节奏
          content = await this.aiWithPrefetched(seat, prefetched.promise);
        } else {
          content = await this.aiWithTyping(seat, () =>
            this.ai.generateSpeech(player, this.host.buildView(player.id) as never),
          );
        }
      }
      if (content) {
        const entry = {
          seat: player.seat,
          name: player.name,
          avatarId: player.avatarId,
          content,
          isAI: player.isHuman === false,
        };
        this.host.broadcast('speech:new', entry);
        this.record.logSpeech(entry);
        state.speeches.push(entry);
        // 迭代5 F1：每条发言落定即同步视图——真人提交后倒计时/当前发言者/流水立即更新，
        // 不再等到整个发言阶段结束（修复“真人提交后还要等满限时”的观感）
        this.host.syncViews();
        // 迭代5 F2+F3：仅当紧邻下一位存活发言者是 AI 时预取（真人发言已落定/无真人隔在中间，
        // 语料完整合法）。AI 展示期间预取与字幕播放并行；真人提交后同样预取紧邻下一位。
        this.startPrefetchForNext(order, idx + 1, state);
        if (player.isHuman === false) {
          // 迭代3 F1：AI 发言按字幕流式时长推进（客户端打字机，服务端等待等长节奏后再进入下一位）
          await this.paceSpeechDisplay(content.length);
        }
      }
    }
    state.currentSpeakerSeat = null;
    state.speechDeadlineMs = null;
    this.speechPrefetch = null;
    this.host.syncViews();
  }

  /**
   * 迭代5 F2 —— 从 fromIdx 起找下一位存活 AI 并后台预取其发言。
   * 迭代5修正（玩法正确性）：扫描途中一旦遇到存活的真人座位立即放弃预取——
   * 预取目标的语料必须完整（此前所有发言已落定），AI 不允许“没听到”真人发言就开口。
   * 跳过已出局座位是安全的（死者不再发言，不影响语料）。
   */
  private startPrefetchForNext(order: number[], fromIdx: number, state: GameState): void {
    for (let i = fromIdx; i < order.length; i++) {
      const seat = order[i];
      if (this.speechPrefetch?.seat === seat) return;
      const player = seatPlayer(state, seat);
      if (!player || !player.alive) continue;
      if (player.isHuman) return; // 真人未发言在前：禁止跨人预取，轮到 AI 时现场生成
      this.speechPrefetch = {
        seat,
        promise: this.ai
          .generateSpeech(player, this.host.buildView(player.id) as never)
          .catch(() => ''), // 兜底：预取失败不阻塞，走空发言跳过
      };
      return;
    }
  }

  /** 迭代5 F2 —— 取走属于指定座位的预取结果（无则返回 null）；独立方法以规避 TS 属性收窄误判 */
  private takePrefetchFor(seat: number): { seat: number; promise: Promise<string> } | null {
    const p = this.speechPrefetch;
    this.speechPrefetch = null;
    return p && p.seat === seat ? p : null;
  }

  /** 迭代5 F2 —— 命中预取的 AI 发言节奏：短打字动效 → 直接取陈词 */
  private async aiWithPrefetched(seat: number, prefetched: Promise<string>): Promise<string> {
    this.host.broadcast('typing:start', { seat });
    await new Promise((r) => setTimeout(r, Math.min(600, appConfig.ai.typingDelayMinMs)));
    try {
      return await prefetched;
    } finally {
      this.host.broadcast('typing:stop', { seat });
    }
  }

  /** 投票 → 计票 → 放逐或 PK */
  private async runVoteFlow(): Promise<void> {
    const state = this.state();
    this.setPhase(Phase.DAY_VOTE);
    const alivePlayers = state.players.filter((p) => p.alive);
    const candidates = alivePlayers.map((p) => p.seat);
    state.voteCandidates = candidates;
    this.host.syncViews();
    this.say('发言结束，进入投票放逐环节。请全体存活玩家投票。');

    const votes = await this.collectVotes(alivePlayers, candidates);
    state.votes.push(...votes);
    votes.forEach((v) => this.record.logVote(v));
    const tally = tallyVotes(votes);
    this.host.broadcast('vote:result', {
      tally,
      exiledSeat: null,
      isPK: false,
    });
    this.record.logTimeline(`第 ${state.dayNumber} 天投票明细：${JSON.stringify(tally)}`);

    const outcome = resolveTally(tally);
    if (outcome.exiledSeat !== null) {
      await this.exileSeat(outcome.exiledSeat, false);
      return;
    }
    if (outcome.pkSeats.length > 0 && this.config.rules.pkOnTie) {
      // 平票 → PK 发言 → 其余玩家再投 → 再平票则平安日
      this.say(
        `${outcome.pkSeats.map((s) => `${s} 号`).join('、')} 票数相同，进入 PK 发言环节。`,
      );
      await this.runDaySpeeches([], true, outcome.pkSeats);
      const pkVoters = alivePlayers.filter((p) => !outcome.pkSeats.includes(p.seat));
      if (pkVoters.length === 0) {
        this.say('无有效投票人，当日为平安日，无人出局。');
        return;
      }
      this.setPhase(Phase.DAY_PK);
      state.voteCandidates = outcome.pkSeats;
      this.host.syncViews();
      this.say('PK 发言结束，请在平票者中再次投票。');
      const pkVotes = await this.collectVotes(pkVoters, outcome.pkSeats, true);
      state.votes.push(...pkVotes);
      pkVotes.forEach((v) => this.record.logVote(v));
      const pkTally = tallyVotes(pkVotes);
      this.host.broadcast('vote:result', {
        tally: pkTally,
        exiledSeat: null,
        isPK: true,
      });
      const pkOutcome = resolveTally(pkTally);
      if (pkOutcome.exiledSeat !== null) {
        await this.exileSeat(pkOutcome.exiledSeat, true);
        return;
      }
      this.say('再次平票，当日为平安日，无人出局。入夜。');
      return;
    }
    this.say('无人得票（弃票），当日为平安日，无人出局。入夜。');
  }

  /** 收集一轮投票（真人上行 / AI 决策；实时广播已投人数） */
  private async collectVotes(
    voters: { id: string; seat: number; isHuman: boolean }[],
    candidates: number[],
    isPK = false,
  ): Promise<VoteRecord[]> {
    const state = this.state();
    const gate = new PhaseGate<{ targetSeat: number }>();
    this.voteGate = gate;
    const seats = voters.map((v) => v.seat);
    const hasHuman = voters.some((v) => v.isHuman);
    const timeoutMs = hasHuman ? appConfig.humanActionTimeoutMs : 0;
    const waitPromise = gate.awaitActions(seats, timeoutMs);
    this.voteProgressState = { votedCount: 0, totalVoters: seats.length };
    const bump = (): void => {
      this.bumpVoteProgress();
    };
    for (const voter of voters.filter((v) => !v.isHuman)) {
      const player = seatPlayer(state, voter.seat)!;
      this.ai
        .decideVote(player, this.host.buildView(voter.id) as never)
        .then((action) => {
          const target = candidates.includes(action.targetSeat)
            ? action.targetSeat
            : candidates[Math.floor(Math.random() * candidates.length)];
          gate.resolve(voter.seat, { targetSeat: target });
          bump();
        })
        .catch(() => {
          const target = candidates[Math.floor(Math.random() * candidates.length)];
          gate.resolve(voter.seat, { targetSeat: target });
          bump();
        });
    }
    const results = await waitPromise;
    this.voteGate = null;
    this.voteProgressState = null;
    const records: VoteRecord[] = [];
    for (const voter of voters) {
      const target = results.get(voter.seat)?.targetSeat ?? null;
      if (target === null) continue; // 真人超时视为弃票
      records.push({ dayNumber: state.dayNumber, isPK, voterSeat: voter.seat, targetSeat: target });
    }
    return records;
  }

  /** 放逐结算：死讯 + 遗言 + 胜负判定 */
  private async exileSeat(seat: number, isPK: boolean): Promise<void> {
    const state = this.state();
    const player = seatPlayer(state, seat);
    if (!player) return;
    this.say(`票数公布完毕，${seat} 号被放逐出局。`);
    player.alive = false;
    this.host.broadcast('death:announce', { seats: [seat], cause: 'exile' });
    this.host.syncViews();
    if (this.tryFinishGame()) return;
    this.say(`请 ${seat} 号留遗言。`);
    let content = '';
    if (player.isHuman) {
      content = await this.waitForLastWords(seat);
    } else {
      content = await this.aiWithTyping(seat, () =>
        this.ai.generateLastWords(player, this.host.buildView(player.id) as never),
      );
    }
    if (content) {
      const entry = {
        seat: player.seat,
        name: player.name,
        avatarId: player.avatarId,
        content,
        isAI: player.isHuman === false,
        isLastWords: true,
      };
      this.host.broadcast('speech:new', entry);
      this.record.logSpeech(entry);
      state.speeches.push(entry);
      // 迭代5 F1：遗言落定即同步视图（真人遗言提交后立即过轮）
      this.host.syncViews();
      // 迭代3 F1：AI 遗言同样按字幕时长推进节奏
      if (player.isHuman === false) await this.paceSpeechDisplay(content.length);
    }
    if (isPK) {
      this.say('PK 投票放逐完毕。');
    }
    if (this.tryFinishGame()) return;
    // 未分胜负 → 入夜
    state.dayNumber += 1;
    this.say('入夜。天黑请闭眼……');
  }

  /** 胜负判定：分出胜负则收尾广播，返回 true 表示本局已结束 */
  private tryFinishGame(): boolean {
    const state = this.state();
    const outcome = checkWin(state.players, this.config.rules);
    if (outcome.winner === null) return false;
    state.winner = outcome.winner;
    state.winnerReason = outcome.reason;
    this.setPhase(Phase.GAME_OVER);
    this.say(outcome.reason);
    this.record.finish(outcome.winner, outcome.reason);
    this.host.broadcast('game:over', {
      winner: outcome.winner,
      reason: outcome.reason,
      recordUrl: `/api/rooms/${state.roomId}/record`,
    });
    this.host.onGameOver();
    this.host.syncViews();
    return true;
  }

  // ============ 内部：真人等待器与 AI 节奏 ============

  /** 投票进度 +1 并广播（不显示投给谁） */
  private bumpVoteProgress(): void {
    if (!this.voteProgressState) return;
    this.voteProgressState.votedCount += 1;
    this.host.broadcast('vote:progress', { ...this.voteProgressState });
  }

  private waitForSpeech(seat: number): Promise<string> {
    return new Promise((resolve) => {
      this.speechWaiter = { seat, resolve };
    });
  }

  /**
   * 真人发言等待 + 限时竞速（迭代2 F4）：超时返回空串并作废等待器
   * （submitSpeech 只认 speechWaiter，迟到的提交会被正确拒绝）。
   * limitMs <= 0 表示不限时（SPEECH_TIME_LIMIT_MS=0）。
   */
  private waitForSpeechWithTimeout(seat: number, limitMs: number): Promise<{ content: string; timedOut: boolean }> {
    if (!limitMs || limitMs <= 0) {
      return this.waitForSpeech(seat).then((content) => ({ content, timedOut: false }));
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (content: string, timedOut: boolean): void => {
        if (settled) return;
        settled = true;
        if (this.speechTimeoutTimer) {
          clearTimeout(this.speechTimeoutTimer);
          this.speechTimeoutTimer = null;
        }
        resolve({ content, timedOut });
      };
      this.speechTimeoutTimer = setTimeout(() => {
        // 超时：作废当前发言等待器，后续 submitSpeech 返回“当前不是你的发言轮次”
        if (this.speechWaiter && this.speechWaiter.seat === seat) {
          this.speechWaiter = null;
        }
        finish('', true);
      }, limitMs);
      void this.waitForSpeech(seat).then((content) => finish(content, false));
    });
  }

  private waitForLastWords(seat: number): Promise<string> {
    return new Promise((resolve) => {
      this.lastWordsWaiter = { seat, resolve };
    });
  }

  /** AI 节奏：typing:start → 随机 1-3s 打字动效 → 生成 → typing:stop */
  private async aiWithTyping(seat: number, generate: () => Promise<string>): Promise<string> {
    this.host.broadcast('typing:start', { seat });
    const delay =
      appConfig.ai.typingDelayMinMs +
      Math.floor(Math.random() * (appConfig.ai.typingDelayMaxMs - appConfig.ai.typingDelayMinMs + 1));
    await new Promise((r) => setTimeout(r, delay));
    try {
      return await generate();
    } finally {
      this.host.broadcast('typing:stop', { seat });
    }
  }

  /**
   * 迭代3 F1 —— AI 发言展示节奏：字幕以 5 字/秒流式输出（客户端打字机），
   * 服务端广播后等待等长时长再进入下一环节，让发言"被听完"。
   * 上限 aiDisplayMaxMs（≈1 分钟）；受 SPEED_MODE 缩放，e2e/极速下自动压缩不拖慢测试。
   */
  private async paceSpeechDisplay(chars: number): Promise<void> {
    if (!appConfig.speech.pacingEnabled) return; // 极速/e2e 模式：不为字幕展示等待
    const cps = Math.max(1, appConfig.speech.displayCps);
    const rawMs = Math.round((chars / cps) * 1000);
    const waitMs = Math.min(rawMs, appConfig.speech.aiDisplayMaxMs);
    if (waitMs <= 0) return;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/**
 * 狼人杀 Demo —— 跨端共享类型（唯一类型真相源）
 *
 * 规则约束（ARCHITECTURE.md §8.1）：
 * - 一切跨端类型只允许定义在本文件，server / client 通过 workspace 引用导入；
 * - 禁止在两端复制定义，避免类型漂移。
 */

/** 玩家角色枚举（6 人局与 9 人局通用；猎人等为未来扩展） */
export enum Role {
  WEREWOLF = 'WEREWOLF',
  SEER = 'SEER',
  WITCH = 'WITCH',
  VILLAGER = 'VILLAGER',
}

/** 全部阶段枚举（裁判状态机的显式节点） */
export enum Phase {
  LOBBY = 'LOBBY',
  NIGHT_WOLF = 'NIGHT_WOLF',
  NIGHT_SEER = 'NIGHT_SEER',
  NIGHT_WITCH = 'NIGHT_WITCH',
  DAWN = 'DAWN',
  DAY_SPEECH = 'DAY_SPEECH',
  DAY_VOTE = 'DAY_VOTE',
  DAY_PK = 'DAY_PK',
  DAY_EXILE = 'DAY_EXILE',
  GAME_OVER = 'GAME_OVER',
}

/** 房间生命周期三态（迭代2 F6：WAITING=大厅 / RUNNING=对局中 / FINISHED=胜负已分） */
export type RoomStatus = 'WAITING' | 'RUNNING' | 'FINISHED';

/**
 * AI 游戏智商/经验难度（迭代4 F3，房主可控）：
 * - high：策略 Prompt 全开（悍跳/倒钩/票型推理），决策精准；
 * - medium：默认基线，与历史版本行为一致；
 * - low：新手人设 Prompt + 决策噪声（概率随机目标），便于新手局/带娃局。
 */
export type AIDifficulty = 'high' | 'medium' | 'low';

/** 胜方；null 表示游戏尚未结束 */
export type Winner = 'WEREWOLF' | 'VILLAGER' | null;

/** AI 性格人设（影响 prompt 风格，P1-3） */
export interface Persona {
  /** 性格标签：激进 / 稳健 / 演技派 / 跟风 */
  label: string;
  /** 一句话性格描述，拼入 prompt */
  trait: string;
}

/** 夜间行动类型（协议表 action:night 冻结值） */
export type NightActionType =
  | 'wolf_kill'
  | 'seer_check'
  | 'witch_save'
  | 'witch_poison'
  | 'skip';

/** 玩家提交的行动（夜间技能 / 弃权） */
export interface Action {
  type: NightActionType;
  /** 目标座位号；skip 类型可为空 */
  targetSeat?: number;
}

/** 投票行动（白天投票 / PK 投票通用） */
export interface VoteAction {
  targetSeat: number;
}

/** 服务端权威玩家对象（仅存在于 server GameState，不直接下发） */
export interface Player {
  id: string;
  seat: number;
  name: string;
  avatarId: string;
  isHuman: boolean;
  persona: Persona;
  role: Role | null;
  alive: boolean;
  /** 身份是否已公开（放逐/死亡翻牌、跳预言家等场景由引擎置位） */
  roleRevealed: boolean;
}

/** 下发给客户端的玩家公开视图（广播安全，无任何私密字段） */
export interface PlayerPublicView {
  seat: number;
  name: string;
  avatarId: string;
  isHuman: boolean;
  alive: boolean;
  /** 仅当 roleRevealed 为 true 时携带角色，否则 undefined */
  role?: Role;
  /** 该 AI 是否处于“打字中”动效 */
  typing?: boolean;
}

/** 本人私有视图（只下发给该玩家自己的连接） */
export interface PlayerPrivateView {
  seat: number;
  name: string;
  role: Role | null;
  alive: boolean;
}

/** 发言流水条目（公开信息，可广播） */
export interface SpeechEntry {
  seat: number;
  name: string;
  avatarId: string;
  content: string;
  isAI: boolean;
  /** 是否遗言 */
  isLastWords?: boolean;
}

/** 单条投票明细（服务端记录用，投票过程中不广播明细） */
export interface VoteRecord {
  dayNumber: number;
  isPK: boolean;
  voterSeat: number;
  targetSeat: number;
}

/** 投票汇总（广播安全：只有票数与出局者，无“谁投给谁”） */
export interface VoteSummary {
  votedCount: number;
  totalVoters: number;
  /** 投票结束后广播票数明细 */
  tally: { seat: number; count: number }[];
  exiledSeat: number | null;
  isPK: boolean;
}

/** 预言家查验记录（仅预言家私有视图携带） */
export interface CheckRecord {
  dayNumber: number;
  targetSeat: number;
  result: 'WEREWOLF' | 'GOOD';
}

/** 女巫药水状态（仅女巫私有视图携带） */
export interface PotionState {
  /** 解药是否已用 */
  saveUsed: boolean;
  /** 毒药是否已用 */
  poisonUsed: boolean;
}

/** 单夜完整记录（服务端权威 + 复盘用） */
export interface NightRecord {
  dayNumber: number;
  /** 双狼仲裁后的最终刀口；null=空刀 */
  knifeTargetSeat: number | null;
  /** 预言家查验 */
  seerCheckSeat: number | null;
  seerCheckResult: 'WEREWOLF' | 'GOOD' | null;
  /** 女巫行动 */
  witchSavedSeat: number | null;
  witchPoisonSeat: number | null;
  /** 本夜最终死亡座位（结算后） */
  deathSeats: number[];
}

/** 服务端权威游戏状态（不下发，客户端只收裁剪视图） */
export interface GameState {
  roomId: string;
  roomCode: string;
  dayNumber: number;
  isNight: boolean;
  phase: Phase;
  players: Player[];
  speeches: SpeechEntry[];
  votes: VoteRecord[];
  nights: NightRecord[];
  winner: Winner;
  /** 游戏是否已开局（锁定加入） */
  started: boolean;
  /** 当前发言者座位（DAY_SPEECH / DAY_PK 阶段） */
  currentSpeakerSeat?: number | null;
  /** 当前真人发言轮的服务端权威截止时间戳（ms）；非发言轮为 null（服务端内部字段，仅 buildView 裁剪下发） */
  speechDeadlineMs?: number | null;
  /** 投票候选座位（DAY_VOTE / DAY_PK 阶段） */
  voteCandidates?: number[];
  /** 投票收集窗口是否开启（服务端内部字段，随视图下发） */
  voteCollecting?: boolean;
  /** 胜负原因描述 */
  winnerReason?: string;
  /** AI 难度（房主在大厅可调，开局后锁定；重开保留） */
  difficulty: AIDifficulty;
}

/** 按请求者角色裁剪后的全量视图（state:sync payload） */
export interface GameStateView {
  roomId: string;
  dayNumber: number;
  isNight: boolean;
  phase: Phase;
  players: PlayerPublicView[];
  /** 本人私有视图 */
  self: PlayerPrivateView;
  speeches: SpeechEntry[];
  /** 投票汇总（投票阶段实时已投人数 / 结束后票数） */
  voteSummary: VoteSummary;
  /** 仅狼人视图携带：狼队友座位 */
  wolfTeammates?: number[];
  /** 仅预言家视图携带：查验记录 */
  checkRecords?: CheckRecord[];
  /** 仅女巫视图携带：药水状态 */
  potions?: PotionState;
  /** 仅女巫视图携带：解药未用时的当晚刀口（私密，永不出现在广播） */
  witchKnifeTarget?: number | null;
  /** 当前发言者座位（DAY_SPEECH / DAY_PK 阶段） */
  currentSpeakerSeat?: number | null;
  /** 本人是当前发言者时为 true（前端据此开启输入框） */
  isMySpeechTurn?: boolean;
  /** 投票候选座位（DAY_VOTE / DAY_PK 阶段） */
  voteCandidates?: number[];
  /**
   * 本玩家在当前阶段是否拥有投票权（前端据此渲染投票面板或等待态）：
   * DAY_VOTE = 存活即可投；DAY_PK = 存活且不是平票者（平票者本人不参与 PK 再投票）。
   */
  selfCanVote?: boolean;
  /** 投票收集窗口是否开启（false = 投票已结束、结果公布中，前端据此展示票型明细） */
  voteCollecting?: boolean;
  /** 结算画面：已确认“继续游戏”的真人座位列表（仅 roomStatus=FINISHED 携带） */
  continueConfirmed?: number[];
  /** 结算画面：本局全部投票明细（仅分出胜负后下发，票型公开复盘） */
  voteHistory?: VoteRecord[];
  winner?: Winner;
  /** 胜负原因描述 */
  winnerReason?: string;
  /** 房间生命周期（WAITING/RUNNING/FINISHED，前端守卫与展示用） */
  roomStatus?: RoomStatus;
  /** 当前真人发言轮的服务端权威截止时间戳（Date.now()+timeLimitMs）；非发言轮为 null；仅展示，前端不据此强制提交 */
  speechDeadlineMs?: number | null;
  /** AI 难度（全员可见，仅房主在大厅可改） */
  difficulty?: AIDifficulty;
}

/** LLM 降级链状态（llm:status payload） */
export interface LLMStatus {
  activeRoute: 'A' | 'B' | 'C';
  message: string;
}

/** 统一 REST 响应信封 {code,data,message}（ARCHITECTURE.md §8.3） */
export interface RestEnvelope<T = unknown> {
  /** 0=成功；1001 房间码无效 / 1002 房满 / 1003 房间已开局 / 2001 参数非法 */
  code: number;
  data: T;
  message: string;
}

/** 建房/加入的统一返回数据 */
export interface RoomIdentity {
  roomId: string;
  roomCode: string;
  seat: number;
  playerId: string;
  rejoinToken: string;
  /** 是否房主（首个真人） */
  isHost: boolean;
}

/** 路线 B 设置（GET 返回掩码，POST 只写不读） */
export interface LLMSettingsView {
  routeAEnabled: boolean;
  routeBBaseUrl: string;
  routeBModel: string;
  /** 掩码回显：sk-****last4；未配置为 null */
  apiKeyMasked: string | null;
}

/** 路线 B 设置写入载荷（POST /api/settings） */
export interface LLMSettingsInput {
  routeAEnabled?: boolean;
  routeBBaseUrl?: string;
  routeBModel?: string;
  apiKey?: string;
}

/** 复盘 JSON 顶层结构（GameRecord.export()） */
export interface GameRecordJSON {
  roomId: string;
  roomCode: string;
  configName: string;
  seatCount: number;
  startedAt: string;
  finishedAt: string;
  winner: Winner;
  winnerReason: string;
  /** 座位 → 玩家与角色总表 */
  seats: { seat: number; name: string; avatarId: string; isHuman: boolean; persona: string; role: Role | null }[];
  nights: NightRecord[];
  speeches: SpeechEntry[];
  votes: VoteRecord[];
  /** 胜负过程播报 */
  timeline: { at: string; text: string }[];
}

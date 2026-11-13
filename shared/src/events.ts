/**
 * Socket.IO 事件协议（唯一实现源，事件命名“域:动作”，协议表已冻结不得改名）
 * 对应 ARCHITECTURE.md §4.3 协议表。
 */

import type {
  Action,
  GameStateView,
  LLMSettingsView,
  SpeechEntry,
} from './types';

/** 法官播报 judge:say payload */
export interface JudgeSayPayload {
  text: string;
}

/** 阶段切换 phase:change payload */
export interface PhaseChangePayload {
  dayNumber: number;
  phase: string;
  isNight: boolean;
  /** 有超时要求时的截止时间戳（ms），缺省表示无限等待 */
  deadline?: number | null;
}

/** 死讯 death:announce payload */
export interface DeathAnnouncePayload {
  seats: number[];
  cause: 'wolf' | 'poison' | 'exile';
}

/** 查验结果 check:result（私发预言家） */
export interface CheckResultPayload {
  targetSeat: number;
  result: 'WEREWOLF' | 'GOOD';
}

/** 狼队友揭示 wolf:teammates（私发狼人） */
export interface WolfTeammatesPayload {
  seats: number[];
}

/** 女巫夜间信息 witch:info（私发女巫） */
export interface WitchInfoPayload {
  /** 解药未用时才告知刀口；否则为 null */
  knifeTargetSeat: number | null;
}

/** 投票进度 vote:progress（广播，不含“谁投给谁”） */
export interface VoteProgressPayload {
  votedCount: number;
  totalVoters: number;
}

/** 投票结果 vote:result（迭代7：details = 谁投给谁的完整票型明细，投票结束后公开） */
export interface VoteResultPayload {
  tally: { seat: number; count: number }[];
  exiledSeat: number | null;
  isPK: boolean;
  /** 票型明细：voterSeat → targetSeat（弃票的真人不在列表中） */
  details: { voterSeat: number; targetSeat: number }[];
}

/** LLM 状态 llm:status */
export interface LLMStatusPayload {
  activeRoute: 'A' | 'B' | 'C';
  message: string;
}

/** 游戏结束 game:over */
export interface GameOverPayload {
  winner: 'WEREWOLF' | 'VILLAGER';
  reason: string;
  recordUrl: string | null;
}

/** 房主重开成功 game:restart（载荷恒为空对象：不含角色/刀口/查验等任何私密字段，安全红线） */
export interface GameRestartPayload {
  /** 预留扩展位；当前恒为空对象 */
  ok: true;
}

/** 打字动效 typing:start / typing:stop */
export interface TypingPayload {
  seat: number;
}

/** 夜间行动上行 payload */
export interface NightActionPayload {
  type: Action['type'];
  targetSeat?: number;
}

/** Client → Server 事件表 */
export interface ClientToServerEvents {
  /** REST 拿到身份后建立 socket 绑定；带 rejoinToken 即断线重连 */
  'room:join-socket': (
    payload: { playerId: string; rejoinToken?: string },
    ack: (res: { ok: boolean; error?: string }) => void,
  ) => void;
  /** 仅房主可发 */
  'game:start': (payload: Record<string, never>, ack: (res: { ok: boolean; error?: string }) => void) => void;
  /** 夜间行动，引擎校验当前阶段权限 */
  'action:night': (payload: NightActionPayload, ack: (res: { ok: boolean; error?: string }) => void) => void;
  /** 白天发言（≤120 字） */
  'speech:submit': (payload: { content: string }, ack: (res: { ok: boolean; error?: string }) => void) => void;
  /** 投票/PK 投票（引擎校验候选范围） */
  'vote:submit': (payload: { targetSeat: number }, ack: (res: { ok: boolean; error?: string }) => void) => void;
  /** 遗言 */
  'lastwords:submit': (payload: { content: string }, ack: (res: { ok: boolean; error?: string }) => void) => void;
  /** 结束后回大厅重开（同房） */
  'game:restart-request': (payload: Record<string, never>, ack: (res: { ok: boolean; error?: string }) => void) => void;
  /** 迭代4 F3：房主设置 AI 难度（仅大厅 WAITING 状态可改；广播经 state:sync 同步） */
  'room:set-difficulty': (
    payload: { difficulty: 'high' | 'medium' | 'low' },
    ack: (res: { ok: boolean; error?: string }) => void,
  ) => void;
}

/** Server → Client 事件表 */
export interface ServerToClientEvents {
  /** 全量裁剪视图，任何不确定时前端以此为准 */
  'state:sync': (payload: GameStateView) => void;
  /** 阶段切换广播 */
  'phase:change': (payload: PhaseChangePayload) => void;
  /** 法官播报 */
  'judge:say': (payload: JudgeSayPayload) => void;
  /** 发言入流水区 */
  'speech:new': (payload: SpeechEntry) => void;
  /** AI“打字中”动效 */
  'typing:start': (payload: TypingPayload) => void;
  'typing:stop': (payload: TypingPayload) => void;
  /** 死讯广播 */
  'death:announce': (payload: DeathAnnouncePayload) => void;
  /** 查验结果：私发预言家 */
  'check:result': (payload: CheckResultPayload) => void;
  /** 狼队友揭示：私发狼人 */
  'wolf:teammates': (payload: WolfTeammatesPayload) => void;
  /** 女巫夜间信息：私发女巫 */
  'witch:info': (payload: WitchInfoPayload) => void;
  /** 已投票人数（不显示投给谁） */
  'vote:progress': (payload: VoteProgressPayload) => void;
  /** 投票结果 */
  'vote:result': (payload: VoteResultPayload) => void;
  /** 顶栏 LLM 状态灯 */
  'llm:status': (payload: LLMStatusPayload) => void;
  /** 胜负 + 复盘下载地址 */
  'game:over': (payload: GameOverPayload) => void;
  /** 房主重开成功广播：前端立即清空全部会话级状态并关闭胜负弹窗，紧随其后的 state:sync 即新局起点 */
  'game:restart': (payload: GameRestartPayload) => void;
  /** 设置变更后通知前端刷新（路线 A 开关/路线 B 配置） */
  'settings:updated': (payload: LLMSettingsView) => void;
}

/** Socket 数据挂载（socket.data.playerId） */
export interface SocketData {
  playerId: string;
  roomId: string;
  seat: number;
}

/**
 * RoomManager —— 房间创建/房间码/加入/重连 token/行动转发/房销毁。
 * 房间码即简易鉴权（拍板②）：4 位数字码；rejoinToken 供断线重连（P1-5）。
 */

import * as crypto from 'node:crypto';

import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  Persona,
  Player,
  RoomIdentity,
  ServerToClientEvents,
  SocketData,
} from '@werewolf/shared';
import { ACTIVE_GAME_CONFIG, validateGameConfig } from '@werewolf/shared';

import type { AIEngine } from '../ai/AIEngine';
import type { LLMPipeline } from '../llm/LLMPipeline';
import { Room } from './Room';

/** Demo 固定：最多 2 真人（拍板⑥：真人按加入顺序占 1、2 号位） */
const MAX_HUMANS = 2;

/** 建房时 AI 预览占用 3-6 号座；2 号位留作第二真人预留席（迭代2 F1，拍板①） */
const AI_PREVIEW_SEATS = [3, 4, 5, 6];

/**
 * 内置 AI 花名册（迭代4 F2）：昵称改为中性名（不暗示性格）；
 * persona 仅注入 prompt，UI 不展示、每局开局随机洗牌分配（与昵称/座位解绑）。
 * avatarId 对应 client avatars.ts / 形象库图片。
 */
const AI_ROSTER: { name: string; avatarId: string; persona: Persona }[] = [
  {
    name: '阿澈',
    avatarId: 'ai-1',
    persona: { label: '激进', trait: '言辞犀利，喜欢带头指认，进攻性极强，容易激动' },
  },
  {
    name: '青禾',
    avatarId: 'ai-2',
    persona: { label: '稳健', trait: '发言谨慎、逻辑导向，不轻易表态，注重细节与票型' },
  },
  {
    name: '陆离',
    avatarId: 'ai-3',
    persona: { label: '演技派', trait: '擅长伪装情绪与表演，发言带戏剧色彩，善于骗取信任' },
  },
  {
    name: '白羽',
    avatarId: 'ai-4',
    persona: { label: '跟风', trait: '倾向跟随多数意见与强势发言者，很少坚持己见' },
  },
  {
    name: '一鸣',
    avatarId: 'ai-5',
    persona: { label: '速攻', trait: '语速极快、想到就说，抢先输出观点，反应敏捷但容易说漏嘴' },
  },
  {
    name: '望舒',
    avatarId: 'ai-6',
    persona: { label: '逻辑流', trait: '逐条分析票型与发言漏洞，引经据典条理清晰，略显啰嗦' },
  },
];

interface JoinOk {
  ok: true;
  identity: RoomIdentity;
}
interface JoinErr {
  ok: false;
  errorCode: number;
  message: string;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private codeIndex = new Map<string, string>();
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
  private aiEngine: AIEngine;
  private pipeline: LLMPipeline;

  constructor(
    io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>,
    aiEngine: AIEngine,
    pipeline: LLMPipeline,
  ) {
    this.io = io;
    this.aiEngine = aiEngine;
    this.pipeline = pipeline;
  }

  /** 建房：首个真人为房主占 1 号座；AI 预览占 3-6 号座；2 号位为第二真人预留席（拍板①） */
  createRoom(hostName: string): RoomIdentity {
    const config = ACTIVE_GAME_CONFIG;
    const configError = validateGameConfig(config);
    if (configError !== null) {
      throw new Error(`板子配置非法：${configError}`);
    }
    const roomId = crypto.randomUUID().slice(0, 8);
    const roomCode = this.allocRoomCode();
    const host: Player = {
      id: crypto.randomUUID(),
      seat: 1,
      name: hostName,
      avatarId: 'human',
      isHuman: true,
      persona: { label: '真人', trait: '由真人玩家操作' },
      role: null,
      alive: true,
      roleRevealed: false,
    };
    const room = new Room(roomId, roomCode, host, this.io, this.aiEngine, this.pipeline, config);
    room.attachAI(this.aiEngine);
    // AI 预览入座：固定占 3-6 号座（名字/头像/性格差异化）
    AI_PREVIEW_SEATS.forEach((seat, i) => {
      const roster = AI_ROSTER[i % AI_ROSTER.length];
      room.addAI(roster.name, roster.avatarId, roster.persona, seat);
    });
    const token = crypto.randomUUID();
    this.rooms.set(roomId, room);
    this.codeIndex.set(roomCode, roomId);
    return {
      roomId,
      roomCode,
      seat: host.seat,
      playerId: host.id,
      rejoinToken: token,
      isHost: true,
    };
  }

  /** 输码加入：房间码即鉴权；失败码 1001/1002/1003 */
  joinByCode(roomCode: string, nickname: string): JoinOk | JoinErr {
    const roomId = this.codeIndex.get(roomCode);
    if (!roomId) return { ok: false, errorCode: 1001, message: '房间码无效，请核对后重试' };
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, errorCode: 1001, message: '房间不存在或已解散' };
    if (room.humanCount >= MAX_HUMANS) {
      return { ok: false, errorCode: 1002, message: '真人席位已满（2 真人 + 4 AI）' };
    }
    const result = room.addHuman(nickname);
    if ('error' in result) {
      return { ok: false, errorCode: result.code, message: result.error };
    }
    return {
      ok: true,
      identity: {
        roomId,
        roomCode,
        seat: result.player.seat,
        playerId: result.player.id,
        rejoinToken: result.rejoinToken,
        isHost: false,
      },
    };
  }

  /** 分配不重复的 4 位房间码（0000-9999） */
  private allocRoomCode(): string {
    for (let attempt = 0; attempt < 10000; attempt++) {
      const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
      if (!this.codeIndex.has(code)) return code;
    }
    throw new Error('房间码分配失败：容量已满');
  }

  /** 断线重连：token 校验 + socket 重绑（P1-5） */
  rejoin(roomId: string, playerId: string, _token: string): { ok: boolean; message?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, message: '房间不存在或已解散' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, message: '玩家不在本房间' };
    return { ok: true };
  }

  /** socket 绑定到房间频道 */
  bindSocket(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>,
    playerId: string,
    rejoinToken?: string,
  ): { ok: boolean; message?: string; roomId?: string; seat?: number } {
    // 遍历房间找玩家（Demo 单局规模，量级安全）
    for (const room of this.rooms.values()) {
      const result = room.bindSocket(socket, playerId, rejoinToken);
      if (result.ok) {
        socket.join(`room:${room.roomId}`);
        return { ok: true, roomId: room.roomId, seat: result.seat };
      }
      if (result.message === '重连凭证无效') {
        return { ok: false, message: result.message };
      }
    }
    return { ok: false, message: '未找到该玩家的房间（可能已被解散）' };
  }

  /** 开始游戏：仅房主可发；开局前 fillAI 自动补满空座（迭代2 F1，禁止空位开局） */
  startGame(roomId: string, playerId: string): { ok: boolean; message?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, message: '房间不存在' };
    if (!room.isHost(playerId)) return { ok: false, message: '只有房主才能开始游戏' };
    return room.startGame(AI_ROSTER);
  }

  /** 迭代4 F3：房主设置 AI 难度（高/中/低），仅大厅可改 */
  setDifficulty(
    roomId: string,
    playerId: string,
    difficulty: 'high' | 'medium' | 'low',
  ): { ok: boolean; message?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, message: '房间不存在' };
    if (!room.isHost(playerId)) return { ok: false, message: '只有房主才能调整 AI 难度' };
    return room.setDifficulty(difficulty);
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  // ============ 行动转发 ============

  submitNightAction(
    roomId: string,
    playerId: string,
    payload: { type: string; targetSeat?: number },
  ): { ok: boolean; message?: string } {
    return this.rooms.get(roomId)?.submitNightAction(playerId, payload as never) ?? { ok: false, message: '房间不存在' };
  }

  submitSpeech(roomId: string, playerId: string, content: string): { ok: boolean; message?: string } {
    return this.rooms.get(roomId)?.submitSpeech(playerId, content) ?? { ok: false, message: '房间不存在' };
  }

  submitVote(roomId: string, playerId: string, targetSeat: number): { ok: boolean; message?: string } {
    return this.rooms.get(roomId)?.submitVote(playerId, targetSeat) ?? { ok: false, message: '房间不存在' };
  }

  submitLastWords(roomId: string, playerId: string, content: string): { ok: boolean; message?: string } {
    return this.rooms.get(roomId)?.submitLastWords(playerId, content) ?? { ok: false, message: '房间不存在' };
  }

  /** 结束后同房原子重开（重置→重建引擎→广播 game:restart→立即开局）：仅房主可发、仅 FINISHED 可调 */
  restartGame(roomId: string, playerId: string): { ok: boolean; message?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, message: '房间不存在' };
    if (!room.isHost(playerId)) return { ok: false, message: '只有房主才能重开游戏' };
    return room.restart(AI_ROSTER);
  }

  /** 断连处理 */
  handleDisconnect(roomId: string, playerId: string, socket: Socket): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.handleDisconnect(playerId, socket as never);
  }

  /** 全部房销毁（进程退出） */
  closeAll(): void {
    this.rooms.clear();
    this.codeIndex.clear();
  }
}

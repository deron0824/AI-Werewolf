/**
 * socket 单例 + REST API 封装（REST 统一 {code,data,message} 信封）。
 */

import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  LLMSettingsInput,
  LLMSettingsView,
  GameRecordJSON,
  RestEnvelope,
  RoomIdentity,
  ServerToClientEvents,
} from '@werewolf/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/** socket 单例（默认连接同源，nginx/vite 代理 /socket.io） */
export function getSocket(): AppSocket {
  if (!socket) {
    socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
  }
  return socket;
}

/** REST 信封解包：code!==0 抛 message */
async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json()) as RestEnvelope<T>;
  if (body.code !== 0) throw new Error(body.message || `请求失败（code=${body.code}）`);
  return body.data;
}

async function post<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return unwrap<T>(res);
}

export const api = {
  /** 建房 */
  createRoom: (nickname: string): Promise<RoomIdentity> => post('/api/rooms', { nickname }),
  /** 输码加入 */
  joinRoom: (roomCode: string, nickname: string): Promise<RoomIdentity> =>
    post('/api/rooms/join', { roomCode, nickname }),
  /** 读设置（Key 掩码回显） */
  getSettings: async (): Promise<LLMSettingsView> => {
    const res = await fetch('/api/settings');
    return unwrap<LLMSettingsView>(res);
  },
  /** 写设置（apiKey 只写不读） */
  saveSettings: (input: LLMSettingsInput): Promise<LLMSettingsView> => post('/api/settings', input),
  /** 复盘 JSON */
  fetchRecord: async (roomId: string): Promise<GameRecordJSON> => {
    const res = await fetch(`/api/rooms/${roomId}/record`);
    return unwrap<GameRecordJSON>(res);
  },
  /** 健康检查 */
  health: async (): Promise<{ status: string; activeRoute: string }> => {
    const res = await fetch('/api/health');
    return unwrap<{ status: string; activeRoute: string }>(res);
  },
};

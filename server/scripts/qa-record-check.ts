/**
 * QA 独立校验（迭代2 F6 补充）：重开前后的旧局复盘 GET 仍 200 且内容非空。
 * 流程：1 真人开局 → 终局（拿到 recordUrl）→ GET 复盘(第1局) → 重开 → 等 game:restart →
 *       再 GET 同一 recordUrl → 期望仍 200 且 seats/speeches 非空（旧局归档可下载）。
 */
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, GameStateView, GameRecordJSON } from '@werewolf/shared';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const BASE = 'http://localhost:3000';

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const envelope = (await res.json()) as { code: number; data: T; message: string };
  if (envelope.code !== 0) throw new Error(`REST ${path} 失败：${envelope.message}`);
  return envelope.data;
}

function attachAutoPlayer(socket: AppSocket): void {
  socket.on('state:sync', (view: GameStateView) => {
    switch (view.phase) {
      case 'NIGHT_WOLF':
        if (view.self.role === 'WEREWOLF' && view.self.alive) {
          const seats = view.players.filter((p) => p.alive && p.seat !== view.self.seat).map((p) => p.seat);
          socket.emit('action:night', { type: 'wolf_kill', targetSeat: seats[0] }, () => undefined);
        }
        break;
      case 'NIGHT_SEER':
        if (view.self.role === 'SEER' && view.self.alive) {
          const seats = view.players.filter((p) => p.alive && p.seat !== view.self.seat).map((p) => p.seat);
          socket.emit('action:night', { type: 'seer_check', targetSeat: seats[0] }, () => undefined);
        }
        break;
      case 'NIGHT_WITCH':
        if (view.self.role === 'WITCH' && view.self.alive) {
          socket.emit('action:night', { type: 'skip' }, () => undefined);
        }
        break;
      case 'DAY_SPEECH':
        if (view.isMySpeechTurn) {
          socket.emit('speech:submit', { content: '复盘校验：先听大家发言。' }, () => undefined);
        }
        break;
      case 'DAY_VOTE':
      case 'DAY_PK': {
        const candidates = (view.voteCandidates ?? []).filter((s) => s !== view.self.seat);
        if (view.self.alive && candidates.length > 0) {
          socket.emit('vote:submit', { targetSeat: candidates[0] }, () => undefined);
        }
        break;
      }
      default:
        break;
    }
  });
  socket.on('judge:say', ({ text }) => {
    const m = text.match(/请\s*(\d+)\s*号留遗言/);
    if (m && Number(m[1]) === socket.lastSeat) {
      socket.emit('lastwords:submit', { content: '复盘校验遗言。' }, () => undefined);
    }
  });
  socket.on('state:sync', (view: GameStateView) => {
    socket.lastSeat = view.self.seat;
  });
}

declare module 'socket.io-client' {
  interface Socket {
    lastSeat?: number;
  }
}

async function getRecord(url: string): Promise<{ status: number; json: GameRecordJSON | null }> {
  const res = await fetch(`${BASE}${url}`);
  let json: GameRecordJSON | null = null;
  try {
    json = (await res.json()) as GameRecordJSON;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function main(): Promise<void> {
  const identity = await postJSON<{ roomCode: string; playerId: string; rejoinToken: string }>('/api/rooms', {
    nickname: '复盘校验员',
  });
  const socket: AppSocket = io(BASE, { transports: ['websocket'] });
  attachAutoPlayer(socket);
  await new Promise<void>((resolve, reject) => {
    socket.emit('room:join-socket', { playerId: identity.playerId, rejoinToken: identity.rejoinToken }, (r) => {
      if (r.ok) resolve();
      else reject(new Error(r.error));
    });
  });

  const gameOver = new Promise<{ winner: string; recordUrl: string | null }>((resolve, reject) => {
    setTimeout(() => reject(new Error('180s 内未终局')), 180_000);
    socket.once('game:over', (p) => resolve(p));
  });
  socket.emit('game:start', {}, () => undefined);
  const over1 = await gameOver;
  if (!over1.recordUrl) throw new Error('game:over 未携带 recordUrl');
  const before = await getRecord(over1.recordUrl);
  console.log(`[qa-record] 第 1 局终局后 GET ${over1.recordUrl} → HTTP ${before.status}，seats=${before.json?.seats?.length}，speeches=${before.json?.speeches?.length}`);

  const restartEvent = new Promise<void>((resolve) => socket.once('game:restart', () => resolve()));
  const ack = new Promise<void>((resolve, reject) => {
    socket.emit('game:restart-request', {}, (r) => {
      if (r.ok) resolve();
      else reject(new Error(`重开被拒：${r.error}`));
    });
  });
  await ack;
  await restartEvent;
  console.log('[qa-record] 已重开（game:restart 已收到）');
  await new Promise((r) => setTimeout(r, 1500));
  const after = await getRecord(over1.recordUrl);
  console.log(`[qa-record] 重开后同 URL GET → HTTP ${after.status}，seats=${after.json?.seats?.length}，speeches=${after.json?.speeches?.length}，winner=${after.json?.winner}`);
  const ok =
    before.status === 200 &&
    after.status === 200 &&
    (before.json?.speeches?.length ?? 0) > 0 &&
    (after.json?.speeches?.length ?? 0) > 0 &&
    before.json?.seats?.length === 6 &&
    after.json?.seats?.length === 6;
  socket.close();
  if (ok) {
    console.log('[qa-record] 通过：重开后旧局复盘 GET 仍 200 且内容完整（归档生效）');
    process.exit(0);
  } else {
    console.error('[qa-record] 失败：重开后旧局复盘不可用或不完整');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[qa-record] 失败：', String(err));
  process.exit(1);
});

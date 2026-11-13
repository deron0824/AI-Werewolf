/**
 * 端到端整局模拟（手动执行，不进 CI）：
 * 2 个模拟真人（socket.io-client）+ AI（服务端 AIEngine）跑完整局，
 * 验证裁判状态机 LOBBY→夜晚→白天→投票→胜负 全流程闭环。
 *
 * 迭代 2 新增场景（ARCHITECTURE-iter2 T05）：
 *   mode=full    （默认）2 真人完整一局（迭代 1 回归）
 *   mode=solo    1 真人开局 → 服务端 fillAI 补满，6 席满员（I-P0-1）
 *   mode=restart 连续「同房重开」2 局均成功且能跑满全流程（I-P0-4）
 *
 * 用法：SPEED_MODE=0 npx tsx server/scripts/e2e-sim.ts [full|solo|restart]
 */

import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, GameStateView } from '@werewolf/shared';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const BASE = 'http://localhost:3000';
/** 整局超时上限（迭代4：AI 发言有真实展示节奏，整局可达数分钟，可用 E2E_TIMEOUT_MS 调大） */
const GAME_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 180_000);

interface Identity {
  roomCode: string;
  playerId: string;
  rejoinToken: string;
}

function randomAliveOther(view: GameStateView, exclude: number[] = []): number | undefined {
  const seats = view.players
    .filter((p) => p.alive && p.seat !== view.self.seat && !exclude.includes(p.seat))
    .map((p) => p.seat);
  return seats.length > 0 ? seats[Math.floor(Math.random() * seats.length)] : undefined;
}

/** 模拟一个真人客户端：收到视图后按阶段自动提交合法行动 */
function attachAutoPlayer(socket: AppSocket, name: string): void {
  socket.on('state:sync', (view) => {
    switch (view.phase) {
      case 'NIGHT_WOLF':
        if (view.self.role === 'WEREWOLF' && view.self.alive) {
          const t = randomAliveOther(view, view.wolfTeammates ?? []);
          socket.emit('action:night', { type: 'wolf_kill', targetSeat: t }, () => undefined);
        }
        break;
      case 'NIGHT_SEER':
        if (view.self.role === 'SEER' && view.self.alive) {
          const t = randomAliveOther(view);
          if (t !== undefined) socket.emit('action:night', { type: 'seer_check', targetSeat: t }, () => undefined);
        }
        break;
      case 'NIGHT_WITCH':
        if (view.self.role === 'WITCH' && view.self.alive) {
          socket.emit('action:night', { type: 'skip' }, () => undefined);
        }
        break;
      case 'DAY_SPEECH':
        if (view.isMySpeechTurn) {
          socket.emit('speech:submit', { content: `${name}：我目前没有明确怀疑对象，先听听大家的发言。` }, () => undefined);
        }
        break;
      case 'DAY_VOTE':
      case 'DAY_PK': {
        const candidates = (view.voteCandidates ?? []).filter((s) => s !== view.self.seat);
        if (view.self.alive && candidates.length > 0) {
          const target = candidates[Math.floor(Math.random() * candidates.length)];
          socket.emit('vote:submit', { targetSeat: target }, () => undefined);
        }
        break;
      }
      default:
        break;
    }
  });
  socket.on('judge:say', ({ text }) => {
    // 遗言：法官播报“请 X 号留遗言”且 X 是本人
    const match = text.match(/请\s*(\d+)\s*号留遗言/);
    if (match && Number(match[1]) === socket.lastSeat) {
      socket.emit('lastwords:submit', { content: `${name} 的遗言：注意发言最强势的人。` }, () => undefined);
    }
  });
  // 记录自己座位（state:sync 视图中取）
  socket.on('state:sync', (view) => {
    socket.lastSeat = view.self.seat;
  });
}

declare module 'socket.io-client' {
  interface Socket {
    lastSeat?: number;
  }
}

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

/** 建房 + 绑定 socket + 返回身份 */
async function makePlayer(nickname: string, roomCode?: string): Promise<{ socket: AppSocket; identity: Identity }> {
  const identity = roomCode
    ? await postJSON<Identity>('/api/rooms/join', { roomCode, nickname })
    : await postJSON<Identity>('/api/rooms', { nickname });
  const socket: AppSocket = io(BASE, { transports: ['websocket'] });
  attachAutoPlayer(socket, nickname.slice(0, 2));
  await new Promise<void>((resolve, reject) => {
    socket.emit('room:join-socket', { playerId: identity.playerId, rejoinToken: identity.rejoinToken }, (r) => {
      if (r.ok) resolve();
      else reject(new Error(r.error));
    });
  });
  return { socket, identity };
}

/** 等待一局跑完（game:over），到点超时报错 */
function awaitGameOver(socket: AppSocket, label: string): Promise<{ winner: string; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时：${GAME_TIMEOUT_MS / 1000}s 内未分出胜负`)), GAME_TIMEOUT_MS);
    socket.once('game:over', (payload) => {
      clearTimeout(timer);
      console.log(`[e2e] ${label} 终局：${payload.winner} 胜 —— ${payload.reason}`);
      resolve(payload);
    });
  });
}

/** 等待某座位号集合（下一帧 state:sync 校验席位满员） */
function awaitNextSeatCheck(socket: AppSocket, expect: number[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时：未收到 state:sync`)), 10000);
    const handler = (view: GameStateView): void => {
      const seats = view.players.map((p) => p.seat).sort((a, b) => a - b);
      const humans = view.players.filter((p) => p.isHuman).length;
      if (seats.length === expect.length && seats.every((s, i) => s === expect[i])) {
        socket.off('state:sync', handler);
        clearTimeout(timer);
        console.log(`[e2e] ${label} 席位 ${seats.join(',')}（真人 ${humans} + AI ${seats.length - humans}）✔ 满员无空位`);
        resolve();
      }
    };
    socket.on('state:sync', handler);
  });
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'full';
  const started = Date.now();

  if (mode === 'solo') {
    // ===== 迭代2 I-P0-1：1 真人开局 → fillAI 补满 6 席 =====
    const host = await makePlayer('独狼真人');
    console.log(`[e2e][solo] 房间 ${host.identity.roomCode} 就绪（1 真人 + 4 预览 AI，2 号位预留）`);
    const seatsFilled = awaitNextSeatCheck(host.socket, [1, 2, 3, 4, 5, 6], 'solo 开局后');
    host.socket.emit('game:start', {}, (r) => {
      if (!r.ok) throw new Error(`开局被拒：${r.error}`);
    });
    await seatsFilled;
    await awaitGameOver(host.socket, 'solo');
    console.log(`[e2e][solo] 补位局通过，耗时 ${Math.round((Date.now() - started) / 1000)}s`);
    host.socket.close();
    process.exit(0);
  }

  if (mode === 'restart') {
    // ===== 迭代2 I-P0-4：连续同房重开 2 局 =====
    const host = await makePlayer('重开甲');
    console.log(`[e2e][restart] 房间 ${host.identity.roomCode} 就绪`);
    host.socket.emit('game:start', {}, (r) => {
      if (!r.ok) throw new Error(`开局被拒：${r.error}`);
    });
    await awaitGameOver(host.socket, '第 1 局');

    for (let round = 1; round <= 2; round++) {
      const restartAck = new Promise<void>((resolve, reject) => {
        host.socket.emit('game:restart-request', {}, (r) => {
          if (r.ok) resolve();
          else reject(new Error(`第 ${round} 次重开被拒：${r.error}`));
        });
      });
      const restartEvent = new Promise<void>((resolve) => {
        host.socket.once('game:restart', () => resolve());
      });
      const nextGameOver = awaitGameOver(host.socket, `重开第 ${round} 局`);
      await restartAck;
      await restartEvent;
      console.log(`[e2e][restart] 第 ${round} 次重开成功（game:restart 广播已收到，免刷新进新局）`);
      await nextGameOver;
    }
    console.log(`[e2e][restart] 连续重开 2 局通过，耗时 ${Math.round((Date.now() - started) / 1000)}s`);
    host.socket.close();
    process.exit(0);
  }

  // ===== 默认 full：2 真人完整一局（迭代 1 回归） =====
  const host = await makePlayer('真人甲');
  const guest = await makePlayer('真人乙', host.identity.roomCode);
  console.log(`[e2e] 房间 ${host.identity.roomCode} 就绪，开始游戏`);
  const finished = awaitGameOver(host.socket, 'full');
  host.socket.emit('game:start', {}, (r) => {
    if (!r.ok) throw new Error(r.error);
  });
  await finished;
  console.log(`[e2e] 全流程闭环通过，耗时 ${Math.round((Date.now() - started) / 1000)}s`);
  host.socket.close();
  guest.socket.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[e2e] 失败：', String(err));
  process.exit(1);
});

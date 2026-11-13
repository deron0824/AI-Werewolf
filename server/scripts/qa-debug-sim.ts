/**
 * QA 诊断脚本：加入房间、开局，打印全部事件流（带时间戳），
 * 用于定位 e2e-sim 卡死的阶段。一次性诊断工具，不属于交付代码。
 */
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@werewolf/shared';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const BASE = 'http://localhost:3000';
const t0 = Date.now();
const ts = (): string => `[${String((Date.now() - t0) / 1000).padStart(6)}s]`;

function log(...args: unknown[]): void {
  console.log(ts(), ...args);
}

function attach(socket: AppSocket, name: string): void {
  for (const ev of [
    'state:sync', 'phase:change', 'judge:say', 'speech:new', 'typing:start', 'typing:stop',
    'death:announce', 'check:result', 'wolf:teammates', 'witch:info', 'vote:progress',
    'vote:result', 'llm:status', 'game:over', 'settings:updated',
  ] as const) {
    socket.on(ev, (payload: unknown) => {
      const p = payload as Record<string, unknown>;
      if (ev === 'state:sync') {
        log(`${name}<state:sync> phase=${p.phase} day=${p.dayNumber} self=${JSON.stringify(p.self)} myTurn=${p.isMySpeechTurn} cands=${JSON.stringify(p.voteCandidates)} wolfMates=${JSON.stringify(p.wolfTeammates)}`);
      } else if (ev === 'speech:new') {
        log(`${name}<speech:new>`, JSON.stringify(p));
      } else {
        log(`${name}<${ev}>`, JSON.stringify(p));
      }
    });
  }
}

function randomAliveOther(socket: AppSocket, exclude: number[] = []): number | undefined {
  const v = socket.lastView;
  if (!v) return undefined;
  const seats = v.players
    .filter((p) => p.alive && p.seat !== v.self.seat && !exclude.includes(p.seat))
    .map((p) => p.seat);
  return seats.length > 0 ? seats[Math.floor(Math.random() * seats.length)] : undefined;
}

declare module 'socket.io-client' {
  interface Socket {
    lastView?: import('@werewolf/shared').GameStateView;
    name?: string;
  }
}

function attachAuto(socket: AppSocket): void {
  socket.on('state:sync', (view) => {
    socket.lastView = view;
    const name = socket.name ?? '?';
    switch (view.phase) {
      case 'NIGHT_WOLF':
        if (view.self.role === 'WEREWOLF' && view.self.alive) {
          const t = randomAliveOther(socket, view.wolfTeammates ?? []);
          log(`${name} 提交 wolf_kill target=${t}`);
          socket.emit('action:night', { type: 'wolf_kill', targetSeat: t }, (r) => log(`${name} ack action:night`, JSON.stringify(r)));
        }
        break;
      case 'NIGHT_SEER':
        if (view.self.role === 'SEER' && view.self.alive) {
          const t = randomAliveOther(socket);
          log(`${name} 提交 seer_check target=${t}`);
          if (t !== undefined) socket.emit('action:night', { type: 'seer_check', targetSeat: t }, (r) => log(`${name} ack action:night`, JSON.stringify(r)));
        }
        break;
      case 'NIGHT_WITCH':
        if (view.self.role === 'WITCH' && view.self.alive) {
          const knife = view.witchKnifeTarget ?? null;
          const potions = view.potions ?? { saveUsed: false, poisonUsed: false };
          if (!potions.saveUsed && knife !== null && knife !== view.self.seat) {
            log(`${name} 提交 witch_save target=${knife}`);
            socket.emit('action:night', { type: 'witch_save', targetSeat: knife }, (r) => log(`${name} ack witch_save`, JSON.stringify(r)));
          } else {
            log(`${name} 提交 witch skip (knife=${knife} saveUsed=${potions.saveUsed})`);
            socket.emit('action:night', { type: 'skip' }, (r) => log(`${name} ack witch skip`, JSON.stringify(r)));
          }
        }
        break;
      case 'DAY_SPEECH':
        if (view.isMySpeechTurn) {
          log(`${name} 提交发言`);
          socket.emit('speech:submit', { content: `${name}：我先表个水，听听大家怎么说。` }, (r) => log(`${name} ack speech`, JSON.stringify(r)));
        }
        break;
      case 'DAY_VOTE':
      case 'DAY_PK': {
        const candidates = (view.voteCandidates ?? []).filter((s) => s !== view.self.seat);
        if (view.self.alive && candidates.length > 0) {
          const target = candidates[Math.floor(Math.random() * candidates.length)];
          log(`${name} 提交投票 target=${target}`);
          socket.emit('vote:submit', { targetSeat: target }, (r) => log(`${name} ack vote`, JSON.stringify(r)));
        }
        break;
      }
      default:
        break;
    }
  });
  socket.on('judge:say', ({ text }) => {
    const match = text.match(/请\s*(\d+)\s*号留遗言/);
    if (match && socket.lastView && Number(match[1]) === socket.lastView.self.seat) {
      log(`${socket.name} 提交遗言`);
      socket.emit('lastwords:submit', { content: `${socket.name} 的遗言：小心发言强势的人。` }, (r) => log(`${socket.name} ack lastwords`, JSON.stringify(r)));
    }
  });
}

async function main(): Promise<void> {
  const res1 = await fetch(`${BASE}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: '诊断甲' }),
  });
  const host = ((await res1.json()) as { data: import('@werewolf/shared').RoomIdentity }).data;
  const res2 = await fetch(`${BASE}/api/rooms/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomCode: host.roomCode, nickname: '诊断乙' }),
  });
  const guest = ((await res2.json()) as { data: import('@werewolf/shared').RoomIdentity }).data;
  log(`房间 ${host.roomCode} 创建`);

  const socketA: AppSocket = io(BASE, { transports: ['websocket'] });
  const socketB: AppSocket = io(BASE, { transports: ['websocket'] });
  socketA.name = '甲';
  socketB.name = '乙';
  attach(socketA, '甲');
  attach(socketB, '乙');
  attachAuto(socketA);
  attachAuto(socketB);
  await new Promise<void>((resolve) => {
    let n = 0;
    const done = (): void => { n += 1; if (n === 2) resolve(); };
    socketA.emit('room:join-socket', { playerId: host.playerId, rejoinToken: host.rejoinToken }, (r) => { log('甲 join-socket', JSON.stringify(r)); done(); });
    socketB.emit('room:join-socket', { playerId: guest.playerId, rejoinToken: guest.rejoinToken }, (r) => { log('乙 join-socket', JSON.stringify(r)); done(); });
  });
  socketA.on('game:over', () => {
    log('=== 终局到达，诊断结束 ===');
    setTimeout(() => process.exit(0), 500);
  });
  setTimeout(() => { log('=== 120s 诊断超时 ==='); process.exit(2); }, 120_000);
  socketA.emit('game:start', {}, (r) => log('甲 game:start ack', JSON.stringify(r)));
}

main().catch((err) => { console.error('诊断脚本异常：', String(err)); process.exit(1); });

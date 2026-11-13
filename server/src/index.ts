/**
 * 服务端入口：Express REST + Socket.IO 装配
 * 分层：接入层（本文件）→ 房间层（RoomManager/Room）→ 引擎层（JudgeEngine）→ 智能层（AIEngine/LLMPipeline）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';

import express, { type Request, type Response } from 'express';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents, SocketData } from '@werewolf/shared';

import { config } from './config';
import { sanitizeLogText, saveSettings, settingsView } from './security/secrets';
import { RoomManager } from './room/RoomManager';
import { LLMPipeline } from './llm/LLMPipeline';
import { WorkBuddyCloudProvider } from './llm/WorkBuddyCloudProvider';
import { AIEngine } from './ai/AIEngine';
import type { LLMSettingsInput, RoomIdentity } from '@werewolf/shared';

/** REST 统一响应信封 */
function ok<T>(res: Response, data: T): void {
  res.json({ code: 0, data, message: 'ok' });
}
function fail(res: Response, code: number, message: string): void {
  res.json({ code, data: null, message: sanitizeLogText(message) });
}

/** 读取项目根 cloudConfig.json（主理人激活产物），缺失返回 null */
function readCloudConfig(): { endpoint: string; publishableKey: string } | null {
  for (const rel of config.cloudConfigCandidates) {
    const abs = path.resolve(process.cwd(), rel);
    try {
      const raw = fs.readFileSync(abs, 'utf-8');
      const parsed = JSON.parse(raw) as { endpoint?: string; publishableKey?: string };
      if (parsed.endpoint && parsed.publishableKey) {
        return { endpoint: parsed.endpoint, publishableKey: parsed.publishableKey };
      }
    } catch {
      // 尝试下一个候选路径
    }
  }
  return null;
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const httpServer = http.createServer(app);
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: config.corsOrigin, credentials: false },
  });
  /** 服务端连接 socket 类型别名 */
  type RoomSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

  // ===== 智能层装配：LLM 三级降级链 A→B→C =====
  const pipeline = new LLMPipeline();

  // 路线 A：WorkBuddy 免密钥（cloudConfig.json 存在即注册）
  const cloudConfig = readCloudConfig();
  if (cloudConfig) {
    pipeline.register(new WorkBuddyCloudProvider(cloudConfig.endpoint, cloudConfig.publishableKey));
  } else {
    console.warn('[llm] 未找到 cloudConfig.json，路线 A 不可用（Pipeline 自动降级到 B/C）');
  }
  // 路线 B/C 由 Pipeline 内部按 settings 动态构建（B 可热配置，C 永在）
  pipeline.onStatus((status) => io.emit('llm:status', status));
  await pipeline.refreshChain(settingsView().routeAEnabled);

  // ===== 房间层装配 =====
  const aiEngine = new AIEngine(pipeline);
  const roomManager = new RoomManager(io, aiEngine, pipeline);

  // ===== REST API =====
  app.get('/api/health', (_req: Request, res: Response) => {
    ok(res, { status: 'up', activeRoute: pipeline.getStatus().activeRoute });
  });

  app.post('/api/rooms', (req: Request, res: Response) => {
    const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname.trim() : '';
    if (!nickname || nickname.length > 12) {
      fail(res, 2001, '昵称非法（1-12 字符）');
      return;
    }
    const identity = roomManager.createRoom(nickname);
    ok<RoomIdentity>(res, identity);
  });

  app.post('/api/rooms/join', (req: Request, res: Response) => {
    const roomCode = typeof req.body?.roomCode === 'string' ? req.body.roomCode.trim().toUpperCase() : '';
    const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname.trim() : '';
    if (!roomCode || !nickname || nickname.length > 12) {
      fail(res, 2001, '房间码或昵称非法');
      return;
    }
    const result = roomManager.joinByCode(roomCode, nickname);
    if (!result.ok) {
      fail(res, result.errorCode ?? 2001, result.message ?? '加入失败');
      return;
    }
    ok<RoomIdentity>(res, result.identity!);
  });

  app.get('/api/settings', (_req: Request, res: Response) => {
    ok(res, settingsView());
  });

  app.post('/api/settings', async (req: Request, res: Response) => {
    const body = req.body as LLMSettingsInput;
    if (typeof body !== 'object' || body === null) {
      fail(res, 2001, '设置载荷非法');
      return;
    }
    saveSettings({
      routeAEnabled: typeof body.routeAEnabled === 'boolean' ? body.routeAEnabled : undefined,
      routeBBaseUrl: typeof body.routeBBaseUrl === 'string' ? body.routeBBaseUrl : undefined,
      routeBModel: typeof body.routeBModel === 'string' ? body.routeBModel : undefined,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
    });
    const view = settingsView();
    // 重建 Provider 链并广播新状态
    await pipeline.refreshChain(view.routeAEnabled);
    io.emit('settings:updated', view);
    ok(res, view);
  });

  app.get('/api/rooms/:roomId/record', (req: Request, res: Response) => {
    const room = roomManager.getRoom(req.params.roomId);
    if (!room) {
      fail(res, 1001, '房间不存在');
      return;
    }
    const record = room.exportRecord();
    if (!record) {
      fail(res, 2001, '对局尚未开始或未结束，暂无复盘数据');
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="record-${req.params.roomId}.json"`);
    res.send(JSON.stringify(record, null, 2));
  });

  // ===== Socket.IO =====
  io.on('connection', (socket: RoomSocket) => {
    // 新连接立即同步当前 LLM 降级链状态：llm:status 平时只在状态变化时广播，
    // 后连入/刷新页面的客户端若不主动推一次，会一直停在“未收到状态”的兜底显示上
    socket.emit('llm:status', pipeline.getStatus());
    socket.on('room:join-socket', (payload, ack) => {
      const result = roomManager.bindSocket(socket as never, payload.playerId, payload.rejoinToken);
      if (!result.ok) {
        ack({ ok: false, error: result.message ?? '绑定失败' });
        return;
      }
      socket.data.playerId = payload.playerId;
      socket.data.roomId = result.roomId!;
      socket.data.seat = result.seat!;
      socket.join(`room:${result.roomId}`);
      ack({ ok: true });
    });

    socket.on('game:start', (_payload, ack) => {
      const result = roomManager.startGame(socket.data.roomId, socket.data.playerId);
      ack({ ok: result.ok, error: result.ok ? undefined : (result.message ?? '无法开始') });
    });

    socket.on('action:night', (payload, ack) => {
      const result = roomManager.submitNightAction(socket.data.roomId, socket.data.playerId, payload);
      ack({ ok: result.ok, error: result.ok ? undefined : result.message });
    });

    socket.on('speech:submit', (payload, ack) => {
      const result = roomManager.submitSpeech(socket.data.roomId, socket.data.playerId, payload.content);
      ack({ ok: result.ok, error: result.ok ? undefined : result.message });
    });

    socket.on('vote:submit', (payload, ack) => {
      const result = roomManager.submitVote(socket.data.roomId, socket.data.playerId, payload.targetSeat);
      ack({ ok: result.ok, error: result.ok ? undefined : result.message });
    });

    socket.on('lastwords:submit', (payload, ack) => {
      const result = roomManager.submitLastWords(socket.data.roomId, socket.data.playerId, payload.content);
      ack({ ok: result.ok, error: result.ok ? undefined : result.message });
    });

    socket.on('game:restart-request', (_payload, ack) => {
      // 迭代7：任一真人可发 = “继续游戏”确认票；两真人齐 → 同房重开
      const result = roomManager.continueGame(socket.data.roomId, socket.data.playerId);
      ack({ ok: result.ok, error: result.ok ? undefined : result.message });
    });

    socket.on('room:set-difficulty', (payload, ack) => {
      const result = roomManager.setDifficulty(socket.data.roomId, socket.data.playerId, payload.difficulty);
      ack({ ok: result.ok, error: result.ok ? undefined : result.message });
    });

    socket.on('disconnect', () => {
      if (socket.data.roomId) {
        roomManager.handleDisconnect(socket.data.roomId, socket.data.playerId, socket as never);
      }
    });
  });

  httpServer.listen(config.port, () => {
    console.log(sanitizeLogText(`[server] 狼人杀 Demo 服务端已启动 http://0.0.0.0:${config.port}`));
  });

  // 优雅退出
  const shutdown = (): void => {
    console.log('[server] 正在关闭…');
    roomManager.closeAll();
    io.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] 启动失败：', sanitizeLogText(String(err)));
  process.exit(1);
});

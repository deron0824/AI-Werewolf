/**
 * 服务端全部可配置项（ARCHITECTURE.md §8.10：节奏参数集中，禁魔法数字）
 *
 * 优先级：真实环境变量 > 项目根 .env > 默认值；SPEED_MODE 倍率作用于全部延迟类参数。
 * 路线 B 的 API Key / baseUrl 等敏感配置由 security/secrets.ts 管理
 * （server/data/settings.json，0600），本文件不接触明文 Key。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 数值环境变量读取（缺失/非法回退默认值） */
function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** 极速模式倍率（0.5 = 一半延迟；SPEED_MODE=0 时延迟取最小值 100ms） */
const SPEED_MODE = numEnv('SPEED_MODE', 1);
const speedMul = (ms: number): number => (SPEED_MODE <= 0 ? 100 : Math.round(ms * SPEED_MODE));

/**
 * 轻量 .env 加载（零依赖，替代 dotenv）：按候选路径找到首个存在的 .env，
 * 解析 KEY=VALUE 行写入 process.env；真实环境变量优先（已存在的不覆盖）。
 * 缺失 .env 属正常（全部走内置默认值），静默跳过。
 */
function loadDotEnv(): void {
  const candidates = ['.env', '../.env'] as string[];
  for (const rel of candidates) {
    try {
      const raw = readFileSync(resolve(process.cwd(), rel), 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (key && process.env[key] === undefined) process.env[key] = value;
      }
      break; // 只加载首个命中的 .env
    } catch {
      // 文件不存在 → 尝试下一个候选路径
    }
  }
}
loadDotEnv();

export const config = {
  /** HTTP / Socket.IO 监听端口 */
  port: numEnv('PORT', 3000),
  /** CORS 允许的来源（* = 本地 Demo 任意来源） */
  corsOrigin: process.env.CORS_ORIGIN ?? '*',

  /** 数据目录（settings.json / 复盘 JSON 存放处，Docker volume 持久化） */
  dataDir: process.env.DATA_DIR ?? 'data',

  /** cloudConfig.json 候选路径（激活产物；缺失则路线 A 不可用） */
  cloudConfigCandidates: [
    'cloudConfig.json', // 仓库根（主理人激活产物位置；cwd=根目录或 server 目录均向上/本地可命中）
    '../cloudConfig.json', // cwd=server 目录时指向仓库根
    'server/src/llm/cloudConfig.json', // 架构文档约定的 server 内路径（cwd=根目录）
    'src/llm/cloudConfig.json', // cwd=server 目录时的 server 内路径
  ] as string[],

  llm: {
    /** 单次 LLM 调用总超时（默认 10s，LLMPipeline 统一 AbortController） */
    timeoutMs: speedMul(numEnv('LLM_TIMEOUT_MS', 10_000)),
    /**
     * 路线 A 首选模型（models.list() 中存在且未禁用时优先使用；否则回退第一个可用模型）。
     * 默认空 = 不指定档位，直接取列表第一个可用模型（第一版行为）。
     * 如需指定：.env 设 WB_PREFERRED_MODEL_ID=deepseek-v4.1-flash 等。
     */
    preferredRouteAModel: process.env.WB_PREFERRED_MODEL_ID ?? '',
    /** 路线 B 默认 OpenAI 兼容参数 */
    defaultRouteBBaseUrl: 'https://api.openai.com/v1',
    defaultRouteBModel: 'gpt-4o-mini',
    /** 结构化决策输出 JSON 模式 */
    decisionJsonMode: true,
    /** 路线 A 健康检查失败后熔断时长（该段时间内直接跳过 A） */
    routeABreakMs: speedMul(numEnv('LLM_ROUTE_A_BREAK_MS', 60_000)),
    /** 提示注入清洗后单条信息的最大字符数 */
    promptSanitizeMaxLen: 2000,
  },

  /** AI 行为节奏（全部受 SPEED_MODE 倍率影响） */
  ai: {
    /** AI“打字中”动效延迟区间：1~3s 随机 */
    typingDelayMinMs: speedMul(numEnv('AI_TYPING_DELAY_MIN_MS', 1_000)),
    typingDelayMaxMs: speedMul(numEnv('AI_TYPING_DELAY_MAX_MS', 3_000)),
  },

  /** 文案限长 */
  speech: {
    /** 发言最大长度（前端限长 + 服务端校验）。迭代3：放宽以支持约 1 分钟的 AI 口播量 */
    maxLength: 300,
    /** 模板/LLM 发言目标字数区间（约 1 分钟口语量，按 5 字/秒流式字幕展示） */
    targetMinLength: 120,
    targetMaxLength: 260,
    /** 遗言最大长度 */
    lastWordsMaxLength: 200,
    /**
     * 真人白天发言限时（迭代2 F4）。
     * 注意：这是玩法时长不是演示节奏，【不受 SPEED_MODE 倍率影响】。
     * 0 = 不限时（法官无限等待）。
     */
    timeLimitMs: numEnv('SPEECH_TIME_LIMIT_MS', 60_000),
    /**
     * AI 发言展示节奏开关（迭代3 F1）。SPEED_MODE<=0（极速/e2e 模式）时关闭，
     * 服务端不为字幕展示等待，保证测试与极速演示不受影响。
     */
    pacingEnabled: SPEED_MODE > 0,
    /**
     * AI 发言字幕流式展示速度（字/秒）。迭代5：提速为 8 字/秒，客户端打字机与服务端节奏共用该值。
     */
    displayCps: numEnv('SPEECH_DISPLAY_CPS', 8),
    /**
     * AI 发言展示节奏上限（服务端等待时长封顶，≈1 分钟讲完）。
     * 演示节奏参数，【受 SPEED_MODE 倍率影响】——e2e/极速模式下自动压缩，不拖慢测试。
     */
    aiDisplayMaxMs: speedMul(numEnv('AI_SPEECH_DISPLAY_MAX_MS', 60_000)),
  },

  /** 真人行动超时：Demo 默认 0 = 法官无限等待真人（UNCLEAR #2） */
  humanActionTimeoutMs: speedMul(numEnv('HUMAN_ACTION_TIMEOUT_MS', 0)),

  /** 复盘记录保留目录（位于 dataDir 下） */
  recordDirName: 'records',

  /** 健康检查脚本用：最小 chat 调用的提示词 */
  healthCheckPrompt: '你是一个连通性测试助手，请回复“OK”两个字母，不要输出其他内容。',
};

export type AppConfig = typeof config;

/**
 * 路线 B API Key 与 LLM 开关的本地存储（安全红线，ARCHITECTURE.md §8.7）
 *
 * - 存储文件：<dataDir>/settings.json，权限 0600（Windows 下尽力模拟）
 * - GET 接口只回掩码（sk-****last4），明文 Key 只写不读
 * - 所有日志出口经 sanitizeLogText() 脱敏，任何 logger 不得打印明文 Key
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { config } from '../config';

/** settings.json 落盘结构（apiKey 为明文，仅存本地文件） */
interface SettingsFile {
  routeAEnabled: boolean;
  routeBBaseUrl: string;
  routeBModel: string;
  apiKey: string;
}

const DEFAULT_SETTINGS: SettingsFile = {
  routeAEnabled: true,
  routeBBaseUrl: config.llm.defaultRouteBBaseUrl,
  routeBModel: config.llm.defaultRouteBModel,
  apiKey: '',
};

/** settings.json 绝对路径（相对 server 进程 cwd） */
function settingsPath(): string {
  return path.resolve(process.cwd(), config.dataDir, 'settings.json');
}

/** 确保数据目录存在 */
function ensureDataDir(): void {
  const dir = path.resolve(process.cwd(), config.dataDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Windows 不支持 POSIX 权限位，尽力设置为仅当前用户可见 */
function forcePrivateMode(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // 非 POSIX 文件系统：忽略（Docker/生产环境为 Linux，0600 生效）
  }
}

/** 读取完整设置（含明文 Key；仅服务端内部使用，禁止直接下发） */
export function loadSettings(): SettingsFile {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SettingsFile>;
    return {
      routeAEnabled: parsed.routeAEnabled ?? DEFAULT_SETTINGS.routeAEnabled,
      routeBBaseUrl: parsed.routeBBaseUrl || DEFAULT_SETTINGS.routeBBaseUrl,
      routeBModel: parsed.routeBModel || DEFAULT_SETTINGS.routeBModel,
      apiKey: parsed.apiKey ?? '',
    };
  } catch {
    // 文件缺失或损坏 → 使用默认（路线 A 开、路线 B 未配置）
    return { ...DEFAULT_SETTINGS };
  }
}

/** 写入设置（0600 权限；apiKey 只写不回读给客户端） */
export function saveSettings(patch: Partial<Omit<SettingsFile, 'apiKey'>> & { apiKey?: string }): SettingsFile {
  const merged: SettingsFile = { ...loadSettings() };
  if (patch.routeAEnabled !== undefined) merged.routeAEnabled = patch.routeAEnabled;
  if (patch.routeBBaseUrl !== undefined && patch.routeBBaseUrl.trim()) {
    merged.routeBBaseUrl = patch.routeBBaseUrl.trim();
  }
  if (patch.routeBModel !== undefined && patch.routeBModel.trim()) {
    merged.routeBModel = patch.routeBModel.trim();
  }
  // 空字符串表示清除 Key；undefined 表示不修改
  if (patch.apiKey !== undefined) merged.apiKey = patch.apiKey.trim();
  ensureDataDir();
  const filePath = settingsPath();
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  forcePrivateMode(filePath);
  return merged;
}

/** 掩码回显：sk-****last4（Key 少于 4 位时视为已配置但不可显示） */
export function maskKey(key: string): string | null {
  if (!key) return null;
  const last4 = key.slice(-4);
  return `****${last4}`;
}

/** GET /api/settings 返回的安全视图（永不包含明文 Key） */
export function settingsView(): {
  routeAEnabled: boolean;
  routeBBaseUrl: string;
  routeBModel: string;
  apiKeyMasked: string | null;
} {
  const s = loadSettings();
  return {
    routeAEnabled: s.routeAEnabled,
    routeBBaseUrl: s.routeBBaseUrl,
    routeBModel: s.routeBModel,
    apiKeyMasked: maskKey(s.apiKey),
  };
}

/**
 * 日志脱敏：把任何出现过的 Key 字符串替换为掩码。
 * 约定：所有 logger 出口（console / event 日志）必须先经过本函数。
 */
export function sanitizeLogText(text: string): string {
  let safe = text;
  const settings = loadSettings();
  if (settings.apiKey) {
    safe = safe.split(settings.apiKey).join('****（已脱敏）');
  }
  // 兜底正则：常见 sk- / wbpk_ 前缀的长 token
  safe = safe.replace(/(sk-|wbpk_)[A-Za-z0-9_-]{8,}/g, '$1****（已脱敏）');
  return safe;
}

/**
 * 语音识别（Speech-to-Text）浏览器封装 —— 迭代3 F3：玩家麦克风输入转字幕。
 *
 * 基于 Web Speech API（SpeechRecognition），识别结果以"草稿"形式回调，
 * 由调用方拼进输入框（textarea = 已确认内容 + 识别草稿），玩家确认后再提交。
 *
 * 支持性约束（UI 层据此决定是否显示 🎤 按钮）：
 * - 需要 Chrome / Edge 等基于 Chromium 的浏览器（window.SpeechRecognition）
 * - 需要安全上下文（localhost 或 HTTPS）；局域网 HTTP 访问时浏览器会禁用麦克风 API
 * - Chrome 的识别引擎依赖谷歌服务，国内网络不可用时 onerror(network) → 回退键盘输入
 */

/** 一次听写会话的句柄：stop 停止识别（调用方负责把草稿提交进输入框） */
export interface DictationHandle {
  stop: () => void;
}

export interface DictationHandlers {
  /** 识别草稿更新（会话累计终稿 + 当前中间结果，全量回调） */
  onDraft: (fullDraft: string) => void;
  /** 识别出错（message 已是可展示的中文提示） */
  onError: (message: string) => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** 当前浏览器是否可用麦克风识别（不支持时 UI 不渲染 🎤，静默回退键盘输入） */
export function getSttSupport(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  if (!w.SpeechRecognition && !w.webkitSpeechRecognition) return false;
  // 非安全上下文（局域网 HTTP）浏览器直接禁用麦克风 API
  if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) return false;
  return true;
}

/** 错误码 → 中文提示（空串表示可静默忽略） */
function errorText(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '麦克风权限被拒绝，请在浏览器地址栏授权后重试';
    case 'network':
      return '语音识别服务不可用（浏览器识别引擎需联网），请改用键盘输入';
    case 'audio-capture':
      return '未检测到麦克风设备，请改用键盘输入';
    case 'aborted':
      return ''; // 用户主动停止，静默
    case 'no-speech':
      return ''; // 没听到内容，继续等待即可
    default:
      return `语音识别出错（${code}），请改用键盘输入`;
  }
}

/**
 * 启动一次听写会话（连续识别，静默超时会自动续起直到调用 stop）。
 * 环境不支持时返回 null（调用方回退纯键盘输入）。
 */
export function startDictation(handlers: DictationHandlers): DictationHandle | null {
  if (!getSttSupport()) return null;
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as SpeechRecognitionCtor;
  const recognition = new Ctor();
  recognition.lang = 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = true;

  let sessionFinal = ''; // 本会话已确认的累计文本
  let active = true;

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0]?.transcript ?? '';
      if (r.isFinal) {
        // 只累计 resultIndex 之后的新终稿？不同实现 resultIndex 语义不一，
        // 这里用"终稿全量重建"：每次事件把 isFinal 段重拼（段顺序稳定，幂等安全）
        continue;
      }
      interim += text;
    }
    let finalRebuild = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalRebuild += r[0]?.transcript ?? '';
    }
    sessionFinal = finalRebuild;
    handlers.onDraft(sessionFinal + interim);
  };

  recognition.onerror = (e) => {
    const msg = errorText(e.error ?? '');
    if (msg) handlers.onError(msg);
  };

  recognition.onend = () => {
    // 连续模式：浏览器静默超时可能自动断开，会话仍激活时续起
    if (active) {
      try {
        recognition.start();
      } catch {
        // 已在启动中/环境异常，忽略（下次 onerror 兜底）
      }
    }
  };

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    stop: () => {
      active = false;
      try {
        recognition.stop();
      } catch {
        // 忽略
      }
    },
  };
}

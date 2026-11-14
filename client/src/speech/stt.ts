/**
 * 语音识别（Speech-to-Text）浏览器封装 —— 迭代3 F3：玩家麦克风输入转字幕。
 *
 * 修复版识别逻辑：
 * - 增量追加模式（onresult 用 resultIndex 起点，isFinal 段只增不减进 sessionFinal），
 *   修复跨自动重启丢终稿（旧"全量重建"在浏览器清掉历史 results 时会丢字）；
 * - 重启循环防护：连续错误计数达上限自动停止并温和提示；
 * - 会话时长上限 90 秒自动停止（草稿保留，提示温和不算故障）。
 *
 * 支持性约束（UI 层据此决定是否显示 🎤 按钮）：
 * - 需要 Chrome / Edge 等基于 Chromium 的浏览器（window.SpeechRecognition）
 * - 需要安全上下文（localhost 或 HTTPS）；局域网 HTTP 访问时浏览器会禁用麦克风 API
 * - Chrome 的识别引擎依赖谷歌服务，国内网络不可用时 onerror(network) → 回退键盘输入
 */

/** 单次听写会话时长上限（ms）：到期自动停止，草稿保留 */
const SESSION_MAX_MS = 90_000;
/** 连续错误上限：达到即自动停止（防 onend 无限续起循环） */
const MAX_CONSECUTIVE_ERRORS = 5;

/** 一次听写会话的句柄：stop 停止识别（调用方负责把草稿提交进输入框） */
export interface DictationHandle {
  stop: () => void;
}

export interface DictationHandlers {
  /** 识别草稿更新（会话累计终稿 + 当前中间结果，全量回调） */
  onDraft: (fullDraft: string) => void;
  /** 识别出错（致命，message 已是可展示的中文提示；调用方应停止识别并清草稿） */
  onError: (message: string) => void;
  /** 非致命通知（如 90s 单次上限到期）：草稿保留、识别自然停止，只提示不清理 */
  onNotice?: (message: string) => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  /** 本事件中结果的起始索引（其之前的结果已确认，不再重复出现在 results 里） */
  resultIndex: number;
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
      // Chrome 的识别引擎依赖谷歌服务器（国内直连不通）；Edge 走微软引擎国内可用
      return '语音识别服务不可用（Chrome 识别引擎需连谷歌服务，国内网络无法直连）——请改用 Edge 浏览器打开本页再开麦，或直接键盘输入';
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
 * 启动一次听写会话（连续识别，静默超时自动续起直到调用 stop 或达时长/错误上限）。
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

  let sessionFinal = ''; // 本会话已确认的累计文本（只增不减）
  let active = true;
  let consecutiveErrors = 0;

  const emit = (interim: string): void => {
    handlers.onDraft(sessionFinal + interim);
  };

  const stopForError = (message: string): void => {
    active = false;
    try {
      recognition.stop();
    } catch {
      // 忽略
    }
    handlers.onError(message);
  };

  recognition.onresult = (e) => {
    // 收到任何结果：连续错误清零（识别恢复正常）
    consecutiveErrors = 0;
    // 增量追加：resultIndex 之前的结果是历史终稿（可能已被引擎裁掉），
    // 只处理 resultIndex 起的新内容，isFinal 段永久追加进 sessionFinal
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0]?.transcript ?? '';
      if (!text) continue;
      if (r.isFinal) {
        sessionFinal += text;
      } else {
        // 非 final 中间结果不落账，仅拼进本次 interim 展示
      }
    }
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r.isFinal) interim += r[0]?.transcript ?? '';
    }
    emit(interim);
  };

  recognition.onerror = (e) => {
    const msg = errorText(e.error ?? '');
    if (msg) consecutiveErrors += 1;
    if (active && consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      stopForError('语音识别多次中断，已自动停止，请改用键盘输入');
      return;
    }
    if (msg) handlers.onError(msg);
  };

  recognition.onend = () => {
    // 连续模式：浏览器静默超时可能自动断开，会话仍激活且未达错误上限时续起
    if (active && consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
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

  // 会话时长上限：到期自动停止（草稿保留在调用方，走非致命通知不算故障）
  const sessionTimer = setTimeout(() => {
    if (!active) return;
    active = false;
    try {
      recognition.stop();
    } catch {
      // 忽略
    }
    const notify = handlers.onNotice ?? handlers.onError;
    notify('识别已达单次上限（90秒），草稿已保留');
  }, SESSION_MAX_MS);

  return {
    stop: () => {
      active = false;
      clearTimeout(sessionTimer);
      try {
        recognition.stop();
      } catch {
        // 忽略
      }
    },
  };
}

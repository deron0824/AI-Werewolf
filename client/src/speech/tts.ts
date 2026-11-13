/**
 * TTS 引擎抽象 + WebSpeech 实现 + 播放仲裁队列（迭代2 F5，ARCHITECTURE-iter2 A6）
 *
 * 共享约定（Part E 约定 3）：全站一切语音（AI 发言 + 法官播报 + 重播）必须经
 * SpeechQueue 入队串行播放，禁止任何调用点直接调用 speechSynthesis.speak。
 * 云端 TTS（I-P2-1）未来只需新增 TTSEngine 实现类替换，接口已预留。
 */

import { voiceProfileOf, JUDGE_VOICE_PROFILE, type VoiceProfile } from './voiceMap';

/** 单条待播任务 */
export interface SpeechTask {
  /** 播报文本（整句播报，不做流式） */
  text: string;
  /** 音色参数（AI 用 avatarId 推导；法官用专用 profile） */
  profile: VoiceProfile;
  /** 来源标记（AI=ai / 法官=judge），用于重播按钮与去重 */
  source: 'ai' | 'judge';
}

/** TTS 引擎接口（云端 TTS 扩展点：实现本接口并在 SpeechQueue 替换 engine 即可） */
export interface TTSEngine {
  /** 是否支持（不支持时调用方静默降级为纯文字） */
  readonly supported: boolean;
  /** 播报一句（resolve 即播完或失败）；内部需吞掉一切异常 */
  speak(text: string, profile: VoiceProfile): Promise<void>;
  /** 立即停止当前播报并清空 */
  cancel(): void;
}

/** Web Speech API 实现（Edge/Chrome 兼容；不支持的环境 supported=false） */
export class WebSpeechTTSEngine implements TTSEngine {
  readonly supported: boolean =
    typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';

  speak(text: string, profile: VoiceProfile): Promise<void> {
    return new Promise((resolve) => {
      if (!this.supported) {
        resolve();
        return;
      }
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.pitch = profile.pitch;
        utterance.rate = profile.rate;
        if (profile.voiceURI) {
          // zh-CN voice 优先选择；找不到指定音色时由浏览器自选（pitch/rate 仍是主要区分手段）
          const voice = window.speechSynthesis
            .getVoices()
            .find((v) => v.voiceURI === profile.voiceURI && v.lang.startsWith('zh'));
          if (voice) utterance.voice = voice;
        }
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      } catch {
        resolve();
      }
    });
  }

  cancel(): void {
    if (!this.supported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // 忽略
    }
  }
}

// ===== 开关持久化（key 固定，Part E 约定 2） =====

const TTS_ENABLED_KEY = 'werewolf-tts-enabled';
const JUDGE_TTS_ENABLED_KEY = 'werewolf-judge-tts-enabled';

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // 忽略
  }
}

/** AI 自动播报开关（迭代3 F2：默认关——内置音色质量一般，待接入更优 TTS；localStorage 持久化） */
export function getTtsEnabled(): boolean {
  return readBool(TTS_ENABLED_KEY, false);
}

export function setTtsEnabled(value: boolean): void {
  writeBool(TTS_ENABLED_KEY, value);
  if (!value) getSpeechQueue().cancel();
}

/** 法官播报配音开关（默认关） */
export function getJudgeTtsEnabled(): boolean {
  return readBool(JUDGE_TTS_ENABLED_KEY, false);
}

export function setJudgeTtsEnabled(value: boolean): void {
  writeBool(JUDGE_TTS_ENABLED_KEY, value);
}

// ===== 播放仲裁队列（同一时刻只播一条，串行排队不重叠） =====

class SpeechQueue {
  private queue: SpeechTask[] = [];
  private playing = false;
  private engine: TTSEngine = new WebSpeechTTSEngine();
  /** 自动播放策略：首次用户手势后才真正出队播放；解锁前的任务仍会入队 */
  private unlocked = false;
  private unlockInstalled = false;

  /** 替换底层引擎（云端 TTS 扩展点） */
  setEngine(engine: TTSEngine): void {
    this.engine.cancel();
    this.engine = engine;
  }

  /**
   * 入队（AI 发言 / 法官播报统一入口）。
   * 开关关闭或环境不支持时静默跳过（纯文字照常，游戏流程不受影响）。
   */
  enqueue(task: SpeechTask): void {
    if (!this.engine.supported) return;
    if (task.source === 'ai' && !getTtsEnabled()) return;
    if (task.source === 'judge' && !getJudgeTtsEnabled()) return;
    this.queue.push(task);
    this.installUnlock();
    if (this.unlocked) void this.drain();
  }

  /** 手动重播：跳过开关直接播（用户显式点击即意图明确） */
  replay(text: string, profile: VoiceProfile, source: 'ai' | 'judge'): void {
    if (!this.engine.supported) return;
    this.queue.push({ text, profile, source });
    this.installUnlock();
    if (this.unlocked) void this.drain();
  }

  /** 立即清空队列并停止当前播报（开关关闭/重开新局时可调用） */
  cancel(): void {
    this.queue = [];
    this.engine.cancel();
  }

  /** 首次任意 click 解锁（浏览器自动播放策略）；由 installUnlock 惰性安装 */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    void this.drain();
  }

  /** 安装一次性解锁监听（幂等，可安全重复调用） */
  installUnlock(): void {
    if (this.unlockInstalled || typeof document === 'undefined') return;
    this.unlockInstalled = true;
    document.addEventListener(
      'click',
      () => this.unlock(),
      { once: true, passive: true },
    );
  }

  private async drain(): Promise<void> {
    if (this.playing) return;
    this.playing = true;
    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift()!;
        await this.engine.speak(task.text, task.profile);
      }
    } finally {
      this.playing = false;
    }
  }
}

let queueSingleton: SpeechQueue | null = null;

/** 播放仲裁队列单例（全站唯一入口） */
export function getSpeechQueue(): SpeechQueue {
  if (!queueSingleton) queueSingleton = new SpeechQueue();
  return queueSingleton;
}

/** 便捷入队：AI 发言（avatarId → 音色） */
export function speakAI(avatarId: string, text: string): void {
  getSpeechQueue().enqueue({ text, profile: voiceProfileOf(avatarId), source: 'ai' });
}

/** 便捷入队：法官播报 */
export function speakJudge(text: string): void {
  getSpeechQueue().enqueue({ text, profile: JUDGE_VOICE_PROFILE, source: 'judge' });
}

/** 便捷重播（点击 🔊） */
export function replaySpeech(avatarId: string | null, text: string, source: 'ai' | 'judge'): void {
  const profile = avatarId ? voiceProfileOf(avatarId) : JUDGE_VOICE_PROFILE;
  getSpeechQueue().replay(text, profile, source);
}

/** 首次用户手势解锁（应用挂载后调用一次即可） */
export function initSpeechUnlock(): void {
  getSpeechQueue().installUnlock();
}

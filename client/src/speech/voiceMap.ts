/**
 * 音色映射表 —— 唯一真相源（迭代2 F5，ARCHITECTURE-iter2 Part E 约定 2）
 *
 * avatarId → { voiceURI?, pitch, rate }；6 个 AI 组合互相可明显区分。
 * voiceURI 留空时由浏览器自选 zh-CN 音色（跨浏览器最稳），pitch/rate 为主要区分手段。
 * 音色调整只改本文件。
 */

export interface VoiceProfile {
  /** 指定语音 URI（zh-CN voice 优先匹配；缺省 = 浏览器自选） */
  voiceURI?: string;
  /** 音高 0~2（1 为默认） */
  pitch: number;
  /** 语速 0.1~10（1 为默认） */
  rate: number;
}

/** 法官播报专用音色（低沉平稳） */
export const JUDGE_VOICE_PROFILE: VoiceProfile = {
  pitch: 0.7,
  rate: 0.95,
};

/**
 * AI 音色表：与 client avatars.ts 的 ai-1~ai-6 对应。
 * 组合设计（zh-CN 音色下听感差异明显）：
 * - ai-1 锋哥  激进：略高音 + 偏快
 * - ai-2 老稳  稳健：标准音 + 偏慢
 * - ai-3 戏精  演技派：高音 + 起伏（rate 略快）
 * - ai-4 随风  跟风：偏低音 + 偏慢
 * - ai-5 快嘴  速攻：标准音 + 明显快
 * - ai-6 老学究 逻辑流：低音 + 慢而清晰
 */
export const VOICE_MAP: Record<string, VoiceProfile> = {
  'ai-1': { pitch: 1.25, rate: 1.15 },
  'ai-2': { pitch: 1.0, rate: 0.9 },
  'ai-3': { pitch: 1.45, rate: 1.05 },
  'ai-4': { pitch: 0.85, rate: 0.9 },
  'ai-5': { pitch: 1.05, rate: 1.35 },
  'ai-6': { pitch: 0.75, rate: 0.85 },
};

/** 取音色参数（未知 avatarId 回退到中性音色） */
export function voiceProfileOf(avatarId: string): VoiceProfile {
  return VOICE_MAP[avatarId] ?? { pitch: 1.0, rate: 1.0 };
}

/**
 * AIEngine —— AI 玩家统一入口：夜间决策 / 投票 / 发言 / 遗言。
 * 只依赖 LLMProvider 接口（经 LLMPipeline）与 PromptBuilder/DecisionParser；
 * 解析失败或 LLM 超时 → 模板句库/规则化决策兜底，绝不阻塞流程。
 */

import { Role, type Action, type GameStateView, type Player } from '@werewolf/shared';

import { config } from '../config';
import type { LLMPipeline } from '../llm/LLMPipeline';
import { decideNightByRules, decideVoteByRules, pickLastWords, pickSpeech } from '../llm/templates';
import { parseAction, parseVote, sanitizeSpeech } from './decisionParser';
import {
  buildDecisionPrompt,
  buildLastWordsPrompt,
  buildSpeechPrompt,
  buildVotePrompt,
} from './promptBuilder';

/** 低难度决策噪声概率（迭代4 F3）：25% 概率不采纳推理结果，改随机选目标 */
const LOW_DIFFICULTY_NOISE_RATE = 0.25;

export class AIEngine {
  private pipeline: LLMPipeline;

  constructor(pipeline: LLMPipeline) {
    this.pipeline = pipeline;
  }

  /** 低难度噪声判定：难度为 low 时按概率引入随机失误 */
  private isNoisy(view: GameStateView): boolean {
    return (view.difficulty ?? 'medium') === 'low' && Math.random() < LOW_DIFFICULTY_NOISE_RATE;
  }

  /** 夜间行动决策（狼刀/验人/用药） */
  async decideNight(player: Player, view: GameStateView): Promise<Action> {
    try {
      const aliveSeats = view.players.filter((p) => p.alive).map((p) => p.seat);
      const candidates = aliveSeats.filter((s) => s !== player.seat);
      const prompt = buildDecisionPrompt(player, view, candidates);
      const result = await this.pipeline.chat(prompt);
      const parsed = parseAction(result.text, candidates, player.seat);
      if (parsed) {
        // 低难度噪声：狼刀/验人以一定概率随机选目标（排除自己与狼队友）
        if ((parsed.type === 'wolf_kill' || parsed.type === 'seer_check') && this.isNoisy(view) && candidates.length > 0) {
          const teammates = new Set(view.wolfTeammates ?? []);
          const pool = candidates.filter((s) => parsed.type === 'seer_check' || !teammates.has(s));
          if (pool.length > 0) {
            return { type: parsed.type, targetSeat: pool[Math.floor(Math.random() * pool.length)] };
          }
        }
        return parsed;
      }
      // 解析失败（含路线 C 哨兵）→ 规则化决策
      return decideNightByRules(view);
    } catch {
      return decideNightByRules(view);
    }
  }

  /** 投票决策（返回目标座位） */
  async decideVote(player: Player, view: GameStateView): Promise<{ targetSeat: number }> {
    try {
      const candidates = (view.voteCandidates ?? view.players.filter((p) => p.alive).map((p) => p.seat))
        .filter((s) => s !== player.seat);
      const prompt = buildVotePrompt(player, view, candidates);
      const result = await this.pipeline.chat(prompt);
      const parsed = parseVote(result.text, candidates, player.seat);
      if (parsed !== null) {
        // 低难度噪声：一定概率跟风乱票（随机选候选）
        if (this.isNoisy(view) && candidates.length > 0) {
          return { targetSeat: candidates[Math.floor(Math.random() * candidates.length)] };
        }
        return { targetSeat: parsed };
      }
      return { targetSeat: decideVoteByRules(view) };
    } catch {
      return { targetSeat: decideVoteByRules(view) };
    }
  }

  /** 白天发言生成（120-260 字口语化，≤300 字限长） */
  async generateSpeech(player: Player, view: GameStateView): Promise<string> {
    try {
      const prompt = buildSpeechPrompt(player, view, '请针对当前局势发表你的看法。');
      const result = await this.pipeline.chat(prompt);
      const cleaned = sanitizeSpeech(result.text, config.speech.maxLength);
      if (cleaned.length >= 4) return cleaned;
      return pickSpeech(player.role ?? Role.VILLAGER, player.seat);
    } catch {
      return pickSpeech(player.role ?? Role.VILLAGER, player.seat);
    }
  }

  /** 遗言生成 */
  async generateLastWords(player: Player, view: GameStateView): Promise<string> {
    try {
      const prompt = buildLastWordsPrompt(player, view);
      const result = await this.pipeline.chat(prompt);
      const cleaned = sanitizeSpeech(result.text, config.speech.lastWordsMaxLength);
      if (cleaned.length >= 4) return cleaned;
      return pickLastWords();
    } catch {
      return pickLastWords();
    }
  }
}

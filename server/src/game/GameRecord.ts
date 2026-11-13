/**
 * 复盘记录器（P1-2）：全程记录刀口/查验/用药/发言全文/投票明细/胜负，
 * 结束后通过 GET /api/rooms/:id/record 下载 JSON。
 */

import type { GameState, GameRecordJSON, NightRecord, SpeechEntry, VoteRecord, Winner } from '@werewolf/shared';
import type { GameConfig } from '@werewolf/shared';

export class GameRecord {
  private startedAt: Date | null = null;
  private finishedAt: Date | null = null;
  private nights: NightRecord[] = [];
  private speeches: SpeechEntry[] = [];
  private votes: VoteRecord[] = [];
  private timeline: { at: string; text: string }[] = [];

  /** 开局（发牌完成）时调用 */
  start(): void {
    this.startedAt = new Date();
  }

  /** 记录一晚 */
  logNight(night: NightRecord): void {
    this.nights.push(night);
  }

  /** 记录发言 */
  logSpeech(entry: SpeechEntry): void {
    this.speeches.push(entry);
  }

  /** 记录投票明细 */
  logVote(vote: VoteRecord): void {
    this.votes.push(vote);
  }

  /** 记录过程播报（法官关键节点） */
  logTimeline(text: string): void {
    this.timeline.push({ at: new Date().toISOString(), text });
  }

  /** 终局：固定胜负结果 */
  finish(_winner: Winner, reason: string): void {
    this.finishedAt = new Date();
    if (reason) this.logTimeline(reason);
  }

  /** 导出复盘 JSON（未开局返回 null） */
  export(state: GameState, config: GameConfig): GameRecordJSON | null {
    if (!this.startedAt) return null;
    return {
      roomId: state.roomId,
      roomCode: state.roomCode,
      configName: config.name,
      seatCount: config.seatCount,
      startedAt: this.startedAt.toISOString(),
      finishedAt: (this.finishedAt ?? new Date()).toISOString(),
      winner: state.winner,
      winnerReason: this.timeline.length > 0 ? this.timeline[this.timeline.length - 1].text : '',
      seats: state.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        avatarId: p.avatarId,
        isHuman: p.isHuman,
        persona: p.persona.label,
        role: p.role,
      })),
      nights: this.nights,
      speeches: this.speeches,
      votes: this.votes,
      timeline: this.timeline,
    };
  }

  /** 重置（重开一局用） */
  reset(): void {
    this.startedAt = null;
    this.finishedAt = null;
    this.nights = [];
    this.speeches = [];
    this.votes = [];
    this.timeline = [];
  }
}

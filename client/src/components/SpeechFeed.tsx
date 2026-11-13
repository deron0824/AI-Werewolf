/**
 * SpeechFeed —— 发言/事件流水区（滚动），含法官播报、发言、死讯、投票结果。
 * 迭代2 F5：每条 AI/真人发言带 🔊 重播按钮（点击经 SpeechQueue 入队播放该条）。
 * 迭代3 F1：AI 发言以 5 字/秒打字机流式展示字幕（模拟真人说话节奏），真人发言即时全量显示。
 * 迭代5 F-顺序修复：客户端确定性发言队列——同一时刻只允许一条 AI 发言在打字，
 *   上一条打完才揭示下一条（即使服务端节奏抖动/重进房间/重渲染也不会出现多条并行打字）。
 *   挂载时已存在的历史发言视为"已讲完"，直接全量显示，只有新到发言进入队列动画。
 */

import { useEffect, useRef, useState } from 'react';

import { type SpeechEntry } from '@werewolf/shared';

import { useGameContext } from '../state/GameContext';
import { replaySpeech } from '../speech/tts';
import { AvatarBadge } from './avatars';

/** 字幕流式速度（字/秒），与服务端展示节奏 config.speech.displayCps 对齐（迭代5：提速为 8） */
const SUBTITLE_CPS = 8;
const CHAR_INTERVAL_MS = 1000 / SUBTITLE_CPS;

/** 打字机字幕：stream=true 时按 SUBTITLE_CPS 逐字显现，完成后回调 onDone；text/stream 变化时重放 */
function TypewriterText({
  text,
  stream,
  onDone,
}: {
  text: string;
  stream: boolean;
  onDone?: () => void;
}): JSX.Element {
  const [shown, setShown] = useState(stream ? '' : text);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    if (!stream) {
      setShown(text);
      return;
    }
    setShown('');
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(timer);
        // 空文本直接完成；有内容时在最后一个字显示后回调
        if (!doneRef.current) {
          doneRef.current = true;
          onDone?.();
        }
      }
    }, CHAR_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, stream]);

  return <span className="text-white/85">{shown}</span>;
}

export default function SpeechFeed(): JSX.Element {
  const { view, deaths, voteResult, gameOver } = useGameContext();
  const bottomRef = useRef<HTMLDivElement>(null);
  const speeches: SpeechEntry[] = view?.speeches ?? [];
  /** 已完整揭示（含打完动画）的发言条数；其余条目排队等待 */
  const [revealCount, setRevealCount] = useState(speeches.length);
  /** 上一次见到的发言总数：用于识别"重开一局清空"（长度回退 → 重置队列） */
  const seenLenRef = useRef(speeches.length);

  useEffect(() => {
    if (speeches.length < seenLenRef.current) {
      // 重开一局：发言被清空，重置队列到当前长度（历史不存在，无需动画）
      seenLenRef.current = speeches.length;
      setRevealCount(speeches.length);
      return;
    }
    if (speeches.length > seenLenRef.current) {
      // 新发言到达：只推进 seenLen，让队列从 revealCount 起逐条动画
      seenLenRef.current = speeches.length;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speeches.length]);

  // 队列推进：当前待揭示条目若是真人发言/法官类（非 AI），无需打字动画，立即揭示
  useEffect(() => {
    const current = speeches[revealCount];
    if (current && current.isAI !== true) {
      setRevealCount((c) => c + 1);
    }
  }, [revealCount, speeches]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [view?.speeches.length, deaths.length, voteResult, gameOver, revealCount]);

  return (
    <div className="mx-2 mb-2 flex-1 min-h-40 overflow-y-auto rounded-lg border border-white/10 bg-night-900/60 p-2 speech-scroll text-sm">
      {speeches.length === 0 && deaths.length === 0 && (
        <div className="text-white/50">发言与事件将在这里滚动显示……</div>
      )}
      {speeches.map((s, i) => {
        // 队列纪律：index < revealCount 已讲完（全量显示）；index === revealCount 正在讲（打字/即将打）；
        // index > revealCount 排队中（暂时不渲染，保证"一次只有一位玩家发言"）
        if (i > revealCount) return null;
        const isTypingNow = i === revealCount && s.isAI === true;
        return (
          <div key={i} className="mb-1.5 flex gap-2">
            <AvatarBadge avatarId={s.avatarId} size={28} />
            <div>
              <span className="font-bold text-amber-300">
                {s.seat}号·{s.name}
                {s.isAI ? '🤖' : ''}
                {s.isLastWords ? '（遗言）' : ''}：
              </span>
              {isTypingNow ? (
                <TypewriterText
                  text={s.content}
                  stream
                  onDone={() => setRevealCount((c) => (c === i ? c + 1 : c))}
                />
              ) : (
                <span className="text-white/85">{s.content}</span>
              )}
              <button
                type="button"
                title="点击重播这条发言"
                className="ml-1 text-xs text-emerald-300/70 hover:text-emerald-300"
                onClick={() => replaySpeech(s.avatarId, `${s.name}说：${s.content}`, s.isAI ? 'ai' : 'judge')}
              >
                🔊
              </button>
            </div>
          </div>
        );
      })}
      {deaths.map((d, i) => (
        <div key={`d-${i}`} className="mb-1.5 text-red-400">
          ⚰️ {d.cause === 'exile' ? `${d.seats.map((s) => `${s}号`).join('、')} 被放逐出局` : `昨夜 ${d.seats.map((s) => `${s}号`).join('、')} 死亡`}
        </div>
      ))}
      {voteResult && (
        <div className="mb-1.5 text-sky-300">
          🗳️ 票数：{voteResult.tally.map((t) => `${t.seat}号${t.count}票`).join('、') || '无有效票'}
          {voteResult.exiledSeat !== null && ` → ${voteResult.exiledSeat}号 出局`}
          {voteResult.isPK && '（PK 投票）'}
        </div>
      )}
      {gameOver && (
        <div className={`mb-1.5 font-bold ${gameOver.winner === 'WEREWOLF' ? 'text-red-400' : 'text-emerald-400'}`}>
          🏁 游戏结束：{gameOver.winner === 'WEREWOLF' ? '狼人阵营胜利！' : '好人阵营胜利！'} {gameOver.reason}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

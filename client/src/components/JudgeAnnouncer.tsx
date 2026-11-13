/**
 * JudgeAnnouncer —— 法官播报区（🎩 样式，公开信息输出：死讯/票数/胜负）。
 */

import { useEffect, useRef } from 'react';

import { useGameContext } from '../state/GameContext';

export default function JudgeAnnouncer(): JSX.Element {
  const { judgeMessages } = useGameContext();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [judgeMessages.length]);

  const latest = judgeMessages.slice(-4);

  return (
    <div className="mx-2 my-2 rounded-lg bg-gradient-to-r from-indigo-900/70 to-purple-900/70 border border-white/10 p-3">
      <div className="flex items-center gap-2 text-amber-300 text-xs mb-1">
        <span className="text-lg">🎩</span>
        <span className="font-bold">法官</span>
      </div>
      <div className="space-y-1 max-h-28 overflow-y-auto speech-scroll text-sm text-white/90">
        {latest.length === 0 ? (
          <div className="text-white/50">等待法官开场……</div>
        ) : (
          latest.map((text, i) => <div key={`${i}-${text.slice(0, 8)}`}>「{text}」</div>)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

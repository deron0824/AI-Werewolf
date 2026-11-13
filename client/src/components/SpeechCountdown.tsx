/**
 * SpeechCountdown —— 真人发言倒计时条（迭代2 F4 前端）。
 *
 * 共享约定（Part E 约定 4）：speechDeadlineMs 是服务端权威时间戳，本组件只做展示；
 * 前端倒计时归零【不得】自动提交发言（服务端超时判定自动“过”）；
 * 本地时钟偏差不参与任何逻辑判定。
 */

import { useEffect, useRef, useState } from 'react';

import { useGameContext } from '../state/GameContext';

export default function SpeechCountdown(): JSX.Element | null {
  const { view } = useGameContext();
  const deadlineMs = view?.speechDeadlineMs ?? null;
  const isMyTurn = view?.isMySpeechTurn ?? false;
  const [remainingSec, setRemainingSec] = useState(0);
  // 本轮发言的总时长基准（deadline 首次出现时记录，进度条按比例显示）
  const totalSecRef = useRef(0);
  const deadlineRef = useRef<number | null>(null);

  useEffect(() => {
    if (deadlineMs === null || deadlineMs === undefined) {
      setRemainingSec(0);
      deadlineRef.current = null;
      return;
    }
    if (deadlineRef.current !== deadlineMs) {
      deadlineRef.current = deadlineMs;
      totalSecRef.current = Math.max(1, Math.ceil((deadlineMs - Date.now()) / 1000));
    }
    const tick = (): void => {
      // 仅展示：本地时钟与服务器可能有偏差，归零判定以服务端为准
      const remaining = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
      setRemainingSec(remaining);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadlineMs]);

  // 仅当轮到本人发言且有服务端截止时间时展示（发言输入框上方）
  if (deadlineMs === null || deadlineMs === undefined || !isMyTurn) return null;

  const ratio = Math.min(1, Math.max(0, remainingSec / totalSecRef.current));
  const urgent = remainingSec <= 10;

  return (
    <div className="mx-2 mb-1 rounded-lg border border-amber-400/30 bg-night-800/40 px-2 py-1">
      <div className="flex items-center justify-between text-xs">
        <span className={urgent ? 'font-bold text-red-400' : 'text-amber-300'}>
          ⏱ 发言倒计时 {remainingSec}s{urgent ? '（即将超时，超时视为“过”）' : ''}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded bg-white/10">
        <div
          className={`h-full transition-all duration-1000 ${urgent ? 'bg-red-500' : 'bg-amber-400'}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

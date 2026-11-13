/**
 * GamePage —— 对局主页面：状态栏 / 法官区 / 座位区 / 身份牌 / 夜间面板 / 流水 / 投票 / 操作区。
 * 迭代4 F6：昼夜背景图交叉淡入；F3：大厅难度选择（房主）。
 */

import { useState } from 'react';

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Snackbar } from '@mui/material';
import { Phase } from '@werewolf/shared';

import { useGameContext } from '../state/GameContext';
import StatusBar from '../components/StatusBar';
import JudgeAnnouncer from '../components/JudgeAnnouncer';
import SeatGrid from '../components/SeatGrid';
import RoleCard from '../components/RoleCard';
import NightPanel from '../components/NightPanel';
import SpeechFeed from '../components/SpeechFeed';
import VotePanel from '../components/VotePanel';
import ActionArea from '../components/ActionArea';
import SpeechCountdown from '../components/SpeechCountdown';
import SettingsDialog from '../components/SettingsDialog';
import GameRecordDialog from '../components/GameRecordDialog';
import RuleDialog from '../components/RuleDialog';

const DIFFICULTY_LABEL: Record<string, string> = { low: '低 80%', medium: '中 100%', high: '高 120%' };

/** 昼夜背景层：两张背景图按 isNight 交叉淡入淡出（1s 过渡） */
function DayNightBackdrop({ isNight, dayNumber }: { isNight: boolean; dayNumber: number }): JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <img
        src="/assets/img/bg-day.png"
        alt=""
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
          isNight ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ backgroundColor: '#2a3b52' }}
      />
      <img
        src="/assets/img/bg-night.png"
        alt=""
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
          isNight ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ backgroundColor: '#101728' }}
      />
      {/* 压暗遮罩：保证前景文字可读 */}
      <div className="absolute inset-0 bg-black/45" />
      {/* 天数水印 */}
      {dayNumber > 0 && (
        <div className="absolute right-3 top-2 text-4xl font-black text-white/10">
          {isNight ? '🌙' : '☀️'} D{dayNumber}
        </div>
      )}
    </div>
  );
}

export default function GamePage(): JSX.Element {
  const { view, identity, toast, showToast, gameOver, startGame, restartGame, setDifficulty, leaveRoom } =
    useGameContext();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  if (!view || !identity) {
    return <div className="p-6 text-white/60">正在恢复对局……（若长时间无响应请回大厅重新加入）</div>;
  }

  const isHost = identity.isHost;
  const showStart = view.phase === Phase.LOBBY && isHost && !gameOver;
  const difficulty = view.difficulty ?? 'medium';

  return (
    <div className="relative flex min-h-full flex-col">
      <DayNightBackdrop isNight={view.isNight} dayNumber={view.dayNumber} />

      <div className="relative z-10">
      <div className="flex items-center justify-between border-b border-white/10 bg-night-900/60 px-3 py-1 text-xs">
        <span>
          房间码：<span className="font-bold text-amber-300 tracking-widest">{identity.roomCode}</span>
          <span className="ml-3 text-white/50">
            AI 难度：<span className="text-white/80">{DIFFICULTY_LABEL[difficulty] ?? '中'}</span>
          </span>
        </span>
        <div className="flex gap-2">
          <button type="button" className="underline" onClick={() => setRulesOpen(true)}>
            ⓘ 规则
          </button>
          <button type="button" className="underline" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
          <button type="button" className="underline" onClick={() => setRecordOpen(true)}>
            复盘
          </button>
          <button type="button" className="underline" onClick={leaveRoom}>
            退出房间
          </button>
        </div>
      </div>

      <StatusBar />
      <JudgeAnnouncer />

      {showStart && (
        <div className="mx-2 mb-2 rounded-lg border border-emerald-400/40 bg-night-800/60 p-3 text-center">
          <div className="mb-2 text-sm text-white/70">
            房间就绪。开局将自动补满 AI 席位（空座由 AI 顶上），法官主持全程。
          </div>
          {/* 迭代4 F3：房主开局前选择 AI 难度（默认中） */}
          <div className="mb-2 flex items-center justify-center gap-2 text-sm">
            <span className="text-white/60">AI 游戏智商：</span>
            {(['low', 'medium', 'high'] as const).map((d) => (
              <button
                key={d}
                type="button"
                disabled={d === difficulty}
                onClick={() => void setDifficulty(d).catch((e) => showToast(String(e.message)))}
                className={`rounded-md px-3 py-1 text-xs transition ${
                  d === difficulty
                    ? 'bg-emerald-500/80 text-white'
                    : 'border border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                }`}
              >
                {DIFFICULTY_LABEL[d]}
                {d === 'medium' && '（默认）'}
              </button>
            ))}
          </div>
          <Button variant="contained" onClick={() => void startGame().catch((e) => showToast(String(e.message)))}>
            开始游戏
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 px-2 md:grid-cols-3">
        <div className="md:col-span-2">
          <SeatGrid highlightSeat={view.currentSpeakerSeat ?? null} />
        </div>
        <div className="space-y-2">
          <RoleCard />
          <NightPanel />
        </div>
      </div>

      <SpeechFeed />
      <VotePanel />
      <SpeechCountdown />
      <ActionArea />
      </div>

      {/* 胜负弹窗 */}
      <Dialog open={gameOver !== null} onClose={() => undefined}>
        <DialogTitle>{gameOver?.winner === 'WEREWOLF' ? '🐺 狼人阵营胜利！' : '🌱 好人阵营胜利！'}</DialogTitle>
        <DialogContent>
          <div className="text-sm text-white/80">{gameOver?.reason}</div>
        </DialogContent>
        <DialogActions>
          {isHost && (
            <Button
              variant="contained"
              onClick={() => void restartGame().catch((e) => showToast(String(e.message)))}
            >
              同房重开一局
            </Button>
          )}
          <Button onClick={leaveRoom}>回大厅</Button>
        </DialogActions>
      </Dialog>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <GameRecordDialog open={recordOpen} onClose={() => setRecordOpen(false)} />
      <RuleDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />

      <Snackbar
        open={toast !== null}
        autoHideDuration={3000}
        onClose={() => showToast('')}
        message={toast ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </div>
  );
}

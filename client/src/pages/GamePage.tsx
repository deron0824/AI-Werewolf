/**
 * GamePage —— 对局主页面：状态栏 / 法官区 / 座位区 / 身份牌 / 夜间面板 / 流水 / 投票 / 操作区。
 * 迭代4 F6：昼夜背景图交叉淡入；F3：大厅难度选择（房主）。
 */

import { useState } from 'react';

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Snackbar } from '@mui/material';
import { Phase, Role } from '@werewolf/shared';

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

const ROLE_LABEL: Record<string, string> = {
  [Role.WEREWOLF]: '🐺 狼人',
  [Role.SEER]: '🔮 预言家',
  [Role.WITCH]: '⚗️ 女巫',
  [Role.VILLAGER]: '🧑‍🌾 平民',
};

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
  const [continuing, setContinuing] = useState(false);

  if (!view || !identity) {
    return <div className="p-6 text-white/60">正在恢复对局……（若长时间无响应请回大厅重新加入）</div>;
  }

  const isHost = identity.isHost;
  const showStart = view.phase === Phase.LOBBY && isHost && !gameOver;
  const difficulty = view.difficulty ?? 'medium';
  // 迭代7 F2：结算画面 —— 双真人都点“继续游戏”才同房开新局
  const humanCount = view.players.filter((p) => p.isHuman).length;
  const confirmedSelf = (view.continueConfirmed ?? []).includes(view.self.seat);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <DayNightBackdrop isNight={view.isNight} dayNumber={view.dayNumber} />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-night-900/60 px-3 py-1 text-xs">
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

      {/* 迭代6 布局改版：主区（座位/身份/投票/操作） + 右侧发言聊天侧栏（约 1/4 列宽） */}
      <div className="flex min-h-0 flex-1">
        {/* 主区：可独立滚动 */}
        <div className="min-w-0 flex-1 overflow-y-auto speech-scroll">
          <JudgeAnnouncer />

          {showStart && (
            <div className="mx-2 mb-2 rounded-xl border border-emerald-400/40 bg-night-800/60 p-3 text-center">
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
                    className={`rounded-lg px-3 py-1 text-xs transition ${
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

          {/* 迭代7 布局：座位卡放大（3/5 宽），身份牌 + 夜间技能区（2/5 宽） */}
          <div className="grid grid-cols-1 gap-2 px-2 md:grid-cols-5">
            <div className="md:col-span-3">
              <SeatGrid highlightSeat={view.currentSpeakerSeat ?? null} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <RoleCard />
              <NightPanel />
            </div>
          </div>

          <VotePanel />
          <SpeechCountdown />
          <ActionArea />
        </div>

        {/* 右侧发言侧栏：聊天记录式滚动流 */}
        <aside className="hidden w-64 shrink-0 flex-col border-l border-white/10 bg-night-900/70 backdrop-blur-sm md:flex xl:w-80">
          <SpeechFeed />
        </aside>
      </div>
      </div>

      {/* 结算画面（迭代7 改版）：全员可见 —— 胜负 + 全员翻牌 + 全部票型明细 + 双人确认继续 */}
      <Dialog open={gameOver !== null} onClose={() => undefined} maxWidth="sm" fullWidth>
        <DialogTitle className="text-center text-xl">
          {gameOver?.winner === 'WEREWOLF' ? '🐺 狼人阵营胜利！' : '🌱 好人阵营胜利！'}
        </DialogTitle>
        <DialogContent>
          <div className="text-sm text-white/80">{gameOver?.reason}</div>

          {/* 全员翻牌 */}
          <div className="mt-3 rounded-xl border border-white/10 bg-night-900/60 p-3">
            <div className="mb-2 text-sm font-bold text-amber-300">全场身份翻牌</div>
            <div className="grid grid-cols-2 gap-1.5 text-sm">
              {view.players.map((p) => (
                <div key={p.seat} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 ${p.alive ? 'bg-white/5' : 'bg-white/5 opacity-60'}`}>
                  <span>
                    {p.seat}号 {p.name}
                    {p.seat === view.self.seat && <span className="ml-1 text-xs text-amber-300">(你)</span>}
                  </span>
                  <span className={p.role === Role.WEREWOLF ? 'font-bold text-red-400' : 'text-white/85'}>
                    {p.role ? ROLE_LABEL[p.role] : '未知'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 全部票型明细（迭代7 F3） */}
          {(view.voteHistory?.length ?? 0) > 0 && (
            <div className="mt-3 rounded-xl border border-white/10 bg-night-900/60 p-3">
              <div className="mb-2 text-sm font-bold text-sky-300">本局全部票型</div>
              <div className="space-y-1 text-xs leading-relaxed text-white/75">
                {(() => {
                  const votes = view.voteHistory ?? [];
                  const groups = new Map<string, string[]>();
                  for (const v of votes) {
                    const key = `第${v.dayNumber}天${v.isPK ? '·PK' : ''}`;
                    const arr = groups.get(key) ?? [];
                    arr.push(`${v.voterSeat}号 → ${v.targetSeat}号`);
                    groups.set(key, arr);
                  }
                  return [...groups.entries()].map(([key, items]) => (
                    <div key={key}>
                      <span className="font-bold text-white/85">{key}：</span>
                      {items.join('，')}
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}

          {/* 继续游戏（迭代7 F2）：双真人都确认后同房开新局，不带上局任何信息 */}
          <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-center text-sm">
            <div className="text-white/80">
              已确认继续：<span className="font-bold text-emerald-300">{view.continueConfirmed?.length ?? 0} / {humanCount}</span> 人
              {confirmedSelf && <span className="ml-2 text-emerald-300">（你已确认，等待对方…）</span>}
            </div>
          </div>
        </DialogContent>
        <DialogActions className="justify-center pb-4">
          <Button
            variant="contained"
            color="success"
            disabled={confirmedSelf || continuing}
            onClick={() => {
              setContinuing(true);
              void restartGame()
                .catch((e) => showToast(String(e.message)))
                .finally(() => setContinuing(false));
            }}
          >
            {confirmedSelf ? '已确认，等待对方…' : '✔ 继续游戏（同房开新局）'}
          </Button>
          <Button onClick={leaveRoom}>退出房间</Button>
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

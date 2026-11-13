/**
 * LobbyPage —— 昵称输入 / 建房 / 输房间码加入（P0-2）。
 */

import { useState } from 'react';

import { Button, TextField } from '@mui/material';

import { useGameContext } from '../state/GameContext';
import SettingsDialog from '../components/SettingsDialog';
import RuleDialog from '../components/RuleDialog';

export default function LobbyPage(): JSX.Element {
  const { createRoom, joinRoom, connected, showToast } = useGameContext();
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-night-800/80 p-6 shadow-card">
        <div className="mb-1 text-center text-3xl">🐺</div>
        <h1 className="mb-1 text-center text-xl font-bold">狼人杀 Demo</h1>
        <p className="mb-4 text-center text-xs text-white/50">
          6 人局：2 真人 + 4 AI · 2狼+预言家+女巫+2平民 · 屠城规则
        </p>

        <TextField
          label="你的昵称"
          size="small"
          fullWidth
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          inputProps={{ maxLength: 12 }}
          margin="dense"
        />

        <div className="mt-3 space-y-2">
          <Button
            variant="contained"
            fullWidth
            disabled={busy || !nickname.trim()}
            onClick={() => void run(async () => createRoom(nickname.trim()))}
          >
            创建房间（成为房主）
          </Button>
          <div className="flex items-center gap-2">
            <TextField
              label="房间码"
              size="small"
              fullWidth
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4 位数字"
            />
            <Button
              variant="outlined"
              disabled={busy || !nickname.trim() || roomCode.length !== 4}
              onClick={() => void run(async () => joinRoom(roomCode, nickname.trim()))}
            >
              加入
            </Button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-white/50">
          <span>
            连接状态：
            <span className={connected ? 'text-emerald-400' : 'text-amber-400'}>
              {connected ? '● 已连接' : '○ 未连接'}
            </span>
          </span>
          <div className="flex gap-2">
            <button type="button" className="underline hover:text-white/80" onClick={() => setRulesOpen(true)}>
              ⓘ 规则说明
            </button>
            <button type="button" className="underline hover:text-white/80" onClick={() => setSettingsOpen(true)}>
              LLM 设置
            </button>
          </div>
        </div>
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <RuleDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}

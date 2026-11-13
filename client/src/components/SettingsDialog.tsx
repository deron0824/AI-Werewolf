/**
 * SettingsDialog —— 路线 B 配置（baseURL/Key/模型）+ 路线 A 开关。
 * Key 不回显明文（GET 掩码回显 sk-****last4），永不上传任何远端（P0-8）。
 */

import { useEffect, useState } from 'react';

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Switch, TextField } from '@mui/material';

import { api } from '../api/socket';
import { useGameContext } from '../state/GameContext';
import {
  getTtsEnabled,
  setTtsEnabled,
  getJudgeTtsEnabled,
  setJudgeTtsEnabled,
} from '../speech/tts';
import { getSfxEnabled, setSfxEnabled } from '../speech/sfx';

export default function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const { showToast } = useGameContext();
  const [routeAEnabled, setRouteAEnabled] = useState(true);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // TTS 开关（localStorage 持久化，断线重连保留；AI 播报默认开 / 法官配音默认关）
  const [ttsEnabled, setTtsEnabledState] = useState(getTtsEnabled());
  const [judgeTtsEnabled, setJudgeTtsEnabledState] = useState(getJudgeTtsEnabled());
  // 游戏音效开关（迭代4 F6：昼夜/行动短特效，默认开）
  const [sfxEnabled, setSfxEnabledState] = useState(getSfxEnabled());

  useEffect(() => {
    if (!open) return;
    api
      .getSettings()
      .then((s) => {
        setRouteAEnabled(s.routeAEnabled);
        setBaseUrl(s.routeBBaseUrl);
        setModel(s.routeBModel);
        setApiKeyMasked(s.apiKeyMasked);
      })
      .catch((err) => showToast(err instanceof Error ? err.message : '读取设置失败'));
  }, [open, showToast]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const saved = await api.saveSettings({
        routeAEnabled,
        routeBBaseUrl: baseUrl,
        routeBModel: model,
        apiKey: apiKey.trim() ? apiKey.trim() : undefined,
      });
      setApiKeyMasked(saved.apiKeyMasked);
      setApiKey('');
      showToast('设置已保存（Key 仅存本地文件，永不上传）');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>设置</DialogTitle>
      <DialogContent dividers>
        {/* 语音播报（迭代2 F5）：纯前端 localStorage，不走服务端保存 */}
        <div className="mb-2 text-sm font-bold text-white/80">语音播报</div>
        <div className="mb-3 space-y-2 rounded border border-white/10 p-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">AI 语音播报</div>
              <div className="text-[11px] text-white/50">AI 玩家发言自动朗读（默认关：内置音色一般，待接入更优 TTS）</div>
            </div>
            <Switch
              checked={ttsEnabled}
              onChange={(e) => {
                setTtsEnabledState(e.target.checked);
                setTtsEnabled(e.target.checked);
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">游戏音效</div>
              <div className="text-[11px] text-white/50">昼夜转换、角色行动、死讯与胜负短特效（默认开）</div>
            </div>
            <Switch
              checked={sfxEnabled}
              onChange={(e) => {
                setSfxEnabledState(e.target.checked);
                setSfxEnabled(e.target.checked);
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">法官配音</div>
              <div className="text-[11px] text-white/50">法官关键播报朗读（默认关，避免与 AI 发言重叠）</div>
            </div>
            <Switch
              checked={judgeTtsEnabled}
              onChange={(e) => {
                setJudgeTtsEnabledState(e.target.checked);
                setJudgeTtsEnabled(e.target.checked);
              }}
            />
          </div>
        </div>
        <div className="mb-3 flex items-center justify-between rounded border border-white/10 p-2">
          <div>
            <div className="text-sm font-bold">路线 A：WorkBuddy 免密钥大模型</div>
            <div className="text-[11px] text-white/50">零配置优先使用；由 cloudConfig.json 激活产物驱动</div>
          </div>
          <Switch checked={routeAEnabled} onChange={(e) => setRouteAEnabled(e.target.checked)} />
        </div>
        <div className="mb-3 text-sm font-bold text-white/80">路线 B：OpenAI 兼容接口（兜底）</div>
        <TextField
          label="Base URL"
          size="small"
          fullWidth
          margin="dense"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
        />
        <TextField
          label="模型名"
          size="small"
          fullWidth
          margin="dense"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="gpt-4o-mini"
        />
        <TextField
          label={apiKeyMasked ? `API Key（已配置：${apiKeyMasked}）` : 'API Key（未配置）'}
          size="small"
          fullWidth
          margin="dense"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="输入新的 Key 覆盖旧值；留空表示不修改"
          helperText="Key 仅保存到服务端本地文件（0600 权限），界面掩码回显，不进入日志、不上传任何远端"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button variant="contained" disabled={saving} onClick={() => void save()}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}

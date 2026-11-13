/**
 * GameRecordDialog —— 复盘查看 + JSON 下载（P1-2）。
 */

import { useEffect, useState } from 'react';

import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';

import { api } from '../api/socket';
import { useGameContext } from '../state/GameContext';

export default function GameRecordDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const { identity } = useGameContext();
  const [record, setRecord] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !identity) return;
    api
      .fetchRecord(identity.roomId)
      .then((r) => setRecord(JSON.stringify(r, null, 2)))
      .catch((err) => setError(err instanceof Error ? err.message : '复盘数据不可用'));
  }, [open, identity]);

  const download = (): void => {
    if (!record || !identity) return;
    const blob = new Blob([record], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `record-${identity.roomId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>对局复盘（JSON）</DialogTitle>
      <DialogContent dividers>
        {error && <div className="text-sm text-red-400">{error}</div>}
        {!error && !record && <div className="text-sm text-white/60">加载中……</div>}
        {record && (
          <pre className="max-h-96 overflow-auto rounded bg-night-900/80 p-2 text-[11px] leading-4 text-white/80 speech-scroll">
            {record}
          </pre>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={download} disabled={!record}>
          下载 JSON
        </Button>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

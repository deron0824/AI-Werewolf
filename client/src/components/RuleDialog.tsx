/**
 * RuleDialog —— 规则说明弹窗（迭代2 F3）。
 * 数据唯一来源 shared/src/rulesText.ts（ARCHITECTURE-iter2 Part E 约定 1）：
 * 本组件只渲染数据，禁止在此另写规则文案（防止文案与 PRD 漂移）。
 */

import { Dialog, DialogContent, DialogTitle } from '@mui/material';

import { RULES_TEXT } from '@werewolf/shared';

interface RuleDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function RuleDialog({ open, onClose }: RuleDialogProps): JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle className="text-amber-300">📘 {RULES_TEXT.title}</DialogTitle>
      <DialogContent dividers>
        <div className="mb-3 rounded border border-amber-400/30 bg-amber-400/10 p-2 text-sm text-amber-200">
          {RULES_TEXT.boardSummary}
        </div>
        <div className="space-y-3">
          {RULES_TEXT.sections.map((section) => (
            <div key={section.title}>
              <div className="mb-1 text-sm font-bold text-emerald-300">{section.title}</div>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-white/80">
                {section.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

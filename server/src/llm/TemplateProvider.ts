/**
 * 路线 C：模板句库包装为 Provider（永不失败，保底路线）。
 * 发言/遗言直接取模板；决策类请求返回哨兵 JSON（解析失败 → AIEngine 走规则化决策）。
 */

import type { LLMProvider, LLMRequest, LLMRoute } from './Provider';
import { pickLastWords, pickSpeech } from './templates';

export class TemplateProvider implements LLMProvider {
  readonly route: LLMRoute = 'C';
  readonly label = '模板句库（保底）';

  /** 永不失败 */
  async checkHealth(): Promise<boolean> {
    return true;
  }

  async chat(req: LLMRequest, _signal: AbortSignal): Promise<string> {
    if (req.jsonMode) {
      // 决策类：返回哨兵 JSON，DecisionParser 解析为“使用模板决策”
      return '{"fallback_template":true}';
    }
    const hint = req.template;
    if (hint?.kind === 'lastwords') {
      return pickLastWords();
    }
    if (hint?.kind === 'speech') {
      // 模板占位 {seat} 由 hint 无法携带，用通用句子（不含占位）即可
      return pickSpeech(hint.role, 0).replaceAll('0 号', '我');
    }
    // 无场景提示的普通对话：安全兜底句
    return '我暂时没有更多信息，请大家根据发言自行判断。';
  }
}

/**
 * 路线 B：OpenAI 兼容接口（原生 fetch，Node 20 自带 fetch，不引 openai SDK）
 * baseURL / apiKey / model 全部可配（settings.json）；Key 不进日志。
 */

import type { LLMProvider, LLMRequest, LLMRoute } from './Provider';

export class OpenAICompatProvider implements LLMProvider {
  readonly route: LLMRoute = 'B';
  readonly label = 'OpenAI 兼容接口';

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
  }

  /** 轻量健康检查：配置齐全即视为可用（真实可用性在首次 chat 时验证） */
  async checkHealth(): Promise<boolean> {
    return Boolean(this.baseUrl && this.apiKey && this.model);
  }

  /** 单次对话：POST /chat/completions，stream:true，SSE 逐行收集 delta */
  async chat(req: LLMRequest, signal: AbortSignal): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      stream: true,
    };
    if (req.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    if (req.temperature !== undefined) {
      body.temperature = req.temperature;
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || res.body === null) {
      throw new Error(`gateway_http_${res.status}: 路线 B HTTP ${res.status}`);
    }

    // SSE 解析：data: {...} 行 → delta.content 累加
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) text += delta;
        } catch {
          // 忽略无法解析的 SSE 行（心跳/注释）
        }
      }
    }
    if (!text.trim()) {
      throw new Error('internal_empty_response: 路线 B 返回空内容');
    }
    return text;
  }
}

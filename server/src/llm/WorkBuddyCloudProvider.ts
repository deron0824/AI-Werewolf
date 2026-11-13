/**
 * 路线 A：WorkBuddy 云服务免密钥大模型（@tencent-ai/workbuddy-cloud-sdk，Node 端）
 *
 * 硬性要求（主理人拍板 + 官方文档核实，逐条遵守）：
 * - 初始化 createWorkBuddyCloud({ endpoint, publishableKey })，两值必传；
 *   endpoint/publishableKey 只能来自 cloudConfig.json（激活产物），禁止硬编码/环境变量；
 * - 模型：cloud.llm.models.list()，取 disabled !== true 的第一个；
 *   空列表是合法结果 → 视为路线 A 不可用；
 * - 调用：cloud.llm.chat.completions.create({ model, messages, stream:true, ... })，
 *   仅支持流式（stream !== true 被 SDK 直接拒绝），结构化输出用
 *   response_format:{type:'json_object'} + 流式收集全部 delta 后自行 JSON.parse；
 * - messages[0] 必须是 system 消息（ModelHub 强制：首条须为应用拥有的 system prompt）；
 * - top_k 不可传；temperature/top_p/repetition_penalty 可传；
 * - 错误对象 CloudOpenAIError 按 error.code 前缀处理（auth_/quota_/gateway_/request_/internal_），
 *   任何错误 → 该次调用判定失败，由 Pipeline 降级。
 */

import {
  createWorkBuddyCloud,
  type WorkBuddyCloudClient,
  type ChatCompletionChunk,
  type ChatCompletionCreateParamsStreaming,
  type CloudOpenAIError,
} from '@tencent-ai/workbuddy-cloud-sdk';

import type { LLMProvider, LLMRequest, LLMRoute } from './Provider';
import { config } from '../config';

export class WorkBuddyCloudProvider implements LLMProvider {
  readonly route: LLMRoute = 'A';
  readonly label = 'WorkBuddy 云服务免密钥 LLM';

  private readonly endpoint: string;
  private readonly publishableKey: string;
  private client: WorkBuddyCloudClient | null = null;
  private modelId: string | null = null;

  constructor(endpoint: string, publishableKey: string) {
    this.endpoint = endpoint;
    this.publishableKey = publishableKey;
  }

  /** 懒初始化客户端（两值必传；任何缺失视为不可用） */
  private ensureClient(): WorkBuddyCloudClient | null {
    if (this.client) return this.client;
    if (!this.endpoint || !this.publishableKey) return null;
    try {
      // Node 端调用属正常用法（SDK 支持 ESM/CJS）
      this.client = createWorkBuddyCloud({
        endpoint: this.endpoint,
        publishableKey: this.publishableKey,
      });
      return this.client;
    } catch (err) {
      console.error('[llm:A] WorkBuddy 客户端初始化失败：', this.describeError(err));
      return null;
    }
  }

  /** 健康检查：models.list() 优先取 config.llm.preferredRouteAModel（未禁用），否则第一个 disabled !== true 的模型；空列表为合法结果 → 不可用 */
  async checkHealth(): Promise<boolean> {
    const client = this.ensureClient();
    if (!client) return false;
    try {
      const models = await client.llm.models.list();
      const preferred = config.llm.preferredRouteAModel;
      const hit = models.find((m) => m.id === preferred && m.disabled !== true);
      if (hit) {
        this.modelId = hit.id;
      } else {
        const first = models.find((m) => m.disabled !== true);
        this.modelId = first?.id ?? null;
        if (this.modelId && preferred) {
          console.warn(`[llm:A] 首选模型 ${preferred} 不在可用列表中，回退到 ${this.modelId}`);
        }
      }
      return this.modelId !== null;
    } catch (err) {
      this.modelId = null;
      console.warn('[llm:A] models.list() 失败：', this.describeError(err));
      return false;
    }
  }

  /** 单次对话：stream:true 流式收集全部 delta；messages[0] 为 system */
  async chat(req: LLMRequest, signal: AbortSignal): Promise<string> {
    const client = this.ensureClient();
    if (!client) throw new Error('internal_provider_not_initialized: SDK 客户端不可用');
    if (!this.modelId) {
      const healthy = await this.checkHealth();
      if (!healthy) throw new Error('internal_no_model: 无可用模型（空模型列表是合法结果，视为 A 不可用）');
    }
    const params: ChatCompletionCreateParamsStreaming = {
      model: this.modelId!,
      // SDK 强制：messages[0] 必须是 system 消息
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      stream: true,
      signal,
    };
    if (req.jsonMode) {
      params.response_format = { type: 'json_object' };
    }
    if (req.temperature !== undefined) {
      params.temperature = req.temperature;
    }
    // 注意：top_k 不可传；如需 top_p / repetition_penalty 在此追加

    // 仅支持流式：create 返回 AsyncIterable<ChatCompletionChunk>（SSE 由 SDK 解析）
    const stream: AsyncIterable<ChatCompletionChunk> = client.llm.chat.completions.create(params);
    let text = '';
    for await (const chunk of stream) {
      // 超时/取消：立刻中断收集
      if (signal.aborted) {
        throw new Error('request_timeout: 路线 A 流式收集被中止');
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) text += delta;
    }
    if (!text.trim()) {
      throw new Error('internal_empty_response: 路线 A 返回空内容');
    }
    return text;
  }

  /** CloudOpenAIError 错误描述（按 error.code 前缀归因；日志脱敏由 secrets.ts 出口负责） */
  describeError(err: unknown): string {
    const e = err as CloudOpenAIError & { code?: string; message?: string };
    const code = typeof e?.code === 'string' ? e.code : 'unknown';
    const prefix = code.split('_')[0];
    const meaning =
      prefix === 'auth'
        ? '鉴权失败'
        : prefix === 'quota'
          ? '配额不足'
          : prefix === 'gateway'
            ? '网关错误'
            : prefix === 'request'
              ? '请求非法（含 stream 必须为 true）'
              : prefix === 'internal'
                ? '服务端内部错误'
                : '未知错误';
    return `[${code}] ${meaning}: ${e?.message ?? String(err)}`;
  }
}

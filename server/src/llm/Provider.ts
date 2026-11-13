/**
 * LLMProvider 接口 + 请求/响应类型（AIEngine 与 LLMPipeline 仅依赖此接口）
 * 三个适配器：WorkBuddyCloudProvider(A) / OpenAICompatProvider(B) / TemplateProvider(C)
 */

import type { Role } from '@werewolf/shared';

/** 统一 LLM 请求 */
export interface LLMRequest {
  /** system 提示词（SDK 约束：messages[0] 必须是 system 消息） */
  system: string;
  /** user 提示词 */
  user: string;
  /** 决策类请求走 JSON 结构化输出（stream 收集后 JSON.parse） */
  jsonMode?: boolean;
  /** 采样温度（可选；top_k 不可传） */
  temperature?: number;
  /** 路线 C 模板兜底所需的场景提示（A/B 路线忽略） */
  template?: TemplateHint;
}

/** 路线 C 模板场景提示 */
export interface TemplateHint {
  kind: 'speech' | 'lastwords';
  role: Role;
  personaLabel: string;
}

/** 统一 LLM 响应（流式收集后的完整文本） */
export interface LLMResponse {
  text: string;
}

/** Provider 路线标识 */
export type LLMRoute = 'A' | 'B' | 'C';

/** LLMProvider 接口：所有适配器实现同一契约，chat 失败必须抛错（由 Pipeline 降级） */
export interface LLMProvider {
  /** 路线标识：A / B / C */
  readonly route: LLMRoute;
  /** 人类可读名称（日志/状态灯用） */
  readonly label: string;
  /** 健康检查（A：models.list() 可用性；B：可做轻量探测；C：恒 true） */
  checkHealth(): Promise<boolean>;
  /** 单次对话（signal 由 Pipeline 的 AbortController 注入，超时统一收口） */
  chat(req: LLMRequest, signal: AbortSignal): Promise<string>;
}

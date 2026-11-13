/**
 * LLMPipeline —— A→B→C 三级降级链（拍板①）。
 * - 有序 Provider 链逐级尝试；任何一级失败在可配超时内自动降级，游戏不被阻塞；
 * - 超时由本类统一 AbortController 实现（默认 10s，可配）；
 * - A 失败（超时/auth/quota/gateway）记入熔断状态并自动切 B；B 未配置或失败切 C；C 永不失败；
 * - 健康状态变化广播 llm:status（前端状态灯）。
 */

import type { LLMStatus } from '@werewolf/shared';

import { config } from '../config';
import { loadSettings, sanitizeLogText } from '../security/secrets';
import type { LLMProvider, LLMRequest, LLMRoute } from './Provider';
import { OpenAICompatProvider } from './OpenAICompatProvider';
import { TemplateProvider } from './TemplateProvider';
import { WorkBuddyCloudProvider } from './WorkBuddyCloudProvider';

export interface ChatResult {
  text: string;
  route: LLMRoute;
}

export class LLMPipeline {
  private providers: LLMProvider[] = [];
  /** 路线熔断：route → 熔断截止时间戳（ms） */
  private breaks = new Map<LLMRoute, number>();
  private statusCb: ((status: LLMStatus) => void) | null = null;
  private lastStatus: LLMStatus = { activeRoute: 'C', message: '初始化中…' };

  /** 注册健康状态回调（index.ts：io.emit('llm:status')） */
  onStatus(cb: (status: LLMStatus) => void): void {
    this.statusCb = cb;
  }

  /** 重建降级链（设置变更/启动时调用）：A(启用且凭据在) → B(已配置) → C(恒在) */
  async refreshChain(routeAEnabled: boolean): Promise<void> {
    this.breaks.clear();
    const chain: LLMProvider[] = [];

    if (routeAEnabled) {
      const cloud = this.findCloudProvider();
      if (cloud) {
        const healthy = await cloud.checkHealth();
        if (healthy) {
          chain.push(cloud);
        } else {
          console.warn(sanitizeLogText('[llm] 路线 A 健康检查未通过（cloudConfig 存在但模型不可用），先跳过'));
        }
      }
    }

    const settings = loadSettings();
    if (settings.apiKey) {
      chain.push(new OpenAICompatProvider(settings.routeBBaseUrl, settings.apiKey, settings.routeBModel));
    } else {
      console.log('[llm] 路线 B 未配置 API Key，跳过');
    }

    chain.push(new TemplateProvider());
    this.providers = chain;
    this.setStatus(chain[0]?.route ?? 'C', `降级链就绪：${chain.map((p) => p.route).join('→')}`);
  }

  /** 追加路线 A Provider（index.ts 在启动时注册） */
  register(provider: LLMProvider): void {
    if (provider.route === 'A' && !this.providers.some((p) => p.route === 'A')) {
      this.providers.unshift(provider);
    }
  }

  private cloudProvider: WorkBuddyCloudProvider | null = null;

  /** 供 register 缓存的路线 A 实例（refreshChain 复用） */
  setCloudProvider(provider: WorkBuddyCloudProvider): void {
    this.cloudProvider = provider;
  }

  private findCloudProvider(): WorkBuddyCloudProvider | null {
    if (this.cloudProvider) return this.cloudProvider;
    const found = this.providers.find((p) => p instanceof WorkBuddyCloudProvider);
    return (found as WorkBuddyCloudProvider | undefined) ?? null;
  }

  /** 统一超时入口：chat 逐级尝试，全部失败理论不可能（C 永不失败） */
  async chat(req: LLMRequest, timeoutMs: number = config.llm.timeoutMs): Promise<ChatResult> {
    for (const provider of this.providers) {
      const breakUntil = this.breaks.get(provider.route) ?? 0;
      if (Date.now() < breakUntil) continue; // 熔断期内直接跳过
      try {
        const text = await this.withTimeout(provider, req, timeoutMs);
        this.setStatus(provider.route, `${provider.label} 工作正常`);
        return { text, route: provider.route };
      } catch (err) {
        const msg = sanitizeLogText(err instanceof Error ? err.message : String(err));
        console.warn(sanitizeLogText(`[llm] 路线 ${provider.route} 调用失败：${msg}，尝试降级`));
        // A 失败熔断（超时/auth/quota/gateway 一律熔断一段时间，避免每次请求都先撞 A）
        if (provider.route === 'A') {
          this.breaks.set('A', Date.now() + config.llm.routeABreakMs);
          this.setStatus('B', `路线 A 失败已熔断，降级到后续路线（${msg.slice(0, 80)}）`);
        }
      }
    }
    // 兜底（理论不可达）：直接给模板句
    this.setStatus('C', '全部 LLM 路线失败，使用模板句库');
    return { text: '{"fallback_template":true}', route: 'C' };
  }

  /** 超时包装：AbortController 注入 signal，超时 abort */
  private async withTimeout(provider: LLMProvider, req: LLMRequest, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await provider.chat(req, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  getStatus(): LLMStatus {
    return { ...this.lastStatus };
  }

  private setStatus(route: LLMRoute, message: string): void {
    this.lastStatus = { activeRoute: route, message };
    this.statusCb?.({ ...this.lastStatus });
  }
}

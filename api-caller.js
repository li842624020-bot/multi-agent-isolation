// API 调用模块 - 负责与 LLM API 通信
// 支持 OpenAI 兼容格式 + Anthropic 原生格式
// 可复用 SillyTavern 当前 API 配置，也可独立配置

import { getContext } from '../../../extensions.js';

export class APICaller {
    constructor(settings) {
        this.settings = settings;
    }

    async call(messages, options = {}) {
        const config = this._resolveConfig(options);

        if (!config.url || !config.key) {
            throw new Error('API 未配置：请在插件设置中填写 API URL 和 Key，或确保 SillyTavern 已配置 API');
        }

        if (config.format === 'anthropic') {
            return this._callAnthropic(messages, config, options);
        }

        return this._callOpenAI(messages, config, options);
    }

    async _callOpenAI(messages, config, options) {
        const body = {
            model: config.model,
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.max_tokens ?? 1024,
        };

        if (options.json_mode) {
            body.response_format = { type: 'json_object' };
        }

        const url = config.url.replace(/\/$/, '');
        const endpoint = url.endsWith('/chat/completions') ? url : `${url}/chat/completions`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.key}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`API 调用失败 (${response.status}): ${errorText.slice(0, 200)}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    }

    async _callAnthropic(messages, config, options) {
        const systemMsg = messages.find(m => m.role === 'system');
        const nonSystemMsgs = messages.filter(m => m.role !== 'system');

        const body = {
            model: config.model,
            max_tokens: options.max_tokens ?? 1024,
            messages: nonSystemMsgs.map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content,
            })),
        };

        if (systemMsg) {
            body.system = systemMsg.content;
        }

        if (options.temperature !== undefined) {
            body.temperature = options.temperature;
        }

        const url = config.url.replace(/\/$/, '');
        const endpoint = url.endsWith('/messages') ? url : `${url}/messages`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.key,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`Anthropic API 调用失败 (${response.status}): ${errorText.slice(0, 200)}`);
        }

        const data = await response.json();
        return data.content?.[0]?.text || '';
    }

    async callJSON(messages, options = {}) {
        const config = this._resolveConfig(options);

        // Anthropic 不支持 json_mode，改用提示词引导
        if (config.format === 'anthropic') {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && !lastMsg.content.includes('JSON')) {
                lastMsg.content += '\n\n请只输出JSON，不要输出其他内容。';
            }
        }

        const raw = await this.call(messages, { ...options, json_mode: config.format !== 'anthropic' });

        try {
            return JSON.parse(raw);
        } catch {
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) {
                return JSON.parse(match[0]);
            }
            throw new Error(`JSON 解析失败: ${raw.slice(0, 100)}`);
        }
    }

    async callParallel(requests) {
        return Promise.allSettled(
            requests.map(req => this.callJSON(req.messages, req.options))
        );
    }

    /**
     * 解析最终使用的 API 配置
     * 优先级：插件设置 > SillyTavern 当前配置
     */
    _resolveConfig(options) {
        const pluginUrl = this.settings.agentApiUrl?.trim();
        const pluginKey = this.settings.agentApiKey?.trim();
        const pluginModel = this.settings.agentModel?.trim();

        // 如果插件有自定义配置，直接使用
        if (pluginUrl && pluginKey) {
            return {
                url: pluginUrl,
                key: pluginKey,
                model: options.model || pluginModel || 'gpt-4o-mini',
                format: this._detectFormat(pluginUrl),
            };
        }

        // 尝试从 SillyTavern 读取当前 API 配置
        const stConfig = this._getSTApiConfig();
        if (stConfig) {
            return {
                url: pluginUrl || stConfig.url,
                key: pluginKey || stConfig.key,
                model: options.model || pluginModel || stConfig.model || 'gpt-4o-mini',
                format: this._detectFormat(pluginUrl || stConfig.url),
            };
        }

        // 都没有，返回空（会在 call() 中报错）
        return {
            url: pluginUrl || '',
            key: pluginKey || '',
            model: options.model || pluginModel || 'gpt-4o-mini',
            format: 'openai',
        };
    }

    /**
     * 从 SillyTavern 全局状态读取当前 API 配置
     */
    _getSTApiConfig() {
        try {
            // SillyTavern 的 OpenAI 设置通常在全局 oai_settings 中
            const oaiSettings = window.oai_settings;
            if (oaiSettings) {
                const url = oaiSettings.custom_url || oaiSettings.reverse_proxy || '';
                const key = oaiSettings.api_key_openai || oaiSettings.reverse_proxy_password || '';
                const model = oaiSettings.openai_model || '';
                if (url || key) {
                    return { url, key, model };
                }
            }

            // 尝试通过 SillyTavern 的 secret API 获取（如果可用）
            // 注意：secrets 通常存储在服务端，前端不一定能直接访问
            const context = getContext();
            if (context?.apiSettings) {
                return {
                    url: context.apiSettings.url || '',
                    key: context.apiSettings.key || '',
                    model: context.apiSettings.model || '',
                };
            }
        } catch (e) {
            console.warn('[MAI APICaller] 无法读取 SillyTavern API 配置:', e);
        }
        return null;
    }

    /**
     * 根据 URL 自动检测 API 格式
     */
    _detectFormat(url) {
        if (!url) return 'openai';
        if (url.includes('anthropic') || url.includes('claude')) {
            return 'anthropic';
        }
        return 'openai';
    }
}

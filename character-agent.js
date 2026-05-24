// 角色 Agent - 每个角色由独立 AI 实例扮演，生成结构化反应

import { APICaller } from './api-caller.js';

const CHARACTER_SYSTEM_TEMPLATE = `{jailbreak}

你正在扮演角色「{name}」。

【角色设定】
{characterInfo}

【输出要求】
根据当前情境，生成该角色的反应。使用以下JSON格式输出：
{{
  "dialogue": "角色说的话（没有则为null）",
  "action": "角色的动作描述",
  "expression": "角色的表情/神态",
  "thought": "角色的内心想法（可选，null表示不展示）"
}}

规则：
- 只输出这一个角色的反应，不要写其他角色
- 保持角色性格一致
- 如果角色在当前情境下不会主动说话或行动，action可以写"沉默"或简单的观察动作
- dialogue 是角色说出口的话，thought 是内心独白（不说出口）
- 不要输出JSON以外的内容`;

export class CharacterAgent {
    constructor(settings) {
        this.settings = settings;
        this.api = new APICaller(settings);
    }

    /**
     * 为单个角色生成反应
     * @param {string} name - 角色名
     * @param {string} characterInfo - 角色设定文本
     * @param {Array} visibleHistory - 该角色可见的历史消息
     * @param {string} currentInput - 用户最新输入
     * @param {string} sceneContext - 调度器提供的场景描述
     * @returns {Object} 结构化反应
     */
    async generateReaction(name, characterInfo, visibleHistory, currentInput, sceneContext) {
        const systemPrompt = this._buildSystemPrompt(name, characterInfo);
        const messages = [
            { role: 'system', content: systemPrompt },
            ...this._formatHistory(visibleHistory),
            { role: 'user', content: this._buildCurrentPrompt(currentInput, sceneContext) },
        ];

        try {
            const result = await this.api.callJSON(messages, {
                temperature: 0.8,
                max_tokens: 256,
            });
            return this._validateReaction(name, result);
        } catch (error) {
            console.warn(`[MAI CharacterAgent] ${name} 生成失败:`, error);
            return this._fallbackReaction(name);
        }
    }

    /**
     * 并行调用多个角色 Agent
     * @param {Array} characterRequests - [{ name, characterInfo, visibleHistory }]
     * @param {string} currentInput
     * @param {string} sceneContext
     * @returns {Array} [{ name, reaction, success }]
     */
    async generateReactionsParallel(characterRequests, currentInput, sceneContext) {
        const promises = characterRequests.map(async (req) => {
            try {
                const reaction = await this.generateReaction(
                    req.name,
                    req.characterInfo,
                    req.visibleHistory,
                    currentInput,
                    sceneContext,
                );
                return { name: req.name, reaction, success: true };
            } catch (error) {
                return { name: req.name, reaction: this._fallbackReaction(req.name), success: false };
            }
        });

        return Promise.all(promises);
    }

    _buildSystemPrompt(name, characterInfo) {
        const prompts = this.settings.jailbreakPrompts || [];
        const jailbreak = prompts.filter(p => p.trim()).join('\n\n');
        return CHARACTER_SYSTEM_TEMPLATE
            .replace('{jailbreak}', jailbreak)
            .replace('{name}', name)
            .replace('{characterInfo}', characterInfo || `角色名：${name}`);
    }

    _formatHistory(visibleHistory) {
        if (!visibleHistory || visibleHistory.length === 0) return [];

        return visibleHistory
            .filter(msg => msg.role !== 'system')
            .slice(-15)
            .map(msg => ({
                role: msg.role,
                content: msg.content,
            }));
    }

    _buildCurrentPrompt(currentInput, sceneContext) {
        let prompt = '';
        if (sceneContext) {
            prompt += `【当前场景】${sceneContext}\n\n`;
        }
        prompt += `【最新输入】\n${currentInput}\n\n请生成你的角色反应（JSON格式）。`;
        return prompt;
    }

    _validateReaction(name, result) {
        return {
            name,
            dialogue: result.dialogue || null,
            action: result.action || '沉默',
            expression: result.expression || '',
            thought: result.thought || null,
        };
    }

    _fallbackReaction(name) {
        return {
            name,
            dialogue: null,
            action: '静静地观察着',
            expression: '',
            thought: null,
        };
    }
}

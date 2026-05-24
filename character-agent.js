// 角色 Agent - 每个角色由独立 AI 实例扮演，生成完整反应段落

import { APICaller } from './api-caller.js';

const CHARACTER_SYSTEM_TEMPLATE = `{jailbreak}

你正在扮演角色「{name}」。

【角色设定】
{characterInfo}

【输出要求】
根据当前情境，生成该角色的完整反应。使用以下JSON格式输出：
{{
  "content": "角色的完整反应段落。要求：自然混合对话、动作、神态描写，形成连贯的叙事段落，不少于3句话。对话用引号标注，动作和神态直接描写。",
  "intent": "一句话概括角色此刻的核心意图或情绪状态",
  "dialogue_summary": "角色说的关键台词摘要（没说话则为null）"
}}

规则：
- 只输出这一个角色的反应，不要写其他角色
- 保持角色性格一致
- content 必须是完整的叙事段落（3-8句），包含动作、神态、对话的自然混合
- 对话要符合角色说话风格，可以有多句对话
- 如果角色在当前情境下不会主动说话，也要描写其动作和神态反应
- intent 是对角色当前状态的一句话总结，供主AI参考
- dialogue_summary 只记录关键台词，用于历史追踪
- 不要输出JSON以外的内容`;

export class CharacterAgent {
    constructor(settings) {
        this.settings = settings;
        this.api = new APICaller(settings);
    }

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
                max_tokens: 768,
            });
            return this._validateReaction(name, result);
        } catch (error) {
            console.warn(`[MAI CharacterAgent] ${name} 生成失败:`, error);
            return this._fallbackReaction(name);
        }
    }

    async generateReactionsParallel(characterRequests, currentInput, sceneContext) {
        const promises = characterRequests.map(async (req) => {
            try {
                const inputForChar = req.filteredInput || currentInput;
                const reaction = await this.generateReaction(
                    req.name,
                    req.characterInfo,
                    req.visibleHistory,
                    inputForChar,
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
        prompt += `【最新输入】\n${currentInput}\n\n请生成你的角色反应（JSON格式），要求内容完整丰富，不少于3句话。`;
        return prompt;
    }

    _validateReaction(name, result) {
        return {
            name,
            content: result.content || '静静地站在一旁，目光平静地注视着眼前发生的一切。',
            intent: result.intent || '观察',
            dialogue_summary: result.dialogue_summary || null,
        };
    }

    _fallbackReaction(name) {
        return {
            name,
            content: '静静地观察着周围的情况，神色平静，没有做出特别的反应。',
            intent: '沉默观察',
            dialogue_summary: null,
        };
    }
}

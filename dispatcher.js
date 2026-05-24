// 调度器 Agent - 分析用户输入，识别角色出场/离场，决定哪些角色需要生成反应
// 新增：按角色过滤用户输入（信息隔离分辨）

import { APICaller } from './api-caller.js';

const DISPATCHER_SYSTEM_PROMPT = `你是一个场景调度器。你的任务是分析用户的最新输入，判断场景中角色的变化，并识别输入中哪些内容是对特定角色说的。

你需要：
1. 判断是否有新角色出场（进入场景）
2. 判断是否有角色离场（离开场景）
3. 判断是否有未命名的新NPC出现
4. 决定哪些在场角色需要对当前输入做出反应
5. 【重要】分析用户输入中，哪些内容是对所有人说的，哪些是私密对特定角色说的

输出严格使用以下JSON格式：
{
  "entered": ["新进入场景的角色名"],
  "exited": ["离开场景的角色名"],
  "new_npcs": [
    {
      "name": "临时角色名",
      "description": "简短描述"
    }
  ],
  "characters_to_react": ["需要做出反应的在场角色名列表"],
  "scene_context": "用一句话描述当前场景状况",
  "filtered_input": {
    "public": "所有角色都能听到/看到的内容",
    "private": {
      "角色名": "只有该角色能听到/看到的内容"
    }
  }
}

规则：
- 只有明确提到出场/离场的角色才放入 entered/exited
- 如果用户输入是主角的对话或动作，所有在场角色通常都需要反应
- 如果是环境描写或旁白，只有被直接影响的角色需要反应
- filtered_input.public 是所有角色都能感知的内容
- filtered_input.private 是只有特定角色能感知的内容（如耳语、私下动作）
- 如果没有私密内容，private 为空对象 {}
- 不确定时宁可让角色反应，也不要遗漏`;

const PRESENCE_KEYWORDS = {
    enter: ['走了进来', '出现了', '推门而入', '来了', '走进', '进入', '到来', '现身', '赶到', '闯入', '走来', '跑来', '冲进'],
    exit: ['离开了', '走了', '消失了', '转身离去', '退出', '离去', '走出', '跑走', '逃走', '告辞', '撤退'],
};

export class Dispatcher {
    constructor(settings) {
        this.settings = settings;
        this.api = new APICaller(settings);
    }

    async analyze(userInput, presentCharacters, knownCharacters) {
        const messages = [
            { role: 'system', content: DISPATCHER_SYSTEM_PROMPT },
            {
                role: 'user',
                content: this._buildUserPrompt(userInput, presentCharacters, knownCharacters),
            },
        ];

        try {
            const result = await this.api.callJSON(messages, {
                temperature: 0.3,
                max_tokens: 768,
            });
            return this._validateResult(result, presentCharacters, userInput);
        } catch (error) {
            console.warn('[MAI Dispatcher] API 调用失败，使用本地快速分析:', error);
            return this._localFallback(userInput, presentCharacters);
        }
    }

    _buildUserPrompt(userInput, presentCharacters, knownCharacters) {
        return `当前在场角色：${presentCharacters.length > 0 ? presentCharacters.join('、') : '（无）'}
已知所有角色：${knownCharacters.length > 0 ? knownCharacters.join('、') : '（无）'}

用户最新输入：
${userInput}

请分析这段输入，输出JSON。注意识别是否有私密对话（耳语、私下动作等）。`;
    }

    _validateResult(result, presentCharacters, userInput) {
        const filtered = result.filtered_input || {};
        return {
            entered: Array.isArray(result.entered) ? result.entered : [],
            exited: Array.isArray(result.exited) ? result.exited : [],
            new_npcs: Array.isArray(result.new_npcs) ? result.new_npcs : [],
            characters_to_react: Array.isArray(result.characters_to_react)
                ? result.characters_to_react
                : [...presentCharacters],
            scene_context: result.scene_context || '',
            filtered_input: {
                public: filtered.public || userInput,
                private: filtered.private || {},
            },
        };
    }

    _localFallback(userInput, presentCharacters) {
        const entered = [];
        const exited = [];

        for (const keyword of PRESENCE_KEYWORDS.enter) {
            const regex = new RegExp(`(.{1,10})${keyword}`, 'g');
            let match;
            while ((match = regex.exec(userInput)) !== null) {
                const nameCandidate = match[1].trim().replace(/[，。、！？""''（）\s]/g, '');
                if (nameCandidate && nameCandidate.length <= 8) {
                    entered.push(nameCandidate);
                }
            }
        }

        for (const keyword of PRESENCE_KEYWORDS.exit) {
            const regex = new RegExp(`(.{1,10})${keyword}`, 'g');
            let match;
            while ((match = regex.exec(userInput)) !== null) {
                const nameCandidate = match[1].trim().replace(/[，。、！？""''（）\s]/g, '');
                if (nameCandidate && nameCandidate.length <= 8) {
                    exited.push(nameCandidate);
                }
            }
        }

        return {
            entered,
            exited,
            new_npcs: [],
            characters_to_react: [...presentCharacters, ...entered],
            scene_context: '',
            filtered_input: {
                public: userInput,
                private: {},
            },
        };
    }

    getFilteredInputForCharacter(characterName, dispatchResult) {
        const publicPart = dispatchResult.filtered_input?.public || '';
        const privatePart = dispatchResult.filtered_input?.private?.[characterName] || '';
        if (privatePart) {
            return `${publicPart}\n${privatePart}`;
        }
        return publicPart;
    }
}

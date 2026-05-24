// 行为指令生成器 - 将角色 Agent 的结构化输出转换为注入 SillyTavern 的行为指令

export class DirectiveBuilder {
    /**
     * 将多个角色的反应组合成一段行为指令文本
     * @param {Array} reactions - [{ name, dialogue, action, expression, thought }]
     * @returns {string} 行为指令文本
     */
    build(reactions) {
        if (!reactions || reactions.length === 0) return '';

        const lines = reactions.map(r => this._formatReaction(r));

        return `[角色行为指令]
以下是各角色在当前场景中的确切反应。请严格按照以下内容描写各角色的行为，将其自然地融入正文叙述中。

${lines.join('\n')}

【重要约束】
- 严格按照上述指令描写每个角色，不要添加任何未列出的行为
- 不要让任何角色表现出"察觉"、"怀疑"、"隐约感到"等未在指令中明确列出的反应
- 不要为角色添加额外的对话或动作
- 可以添加环境描写和氛围渲染，但角色行为必须严格遵循指令`;
    }

    /**
     * 将行为指令注入到 messages 数组中
     * @param {Array} chat - SillyTavern 的 messages 数组（引用传递）
     * @param {string} directive - 行为指令文本
     * @param {string} position - 注入位置
     */
    inject(chat, directive, position = 'before_last') {
        if (!directive || !chat || chat.length === 0) return;

        const injectionMessage = {
            role: 'system',
            content: directive,
        };

        switch (position) {
            case 'before_last':
                // 在最后一条消息之前（通常是用户最新输入之前）
                chat.splice(Math.max(0, chat.length - 1), 0, injectionMessage);
                break;
            case 'after_last':
                // 在最后一条消息之后
                chat.push(injectionMessage);
                break;
            case 'second_to_last':
                // 在倒数第二个位置
                chat.splice(Math.max(0, chat.length - 2), 0, injectionMessage);
                break;
            default:
                chat.splice(Math.max(0, chat.length - 1), 0, injectionMessage);
        }
    }

    _formatReaction(reaction) {
        const parts = [];

        if (reaction.action && reaction.action !== '沉默') {
            parts.push(reaction.action);
        }

        if (reaction.expression) {
            parts.push(`表情：${reaction.expression}`);
        }

        if (reaction.dialogue) {
            parts.push(`说："${reaction.dialogue}"`);
        }

        if (reaction.thought) {
            parts.push(`（内心：${reaction.thought}）`);
        }

        if (parts.length === 0) {
            parts.push('沉默，没有特别反应');
        }

        return `- ${reaction.name}：${parts.join('；')}`;
    }
}

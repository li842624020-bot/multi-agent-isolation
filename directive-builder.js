// 行为指令生成器 - 将角色 Agent 的完整反应转换为注入 SillyTavern 的行为指令

export class DirectiveBuilder {
    build(reactions) {
        if (!reactions || reactions.length === 0) return '';

        const blocks = reactions.map(r => this._formatReaction(r));

        return `[角色行为指令]
以下是各角色在当前场景中的完整反应内容和意图。请将这些内容自然地整合到你的回复中，可以适当润色文笔使其更流畅，但必须保留每个角色的核心行为、对话和意图不变。

${blocks.join('\n\n')}

【整合要求】
- 保留每个角色的核心对话内容和行为，不要删减或大幅改动
- 可以调整措辞和文笔使叙述更流畅自然
- 不要为角色添加上述内容中没有的额外对话或重大行为
- 不要让角色表现出未在上述内容中提及的"察觉"、"怀疑"等反应
- 可以添加环境描写、氛围渲染和过渡衔接`;
    }

    inject(chat, directive, position = 'before_last') {
        if (!directive || !chat || chat.length === 0) return;

        const injectionMessage = {
            role: 'system',
            content: directive,
        };

        switch (position) {
            case 'before_last':
                chat.splice(Math.max(0, chat.length - 1), 0, injectionMessage);
                break;
            case 'after_last':
                chat.push(injectionMessage);
                break;
            case 'second_to_last':
                chat.splice(Math.max(0, chat.length - 2), 0, injectionMessage);
                break;
            default:
                chat.splice(Math.max(0, chat.length - 1), 0, injectionMessage);
        }
    }

    _formatReaction(reaction) {
        let block = `【${reaction.name}】\n`;
        block += `意图：${reaction.intent || '观察'}\n`;
        block += `内容：\n${reaction.content || '沉默观察，没有特别反应。'}`;

        return block;
    }
}

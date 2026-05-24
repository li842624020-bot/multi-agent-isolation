// 角色专属历史管理 - 为每个角色维护独立的可见历史
// 核心原则：角色只能看到自己在场时的对话

export class HistoryManager {
    constructor() {
        // 每条消息的元数据：记录该消息发生时谁在场
        // key: messageIndex, value: { presentCharacters: string[], scene: string }
        this.messageMeta = new Map();
    }

    /**
     * 标记一条消息的在场角色
     */
    markMessage(messageIndex, presentCharacters, scene = '') {
        this.messageMeta.set(messageIndex, {
            presentCharacters: [...presentCharacters],
            scene,
        });
    }

    /**
     * 为指定角色过滤历史 - 只返回该角色在场时的消息
     * @param {string} characterName - 角色名
     * @param {Array} fullChat - SillyTavern 的完整 messages 数组
     * @returns {Array} 该角色可见的历史消息子集
     */
    getHistoryForCharacter(characterName, fullChat) {
        if (this.messageMeta.size === 0) {
            return fullChat;
        }

        const filtered = [];
        for (let i = 0; i < fullChat.length; i++) {
            const meta = this.messageMeta.get(i);
            // 没有元数据的消息（系统提示词等）默认可见
            if (!meta) {
                if (fullChat[i].role === 'system') {
                    filtered.push(fullChat[i]);
                }
                continue;
            }
            // 该角色在场时的消息才可见
            if (meta.presentCharacters.includes(characterName)) {
                filtered.push(fullChat[i]);
            }
        }
        return filtered;
    }

    /**
     * 从 SillyTavern 的 chat 数据中重建元数据
     * SillyTavern 的 chat 对象可能有 extra 字段可以存储自定义数据
     */
    loadFromChat(chatMessages) {
        this.messageMeta.clear();
        chatMessages.forEach((msg, index) => {
            if (msg.extra?.mai_present) {
                this.messageMeta.set(index, {
                    presentCharacters: msg.extra.mai_present,
                    scene: msg.extra.mai_scene || '',
                });
            }
        });
    }

    /**
     * 将当前在场信息写入 SillyTavern 的消息 extra 字段
     */
    saveToMessage(message, presentCharacters, scene = '') {
        if (!message.extra) {
            message.extra = {};
        }
        message.extra.mai_present = [...presentCharacters];
        message.extra.mai_scene = scene;
    }

    /**
     * 获取最近 N 条该角色可见的历史（用于构建角色 Agent 的上下文）
     * @param {string} characterName
     * @param {Array} fullChat
     * @param {number} maxMessages - 最多返回多少条
     * @returns {Array}
     */
    getRecentHistoryForCharacter(characterName, fullChat, maxMessages = 20) {
        const allVisible = this.getHistoryForCharacter(characterName, fullChat);
        // 保留 system 消息 + 最近的对话消息
        const systemMsgs = allVisible.filter(m => m.role === 'system');
        const chatMsgs = allVisible.filter(m => m.role !== 'system');
        const recentChat = chatMsgs.slice(-maxMessages);
        return [...systemMsgs, ...recentChat];
    }

    /**
     * 获取消息总数和角色可见消息数（用于调试/UI显示）
     */
    getStats(characterName, fullChat) {
        const visible = this.getHistoryForCharacter(characterName, fullChat);
        return {
            total: fullChat.length,
            visible: visible.length,
            hidden: fullChat.length - visible.length,
        };
    }

    /**
     * 清除所有元数据
     */
    clear() {
        this.messageMeta.clear();
    }
}

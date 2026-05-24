// Multi-Agent Isolation Plugin for SillyTavern
// 通过多Agent架构实现角色间的真正信息隔离

import { eventSource, event_types, main_api } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

import { Dispatcher } from './dispatcher.js';
import { CharacterAgent } from './character-agent.js';
import { HistoryManager } from './history-manager.js';
import { DirectiveBuilder } from './directive-builder.js';

const extensionName = 'multi-agent-isolation';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const defaultSettings = {
    enabled: false,
    autoDetectPresence: true,
    autoGenerateNPC: true,
    showDebugInfo: false,
    presentCharacters: [],
    allKnownCharacters: [],
    agentModel: '',
    agentApiUrl: '',
    agentApiKey: '',
    agentJailbreakPrompt: '',
    injectionPosition: 'before_last',
};

// 核心模块实例
let dispatcher = null;
let characterAgent = null;
let historyManager = new HistoryManager();
let directiveBuilder = new DirectiveBuilder();

// === 设置管理 ===

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    initModules();
    updateUI();
}

function getSettings() {
    return extension_settings[extensionName] || defaultSettings;
}

function saveSettings() {
    saveSettingsDebounced();
}

function initModules() {
    const settings = getSettings();
    dispatcher = new Dispatcher(settings);
    characterAgent = new CharacterAgent(settings);
}

function updateUI() {
    const settings = getSettings();
    $('#mai_enabled').prop('checked', settings.enabled);
    $('#mai_auto_detect').prop('checked', settings.autoDetectPresence);
    $('#mai_auto_npc').prop('checked', settings.autoGenerateNPC);
    $('#mai_debug').prop('checked', settings.showDebugInfo);
    $('#mai_agent_model').val(settings.agentModel || '');
    $('#mai_agent_url').val(settings.agentApiUrl || '');
    $('#mai_agent_key').val(settings.agentApiKey || '');
    $('#mai_jailbreak').val(settings.agentJailbreakPrompt || '');
    renderPresentCharacters();
    toggleDebugPanel();
}

function renderPresentCharacters() {
    const settings = getSettings();
    const container = $('#mai_present_characters');
    if (!container.length) return;

    container.empty();
    const chars = settings.presentCharacters || [];

    if (chars.length === 0) {
        container.append('<div class="mai-empty-state">暂无在场角色，开始对话后自动识别</div>');
        return;
    }

    chars.forEach((name, index) => {
        const tag = $(`
            <div class="mai-character-tag">
                <span class="mai-character-name">${name}</span>
                <span class="mai-character-remove" data-index="${index}" title="移除">×</span>
            </div>
        `);
        container.append(tag);
    });
}

function toggleDebugPanel() {
    const settings = getSettings();
    $('#mai_debug_output').toggle(settings.showDebugInfo);
}

// === 事件处理 ===

function onEnabledChange(event) {
    const settings = getSettings();
    settings.enabled = Boolean($(event.target).prop('checked'));
    saveSettings();
    logDebug(`插件${settings.enabled ? '已启用' : '已禁用'}`);
}

function onAutoDetectChange(event) {
    const settings = getSettings();
    settings.autoDetectPresence = Boolean($(event.target).prop('checked'));
    saveSettings();
}

function onAutoNPCChange(event) {
    const settings = getSettings();
    settings.autoGenerateNPC = Boolean($(event.target).prop('checked'));
    saveSettings();
}

function onDebugChange(event) {
    const settings = getSettings();
    settings.showDebugInfo = Boolean($(event.target).prop('checked'));
    saveSettings();
    toggleDebugPanel();
}

function onAgentModelChange(event) {
    const settings = getSettings();
    settings.agentModel = $(event.target).val();
    saveSettings();
    initModules();
}

function onAgentUrlChange(event) {
    const settings = getSettings();
    settings.agentApiUrl = $(event.target).val();
    saveSettings();
    initModules();
}

function onAgentKeyChange(event) {
    const settings = getSettings();
    settings.agentApiKey = $(event.target).val();
    saveSettings();
    initModules();
}

function onJailbreakChange(event) {
    const settings = getSettings();
    settings.agentJailbreakPrompt = $(event.target).val();
    saveSettings();
    initModules();
}

function onAddCharacter() {
    const input = $('#mai_add_character_input');
    const name = input.val().trim();
    if (!name) return;

    const settings = getSettings();
    if (!settings.presentCharacters.includes(name)) {
        settings.presentCharacters.push(name);
        if (!settings.allKnownCharacters.includes(name)) {
            settings.allKnownCharacters.push(name);
        }
        saveSettings();
        renderPresentCharacters();
        logDebug(`手动添加角色: ${name}`);
    }
    input.val('');
}

function onRemoveCharacter(event) {
    const index = $(event.target).data('index');
    const settings = getSettings();
    const removed = settings.presentCharacters.splice(index, 1);
    saveSettings();
    renderPresentCharacters();
    logDebug(`移除角色: ${removed[0]}`);
}

// === 核心流程：生成前拦截 ===

async function onChatCompletionPromptReady(data) {
    const settings = getSettings();

    if (!settings.enabled) return;
    if (data.dryRun) return;

    logDebug('=== 开始多Agent处理 ===');

    try {
        // 1. 获取用户最新输入
        const userInput = extractLastUserInput(data.chat);
        if (!userInput) {
            logDebug('未找到用户输入，跳过');
            return;
        }
        logDebug(`用户输入: ${userInput.slice(0, 50)}...`);

        // 2. 调度器分析
        logDebug('调度器分析中...');
        const dispatchResult = await dispatcher.analyze(
            userInput,
            settings.presentCharacters,
            settings.allKnownCharacters,
        );
        logDebug(`调度结果: 进入=${dispatchResult.entered.join(',')} 离开=${dispatchResult.exited.join(',')}`);
        logDebug(`需要反应的角色: ${dispatchResult.characters_to_react.join(', ')}`);

        // 3. 更新在场状态
        updatePresence(dispatchResult, settings);

        // 4. 如果没有角色需要反应，跳过
        if (dispatchResult.characters_to_react.length === 0) {
            logDebug('无角色需要反应，跳过');
            return;
        }

        // 5. 为每个角色准备请求（带隔离历史）
        const characterRequests = dispatchResult.characters_to_react.map(name => ({
            name,
            characterInfo: getCharacterInfo(name),
            visibleHistory: historyManager.getRecentHistoryForCharacter(name, data.chat, 20),
        }));

        // 6. 并行调用角色 Agent
        logDebug(`并行调用 ${characterRequests.length} 个角色Agent...`);
        const reactions = await characterAgent.generateReactionsParallel(
            characterRequests,
            userInput,
            dispatchResult.scene_context,
        );

        const successCount = reactions.filter(r => r.success).length;
        logDebug(`角色Agent完成: ${successCount}/${reactions.length} 成功`);

        // 7. 生成行为指令
        const reactionData = reactions.map(r => r.reaction);
        const directive = directiveBuilder.build(reactionData);

        if (directive) {
            // 8. 注入到 messages 数组
            directiveBuilder.inject(data.chat, directive, settings.injectionPosition);
            logDebug('行为指令已注入');
            logDebug(`指令预览: ${directive.slice(0, 100)}...`);
        }

    } catch (error) {
        console.error('[Multi-Agent Isolation] 处理失败，降级到正常模式:', error);
        logDebug(`处理失败: ${error.message}`);
    }
}

// === 生成后处理 ===

async function onMessageReceived(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;

    // 标记新消息的在场角色（用于历史隔离）
    const context = getContext();
    if (context.chat && context.chat.length > 0) {
        const lastMsg = context.chat[context.chat.length - 1];
        historyManager.saveToMessage(lastMsg, settings.presentCharacters);
    }

    logDebug(`收到AI回复，已标记在场角色: ${settings.presentCharacters.join(', ')}`);
}

// === 辅助函数 ===

function extractLastUserInput(chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i].role === 'user') {
            return chat[i].content;
        }
    }
    return null;
}

function updatePresence(dispatchResult, settings) {
    // 添加新进入的角色
    for (const name of dispatchResult.entered) {
        if (!settings.presentCharacters.includes(name)) {
            settings.presentCharacters.push(name);
        }
        if (!settings.allKnownCharacters.includes(name)) {
            settings.allKnownCharacters.push(name);
        }
    }

    // 移除离开的角色
    for (const name of dispatchResult.exited) {
        const idx = settings.presentCharacters.indexOf(name);
        if (idx !== -1) {
            settings.presentCharacters.splice(idx, 1);
        }
    }

    saveSettings();
    renderPresentCharacters();
}

function getCharacterInfo(name) {
    // 尝试从 SillyTavern 的角色数据中获取设定
    try {
        const context = getContext();
        // 群聊中的角色
        if (context.groups && context.groupId) {
            const group = context.groups.find(g => g.id === context.groupId);
            if (group) {
                const char = context.characters?.find(c => c.name === name);
                if (char) {
                    return char.description || char.personality || `角色名：${name}`;
                }
            }
        }
        // 单聊角色
        if (context.characterId !== undefined) {
            const char = context.characters?.[context.characterId];
            if (char && char.name === name) {
                return char.description || char.personality || `角色名：${name}`;
            }
        }
    } catch (e) {
        // 获取失败时使用默认
    }
    return `角色名：${name}`;
}

function logDebug(message) {
    const settings = getSettings();
    if (settings.showDebugInfo) {
        console.log(`[MAI] ${message}`);
        const debugPanel = $('#mai_debug_output');
        if (debugPanel.length) {
            debugPanel.show();
            const time = new Date().toLocaleTimeString();
            debugPanel.prepend(`<div class="mai-debug-line">[${time}] ${message}</div>`);
            debugPanel.find('.mai-debug-line').slice(30).remove();
        }
    }
}

// === 初始化 ===

jQuery(async () => {
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $('#extensions_settings2').append(settingsHtml);

    // 绑定事件
    $('#mai_enabled').on('change', onEnabledChange);
    $('#mai_auto_detect').on('change', onAutoDetectChange);
    $('#mai_auto_npc').on('change', onAutoNPCChange);
    $('#mai_debug').on('change', onDebugChange);
    $('#mai_agent_model').on('input', onAgentModelChange);
    $('#mai_agent_url').on('input', onAgentUrlChange);
    $('#mai_agent_key').on('input', onAgentKeyChange);
    $('#mai_jailbreak').on('input', onJailbreakChange);
    $('#mai_add_character_btn').on('click', onAddCharacter);
    $('#mai_add_character_input').on('keypress', (e) => {
        if (e.key === 'Enter') onAddCharacter();
    });
    $(document).on('click', '.mai-character-remove', onRemoveCharacter);

    // 注册核心事件监听
    if ('CHAT_COMPLETION_PROMPT_READY' in event_types) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);
        console.log('[Multi-Agent Isolation] 已注册 CHAT_COMPLETION_PROMPT_READY 事件');
    } else {
        console.warn('[Multi-Agent Isolation] CHAT_COMPLETION_PROMPT_READY 事件不可用');
        toastr.warning('Multi-Agent Isolation: 需要更新 SillyTavern 到最新版本');
    }

    if ('MESSAGE_RECEIVED' in event_types) {
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    }

    // 加载设置
    await loadSettings();
    console.log('[Multi-Agent Isolation] 插件已加载 v0.2.0');
});

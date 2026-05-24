// Multi-Agent Isolation Plugin for SillyTavern
// 通过多Agent架构实现角色间的真正信息隔离

import { eventSource, event_types } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

import { Dispatcher } from './dispatcher.js';
import { CharacterAgent } from './character-agent.js';
import { HistoryManager } from './history-manager.js';
import { DirectiveBuilder } from './directive-builder.js';
import { APICaller } from './api-caller.js';

const extensionName = 'multi-agent-isolation';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const defaultSettings = {
    enabled: false,
    autoDetectPresence: true,
    autoGenerateNPC: true,
    presentCharacters: [],
    allKnownCharacters: [],
    agentModel: '',
    agentApiUrl: '',
    agentApiKey: '',
    jailbreakPrompts: [''],
    injectionPosition: 'before_last',
};

let dispatcher = null;
let characterAgent = null;
let historyManager = new HistoryManager();
let directiveBuilder = new DirectiveBuilder();
let logEntries = [];

// === 设置管理 ===

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    const s = getSettings();
    if (s.agentJailbreakPrompt && !s.jailbreakPrompts) {
        s.jailbreakPrompts = [s.agentJailbreakPrompt];
        delete s.agentJailbreakPrompt;
    }
    if (!Array.isArray(s.jailbreakPrompts)) {
        s.jailbreakPrompts = [''];
    }
    initModules();
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

// === 日志系统 ===

function addLog(message, level = 'info') {
    const time = new Date().toLocaleTimeString();
    logEntries.unshift({ time, message, level });
    if (logEntries.length > 100) logEntries.pop();
    console.log(`[MAI][${level}] ${message}`);
    renderLogs();
}

function renderLogs() {
    const panel = document.getElementById('mai_log_panel');
    if (!panel) return;
    if (logEntries.length === 0) {
        panel.innerHTML = '<div class="mai-log-empty">暂无日志，发送消息后将显示运行记录</div>';
        return;
    }
    panel.innerHTML = logEntries.map(e =>
        `<div class="mai-log-line ${e.level}">[${e.time}] ${e.message}</div>`
    ).join('');
}

// === Modal UI ===

function createModalHTML() {
    return `
    <div class="mai-modal-overlay" id="mai_modal_overlay">
        <div class="mai-modal">
            <div class="mai-modal-header">
                <span class="mai-modal-title">Multi-Agent 信息隔离</span>
                <span class="mai-modal-close" id="mai_modal_close">&times;</span>
            </div>
            <div class="mai-tabs">
                <div class="mai-tab active" data-tab="settings">设置</div>
                <div class="mai-tab" data-tab="characters">角色</div>
                <div class="mai-tab" data-tab="prompts">提示词</div>
                <div class="mai-tab" data-tab="logs">日志</div>
            </div>
            <div class="mai-modal-body">
                <!-- 设置 Tab -->
                <div class="mai-tab-content active" data-tab="settings">
                    <div class="mai-section-title">API 连接</div>
                    <div class="mai-form-group">
                        <label>API URL</label>
                        <input id="mai_m_url" type="text" placeholder="https://api.openai.com/v1 或中转站地址" />
                        <div class="mai-form-hint">支持 OpenAI 兼容格式和 Anthropic 原生格式，留空则复用 SillyTavern 当前配置</div>
                    </div>
                    <div class="mai-form-group">
                        <label>API Key</label>
                        <input id="mai_m_key" type="password" placeholder="sk-... 或 anthropic key" />
                    </div>
                    <div class="mai-form-group">
                        <label>模型名称</label>
                        <input id="mai_m_model" type="text" placeholder="gpt-4o-mini / claude-3-haiku-20240307" />
                        <div class="mai-form-hint">推荐用便宜快速的模型，最终输出质量由 SillyTavern 主模型决定</div>
                    </div>
                    <div class="mai-api-test-row">
                        <button class="mai-btn mai-btn-primary" id="mai_test_api">测试连接</button>
                        <span id="mai_api_status"></span>
                    </div>

                    <div class="mai-section-title" style="margin-top:24px;">自动化</div>
                    <div class="mai-checkbox-group">
                        <label><input id="mai_m_auto_detect" type="checkbox" /> 自动识别角色出场/离场</label>
                        <label><input id="mai_m_auto_npc" type="checkbox" /> 自动生成临时NPC设定</label>
                    </div>
                </div>

                <!-- 角色 Tab -->
                <div class="mai-tab-content" data-tab="characters">
                    <div class="mai-section-title">当前在场角色</div>
                    <div id="mai_m_characters" class="mai-character-list">
                        <div class="mai-empty-state">暂无在场角色</div>
                    </div>
                    <div class="mai-add-character">
                        <input id="mai_m_add_input" type="text" placeholder="输入角色名..." />
                        <button class="mai-btn" id="mai_m_add_btn">添加</button>
                    </div>
                    <div class="mai-form-hint" style="margin-top:12px;">手动添加的角色会参与信息隔离。开启自动识别后，角色也会根据对话内容自动进出场。</div>
                </div>

                <!-- 提示词 Tab -->
                <div class="mai-tab-content" data-tab="prompts">
                    <div class="mai-section-title">角色Agent通用提示词</div>
                    <div class="mai-form-hint" style="margin-bottom:12px;">每条提示词会拼接后添加到角色Agent的系统提示词开头（用于破限等）</div>
                    <div id="mai_m_prompts" class="mai-prompt-list"></div>
                    <button class="mai-btn" id="mai_m_add_prompt" style="margin-top:8px;">+ 添加提示词</button>
                </div>

                <!-- 日志 Tab -->
                <div class="mai-tab-content" data-tab="logs">
                    <div class="mai-log-toolbar">
                        <button class="mai-btn mai-btn-danger" id="mai_clear_logs">清空日志</button>
                    </div>
                    <div id="mai_log_panel" class="mai-log-panel">
                        <div class="mai-log-empty">暂无日志，发送消息后将显示运行记录</div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

function openModal() {
    const overlay = document.getElementById('mai_modal_overlay');
    if (overlay) {
        syncModalFromSettings();
        overlay.classList.add('active');
    }
}

function closeModal() {
    const overlay = document.getElementById('mai_modal_overlay');
    if (overlay) overlay.classList.remove('active');
}

function syncModalFromSettings() {
    const s = getSettings();
    const url = document.getElementById('mai_m_url');
    const key = document.getElementById('mai_m_key');
    const model = document.getElementById('mai_m_model');
    const autoDetect = document.getElementById('mai_m_auto_detect');
    const autoNpc = document.getElementById('mai_m_auto_npc');

    if (url) url.value = s.agentApiUrl || '';
    if (key) key.value = s.agentApiKey || '';
    if (model) model.value = s.agentModel || '';
    if (autoDetect) autoDetect.checked = s.autoDetectPresence;
    if (autoNpc) autoNpc.checked = s.autoGenerateNPC;

    renderModalCharacters();
    renderModalPrompts();
    renderLogs();
}

function renderModalCharacters() {
    const container = document.getElementById('mai_m_characters');
    if (!container) return;
    const s = getSettings();
    const chars = s.presentCharacters || [];

    if (chars.length === 0) {
        container.innerHTML = '<div class="mai-empty-state">暂无在场角色，开始对话后自动识别</div>';
        return;
    }

    container.innerHTML = chars.map((name, i) => `
        <div class="mai-character-tag">
            <span class="mai-character-name">${name}</span>
            <span class="mai-character-remove" data-index="${i}" title="移除">&times;</span>
        </div>
    `).join('');
}

function renderModalPrompts() {
    const container = document.getElementById('mai_m_prompts');
    if (!container) return;
    const s = getSettings();
    const prompts = s.jailbreakPrompts || [''];

    container.innerHTML = prompts.map((text, i) => `
        <div class="mai-prompt-item">
            <textarea data-index="${i}" rows="3" placeholder="输入提示词内容...">${text}</textarea>
            <span class="mai-prompt-remove" data-index="${i}" title="删除">&times;</span>
        </div>
    `).join('');
}

// === Modal 事件绑定 ===

function bindModalEvents() {
    // Tab 切换
    document.querySelectorAll('.mai-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.mai-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.mai-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.querySelector(`.mai-tab-content[data-tab="${target}"]`)?.classList.add('active');
        });
    });

    // 关闭
    document.getElementById('mai_modal_close')?.addEventListener('click', closeModal);
    document.getElementById('mai_modal_overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'mai_modal_overlay') closeModal();
    });

    // API 设置变更
    document.getElementById('mai_m_url')?.addEventListener('change', (e) => {
        getSettings().agentApiUrl = e.target.value;
        saveSettings();
        initModules();
    });
    document.getElementById('mai_m_key')?.addEventListener('change', (e) => {
        getSettings().agentApiKey = e.target.value;
        saveSettings();
        initModules();
    });
    document.getElementById('mai_m_model')?.addEventListener('change', (e) => {
        getSettings().agentModel = e.target.value;
        saveSettings();
        initModules();
    });

    // 自动化选项
    document.getElementById('mai_m_auto_detect')?.addEventListener('change', (e) => {
        getSettings().autoDetectPresence = e.target.checked;
        saveSettings();
    });
    document.getElementById('mai_m_auto_npc')?.addEventListener('change', (e) => {
        getSettings().autoGenerateNPC = e.target.checked;
        saveSettings();
    });

    // API 测试
    document.getElementById('mai_test_api')?.addEventListener('click', testApiConnection);

    // 角色管理
    document.getElementById('mai_m_add_btn')?.addEventListener('click', addCharacterFromModal);
    document.getElementById('mai_m_add_input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addCharacterFromModal();
    });
    document.getElementById('mai_m_characters')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('mai-character-remove')) {
            const idx = parseInt(e.target.dataset.index);
            const s = getSettings();
            s.presentCharacters.splice(idx, 1);
            saveSettings();
            renderModalCharacters();
            addLog(`移除角色: index=${idx}`, 'info');
        }
    });

    // 提示词管理
    document.getElementById('mai_m_add_prompt')?.addEventListener('click', () => {
        const s = getSettings();
        s.jailbreakPrompts.push('');
        saveSettings();
        renderModalPrompts();
        bindPromptEvents();
    });
    bindPromptEvents();

    // 清空日志
    document.getElementById('mai_clear_logs')?.addEventListener('click', () => {
        logEntries = [];
        renderLogs();
    });
}

function bindPromptEvents() {
    document.querySelectorAll('.mai-prompt-item textarea').forEach(ta => {
        ta.removeEventListener('change', onPromptChange);
        ta.addEventListener('change', onPromptChange);
    });
    document.querySelectorAll('.mai-prompt-remove').forEach(btn => {
        btn.removeEventListener('click', onPromptRemove);
        btn.addEventListener('click', onPromptRemove);
    });
}

function onPromptChange(e) {
    const idx = parseInt(e.target.dataset.index);
    const s = getSettings();
    s.jailbreakPrompts[idx] = e.target.value;
    saveSettings();
    initModules();
}

function onPromptRemove(e) {
    const idx = parseInt(e.target.dataset.index);
    const s = getSettings();
    if (s.jailbreakPrompts.length <= 1) {
        s.jailbreakPrompts = [''];
    } else {
        s.jailbreakPrompts.splice(idx, 1);
    }
    saveSettings();
    renderModalPrompts();
    bindPromptEvents();
    initModules();
}

function addCharacterFromModal() {
    const input = document.getElementById('mai_m_add_input');
    const name = input?.value.trim();
    if (!name) return;

    const s = getSettings();
    if (!s.presentCharacters.includes(name)) {
        s.presentCharacters.push(name);
        if (!s.allKnownCharacters.includes(name)) {
            s.allKnownCharacters.push(name);
        }
        saveSettings();
        renderModalCharacters();
        addLog(`手动添加角色: ${name}`, 'info');
    }
    input.value = '';
}

// === API 测试 ===

async function testApiConnection() {
    const statusEl = document.getElementById('mai_api_status');
    if (!statusEl) return;

    statusEl.className = 'mai-api-status testing';
    statusEl.textContent = '测试中...';

    try {
        const api = new APICaller(getSettings());
        const result = await api.call([
            { role: 'system', content: 'Reply with exactly: OK' },
            { role: 'user', content: 'Test' },
        ], { max_tokens: 10, temperature: 0 });

        statusEl.className = 'mai-api-status success';
        statusEl.textContent = `连接成功: "${result.slice(0, 20)}"`;
        addLog(`API 测试成功: ${result.slice(0, 30)}`, 'success');
    } catch (err) {
        statusEl.className = 'mai-api-status error';
        statusEl.textContent = `失败: ${err.message.slice(0, 50)}`;
        addLog(`API 测试失败: ${err.message}`, 'error');
    }
}

// === 核心流程：生成前拦截 ===

async function onChatCompletionPromptReady(data) {
    const settings = getSettings();

    if (!settings.enabled) return;
    if (data.dryRun) return;

    addLog('=== 开始多Agent处理 ===', 'info');

    try {
        const userInput = extractLastUserInput(data.chat);
        if (!userInput) {
            addLog('未找到用户输入，跳过', 'warn');
            return;
        }
        addLog(`用户输入: ${userInput.slice(0, 50)}...`, 'info');

        addLog('调度器分析中...', 'info');
        const dispatchResult = await dispatcher.analyze(
            userInput,
            settings.presentCharacters,
            settings.allKnownCharacters,
        );
        addLog(`调度结果: 进入=[${dispatchResult.entered.join(',')}] 离开=[${dispatchResult.exited.join(',')}]`, 'info');
        addLog(`需要反应: [${dispatchResult.characters_to_react.join(', ')}]`, 'info');

        updatePresence(dispatchResult, settings);

        if (dispatchResult.characters_to_react.length === 0) {
            addLog('无角色需要反应，跳过', 'warn');
            return;
        }

        const characterRequests = dispatchResult.characters_to_react.map(name => ({
            name,
            characterInfo: getCharacterInfo(name),
            visibleHistory: historyManager.getRecentHistoryForCharacter(name, data.chat, 20),
        }));

        addLog(`并行调用 ${characterRequests.length} 个角色Agent...`, 'info');
        const reactions = await characterAgent.generateReactionsParallel(
            characterRequests,
            userInput,
            dispatchResult.scene_context,
        );

        const successCount = reactions.filter(r => r.success).length;
        addLog(`角色Agent完成: ${successCount}/${reactions.length} 成功`, successCount > 0 ? 'success' : 'warn');

        const reactionData = reactions.map(r => r.reaction);
        const directive = directiveBuilder.build(reactionData);

        if (directive) {
            directiveBuilder.inject(data.chat, directive, settings.injectionPosition);
            addLog('行为指令已注入', 'success');
            addLog(`指令预览: ${directive.slice(0, 80)}...`, 'info');
        }

    } catch (error) {
        console.error('[Multi-Agent Isolation] 处理失败:', error);
        addLog(`处理失败: ${error.message}`, 'error');
    }
}

// === 生成后处理 ===

function onMessageReceived() {
    const settings = getSettings();
    if (!settings.enabled) return;

    const context = getContext();
    if (context.chat && context.chat.length > 0) {
        const lastMsg = context.chat[context.chat.length - 1];
        historyManager.saveToMessage(lastMsg, settings.presentCharacters);
    }
    addLog(`回复已标记在场角色: [${settings.presentCharacters.join(', ')}]`, 'info');
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
    for (const name of dispatchResult.entered) {
        if (!settings.presentCharacters.includes(name)) {
            settings.presentCharacters.push(name);
        }
        if (!settings.allKnownCharacters.includes(name)) {
            settings.allKnownCharacters.push(name);
        }
    }
    for (const name of dispatchResult.exited) {
        const idx = settings.presentCharacters.indexOf(name);
        if (idx !== -1) settings.presentCharacters.splice(idx, 1);
    }
    saveSettings();
    renderModalCharacters();
}

function getCharacterInfo(name) {
    try {
        const context = getContext();
        if (context.groups && context.groupId) {
            const char = context.characters?.find(c => c.name === name);
            if (char) return char.description || char.personality || `角色名：${name}`;
        }
        if (context.characterId !== undefined) {
            const char = context.characters?.[context.characterId];
            if (char && char.name === name) {
                return char.description || char.personality || `角色名：${name}`;
            }
        }
    } catch (e) {}
    return `角色名：${name}`;
}

function updateLaunchBtnState() {
    const btn = document.getElementById('mai_launch_btn');
    if (btn) {
        btn.classList.toggle('mai-active', getSettings().enabled);
    }
}

// === 初始化 ===

jQuery(async () => {
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $('#extensions_settings2').append(settingsHtml);

    // 添加主界面入口图标
    const launchBtn = $(`
        <div id="mai_launch_btn" class="fa-solid fa-users-gear" title="Multi-Agent 信息隔离"></div>
    `);
    $('#extensionsMenu, #top-settings-holder, #form_sheld .range-block-counter').first()
        .before(launchBtn);

    // 如果上面没找到合适位置，尝试其他位置
    if (!document.getElementById('mai_launch_btn')) {
        $('#send_but_sheld').prepend(launchBtn);
    }

    // 注入 Modal HTML
    $('body').append(createModalHTML());

    // 绑定事件
    $('#mai_enabled').on('change', (e) => {
        const settings = getSettings();
        settings.enabled = Boolean($(e.target).prop('checked'));
        saveSettings();
        updateLaunchBtnState();
        addLog(`插件${settings.enabled ? '已启用' : '已禁用'}`, 'info');
    });

    $('#mai_launch_btn').on('click', openModal);
    bindModalEvents();

    // 注册核心事件
    if ('CHAT_COMPLETION_PROMPT_READY' in event_types) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);
        console.log('[Multi-Agent Isolation] CHAT_COMPLETION_PROMPT_READY registered');
    } else {
        console.warn('[Multi-Agent Isolation] CHAT_COMPLETION_PROMPT_READY not available');
        toastr.warning('Multi-Agent Isolation: 需要更新 SillyTavern 到最新版本');
    }

    if ('MESSAGE_RECEIVED' in event_types) {
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    }

    loadSettings();
    updateLaunchBtnState();
    console.log('[Multi-Agent Isolation] v0.3.0 loaded');
});

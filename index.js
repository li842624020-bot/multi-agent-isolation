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
    characterProfiles: {},
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
                    <div class="mai-section-title">在场角色管理</div>
                    <div class="mai-api-test-row" style="margin-bottom:12px;">
                        <button class="mai-btn mai-btn-primary" id="mai_analyze_btn">分析当前对话</button>
                        <span id="mai_analyze_status"></span>
                    </div>
                    <div class="mai-form-hint" style="margin-bottom:12px;">点击"分析当前对话"自动识别角色及其已知信息。也可手动添加角色。</div>
                    <div id="mai_m_characters" class="mai-character-list">
                        <div class="mai-empty-state">暂无在场角色</div>
                    </div>
                    <div class="mai-add-character">
                        <input id="mai_m_add_input" type="text" placeholder="输入角色名..." />
                        <button class="mai-btn" id="mai_m_add_btn">添加</button>
                    </div>

                    <div class="mai-section-title" style="margin-top:20px;">角色信息总览</div>
                    <div id="mai_character_profiles" class="mai-character-profiles">
                        <div class="mai-empty-state">分析对话后将显示每个角色的已知信息摘要</div>
                    </div>
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
    renderCharacterProfiles();
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

    // 对话分析
    document.getElementById('mai_analyze_btn')?.addEventListener('click', analyzeCurrentChat);

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

// === 对话分析 ===

async function analyzeCurrentChat() {
    const statusEl = document.getElementById('mai_analyze_status');
    if (statusEl) {
        statusEl.className = 'mai-api-status testing';
        statusEl.textContent = '分析中...';
    }

    addLog('开始分析当前对话...', 'info');

    try {
        const context = getContext();
        const chat = context.chat || [];

        if (chat.length === 0) {
            if (statusEl) {
                statusEl.className = 'mai-api-status error';
                statusEl.textContent = '当前无对话内容';
            }
            addLog('分析失败：当前无对话内容', 'warn');
            return;
        }

        // 提取最近的对话内容用于分析
        const recentMessages = chat.slice(-30).map(msg => {
            const role = msg.is_user ? '用户' : 'AI';
            return `[${role}]: ${(msg.mes || '').slice(0, 300)}`;
        }).join('\n');

        // 获取角色卡信息
        let charCardInfo = '';
        if (context.characterId !== undefined && context.characters) {
            const char = context.characters[context.characterId];
            if (char) {
                charCardInfo = `当前角色卡: ${char.name}\n设定: ${(char.description || '').slice(0, 500)}`;
            }
        }

        const api = new APICaller(getSettings());
        const analysisPrompt = `分析以下对话内容，识别所有出现的角色（不包括用户本人）。

${charCardInfo}

最近对话:
${recentMessages}

请输出JSON格式：
{
  "characters": [
    {
      "name": "角色名",
      "present": true/false,
      "known_info": "该角色目前已知的信息摘要（其他角色不知道的秘密要标注）",
      "relationship": "与其他角色的关系",
      "last_action": "最近的行为/状态"
    }
  ]
}

规则：
- 只识别对话中实际出现或被提及的角色
- present=true 表示当前在场，false 表示已离场或只是被提及
- known_info 要区分"公开信息"和"私密信息"
- 只输出JSON`;

        const result = await api.callJSON([
            { role: 'system', content: '你是一个对话分析助手，负责从RP对话中提取角色信息。' },
            { role: 'user', content: analysisPrompt },
        ], { temperature: 0.3, max_tokens: 1024 });

        // 更新设置
        const settings = getSettings();
        if (result.characters && Array.isArray(result.characters)) {
            settings.presentCharacters = [];
            settings.characterProfiles = settings.characterProfiles || {};

            for (const char of result.characters) {
                if (char.present) {
                    if (!settings.presentCharacters.includes(char.name)) {
                        settings.presentCharacters.push(char.name);
                    }
                }
                if (!settings.allKnownCharacters.includes(char.name)) {
                    settings.allKnownCharacters.push(char.name);
                }
                settings.characterProfiles[char.name] = {
                    known_info: char.known_info || '',
                    relationship: char.relationship || '',
                    last_action: char.last_action || '',
                    present: char.present,
                    updated_at: new Date().toLocaleString(),
                };
            }

            saveSettings();
            renderModalCharacters();
            renderCharacterProfiles();

            if (statusEl) {
                statusEl.className = 'mai-api-status success';
                statusEl.textContent = `识别到 ${result.characters.length} 个角色`;
            }
            addLog(`分析完成: 识别到 ${result.characters.length} 个角色`, 'success');
        }
    } catch (err) {
        if (statusEl) {
            statusEl.className = 'mai-api-status error';
            statusEl.textContent = `分析失败: ${err.message.slice(0, 40)}`;
        }
        addLog(`对话分析失败: ${err.message}`, 'error');
    }
}

function renderCharacterProfiles() {
    const container = document.getElementById('mai_character_profiles');
    if (!container) return;

    const settings = getSettings();
    const profiles = settings.characterProfiles || {};
    const names = Object.keys(profiles);

    if (names.length === 0) {
        container.innerHTML = '<div class="mai-empty-state">分析对话后将显示每个角色的已知信息摘要</div>';
        return;
    }

    container.innerHTML = names.map(name => {
        const p = profiles[name];
        const statusBadge = p.present
            ? '<span class="mai-badge mai-badge-online">在场</span>'
            : '<span class="mai-badge mai-badge-offline">离场</span>';
        return `
        <div class="mai-profile-card">
            <div class="mai-profile-header">
                <strong>${name}</strong> ${statusBadge}
                <small class="mai-profile-time">${p.updated_at || ''}</small>
            </div>
            <div class="mai-profile-body">
                <div class="mai-profile-row"><b>已知信息:</b> ${p.known_info || '无'}</div>
                <div class="mai-profile-row"><b>关系:</b> ${p.relationship || '无'}</div>
                <div class="mai-profile-row"><b>最近状态:</b> ${p.last_action || '无'}</div>
            </div>
        </div>`;
    }).join('');
}

// === 核心流程：生成前拦截 ===

async function onChatCompletionPromptReady(data) {
    const settings = getSettings();

    if (!settings.enabled) return;
    if (data.dryRun) return;

    addLog('=== 开始多Agent处理 ===', 'info');

    try {
        // 自动从当前对话获取角色
        autoDetectCharacters(settings);

        const userInput = extractLastUserInput(data.chat);
        if (!userInput) {
            addLog('未找到用户输入，跳过', 'warn');
            return;
        }
        addLog(`用户输入: ${userInput.slice(0, 50)}...`, 'info');
        addLog(`当前在场角色: [${settings.presentCharacters.join(', ')}]`, 'info');

        // 如果仍然没有角色，跳过
        if (settings.presentCharacters.length === 0) {
            addLog('未检测到角色，跳过（请在角色Tab中添加角色）', 'warn');
            return;
        }

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
            addLog('调度器判断无角色需要反应，跳过', 'warn');
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
            addLog('行为指令已注入到messages', 'success');
            addLog(`注入内容: ${directive.slice(0, 120)}...`, 'info');
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

function autoDetectCharacters(settings) {
    try {
        const context = getContext();
        // 群聊：获取群组中所有角色
        if (context.groupId && context.groups) {
            const group = context.groups.find(g => g.id === context.groupId);
            if (group && group.members) {
                for (const memberId of group.members) {
                    const char = context.characters?.find(c => c.avatar === memberId || c.name === memberId);
                    const name = char?.name || memberId;
                    if (name && !settings.presentCharacters.includes(name)) {
                        settings.presentCharacters.push(name);
                        addLog(`自动识别群聊角色: ${name}`, 'info');
                    }
                    if (name && !settings.allKnownCharacters.includes(name)) {
                        settings.allKnownCharacters.push(name);
                    }
                }
            }
        }
        // 单聊：获取当前角色卡名称
        else if (context.characterId !== undefined && context.characters) {
            const char = context.characters[context.characterId];
            if (char?.name && !settings.presentCharacters.includes(char.name)) {
                settings.presentCharacters.push(char.name);
                addLog(`自动识别角色: ${char.name}`, 'info');
            }
            if (char?.name && !settings.allKnownCharacters.includes(char.name)) {
                settings.allKnownCharacters.push(char.name);
            }
        }
    } catch (e) {
        addLog(`自动识别角色失败: ${e.message}`, 'warn');
    }
}

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
        // 优先使用 characterProfiles 中的摘要
        const settings = getSettings();
        if (settings.characterProfiles?.[name]) {
            const profile = settings.characterProfiles[name];
            return `角色名：${name}\n已知信息：${profile.known_info || '无'}\n关系：${profile.relationship || '无'}`;
        }
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

// === 初始化 ===

jQuery(async () => {
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $('#extensions_settings2').append(settingsHtml);

    // 注入 Modal HTML
    $('body').append(createModalHTML());

    // 绑定扩展面板事件
    $('#mai_enabled').on('change', (e) => {
        const settings = getSettings();
        settings.enabled = Boolean($(e.target).prop('checked'));
        saveSettings();
        addLog(`插件${settings.enabled ? '已启用' : '已禁用'}`, 'info');
    });

    $('#mai_open_panel_btn').on('click', openModal);
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
    $('#mai_enabled').prop('checked', getSettings().enabled);
    console.log('[Multi-Agent Isolation] v0.4.0 loaded');
});

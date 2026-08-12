class DifyAIClient {
    constructor() {
        this.STORAGE_KEY = 'taskmind_dify_config';
        this.config = this.loadConfig();
        this.loadEnvFile();
    }

    loadConfig() {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved) {
            try { return JSON.parse(saved); } catch (e) { console.error(e); }
        }
        return {
            apiKey: '',
            baseUrl: 'https://api.dify.ai/v1',
            mode: 'auto'
        };
    }

    async loadEnvFile() {
        try {
            const response = await fetch('.env');
            if (response.ok) {
                const text = await response.text();
                const envVars = {};
                text.split('\n').forEach(line => {
                    const clean = line.trim();
                    if (clean && !clean.startsWith('#') && clean.includes('=')) {
                        const parts = clean.split('=');
                        const key = parts[0].trim();
                        const val = parts.slice(1).join('=').trim();
                        envVars[key] = val;
                    }
                });

                if (envVars['DIFY_API_KEY'] && envVars['DIFY_API_KEY'] !== 'app-your_dify_api_key_here') {
                    this.config.apiKey = envVars['DIFY_API_KEY'];
                }
                if (envVars['DIFY_BASE_URL']) {
                    this.config.baseUrl = envVars['DIFY_BASE_URL'];
                }

                this.saveConfig(this.config.apiKey, this.config.baseUrl, this.config.mode);
                if (window.appController) {
                    window.appController.updateDifyStatusUI();
                }
            }
        } catch (e) {
            // Silently fallback if .env cannot be fetched directly in browser
        }
    }

    saveConfig(apiKey, baseUrl, mode) {
        this.config = {
            apiKey: apiKey ? apiKey.trim() : '',
            baseUrl: baseUrl ? baseUrl.trim().replace(/\/$/, '') : 'https://api.dify.ai/v1',
            mode: mode || 'auto'
        };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.config));
    }

    hasApiKey() {
        return Boolean(this.config.apiKey && this.config.apiKey.length > 5 && !this.config.apiKey.includes("your_dify_api_key"));
    }

    async testConnection() {
        if (!this.hasApiKey()) {
            throw new Error("No valid Dify API Key provided. Please update your .env file.");
        }

        const response = await fetch(`${this.config.baseUrl}/parameters`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.config.apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok || response.status === 200) {
            return { success: true, message: "Connected to Dify.ai API successfully!" };
        } else {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || `HTTP ${response.status}: Connection failed`);
        }
    }

    async processPromptWithDify(userPrompt) {
        if (!this.hasApiKey()) throw new Error("Dify API key is missing");

        const endpoint = `${this.config.baseUrl}/chat-messages`;
        const payload = {
            inputs: {},
            query: `Parse request to JSON keys: title, type (exam|task|schedule|note|goal), date (YYYY-MM-DD), time (HH:MM), priority (low|medium|high), notes. Prompt: "${userPrompt}"`,
            response_mode: "blocking",
            user: "taskmind-user"
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            throw new Error(errJson.message || `Dify API error (${response.status})`);
        }

        const data = await response.json();
        const aiAnswer = data.answer || (data.data && data.data.outputs ? JSON.stringify(data.data.outputs) : "");
        return this.extractJSONFromAIResponse(aiAnswer, userPrompt);
    }

    extractJSONFromAIResponse(aiText, originalPrompt) {
        try {
            const jsonMatch = aiText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.title) {
                    return {
                        id: 'item_' + Date.now(),
                        title: parsed.title,
                        type: parsed.type || 'task',
                        date: parsed.date || new Date().toISOString().split('T')[0],
                        time: parsed.time || '09:00',
                        priority: parsed.priority || 'medium',
                        completed: false,
                        notes: parsed.notes || `From prompt: "${originalPrompt}"`,
                        createdAt: new Date().toISOString()
                    };
                }
            }
        } catch (e) {
            console.warn("Could not parse JSON from response", e);
        }

        return {
            id: 'item_' + Date.now(),
            title: originalPrompt.slice(0, 50),
            type: 'task',
            date: new Date().toISOString().split('T')[0],
            time: '10:00',
            priority: 'medium',
            completed: false,
            notes: aiText || `Prompt: ${originalPrompt}`,
            createdAt: new Date().toISOString()
        };
    }
}

class SmartParser {
    static parsePrompt(promptText) {
        if (!promptText || !promptText.trim()) throw new Error("Prompt text cannot be empty");

        const raw = promptText.trim();
        const textLower = raw.toLowerCase();

        let type = 'task';
        if (/\b(exam|test|quiz|midterm|final|viva|assessment)\b/.test(textLower)) {
            type = 'exam';
        } else if (/\b(goal|milestone|target|aim|habit)\b/.test(textLower)) {
            type = 'goal';
        } else if (/\b(note|remember|memo|reflection|thought|formula)\b/.test(textLower)) {
            type = 'note';
        } else if (/\b(schedule|class|lecture|meeting|workout|gym|routine|training)\b/.test(textLower)) {
            type = 'schedule';
        }

        let priority = 'medium';
        if (/\b(urgent|high priority|important|critical|asap|alert|exam)\b/.test(textLower)) {
            priority = 'high';
        } else if (/\b(low priority|casual|whenever|optional)\b/.test(textLower)) {
            priority = 'low';
        }

        let time = '09:00';
        const timeRegex = /\b(at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/i;
        const timeMatch = raw.match(timeRegex);
        if (timeMatch) {
            if (timeMatch[2]) {
                let hours = parseInt(timeMatch[2], 10);
                const minutes = timeMatch[3] ? timeMatch[3] : '00';
                const ampm = timeMatch[4].toLowerCase();
                if (ampm === 'pm' && hours < 12) hours += 12;
                if (ampm === 'am' && hours === 12) hours = 0;
                time = `${hours.toString().padStart(2, '0')}:${minutes}`;
            } else if (timeMatch[5]) {
                time = `${timeMatch[5].padStart(2, '0')}:${timeMatch[6]}`;
            }
        }

        let date = this.extractDate(textLower);
        let cleanTitle = this.generateCleanSummaryTitle(raw, type);

        return {
            id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            title: cleanTitle,
            type: type,
            date: date,
            time: time,
            priority: priority,
            completed: false,
            notes: raw,
            createdAt: new Date().toISOString()
        };
    }

    static generateCleanSummaryTitle(raw, type) {
        const timeRegex = /\b(at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
        const dateRegex = /\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(today|tomorrow|next week|next monday|next tuesday|next wednesday|next thursday|next friday|next saturday|next sunday)\b/gi;

        let clean = raw
            .replace(timeRegex, '')
            .replace(dateRegex, '')
            .replace(/\b(i have my|i have an|i have a|i have|so schedule a task|so schedule a|schedule a task|schedule a|add a to do reminder of|add a to do reminder|add a reminder of|add a reminder|add to do|reminder of|remind me to|remember to|need to|want to|please|for me|so|also|so schedulae a tak and|tak|schedulae)\b/gi, ' ')
            .replace(/\b(and|with|for|on|at|in|of|to|a|an|the)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!clean) {
            clean = raw.split(/\s+/).slice(0, 4).join(' ');
        }

        const words = clean.split(' ').filter(w => w.length > 0);
        let summary = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

        if (summary.length > 28) {
            summary = summary.slice(0, 26) + '...';
        }

        return summary || (type.toUpperCase() + ' Item');
    }

    static extractDate(textLower) {
        const today = new Date();

        if (textLower.includes('tomorrow')) {
            const nextDay = new Date(today);
            nextDay.setDate(today.getDate() + 1);
            return this.formatDateString(nextDay);
        }

        if (textLower.includes('today')) {
            return this.formatDateString(today);
        }

        const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        for (let i = 0; i < daysOfWeek.length; i++) {
            const dayName = daysOfWeek[i];
            if (textLower.includes(dayName)) {
                const targetDayIndex = i;
                const currentDayIndex = today.getDay();
                let daysAhead = targetDayIndex - currentDayIndex;
                if (daysAhead <= 0 || textLower.includes('next ' + dayName)) daysAhead += 7;

                const targetDate = new Date(today);
                targetDate.setDate(today.getDate() + daysAhead);
                return this.formatDateString(targetDate);
            }
        }

        // 1. Day Month (e.g. "14 aug", "14th august", "14th of august")
        const dayMonthRegex = /\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
        const dayMonthMatch = textLower.match(dayMonthRegex);
        if (dayMonthMatch) {
            const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
            const dayNum = parseInt(dayMonthMatch[1], 10);
            const monthIdx = monthNames.findIndex(m => dayMonthMatch[2].startsWith(m));
            if (monthIdx !== -1 && dayNum > 0 && dayNum <= 31) {
                const d = new Date(today.getFullYear(), monthIdx, dayNum);
                return this.formatDateString(d);
            }
        }

        // 2. Month Day (e.g. "aug 14", "august 14th")
        const monthDayRegex = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
        const monthDayMatch = textLower.match(monthDayRegex);
        if (monthDayMatch) {
            const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
            const monthIdx = monthNames.findIndex(m => monthDayMatch[1].startsWith(m));
            const dayNum = parseInt(monthDayMatch[2], 10);
            if (monthIdx !== -1 && dayNum > 0 && dayNum <= 31) {
                const d = new Date(today.getFullYear(), monthIdx, dayNum);
                return this.formatDateString(d);
            }
        }

        return this.formatDateString(today);
    }

    static formatDateString(dateObj) {
        const year = dateObj.getFullYear();
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const day = dateObj.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}

class CalendarManager {
    constructor(appState) {
        this.appState = appState;
        this.currentDate = new Date();
        this.gridElement = document.getElementById('calendar-days-grid');
        this.monthYearLabel = document.getElementById('calendar-month-year');
        this.initControls();
    }

    initControls() {
        document.getElementById('cal-prev-btn')?.addEventListener('click', () => this.changeMonth(-1));
        document.getElementById('cal-next-btn')?.addEventListener('click', () => this.changeMonth(1));
        document.getElementById('cal-today-btn')?.addEventListener('click', () => {
            this.currentDate = new Date();
            this.render();
        });
    }

    changeMonth(delta) {
        this.currentDate.setMonth(this.currentDate.getMonth() + delta);
        this.render();
    }

    render() {
        if (!this.gridElement || !this.monthYearLabel) return;

        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        this.monthYearLabel.textContent = `${monthNames[month]} ${year}`;
        this.gridElement.innerHTML = '';

        const firstDayOfMonth = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrevMonth = new Date(year, month, 0).getDate();
        const todayStr = SmartParser.formatDateString(new Date());

        for (let i = firstDayOfMonth - 1; i >= 0; i--) {
            const dayNum = daysInPrevMonth - i;
            const prevMonthDateStr = SmartParser.formatDateString(new Date(year, month - 1, dayNum));
            this.gridElement.appendChild(this.createDayCell(dayNum, prevMonthDateStr, true, false));
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = SmartParser.formatDateString(new Date(year, month, day));
            const isToday = dateStr === todayStr;
            this.gridElement.appendChild(this.createDayCell(day, dateStr, false, isToday));
        }

        const totalCells = firstDayOfMonth + daysInMonth;
        const remainingCells = (42 - totalCells) % 7 === 0 && totalCells >= 35 ? (42 - totalCells) : (35 - totalCells);
        for (let day = 1; day <= remainingCells; day++) {
            const nextMonthDateStr = SmartParser.formatDateString(new Date(year, month + 1, day));
            this.gridElement.appendChild(this.createDayCell(day, nextMonthDateStr, true, false));
        }
    }

    createDayCell(dayNumber, dateStr, isOtherMonth, isToday) {
        const cell = document.createElement('div');
        cell.className = `cal-day-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}`;
        cell.setAttribute('data-date', dateStr);

        const numberBadge = document.createElement('div');
        numberBadge.className = 'cal-day-num';
        numberBadge.textContent = dayNumber;
        cell.appendChild(numberBadge);

        const eventsContainer = document.createElement('div');
        eventsContainer.className = 'cal-events-container';

        const matchingEvents = this.appState.items.filter(item => item.date === dateStr);
        matchingEvents.forEach(evt => {
            const chip = document.createElement('div');
            chip.className = `cal-event-chip ${evt.type || 'task'}`;
            const displayTitle = evt.title.length > 22 ? evt.title.slice(0, 20) + '...' : evt.title;
            chip.textContent = `${evt.time ? evt.time + ' ' : ''}${displayTitle}`;
            chip.title = `${evt.title} (${evt.type ? evt.type.toUpperCase() : 'TASK'}) - ${evt.time || 'All Day'}\n${evt.notes ? 'Details: ' + evt.notes : ''}`;
            eventsContainer.appendChild(chip);
        });

        cell.appendChild(eventsContainer);
        cell.addEventListener('click', () => {
            if (window.appController) window.appController.openEventModal(dateStr);
        });

        return cell;
    }
}

class TaskManager {
    constructor(appState) {
        this.appState = appState;
    }

    renderTodayReminders() {
        const container = document.getElementById('today-reminders-container');
        if (!container) return;

        const todayStr = SmartParser.formatDateString(new Date());
        const todayItems = this.appState.items.filter(item => item.date === todayStr);

        container.innerHTML = '';

        if (todayItems.length === 0) {
            container.innerHTML = `
                <div class="text-muted" style="text-align: center; padding: 2rem 0; font-size: 0.9rem;">
                    <i class="fa-solid fa-calendar-check" style="font-size: 2rem; color: var(--success); margin-bottom: 0.5rem; display: block;"></i>
                    No tasks scheduled for today!
                </div>
            `;
            return;
        }

        todayItems.sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));

        todayItems.forEach(item => {
            const el = document.createElement('div');
            el.className = `reminder-item ${item.type || 'task'} ${item.completed ? 'completed' : ''}`;
            
            el.innerHTML = `
                <div class="reminder-time">${item.time || 'All Day'}</div>
                <div class="reminder-info">
                    <div class="reminder-title" style="${item.completed ? 'text-decoration: line-through; opacity: 0.6;' : ''}">
                        ${item.title}
                    </div>
                    <div class="reminder-meta">
                        <span><i class="fa-solid fa-tag"></i> ${item.type.toUpperCase()}</span>
                        <span><i class="fa-solid fa-flag"></i> ${item.priority.toUpperCase()}</span>
                    </div>
                </div>
                <div class="custom-checkbox ${item.completed ? 'checked' : ''}" data-id="${item.id}">
                    <i class="fa-solid fa-check" style="font-size: 0.75rem;"></i>
                </div>
            `;

            el.querySelector('.custom-checkbox').addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleTaskCompleted(item.id);
            });

            container.appendChild(el);
        });
    }

    renderDashboardTodoWidget() {
        const container = document.getElementById('dashboard-todo-container');
        if (!container) return;

        const pendingItems = this.appState.items.filter(item => !item.completed).slice(0, 5);
        container.innerHTML = '';

        if (pendingItems.length === 0) {
            container.innerHTML = `<div class="text-muted" style="text-align: center; padding: 1.5rem 0; font-size: 0.85rem;">All caught up! 🎉</div>`;
            return;
        }

        pendingItems.forEach(item => {
            const row = document.createElement('div');
            row.className = 'todo-item';
            row.innerHTML = `
                <div class="custom-checkbox" data-id="${item.id}"><i class="fa-solid fa-check" style="font-size: 0.7rem;"></i></div>
                <span class="todo-text">${item.title}</span>
                <span class="tag-badge tag-${item.type}">${item.type}</span>
            `;

            row.querySelector('.custom-checkbox').addEventListener('click', () => this.toggleTaskCompleted(item.id));
            container.appendChild(row);
        });
    }

    renderFullTaskList(activeFilter = 'all', searchQuery = '') {
        const container = document.getElementById('tasks-full-list');
        if (!container) return;

        let filtered = [...this.appState.items];
        if (activeFilter === 'completed') {
            filtered = filtered.filter(i => i.completed);
        } else if (activeFilter !== 'all') {
            filtered = filtered.filter(i => i.type === activeFilter);
        }

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(i => i.title.toLowerCase().includes(q) || (i.notes && i.notes.toLowerCase().includes(q)));
        }

        container.innerHTML = '';

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="dash-card" style="text-align: center; padding: 3rem 1rem;">
                    <i class="fa-solid fa-box-open" style="font-size: 2.5rem; color: var(--text-dim); margin-bottom: 0.5rem; display: block;"></i>
                    <p class="text-muted">No tasks match your filters.</p>
                </div>
            `;
            return;
        }

        filtered.forEach(item => {
            const card = document.createElement('div');
            card.className = `task-card-full ${item.completed ? 'completed' : ''}`;
            card.innerHTML = `
                <div class="task-left-sec">
                    <div class="custom-checkbox ${item.completed ? 'checked' : ''}" data-id="${item.id}">
                        <i class="fa-solid fa-check" style="font-size: 0.75rem;"></i>
                    </div>
                    <div class="task-main-details">
                        <h4 style="${item.completed ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${item.title}</h4>
                        <div class="task-meta-tags">
                            <span><i class="fa-regular fa-calendar"></i> ${item.date} ${item.time ? 'at ' + item.time : ''}</span>
                            <span><i class="fa-solid fa-tag"></i> ${item.type.toUpperCase()}</span>
                        </div>
                    </div>
                </div>

                <div class="task-actions-sec">
                    <span class="priority-badge priority-${item.priority}">${item.priority.toUpperCase()}</span>
                    <button class="icon-btn delete-task-btn" data-id="${item.id}" title="Delete Task">
                        <i class="fa-solid fa-trash-can" style="color: var(--danger); font-size: 0.85rem;"></i>
                    </button>
                </div>
            `;

            card.querySelector('.custom-checkbox').addEventListener('click', () => this.toggleTaskCompleted(item.id));
            card.querySelector('.delete-task-btn').addEventListener('click', () => this.deleteTask(item.id));
            container.appendChild(card);
        });

        this.updateFilterCounts();
    }

    updateFilterCounts() {
        const counts = {
            exam: this.appState.items.filter(i => i.type === 'exam').length,
            task: this.appState.items.filter(i => i.type === 'task').length,
            schedule: this.appState.items.filter(i => i.type === 'schedule').length,
            completed: this.appState.items.filter(i => i.completed).length
        };

        for (const [key, val] of Object.entries(counts)) {
            const badge = document.getElementById(`count-${key}`);
            if (badge) badge.textContent = val;
        }
    }

    toggleTaskCompleted(id) {
        const target = this.appState.items.find(i => i.id === id);
        if (target) {
            target.completed = !target.completed;
            if (target.completed && window.appController) {
                window.appController.showToast(`Completed: "${target.title}"`, 'success');
            }
            this.appState.saveData();
            if (window.appController) window.appController.refreshAllViews();
        }
    }

    deleteTask(id) {
        this.appState.items = this.appState.items.filter(i => i.id !== id);
        this.appState.saveData();
        if (window.appController) {
            window.appController.showToast("Item deleted", 'info');
            window.appController.refreshAllViews();
        }
    }
}

class GoalManager {
    constructor(appState) {
        this.appState = appState;
    }

    renderDashboardGoalsWidget() {
        const container = document.getElementById('dashboard-goals-container');
        if (!container) return;

        container.innerHTML = '';
        if (this.appState.goals.length === 0) {
            container.innerHTML = `<div class="text-muted" style="text-align: center; padding: 1rem 0; font-size: 0.85rem;">No active goals set.</div>`;
            return;
        }

        this.appState.goals.slice(0, 3).forEach(goal => {
            const pct = Math.min(100, Math.round((goal.current / goal.target) * 100));
            const item = document.createElement('div');
            item.className = 'mini-goal-item';
            item.innerHTML = `
                <div class="goal-info-top">
                    <span>${goal.title}</span>
                    <span class="color-accent">${pct}% (${goal.current}/${goal.target})</span>
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${pct}%;"></div>
                </div>
            `;
            container.appendChild(item);
        });
    }

    renderFullGoalsView() {
        const grid = document.getElementById('goals-main-grid');
        const completedLogContainer = document.getElementById('completed-log-container');

        if (grid) {
            grid.innerHTML = '';
            if (this.appState.goals.length === 0) {
                grid.innerHTML = `
                    <div class="dash-card" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
                        <i class="fa-solid fa-trophy" style="font-size: 3rem; color: var(--warning); margin-bottom: 0.75rem; display: block;"></i>
                        <h3>No Goals Yet</h3>
                        <p class="text-muted">Set ambitious milestones and track your progress!</p>
                    </div>
                `;
            } else {
                this.appState.goals.forEach(goal => {
                    const pct = Math.min(100, Math.round((goal.current / goal.target) * 100));
                    const isCompleted = goal.current >= goal.target;

                    const card = document.createElement('div');
                    card.className = 'goal-card';
                    card.innerHTML = `
                        <div class="goal-card-header">
                            <div>
                                <div class="goal-card-title">${goal.title}</div>
                                <span class="goal-category-badge">${goal.category || 'Personal'}</span>
                            </div>
                            <span class="badge ${isCompleted ? 'badge-accent' : ''}" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">
                                ${isCompleted ? '🏆 ACHIEVED' : 'IN PROGRESS'}
                            </span>
                        </div>

                        <div class="goal-progress-wrap">
                            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 700;">
                                <span>Progress</span>
                                <span>${pct}% (${goal.current}/${goal.target})</span>
                            </div>
                            <div class="progress-bar-bg">
                                <div class="progress-bar-fill" style="width: ${pct}%;"></div>
                            </div>
                        </div>

                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
                            <span style="font-size: 0.78rem; color: var(--text-muted);">${goal.deadline ? 'Deadline: ' + goal.deadline : 'Continuous'}</span>
                            <button class="btn btn-secondary btn-sm increment-goal-btn" data-id="${goal.id}" ${isCompleted ? 'disabled' : ''}>
                                <i class="fa-solid fa-plus"></i> +1 Progress
                            </button>
                        </div>
                    `;

                    card.querySelector('.increment-goal-btn')?.addEventListener('click', () => this.incrementGoalProgress(goal.id));
                    grid.appendChild(card);
                });
            }
        }

        if (completedLogContainer) {
            completedLogContainer.innerHTML = '';
            const completedItems = this.appState.items.filter(i => i.completed);
            if (completedItems.length === 0) {
                completedLogContainer.innerHTML = `<div class="text-muted" style="padding: 1rem 0; font-size: 0.85rem;">No completed tasks in history log.</div>`;
            } else {
                completedItems.forEach(item => {
                    const row = document.createElement('div');
                    row.className = 'completed-log-item';
                    row.innerHTML = `
                        <span><i class="fa-solid fa-circle-check" style="color: var(--success); margin-right: 0.5rem;"></i> ${item.title}</span>
                        <span class="text-muted" style="font-size: 0.78rem;">${item.date} (${item.type.toUpperCase()})</span>
                    `;
                    completedLogContainer.appendChild(row);
                });
            }
        }
    }

    incrementGoalProgress(goalId) {
        const goal = this.appState.goals.find(g => g.id === goalId);
        if (goal && goal.current < goal.target) {
            goal.current += 1;
            if (goal.current >= goal.target && window.appController) {
                window.appController.showToast(`🎉 Achieved goal: "${goal.title}"`, 'success');
            }
            this.appState.saveData();
            if (window.appController) window.appController.refreshAllViews();
        }
    }
}

class NoteManager {
    constructor(appState) {
        this.appState = appState;
        this.selectedDate = SmartParser.formatDateString(new Date());
    }

    initQuickNoteWidget() {
        const textarea = document.getElementById('quick-daily-note');
        const tag = document.getElementById('quick-note-saved-tag');
        if (!textarea) return;

        const todayStr = SmartParser.formatDateString(new Date());
        const existingNote = this.appState.notes[todayStr] || { content: '', mood: '🎯 Focused' };
        textarea.value = existingNote.content;

        let autoSaveTimer;
        textarea.addEventListener('input', () => {
            if (tag) tag.textContent = 'Saving...';
            clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(() => {
                this.saveJournalEntry(todayStr, textarea.value, existingNote.mood);
                if (tag) tag.textContent = 'Saved';
            }, 800);
        });
    }

    renderFullJournalView() {
        const datesContainer = document.getElementById('journal-dates-container');
        const textarea = document.getElementById('journal-content-textarea');
        const titleEl = document.getElementById('journal-selected-date-title');
        const moodSelect = document.getElementById('journal-mood-select');

        if (!datesContainer || !textarea) return;

        datesContainer.innerHTML = '';
        const todayStr = SmartParser.formatDateString(new Date());
        if (!this.appState.notes[todayStr]) {
            this.appState.notes[todayStr] = { content: '', mood: '🎯 Focused' };
        }

        const dateKeys = Object.keys(this.appState.notes).sort().reverse();
        dateKeys.forEach(dStr => {
            const btn = document.createElement('button');
            btn.className = `journal-date-btn ${dStr === this.selectedDate ? 'active' : ''}`;
            btn.textContent = dStr === todayStr ? `Today (${dStr})` : dStr;
            btn.addEventListener('click', () => {
                this.selectedDate = dStr;
                this.renderFullJournalView();
            });
            datesContainer.appendChild(btn);
        });

        const activeEntry = this.appState.notes[this.selectedDate] || { content: '', mood: '🎯 Focused' };
        if (titleEl) titleEl.textContent = `Diary Entry for ${this.selectedDate}`;
        textarea.value = activeEntry.content || '';
        if (moodSelect) moodSelect.value = activeEntry.mood || '🎯 Focused';

        textarea.oninput = () => {
            const saveMsg = document.getElementById('journal-save-msg');
            if (saveMsg) saveMsg.textContent = 'Saving...';
            this.saveJournalEntry(this.selectedDate, textarea.value, moodSelect.value);
            setTimeout(() => { if (saveMsg) saveMsg.textContent = 'Saved'; }, 600);
        };

        moodSelect.onchange = () => this.saveJournalEntry(this.selectedDate, textarea.value, moodSelect.value);

        document.getElementById('save-journal-btn')?.addEventListener('click', () => {
            this.saveJournalEntry(this.selectedDate, textarea.value, moodSelect.value);
            if (window.appController) window.appController.showToast(`Diary saved for ${this.selectedDate}`, 'success');
        });

        document.getElementById('new-journal-entry-btn')?.addEventListener('click', () => {
            this.selectedDate = todayStr;
            this.renderFullJournalView();
        });
    }

    saveJournalEntry(dateStr, content, mood) {
        this.appState.notes[dateStr] = { content: content, mood: mood, updatedAt: new Date().toISOString() };
        this.appState.saveData();
    }
}

class AppState {
    constructor() {
        this.STORAGE_KEY_ITEMS = 'taskmind_items_v2';
        this.STORAGE_KEY_GOALS = 'taskmind_goals_v2';
        this.STORAGE_KEY_NOTES = 'taskmind_notes_v2';

        this.items = this.loadJSON(this.STORAGE_KEY_ITEMS, []);
        this.goals = this.loadJSON(this.STORAGE_KEY_GOALS, []);
        this.notes = this.loadJSON(this.STORAGE_KEY_NOTES, {});
    }

    loadJSON(key, fallback) {
        const val = localStorage.getItem(key);
        if (val) {
            try { return JSON.parse(val); } catch (e) { console.error(e); }
        }
        return fallback;
    }

    saveData() {
        localStorage.setItem(this.STORAGE_KEY_ITEMS, JSON.stringify(this.items));
        localStorage.setItem(this.STORAGE_KEY_GOALS, JSON.stringify(this.goals));
        localStorage.setItem(this.STORAGE_KEY_NOTES, JSON.stringify(this.notes));
    }
}


class AppController {
    constructor() {
        this.state = new AppState();
        window.difyClient = new DifyAIClient();

        this.calendarManager = new CalendarManager(this.state);
        this.taskManager = new TaskManager(this.state);
        this.goalManager = new GoalManager(this.state);
        this.noteManager = new NoteManager(this.state);

        this.initUI();
    }

    initUI() {
        this.initNavigation();
        this.initAIInputForm();
        this.initModals();
        this.initThemeToggle();
        this.updateDateDisplay();
        this.refreshAllViews();
    }

    updateDateDisplay() {
        const dateEl = document.getElementById('current-date-text');
        if (dateEl) {
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            dateEl.textContent = new Date().toLocaleDateString(undefined, options);
        }
    }

    initNavigation() {
        const navButtons = document.querySelectorAll('.nav-item');
        const views = document.querySelectorAll('.content-view');
        const pageTitle = document.getElementById('page-title');

        navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetView = btn.getAttribute('data-view');
                navButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                views.forEach(v => {
                    if (v.id === `view-${targetView}`) v.classList.add('active');
                    else v.classList.remove('active');
                });

                const titles = {
                    dashboard: 'Dashboard Overview',
                    calendar: 'Interactive Calendar',
                    tasks: 'To-Do List & Tasks',
                    goals: 'Achieved Goals & Streaks',
                    notes: 'Daily Diary & Reflections'
                };
                if (pageTitle) pageTitle.textContent = titles[targetView] || 'TaskMind';
                this.refreshAllViews();
            });
        });

        document.getElementById('view-all-tasks-btn')?.addEventListener('click', () => {
            document.querySelector('.nav-item[data-view="tasks"]')?.click();
        });
    }

    initAIInputForm() {
        const form = document.getElementById('ai-schedule-form');
        const input = document.getElementById('ai-prompt-input');

        document.querySelectorAll('.preset-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const prompt = chip.getAttribute('data-prompt');
                if (input) input.value = prompt;
                this.processAIPrompt(prompt);
            });
        });

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const prompt = input.value.trim();
                if (!prompt) return;
                await this.processAIPrompt(prompt);
                input.value = '';
            });
        }
    }

    async processAIPrompt(promptText) {
        const submitBtn = document.getElementById('ai-submit-btn');
        if (submitBtn) submitBtn.disabled = true;

        try {
            this.showToast("Scheduling your request...", "info");
            let scheduledItem = null;
            const mode = window.difyClient.config.mode;

            if ((mode === 'auto' || mode === 'dify') && window.difyClient.hasApiKey()) {
                try {
                    scheduledItem = await window.difyClient.processPromptWithDify(promptText);
                    this.showToast("Parsed via Dify.ai API!", "success");
                } catch (difyErr) {
                    console.warn("Dify API error, fallback to local parser", difyErr);
                    scheduledItem = SmartParser.parsePrompt(promptText);
                    this.showToast("Dify offline, parsed locally!", "info");
                }
            } else {
                scheduledItem = SmartParser.parsePrompt(promptText);
            }
            if (scheduledItem) {
                if (scheduledItem.type === 'goal') {
                    const newGoal = {
                        id: 'goal_' + Date.now(),
                        title: scheduledItem.title,
                        target: 10,
                        current: 0,
                        category: 'Personal',
                        deadline: scheduledItem.date
                    };
                    this.state.goals.unshift(newGoal);
                    this.showToast(`🎯 Goal added to Goals Section: "${newGoal.title}"`, "success");
                } else if (scheduledItem.type === 'note') {
                    const existing = this.state.notes[scheduledItem.date] || {};
                    const newContent = existing.content
                        ? `${existing.content}\n• ${scheduledItem.title}`
                        : scheduledItem.title;
                    this.state.notes[scheduledItem.date] = {
                        content: newContent,
                        mood: existing.mood || "🎯 Focused",
                        updatedAt: new Date().toISOString()
                    };
                    this.showToast(`📝 Note added to Daily Diary for ${scheduledItem.date}`, "success");
                } else {
                    this.state.items.unshift(scheduledItem);
                    const categoryLabel = scheduledItem.type === 'exam' ? '🎓 Exam' : scheduledItem.type === 'schedule' ? '📅 Schedule' : '📌 To-Do Task';
                    this.showToast(`Added ${categoryLabel}: "${scheduledItem.title}"`, "success");
                }

                this.state.saveData();
                this.refreshAllViews();
            }
        } catch (error) {
            console.error(error);
            this.showToast("Error processing prompt: " + error.message, "error");
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    initModals() {
        const difyModal = document.getElementById('dify-modal');

        document.getElementById('close-dify-modal-btn')?.addEventListener('click', () => difyModal.classList.remove('active'));

        document.getElementById('save-dify-btn')?.addEventListener('click', () => {
            const apiKey = document.getElementById('dify-api-key').value;
            const baseUrl = document.getElementById('dify-base-url').value;
            const mode = document.getElementById('dify-mode-select').value;
            window.difyClient.saveConfig(apiKey, baseUrl, mode);
            this.updateDifyStatusUI();
            difyModal.classList.remove('active');
            this.showToast("Settings saved", "success");
        });

        document.getElementById('test-dify-btn')?.addEventListener('click', async () => {
            const apiKey = document.getElementById('dify-api-key').value;
            const baseUrl = document.getElementById('dify-base-url').value;
            window.difyClient.saveConfig(apiKey, baseUrl, 'auto');
            try {
                const res = await window.difyClient.testConnection();
                this.showToast(res.message, res.success ? "success" : "info");
            } catch (err) {
                this.showToast("Connection failed: " + err.message, "error");
            }
        });

        const eventModal = document.getElementById('event-modal');
        document.getElementById('open-quick-add-btn')?.addEventListener('click', () => this.openEventModal());
        document.getElementById('close-event-modal-btn')?.addEventListener('click', () => eventModal.classList.remove('active'));
        document.getElementById('cancel-event-btn')?.addEventListener('click', () => eventModal.classList.remove('active'));

        document.getElementById('manual-event-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const newItem = {
                id: 'item_' + Date.now(),
                title: document.getElementById('event-title').value.trim(),
                type: document.getElementById('event-type').value,
                priority: document.getElementById('event-priority').value,
                date: document.getElementById('event-date').value,
                time: document.getElementById('event-time').value,
                notes: document.getElementById('event-notes').value.trim(),
                completed: false,
                createdAt: new Date().toISOString()
            };

            this.state.items.unshift(newItem);
            this.state.saveData();
            eventModal.classList.remove('active');
            this.showToast(`Saved "${newItem.title}"`, 'success');
            this.refreshAllViews();
        });

        const goalModal = document.getElementById('goal-modal');
        document.getElementById('add-new-goal-btn')?.addEventListener('click', () => goalModal.classList.add('active'));
        document.getElementById('close-goal-modal-btn')?.addEventListener('click', () => goalModal.classList.remove('active'));
        document.getElementById('cancel-goal-btn')?.addEventListener('click', () => goalModal.classList.remove('active'));

        document.getElementById('new-goal-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const newGoal = {
                id: 'goal_' + Date.now(),
                title: document.getElementById('goal-title').value.trim(),
                target: parseInt(document.getElementById('goal-target').value, 10) || 10,
                current: 0,
                category: document.getElementById('goal-category').value,
                deadline: document.getElementById('goal-deadline').value
            };

            this.state.goals.unshift(newGoal);
            this.state.saveData();
            goalModal.classList.remove('active');
            this.showToast(`New Goal created: "${newGoal.title}"`, 'success');
            this.refreshAllViews();
        });
    }

    openEventModal(selectedDateStr = null) {
        const modal = document.getElementById('event-modal');
        const dateInput = document.getElementById('event-date');
        const titleInput = document.getElementById('event-title');
        if (titleInput) titleInput.value = '';
        if (dateInput) dateInput.value = selectedDateStr || SmartParser.formatDateString(new Date());
        modal.classList.add('active');
    }

    initThemeToggle() {
        const themeBtn = document.getElementById('theme-toggle-btn');
        const savedTheme = localStorage.getItem('taskmind_theme') || 'dark';

        if (savedTheme === 'light') {
            document.body.classList.add('light-theme');
            if (themeBtn) themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
        }

        themeBtn?.addEventListener('click', () => {
            const isLight = document.body.classList.toggle('light-theme');
            localStorage.setItem('taskmind_theme', isLight ? 'light' : 'dark');
            themeBtn.innerHTML = isLight ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
        });
    }

    updateDifyStatusUI() {
        // Safe placeholder for status updates
    }

    refreshAllViews() {
        this.updateDashboardStats();
        this.taskManager.renderTodayReminders();
        this.taskManager.renderDashboardTodoWidget();
        this.calendarManager.render();
        this.taskManager.renderFullTaskList();
        this.goalManager.renderDashboardGoalsWidget();
        this.goalManager.renderFullGoalsView();
        this.noteManager.initQuickNoteWidget();
        this.noteManager.renderFullJournalView();
    }

    updateDashboardStats() {
        const todayStr = SmartParser.formatDateString(new Date());
        const todayItems = this.state.items.filter(i => i.date === todayStr);

        const todayDone = todayItems.filter(i => i.completed).length;
        const totalPending = this.state.items.filter(i => !i.completed).length;
        const upcomingExams = this.state.items.filter(i => i.type === 'exam' && !i.completed).length;

        const countToday = document.getElementById('today-task-count');
        const elDone = document.getElementById('stat-completed-today');
        const elPending = document.getElementById('stat-pending');
        const elExams = document.getElementById('stat-upcoming-exams');

        if (countToday) countToday.textContent = `${todayItems.length} items`;
        if (elDone) elDone.textContent = todayDone;
        if (elPending) elPending.textContent = totalPending;
        if (elExams) elExams.textContent = upcomingExams;
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const iconMap = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };

        toast.innerHTML = `<i class="fa-solid ${iconMap[type] || 'fa-bell'}"></i><span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(40px)';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.appController = new AppController();
});

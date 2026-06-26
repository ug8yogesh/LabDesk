// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let currentUser = null;
let selectedFaultType = null;
let assignFaultId = null;
let completingTaskId = null;
let feedbackFaultId = null;
let selectedRating = 0;
let allMyFaults = [];
let allSolutions = [];
// Resolution page state
let resCurrentSolutionId = null;
let resStepsDone = {};   // { solutionId: Set of done step indices }
let showAllMode = false;
let pendingReportData = null; // stores form data when going to resolution

// ═══════════════════════════════════════════
// API HELPER
// ═══════════════════════════════════════════
async function api(method, url, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
    if (body) opts.body = JSON.stringify(body);
    try {
        const r = await fetch(url, opts);
        const text = await r.text();
        try {
            return JSON.parse(text);
        } catch {
            return { error: `Server error (${r.status})` };
        }
    } catch (e) {
        return { error: 'Network error. Please check your connection.' };
    }
}

// ═══════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════
function toast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3200);
}

// ═══════════════════════════════════════════
// MOBILE SIDEBAR
// ═══════════════════════════════════════════
function openSidebar(id) {
    document.getElementById(id).classList.add('open');
    document.querySelectorAll('.sidebar-overlay').forEach(o => o.classList.add('show'));
}
function closeSidebar() {
    document.querySelectorAll('.sidebar').forEach(s => s.classList.remove('open'));
    document.querySelectorAll('.sidebar-overlay').forEach(o => o.classList.remove('show'));
}

// ═══════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════
function switchAuthTab(tab, el) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
    document.getElementById('forgot-form').style.display = 'none';
    document.getElementById('auth-alert').innerHTML = '';
}

// ═══════════════════════════════════════════
// PASSWORD VALIDATION
// ═══════════════════════════════════════════
const COMMON_PASSWORDS = [
    'password', '12345678', '123456789', 'password1', 'iloveyou',
    'admin123', 'welcome1', 'monkey123', 'dragon12', 'master12',
    'letmein1', 'sunshine', 'princess', 'football', 'qwerty123'
];

function validatePassword(password, name = '', studentId = '') {
    if (password !== password.trim()) {
        return { valid: false, errors: ['Password must not start or end with a space.'] };
    }
    const pw = password.trim();
    if (pw.length < 8 || pw.length > 10) {
        return { valid: false, errors: ['Password must be between 8 and 10 characters long.'] };
    }
    if (!/[A-Z]/.test(pw)) {
        return { valid: false, errors: ['Add at least one uppercase letter'] };
    }
    if (!/[a-z]/.test(pw)) {
        return { valid: false, errors: ['Add at least one lowercase letter'] };
    }
    if (!/[0-9]/.test(pw)) {
        return { valid: false, errors: ['Add at least one number'] };
    }
    if (!/[@#$%&*!^()_\-+=\[\]{};:'",.<>?/\\|`~]/.test(pw)) {
        return { valid: false, errors: ['Add at least one special character'] };
    }
    if (COMMON_PASSWORDS.includes(pw.toLowerCase())) {
        return { valid: false, errors: ['Password is too common'] };
    }
    const lowerPw = pw.toLowerCase();
    const nameParts = name.toLowerCase().split(/\s+/).filter(p => p.length > 2);
    for (const part of nameParts) {
        if (lowerPw.includes(part)) {
            return { valid: false, errors: ['Password must not contain your name'] };
        }
    }
    if (studentId && lowerPw.includes(studentId.toLowerCase())) {
        return { valid: false, errors: ['Password must not contain your Student ID'] };
    }
    if (/(.)\1{2,}/.test(pw)) {
        return { valid: false, errors: ['No more than 2 repeated characters'] };
    }
    return { valid: true };
}

async function doLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) { showAlert('auth-alert', 'Please enter email and password.', 'error'); return; }
    const btn = document.getElementById('login-btn');
    btn.innerHTML = '<span class="spinner"></span> Signing in...';
    btn.disabled = true;
    const res = await api('POST', '/api/auth/login', { email, password });
    btn.innerHTML = 'Sign In →'; btn.disabled = false;
    if (res.error) { showAlert('auth-alert', res.error, 'error'); return; }
    currentUser = res.user;
    loadDashboard();
}

async function doRegister() {
    const name = document.getElementById('reg-name').value.trim();
    const student_id = document.getElementById('reg-sid').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-pass').value;
    const confirmPassword = document.getElementById('reg-confirm-pass').value;
    const confirmError = document.getElementById('confirm-password-error');

    if (!name || !student_id || !email || !password) {
        showAlert('auth-alert', 'All fields are required.', 'error'); return;
    }

    const result = validatePassword(password, name, student_id);
    const passwordError = document.getElementById('password-error');

    if (!result.valid) {
        passwordError.textContent = result.errors[0];
        return;
    } else {
        passwordError.textContent = '';
    }
    if (password !== confirmPassword) {
        confirmError.textContent = "Passwords do not match";
        return;
    } else {
        confirmError.textContent = "";
    }
    const res = await api('POST', '/api/auth/register', { name, email, password, student_id });
    if (res.error) { showAlert('auth-alert', res.error, 'error'); return; }
    showAlert('auth-alert', '✅ Account created! Please sign in.', 'success');
    document.querySelectorAll('.auth-tab')[0].click();
}

async function doLogout() {
    await api('POST', '/api/auth/logout');
    currentUser = null; selectedFaultType = null;
    showPage('page-auth');
    toast('Signed out successfully.', 'info');
}

// ── Forgot Password ──
function showForgotPassword() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('forgot-form').style.display = 'block';
}

function backToLogin() {
    document.getElementById('forgot-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
}

async function sendResetLink() {
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) {
        showAlert('auth-alert', 'Please enter your email.', 'error');
        return;
    }
    const res = await api('POST', '/api/auth/forgot-password', { email });
    if (res.error) {
        showAlert('auth-alert', res.error, 'error');
    } else {
        showAlert('auth-alert', '✅ Reset link sent! Check terminal/email.', 'success');
    }
}

function loadDashboard() {
    if (currentUser.role === 'student') {
        document.getElementById('student-name').textContent = currentUser.name;
        document.getElementById('student-avatar').textContent = currentUser.name[0].toUpperCase();
        showPage('page-student');
        showStudentView('dashboard', document.querySelector('#student-sidebar .nav-item'));
        loadStudentDashboard();
    } else if (currentUser.role === 'admin') {
        showPage('page-admin');
        loadAdminDashboard();
    } else if (currentUser.role === 'technician') {
        document.getElementById('tech-name').textContent = currentUser.name;
        showPage('page-technician');
        loadTechTasks();
    }
    loadNotifications();
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function showStudentView(v, navEl) {
    ['dashboard', 'report', 'myreports', 'solutions', 'resolution'].forEach(id => {
        const el = document.getElementById('sv-' + id);
        if (el) el.style.display = id === v ? 'block' : 'none';
    });
    document.querySelectorAll('#page-student .nav-item').forEach(n => n.classList.remove('active'));
    if (navEl) navEl.classList.add('active');
    const titles = { dashboard: 'Dashboard', report: 'Report a Fault', myreports: 'My Reports', solutions: 'Self-Help Solutions', resolution: 'Find a Resolution' };
    document.getElementById('student-view-title').textContent = titles[v] || v;
    if (v === 'myreports') loadMyFaults();
    if (v === 'solutions') loadSolutions();
    if (v === 'dashboard') loadStudentDashboard();
    if (v === 'resolution') loadResolutionPage();
    closeSidebar();
}

function showAdminView(v, navEl) {
    ['dashboard', 'faults', 'technicians', 'feedback', 'solutions', 'dbviewer'].forEach(id => {
        document.getElementById('av-' + id).style.display = id === v ? 'block' : 'none';
    });
    document.querySelectorAll('#page-admin .nav-item').forEach(n => n.classList.remove('active'));
    if (navEl) navEl.classList.add('active');
    const titles = { dashboard: 'Dashboard', faults: 'All Fault Reports', technicians: 'Technicians', feedback: 'Student Feedback', solutions: 'Solutions Manager', dbviewer: 'Database Viewer' };
    document.getElementById('admin-view-title').textContent = titles[v];
    document.getElementById('export-btn').style.display = v === 'faults' ? 'flex' : 'none';
    if (v === 'dashboard') loadAdminDashboard();
    if (v === 'faults') loadAllFaults();
    if (v === 'technicians') loadTechniciansList();
    if (v === 'feedback') loadFeedback();
    if (v === 'solutions') loadAdminSolutions();
    if (v === 'dbviewer') showDbTable('users', document.querySelector('#db-tabs .btn'));
    closeSidebar();
}

function showTechView(v, navEl) {
    ['tasks', 'history'].forEach(id => {
        document.getElementById('tv-' + id).style.display = id === v ? 'block' : 'none';
    });
    document.querySelectorAll('#page-technician .nav-item').forEach(n => n.classList.remove('active'));
    if (navEl) navEl.classList.add('active');
    const titles = { tasks: 'My Tasks', history: 'Work History' };
    document.getElementById('tech-view-title').textContent = titles[v];
    if (v === 'tasks') loadTechTasks();
    if (v === 'history') loadTechHistory();
    closeSidebar();
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function statusBadge(s) { return `<span class="badge badge-${s}">${s.replace('_', ' ')}</span>`; }
function fmtDate(d) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

function parseSteps(steps) {
    if (Array.isArray(steps)) return steps;
    try { return JSON.parse(steps); } catch { return []; }
}

// ═══════════════════════════════════════════
// STUDENT DASHBOARD
// ═══════════════════════════════════════════
async function loadStudentDashboard() {
    const faults = await api('GET', '/api/faults/my');
    if (faults.error) return;
    const open = faults.filter(f => ['open', 'assigned', 'in_progress'].includes(f.status)).length;
    const resolved = faults.filter(f => ['resolved', 'closed'].includes(f.status)).length;
    document.getElementById('student-stats').innerHTML = `
        <div class="stat-card accent"><div class="stat-icon">📋</div><div class="stat-label">Total Reports</div><div class="stat-value">${faults.length}</div><div class="stat-sub">All time</div></div>
        <div class="stat-card red"><div class="stat-icon">🔴</div><div class="stat-label">Active</div><div class="stat-value">${open}</div><div class="stat-sub">In progress</div></div>
        <div class="stat-card green"><div class="stat-icon">✅</div><div class="stat-label">Resolved</div><div class="stat-value">${resolved}</div><div class="stat-sub">Completed</div></div>
    `;
    const tbody = document.getElementById('student-recent-faults');
    tbody.innerHTML = faults.slice(0, 5).map(f => `
        <tr>
            <td><strong>#${f.id}</strong></td><td>${f.lab_name}</td><td>${f.computer_number}</td>
            <td><span class="badge badge-${f.fault_type}">${f.fault_type}</span></td>
            <td>${statusBadge(f.status)}</td>
            <td>${fmtDate(f.created_at)}</td>
        </tr>
    `).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:32px">No reports yet.</td></tr>';
}

// ═══════════════════════════════════════════
// REPORT FAULT — with dynamic button
// ═══════════════════════════════════════════
function selectFaultType(type) {
    selectedFaultType = type;
    document.getElementById('ft-software').classList.toggle('selected', type === 'software');
    document.getElementById('ft-hardware').classList.toggle('selected', type === 'hardware');
    const btn = document.getElementById('report-submit-btn');
    if (type === 'software') {
        btn.textContent = '🔍 Find Resolution →';
        btn.className = 'btn btn-teal';
        btn.style.width = '100%';
        btn.style.justifyContent = 'center';
    } else {
        btn.textContent = 'Submit Fault Report →';
        btn.className = 'btn btn-primary';
        btn.style.width = '';
        btn.style.justifyContent = '';
    }
}

function handleReportAction() {
    const lab = document.getElementById('r-lab').value;
    const comp = document.getElementById('r-comp').value.trim();
    const desc = document.getElementById('r-desc').value.trim();
    if (!lab || !comp || !selectedFaultType || !desc) {
        showAlert('report-alert', '⚠️ Please fill in all fields and select fault type.', 'error'); return;
    }
    if (selectedFaultType === 'software') {
        pendingReportData = { lab, comp, desc };
        showStudentView('resolution', null);
    } else {
        submitHardwareFault(lab, comp, desc);
    }
}

async function submitHardwareFault(lab, comp, desc) {
    const res = await api('POST', '/api/faults', { lab_name: lab, computer_number: comp, fault_type: 'hardware', description: desc });
    if (res.error) { showAlert('report-alert', res.error, 'error'); return; }
    showAlert('report-alert', `✅ Hardware fault #${res.fault_id} reported! Admin has been notified.`, 'success');
    resetReportForm();
    toast('Fault report submitted!', 'success');
}

function resetReportForm() {
    document.getElementById('r-lab').value = '';
    document.getElementById('r-comp').value = '';
    document.getElementById('r-desc').value = '';
    selectedFaultType = null;
    ['ft-software', 'ft-hardware'].forEach(id => document.getElementById(id).classList.remove('selected'));
    const btn = document.getElementById('report-submit-btn');
    btn.textContent = 'Submit Fault Report →';
    btn.className = 'btn btn-primary';
    btn.style.width = '';
    btn.style.justifyContent = '';
}

// ═══════════════════════════════════════════
// SOLUTIONS — shared fetch with fallback
// ═══════════════════════════════════════════
const FALLBACK_SOLUTIONS = [
    { id: 1, category: 'Application Issues', problem: 'Application not installed / missing', solution: 'Install the required application', steps: JSON.stringify(['Click Start Menu and search for the application','If not found, open Software Center or App Store','Search for the required application','Click Install and wait for completion','Restart the application if needed','Contact admin if installation fails']) },
    { id: 2, category: 'Application Issues', problem: 'Application crashes or freezes', solution: 'Force close and restart the application', steps: JSON.stringify(['Press Ctrl + Alt + Delete and open Task Manager','Find the frozen application in the list','Right-click and select End Task','Wait 30 seconds then reopen the application','If it crashes again, try restarting the computer','Report to admin if problem persists']) },
    { id: 3, category: 'Internet & Network', problem: 'No internet connection', solution: 'Check network settings and reconnect', steps: JSON.stringify(['Check if the network cable is properly plugged in','Click the network icon in the taskbar','Select your network and click Connect','If Wi-Fi, enter the password if prompted','Open browser and test the connection','Restart the computer if still not connected']) },
    { id: 4, category: 'Internet & Network', problem: 'Slow internet or browser issues', solution: 'Clear cache and restart browser', steps: JSON.stringify(['Press Ctrl + Shift + Delete in your browser','Select All time for the time range','Check all boxes for cache cookies history','Click Clear data or Clear browsing data','Close and reopen the browser','Try a different browser if issue continues']) },
    { id: 5, category: 'Display & Graphics', problem: 'Screen resolution is wrong', solution: 'Adjust display settings', steps: JSON.stringify(['Right-click on the desktop','Select Display Settings','Scroll to Display Resolution','Select the recommended resolution','Click Keep Changes when prompted','Restart if the issue persists']) },
    { id: 6, category: 'Display & Graphics', problem: 'Screen flickers or has artifacts', solution: 'Update or roll back display driver', steps: JSON.stringify(['Right-click Start Menu and select Device Manager','Expand Display Adapters','Right-click your graphics card','Select Update driver then Search automatically','If it worsens select Roll Back Driver','Restart the computer after changes']) },
    { id: 7, category: 'File & Storage', problem: 'Cannot save files or disk full', solution: 'Free up disk space', steps: JSON.stringify(['Open File Explorer and right-click on C drive','Select Properties to see disk space','Open Disk Cleanup from the same screen','Check all boxes and click OK','Delete any personal unused files from Desktop','Contact admin if system drive is full']) },
    { id: 8, category: 'File & Storage', problem: 'USB drive not recognized', solution: 'Reconnect and check device manager', steps: JSON.stringify(['Remove the USB drive and reinsert it','Wait 10 seconds for it to be detected','Open File Explorer to check if it appears','If not open Device Manager and look for errors','Try a different USB port on the computer','Test the USB on another computer to confirm it works']) },
    { id: 9, category: 'System Performance', problem: 'Computer is very slow', solution: 'Close background processes and clean up', steps: JSON.stringify(['Press Ctrl + Alt + Delete and open Task Manager','Sort by CPU and Memory usage','End any unnecessary high-usage processes','Disable startup programs via Task Manager Startup tab','Run Disk Cleanup from Start Menu','Restart the computer']) },
    { id: 10, category: 'System Performance', problem: 'Computer wont start or boot loop', solution: 'Perform startup repair', steps: JSON.stringify(['Hold the power button to force shutdown','Press F8 or F11 repeatedly while turning on','Select Startup Repair from the options','Let Windows diagnose and fix the issue','If it fails select System Restore','Contact admin or technician if repair fails']) },
    { id: 11, category: 'Printing', problem: 'Cannot print or printer offline', solution: 'Restart print spooler service', steps: JSON.stringify(['Press Windows + R and type services.msc','Find Print Spooler service','Right-click and select Restart','Open Control Panel and go to Printers','Right-click your printer and Set as Default','Try printing again']) },
    { id: 12, category: 'Login & Access', problem: 'Forgot password or cannot login', solution: 'Contact administrator to reset password', steps: JSON.stringify(['Do NOT try too many incorrect passwords','Note your Student ID and username','Visit the admin office or raise a ticket','Admin will reset your password','Check your email for reset instructions','Login with temporary password and change it']) },
];

async function fetchSolutions() {
    if (allSolutions.length) return;
    const res = await api('GET', '/api/solutions');
    if (!res.error && Array.isArray(res) && res.length > 0) {
        allSolutions = res;
    } else {
        allSolutions = FALLBACK_SOLUTIONS;
    }
}

// ═══════════════════════════════════════════
// RESOLUTION PAGE
// ═══════════════════════════════════════════
async function loadResolutionPage() {
    await fetchSolutions();
    resStepsDone = {};
    showAllMode = false;

    const cats = [...new Set(allSolutions.map(s => s.category))];
    const catFilter = document.getElementById('res-category-filter');
    catFilter.innerHTML = '<option value="">📂 All Categories</option>' +
        cats.map(c => `<option value="${c}">${c}</option>`).join('');

    const desc = (pendingReportData?.desc || '').toLowerCase();
    const keywords = desc.split(/\s+/).filter(w => w.length > 3);
    const matched = allSolutions.filter(s => {
        const text = (s.problem + ' ' + s.solution + ' ' + s.category).toLowerCase();
        return keywords.some(k => text.includes(k));
    });

    const matchedSection = document.getElementById('res-matched-section');
    if (matched.length > 0) {
        matchedSection.style.display = 'block';
        document.getElementById('res-matched-list').innerHTML = matched.map(s => renderResSolutionCard(s, true)).join('');
    } else {
        matchedSection.style.display = 'none';
    }

    document.getElementById('res-all-label').textContent = '💡 All Solutions';
    document.getElementById('res-all-list').innerHTML = allSolutions.map(s => renderResSolutionCard(s, false)).join('');
    document.getElementById('res-search').value = '';

    if (pendingReportData) {
        const controls = document.querySelector('.resolution-controls');
        const existing = document.getElementById('res-problem-info');
        if (existing) existing.remove();
        const info = document.createElement('div');
        info.className = 'alert alert-info';
        info.style.marginBottom = '16px';
        info.id = 'res-problem-info';
        info.innerHTML = `<strong>Your problem:</strong> "${pendingReportData.desc.substring(0, 120)}${pendingReportData.desc.length > 120 ? '...' : ''}"`;
        controls.parentNode.insertBefore(info, controls);
    }
}

function renderResSolutionCard(s, isMatched) {
    const steps = parseSteps(s.steps);
    return `
    <div class="res-solution-card${isMatched ? ' matched' : ''}" id="res-card-${s.id}">
        <div class="res-card-header" onclick="toggleResCard(${s.id})">
            <div>
                <div class="res-card-title">
                    🔸 ${s.problem}
                    ${isMatched ? '<span class="match-badge">⚡ Suggested</span>' : ''}
                </div>
                <div class="res-card-subtitle">${s.solution} &nbsp;·&nbsp; <span style="color:var(--accent)">${s.category}</span></div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
                <span style="font-size:11px;color:var(--muted)">${steps.length} steps</span>
                <span class="res-card-chevron">▼</span>
            </div>
        </div>
        <div class="res-card-body" id="res-body-${s.id}">
            <div class="steps-progress">
                <span class="steps-progress-label" id="res-prog-label-${s.id}">0 / ${steps.length} steps done</span>
                <div class="steps-progress-bar">
                    <div class="steps-progress-fill" id="res-prog-fill-${s.id}" style="width:0%"></div>
                </div>
            </div>
            <ul class="step-list" id="res-steps-${s.id}">
                ${steps.map((step, i) => `
                    <li class="step-item" id="res-step-${s.id}-${i}" onclick="toggleStep(${s.id}, ${i}, ${steps.length})">
                        <div class="step-checkbox" id="res-chk-${s.id}-${i}">
                            <span class="step-number">${i + 1}</span>
                        </div>
                        <div class="step-text">${step}</div>
                    </li>
                `).join('')}
            </ul>
            <div class="all-done-banner" id="res-done-banner-${s.id}">
                <div style="font-size:28px">🎉</div>
                <div style="flex:1">
                    <div style="font-weight:700;margin-bottom:4px">All steps completed!</div>
                    <div style="font-size:12px;color:var(--muted)">Did this solve your problem?</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button class="btn btn-success btn-sm" onclick="problemSolvedRes(${s.id})">✅ Yes, Solved!</button>
                    <button class="btn btn-danger btn-sm" onclick="problemNotSolved()">❌ Still having issues? Report →</button>
                </div>
            </div>
        </div>
    </div>`;
}

function toggleResCard(solutionId) {
    const card = document.getElementById('res-card-' + solutionId);
    card.classList.toggle('open');
}

function toggleStep(solutionId, stepIndex, totalSteps) {
    if (!resStepsDone[solutionId]) resStepsDone[solutionId] = new Set();
    const done = resStepsDone[solutionId];
    const stepEl = document.getElementById(`res-step-${solutionId}-${stepIndex}`);
    const chkEl = document.getElementById(`res-chk-${solutionId}-${stepIndex}`);

    if (done.has(stepIndex)) {
        done.delete(stepIndex);
        stepEl.classList.remove('done');
        chkEl.innerHTML = `<span class="step-number">${stepIndex + 1}</span>`;
    } else {
        done.add(stepIndex);
        stepEl.classList.add('done');
        chkEl.innerHTML = '✓';
    }

    const count = done.size;
    const pct = Math.round((count / totalSteps) * 100);
    document.getElementById(`res-prog-label-${solutionId}`).textContent = `${count} / ${totalSteps} steps done`;
    document.getElementById(`res-prog-fill-${solutionId}`).style.width = pct + '%';

    const banner = document.getElementById(`res-done-banner-${solutionId}`);
    if (count === totalSteps) {
        banner.classList.add('show');
        document.getElementById(`res-card-${solutionId}`).classList.add('completed');
    } else {
        banner.classList.remove('show');
        document.getElementById(`res-card-${solutionId}`).classList.remove('completed');
    }
}

function problemSolvedRes(solutionId) {
    pendingReportData = null;
    resetReportForm();
    openModal('modal-solved');
    toast('Problem solved! 🎉', 'success');
}

function problemNotSolved() {
    escalateToAdmin();
}

async function escalateToAdmin() {
    if (!pendingReportData) {
        toast('Please fill in your fault details so we can submit it to admin.', 'info');
        const reportNavItem = document.querySelector('#student-sidebar .nav-item[onclick*="report"]');
        showStudentView('report', reportNavItem);
        return;
    }
    const { lab, comp, desc } = pendingReportData;
    const res = await api('POST', '/api/faults', {
        lab_name: lab, computer_number: comp,
        fault_type: 'software', description: desc
    });
    if (res.error) { toast('Error submitting report: ' + res.error, 'error'); return; }
    pendingReportData = null;
    resetReportForm();
    toast(`✅ Fault #${res.fault_id} submitted to admin! A technician will be assigned.`, 'success');
    showStudentView('dashboard', null);
}

function filterResolutions() {
    const q = document.getElementById('res-search').value.toLowerCase();
    const cat = document.getElementById('res-category-filter').value;
    let filtered = allSolutions;
    if (cat) filtered = filtered.filter(s => s.category === cat);
    if (q) filtered = filtered.filter(s =>
        s.problem.toLowerCase().includes(q) ||
        s.solution.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
    );
    document.getElementById('res-all-label').textContent = filtered.length > 0
        ? `💡 ${filtered.length} Solution${filtered.length !== 1 ? 's' : ''} Found`
        : '💡 No Solutions Found';
    document.getElementById('res-all-list').innerHTML = filtered.map(s => renderResSolutionCard(s, false)).join('');

    Object.entries(resStepsDone).forEach(([solutionId, doneSet]) => {
        doneSet.forEach(stepIndex => {
            const stepEl = document.getElementById(`res-step-${solutionId}-${stepIndex}`);
            const chkEl = document.getElementById(`res-chk-${solutionId}-${stepIndex}`);
            if (stepEl && chkEl) {
                stepEl.classList.add('done');
                chkEl.innerHTML = '✓';
            }
        });
        const sol = allSolutions.find(s => String(s.id) === String(solutionId));
        if (sol) {
            const steps = parseSteps(sol.steps);
            const count = doneSet.size;
            const pct = Math.round((count / steps.length) * 100);
            const labelEl = document.getElementById(`res-prog-label-${solutionId}`);
            const fillEl = document.getElementById(`res-prog-fill-${solutionId}`);
            if (labelEl) labelEl.textContent = `${count} / ${steps.length} steps done`;
            if (fillEl) fillEl.style.width = pct + '%';
            if (count === steps.length) {
                const banner = document.getElementById(`res-done-banner-${solutionId}`);
                const card = document.getElementById(`res-card-${solutionId}`);
                if (banner) banner.classList.add('show');
                if (card) card.classList.add('completed');
            }
        }
    });

    if (q || cat) document.getElementById('res-matched-section').style.display = 'none';
    else if (document.getElementById('res-matched-list').innerHTML) {
        document.getElementById('res-matched-section').style.display = 'block';
    }
}

function toggleShowAll(btn) {
    showAllMode = !showAllMode;
    btn.textContent = showAllMode ? 'Collapse All' : 'Show All Solutions';
    btn.classList.toggle('btn-primary', showAllMode);
    btn.classList.toggle('btn-ghost', !showAllMode);
    document.querySelectorAll('.res-solution-card').forEach(card => {
        card.classList.toggle('open', showAllMode);
    });
}

// ═══════════════════════════════════════════
// MY REPORTS
// ═══════════════════════════════════════════
async function loadMyFaults(filterStatus = null) {
    if (!allMyFaults.length) {
        const res = await api('GET', '/api/faults/my');
        if (!res.error) allMyFaults = res;
    }
    // FIX: Corrected filter logic — 'open' status was unreachable because the 'in_progress'
    // branch was catching it first. Each status now has its own explicit branch.
    const faults = filterStatus && filterStatus !== 'all'
        ? allMyFaults.filter(f => {
            if (filterStatus === 'open') return f.status === 'open';
            if (filterStatus === 'in_progress') return ['assigned', 'in_progress'].includes(f.status);
            return f.status === filterStatus;
        }) : allMyFaults;
    const tbody = document.getElementById('my-faults-table');
    tbody.innerHTML = faults.map(f => `
        <tr>
            <td><strong>#${f.id}</strong></td><td>${f.lab_name}</td><td>${f.computer_number}</td>
            <td><span class="badge badge-${f.fault_type}">${f.fault_type}</span></td>
            <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.description}">${f.description.substring(0,45)}${f.description.length>45?'...':''}</td>
            <td>${statusBadge(f.status)}</td>
            <td>${fmtDate(f.created_at)}</td>
            <td>
                ${['resolved','closed'].includes(f.status)
                    ? `<span style="background:rgba(34,197,94,0.15);color:var(--green);border:1px solid rgba(34,197,94,0.3);padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700">✓ Solved</span>`
                    : `<span style="background:rgba(232,160,69,0.15);color:var(--accent);border:1px solid rgba(232,160,69,0.3);padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700">⏳ In Progress</span>`}
                ${f.status==='closed'&&!f.resolved_by_student?`<button class="btn btn-ghost btn-xs" onclick="openFeedback(${f.id})">⭐ Rate</button>`:''}
            </td>
        </tr>
    `).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:32px">No reports found</td></tr>';
}

function filterMyFaults(status, btn) {
    document.querySelectorAll('#sv-myreports .filter-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    loadMyFaults(status);
}

async function markSelfResolved(id) {
    await api('PATCH', `/api/faults/${id}/self-resolved`);
    allMyFaults = []; loadMyFaults();
    toast('Marked as resolved!', 'success');
}

// ═══════════════════════════════════════════
// SOLUTIONS LIBRARY (separate page)
// ═══════════════════════════════════════════
async function loadSolutions() {
    await fetchSolutions();
    renderSolutions(allSolutions);
}

function filterSolutions() {
    const q = document.getElementById('solutions-search').value.toLowerCase();
    const filtered = q ? allSolutions.filter(s =>
        s.problem.toLowerCase().includes(q) || s.solution.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    ) : allSolutions;
    renderSolutions(filtered, q);
}

function renderSolutions(solutions, query = '') {
    const grouped = {};
    solutions.forEach(s => { if (!grouped[s.category]) grouped[s.category] = []; grouped[s.category].push(s); });
    const container = document.getElementById('solutions-container');
    if (!solutions.length) { container.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>No solutions found for "${query}"</p></div>`; return; }
    container.innerHTML = Object.entries(grouped).map(([cat, items]) => `
        <div class="solution-category-section">
            <div class="category-label">📁 ${cat} <span style="color:var(--muted);font-weight:400">(${items.length})</span></div>
            <div class="solutions-grid">
                ${items.map(s => {
                    const steps = parseSteps(s.steps);
                    return `
                    <div class="solution-item" id="sol-${s.id}">
                        <div class="solution-header" onclick="toggleSolution(${s.id})">
                            <div><div class="solution-title">🔸 ${s.problem}</div><div class="solution-summary">${s.solution}</div></div>
                            <span class="solution-chevron">▼</span>
                        </div>
                        <div class="solution-body">
                            <ol class="solution-steps">${steps.map(step => `<li>${step}</li>`).join('')}</ol>
                            <div class="solution-actions">
                                <button class="btn btn-success btn-sm" onclick="problemSolved(${s.id})">✓ This solved my problem</button>
                                <button class="btn btn-ghost btn-sm" onclick="showStudentView('report',null)">Still having issues? Report →</button>
                            </div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>
    `).join('');
    if (query && solutions.length <= 3) solutions.forEach(s => document.getElementById('sol-' + s.id)?.classList.add('open'));
}

function toggleSolution(id) { document.getElementById('sol-' + id).classList.toggle('open'); }
function problemSolved(id) { document.getElementById('sol-'+id).querySelector('.solution-header').style.borderLeft='3px solid var(--green)'; toast('Great! Problem solved!', 'success'); }

// ═══════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════
async function loadAdminDashboard() {
    const [stats, faults] = await Promise.all([api('GET','/api/admin/stats'), api('GET','/api/admin/faults')]);
    document.getElementById('admin-stats-grid').innerHTML = `
        <div class="stat-card accent"><div class="stat-icon">📋</div><div class="stat-label">Total Faults</div><div class="stat-value">${stats.total}</div><div class="stat-sub">All time</div></div>
        <div class="stat-card red"><div class="stat-icon">🔴</div><div class="stat-label">Open</div><div class="stat-value">${stats.open}</div><div class="stat-sub">Needs action</div></div>
        <div class="stat-card blue"><div class="stat-icon">🔧</div><div class="stat-label">In Progress</div><div class="stat-value">${stats.inProgress}</div><div class="stat-sub">Assigned/Active</div></div>
        <div class="stat-card green"><div class="stat-icon">✅</div><div class="stat-label">Resolved</div><div class="stat-value">${stats.resolved}</div><div class="stat-sub">Completed</div></div>
        <div class="stat-card accent"><div class="stat-icon">📅</div><div class="stat-label">Today</div><div class="stat-value">${stats.todayFaults}</div><div class="stat-sub">New faults today</div></div>
        ${stats.avgRating?`<div class="stat-card teal"><div class="stat-icon">⭐</div><div class="stat-label">Avg Rating</div><div class="stat-value">${stats.avgRating}</div><div class="stat-sub">Out of 5.0</div></div>`:''}
    `;
    if (stats.trend && stats.trend.length) {
        const maxVal = Math.max(...stats.trend.map(t=>t.count),1);
        document.getElementById('trend-chart').innerHTML = `
            <div style="display:flex;align-items:flex-end;gap:8px;height:80px;padding:0 4px">
                ${stats.trend.map(t=>{const h=Math.max((t.count/maxVal)*72,4);const date=new Date(t.date).toLocaleDateString('en-GB',{day:'2-digit',month:'short'});return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="font-size:10px;color:var(--muted)">${t.count}</div><div style="width:100%;height:${h}px;background:linear-gradient(180deg,var(--accent),var(--accent-dark));border-radius:3px 3px 0 0;min-height:4px"></div><div style="font-size:9px;color:var(--muted);white-space:nowrap">${date}</div></div>`;}).join('')}
            </div>`;
    }
    if (stats.topLabs && stats.topLabs.length) {
        const maxLab = stats.topLabs[0].count;
        document.getElementById('top-labs').innerHTML = stats.topLabs.map(l=>`
            <div style="margin-bottom:12px">
                <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="font-size:13px;font-weight:500">${l.lab_name}</span><span style="font-size:12px;color:var(--muted)">${l.count} faults</span></div>
                <div class="progress-bar"><div class="progress-fill accent" style="width:${l.count/maxLab*100}%"></div></div>
            </div>`).join('');
    }
    const nonClosed = faults.filter(f=>!['closed'].includes(f.status));
    document.getElementById('admin-hw-faults').innerHTML = nonClosed.map(f=>`
        <tr><td><strong>#${f.id}</strong></td><td>${f.student_name}<br><span style="font-size:11px;color:var(--muted)">${f.student_number}</span></td>
        <td>${f.lab_name}</td><td>${f.computer_number}</td><td>${statusBadge(f.status)}</td><td>${fmtDate(f.created_at)}</td>
        <td>${f.status==='open'?`<button class="btn btn-teal btn-xs" onclick="openAssign(${f.id},'${f.lab_name}','${f.computer_number}')">Assign Tech</button>`:f.status==='resolved'?`<button class="btn btn-success btn-xs" onclick="notifyStudent(${f.id})">Notify Student ✓</button>`:`<span style="font-size:12px;color:var(--muted)">${f.technician_name||'—'}</span>`}</td></tr>
    `).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:32px">🎉 No pending faults!</td></tr>';
}

async function loadAllFaults() {
    const search = document.getElementById('fault-search')?.value||'';
    const status = document.getElementById('fault-status-filter')?.value||'';
    const type = document.getElementById('fault-type-filter')?.value||'';
    const params = new URLSearchParams();
    if (search) params.set('search',search); if (status) params.set('status',status); if (type) params.set('fault_type',type);
    const faults = await api('GET','/api/admin/faults?'+params.toString());
    if (faults.error) return;
    // FIX: Added conditional check before appending '...' to avoid it showing on short descriptions
    document.getElementById('admin-all-faults').innerHTML = faults.map(f=>`
        <tr><td><strong>#${f.id}</strong></td><td>${f.student_name}</td><td>${f.lab_name}</td>
        <td><span class="badge badge-${f.fault_type}">${f.fault_type}</span></td>
        <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.description}">${f.description.substring(0,45)}${f.description.length>45?'...':''}</td>
        <td>${statusBadge(f.status)}</td>
        <td>${f.technician_name||'<span style="color:var(--muted)">—</span>'}</td>
        <td>${fmtDate(f.created_at)}</td>
        <td>${f.status==='open'?`<button class="btn btn-teal btn-xs" onclick="openAssign(${f.id},'${f.lab_name}','${f.computer_number}')">Assign</button>`:f.status==='resolved'?`<button class="btn btn-success btn-xs" onclick="notifyStudent(${f.id})">Notify</button>`:''}</td></tr>
    `).join('')||'<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:32px">No faults match your filters</td></tr>';
}

async function loadTechniciansList() {
    const techs = await api('GET','/api/admin/technicians');
    if (techs.error) return;
    document.getElementById('tech-cards-container').innerHTML = techs.map(t=>{
        const completion = t.total_tasks>0?Math.round((t.completed_tasks/t.total_tasks)*100):0;
        return `<div class="tech-card"><div class="tech-info"><div><div class="tech-name">🔧 ${t.name}</div><div class="tech-email">${t.email}</div></div><div style="text-align:right"><div style="font-size:20px;font-weight:700;color:var(--teal)">${completion}%</div><div style="font-size:11px;color:var(--muted)">completion rate</div></div></div><div style="display:flex;gap:20px;font-size:12px;color:var(--muted);margin-bottom:10px"><span>📋 ${t.total_tasks} total</span><span>✅ ${t.completed_tasks} done</span><span>🔄 ${t.total_tasks-t.completed_tasks} pending</span></div><div class="progress-bar"><div class="progress-fill teal" style="width:${completion}%"></div></div></div>`;
    }).join('')||'<div class="empty-state"><div class="icon">👷</div><p>No technicians registered</p></div>';
}

async function loadFeedback() {
    const fb = await api('GET','/api/admin/feedback');
    if (fb.error) return;
    if (fb.length>0) {
        const avg = fb.reduce((s,f)=>s+f.rating,0)/fb.length;
        const dist = [1,2,3,4,5].map(r=>fb.filter(f=>f.rating===r).length);
        document.getElementById('feedback-summary').innerHTML = `
            <div style="display:flex;align-items:center;gap:32px;flex-wrap:wrap">
                <div style="text-align:center"><div style="font-size:48px;font-weight:700;color:var(--accent)">${avg.toFixed(1)}</div><div style="font-size:20px;color:var(--accent)">${'★'.repeat(Math.round(avg))}${'☆'.repeat(5-Math.round(avg))}</div><div style="font-size:12px;color:var(--muted);margin-top:4px">${fb.length} responses</div></div>
                <div style="flex:1;min-width:200px">${[5,4,3,2,1].map(r=>`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="font-size:12px;width:16px;color:var(--accent)">${r}★</span><div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden"><div style="width:${fb.length>0?(dist[r-1]/fb.length*100):0}%;height:100%;background:var(--accent);border-radius:4px;transition:width 0.5s"></div></div><span style="font-size:12px;color:var(--muted);width:20px">${dist[r-1]}</span></div>`).join('')}</div>
            </div>`;
    } else { document.getElementById('feedback-summary').innerHTML='<p style="color:var(--muted)">No feedback yet.</p>'; }
    document.getElementById('feedback-table').innerHTML = fb.map(f=>`
        <tr><td><strong>#${f.fault_id}</strong></td><td>${f.student_name}</td><td>${f.lab_name}</td>
        <td><span style="color:var(--accent)">${'★'.repeat(f.rating)}</span><span style="color:var(--muted)">${'☆'.repeat(5-f.rating)}</span> <span style="font-size:12px;color:var(--muted)">(${f.rating}/5)</span></td>
        <td>${f.comment||'<span style="color:var(--muted)">—</span>'}</td><td>${fmtDate(f.created_at)}</td></tr>
    `).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:32px">No feedback yet</td></tr>';
}

async function openAssign(faultId, lab, comp) {
    assignFaultId = faultId;
    document.getElementById('assign-fault-info').innerHTML = `📋 Fault <strong>#${faultId}</strong> — ${lab}, Computer: <strong>${comp}</strong>`;
    const techs = await api('GET','/api/admin/technicians');
    document.getElementById('assign-tech-select').innerHTML = techs.map(t=>`<option value="${t.id}">${t.name} (${t.total_tasks-t.completed_tasks} active tasks)</option>`).join('');
    document.getElementById('tech-workload-info').textContent = '💡 Consider technicians with fewer active tasks.';
    openModal('modal-assign');
}

async function confirmAssign() {
    const techId = document.getElementById('assign-tech-select').value;
    await api('POST','/api/admin/assign',{fault_id:assignFaultId,technician_id:techId});
    closeModal('modal-assign'); toast('Technician assigned!','success'); loadAdminDashboard();
}

async function notifyStudent(faultId) {
    await api('POST','/api/admin/notify-student',{fault_id:faultId});
    toast('Student notified and asked for feedback!','success'); loadAdminDashboard();
}

function exportFaults() { window.open('/api/admin/export/faults','_blank'); toast('Downloading CSV...','info'); }

// ═══════════════════════════════════════════
// TECHNICIAN
// ═══════════════════════════════════════════
async function loadTechTasks() {
    const tasks = await api('GET','/api/technician/tasks');
    if (tasks.error) return;
    const active = tasks.filter(t=>['pending','accepted'].includes(t.status));
    const badge = document.getElementById('pending-badge');
    if (active.length>0){badge.textContent=active.length;badge.style.display='inline';}else badge.style.display='none';
    const container = document.getElementById('tech-tasks-container');
    if (active.length===0){container.innerHTML=`<div class="empty-state"><div class="icon">✅</div><h3>No Active Tasks</h3><p>You're all caught up!</p></div>`;return;}
    container.innerHTML = active.map(t=>`
        <div class="task-card">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;gap:10px">
                <div>
                    <div style="font-size:16px;font-weight:700">Task #${t.id}</div>
                    <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">
                        <span class="badge badge-${t.status}">${t.status}</span>
                        ${t.fault_type ? `<span class="badge badge-${t.fault_type}">${t.fault_type.charAt(0).toUpperCase()+t.fault_type.slice(1)}</span>` : ''}
                    </div>
                </div>
                <div style="text-align:right;font-size:11px;color:var(--muted);white-space:nowrap">Assigned<br>${fmtDate(t.assigned_at)}</div>
            </div>
            <div class="task-meta-grid">
                <div><div class="task-meta-label">Lab</div><div class="task-meta-value">${t.lab_name}</div></div>
                <div><div class="task-meta-label">Computer</div><div class="task-meta-value">${t.computer_number}</div></div>
                <div><div class="task-meta-label">Reported by</div><div class="task-meta-value">${t.student_name}</div></div>
                <div><div class="task-meta-label">Student ID</div><div class="task-meta-value">${t.student_number}</div></div>
            </div>
            <div style="background:var(--card);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:16px;font-size:13px;line-height:1.5;color:rgba(248,250,252,0.8)">
                <div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px">Problem Description</div>
                ${t.description}
            </div>
            <div class="flex gap-2" style="flex-wrap:wrap">
                ${t.status==='pending'
                    ? `<button class="btn btn-success btn-sm" onclick="respondTask(${t.id},'accepted')">✓ Accept Task</button><button class="btn btn-danger btn-sm" onclick="respondTask(${t.id},'declined')">✗ Decline Task</button>`
                    : t.status==='accepted'
                        ? `<button class="btn btn-primary btn-sm" onclick="openComplete(${t.id})">Mark as Completed →</button>`
                        : ''}
            </div>
        </div>`).join('');
}

async function respondTask(taskId, status) {
    await api('PATCH',`/api/technician/tasks/${taskId}`,{status});
    toast(status==='accepted'?'Task accepted!':'Task declined.',status==='accepted'?'success':'info');
    loadTechTasks(); loadNotifications();
}

function openComplete(taskId) { completingTaskId=taskId; document.getElementById('comp-problem').value=''; document.getElementById('comp-solution').value=''; openModal('modal-complete'); }

async function confirmComplete() {
    const problem = document.getElementById('comp-problem').value.trim();
    const solution = document.getElementById('comp-solution').value.trim();
    if (!problem||!solution){toast('Please fill in both fields.','error');return;}
    await api('PATCH',`/api/technician/tasks/${completingTaskId}`,{status:'completed',problem_description:problem,solution_description:solution});
    closeModal('modal-complete'); toast('Task completed! Admin notified.','success'); loadTechTasks();
}

async function loadTechHistory() {
    const tasks = await api('GET','/api/technician/tasks');
    if (tasks.error) return;
    const done = tasks.filter(t=>t.status==='completed');
    document.getElementById('tech-stats-mini').textContent=`${done.length} completed tasks`;
    document.getElementById('tech-history-table').innerHTML = done.map(t=>`
        <tr><td><strong>#${t.id}</strong></td><td>#${t.fault_id}</td><td>${t.lab_name}</td><td>${t.computer_number}</td>
        <td style="max-width:160px">${t.problem_description||'<span style="color:var(--muted)">—</span>'}</td>
        <td style="max-width:160px">${t.solution_description||'<span style="color:var(--muted)">—</span>'}</td>
        <td>${fmtDate(t.updated_at)}</td></tr>
    `).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:32px">No completed tasks yet</td></tr>';
}

// ═══════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════
async function loadNotifications() {
    const notes = await api('GET','/api/notifications');
    if (notes.error) return;
    const unread = notes.filter(n=>!n.is_read).length;
    ['notif-dot-student','notif-dot-admin','notif-dot-tech'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display=unread>0?'block':'none';});
    document.getElementById('notif-list').innerHTML = notes.length===0
        ?'<div class="empty-state" style="padding:40px 20px"><div class="icon">🔔</div><p>No notifications yet</p></div>'
        :notes.map(n=>`<div class="notif-item ${n.is_read?'':'unread'}"><div class="notif-msg">${n.message}</div><div class="notif-time">${new Date(n.created_at).toLocaleString()}</div></div>`).join('');
}

// FIX: Only mark notifications as read when opening the panel, not when closing it
async function toggleNotifPanel() {
    const panel = document.getElementById('notif-panel');
    const isOpen = panel.classList.contains('open');
    panel.classList.toggle('open');
    if (!isOpen) {
        await api('PATCH','/api/notifications/read');
        ['notif-dot-student','notif-dot-admin','notif-dot-tech'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    }
}

// ═══════════════════════════════════════════
// FEEDBACK
// ═══════════════════════════════════════════
const ratingLabels = ['','Very Poor 😞','Poor 😕','Okay 😐','Good 😊','Excellent 🌟'];

function openFeedback(faultId) {
    feedbackFaultId=faultId; selectedRating=0;
    document.querySelectorAll('.star').forEach(s=>s.classList.remove('active'));
    document.getElementById('feedback-comment').value='';
    document.getElementById('rating-label').textContent='';
    openModal('modal-feedback');
}

function setRating(val) {
    selectedRating=val;
    document.querySelectorAll('.star').forEach(s=>s.classList.toggle('active',parseInt(s.dataset.v)<=val));
    document.getElementById('rating-label').textContent=ratingLabels[val];
}

async function submitFeedback() {
    if (!selectedRating){toast('Please select a rating.','error');return;}
    const comment = document.getElementById('feedback-comment').value;
    await api('POST','/api/feedback',{fault_id:feedbackFaultId,rating:selectedRating,comment});
    closeModal('modal-feedback'); toast('Thank you for your feedback! 🌟','success');
    allMyFaults = []; loadMyFaults(); loadStudentDashboard();
}

// ═══════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('open');}));

function showAlert(id,msg,type){
    const el=document.getElementById(id);
    el.innerHTML=`<div class="alert alert-${type}">${msg}</div>`;
    setTimeout(()=>{if(el)el.innerHTML='';},5000);
}

// ═══════════════════════════════════════════
// DATABASE VIEWER
// ═══════════════════════════════════════════
async function showDbTable(tableName, btn) {
    if (btn) {
        document.querySelectorAll('#db-tabs .btn').forEach(b=>{b.classList.remove('btn-primary');b.classList.add('btn-ghost');});
        btn.classList.remove('btn-ghost'); btn.classList.add('btn-primary');
    }
    const container = document.getElementById('db-table-container');
    container.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)"><span class="spinner"></span> Loading...</div>';
    const tableNames={users:'👤 Users',fault_reports:'📋 Fault Reports',technician_tasks:'🔧 Technician Tasks',software_solutions:'💡 Software Solutions',notifications:'🔔 Notifications',feedback:'⭐ Feedback'};
    document.getElementById('db-table-title').textContent=tableNames[tableName]+' Table';
    const rows = await api('GET','/api/admin/db/'+tableName);
    if (!rows||rows.error||rows.length===0){container.innerHTML='<div class="empty-state"><div class="icon">📭</div><h3>No Records</h3><p>This table is empty</p></div>';document.getElementById('db-row-count').textContent='0 records';return;}
    document.getElementById('db-row-count').textContent=rows.length+' record(s)';
    const cols=Object.keys(rows[0]);
    let html='<table><thead><tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>';
    rows.forEach(row=>{html+='<tr>'+cols.map(c=>{let val=row[c];if(c==='password')val='••••••••';if(val===null||val===undefined)val='<span style="color:var(--muted)">NULL</span>';if(typeof val==='string'&&val.length>65)val=val.substring(0,65)+'…';return'<td>'+val+'</td>';}).join('')+'</tr>';});
    html+='</tbody></table>'; container.innerHTML=html;
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
(async () => {
    const res = await api('GET','/api/auth/me');
    if (res.user){currentUser=res.user;loadDashboard();}
})();

// ═══════════════════════════════════════════
// ADMIN SOLUTIONS MANAGER
// ═══════════════════════════════════════════
async function loadAdminSolutions() {
    const res = await api('GET', '/api/solutions');
    const tbody = document.getElementById('solutions-admin-table');
    if (!res || res.error || !res.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:32px">No solutions found</td></tr>';
        return;
    }
    tbody.innerHTML = res.map((s, index) => {
        const steps = parseSteps(s.steps);
        return `<tr>
            <td><strong>${index + 1}</strong></td>
            <td><span class="badge" style="background:rgba(45,212,191,0.15);color:var(--teal);border:1px solid rgba(45,212,191,0.3)">${s.category}</span></td>
            <td style="max-width:200px">${s.problem}</td>
            <td style="max-width:180px;color:var(--muted);font-size:12px">${s.solution}</td>
            <td><span style="font-size:12px;color:var(--muted)">${steps.length} steps</span></td>
            <td style="display:flex;gap:6px">
                <button class="btn btn-teal btn-xs" onclick="openSolutionModal(${s.id})">✏️ Edit</button>
                <button class="btn btn-danger btn-xs" onclick="deleteSolution(${s.id})">🗑️ Delete</button>
            </td>
        </tr>`;
    }).join('');
}

function addSolutionStep(value = '') {
    const list = document.getElementById('sol-steps-list');
    const index = list.children.length + 1;
    const div = document.createElement('div');
    div.style = 'display:flex;align-items:center;gap:8px';
    div.innerHTML = `<span style="font-size:12px;color:var(--muted);width:20px;text-align:right;flex-shrink:0">${index}.</span>
        <input type="text" placeholder="Step ${index} description" value="${value}"
            style="flex:1;background:var(--navy-light);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 12px;color:var(--white);font-family:inherit;font-size:13px;outline:none">
        <button type="button" onclick="this.parentElement.remove();reindexSteps()"
            style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:var(--red);border-radius:6px;padding:6px 10px;cursor:pointer;font-size:13px;flex-shrink:0">✕</button>`;
    list.appendChild(div);
}

function reindexSteps() {
    const list = document.getElementById('sol-steps-list');
    Array.from(list.children).forEach((div, i) => {
        div.querySelector('span').textContent = (i + 1) + '.';
        div.querySelector('input').placeholder = `Step ${i + 1} description`;
    });
}

// FIX: openSolutionModal now opens the modal immediately with a loading state,
// then populates data asynchronously — eliminating the race condition where
// openModal was called after an async operation.
function openSolutionModal(id) {
    document.getElementById('sol-edit-id').value = id || '';
    document.getElementById('sol-category').value = '';
    document.getElementById('sol-problem').value = '';
    document.getElementById('sol-solution').value = '';
    document.getElementById('sol-steps-list').innerHTML = '';
    document.getElementById('solution-modal-title').textContent = id ? 'Edit Solution' : 'Add Solution';
    openModal('modal-solution');

    if (id) {
        api('GET', '/api/solutions').then(res => {
            const s = res.find(x => x.id === id);
            if (!s) return;
            const steps = parseSteps(s.steps);
            document.getElementById('sol-category').value = s.category;
            document.getElementById('sol-problem').value = s.problem;
            document.getElementById('sol-solution').value = s.solution;
            steps.forEach(step => addSolutionStep(step));
        });
    } else {
        addSolutionStep();
    }
}

async function saveSolution() {
    const id = document.getElementById('sol-edit-id').value;
    const category = document.getElementById('sol-category').value.trim();
    const problem = document.getElementById('sol-problem').value.trim();
    const solution = document.getElementById('sol-solution').value.trim();
    const stepInputs = document.querySelectorAll('#sol-steps-list input');
    const steps = Array.from(stepInputs).map(i => i.value.trim()).filter(s => s.length > 0);

    if (!category || !problem || !solution) { toast('Please fill in all fields.', 'error'); return; }
    if (steps.length < 1) { toast('Please add at least one step.', 'error'); return; }

    const body = { category, problem, solution, steps: JSON.stringify(steps) };
    const res = id
        ? await api('PUT', `/api/admin/solutions/${id}`, body)
        : await api('POST', '/api/admin/solutions', body);

    if (res.error) { toast('Error: ' + res.error, 'error'); return; }
    closeModal('modal-solution');
    toast(id ? '✅ Solution updated!' : '✅ Solution added!', 'success');
    allSolutions = [];
    loadAdminSolutions();
}

async function deleteSolution(id) {
    if (!confirm('Are you sure you want to delete this solution?')) return;
    const res = await api('DELETE', `/api/admin/solutions/${id}`);
    if (res.error) { toast('Error: ' + res.error, 'error'); return; }
    toast('🗑️ Solution deleted!', 'success');
    allSolutions = [];
    loadAdminSolutions();
}
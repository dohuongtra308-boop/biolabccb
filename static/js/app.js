/**
 * BioLab Manager - Frontend Single Page Application Engine
 * Quản lý trạng thái giao diện, Web Audio API chuông báo và tương tác 2 vai trò
 */

// Global State
let currentUser = null;
let authToken = localStorage.getItem('biolab_token');
let currentAdminZoneFilter = 'ALL';
let activeSessionId = null;
let allEquipment = [];
let allSessions = [];
let commonSchedule = [];
let commonScheduleError = '';
let teacherCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let teacherCalendarSelectedDate = '';
let adminCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let adminCalendarSelectedDate = '';
let activeGradeGroup = 1;
let pendingExcelDownload = null;
let backgroundSyncRunning = false;
let lastBackgroundSnapshot = '';
const rejectionReasonDrafts = {};
let teacherReportDamageItems = [];
let teacherReportPlannedQuantities = {};

// Attach the login token to every API request. The server remains the source of truth.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('/api/') && authToken) {
    init.headers = new Headers(init.headers || {});
    init.headers.set('Authorization', `Bearer ${authToken}`);
    if (!init.method || init.method.toUpperCase() === 'GET') init.cache = 'no-store';
  }
  return nativeFetch(input, init);
};

// ================= 1. WEB AUDIO API CHIME SYNTHESIZER =================
function playChimeSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    // Sound Note 1 (880 Hz - A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, ctx.currentTime);
    gain1.gain.setValueAtTime(0.15, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.6);

    // Sound Note 2 (1320 Hz - E6) slightly delayed
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, ctx.currentTime + 0.12);
    gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.12);
    osc2.stop(ctx.currentTime + 0.8);
  } catch (e) {
    console.warn("Audio context not allowed yet:", e);
  }
}

// ================= 2. TOAST SYSTEM =================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bg = type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-rose-600' : 'bg-brand-700';
  toast.className = `${bg} text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 text-xs font-semibold transform transition-all duration-300 opacity-0 translate-y-2 pointer-events-auto`;
  toast.innerHTML = `<span>${message}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove('opacity-0', 'translate-y-2');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function formatVietnamTime(utcTimestamp) {
  if (!utcTimestamp) return '';
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(utcTimestamp) ? utcTimestamp : `${utcTimestamp.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return utcTimestamp;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(parsed);
}

// ================= 3. INITIALIZATION & AUTH =================
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) lucide.createIcons();
  
  // Restore user from localStorage or fetch /api/auth/me
  const savedUser = localStorage.getItem('biolab_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      updateUserUI();
    } catch (e) {
      localStorage.removeItem('biolab_user');
    }
  }

  if (currentUser && authToken) {
    await loadEquipment();
    await loadSessions();
    await loadCommonSchedule();
    await loadNotifications();
    lastBackgroundSnapshot = buildBackgroundSnapshot();
  } else if (currentUser) {
    currentUser = null;
    localStorage.removeItem('biolab_user');
  }

  if (!currentUser) {
    showView('view-landing');
  } else {
    routeByRole();
  }

  // Set today date on register session modal
  const regDateInput = document.getElementById('reg-date');
  if (regDateInput) {
    regDateInput.value = new Date().toISOString().split('T')[0];
  }

  // Đồng bộ ngầm để thay đổi từ phía giáo viên/cán bộ xuất hiện không cần F5.
  // Five seconds still gives near-real-time cross-user updates while leaving
  // Render threads available for explicit button actions.
  setInterval(syncVisibleState, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncVisibleState();
  });
  window.addEventListener('focus', syncVisibleState);
  document.getElementById('modal-register-session')?.addEventListener('input', saveRegistrationDraft);
  document.getElementById('modal-register-session')?.addEventListener('change', saveRegistrationDraft);
});

function buildBackgroundSnapshot() {
  return JSON.stringify({equipment: allEquipment, sessions: allSessions, schedule: commonSchedule});
}

async function syncVisibleState() {
  if (!currentUser || !authToken || document.hidden || backgroundSyncRunning) return;
  backgroundSyncRunning = true;
  try {
    await Promise.all([loadEquipment(), loadSessions(), loadNotifications(), loadCommonSchedule()]);
    const nextSnapshot = buildBackgroundSnapshot();
    if (nextSnapshot !== lastBackgroundSnapshot) {
      lastBackgroundSnapshot = nextSnapshot;
      if (currentUser.role === 'TEACHER') renderTeacherView();
      if (currentUser.role === 'LAB_MANAGER') renderAdminView();
    }
  } finally {
    backgroundSyncRunning = false;
  }
}

function updateUserUI() {
  const badge = document.getElementById('user-role-badge');
  const name = document.getElementById('user-fullname');

  if (!currentUser) {
    badge.textContent = 'Chưa đăng nhập';
    badge.className = 'px-2 py-0.5 text-xs font-semibold rounded bg-slate-600 text-white';
    name.textContent = 'Khách';
    const accountLabel = document.getElementById('account-button-label');
    if (accountLabel) accountLabel.textContent = 'Đăng nhập';
    return;
  }

  name.textContent = currentUser.full_name;
  const accountLabel = document.getElementById('account-button-label');
  if (accountLabel) accountLabel.textContent = 'Đăng xuất';
  if (currentUser.role === 'LAB_MANAGER') {
    badge.textContent = 'Cán bộ Quản lý';
    badge.className = 'px-2 py-0.5 text-xs font-semibold rounded bg-indigo-500 text-white';
  } else if (currentUser.role === 'TEACHER') {
    badge.textContent = 'Giáo viên';
    badge.className = 'px-2 py-0.5 text-xs font-semibold rounded bg-emerald-500 text-brand-950';
  }
}

function routeByRole() {
  if (!currentUser) {
    showView('view-landing');
    return;
  }
  if (currentUser.role === 'TEACHER') {
    showView('view-teacher');
    renderTeacherView();
  } else if (currentUser.role === 'LAB_MANAGER') {
    showView('view-admin');
    renderAdminView();
  }
}

function showView(viewId) {
  ['view-landing', 'view-teacher', 'view-admin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(viewId);
  if (target) target.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function navigateHome() {
  if (currentUser) {
    routeByRole();
  } else {
    showView('view-landing');
  }
}

async function handleAccountButton() {
  if (!currentUser) return openLoginModal();
  if (authToken) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {'Authorization': `Bearer ${authToken}`}
      });
    } catch (_) {
      // Vẫn đăng xuất trên trình duyệt nếu mạng hoặc máy chủ tạm thời gián đoạn.
    }
  }
  currentUser = null;
  authToken = null;
  lastBackgroundSnapshot = '';
  localStorage.removeItem('biolab_user');
  localStorage.removeItem('biolab_token');
  updateUserUI();
  showView('view-landing');
  openLoginModal();
}

// ================= 4. AUTHENTICATION ACTIONS =================
function openLoginModal(titleText = 'Đăng Nhập Hệ Thống THPT Chuyên Cao Bằng') {
  const title = document.getElementById('login-modal-title');
  if (title) title.textContent = titleText;
  document.getElementById('modal-login').classList.remove('hidden');
}
function closeLoginModal() {
  document.getElementById('modal-login').classList.add('hidden');
}

function openLoginModalForRole(role) {
  const username = document.getElementById('login-username');
  const password = document.getElementById('login-password');
  if (username) username.value = '';
  if (password) password.value = '';
  openLoginModal(role === 'LAB_MANAGER' ? 'Đăng nhập Cán bộ Quản lý' : 'Đăng nhập Giáo viên Bộ môn');
  window.setTimeout(() => username?.focus(), 0);
}

async function submitLogin() {
  const u = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value.trim();

  if (!u || !p) {
    showToast('Vui lòng nhập đầy đủ tài khoản và mật khẩu', 'error');
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await res.json();
    if (res.ok && data.user) {
      currentUser = data.user;
      authToken = data.token;
      localStorage.setItem('biolab_user', JSON.stringify(currentUser));
      localStorage.setItem('biolab_token', authToken);
      if (currentUser.must_change_password) {
        closeLoginModal();
        document.getElementById('modal-change-password').classList.remove('hidden');
        return;
      }
      await finishLogin();
    } else {
      showToast(data.error || 'Sai tên đăng nhập hoặc mật khẩu', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối máy chủ', 'error');
  }
}

async function finishLogin() {
      await loadEquipment();
      await loadSessions();
      await loadCommonSchedule();
      await loadNotifications();
      lastBackgroundSnapshot = buildBackgroundSnapshot();
      updateUserUI();
      closeLoginModal();
      showToast(`Đăng nhập thành công: ${currentUser.full_name}`);
      playChimeSound();
      routeByRole();
      if (pendingExcelDownload) {
        const pending = pendingExcelDownload;
        pendingExcelDownload = null;
        window.setTimeout(() => downloadExcel(pending.url, pending.filename), 100);
      }
}

async function submitFirstPasswordChange() {
  const password = document.getElementById('new-password').value;
  const confirmation = document.getElementById('confirm-new-password').value;
  if (password.length < 8) return showToast('Mật khẩu phải có ít nhất 8 ký tự', 'error');
  if (password !== confirmation) return showToast('Hai mật khẩu chưa trùng khớp', 'error');
  const res = await fetch('/api/auth/change-password', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({new_password:password})});
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Không thể đổi mật khẩu', 'error');
  currentUser.must_change_password = 0;
  localStorage.setItem('biolab_user', JSON.stringify(currentUser));
  document.getElementById('modal-change-password').classList.add('hidden');
  await finishLogin();
}

// ================= 5. DATA LOADING APIS =================
async function loadEquipment() {
  try {
    const res = await fetch('/api/equipment');
    allEquipment = await res.json();
    const stat = document.getElementById('stat-total-eq');
    if (stat) stat.textContent = `${allEquipment.length} mục`;
  } catch (e) {
    console.error("Lỗi tải thiết bị:", e);
  }
}

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    allSessions = await res.json();
    if (allSessions.length > 0) {
      // Keep the session the user selected. Background polling must not redirect
      // an open report modal to a different overlapping booking.
      const selectedStillExists = allSessions.some(s => s.id === activeSessionId);
      if (!selectedStillExists) {
        const active = allSessions.find(s => !['COMPLETED','REJECTED','CANCELLED'].includes(s.status)) || allSessions[0];
        if (active) activeSessionId = active.id;
      }
    } else {
      activeSessionId = null;
    }
  } catch (e) {
    console.error("Lỗi tải ca học:", e);
  }
}

async function loadCommonSchedule() {
  if (!currentUser) return;
  try {
    let res = await fetch('/api/schedule/common');
    let data = await res.json().catch(() => []);
    // Tương thích tạm thời khi giao diện mới được tải trước backend trên máy chủ.
    // API lịch sử của cán bộ có đủ trường để dựng lịch và đã tồn tại ở bản cũ.
    if (res.status === 404 && currentUser.role === 'LAB_MANAGER') {
      res = await fetch('/api/stats/teachers-summary');
      data = await res.json().catch(() => []);
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    commonSchedule = Array.isArray(data) ? data : [];
    commonSchedule = commonSchedule.filter(item => !['REJECTED', 'CANCELLED'].includes(item.status));
    commonScheduleError = '';
    if (currentUser.role === 'TEACHER') renderCommonSchedule();
    if (currentUser.role === 'LAB_MANAGER') renderAdminCalendar();
  } catch (e) {
    commonScheduleError = e.message || 'Không thể tải lịch';
    console.error('Lỗi tải lịch đăng ký chung:', e);
    if (currentUser.role === 'TEACHER') renderCommonSchedule();
    if (currentUser.role === 'LAB_MANAGER') renderAdminCalendar();
  }
}

async function loadNotifications() {
  try {
    const res = await fetch('/api/notifications');
    const notifs = await res.json();
    const badge = document.getElementById('notif-badge');
    const list = document.getElementById('notif-list');
    if (!list) return;

    const unread = notifs.filter(n => !n.is_read);
    if (unread.length > 0) {
      badge.textContent = unread.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    if (notifs.length === 0) {
      list.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">Không có thông báo mới</div>`;
      return;
    }

    list.innerHTML = notifs.map(n => `
      <div class="p-3 hover:bg-slate-50 transition rounded-xl ${n.is_read ? 'opacity-60' : 'bg-teal-50/50'}">
        <div class="flex items-start justify-between">
          <span class="font-bold text-xs text-slate-900">${n.title}</span>
          <span class="text-[10px] text-slate-400" title="Giờ Việt Nam (GMT+7)">${formatVietnamTime(n.created_at)}</span>
        </div>
        <p class="text-xs text-slate-600 mt-1">${n.message}</p>
      </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error("Lỗi tải thông báo:", e);
  }
}

function toggleNotifications() {
  const drawer = document.getElementById('notif-drawer');
  drawer.classList.toggle('hidden');
}

async function markAllNotificationsRead() {
  await fetch('/api/notifications/read-all', { method: 'POST' });
  loadNotifications();
}

// ================= 7. TEACHER FLOW =================
function renderTeacherView() {
  renderTeacherTasks();
  renderCommonSchedule();
  const sessionList = document.getElementById('teacher-session-list');
  const livePanel = document.getElementById('teacher-live-panel');
  if (allSessions.length === 0) {
    sessionList.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">Chưa có ca thực hành nào</div>`;
    livePanel?.classList.add('hidden');
    return;
  }

  livePanel?.classList.remove('hidden');

  sessionList.innerHTML = allSessions.map(s => `
    <div data-teacher-session-id="${s.id}" onclick="selectTeacherSession(${s.id})" class="p-4 rounded-xl border-2 transition cursor-pointer ${s.id === activeSessionId ? 'bg-emerald-100 border-emerald-600 ring-2 ring-emerald-200 shadow-md' : 'bg-white border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40'}">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-brand-800 bg-brand-50 px-2 py-0.5 rounded">Lớp ${s.class_name}</span>
        <span class="text-[11px] text-slate-500">${s.session_date}</span>
      </div>
      <h4 class="text-xs font-bold text-slate-900 mt-1.5">${s.title}</h4>
      <div class="flex items-center justify-between mt-2 pt-2 border-t text-[11px]">
        <span class="text-slate-500">${s.period_slot}</span>
        <span class="font-bold ${s.status === 'COMPLETED' ? 'text-emerald-600' : 'text-amber-600'}">${sessionStatusLabel(s.status)}</span>
      </div>
    </div>
  `).join('');

  selectTeacherSession(activeSessionId);
}

async function selectTeacherSession(sessionId, showLoading = true) {
  activeSessionId = sessionId;
  updateTeacherSessionSelectionHighlight();
  const s = allSessions.find(x => x.id === sessionId);
  if (!s) return;

  document.getElementById('tl-class-badge').textContent = `LỚP ${s.class_name}`;
  document.getElementById('tl-title').textContent = s.title;
  document.getElementById('tl-status').textContent = sessionStatusLabel(s.status);

  const grid = document.getElementById('teacher-groups-grid');
  const items = JSON.parse(s.planned_items || '[]');
  const location = s.approved_location === 'LAB' ? 'Phòng thực hành' : s.approved_location === 'CLASS' ? 'Lớp học' : 'Chờ cán bộ quyết định';
  const canStart = ['APPROVED_LAB', 'APPROVED_CLASS'].includes(s.status);
  const canReport = ['IN_PROGRESS', 'REDO_5S'].includes(s.status);
  grid.innerHTML = `
    <div class="col-span-2 p-5 rounded-xl border bg-slate-50 space-y-3">
      <div class="grid sm:grid-cols-2 gap-2 text-xs"><p><b>Địa điểm:</b> ${location}</p><p><b>Sĩ số:</b> ${s.student_count || 0}</p><p><b>Buổi:</b> ${s.shift === 'AFTERNOON' ? 'Chiều' : 'Sáng'}</p><p><b>Tiết:</b> ${s.period_start}–${s.period_end}</p></div>
      <div class="text-xs"><b>Thiết bị đề nghị:</b> ${items.map(i => `${typeof i === 'string' ? i : i.code} × ${typeof i === 'string' ? 1 : i.quantity}`).join(', ') || 'Không có'}</div>
      ${s.approval_note ? `<p class="text-xs text-rose-600"><b>Phản hồi cán bộ:</b> ${s.approval_note}</p>` : ''}
      ${s.report_review_note ? `<div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>Tin nhắn nghiệm thu 5S:</b> ${escapeRegisterReviewText(formatReportReviewNote(s.report_review_note))}</div>` : ''}
      <div class="flex gap-2 pt-2">
        ${canStart ? `<button onclick="startTeachingSession(${s.id})" class="px-4 py-2 bg-brand-600 text-white rounded-xl text-xs font-bold">Bắt đầu ca dạy</button>` : ''}
        ${canReport ? `<button onclick="openSessionReportModal(${s.id})" class="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold">${s.status === 'REDO_5S' ? 'Thực hiện lại 5S' : 'Báo cáo cuối ca'}</button>` : ''}
        ${s.status === 'COMPLETED' ? `<button onclick="duplicateTeacherSession(${s.id})" class="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold">Đăng ký lại</button>` : ''}
      </div>
    </div>`;
}

function renderTeacherTasks() {
  const wrapper = document.getElementById('teacher-task-box');
  const box = document.getElementById('teacher-task-list');
  if (!wrapper || !box) return;
  const statuses = new Set(['NEEDS_CHANGES','APPROVED_LAB','APPROVED_CLASS','IN_PROGRESS','REDO_5S','PENDING_ACCEPTANCE']);
  const tasks = allSessions.filter(item => statuses.has(item.status));
  wrapper.classList.toggle('hidden', tasks.length === 0);
  box.innerHTML = tasks.map(item => `<button onclick="selectTeacherSession(${item.id})" class="w-full p-3 rounded-xl border border-amber-200 bg-white hover:bg-amber-50 text-left flex justify-between gap-3">
    <span><b class="block text-xs">${escapeRegisterReviewText(item.title)}</b><span class="text-[11px] text-slate-500">${item.session_date} • ${escapeRegisterReviewText(item.period_slot)}</span></span>
    <span class="text-[10px] font-bold text-amber-800 shrink-0">${sessionStatusLabel(item.status)}</span>
  </button>`).join('');
}

function renderCommonSchedule() {
  const grid = document.getElementById('teacher-calendar-grid');
  const title = document.getElementById('teacher-calendar-title');
  const selectedLabel = document.getElementById('teacher-calendar-selected-label');
  const detail = document.getElementById('teacher-calendar-day-detail');
  if (!grid || !title || !selectedLabel || !detail) return;
  if (commonScheduleError) {
    grid.innerHTML = `<div class="col-span-7 rounded-xl border border-rose-700 bg-rose-950/40 p-4 text-xs text-rose-200">Không tải được lịch chung: ${escapeRegisterReviewText(commonScheduleError)}</div>`;
    detail.innerHTML = '';
    return;
  }
  renderScheduleCalendar('teacher', teacherCalendarMonth, teacherCalendarSelectedDate, grid, title, selectedLabel, detail);
}

function changeTeacherCalendarMonth(delta) {
  teacherCalendarMonth = new Date(teacherCalendarMonth.getFullYear(), teacherCalendarMonth.getMonth() + delta, 1);
  teacherCalendarSelectedDate = '';
  renderCommonSchedule();
}

function goTeacherCalendarToday() {
  const today = new Date();
  teacherCalendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  teacherCalendarSelectedDate = scheduleDateKey(today);
  renderCommonSchedule();
}

function selectTeacherCalendarDate(dateKey) {
  teacherCalendarSelectedDate = dateKey;
  renderCommonSchedule();
}

function updateTeacherSessionSelectionHighlight() {
  document.querySelectorAll('[data-teacher-session-id]').forEach(card => {
    const selected = Number(card.dataset.teacherSessionId) === Number(activeSessionId);
    card.classList.toggle('bg-emerald-100', selected);
    card.classList.toggle('border-emerald-600', selected);
    card.classList.toggle('ring-2', selected);
    card.classList.toggle('ring-emerald-200', selected);
    card.classList.toggle('shadow-md', selected);
    card.classList.toggle('bg-white', !selected);
    card.classList.toggle('border-slate-200', !selected);
  });
}

function sessionStatusLabel(status) {
  return ({
    PENDING: 'Chờ duyệt',
    APPROVED_LAB: 'Đã duyệt – Phòng thực hành',
    APPROVED_CLASS: 'Đã duyệt – Dạy tại lớp',
    IN_PROGRESS: 'Đang thực hiện',
    SUBMITTED: 'Đã gửi báo cáo',
    REVIEWED: 'Đã đánh giá',
    PENDING_ACCEPTANCE: 'Chờ đợi xác nhận',
    COMPLETED: 'Hoàn tất',
    REJECTED: 'Không đồng ý',
    NEEDS_CHANGES: 'Yêu cầu bổ sung',
    REDO_5S: 'Yêu cầu thực hiện lại',
    CANCELLED: 'Đã hủy'
  })[status] || 'Chưa xác định';
}

async function startTeachingSession(sessionId) {
  const res = await fetch(`/api/sessions/${sessionId}/status`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'IN_PROGRESS'})});
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Không thể bắt đầu ca', 'error');
  await loadSessions(); renderTeacherView(); showToast('Ca dạy đã bắt đầu');
}

function openSessionReportModal(sessionId) {
  activeSessionId = sessionId;
  const session = allSessions.find(item => item.id === sessionId);
  const planned = session ? JSON.parse(session.planned_items || '[]') : [];
  const plannedQuantities = {};
  planned.forEach(item => {
    const code = typeof item === 'string' ? item : item.code;
    const quantity = Number(typeof item === 'string' ? 1 : item.quantity || 1);
    if (code) plannedQuantities[code] = (plannedQuantities[code] || 0) + quantity;
  });
  teacherReportPlannedQuantities = plannedQuantities;
  teacherReportDamageItems = [];
  const damageEquipmentSelect = document.getElementById('report-damage-equipment');
  if (damageEquipmentSelect) {
    const plannedEquipment = allEquipment.filter(item => plannedQuantities[item.code]);
    damageEquipmentSelect.innerHTML = plannedEquipment.length
      ? '<option value="">-- Chọn thiết bị/dụng cụ --</option>' + plannedEquipment.map(item => `<option value="${item.id}">${escapeRegisterReviewText(item.name)} (${escapeRegisterReviewText(item.code)})</option>`).join('')
      : '<option value="">Phiếu không có thiết bị</option>';
  }
  const damageReason = document.getElementById('report-damage-reason');
  if (damageReason) damageReason.value = '';
  const damageQuantity = document.getElementById('report-damage-quantity');
  if (damageQuantity) damageQuantity.value = 1;
  renderTeacherReportDamages();
  const consumables = allEquipment.filter(item => item.stock_type === 'CONSUMABLE' && plannedQuantities[item.code]);
  const usageBox = document.getElementById('report-consumables');
  usageBox.innerHTML = consumables.length ? consumables.map(item => `
    <label class="flex items-center justify-between gap-3 p-2 rounded-lg border border-amber-200 bg-amber-50">
      <span><strong>${escapeRegisterReviewText(item.name)}</strong><span class="block text-[10px] text-slate-500">Đã mượn: ${plannedQuantities[item.code]} ${escapeRegisterReviewText(item.unit)}</span></span>
      <input type="number" min="0" max="${plannedQuantities[item.code]}" value="0" data-consumable-code="${escapeRegisterReviewText(item.code)}" class="w-20 p-2 border rounded-lg text-center font-bold" aria-label="Lượng đã dùng của ${escapeRegisterReviewText(item.name)}">
    </label>`).join('') : '<p class="text-[11px] text-slate-400">Phiếu này không mượn hóa chất tiêu hao.</p>';
  document.getElementById('report-5s-section').classList.remove('hidden');
  for (let i = 1; i <= 5; i++) {
    const checkbox = document.getElementById(`report-s${i}`);
    if (checkbox) checkbox.checked = false;
  }
  document.getElementById('modal-session-report').classList.remove('hidden');
}
function closeSessionReportModal(){ document.getElementById('modal-session-report').classList.add('hidden'); }

function syncTeacherReportDamageLimit() {
  const equipmentId = Number(document.getElementById('report-damage-equipment')?.value);
  const equipment = allEquipment.find(item => item.id === equipmentId);
  const input = document.getElementById('report-damage-quantity');
  if (!input || !equipment) return;
  const maximum = Number(teacherReportPlannedQuantities[equipment.code] || 1);
  input.max = maximum;
  input.value = Math.min(Math.max(1, Number(input.value || 1)), maximum);
}

function addTeacherReportDamage() {
  const equipmentId = Number(document.getElementById('report-damage-equipment')?.value);
  const equipment = allEquipment.find(item => item.id === equipmentId);
  const quantity = Number(document.getElementById('report-damage-quantity')?.value || 0);
  const reason = document.getElementById('report-damage-reason')?.value.trim() || '';
  const maximum = equipment ? Number(teacherReportPlannedQuantities[equipment.code] || 0) : 0;
  if (!equipment || quantity < 1 || quantity > maximum || !reason) {
    return showToast('Vui lòng chọn thiết bị, số lượng hợp lệ và nhập lý do sự cố', 'error');
  }
  const existingIndex = teacherReportDamageItems.findIndex(item => item.equipment_id === equipmentId);
  const damage = {equipment_id:equipmentId, quantity, reason, group_number:null};
  if (existingIndex >= 0) teacherReportDamageItems[existingIndex] = damage;
  else teacherReportDamageItems.push(damage);
  document.getElementById('report-damage-reason').value = '';
  renderTeacherReportDamages();
  showToast('Đã thêm sự cố vào báo cáo cuối ca', 'info');
}

function removeTeacherReportDamage(index) {
  teacherReportDamageItems.splice(index, 1);
  renderTeacherReportDamages();
}

function renderTeacherReportDamages() {
  const list = document.getElementById('report-damage-list');
  if (!list) return;
  list.innerHTML = teacherReportDamageItems.length ? teacherReportDamageItems.map((item, index) => {
    const equipment = allEquipment.find(entry => entry.id === item.equipment_id);
    return `<div class="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
      <div><b class="text-xs text-rose-800">${escapeRegisterReviewText(equipment?.name || 'Thiết bị')}</b><p class="text-[11px] text-slate-600">Số lượng: ${item.quantity} · ${escapeRegisterReviewText(item.reason)}</p></div>
      <button type="button" onclick="removeTeacherReportDamage(${index})" class="text-rose-600 hover:text-rose-800" title="Xóa sự cố">✕</button>
    </div>`;
  }).join('') : '<p class="text-[11px] text-slate-400">Không có sự cố được ghi nhận.</p>';
}

async function submitSessionReport() {
  const body = {notes:document.getElementById('report-notes').value,usage_items:[],damage_items:teacherReportDamageItems};
  document.querySelectorAll('[data-consumable-code]').forEach(input => {
    body.usage_items.push({code: input.dataset.consumableCode, used_quantity: Number(input.value || 0)});
  });
  for(let i=1;i<=5;i++) body[`s${i}`] = document.getElementById(`report-s${i}`).checked;
  if (![1, 2, 3, 4, 5].every(i => body[`s${i}`])) {
    return showToast('Vui lòng xác nhận đầy đủ 5 nội dung 5S trước khi gửi báo cáo', 'error');
  }
  const res = await fetch(`/api/sessions/${activeSessionId}/report`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Không thể gửi báo cáo', 'error');
  closeSessionReportModal(); await loadSessions(); renderTeacherView(); showToast('Đã gửi báo cáo, chờ đợi cán bộ xác nhận');
}

function filterClassesByGrade(loadCatalog = true) {
  const grade = document.getElementById('reg-grade').value;
  const select = document.getElementById('reg-class-select');
  if (!select) return;

  const classes = {
    '10': ['10 Sinh', '10 Toán', '10 Hóa', '10 Ghép'],
    '11': ['11 Sinh', '11 Toán', '11 Hóa', '11 Ghép', '11 chuyên đề'],
    '12': ['12 Sinh', '12 Toán', '12 Hóa', '12 Ghép', '12 chuyên đề']
  };

  const list = classes[grade] || classes['12'];
  select.innerHTML = list.map(c => `<option value="${c}">${c}</option>`).join('');
  if (loadCatalog && !registrationCopyMode) loadLessonCatalog();
}

function handleRegistrationGradeChange() {
  // Đổi khối là đổi chương trình học: không được giữ bài và thiết bị của khối cũ.
  registrationCopyMode = false;
  selectedTeacherRegEquipment.clear();
  filterClassesByGrade(false);
  updateTeacherRegTotals();
  switchTeacherRegZone('GENERAL');
  loadLessonCatalog();
}

let currentSessionShift = 'MORNING';
let teacherRegZone = 'GENERAL';
let selectedTeacherRegEquipment = new Map();
let currentLessonCatalog = [];
let teacherUsageHistory = [];
let registrationCopyMode = false;

async function loadLessonCatalog() {
  const grade = document.getElementById('reg-grade')?.value;
  const className = document.getElementById('reg-class-select')?.value;
  const select = document.getElementById('reg-lesson-select');
  if (!grade || !className || !select) return;
  select.innerHTML = '<option value="">Đang tải danh sách bài phù hợp...</option>';
  try {
    const res = await fetch(`/api/lesson-catalog?grade=${encodeURIComponent(grade)}&class_name=${encodeURIComponent(className)}`);
    if (!res.ok) throw new Error('Không tải được danh mục bài thực hành');
    const data = await res.json();
    currentLessonCatalog = data.lessons || [];
    select.innerHTML = `<option value="">-- Chọn tên bài thực hành ${data.class_type || ''} --</option>` + currentLessonCatalog.map(lesson =>
      `<option value="${lesson.id}">${lesson.title}</option>`
    ).join('') + '<option value="CUSTOM">✍ Tự nhập tên bài khác</option>';
    document.getElementById('reg-lesson-detail')?.classList.add('hidden');
    document.getElementById('reg-custom-title-wrap')?.classList.add('hidden');
    const customTitle = document.getElementById('reg-custom-title');
    if (customTitle) customTitle.value = '';
    const status = document.getElementById('reg-suggestion-status');
    if (status) status.textContent = '';
  } catch (error) {
    currentLessonCatalog = [];
    select.innerHTML = '<option value="">Không tải được danh mục bài thực hành</option>';
    showToast(error.message, 'error');
  }
}

function handleRegistrationClassChange() {
  if (registrationCopyMode) {
    saveRegistrationDraft();
    return;
  }
  loadLessonCatalog();
}

function applySelectedLesson() {
  registrationCopyMode = false;
  const selectedValue = document.getElementById('reg-lesson-select')?.value || '';
  const customWrap = document.getElementById('reg-custom-title-wrap');
  if (selectedValue === 'CUSTOM') {
    customWrap?.classList.remove('hidden');
    document.getElementById('reg-lesson-detail')?.classList.add('hidden');
    selectedTeacherRegEquipment.clear();
    updateTeacherRegTotals();
    const status = document.getElementById('reg-suggestion-status');
    if (status) status.textContent = 'Hãy tự chọn thiết bị cần mượn';
    switchTeacherRegZone('GENERAL');
    return;
  }
  customWrap?.classList.add('hidden');
  const lessonId = parseInt(selectedValue || '0');
  const lesson = currentLessonCatalog.find(item => item.id === lessonId);
  const detail = document.getElementById('reg-lesson-detail');
  const status = document.getElementById('reg-suggestion-status');
  if (!lesson) {
    detail?.classList.add('hidden');
    if (status) status.textContent = '';
    return;
  }

  selectedTeacherRegEquipment = new Map(lesson.suggested_items.map(item => [item.code, 1]));
  updateTeacherRegTotals();
  if (detail) {
    const missing = lesson.unmatched_suggestions?.length
      ? `<p class="mt-2 text-amber-700"><b>Chưa có trong kiểm kê:</b> ${lesson.unmatched_suggestions.join('; ')}</p>`
      : '';
    detail.innerHTML = `<p><b>Hoạt động chính:</b> ${lesson.activity || 'Chưa cập nhật'}</p>${missing}`;
    detail.classList.remove('hidden');
  }
  if (status) status.textContent = `Đã gợi ý ${lesson.suggested_items.length} thiết bị — hãy kiểm tra số lượng`;
  switchTeacherRegZone('GENERAL');
}

function updateTeacherRegTotals() {
  const count = selectedTeacherRegEquipment.size;
  const totalQuantity = Array.from(selectedTeacherRegEquipment.values()).reduce((sum, quantity) => sum + Number(quantity || 0), 0);
  const countElement = document.getElementById('reg-selected-count');
  const quantityElement = document.getElementById('reg-selected-quantity');
  if (countElement) countElement.textContent = count;
  if (quantityElement) quantityElement.textContent = totalQuantity;
  updateClassroomEligibility();
  saveRegistrationDraft();
}

function classroomRestriction() {
  for (const code of selectedTeacherRegEquipment.keys()) {
    const item = allEquipment.find(equipment => equipment.code === code);
    if (item && (item.stock_type === 'CONSUMABLE' || item.usage_scope === 'LAB_ONLY')) return item;
  }
  return null;
}

function updateClassroomEligibility() {
  const select = document.getElementById('reg-location');
  const note = document.getElementById('reg-location-note');
  if (!select) return;
  const restricted = classroomRestriction();
  const classOption = Array.from(select.options).find(option => option.value === 'CLASS');
  if (classOption) classOption.disabled = !!restricted;
  if (restricted && select.value === 'CLASS') select.value = 'LAB';
  if (note) {
    note.textContent = restricted ? `${restricted.name} chỉ được sử dụng trong phòng thực hành.` : 'Phiếu không có hóa chất hoặc thiết bị bắt buộc dùng tại phòng thực hành.';
    note.className = restricted ? 'mt-1 text-[10px] text-rose-600' : 'mt-1 text-[10px] text-emerald-700';
  }
}

function registrationDraftKey() { return `biolab_registration_draft_${currentUser?.id || 'guest'}`; }
function saveRegistrationDraft() {
  if (!currentUser || document.getElementById('modal-register-session')?.classList.contains('hidden')) return;
  const value = id => document.getElementById(id)?.value || '';
  localStorage.setItem(registrationDraftKey(), JSON.stringify({grade:value('reg-grade'),className:value('reg-class-select'),lesson:value('reg-lesson-select'),customTitle:value('reg-custom-title'),date:value('reg-date'),students:value('reg-student-count'),location:value('reg-location'),notes:value('reg-notes'),shift:currentSessionShift,period:value('reg-period'),items:Array.from(selectedTeacherRegEquipment.entries()),copyMode:registrationCopyMode}));
}

function setSessionShift(shift) {
  currentSessionShift = shift;
  const btnMorning = document.getElementById('btn-shift-morning');
  const btnAfternoon = document.getElementById('btn-shift-afternoon');
  const periodSelect = document.getElementById('reg-period');
  if (!periodSelect) return;

  if (shift === 'MORNING') {
    btnMorning.className = 'py-2 px-3 rounded-xl border-2 border-brand-600 bg-brand-50 text-brand-800 font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm';
    btnAfternoon.className = 'py-2 px-3 rounded-xl border border-slate-200 bg-white text-slate-600 font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-slate-50';
    periodSelect.innerHTML = `
      <option value="Tiết 1 (Sáng)">Tiết 1 (Sáng)</option>
      <option value="Tiết 2 (Sáng)">Tiết 2 (Sáng)</option>
      <option value="Tiết 3 (Sáng)">Tiết 3 (Sáng)</option>
      <option value="Tiết 4 (Sáng)">Tiết 4 (Sáng)</option>
      <option value="Tiết 5 (Sáng)">Tiết 5 (Sáng)</option>
      <option value="Tiết 1-2 (Sáng)" selected>Tiết 1-2 (Sáng)</option>
      <option value="Tiết 2-3 (Sáng)" selected>Tiết 2-3 (Sáng)</option>
      <option value="Tiết 3-4 (Sáng)">Tiết 3-4 (Sáng)</option>
      <option value="Tiết 4-5 (Sáng)">Tiết 4-5 (Sáng)</option>
    `;
  } else {
    btnAfternoon.className = 'py-2 px-3 rounded-xl border-2 border-brand-600 bg-brand-50 text-brand-800 font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm';
    btnMorning.className = 'py-2 px-3 rounded-xl border border-slate-200 bg-white text-slate-600 font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-slate-50';
    periodSelect.innerHTML = `
      <option value="Tiết 1 (Chiều)">Tiết 1 (Chiều)</option>
      <option value="Tiết 2 (Chiều)">Tiết 2 (Chiều)</option>
      <option value="Tiết 1-2 (Chiều)" selected>Tiết 1-2 (Chiều)</option>
    `;
  }
  saveRegistrationDraft();
}

function switchTeacherRegZone(zoneCode) {
  teacherRegZone = zoneCode;
  ['a', 'b', 'c', 'd', 'e'].forEach(z => {
    const btn = document.getElementById(`btn-trz-${z}`);
    if (btn) {
      const isTarget = `ZONE_${z.toUpperCase()}` === zoneCode;
      btn.className = isTarget ? 'py-1.5 px-1 text-center rounded-lg bg-teal-600 text-white shadow-sm' : 'py-1.5 px-1 text-center rounded-lg bg-slate-100 text-slate-700';
    }
  });

  const list = document.getElementById('reg-equipment-zone-list');
  if (!list) return;
  const searchTerm = (document.getElementById('reg-equipment-search')?.value || '').trim().toLocaleLowerCase('vi');
  const items = (zoneCode === 'GENERAL' ? allEquipment : allEquipment.filter(e => e.zone === zoneCode))
    .filter(e => !searchTerm || e.name.toLocaleLowerCase('vi').includes(searchTerm));

  if (items.length === 0) {
    list.innerHTML = `<div class="text-center py-4 text-xs text-slate-400">Không có thiết bị trong phân khu này</div>`;
    return;
  }

  list.innerHTML = items.map(eq => {
    const isChecked = selectedTeacherRegEquipment.has(eq.code);
    const selectedQuantity = selectedTeacherRegEquipment.get(eq.code) || 1;
    return `
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-2 rounded-lg hover:bg-white text-xs border border-transparent hover:border-slate-200 transition ${isChecked ? 'bg-teal-50/70 border-teal-200' : ''}">
        <div class="flex items-center gap-2.5 min-w-0">
          <input type="checkbox" onchange="toggleTeacherRegItem('${eq.code}')" ${isChecked ? 'checked' : ''} class="w-4 h-4 text-brand-600 rounded">
          <div class="min-w-0">
            <span class="font-bold text-slate-900">${eq.name}</span>
            <span class="text-[10px] text-slate-400 block font-mono whitespace-nowrap">${eq.code} • ${eq.unit}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 ${isChecked ? 'w-full sm:w-auto p-2 sm:p-0 bg-white/70 sm:bg-transparent rounded-lg' : ''}">
          ${isChecked ? `<div class="flex flex-1 sm:flex-none items-center justify-between sm:justify-start gap-1 text-xs font-bold text-brand-800">
            <span class="mr-1">Số lượng</span>
            <button type="button" onclick="changeTeacherRegQuantity('${eq.code}', -1)" class="w-8 h-8 rounded-lg border border-brand-300 bg-white text-brand-700 font-extrabold">−</button>
            <input aria-label="Số lượng ${eq.name}" type="number" min="1" max="${eq.available_qty}" value="${selectedQuantity}" oninput="updateTeacherRegQuantity('${eq.code}', this.value, false)" onchange="updateTeacherRegQuantity('${eq.code}', this.value, true)" class="w-16 p-1.5 border-2 border-brand-300 bg-white rounded-lg text-center text-sm font-extrabold text-brand-800">
            <button type="button" onclick="changeTeacherRegQuantity('${eq.code}', 1)" class="w-8 h-8 rounded-lg border border-brand-300 bg-white text-brand-700 font-extrabold">+</button>
          </div>` : ''}
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 whitespace-nowrap">Tồn: ${eq.available_qty} ${eq.unit}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderTeacherEquipmentList() {
  switchTeacherRegZone(teacherRegZone);
}

function changeTeacherRegQuantity(code, delta) {
  const current = Number(selectedTeacherRegEquipment.get(code) || 1);
  updateTeacherRegQuantity(code, current + delta, true);
}

function toggleTeacherRegItem(code) {
  if (selectedTeacherRegEquipment.has(code)) {
    selectedTeacherRegEquipment.delete(code);
  } else {
    selectedTeacherRegEquipment.set(code, 1);
  }
  updateTeacherRegTotals();
  switchTeacherRegZone(teacherRegZone);
}

function updateTeacherRegQuantity(code, value, refresh = false) {
  const equipment = allEquipment.find(item => item.code === code);
  const maxQuantity = Math.max(1, Number(equipment?.available_qty || 1));
  const quantity = Math.min(maxQuantity, Math.max(1, parseInt(value || '1')));
  selectedTeacherRegEquipment.set(code, quantity);
  updateTeacherRegTotals();
  if (refresh) switchTeacherRegZone(teacherRegZone);
}

function clearTeacherRegEquipment() {
  selectedTeacherRegEquipment.clear();
  updateTeacherRegTotals();
  switchTeacherRegZone(teacherRegZone);
}

async function openRegisterSessionModal() {
  registrationCopyMode = false;
  filterClassesByGrade();
  setSessionShift('MORNING');
  selectedTeacherRegEquipment.clear();
  updateTeacherRegTotals();
  switchTeacherRegZone('GENERAL');
  document.getElementById('modal-register-session').classList.remove('hidden');
  await loadLessonCatalog();
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(registrationDraftKey()) || 'null'); } catch (_) {}
  if (draft) {
    registrationCopyMode = !!draft.copyMode;
    document.getElementById('reg-grade').value=draft.grade||'12'; filterClassesByGrade(false);
    document.getElementById('reg-class-select').value=draft.className||document.getElementById('reg-class-select').value; await loadLessonCatalog();
    document.getElementById('reg-lesson-select').value=draft.lesson||'';
    document.getElementById('reg-custom-title').value=draft.customTitle||'';
    document.getElementById('reg-custom-title-wrap').classList.toggle('hidden',draft.lesson!=='CUSTOM');
    document.getElementById('reg-date').value=draft.date||''; document.getElementById('reg-student-count').value=draft.students||35;
    document.getElementById('reg-notes').value=draft.notes||''; setSessionShift(draft.shift||'MORNING');
    document.getElementById('reg-period').value=draft.period||document.getElementById('reg-period').value;
    selectedTeacherRegEquipment=new Map(draft.items||[]); document.getElementById('reg-location').value=draft.location||'LAB';
    updateTeacherRegTotals(); switchTeacherRegZone('GENERAL'); showToast('Đã khôi phục phiếu đang soạn','info');
  }
}

function closeRegisterSessionModal() {
  document.getElementById('modal-register-session').classList.add('hidden');
  closeRegisterReview();
}

function closeRegisterReview() {
  document.getElementById('modal-register-review')?.classList.add('hidden');
}

function escapeRegisterReviewText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character]);
}

function formatReportReviewNote(value) {
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    return parsed?.reason || value;
  } catch (_) {
    return value;
  }
}

function openRegisterReview() {
  const lessonSelection = document.getElementById('reg-lesson-select').value;
  const isCustomLesson = lessonSelection === 'CUSTOM';
  const lessonCatalogId = isCustomLesson ? null : parseInt(lessonSelection || '0');
  const lesson = currentLessonCatalog.find(item => item.id === lessonCatalogId);
  const title = isCustomLesson ? document.getElementById('reg-custom-title').value.trim() : (lesson?.title || '');
  const cls = document.getElementById('reg-class-select')?.value.trim() || '';
  const date = document.getElementById('reg-date').value;
  const slot = document.getElementById('reg-period').value;
  const periodNumbers = slot.match(/\d/g)?.map(Number) || [1];
  const periodStart = periodNumbers[0];
  const periodEnd = periodNumbers[periodNumbers.length - 1];
  const selectedItems = Array.from(selectedTeacherRegEquipment.entries());

  if ((!lessonCatalogId && !isCustomLesson) || !title || !cls || !date) {
    showToast(isCustomLesson ? 'Vui lòng nhập tên bài, lớp và ngày dạy' : 'Vui lòng chọn tên bài, lớp và ngày dạy', 'error');
    return;
  }
  if (selectedItems.length === 0) {
    showToast('Vui lòng chọn ít nhất một thiết bị và kiểm tra số lượng', 'error');
    return;
  }
  const restricted = classroomRestriction();
  if (document.getElementById('reg-location').value === 'CLASS' && restricted) return showToast(`${restricted.name} chỉ được sử dụng trong phòng thực hành`, 'error');

  const itemRows = selectedItems.map(([code, quantity]) => {
    const equipment = allEquipment.find(item => item.code === code);
    return `<tr class="border-t border-slate-100 hover:bg-slate-50/80 transition-colors">
      <td class="px-3 sm:px-4 py-3 align-middle">
        <span class="block font-bold text-slate-900 leading-snug">${escapeRegisterReviewText(equipment?.name || code)}</span>
        <span class="block mt-1 text-[10px] text-slate-400 font-mono whitespace-nowrap">${escapeRegisterReviewText(code)}</span>
      </td>
      <td class="px-2 sm:px-3 py-3 text-center align-middle">
        <span class="inline-flex min-w-8 h-8 px-2 items-center justify-center rounded-lg bg-teal-50 text-brand-800 font-extrabold">${quantity}</span>
      </td>
      <td class="px-3 sm:px-4 py-3 text-right align-middle text-slate-600 font-medium whitespace-nowrap">${escapeRegisterReviewText(equipment?.unit || '')}</td>
    </tr>`;
  }).join('');
  const totalQuantity = selectedItems.reduce((sum, [, quantity]) => sum + Number(quantity), 0);
  const conflicts = commonSchedule.filter(item => item.session_date === date && item.shift === currentSessionShift && item.period_start <= periodEnd && item.period_end >= periodStart);
  const conflictWarning = conflicts.length ? `<div class="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
    <p class="font-bold">⚠ Khung giờ này đã có ${conflicts.length} phiếu đăng ký</p>
    ${conflicts.map(item => `<p class="mt-1 text-[11px]">${escapeRegisterReviewText(item.teacher_name)} • Lớp ${escapeRegisterReviewText(item.class_name)} • Tiết ${item.period_start}–${item.period_end} • ${sessionStatusLabel(item.status)}</p>`).join('')}
    <p class="mt-2 text-[11px]">Bạn vẫn có thể gửi phiếu. Cán bộ quản lý sẽ quyết định địa điểm phù hợp.</p>
  </div>` : '';
  document.getElementById('reg-review-summary').innerHTML = `
    ${conflictWarning}
    <div class="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1">
      <p><b>Bài thực hành:</b> ${escapeRegisterReviewText(title)}</p>
      <p><b>Lớp:</b> ${escapeRegisterReviewText(cls)} • <b>Ngày:</b> ${escapeRegisterReviewText(date)}</p>
      <p><b>Thời gian:</b> ${escapeRegisterReviewText(slot)} • <b>Địa điểm đề nghị:</b> ${document.getElementById('reg-location').value === 'CLASS' ? 'Lớp học' : 'Phòng thực hành'}</p>
    </div>
    <div class="rounded-2xl border border-teal-200 overflow-hidden bg-white">
      <div class="bg-teal-50 px-4 py-3 font-bold text-teal-900 flex flex-wrap items-center justify-between gap-2">
        <span>Thiết bị đã chọn</span>
        <span class="text-xs font-semibold">${selectedItems.length} loại • Tổng số lượng: ${totalQuantity}</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full table-fixed">
          <colgroup><col class="w-[55%]"><col class="w-[25%]"><col class="w-[20%]"></colgroup>
          <thead class="bg-slate-50/80 text-slate-500 border-t border-slate-100">
            <tr>
              <th class="px-3 sm:px-4 py-2.5 text-left font-semibold">Thiết bị</th>
              <th class="px-2 sm:px-3 py-2.5 text-center font-semibold whitespace-nowrap">Số lượng</th>
              <th class="px-3 sm:px-4 py-2.5 text-right font-semibold whitespace-nowrap">Đơn vị</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>
      </div>
    </div>`;
  document.getElementById('modal-register-review').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

async function submitRegisterSession() {
  const lessonSelection = document.getElementById('reg-lesson-select').value;
  const isCustomLesson = lessonSelection === 'CUSTOM';
  const lessonCatalogId = isCustomLesson ? null : parseInt(lessonSelection || '0');
  const lesson = currentLessonCatalog.find(item => item.id === lessonCatalogId);
  const title = isCustomLesson ? document.getElementById('reg-custom-title').value.trim() : (lesson?.title || '');
  const grade = parseInt(document.getElementById('reg-grade').value);
  const clsSelect = document.getElementById('reg-class-select');
  const cls = clsSelect ? clsSelect.value.trim() : '12 Sinh';
  const date = document.getElementById('reg-date').value;
  const slot = document.getElementById('reg-period').value;
  const periodNumbers = slot.match(/\d/g)?.map(Number) || [1];

  const checked = Array.from(selectedTeacherRegEquipment.entries());

  if ((!lessonCatalogId && !isCustomLesson) || !title || !cls || !date) {
    showToast(isCustomLesson ? 'Vui lòng nhập tên bài, lớp và ngày dạy' : 'Vui lòng chọn tên bài, lớp và ngày dạy', 'error');
    return;
  }

  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title, lesson_catalog_id: lessonCatalogId, grade_level: grade, class_name: cls, session_date: date, period_slot: slot,
      planned_items: checked.map(([code, quantity]) => ({code, quantity})),
      shift: currentSessionShift, period_start: periodNumbers[0], period_end: periodNumbers[periodNumbers.length - 1],
      student_count: parseInt(document.getElementById('reg-student-count').value || '0'),
      requested_location: document.getElementById('reg-location').value,
      request_notes: document.getElementById('reg-notes').value
    })
  });

  const data = await res.json();
  if (res.ok) {
    localStorage.removeItem(registrationDraftKey());
    showToast('Đăng ký ca thực hành thành công! Đã gửi chuông báo cho Cán bộ phòng');
    playChimeSound();
    closeRegisterReview();
    closeRegisterSessionModal();
    await loadSessions();
    renderTeacherView();
  } else {
    showToast(data.error || 'Không thể gửi phiếu đăng ký', 'error');
  }
}

async function duplicateTeacherSession(sessionId) {
  const source=allSessions.find(item=>item.id===sessionId); if(!source)return;
  localStorage.removeItem(registrationDraftKey()); await openRegisterSessionModal();
  registrationCopyMode=true;
  document.getElementById('reg-grade').value=String(source.grade_level||12); filterClassesByGrade(false);
  document.getElementById('reg-class-select').value=source.class_name; await loadLessonCatalog();
  const lesson=currentLessonCatalog.find(item=>item.id===source.lesson_catalog_id);
  document.getElementById('reg-lesson-select').value=lesson?String(lesson.id):'CUSTOM';
  if(!lesson){document.getElementById('reg-custom-title-wrap').classList.remove('hidden');document.getElementById('reg-custom-title').value=source.title;}
  document.getElementById('reg-date').value=''; document.getElementById('reg-student-count').value=source.student_count||35;
  document.getElementById('reg-notes').value=source.request_notes||''; setSessionShift(source.shift||'MORNING'); document.getElementById('reg-period').value=source.period_slot;
  selectedTeacherRegEquipment=new Map(JSON.parse(source.planned_items||'[]').map(item=>[typeof item==='string'?item:item.code,typeof item==='string'?1:item.quantity]));
  document.getElementById('reg-location').value=source.requested_location||'LAB'; updateTeacherRegTotals(); switchTeacherRegZone('GENERAL'); saveRegistrationDraft();
  showToast('Đã sao chép phiếu. Vui lòng chọn ngày mới và kiểm tra lại.','info');
}

async function openGradeModal(gNum) {
  activeGradeGroup = gNum;
  document.getElementById('grade-modal-title').textContent = `Đánh Giá & Chấm Điểm: Nhóm ${gNum}`;

  try {
    const res = await fetch(`/api/submissions?session_id=${activeSessionId}&group_number=${gNum}`);
    const sub = await res.json();

    const imgContainer = document.getElementById('grade-images-container');
    const noteEl = document.getElementById('grade-student-note');

    if (sub && sub.id) {
      const photos = JSON.parse(sub.result_images || '[]');
      if (sub.bench_photo_url) photos.push(sub.bench_photo_url);
      if (sub.zone_photo_url) photos.push(sub.zone_photo_url);
      if (photos.length > 0) {
        imgContainer.innerHTML = photos.map(url => `<img src="${url}" class="rounded-lg h-24 w-full object-cover border">`).join('');
      } else {
        imgContainer.innerHTML = `<div class="col-span-2 text-center py-4 text-xs text-slate-400">Chưa tải ảnh</div>`;
      }
      noteEl.textContent = sub.experiment_note || 'Chưa có ghi chú';
      document.getElementById('grade-score').value = sub.teacher_score || '';
      document.getElementById('grade-rating').value = sub.teacher_rating || 'Xuất sắc';
      document.getElementById('grade-comment').value = sub.teacher_comment || '';
      document.getElementById('grade-5s-approved').checked = !!sub.teacher_5s_approved;
    } else {
      imgContainer.innerHTML = `<div class="col-span-2 text-center py-4 text-xs text-slate-400">Nhóm chưa nộp bài</div>`;
      noteEl.textContent = 'Chưa có ghi chú';
    }

    document.getElementById('modal-grade-group').classList.remove('hidden');
  } catch (e) {
    console.error("Lỗi nạp modal chấm điểm:", e);
  }
}

function closeGradeModal() {
  document.getElementById('modal-grade-group').classList.add('hidden');
}

async function submitTeacherGrade() {
  const score = parseFloat(document.getElementById('grade-score').value);
  const rating = document.getElementById('grade-rating').value;
  const comment = document.getElementById('grade-comment').value;
  const is5S = document.getElementById('grade-5s-approved').checked;

  const res = await fetch('/api/submissions/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: activeSessionId,
      group_number: activeGradeGroup,
      teacher_score: score,
      teacher_rating: rating,
      teacher_comment: comment,
      teacher_5s_approved: is5S ? 1 : 0
    })
  });

  const data = await res.json();
  if (res.ok) {
    showToast(`Đã lưu điểm cho Nhóm ${activeGradeGroup}!`);
    playChimeSound();
    closeGradeModal();
    selectTeacherSession(activeSessionId);
  } else {
    showToast(data.error || 'Không thể duyệt bài', 'error');
  }
}

// ================= 8. ADMIN / LAB MANAGER FLOW =================
function renderAdminView() {
  filterAdminZone(currentAdminZoneFilter);
  renderAdminBookingApprovals();
  renderAdminPostSessionAcceptance();
  renderAdminBreakages();
  renderTeacherStatsTable();
  renderAdminCalendar();
}

function switchAdminTab(tabName) {
  const tabs = [
    { name: 'inventory', btnId: 'tab-admin-inv', contentId: 'admin-tab-inventory' },
    { name: 'sessions', btnId: 'tab-admin-ses', contentId: 'admin-tab-sessions' },
    { name: 'acceptance', btnId: 'tab-admin-acc', contentId: 'admin-tab-acceptance' },
    { name: 'teachers-summary', btnId: 'tab-admin-tea', contentId: 'admin-tab-teachers-summary' },
    { name: 'calendar', btnId: 'tab-admin-cal', contentId: 'admin-tab-calendar' },
    { name: 'breakages', btnId: 'tab-admin-brk', contentId: 'admin-tab-breakages' },
    { name: 'reports', btnId: 'tab-admin-rep', contentId: 'admin-tab-reports' }
  ];

  tabs.forEach(t => {
    const tabBtn = document.getElementById(t.btnId);
    const tabContent = document.getElementById(t.contentId);
    if (tabBtn && tabContent) {
      if (t.name === tabName) {
        tabBtn.className = 'py-3 px-4 rounded-xl bg-brand-600 text-white flex items-center gap-1.5 text-left';
        tabContent.classList.remove('hidden');
      } else {
        tabBtn.className = 'py-3 px-4 rounded-xl text-slate-600 hover:bg-slate-100 flex items-center gap-1.5 text-left';
        tabContent.classList.add('hidden');
      }
    }
  });

  if (tabName === 'teachers-summary') {
    renderTeacherStatsTable();
  }
  if (tabName === 'calendar') renderAdminCalendar();
  if (window.lucide) lucide.createIcons();
}

function scheduleDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function changeAdminCalendarMonth(delta) {
  adminCalendarMonth = new Date(adminCalendarMonth.getFullYear(), adminCalendarMonth.getMonth() + delta, 1);
  adminCalendarSelectedDate = '';
  renderAdminCalendar();
}

function goAdminCalendarToday() {
  const today = new Date();
  adminCalendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  adminCalendarSelectedDate = scheduleDateKey(today);
  renderAdminCalendar();
}

function selectAdminCalendarDate(dateKey) {
  adminCalendarSelectedDate = dateKey;
  renderAdminCalendar();
}

function renderScheduleCalendar(prefix, visibleMonth, selectedDate, grid, title, selectedLabel, detail) {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const monthSchedules = commonSchedule.filter(item => item.session_date?.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`));
  const todayKey = scheduleDateKey(new Date());
  let selectedKey = selectedDate;
  if (!selectedKey) {
    selectedKey = todayKey.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`) ? todayKey : (monthSchedules[0]?.session_date || '');
    if (prefix === 'teacher') teacherCalendarSelectedDate = selectedKey;
    else adminCalendarSelectedDate = selectedKey;
  }
  title.textContent = `Tháng ${month + 1} ${year}`;
  selectedLabel.textContent = selectedKey
    ? new Intl.DateTimeFormat('vi-VN', {weekday:'long', day:'numeric', month:'long', year:'numeric'}).format(new Date(`${selectedKey}T12:00:00`))
    : 'Chọn một ngày để xem lịch';
  const firstDay = new Date(year, month, 1);
  const sundayOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = sundayOffset - 1; i >= 0; i--) cells.push(`<div class="h-11 flex items-center justify-center text-xs text-slate-300">${previousMonthDays - i}</div>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const key = scheduleDateKey(new Date(year, month, day));
    const sessions = commonSchedule.filter(item => item.session_date === key);
    const selected = key === selectedKey;
    const isToday = key === todayKey;
    const selectFunction = prefix === 'teacher' ? 'selectTeacherCalendarDate' : 'selectAdminCalendarDate';
    cells.push(`<button type="button" onclick="${selectFunction}('${key}')" title="${sessions.length} ca thực hành" class="relative h-11 flex items-center justify-center rounded-full text-sm font-semibold transition ${selected ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-300/50' : isToday ? 'ring-2 ring-emerald-500 text-emerald-700' : 'text-slate-700 hover:bg-emerald-50'}">
      ${day}${sessions.length ? `<span class="absolute bottom-1 w-1.5 h-1.5 rounded-full ${selected ? 'bg-white' : 'bg-emerald-500'}"></span>` : ''}
    </button>`);
  }
  const totalCells = Math.ceil((sundayOffset + daysInMonth) / 7) * 7;
  for (let day = 1; cells.length < totalCells; day++) cells.push(`<div class="h-11 flex items-center justify-center text-xs text-slate-300">${day}</div>`);
  grid.innerHTML = cells.join('');

  const selectedSessions = selectedKey ? commonSchedule.filter(item => item.session_date === selectedKey) : [];
  detail.innerHTML = selectedKey
    ? selectedSessions.length ? selectedSessions.map(item => `<div class="rounded-xl border border-emerald-200 bg-white p-3 text-left shadow-sm">
        <div class="flex flex-wrap justify-between gap-2"><b class="text-xs text-emerald-700">${item.shift === 'AFTERNOON' ? 'Chiều' : 'Sáng'} · Tiết ${item.period_start}–${item.period_end}</b><span class="text-[10px] font-bold text-emerald-600">${sessionStatusLabel(item.status)}</span></div>
        <p class="mt-1 text-xs font-semibold text-slate-900">${escapeRegisterReviewText(item.teacher_name)} · Lớp ${escapeRegisterReviewText(item.class_name)}</p>
        <p class="text-[11px] text-slate-500">${escapeRegisterReviewText(item.title)}</p>
      </div>`).join('') : '<p class="py-4 text-xs text-slate-400">Ngày này chưa có ca thực hành.</p>'
    : '<p class="py-4 text-xs text-slate-400">Chọn một ngày trên lịch để xem chi tiết các ca.</p>';
}

function renderAdminCalendar() {
  const grid = document.getElementById('admin-calendar-grid');
  const title = document.getElementById('admin-calendar-title');
  const selectedLabel = document.getElementById('admin-calendar-selected-label');
  const detail = document.getElementById('admin-calendar-day-detail');
  if (!grid || !title || !selectedLabel || !detail) return;
  if (commonScheduleError) {
    grid.innerHTML = `<div class="col-span-7 p-6 text-center text-xs text-rose-300">Không tải được lịch: ${escapeRegisterReviewText(commonScheduleError)}</div>`;
    detail.innerHTML = '';
    return;
  }
  renderScheduleCalendar('admin', adminCalendarMonth, adminCalendarSelectedDate, grid, title, selectedLabel, detail);
  if (window.lucide) lucide.createIcons();
}

async function renderTeacherStatsTable() {
  const tbody = document.getElementById('admin-teacher-stats-tbody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/stats/teachers-summary');
    const lessons = await res.json();
    teacherUsageHistory = Array.isArray(lessons) ? lessons : [];
    renderFilteredTeacherUsageHistory();
  } catch (e) {
    console.error("Lỗi tải lịch sử dùng phòng thí nghiệm:", e);
  }
}

function filterTeacherUsageHistory() {
  renderFilteredTeacherUsageHistory();
}

function renderFilteredTeacherUsageHistory() {
  const tbody = document.getElementById('admin-teacher-stats-tbody');
  if (!tbody) return;
  const searchTerm = (document.getElementById('teacher-stats-search')?.value || '').trim().toLocaleLowerCase('vi');
  const lessons = teacherUsageHistory.filter(lesson => !searchTerm
    || String(lesson.teacher_name || '').toLocaleLowerCase('vi').includes(searchTerm)
    || String(lesson.title || '').toLocaleLowerCase('vi').includes(searchTerm));
  const sortMode = document.getElementById('teacher-history-sort')?.value || 'DATE_DESC';
  lessons.sort((left, right) => {
    if (sortMode === 'TEACHER_ASC' || sortMode === 'TEACHER_DESC') {
      const comparison = String(left.teacher_name || '').localeCompare(String(right.teacher_name || ''), 'vi', {sensitivity: 'base'});
      return sortMode === 'TEACHER_ASC' ? comparison : -comparison;
    }
    const comparison = String(left.session_date || '').localeCompare(String(right.session_date || ''));
    return sortMode === 'DATE_ASC' ? comparison : -comparison;
  });

    if (lessons.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-xs text-slate-400">${searchTerm ? 'Không tìm thấy giáo viên hoặc bài thực hành phù hợp' : 'Chưa có phiếu nào trong lịch sử sử dụng'}</td></tr>`;
      return;
    }

    const rows = [];
    lessons.forEach(lesson => {
      const location = lesson.approved_location === 'LAB' ? 'Phòng thực hành' : lesson.approved_location === 'CLASS' ? 'Lớp học' : lesson.requested_location === 'CLASS' ? 'Đề nghị tại lớp' : 'Đề nghị phòng TH';
      const plannedItems = (() => { try { return JSON.parse(lesson.planned_items || '[]'); } catch (_) { return []; } })();
      const equipmentText = plannedItems.map(item => {
        const code = typeof item === 'string' ? item : item.code;
        const quantity = typeof item === 'string' ? 1 : Number(item.quantity || 1);
        const equipment = allEquipment.find(entry => entry.code === code);
        return `${escapeRegisterReviewText(equipment?.name || code || 'Thiết bị')} × ${quantity}`;
      }).join('<br>') || '<span class="text-slate-400">Không đăng ký</span>';
      rows.push(`<tr class="hover:bg-slate-50">
        <td class="p-3 text-slate-500">${lesson.session_date}</td>
        <td class="p-3 font-bold text-slate-900">${lesson.teacher_name}</td>
        <td class="p-3 font-semibold text-slate-700">${lesson.class_name}</td>
        <td class="p-3 text-slate-700">${lesson.title}</td>
        <td class="p-3 text-slate-600 leading-5">${equipmentText}</td>
        <td class="p-3 text-slate-600 whitespace-nowrap">${location}</td>
        <td class="p-3 text-center">Tiết ${lesson.period_start}–${lesson.period_end}</td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded bg-slate-100 font-bold">${sessionStatusLabel(lesson.status)}</span></td>
      </tr>`);
    });
    tbody.innerHTML = rows.join('');

    if (window.lucide) lucide.createIcons();
}

function filterAdminZone(zone) {
  currentAdminZoneFilter = zone;
  ['all', 'a', 'b', 'c', 'd', 'e'].forEach(z => {
    const btn = document.getElementById(`btn-az-${z}`);
    const isTarget = (z === 'all' && zone === 'ALL') || `ZONE_${z.toUpperCase()}` === zone;
    if (btn) {
      btn.className = isTarget ? 'px-3 py-1.5 rounded-lg bg-brand-600 text-white' : 'px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700';
    }
  });

  const tbody = document.getElementById('admin-inventory-tbody');
  if (!tbody) return;
  const searchTerm = (document.getElementById('admin-inventory-search')?.value || '').trim().toLocaleLowerCase('vi');
  const items = (zone === 'ALL' ? allEquipment : allEquipment.filter(e => e.zone === zone)).filter(e => {
    const name = String(e.name || '').toLocaleLowerCase('vi');
    const code = String(e.code || '').toLocaleLowerCase('vi');
    return !searchTerm || name.includes(searchTerm) || code.includes(searchTerm);
  });

  const zoneNames = {
    'ZONE_A': 'Khu A (Đo lường)',
    'ZONE_B': 'Khu B (Thủy tinh)',
    'ZONE_C': 'Khu C (Hóa chất)',
    'ZONE_D': 'Khu D (Bộ Kit)',
    'ZONE_E': 'Khu E (Học liệu)'
  };

  tbody.innerHTML = items.map(eq => `
    <tr class="hover:bg-slate-50">
      <td class="p-3 font-mono font-bold text-brand-800 whitespace-nowrap">${eq.code}</td>
      <td class="p-3 font-bold text-slate-900">${eq.name}</td>
      <td class="p-3"><span class="bg-teal-50 text-teal-800 px-2 py-0.5 rounded font-semibold text-[11px]">${eq.usage_scope === 'LAB_ONLY' ? 'Chỉ phòng TH' : eq.usage_scope === 'CLASS_ONLY' ? 'Chỉ lớp học' : 'Phòng TH / Lớp'}</span></td>
      <td class="p-3 text-slate-600">${eq.category}</td>
      <td class="p-3 text-center font-bold text-slate-900">${eq.available_qty}</td>
      <td class="p-3 text-center text-slate-500">${eq.unit}</td>
      <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${eq.status === 'GOOD' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${eq.status === 'GOOD' ? 'Tốt' : 'Bảo trì'}</span></td>
      <td class="p-3 text-right">
        <button onclick="toggleEquipmentStatus(${eq.id}, '${eq.status}')" title="${eq.status === 'GOOD' ? 'Chuyển sang bảo trì' : 'Chuyển về tình trạng tốt'}" class="${eq.status === 'GOOD' ? 'text-amber-600 hover:text-amber-800' : 'text-emerald-600 hover:text-emerald-800'} p-1"><i data-lucide="${eq.status === 'GOOD' ? 'wrench' : 'circle-check'}" class="w-4 h-4"></i></button>
        <button onclick="deleteEquipment(${eq.id})" class="text-rose-500 hover:text-rose-700 p-1"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </td>
    </tr>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function filterAdminInventory() {
  filterAdminZone(currentAdminZoneFilter);
}

function openAddEquipmentModal() {
  const search = document.getElementById('eq-existing-search');
  const results = document.getElementById('eq-existing-results');
  const note = document.getElementById('eq-existing-selected-note');
  if (search) search.value = '';
  if (results) { results.innerHTML = ''; results.classList.add('hidden'); }
  if (note) { note.textContent = ''; note.classList.add('hidden'); }
  document.getElementById('modal-add-equipment').classList.remove('hidden');
}
function closeAddEquipmentModal() {
  document.getElementById('modal-add-equipment').classList.add('hidden');
}

function searchExistingEquipmentForAdd() {
  const query = (document.getElementById('eq-existing-search')?.value || '').trim().toLocaleLowerCase('vi');
  const results = document.getElementById('eq-existing-results');
  const note = document.getElementById('eq-existing-selected-note');
  if (note) { note.textContent = ''; note.classList.add('hidden'); }
  if (!results) return;
  if (!query) {
    results.innerHTML = '';
    results.classList.add('hidden');
    return;
  }

  const matches = allEquipment.filter(item =>
    item.code.toLocaleLowerCase('vi').includes(query) || item.name.toLocaleLowerCase('vi').includes(query)
  ).slice(0, 8);
  results.innerHTML = matches.length ? matches.map(item => `
    <button type="button" onclick="selectExistingEquipmentForAdd(${item.id})" class="w-full p-3 text-left hover:bg-teal-50 flex items-center justify-between gap-3">
      <span><b class="text-slate-900">${escapeRegisterReviewText(item.name)}</b><span class="block text-[10px] text-slate-500"><span class="font-mono whitespace-nowrap">${escapeRegisterReviewText(item.code)}</span> • ${escapeRegisterReviewText(item.category)}</span></span>
      <span class="shrink-0 text-[10px] font-bold text-brand-700">Hiện có ${item.available_qty} ${escapeRegisterReviewText(item.unit)}</span>
    </button>`).join('') : '<div class="p-3 text-center text-slate-400">Không tìm thấy thiết bị phù hợp</div>';
  results.classList.remove('hidden');
}

function selectExistingEquipmentForAdd(equipmentId) {
  const equipment = allEquipment.find(item => item.id === equipmentId);
  if (!equipment) return;
  document.getElementById('eq-code').value = equipment.code;
  document.getElementById('eq-name').value = equipment.name;
  document.getElementById('eq-category').value = equipment.category;
  document.getElementById('eq-unit').value = equipment.unit;
  document.getElementById('eq-notes').value = equipment.notes || '';
  document.getElementById('eq-qty').value = 1;
  document.getElementById('eq-existing-results').classList.add('hidden');
  const note = document.getElementById('eq-existing-selected-note');
  note.textContent = `Đã chọn ${equipment.name}. Số lượng nhập thêm sẽ được cộng vào kiểm kê hiện tại.`;
  note.classList.remove('hidden');
}

async function submitAddEquipment() {
  const code = document.getElementById('eq-code').value.trim();
  const name = document.getElementById('eq-name').value.trim();
  const cat = document.getElementById('eq-category').value.trim();
  const qty = parseInt(document.getElementById('eq-qty').value);
  const unit = document.getElementById('eq-unit').value.trim();
  const notes = document.getElementById('eq-notes').value.trim();

  if (!code || !name) {
    showToast('Vui lòng nhập Mã và Tên thiết bị', 'error');
    return;
  }

  const res = await fetch('/api/equipment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code, name, category: cat, total_qty: qty, available_qty: qty, unit, notes
    })
  });

  const data = await res.json();
  if (res.ok) {
    showToast(data.merged ? 'Thiết bị đã tồn tại; số lượng đã được cộng dồn!' : 'Thêm thiết bị mới thành công!');
    closeAddEquipmentModal();
    await loadEquipment();
    filterAdminZone(currentAdminZoneFilter);
  } else showToast(data.error || 'Không thể thêm thiết bị', 'error');
}

async function deleteEquipment(eqId) {
  if (!confirm('Bạn có chắc muốn xóa thiết bị này khỏi danh mục?')) return;
  const res = await fetch(`/api/equipment/${eqId}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('Đã xóa thiết bị');
    await loadEquipment();
    filterAdminZone(currentAdminZoneFilter);
  }
}

async function toggleEquipmentStatus(eqId, currentStatus) {
  const newStatus = currentStatus === 'GOOD' ? 'MAINTENANCE' : 'GOOD';
  const label = newStatus === 'GOOD' ? 'Tốt' : 'Bảo trì';
  const res = await fetch(`/api/equipment/${eqId}/status`, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({status: newStatus})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showToast(data.error || 'Không thể cập nhật tình trạng thiết bị', 'error');
    return;
  }
  showToast(`Đã chuyển tình trạng thiết bị sang ${label}`);
  await loadEquipment();
  filterAdminZone(currentAdminZoneFilter);
}

function renderAdminSessionCards(container, sessions, mode) {
  if (!container) return;
  if (sessions.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-xs text-slate-400">${mode === 'approval' ? 'Không có phiếu đăng ký chờ duyệt' : 'Không có tiết học chờ đợi xác nhận'}</div>`;
    return;
  }
  container.innerHTML = sessions.map(s => `
    <div class="p-5 rounded-2xl border border-slate-200 bg-slate-50 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
        <div><span class="text-xs font-bold text-brand-800 bg-brand-100 px-2 py-0.5 rounded">LỚP ${s.class_name} • ${s.session_date}</span><h4 class="text-base font-bold text-slate-900 mt-1">${s.title}</h4><p class="text-xs text-slate-500">GV: ${s.teacher_name || 'Giáo viên bộ môn'} | ${s.period_slot}</p></div>
        <div class="flex flex-wrap items-center gap-2"><span class="px-3 py-1 bg-slate-100 rounded-full font-bold text-xs">${sessionStatusLabel(s.status)}</span>
          ${mode === 'approval' ? `<button onclick="decideBooking(${s.id},'APPROVE_LAB')" class="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold">Duyệt phòng TH</button><button onclick="decideBooking(${s.id},'APPROVE_CLASS')" class="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold">Duyệt tại lớp</button><button onclick="decideBooking(${s.id},'REJECT')" class="px-3 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold">Không đồng ý</button>` : ''}
        </div>
      </div>
      <div class="grid sm:grid-cols-3 gap-2 text-xs text-slate-600"><p><b>Đề nghị:</b> ${s.requested_location === 'CLASS' ? 'Dạy tại lớp' : 'Phòng thực hành'}</p><p><b>Buổi:</b> ${s.shift === 'AFTERNOON' ? 'Chiều' : 'Sáng'}, tiết ${s.period_start}–${s.period_end}</p><p><b>Sĩ số:</b> ${s.student_count || 0}</p></div>
      ${s.approval_note ? `<p class="text-xs"><b>Ghi chú xử lý:</b> ${s.approval_note}</p>` : ''}
      ${mode === 'approval' ? `<div class="rounded-xl border border-rose-200 bg-white p-4 space-y-2">
        <label for="rejection-reason-${s.id}" class="block text-xs font-bold text-slate-700">Lý do từ chối <span class="text-rose-600">*</span></label>
        <textarea id="rejection-reason-${s.id}" rows="2" oninput="rejectionReasonDrafts[${s.id}] = this.value" class="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500" placeholder="Nhập lý do để giáo viên biết và điều chỉnh phiếu...">${escapeRegisterReviewText(rejectionReasonDrafts[s.id] || '')}</textarea>
        <p class="text-[11px] text-slate-500">Ô này bắt buộc khi chọn “Không đồng ý”.</p>
      </div>` : ''}
      ${mode !== 'approval' ? `<div class="rounded-xl border border-emerald-200 bg-white p-4 space-y-3">
        <label for="acceptance-message-${s.id}" class="block text-xs font-bold text-slate-700">Tin nhắn nghiệm thu gửi giáo viên</label>
        <textarea id="acceptance-message-${s.id}" rows="3" class="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Nhập kết quả nghiệm thu hoặc nội dung giáo viên cần bổ sung..."></textarea>
        <div class="flex flex-wrap gap-2"><button onclick="acceptSessionReport(${s.id},'ACCEPT')" class="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold">Nghiệm thu sau tiết học</button><button onclick="acceptSessionReport(${s.id},'REDO_5S')" class="px-3 py-2 bg-amber-600 text-white rounded-lg text-xs font-bold">Yêu cầu bổ sung</button></div>
      </div>` : ''}
    </div>`).join('');
  if (window.lucide) lucide.createIcons();
}

async function renderAdminBookingApprovals() {
  const container = document.getElementById('admin-session-acceptance-list');
  renderAdminSessionCards(container, allSessions.filter(s => ['PENDING','NEEDS_CHANGES'].includes(s.status)), 'approval');
}

async function renderAdminPostSessionAcceptance() {
  const container = document.getElementById('admin-post-session-acceptance-list');
  renderAdminSessionCards(container, allSessions.filter(s => s.status === 'PENDING_ACCEPTANCE'), 'acceptance');
}

async function downloadExcel(url, filename) {
  try {
    const separator = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${separator}_=${Date.now()}`, {cache: 'no-store'});
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        pendingExcelDownload = {url, filename};
        authToken = null;
        currentUser = null;
        localStorage.removeItem('biolab_token');
        localStorage.removeItem('biolab_user');
        updateUserUI();
        openLoginModal('Phiên đã hết hạn – đăng nhập để tiếp tục tải báo cáo');
        window.setTimeout(() => document.getElementById('login-username')?.focus(), 0);
        throw new Error('Phiên đăng nhập đã hết hạn. Báo cáo sẽ tự tải sau khi bạn đăng nhập lại.');
      }
      throw new Error(data.error || 'Không thể xuất báo cáo');
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    showToast('Đã xuất file Excel thành công');
  } catch (error) {
    showToast(error.message || 'Không thể xuất file Excel', 'error');
  }
}

function downloadTeacherStatsExcel(button) {
  downloadExcel(button.dataset.url || '/api/export/teachers-summary-excel', button.dataset.filename || 'Lich_Su_Dung_Phong_Thi_Nghiem.xls');
}

async function decideBooking(sessionId, decision) {
  let reason = '';
  if (decision === 'REJECT') {
    reason = (document.getElementById(`rejection-reason-${sessionId}`)?.value || rejectionReasonDrafts[sessionId] || '').trim();
    if (!reason) {
      document.getElementById(`rejection-reason-${sessionId}`)?.focus();
      return showToast('Vui lòng nhập lý do từ chối phiếu', 'error');
    }
  }
  const res = await fetch(`/api/sessions/${sessionId}/approve`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,reason})});
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Không thể duyệt phiếu', 'error');
  delete rejectionReasonDrafts[sessionId];
  await loadSessions(); renderAdminView(); showToast('Đã cập nhật quyết định phiếu');
}

async function acceptSessionReport(sessionId, action) {
  const reason = document.getElementById(`acceptance-message-${sessionId}`)?.value.trim() || '';
  const failed_items = action === 'REDO_5S' ? ['5S'] : [];
  if (action === 'REDO_5S' && !reason) return showToast('Vui lòng nhập tin nhắn nêu nội dung cần bổ sung', 'error');
  const res = await fetch(`/api/sessions/${sessionId}/accept-report`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,reason,failed_items})});
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Không thể nghiệm thu', 'error');
  await loadSessions(); renderAdminView(); showToast(action === 'ACCEPT' ? 'Đã nghiệm thu và đóng ca' : 'Đã yêu cầu giáo viên thực hiện lại 5S');
}

// Breakages
async function renderAdminBreakages() {
  const tbody = document.getElementById('admin-breakages-tbody');
  try {
    const res = await fetch('/api/breakages');
    const breakages = await res.json();
    const stat = document.getElementById('stat-breakages');
    if (stat) stat.textContent = `${breakages.length} sự cố`;

    if (breakages.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-xs text-slate-400">Không có thiết bị hỏng vỡ nào được ghi nhận</td></tr>`;
      return;
    }

    tbody.innerHTML = breakages.map(b => `
      <tr class="hover:bg-slate-50">
        <td class="p-3 text-slate-500">${b.session_date}</td>
        <td class="p-3 font-bold text-slate-900">${b.class_name} • Nhóm ${b.group_number || 'Chung'}</td>
        <td class="p-3 font-bold text-rose-600">${b.equipment_name} <span class="font-mono text-[10px] text-slate-400 whitespace-nowrap">(${b.equipment_code})</span></td>
        <td class="p-3 text-center font-bold">${b.quantity}</td>
        <td class="p-3 text-slate-600">${b.reason}</td>
        <td class="p-3 text-center">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${b.is_resolved ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
            ${b.is_resolved ? 'Đã xác nhận, đã trừ kho' : 'Chờ xác nhận'}
          </span>
        </td>
        <td class="p-3 text-right">
          ${!b.is_resolved ? `<button onclick="resolveBreakage(${b.id})" class="px-2 py-1 bg-emerald-600 text-white rounded text-[10px] font-bold hover:bg-emerald-700">Xác nhận sự cố</button>` : `<span class="text-slate-400 text-xs">✓</span>`}
        </td>
      </tr>
    `).join('');
    if (window.lucide) lucide.createIcons();
  } catch(e){}
}

function openRecordBreakageModal() {
  const sesSelect = document.getElementById('brk-session-select');
  sesSelect.innerHTML = allSessions.map(s => `<option value="${s.id}">Lớp ${s.class_name} - ${s.title} (${s.session_date})</option>`).join('');

  const eqSelect = document.getElementById('brk-equipment-select');
  eqSelect.innerHTML = allEquipment.map(e => `<option value="${e.id}">${e.name} (${e.code}) — còn ${e.available_qty} ${e.unit}</option>`).join('');
  syncBreakageQuantityLimit();

  document.getElementById('modal-record-breakage').classList.remove('hidden');
}

function syncBreakageQuantityLimit() {
  const equipmentId = Number(document.getElementById('brk-equipment-select')?.value);
  const equipment = allEquipment.find(item => item.id === equipmentId);
  const quantityInput = document.getElementById('brk-qty');
  if (!quantityInput || !equipment) return;
  const maximum = Math.max(0, Math.min(Number(equipment.total_qty || 0), Number(equipment.available_qty || 0)));
  quantityInput.max = maximum;
  quantityInput.value = maximum > 0 ? Math.min(Math.max(1, Number(quantityInput.value || 1)), maximum) : 0;
  quantityInput.disabled = maximum === 0;
}

function closeRecordBreakageModal() {
  document.getElementById('modal-record-breakage').classList.add('hidden');
}

async function submitRecordBreakage() {
  const sId = parseInt(document.getElementById('brk-session-select').value);
  const eqId = parseInt(document.getElementById('brk-equipment-select').value);
  const grp = parseInt(document.getElementById('brk-group').value);
  const qty = parseInt(document.getElementById('brk-qty').value);
  const reason = document.getElementById('brk-reason').value.trim();

  const equipment = allEquipment.find(item => item.id === eqId);
  const maximum = equipment ? Math.min(Number(equipment.total_qty || 0), Number(equipment.available_qty || 0)) : 0;

  if (!reason || !Number.isInteger(qty) || qty < 1 || qty > maximum) {
    showToast(maximum < 1 ? 'Thiết bị đã hết, không thể ghi nhận thêm số lượng hỏng' : `Số lượng hỏng phải từ 1 đến ${maximum}`, 'error');
    return;
  }

  const res = await fetch('/api/breakages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sId, equipment_id: eqId, group_number: grp, quantity: qty, reason
    })
  });

  const data = await res.json();
  if (res.ok) {
    showToast('Đã ghi nhận thiết bị hỏng vỡ vào hệ thống kiểm kê');
    playChimeSound();
    closeRecordBreakageModal();
    renderAdminBreakages();
  } else showToast(data.error || 'Không thể ghi nhận sự cố', 'error');
}

async function resolveBreakage(id) {
  const res = await fetch(`/api/breakages/${id}/resolve`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Không thể xác nhận sự cố', 'error');
  showToast(`Đã xác nhận sự cố và trừ ${data.deducted_quantity} khỏi kiểm kê`);
  await loadEquipment();
  filterAdminInventory();
  renderAdminBreakages();
}

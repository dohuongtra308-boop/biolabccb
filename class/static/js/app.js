/**
 * BioLab Manager - Frontend Single Page Application Engine
 * Quản lý trạng thái giao diện, Web Audio API chuông báo, Upload ảnh Camera và Tương tác 3 vai trò
 */

// Global State
let currentUser = null;
let authToken = localStorage.getItem('biolab_token');
let currentZoneFilter = 'ZONE_A';
let currentAdminZoneFilter = 'ALL';
let currentStudentGroup = 1;
let activeSessionId = 1; // Default to current in-progress session
let allEquipment = [];
let allSessions = [];
let studentBorrowList = {}; // { eqId: quantity }
let uploadedExpPhotos = [];
let uploadedBenchPhoto = null;
let uploadedZonePhoto = null;
let activeGradeGroup = 1;
let studentReadOnly = false;

// Attach the login token to every API request. The server remains the source of truth.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('/api/') && authToken) {
    init.headers = new Headers(init.headers || {});
    init.headers.set('Authorization', `Bearer ${authToken}`);
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
    await loadNotifications();
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

  // Periodic polling for notifications
  setInterval(loadNotifications, 10000);
  setInterval(() => {
    if (currentUser?.role === 'TEACHER' && activeSessionId) {
      selectTeacherSession(activeSessionId, false);
    }
  }, 5000);
});

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
  } else {
    badge.textContent = `Lớp ${currentUser.class_name || '10A1'}`;
    badge.className = 'px-2 py-0.5 text-xs font-semibold rounded bg-teal-400 text-brand-950';
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
  ['view-landing', 'view-student', 'view-teacher', 'view-admin'].forEach(id => {
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

function handleAccountButton() {
  if (!currentUser) return openLoginModal();
  currentUser = null;
  authToken = null;
  localStorage.removeItem('biolab_user');
  localStorage.removeItem('biolab_token');
  updateUserUI();
  showView('view-landing');
  openLoginModal();
}

// ================= 4. AUTHENTICATION ACTIONS =================
function openLoginModal() {
  document.getElementById('modal-login').classList.remove('hidden');
}
function closeLoginModal() {
  document.getElementById('modal-login').classList.add('hidden');
}

async function quickLogin(username, password) {
  document.getElementById('login-username').value = username;
  document.getElementById('login-password').value = password;
  await submitLogin();
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
      await loadNotifications();
      updateUserUI();
      closeLoginModal();
      showToast(`Đăng nhập thành công: ${currentUser.full_name}`);
      playChimeSound();
      routeByRole();
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
      // Find currently active or scheduled session
      const active = allSessions.find(s => !['COMPLETED','REJECTED','CANCELLED'].includes(s.status)) || allSessions[0];
      if (active) activeSessionId = active.id;
    }
  } catch (e) {
    console.error("Lỗi tải ca học:", e);
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
          <span class="text-[10px] text-slate-400">${new Date(n.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
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

// ================= 6. STUDENT MOBILE FLOW =================
function renderStudentView() {
  const currentSession = allSessions.find(s => s.id === activeSessionId) || allSessions[0];
  if (currentSession) {
    document.getElementById('student-session-title').textContent = currentSession.title;
    document.getElementById('student-session-slot').textContent = currentSession.period_slot;
    document.getElementById('student-teacher-name').textContent = currentSession.teacher_name || 'Giáo viên bộ môn';
    document.getElementById('student-class-badge').textContent = `LỚP ${currentUser.class_name || currentSession.class_name}`;
    const plannedCodes = JSON.parse(currentSession.planned_items || '[]');
    studentBorrowList = {};
    allEquipment.forEach(eq => {
      if (plannedCodes.includes(eq.code) || plannedCodes.includes(eq.id)) studentBorrowList[eq.id] = 1;
    });
  }

  filterStudentZone('ZONE_A');
  loadGroupSubmissionData();
}

function onStudentGroupChange() {
  currentStudentGroup = parseInt(document.getElementById('student-group-select').value);
  loadGroupSubmissionData();
}

function switchStudentStep(stepNum) {
  [1, 2, 3].forEach(n => {
    const tab = document.getElementById(`step-tab-${n}`);
    const view = document.getElementById(`student-step-${n}`);
    if (n === stepNum) {
      tab.className = 'py-2.5 px-4 border-b-2 border-brand-600 text-brand-700 flex items-center gap-1.5 whitespace-nowrap';
      view.classList.remove('hidden');
    } else {
      tab.className = 'py-2.5 px-4 border-b-2 border-transparent hover:text-slate-800 flex items-center gap-1.5 whitespace-nowrap';
      view.classList.add('hidden');
    }
  });
  if (window.lucide) lucide.createIcons();
}

function filterStudentZone(zoneCode) {
  currentZoneFilter = zoneCode;
  ['a', 'b', 'c', 'd', 'e'].forEach(z => {
    const btn = document.getElementById(`btn-sz-${z}`);
    const isTarget = `ZONE_${z.toUpperCase()}` === zoneCode;
    btn.className = isTarget ? 'py-2 px-1 text-center rounded-lg bg-teal-600 text-white' : 'py-2 px-1 text-center rounded-lg bg-slate-100 text-slate-700';
  });

  const list = document.getElementById('student-equipment-list');
  const currentSession = allSessions.find(s => s.id === activeSessionId);
  const plannedCodes = JSON.parse(currentSession?.planned_items || '[]');
  const items = allEquipment.filter(e => e.zone === zoneCode && (plannedCodes.includes(e.code) || plannedCodes.includes(e.id)));

  if (items.length === 0) {
    list.innerHTML = `<div class="text-center py-6 text-xs text-slate-400">Không có thiết bị trong phân khu này</div>`;
    return;
  }

  list.innerHTML = items.map(eq => {
    const pickedQty = studentBorrowList[eq.id] || 0;
    return `
      <div class="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between shadow-sm">
        <div>
          <span class="font-bold text-xs text-slate-900">${eq.name}</span>
          <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
            <span class="bg-slate-100 px-1.5 py-0.5 rounded font-mono">${eq.code}</span>
            <span>Đơn vị: ${eq.unit}</span>
          </div>
        </div>
        <div class="flex items-center space-x-2">
          <button ${studentReadOnly ? 'disabled' : ''} onclick="changeStudentItemQty(${eq.id}, -1)" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center disabled:opacity-50">-</button>
          <span id="st-qty-${eq.id}" class="w-6 text-center text-xs font-extrabold text-brand-700">${pickedQty}</span>
          <button ${studentReadOnly ? 'disabled' : ''} onclick="changeStudentItemQty(${eq.id}, 1)" class="w-7 h-7 rounded-lg bg-teal-100 hover:bg-teal-200 text-teal-900 font-bold flex items-center justify-center disabled:opacity-50">+</button>
        </div>
      </div>
    `;
  }).join('');
}

function changeStudentItemQty(eqId, delta) {
  const cur = studentBorrowList[eqId] || 0;
  const next = Math.max(0, cur + delta);
  if (next === 0) delete studentBorrowList[eqId];
  else studentBorrowList[eqId] = next;

  const el = document.getElementById(`st-qty-${eqId}`);
  if (el) el.textContent = next;
}

async function saveStudentBorrowItems() {
  const items = Object.entries(studentBorrowList).map(([eqId, qty]) => ({
    equipment_id: parseInt(eqId),
    quantity: qty
  }));

  if (items.length === 0) {
    showToast('Vui lòng chọn ít nhất 1 thiết bị', 'error');
    return;
  }

  const res = await fetch('/api/borrow-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: activeSessionId,
      group_number: currentStudentGroup,
      items: items
    })
  });

  if (res.ok) {
    showToast('Đã ghi nhận danh mục thiết bị của nhóm thành công!');
    playChimeSound();
    switchStudentStep(2);
  }
}

// Student Upload Photo Logic
function handleStudentPhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    const dataUrl = evt.target.result;
    uploadedExpPhotos.push(dataUrl);
    renderUploadedPhotoGrid();
    showToast('Đã tải ảnh kết quả lên thành công!');
  };
  reader.readAsDataURL(file);
}

function renderUploadedPhotoGrid() {
  const grid = document.getElementById('student-photo-preview-grid');
  grid.innerHTML = uploadedExpPhotos.map((url, idx) => `
    <div class="relative rounded-xl overflow-hidden border border-slate-200 group aspect-video">
      <img src="${url}" class="w-full h-full object-cover">
      <button onclick="uploadedExpPhotos.splice(${idx}, 1); renderUploadedPhotoGrid();" class="absolute top-1 right-1 bg-rose-600 text-white rounded-full p-1 opacity-80 hover:opacity-100">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    </div>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

async function saveStudentExperimentNote() {
  const note = document.getElementById('student-exp-note').value;
  await fetch('/api/submissions/note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: activeSessionId,
      group_number: currentStudentGroup,
      experiment_note: note,
      result_images: uploadedExpPhotos
    })
  });
  showToast('Đã lưu Sổ tay thí nghiệm');
  playChimeSound();
  switchStudentStep(3);
}

function uploadBenchPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    uploadedBenchPhoto = evt.target.result;
    document.getElementById('preview-bench').innerHTML = `<img src="${uploadedBenchPhoto}" class="w-full h-full object-cover">`;
    showToast('Đã chụp ảnh Bàn học');
  };
  reader.readAsDataURL(file);
}

function uploadZonePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    uploadedZonePhoto = evt.target.result;
    document.getElementById('preview-zone').innerHTML = `<img src="${uploadedZonePhoto}" class="w-full h-full object-cover">`;
    showToast('Đã chụp ảnh Phân khu trả đồ');
  };
  reader.readAsDataURL(file);
}

async function submitStudent5SChecklist() {
  const s1 = document.getElementById('chk-s1').checked;
  const s2 = document.getElementById('chk-s2').checked;
  const s3 = document.getElementById('chk-s3').checked;
  const s4 = document.getElementById('chk-s4').checked;
  const s5 = document.getElementById('chk-s5').checked;

  if (!s1 || !s2 || !s3 || !s4 || !s5) {
    showToast('Vui lòng hoàn thành đủ cả 5 tiêu chí 5S (S1 - S5)', 'error');
    return;
  }

  const res = await fetch('/api/submissions/5s', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: activeSessionId,
      group_number: currentStudentGroup,
      s1: s1 ? 1 : 0,
      s2: s2 ? 1 : 0,
      s3: s3 ? 1 : 0,
      s4: s4 ? 1 : 0,
      s5: s5 ? 1 : 0,
      bench_photo_url: uploadedBenchPhoto,
      zone_photo_url: uploadedZonePhoto,
      result_images: uploadedExpPhotos,
      experiment_note: document.getElementById('student-exp-note').value
    })
  });

  if (res.ok) {
    showToast('🎉 Tuyệt vời! Đã nộp hoàn tất ca học và gửi thông báo nghiệm thu 5S');
    playChimeSound();
    setStudentReadOnly(true);
    await loadSessions();
  } else {
    const data = await res.json();
    showToast(data.error || 'Không thể nộp báo cáo', 'error');
  }
}

async function loadGroupSubmissionData() {
  try {
    const res = await fetch(`/api/submissions?session_id=${activeSessionId}&group_number=${currentStudentGroup}`);
    const sub = await res.json();
    if (sub && sub.id) {
      if (sub.experiment_note) document.getElementById('student-exp-note').value = sub.experiment_note;
      if (sub.result_images) {
        uploadedExpPhotos = JSON.parse(sub.result_images || '[]');
        renderUploadedPhotoGrid();
      }
      document.getElementById('chk-s1').checked = !!sub.s1_seiri_done;
      document.getElementById('chk-s2').checked = !!sub.s2_seiton_done;
      document.getElementById('chk-s3').checked = !!sub.s3_seiso_done;
      document.getElementById('chk-s4').checked = !!sub.s4_seiketsu_done;
      document.getElementById('chk-s5').checked = !!sub.s5_shitsuke_done;

      if (sub.bench_photo_url) {
        document.getElementById('preview-bench').innerHTML = `<img src="${sub.bench_photo_url}" class="w-full h-full object-cover">`;
      }
      if (sub.zone_photo_url) {
        document.getElementById('preview-zone').innerHTML = `<img src="${sub.zone_photo_url}" class="w-full h-full object-cover">`;
      }
      setStudentReadOnly(['SUBMITTED', 'REVIEWED'].includes(sub.status));
    } else {
      const session = allSessions.find(s => s.id === activeSessionId);
      setStudentReadOnly(session?.status === 'COMPLETED');
    }
  } catch (e) {
    console.error("Lỗi nạp bài nộp nhóm:", e);
  }
}

function setStudentReadOnly(readOnly) {
  studentReadOnly = readOnly;
  document.querySelectorAll('#student-step-1 input, #student-step-1 button, #student-step-2 input, #student-step-2 textarea, #student-step-2 button, #student-step-3 input, #student-step-3 button')
    .forEach(el => { el.disabled = readOnly; });
  let banner = document.getElementById('student-readonly-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'student-readonly-banner';
    banner.className = 'hidden bg-slate-100 border border-slate-300 text-slate-700 p-3 rounded-xl text-xs font-bold';
    document.getElementById('student-step-1').before(banner);
  }
  banner.textContent = 'Bài đã nộp — đang ở chế độ chỉ xem. Giáo viên có thể xem và đánh giá kết quả.';
  banner.classList.toggle('hidden', !readOnly);
  filterStudentZone(currentZoneFilter);
}

// ================= 7. TEACHER FLOW =================
function renderTeacherView() {
  const sessionList = document.getElementById('teacher-session-list');
  if (allSessions.length === 0) {
    sessionList.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">Chưa có ca thực hành nào</div>`;
    return;
  }

  sessionList.innerHTML = allSessions.map(s => `
    <div onclick="selectTeacherSession(${s.id})" class="p-4 rounded-xl border transition cursor-pointer ${s.id === activeSessionId ? 'bg-teal-50/70 border-brand-500 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}">
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
  const s = allSessions.find(x => x.id === sessionId);
  if (!s) return;

  document.getElementById('tl-class-badge').textContent = `LỚP ${s.class_name}`;
  document.getElementById('tl-title').textContent = s.title;
  const statusLabels = { PENDING: 'Sắp diễn ra', IN_PROGRESS: 'Đang diễn ra', SUBMITTED: 'Đã nhận đủ bài', COMPLETED: 'Đã nghiệm thu' };
  document.getElementById('tl-status').textContent = statusLabels[s.status] || s.status;

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
      <div class="flex gap-2 pt-2">
        ${canStart ? `<button onclick="startTeachingSession(${s.id})" class="px-4 py-2 bg-brand-600 text-white rounded-xl text-xs font-bold">Bắt đầu ca dạy</button>` : ''}
        ${canReport ? `<button onclick="openSessionReportModal(${s.id})" class="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold">${s.status === 'REDO_5S' ? 'Thực hiện lại 5S' : 'Báo cáo cuối ca'}</button>` : ''}
      </div>
    </div>`;
}

function sessionStatusLabel(status) {
  return ({PENDING:'Chờ duyệt',APPROVED_LAB:'Đã duyệt – Phòng thực hành',APPROVED_CLASS:'Đã duyệt – Dạy tại lớp',IN_PROGRESS:'Đang thực hiện',PENDING_ACCEPTANCE:'Chờ nghiệm thu',COMPLETED:'Hoàn tất',REJECTED:'Không đồng ý',NEEDS_CHANGES:'Yêu cầu bổ sung',REDO_5S:'Yêu cầu thực hiện lại 5S'})[status] || status;
}

async function startTeachingSession(sessionId) {
  const res = await fetch(`/api/sessions/${sessionId}/status`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'IN_PROGRESS'})});
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Không thể bắt đầu ca', 'error');
  await loadSessions(); renderTeacherView(); showToast('Ca dạy đã bắt đầu');
}

function openSessionReportModal(sessionId) {
  activeSessionId = sessionId;
  const s = allSessions.find(x => x.id === sessionId);
  document.getElementById('report-5s-section').classList.toggle('hidden', s?.approved_location !== 'LAB');
  document.getElementById('modal-session-report').classList.remove('hidden');
}
function closeSessionReportModal(){ document.getElementById('modal-session-report').classList.add('hidden'); }
async function submitSessionReport() {
  const s = allSessions.find(x => x.id === activeSessionId);
  const body = {notes:document.getElementById('report-notes').value,usage_items:[],damage_items:[]};
  for(let i=1;i<=5;i++) body[`s${i}`] = s?.approved_location === 'LAB' ? document.getElementById(`report-s${i}`).checked : true;
  const res = await fetch(`/api/sessions/${activeSessionId}/report`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Không thể gửi báo cáo', 'error');
  closeSessionReportModal(); await loadSessions(); renderTeacherView(); showToast('Đã gửi báo cáo, chờ cán bộ nghiệm thu');
}

function filterClassesByGrade() {
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
  loadLessonCatalog();
}

let currentSessionShift = 'MORNING';
let teacherRegZone = 'GENERAL';
let selectedTeacherRegEquipment = new Map();
let currentLessonCatalog = [];
let teacherStatsFilter = 'YEAR';

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

function applySelectedLesson() {
  const selectedValue = document.getElementById('reg-lesson-select')?.value || '';
  const customWrap = document.getElementById('reg-custom-title-wrap');
  if (selectedValue === 'CUSTOM') {
    customWrap?.classList.remove('hidden');
    document.getElementById('reg-lesson-detail')?.classList.add('hidden');
    selectedTeacherRegEquipment.clear();
    document.getElementById('reg-selected-count').textContent = 0;
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
  document.getElementById('reg-selected-count').textContent = selectedTeacherRegEquipment.size;
  if (detail) {
    const missing = lesson.unmatched_suggestions?.length
      ? `<p class="mt-2 text-amber-700"><b>Chưa có trong kiểm kê:</b> ${lesson.unmatched_suggestions.join('; ')}</p>`
      : '';
    detail.innerHTML = `<p><b>Hoạt động chính:</b> ${lesson.activity || 'Chưa cập nhật'}</p>${missing}`;
    detail.classList.remove('hidden');
  }
  if (status) status.textContent = `Đã gợi ý ${lesson.suggested_items.length} thiết bị`;
  switchTeacherRegZone('GENERAL');
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
  const items = zoneCode === 'GENERAL' ? allEquipment : allEquipment.filter(e => e.zone === zoneCode);

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
            <span class="text-[10px] text-slate-400 block font-mono">${eq.code} • ${eq.unit}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 ${isChecked ? 'w-full sm:w-auto p-2 sm:p-0 bg-white/70 sm:bg-transparent rounded-lg' : ''}">
          ${isChecked ? `<label class="flex flex-1 sm:flex-none items-center justify-between sm:justify-start gap-2 text-xs font-bold text-brand-800">Số lượng mượn
            <input type="number" min="1" max="${eq.available_qty}" value="${selectedQuantity}" oninput="updateTeacherRegQuantity('${eq.code}', this.value, false)" onchange="updateTeacherRegQuantity('${eq.code}', this.value, true)" class="w-20 p-2 border-2 border-brand-300 bg-white rounded-lg text-center text-sm font-extrabold text-brand-800">
          </label>` : ''}
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 whitespace-nowrap">Tồn: ${eq.available_qty} ${eq.unit}</span>
        </div>
      </div>
    `;
  }).join('');
}

function toggleTeacherRegItem(code) {
  if (selectedTeacherRegEquipment.has(code)) {
    selectedTeacherRegEquipment.delete(code);
  } else {
    selectedTeacherRegEquipment.set(code, 1);
  }
  document.getElementById('reg-selected-count').textContent = selectedTeacherRegEquipment.size;
  switchTeacherRegZone(teacherRegZone);
}

function updateTeacherRegQuantity(code, value, refresh = false) {
  const equipment = allEquipment.find(item => item.code === code);
  const maxQuantity = Math.max(1, Number(equipment?.available_qty || 1));
  const quantity = Math.min(maxQuantity, Math.max(1, parseInt(value || '1')));
  selectedTeacherRegEquipment.set(code, quantity);
  if (refresh) switchTeacherRegZone(teacherRegZone);
}

function clearTeacherRegEquipment() {
  selectedTeacherRegEquipment.clear();
  document.getElementById('reg-selected-count').textContent = 0;
  switchTeacherRegZone(teacherRegZone);
}

async function openRegisterSessionModal() {
  filterClassesByGrade();
  setSessionShift('MORNING');
  selectedTeacherRegEquipment.clear();
  document.getElementById('reg-selected-count').textContent = 0;
  switchTeacherRegZone('GENERAL');
  document.getElementById('modal-register-session').classList.remove('hidden');
  await loadLessonCatalog();
}

function closeRegisterSessionModal() {
  document.getElementById('modal-register-session').classList.add('hidden');
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
    showToast('Đăng ký ca thực hành thành công! Đã gửi chuông báo cho Cán bộ phòng');
    playChimeSound();
    closeRegisterSessionModal();
    await loadSessions();
    renderTeacherView();
  } else {
    showToast(data.error || 'Không thể gửi phiếu đăng ký', 'error');
  }
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
}

function switchAdminTab(tabName) {
  const tabs = [
    { name: 'inventory', btnId: 'tab-admin-inv', contentId: 'admin-tab-inventory' },
    { name: 'sessions', btnId: 'tab-admin-ses', contentId: 'admin-tab-sessions' },
    { name: 'acceptance', btnId: 'tab-admin-acc', contentId: 'admin-tab-acceptance' },
    { name: 'teachers-summary', btnId: 'tab-admin-tea', contentId: 'admin-tab-teachers-summary' },
    { name: 'breakages', btnId: 'tab-admin-brk', contentId: 'admin-tab-breakages' },
    { name: 'reports', btnId: 'tab-admin-rep', contentId: 'admin-tab-reports' }
  ];

  tabs.forEach(t => {
    const tabBtn = document.getElementById(t.btnId);
    const tabContent = document.getElementById(t.contentId);
    if (tabBtn && tabContent) {
      if (t.name === tabName) {
        tabBtn.className = 'py-3 px-4 border-b-2 border-brand-600 text-brand-700 flex items-center gap-1.5 whitespace-nowrap';
        tabContent.classList.remove('hidden');
      } else {
        tabBtn.className = 'py-3 px-4 border-b-2 border-transparent text-slate-500 hover:text-slate-800 flex items-center gap-1.5 whitespace-nowrap';
        tabContent.classList.add('hidden');
      }
    }
  });

  if (tabName === 'teachers-summary') {
    renderTeacherStatsTable();
  }
  if (window.lucide) lucide.createIcons();
}

async function setTeacherStatsFilter(filter) {
  teacherStatsFilter = filter;
  ['week', 'month', 'year'].forEach(f => {
    const btn = document.getElementById(`btn-tsf-${f}`);
    if (btn) {
      if (f === filter.toLowerCase()) {
        btn.className = 'px-3 py-1 rounded-lg bg-brand-600 text-white shadow-sm';
      } else {
        btn.className = 'px-3 py-1 rounded-lg text-slate-600 hover:text-slate-900';
      }
    }
  });

  const exportButton = document.getElementById('btn-export-teacher-stats-excel');
  if (exportButton) {
    exportButton.dataset.url = `/api/export/teachers-summary-excel?period=${filter}`;
    exportButton.dataset.filename = `Tong_Ket_Giao_Vien_${filter}.xls`;
  }

  await renderTeacherStatsTable();
}

async function renderTeacherStatsTable() {
  const tbody = document.getElementById('admin-teacher-stats-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/stats/teachers-summary?period=${teacherStatsFilter}`);
    const lessons = await res.json();

    if (lessons.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-xs text-slate-400">Chưa có tiết thực hành đã diễn ra tại phòng Lab</td></tr>`;
      return;
    }

    let previousTeacher = null;
    const rows = [];
    lessons.forEach((lesson, index) => {
      if (previousTeacher !== null && previousTeacher !== lesson.teacher_id) {
        const previous = lessons[index - 1];
        rows.push(`<tr class="bg-teal-50 font-bold text-brand-800"><td colspan="5" class="p-3 text-right">Tổng cộng ${previous.teacher_name}</td><td class="p-3 text-center">${previous.total_periods} tiết</td><td class="p-3 text-center">${previous.total_lessons} bài</td></tr>`);
      }
      rows.push(`<tr class="hover:bg-slate-50">
        <td class="p-3 text-slate-500">${lesson.session_date}</td>
        <td class="p-3 font-bold text-slate-900">${lesson.teacher_name}</td>
        <td class="p-3 font-semibold text-slate-700">${lesson.class_name}</td>
        <td class="p-3 text-slate-700">${lesson.title}</td>
        <td class="p-3 text-center">Tiết ${lesson.period_start}–${lesson.period_end}</td>
        <td class="p-3 text-center font-extrabold text-brand-700">${lesson.total_periods}</td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded bg-slate-100 font-bold">${sessionStatusLabel(lesson.status)}</span></td>
      </tr>`);
      previousTeacher = lesson.teacher_id;
    });
    const last = lessons[lessons.length - 1];
    rows.push(`<tr class="bg-teal-50 font-bold text-brand-800"><td colspan="5" class="p-3 text-right">Tổng cộng ${last.teacher_name}</td><td class="p-3 text-center">${last.total_periods} tiết</td><td class="p-3 text-center">${last.total_lessons} bài</td></tr>`);
    tbody.innerHTML = rows.join('');

    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error("Lỗi tải bảng thống kê giáo viên:", e);
  }
}

function filterAdminZone(zone) {
  currentAdminZoneFilter = zone;
  ['all', 'a', 'b', 'c', 'd', 'e'].forEach(z => {
    const btn = document.getElementById(`btn-az-${z}`);
    const isTarget = (z === 'all' && zone === 'ALL') || `ZONE_${z.toUpperCase()}` === zone;
    btn.className = isTarget ? 'px-3 py-1.5 rounded-lg bg-brand-600 text-white' : 'px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700';
  });

  const tbody = document.getElementById('admin-inventory-tbody');
  const items = zone === 'ALL' ? allEquipment : allEquipment.filter(e => e.zone === zone);

  const zoneNames = {
    'ZONE_A': 'Khu A (Đo lường)',
    'ZONE_B': 'Khu B (Thủy tinh)',
    'ZONE_C': 'Khu C (Hóa chất)',
    'ZONE_D': 'Khu D (Bộ Kit)',
    'ZONE_E': 'Khu E (Học liệu)'
  };

  tbody.innerHTML = items.map(eq => `
    <tr class="hover:bg-slate-50">
      <td class="p-3 font-mono font-bold text-brand-800">${eq.code}</td>
      <td class="p-3 font-bold text-slate-900">${eq.name}</td>
      <td class="p-3"><span class="bg-teal-50 text-teal-800 px-2 py-0.5 rounded font-semibold text-[11px]">${eq.usage_scope === 'LAB_ONLY' ? 'Chỉ phòng TH' : eq.usage_scope === 'CLASS_ONLY' ? 'Chỉ lớp học' : 'Phòng TH / Lớp'}</span></td>
      <td class="p-3 text-slate-600">${eq.category}</td>
      <td class="p-3 text-center font-bold text-slate-900">${eq.total_qty}</td>
      <td class="p-3 text-center text-slate-500">${eq.unit}</td>
      <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${eq.status === 'GOOD' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">${eq.status === 'GOOD' ? 'Tốt' : 'Bảo trì'}</span></td>
      <td class="p-3 text-right">
        <button onclick="deleteEquipment(${eq.id})" class="text-rose-500 hover:text-rose-700 p-1"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </td>
    </tr>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function openAddEquipmentModal() {
  document.getElementById('modal-add-equipment').classList.remove('hidden');
}
function closeAddEquipmentModal() {
  document.getElementById('modal-add-equipment').classList.add('hidden');
}

async function submitAddEquipment() {
  const code = document.getElementById('eq-code').value.trim();
  const zone = document.getElementById('eq-zone').value;
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
      code, zone, name, category: cat, total_qty: qty, available_qty: qty, unit, notes
    })
  });

  if (res.ok) {
    showToast('Thêm thiết bị mới vào phân khu thành công!');
    closeAddEquipmentModal();
    await loadEquipment();
    filterAdminZone(currentAdminZoneFilter);
  }
}

async function deleteEquipment(eqId) {
  if (!confirm('Bạn có chắc muốn xóa thiết bị này khỏi danh mục phân khu?')) return;
  const res = await fetch(`/api/equipment/${eqId}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('Đã xóa thiết bị');
    await loadEquipment();
    filterAdminZone(currentAdminZoneFilter);
  }
}

function renderAdminSessionCards(container, sessions, mode) {
  if (!container) return;
  if (sessions.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-xs text-slate-400">${mode === 'approval' ? 'Không có phiếu đăng ký chờ duyệt' : 'Không có tiết học chờ nghiệm thu'}</div>`;
    return;
  }
  container.innerHTML = sessions.map(s => `
    <div class="p-5 rounded-2xl border border-slate-200 bg-slate-50 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
        <div><span class="text-xs font-bold text-brand-800 bg-brand-100 px-2 py-0.5 rounded">LỚP ${s.class_name} • ${s.session_date}</span><h4 class="text-base font-bold text-slate-900 mt-1">${s.title}</h4><p class="text-xs text-slate-500">GV: ${s.teacher_name || 'Giáo viên bộ môn'} | ${s.period_slot}</p></div>
        <div class="flex flex-wrap items-center gap-2"><span class="px-3 py-1 bg-slate-100 rounded-full font-bold text-xs">${sessionStatusLabel(s.status)}</span>
          ${mode === 'approval' ? `<button onclick="decideBooking(${s.id},'APPROVE_LAB')" class="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold">Duyệt phòng TH</button><button onclick="decideBooking(${s.id},'APPROVE_CLASS')" class="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold">Duyệt tại lớp</button><button onclick="decideBooking(${s.id},'REJECT')" class="px-3 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold">Không đồng ý</button>` : `<button onclick="acceptSessionReport(${s.id},'ACCEPT')" class="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold">Nghiệm thu sau tiết học</button><button onclick="acceptSessionReport(${s.id},'REDO_5S')" class="px-3 py-2 bg-amber-600 text-white rounded-lg text-xs font-bold">Yêu cầu bổ sung 5S</button>`}
        </div>
      </div>
      <div class="grid sm:grid-cols-3 gap-2 text-xs text-slate-600"><p><b>Đề nghị:</b> ${s.requested_location === 'CLASS' ? 'Dạy tại lớp' : 'Phòng thực hành'}</p><p><b>Buổi:</b> ${s.shift === 'AFTERNOON' ? 'Chiều' : 'Sáng'}, tiết ${s.period_start}–${s.period_end}</p><p><b>Sĩ số:</b> ${s.student_count || 0}</p></div>
      ${s.approval_note ? `<p class="text-xs"><b>Ghi chú xử lý:</b> ${s.approval_note}</p>` : ''}
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
    const res = await fetch(url);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
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
    URL.revokeObjectURL(objectUrl);
    showToast('Đã xuất file Excel thành công');
  } catch (error) {
    showToast(error.message || 'Không thể xuất file Excel', 'error');
  }
}

function downloadTeacherStatsExcel(button) {
  downloadExcel(button.dataset.url || '/api/export/teachers-summary-excel?period=YEAR', button.dataset.filename || 'Tong_Ket_Giao_Vien_YEAR.xls');
}

async function decideBooking(sessionId, decision) {
  let reason = '';
  if (decision === 'REJECT') { reason = prompt('Nhập lý do không đồng ý:') || ''; if (!reason) return; }
  const res = await fetch(`/api/sessions/${sessionId}/approve`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,reason})});
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Không thể duyệt phiếu', 'error');
  await loadSessions(); renderAdminView(); showToast('Đã cập nhật quyết định phiếu');
}

async function acceptSessionReport(sessionId, action) {
  let reason = '', failed_items = [];
  if (action === 'REDO_5S') { reason = prompt('Nhập lý do và mục 5S chưa đạt:') || ''; if (!reason) return; failed_items = ['5S']; }
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

    if (breakages.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-xs text-slate-400">Không có thiết bị hỏng vỡ nào được ghi nhận</td></tr>`;
      return;
    }

    tbody.innerHTML = breakages.map(b => `
      <tr class="hover:bg-slate-50">
        <td class="p-3 text-slate-500">${b.session_date}</td>
        <td class="p-3 font-bold text-slate-900">${b.class_name} • Nhóm ${b.group_number || 'Chung'}</td>
        <td class="p-3 font-bold text-rose-600">${b.equipment_name} <span class="font-mono text-[10px] text-slate-400">(${b.equipment_code})</span></td>
        <td class="p-3 text-center font-bold">${b.quantity}</td>
        <td class="p-3 text-slate-600">${b.reason}</td>
        <td class="p-3 text-right font-extrabold text-slate-900">${parseInt(b.cost_estimate || 0).toLocaleString()} đ</td>
        <td class="p-3 text-center">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${b.is_resolved ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
            ${b.is_resolved ? 'Đã bồi hoàn' : 'Chưa xử lý'}
          </span>
        </td>
        <td class="p-3 text-right">
          ${!b.is_resolved ? `<button onclick="resolveBreakage(${b.id})" class="px-2 py-1 bg-emerald-600 text-white rounded text-[10px] font-bold hover:bg-emerald-700">Đánh dấu xong</button>` : `<span class="text-slate-400 text-xs">✓</span>`}
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
  eqSelect.innerHTML = allEquipment.map(e => `<option value="${e.id}">${e.name} (${e.code}) - ${e.zone}</option>`).join('');

  document.getElementById('modal-record-breakage').classList.remove('hidden');
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
  const cost = parseFloat(document.getElementById('brk-cost').value);

  if (!reason) {
    showToast('Vui lòng nhập nguyên nhân sự cố', 'error');
    return;
  }

  const res = await fetch('/api/breakages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sId, equipment_id: eqId, group_number: grp, quantity: qty, reason, cost_estimate: cost
    })
  });

  if (res.ok) {
    showToast('Đã ghi nhận thiết bị hỏng vỡ vào hệ thống kiểm kê');
    playChimeSound();
    closeRecordBreakageModal();
    renderAdminBreakages();
  }
}

async function resolveBreakage(id) {
  await fetch(`/api/breakages/${id}/resolve`, { method: 'POST' });
  showToast('Đã cập nhật trạng thái bồi hoàn');
  renderAdminBreakages();
}

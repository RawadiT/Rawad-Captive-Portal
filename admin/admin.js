(function () {
  'use strict';

  var cfg = window.RAWAD_ADMIN_CONFIG || {};
  var TOKEN_KEY = 'rawad_admin_jwt';
  var users = [];
  var quotas = [];
  var admins = [];
  var currentAdmin = null;
  var msgBox = document.getElementById('admin-msg');
  var loginMsg = document.getElementById('login-msg');

  function byId(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function showMsg(target, text, isError) {
    target.textContent = text;
    target.className = 'notice ' + (isError ? 'notice-error' : 'notice-success');
    target.classList.remove('hidden');
  }
  function hideMsg(target) { target.classList.add('hidden'); }
  function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ''; }

  async function api(path, opts) {
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey ||
        cfg.supabaseUrl.indexOf('YOUR_PROJECT') !== -1 ||
        cfg.supabaseAnonKey.indexOf('YOUR_SUPABASE') !== -1) {
      throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
    }
    opts = opts || {};
    var headers = Object.assign({
      'Content-Type': 'application/json',
      'apikey': cfg.supabaseAnonKey
    }, opts.headers || {});
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    var response = await fetch(cfg.supabaseUrl + '/functions/v1/admin-api' + path,
      Object.assign({}, opts, { headers: headers }));
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'تعذر إكمال الطلب.');
    return data;
  }

  function dateTime(value) {
    if (!value) return '—';
    var date = new Date(value);
    return isNaN(date.getTime()) ? '—' : date.toLocaleString('ar-IQ');
  }
  function duration(seconds) {
    if (seconds == null) return '—';
    seconds = Math.max(0, Number(seconds));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    return h ? h + ' س ' + m + ' د' : m + ' دقيقة';
  }
  function stateOf(user) {
    if (user.is_disabled) return 'disabled';
    if (user.is_expired) return 'expired';
    if (user.started_at) return 'active';
    return 'pending';
  }
  function stateLabel(user) {
    return ({ disabled: 'معطل', expired: 'منتهي', active: 'نشط', pending: 'لم يبدأ' })[stateOf(user)];
  }
  function badge(user) {
    return '<span class="status status-' + stateOf(user) + '">' + stateLabel(user) + '</span>';
  }
  function renderStats() {
    byId('stat-total').textContent = users.length.toLocaleString('ar-IQ');
    byId('stat-active').textContent = users.filter(function (u) { return stateOf(u) === 'active'; }).length.toLocaleString('ar-IQ');
    byId('stat-pending').textContent = users.filter(function (u) { return stateOf(u) === 'pending'; }).length.toLocaleString('ar-IQ');
    byId('stat-disabled').textContent = users.filter(function (u) { return u.is_disabled; }).length.toLocaleString('ar-IQ');
    byId('users-count').textContent = users.length.toLocaleString('ar-IQ');
  }
  function renderRecent() {
    var rows = users.slice(0, 5);
    byId('recent-users').innerHTML = rows.length ? rows.map(function (u) {
      return '<tr><td><strong>' + escapeHtml(u.username) + '</strong></td><td>' +
        Number(u.duration_minutes).toLocaleString('ar-IQ') + ' دقيقة</td><td>' + badge(u) +
        '</td><td>' + dateTime(u.created_at) + '</td></tr>';
    }).join('') : '<tr><td colspan="4" class="empty">لا توجد حسابات مسجلة حالياً.</td></tr>';
  }
  function renderUsers() {
    var query = byId('users-search').value.trim().toLowerCase();
    var filter = byId('users-filter').value;
    var filtered = users.filter(function (u) {
      return u.username.toLowerCase().indexOf(query) !== -1 &&
        (filter === 'all' || stateOf(u) === filter);
    });
    byId('users-tbody').innerHTML = filtered.map(function (u) {
      var action = u.is_disabled ? 'تفعيل' : 'تعطيل';
      return '<tr><td><strong>' + escapeHtml(u.username) + '</strong><small class="cell-sub">أُنشئ في ' + dateTime(u.created_at) +
        '</small></td><td>' + Number(u.duration_minutes).toLocaleString('ar-IQ') + ' د</td><td>' +
        duration(u.remaining_seconds) + '</td><td>' + badge(u) + '</td><td>' + dateTime(u.started_at) +
        '</td><td>' + dateTime(u.expires_at) + '</td><td><div class="row-actions">' +
        '<button class="mini-btn edit-btn" data-edit="' + u.id + '">تعديل</button>' +
        '<button class="mini-btn ' + (u.is_disabled ? 'enable-btn' : 'disable-btn') + '" data-toggle="' + u.id +
        '" data-disabled="' + (!u.is_disabled) + '">' + action + '</button></div></td></tr>';
    }).join('');
    byId('users-empty').classList.toggle('hidden', filtered.length !== 0);
    if (!filtered.length) byId('users-tbody').innerHTML = '';
  }
  function renderQuotas() {
    byId('quotas-tbody').innerHTML = quotas.length ? quotas.map(function (q) {
      return '<tr><td><strong dir="ltr">' + escapeHtml(q.mac_address) + '</strong></td><td>' +
        escapeHtml(q.quota_date) + '</td><td>' + dateTime(q.started_at) + '</td><td>' +
        dateTime(q.expires_at) + '</td><td>' + dateTime(q.created_at) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty">لا توجد سجلات حصص مجانية حالياً.</td></tr>';
  }
  async function loadUsers() {
    if (!currentAdmin || !currentAdmin.is_super_admin) return;
    var result = await api('/users', { method: 'GET' });
    users = result.users || [];
    renderStats(); renderRecent(); renderUsers();
  }
  async function loadAdmins() {
    var result = await api('/admins', { method: 'GET' });
    admins = result.admins || [];
    byId('admins-count').textContent = admins.length.toLocaleString('ar-IQ');
    byId('admins-tbody').innerHTML = admins.filter(function (a) { return !a.is_super_admin; }).map(function (a) {
      return '<tr><td><strong>' + escapeHtml(a.username) + '</strong></td><td><span class="status status-pending">مدير فرعي</span></td><td>' +
        dateTime(a.created_at) + '</td><td><div class="row-actions"><button class="mini-btn edit-btn" data-edit-admin="' + a.id + '">تعديل</button>' +
        '<button class="mini-btn delete-btn" data-delete-admin="' + a.id + '">حذف</button></div></td></tr>';
    }).join('') || '<tr><td colspan="4" class="empty">لا توجد حسابات مدراء فرعيين.</td></tr>';
  }
  async function loadQuotas() {
    var result = await api('/free-quotas', { method: 'GET' });
    quotas = result.quotas || [];
    renderQuotas();
  }
  async function refreshAll() {
    byId('btn-refresh').disabled = true;
    try {
      await loadUsers();
      if (!byId('view-quotas').classList.contains('hidden')) await loadQuotas();
      showMsg(msgBox, 'تم تحديث البيانات بنجاح.', false);
    } catch (error) { showMsg(msgBox, error.message, true); }
    finally { byId('btn-refresh').disabled = false; }
  }
  function showView(name) {
    ['overview', 'users', 'quotas', 'admins', 'password'].forEach(function (view) {
      byId('view-' + view).classList.toggle('hidden', view !== name);
    });
    document.querySelectorAll('.nav-link').forEach(function (button) {
      button.classList.toggle('active', button.dataset.view === name);
    });
    var labels = { overview: 'نظرة عامة', users: 'حسابات الإنترنت', quotas: 'الحصص المجانية', admins: 'إدارة المدراء', password: 'كلمة المرور' };
    if ((name === 'admins' || name === 'quotas' || name === 'overview') && !currentAdmin.is_super_admin) {
      showView('users');
      return;
    }
    byId('page-title').textContent = labels[name];
    byId('breadcrumb').textContent = labels[name];
    if (name === 'quotas') loadQuotas().catch(function (e) { showMsg(msgBox, e.message, true); });
    if (name === 'admins') loadAdmins().catch(function (e) { showMsg(msgBox, e.message, true); });
    if (name === 'users' && currentAdmin.is_super_admin) renderUsers();
  }
  function showApp(loggedIn) {
    byId('login-section').classList.toggle('hidden', loggedIn);
    byId('app-shell').classList.toggle('hidden', !loggedIn);
    if (loggedIn) {
      byId('admin-name').textContent = currentAdmin && currentAdmin.username || 'المدير';
      document.querySelectorAll('[data-root-only]').forEach(function (el) {
        el.classList.toggle('hidden', !currentAdmin || !currentAdmin.is_super_admin);
      });
      if (currentAdmin && currentAdmin.is_super_admin) {
        byId('view-users').querySelector('.panel:not(.create-panel)').classList.remove('hidden');
        loadUsers().catch(function (e) { showMsg(msgBox, e.message, true); });
      } else {
        showView('users');
        byId('view-users').querySelector('.panel:not(.create-panel)').classList.add('hidden');
      }
    }
  }

  document.querySelectorAll('.nav-link').forEach(function (button) {
    button.addEventListener('click', function () { showView(button.dataset.view); });
  });
  document.querySelectorAll('[data-go]').forEach(function (button) {
    button.addEventListener('click', function () { showView(button.dataset.go); });
  });
  byId('btn-refresh').addEventListener('click', refreshAll);
  byId('users-search').addEventListener('input', renderUsers);
  byId('users-filter').addEventListener('change', renderUsers);

  byId('admin-login-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    hideMsg(loginMsg);
    try {
      var result = await api('/login', {
        method: 'POST',
        body: JSON.stringify({
          username: byId('adm-user').value.trim(),
          password: byId('adm-pass').value
        })
      });
      if (!result.token) throw new Error('لم يُرجع الخادم رمز المصادقة.');
      sessionStorage.setItem(TOKEN_KEY, result.token);
      currentAdmin = result.admin || null;
      byId('adm-pass').value = '';
      showApp(true);
    } catch (error) { showMsg(loginMsg, error.message, true); }
    finally { submit.disabled = false; }
  });

  byId('create-user-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: byId('new-username').value.trim(),
          password: byId('new-password').value,
          duration_minutes: Number(byId('new-duration').value)
        })
      });
      form.reset();
      byId('new-duration').value = 180;
      showMsg(msgBox, 'تم إنشاء الحساب بنجاح.', false);
      await loadUsers();
    } catch (error) { showMsg(msgBox, error.message, true); }
    finally { button.disabled = false; }
  });

  function openEditModal(user) {
    hideMsg(byId('edit-modal-msg'));
    byId('edit-user-id').value = user.id;
    byId('edit-username').value = user.username || '';
    byId('edit-password').value = '';
    byId('edit-duration').value = user.duration_minutes;
    byId('edit-modal').classList.remove('hidden');
    setTimeout(function () { byId('edit-username').focus(); }, 0);
  }
  function closeEditModal() {
    byId('edit-modal').classList.add('hidden');
    byId('edit-user-form').reset();
    hideMsg(byId('edit-modal-msg'));
  }
  byId('edit-modal-close').addEventListener('click', closeEditModal);
  byId('edit-cancel').addEventListener('click', closeEditModal);
  byId('edit-modal').addEventListener('click', function (event) {
    if (event.target === byId('edit-modal')) closeEditModal();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !byId('edit-modal').classList.contains('hidden')) closeEditModal();
  });
  byId('edit-user-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var save = byId('edit-save');
    var userId = byId('edit-user-id').value;
    var username = byId('edit-username').value.trim();
    var password = byId('edit-password').value;
    var durationMinutes = Number(byId('edit-duration').value);
    if (!username) {
      showMsg(byId('edit-modal-msg'), 'اسم المستخدم مطلوب.', true);
      return;
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
      showMsg(byId('edit-modal-msg'), 'أدخل مدة صحيحة بالدقائق.', true);
      return;
    }
    if (password && password.length < 6) {
      showMsg(byId('edit-modal-msg'), 'كلمة المرور يجب أن تتكون من 6 أحرف على الأقل.', true);
      return;
    }
    var payload = { username: username, duration_minutes: durationMinutes };
    if (password) payload.password = password;
    save.disabled = true;
    try {
      await api('/users/' + userId, { method: 'PATCH', body: JSON.stringify(payload) });
      closeEditModal();
      showMsg(msgBox, 'تم حفظ تعديلات الحساب بنجاح.', false);
      await loadUsers();
    } catch (error) {
      showMsg(byId('edit-modal-msg'), error.message, true);
    } finally {
      save.disabled = false;
    }
  });

  byId('users-tbody').addEventListener('click', async function (event) {
    if (event.target.dataset.deleteUser) {
      if (!currentAdmin || !currentAdmin.is_super_admin) return;
      var targetUser = users.find(function (u) { return u.id === event.target.dataset.deleteUser; });
      if (!targetUser) return;
      askConfirm('حذف حساب الإنترنت', 'سيتم حذف الحساب "' + targetUser.username + '" نهائياً من قاعدة البيانات. لا يمكن التراجع عن هذه العملية.', async function () {
        try {
          await api('/users/' + targetUser.id, { method: 'DELETE' });
          showMsg(msgBox, 'تم حذف حساب الإنترنت نهائياً.', false);
          await loadUsers();
        } catch (error) { showMsg(msgBox, error.message, true); }
      });
      return;
    }
    var editId = event.target.dataset.edit;
    var toggleId = event.target.dataset.toggle;
    if (!editId && !toggleId) return;
    var user = users.find(function (u) { return u.id === (editId || toggleId); });
    if (!user) return;
    if (editId) {
      openEditModal(user);
    }
    if (toggleId) {
      var disable = event.target.dataset.disabled === 'true';
      askConfirm(disable ? 'تعطيل الحساب' : 'إعادة تفعيل الحساب', disable ? 'هل تريد تعطيل هذا الحساب؟' : 'هل تريد إعادة تفعيل هذا الحساب؟', async function () {
      try {
        await api('/users/' + user.id + '/status', {
          method: 'PATCH', body: JSON.stringify({ is_disabled: disable })
        });
        showMsg(msgBox, disable ? 'تم تعطيل الحساب.' : 'تم تفعيل الحساب.', false);
        await loadUsers();
      } catch (error) { showMsg(msgBox, error.message, true); }
      });
    }
  });

  function askConfirm(title, message, action) {
    byId('confirm-title').textContent = title;
    byId('confirm-text').textContent = message;
    byId('confirm-modal').classList.remove('hidden');
    var accept = byId('confirm-accept');
    var cancel = byId('confirm-cancel');
    function cleanup() {
      byId('confirm-modal').classList.add('hidden');
      accept.removeEventListener('click', onAccept);
      cancel.removeEventListener('click', onCancel);
    }
    function onCancel() { cleanup(); }
    async function onAccept() { cleanup(); await action(); }
    accept.addEventListener('click', onAccept);
    cancel.addEventListener('click', onCancel);
  }

  document.querySelectorAll('[data-toggle-password]').forEach(function (button) {
    button.addEventListener('click', function () {
      var input = byId(button.dataset.togglePassword);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      button.textContent = input.type === 'password' ? 'إظهار' : 'إخفاء';
    });
  });

  byId('create-admin-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/admins', { method: 'POST', body: JSON.stringify({
        username: byId('new-admin-username').value.trim(),
        password: byId('new-admin-password').value
      }) });
      form.reset();
      showMsg(msgBox, 'تم إنشاء حساب المدير الفرعي بنجاح.', false);
      await loadAdmins();
    } catch (error) { showMsg(msgBox, error.message, true); }
    finally { button.disabled = false; }
  });

  function openAdminEdit(admin) {
    byId('admin-edit-id').value = admin.id;
    byId('admin-edit-username').value = admin.username;
    byId('admin-edit-password').value = '';
    hideMsg(byId('admin-edit-msg'));
    byId('admin-edit-modal').classList.remove('hidden');
  }
  function closeAdminEdit() {
    byId('admin-edit-modal').classList.add('hidden');
    byId('admin-edit-form').reset();
  }
  byId('admin-edit-close').addEventListener('click', closeAdminEdit);
  byId('admin-edit-cancel').addEventListener('click', closeAdminEdit);
  byId('admin-edit-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = byId('admin-edit-save');
    var id = byId('admin-edit-id').value;
    var password = byId('admin-edit-password').value;
    var payload = { username: byId('admin-edit-username').value.trim() };
    if (password) payload.password = password;
    if (!payload.username || (password && password.length < 6)) {
      showMsg(byId('admin-edit-msg'), 'تحقق من اسم المستخدم وكلمة المرور (6 أحرف على الأقل).', true);
      return;
    }
    button.disabled = true;
    try {
      await api('/admins/' + id, { method: 'PATCH', body: JSON.stringify(payload) });
      closeAdminEdit();
      showMsg(msgBox, 'تم تحديث حساب المدير.', false);
      await loadAdmins();
    } catch (error) { showMsg(byId('admin-edit-msg'), error.message, true); }
    finally { button.disabled = false; }
  });
  byId('admins-tbody').addEventListener('click', function (event) {
    var editId = event.target.dataset.editAdmin;
    var deleteId = event.target.dataset.deleteAdmin;
    if (editId) {
      var admin = admins.find(function (a) { return a.id === editId && !a.is_super_admin; });
      if (admin) openAdminEdit(admin);
    }
    if (deleteId) {
      var target = admins.find(function (a) { return a.id === deleteId && !a.is_super_admin; });
      if (!target) return;
      askConfirm('حذف حساب المدير', 'سيتم حذف حساب المدير الفرعي "' + target.username + '" نهائياً.', async function () {
        try {
          await api('/admins/' + target.id, { method: 'DELETE' });
          showMsg(msgBox, 'تم حذف حساب المدير الفرعي.', false);
          await loadAdmins();
        } catch (error) { showMsg(msgBox, error.message, true); }
      });
    }
  });

  byId('change-password-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = byId('change-password-submit');
    var currentPassword = byId('current-admin-password').value;
    var newPassword = byId('new-admin-password-self').value;
    var confirmPassword = byId('confirm-admin-password').value;
    if (newPassword !== confirmPassword) {
      showMsg(byId('change-password-msg'), 'كلمتا المرور الجديدتان غير متطابقتين.', true);
      return;
    }
    button.disabled = true;
    try {
      await api('/change-password', { method: 'POST', body: JSON.stringify({
        current_password: currentPassword, new_password: newPassword
      }) });
      byId('change-password-form').reset();
      document.querySelectorAll('[data-toggle-password]').forEach(function (b) { b.textContent = 'إظهار'; });
      showMsg(byId('change-password-msg'), 'تم تغيير كلمة المرور بنجاح.', false);
    } catch (error) { showMsg(byId('change-password-msg'), error.message, true); }
    finally { button.disabled = false; }
  });

  byId('btn-logout').addEventListener('click', function () {
    sessionStorage.removeItem(TOKEN_KEY);
    currentAdmin = null;
    showApp(false);
    byId('adm-user').value = '';
    byId('adm-pass').value = '';
    hideMsg(loginMsg);
  });

  if (getToken()) {
    api('/me', { method: 'GET' })
      .then(function (result) { currentAdmin = result.admin || null; showApp(true); })
      .catch(function () { sessionStorage.removeItem(TOKEN_KEY); showApp(false); });
  }
})();
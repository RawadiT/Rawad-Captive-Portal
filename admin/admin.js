(function () {
  'use strict';

  var cfg = window.RAWAD_ADMIN_CONFIG || {};
  var TOKEN_KEY = 'rawad_admin_jwt';
  var users = [];
  var quotas = [];
  var admins = [];
  var portalSettings = null;
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
  function isSiteOwner() { return !!currentAdmin && (currentAdmin.role === 'site_owner' || currentAdmin.is_super_admin === true); }
  function canManageOperations() { return !!currentAdmin && (isSiteOwner() || currentAdmin.role === 'general'); }
  function roleLabel() {
    if (isSiteOwner()) return 'مدير الموقع';
    return currentAdmin && currentAdmin.role === 'general' ? 'مدير عام' : 'مدير فرعي';
  }

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
  function duration(user) {
    if (user.is_unlimited) return 'غير محدود';
    var seconds = user.remaining_seconds;
    if (seconds == null) return '—';
    seconds = Math.max(0, Number(seconds));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    return h ? h + ' س ' + m + ' د' : m + ' دقيقة';
  }
  function durationConfigLabel(user) {
    if (user.is_unlimited) return 'مفتوح';
    return Number(user.duration_minutes || 0).toLocaleString('ar-IQ') + ' د';
  }
  function stateOf(user) {
    if (user.is_disabled) return 'disabled';
    if (user.is_unlimited) return 'unlimited';
    if (user.is_expired) return 'expired';
    if (user.started_at) return 'active';
    return 'pending';
  }
  function stateLabel(user) {
    return ({ disabled: 'معطل', unlimited: 'مفتوح', expired: 'منتهي', active: 'نشط', pending: 'لم يبدأ' })[stateOf(user)];
  }
  function badge(user) {
    return '<span class="status status-' + stateOf(user) + '">' + stateLabel(user) + '</span>';
  }
  function renderStats() {
    byId('stat-total').textContent = users.length.toLocaleString('ar-IQ');
    byId('stat-active').textContent = users.filter(function (u) {
      var st = stateOf(u);
      return st === 'active' || st === 'unlimited';
    }).length.toLocaleString('ar-IQ');
    byId('stat-pending').textContent = users.filter(function (u) { return stateOf(u) === 'pending'; }).length.toLocaleString('ar-IQ');
    byId('stat-disabled').textContent = users.filter(function (u) { return u.is_disabled; }).length.toLocaleString('ar-IQ');
    byId('users-count').textContent = users.length.toLocaleString('ar-IQ');
  }
  function renderRecent() {
    var rows = users.slice(0, 5);
    byId('recent-users').innerHTML = rows.length ? rows.map(function (u) {
      var durText = u.is_unlimited ? 'حساب مفتوح (دون حد زمني)' : (Number(u.duration_minutes || 0).toLocaleString('ar-IQ') + ' دقيقة');
      return '<tr><td><strong>' + escapeHtml(u.username) + '</strong></td><td>' +
        durText + '</td><td>' + badge(u) +
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
        '</small></td><td>' + durationConfigLabel(u) + '</td><td>' +
        duration(u) + '</td><td>' + badge(u) + '</td><td>' + dateTime(u.started_at) +
        '</td><td>' + (u.is_unlimited ? 'دون انتهاء' : dateTime(u.expires_at)) + '</td><td><div class="row-actions">' +
        (canManageOperations()
          ? '<button class="mini-btn edit-btn" data-edit="' + u.id + '">تعديل</button>' +
            '<button class="mini-btn ' + (u.is_disabled ? 'enable-btn' : 'disable-btn') + '" data-toggle="' + u.id +
            '" data-disabled="' + (!u.is_disabled) + '">' + action + '</button>' +
            '<button class="mini-btn delete-btn" data-delete-user="' + u.id + '">حذف نهائي</button>'
          : '<span class="muted">عرض فقط</span>') + '</div></td></tr>';
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
    if (!currentAdmin) return;
    var result = await api('/users', { method: 'GET' });
    users = result.users || [];
    renderStats(); renderRecent(); renderUsers();
  }
  async function loadAdmins() {
    var result = await api('/admins', { method: 'GET' });
    admins = result.admins || [];
    byId('admins-count').textContent = admins.length.toLocaleString('ar-IQ');
    byId('admins-tbody').innerHTML = admins.filter(function (a) { return !a.is_super_admin; }).map(function (a) {
      return '<tr><td><strong>' + escapeHtml(a.username) + '</strong></td><td><span class="status ' + (a.role === 'general' ? 'status-active' : 'status-pending') + '">' + (a.role === 'general' ? 'مدير عام' : 'مدير فرعي') + '</span></td><td>' +
        dateTime(a.created_at) + '</td><td><div class="row-actions"><button class="mini-btn edit-btn" data-edit-admin="' + a.id + '">تعديل</button>' +
        '<button class="mini-btn delete-btn" data-delete-admin="' + a.id + '">حذف</button></div></td></tr>';
    }).join('') || '<tr><td colspan="4" class="empty">لا توجد حسابات مدراء إضافية.</td></tr>';
  }
  async function loadQuotas() {
    var result = await api('/free-quotas', { method: 'GET' });
    quotas = result.quotas || [];
    renderQuotas();
  }

  function applyPortalSettingsToForm(s) {
    if (!s) return;
    byId('ps-site-title').value = s.site_title || '';
    byId('ps-welcome-title').value = s.welcome_title || '';
    byId('ps-welcome-subtitle').value = s.welcome_subtitle || '';
    byId('ps-free-notice').value = s.free_notice || '';
    byId('ps-instagram-enabled').checked = !!s.instagram_enabled;
    byId('ps-instagram-url').value = s.instagram_url || '';
    byId('ps-facebook-enabled').checked = !!s.facebook_enabled;
    byId('ps-facebook-url').value = s.facebook_url || '';
    byId('ps-tiktok-enabled').checked = !!s.tiktok_enabled;
    byId('ps-tiktok-url').value = s.tiktok_url || '';
    byId('ps-whatsapp-enabled').checked = !!s.whatsapp_enabled;
    byId('ps-whatsapp-url').value = s.whatsapp_url || '';
    byId('ps-phone-enabled').checked = !!s.phone_enabled;
    byId('ps-phone-number').value = s.phone_number || '';
    updatePortalPreview();
  }

  function updatePortalPreview() {
    byId('prev-site-title').textContent = byId('ps-site-title').value.trim() || 'شبكة رواد';
    byId('prev-welcome-title').textContent = byId('ps-welcome-title').value.trim() || 'أهلاً بك في شبكة رواد';
    byId('prev-welcome-subtitle').textContent = byId('ps-welcome-subtitle').value.trim() || 'استمتع بإنترنت فائق السرعة عبر بوابة الدخول الموحدة';
    byId('prev-free-notice').textContent = byId('ps-free-notice').value.trim() || 'يحق لكل جهاز 30 دقيقة مجانية يومياً';

    var list = byId('prev-links-list');
    while (list.firstChild) list.removeChild(list.firstChild);
    var items = [
      { enabled: byId('ps-instagram-enabled').checked, val: byId('ps-instagram-url').value.trim(), label: 'Instagram' },
      { enabled: byId('ps-facebook-enabled').checked, val: byId('ps-facebook-url').value.trim(), label: 'Facebook' },
      { enabled: byId('ps-tiktok-enabled').checked, val: byId('ps-tiktok-url').value.trim(), label: 'TikTok' },
      { enabled: byId('ps-whatsapp-enabled').checked, val: byId('ps-whatsapp-url').value.trim(), label: 'WhatsApp' },
      { enabled: byId('ps-phone-enabled').checked, val: byId('ps-phone-number').value.trim(), label: byId('ps-phone-number').value.trim() || 'اتصال' }
    ];
    var count = 0;
    items.forEach(function (it) {
      if (it.enabled && it.val) {
        var pill = document.createElement('span');
        pill.className = 'preview-link-pill';
        pill.textContent = it.label;
        list.appendChild(pill);
        count++;
      }
    });
    byId('prev-links-wrap').classList.toggle('hidden', count === 0);
  }

  async function loadPortalSettings() {
    var result = await api('/portal-settings', { method: 'GET' });
    portalSettings = result.settings || null;
    applyPortalSettingsToForm(portalSettings);
  }

  async function loadCleanupSummary() {
    if (!isSiteOwner()) return;
    var result = await api('/cleanup/summary', { method: 'GET' });
    var sum = result.summary || {};
    byId('cl-past-quotas').textContent = Number(sum.past_free_quotas_count || 0).toLocaleString('ar-IQ');
    byId('cl-today-quotas').textContent = Number(sum.today_free_quotas_preserved || 0).toLocaleString('ar-IQ');
    byId('cl-baghdad-date').textContent = sum.baghdad_today || '—';
    byId('cl-ended-sessions').textContent = Number(sum.ended_sessions_count || 0).toLocaleString('ar-IQ');
    var totalAccounts = Number(sum.users_preserved || 0) + Number(sum.admins_preserved || 0);
    byId('cl-preserved-accounts').textContent = totalAccounts.toLocaleString('ar-IQ');
    byId('cl-preserved-detail').textContent =
      'مستخدمون: ' + Number(sum.users_preserved || 0).toLocaleString('ar-IQ') +
      ' | مدراء: ' + Number(sum.admins_preserved || 0).toLocaleString('ar-IQ');
  }

  async function refreshAll() {
    byId('btn-refresh').disabled = true;
    try {
      await loadUsers();
      if (!byId('view-quotas').classList.contains('hidden')) await loadQuotas();
      if (!byId('view-portal-settings').classList.contains('hidden')) await loadPortalSettings();
      if (!byId('view-cleanup').classList.contains('hidden') && isSiteOwner()) await loadCleanupSummary();
      showMsg(msgBox, 'تم تحديث البيانات بنجاح.', false);
    } catch (error) { showMsg(msgBox, error.message, true); }
    finally { byId('btn-refresh').disabled = false; }
  }

  function syncUnlimitedField(checkboxEl, durationEl, defaultVal) {
    if (checkboxEl.checked) {
      durationEl.disabled = true;
      durationEl.required = false;
      durationEl.value = '';
      durationEl.placeholder = 'مفتوح دون حد زمني';
    } else {
      durationEl.disabled = false;
      durationEl.required = true;
      if (!durationEl.value && defaultVal) durationEl.value = String(defaultVal);
      durationEl.placeholder = '';
    }
  }

  function showView(name) {
    ['overview', 'users', 'quotas', 'portal-settings', 'admins', 'cleanup', 'password'].forEach(function (view) {
      byId('view-' + view).classList.toggle('hidden', view !== name);
    });
    document.querySelectorAll('.nav-link').forEach(function (button) {
      button.classList.toggle('active', button.dataset.view === name);
    });
    var labels = {
      overview: 'نظرة عامة',
      users: 'حسابات الإنترنت',
      quotas: 'الحصص المجانية',
      'portal-settings': 'إعدادات البوابة',
      admins: 'إدارة المدراء',
      cleanup: 'تنظيف قاعدة البيانات',
      password: 'كلمة المرور'
    };
    if (((name === 'admins' || name === 'cleanup') && !isSiteOwner()) ||
        ((name === 'quotas' || name === 'overview' || name === 'portal-settings') && !canManageOperations())) {
      showView('users');
      return;
    }
    byId('page-title').textContent = labels[name] || 'لوحة الإدارة';
    byId('breadcrumb').textContent = labels[name] || 'لوحة الإدارة';
    if (name === 'quotas') loadQuotas().catch(function (e) { showMsg(msgBox, e.message, true); });
    if (name === 'portal-settings') loadPortalSettings().catch(function (e) { showMsg(msgBox, e.message, true); });
    if (name === 'admins') loadAdmins().catch(function (e) { showMsg(msgBox, e.message, true); });
    if (name === 'cleanup') loadCleanupSummary().catch(function (e) { showMsg(msgBox, e.message, true); });
    if (name === 'users') renderUsers();
  }

  function showApp(loggedIn) {
    byId('login-section').classList.toggle('hidden', loggedIn);
    byId('app-shell').classList.toggle('hidden', !loggedIn);
    if (loggedIn) {
      byId('admin-name').textContent = currentAdmin && currentAdmin.username || 'المدير';
      byId('admin-role-label').textContent = roleLabel();
      document.querySelectorAll('[data-owner-only]').forEach(function (el) {
        el.classList.toggle('hidden', !isSiteOwner());
      });
      document.querySelectorAll('[data-manager-only]').forEach(function (el) {
        el.classList.toggle('hidden', !canManageOperations());
      });
      byId('view-users').querySelector('.panel:not(.create-panel)').classList.remove('hidden');
      loadUsers().catch(function (e) { showMsg(msgBox, e.message, true); });
      if (!canManageOperations()) showView('users');
      else showView('overview');
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

  byId('create-unlimited').addEventListener('change', function () {
    syncUnlimitedField(byId('create-unlimited'), byId('new-duration'), 180);
  });
  byId('edit-unlimited').addEventListener('change', function () {
    syncUnlimitedField(byId('edit-unlimited'), byId('edit-duration'), 180);
  });

  ['ps-site-title', 'ps-welcome-title', 'ps-welcome-subtitle', 'ps-free-notice',
   'ps-instagram-enabled', 'ps-instagram-url', 'ps-facebook-enabled', 'ps-facebook-url',
   'ps-tiktok-enabled', 'ps-tiktok-url', 'ps-whatsapp-enabled', 'ps-whatsapp-url',
   'ps-phone-enabled', 'ps-phone-number'].forEach(function (id) {
    var el = byId(id);
    if (el) {
      el.addEventListener('input', updatePortalPreview);
      el.addEventListener('change', updatePortalPreview);
    }
  });

  byId('ps-reload-btn').addEventListener('click', function () {
    loadPortalSettings().then(function () {
      showMsg(msgBox, 'تمت إعادة تحميل الإعدادات المحفوظة.', false);
    }).catch(function (error) { showMsg(msgBox, error.message, true); });
  });

  byId('portal-settings-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var btn = byId('ps-save-btn');
    btn.disabled = true;
    try {
      var payload = {
        site_title: byId('ps-site-title').value.trim(),
        welcome_title: byId('ps-welcome-title').value.trim(),
        welcome_subtitle: byId('ps-welcome-subtitle').value.trim(),
        free_notice: byId('ps-free-notice').value.trim(),
        instagram_enabled: byId('ps-instagram-enabled').checked,
        instagram_url: byId('ps-instagram-url').value.trim(),
        facebook_enabled: byId('ps-facebook-enabled').checked,
        facebook_url: byId('ps-facebook-url').value.trim(),
        tiktok_enabled: byId('ps-tiktok-enabled').checked,
        tiktok_url: byId('ps-tiktok-url').value.trim(),
        whatsapp_enabled: byId('ps-whatsapp-enabled').checked,
        whatsapp_url: byId('ps-whatsapp-url').value.trim(),
        phone_enabled: byId('ps-phone-enabled').checked,
        phone_number: byId('ps-phone-number').value.trim()
      };
      var res = await api('/portal-settings', { method: 'PUT', body: JSON.stringify(payload) });
      portalSettings = res.settings || null;
      applyPortalSettingsToForm(portalSettings);
      showMsg(msgBox, 'تم حفظ إعدادات بوابة العملاء بنجاح.', false);
    } catch (error) { showMsg(msgBox, error.message, true); }
    finally { btn.disabled = false; }
  });

  byId('btn-cleanup-refresh').addEventListener('click', function () {
    loadCleanupSummary().then(function () {
      showMsg(msgBox, 'تم تحديث إحصائيات التنظيف.', false);
    }).catch(function (error) { showMsg(msgBox, error.message, true); });
  });

  byId('btn-cleanup-execute').addEventListener('click', function () {
    if (!isSiteOwner()) return;
    askConfirm(
      'تنفيذ تنظيف البيانات التشغيلية',
      'سيتم حذف سجلات free_quotas المنتهية للأيام السابقة والجلسات المنتهية فقط، مع الاحتفاظ بحصص اليوم الحالي بتوقيت بغداد وجميع حسابات المستخدمين والمدراء. هل تريد المتابعة؟',
      async function () {
        var btn = byId('btn-cleanup-execute');
        btn.disabled = true;
        try {
          var res = await api('/cleanup/execute', {
            method: 'POST',
            body: JSON.stringify({ confirm: 'CLEANUP' })
          });
          var r = res.result || {};
          showMsg(
            msgBox,
            'تم التنظيف: حذف ' + Number(r.deleted_free_quotas || 0) +
              ' حصة قديمة و ' + Number(r.deleted_sessions || 0) +
              ' جلسة منتهية مع حفظ ' + Number(r.preserved_today_free_quotas || 0) +
              ' حصة ليوم بغداد الحالي وجميع الحسابات.',
            false
          );
          await loadCleanupSummary();
        } catch (error) { showMsg(msgBox, error.message, true); }
        finally { btn.disabled = false; }
      }
    );
  });

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
    var isUnlimited = byId('create-unlimited').checked;
    button.disabled = true;
    try {
      var payload = {
        username: byId('new-username').value.trim(),
        password: byId('new-password').value,
        is_unlimited: isUnlimited
      };
      if (!isUnlimited) {
        payload.duration_minutes = Number(byId('new-duration').value);
      }
      await api('/users', { method: 'POST', body: JSON.stringify(payload) });
      form.reset();
      byId('create-unlimited').checked = false;
      syncUnlimitedField(byId('create-unlimited'), byId('new-duration'), 180);
      showMsg(msgBox, isUnlimited ? 'تم إنشاء الحساب المفتوح بنجاح.' : 'تم إنشاء الحساب بنجاح.', false);
      await loadUsers();
    } catch (error) { showMsg(msgBox, error.message, true); }
    finally { button.disabled = false; }
  });

  function openEditModal(user) {
    hideMsg(byId('edit-modal-msg'));
    byId('edit-user-id').value = user.id;
    byId('edit-username').value = user.username || '';
    byId('edit-password').value = '';
    byId('edit-unlimited').checked = !!user.is_unlimited;
    byId('edit-duration').value = user.duration_minutes || '';
    syncUnlimitedField(byId('edit-unlimited'), byId('edit-duration'), user.duration_minutes || 180);
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
    var save = byId('edit-save');
    var userId = byId('edit-user-id').value;
    var username = byId('edit-username').value.trim();
    var password = byId('edit-password').value;
    var isUnlimited = byId('edit-unlimited').checked;
    var durationMinutes = isUnlimited ? null : Number(byId('edit-duration').value);
    if (!username) {
      showMsg(byId('edit-modal-msg'), 'اسم المستخدم مطلوب.', true);
      return;
    }
    if (!isUnlimited && (!Number.isInteger(durationMinutes) || durationMinutes < 1)) {
      showMsg(byId('edit-modal-msg'), 'أدخل مدة صحيحة بالدقائق.', true);
      return;
    }
    if (password && password.length < 6) {
      showMsg(byId('edit-modal-msg'), 'كلمة المرور يجب أن تتكون من 6 أحرف على الأقل.', true);
      return;
    }
    var payload = { username: username, is_unlimited: isUnlimited };
    if (!isUnlimited) payload.duration_minutes = durationMinutes;
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
      if (!currentAdmin) return;
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
        password: byId('new-admin-password').value,
        role: byId('new-admin-role').value
      }) });
      form.reset();
      showMsg(msgBox, 'تم إنشاء حساب المدير بنجاح.', false);
      await loadAdmins();
    } catch (error) { showMsg(msgBox, error.message, true); }
    finally { button.disabled = false; }
  });

  function openAdminEdit(admin) {
    byId('admin-edit-id').value = admin.id;
    byId('admin-edit-username').value = admin.username;
    byId('admin-edit-password').value = '';
    byId('admin-edit-role').value = admin.role || 'subordinate';
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
    var payload = { username: byId('admin-edit-username').value.trim(), role: byId('admin-edit-role').value };
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
      askConfirm('حذف حساب المدير', 'سيتم حذف حساب المدير "' + target.username + '" نهائياً.', async function () {
        try {
          await api('/admins/' + target.id, { method: 'DELETE' });
          showMsg(msgBox, 'تم حذف حساب المدير.', false);
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

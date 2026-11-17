(function () {
  var cfg = window.RAWAD_ADMIN_CONFIG || {};
  var TOKEN_KEY = 'rawad_admin_jwt';
  var msgBox = document.getElementById('admin-msg');
  var loginSection = document.getElementById('login-section');
  var dashSection = document.getElementById('dashboard-section');
  var btnLogout = document.getElementById('btn-logout');

  function showMsg(text, isError) {
    msgBox.textContent = text;
    msgBox.className = 'msg ' + (isError ? 'err' : 'ok');
    msgBox.style.display = 'block';
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  async function api(path, opts) {
    var headers = Object.assign({
      'Content-Type': 'application/json',
      'apikey': cfg.supabaseAnonKey
    }, (opts && opts.headers) || {});
    var tok = getToken();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    var res = await fetch(cfg.supabaseUrl + '/functions/v1/admin-api' + path, Object.assign({}, opts, { headers: headers }));
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'فشل الطلب');
    return data;
  }

  function statusBadge(u) {
    if (u.is_disabled) return '<span class="badge b-disabled">معطل</span>';
    if (u.is_expired) return '<span class="badge b-expired">منتهي</span>';
    if (u.started_at) return '<span class="badge b-active">نشط</span>';
    return '<span class="badge b-pending">لم يبدأ بعد</span>';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('ar-IQ');
  }

  async function loadUsers() {
    var res = await api('/users', { method: 'GET' });
    var tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '';
    (res.users || []).forEach(function (u) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td></td>' +
        '<td>' + u.duration_minutes + '</td>' +
        '<td>' + statusBadge(u) + '</td>' +
        '<td>' + fmtDate(u.started_at) + '</td>' +
        '<td>' + fmtDate(u.expires_at) + '</td>' +
        '<td class="actions"></td>';
      tr.children[0].textContent = u.username;

      var actions = tr.children[5];
      var btnToggle = document.createElement('button');
      btnToggle.className = 'btn ' + (u.is_disabled ? 'btn-ok' : 'btn-danger');
      btnToggle.textContent = u.is_disabled ? 'تفعيل' : 'تعطيل';
      btnToggle.onclick = async function () {
        try {
          await api('/users/' + u.id + '/status', {
            method: 'PATCH',
            body: JSON.stringify({ is_disabled: !u.is_disabled })
          });
          showMsg('تم تحديث حالة الحساب.', false);
          loadUsers();
        } catch (e) { showMsg(e.message, true); }
      };

      var btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn-sec';
      btnEdit.textContent = 'تعديل';
      btnEdit.onclick = async function () {
        var newDur = prompt('أدخل المدة الجديدة بالدقائق:', String(u.duration_minutes));
        if (newDur === null) return;
        var newPass = prompt('كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية):', '');
        var payload = { duration_minutes: Number(newDur) };
        if (newPass) payload.password = newPass;
        try {
          await api('/users/' + u.id, { method: 'PATCH', body: JSON.stringify(payload) });
          showMsg('تم تعديل الحساب.', false);
          loadUsers();
        } catch (e) { showMsg(e.message, true); }
      };

      actions.appendChild(btnEdit);
      actions.appendChild(btnToggle);
      tbody.appendChild(tr);
    });
  }

  function showDashboard(loggedIn) {
    loginSection.style.display = loggedIn ? 'none' : 'block';
    dashSection.style.display = loggedIn ? 'block' : 'none';
    btnLogout.style.display = loggedIn ? 'inline-block' : 'none';
    if (loggedIn) loadUsers().catch(function (e) { showMsg(e.message, true); });
  }

  document.getElementById('admin-login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      var res = await api('/login', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('adm-user').value.trim(),
          password: document.getElementById('adm-pass').value
        })
      });
      document.getElementById('adm-pass').value = '';
      sessionStorage.setItem(TOKEN_KEY, res.token);
      msgBox.style.display = 'none';
      showDashboard(true);
    } catch (err) { showMsg(err.message, true); }
  });

  document.getElementById('create-user-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('new-username').value.trim(),
          password: document.getElementById('new-password').value,
          duration_minutes: Number(document.getElementById('new-duration').value)
        })
      });
      document.getElementById('new-username').value = '';
      document.getElementById('new-password').value = '';
      showMsg('تم إنشاء الحساب بنجاح.', false);
      loadUsers();
    } catch (err) { showMsg(err.message, true); }
  });

  document.getElementById('btn-refresh').addEventListener('click', function () {
    loadUsers().catch(function (e) { showMsg(e.message, true); });
  });

  btnLogout.addEventListener('click', function () {
    sessionStorage.removeItem(TOKEN_KEY);
    showDashboard(false);
  });

  if (getToken()) {
    api('/me', { method: 'GET' })
      .then(function () { showDashboard(true); })
      .catch(function () { sessionStorage.removeItem(TOKEN_KEY); showDashboard(false); });
  }
})();

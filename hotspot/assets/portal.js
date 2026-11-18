(function () {
  var cfg = window.RAWAD_PORTAL_CONFIG || {};
  var inFlight = false;

  var msgBox = document.getElementById('msg-box');
  var btnFree = document.getElementById('btn-free');
  var btnLogin = document.getElementById('btn-login');
  var btnToggleLogin = document.getElementById('btn-toggle-login');
  var loginPanel = document.getElementById('login-panel');
  var btnTogglePassword = document.getElementById('btn-toggle-password');
  var loginForm = document.getElementById('login-form');
  var hsForm = document.getElementById('hs-auth-form');

  function showMsg(text, isError) {
    if (!msgBox) return;
    msgBox.textContent = text;
    msgBox.className = 'msg ' + (isError ? 'err' : 'ok');
    msgBox.style.display = 'block';
  }

  function setBusy(busy, activeBtn, label) {
    inFlight = busy;
    if (btnFree) btnFree.disabled = busy;
    if (btnLogin) btnLogin.disabled = busy;
    if (activeBtn) {
      if (busy) {
        if (!activeBtn.dataset.idleHtml) {
          activeBtn.dataset.idleHtml = activeBtn.innerHTML;
        }
        activeBtn.innerHTML = '<span class="spinner"></span><span>' + label + '</span>';
      } else {
        activeBtn.innerHTML = activeBtn.dataset.idleHtml || label;
      }
    }
  }

  function setLoginPanelOpen(open) {
    if (!loginPanel || !btnToggleLogin) return;
    loginPanel.classList.toggle('is-open', open);
    btnToggleLogin.classList.toggle('is-open', open);
    btnToggleLogin.setAttribute('aria-expanded', open ? 'true' : 'false');
    loginPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      var usernameEl = document.getElementById('username');
      if (usernameEl) {
        setTimeout(function () { usernameEl.focus(); }, 180);
      }
    }
  }

  if (btnToggleLogin && loginPanel) {
    btnToggleLogin.addEventListener('click', function () {
      var isOpen = loginPanel.classList.contains('is-open');
      setLoginPanelOpen(!isOpen);
    });
  }

  if (btnTogglePassword) {
    btnTogglePassword.addEventListener('click', function () {
      var passwordEl = document.getElementById('password');
      if (!passwordEl) return;
      var reveal = passwordEl.type === 'password';
      passwordEl.type = reveal ? 'text' : 'password';
      btnTogglePassword.textContent = reveal ? 'إخفاء' : 'إظهار';
      btnTogglePassword.setAttribute('aria-pressed', reveal ? 'true' : 'false');
      btnTogglePassword.setAttribute('aria-label', reveal ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    });
  }

  async function callPortalAuth(payload) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
      var res = await fetch(cfg.supabaseUrl + '/functions/v1/portal-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabasePublishableKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'تعذر إتمام التحقق. يرجى المحاولة مجدداً.');
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function saveSessionQuota(res) {
    if (!res) return;
    try {
      var expiresAtMs = res.expires_at ? Date.parse(res.expires_at) : NaN;
      if (!isFinite(expiresAtMs) && typeof res.remaining_seconds === 'number' && isFinite(res.remaining_seconds)) {
        expiresAtMs = Date.now() + Math.max(0, res.remaining_seconds) * 1000;
      }
      if (!isFinite(expiresAtMs)) return;
      var totalSec = (typeof res.remaining_seconds === 'number' && isFinite(res.remaining_seconds))
        ? Math.max(1, Math.floor(res.remaining_seconds))
        : Math.max(1, Math.round((expiresAtMs - Date.now()) / 1000));
      sessionStorage.setItem('rawad_session_quota', JSON.stringify({
        expiresAtMs: expiresAtMs,
        totalSeconds: totalSec,
        mac: cfg.mac || ''
      }));
    } catch (e) {}
  }

  function completeHotspotLogin() {
    if (!hsForm) return false;

    if (
      typeof hexMD5 !== 'function' ||
      !cfg.chapId ||
      !cfg.chapChallenge
    ) {
      showMsg('تعذر تهيئة مصادقة MikroTik. يرجى إعادة تحميل الصفحة.', true);
      return false;
    }

    hsForm.elements.username.value = 'rawad-gate';
    hsForm.elements.password.value =
      hexMD5(String(cfg.chapId) + 'rawad-gate' + String(cfg.chapChallenge));

    hsForm.submit();
    return true;
  }

  if (btnFree) {
    btnFree.addEventListener('click', async function () {
      if (inFlight) return;
      setBusy(true, btnFree, 'جارٍ التحقق من الحصة...');
      try {
        var res = await callPortalAuth({
          action: 'free',
          mac: cfg.mac,
          ip: cfg.ip
        });
        var mins = Math.max(1, Math.ceil((res.remaining_seconds || 1800) / 60));
        saveSessionQuota(res);
        showMsg('تم التحقق بنجاح (' + mins + ' دقيقة متاحة). جارٍ تفعيل الإنترنت...', false);
        completeHotspotLogin();
      } catch (err) {
        var msg = err && err.name === 'AbortError' ? 'انتهت مهلة الاتصال بخادم التحقق.' : (err && err.message) || 'فشل التحقق';
        showMsg(msg, true);
        setBusy(false, btnFree, 'الحصول على 30 دقيقة مجانية');
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (inFlight) return;
      var usernameEl = document.getElementById('username');
      var passwordEl = document.getElementById('password');
      var username = usernameEl ? usernameEl.value.trim() : '';
      var password = passwordEl ? passwordEl.value : '';
      if (!username || !password) {
        showMsg('يرجى إدخال اسم المستخدم وكلمة المرور.', true);
        return;
      }
      setBusy(true, btnLogin, 'جارٍ تسجيل الدخول...');
      try {
        var loginRes = await callPortalAuth({
          action: 'login',
          mac: cfg.mac,
          ip: cfg.ip,
          username: username,
          password: password
        });
        if (passwordEl) passwordEl.value = '';
        saveSessionQuota(loginRes);
        showMsg('تم التحقق من الحساب بنجاح. جارٍ تفعيل الإنترنت...', false);
        completeHotspotLogin();
      } catch (err) {
        var msg = err && err.name === 'AbortError' ? 'انتهت مهلة الاتصال بخادم التحقق.' : (err && err.message) || 'بيانات الدخول غير صحيحة';
        showMsg(msg, true);
        setBusy(false, btnLogin, 'تسجيل الدخول');
      }
    });
  }
})();

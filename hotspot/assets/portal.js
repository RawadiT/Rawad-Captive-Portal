(function () {
  var cfg = window.RAWAD_PORTAL_CONFIG || {};
  var inFlight = false;

  var msgBox = document.getElementById('msg-box');
  var btnFree = document.getElementById('btn-free');
  var btnLogin = document.getElementById('btn-login');
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
      activeBtn.innerHTML = busy ? '<span class="spinner"></span><span>' + label + '</span>' : label;
    }
  }

  async function callPortalAuth(payload) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
      var res = await fetch(cfg.supabaseUrl + '/functions/v1/portal-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabaseAnonKey,
          'Authorization': 'Bearer ' + cfg.supabaseAnonKey
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

  function completeHotspotLogin() {
    if (!hsForm) return;
    hsForm.submit();
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
        await callPortalAuth({
          action: 'login',
          mac: cfg.mac,
          ip: cfg.ip,
          username: username,
          password: password
        });
        if (passwordEl) passwordEl.value = '';
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

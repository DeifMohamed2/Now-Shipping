(function () {
  const i18n = window.FP_I18N || {};
  const el = (id) => document.getElementById(id);
  const alertOk = el('alertSuccess');
  const alertErr = el('alertError');
  const steps = [el('step1'), el('step2'), el('step3')];
  const bars = document.querySelectorAll('.fp-steps-bar .seg');
  const emailInput = el('fp-email');
  const otpInput = el('fp-otp');
  const newPass = el('fp-new');
  const confirmPass = el('fp-confirm');
  const btnSend = el('btn-send-otp');
  const btnVerify = el('btn-verify-otp');
  const btnReset = el('btn-reset');

  let resetToken = '';
  let currentStep = 1;

  function showAlert(which, msg) {
    alertOk.classList.remove('show');
    alertErr.classList.remove('show');
    if (!msg) return;
    if (which === 'ok') {
      alertOk.textContent = msg;
      alertOk.classList.add('show');
    } else {
      alertErr.textContent = msg;
      alertErr.classList.add('show');
    }
  }

  function setLoading(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    btn.classList.toggle('btn-loading', !!on);
  }

  function validEmail(v) {
    const s = String(v || '').trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  function showStep(n) {
    currentStep = n;
    steps.forEach((s, i) => {
      if (!s) return;
      s.classList.toggle('is-active', i + 1 === n);
    });
    bars.forEach((b, i) => {
      b.classList.remove('active', 'done');
      if (i + 1 < n) b.classList.add('done');
      else if (i + 1 === n) b.classList.add('active');
    });
    if (n === 2) otpInput.focus();
    if (n === 3) newPass.focus();
  }

  btnSend.addEventListener('click', async function () {
    showAlert(null, '');
    if (!validEmail(emailInput.value)) {
      showAlert('err', i18n.invalidEmail || 'Please enter a valid email address.');
      return;
    }
    setLoading(btnSend, true);
    try {
      const res = await fetch('/forgot-password/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput.value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert('err', data.message || i18n.sendFailed || 'Could not send email.');
        return;
      }
      showAlert('ok', data.message || '');
      resetToken = '';
      showStep(2);
    } catch (e) {
      showAlert('err', i18n.networkError || 'Network error.');
    } finally {
      setLoading(btnSend, false);
    }
  });

  btnVerify.addEventListener('click', async function () {
    showAlert(null, '');
    if (!validEmail(emailInput.value)) {
      showAlert('err', i18n.invalidEmail || 'Invalid email.');
      return;
    }
    const otp = String(otpInput.value || '').trim();
    if (!/^\d{6}$/.test(otp)) {
      showAlert('err', i18n.invalidOtp || 'Enter the 6-digit code from your email.');
      return;
    }
    setLoading(btnVerify, true);
    try {
      const res = await fetch('/forgot-password/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          otp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert('err', data.message || i18n.invalidOtp || 'Verification failed.');
        return;
      }
      resetToken = data.resetToken || '';
      if (!resetToken) {
        showAlert('err', i18n.sessionExpired || 'Please start again.');
        return;
      }
      showAlert('ok', data.message || '');
      showStep(3);
    } catch (e) {
      showAlert('err', i18n.networkError || 'Network error.');
    } finally {
      setLoading(btnVerify, false);
    }
  });

  btnReset.addEventListener('click', async function () {
    showAlert(null, '');
    if (!resetToken) {
      showAlert('err', i18n.sessionExpired || 'Please verify the code again.');
      showStep(2);
      return;
    }
    if (String(newPass.value || '').length < 8) {
      showAlert('err', i18n.passwordMin || 'Password must be at least 8 characters.');
      return;
    }
    if (newPass.value !== confirmPass.value) {
      showAlert('err', i18n.passwordMismatch || 'Passwords do not match.');
      return;
    }
    setLoading(btnReset, true);
    try {
      const res = await fetch('/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resetToken,
          newPassword: newPass.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert('err', data.message || i18n.sessionExpired || 'Request failed.');
        if (res.status === 400 && /expired|start again/i.test(String(data.message || ''))) {
          resetToken = '';
          showStep(1);
        }
        return;
      }
      showAlert('ok', data.message || '');
      setTimeout(function () {
        window.location.href = '/login';
      }, 1500);
    } catch (e) {
      showAlert('err', i18n.networkError || 'Network error.');
    } finally {
      setLoading(btnReset, false);
    }
  });
})();

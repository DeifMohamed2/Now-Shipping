(function () {
  function initForgotPassword() {
    const i18n = window.FP_I18N || {};
    const el = (id) => document.getElementById(id);
    const alertOk = el('alertSuccess');
    const alertErr = el('alertError');
    const steps = [el('step1'), el('step2'), el('step3')];
    const bars = document.querySelectorAll('.fp-steps-bar .seg');
    const phoneInput = el('fp-phone');
    const otpInput = el('fp-otp');
    const newPass = el('fp-new');
    const confirmPass = el('fp-confirm');
    const btnSend = el('btn-send-otp');
    const btnVerify = el('btn-verify-otp');
    const btnReset = el('btn-reset');

    if (!phoneInput || !btnSend || !btnVerify || !btnReset) {
      console.error('Forgot password form elements are missing from the page.');
      return;
    }

    let resetToken = '';

    function showAlert(which, msg) {
      if (alertOk) alertOk.classList.remove('show');
      if (alertErr) alertErr.classList.remove('show');
      if (!msg) return;
      if (which === 'ok' && alertOk) {
        alertOk.textContent = msg;
        alertOk.classList.add('show');
      } else if (alertErr) {
        alertErr.textContent = msg;
        alertErr.classList.add('show');
      }
    }

    function setLoading(btn, on) {
      if (!btn) return;
      btn.disabled = !!on;
      btn.classList.toggle('btn-loading', !!on);
    }

    function normalizePhone(raw) {
      const digits = String(raw || '').replace(/\D/g, '');
      if (/^0\d{10}$/.test(digits)) return digits;
      if (/^20\d{10}$/.test(digits)) return `0${digits.slice(2)}`;
      return digits;
    }

    function validPhone(v) {
      return /^\d{11}$/.test(normalizePhone(v));
    }

    function getPhoneValue() {
      return normalizePhone(phoneInput && phoneInput.value);
    }

    function showStep(n) {
      steps.forEach((s, i) => {
        if (!s) return;
        s.classList.toggle('is-active', i + 1 === n);
      });
      bars.forEach((b, i) => {
        b.classList.remove('active', 'done');
        if (i + 1 < n) b.classList.add('done');
        else if (i + 1 === n) b.classList.add('active');
      });
      if (n === 2 && otpInput) otpInput.focus();
      if (n === 3 && newPass) newPass.focus();
    }

    btnSend.addEventListener('click', async function () {
      showAlert(null, '');
      if (!validPhone(phoneInput.value)) {
        showAlert('err', i18n.invalidPhone || 'Please enter a valid 11-digit phone number.');
        return;
      }
      setLoading(btnSend, true);
      try {
        const res = await fetch('/forgot-password/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: getPhoneValue() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg =
            res.status === 404
              ? data.message || i18n.phoneNotFound || 'No business account found with this phone number.'
              : data.message || i18n.sendFailed || 'Could not send SMS.';
          showAlert('err', msg);
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
      if (!validPhone(phoneInput.value)) {
        showAlert('err', i18n.invalidPhone || 'Invalid phone number.');
        return;
      }
      const otp = String((otpInput && otpInput.value) || '').trim();
      if (!/^\d{6}$/.test(otp)) {
        showAlert('err', i18n.invalidOtp || 'Enter the 6-digit code from your SMS.');
        return;
      }
      setLoading(btnVerify, true);
      try {
        const res = await fetch('/forgot-password/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phoneNumber: getPhoneValue(),
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
      if (String((newPass && newPass.value) || '').length < 8) {
        showAlert('err', i18n.passwordMin || 'Password must be at least 8 characters.');
        return;
      }
      if (!newPass || !confirmPass || newPass.value !== confirmPass.value) {
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initForgotPassword);
  } else {
    initForgotPassword();
  }
})();

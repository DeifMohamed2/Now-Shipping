(function () {
  'use strict';

  /* ========== Mobile Nav Toggle ========== */
  const navToggle = document.getElementById('navToggle');
  const mainNav = document.getElementById('mainNav');

  if (navToggle && mainNav) {
    navToggle.addEventListener('click', () => {
      const isOpen = mainNav.classList.toggle('is-open');
      navToggle.classList.toggle('is-active', isOpen);
      navToggle.setAttribute('aria-expanded', isOpen);
    });

    mainNav.querySelectorAll('.nav__link').forEach((link) => {
      link.addEventListener('click', () => {
        mainNav.classList.remove('is-open');
        navToggle.classList.remove('is-active');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ========== Smooth Scroll ========== */
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const offset = 80;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  /* ========== FAQ Accordion ========== */
  const faqList = document.getElementById('faqList');
  if (faqList) {
    const items = faqList.querySelectorAll('.faq-item');

    items.forEach((item) => {
      const trigger = item.querySelector('.faq-item__trigger');
      const icon = item.querySelector('.faq-item__icon');

      trigger.addEventListener('click', () => {
        const isOpen = item.classList.contains('is-open');

        items.forEach((other) => {
          other.classList.remove('is-open');
          other.querySelector('.faq-item__trigger').setAttribute('aria-expanded', 'false');
          other.querySelector('.faq-item__icon').textContent = '+';
        });

        if (!isOpen) {
          item.classList.add('is-open');
          trigger.setAttribute('aria-expanded', 'true');
          icon.textContent = '−';
        }
      });
    });
  }

  /* ========== Bar Chart Animation ========== */
  const barChart = document.getElementById('barChart');
  if (barChart) {
    const bars = barChart.querySelectorAll('.bar-chart__bar');

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            bars.forEach((bar) => {
              const h = bar.getAttribute('data-height') || '50';
              bar.style.height = `${h}%`;
            });
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.3 }
    );

    observer.observe(barChart);
  }

  /* ========== Form Validation ========== */
  const form = document.getElementById('registerForm');
  const formCard = document.getElementById('formCard');

  const phoneRegex = /^01[0-9]{9}$/;

  function showError(fieldName, message) {
    const field = document.getElementById(fieldName);
    const group = field?.closest('.form-group');
    const errorEl = document.querySelector(`[data-for="${fieldName}"]`);
    if (group) group.classList.add('has-error');
    if (errorEl) errorEl.textContent = message;
  }

  function clearErrors() {
    form.querySelectorAll('.form-group').forEach((g) => g.classList.remove('has-error'));
    form.querySelectorAll('.form-error').forEach((e) => (e.textContent = ''));
  }

  function validate() {
    clearErrors();
    let valid = true;

    const fullName = document.getElementById('fullName').value.trim();
    const phone = document.getElementById('phone').value.trim().replace(/\s/g, '');
    const storeName = document.getElementById('storeName').value.trim();
    const productType = document.getElementById('productType').value;
    const monthlyOrders = document.getElementById('monthlyOrders').value;

    if (!fullName || fullName.length < 2) {
      showError('fullName', 'من فضلك أدخل اسمك بالكامل');
      valid = false;
    }

    if (!phoneRegex.test(phone)) {
      showError('phone', 'من فضلك أدخل رقم موبايل مصري صحيح (01XXXXXXXXX)');
      valid = false;
    }

    if (!storeName || storeName.length < 2) {
      showError('storeName', 'من فضلك أدخل اسم المتجر أو البيزنس');
      valid = false;
    }

    if (!productType) {
      showError('productType', 'من فضلك اختر نوع المنتجات');
      valid = false;
    }

    if (!monthlyOrders) {
      showError('monthlyOrders', 'من فضلك اختر عدد الأوردرات الشهرية');
      valid = false;
    }

    return valid;
  }

  if (form && formCard) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate()) return;

      const submitBtn = form.querySelector('button[type="submit"]');
      const defaultBtnHtml = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> جاري الإرسال...';
      }

      const existingErr = formCard.querySelector('.form-submit-error');
      if (existingErr) existingErr.remove();

      const payload = {
        fullName: document.getElementById('fullName').value.trim(),
        phone: document.getElementById('phone').value.trim().replace(/\s/g, ''),
        storeName: document.getElementById('storeName').value.trim(),
        productType: document.getElementById('productType').value,
        monthlyOrders: document.getElementById('monthlyOrders').value,
      };

      try {
        const res = await fetch('/api/landing/applications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.success) {
          throw new Error(data.message || 'submit_failed');
        }

        formCard.innerHTML = `
        <div class="form-card--success">
          <i class="fa-solid fa-circle-check"></i>
          <h3>تم إرسال بياناتك بنجاح!</h3>
          <p>فريق Now هيتواصل معاك خلال 24 ساعة بـ عرض مخصص لحجم بزنسك.</p>
        </div>
      `;
      } catch (err) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = defaultBtnHtml;
        }
        const errEl = document.createElement('p');
        errEl.className = 'form-submit-error';
        errEl.setAttribute('role', 'alert');
        errEl.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> لم يتم إرسال البيانات. حاول مرة أخرى.';
        form.insertAdjacentElement('afterend', errEl);
      }
    });
  }

  /* ========== Navbar shadow on scroll ========== */
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    window.addEventListener(
      'scroll',
      () => {
        navbar.style.boxShadow = window.scrollY > 20 ? '0 4px 20px rgba(16,42,79,0.08)' : 'none';
      },
      { passive: true }
    );
  }
})();

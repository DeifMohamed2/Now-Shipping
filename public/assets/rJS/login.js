const loginForm = document.getElementById('loginForm');
const errorMessage = document.getElementById('errorMessage');
const loginButton = document.querySelector('.btn-login');
const btnText = document.querySelector('.btn-text');

let isSubmitting = false;

function validateEmailOrPhone(value) {
  const s = String(value).trim();
  if (!s) return false;
  const emailRe =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  if (emailRe.test(s.toLowerCase())) return true;
  const digits = s.replace(/\D/g, '');
  return /^\d{11}$/.test(digits);
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // Prevent multiple submissions
  if (isSubmitting) return;
  
  const formData = new FormData(loginForm);
  const formObject = Object.fromEntries(formData.entries());
  if (!validateEmailOrPhone(formObject.email || '')) {
    showError('Please enter a valid email address or 11-digit phone number.');
    return;
  }
  if (String(formObject.password || '').length < 8) {
    showError('Password must be at least 8 characters.');
    return;
  }

  isSubmitting = true;
  
  // Show loading state
  showLoadingState();
  
  // Hide any previous errors
  hideError();
  
  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formObject),
    });

    const data = await response.json();
    
    if (response.ok) {
      // Success - redirect
      window.location.href = '/business/dashboard';
    } else {
      // Show error without resetting form
      showError(data.message || 'Login failed. Please try again.');
    }
  } catch (err) {
    console.error('Login error:', err);
    showError('Network error. Please check your connection and try again.');
  } finally {
    // Reset loading state
    hideLoadingState();
    isSubmitting = false;
  }
});

function showLoadingState() {
  if (loginButton) {
    loginButton.classList.add('btn-loading');
    loginButton.disabled = true;
  }
}

function hideLoadingState() {
  if (loginButton) {
    loginButton.classList.remove('btn-loading');
    loginButton.disabled = false;
  }
}

function showError(message) {
  if (errorMessage) {
    errorMessage.style.display = 'block';
    errorMessage.innerText = message;
    errorMessage.classList.add('shake');
    
    // Remove shake animation after it completes
    setTimeout(() => {
      errorMessage.classList.remove('shake');
    }, 600);
  }
}

function hideError() {
  if (errorMessage) {
    errorMessage.style.display = 'none';
    errorMessage.innerText = '';
  }
}

const loginForm = document.getElementById('loginForm');
const errorMessage = document.getElementById('errorMessage');
const loginButton = document.querySelector('.btn-login');
const btnText = document.querySelector('.btn-text');

let isSubmitting = false;

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // Prevent multiple submissions
  if (isSubmitting) return;
  
  isSubmitting = true;
  
  // Show loading state
  showLoadingState();
  
  // Hide any previous errors
  hideError();
  
  try {
    const formData = new FormData(loginForm);
    const formObject = Object.fromEntries(formData.entries());
    
    const response = await fetch('/admin-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formObject),
    });

    const data = await response.json();
    
    if (response.ok) {
      // Success - redirect
      window.location.href = '/admin/dashboard';
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

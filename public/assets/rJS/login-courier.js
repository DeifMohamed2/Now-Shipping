const loginForm = document.getElementById('loginForm');
const errorMessage = document.getElementById('errorMessage');
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const formData = new FormData(loginForm);
    const formObject = Object.fromEntries(formData.entries());
    const response = await fetch('/courier-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formObject),
    });

    const data = await response.json();
    if (response.ok) {
      window.location.href = '/courier/dashboard';
    } else {
    errorMessage.style.display = 'block';
      errorMessage.innerText = data.message;
    }
  } catch (err) {
    console.error('An error occurred:', err);
        errorMessage.style.display = 'block';

errorMessage.innerText = 'An error occurred. Please try again.';  
} finally {
    
    loginForm.reset();
  }
});

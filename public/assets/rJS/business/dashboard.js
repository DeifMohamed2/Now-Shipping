// Helper function to check if an element is visible
function isVisible(el) {
  return el.offsetParent !== null; // Ensures only displayed elements are considered
}

// Helper function to clear all input values inside a container
function clearFormInputs(container) {
  if (!container) return;
  const inputs = container.querySelectorAll('input, select, textarea');
  inputs.forEach((input) => {
    if (input.type === 'checkbox' || input.type === 'radio') {
      input.checked = false;
    } else {
      input.value = '';
    }
    input.classList.remove('is-invalid'); // Remove validation errors when clearing
  });
}

// Validate only the visible required fields in the current tab
function validateCurrentStep(currentTabPane) {
  let isValid = true;
  const requiredElements = currentTabPane.querySelectorAll(
    'input[required], select[required], textarea[required]'
  );

  requiredElements.forEach((el) => {
    if (!isVisible(el)) {
      el.removeAttribute('required'); // Prevents hidden fields from being validated
      return;
    }

    if (el.type === 'radio') {
      const groupName = el.name;
      const radioGroup = currentTabPane.querySelectorAll(
        `input[name="${groupName}"]`
      );
      const groupChecked = Array.from(radioGroup).some(
        (radio) => radio.checked
      );

      if (!groupChecked) {
        isValid = false;
        radioGroup.forEach((radio) => radio.classList.add('is-invalid'));
      } else {
        radioGroup.forEach((radio) => radio.classList.remove('is-invalid'));
      }
    } else {
      if (!el.value) {
        isValid = false;
        el.classList.add('is-invalid');
      } else {
        el.classList.remove('is-invalid');
      }
    }
  });

  return isValid;
}

// Mark step as completed
function markStepAsDone(currentTabPane) {
  const tabId = currentTabPane.getAttribute('id');
  const tabLink = document.querySelector(
    `[href="#${tabId}"], [data-bs-target="#${tabId}"]`
  );
  if (tabLink) {
    tabLink.classList.add('completed');
    const icon = tabLink.querySelector('.step-icon');
    if (icon) {
      icon.classList.remove('ri-close-circle-fill');
      icon.classList.add('ri-check-circle-fill');
    }
  }
}

document.querySelectorAll('.form-steps').forEach((formSteps) => {
  // Prevent navigation unless the current tab is valid
  document.querySelectorAll('.nav-link').forEach((navLink) => {
    navLink.addEventListener('click', function (e) {
      const currentTabPane = document.querySelector('.tab-pane.show.active');
      if (currentTabPane && !validateCurrentStep(currentTabPane)) {
        e.preventDefault();
        alert('Please fill all required fields before leaving this step.');
        return false;
      }
    });
  });

  // Payment Method Selection
  formSteps.querySelectorAll('.payment-option').forEach((paymentOption) => {
    paymentOption.addEventListener('click', function () {
      formSteps
        .querySelectorAll('.payment-option')
        .forEach((option) => option.classList.remove('active'));
      this.classList.add('active');

      document.querySelectorAll('.payment-detail').forEach((detail) => {
        clearFormInputs(detail);
        detail.style.display = 'none';
      });

      const method = this.getAttribute('data-value');
      if (method) {
        const detailDiv = document.getElementById(method + 'Details');
        if (detailDiv) {
          detailDiv.style.display = 'block';
          document.getElementById('paymentDetails').style.display = 'block';
        }
      }

      const radioInput = this.querySelector('.payment-radio');
      if (radioInput) {
        radioInput.checked = true;
      }
    });
  });

  // Brand Type Selection
  formSteps.querySelectorAll('.brand-option').forEach((brandOption) => {
    brandOption.addEventListener('click', function () {
      formSteps
        .querySelectorAll('.brand-option')
        .forEach((option) => option.classList.remove('active'));
      this.classList.add('active');

      const brandType = this.getAttribute('data-value');
      const personalFields = document.getElementById('personalFields');
      const companyFields = document.getElementById('companyFields');

      if (brandType === 'personal') {
        clearFormInputs(companyFields);
        companyFields
          .querySelectorAll('input, select')
          .forEach((el) => el.removeAttribute('required')); // Disable validation for hidden fields
        personalFields
          .querySelectorAll('input, select')
          .forEach((el) => el.setAttribute('required', 'required'));
        personalFields.style.display = 'block';
        companyFields.style.display = 'none';
      } else if (brandType === 'company') {
        clearFormInputs(personalFields);
        personalFields
          .querySelectorAll('input, select')
          .forEach((el) => el.removeAttribute('required')); // Disable validation for hidden fields
        companyFields
          .querySelectorAll('input, select')
          .forEach((el) => el.setAttribute('required', 'required'));
        companyFields.style.display = 'block';
        personalFields.style.display = 'none';
      }

      const radioInput = this.querySelector('.brand-radio');
      if (radioInput) {
        radioInput.checked = true;
      }
    });
  });

  // Next Tab Navigation
  formSteps.querySelectorAll('.nexttab').forEach((nextBtn) => {
    nextBtn.addEventListener('click', function () {
      const currentTabPane = formSteps.querySelector('.tab-pane.show.active');
      if (!validateCurrentStep(currentTabPane)) {
        alert('Please complete all required fields before continuing.');
        return;
      }

      const nextTabId = this.getAttribute('data-nexttab');
      if (!nextTabId) {
        console.error('Next tab not found');
        return;
      }

      const nextTab = document.getElementById(nextTabId);
      if (nextTab) {
        currentTabPane.classList.remove('show', 'active');
        nextTab.click();
        markStepAsDone(currentTabPane);
      }
    });
  });

  // Submit Form
  const verificationForm = document.getElementById('verificationForm');
const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/dusod9wxt/upload';
const CLOUDINARY_UPLOAD_PRESET = 'order_project'; // Get this from Cloudinary settings


let uploadedPhotos = []; // Store uploaded image URLs
const submitButton = document.getElementById('submitButton'); // Get Submit Button
const photoCountDisplay = document.getElementById('photoCount'); // Get Photo Count Display

// ✅ Handle Multiple File Uploads to Cloudinary (Keep Old Photos & Show Progress)
document.querySelectorAll('.filepond-input-multiple').forEach((input) => {
  input.addEventListener('change', async function (event) {
    const files = Array.from(event.target.files);
    uploadedPhotos = []; // Reset previously uploaded images

    if (files.length > 0) {
      submitButton.disabled = true;
      submitButton.innerText = 'Uploading Photos... 0%';

      const totalFiles = files.length;
      let uploadedCount = 0;
      let startTime = Date.now();

      const uploadPromises = files.map(async (file, index) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

        try {
          const response = await fetch(CLOUDINARY_URL, {
            method: 'POST',
            body: formData,
          });
          const data = await response.json();
          if (data.secure_url) {
            uploadedPhotos.push(data.secure_url);
            uploadedCount++;

            // ✅ Calculate Progress
            let progress = Math.round((uploadedCount / totalFiles) * 100);
            let elapsedTime = (Date.now() - startTime) / 1000; // Time in seconds
            let avgTimePerFile = elapsedTime / uploadedCount;
            let remainingTime = Math.max(
              0,
              Math.round(avgTimePerFile * (totalFiles - uploadedCount))
            );

            submitButton.innerText = `Uploading Photos... ${progress}% (${remainingTime}s left)`;
          }
        } catch (error) {
          console.error('Error uploading image:', error);
        }
      });

      await Promise.all(uploadPromises);

      submitButton.disabled = false;
      submitButton.innerText = 'Submit All';
      photoCountDisplay.innerText = `Uploaded Photos: ${uploadedPhotos.length}`;
      console.log('Uploaded Photos:', uploadedPhotos);
    }
  });
});

// ✅ Form Submission
document
  .getElementById('verificationForm')
  .addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('Submit button clicked');

    const lastStep = document.querySelector('.tab-pane.show.active');
    if (!validateCurrentStep(lastStep)) {
      alert('Please complete all required fields before submitting.');
      return;
    }

    try {
      const formData = new FormData(e.target);
      const formObject = Object.fromEntries(formData.entries());

      // ✅ Capture Selling Points
      const sellingPoints = [];
      document
      .querySelectorAll('input[name="sellingPoints[]"]:checked')
      .forEach((checkbox) => {
        sellingPoints.push(checkbox.value);
      });

      formObject.sellingPoints = sellingPoints;
      formObject.photosOfBrandType = uploadedPhotos; // ✅ Attach Cloudinary image URLs

      console.log('Final Form Data:', formObject); // Debugging

      const response = await fetch('/business/completionConfirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formObject),
      });

      const data = await response.json();
      console.log('Server Response:', data);
      if (response.ok) {
      Swal.fire({
        icon: 'success',
        title: 'Success!',
        text: data.message || 'Account Successfully Fully Completed',
        confirmButtonText: 'OK',
      }).then((result) => {
        if (result.isConfirmed) {
          window.location.reload();
        }
      });
      } else {
      Swal.fire({
        icon: 'error',
        title: 'Oops...',
        text: data.error || 'An error occurred. Please try again.',
      });
      }
    } catch (err) {
      console.error('An error occurred:', err);
      Swal.fire({
      icon: 'error',
      title: 'Oops...',
      text: 'An error occurred. Please try again.',
      });
    }
  });
});

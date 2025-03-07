// Profile Image Upload
document
  .querySelector('#profile-img-file-input')
  ?.addEventListener('change', function () {
    const profileImage = document.querySelector('.user-profile-image');
    const file = this.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function (e) {
        profileImage.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  });

// Email Verification Step
document
  .querySelector('#verify-gmail-btn')
  ?.addEventListener('click', function () {
    const emailVerificationTab = document.querySelector(
      '#v-pills-bill-info-tab'
    );
    if (emailVerificationTab) {
      emailVerificationTab.classList.add('done');
    }
  });

// Form Wizard Functionality
document.querySelectorAll('.form-steps').forEach((formSteps) => {
  // Next Tab Navigation
  formSteps.querySelectorAll('.nexttab').forEach((nextBtn) => {
    nextBtn.addEventListener('click', function () {
      const currentTabPane = formSteps.querySelector('.tab-pane.show.active');
      let isValid = validateCurrentStep(currentTabPane);

      if (isValid) {
        const nextTabId = this.getAttribute('data-nexttab');
        const nextTab = document.getElementById(nextTabId);
        if (nextTab) {
          nextTab.click();
          updateProgress(formSteps);
          markStepAsDone(currentTabPane); // Mark current step as done
        } else {
          console.error('Next tab not found:', nextTabId);
        }
      } else {
        formSteps.classList.add('was-validated');
      }
    });
  });

  // Previous Tab Navigation
  formSteps.querySelectorAll('.previestab').forEach((prevBtn) => {
    prevBtn.addEventListener('click', function () {
      const prevTabId = this.getAttribute('data-previous');
      const prevTab = document.getElementById(prevTabId);
      if (prevTab) {
        prevTab.click();
        updateProgress(formSteps);
      } else {
        console.error('Previous tab not found:', prevTabId);
      }
    });
  });

  // Progress Bar Update
  function updateProgress(form) {
    const tabs = form.querySelectorAll('[data-bs-toggle="pill"]');
    const activeTab = form.querySelector('.nav-link.active');
    const progressBar = document.querySelector('.progress-bar');

    if (progressBar) {
      const activeIndex = parseInt(activeTab.getAttribute('data-position'));
      const progress = (activeIndex / (tabs.length - 1)) * 100;
      progressBar.style.width = `${progress}%`;
    }
  }

  // Initialize Progress
  updateProgress(formSteps);
});

// Payment Method Dynamic Fields
document.querySelectorAll('input[name="paymentMethod"]').forEach((radio) => {
  radio.addEventListener('change', function () {
    // Hide all payment details
    document
      .querySelectorAll('.payment-detail')
      .forEach((div) => (div.style.display = 'none'));

    // Show the selected payment method's details
    const detailsDiv = document.querySelector(`#${this.value}Details`);
    if (detailsDiv) {
      detailsDiv.style.display = 'block';
    }
  });
});

// Brand Type Dynamic Fields
document.querySelectorAll('input[name="brandType"]').forEach((radio) => {
  radio.addEventListener('change', function () {
    // Hide all brand type fields
    document
      .querySelectorAll('#personalFields, #companyFields')
      .forEach((div) => (div.style.display = 'none'));

    // Show the selected brand type's fields
    const fieldsDiv = document.querySelector(`#${this.value}Fields`);
    if (fieldsDiv) {
      fieldsDiv.style.display = 'block';
    }
  });
});

// Validate Current Step
function validateCurrentStep(currentTabPane) {
  let isValid = true;

  // Clear previous errors
  currentTabPane
    .querySelectorAll('.is-invalid')
    .forEach((el) => el.classList.remove('is-invalid'));
  currentTabPane
    .querySelectorAll('.invalid-feedback')
    .forEach((el) => el.remove());

  // Validate required fields
  currentTabPane.querySelectorAll('[required]').forEach((input) => {
    if (!input.value.trim()) {
      isValid = false;
      input.classList.add('is-invalid');
      const error = document.createElement('div');
      error.className = 'invalid-feedback';
      error.textContent = 'This field is required';
      input.parentNode.appendChild(error);
    }
  });

  // Step-specific validations
  switch (currentTabPane.id) {
    case 'v-pills-brand-info': // Step 2
      const checkboxesChecked =
        currentTabPane.querySelectorAll("input[type='checkbox']:checked")
          .length > 0;
      if (!checkboxesChecked) {
        isValid = false;
        const error = document.createElement('div');
        error.className = 'invalid-feedback d-block mt-2';
        error.textContent = 'Please select at least one sales channel';
        currentTabPane.querySelector('.row.g-3').appendChild(error);
      }
      break;

    case 'v-payment-method': // Step 4
      const paymentSelected = currentTabPane.querySelector(
        "input[name='paymentMethod']:checked"
      );
      if (!paymentSelected) {
        isValid = false;
        const error = document.createElement('div');
        error.className = 'invalid-feedback d-block mt-2';
        error.textContent = 'Please select a payment method';
        currentTabPane.querySelector('.row.g-3').appendChild(error);
      } else {
        const detailsDiv = document.querySelector(
          `#${paymentSelected.value}Details`
        );
        detailsDiv?.querySelectorAll('input, select').forEach((input) => {
          if (!input.value.trim() && input.required) {
            isValid = false;
            input.classList.add('is-invalid');
            const error = document.createElement('div');
            error.className = 'invalid-feedback';
            error.textContent = 'This field is required';
            input.parentNode.appendChild(error);
          }
        });
      }
      break;

    case 'v-brand-type': // Step 5
      const brandTypeSelected = currentTabPane.querySelector(
        "input[name='brandType']:checked"
      );
      if (!brandTypeSelected) {
        isValid = false;
        const error = document.createElement('div');
        error.className = 'invalid-feedback d-block mt-2';
        error.textContent = 'Please select a brand type';
        currentTabPane.querySelector('.row.g-3').appendChild(error);
      } else {
        const detailsDiv = document.querySelector(
          `#${brandTypeSelected.value}Fields`
        );
        detailsDiv
          ?.querySelectorAll('input, select, .filepond')
          .forEach((input) => {
            if (input.classList.contains('filepond')) {
              if (input.files.length === 0) {
                isValid = false;
                const error = document.createElement('div');
                error.className = 'invalid-feedback d-block mt-2';
                error.textContent = 'Please upload required files';
                input.parentNode.appendChild(error);
              }
            } else if (!input.value.trim() && input.required) {
              isValid = false;
              input.classList.add('is-invalid');
              const error = document.createElement('div');
              error.className = 'invalid-feedback';
              error.textContent = 'This field is required';
              input.parentNode.appendChild(error);
            }
          });
      }
      break;
  }

  return isValid;
}

// Mark Step as Done
function markStepAsDone(currentTabPane) {
  const currentTab = document.querySelector(
    `[data-bs-target="#${currentTabPane.id}"]`
  );
  if (currentTab && !currentTab.classList.contains('done')) {
    currentTab.classList.add('done');
  }
}

// Bootstrap Form Validation Reset
document.querySelectorAll('.form-control').forEach((input) => {
  input.addEventListener('input', function () {
    this.classList.remove('is-invalid');
    const error = this.parentNode.querySelector('.invalid-feedback');
    if (error) error.remove();
  });
});

// Register FilePond plugins
FilePond.registerPlugin(
  FilePondPluginFileEncode,
  FilePondPluginFileValidateSize,
  FilePondPluginImageExifOrientation,
  FilePondPluginImagePreview
);

// Initialize FilePond for file uploads
const inputMultipleElements = document.querySelectorAll(
  'input.filepond-input-multiple'
);
if (inputMultipleElements) {
  Array.from(inputMultipleElements).forEach(function (element) {
    FilePond.create(element);
  });

  FilePond.create(document.querySelector('.filepond-input-circle'), {
    labelIdle:
      'Drag & Drop your picture or <span class="filepond--label-action">Browse</span>',
    imagePreviewHeight: 170,
    imageCropAspectRatio: '1:1',
    imageResizeTargetWidth: 200,
    imageResizeTargetHeight: 200,
    stylePanelLayout: 'compact circle',
    styleLoadIndicatorPosition: 'center bottom',
    styleProgressIndicatorPosition: 'right bottom',
    styleButtonRemoveItemPosition: 'left bottom',
    styleButtonProcessItemPosition: 'right bottom',
  });
}

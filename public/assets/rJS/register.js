document.addEventListener('DOMContentLoaded', () => {
    const countryListUrl = 'assets/json/country-list.json';
    let countryData = [];

    const fetchCountryList = async () => {
        try {
            const response = await fetch(countryListUrl);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            countryData = await response.json();
            initializeDropdowns();
        } catch (error) {
            console.error('Something went wrong:', error);
        }
    };

    const initializeDropdowns = () => {
        const dropdowns = document.querySelectorAll('[data-input-flag]');
        dropdowns.forEach(dropdown => {
            populateDropdown(dropdown);
            setupSearch(dropdown);
            setDefaultCountry(dropdown, 'Egypt');
        });
    };

    const populateDropdown = (dropdown) => {
        const dropdownMenu = dropdown.querySelector('.dropdown-menu-list');
        dropdownMenu.innerHTML = countryData.map(country => `
            <li class="dropdown-item d-flex">
                <div class="flex-shrink-0 me-2">
                    <img src="${country.flagImg}" alt="country flag" class="options-flagimg" height="20">
                </div>
                <div class="flex-grow-1">
                    <div class="d-flex">
                        <div class="country-name me-1">${country.countryName}</div>
                        <span class="countrylist-codeno text-muted">${country.countryCode}</span>
                    </div>
                </div>
            </li>
        `).join('');
        setupDropdownEvents(dropdown);
    };

    const setupDropdownEvents = (dropdown) => {
        const items = dropdown.querySelectorAll('.dropdown-menu li');
        items.forEach(item => {
            const flagImg = item.querySelector('.options-flagimg').getAttribute('src');
            const countryCode = item.querySelector('.countrylist-codeno').innerText;
            item.addEventListener('click', () => {
                const button = dropdown.querySelector('button');
                if (button) {
                    button.querySelector('img').setAttribute('src', flagImg);
                    const span = button.querySelector('span');
                    if (span) span.innerText = countryCode;
                }
            });
        });
    };

    const setupSearch = (dropdown) => {
        const searchInput = dropdown.querySelector('.search-countryList');
        if (searchInput) {
            searchInput.addEventListener('keyup', () => {
                const searchTerm = searchInput.value.toLowerCase();
                const filteredCountries = countryData.filter(country =>
                    country.countryName.toLowerCase().includes(searchTerm) ||
                    country.countryCode.includes(searchTerm)
                );
                const dropdownMenu = dropdown.querySelector('.dropdown-menu-list');
                dropdownMenu.innerHTML = filteredCountries.map(country => `
                    <li class="dropdown-item d-flex">
                        <div class="flex-shrink-0 me-2">
                            <img src="${country.flagImg}" alt="country flag" class="options-flagimg" height="20">
                        </div>
                        <div class="flex-grow-1">
                            <div class="d-flex">
                                <div class="country-name me-1">${country.countryName}</div>
                                <span class="countrylist-codeno text-muted">${country.countryCode}</span>
                            </div>
                        </div>
                    </li>
                `).join('');
                setupDropdownEvents(dropdown);
            });
        }
    };

    const setDefaultCountry = (dropdown, defaultCountryName) => {
        const defaultCountry = countryData.find(country => country.countryName === defaultCountryName);
        if (defaultCountry) {
            const button = dropdown.querySelector('button');
            if (button) {
                button.querySelector('img').setAttribute('src', defaultCountry.flagImg);
                const span = button.querySelector('span');
                if (span) span.innerText = defaultCountry.countryCode;
            }
        }
    };

    fetchCountryList();
});




// Form steps navigation handler
const formSteps = document.querySelectorAll('.form-steps');
if (formSteps) {
    formSteps.forEach(form => {
        const nextTabs = form.querySelectorAll('.nexttab');
        const prevTabs = form.querySelectorAll('.previestab');
        const tabButtons = form.querySelectorAll('button[data-bs-toggle="pill"]');

        nextTabs.forEach(nextTab => {
            nextTab.addEventListener('click', function () {
                form.classList.add('was-validated');
                const inputs = form.querySelectorAll('.tab-pane.show .form-control');
                let allValid = true;

                inputs.forEach(input => {
                    if (!input.checkValidity()) {
                        allValid = false;
                        input.focus();
                    }
                });

                if (allValid) {
                    const nextTabId = nextTab.getAttribute('data-nexttab');
                    if (nextTabId) {
                        document.getElementById(nextTabId).click();
                        form.classList.remove('was-validated');
                    }
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Oops...',
                        text: 'Please fill out all required fields correctly.',
                    });
                }
            });
        });

        prevTabs.forEach(prevTab => {
            prevTab.addEventListener('click', function () {
                const prevTabId = prevTab.getAttribute('data-previous');
                const doneTabs = form.querySelectorAll('.custom-nav .done');
                const lastDoneIndex = doneTabs.length - 1;

                if (doneTabs[lastDoneIndex]) {
                    doneTabs[lastDoneIndex].classList.remove('done');
                }

                document.getElementById(prevTabId).click();
            });
        });

        tabButtons.forEach((tabButton, index) => {
            tabButton.setAttribute('data-position', index);
            tabButton.addEventListener('click', function () {
                form.classList.remove('was-validated');

                if (tabButton.getAttribute('data-progressbar')) {
                    const totalTabs = document.getElementById('custom-progress-bar').querySelectorAll('li').length - 1;
                    const progress = (index / totalTabs) * 100;
                    document.getElementById('custom-progress-bar').querySelector('.progress-bar').style.width = `${progress}%`;
                }

                const doneTabs = form.querySelectorAll('.custom-nav .done');
                doneTabs.forEach(doneTab => doneTab.classList.remove('done'));

                for (let i = 0; i <= index; i++) {
                    if (tabButtons[i].classList.contains('active')) {
                        tabButtons[i].classList.remove('done');
                    } else {
                        tabButtons[i].classList.add('done');
                    }
                }
            });
        });
    });
}

// Password validation handler
const passwordInput = document.querySelector('input[name="password"]');
if (passwordInput) {
    const passwordFeedback = document.createElement('div');
    passwordFeedback.className = 'invalid-feedback';
    passwordFeedback.innerText = 'Password must be at least 8 characters long';
    passwordInput.parentNode.appendChild(passwordFeedback);

    passwordInput.addEventListener('input', function () {
        if (passwordInput.value.length < 8) {
            passwordInput.setCustomValidity('Password must be at least 8 characters long');
            passwordFeedback.style.display = 'block';
        } else {
            passwordInput.setCustomValidity('');
            passwordFeedback.style.display = 'none';
        }
    });
}

// Form submission handler
const signUpForm = document.getElementById('signup-form');
const submitBTN = document.getElementById('submitBTN');
if (signUpForm) {
    signUpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        submitBTN.setAttribute('disabled', 'disabled');
        submitBTN.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Loading...';
        if (!signUpForm.checkValidity()) {
            Swal.fire({
                icon: 'error',
                title: 'Oops...',
                text: 'Please fill out all required fields correctly.',
            });
            return;
        }

        try {
            const formData = new FormData(signUpForm);
            const formObject = Object.fromEntries(formData.entries());
            console.log(formObject);

            const response = await fetch('/signup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formObject),
            });

            const data = await response.json();
            console.log(data);
            if (response.ok) {
                console.log(data);
                document.getElementById('finish-account-tab').removeAttribute('disabled');
                document.getElementById('finish-account-tab').click();
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Oops...',
                    text: data.message || 'Something went wrong. Please try again.',
                });
            }
        } catch (err) {
            console.error(err);
            Swal.fire({
                icon: 'error',
                title: 'Oops...',
                text: 'Something went wrong. Please try again.',
            });
        }finally{
            submitBTN.removeAttribute('disabled');
            submitBTN.innerHTML = 'Submit';
            
        }
    });
}
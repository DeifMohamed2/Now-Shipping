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



// Profile image upload handler
const profileImgInput = document.querySelector('#profile-img-file-input');
if (profileImgInput) {
    profileImgInput.addEventListener('change', function () {
        const userProfileImage = document.querySelector('.user-profile-image');
        const file = profileImgInput.files[0];
        const reader = new FileReader();

        reader.addEventListener('load', function () {
            userProfileImage.src = reader.result;
        });

        if (file) {
            reader.readAsDataURL(file);
        }
    });
}

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
                inputs.forEach(input => {
                    if (input.value.length > 0 && input.value.match(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/)) {
                        const nextTabId = nextTab.getAttribute('data-nexttab');
                        document.getElementById(nextTabId).click();
                        form.classList.remove('was-validated');
                    }
                });
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

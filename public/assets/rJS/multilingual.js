/**
 * Multilingual Support JavaScript
 * Handles language switching, RTL/LTR direction changes, and loading states
 */

class MultilingualManager {
    constructor() {
        this.currentLang = this.getCurrentLanguage();
        this.isLoading = false;
        this.supportedLanguages = ['en', 'ar'];
        this.init();
    }

    init() {
        this.setInitialDirection();
        this.createLanguageSwitcher();
        this.bindEvents();
        this.initializeAnimations();
    }

    getCurrentLanguage() {
        // Get language from URL parameter, cookie, or default to 'en'
        const urlParams = new URLSearchParams(window.location.search);
        const langParam = urlParams.get('lang');
        const cookieLang = this.getCookie('language');
        
        return langParam || cookieLang || 'en';
    }

    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    setCookie(name, value, days = 365) {
        const expires = new Date();
        expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
    }

    setInitialDirection() {
        const isRTL = this.currentLang === 'ar';
        document.documentElement.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
        document.documentElement.setAttribute('lang', this.currentLang);
        
        // Add language class to body
        document.body.classList.remove('lang-en', 'lang-ar');
        document.body.classList.add(`lang-${this.currentLang}`);
        
        // Add direction class
        document.body.classList.remove('rtl', 'ltr');
        document.body.classList.add(isRTL ? 'rtl' : 'ltr');
    }

    createLanguageSwitcher() {
        // Check if switcher already exists
        if (document.getElementById('languageSwitcher')) {
            return;
        }

        const switcherHTML = `
            <div class="language-switcher" id="languageSwitcher">
                <div class="language-dropdown">
                    <button class="language-toggle" id="languageToggle" type="button" aria-label="Switch Language">
                        <span class="language-flag" id="currentFlag">
                            ${this.getFlagIcon(this.currentLang)}
                        </span>
                        <span class="language-name" id="currentLangName">
                            ${this.getLanguageName(this.currentLang)}
                        </span>
                        <i class="fas fa-chevron-down language-arrow" aria-hidden="true"></i>
                    </button>
                    <div class="language-menu" id="languageMenu" role="menu">
                        ${this.supportedLanguages.map(lang => `
                            <div class="language-option ${lang === this.currentLang ? 'active' : ''}" 
                                 data-lang="${lang}" 
                                 role="menuitem"
                                 tabindex="0">
                                <span class="language-flag">${this.getFlagIcon(lang)}</span>
                                <span class="language-name">${this.getLanguageName(lang)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="language-loader" id="languageLoader" style="display: none;" aria-live="polite">
                    <div class="loader-spinner" aria-hidden="true"></div>
                    <span class="loader-text">${this.getTranslation('language.loading')}</span>
                </div>
            </div>
        `;

        // Try multiple selectors to find the best place to insert the switcher
        const selectors = [
            '.nav-container',
            '.nav-wrapper',
            '.navbar-links',
            '.navbar-container',
            '.auth-buttons',
            'header .container',
            'header',
            '.top-navbar .navbar-container',
            '#main-nav',
            'nav'
        ];

        let targetElement = null;
        for (const selector of selectors) {
            targetElement = document.querySelector(selector);
            if (targetElement) {
                break;
            }
        }

        if (targetElement) {
            console.log('Found target element for language switcher:', targetElement);
            // Special handling for different navbar structures
            if (targetElement.classList.contains('nav-container')) {
                // For landing page nav-container, insert after the nav element
                const navElement = targetElement.querySelector('nav');
                if (navElement) {
                    console.log('Inserting language switcher after nav element');
                    navElement.insertAdjacentHTML('afterend', switcherHTML);
                } else {
                    console.log('No nav element found, inserting at end of nav-container');
                    targetElement.insertAdjacentHTML('beforeend', switcherHTML);
                }
            } else if (targetElement.classList.contains('nav-wrapper')) {
                // Special handling for nav-wrapper
                const navContainer = targetElement.querySelector('.nav-container');
                if (navContainer) {
                    console.log('Inserting language switcher in nav-container within nav-wrapper');
                    navContainer.insertAdjacentHTML('beforeend', switcherHTML);
                } else {
                    console.log('No nav-container found, inserting at end of nav-wrapper');
                    targetElement.insertAdjacentHTML('beforeend', switcherHTML);
                }
            } else if (targetElement.tagName === 'NAV') {
                // For nav elements, insert at the end
                console.log('Inserting language switcher in nav element');
                targetElement.insertAdjacentHTML('beforeend', switcherHTML);
            } else {
                // Default behavior
                console.log('Using default insertion method');
                targetElement.insertAdjacentHTML('beforeend', switcherHTML);
            }
        } else {
            // Fallback: insert at the beginning of body
            console.log('No target element found, inserting at beginning of body');
            document.body.insertAdjacentHTML('afterbegin', switcherHTML);
        }
    }

    bindEvents() {
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            const toggle = document.getElementById('languageToggle');
            const menu = document.getElementById('languageMenu');
            const options = document.querySelectorAll('.language-option');

            console.log('Language switcher elements:', { toggle, menu, options: options.length });

            if (toggle) {
                // Remove any existing event listeners to prevent duplicates
                toggle.removeEventListener('click', this.toggleHandler);
                
                // Create bound handler
                this.toggleHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Toggle clicked');
                    this.toggleMenu();
                };
                
                toggle.addEventListener('click', this.toggleHandler);

                // Keyboard support
                toggle.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        this.toggleMenu();
                    } else if (e.key === 'Escape') {
                        this.closeMenu();
                    }
                });
            } else {
                console.error('Language toggle button not found!');
            }

            options.forEach(option => {
                // Remove any existing event listeners
                option.removeEventListener('click', this.optionClickHandler);
                
                // Create bound handler for each option
                this.optionClickHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const lang = option.dataset.lang;
                    console.log('Language option clicked:', lang);
                    if (lang !== this.currentLang) {
                        this.switchLanguage(lang);
                    } else {
                        // If same language, just close the menu
                        this.closeMenu();
                    }
                };
                
                option.addEventListener('click', this.optionClickHandler);

                // Keyboard support for options
                option.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        const lang = option.dataset.lang;
                        if (lang !== this.currentLang) {
                            this.switchLanguage(lang);
                        } else {
                            this.closeMenu();
                        }
                    }
                });
            });

            // Close menu when clicking outside - use a more specific handler
            this.outsideClickHandler = (e) => {
                const switcher = document.getElementById('languageSwitcher');
                if (switcher && !switcher.contains(e.target)) {
                    this.closeMenu();
                }
            };
            
            // Remove existing listener and add new one
            document.removeEventListener('click', this.outsideClickHandler);
            document.addEventListener('click', this.outsideClickHandler);

            // Close menu on escape key
            this.escapeKeyHandler = (e) => {
                if (e.key === 'Escape') {
                    this.closeMenu();
                }
            };
            
            document.removeEventListener('keydown', this.escapeKeyHandler);
            document.addEventListener('keydown', this.escapeKeyHandler);
        }, 100);
    }

    toggleMenu() {
        const menu = document.getElementById('languageMenu');
        const toggle = document.getElementById('languageToggle');
        
        console.log('Toggle menu called', { menu, toggle });
        
        if (menu && toggle) {
            const isOpen = menu.classList.contains('show') || menu.style.display === 'block';
            console.log('Menu is open:', isOpen);
            
            if (isOpen) {
                this.closeMenu();
            } else {
                this.openMenu();
            }
        } else {
            console.error('Menu or toggle not found:', { menu, toggle });
        }
    }

    openMenu() {
        const menu = document.getElementById('languageMenu');
        const toggle = document.getElementById('languageToggle');
        
        console.log('Opening menu', { menu, toggle });
        
        if (menu && toggle) {
            // Close any other open dropdowns first
            this.closeAllOtherDropdowns();
            
            // Add show class and set attributes
            menu.classList.add('show');
            toggle.setAttribute('aria-expanded', 'true');
            
            // Force display with important styles
            menu.style.setProperty('display', 'block', 'important');
            menu.style.setProperty('opacity', '1', 'important');
            menu.style.setProperty('visibility', 'visible', 'important');
            menu.style.setProperty('transform', 'translateY(0) scale(1)', 'important');
            menu.style.setProperty('z-index', '9999', 'important');
            
            console.log('Menu opened successfully');
            
            // Focus first option after a small delay
            setTimeout(() => {
                const firstOption = menu.querySelector('.language-option');
                if (firstOption) {
                    firstOption.focus();
                }
            }, 50);
        } else {
            console.error('Cannot open menu - elements not found');
        }
    }

    closeMenu() {
        const menu = document.getElementById('languageMenu');
        const toggle = document.getElementById('languageToggle');
        
        console.log('Closing menu', { menu, toggle });
        
        if (menu && toggle) {
            menu.classList.remove('show');
            toggle.setAttribute('aria-expanded', 'false');
            
            // Force hide with transition
            menu.style.setProperty('opacity', '0', 'important');
            menu.style.setProperty('visibility', 'hidden', 'important');
            menu.style.setProperty('transform', 'translateY(-10px) scale(0.95)', 'important');
            
            // Hide completely after transition
            setTimeout(() => {
                if (!menu.classList.contains('show')) {
                    menu.style.setProperty('display', 'none', 'important');
                }
            }, 300);
            
            console.log('Menu closed successfully');
        } else {
            console.error('Cannot close menu - elements not found');
        }
    }

    closeAllOtherDropdowns() {
        // Close any other dropdowns that might be open
        const otherDropdowns = document.querySelectorAll('.dropdown-menu.show, .language-menu.show');
        otherDropdowns.forEach(dropdown => {
            if (dropdown.id !== 'languageMenu') {
                dropdown.classList.remove('show');
                dropdown.style.display = 'none';
            }
        });
    }

    async switchLanguage(newLang) {
        if (this.isLoading || newLang === this.currentLang || !this.supportedLanguages.includes(newLang)) {
            return;
        }

        this.isLoading = true;
        this.showLoader();

        try {
            // Update URL with new language parameter
            const url = new URL(window.location);
            url.searchParams.set('lang', newLang);
            
            // Set cookie for persistence
            this.setCookie('language', newLang);

            // Update current language
            this.currentLang = newLang;

            // Add loading class to body
            document.body.classList.add('language-switching');

            // Reload page with new language
            window.location.href = url.toString();

        } catch (error) {
            console.error('Language switch error:', error);
            this.hideLoader();
            this.isLoading = false;
            this.showError('Failed to switch language. Please try again.');
        }
    }

    showLoader() {
        const loader = document.getElementById('languageLoader');
        const toggle = document.getElementById('languageToggle');
        
        if (loader && toggle) {
            toggle.style.display = 'none';
            loader.style.display = 'flex';
        }
    }

    hideLoader() {
        const loader = document.getElementById('languageLoader');
        const toggle = document.getElementById('languageToggle');
        
        if (loader && toggle) {
            loader.style.display = 'none';
            toggle.style.display = 'flex';
        }
    }

    showError(message) {
        // Create error notification
        const errorDiv = document.createElement('div');
        errorDiv.className = 'language-error';
        errorDiv.textContent = message;
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ef4444;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 10000;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        `;

        document.body.appendChild(errorDiv);

        // Remove after 5 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }

    getFlagIcon(lang) {
        const flags = {
            'en': '🇺🇸',
            'ar': '🇪🇬'
        };
        return flags[lang] || '🌐';
    }

    getLanguageName(lang) {
        const names = {
            'en': 'English',
            'ar': 'العربية'
        };
        return names[lang] || 'Language';
    }

    getTranslation(key) {
        // This would typically get translations from the i18n system
        // For now, return basic translations
        const translations = {
            'language.loading': this.currentLang === 'ar' ? 'جاري تغيير اللغة...' : 'Switching language...'
        };
        return translations[key] || key;
    }

    initializeAnimations() {
        // Add smooth transitions for RTL/LTR changes and enhanced dropdown styles
        const style = document.createElement('style');
        style.textContent = `
            .language-switching * {
                transition: all 0.3s ease !important;
            }
            
            [dir="rtl"] {
                transition: all 0.3s ease;
            }
            
            [dir="ltr"] {
                transition: all 0.3s ease;
            }

            /* Enhanced Language Switcher Styles */
            .language-switcher {
                position: relative;
                display: inline-block;
                margin: 0 8px;
                z-index: 1000;
            }

            /* Landing page specific styles */
            .nav-container .language-switcher,
            .nav-wrapper .language-switcher {
                margin-left: 1rem;
                margin-right: 0;
            }

            [dir="rtl"] .nav-container .language-switcher,
            [dir="rtl"] .nav-wrapper .language-switcher {
                margin-left: 0;
                margin-right: 1rem;
            }

            .language-dropdown {
                position: relative;
            }

            .language-toggle {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 16px;
                background: linear-gradient(135deg, #F39720, #FDB614);
                border: none;
                border-radius: 25px;
                cursor: pointer;
                transition: all 0.3s ease;
                font-size: 14px;
                color: white;
                font-weight: 600;
                box-shadow: 0 4px 15px rgba(243, 151, 32, 0.3);
                min-width: 120px;
                justify-content: center;
                position: relative;
                z-index: 1001;
            }

            .language-toggle:hover {
                background: linear-gradient(135deg, #FDB614, #F39720);
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(243, 151, 32, 0.4);
            }

            .language-toggle:active {
                transform: translateY(0);
            }

            .language-flag {
                font-size: 18px;
                filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
            }

            .language-name {
                font-weight: 600;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
            }

            .language-arrow {
                font-size: 12px;
                transition: transform 0.3s ease;
                margin-left: 4px;
            }

            .language-toggle[aria-expanded="true"] .language-arrow {
                transform: rotate(180deg);
            }

            .language-menu {
                position: absolute;
                top: calc(100% + 8px);
                right: 0;
                background: white;
                border: none;
                border-radius: 12px;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                min-width: 160px;
                z-index: 9999 !important;
                opacity: 0;
                visibility: hidden;
                transform: translateY(-10px) scale(0.95);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                overflow: hidden;
                display: none;
                pointer-events: none;
            }

            .language-menu.show {
                opacity: 1 !important;
                visibility: visible !important;
                transform: translateY(0) scale(1) !important;
                display: block !important;
                pointer-events: auto !important;
            }

            .language-option {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 14px 18px;
                cursor: pointer;
                transition: all 0.2s ease;
                border-bottom: 1px solid #f1f5f9;
                position: relative;
                background: white;
            }

            .language-option:last-child {
                border-bottom: none;
            }

            .language-option:hover {
                background: linear-gradient(135deg, #f8fafc, #f1f5f9);
                transform: translateX(4px);
            }

            .language-option.active {
                background: linear-gradient(135deg, #F39720, #FDB614);
                color: white;
            }

            .language-option.active .language-flag {
                filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
            }

            .language-option .language-flag {
                font-size: 20px;
            }

            .language-option .language-name {
                font-weight: 500;
                font-size: 14px;
            }

            .language-loader {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 16px;
                color: white;
                font-size: 14px;
                background: linear-gradient(135deg, #F39720, #FDB614);
                border-radius: 25px;
                min-width: 120px;
                justify-content: center;
            }

            .loader-spinner {
                width: 18px;
                height: 18px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-top: 2px solid white;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }

            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            .loader-text {
                font-size: 13px;
                font-weight: 500;
            }

            /* RTL Adjustments */
            [dir="rtl"] .language-menu {
                right: auto;
                left: 0;
            }

            [dir="rtl"] .language-toggle {
                flex-direction: row-reverse;
            }

            [dir="rtl"] .language-option {
                flex-direction: row-reverse;
            }

            [dir="rtl"] .language-option:hover {
                transform: translateX(-4px);
            }

            [dir="rtl"] .language-arrow {
                margin-left: 0;
                margin-right: 4px;
            }

            /* Loading State */
            .language-switching {
                pointer-events: none;
            }

            .language-switching * {
                cursor: wait !important;
            }

            /* Responsive */
            @media (max-width: 768px) {
                .language-toggle {
                    padding: 8px 12px;
                    font-size: 13px;
                    min-width: 100px;
                }

                .language-name {
                    display: none;
                }

                .language-menu {
                    min-width: 140px;
                    right: -10px;
                }

                [dir="rtl"] .language-menu {
                    right: auto;
                    left: -10px;
                }
            }

            @media (max-width: 480px) {
                .language-switcher {
                    margin: 0 4px;
                }

                .language-toggle {
                    padding: 6px 10px;
                    min-width: 80px;
                }

                .language-flag {
                    font-size: 16px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Public method to get current language
    getCurrentLanguageCode() {
        return this.currentLang;
    }

    // Public method to check if current language is RTL
    isRTL() {
        return this.currentLang === 'ar';
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing MultilingualManager...');
    console.log('Current page URL:', window.location.href);
    console.log('Document ready state:', document.readyState);
    window.multilingualManager = new MultilingualManager();
    console.log('MultilingualManager initialized:', window.multilingualManager);
    
    // Additional debugging for landing pages
    setTimeout(() => {
        const switcher = document.getElementById('languageSwitcher');
        const toggle = document.getElementById('languageToggle');
        const menu = document.getElementById('languageMenu');
        console.log('Language switcher elements after initialization:', {
            switcher: !!switcher,
            toggle: !!toggle,
            menu: !!menu,
            switcherHTML: switcher ? switcher.outerHTML.substring(0, 100) + '...' : 'Not found'
        });
    }, 500);
});

// Also try to initialize immediately if DOM is already ready
if (document.readyState === 'loading') {
    // DOM is still loading, wait for DOMContentLoaded
} else {
    // DOM is already ready, initialize immediately
    console.log('DOM already ready, initializing MultilingualManager immediately...');
    window.multilingualManager = new MultilingualManager();
    console.log('MultilingualManager initialized immediately:', window.multilingualManager);
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultilingualManager;
}

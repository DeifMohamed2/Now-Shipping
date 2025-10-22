/**
 * Language Switcher with RTL Support and Loading Animation
 * Provides seamless language switching with professional UX
 */

class LanguageSwitcher {
    constructor() {
        this.currentLang = this.getCurrentLanguage();
        this.isLoading = false;
        this.init();
    }

    init() {
        this.createLanguageSwitcher();
        this.bindEvents();
        this.setInitialDirection();
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

    createLanguageSwitcher() {
        // Create language switcher HTML
        const switcherHTML = `
            <div class="language-switcher" id="languageSwitcher">
                <div class="language-dropdown">
                    <button class="language-toggle" id="languageToggle" type="button">
                        <span class="language-flag" id="currentFlag">
                            ${this.getFlagIcon(this.currentLang)}
                        </span>
                        <span class="language-name" id="currentLangName">
                            ${this.getLanguageName(this.currentLang)}
                        </span>
                        <i class="fas fa-chevron-down language-arrow"></i>
                    </button>
                    <div class="language-menu" id="languageMenu">
                        <div class="language-option" data-lang="en">
                            <span class="language-flag">🇺🇸</span>
                            <span class="language-name">English</span>
                        </div>
                        <div class="language-option" data-lang="ar">
                            <span class="language-flag">🇪🇬</span>
                            <span class="language-name">العربية</span>
                        </div>
                    </div>
                </div>
                <div class="language-loader" id="languageLoader" style="display: none;">
                    <div class="loader-spinner"></div>
                    <span class="loader-text">${this.getTranslation('language.loading')}</span>
                </div>
            </div>
        `;

        // Insert switcher into the page
        const targetElement = document.querySelector('.navbar-links') || document.querySelector('.navbar-container');
        if (targetElement) {
            targetElement.insertAdjacentHTML('beforeend', switcherHTML);
        }
    }

    bindEvents() {
        const toggle = document.getElementById('languageToggle');
        const menu = document.getElementById('languageMenu');
        const options = document.querySelectorAll('.language-option');

        if (toggle) {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenu();
            });
        }

        options.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const lang = option.dataset.lang;
                if (lang !== this.currentLang) {
                    this.switchLanguage(lang);
                }
                this.closeMenu();
            });
        });

        // Close menu when clicking outside
        document.addEventListener('click', () => {
            this.closeMenu();
        });

        // Close menu on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeMenu();
            }
        });
    }

    toggleMenu() {
        const menu = document.getElementById('languageMenu');
        if (menu) {
            menu.classList.toggle('show');
        }
    }

    closeMenu() {
        const menu = document.getElementById('languageMenu');
        if (menu) {
            menu.classList.remove('show');
        }
    }

    async switchLanguage(newLang) {
        if (this.isLoading || newLang === this.currentLang) return;

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

            // Reload page with new language
            window.location.href = url.toString();

        } catch (error) {
            console.error('Language switch error:', error);
            this.hideLoader();
            this.isLoading = false;
        }
    }

    showLoader() {
        const loader = document.getElementById('languageLoader');
        const toggle = document.getElementById('languageToggle');
        
        if (loader && toggle) {
            toggle.style.display = 'none';
            loader.style.display = 'flex';
        }

        // Add loading class to body for global loading state
        document.body.classList.add('language-switching');
    }

    hideLoader() {
        const loader = document.getElementById('languageLoader');
        const toggle = document.getElementById('languageToggle');
        
        if (loader && toggle) {
            loader.style.display = 'none';
            toggle.style.display = 'flex';
        }

        document.body.classList.remove('language-switching');
    }

    setInitialDirection() {
        const isRTL = this.currentLang === 'ar';
        document.documentElement.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
        document.documentElement.setAttribute('lang', this.currentLang);
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
}

// Language Switcher Styles
const languageSwitcherStyles = `
    <style>
        .language-switcher {
            position: relative;
            display: inline-block;
            margin: 0 8px;
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
            z-index: 9999;
            opacity: 0;
            visibility: hidden;
            transform: translateY(-10px) scale(0.95);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            overflow: hidden;
            display: none;
        }

        .language-menu.show {
            opacity: 1 !important;
            visibility: visible !important;
            transform: translateY(0) scale(1) !important;
            display: block !important;
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
    </style>
`;

// Inject styles
document.head.insertAdjacentHTML('beforeend', languageSwitcherStyles);

// Initialize language switcher when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Language switcher DOM ready');
    // Use the new multilingual manager instead
    if (typeof MultilingualManager !== 'undefined') {
        console.log('Using MultilingualManager');
        new MultilingualManager();
    } else {
        console.log('Using fallback LanguageSwitcher');
        // Fallback to old implementation
        new LanguageSwitcher();
    }
});

// Also try to initialize immediately if DOM is already ready
if (document.readyState === 'loading') {
    // DOM is still loading, wait for DOMContentLoaded
} else {
    // DOM is already ready, initialize immediately
    console.log('Language switcher DOM already ready');
    if (typeof MultilingualManager !== 'undefined') {
        console.log('Using MultilingualManager immediately');
        new MultilingualManager();
    } else {
        console.log('Using fallback LanguageSwitcher immediately');
        new LanguageSwitcher();
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LanguageSwitcher;
}

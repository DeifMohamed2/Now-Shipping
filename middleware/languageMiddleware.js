/**
 * Language Middleware
 * Handles language switching and RTL/LTR direction setting
 */

const fs = require('fs');
const path = require('path');

// Load translation files
const loadTranslations = () => {
  const translations = {};
  const i18nPath = path.join(__dirname, '../i18n');
  
  try {
    const files = fs.readdirSync(i18nPath);
    files.forEach(file => {
      if (file.endsWith('.json')) {
        const lang = file.replace('.json', '');
        const filePath = path.join(i18nPath, file);
        translations[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    });
  } catch (error) {
    console.error('Error loading translations:', error);
  }
  
  return translations;
};

const translations = loadTranslations();

const SUPPORTED_LANGUAGES = ['en', 'ar'];

const cookieOpts = {
  maxAge: 365 * 24 * 60 * 60 * 1000,
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
};

/** `lang` or legacy `clang` query (first valid wins). */
function langFromQuery(req) {
  for (const key of ['lang', 'clang']) {
    const raw = req.query[key];
    if (!raw || typeof raw !== 'string') continue;
    const v = raw.toLowerCase();
    if (SUPPORTED_LANGUAGES.includes(v)) return v;
  }
  return null;
}

const languageMiddleware = (req, res, next) => {
  const fromQuery = langFromQuery(req);
  const cookieLang = req.cookies && req.cookies.language;
  const legacyUlang = req.cookies && req.cookies.ulang;
  const raw = fromQuery || cookieLang || legacyUlang || 'en';
  const currentLang = SUPPORTED_LANGUAGES.includes(raw) ? raw : 'en';

  req.language = currentLang;
  req.direction = currentLang === 'ar' ? 'rtl' : 'ltr';
  req.translations = translations[currentLang] || translations['en'];

  res.locals.translation = req.translations;
  res.locals.currentLang = currentLang;
  res.locals.lang = currentLang;
  res.locals.direction = req.direction;
  res.locals.isRTL = req.direction === 'rtl';

  next();
};

// Middleware to handle language switching (?lang= or ?clang= → cookie + clean URL)
const handleLanguageSwitch = (req, res, next) => {
  if (!req.query.lang && !req.query.clang) {
    return next();
  }

  const fromQuery = langFromQuery(req);
  const lang = fromQuery || 'en';

  res.cookie('language', lang, cookieOpts);
  if (req.session) {
    req.session.ulang = lang;
  }

  const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
  url.searchParams.delete('lang');
  url.searchParams.delete('clang');

  return res.redirect(url.pathname + url.search);
};

// Helper function to get translation
const getTranslation = (key, lang = 'en') => {
  const keys = key.split('.');
  let translation = translations[lang] || translations['en'];
  
  for (const k of keys) {
    if (translation && translation[k]) {
      translation = translation[k];
    } else {
      return key; // Return key if translation not found
    }
  }
  
  return translation;
};

// Helper function to get all available languages
const getAvailableLanguages = () => {
  return Object.keys(translations).map(lang => ({
    code: lang,
    name: lang === 'en' ? 'English' : lang === 'ar' ? 'العربية' : lang,
    flag: lang === 'en' ? '🇺🇸' : lang === 'ar' ? '🇪🇬' : '🌐',
    direction: lang === 'ar' ? 'rtl' : 'ltr'
  }));
};

module.exports = {
  languageMiddleware,
  handleLanguageSwitch,
  getTranslation,
  getAvailableLanguages,
  translations
};


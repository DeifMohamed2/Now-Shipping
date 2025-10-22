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

const languageMiddleware = (req, res, next) => {
  // Get language from query parameter, cookie, or default to 'en'
  const lang = req.query.lang || req.cookies.language || 'en';
  
  // Validate language
  const supportedLanguages = ['en', 'ar'];
  const currentLang = supportedLanguages.includes(lang) ? lang : 'en';
  
  // Set language in request object
  req.language = currentLang;
  
  // Set direction based on language
  req.direction = currentLang === 'ar' ? 'rtl' : 'ltr';
  
  // Get translations for current language
  req.translations = translations[currentLang] || translations['en'];
  
  // Set cookie for language persistence
  if (req.query.lang && supportedLanguages.includes(req.query.lang)) {
    res.cookie('language', req.query.lang, {
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: false, // Allow client-side access
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
  }
  
  // Make translations available to views
  res.locals.translation = req.translations;
  res.locals.currentLang = currentLang;
  res.locals.direction = req.direction;
  res.locals.isRTL = req.direction === 'rtl';
  
  next();
};

// Middleware to handle language switching
const handleLanguageSwitch = (req, res, next) => {
  if (req.query.lang) {
    const supportedLanguages = ['en', 'ar'];
    const lang = supportedLanguages.includes(req.query.lang) ? req.query.lang : 'en';
    
    // Set cookie
    res.cookie('language', lang, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    
    // Remove lang parameter from URL to avoid duplication
    const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
    url.searchParams.delete('lang');
    
    // Redirect to clean URL
    return res.redirect(url.pathname + url.search);
  }
  
  next();
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


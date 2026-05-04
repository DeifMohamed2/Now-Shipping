#!/usr/bin/env node
/**
 * Post-deploy smoke: ensures CommonJS deps that broke before (ExcelJS + uuid, Shopify SDK) load.
 * Run from repo root: npm run smoke:deps
 */
'use strict';

require('../utils/shopifyService');
require('exceljs');

console.log('smoke-deps: ok');

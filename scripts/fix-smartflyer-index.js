#!/usr/bin/env node
/**
 * Fix smartFlyerBarcode index: drop the old unique index that rejects multiple nulls,
 * then sync indexes so Mongoose creates the correct sparse unique index.
 * Run: node scripts/fix-smartflyer-index.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL not set in .env');
  process.exit(1);
}

async function fixIndex() {
  try {
    await mongoose.connect(DB);
    console.log('Connected to DB');

    const Order = require('../models/order');
    const collection = Order.collection;

    try {
      await collection.dropIndex('smartFlyerBarcode_1');
      console.log('Dropped old smartFlyerBarcode_1 index');
    } catch (err) {
      if (err.code === 27 || err.message?.includes('index not found')) {
        console.log('Index smartFlyerBarcode_1 does not exist (already dropped or never created)');
      } else {
        throw err;
      }
    }

    await Order.syncIndexes();
    console.log('Synced indexes - sparse unique index on smartFlyerBarcode created');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('Done');
    process.exit(0);
  }
}

fixIndex();

/**
 * Delivery / return / exchange policy PDF (Puppeteer) — shared by business routes and Shopify app.
 */
const puppeteer = require('puppeteer');
const bwipjs = require('bwip-js');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { getPuppeteerLaunchOptions } = require('./puppeteerLaunch');

function normalizePaperSize(rawPaper) {
  const u = String(rawPaper || 'A4').trim().toUpperCase();
  if (u === 'A3' || u === 'A4' || u === 'A5') return u;
  if (u === 'LETTER') return 'Letter';
  if (u === 'LEGAL') return 'Legal';
  if (u === 'TABLOID') return 'Tabloid';
  return 'A4';
}

// Helper functions for PDF generation
async function generateBarcode(awbNumber) {
  // bwip-js is pure JS (no node-canvas). node-canvas often breaks on Linux VPS without Cairo build deps.
  const safe = awbNumber != null && String(awbNumber).trim() !== '' ? String(awbNumber) : '0';
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text: safe,
    scale: 3,
    height: 12,
    includetext: false,
  });
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function generateQRCode(awbNumber) {
  const payload = awbNumber != null && String(awbNumber).trim() !== '' ? String(awbNumber) : '0';
  const qrCode = await QRCode.toDataURL(payload, {
    width: 150,
    margin: 1,
    color: { dark: '#000000', light: '#FFFFFF' }
  });
  return qrCode;
}

function getImageAsBase64(imagePath) {
  try {
    const fullPath = path.join(__dirname, '..', 'public', imagePath);
    const imageBuffer = fs.readFileSync(fullPath);
    const base64Image = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mimeType};base64,${base64Image}`;
  } catch (error) {
    console.error('Error reading image:', error);
    return '';
  }
}

function getDeliveryStatusText(orderType, amountType) {
  // Map order types to delivery status text
  const statusMap = {
    'Deliver': 'DELIVER',
    'Return': 'RETURN',
    'Exchange': 'EXCHANGE'
  };
  
  return statusMap[orderType] || 'DELIVER';
}

// Shared styles for all policy types
const getSharedStyles = () => `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: Arial, sans-serif;
    background-color: #fff;
    padding: 0;
    margin: 0;
  }

  .container {
    width: 100%;
    max-width: 100%;
    margin: 0;
    background-color: white;
    padding: 0;
    box-sizing: border-box;
    position: relative;
  }

  .watermark {
    position: absolute;
    right: -150px;
    top: 70%;
    transform: translateY(-50%);
    opacity: 0.1;
    width: 652px;
    height: auto;
    z-index: 0;
    pointer-events: none;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0;
    gap: 12px;
    position: relative;
    z-index: 1;
  }

  .logo {
    width: 150px;
    height: auto;
  }

  .logo img {
    width: 100%;
    height: auto;
    display: block;
  }

  .awb-section {
    text-align: center;
    flex: 1;
  }

  .awb-label {
    font-size: 20px;
    font-weight: 800;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .awb-number {
    font-size: 24px;
    font-weight: bold;
  }

  .barcode-qr {
    display: flex;
    gap: 64px;
    align-items: center;
  }

  .barcode-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .barcode-container {
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: #000;
    padding: 8px;
    border-radius: 4px;
  }

  .barcode-label-box {
    background-color: #000;
    color: #fff;
    padding: 20px 12px;
    font-size: 14px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 50px;
  }

  .barcode-wrapper {
    background-color: #fff;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .barcode-wrapper img {
    height: 64px;
  }

  .qr-code {
    width: 112px;
    height: 112px;
    border: 2px solid #d1d5db;
    border-radius: 4px;
    padding: 8px;
    background-color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .qr-code img {
    width: 100%;
    height: 100%;
  }

  .content {
    display: grid;
    grid-template-columns: 1fr 2.3fr;
    gap: 0;
    align-items: stretch;
    position: relative;
    z-index: 1;
  }

  .left-section {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .left-box {
    border: 1px solid #9ca3af;
  }

  .right-section {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .right-box {
    border: 1px solid #9ca3af;
  }

  .flex-1 {
    flex: 1;
  }

  .form-row {
    display: grid;
    border-bottom: 1px solid #9ca3af;
    min-height: 50px;
  }

  .form-row:last-child {
    border-bottom: none;
  }

  .form-row-cod {
    grid-template-columns: 1fr 1.5fr;
  }

  .form-row-reversed {
    grid-template-columns: 1.5fr 1fr;
  }

  .form-row-normal {
    grid-template-columns: 1.3fr 1.5fr;
  }

  .form-label {
    padding: 12px;
    font-weight: bold;
    font-size: 14px;
    text-transform: uppercase;
    border-right: 1px solid #9ca3af;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    background-color: #f9fafb;
    white-space: nowrap;
  }

  .cod-label {
    font-size: 20px;
    font-weight: 800;
    justify-content: center;
  }

  .arabic-label {
    font-size: 14px;
    font-weight: bold;
    text-align: center;
    justify-content: center;
    background-color: #f9fafb;
    padding: 12px;
    border-left: none;
    border-right: none;
  }

  .form-value {
    padding: 12px;
    font-size: 14px;
    display: flex;
    align-items: center;
    font-weight: 500;
    text-align: center;
    justify-content: center;
    border-right: 1px solid #9ca3af;
  }

  .form-value-no-border {
    border-right: none;
  }

  .description-value {
    min-height: 100px;
    align-items: flex-start;
    padding-top: 12px;
  }

  .info-row {
    display: grid;
    grid-template-columns: 1fr 110px;
    border-bottom: 1px solid #d1d5db;
  }

  .info-row:last-child {
    border-bottom: none;
  }

  .info-label {
    padding: 12px;
    font-weight: bold;
    background-color: #f9fafb;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    border-right: 1px solid #9ca3af;
    min-width: 110px;
  }

  .info-value {
    padding: 12px;
    font-size: 14px;
    display: flex;
    align-items: center;
    line-height: 1.4;
    text-align: center;
    justify-content: center;
  }

  .address-value {
    font-size: 14px;
    line-height: 1.625;
    min-height: 100px;
    align-items: flex-start;
  }

  .notes-value {
    min-height: 100px;
    align-items: center;
    justify-content: center;
    text-align: center;
  }

  .location-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .location-value {
    padding: 12px;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .location-value:last-child {
    border-right: 1px solid #9ca3af;
  }

  .highlight-box {
    background-color: #fef3c7;
    border: 2px solid #f59e0b;
    padding: 12px;
    margin: 12px 0;
    border-radius: 4px;
  }

  .highlight-label {
    font-weight: bold;
    font-size: 16px;
    color: #92400e;
    margin-bottom: 8px;
  }

  .highlight-value {
    font-size: 18px;
    font-weight: bold;
    color: #78350f;
  }

  .section-divider {
    border-top: 2px solid #9ca3af;
    margin: 16px 0;
    padding-top: 16px;
  }

  @media print {
    body {
      margin: 0;
      padding: 0;
    }
    .container {
      margin: 0;
      padding: 0;
      page-break-after: avoid;
    }
  }
`;

// Delivery Policy Template (Original design)
function getDeliveryPolicyTemplate(data, barcodeDataUrl, qrCodeDataUrl, logoDataUrl, watermarkDataUrl) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Delivery Policy</title>
      <style>${getSharedStyles()}</style>
    </head>
    <body>
      <div class="container">
        ${watermarkDataUrl ? `<img src="${watermarkDataUrl}" class="watermark" alt="Watermark">` : ''}
        <div class="header">
          <div class="logo">
            ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo">` : '<div style="font-size: 60px; font-weight: bold; color: #000;">now</div>'}
          </div>
          
          <div class="awb-section">
            <div class="awb-label">AWB NUMBER</div>
            <div class="awb-number">${data.awbNumber}</div>
          </div>

          <div class="barcode-qr">
            <div class="barcode-item">
              <div class="barcode-container">
                <div class="barcode-label-box">E-01</div>
                <div class="barcode-wrapper">
                  <img src="${barcodeDataUrl}" alt="Barcode">
                </div>
              </div>
            </div>
            
            <div class="barcode-item">
              <div class="qr-code">
                <img src="${qrCodeDataUrl}" alt="QR Code">
              </div>
            </div>
          </div>
        </div>

        <div class="content">
          <div class="left-section">
            <!-- Box 1: COD -->
            <div class="left-box">
              <div class="form-row form-row-cod">
                <div class="form-label cod-label">COD</div>
                <div class="form-value form-value-no-border">${data.cod}</div>
              </div>
            </div>

            <!-- Box 1.5: حالة الشحنه -->
            <div class="left-box">
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.deliveryStatus || 'DELIVER'}</div>
                <div class="arabic-label">حالة الشحنه</div>
              </div>
            </div>

            <!-- Box 2: عدد القطع + فتح الشحنه + وصف الشحنه -->
            <div class="left-box flex-1">
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.numPieces || '1'}</div>
                <div class="arabic-label">عدد القطع</div>
              </div>
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.openShipment || 'NO'}</div>
                <div class="arabic-label">فتح الشحنه</div>
              </div>
              <div class="form-row form-row-reversed">
                <div class="form-value description-value">${data.shipmentDescription || 'N/A'}</div>
                <div class="arabic-label">وصف الشحنه</div>
              </div>
            </div>

            <!-- Box 3: ORDER REF + CREATED ON -->
            <div class="left-box">
              <div class="form-row form-row-normal">
                <div class="form-label" style="font-size: 12px; font-weight: 700; border-right: none;">ORDER REF</div>
                <div class="form-value form-value-no-border" style="font-size: 15px; font-weight: 600;">${data.orderRef || 'N/A'}</div>
              </div>
              <div class="form-row form-row-normal">
                <div class="form-label" style="font-size: 12px; font-weight: 700; border-right: none;">CREATED ON</div>
                <div class="form-value form-value-no-border" style="font-size: 15px; font-weight: 600;">${data.createdOn || ''}</div>
              </div>
            </div>
          </div>

          <div class="right-section">
            <!-- Box 1: من، الي، تليفون -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value">${data.shippingFrom}</div>
                <div class="info-label">من</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.recipientName}</div>
                <div class="info-label">الي</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.recipientPhone}</div>
                <div class="info-label">تليفون</div>
              </div>
            </div>

            <!-- Box 2: المدينة، المنطقة، العنوان -->
            <div class="right-box flex-1">
              <div class="info-row">
                <div class="location-row">
                  <div class="location-value">${data.city}</div>
                  <div class="location-value">${data.hub}</div>
                </div>
                <div class="info-label">المدينة</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.area}</div>
                <div class="info-label">المنطقة</div>
              </div>
              <div class="info-row">
                <div class="info-value address-value">${data.address}</div>
                <div class="info-label">العنوان</div>
              </div>
            </div>

            <!-- Box 3: الملاحظات -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value notes-value">${data.notes}</div>
                <div class="info-label">الملاحظات</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Return Policy Template (Different design with original order number)
function getReturnPolicyTemplate(data, barcodeDataUrl, qrCodeDataUrl, logoDataUrl, watermarkDataUrl) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Return Policy</title>
      <style>${getSharedStyles()}</style>
    </head>
    <body>
      <div class="container">
        ${watermarkDataUrl ? `<img src="${watermarkDataUrl}" class="watermark" alt="Watermark">` : ''}
        <div class="header">
          <div class="logo">
            ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo">` : '<div style="font-size: 60px; font-weight: bold; color: #000;">now</div>'}
          </div>
          
          <div class="awb-section">
            <div class="awb-label">RETURN AWB NUMBER</div>
            <div class="awb-number">${data.awbNumber}</div>
          </div>

          <div class="barcode-qr">
            <div class="barcode-item">
              <div class="barcode-container">
                <div class="barcode-label-box">R-01</div>
                <div class="barcode-wrapper">
                  <img src="${barcodeDataUrl}" alt="Barcode">
                </div>
              </div>
            </div>
            
            <div class="barcode-item">
              <div class="qr-code">
                <img src="${qrCodeDataUrl}" alt="QR Code">
              </div>
            </div>
          </div>
        </div>

        <div class="content">
          <div class="left-section">
            <!-- Box 1: COD -->
            <div class="left-box">
              <div class="form-row form-row-cod">
                <div class="form-label cod-label">COD</div>
                <div class="form-value form-value-no-border">${data.cod}</div>
              </div>
            </div>

            <!-- Box 1.5: حالة الشحنه -->
            <div class="left-box">
              <div class="form-row form-row-reversed">
                <div class="form-value">RETURN</div>
                <div class="arabic-label">حالة الشحنه</div>
              </div>
            </div>

            <!-- Box 2: عدد القطع + فتح الشحنه + وصف الشحنه -->
            <div class="left-box flex-1">
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.numPieces || '1'}</div>
                <div class="arabic-label">عدد القطع</div>
              </div>
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.openShipment || 'NO'}</div>
                <div class="arabic-label">فتح الشحنه</div>
              </div>
              <div class="form-row form-row-reversed">
                <div class="form-value description-value">${data.shipmentDescription || 'N/A'}</div>
                <div class="arabic-label">وصف الشحنه</div>
              </div>
            </div>

            <!-- Box 3: ORDER REF + CREATED ON -->
            <div class="left-box">
              <div class="form-row form-row-normal">
                <div class="form-label" style="font-size: 12px; font-weight: 700; border-right: none;">ORDER REF</div>
                <div class="form-value form-value-no-border" style="font-size: 15px; font-weight: 600;">${data.orderRef || 'N/A'}</div>
              </div>
              <div class="form-row form-row-normal">
                <div class="form-label" style="font-size: 12px; font-weight: 700; border-right: none;">CREATED ON</div>
                <div class="form-value form-value-no-border" style="font-size: 15px; font-weight: 600;">${data.createdOn || ''}</div>
              </div>
            </div>
          </div>

          <div class="right-section">
            <!-- Box 1: من، الي، تليفون -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value">${data.shippingFrom}</div>
                <div class="info-label">من</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.recipientName}</div>
                <div class="info-label">الي</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.recipientPhone}</div>
                <div class="info-label">تليفون</div>
              </div>
            </div>

            <!-- Box 2: المدينة، المنطقة، العنوان -->
            <div class="right-box flex-1">
              <div class="info-row">
                <div class="location-row">
                  <div class="location-value">${data.city}</div>
                  <div class="location-value">${data.hub}</div>
                </div>
                <div class="info-label">المدينة</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.area}</div>
                <div class="info-label">المنطقة</div>
              </div>
              <div class="info-row">
                <div class="info-value address-value">${data.address}</div>
                <div class="info-label">العنوان</div>
              </div>
            </div>

            <!-- Box 3: سبب الإرجاع + الملاحظات -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value notes-value">${data.returnReason || 'N/A'}</div>
                <div class="info-label">سبب الإرجاع</div>
              </div>
              <div class="info-row">
                <div class="info-value notes-value">${data.notes}</div>
                <div class="info-label">الملاحظات</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Exchange Policy Template (Different design with exchange details)
function getExchangePolicyTemplate(data, barcodeDataUrl, qrCodeDataUrl, logoDataUrl, watermarkDataUrl) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Exchange Policy</title>
      <style>${getSharedStyles()}</style>
    </head>
    <body>
      <div class="container">
        ${watermarkDataUrl ? `<img src="${watermarkDataUrl}" class="watermark" alt="Watermark">` : ''}
        <div class="header">
          <div class="logo">
            ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo">` : '<div style="font-size: 60px; font-weight: bold; color: #000;">now</div>'}
          </div>
          
          <div class="awb-section">
            <div class="awb-label">EXCHANGE AWB NUMBER</div>
            <div class="awb-number">${data.awbNumber}</div>
          </div>

          <div class="barcode-qr">
            <div class="barcode-item">
              <div class="barcode-container">
                <div class="barcode-label-box">X-01</div>
                <div class="barcode-wrapper">
                  <img src="${barcodeDataUrl}" alt="Barcode">
                </div>
              </div>
            </div>
            
            <div class="barcode-item">
              <div class="qr-code">
                <img src="${qrCodeDataUrl}" alt="QR Code">
              </div>
            </div>
          </div>
        </div>

        <div class="content">
          <div class="left-section">
            <!-- Box 1: COD -->
            <div class="left-box">
              <div class="form-row form-row-cod">
                <div class="form-label cod-label">COD</div>
                <div class="form-value form-value-no-border">${data.cod}</div>
              </div>
            </div>

            <!-- Box 1.5: حالة الشحنه -->
            <div class="left-box">
              <div class="form-row form-row-reversed">
                <div class="form-value">EXCHANGE</div>
                <div class="arabic-label">حالة الشحنه</div>
              </div>
            </div>

            <!-- Box 2: عدد القطع + فتح الشحنه + وصف الشحنه -->
            <div class="left-box flex-1">
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.numPieces || '1'}</div>
                <div class="arabic-label">عدد القطع</div>
              </div>
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.openShipment || 'NO'}</div>
                <div class="arabic-label">فتح الشحنه</div>
              </div>
              <div class="form-row form-row-reversed">
                <div class="form-value description-value">${data.shipmentDescription || 'N/A'}</div>
                <div class="arabic-label">وصف الشحنه</div>
              </div>
            </div>

            <!-- Box 3: ORDER REF + CREATED ON -->
            <div class="left-box">
              <div class="form-row form-row-normal">
                <div class="form-label" style="font-size: 12px; font-weight: 700; border-right: none;">ORDER REF</div>
                <div class="form-value form-value-no-border" style="font-size: 15px; font-weight: 600;">${data.orderRef || 'N/A'}</div>
              </div>
              <div class="form-row form-row-normal">
                <div class="form-label" style="font-size: 12px; font-weight: 700; border-right: none;">CREATED ON</div>
                <div class="form-value form-value-no-border" style="font-size: 15px; font-weight: 600;">${data.createdOn || ''}</div>
              </div>
            </div>
          </div>

          <div class="right-section">
            <!-- Box 1: من، الي، تليفون -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value">${data.shippingFrom}</div>
                <div class="info-label">من</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.recipientName}</div>
                <div class="info-label">الي</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.recipientPhone}</div>
                <div class="info-label">تليفون</div>
              </div>
            </div>

            <!-- Box 2: المدينة، المنطقة، العنوان -->
            <div class="right-box flex-1">
              <div class="info-row">
                <div class="location-row">
                  <div class="location-value">${data.city}</div>
                  <div class="location-value">${data.hub}</div>
                </div>
                <div class="info-label">المدينة</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.area}</div>
                <div class="info-label">المنطقة</div>
              </div>
              <div class="info-row">
                <div class="info-value address-value">${data.address}</div>
                <div class="info-label">العنوان</div>
              </div>
            </div>

            <!-- Box 3: Products Being Returned -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value notes-value">${data.productDescription || 'N/A'}</div>
                <div class="info-label">المنتج المراد إرجاعه</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.numberOfItems || '1'}</div>
                <div class="info-label">عدد القطع المرجعة</div>
              </div>
            </div>

            <!-- Box 4: New Product for Exchange -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value notes-value">${data.productDescriptionReplacement || 'N/A'}</div>
                <div class="info-label">المنتج الجديد للاستبدال</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.numberOfItemsReplacement || '1'}</div>
                <div class="info-label">عدد القطع الجديدة</div>
              </div>
            </div>

            <!-- Box 5: الملاحظات -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value notes-value">${data.notes}</div>
                <div class="info-label">الملاحظات</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Legacy function for backward compatibility
function getHtmlTemplate(data, barcodeDataUrl, qrCodeDataUrl, logoDataUrl, watermarkDataUrl) {
  return getDeliveryPolicyTemplate(data, barcodeDataUrl, qrCodeDataUrl, logoDataUrl, watermarkDataUrl);
}

/**
 * @param {import('mongoose').Document} order - Order with populated business
 * @returns {{ htmlContent: string, filenamePrefix: string, awbNumber: string }}
 */
async function buildPolicyHtmlForOrder(order) {
  const orderType = order.orderShipping?.orderType || 'Deliver';

  const baseData = {
    awbNumber: order.orderNumber != null ? String(order.orderNumber) : '',
    cod:
      order.orderShipping?.amountType === 'COD' || order.orderShipping?.amountType === 'CD'
        ? `${order.orderShipping?.amount || '0'} EGP`
        : 'N/A',
    deliveryStatus: getDeliveryStatusText(order.orderShipping?.orderType, order.orderShipping?.amountType),
    recipientName: order.orderCustomer?.fullName || 'N/A',
    recipientPhone: order.orderCustomer?.phoneNumber != null ? String(order.orderCustomer.phoneNumber) : 'N/A',
    city: String(order.orderCustomer?.government ?? '').toUpperCase() || 'N/A',
    hub: String(order.orderCustomer?.zone ?? '').toUpperCase() || 'N/A',
    area: String(order.orderCustomer?.zone ?? '').toUpperCase() || 'N/A',
    address: order.orderCustomer?.address || 'N/A',
    notes: order.orderShipping?.returnNotes || order.orderShipping?.returnReason || order.orderNotes || 'N/A',
    shippingFrom:
      order.business?.brandInfo?.brandName ||
      order.business?.name ||
      order.business?.businessName ||
      order.business?.fullName ||
      'Business',
    orderRef: order.referralNumber || null,
    createdOn: order.orderDate ? new Date(order.orderDate).toLocaleDateString('en-GB') : '',
    numPieces: order.orderShipping?.numberOfItems?.toString() || '1',
    openShipment: 'NO',
    shipmentDescription: order.orderShipping?.productDescription || 'N/A',
  };

  let data = { ...baseData };
  let templateFunction = getDeliveryPolicyTemplate;
  let filenamePrefix = 'delivery';

  if (orderType === 'Return') {
    data = {
      ...baseData,
      returnReason: order.orderShipping?.returnReason || 'N/A',
      notes: order.orderShipping?.returnNotes || order.orderShipping?.returnReason || order.orderNotes || 'N/A',
    };
    templateFunction = getReturnPolicyTemplate;
    filenamePrefix = 'return';
  } else if (orderType === 'Exchange') {
    data = {
      ...baseData,
      productDescription: order.orderShipping?.productDescription || 'N/A',
      numberOfItems: order.orderShipping?.numberOfItems?.toString() || '1',
      productDescriptionReplacement: order.orderShipping?.productDescriptionReplacement || 'N/A',
      numberOfItemsReplacement: order.orderShipping?.numberOfItemsReplacement?.toString() || '1',
      notes: order.orderShipping?.returnNotes || order.orderShipping?.returnReason || order.orderNotes || 'N/A',
    };
    templateFunction = getExchangePolicyTemplate;
    filenamePrefix = 'exchange';
  }

  const barcodeDataUrl = await generateBarcode(data.awbNumber);
  const qrCodeDataUrl = await generateQRCode(data.awbNumber);
  const logoDataUrl = getImageAsBase64('logo.png');
  const watermarkDataUrl = getImageAsBase64('watermark.png');
  const htmlContent = templateFunction(data, barcodeDataUrl, qrCodeDataUrl, logoDataUrl, watermarkDataUrl);
  return { htmlContent, filenamePrefix, awbNumber: data.awbNumber };
}

async function htmlToPdfBuffer(htmlContent, paperSize) {
  const launchOpts = getPuppeteerLaunchOptions();
  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1400 });
    await page.setContent(htmlContent, {
      waitUntil: 'load',
      timeout: 30000,
    });

    let scale = 1.0;
    if (paperSize === 'A5') scale = 0.7;
    if (scale !== 1.0) {
      await page.evaluate((scaleValue) => {
        document.body.style.transform = `scale(${scaleValue})`;
        document.body.style.transformOrigin = 'top left';
        document.body.style.width = `${100 / scaleValue}%`;
      }, scale);
    }

    const pdfBuffer = await page.pdf({
      format: paperSize,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
      preferCSSPageSize: false,
    });
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('Generated PDF is empty');
    }
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

/**
 * Single-order delivery policy PDF (same output as legacy printPolicy).
 * @param {import('mongoose').Document} order
 * @param {string} [rawPaperSize]
 * @returns {Promise<Buffer>}
 */
async function renderDeliveryPolicyPdfBuffer(order, rawPaperSize) {
  const paperSize = normalizePaperSize(rawPaperSize);
  const { htmlContent } = await buildPolicyHtmlForOrder(order);
  return htmlToPdfBuffer(htmlContent, paperSize);
}

/**
 * Merge multiple order policy PDFs into one file (one browser session).
 * @param {import('mongoose').Document[]} orders
 * @param {string} [rawPaperSize]
 */
async function renderMergedDeliveryPolicyPdfBuffers(orders, rawPaperSize) {
  if (!Array.isArray(orders) || orders.length === 0) {
    throw new Error('No orders to print');
  }
  const paperSize = normalizePaperSize(rawPaperSize);
  const merged = await PDFDocument.create();
  const launchOpts = getPuppeteerLaunchOptions();
  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1400 });
    const contentWait = { waitUntil: 'domcontentloaded', timeout: 20000 };
    for (const order of orders) {
      const { htmlContent } = await buildPolicyHtmlForOrder(order);
      await page.setContent(htmlContent, contentWait);
      let scale = 1.0;
      if (paperSize === 'A5') scale = 0.7;
      if (scale !== 1.0) {
        await page.evaluate((scaleValue) => {
          document.body.style.transform = `scale(${scaleValue})`;
          document.body.style.transformOrigin = 'top left';
          document.body.style.width = `${100 / scaleValue}%`;
        }, scale);
      }
      const pdfBuffer = await page.pdf({
        format: paperSize,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        printBackground: true,
        preferCSSPageSize: false,
      });
      const doc = await PDFDocument.load(pdfBuffer);
      const copied = await merged.copyPages(doc, doc.getPageIndices());
      copied.forEach((p) => merged.addPage(p));
    }
    await page.close();
    return Buffer.from(await merged.save());
  } finally {
    await browser.close();
  }
}

module.exports = {
  normalizePaperSize,
  renderDeliveryPolicyPdfBuffer,
  renderMergedDeliveryPolicyPdfBuffers,
  getHtmlTemplate,
};

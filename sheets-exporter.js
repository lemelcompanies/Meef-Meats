import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

// Configuration
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';

/**
 * Initialize Google Sheets API
 */
async function getGoogleSheetsClient() {
  try {
    // Check if credentials file exists
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      console.error('Google credentials file not found at:', CREDENTIALS_PATH);
      return null;
    }

    // Load credentials
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));

    // Create auth client
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    return sheets;
  } catch (error) {
    console.error('Error initializing Google Sheets client:', error.message);
    return null;
  }
}

/**
 * Format order data for Google Sheets row
 */
function formatOrderForSheet(order) {
  // Format order date
  const orderDate = new Date(order.created_at).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  // Format order contents
  const orderContents = order.items.map(item => {
    const size = item.size === 'full' ? 'Full' : 'Half';
    return `${item.qty}x ${size} Turkey - ${item.flavor}`;
  }).join(', ');

  // Format total
  const total = `$${(order.total_cents / 100).toFixed(2)}`;

  // Format pickup date
  const pickupDate = new Date(order.pickup_date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  // Payment method - empty for now (can be filled manually or via admin)
  const paymentMethod = order.payment_method || '';

  // Payment received - default to "No"
  const paymentReceived = order.payment_received ? 'Yes' : 'No';

  return [
    order.id,                    // Order ID
    orderDate,                   // Order Date
    order.customer_name,         // Name
    order.email,                 // Email
    order.phone,                 // Phone
    orderContents,               // Order Contents
    total,                       // Total
    paymentMethod,               // Method of Payment
    paymentReceived,             // Payment Received
    pickupDate,                  // Pickup Date
    order.status                 // Status
  ];
}

/**
 * Export order to Google Sheets
 */
export async function exportOrderToSheets(order) {
  try {
    // Check if Google Sheets is configured
    if (!SPREADSHEET_ID) {
      console.log('Google Sheets not configured (GOOGLE_SHEET_ID not set). Skipping export.');
      return { success: false, message: 'Not configured' };
    }

    // Get Google Sheets client
    const sheets = await getGoogleSheetsClient();
    if (!sheets) {
      console.error('Failed to initialize Google Sheets client');
      return { success: false, message: 'Failed to initialize' };
    }

    // Format order data
    const rowData = formatOrderForSheet(order);

    // Append to sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:K', // Adjust if your sheet has a different name
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [rowData]
      }
    });

    console.log('✓ Order exported to Google Sheets:', order.id);
    return { success: true, response: response.data };

  } catch (error) {
    console.error('Error exporting to Google Sheets:', error.message);
    if (error.response) {
      console.error('Response error:', error.response.data);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Update order in Google Sheets (when status changes)
 */
export async function updateOrderInSheets(orderId, updatedFields) {
  try {
    if (!SPREADSHEET_ID) {
      return { success: false, message: 'Not configured' };
    }

    const sheets = await getGoogleSheetsClient();
    if (!sheets) {
      return { success: false, message: 'Failed to initialize' };
    }

    // Find the row with this order ID
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:K',
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    // Find the row (skip header row)
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === orderId) {
        rowIndex = i + 1; // +1 because sheets are 1-indexed
        break;
      }
    }

    if (rowIndex === -1) {
      console.log('Order not found in sheet:', orderId);
      return { success: false, message: 'Order not found in sheet' };
    }

    // Update specific fields
    const updates = [];

    // Status is in column K (index 10)
    if (updatedFields.status) {
      updates.push({
        range: `Sheet1!K${rowIndex}`,
        values: [[updatedFields.status]]
      });
    }

    // Payment method is in column H (index 7)
    if (updatedFields.payment_method) {
      updates.push({
        range: `Sheet1!H${rowIndex}`,
        values: [[updatedFields.payment_method]]
      });
    }

    // Payment received is in column I (index 8)
    if (updatedFields.payment_received !== undefined) {
      updates.push({
        range: `Sheet1!I${rowIndex}`,
        values: [[updatedFields.payment_received ? 'Yes' : 'No']]
      });
    }

    if (updates.length === 0) {
      return { success: true, message: 'No updates needed' };
    }

    // Batch update
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: updates
      }
    });

    console.log('✓ Order updated in Google Sheets:', orderId);
    return { success: true };

  } catch (error) {
    console.error('Error updating Google Sheets:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Bulk export all existing orders to Google Sheets
 */
export async function bulkExportOrders(orders) {
  try {
    if (!SPREADSHEET_ID) {
      console.log('Google Sheets not configured');
      return { success: false, message: 'Not configured' };
    }

    const sheets = await getGoogleSheetsClient();
    if (!sheets) {
      return { success: false, message: 'Failed to initialize' };
    }

    // Format all orders
    const rows = orders.map(order => formatOrderForSheet(order));

    // Append all rows at once
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:K',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: rows
      }
    });

    console.log(`✓ Bulk exported ${orders.length} orders to Google Sheets`);
    return { success: true, count: orders.length, response: response.data };

  } catch (error) {
    console.error('Error bulk exporting to Google Sheets:', error.message);
    return { success: false, error: error.message };
  }
}

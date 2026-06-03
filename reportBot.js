require("dotenv").config();

const { google } = require("googleapis");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function getGoogleAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

function formatDate(dateValue) {
  const d = new Date(dateValue);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getGroupFromOrderCode(orderCode = "") {
  const clean = String(orderCode).replace("#", "");
  const match = clean.match(/^([A-Za-z0-9]+)/);
  return match ? match[1].replace(/[0-9]/g, "") || match[1] : "";
}

function safeSheetName(name) {
  return String(name || "未分類")
    .replace(/[\\/?*[\]:]/g, "")
    .slice(0, 80);
}

async function getSheetsClient() {
  const auth = getGoogleAuth();
  return google.sheets({ version: "v4", auth });
}

async function getExistingSheets(sheets) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID
  });

  return res.data.sheets.map(s => s.properties.title);
}

async function createSheetIfNotExists(sheets, sheetName, existingSheets) {
  if (existingSheets.includes(sheetName)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName
            }
          }
        }
      ]
    }
  });

  existingSheets.push(sheetName);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1:G1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["日期", "群", "單號", "金額", "項目", "車牌", "車隊"]]
    }
  });
}

async function clearSheetData(sheets, sheetName) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A2:G1000`
  });
}

async function writeRows(sheets, sheetName, rows) {
  if (rows.length === 0) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A2:G${rows.length + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: rows
    }
  });

  const totalRow = rows.length + 3;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A${totalRow}:G${totalRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        "",
        "",
        "總扣",
        `=SUM(D2:D${rows.length + 1})`,
        "",
        "",
        ""
      ]]
    }
  });
}

async function getReportOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("order_code,address,assigned_plate,status,created_at")
    .not("assigned_plate", "is", null)
    .in("status", ["assigned", "decided", "completed"])
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

function groupByPlate(orders) {
  const map = {};

  for (const order of orders) {
    const plate = safeSheetName(order.assigned_plate || "未分類");

    if (!map[plate]) map[plate] = [];

    map[plate].push([
      formatDate(order.created_at),
      getGroupFromOrderCode(order.order_code),
      `#${order.order_code}/${order.address}`,
      20,
      "回扣",
      order.assigned_plate,
      "自家"
    ]);
  }

  return map;
}

async function syncReportsToGoogleSheet() {
  const sheets = await getSheetsClient();
  const orders = await getReportOrders();
  const grouped = groupByPlate(orders);
  const existingSheets = await getExistingSheets(sheets);

  let sheetCount = 0;
  let rowCount = 0;

  for (const [plate, rows] of Object.entries(grouped)) {
    await createSheetIfNotExists(sheets, plate, existingSheets);
    await clearSheetData(sheets, plate);
    await writeRows(sheets, plate, rows);

    sheetCount++;
    rowCount += rows.length;
  }

  return {
    sheets: sheetCount,
    rows: rowCount
  };
}

module.exports = {
  syncReportsToGoogleSheet
};
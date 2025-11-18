const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 讀取環境變數
const env = {
  API_KEY: process.env.GOOGLE_SHEETS_API_KEY || '',
  SPREADSHEET_ID: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '',
  RANGE: process.env.GOOGLE_SHEETS_RANGE || '用戶留言!C:F',
  TIMELINE_RANGE: process.env.GOOGLE_SHEETS_TIMELINE_RANGE || '大事紀!C:G',
  LUNCH_EVENTS_RANGE: process.env.GOOGLE_SHEETS_LUNCH_EVENTS_RANGE || '午餐直播連結!A:D',
  APPSCRIPT_URL: process.env.GOOGLE_APPSCRIPT_URL || ''
};

// 驗證必要的環境變數
const requiredVars = ['API_KEY', 'SPREADSHEET_ID', 'APPSCRIPT_URL'];
const missingVars = requiredVars.filter(key => !env[key]);

if (missingVars.length > 0) {
  console.error('❌ 缺少必要的環境變數:', missingVars.join(', '));
  console.error('請確認 .env 檔案已正確設定');
  process.exit(1);
}

console.log('✅ 環境變數載入成功');

// 轉義 JavaScript 字串中的特殊字元
function escapeJsString(str) {
  return String(str)
    .replace(/\\/g, '\\\\')  // 反斜線
    .replace(/'/g, "\\'")    // 單引號
    .replace(/"/g, '\\"')    // 雙引號
    .replace(/\n/g, '\\n')   // 換行
    .replace(/\r/g, '\\r')   // 回車
    .replace(/\t/g, '\\t');  // Tab
}

// 生成 config.js 檔案
const configPath = path.join(__dirname, 'config.js');
const configContent = `// 此檔案由 build.js 自動生成，請勿手動編輯
// 所有配置都從 .env 檔案讀取

window.MM_SHEET_CONFIG = {
  apiKey: '${escapeJsString(env.API_KEY)}',            // Google Sheets API 金鑰（用於讀取）
  spreadsheetId: '${escapeJsString(env.SPREADSHEET_ID)}',     // 試算表 ID
  range: '${escapeJsString(env.RANGE)}',   // 讀取範圍：審核狀態、調整後的留言內容、用戶名稱、Email
  timelineRange: '${escapeJsString(env.TIMELINE_RANGE)}',   // 讀取範圍：年/月、事件標題、事件標題縮減版、事件描述、夥伴留言
  lunchEventsRange: '${escapeJsString(env.LUNCH_EVENTS_RANGE)}',   // 讀取範圍：日期、連結、按鈕顯示、嵌入 YT 影片
  appScriptUrl: "${escapeJsString(env.APPSCRIPT_URL)}",     // Google Apps Script Web App URL（用於寫入留言，請參考 GOOGLE_SHEETS_SETUP.md 設定）
  sheetsApiEndpoint: 'https://sheets.googleapis.com/v4/spreadsheets',  // Google Sheets API 端點
};
`;

fs.writeFileSync(configPath, configContent, 'utf8');
console.log('✅ config.js 已生成');

console.log('🎉 構建完成！');


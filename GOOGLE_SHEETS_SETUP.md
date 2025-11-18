# Google Sheets 寫入功能設定指南

本專案使用 Google Apps Script 作為中間層，將表單留言寫入 Google Sheet。

## 📋 設定步驟

### 1. 建立 Google Apps Script Web App

1. 開啟您的 Google Sheet（與讀取資料使用同一個試算表）
2. 點擊 **擴充功能** > **Apps Script**
3. 刪除預設程式碼，貼上以下程式碼：

```javascript
function doPost(e) {
  try {
    // 取得試算表（請將 'YOUR_SPREADSHEET_ID' 替換為您的試算表 ID）
    const spreadsheetId = 'YOUR_SPREADSHEET_ID';
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('用戶留言');
    
    // 記錄原始資料以便除錯
    const rawData = e.postData.contents;
    Logger.log('Received data: ' + rawData);
    
    // 解析 POST 資料
    const data = JSON.parse(rawData);
    
    // 確保正確取得各欄位資料（使用 String() 確保不會是 undefined）
    const name = String(data.name || '').trim();
    const email = String(data.email || '').trim();
    const message = String(data.message || '').trim();
    const timestamp = data.timestamp || new Date().toISOString();
    
    // 記錄解析後的資料以便除錯
    Logger.log('Parsed - name: ' + name + ', email: ' + email + ', message length: ' + message.length);
    
    // 根據您的 Sheet 欄位結構寫入
    // Sheet 欄位順序（從左到右）：編號、隱藏、審核狀態、調整後的留言、用戶名稱、Email、留言時間
    const rowData = [
      '',                   // A 欄：編號（自動遞增或留空）
      true,                // B 欄：隱藏（false 表示不隱藏）
      '審核中',            // C 欄：審核狀態（新留言預設為待審核）
      message,              // D 欄：調整後的留言內容（確保不是空字串）
      name,                 // E 欄：用戶名稱
      email,                // F 欄：Email
      timestamp             // G 欄：留言時間
    ];
    
    // 記錄即將寫入的資料
    Logger.log('Writing row: ' + JSON.stringify(rowData));
    
    // 寫入資料
    sheet.appendRow(rowData);
    
    // 回傳成功訊息（包含接收到的資料以便驗證）
    return ContentService.createTextOutput(JSON.stringify({ 
      success: true, 
      message: '留言已成功提交',
      received: {
        name: name,
        email: email,
        messageLength: message.length
      }
    }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    // 記錄錯誤並回傳
    Logger.log('Error: ' + error.toString());
    Logger.log('Stack: ' + error.stack);
    return ContentService.createTextOutput(JSON.stringify({ 
      success: false, 
      error: error.toString(),
      stack: error.stack
    }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 注意：不需要 doOptions() 函數
// 因為前端使用 text/plain Content-Type，不會觸發 CORS 預檢請求

**重要說明：**
- 使用 `doPost()` 接收 POST 請求
- 資料透過 `e.postData.contents` 取得 JSON 字串（前端使用 `text/plain` Content-Type）
- 需要手動解析 JSON：`JSON.parse(e.postData.contents)`
- 使用 `String()` 確保資料不會是 `undefined`，並使用 `.trim()` 移除多餘空白
- 使用 `Logger.log()` 記錄資料以便除錯（可在 Apps Script 編輯器的「執行作業」中查看）
- 使用 `ContentService` 回傳 JSON，瀏覽器的 `fetch` API 會自動跟隨 302 重定向
- 前端使用 `text/plain;charset=utf-8` 作為 Content-Type 以避免 CORS 預檢請求

**除錯技巧：**
- 在 Apps Script 編輯器中，點擊「執行作業」可以看到 `Logger.log()` 的輸出
- 如果資料仍未正確寫入，檢查 Logger 中的記錄來確認資料是否正確解析

### 2. 設定試算表 ID

將程式碼中的 `'YOUR_SPREADSHEET_ID'` 替換為您的實際試算表 ID。

試算表 ID 可在 URL 中找到：
```
https://docs.google.com/spreadsheets/d/[試算表ID]/edit
```

### 3. 部署 Web App

1. 在 Apps Script 編輯器中，點擊 **部署** > **新部署**
2. 點擊 **選取類型** 旁的齒輪圖示，選擇 **網頁應用程式**
3. 設定部署選項：
   - **說明**：可填寫 "留言表單提交服務"
   - **執行身份**：選擇 **我自己**
   - **誰可以存取**：選擇 **任何人**（讓網站可以呼叫此 API）
4. 點擊 **部署**
5. **重要**：首次部署會要求授權，請點擊 **授權存取** 並完成授權流程
6. 部署完成後，複製 **Web 應用程式網址**

### 4. 更新網站設定

在 `index.html` 中的 `MM_SHEET_CONFIG` 設定中，新增 `appScriptUrl`：

```javascript
window.MM_SHEET_CONFIG = {
  apiKey: '您的API金鑰',
  spreadsheetId: '您的試算表ID',
  range: '用戶留言!C:F',
  appScriptUrl: 'https://script.google.com/macros/s/您剛才複製的Web應用程式網址/exec' // 新增這一行
};
```

**注意**：網站程式碼已更新為使用 POST 方法，會透過 JSON body 傳送資料。瀏覽器會自動跟隨 Apps Script 的 302 重定向。

### 5. 測試功能

1. 在網站上填寫留言表單並提交
2. 檢查 Google Sheet 中是否新增了留言資料
3. 檢查瀏覽器開發者工具的 Console，確認是否有錯誤訊息

## 🔧 欄位對應說明

根據您的 Sheet 結構，欄位順序（從左到右）為：

- **A 欄**：編號（自動處理，可留空）
- **B 欄**：隱藏（預設為 `false`）
- **C 欄**：審核狀態（新留言預設為「待審核」）
- **D 欄**：調整後的留言內容 ← `message` 參數
- **E 欄**：用戶名稱 ← `name` 參數
- **F 欄**：Email ← `email` 參數
- **G 欄**：留言時間（自動填入時間戳記）

Apps Script 中的 `appendRow` 會按照上述順序寫入資料。

## ⚠️ 注意事項

1. **安全性**：由於設定為「任何人」可以存取，建議在 Apps Script 中加入簡單的驗證機制（如檢查來源網域）
2. **審核狀態**：新留言預設為「待審核」，需手動或透過其他方式將狀態改為「已通過」才會顯示在網站上
3. **錯誤處理**：如果寫入失敗，網站的留言功能仍會正常運作（會顯示在頁面上，但不會寫入 Sheet）

## 🐛 疑難排解

### 302 Found 錯誤解決方法：

1. **使用 POST 方法配合 CORS 模式**（已實作）：
   - 前端使用 `fetch` 的 `cors` 模式，瀏覽器會自動跟隨 302 重定向
   - 確保 Apps Script 使用 `doPost()` 接收 POST 請求
   - 前端傳送 JSON 格式的資料

2. **確認 Apps Script 設定**：
   - 「執行身份」選擇「我自己」
   - 「誰可以存取」選擇「任何人」（包括匿名使用者）
   - 確保 Apps Script 中包含 `doPost()` 函數

3. **檢查試算表權限**：
   - 確認試算表允許 Apps Script 帳號寫入
   - 或者將試算表分享給執行 Apps Script 的帳號

4. **重新部署**：
   - 修改 Apps Script 後，需要重新部署並使用新的 URL
   - 每次修改後都要建立新的部署版本

### 其他常見問題：

- **403 錯誤**：檢查「誰可以存取」是否設定為「任何人」（包括匿名使用者）
- **資料未寫入**：檢查試算表 ID 和 Sheet 名稱是否正確（注意大小寫）
- **CORS 錯誤**：已解決！使用 `text/plain;charset=utf-8` 作為 Content-Type 可以避免 CORS 預檢請求（OPTIONS），這樣就不需要 `doOptions()` 函數。這是 Google Apps Script Web App 的最佳實務做法


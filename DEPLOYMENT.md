# 部署說明

## 自動部署（GitHub Actions）

此專案使用 GitHub Actions 自動部署到 GitHub Pages。每次推送到 `main` 分支時，會自動執行構建和部署。

### 設置 GitHub Secrets

在 GitHub 倉庫中設置以下 Secrets（Settings > Secrets and variables > Actions > New repository secret）：

1. **GOOGLE_APPSCRIPT_URL** - API URL
2. **KEY_FOR_MM_10_YEARS_EVENT_PAGE** - Timeline API 驗證用 Header 值（**重要：必須設置，否則 API 請求不會包含 x-api-key**）

### 部署流程

1. 推送代碼到 `main` 分支
2. GitHub Actions 會自動：
   - 安裝依賴
   - 執行 `npm run build` 生成 `config.js`
   - 部署到 GitHub Pages

### 手動觸發部署

如果需要手動觸發部署：
1. 前往 GitHub 倉庫的 Actions 頁面
2. 選擇 "Deploy to GitHub Pages" 工作流程
3. 點擊 "Run workflow"

## 本地開發

### 設置環境變數

創建 `.env` 檔案（此檔案不會被提交到 Git）：

```env
GOOGLE_SHEETS_API_KEY=your_api_key
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SHEETS_RANGE=用戶留言!C:F
GOOGLE_SHEETS_TIMELINE_RANGE=大事紀!C:G
GOOGLE_SHEETS_LUNCH_EVENTS_RANGE=午餐直播連結!A:D
GOOGLE_APPSCRIPT_URL=https://dev-data.macromicro.me
KEY_FOR_MM_10_YEARS_EVENT_PAGE=your_api_key
```

### 構建

```bash
npm install
npm run build
```

### 本地運行

```bash
npm run dev
```

## 驗證部署

部署完成後，檢查以下項目：

1. 訪問 `https://your-domain.com/config.js`
2. 確認 `timelineApiKey` 有正確的值（不應該是空字串）
3. 確認 `appScriptUrl` 和 `sheetsApiEndpoint` 沒有尾隨換行符
4. 在瀏覽器開發者工具的 Network 面板中，確認 API 請求包含 `x-api-key` header

## 故障排除

### config.js 中 timelineApiKey 為空

- 確認 GitHub Secrets 中已設置 `KEY_FOR_MM_10_YEARS_EVENT_PAGE`
- 檢查 GitHub Actions 的構建日誌，確認環境變數是否正確載入
- 確認 Secrets 的值沒有多餘的空白或換行符

### API 請求沒有 x-api-key header

- 檢查瀏覽器控制台是否有警告訊息
- 確認 `config.js` 中的 `timelineApiKey` 有值
- 清除瀏覽器緩存並重新載入


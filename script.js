(function(){
  "use strict";

  // Constants
  const MEDIA_DESKTOP_MIN = '(min-width: 48rem)';
  const DEBOUNCE_MS = 300;
  const TIMELINE_SCROLL_DELTA = 300;
  const TIMELINE_AUTOSCROLL_SPEED_PX_PER_FRAME = 0.3;
  const CAROUSEL_INTERVAL_MS = 8000; // 從 5000 增加到 8000 毫秒，降低滾動速度
  const CAROUSEL_ROW2_DELAY_MS = 6000; // 同步調整 row2 的延遲時間
  const CAROUSEL_DELTA = 320;
  const SWIPE_THRESHOLD_PX = 40;
  const COUNTDOWN_ANALYTICS_INTERVAL_MS = 60 * 1000;
  const COUNTDOWN_UI_INTERVAL_MS = 1000;

  // Simple GA4-like dispatcher with debouncing
  const debounceMap = new Map();
  function debounceKey(eventName, key){
    return `${eventName}::${key}`;
  }
  function track(eventName, params){
    const now = Date.now();
    const key = debounceKey(eventName, params && (params.element_id || params.year || params.to_index || 'global'));
    const last = debounceMap.get(key) || 0;
    if (now - last < DEBOUNCE_MS) return; // debounce
    debounceMap.set(key, now);
    // Placeholder: integrate with GA4 gtag or dataLayer
    console.log('[GA4]', eventName, params);
  }
  window.MMAnalytics = { track };

  // Helpers
  function getSectionFromElement(el){
    const sec = el.closest('[id^="sec-"]');
    if(!sec) return undefined;
    const id = sec.id.replace('sec-','');
    return id;
  }
  function bindCTA(selector){
    document.querySelectorAll(selector).forEach(function(el){
      el.addEventListener('click', function(){
        const elementId = el.getAttribute('data-analytics-id') || el.id;
        const text = el.getAttribute('data-analytics-text') || el.textContent.trim();
        const section = getSectionFromElement(el);
        const payload = { element_id: elementId, section: section, text: text };
        const promo = el.getAttribute('data-promo-code');
        const tier = el.getAttribute('data-plan-tier');
        if (promo) payload.promo_code = promo;
        if (tier) payload.plan_tier = tier;
        track('cta_click', payload);
      });
    });
  }

  // Hero
  bindCTA('#btn-hero-cta--primary, #ply-hero-video');
  document.getElementById('ply-hero-video')?.addEventListener('click', function(){
    track('video_play', { element_id: 'ply-hero-video', section: 'hero' });
  });

  // Timeline interactions
  const timelineViewport = document.getElementById('list-timeline');
  
  // 從 Google Sheet 取得大事紀資料
  async function fetchTimelineEventsViaAPI(){
    const cfg = window.MM_SHEET_CONFIG || {};
    const apiKey = cfg.apiKey;
    const spreadsheetId = cfg.spreadsheetId;
    const range = cfg.timelineRange || '大事紀!C:G';
    const sheetsApiEndpoint = cfg.sheetsApiEndpoint || 'https://sheets.googleapis.com/v4/spreadsheets';
    if (!apiKey || !spreadsheetId) return [];
    const url = `${sheetsApiEndpoint}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return [];
      const json = await res.json();
      const values = (json && Array.isArray(json.values)) ? json.values : [];
      if (values.length <= 1) return [];
      const headers = values[0];
      const rows = values.slice(1);
      
      // 欄位索引：C=年/月, D=事件標題, E=事件標題縮減版, F=事件描述, G=夥伴留言
      let idxYearMonth = getHeaderIndex(headers, ['年/月','year/month','Year/Month']);
      let idxTitle = getHeaderIndex(headers, ['事件標題','title','Title']);
      let idxDescription = getHeaderIndex(headers, ['事件描述','description','Description']);
      let idxPartner = getHeaderIndex(headers, ['夥伴留言','partner','Partner']);
      
      if (idxYearMonth < 0 || idxTitle < 0 || idxDescription < 0 || idxPartner < 0){
        console.warn('[Timeline Sheets] Header not matched, fallback by position');
        idxYearMonth = 0; idxTitle = 1; idxDescription = 3; idxPartner = 4; // 位置推斷：C=年/月(0), D=事件標題(1), F=事件描述(3), G=夥伴留言(4)
      }
      
      const mapped = rows.map(function(r, idx){
        const yearMonth = String((r && r[idxYearMonth]) || '').trim();
        // 從年/月欄位提取年份（例如 "2020/01" -> "2020"）
        const yearMatch = yearMonth.match(/^(\d{4})/);
        const year = yearMatch ? yearMatch[1] : '';
        
        return {
          year: year,
          yearMonth: yearMonth,
          titleShort: String((r && r[idxTitle]) || '').trim(),
          description: String((r && r[idxDescription]) || '').trim(),
          partner: String((r && r[idxPartner]) || '').trim(),
          index: idx
        };
      }).filter(function(e){ 
        // 只保留有年份和標題的資料
        return e.year && e.titleShort.length > 0; 
      });
      
      return mapped;
    } catch (error) {
      console.error('[Timeline Sheets] Error fetching timeline events:', error);
      return [];
    }
  }
  
  // 按年份分組事件
  function groupEventsByYear(events){
    const grouped = {};
    events.forEach(function(event){
      const year = event.year;
      if (!grouped[year]){
        grouped[year] = [];
      }
      grouped[year].push(event);
    });
    return grouped;
  }
  
  // 開啟時間軸事件 modal - 顯示該年度的所有事件
  const dlgTimelineEvent = document.getElementById('dlg-timeline-event');
  const btnTimelineEventClose = document.getElementById('btn-timeline-event-close');
  const btnTimelineEventBackdrop = document.getElementById('btn-timeline-event-backdrop');
  const txtTimelineEventTitle = document.getElementById('txt-timeline-event-title');
  const timelineEventContentList = document.getElementById('timeline-event-content-list');
  
  function openTimelineYearEvents(year, yearEvents){
    if (!dlgTimelineEvent || !txtTimelineEventTitle || !timelineEventContentList) return;
    if (!year || !yearEvents || yearEvents.length === 0) return;
    
    // 設置標題為年份
    txtTimelineEventTitle.textContent = `${year} 年度大事紀`;
    
    // 清空現有內容
    timelineEventContentList.innerHTML = '';
    
    // 為該年度的每個事件建立區塊
    yearEvents.forEach(function(event){
      const eventBlock = document.createElement('div');
      eventBlock.className = 'timeline-event-item';
      
      // 事件標題（加上月份前綴）
      const eventTitle = document.createElement('h4');
      eventTitle.className = 'timeline-event-item-title';
      
      // 從 yearMonth 提取月份（例如 "2020/01" -> "01"）
      let monthPrefix = '';
      if (event.yearMonth) {
        const monthMatch = event.yearMonth.match(/\/(\d{1,2})$/);
        if (monthMatch) {
          const month = monthMatch[1].padStart(2, '0');
          monthPrefix = `${month}月 `;
        }
      }
      
      eventTitle.textContent = monthPrefix + (event.titleShort || '事件');
      eventBlock.appendChild(eventTitle);
      
      // 事件描述
      // const descriptionSection = document.createElement('div');
      // descriptionSection.className = 'timeline-event-description';
      // const descText = document.createElement('p');
      // descText.className = 'modal-desc';
      // descText.textContent = event.description || '';
      // descriptionSection.appendChild(descText);
      // eventBlock.appendChild(descriptionSection);
      
      // 如果有夥伴留言，才顯示該區塊
      if (event.partner && event.partner.trim().length > 0){
        const partnerSection = document.createElement('div');
        partnerSection.className = 'timeline-event-partner';
        const partnerTitle = document.createElement('h5');
        partnerTitle.className = 'timeline-event-section-title';
        partnerTitle.textContent = '夥伴留言';
        const partnerText = document.createElement('p');
        partnerText.className = 'modal-desc';
        partnerText.textContent = event.partner;
        partnerSection.appendChild(partnerTitle);
        partnerSection.appendChild(partnerText);
        eventBlock.appendChild(partnerSection);
      }
      
      timelineEventContentList.appendChild(eventBlock);
    });
    
    dlgTimelineEvent.removeAttribute('hidden');
    track('timeline_event_view', { year: year, element_id: `timeline-${year}`, section: 'timeline' });
  }
  
  function closeTimelineEvent(){
    if (dlgTimelineEvent) dlgTimelineEvent.setAttribute('hidden','');
  }
  
  btnTimelineEventClose?.addEventListener('click', closeTimelineEvent);
  btnTimelineEventBackdrop?.addEventListener('click', closeTimelineEvent);
  document.addEventListener('keydown', function(e){ 
    if (e.key === 'Escape' && dlgTimelineEvent && !dlgTimelineEvent.hasAttribute('hidden')) closeTimelineEvent(); 
  });
  
  // 生成單一時間軸事件項目（現在每個年份只顯示一個圖片）
  function createTimelineYearItem(year, yearEvents){
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.setAttribute('data-year', year);
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `${year} 年度大事紀`);
    
    // 使用年份圖片
    const imagePath = `images/timeline_${year}.png`;
    
    const img = document.createElement('img');
    img.src = imagePath;
    img.alt = `${year} 年度大事紀`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onerror = function(){
      // 如果圖片不存在，使用預設圖片
      this.src = '';
    };
    
    // 建立容器來放置圖片
    const container = document.createElement('div');
    container.className = 'timeline-item-container';
    
    container.appendChild(img);
    item.appendChild(container);
    
    // 點擊事件：開啟 modal，顯示該年度的所有事件
    item.addEventListener('click', function(){
      openTimelineYearEvents(year, yearEvents);
    });
    item.addEventListener('keydown', function(e){
      if (e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        openTimelineYearEvents(year, yearEvents);
      }
    });
    
    return item;
  }
  
  // 初始化時間軸
  async function initTimeline(){
    if (!timelineViewport) return;
    
    const events = await fetchTimelineEventsViaAPI();
    
    if (events.length === 0){
      console.warn('[Timeline] No events found, using default years');
      // 如果沒有資料，使用預設年份 2015-2025
      const defaultYears = ['2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];
      defaultYears.forEach(function(year){
        // 為預設年份創建一個空事件物件陣列
        const emptyEvents = [{ year: year, titleShort: '暫無資料', description: '該年度暫無事件資料', partner: '' }];
        const item = createTimelineYearItem(year, emptyEvents);
        timelineViewport.appendChild(item);
      });
      return;
    }
    
    // 按年份分組事件
    const groupedEvents = groupEventsByYear(events);
    
    // 取得所有年份並排序
    const years = Object.keys(groupedEvents).sort();
    
    // 為每個年份建立一個時間軸項目（每年只顯示一張圖片）
    years.forEach(function(year){
      const yearEvents = groupedEvents[year];
      const item = createTimelineYearItem(year, yearEvents);
      timelineViewport.appendChild(item);
    });
  }
  
  // 舊的 expandTimelineItem 函數已移除，改用 modal 方式
  document.getElementById('btn-timeline-prev')?.addEventListener('click', function(){
    timelineViewport.scrollBy({ left: -TIMELINE_SCROLL_DELTA, behavior: 'smooth' });
    track('timeline_nav', { direction: 'prev', element_id: 'btn-timeline-prev' });
  });
  document.getElementById('btn-timeline-next')?.addEventListener('click', function(){
    timelineViewport.scrollBy({ left: TIMELINE_SCROLL_DELTA, behavior: 'smooth' });
    track('timeline_nav', { direction: 'next', element_id: 'btn-timeline-next' });
  });

  // Timeline continuous auto-scroll (left to right), desktop/tablet only
  let timelineRAF = null;
  let timelinePaused = false;
  function startTimelineAutoScroll(){
    if (!timelineViewport) return;
    if (timelineViewport.dataset.autoscroll === 'on') return;
    // Only when horizontal (>= 48rem / 768px)
    if (!window.matchMedia(MEDIA_DESKTOP_MIN).matches) return;
    // Duplicate children once to enable seamless loop
    const originalWidth = timelineViewport.scrollWidth;
    if (!timelineViewport.dataset.cloned){
      const clone = timelineViewport.cloneNode(true);
      // move children of clone into viewport (not duplicate id attributes)
      Array.from(clone.children).forEach(function(node){
        // Remove duplicate ids to avoid duplicates in DOM
        if (node.id) node.id = node.id + '-clone';
        timelineViewport.appendChild(node);
      });
      timelineViewport.dataset.cloned = 'true';
    }
    const speedPxPerFrame = TIMELINE_AUTOSCROLL_SPEED_PX_PER_FRAME; // slow
    function step(){
      if (timelinePaused) { timelineRAF = requestAnimationFrame(step); return; }
      timelineViewport.scrollLeft += speedPxPerFrame;
      if (timelineViewport.scrollLeft >= originalWidth){
        timelineViewport.scrollLeft -= originalWidth; // loop
      }
      timelineRAF = requestAnimationFrame(step);
    }
    timelineViewport.dataset.autoscroll = 'on';
    timelineRAF = requestAnimationFrame(step);
  }
  function stopTimelineAutoScroll(){
    if (timelineRAF){ cancelAnimationFrame(timelineRAF); timelineRAF = null; }
    if (timelineViewport){ timelineViewport.dataset.autoscroll = 'off'; }
  }
  function applyTimelineMode(){
    stopTimelineAutoScroll();
    if (window.matchMedia(MEDIA_DESKTOP_MIN).matches){
      startTimelineAutoScroll();
    } else {
      // Reset scroll for vertical mode
      if (timelineViewport) timelineViewport.scrollTop = 0;
    }
  }
  if (timelineViewport){
    applyTimelineMode();
    window.addEventListener('resize', function(){ applyTimelineMode(); });
    timelineViewport.addEventListener('pointerenter', function(){ timelinePaused = true; });
    timelineViewport.addEventListener('pointerleave', function(){ timelinePaused = false; });
    timelineViewport.addEventListener('focusin', function(){ timelinePaused = true; });
    timelineViewport.addEventListener('focusout', function(){ timelinePaused = false; });
  }

  // Quiz
  bindCTA('#btn-quiz-start');
  document.getElementById('btn-quiz-start')?.addEventListener('click', function(){
    track('quiz_start', { section: 'quiz' });
    // Simple demo quiz flow: simulate 3 questions and completion
    const start = Date.now();
    setTimeout(function(){
      const duration = Date.now() - start;
      const score = Math.floor(60 + Math.random() * 40);
      track('quiz_complete', { score: score, duration_ms: duration });
      alert('測驗完成！分數：' + score);
    }, 1200);
  });

  // Testimonial carousel
  const row1 = document.getElementById('list-testimonial-row-1');
  const row2 = document.getElementById('list-testimonial-row-2');
  let demoMessages = [];
  function toBoolean(v){
    if (v === true) return true;
    if (typeof v === 'string'){
      const s = v.trim().toLowerCase();
      return s === 'true' || s === 'y' || s === 'yes' || s === '1';
    }
    if (typeof v === 'number') return v === 1;
    return false;
  }
  function isApprovedValue(v){
    return String(v).trim() === '已通過';
  }
  function normalizeHeaderName(s){
    return String(s || '')
      .replace(/[\u3000\s]+/g, '') // 移除半形/全形空白
      .toLowerCase();
  }
  function getHeaderIndex(headers, nameCandidates){
    const map = Object.create(null);
    headers.forEach(function(h, idx){ map[normalizeHeaderName(h)] = idx; });
    for (let i=0;i<nameCandidates.length;i++){
      const key = normalizeHeaderName(nameCandidates[i]);
      if (map[key] !== undefined) return map[key];
    }
    return -1;
  }
  // 取得 UTC+8 時區的時間戳記（台灣時區）
  // 格式：YYYY-MM-DD HH:mm:ss
  function getUTCP8Timestamp(){
    const now = new Date();
    // 取得 UTC 時間並加上 8 小時（UTC+8）
    const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    
    // 格式化為 YYYY-MM-DD HH:mm:ss 格式
    const year = utc8Time.getUTCFullYear();
    const month = String(utc8Time.getUTCMonth() + 1).padStart(2, '0');
    const day = String(utc8Time.getUTCDate()).padStart(2, '0');
    const hours = String(utc8Time.getUTCHours()).padStart(2, '0');
    const minutes = String(utc8Time.getUTCMinutes()).padStart(2, '0');
    const seconds = String(utc8Time.getUTCSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  // 寫入留言到 Google Sheet (透過 Google Apps Script Web App)
  async function appendTestimonialToSheet(name, email, message){
    const cfg = window.MM_SHEET_CONFIG || {};
    const appScriptUrl = cfg.appScriptUrl;
    
    // 如果沒有設定 Apps Script URL，則跳過寫入
    if (!appScriptUrl) {
      console.warn('[Sheets] appScriptUrl not configured, skipping write operation');
      console.info('[Sheets] 如需寫入功能，請參考 GOOGLE_SHEETS_SETUP.md 設定 Google Apps Script Web App URL');
      return false;
    }
    
    try {
      // 使用 POST 方法，Content-Type 設為 text/plain 以避免 CORS 預檢請求
      // 這是 Google Apps Script Web App 最可靠的方式
      // 注意：Apps Script 會返回 302 重定向，fetch API 會自動跟隨
      const response = await fetch(appScriptUrl, {
        method: 'POST',
        mode: 'cors', // 使用 cors 模式以跟隨 302 重定向
        headers: {
          'Content-Type': 'text/plain;charset=utf-8', // 使用 text/plain 避免 CORS 預檢請求
        },
        body: JSON.stringify({
          name: name,
          email: email,
          message: message,
          timestamp: getUTCP8Timestamp()
        }),
        redirect: 'follow' // 明確指定跟隨 302 重定向
      });
      
      // Google Apps Script 會先返回 302，然後重定向到實際執行 URL
      // fetch API 會自動跟隨重定向，最終 response.status 應該是 200（如果成功）
      // 或我們讀取回應內容來確認
      try {
        const result = await response.text();
        console.log('[Sheets] Response received:', result);
        
        // 嘗試解析 JSON 回應（如果 Apps Script 有返回）
        try {
          const jsonResult = JSON.parse(result);
          if (jsonResult.success) {
            console.log('[Sheets] ✅ Testimonial submitted successfully');
            return true;
          }
        } catch (e) {
          // 如果不是 JSON，可能是 HTML 或其他格式（這是正常的）
          console.log('[Sheets] Response is not JSON (this is normal for Apps Script)');
        }
        
        // 如果狀態碼是 2xx，通常表示成功（即使是 302 重定向後）
        if (response.status >= 200 && response.status < 300) {
          console.log('[Sheets] ✅ Request completed with status:', response.status);
          return true;
        }
        
        // 302 本身不是錯誤，表示重定向正在進行（fetch 會自動跟隨）
        if (response.status === 302 || response.redirected) {
          console.log('[Sheets] ✅ Request redirected (normal for Apps Script), assuming success');
          return true;
        }
        
        console.warn('[Sheets] ⚠️ Unexpected response status:', response.status);
        return true; // 仍然返回 true，讓流程繼續（資料可能已寫入）
        
      } catch (readError) {
        // 無法讀取回應（可能是因為 CORS 或其他原因），但不影響寫入操作
        console.warn('[Sheets] Could not read response, but request was sent:', readError);
        // 假設成功（因為請求已經發送，Apps Script 通常會處理）
        return true;
      }
      
    } catch (error) {
      console.error('[Sheets] ❌ Error submitting testimonial:', error);
      // 即使寫入失敗，仍繼續顯示留言（不會影響使用者體驗）
      return false;
    }
  }

  async function fetchSheetMessagesViaAPI(){
    const cfg = window.MM_SHEET_CONFIG || {};
    const apiKey = cfg.apiKey;
    const spreadsheetId = cfg.spreadsheetId;
    const range = cfg.range || '用戶留言!C:Ff';
    const sheetsApiEndpoint = cfg.sheetsApiEndpoint || 'https://sheets.googleapis.com/v4/spreadsheets';
    if (!apiKey || !spreadsheetId) return [];
    const url = `${sheetsApiEndpoint}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return [];
      const json = await res.json();
      const values = (json && Array.isArray(json.values)) ? json.values : [];
      if (values.length <= 1) return [];
      const headers = values[0];
      const rows = values.slice(1);
      let idxApproved = getHeaderIndex(headers, ['審核狀態','approved','Approved']);
      let idxMessage  = getHeaderIndex(headers, ['調整後的留言內容','message','Message']);
      let idxName     = getHeaderIndex(headers, ['用戶名稱','name','Name']);
      if (idxApproved < 0 || idxMessage < 0 || idxName < 0){
        console.warn('[Sheets] Header not matched, fallback by position');
        idxApproved = 0; idxMessage = 1; idxName = 2; // 位置推斷：range 第一欄=審核狀態、第二欄=留言、第三欄=名稱
      }
      const mapped = rows.map(function(r){
        return {
          approved: isApprovedValue((r && r[idxApproved]) || ''),
          text: String((r && r[idxMessage]) || ''),
          name: String((r && r[idxName]) || '匿名用戶')
        };
      }).filter(function(t){ return t.text.trim().length > 0; });
      const approvedOnly = mapped.filter(function(t){ return t.approved; });
      if (approvedOnly.length === 0){
        console.warn('[Sheets] No approved rows matched (value must be "已通過")');
      }
      return approvedOnly;
    } catch (_) {
      return [];
    }
  }

  // --- CSV 備援：解析與讀取（Publish to the web -> CSV 連結） ---
  function parseCsv(text){
    const rows = [];
    let i = 0, field = '', row = [], inQuotes = false;
    while (i < text.length){
      const ch = text[i++];
      if (inQuotes){
        if (ch === '"'){
          if (text[i] === '"'){ field += '"'; i++; } else { inQuotes = false; }
        } else { field += ch; }
      } else {
        if (ch === '"'){ inQuotes = true; }
        else if (ch === ','){ row.push(field); field = ''; }
        else if (ch === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
        else if (ch === '\r'){ /* ignore */ }
        else { field += ch; }
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  async function fetchSheetMessagesViaCSV(){
    const cfg = window.MM_SHEET_CONFIG || {};
    const csvUrl = cfg.csvUrl;
    if (!csvUrl) return [];
    try {
      const res = await fetch(csvUrl, { cache: 'no-store' });
      if (!res.ok) return [];
      const text = await res.text();
      const values = parseCsv(text);
      if (!Array.isArray(values) || values.length <= 1) return [];
      const headers = values[0];
      const rows = values.slice(1);
      let idxApproved = getHeaderIndex(headers, ['審核狀態','approved','Approved']);
      let idxMessage  = getHeaderIndex(headers, ['調整後的留言內容','message','Message']);
      let idxName     = getHeaderIndex(headers, ['用戶名稱','name','Name']);
      if (idxApproved < 0 || idxMessage < 0 || idxName < 0){
        console.warn('[Sheets CSV] Header not matched, fallback by position');
        idxApproved = 0; idxMessage = 1; idxName = 2;
      }
      const mapped = rows.map(function(r){
        return {
          approved: isApprovedValue((r && r[idxApproved]) || ''),
          text: String((r && r[idxMessage]) || ''),
          name: String((r && r[idxName]) || '匿名用戶')
        };
      }).filter(function(t){ return t.text.trim().length > 0; });
      const approvedOnly = mapped.filter(function(t){ return t.approved; });
      if (approvedOnly.length === 0){
        console.warn('[Sheets CSV] No approved rows matched (value must be "已通過")');
      }
      return approvedOnly;
    } catch (_) {
      return [];
    }
  }
  // 動態計算卡片文字的行數，確保不會被切一半，且 ... 出現在倒數三個文字之後
  function adjustCardTextLineClamp(card){
    const textEl = card.querySelector('.text');
    const textContentEl = card.querySelector('.text-content');
    const footerEl = card.querySelector('.card-footer');
    if (!textEl || !textContentEl || !footerEl) return;
    
    // 取得完整文字（從 data-full-text 或 textContent）
    const fullText = card.getAttribute('data-full-text') || textContentEl.textContent;
    if (!fullText) return;
    
    // 計算卡片可用高度（總高度 - padding - footer 高度 - margin）
    const cardHeight = card.clientHeight;
    const cardStyle = window.getComputedStyle(card);
    const paddingTop = parseFloat(cardStyle.paddingTop);
    const paddingBottom = parseFloat(cardStyle.paddingBottom);
    const footerHeight = footerEl.offsetHeight;
    const textStyle = window.getComputedStyle(textEl);
    const textMarginBottom = parseFloat(textStyle.marginBottom);
    
    const availableHeight = cardHeight - paddingTop - paddingBottom - footerHeight - textMarginBottom;
    
    // 創建測量元素，複製所有影響文字渲染的樣式（使用 text-content 的樣式）
    const textContentStyle = window.getComputedStyle(textContentEl);
    const measureEl = document.createElement('span');
    measureEl.style.fontSize = textContentStyle.fontSize;
    measureEl.style.fontFamily = textContentStyle.fontFamily;
    measureEl.style.fontWeight = textContentStyle.fontWeight;
    measureEl.style.lineHeight = textContentStyle.lineHeight;
    measureEl.style.padding = textContentStyle.padding;
    measureEl.style.margin = '0';
    measureEl.style.position = 'absolute';
    measureEl.style.visibility = 'hidden';
    measureEl.style.width = textContentEl.offsetWidth + 'px';
    measureEl.style.wordBreak = textContentStyle.wordBreak;
    measureEl.style.overflowWrap = textContentStyle.overflowWrap;
    measureEl.style.whiteSpace = 'normal';
    measureEl.style.height = 'auto';
    measureEl.style.maxWidth = textContentEl.offsetWidth + 'px';
    measureEl.style.overflow = 'visible';
    measureEl.style.webkitLineClamp = 'none';
    measureEl.style.lineClamp = 'none';
    measureEl.style.display = 'block';
    document.body.appendChild(measureEl);
    
    // 計算單行高度
    measureEl.textContent = '測量';
    const singleLineHeight = measureEl.offsetHeight;
    
    // 如果測量失敗，使用計算值作為備選
    const fallbackLineHeight = parseFloat(textContentStyle.lineHeight);
    const fallbackFontSize = parseFloat(textContentStyle.fontSize);
    const finalLineHeight = singleLineHeight > 0 ? singleLineHeight : 
                           (isNaN(fallbackLineHeight) || fallbackLineHeight < fallbackFontSize ? 
                            fallbackFontSize * 1.5 : fallbackLineHeight);
    
    // 計算可以完整顯示的最大高度（確保最後一行不會被切一半）
    const maxHeight = availableHeight;
    
    // 測試完整文字是否可以完整顯示
    measureEl.textContent = fullText;
    const fullTextHeight = measureEl.offsetHeight;
    
    // 如果完整文字可以完整顯示，直接顯示完整文字
    if (fullTextHeight <= maxHeight) {
      textContentEl.textContent = fullText;
      textContentEl.style.webkitLineClamp = 'none';
      textContentEl.style.lineClamp = 'none';
      document.body.removeChild(measureEl);
      return;
    }
    
    // 如果文字太長，需要截斷
    // 使用二分搜尋找到可以完整顯示的最大文字長度（包含 "..."）
    let left = 0;
    let right = fullText.length;
    let bestLength = 0;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const testText = fullText.slice(0, mid) + '...';
      measureEl.textContent = testText;
      const testHeight = measureEl.offsetHeight;
      
      if (testHeight <= maxHeight) {
        // 這個長度可以完整顯示，嘗試更長的文字
        bestLength = mid;
        left = mid + 1;
      } else {
        // 這個長度太長，需要縮短
        right = mid - 1;
      }
    }
    
    // 設置截斷後的文字（只顯示到 ...，後面不接任何文字）
    if (bestLength > 0) {
      const truncatedText = fullText.slice(0, bestLength) + '...';
      textContentEl.textContent = truncatedText;
    } else {
      // 如果連 "..." 都放不下，只顯示 "..."
      textContentEl.textContent = '...';
    }
    
    // 移除 line-clamp，因為我們已經手動截斷了文字
    textContentEl.style.webkitLineClamp = 'none';
    textContentEl.style.lineClamp = 'none';
    
    document.body.removeChild(measureEl);
  }
  
  // 批量調整所有卡片的文字行數
  function adjustAllCardTextClamps(){
    document.querySelectorAll('.card-testimonial').forEach(adjustCardTextLineClamp);
  }

  function createCard(t){
    const card = document.createElement('div');
    card.className = 'card-testimonial';
    card.id = `card-testimonial-item-${String(t.id).padStart(2,'0')}`;
    card.setAttribute('data-analytics-id', card.id);
    card.setAttribute('data-full-text', t.text);
    card.setAttribute('data-user-name', t.name);
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', '點擊查看完整留言');
    // 清理文字：移除多餘的換行符，保留正常空格，確保文字連續
    const cleanText = String(t.text || '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    card.innerHTML = `
    <p class="text"><span class="text-content">${cleanText}</span></p>
    <div class="card-footer">
      <img src="images/bunny_black.png" alt="用戶頭像" class="user-avatar-img">
      <div class="name">｜${t.name}</div>
    </div>
  `;
    card.addEventListener('click', function(){ openTestimonialFull(t.text, t.name, card.id); });
    card.addEventListener('keydown', function(e){
      if (e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        openTestimonialFull(t.text, t.name, card.id);
      }
    });
    // 等待 DOM 渲染完成後調整行數
    setTimeout(function(){
      adjustCardTextLineClamp(card);
    }, 0);
    return card;
  }
  function mountInitialTestimonials(){
    demoMessages.forEach(function(t,idx){
      (idx % 2 === 0 ? row1 : row2).appendChild(createCard(t));
    });
    // 等待所有卡片渲染完成後，重新調整一次（確保所有尺寸都正確）
    setTimeout(adjustAllCardTextClamps, 100);
  }

  // Autoplay with staggering rows
  function makeRowAutoplay(row, intervalMs){
    return setInterval(function(){
      if (!row) return;
      const delta = CAROUSEL_DELTA; // px
      const maxScroll = row.scrollWidth - row.clientWidth;
      // loop back when reaching end
      if (row.scrollLeft + delta >= maxScroll){
        row.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        row.scrollBy({ left: delta, behavior: 'smooth' });
      }
      track('carousel_autoplay', { interval_ms: intervalMs, visible_count: '1-3' });
    }, intervalMs);
  }
  let row1Timer = null;
  let row2Timer = null;
  function startCarousel(){
    if (row1Timer || row2Timer) return;
    row1Timer = makeRowAutoplay(row1, CAROUSEL_INTERVAL_MS);
    // row2 偏移 3 秒啟動
    setTimeout(function(){ row2Timer = makeRowAutoplay(row2, CAROUSEL_INTERVAL_MS); }, CAROUSEL_ROW2_DELAY_MS);
  }
  function stopCarousel(){
    if (row1Timer){ clearInterval(row1Timer); row1Timer = null; }
    if (row2Timer){ clearInterval(row2Timer); row2Timer = null; }
  }
  async function initTestimonials(){
    let sheet = await fetchSheetMessagesViaAPI();
    if (sheet.length > 0){
      demoMessages = sheet.map(function(r, i){ return { id: i+1, name: r.name, text: r.text }; });
    } else {
      const csv = await fetchSheetMessagesViaCSV();
      if (csv.length > 0){
        demoMessages = csv.map(function(r, i){ return { id: i+1, name: r.name, text: r.text }; });
      } else {
        demoMessages = Array.from({length: 32}).map(function(_,i){
          return { id: i+1, name: `會員 ${i+1}`, text: `這裡是第 ${i+1} 則真實回饋，MacroMicro 讓我更有效率理解市場。` };
        });
      }
    }
    mountInitialTestimonials();
    startCarousel();
  }

  // Swipe / manual
  [row1, row2].forEach(function(row){
    if (!row) return;
    let startX = 0;
    row.addEventListener('pointerdown', function(e){ startX = e.clientX; stopCarousel(); });
    row.addEventListener('pointerup', function(e){
      const dx = e.clientX - startX;
      if (Math.abs(dx) > SWIPE_THRESHOLD_PX){
        const dir = dx < 0 ? 'left' : 'right';
        const toIndex = Math.floor((row.scrollLeft + (dir==='left'? CAROUSEL_DELTA : -CAROUSEL_DELTA)) / CAROUSEL_DELTA);
        track('carousel_swipe', { direction: dir, to_index: toIndex });
      }
      startCarousel();
    });
  });

  // Testimonial form append
  const form = document.getElementById('form-testimonial');
  const dlg = document.getElementById('dlg-testimonial-thanks');
  const btnDlgClose = document.getElementById('btn-testimonial-thanks-close');
  const btnDlgBackdrop = document.getElementById('btn-thanks-backdrop');
  function openThanks(){ if (dlg) dlg.removeAttribute('hidden'); }
  function closeThanksAndReveal(){
    if (dlg) dlg.setAttribute('hidden','');
    // 滾到第一張，讓使用者看到自己的留言
    row1.scrollTo({ left: 0, behavior: 'smooth' });
  }
  btnDlgClose?.addEventListener('click', closeThanksAndReveal);
  btnDlgBackdrop?.addEventListener('click', closeThanksAndReveal);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && dlg && !dlg.hasAttribute('hidden')) closeThanksAndReveal(); });

  // Testimonial Full Text Modal
  const dlgFull = document.getElementById('dlg-testimonial-full');
  const btnFullClose = document.getElementById('btn-testimonial-full-close');
  const btnFullBackdrop = document.getElementById('btn-testimonial-full-backdrop');
  const txtFullText = document.getElementById('txt-testimonial-full-text');
  const txtFullName = document.getElementById('txt-testimonial-full-name');
  function openTestimonialFull(text, name, cardId){
    if (!dlgFull || !txtFullText || !txtFullName) return;
    txtFullText.textContent = text;
    txtFullName.textContent = name;
    dlgFull.removeAttribute('hidden');
    track('testimonial_view_full', { element_id: cardId, section: 'testimonial' });
  }
  function closeTestimonialFull(){
    if (dlgFull) dlgFull.setAttribute('hidden','');
  }
  btnFullClose?.addEventListener('click', closeTestimonialFull);
  btnFullBackdrop?.addEventListener('click', closeTestimonialFull);
  document.addEventListener('keydown', function(e){ 
    if (e.key === 'Escape' && dlgFull && !dlgFull.hasAttribute('hidden')) closeTestimonialFull(); 
  });

  // 驗證 Email 格式
  function validateEmail(email){
    if (!email || email.length <= 2) return false;
    const atIndex = email.indexOf('@');
    if (atIndex === -1) return false; // 必須包含 @
    if (atIndex === 0 || atIndex === email.length - 1) return false; // @ 不能在第一個或最後一個位置
    
    const dotIndex = email.indexOf('.', atIndex); // 尋找 @ 後方的 .
    if (dotIndex === -1) return false; // 必須包含 .
    if (dotIndex === atIndex + 1) return false; // . 不能在 @ 正後方
    if (dotIndex === email.length - 1) return false; // . 不能在最後一個位置
    
    return true;
  }

  // 驗證表單資料
  function validateTestimonialForm(name, email, message){
    const errors = [];
    
    // 檢查必填欄位
    if (!name || name.trim().length === 0) {
      errors.push('請填寫會員名稱');
    }
    if (!email || email.trim().length === 0) {
      errors.push('請填寫 Email');
    }
    if (!message || message.trim().length === 0) {
      errors.push('請填寫留言內容');
    }
    
    // 如果基本驗證失敗，直接返回錯誤
    if (errors.length > 0) {
      return { valid: false, errors: errors };
    }
    
    // 驗證 Email 格式
    if (!validateEmail(email.trim())) {
      errors.push('Email 格式不正確');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  form?.addEventListener('submit', async function(e){
    e.preventDefault();
    const nameInput = document.getElementById('inp-testimonial-name');
    const emailInput = document.getElementById('inp-testimonial-email');
    const messageInput = document.getElementById('inp-testimonial-message');
    
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const message = messageInput.value.trim();
    
    // 驗證表單資料
    const validation = validateTestimonialForm(name, email, message);
    
    if (!validation.valid) {
      // 顯示錯誤訊息
      const errorMsg = validation.errors.join('、');
      alert(errorMsg);
      
      // 移除舊的錯誤樣式
      nameInput.classList.remove('error');
      emailInput.classList.remove('error');
      messageInput.classList.remove('error');
      
      // 根據錯誤類型添加錯誤樣式
      if (!name || name.length === 0) {
        nameInput.classList.add('error');
      }
      if (!email || email.length === 0 || !validateEmail(email)) {
        emailInput.classList.add('error');
      }
      if (!message || message.length === 0) {
        messageInput.classList.add('error');
      }
      
      return;
    }
    
    // 移除錯誤樣式
    nameInput.classList.remove('error');
    emailInput.classList.remove('error');
    messageInput.classList.remove('error');
    
    // 嘗試寫入 Google Sheet
    await appendTestimonialToSheet(name, email, message);
    
    const newId = demoMessages.length + 1;
    const t = { id: newId, name: name, text: message };
    demoMessages.push(t);
    // prepend to row1; 之後彈出感謝視窗，關閉後再滾到最左
    const newCard = createCard(t);
    row1.insertBefore(newCard, row1.firstChild);
    // 確保新卡片的行數正確計算
    setTimeout(function(){
      adjustCardTextLineClamp(newCard);
    }, 50);
    form.reset();
    openThanks();
  });
  
  // 視窗大小改變時重新調整所有卡片行數（使用 debounce 優化效能）
  let resizeTimeout = null;
  window.addEventListener('resize', function(){
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function(){
      adjustAllCardTextClamps();
    }, 150);
  });

  // Offer CTA
  bindCTA('.btn-offer');

  // Countdown tag
  const countdownEl = document.getElementById('tag-offer-countdown');
  const end = Date.now() + 1000 * 60 * 60 * 24; // 24h from now
  function fmt(n){ return String(n).padStart(2,'0'); }
  function tick(){
    const remain = Math.max(0, end - Date.now());
    const sec = Math.floor(remain / 1000) % 60;
    const min = Math.floor(remain / (1000*60)) % 60;
    const hr = Math.floor(remain / (1000*60*60));
    if (countdownEl){ countdownEl.textContent = `${fmt(hr)}:${fmt(min)}:${fmt(sec)}`; }
    track('countdown_view', { remaining_sec: Math.floor(remain/1000) });
  }
  setInterval(tick, COUNTDOWN_ANALYTICS_INTERVAL_MS); // update every minute for analytics
  setInterval(function(){ if (countdownEl) tick(); }, COUNTDOWN_UI_INTERVAL_MS); // UI refresh each second
  tick();
  // Lunch Events - 午餐直播連結
  // 將 YouTube 連結轉換為嵌入格式
  function convertToYouTubeEmbed(url){
    if (!url || typeof url !== 'string') {
      console.warn('[YouTube URL] Invalid URL provided:', url);
      return null;
    }
    
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      console.warn('[YouTube URL] Empty URL provided');
      return null;
    }
    
    // 如果已經是 embed 格式，驗證是否有 videoId
    if (trimmedUrl.includes('/embed/')) {
      const embedMatch = trimmedUrl.match(/\/embed\/([^?&/]+)/);
      if (embedMatch && embedMatch[1] && embedMatch[1].length > 5) {
        return trimmedUrl;
      } else {
        console.warn('[YouTube URL] Invalid embed URL:', trimmedUrl);
        return null;
      }
    }
    
    let videoId = '';
    
    try {
      // 處理 https://www.youtube.com/watch?v=VIDEO_ID 格式
      const watchMatch = trimmedUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (watchMatch && watchMatch[1]) {
        videoId = watchMatch[1];
      }
      
      // 處理 https://youtu.be/VIDEO_ID 格式
      if (!videoId) {
        const shortMatch = trimmedUrl.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        if (shortMatch && shortMatch[1]) {
          videoId = shortMatch[1];
        }
      }
      
      // 處理 https://www.youtube.com/live/VIDEO_ID 格式
      if (!videoId) {
        const liveMatch = trimmedUrl.match(/youtube\.com\/live\/([a-zA-Z0-9_-]{11})/);
        if (liveMatch && liveMatch[1]) {
          videoId = liveMatch[1];
        }
      }
      
      // 如果找到 videoId，轉換為 embed 格式
      if (videoId && videoId.length === 11) {
        // 保留原始 URL 的查詢參數（如 start, autoplay 等）
        try {
          const urlObj = new URL(trimmedUrl);
          const params = new URLSearchParams(urlObj.search);
          params.delete('v'); // 刪除 v 參數，因為它會在 embed URL 路徑中
          
          let embedUrl = `https://www.youtube.com/embed/${videoId}`;
          const paramsStr = params.toString();
          if (paramsStr) {
            embedUrl += `?${paramsStr}`;
          }
          console.log('[YouTube URL] Converted to embed:', embedUrl);
          return embedUrl;
        } catch (e) {
          // 如果 URL 解析失敗，返回簡單的 embed URL
          console.log('[YouTube URL] Using simple embed format:', videoId);
          return `https://www.youtube.com/embed/${videoId}`;
        }
      } else {
        console.warn('[YouTube URL] Could not extract valid video ID from:', trimmedUrl);
      }
    } catch (error) {
      console.error('[YouTube URL] Error parsing URL:', trimmedUrl, error);
    }
    
    // 如果無法識別格式，返回 null（不要返回無效的 URL）
    console.warn('[YouTube URL] Failed to convert URL, returning null:', trimmedUrl);
    return null;
  }
  
  async function fetchLunchEventsViaAPI(){
    const cfg = window.MM_SHEET_CONFIG || {};
    const apiKey = cfg.apiKey;
    const spreadsheetId = cfg.spreadsheetId;
    const range = cfg.lunchEventsRange || '午餐直播連結!A:D';
    const sheetsApiEndpoint = cfg.sheetsApiEndpoint || 'https://sheets.googleapis.com/v4/spreadsheets';
    if (!apiKey || !spreadsheetId) return [];
    const url = `${sheetsApiEndpoint}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return [];
      const json = await res.json();
      const values = (json && Array.isArray(json.values)) ? json.values : [];
      if (values.length <= 1) return [];
      const headers = values[0];
      const rows = values.slice(1);
      
      // 欄位索引：A=日期, B=連結, C=按鈕顯示, D=嵌入 YT 影片
      let idxDate = getHeaderIndex(headers, ['日期','date','Date']);
      let idxLink = getHeaderIndex(headers, ['連結','link','Link']);
      let idxShowButton = getHeaderIndex(headers, ['按鈕顯示','show','Show']);
      let idxEmbedVideo = getHeaderIndex(headers, ['嵌入YT影片','嵌入 YT 影片','embed','Embed']);
      
      if (idxDate < 0 || idxLink < 0 || idxShowButton < 0 || idxEmbedVideo < 0){
        console.warn('[Lunch Events Sheets] Header not matched, fallback by position');
        idxDate = 0; idxLink = 1; idxShowButton = 2; idxEmbedVideo = 3;
      }
      
      const mapped = rows.map(function(r, idx){
        const dateText = String((r && r[idxDate]) || '').trim();
        const link = String((r && r[idxLink]) || '').trim();
        const showButton = toBoolean((r && r[idxShowButton]) || false);
        const embedVideo = toBoolean((r && r[idxEmbedVideo]) || false);
        
        return {
          date: dateText,
          link: link,
          showButton: showButton,
          embedVideo: embedVideo,
          index: idx
        };
      }).filter(function(e){ 
        // 只保留有日期的資料
        return e.date.length > 0; 
      });
      
      return mapped;
    } catch (error) {
      console.error('[Lunch Events Sheets] Error fetching lunch events:', error);
      return [];
    }
  }
  
  // 初始化午餐活動區域
  async function initLunchEvents(){
    const lunchEventVideo = document.querySelector('.lunch-event-video iframe');
    const lunchEventDates = document.querySelector('.lunch-event-dates');
    
    if (!lunchEventVideo || !lunchEventDates) return;
    
    const events = await fetchLunchEventsViaAPI();
    
    if (events.length === 0){
      console.warn('[Lunch Events] No events found, using default buttons');
      return;
    }
    
    // 清空現有按鈕
    lunchEventDates.innerHTML = '';
    
    // 取得最多 6 個活動
    const displayEvents = events.slice(0, 6);
    
    // 找到第一個需要嵌入影片的活動
    const firstEmbedEvent = displayEvents.find(function(e){ return e.embedVideo && e.link; });
    
    // 如果有需要嵌入的影片，更新 iframe src
    if (firstEmbedEvent && firstEmbedEvent.link){
      const embedUrl = convertToYouTubeEmbed(firstEmbedEvent.link);
      if (embedUrl) {
        lunchEventVideo.src = embedUrl;
        console.log('[Lunch Events] Successfully embedded video:', embedUrl);
      } else {
        console.error('[Lunch Events] Failed to convert URL to embed format:', firstEmbedEvent.link);
        console.warn('[Lunch Events] Please check that the URL in Google Sheets is a valid YouTube link');
      }
    } else {
      console.log('[Lunch Events] No video to embed (no events with embedVideo=TRUE found)');
    }
    
    // 格式化日期文字，在適當位置換行
    function formatDateForButton(dateText){
      if (!dateText) return '';
      
      // 先統一格式：確保 "年"、"月" 後面都有空格
      let normalized = dateText
        .replace(/年\s*/g, '年 ')    // 年後面確保有空格
        .replace(/月\s*/g, '月 ')    // 月後面確保有空格
        .replace(/\s+/g, ' ')        // 多個連續空格合併成一個
        .trim();                     // 移除首尾空格
      
      // 如果日期包含年份，在 "年 " 後面插入換行
      // 例如：
      //   "2026年01月06日" → "2026 年 " + "01 月 06 日"
      //   "2026 年01 月 06 號" → "2026 年 " + "01 月 06 號"
      //   "2026 年 01 月 06 日" → "2026 年 " + "01 月 06 日"
      // 注意：第一行結尾保留空格，確保渲染時 "年" 和數字之間有空格
      if (normalized.includes('年') && normalized.length > 8) {
        return normalized.replace(/年 /g, '年 \n');
      }
      
      // 如果沒有年份但日期較長（例如 "12 月 02 日"），保持原樣
      // 讓 CSS 自動處理換行
      return normalized;
    }
    
    // 建立按鈕
    displayEvents.forEach(function(event){
      const button = document.createElement('button');
      button.className = 'btn-date';
      
      // 使用格式化後的日期文字
      const formattedDate = formatDateForButton(event.date);
      
      // 如果包含換行符號，使用 innerHTML 來處理換行
      if (formattedDate.includes('\n')) {
        const lines = formattedDate.split('\n');
        // 在 span 之間插入不可斷空格 (&nbsp;)，確保 flexbox 中也能正確顯示空格
        button.innerHTML = lines.map(function(line){
          return '<span>' + line.trim() + '</span>';
        }).join('&nbsp;');
      } else {
        button.textContent = formattedDate;
      }
      
      // 根據 showButton 設定背景顏色
      if (event.showButton){
        button.style.background = '#199B7E';
        button.style.borderColor = '#50E3C2';
      } else {
        button.style.background = '#AEAEAE';
        button.style.borderColor = '#AEAEAE';
        button.style.cursor = 'default';
      }
      
      // 如果有連結，點擊時導向連結
      if (event.link && event.showButton){
        button.addEventListener('click', function(){
          window.open(event.link, '_blank', 'noopener,noreferrer');
          track('lunch_event_click', { 
            date: event.date, 
            link: event.link, 
            section: 'lunch-event' 
          });
        });
      } else {
        // 如果沒有連結或按鈕不顯示，禁用按鈕
        button.disabled = !event.showButton;
      }
      
      lunchEventDates.appendChild(button);
    });
  }
  
  // 啟動留言初始化
  initTestimonials();
  // 啟動時間軸初始化
  initTimeline();
  // 啟動午餐活動初始化
  initLunchEvents();
})();



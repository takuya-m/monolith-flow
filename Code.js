const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('App')
    .setTitle('Focus Cockpit Cloud')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * ■ Cloud Sync API
 */
function saveCloudState(stateJson) {
  PropertiesService.getUserProperties().setProperty('COCKPIT_STATE', stateJson);
  return "Synced";
}

function loadCloudState() {
  const json = PropertiesService.getUserProperties().getProperty('COCKPIT_STATE');
  return json ? json : null;
}

/**
 * ■ 履歴取得
 */
function getRecentTasks() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheets()[0];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  const tasks = values.map(r => String(r[0]).trim()).filter(t => t !== "");
  const uniqueTasks = [...new Set(tasks.reverse())].slice(15);
  return uniqueTasks;
}

/**
 * 認証用（初回のみ実行）
 */
function authorizeCheck() {
  const cal = CalendarApp.getDefaultCalendar();
  console.log("Calendar Auth OK: " + cal.getName());
}

/**
 * ■ ログ保存 & カレンダー登録（自動・手動共通）
 */
function logSessionChunk(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    let timelineSheet = ss.getSheetByName('Timeline');
    if (!timelineSheet) {
      timelineSheet = ss.insertSheet('Timeline');
      timelineSheet.appendRow(['Start Time', 'End Time', 'Duration (min)', 'Type', 'Task Name', 'Reason', 'Event ID']);
      timelineSheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#DDD');
    }

    const start = new Date(data.startTime);
    const end = new Date(data.endTime);
    const durationMin = (end.getTime() - start.getTime()) / 60000;
    
    if (isNaN(durationMin) || durationMin < 0) return "Invalid Time";

    // 2. Googleカレンダー登録
    const cal = CalendarApp.getDefaultCalendar();
    let title = "", colorId = "";

    if (data.type === 'Break') {
      // "Recovery"なら"休憩"、それ以外(Bio Break等)ならその名前を使う
      title = (data.taskName === 'Recovery') ? "休憩" : data.taskName;
      colorId = CalendarApp.EventColor.PALE_GREEN;
    } else {
      title = data.taskName;
      colorId = CalendarApp.EventColor.PALE_RED;
    }
    
    const event = cal.createEvent(title, start, end, { description: `Reason: ${data.reason}` });
    event.setColor(colorId);
    
    const eventId = event.getId();

    // 3. シートへ保存
    timelineSheet.appendRow([
      start, end, durationMin.toFixed(1),
      data.type, data.taskName, data.reason, eventId
    ]);

    return "Synced 📅";

  } catch (e) {
    return "Error: " + e.toString();
  }
}

/**
 * ■ 手動登録用ラッパー
 */
function manualLogSession(data) {
  try {
    const start = new Date(data.startTime);
    const end = new Date(data.endTime);
    const durationMs = end.getTime() - start.getTime();
    
    if (durationMs < 0) return "End time must be after Start time";

    const timelineData = { ...data, reason: 'Manual Entry' };
    logSessionChunk(timelineData);

    const logData = {
      taskName: data.taskName,
      workMs: (data.type === 'Task') ? durationMs : 0,
      breakMs: (data.type === 'Break') ? durationMs : 0,
      predicted: data.predicted || 0, 
      isDeepWork: data.isDeepWork || false,
      status: data.status || 'Done',
      switchCount: 0,
      interruptionReasons: ['Manual'],
      memo: data.memo || ''
    };
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheets()[0];
    
    const workMin = (logData.workMs / 60000).toFixed(1);
    const breakMin = (logData.breakMs / 60000).toFixed(1);
    
    let gap = '-';
    if (logData.predicted > 0 && logData.workMs > 0) {
      gap = ((workMin - logData.predicted) / logData.predicted * 100).toFixed(1) + '%';
    }
    
    const rowData = [
      start, 
      String(logData.taskName),
      workMin,
      breakMin,
      logData.predicted,
      gap,
      logData.isDeepWork ? '🔥 Deep' : 'Shallow',
      logData.status,
      logData.switchCount,
      logData.interruptionReasons.join(', '),
      logData.memo
    ];
    
    sheet.appendRow(rowData);

    return "Manual Entry Saved 📝";

  } catch (e) {
    return "Error: " + e.toString();
  }
}

// 完了ログ（集計用）
function saveLog(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheets()[0];
    const now = new Date();
    const workMin = (data.workMs / 1000 / 60).toFixed(1);
    const breakMin = (data.breakMs / 1000 / 60).toFixed(1);
    
    let gap = '-';
    if (data.predicted > 0) {
      gap = ((workMin - data.predicted) / data.predicted * 100).toFixed(1) + '%';
    }
    
    const rowData = [
      now, String(data.taskName), workMin, breakMin, data.predicted, gap,
      data.isDeepWork ? '🔥 Deep' : 'Shallow', data.status,
      data.switchCount, data.interruptionReasons.join(', '), data.memo
    ];
    sheet.appendRow(rowData);
    return "OK";
  } catch (e) {
    return "Error: " + e.toString();
  }
}

// フィードバック保存
function saveFeedback(comment) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName('Feedback');
    if (!sheet) {
      sheet = ss.insertSheet('Feedback');
      sheet.appendRow(['Date', 'Comment']);
    }
    sheet.appendRow([new Date(), comment]);
    return "Feedback Sent!";
  } catch (e) {
    return "Error: " + e.toString();
  }
}

/**
 * ■ 履歴データの取得 (編集画面用)
 */
function getLogHistoryData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Timeline');
  if (!sheet) return [];
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return []; 
  
  const startRow = Math.max(2, lastRow - 19);
  const numRows = lastRow - startRow + 1;
  const values = sheet.getRange(startRow, 1, numRows, 7).getValues();
  
  const logs = values.map((row, index) => {
    return {
      rowIndex: startRow + index,
      startTime: new Date(row[0]).getTime(),
      endTime: new Date(row[1]).getTime(),
      duration: row[2],
      type: row[3],
      taskName: row[4],
      reason: row[5],
      eventId: row[6]
    };
  }).reverse();
  
  return logs;
}

/**
 * ■ ログの削除 (カレンダー連動 & Mainシート連動)
 */
function deleteSessionLog(rowIndex, eventId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const timelineSheet = ss.getSheetByName('Timeline');
    const mainSheet = ss.getSheets()[0]; 
    
    const targetRange = timelineSheet.getRange(rowIndex, 1, 1, 6);
    const values = targetRange.getValues()[0];
    const targetEndTime = new Date(values[1]); 
    const targetTaskName = String(values[4]);
    
    // Calendar Delete
    if (eventId) {
      try {
        const cal = CalendarApp.getDefaultCalendar();
        const event = cal.getEventById(eventId);
        if (event) { event.deleteEvent(); }
      } catch (e) { console.warn("Calendar delete failed: " + e); }
    }
    
    // Main Sheet Delete
    const mainLastRow = mainSheet.getLastRow();
    if (mainLastRow > 1) {
      const mainData = mainSheet.getRange(2, 1, mainLastRow - 1, 2).getValues();
      for (let i = mainData.length - 1; i >= 0; i--) {
        const rowDate = new Date(mainData[i][0]);
        const rowTask = String(mainData[i][1]);
        const diff = Math.abs(rowDate.getTime() - targetEndTime.getTime());
        if (rowTask === targetTaskName && diff < 5000) {
          mainSheet.deleteRow(i + 2);
          break; 
        }
      }
    }

    // Timeline Delete
    timelineSheet.deleteRow(rowIndex);
    
    return "Deleted from All Sheets & Calendar 🗑️";
  } catch (e) {
    return "Error: " + e.toString();
  }
}

/**
 * ■ ログの編集 (カレンダー連動)
 */
function updateSessionLog(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Timeline');
    const rowIndex = data.rowIndex;
    
    const start = new Date(data.startTime);
    const end = new Date(data.endTime);
    const durationMin = ((end.getTime() - start.getTime()) / 60000).toFixed(1);
    
    // 1. カレンダー更新
    if (data.eventId) {
      try {
        const cal = CalendarApp.getDefaultCalendar();
        const event = cal.getEventById(data.eventId);
        if (event) {
          // タイトル更新ロジック
          let title = "";
          if (data.type === 'Break') {
            title = (data.taskName === 'Recovery') ? "休憩" : data.taskName;
            event.setColor(CalendarApp.EventColor.PALE_GREEN);
          } else {
            title = data.taskName;
            event.setColor(CalendarApp.EventColor.PALE_RED);
          }
          event.setTitle(title);
          event.setTime(start, end);
        }
      } catch (e) {
        console.warn("Calendar update failed: " + e);
      }
    }
    
    // 2. シート更新
    const range = sheet.getRange(rowIndex, 1, 1, 6);
    range.setValues([[
      start, end, durationMin, data.type, data.taskName, data.reason
    ]]);
    
    return "Updated & Synced 🔄";
  } catch (e) {
    return "Error: " + e.toString();
  }
}
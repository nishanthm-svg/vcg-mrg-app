// ============================================================
//  VCG/MRG Identification - Google Apps Script Backend
//  Deploy this as a Web App in Google Apps Script
//  Instructions: see setup-guide.html
// ============================================================

const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE'; // Replace after creating sheet

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'ping') return jsonResponse({ status: 'ok', message: 'VCG-MRG API running' });
  // Handle submit via GET (avoids CORS preflight)
  if (action === 'submit' && e.parameter.data) {
    try {
      const data = JSON.parse(e.parameter.data);
      return submitIdentification(data);
    } catch(err) {
      return jsonResponse({ status: 'error', message: err.toString() });
    }
  }
  if (action === 'delete' && e.parameter.unkey) return deleteIdentification(e.parameter.unkey);
  if (action === 'getSubmissions') return getSubmissions(e);
  if (action === 'getProgress') return getProgress(e);
  return jsonResponse({ status: 'ok' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === 'submit') return submitIdentification(body.data);
    if (action === 'delete') return deleteIdentification(body.unkey);
    return jsonResponse({ status: 'error', message: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function submitIdentification(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('Identifications');

  // Create sheet if not exists
  if (!sheet) {
    sheet = ss.insertSheet('Identifications');
    const headers = [
      'Unkey', 'Executive', 'BMCU Name', 'MPP Code', 'MPP Name', 'Member Code',
      'Member Name', 'ACO Name', 'Plant Code', 'Type (VCG/MRG)',
      'Total Days', 'Total Qty (L)', 'Last FY VCG/MRG', 'Remarks',
      'Submitted At', 'Synced'
    ];
    sheet.appendRow(headers);
    // Format header row
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#1a237e');
    headerRange.setFontColor('white');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  // Check if record already exists (upsert by unkey)
  const unkey = String(data.unkey);
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  let existingRow = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === unkey) { existingRow = i + 1; break; }
  }

  const row = [
    unkey, data.executive, data.bmcuName || '', data.mppCode, data.mppName,
    data.memberCode, data.memberName, data.acoName, data.plantCode,
    data.type, data.totalDays, data.totalQty, data.lastFYVCGMRG || '',
    data.remarks || '', data.submittedAt, 'Yes'
  ];

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
    // Color code by type
    const lastRow = sheet.getLastRow();
    const typeCell = sheet.getRange(lastRow, 9);
    if (data.type === 'VCG') {
      typeCell.setBackground('#f3e5f5');
    } else if (data.type === 'MRG') {
      typeCell.setBackground('#e0f2f1');
    }
  }

  // Update Progress Sheet
  updateProgressSheet(ss, data);

  return jsonResponse({ status: 'ok', message: 'Saved successfully' });
}

function deleteIdentification(unkey) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Identifications');
  if (!sheet) return jsonResponse({ status: 'ok' });

  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(unkey)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return jsonResponse({ status: 'ok', message: 'Deleted' });
}

function updateProgressSheet(ss, data) {
  let progSheet = ss.getSheetByName('Progress');
  if (!progSheet) {
    progSheet = ss.insertSheet('Progress');
    progSheet.appendRow(['Executive', 'MPPs Completed', 'VCG Count', 'MRG Count', 'Total Identified', 'Last Updated']);
    const hr = progSheet.getRange(1, 1, 1, 6);
    hr.setBackground('#1a237e'); hr.setFontColor('white'); hr.setFontWeight('bold');
    progSheet.setFrozenRows(1);
  }

  const identSheet = ss.getSheetByName('Identifications');
  if (!identSheet) return;
  const allData = identSheet.getDataRange().getValues().slice(1); // skip header

  // Aggregate by executive
  const execMap = {};
  allData.forEach(row => {
    const exec = row[1], mpp = row[2], type = row[8];
    if (!execMap[exec]) execMap[exec] = { mpps: new Set(), vcg: 0, mrg: 0 };
    execMap[exec].mpps.add(mpp);
    if (type === 'VCG') execMap[exec].vcg++;
    if (type === 'MRG') execMap[exec].mrg++;
  });

  // Clear and rewrite progress
  const lastRow = progSheet.getLastRow();
  if (lastRow > 1) progSheet.getRange(2, 1, lastRow - 1, 6).clearContent();

  const rows = Object.entries(execMap).map(([exec, d]) => [
    exec, d.mpps.size, d.vcg, d.mrg, d.vcg + d.mrg,
    new Date().toLocaleString('en-IN')
  ]);
  if (rows.length) progSheet.getRange(2, 1, rows.length, 6).setValues(rows);
}

function getSubmissions(e) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Identifications');
  if (!sheet) return jsonResponse({ submissions: [] });

  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const submissions = values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });

  const exec = e.parameter.executive;
  const filtered = exec ? submissions.filter(s => s['Executive'] === exec) : submissions;
  return jsonResponse({ submissions: filtered });
}

function getProgress(e) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Progress');
  if (!sheet) return jsonResponse({ progress: [] });

  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const progress = values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
  return jsonResponse({ progress });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// FILE: Code.gs (Versi REST API Final Lengkap dengan Services)
// TUJUAN: Sebagai penerima request API dan pengelola Database Sheets
// FITUR: ENTERPRISE CONCURRENCY LOCK, DYNAMIC EMAIL ROUTING, PIC DYNAMICS & TOKEN SECURITY
// ==========================================

const CONFIG = {
  // WAJIB GANTI DENGAN ID SPREADSHEET ANDA
  SHEET_ID: "1NX639o-fzydH-x94AEV8-ukwrBeS31ml5QsUGFueCdg"
};

// ==========================================
// 🔴 WAJIB JALANKAN FUNGSI INI 1X DI EDITOR GOOGLE SCRIPT 
// UNTUK MENGAKTIFKAN IZIN PENGIRIMAN EMAIL OTOMATIS
// ==========================================
function SETUP_EMAIL_WAJIB_JALANKAN() {
  const emailAdmin = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: emailAdmin,
    subject: "✅ [SUKSES] Sistem Notifikasi Email Stok Gudang Aktif",
    htmlBody: "<h3>Sistem Email Enterprise Telah Aktif!</h3><p>Sistem ini sekarang dilindungi oleh Token Cache Service dan Dynamic Database Email.</p>"
  });
  Logger.log("CEK EMAIL ANDA. JIKA MASUK, SISTEM ENTERPRISE SUDAH AKTIF.");
}

// ==========================================
// 1. ROUTER & SECURITY MIDDLEWARE
// ==========================================

function doPost(e) {
  let result = { success: false, error: "Invalid action." };
  
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("No payload received.");
    }
    
    const params = JSON.parse(e.postData.contents);
    const action = params.action;
    const payload = params.payload || {};
    const token = params.token; 

    // 🛡️ ENTERPRISE SECURITY: VALIDASI TOKEN
    let sessionUser = null;
    if (action !== 'authenticateUser') {
      if (!token) return ContentService.createTextOutput(JSON.stringify({ success: false, error: "SESSION_EXPIRED", message: "Akses Ditolak: Token keamanan tidak ditemukan." })).setMimeType(ContentService.MimeType.JSON);
      
      const cachedSessionStr = CacheService.getScriptCache().get(token);
      if (!cachedSessionStr) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: "SESSION_EXPIRED", message: "Sesi Habis: Silakan login kembali untuk keamanan." })).setMimeType(ContentService.MimeType.JSON);
      }
      
      sessionUser = JSON.parse(cachedSessionStr);
      CacheService.getScriptCache().put(token, cachedSessionStr, 28800); // Perpanjang 8 Jam
    }

    switch (action) {
      case 'authenticateUser': result = authenticateUser(payload.username, payload.password); break;
      case 'getInitialData': result = getInitialData(); break;
      
      case 'changePassword': result = changePassword(payload, sessionUser); break;
      case 'saveSettings': result = saveSettings(payload, sessionUser); break;

      case 'submitOpnameUpdate': result = submitOpnameUpdate(payload); break;
      case 'saveMasterItem': result = saveMasterItem(payload.itemData, payload.isEditing); break;
      case 'deleteMasterItem': result = deleteMasterItemsBulk([payload.barcode]); break;
      case 'deleteMasterItemsBulk': result = deleteMasterItemsBulk(payload.barcodes); break;
      
      case 'deleteHistoryItem': result = deleteHistoryItemsBulk([payload.id], payload.revertData ? [payload.revertData] : null); break;
      case 'deleteHistoryItemsBulk': result = deleteHistoryItemsBulk(payload.ids, payload.revertDatas); break;
      case 'deleteRecapOpname': result = deleteRecapsBulk(payload.dateStr, [payload.barcode], payload.revertData ? [payload.revertData] : null); break;
      case 'deleteRecapsBulk': result = deleteRecapsBulk(payload.dateStr, payload.barcodes, payload.revertDatas); break;
      
      case 'importMasterDataBulk': result = importMasterDataBulk(payload.dataArray, sessionUser); break;
      case 'importHistoryDataBulk': result = importHistoryDataBulk(payload.dataArray, sessionUser); break;
      
      default: result = { success: false, error: "Action API tidak ditemukan." };
    }
  } catch (err) {
    result = { success: false, error: "Server Error: " + err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({status: "API Active. Enterprise Security & Token System Loaded."})).setMimeType(ContentService.MimeType.JSON);
}

function sanitize_(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

// ==========================================
// 2. SERVICES (BUSINESS LOGIC)
// ==========================================

function getSheet_(sheetName) {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(sheetName);
}

function sheetDataToObjectArray_(sheetName) {
  const sheet = getSheet_(sheetName);
  if (!sheet) throw new Error("Sheet " + sheetName + " not found.");
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; 
  
  const headers = data[0];
  const rows = data.slice(1);
  
  return rows.map(row => {
    let obj = {};
    headers.forEach((header, index) => { obj[header] = typeof row[index] === 'string' ? sanitize_(row[index]) : row[index]; });
    return obj;
  });
}

function authenticateUser(username, password) {
  Utilities.sleep(500); 
  const data = getSheet_("Users").getDataRange().getValues();
  const safeUsername = sanitize_(username);
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(safeUsername) && String(data[i][1]) === String(password)) {
      
      const userData = { username: data[i][0], role: data[i][2], location: data[i][3] };
      const token = Utilities.getUuid(); 
      CacheService.getScriptCache().put(token, JSON.stringify(userData), 28800); 

      return { success: true, data: userData, token: token };
    }
  }
  return { success: false, error: "Username atau password salah!" };
}

function getInitialData() {
  try {
    return { 
      success: true, 
      data: { 
        inventory: sheetDataToObjectArray_("MasterData"), 
        transactions: sheetDataToObjectArray_("LogHistory"),
        settings: sheetDataToObjectArray_("Settings") 
      } 
    };
  } catch(e) { return { success: false, error: e.message }; }
}

function changePassword(payload, sessionUser) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { success: false, error: "Sistem Sibuk." }; }
  
  try {
    if (sessionUser.username !== payload.username) throw new Error("Otorisasi Gagal: Anda tidak dapat mengubah password pengguna lain.");

    const sheet = getSheet_("Users");
    const data = sheet.getDataRange().getValues();
    let found = false;

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === payload.username) {
        if (String(data[i][1]) !== String(payload.oldPassword)) throw new Error("Password Lama Salah!");
        sheet.getRange(i+1, 2).setValue(payload.newPassword);
        found = true;
        break;
      }
    }
    
    if(!found) throw new Error("Pengguna tidak ditemukan di Database.");
    return { success: true, data: "Password berhasil diubah. Sesi tetap aktif." };
  } catch(e) { return { success: false, error: e.message }; } finally { lock.releaseLock(); }
}

// 🔥 ENTERPRISE: DYNAMIC PIC ALLOCATION & EMAIL
function saveSettings(payload, sessionUser) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { success: false, error: "Sistem Sibuk." }; }
  
  try {
    if (sessionUser.role !== 'Super Admin') throw new Error("Akses Ditolak: Hanya Super Admin.");

    const sheet = getSheet_("Settings");
    sheet.clearContents();
    
    // UPDATE STRUKTUR: Tambah PICList di Header
    sheet.appendRow(["Location", "EmailPIC", "PICList"]);
    if (payload.settingsData && payload.settingsData.length > 0) {
      const rows = payload.settingsData.map(set => [
        sanitize_(set.Location.toUpperCase()), 
        sanitize_(set.EmailPIC), 
        sanitize_(set.PICList || "")
      ]);
      sheet.getRange(2, 1, rows.length, 3).setValues(rows);
    }
    
    return { success: true, data: "Konfigurasi Gudang & Daftar PIC berhasil diperbarui." };
  } catch(e) { return { success: false, error: e.message }; } finally { lock.releaseLock(); }
}

function submitOpnameUpdate(payload) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { success: false, error: "Sistem Sibuk (Ada user lain sedang input). Coba lagi dalam 3 detik." }; }
  
  try {
    const mSheet = getSheet_("MasterData");
    const lSheet = getSheet_("LogHistory");
    
    const mData = mSheet.getDataRange().getValues();
    let found = false;
    let minQty = 0;

    for(let i = 1; i < mData.length; i++) {
      if(mData[i][0] == payload.barcode) {
        minQty = mData[i][4]; 
        mSheet.getRange(i+1, 4).setValue(payload.newQty);
        mSheet.getRange(i+1, 8).setValue(new Date().toISOString());
        found = true; 
        break;
      }
    }
    if(!found) throw new Error("Barang tidak ditemukan.");
    
    lSheet.appendRow([
      sanitize_(payload.id), payload.date, sanitize_(payload.user), sanitize_(payload.barcode), 
      sanitize_(payload.name), payload.oldQty, payload.newQty, payload.variance, sanitize_(payload.location), sanitize_(payload.pic)
    ]);

    if (payload.newQty <= minQty) {
      const settings = sheetDataToObjectArray_("Settings");
      sendLowStockEmailAlert_(payload.name, payload.barcode, payload.location, payload.newQty, minQty, payload.pic, payload.user, settings);
    }
    
    return { success: true, data: "Data Opname Tersimpan." };
  } catch (err) { return { success: false, error: err.message }; } finally { lock.releaseLock(); }
}

function sendLowStockEmailAlert_(itemName, barcode, location, newQty, minQty, pic, user, settings) {
  try {
    const locKey = String(location).toUpperCase().trim();
    let targetEmail = Session.getEffectiveUser().getEmail(); 
    
    const settingMatch = settings.find(s => String(s.Location).toUpperCase() === locKey);
    if (settingMatch && settingMatch.EmailPIC) targetEmail = settingMatch.EmailPIC;

    const subject = `⚠️ PERINGATAN REORDER: Stok Menipis - ${itemName} (${newQty})`;
    const body = `<div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;"><div style="background-color: #ef4444; color: white; padding: 20px; text-align: center;"><h2 style="margin: 0; font-size: 20px;">🚨 Peringatan Stok Rendah (Reorder) 🚨</h2></div><div style="padding: 20px; color: #334155; background-color: #f8fafc;"><p>Yth. <b>Tim Gudang ${location}</b>,</p><p>Sistem mendeteksi bahwa stok fisik barang di bawah ini telah mencapai batas minimum. <b>Harap segera lakukan pemesanan ulang (Reorder).</b></p><table style="width: 100%; border-collapse: collapse; margin-top: 15px; background: white; border-radius: 8px;"><tr><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; width: 40%;"><b>Nama Barang</b></td><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; font-weight: bold; color: #0f172a;">${itemName}</td></tr><tr><td style="padding: 12px; border-bottom: 1px solid #f1f5f9;"><b>Barcode ID</b></td><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; font-family: monospace;">${barcode}</td></tr><tr><td style="padding: 12px; border-bottom: 1px solid #f1f5f9;"><b>Lokasi Gudang</b></td><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; color: #0284c7; font-weight: bold;">${location}</td></tr><tr><td style="padding: 12px; border-bottom: 1px solid #f1f5f9;"><b>Sisa Stok Aktual</b></td><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; color: #ef4444; font-size: 20px; font-weight: 900;">${newQty}</td></tr><tr><td style="padding: 12px; border-bottom: 1px solid #f1f5f9;"><b>Batas Minimum Sistem</b></td><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; font-weight: bold;">${minQty}</td></tr><tr><td style="padding: 12px; border-bottom: 1px solid #f1f5f9;"><b>Petugas Opname</b></td><td style="padding: 12px; border-bottom: 1px solid #f1f5f9;">${pic} (Sistem: ${user})</td></tr><tr><td style="padding: 12px;"><b>Waktu Deteksi</b></td><td style="padding: 12px;">${new Date().toLocaleString('id-ID')}</td></tr></table><div style="margin-top: 25px; padding: 15px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; text-align: center; color: #b45309; font-size: 14px;"><b>Penting:</b> Email ini dikirim otomatis berdasarkan pengaturan Master Config di Aplikasi.</div></div></div>`;
    MailApp.sendEmail({ to: targetEmail, subject: subject, htmlBody: body });
  } catch (error) { console.error("Error email: " + error.message); }
}

function saveMasterItem(item, isEditing) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { success: false, error: "Sistem Sibuk." }; }
  try {
    const sheet = getSheet_("MasterData");
    const updateDate = new Date().toISOString();
    if (isEditing) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] == item.barcode) {
          sheet.getRange(i+1, 1, 1, 8).setValues([[
            sanitize_(item.barcode), sanitize_(item.name), sanitize_(item.category), item.qty, 
            item.minQty, sanitize_(item.unit), sanitize_(item.location), updateDate
          ]]);
          return { success: true, data: "Barang berhasil diupdate." };
        }
      }
      return { success: false, error: "Barang tidak ditemukan." };
    } else {
      sheet.appendRow([ sanitize_(item.barcode), sanitize_(item.name), sanitize_(item.category), item.qty, item.minQty, sanitize_(item.unit), sanitize_(item.location), updateDate ]);
      return { success: true, data: "Barang baru ditambahkan." };
    }
  } finally { lock.releaseLock(); }
}

// 3. BULK OPERATIONS
function importMasterDataBulk(dataArray, sessionUser) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return { success: false, error: "Sistem Sibuk." }; }
  try {
    if (sessionUser.role !== 'Super Admin') throw new Error("Akses Ditolak: Hanya Admin.");
    if (!dataArray || dataArray.length === 0) return { success: false, error: "Data kosong" };
    const sheet = getSheet_("MasterData");
    const headers = sheet.getRange(1, 1, 1, 8).getValues()[0];
    sheet.clearContents(); sheet.appendRow(headers);
    const rows = dataArray.map(item => [ sanitize_(item.barcode), sanitize_(item.name), sanitize_(item.category), item.qty, item.minQty, sanitize_(item.unit), sanitize_(item.location), new Date().toISOString() ]);
    sheet.getRange(2, 1, rows.length, 8).setValues(rows);
    return { success: true, data: "Import Master Data berhasil ditimpa." };
  } finally { lock.releaseLock(); }
}

function importHistoryDataBulk(dataArray, sessionUser) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return { success: false, error: "Sistem Sibuk." }; }
  try {
    if (sessionUser.role !== 'Super Admin') throw new Error("Akses Ditolak: Hanya Admin.");
    if (!dataArray || dataArray.length === 0) return { success: false, error: "Data kosong" };
    const sheet = getSheet_("LogHistory");
    const headers = sheet.getRange(1, 1, 1, 10).getValues()[0]; 
    sheet.clearContents(); sheet.appendRow(headers);
    const rows = dataArray.map(item => [ sanitize_(item.id), item.date, sanitize_(item.user), sanitize_(item.barcode), sanitize_(item.name), item.oldQty, item.newQty, item.variance, sanitize_(item.location), sanitize_(item.pic) ]);
    sheet.getRange(2, 1, rows.length, 10).setValues(rows);
    return { success: true, data: "Import History berhasil ditimpa." };
  } finally { lock.releaseLock(); }
}

function applyRevertDatas_(revertDatas) {
  if (!revertDatas || revertDatas.length === 0) return;
  const mSheet = getSheet_("MasterData");
  const mData = mSheet.getDataRange().getValues();
  let isChanged = false;
  revertDatas.forEach(rev => {
    for(let i=1; i<mData.length; i++) {
      if(mData[i][0] == rev.barcode) {
        mData[i][3] = rev.revertToQty; mData[i][7] = new Date().toISOString();
        isChanged = true; break;
      }
    }
  });
  if (isChanged) mSheet.getRange(1, 1, mData.length, mData[0].length).setValues(mData);
}

function deleteMasterItemsBulk(barcodes) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { success: false, error: "Sistem Sibuk." }; }
  try {
    const sheet = getSheet_("MasterData"); const data = sheet.getDataRange().getValues(); const headers = data[0];
    const newData = data.slice(1).filter(row => !barcodes.includes(row[0]));
    sheet.clearContents();
    if (newData.length > 0) sheet.getRange(1, 1, newData.length + 1, headers.length).setValues([headers, ...newData]); else sheet.appendRow(headers);
    return { success: true, data: "Barang terpilih berhasil dihapus." };
  } finally { lock.releaseLock(); }
}

function deleteHistoryItemsBulk(ids, revertDatas) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { success: false, error: "Sistem Sibuk." }; }
  try {
    const sheet = getSheet_("LogHistory"); const data = sheet.getDataRange().getValues(); const headers = data[0];
    const newData = data.slice(1).filter(row => !ids.includes(row[0]));
    sheet.clearContents();
    if (newData.length > 0) sheet.getRange(1, 1, newData.length + 1, headers.length).setValues([headers, ...newData]); else sheet.appendRow(headers);
    if (revertDatas && revertDatas.length > 0) applyRevertDatas_(revertDatas);
    return { success: true, data: "Log terpilih berhasil dihapus." };
  } finally { lock.releaseLock(); }
}

function deleteRecapsBulk(dateStr, barcodes, revertDatas) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { success: false, error: "Sistem Sibuk." }; }
  try {
    const sheet = getSheet_("LogHistory"); const data = sheet.getDataRange().getValues(); const headers = data[0];
    const dateTarget = String(dateStr).substring(0, 10);
    const newData = data.slice(1).filter(row => {
      return !(String(row[1]).substring(0, 10).startsWith(dateTarget) && barcodes.includes(row[3]));
    });
    sheet.clearContents();
    if (newData.length > 0) sheet.getRange(1, 1, newData.length + 1, headers.length).setValues([headers, ...newData]); else sheet.appendRow(headers);
    if (revertDatas && revertDatas.length > 0) applyRevertDatas_(revertDatas);
    return { success: true, data: "Data rekap harian dihapus." };
  } finally { lock.releaseLock(); }
}

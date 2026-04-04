function runInstaller() {
  const ssName = "DB_CIP_MultiUser_" + new Date().toISOString().slice(0,10);
  const ss = SpreadsheetApp.create(ssName);
  
  // 1. Setup Sheet: MasterData
  const masterSheet = ss.getActiveSheet();
  masterSheet.setName("MasterData");
  masterSheet.appendRow(["barcode", "name", "category", "qty", "minQty", "unit", "location", "lastUpdate"]);
  masterSheet.getRange("A1:H1").setFontWeight("bold").setBackground("#e2e8f0");
  masterSheet.setFrozenRows(1);

  // 2. Setup Sheet: LogHistory
  const logSheet = ss.insertSheet("LogHistory");
  logSheet.appendRow(["id", "date", "user", "barcode", "name", "oldQty", "newQty", "variance", "location"]);
  logSheet.getRange("A1:I1").setFontWeight("bold").setBackground("#e2e8f0");
  logSheet.setFrozenRows(1);

  // 3. Setup Sheet: Users
  const userSheet = ss.insertSheet("Users");
  userSheet.appendRow(["username", "password", "role", "location"]);
  userSheet.getRange("A1:D1").setFontWeight("bold").setBackground("#e2e8f0");
  userSheet.setFrozenRows(1);
  
  // Default Users
  userSheet.appendRow(["admin", "admin", "Super Admin", "ALL"]);
  userSheet.appendRow(["storeroom", "123", "Staff Gudang", "Store Room"]);
  userSheet.appendRow(["cipstore", "123", "Staff Gudang", "CIP Store"]);

  Logger.log("=========================================");
  Logger.log("INSTALLASI SELESAI!");
  Logger.log("SILAKAN COPY ID SPREADSHEET DI BAWAH INI:");
  Logger.log(ss.getId());
  Logger.log("=========================================");
}

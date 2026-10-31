// Kino Sync Drive: el "servidor" de sincronizacion para el plugin de Kino "sync-drive".
// Guarda la copia cifrada de Kino (kino-sync-blob.txt) en la carpeta "Kino Sync Drive" de tu Google Drive.
//
//   GET  ?action=status&token=...               -> {ok:true, empty:true|false}
//   GET  ?action=pull&token=...                 -> {ok:true, blob:"...", version:"..."} (blob null si no hay nada)
//   POST {token, action:"push", blob, expected} -> {ok:true, version} | {ok:false, conflict:true, version}
//
// PRIMERA VEZ: ejecuta setup() (arriba, menu de funciones + boton Ejecutar), autoriza y copia el
// token que aparece en el Registro de ejecucion. Despues: Implementar > Nueva implementacion >
// Aplicacion web, con "Ejecutar como: Yo" y "Quien tiene acceso: Cualquier persona".
//
// VELOCIDAD: los IDs de la carpeta y del archivo se guardan la primera vez (buscar por nombre en
// Drive es lento; DriveApp.getFolderById/getFileById es casi instantaneo) y la copia se sirve
// ademas desde la cache del script, asi la mayoria de las lecturas no tocan Drive.

var FOLDER_NAME = "Kino Sync Drive";
var BLOB_FILE = "kino-sync-blob.txt";
var MAX_BLOB_CHARS = 8 * 1024 * 1024; // un poco mas que los 4 MB de Kino, que viajan como base64
var CACHE_KEY = "pullcache";
var CACHE_MAX = 90000; // la cache guarda valores de hasta 100 KB; dejamos margen

var props_ = function () { return PropertiesService.getScriptProperties(); };

function setup() {
  var tk = props_().getProperty("TOKEN");
  if (!tk) {
    tk = Utilities.getUuid().split("-").join("") + Utilities.getUuid().split("-").join("");
    props_().setProperty("TOKEN", tk);
  }
  folder_(); // crea la carpeta y guarda su ID
  Logger.log("TOKEN para el plugin de Kino (copialo completo):");
  Logger.log(tk);
  Logger.log("Ahora: Implementar > Nueva implementacion > Aplicacion web.");
  Logger.log("Ejecutar como: Yo. Quien tiene acceso: Cualquier persona (incluidos los anonimos).");
  Logger.log("Copia la URL del Web App (termina en /exec): es la 'Direccion del Web App' del plugin de Kino.");
}

// ---- la API ----

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (!checkToken_(p.token)) return json_({ ok: false, error: "token" });
    if (p.action === "status") {
      var v = currentVersion_();
      return json_({ ok: true, empty: v === null });
    }
    if (p.action === "pull") {
      var cached = cache_();
      if (cached) return json_({ ok: true, blob: cached.blob, version: cached.version });
      var v2 = currentVersion_();
      if (v2 === null) return json_({ ok: true, blob: null, version: "0" });
      var blob = readBlob_();
      if (blob === null) return json_({ ok: true, blob: null, version: "0" });
      return json_({ ok: true, blob: blob, version: v2 });
    }
    return json_({ ok: false, error: "action" });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000); // serializa las escrituras: la version que se revisa y la que se guarda no cambian a la vez
  try {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (err) { return json_({ ok: false, error: "body" }); }
    // el token y el action llegan en el cuerpo JSON y ademas en la URL (?token=...&action=...): valen cualquiera de los dos
    var given = body.token || (e && e.parameter && e.parameter.token);
    if (!checkToken_(given)) return json_({ ok: false, error: "token" });
    var act = body.action || (e && e.parameter && e.parameter.action);
    if (act !== "push") return json_({ ok: false, error: "action" });
    var blob = String(body.blob || "");
    if (!blob) return json_({ ok: false, error: "blob" });
    if (blob.length > MAX_BLOB_CHARS) return json_({ ok: false, error: "too_large" });
    var expected = body.expected == null || body.expected === "" ? "0" : String(body.expected);
    var current = currentVersion_();
    var cur = current === null ? "0" : current;
    if (expected !== cur) return json_({ ok: false, conflict: true, version: cur });
    var counter = Number(props_().getProperty("COUNTER") || "0") + 1;
    var version = counter + "." + Utilities.getUuid().split("-").join("").slice(0, 8);
    writeBlob_(blob);
    props_().setProperty("COUNTER", String(counter));
    props_().setProperty("VERSION", version);
    // mantiene la cache al dia: el siguiente pull no toca Drive
    if (blob.length <= CACHE_MAX) {
      try { CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify({ blob: blob, version: version }), 21600); } catch (err) { /* la cache es opcional */ }
    } else {
      try { CacheService.getScriptCache().remove(CACHE_KEY); } catch (err) { /* la cache es opcional */ }
    }
    return json_({ ok: true, version: version });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---- almacen ----

function checkToken_(given) {
  var tk = props_().getProperty("TOKEN");
  return !!tk && String(given || "") === tk;
}

function currentVersion_() {
  var v = props_().getProperty("VERSION");
  return v || null;
}

/** La copia cacheada {blob, version}, o null. */
function cache_() {
  try {
    var s = CacheService.getScriptCache().get(CACHE_KEY);
    return s ? JSON.parse(s) : null;
  } catch (err) {
    return null;
  }
}

/** La carpeta por ID (rapido); la primera vez la busca por nombre y guarda el ID. */
function folder_() {
  var id = props_().getProperty("FOLDER_ID");
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { /* la carpeta se movio o borro: volver a buscar */ }
  }
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  var f = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  props_().setProperty("FOLDER_ID", f.getId());
  return f;
}

/** El archivo por ID (rapido); la primera vez lo busca por nombre y guarda el ID. */
function file_() {
  var id = props_().getProperty("FILE_ID");
  if (id) {
    try { return DriveApp.getFileById(id); } catch (err) { /* el archivo se movio o borro: volver a buscar */ }
  }
  var it = folder_().getFilesByName(BLOB_FILE);
  if (it.hasNext()) {
    var f = it.next();
    props_().setProperty("FILE_ID", f.getId());
    return f;
  }
  return null;
}

function readBlob_() {
  var f = file_();
  return f ? f.getBlob().getDataAsString() : null;
}

function writeBlob_(text) {
  var f = file_();
  if (f) { f.setContent(text); return; }
  f = folder_().createFile(BLOB_FILE, text, "text/plain");
  props_().setProperty("FILE_ID", f.getId());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

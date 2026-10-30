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

var FOLDER_NAME = "Kino Sync Drive";
var BLOB_FILE = "kino-sync-blob.txt";
var MAX_BLOB_CHARS = 8 * 1024 * 1024; // un poco mas que los 4 MB de Kino, que viajan como base64

function setup() {
  var props = PropertiesService.getScriptProperties();
  var tk = props.getProperty("TOKEN");
  if (!tk) {
    tk = Utilities.getUuid().split("-").join("") + Utilities.getUuid().split("-").join("");
    props.setProperty("TOKEN", tk);
  }
  folder_(); // crea ya la carpeta "Kino Sync Drive" en tu Drive
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
      var v2 = currentVersion_();
      var blob = readBlob_();
      if (v2 === null || blob === null) return json_({ ok: true, blob: null, version: "0" });
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
    // el token llega en el cuerpo JSON y ademas en la URL (?token=...): vale cualquiera de los dos
    var given = body.token || (e && e.parameter && e.parameter.token);
    if (!checkToken_(given)) return json_({ ok: false, error: "token" });
    if (body.action !== "push") return json_({ ok: false, error: "action" });
    var blob = String(body.blob || "");
    if (!blob) return json_({ ok: false, error: "blob" });
    if (blob.length > MAX_BLOB_CHARS) return json_({ ok: false, error: "too_large" });
    var expected = body.expected == null || body.expected === "" ? "0" : String(body.expected);
    var current = currentVersion_();
    var cur = current === null ? "0" : current;
    if (expected !== cur) return json_({ ok: false, conflict: true, version: cur });
    var props = PropertiesService.getScriptProperties();
    var counter = Number(props.getProperty("COUNTER") || "0") + 1;
    var version = counter + "." + Utilities.getUuid().split("-").join("").slice(0, 8);
    writeBlob_(blob);
    props.setProperty("COUNTER", String(counter));
    props.setProperty("VERSION", version);
    return json_({ ok: true, version: version });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---- almacen ----

function checkToken_(given) {
  var tk = PropertiesService.getScriptProperties().getProperty("TOKEN");
  return !!tk && String(given || "") === tk;
}

function currentVersion_() {
  var v = PropertiesService.getScriptProperties().getProperty("VERSION");
  return v || null;
}

function folder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function readBlob_() {
  var it = folder_().getFilesByName(BLOB_FILE);
  return it.hasNext() ? it.next().getBlob().getDataAsString() : null;
}

function writeBlob_(text) {
  var f = folder_();
  var it = f.getFilesByName(BLOB_FILE);
  if (it.hasNext()) { it.next().setContent(text); return; }
  f.createFile(BLOB_FILE, text, "text/plain");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

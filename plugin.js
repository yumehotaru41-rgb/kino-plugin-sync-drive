// Sync Drive (sync-drive): la sincronizacion entre aparatos de Kino a traves de un Web App de
// Google Apps Script que corres tu mismo (Code.gs en este repositorio), el cual guarda la copia
// cifrada en tu Google Drive. Basado en kinotvapp/kino-plugin-sync-server de Kino (el ejemplo de
// proveedor de sincronizacion); aqui el almacen es Apps Script + Drive en vez de server.mjs.
//
// Kino cifra la copia y le entrega a este plugin solo un blob opaco (base64). El plugin lo guarda
// en el Web App con POST {action:"push"} y lo trae de vuelta con GET ?action=pull. La version que
// devuelve el Web App hace condicional cada escritura: "expected" lleva la version que Kino leyo
// por ultima vez, y una respuesta "conflict" significa que otro aparato escribio primero -> Kino
// trae, combina y vuelve a enviar.
//
// La llave de cifrado la deriva Kino del ajuste "token" (sync.keySecret del manifiesto), asi que
// este plugin y el dueno del Web App PUEDEN leer los datos sincronizados: por eso la pantalla de
// instalacion lo dice en rojo.

const es = () => !String(kino.lang || "es").toLowerCase().startsWith("en");
const t = (esText, enText) => (es() ? esText : enText);

/** Un error con tipo que tambien guarda la frase para la persona (e.say). */
function fail(code, detail, say) {
  const e = say ? kino.error(code, detail, { userMessage: say }) : kino.error(code, detail);
  try { e.say = say || null; } catch (_) { /* un error congelado simplemente no tiene frase */ }
  return e;
}

/** La direccion del Web App y el token, revisados; lanza un error legible si algo falta. */
function settings() {
  const url = String(kino.config.get("serverUrl") || "").trim();
  const token = String(kino.config.get("token") || "").trim();
  if (!url) throw fail("auth_required", "serverUrl missing", t("Falta la direccion del Web App.", "The Web App address is missing."));
  if (!token) throw fail("auth_required", "token missing", t("Falta el token.", "The token is missing."));
  if (url.indexOf("https://") !== 0) throw fail("auth_required", "serverUrl not https", t("La direccion debe empezar por https:// (Kino no deja usar http ni tu red local).", "The address must start with https:// (Kino allows neither http nor your local network)."));
  if (url.indexOf("/exec") < 0) throw fail("auth_required", "serverUrl is not the web app url", t("Esa no parece la URL del Web App: debe terminar en /exec.", "That does not look like the Web App URL: it must end in /exec."));
  return { base: url, token };
}

/** Una peticion al Web App; la respuesta es JSON: {ok:true,...} o {ok:false,error:"token"}. */
async function api(action, body) {
  const s = settings();
  let r;
  try {
    r = await kino.fetch(s.base + (s.base.indexOf("?") >= 0 ? "&" : "?") + "action=" + action + "&token=" + encodeURIComponent(s.token), {
      method: body ? "POST" : "GET",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: { json: Object.assign({ token: s.token }, body) } } : {}),
      redirect: "follow",
      cookies: false,
      timeoutMs: 30000,
    });
  } catch (e) {
    if (e && e.code === "host_not_allowed") throw fail("auth_required", "host refused: " + (e.host || ""), t("Kino no deja conectarse a esa direccion: usa la URL https del Web App, la que termina en /exec.", "Kino will not connect to that address: use the Web App's https URL, the one ending in /exec."));
    if (e && e.code === "too_large") throw fail("unavailable", "blob too large for kino.fetch", t("La copia es demasiado grande para este plugin.", "The copy is too large for this plugin."));
    if (e && e.code === "rate_limited") throw kino.error("rate_limited", "kino.fetch budget");
    throw fail("unavailable", "web app unreachable: " + (e && e.code), t("No se pudo llegar al Web App. Esta implementado con acceso 'Cualquier persona'?", "Could not reach the Web App. Is it deployed with 'Anyone' access?"));
  }
  let data = null;
  try { data = r.json(); } catch (_) { data = null; }
  if (data && data.error === "token") throw fail("auth_required", "token rejected", t("El Web App no acepta el token. Copia otra vez el que mostro setup() en Apps Script.", "The Web App does not accept the token. Copy again the one setup() printed in Apps Script."));
  return data;
}

/** La copia guardada y su version, o null cuando el Web App aun no guarda nada. */
export async function syncPull() {
  const data = await api("pull");
  if (!data || data.ok !== true) throw kino.error("unavailable", "pull answer: " + JSON.stringify(data));
  if (data.blob == null) return null;
  return { blob: String(data.blob), version: String(data.version) };
}

/** Guarda la copia si el Web App sigue en [expectedVersion] (null = vacio); "conflict" es la senal de combinacion de Kino. */
export async function syncPush({ blob, expectedVersion, maxBlobBytes } = {}) {
  if (typeof blob !== "string" || !blob) throw kino.error("invalid_request", "no blob");
  if (maxBlobBytes && Math.floor((blob.length * 3) / 4) > maxBlobBytes + 2) throw kino.error("invalid_request", "blob over maxBlobBytes");
  const data = await api("push", { blob: blob, expected: expectedVersion == null || expectedVersion === "" ? "0" : String(expectedVersion) });
  if (data && data.conflict) throw kino.error("conflict", "the stored copy changed (server " + String(data.version || "?") + ")");
  if (!data || data.ok !== true) throw kino.error("unavailable", "push answer: " + JSON.stringify(data));
  return { version: String(data.version) };
}

/** Listo cuando el Web App responde con este token. */
export async function syncStatus() {
  try {
    const url = String(kino.config.get("serverUrl") || "").trim();
    const token = String(kino.config.get("token") || "").trim();
    if (!url || !token) return { ready: false, message: t("Escribe la direccion del Web App y el token.", "Type the Web App address and the token.") };
    const data = await api("status");
    if (!data || data.ok !== true) return { ready: false, message: t("El Web App respondio algo inesperado. Revisa la URL (debe terminar en /exec).", "The Web App answered something unexpected. Check the URL (it must end in /exec).") };
    return data.empty
      ? { ready: true, message: t("Conectado. El Web App aun no guarda nada.", "Connected. The Web App stores nothing yet.") }
      : { ready: true, message: t("Conectado.", "Connected.") };
  } catch (e) {
    return { ready: false, message: (e && e.say) || t("No se pudo consultar el Web App.", "Could not ask the Web App.") };
  }
}

// --- El formulario de ajustes (Conectar) ---

async function describe() {
  const s = await syncStatus();
  return s.message;
}

export async function settingsStatus() {
  if (!String(kino.config.get("serverUrl") || "").trim()) return { status: t("Escribe la direccion del Web App.", "Type the Web App address.") };
  if (!String(kino.config.get("token") || "").trim()) return { status: t("Pega el token.", "Paste the token.") };
  return { status: await describe() };
}

export async function action(key) {
  if (key === "check") return { message: await describe() };
  return { message: t("Nada que hacer.", "Nothing to do.") };
}

export async function validateSettings(values) {
  const out = {};
  const url = String(values.serverUrl || "").trim();
  if (url && (url.indexOf("https://") !== 0 || url.indexOf("/exec") < 0)) out.serverUrl = t("Debe ser la URL del Web App: https y termina en /exec.", "It must be the Web App URL: https and ending in /exec.");
  const token = String(values.token || "").trim();
  if (token && token.length < 32) out.token = t("Ese token es muy corto: copia el que mostro setup() en Apps Script.", "That token is too short: copy the one setup() printed in Apps Script.");
  return Object.keys(out).length ? out : null;
}

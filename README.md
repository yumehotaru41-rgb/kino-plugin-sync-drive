# Sync Drive: sincroniza tus aparatos de Kino a traves de tu propio Google Drive

Plugin de Kino (id 'sync-drive') que guarda la copia cifrada de tu historial, biblioteca y ajustes
en **tu Google Drive**, a traves de un Web App de Google Apps Script que corres tu mismo. Sin
computadora encendida y sin tuneles: el Web App esta siempre disponible y tu telefono y tu TV
Android se mantienen en paso (empezar algo en uno y continuar en el otro justo donde lo dejaste).

Basado en el ejemplo oficial kinotvapp/kino-plugin-sync-server de Kino; aqui el almacen es
Apps Script + Drive en vez de server.mjs + Cloudflare.

~~~
tu celular -+
            +-- https --> script.google.com (tu Web App) --> carpeta "Kino Sync Drive" en tu Drive
tu TV       +                         kino-sync-blob.txt  (la copia cifrada)
~~~

Necesitas Kino 0.9.74 o mas nuevo en tus aparatos y una cuenta de Google.

## 1. Crea el Web App

1. Abre https://script.google.com con tu cuenta de Google y crea un **Nuevo proyecto** (llamalo por ejemplo "Kino Sync Drive").
2. Borra el contenido del editor, pega completo el archivo **Code.gs** de este repositorio y guarda.
3. Arriba, en el menu de funciones, elige **setup** y pulsa **Ejecutar**. La primera vez Google te pide autorizar el acceso a Drive y a las propiedades del script: acepta (Avanzado > Ir a Kino Sync Drive).
4. En el **Registro de ejecucion** aparece el **TOKEN** (64 caracteres). Copialo.
5. **Implementar > Nueva implementacion > Aplicacion web**:
   - Descripcion: la que quieras.
   - **Ejecutar como: Yo** (tu cuenta).
   - **Quien tiene acceso: Cualquier persona** (el token protege los datos).
   - Implementa y copia la **URL del Web App** (termina en /exec).

## 2. Instala el plugin en Kino (en cada aparato)

1. Celular: **Menu > Plugins > +**. TV: **Plugins > Agregar plugin**.
2. Tipo **Kino**, direccion: **yumehotaru41-rgb/kino-plugin-sync-drive**, y agrega.
   (El plugin no es firma del autor de Kino: es de la comunidad. Nada del plugin va a tu Home.)

## 3. Enciende el proveedor (en cada aparato)

1. **Ajustes > Ajustes de todos los perfiles > Sincronizacion > Proveedor**: enciende **Sync Drive**.
2. Toca **Combinar con este aparato** (la sincronizacion por red local se apaga mientras uses este proveedor).
3. Toca **Conectar** y escribe:
   - **Direccion del Web App**: la URL /exec del paso 1.5.
   - **Token**: el del paso 1.4.
4. Toca **Guardar** y usa **Probar conexion**: debe decir "Conectado".
5. Vuelve atras: la primera sincronizacion corre sola ("Sincronizado hace un momento").

Desde ahi, Kino trae la copia al volver al frente y cada 5 minutos, y envia la suya un minuto despues de un cambio. **Sincronizar ahora** fuerza una sincronizacion.

## Que puede ver Google y que no

Kino cifra la copia con una llave que deriva del token, asi que Google (y este plugin) solo ven un
blob cifrado, nunca tu historial en claro. Quien tenga la URL mas el token puede leer la copia
cifrada: no compartas el token.

## Si algo falla

- "No se pudo llegar al Web App": revisa que la implementacion este con acceso "Cualquier persona" y que la URL termine en /exec (no uses la URL /dev).
- "El Web App no acepta el token": vuelve a ejecutar setup() en Apps Script y copia el token del registro completo, sin espacios.
- Cambiaste algo de Code.gs: Implementar > **Gestionar implementaciones > Editar > Nueva version**, o la URL seguira corriendo el codigo viejo.
- Para empezar de cero: borra la carpeta "Kino Sync Drive" de Drive y, en Apps Script, Configuracion del proyecto > Propiedades del script, borra VERSION y COUNTER (no borres TOKEN, o tus aparatos dejaran de entenderse).

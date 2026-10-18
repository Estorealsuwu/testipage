# te la creiste we · Una página para Vercel

La página pública muestra la imagen original y el texto **te la creiste we** encima, adaptados al teléfono y a la computadora. El contador registra las visitas en segundo plano. Un aviso pequeño informa que se registra la IP y la fecha.

Solo existe una página HTML. Para ver las estadísticas privadas, abre **`/#panel`** en la misma URL e ingresa la contraseña. El panel se abre sobre el meme; el historial no se entrega sin contraseña.

## Probar en tu computadora

Con Node.js 22.9 o posterior, ejecuta desde esta carpeta:

```sh
npm run dev
```

Abre **http://127.0.0.1:8787**. El panel está en **http://127.0.0.1:8787/#panel**.

Sin variables de entorno, el servidor usa datos temporales y genera una contraseña aleatoria nueva en cada inicio. Consulta esa contraseña temporal en la terminal para entrar al panel local; no se guarda en archivos.

Los registros locales desaparecen al reiniciar. Las funciones de producción nunca usan una contraseña predeterminada ni datos en memoria. No abras el HTML con doble clic: el registro necesita el servidor.

## Configurar Vercel

Importa esta carpeta desde GitHub o ejecuta `npx vercel` desde ella. Usa el preset **Other** y Node.js **22.x**. `vercel.json` ya configura la comprobación del código, las funciones y el directorio de salida `public`. La raíz del proyecto debe contener `package.json`, `vercel.json`, `api/` y `public/` juntos.

Crea o conecta una base Redis de Upstash. En las variables del proyecto Vercel, agrega:

| Variable | Contenido |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | URL HTTPS de la base Redis |
| `UPSTASH_REDIS_REST_TOKEN` | REST token de escritura |
| `ADMIN_PASSWORD` | Contraseña privada aleatoria de al menos 24 caracteres ASCII |
| `IP_HASH_SALT` | Otro secreto de al menos 32 caracteres; debe mantenerse estable |

También se aceptan los nombres `KV_REST_API_URL` y `KV_REST_API_TOKEN` que puede proporcionar la integración de Vercel. Si existen ambos juegos de variables, se usan los valores `UPSTASH_*`.

Genera dos valores distintos con este comando, ejecutándolo dos veces:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Usa uno para `ADMIN_PASSWORD` y el otro para `IP_HASH_SALT`. Guarda los valores en las variables del servidor; no los subas a GitHub ni a `public/`. Los archivos `.env` y sus variantes están excluidos del repositorio; no se publica ninguna contraseña predeterminada.

Opcional: define `REDIS_KEY_PREFIX`, cuyo valor predeterminado es `pulso:v1`. Usa otro prefijo en los despliegues de Preview para separar las visitas de prueba de las reales.

Tras configurar las variables, despliega o haz un Redeploy. La URL pública mostrará el meme; en **`https://TU-DOMINIO/#panel`** podrás consultar los totales y las últimas 100 IP con tu contraseña.

Para usar Redis en local, crea un archivo `.env.local` solo en tu computadora con los cuatro nombres de variables de la tabla y sus valores. Ejecuta `npm run dev`. Ese archivo se ignora en Git y en Vercel. Usa un prefijo distinto para las pruebas.

## Qué registra

- **Visitas:** una visita por IP cada 30 segundos. Las recargas seguidas no duplican el contador.
- **IP distintas:** número de IP diferentes registradas. Es una aproximación de visitantes; varias personas pueden compartir IP y una persona puede cambiar de IP.
- **Historial privado:** las últimas 100 visitas aceptadas con IP completa y fecha UTC. El panel las muestra en la zona horaria del dispositivo.
- **Actualizar en el panel:** consulta sin sumar una visita. Entrar directamente con `/#panel` tampoco cuenta como visita pública.

La página requiere JavaScript para registrar el acceso. Los bots que ejecuten JavaScript pueden contar; no es un sistema de verificación de personas. No se usa un servicio externo para buscar la IP: se obtiene de las cabeceras del servidor de Vercel.

El total y el conjunto de identidades IP se conservan en Redis. Las identidades se calculan con HMAC y `IP_HASH_SALT`; no representan personas ni garantizan anonimización. Las IP completas solo permanecen en la lista privada hasta que las desplazan 100 visitas más recientes; no hay borrado por antigüedad. Cambiar el secreto de IP altera el cálculo de IP distintas.

El panel conserva la contraseña solo en memoria mientras está abierto. Al cerrarlo, cerrar sesión o salir de la página se vacían la contraseña y el historial. La API exige la contraseña para entregar los registros. Los intentos incorrectos repetidos tienen un límite por IP. El registro es atómico en Redis para evitar que accesos simultáneos dupliquen una visita.

## Comprobar el código

```sh
npm run check
npm test
```

Las pruebas no requieren credenciales. La conexión a tu Redis y el despliegue real deben verificarse con la cuenta configurada.

## Archivos

- `public/index.html`: única página, meme y panel privado.
- `public/meme.png`: imagen original proporcionada.
- `public/styles.css`: presentación y adaptación a pantallas pequeñas.
- `public/app.js`: registro y apertura del panel.
- `public/admin.js`: acceso privado e historial.
- `api/visits.js`, `api/admin.js`: funciones del servidor.
- `lib/`: almacenamiento, seguridad y manejo de solicitudes.

Referencias: [funciones Node.js de Vercel](https://vercel.com/docs/functions/runtimes/node-js), [cabeceras de IP](https://vercel.com/docs/headers/request-headers), [API REST de Upstash](https://upstash.com/docs/redis/features/restapi).

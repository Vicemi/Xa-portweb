# 🚀 XA: Contra los Cuatreros Galácticos — Port Web

> Un port web no oficial del clásico **XA: Contra los Cuatreros Galácticos** (2010), creado originalmente por **Batoví Games Studio** junto a **Calcar**, reconstruido para correr en el navegador con **Astro** y **React**. Se juega en PC y en el celular.

🎮 **Jugalo online:** [xa-portweb.vicemi.dev](https://xa-portweb.vicemi.dev). No hay que instalar nada: anda en PC y en el celular, y se actualiza solo con cada cambio que llega a `main` (deploy continuo en Cloudflare Pages).

---

## 📖 Sobre el proyecto

XA fue uno de los juegos que más marcaron mi infancia. Este proyecto nace de una necesidad bastante simple: **revivirlo**. Pero no solo hacerlo funcionar de nuevo, sino también poder modificarlo, mejorarlo y expandirlo: crear mapas nuevos, agregar personajes y sumarle contenido que el original nunca tuvo.

El juego original está abandonado por su estudio desde hace años. La meta es que este port sea **fiel 1 a 1 al original** como punto de partida y, sobre esa base, una plataforma abierta para mods y contenido nuevo, manteniendo vivo un juego que forma parte de la memoria de muchos.

## 🛠️ Cómo se hizo

El camino no fue directo, y vale la pena contarlo.

### Primer intento: reconstrucción desde cero

Empecé porteando el juego desde cero junto a **Claude** y **[Ghidra](https://ghidra-sre.org/)**, con la idea de rehacer todo el código a partir del ejecutable original. Para ese momento ya tenía bastante material:

- Todos los **assets** extraídos del archivo `.xa`.
- El **sistema de niveles** en texto plano.
- Lógica y estructuras que logré extraer del **binario** analizándolo con Ghidra y Claude.

Aun así, el avance era muy lento. Tener los datos no alcanzaba: reconstruir el comportamiento real del juego a partir del binario se estaba volviendo prácticamente imposible.

### El punto de quiebre: universal-modder

Todo cambió al usar **[universal-modder](https://github.com/rehan-remade/universal-modder)**, un conjunto de skills y herramientas que le dan a un agente de IA una guía estructurada para analizar, hacer ingeniería inversa y modificar juegos. Con ese marco de trabajo, Claude pudo abordar el juego de forma mucho más ordenada y finalmente empezaron a salir resultados.

### El port actual

Después, usando **DeepSeek R4** con la misma skill, logré portear la **mayor parte del juego** a web con React, sobre un proyecto en Astro. A partir de ahí, con **Claude**, cada mecánica se fue contrastando contra el código descompilado y el juego original corriendo, para que se comporte igual: física del héroe, colisiones, enemigos, jefe final, pantallas, textos y sonido. El diario completo de ese trabajo está en [`MODLOG.md`](MODLOG.md).

## 🚧 Estado actual

El juego es **jugable de principio a fin** (16 niveles y el jefe final), en PC y en celular, y está **publicado online** en [xa-portweb.vicemi.dev](https://xa-portweb.vicemi.dev). Las mecánicas, enemigos, pantallas y textos se repasaron uno por uno contra el código del juego original; se siguen ajustando detalles finos a medida que aparecen.

Si encontrás algún problema, abrí un *issue* contando **en qué nivel**, **qué hiciste** y **qué esperabas que pasara**. ¡Toda ayuda suma!

### ✅ Lo que ya funciona

- **Flujo completo del original:** logos de Batoví y Calcar (con su "dong" de piano y fundidos de 0,8 s), pantalla de carga, cómic de la historia, menú principal (de día o de noche según la hora, con el récord total), ayuda, créditos (rediseñados en alta resolución), opciones, mapa de selección de niveles, intro de cada nivel, pausa, game over y final.
- **Textos originales:** títulos, descripciones de los niveles y carteles salen del juego original (incluidos tildes, "ñ", "¡" y "¿").
- **Héroe:** caminar, salto y doble salto (power-up que se reinicia en cada nivel, como en el original), escaleras, agacharse y cubrirse con el escudo (frena las balas enemigas), disparo en ráfaga, daño, vidas y puntos de guardado.
- **Enemigos** con el comportamiento del original: patrulleros (también sobre plataformas), marcianos que te disparan cuando te ven, naves y pájaros con su vaivén, naves que disparan hacia donde apuntan, torretas, cañones en parábola, cobras saltarinas, bombas que estallan en balas, pirañas robot, guillotinas, pinchos y más. Cada uno da los puntos del original y los muestra flotando al morir.
- **Objetos:** monedas, vacas para rescatar, ítems flotantes, llaves y puertas que las gastan, plataformas móviles con la imagen de cada nivel y carteles con sus textos originales.
- **Jefe final** con sus mecánicas: disparo en abanico, muerte por contacto, 200 impactos, explosión final y la llave que abre la salida.
- **Mapa de niveles** con progreso guardado: vacas rescatadas, porcentaje de monedas, puntaje por nivel e indicador de nivel perfecto.
- **Opciones:** volumen de música y efectos, **pantalla completa** y **estirar pantalla**; todo se recuerda entre partidas.
- **Celular:** controles táctiles con multitouch (ver abajo) y aviso para girar el teléfono.

### 🗺️ Planes a futuro

- [x] Port fiel del juego completo, publicado online con deploy continuo
- [ ] Comparación lado a lado con el original para los últimos detalles finos
- [ ] Soporte para mods
- [ ] Editor / creación de mapas nuevos
- [ ] Nuevos personajes
- [ ] Expansión general del contenido del juego

---

## 🎮 Controles

### Teclado

| Acción | Teclas |
| :--- | :--- |
| Moverse | **Flechas** (o teclado numérico 4 / 6) |
| Subir / bajar escaleras, agacharse | **↑ / ↓** (o 8 / 2) |
| Saltar (mantener) | **Z** o **Espacio** |
| Disparar (mantener = ráfaga) | **X** (o 3 / 9) |
| Pausa | **Esc** o **P** |
| Pantalla completa | **F** (o desde *Opciones*) |
| Menús | Flechas + **Enter**, o el mouse |
| Historia (cómic) | **Cualquier tecla** o clic pasa a la página siguiente |

### Celular / táctil

Girá el teléfono en **horizontal**. Los controles aparecen solo mientras jugás, y en los menús alcanza con tocar.

- **Mitad izquierda = joystick flotante.** Apoyá el dedo en cualquier parte de la mitad izquierda y arrastrá hacia donde quieras moverte. El centro del joystick acompaña al dedo, así que para cambiar de dirección basta un movimiento corto hacia el otro lado, sin levantar el dedo. Arrastrar en diagonal hacia arriba o abajo sirve para escaleras.
- **Mitad derecha = acciones.** Botones grandes de **SALTO** y **FUEGO**, separados entre sí. Tocar cualquier otra zona de la mitad derecha también salta.
- **Multitouch real:** podés moverte, saltar y disparar al mismo tiempo, y deslizar el dedo de un botón al otro sin soltarlo.
- **Botón de volver (arriba a la derecha)**, siempre visible: hace lo que haría la tecla *Esc* en cada pantalla y su ícono cambia según dónde estés: ❚❚ pausa el juego, ▶ continúa o empieza el nivel, ↩ vuelve al menú, ⏭ pasa al siguiente logo o página de la historia y, en el menú principal, ⛶ activa la pantalla completa.
- El celular vibra levemente al saltar (si lo soporta).

> En una notebook con pantalla táctil podés forzar los controles táctiles con `?touch=1` en la URL (o desactivarlos con `?touch=0`).

---

## 💻 Ejecutar el proyecto localmente

### Requisitos

- **[Node.js](https://nodejs.org/)** **22.12 o superior**
- **npm** (viene incluido con Node.js)
- **Git**

Podés verificar que los tenés instalados con:

```sh
node -v
npm -v
git --version
```

### Instalación

1. **Clonar el repositorio**

   ```sh
   git clone https://github.com/Vicemi/Xa-portweb.git
   cd Xa-portweb
   ```

2. **Instalar las dependencias**

   ```sh
   npm install
   ```

3. **Iniciar el servidor de desarrollo**

   ```sh
   npm run dev
   ```

4. **Abrir el juego** en el navegador en [http://localhost:4321](http://localhost:4321)

### Generar una versión de producción

Para compilar el sitio estático:

```sh
npm run build
```

Los archivos se generan en la carpeta `./dist/`, lista para subir a cualquier hosting estático (Cloudflare Pages, Vercel, Netlify, GitHub Pages, un servidor propio, etc.).

### 🌐 Deploy

La versión pública vive en **[Cloudflare Pages](https://pages.cloudflare.com/)** con deploy continuo: cada push a `main` compila el sitio y lo publica en [xa-portweb.vicemi.dev](https://xa-portweb.vicemi.dev). No hace falta ningún paso manual.

Para previsualizar la build localmente antes de publicarla:

```sh
npm run preview
```

### 🧞 Comandos disponibles

Todos se ejecutan desde la raíz del proyecto:

| Comando                   | Acción                                                  |
| :------------------------ | :------------------------------------------------------ |
| `npm install`             | Instala las dependencias                                |
| `npm run dev`             | Inicia el servidor local en `localhost:4321`            |
| `npm run build`           | Compila la versión de producción en `./dist/`           |
| `npm run preview`         | Previsualiza la build localmente antes de publicarla    |
| `npm run manifest`        | Regenera `public/assets/manifest.json` (después de agregar o quitar archivos del juego, por ejemplo un mapa nuevo) |
| `npm run astro ...`       | Ejecuta comandos del CLI de Astro (`astro add`, `astro check`) |

### 🔗 Atajos por URL (útiles para probar y para mods)

| URL | Qué hace |
| :--- | :--- |
| `/?level=5` | Entra directo al nivel 5 (1 a 16) |
| `/?map=assets/data/mi_mapa.tmx` | Carga cualquier mapa TMX |
| `/?touch=1` / `/?touch=0` | Fuerza / desactiva los controles táctiles |

---

## 🧩 Mapas nuevos (mods)

Los niveles son archivos **[Tiled](https://www.mapeditor.org/) `.tmx`** en `public/assets/data/`. Para crear uno:

1. Copiá un nivel existente (por ejemplo `level1.tmx`) con otro nombre, como `public/assets/data/mi_mapa.tmx`, y editalo en Tiled.
2. Corré `npm run manifest` para que el juego lo encuentre.
3. Jugalo con `/?map=assets/data/mi_mapa.tmx`, o desde el mapa de niveles: los mapas extra aparecen después del nivel 16 (con las flechas) y siempre están desbloqueados.

Los objetos del mapa usan los mismos tipos y propiedades que el original (`Enemy`, `Android`, `UFO`, `Item`, `Door`, `SavePoint`, `Information`…, con `pxVel`, `pLives`, `pMinTime`, `pText`, etc.). En [`MODLOG.md`](MODLOG.md) está documentado qué hace cada uno.

---

## 📁 Estructura del proyecto

```text
/
├── public/
│   ├── assets/          # assets originales del juego + manifest.json
│   └── favicon.png
├── src/
│   ├── components/
│   │   ├── XaGame.tsx         # monta el juego (canvas, orientación, detección táctil)
│   │   └── TouchControls.tsx  # joystick flotante + botones multitouch
│   ├── pages/           # index.astro — la página principal y los estilos
│   └── xa/              # el motor del port
│       ├── core/        # assets, audio, input, sprites, fuente bitmap
│       ├── data/        # sprites.json, levels.json, font.json (extraídos del juego original)
│       ├── world/       # mundo, héroe, enemigos, tilemap, objetos, HUD, cámara
│       └── game.ts      # bucle principal (60 fps) y flujo de pantallas
├── tools/               # herramientas de ingeniería inversa y de datos
│   ├── extract_texts.py # extrae títulos, descripciones y textos del xa.exe original
│   ├── xre.py           # explora el xa.exe (strings, lecturas/escrituras, constantes)
│   ├── xre_points.py    # busca los puntos de cada enemigo en el xa.exe
│   ├── build_data.py    # genera sprites.json a partir de lo extraído
│   ├── gen-manifest.mjs # regenera public/assets/manifest.json
│   └── …                # anims.py, imagemaps.py, letterwidth.py, collision-sim.mjs, cap.ps1
├── MODLOG.md            # diario de trabajo del port (todo lo descubierto del juego original)
└── package.json
```

## 📦 Assets del juego (incluidos)

Este port **incluye** los assets originales (imágenes, sonidos, mapas `.tmx`) en `public/assets/`, así que el juego funciona de forma **autónoma**: clonás el repo, `npm install`, `npm run dev` y listo.

- Al cargar, el juego usa primero los assets incluidos (`/assets/`).
- Si no los encuentra, cae al modo de carpeta: el navegador te pide elegir tu instalación del juego (File System Access API; con alternativa de selector de carpeta en Firefox/Safari). Los archivos se leen **localmente en tu navegador** y **nunca** se suben a ningún servidor.

> ⚠️ *XA: Contra los Cuatreros Galácticos* es obra de **Batoví Games Studio** y **Calcar**. Este es un proyecto de fans **sin fines de lucro**; si algún titular de derechos lo solicita, el repositorio se dará de baja.

---

## 🤝 Contribuir

Si querés colaborar, ¡bienvenido! Podés:

- Reportar bugs abriendo un *issue*.
- Proponer mejoras o ideas para mods, mapas o personajes.
- Enviar un *pull request* con correcciones o nuevo contenido.

El trabajo se hace en la rama `develop` y se integra en `main` cuando está probado; al llegar a `main` se publica automáticamente en la web.

## ⚖️ Créditos y aviso legal

- **XA: Contra los Cuatreros Galácticos** es obra de sus creadores originales, **Batoví Games Studio** y **Calcar**. Todos los derechos sobre el juego original, sus personajes y sus assets les pertenecen.
- Este es un **proyecto de fans, sin fines de lucro**, hecho por nostalgia y con el objetivo de preservar el juego. No está afiliado ni respaldado por los autores originales.
- Si sos uno de los titulares de los derechos y tenés alguna inquietud sobre este proyecto, no dudes en contactarme.

### Herramientas utilizadas

- [Astro](https://astro.build/) y [React](https://react.dev/)
- [Ghidra](https://ghidra-sre.org/) — ingeniería inversa del ejecutable
- [universal-modder](https://github.com/rehan-remade/universal-modder) — skills para modding asistido por IA
- [Claude](https://claude.ai/) y DeepSeek R4 — asistentes de IA usados en el desarrollo

---

<p align="center">Hecho con 💙 desde Uruguay por <b>Vicemi</b></p>

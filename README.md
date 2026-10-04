# 🚀 XA: Contra los Cuatreros Galácticos — Port Web

> Un port web no oficial del clásico **XA: Contra los Cuatreros Galácticos**, creado originalmente por **Batoví** y **Calca**, reconstruido para correr en el navegador con **Astro** y **React**.

🎮 **Jugalo online:** [xa-portweb.vicemi.dev](https://xa-portweb.vicemi.dev) *(próximamente)*

---

## 📖 Sobre el proyecto

XA fue uno de los juegos que más marcaron mi infancia. Este proyecto nace de una necesidad bastante simple: **revivirlo**. Pero no solo hacerlo funcionar de nuevo, sino también poder modificarlo, mejorarlo y expandirlo: crear mapas nuevos, agregar personajes y sumarle contenido que el original nunca tuvo.

La meta a largo plazo es que este port sea una base abierta sobre la cual se puedan construir mods y contenido nuevo, manteniendo vivo un juego que forma parte de la memoria de muchos.

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

Después, usando **DeepSeek R4** con la misma skill, logré portear la **mayor parte del juego** a web con React, sobre un proyecto en Astro.

## 🚧 Estado actual

El proyecto está **en desarrollo activo**. La mayor parte del juego ya es jugable, pero todavía hay bugs y errores que iré puliendo de a poco.

Si encontrás algún problema, podés abrir un *issue* describiendo qué pasó y cómo reproducirlo. ¡Toda ayuda suma!

### 🗺️ Planes a futuro

- [ ] Corregir los bugs y errores conocidos
- [ ] Soporte para mods
- [ ] Creación de mapas nuevos
- [ ] Nuevos personajes
- [ ] Expansión general del contenido del juego

---

## 💻 Ejecutar el proyecto localmente

### Requisitos

- **[Node.js](https://nodejs.org/)** — versión LTS (20 o superior recomendada)
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

Los archivos se generan en la carpeta `./dist/`, lista para subir a cualquier hosting estático (Vercel, Netlify, Cloudflare Pages, GitHub Pages, un servidor propio, etc.).

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
| `npm run astro ...`       | Ejecuta comandos del CLI de Astro (`astro add`, `astro check`) |
| `npm run astro -- --help` | Muestra la ayuda del CLI de Astro                       |

## 📁 Estructura del proyecto

```text
/
├── public/          # favicon + assets originales del juego (incluidos, ver abajo)
├── src/
│   ├── components/  # XaGame.tsx — el componente React que monta el juego
│   ├── pages/       # index.astro — la página principal
│   └── xa/          # El motor del port
│       ├── core/    # assets, audio, input, sprites, fuente bitmap
│       ├── data/    # sprites.json, levels.json, font.json (extraídos del binario)
│       ├── world/   # mundo, héroe, enemigos, tilemap, objetos, HUD, cámara
│       └── game.ts  # bucle principal (60 fps) y flujo de pantallas
├── tools/           # Herramientas de ingeniería inversa (xre.py, anims.py, …)
├── astro.config.mjs
├── MODLOG.md        # Diario de trabajo del port
└── package.json
```

## 📦 Assets del juego (incluidos)

Este port **incluye** los assets originales (imágenes, sonidos, mapas `.tmx`) en `public/assets/`, así que el juego funciona de forma **autónoma**: clonás el repo, `npm install`, `npm run dev` y listo.

- Al cargar, el juego usa primero los assets incluidos (`/assets/`).
- Si no los encuentra, cae al modo de carpeta: el navegador te pide elegir tu instalación del juego (File System Access API; con fallback a selector de carpeta en Firefox/Safari). Los archivos se leen **localmente en tu navegador** y **nunca** se suben a ningún servidor.

> ⚠️ *XA: Contra los Cuatreros Galácticos* es obra de **Batoví** y **Calca**. Este es un proyecto de fans **sin fines de lucro**; si algún titular de derechos lo solicita, el repositorio se dará de baja.

---

## 🤝 Contribuir

Si querés colaborar, ¡bienvenido! Podés:

- Reportar bugs abriendo un *issue*.
- Proponer mejoras o ideas para mods, mapas o personajes.
- Enviar un *pull request* con correcciones o nuevo contenido.

## ⚖️ Créditos y aviso legal

- **XA: Contra los Cuatreros Galácticos** es obra de sus creadores originales, **Batoví** y **Calca**. Todos los derechos sobre el juego original, sus personajes y sus assets les pertenecen.
- Este es un **proyecto de fans, sin fines de lucro**, hecho por nostalgia y con el objetivo de preservar el juego. No está afiliado ni respaldado por los autores originales.
- Si sos uno de los titulares de los derechos y tenés alguna inquietud sobre este proyecto, no dudes en contactarme.

### Herramientas utilizadas

- [Astro](https://astro.build/) y [React](https://react.dev/)
- [Ghidra](https://ghidra-sre.org/) — ingeniería inversa del ejecutable
- [universal-modder](https://github.com/rehan-remade/universal-modder) — skills para modding asistido por IA
- [Claude](https://claude.ai/) y DeepSeek R4 — asistentes de IA usados en el desarrollo

---

<p align="center">Hecho con 💙 desde Uruguay por <b>Vicemi</b></p>

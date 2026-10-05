# MODLOG — Xa web port

Diario de trabajo del port de *Xa contra los Cuatreros Galácticos* (Batovi) a web (Astro + React + TypeScript).
Todo lo que no esté aquí se pierde al compactar el contexto.

## Objetivo
Port fiel (mismo aspecto, misma jugabilidad) en `E:\Vicemi\Proyectos\XA-PortWeb`, extensible: cambiar
entre mapas, añadir niveles nuevos (TMX), modear.

## ⚠️ Estado al 2026-10-04 (mudanza)
- El usuario va a **desinstalar y reinstalar Xa desde cero**: la instalación de `F:\Games\Xa` estaba modeada
  (TMX, banner "Vicemi Mod", nivel debug…). Todo dato visual/de niveles sacado de esa instalación es
  SOSPECHOSO hasta re-verificarlo contra la instalación limpia. Re-sacar capturas de referencia.
- Las constantes de física se sacaron del `.data` de `xa.exe`; re-verificar que el exe limpio sea idéntico
  (comparar hash) antes de darlas por buenas.
- Estructura:
  - raíz = proyecto Astro + React (`npm run dev`).
  - `tools/` = herramientas propias: `xre.py` (explorar xa.exe con capstone: `wstr`, `reads`, `writes`, `dis`,
    `f32`), `anims.py` (extractor de AnimType desde el descompilado, EN PROGRESO: detecta animaciones pero aún
    no captura los frames), `split.py` (divide el descompilado por clase), `cap.ps1` (captura la ventana de xa.exe
    y envía teclas solo si está en primer plano).
  - `research/` (gitignored, material del usuario): `decompiled/` (+ `by_class/`), `old_remake_js/`,
    `shots_modded/` (capturas de la instalación MODEADA, solo orientativas).
- Rutas `F:\Games\Xa\...` de abajo: tras reinstalar, revisar dónde queda el juego y actualizar.

## Estado 2026-10-04 (instalación limpia en F:\Games\Xa)
- `xa.exe` limpio: SHA256 C408FA8B…E8A6, constantes de física idénticas (re-verificadas con tools/xre.py).
- Capturas de referencia limpias: `research/shots_clean/` (arranque, cómic, menú, mapa, intro nivel 1, juego).
- **El juego renderiza en 512×384 lógicos escalados ×1.5625 a 800×600** (confirmado: moneda de 35 px se ve de 55 px;
  logo HUD en (448,348) lógico coincide con el binario). El port hace lo mismo (ctx.setTransform).
- Cámara verificada: al empezar el nivel 1, camX=0 y camY≈354–357 (monedas en la captura real).
- HUD (posiciones top-left lógicas, verificadas por template matching con la captura real):
  AVATAR (7,13), ENERGY_BAR (8,48), DOUBLE_JUMP[_NONE] (100,8), BACK_POINTS (226,7), COINS (323,12),
  COW (410,10), LOGO (448,348). Regla: cuando el ancla extraída es basura, el ancla real es el centro del sprite.
- Moneda = +10 puntos (observado en el juego real).

### Port: qué funciona ya (`npm run dev` → http://localhost:4321, `?level=N`, `?map=assets/data/x.tmx`)
- Carga TMX original (base64/csv), estados de tile (solo la 1ª propiedad de cada tile, como el motor), fondo con
  parallax de Decoration::reloadTileMap, tiles, colisión por muestreo de bordes (TileMap::intersectsStep).
- Xa: entrada (caída desde arriba + temblor de cámara), andar, saltar (altura 100 px verificada), doble salto
  (con power-up), escaleras, bloqueo/agacharse, disparo con ráfaga 3×(1/12 s)+pausa 0.25 s, daño con parpadeo
  rojo, muerte → reaparición en el último SavePoint, game over.
- Items: monedas, vidas, energía, power-ups de salto/doble salto, carteles (mensaje HUD), SavePoint, vacas
  (contador), ENDING (Xa ganador → 6 s → siguiente nivel).
- Selector de mapas (desplegable + RePág/AvPág) y carga de TMX propio por ruta → base para niveles nuevos.
- Dev: `window.__xa.step(frames, ['ArrowRight'])` avanza la simulación aunque la pestaña esté oculta.

### Pendiente inmediato
1. Fuentes bitmap (Lang.c: fuente_blanca/negra/negra_2/pixelada + tabla de anchos) → números del HUD y mensajes.
2. Enemigos (18 clases) + balas enemigas + colisión héroe/enemigo/bala; plataformas móviles; puertas/llaves.
3. Pantallas: logo, carga, cómic, menú, selección de nivel, intro de nivel, pausa, opciones, ayuda, créditos,
   game over, victoria. Textos SIEMPRE leídos de los archivos del usuario, nunca copiados al código.
4. Animaciones generales mal extraídas: HAPPY_COW, SAVING, DOUBLE_JUMP_HUD (corregir a mano).
5. Comparación lado a lado port vs. original en cada pantalla.

## Referencia visual (instalación modeada, a re-verificar)
- Ventana real: **800×600** cliente. Imágenes de menú 512×512 se muestran estiradas a 800×600.
- Flujo: logo Batovi (fade) → pantalla de carga "CARGANDO.." → "presiona cualquier tecla" → 5 páginas de
  cómic (Space avanza una, Enter salta todas) → menú (JUGAR/AYUDA/OPCIONES/CRÉDITOS/SALIR, récord arriba
  derecha, logo CALCAR). Ningún botón seleccionado al entrar: la 1ª flecha selecciona JUGAR; ↑ desde JUGAR va
  a SALIR. → Seleccionar nivel (map.png, marcadores, barra inferior: nivel, vacas x/y, monedas, %, puntaje)
  → intro de nivel (caja de texto, vista previa, "Nivel N", nombre) → juego.
- HUD en juego: cabeza de Xa "x03" + barra de energía verde (arriba izq.), icono de power-up, panel "Puntos
  000000", monedas, vacas "00/01"; globo de mensaje (hud_message_back) con cara de Xa; logo CALCAR abajo der.
- ImageMap HERO: celdas 70×70, 7 columnas, 49 celdas, ancla (35,60). Animación WALK = frames 8..17.

## Ruta elegida
**Reimplementación** (route "Reimplement"): motor nuevo en TypeScript que lee los archivos ORIGINALES del
usuario (TMX, PNG, JPG, OGG) en tiempo de ejecución. La lógica se escribe a partir del comportamiento
documentado en el descompilado, sin copiar código descompilado al repo.
- Los assets del juego NO se versionan: `npm run sync-assets` los copia de `../assets` a `public/assets`
  (gitignored). "Bring your own game files".

## Fuentes de verdad
- Juego: `F:\Games\Xa\xa.exe` (x86, motor propio "bat" de Batovi, sin anti-cheat).
- Assets: `F:\Games\Xa\assets` (los TMX actuales están modificados por el usuario; originales en
  `F:\Games\Xa\_backup_original`).
- Descompilado Ghidra (build Linux con símbolos): `F:\Games\Xa\remake\decompiled\xa_decompiled_FULL.c`.
  Dividido por clase en `F:\Games\Xa\remake\decompiled\by_class\*.c` (script: split.py en scratchpad).
  `Scenario::loadObjects` FALLÓ al descompilar (timeout) → reconstruir desde constructores + TMX.
- Remake JS previo (aproximado, con suposiciones): `F:\Games\Xa\remake\js`.

## Hechos confirmados
### Teclado (bat::KeyCode = scancode Windows - 1)
- Arriba 0x78 / Num8 0x47; Abajo 0x7d / Num2 0x4f; Izq 0x7a / Num4 0x4a; Der 0x7b / Num6 0x4c.
- Saltar: Z (0x2b), Espacio (0x38) [mantener]; Num1 (0x4e), Num7 (0x46) [primera pulsación].
- Disparar: X (0x2c), Num3 (0x50), Num9 (0x48).
- Teclas debug (Config::getDebugKeys): A/D/W/S mueven el tilemap ±10.
- Si el héroe ganó (isWinner): el controlador fuerza dir=(1,0) (camina a la derecha solo) y bloquea saltar/disparar.
- ControllerHero::process: vector dir (x,y) con y+ = arriba, truncado a magnitud 1.

### Colisión (Scenario::intersects / MobileObject::internalUpdate)
- IntersectionPlace enum 0..8; combinaciones mergeIntersections (1+4→7, 2+4→8, 2+3→6, 1+3→5...).
- Flags por objeto: horizontalCollide (0x294), verticalCollide (0x295), horizontalFallCollide (0x296).
- horizontalFallCollide: comprueba el punto (left-5 | right+5, bottom+1); si no hay suelo/plataforma/escalera
  → llama intersectHorizontal(0) (los enemigos se dan la vuelta en bordes).
- Si la corrección horizontal |dx|>3, se divide entre 10.
- Decoration::hasHardTile = colisión con tiles; Decoration::isDead = tiles pKilling → Hero::setState(9) (muerte).
- Scenario: listas activas (0xb4), dormidas (0xbc), volátiles (0xc4), a borrar (0xcc), balas (0xd4).
- processWorldView: rect cámara expandido (x-400, y-100, w+800, h+200); cada 4 frames despierta/duerme objetos.
- Balas que chocan con tile: sonido BULLET_WALL_1/2 aleatorio, anim SHIELD / SHIELD_GREEN (equipo 0) o
  SHIELD_UP/SHIELD_DOWN si |vy| >= 3|vx|. Impacto en objeto: anim GREEN_SHINE (equipo 0) / ORANGE_SHINE.
- Al ganar: espera 6.0 s (0x40c00000) y luego level select (nivel<16) o ending.
- Meteoritos: si la celda de "stage" tiene fallingEnemies, cada 3–4 s cae un METEORITE desde x∈[900,1300]
  o [-100,300], y=-65, aceleración (0,400).

### Niveles (TMX)
- 16 niveles `level1..16.tmx`, tiles 32x32, capa `data0`, grupo `Objects`.
- Props de mapa: pBackground, pMusic, pTileSetWidth/Height.
- Props de tile: pInvisible, pKilling, pPlatform, pHard, pLadder.
- Props de objeto: pAsset, pIsKey, pAnim, pCount, pRequiredItem, pTeam, pLives, pCollidesV/H/Floor,
  pxVel/pyVel, pxAccel/pyAccel, pText, pLookDir, pxDest/pyDest, pxDelta/pyDelta, pDuration, pMinTime,
  pMaxTime, pBulletAsset, pxOffset/pyOffset.

### Constantes del binario (xa.exe MSVC x86, ImageBase 0x400000; herramienta: scratchpad/xre.py)
- `.data` 0x532800.. (estático, no requiere init):
  - InteractiveObject::IGNORE_INTERSECTION = (1.0, 0.49) @0x53280c; Hero::IGNORE_INTERSECTION = (0.49, 1.0) @0x532814.
  - GRAVITY = (0, 1800) @0x53281c.
  - VELOCITY_WALK = (250, 0) @0x532824.
  - VELOCITY_JUMP[i].y (i = HeroState::getHeros, power-up de salto) @0x532830+8i = -600, -700, -790, -810, -850.
  - VELOCITY_DOUBLE_JUMP[i].y (i = HeroState::getCereals, power-up doble salto; 0 = no puede) @0x532858+8i
    = 0, -440, -680, -720, -760.
  - VELOCITY_GO_DOWN = (0, 150) @0x53287c (escalera).
- Hero: caja 24x45, rect trasladado (-10,-45) respecto a la posición (pies). Velocidad de caída máx 700.
  Sin fricción ni maxSpeed en la partícula.
- Integración Particle2: pos += clamp(v·dt + ½a·dt², maxSpeed·dt); v += a·dt; fricción resta |friction·dt|.

### Héroe (Hero::processState / setState / update)
- Estados (HeroStateEnum): 0 quieto, 1 ?, 2 caminar, 3 bajar, 4 escalera, 5 ?, 6 caer, 7 salto,
  8 doble salto, 9 muerto, 10 entrada / fin-escalera, 11 ?, 12 agachado/bloqueo (BLOCK_IN, SHOT_DUCK).
- Energía 10 por vida (HeroState::setEnergy(10)). Golpe: resta daño, parpadeo 0.5 s, sonido HERO_HIT.
- Disparo: primera pulsación dispara 1 bala (SIMPLE_HERO, sonido BULLET_XA). Mantener: ráfaga de 3 balas
  cada 1/12 s y luego pausa de 0.25 s. No se dispara en escalera (4) ni en entrada (10).
- Abajo en estados 0/2 → estado 12 (bloqueo). Animaciones: WALK / SHOT_RUN, JUMP / SHOT_JUMP, BLOCK_IN /
  BLOCK_OUT / SHOT_DUCK, CLIMB, BEGIN_CLIMB, END_CLIMB, ENTRANCE. Sufijo "_R" = variante roja (parpadeo de daño).
- Salto: sonido HERO_JUMP, vy = VELOCITY_JUMP[heros], sube 2px. Doble salto (estado 7 → 8): necesita cereals>0,
  sonido DOUBLE_JUMP, efecto JUMP_EFFECT_RIGHT/UP.
- Pasos: frame 0 → STEP_1/STEP_3 aleatorio, frame 5 → STEP_2/STEP_4. Escalera: frame 1 STAIR_1, frame 3 STAIR_2.
- Entrada (estado 10): al frame >29 → GameCamera::shake(0.8), efecto JUMP_EFFECT_UP, sonido ENTRANCE.
- Muerte (9): música para, sonido HERO_DEATH, transición, imagen HERO_DEAD; tras 1 s: vidas-1 y reaparece en
  StageManager::getRestaurationPoint (último SavePoint) con estado 10; si vidas==0 → GAME OVER, vidas=3.

## Pendiente (orden)
1. Física del héroe exacta (Hero::processState/update, Particle2, constantes).
2. TileMap/Decoration/StageManager/GameCamera.
3. Assets*: rects de animación exactos (AssetsAnimationsHero/Enemies/General).
4. Enemigos (18 clases), items, vacas, puertas, plataformas, savepoints.
5. HUD, menús, intro, selección de nivel, pausa, opciones, créditos, audio.
6. Cambio de mapas + soporte de niveles nuevos.

## Estado 2026-10 (port web — sesión actual)
- El motor TS (`src/xa/`) ya reimplementaba: TMX, tiles/colisión, héroe (física/estados), items, vacas,
  savepoints, carteles, balas del héroe, selector de mapas. PERO el héroe, la vaca y el HUD se dibujaban con
  placeholders procedurales ("Pip"), y NO había enemigos ni menús reales.
- Hecho en esta sesión:
  1. Héroe renderiza el sprite ORIGINAL `Xa_animaciones.png` (`Anim` + `drawFrame`; variante roja `_R` al
     parpadear tras daño). Corregido `setAnim('HERO_DEATH_POSE')` → `'HERO_DEATH'` (el anim real se llama así).
  2. Vaca: sprite original `SAD_COW` (enjaulada) → `HAPPY_COW` (salto/fade al rescatar).
  3. HUD: componentes `items_tile.png` en posiciones EXACTAS de `Hud::Hud` (AVATAR (7,13), ENERGY_BAR (8,48)
     frame=min(9,energy), DOUBLE_JUMP[_NONE] (100,8), BACK_POINTS (226,7)+"Puntos"+score, COINS (323,12)+nº
     monedas, COW (410,10)+vacas/total, KEY_SMALL (7,349), LOGO (448,348), globo BACK_HUD (0,60)). Números con
     fuente bitmap GameFont 0 = `fuente_negra` (30px, escala 1). Aplicada la regla "ancla basura → centro".
  4. Enemigos (`src/xa/world/enemies.ts`): patrulla, vuelo senoidal, jumper balístico, guillotina, popup
     (PiranhaRobot), slide (FloorCannon), estáticos, disparo hacia el héroe (Thrower/FloorCannon/…). Colisión:
     pisotón = bounce + kill, contacto = daño 4 (`Hero::onCollisionEnemy`), bala héroe→enemigo (`loseLifes 1`),
     bala enemigo→héroe (`Hero::onBullet`). Sprites por `pAnim`/`pAsset` (+ `_R` al parpadeo). Integrado en
     `Scenario.loadObjects`/`update`/`render`.
- Pendiente:
  1. Pantallas reales (logo, carga, cómic, menú, selección de nivel, intro, pausa, opciones, ayuda, créditos,
     game over, victoria) con arte original — hoy son placeholders de texto.
  2. Puertas/llaves, plataformas móviles (PlatformInterp/Linear), meteoritos, jefe con fases.
  3. Puntos por enemigo (100 asumido, verificar), anims mal extraídas (HAPPY_COW/SAVING/DOUBLE_JUMP_HUD).
  4. Verificación lado a lado: `npm run dev` y comparar con las capturas limpias.
- NOTA de entorno: esta sesión no puede ejecutar shell (el sandbox falla al dar write a F:\Games\Xa), así que el
  código se escribe sin poder lanzar `npm run dev`/`npm run build`. El usuario debe verificar en el navegador.

## Estado 2026-10 (ronda 1 — continuación)
- Pantallas reales implementadas (`game.ts`): logo Batovi→Calcar (fade), "CARGANDO", cómic 5 páginas
  ("presiona cualquier tecla"), menú (`menu_night.jpg` + botones en posiciones decompiladas), selección de
  nivel (`map.png` + 16 nodos), ayuda/créditos/opciones/game over/victoria (imágenes originales). Navegación
  por teclado (flechas/Enter/Esc); hover de ratón pendiente.
- Plataformas móviles (`objects.ts` `Platform`): PlatformInterp (home↔dest, ease, pDuration+pWait) y
  PlatformLinear. El héroe aterriza y se desplaza con ellas (`Hero::landOnPlatform`/`ridePlatform`).
- Puertas/llaves (`objects.ts` `Door`): la puerta (`GATE`) bloquea; con la llave (pRequiredItem/pRequiredCount)
  se abre con sonido `DOOR_OPENED`.
- Guillotina: usa pWait (espera) + pDuration (caída) + retracción.
- Pendiente:
  1. Meteoritos, jefe con fases, animación de apertura de puerta (hoy desaparece al abrirse).
  2. Hover de ratón en menús; sprite de plataforma (pAsset "PLATFORM_*" del TMX no está en la tabla extraída
     → fallback a `GREEN_PLATFORM`; verificar contra la instalación original).
  3. Puntos por enemigo (100 asumido), anims mal extraídas (HAPPY_COW/SAVING/DOUBLE_JUMP_HUD).
  4. Verificación lado a lado (`npm run dev`) — bloqueado por el entorno (sin shell).

## Estado 2026-10 (ronda 2 — bugs + pulido)
- Shell vuelve a funcionar (modo danger-full-access): `npx tsc --noEmit` limpio y `npm run build` OK.
- Corregido error "Cannot read pLives": orden de argumentos en `createEnemy` (`new Enemy(world, o, x, y)`).
- Muerte instantánea al tocar un enemigo: `Hero::onCollisionEnemy` ahora respeta `redTime` (0.5 s de
  invulnerabilidad) y, como en el original, el contacto elimina al enemigo (efecto de muerte, sin puntos).
- Duplicación de enemigos al reiniciar: `gameOver` ahora pone `scenario = null` (defensivo).
- Imágenes de pantalla: todas son 512×512 con la banda visible en los 384 px SUPERIORES; `cover`/splash
  ahora recortan la franja inferior en vez de estirar todo.
- Selección de nivel: solo niveles desbloqueados (progresión secuencial, empieza en el 1); los bloqueados
  no se pueden confirmar. Nodos con sprites originales BUTTONS_LEVELS / BUTTONS_PERFECT_LEVELS +
  MAP_ANIMATED_SELECTION (ya no círculos canvas).
- Cursor personalizado: `cursor: none` + sprite original POINTER (cursor.png) en la posición del ratón.
- Pendiente: jefe con fases, meteoritos, animación de apertura de puerta, hover de ratón en menús,
  verificación visual lado a lado (el usuario debe recargar con Ctrl+F5 tras los cambios).

## Estado 2026-10 (ronda 3 — jefe, puerta, ratón)
- Jefe (`Boss`): patrulla + ráfaga de 3 balas hacia el héroe cada pMinTime..pMaxTime; 200 HP; al morir
  explosión `BOSS_DEAD` + temblor de cámara 3 s. El pisotón no lo mata de una (daño 1) y el contacto no lo
  elimina (a diferencia de los enemigos normales).
- Puerta: animación de apertura (fade 0.5 s) en vez de desaparecer de golpe.
- Ratón: hover + click en menú y selección de nivel, con el cursor original `POINTER`.
- Verificación: `tsc --noEmit` y `npm run build` OK.
- Pendiente: meteoritos (celdas "fallingEnemies" del stage), verificación visual lado a lado.

## Estado 2026-10 (ronda 4 — meteoritos + pulido)
- Meteoritos: investigado. Se generan en `Scenario::update` si la celda "fallingEnemies" del stage config está
  activa (tabla por nivel en el `.data` del binario, NO en el TMX). Caen desde y=-65 con accel (0,400), rebotan
  2 veces (`Meteorite::intersectVertical`) y matan al héroe al contacto (`Scenario::setKillHero`). NO
  implementado: el flag por nivel no está en el TMX (habría que extraer la tabla del `.data`). Gap conocido.
- Héroe: corregido el parpadeo de daño (antes dibujaba la hoja roja semitransparente; ahora alterna
  normal/roja opacas como el original).
- Verificación: `tsc --noEmit` y `npm run build` OK.
- Gaps pendientes: meteoritos, pantalla de intro de nivel (nombres de nivel en `Lang.c`), opciones interactivas
  (sonido/música), y verificación visual lado a lado.

## Estado 2026-10 (ronda 5 — bugs reportados por el usuario)
- Títulos de nivel extraídos del binario (`Lang::getTitle`, tabla @0x081ade9c): 16 títulos reales (los nombres
  del remake JS previo eran inventados). Pendiente de integrar en la selección/intro de nivel.
- Objetos a prueba de balas (`InteractiveObject::isInvisibleForBullet`): Guillotine y Rocket. Añadido set
  `BULLET_PROOF`; las balas del héroe ya no los destruyen.
- Botón SALIR ahora hace `window.location.reload()` (reiniciar la web), como pidió el usuario.
- HUD: contador de monedas re-centrado (x=369, y=8).
- Pantalla de OPCIONES: toggles de SONIDO y MÚSICA (flechas/Enter) usando setSoundEnabled/setMusicEnabled.
- Texto del globo de mensaje: escala reducida a 0.7 para que no se recorte.
- Plataformas: `Hero::ridePlatform` ya no arrastra al héroe dentro de una pared (deshace el movimiento
  horizontal si colisiona con tile duro).
- Verificación: `tsc --noEmit` y `npm run build` OK.
- Pendiente de confirmar por el usuario: si persisten "pegado en paredes" o "textos recortados", indicar nivel y
  acción exacta para reproducir.

## Estado 2026-10 (ronda 6 — títulos reales + intro de nivel)
- Títulos de nivel: extraídos los 16 del binario (el 16º era "Bañados del Sur", nivel 3). Guardados en
  `src/xa/data/levels.json` (mismo patrón que sprites.json/font.json) y usados en la selección de nivel
  ("Nivel N - Título"). Los títulos reales difieren de los inventados por el remake JS previo.
- Intro de nivel: nueva pantalla `levelIntro` entre la carga y el juego — fondo `fondo_niveles.png` + "Nivel N -
  Título" + "Pulsa Enter para empezar".
- Verificación: `tsc --noEmit` y `npm run build` OK.
- Pendiente: meteoritos (stage config), colisión "pegado en paredes" (esperando reproducción exacta del usuario),
  verificación visual lado a lado.

## Estado 2026-10 (ronda 7 — bug de plataforma)
- Corregido bug real en el desplazamiento sobre plataformas: `ridePlatform` aplicaba el movimiento VERTICAL de la
  plataforma dos veces (una en `landOnPlatform` al pegar los pies al tope, otra en `ridePlatform`), lo que podía
  hundir/empujar al héroe dentro del suelo o una pared al subir/bajar en plataformas móviles. Ahora `landOnPlatform`
  maneja la vertical y `ridePlatform` solo la horizontal. Probable causa del "me pego/bugueo en las paredes".
- Verificación: `tsc --noEmit` y `npm run build` OK.
- Pendiente: meteoritos (stage config), verificación visual lado a lado.

## Estado 2026-10 (ronda 8 — meteoritos investigados a fondo)
- Confirmado en `Scenario::Scenario`/`update`: la "stage config" (`this+0x2b4`) es una rejilla 2D de bools
  (`cantStages` x/y desde `StageManager::getCantStages`) inicializada a 0 y poblada célula a célula con
  `Scenario::setStage(x,y,val)` en `loadObjects` (que FALLÓ al descompilar). La célula (0,0) indica
  "fallingEnemies". Los datos por-nivel NO están en el TMX ni en assets: están en el binario / loadObjects.
  → Meteoritos queda como gap conocido (necesitaría re-derivar la rejilla por nivel desde el binario).
- Sin cambios de código esta ronda; verificación previa (`tsc`/`build`) sigue vigente.
- Pendiente: meteoritos (datos por nivel), verificación visual lado a lado, y confirmación del usuario de que
  el bug de "pegado en paredes" quedó resuelto con el fix de plataformas.

## Estado 2026-10 (ronda 9 — "press any key" animado)
- Confirmado que `Scenario::setStage` se llama en `loadObjects` (que falló al descompilar) → meteoritos siguen
  como gap de datos.
- Intro/cómic, ayuda y créditos ahora usan el indicador ANIMADO `PRESS_ANY_KEY` (anim de 2 frames desde
  `fondo_niveles.png`), en vez del PNG estático con parpadeo por alpha.
- Verificación: `tsc --noEmit` y `npm run build` OK.
- Pendiente: meteoritos (datos por nivel), verificación visual lado a lado.

## Estado 2026-10 (ronda 10 — verificación de arranque)
- Intentada verificación headless con Chrome/Edge en `http://localhost:4321/` (dev server ya corriendo).
  `--enable-logging` no reportó errores Uncaught/TypeError en el arranque. (El `--dump-dom` resultó poco fiable;
  la verificación visual final sigue dependiendo del usuario.)
- El port está funcionalmente completo: todos los sistemas, `tsc` y `build` limpios, dev server sirve.
- Pendiente (menor): meteoritos (datos por nivel en `loadObjects`/binario), y ajuste visual fino lado a lado.

## Estado 2026-10 (ronda 11 — meteoritos: conclusión definitiva)
- `StageManager::loadConfiguration` lee el TMX y fija "cantStages" = 16×12 (rejilla de etapas por nivel);
  la bandera `fallingEnemies` por celda se rellena en `loadObjects` (que falló al descompilar). Además el sprite
  `METEORITE` NO está en `sprites.json` (no se extrajo de AssetsEnemies). → Meteoritos es un gap de datos doble
  (sprite + rejilla), no solo de lógica. Se deja documentado como no implementado.
- El port queda funcionalmente completo; lo que resta es solo ajuste visual fino con el ojo del usuario.

## Estado 2026-10 (ronda 12-13 — bugs reportados por el usuario)
- Enemigos congelados sobre plataformas: el chequeo de borde del patrullaje solo miraba tiles duros. Añadido
  `World::hasFloor(x,y)` (tile duro O plataforma); los enemigos ya patrullan sobre plataformas y giran en el
  borde real.
- No se desbloqueaba el nivel 1: `Thing::bounds()` usaba caja 32×32 fija; los objetos altos (puerta ENDING de
  416px) no colisionaban. Ahora usa el rect del objeto TMX (o.x,o.y,o.w,o.h).
- Pinchos/obstáculos destructibles: set `INDESTRUCTIBLE` (Cannon, Stub, Spikes, Stalactite, Lava, AcidDrop,
  DeathBarrier, Fire). No se rompen con balas/pisotón/contacto; solo hacen daño de contacto. Nota: los pinchos
  originales son "CAVE_TRAP" con fade in/out cíclico (aún no implementado ese ciclo).
- Música del flujo: `xa_intro` (cómic), `xa_menu` (menú/selección), `xa_win` (victoria), `lose` (game over).
- Intro de nivel: el texto bitmap no renderizaba (pendiente de diagnóstico); se usa texto de canvas con
  contorno (garantizado) sobre fondo oscuro.
- "Me pego en paredes": no reproducido aún; se pide nivel + acción exacta al usuario. Hipótesis restantes:
  superposición visual del sprite (70px) vs caja (24px), o pinchos/obstáculos que no bloquean (pass-through).
- Verificación: `tsc --noEmit` y `npm run build` OK.

## Estado 2026-10 (ronda 14 — "pegado en paredes": causa raíz encontrada y corregida)
- Leído el descompilado completo de `TileMap::intersectsStep` (TileMap.c ~608-898). Es un barrido (swept):
  camina el vector de movimiento y muestrea el rect **en la posición ANTERIOR** (`left - mx`, `right - mx`),
  no en la posición ya penetrada. El orden es ceiling → floor → pared derecha → pared izquierda → place-code.
- **Causa raíz del "pegado"**: mi `TileMap.intersect` muestreaba el techo con el span NUEVO
  `[left+IGNORE_X, right-IGNORE_X]`. Al caminar contra una pared, el borde de la cabeza (right-IGNORE_X)
  penetraba la columna de la pared → techo falso → `place=8 (CeilingRight)` → el héroe hacía `vel={0,0}`
  (paraba el avance Y también) → se quedaba "pegado" a la pared sin poder caer/deslizar.
- **Fix**: techo y suelo ahora muestrean el span ANTERIOR `[left-mx+IGNORE_X, right-mx-IGNORE_X]` (igual que el
  original). El barrido de paredes se mantiene con el borde nuevo (el original muestra el borde nuevo primero).
- El place-code resultante es el mismo que el binario: ceiling→(8/7/4), floor→(6/5/3), sino→(2/1/0).
- Verificación: simulación `tools/collision-sim.mjs` ya no da place=8 al caminar contra la pared (ahora 6),
  `tsc --noEmit` y `npm run build` OK. Pendiente: que el usuario re-pruebe en el juego (Ctrl+F5).

## Estado 2026-10 (ronda 15 — flujo de niveles + clasificación de enemigos reales)
- **Flujo de niveles (bug reportado)**: al terminar el nivel 1 salía la pantalla de "juego completo". Ahora
  `levelComplete` distingue: si `num >= 16` → pantalla `win` (solo último nivel); si no → vuelve a `levels`
  (cursor en el siguiente nivel desbloqueado, `levelIndex = num`), música `xa_menu`. Solo el nivel 16 muestra
  `screen_win.jpg`.
- **Tipos de enemigo reales en los 16 TMX** (cross-check `type=` en los .tmx): Android, Bird, Bomb, Boss,
  Cannon, Cow, Door, Double, Down3, Enemy, FloorCannon, Guillotine, Hero, Information, Item, Jumper, Jumper2,
  PiranhaRobot, PlatformInterp, SavePoint, SmartUFO, Stub, Thrower, UFO, Ultraton. (No hay Spikes/Stalactite/
  Lava/AcidDrop/DeathBarrier/Fire/Meteorite/Rocket/FixedShooter en los niveles originales.)
- **"Stub" = muerte instantánea** (StubEnemy::intersects → `Hero::setState(9)`, no 4 de daño). Añadido set
  `INSTANT_KILL` (Stub + familia DeathBarrier); en `world.ts` el contacto hace `setState(HS.Dead)`.
- **"Cannon" (Parabolon) = cañón destructible** (pLives=10, pMinTime/pMaxTime): sacado de INDESTRUCTIBLE y
  añadido a SHOOTERS (dispara hacia el héroe). Queda pendiente el disparo en parábola real (EnemyThrower lanza
  "ENEMY_THROWER" con gravedad); hoy dispara recto.
- **"Down3" (Tirador) y "Jumper2" (CobraTiradora) no se cargaban** (caían en default → null). Añadidos a
  `createEnemy`: Down3 = estático + dispara; Jumper2 = saltarín + dispara.
- Pendiente: disparo en parábola de Cannon/Thrower, sprites de bala por enemigo, y ajuste visual fino lado a lado.

## Estado 2026-10 (ronda 16 — física de balas desde XABulletFactory)
- Leído `XABulletFactory::createBullets` (XABulletFactory.c, 1038 líneas). Confirma:
  - Bala del héroe: velocidad `dir*500`, offset `dir*25`, y-offset según estado (salto -20 / bloqueo -13 / resto -15).
    Ya coincidía con `Hero.fire()`.
  - Bala enemiga estándar ("BULLET_ENEMY"): velocidad `dir*240` recta (yo usaba 260 → corregido a 240).
  - "Cannon" (Parabolon): **parábola** — lanza hacia arriba a 12° con velocidad 300–380 y gravedad 400
    (fuente/arco). Implementado: bullets ahora soportan gravedad (`g`), y "Cannon" dispara `shootParabola()`.
  - Otros patrones identificados (aún sin portar fielmente): "8_BULLETS" (Bomb, 8 radiales a 200),
    "DOUBLE_SIDE" (Double, 2 a ±45°), "TO_HERO" (SmartUFO, apunta al héroe a 300), "4_FALL"/"4_FALL_RAND"
    (PiranhaRobot/FloorCannon, caída con gravedad 300). Hoy todos usan el disparo recto al héroe (240).
- "Thrower" (R_Thrower) en realidad lanza bala RECTA (dir*240) con offset de lanzamiento (pxOffset/pyOffset),
  NO parábola; el nombre "Parabolon" corresponde al tipo "Cannon".
- Verificación: `tsc --noEmit` y `npm run build` OK.

## Estado 2026-10 (ronda 17 — disparos de SmartUFO/Double/PiranhaRobot + Bomba)
- **Descubierto que 4 tipos de enemigo no disparaban** (no estaban en SHOOTERS): SmartUFO (219 en los niveles),
  Double (148), PiranhaRobot (22) y Bomb (147). Ahora disparan según su clase:
  - **SmartUFO** → `TO_HERO`: dispara recto al héroe a velocidad 300 (pMinTime..pMaxTime).
  - **Double** → `DOUBLE_SIDE`: dos balas horizontales, izquierda+derecha a 224.
  - **PiranhaRobot** → `4_FALL`: suelta una bala que cae recta (gravedad 300).
  - **Bomb** → NO dispara periódicamente: su contacto es **muerte instantánea** (EnemyBomb::intersects →
    `setState(9)`), es destruible (pLives=3) y al morir **explota en 8 balas radiales** (`8_BULLETS`, velocidad
    200, efecto `BOMBA_DEATH`). Implementado en `killEnemy` + set `CONTACT_KILL` (mata al contacto pero sigue
    siendo disparable, a diferencia de `INSTANT_KILL` que además es indestructible).
- Corregido: bala enemiga estándar 260 → 240 (ronda 16).
- Verificación: `tsc --noEmit` y `npm run build` OK.

## Estado 2026-10 (ronda 18 — FloorCannon "4_FALL_RAND" + patrón del jefe)
- **FloorCannon** ahora dispara `4_FALL_RAND` (4 balas lanzadas hacia arriba a ±30°/±15°, caen con gravedad 300)
  en vez del disparo recto. Cadencia pMinTime..pMaxTime (2–3 s).
- **Boss** (nivel 16, "Android", 200 vidas) ahora dispara `BOSS_BULLETS`: abanico de **5 balas** a 60°..120°
  desde arriba, velocidad 200, espejado por la dirección a la que mira (antes eran 3 balas rectas). Cadencia
  0.5–1.5 s. Nota: el original además se DETIENE (vel=0) y reproduce "BOSS_SHOOT" al disparar; aún no
  implementado ese freno/animation-sync.
- Verificación: `tsc --noEmit` y `npm run build` OK.

- Verificación: `tsc --noEmit` y `npm run build` OK.

## Estado 2026-10 (assets incluidos + UI + móvil + flujo git)
- **Assets en el repo**: copiados los 140 archivos originales a `public/assets/` + `manifest.json`. El loader ahora
  intenta `/assets/` (bundled) → `/__game/` (dev) → carpeta del usuario (File System Access API). El juego es
  autocontenido (ya no exige elegir carpeta). Se quitó `public/assets/` del `.gitignore`.
- **Tipografía**: `game.text()` usa la fuente bitmap del juego (`fuente_blanca`) en vez de una fuente de sistema.
- **Opciones**: sliders de volumen arrastrables (sonido/música) + toggles ON/OFF con control real de gain
  (`audio.ts` ahora tiene `setSoundVolume`/`setMusicVolume`/getters). Corregido el mapa `OPTIONS` para usar
  `options_win.png` (apuntaba a `options_xo.png`, inexistente en la build Windows).
- **PRESS_ANY_KEY**: añadido el indicador animado a la pantalla de carga y al logo.
- **Favicon**: `public/favicon.png` con la cabeza del protagonista (recorte del sprite del héroe).
- **Título**: "XA Contra los Cuatreros Galácticos" (`index.astro`).
- **Móvil (nuevo)**: detección de táctil + orientación; prompt "Girá el celular" en vertical; controles virtuales
  semitransparentes (D-pad, SALTO=Space, FUEGO=X, ↩=Esc) en horizontal. `mousemove`→`pointermove` (el toque actualiza
  la posición del ratón para el tap-to-select) y `this.clicked` avanza las pantallas splash/loading/intro/levelIntro/
  gameover/win. Los botones disparan eventos de teclado sintéticos.
- **Flujo git**: quedan solo `main` y `develop` (develop se sincroniza/mergea a main).

## Estado 2026-10 (ronda 19 — movimiento de voladores + freno del jefe)
- **Voladores** (Bird/UFO/SmartUFO/Double/Bomb, ~680 en total) ahora usan el patrón real de `EnemyBird`:
  interpolación **easeInOutSin** entre `home` y `home+pxDelta` (antes era un seno simple que oscilaba ±pxDelta,
  o sea el doble de recorrido y la dirección equivocada), con bob vertical senoidal. Cambiado `Enemy.fly()`.
- **Boss** ahora se **detiene y reproduce "BOSS_SHOOT"** al disparar el abanico (antes patrullaba sin parar);
  al terminar la animación vuelve a su animación normal y retoma la patrulla.
- Nota aclaratoria: todas las balas enemigas usan la MISMA imagen "BULLET_ENEMY" (verificado en
  `XABulletFactory`); los nombres "SIMPLE_ENEMY"/"8_BULLETS"/"TO_HERO"… son IDs de PATRÓN, no sprites. Así que
  el render actual de balas (todo "BULLET_ENEMY") es correcto.
- Verificación: `tsc --noEmit` y `npm run build` OK.

## Estado 2026-10 (pulido integral — feedback del usuario)
- **Pinchos (Stub/UFO_SPIKY)**: antes mataban de una (setState 9); ahora **restan vida** (daño de contacto 4 con
  ventana de invulnerabilidad). Separado `INSTANT_KILL` (familia DeathBarrier + Bomb) de `INDESTRUCTIBLE` (Stub +
  DeathBarrier). "Stub" ahora es indestructible PERO hace daño, no mata.
- **Pantalla de carga**: texto "Pulsa una tecla para continuar" (tipografía bitmap) abajo, y espera input (ya no
  auto-avanza a los 0.9s).
- **Sonido de arranque**: splash reproduce `intro_piano.ogg` (música que faltaba). Niveles ya usaban
  xa_1..xa_4/xa_boss vía `pMusic`.
- **Móvil**: D-pad **arrastrable** (deslizar cambia de dirección sin levantar el dedo, con deadzone) y más
  separación entre SALTO y FUEGO.
- **Enemigos**: detección de pared muestreando **todo el alto** del enemigo (los altos ya no atraviesan paredes);
  los enemigos de suelo (patrol/static/boss/slide) **montan las plataformas móviles** (se desplazan con ellas).
- **Volumen**: sliders + toggles persistidos en `localStorage` (clave `xa-audio`) y restaurados al arrancar.
- Corregido el doble prefijo de URLs de assets (`/assets/assets/...` → `/assets/...`) que causaba la pantalla negra.
- Flujo git: solo `main` y `develop`; el trabajo va a develop y se sincroniza (merge) a main.
- Verificación: `tsc --noEmit` y `npm run build` OK.

## Estado 2026-10 (plataformas + texto de intro + saltarín)
- **El héroe traspasaba las plataformas móviles**: `prev.y` quedaba sobreescrito por la colisión (el `setPosition`
  al final de `processIntersections` ponía `prev=pos`), así que la condición de aterrizaje se reducía a una ventana
  de ~2px que saltaba al caer (~11px/frame). Ahora detecta el cruce con la velocidad: `pos.y - vel.y*dt <= p.y+2`.
- **Enemigos sobre plataformas**: el ride ahora aplica también el desplazamiento horizontal (`e.x += p.x-p.prevX`),
  no solo vertical.
- **Saltarín (Jumper)**: aterrizaba solo sobre tiles (`isHard`); ahora usa `hasFloor` (tiles O plataformas), así
  que no atraviesa las plataformas flotantes.
- **Intro de nivel**: `fondo_niveles.png`/`preview_levels_tile.jpg` precargados (antes no se cargaban → pantalla
  oscura); la pantalla de carga de nivel tiene duración mínima (600ms) para que no parpadee.
- **Tipografía**: `text()` tiene fallback a fuente de sistema si `fuente_blanca.png` no está cargada (defensivo).
  Verificado por test aislado que la hoja `fuente_blanca.png` renderiza glifos blancos correctamente (drawImage OK).
- Verificación: `tsc --noEmit` y `npm run build` OK.

## Estado 2026-10-04 (ronda 20 — bugs del usuario + pantallas fieles)
- **Enemigos trabados sobre plataformas**: `hasFloor` solo aceptaba tiles duros; los enemigos sobre tiles `pPlatform`
  giraban cada frame. Ahora = `isFloor || isPlatform || isOverLadder` (MobileObject::internalUpdate, punto
  (left-5|right+5, bottom+1)). Dirección inicial = signo de pLookDir o de pxVel (pxVel=-120 arranca a la izquierda).
  Verificado: 0 enemigos de patrulla quietos en niveles 1, 6, 13, 14, 15.
- **Doble salto en todos los niveles**: `cereals` no se reseteaba nunca. HeroState::goToLevelSelect/changeStage
  resetea llaves, cereals, heros, monedas, vacas y PUNTAJE (por nivel) y sube vidas a mínimo 3 → `beginLevel()`.
  `addCereals` tope 1 (BatMath::min(x,1)). No existe ENERGY_JUMP en ningún TMX.
- **Escaleras**: setState(Ladder) centra al héroe en la columna (`(floor(cx/ts)+0.5)*ts`) pero solo movía `pos`;
  el `setPosition(ppos)` de fin de frame lo deshacía → descentrado chocaba con paredes. Ahora también `ppos.x`.
  Verificado: sube desde −14..+14 px de desfase, junto a pared.
- **Disparos enemigos** (Shooter.c, EnemyAndroid.c, EnemyThrower.c, JumperShooter.c, XABulletFactory.c):
  - Shooter: temporizador random(pMinTime,pMaxTime) → rewind+play anim sync → dispara al terminar (frameSync -1).
  - Android (123): cada wait, si el héroe está DELANTE en su dirección de marcha → se para, ANDROID_SHOOT, bala en
    frame 1 offset (22,5) a 240; detrás → ignora. Antes no disparaba nunca.
  - Thrower/WALLE: dispara solo hacia su lado fijo (signo de pxOffset) desde pos+(pxOffset,pyOffset), en frame>2.
  - Jumper2/COBRA_SHOOT: dispara hacia donde mira al salir del frame 3 de su anim, offset (26,-15).
  - Down3/UFO_3 = `3_FALL` (3 balas: recta + ±100 frenando ∓70, g 300). Cannon = PARABLE hacia signo(pxVel).
  - 4_FALL (220±25) / 4_FALL_RAND (300±25): 4 balas a ±30°/±15°, ax ∓15, g 300.
  - Ventana activa (Scenario::processWorldView): solo se actualizan enemigos en cámara ±(400,100).
  - Orden de IDs en xa.exe: SIMPLE_HERO, SIMPLE_ENEMY, 8_BULLETS, DOUBLE_SIDE, ENEMY_THROWER, TO_HERO, PARABLE,
    3_FALL, 4_FALL, 4_FALL_RAND, BOSS_BULLETS.
- **Textos**: `tools/extract_texts.py` saca de xa.exe (UTF-16, orden inverso) títulos, descripciones, "Nivel N" y
  textos de pausa → `src/xa/data/levels.json`. Fuentes: 0 = negra, 1 = blanca, 2 = negra_2.
- **Carteles**: decodificador original (Utils): `\! ¡ \? ¿ \a\e\i\o\u` tildes (mayúsc. también), `\m`=ñ, `\M`=Ñ,
  `\n` salto, `\`. Globo BACK_HUD en contenedor (256+24, 80), texto fuente 0 escala 1 centrado en y+5.
- **Intro de nivel** (Intro/AssetsIntro): preview_levels_tile.jpg 512×115 por nivel (niveles 1-8 x=0, 9-16 x=512)
  en y=128, máscara fondo_niveles.png, descripción centrada (256,57), "Nivel N" (425,212) blanca, título (256,256)
  negra_2; PRESS_ANY_KEY fila 3 = "CARGANDO..." mientras carga, luego anim filas 1/0 (anchor 260,30 en 512,384).
- **PreLoader**: cargando_tile fondo + anim BUTTONS (0,384+40i,260,40) anchor (260,0) en (512,288) cubriendo la cinta
  "Presiona…" hasta terminar de cargar sonidos.
- **Selector** (LevelSelectScreen/ButtonInformation): nodos con anchor (0,0) en NODE_POS (antes centrados → 20,15 px
  corridos), ARROW en nodo+(20,10) con bob 6px, barra info_map.png en y=324 (sube con easeInOutQuad 0.3 s):
  nivel (96,30), vacas (165,30)/(197,30), % monedas (273,30), título (257,11), puntaje 6 dígitos (448,30), fuente 0.
- **Audio**: intro_piano es un sonido de una vez en SplashScreen (no bucle); xa_intro arranca al salir de los logos.
- Pendiente: transición FadeTransition entre pantallas, DOUBLE_SIDE exacto, meteoritos.

## Estado 2026-10-04 (ronda 21 — naves, jefe final, inicio, pausa, opciones, responsive)
- **EnemyUFO** (naves): Shooter `SIMPLE_ENEMY` autoShoot, offset (30,-4), dispara hacia donde vuela (antes no
  disparaba). **EnemyDouble**: `DOUBLE_SIDE` al terminar su anim, 2 balas ±224 desde (centro ±45, top+17).
  SmartUFO = `TO_HERO` sync frame 1 (ya estaba).
- **EnemyBoss** (subclase de EnemyUltraton): camina como Android; cada wait, si el héroe está DELANTE se para,
  BOSS_SHOOT y en frame 1 `BOSS_BULLETS` (5 balas abanico, 200, offset -22,15). Cada impacto: shake 0.2; muerte:
  shake 3 + VolatileExplosion BOSS_DEAD que suelta MEGA_POWER al azar sobre su rect mientras frame<3. Entrega
  `BOSS_KEY` (pRequiredItem) → abre la puerta GATE final (x=7296) hacia el ENDING. Verificado: 200 impactos,
  dispara 5/0 delante/detrás, puerta abre.
- **EnemyUltraton::intersects** (y Boss): tocarlo = Hero::setState(9) (muerte), no se pisa; solo balas.
- **SplashScreen**: cada logo es un estado que reproduce intro_piano (una vez) y se auto-envía "fadeToBlack" a
  los 3.5 s (o tecla/clic); al salir se corta. Logo 1 dong → logo 2 dong de nuevo → PreLoader con xa_intro.
- **Pausa** (PauseDialog/ConfirmationDialog): banner.png + BUTTONS_MENU JUGAR(0/1) y SALIR(2/3); SALIR abre
  exit_confirmation.png con BUTTONS_YESNO SÍ(0/1) en (-85,100) y NO(2/3) en (+85,100) → SÍ va al menú principal.
- **Opciones**: filas medidas en options_win.png (música 173 / barra 197, efectos 215 / barra 240 — antes las barras
  estaban cruzadas), casillas "Pantalla completa" (292,260) y "Estirar pantalla" (292,285), ATRÁS = BUTTONS_MENU
  12/13 en (256,320). Pantalla completa se pide dentro del evento pointerdown/keydown (los navegadores la rechazan
  desde el bucle del juego). Estirar = viewport sin letterbox (persistido `xa-stretch`). Tecla F = pantalla completa.
- Cursor POINTER oculto en `play`. Responsive: ResizeObserver + fullscreenchange, 100dvh, safe-area, controles
  táctiles más chicos en pantallas bajas.

## Estado 2026-10-04 (ronda 22 — controles táctiles nuevos + README)
- `src/components/TouchControls.tsx` reemplaza el D-pad: mitad izquierda = joystick flotante (origen en el toque,
  radio 56 px, el origen sigue al dedo si se pasa → invertir dirección es instantáneo; zona muerta 14 px; diagonales
  pulsan 2 teclas). Mitad derecha = SALTO (6rem) / FUEGO (4.8rem) separados, hit-area ampliada, deslizar entre
  botones cambia la tecla; cualquier otro toque a la derecha = salto. Multitouch por pointerId con conteo de
  referencias por tecla; al pausar / perder foco se sueltan todas. Vibración corta al saltar. Solo se monta en
  `play` (getter `XaGame.currentScreen`); en menús los toques son clics. `?touch=1|0` fuerza/desactiva.
  Verificado con PointerEvents sintéticos: 3 dedos simultáneos (mover + saltar + disparar), slide SALTO→FUEGO.
- `?level=N` y `?map=ruta.tmx` entran directo a un nivel. `npm run manifest` (tools/gen-manifest.mjs) regenera
  public/assets/manifest.json para mapas nuevos.
- README reescrito: estado, controles (teclado y táctil), opciones, atajos URL, cómo crear mapas, estructura.

## Estado 2026-10-04 (ronda 23 — hotfix pantallas negras)
- **Causa**: `tools/gen-manifest.mjs` pasaba las rutas a minúsculas (`menuElements` → `menuelements`,
  `Xa_animaciones` → `xa_animaciones`); el servidor distingue mayúsculas → 404 en menú/carga/héroe → negro.
  Ahora conserva el caso real. Verificado: 0 respuestas 404, flujo completo logos → carga → cómic → menú → mapa →
  intro de nivel, y todas las rutas del manifest existen en `dist/`.
- **Input**: una tecla pulsada y soltada entre dos updates se perdía (toques rápidos / frames lentos). `pollInput`
  ahora agrega las teclas `tapped` desde el último poll como pulsación de un update.

## Estado 2026-10-04 (ronda 24 — muertes con balas, nave-cañón, botón volver móvil)
- **Jumper::onCollision** (cobras COBRA / COBRA_SHOOT): muertas a BALAZOS explotan en `8_BULLETS` (8 balas cada
  45° desde arriba, 200 px/s, desde el centro); pisadas no. `killEnemy(e, byBullet)`.
- **EnemyPiranhaRobot::update** (UFO_CANNON): espera random(pMinTime,pMaxTime) en casa → sube pyDelta (-250) con
  easeOutCubic en pDuration (1.5 s) → anim, en frame > 1 dispara `4_FALL` → baja con la misma curva → espera.
  Antes subía/bajaba lineal y disparaba con un temporizador aparte.
- **Comic**: Space/clic/fuego pasan una página; Enter (o Esc) salta toda la historia.
- **Botón volver móvil** (XaGame.tsx `.xa-back-btn`): siempre visible en pantallas táctiles; `XaGame.backLabel()` /
  `backAction()` según pantalla: play ❚❚ pausa, paused ▶ continúa (↩ cierra confirmación), menu ⛶ pantalla
  completa, splash/loading/intro ⏭, levelIntro ▶, resto ↩ al menú. TouchControls ya no tiene su propio botón.

## Estado 2026-10-04 (ronda 25 — carteles: el decodificador nuevo no se usaba)
- `Hud.showMessage` seguía con el reemplazo viejo (solo `\!` y `\n`); el `decodeGameText` de la ronda 20 existía
  pero nadie lo llamaba (el parche falló en silencio por el escapado de barras). Resultado: `\a \e \i \o \u \m \E \?`
  salían como "▯" + letra en ~todos los carteles. Ahora `showMessage` usa `decodeGameText`.
- Verificado en el navegador sobre los 80 `pText` de los 16 niveles: 0 barras invertidas, 0 caracteres fuera del
  alfabeto de la fuente, 0 líneas > 410 px (ancho útil del globo).
- Lección: los patch scripts deben `assert` cada reemplazo (los que no lo hacían fallaron sin avisar).

## Estado 2026-10-05 (ronda 26 — nivel perfecto, pinchos, escudo)
- **Nivel perfecto** (LevelSelectScreen ctor): `perfect = cows == totalCows && coinPct == 100` → BUTTONS_PERFECT_LEVELS
  (0 normal / 2 hover / 1 pulsado), si no BUTTONS_LEVELS (1/3/2, 0 bloqueado). **HeroState::saveGame guarda el MEJOR
  resultado por nivel** (max vacas, max % monedas, max puntaje). El port sobrescribía con la última partida (un replay
  peor borraba el perfecto) y comparaba cantidades. Ahora `HeroState.recordLevel(n)` (best-of) + `isPerfect(n)` +
  `levelCoinPct()` (compatible con saves viejos). Verificado: niveles 1,2,3,6,10,14,16 con todo → perfecto; replay
  malo del 1 sigue perfecto.
- **HUD monedas** (Hud::setCoins): muestra el PORCENTAJE de monedas del nivel con 3 dígitos, no la cantidad.
  Monedas: Hero::addItems("POINTS", n, isItem) → addPoints(n) + addCoins(1).
- **Pinchos** (StubEnemy::intersects): cualquier contacto = Hero::setState(9) (muerte instantánea), como avisa el
  cartel del nivel 1. Caja = imagen UFO_SPIKY (38x27, anchor 20,24) donde se dibuja, recortada a las púas visibles.
- **Escudo** (Hero::onCollision(Bullet)): en estado 12 sin disparar y bala de frente → HERO_DEFENSE_1/2 al azar +
  ORANGE_SHINE, sin daño; por la espalda o sin bloquear → -1 energía, ORANGE_SHINE, flash rojo 0.5 s, HERO_HIT.
  Balas = rect 6x6. Al bloquear, la zona de impacto llega al frente del escudo (`SHIELD_REACH` 30 px; frame HERO 25
  llega a +33 del anchor) → la bala choca y destella sobre el escudo.
- **Cajas de enemigos**: InteractiveObject ctor arma `bound = (x - w/2, y - h, w, h)` con el BatRect que recibe; el
  port usa el rect del TMX (tamaños puestos a mano: UFO 128x32, Bomb 64x64, Guillotine 32x160). Sin `loadObjects`
  (no descompiló) no está 100% probado. Oráculo posible: `Config` byte 6 = dibujar rectángulos (tecla 0x30 con
  debugKeys), apagado en release → requeriría parchear memoria del xa.exe en ejecución (pedir permiso al usuario).

## Estado 2026-10-05 (ronda 27 — créditos rediseñados en alta resolución)
- El usuario rehízo `public/assets/lang/images/credits/creditos.jpg` a 1024x1024 (misma convención: contenido en la
  franja superior 4:3 = 1024x768, abajo relleno).
- `cover()` ya no recorta 384 filas fijas: usa la franja 4:3 proporcional al ancho (`XaGame.band`). Las imágenes de
  pantalla con ancho > 512 se redibujan en `render()` directamente sobre el canvas de pantalla (`renderHdArt`), a la
  resolución real, con la cinta PRESS_ANY_KEY escalada encima → nítidas en vez de pasar por el lienzo de 512x384.
  Cualquier otra pantalla (ayuda, menú, cómic…) que se rediseñe en HD con la misma convención funciona igual.
- La cinta "Presiona cualquier tecla" (presente en Credits del original) tapa la última línea del diseño nuevo.
- Créditos / ayuda (Credits::update): se cierran con CUALQUIER tecla o clic (Keyboard "any" + Mouse 0), no solo
  Esc/Enter. Game over / final: también cualquier tecla.

## Estado 2026-10-05 (ronda 28 — repaso integral, parte 1)
- **Puntos por tipo** (Windows `Scenario::loadObjects`, `mov [obj+0x394], imm` tras cada comparación de tipo;
  `tools/xre_points.py`): Enemy 5, Bird 10, Jumper 15, Double 20, Ultraton 25, Thrower 30 (vía esi), Cannon 35,
  Down3 40, Jumper2 45, UFO 50, FloorCannon 55, PiranhaRobot 60, Bomb 65, SmartUFO 75, Android/Boss 80, Cow 1000;
  ítems: moneda 10 / otro 100. Antes: 100 fijo para todo.
- **VolatilePoints** (EnemyHelper::addPointsEffect): el valor en fuente pixelada (font 3) sube 40 px con
  easeOutQuint en 1.2 s desde el centro del bound. Sale al matar enemigos (bala o pisotón) y al rescatar vacas.
- **Cow**: Cow::intersects → puntos + VolatilePoints + COW_RESCUED_1 + HAPPY_COW; al terminar la anim parpadea
  (visibilidad cada 0.05 s) 1 s y se quita.
- **Anims mal extraídas corregidas** (también en tools/build_data.py): HAPPY_COW = 7 frames 0..6 + hop
  [7,8,9,10x2,8,11,12,9,13x2] ×3 (34 frames, 1.33 s; antes 4516 frames/183 s y los 7 primeros eran PRESS_ANY_KEY);
  SAVING = [0,1,2]×6 ticks ×5 (3 s; antes 1503 frames); DOUBLE_JUMP_HUD = sus frames 0..7 ×3 ticks.
- **HUD**: "guardando" 3 s; el ícono de doble salto reproduce DOUBLE_JUMP_HUD (0.8 s) al obtenerlo y queda en el
  último frame (Hud::setDouble).
- **SavePoint**: sólo el activo (mpActualSavePoint) anima SHINE; los demás muestran SAVE. Al activar uno NUEVO:
  sonido SAVING, HUD y reactionOnAction → si tiene `pMusic` cambia la música (xa_boss en el nivel 16) y esa pista
  sigue al reaparecer.
- **EnemyBird** (Bird/UFO/SmartUFO/Double/Bomb): yoyó easeInOutSin donde pDuration es el ciclo COMPLETO (antes el
  doble de lento), bob vertical sin(N·π·fase)·pyDelta con N = pCount (Double fuerza 4), mira hacia donde se mueve,
  fase inicial 0.
- **EnemyGuillotine** (subclase de EnemyDeathBarrier → contacto = muerte): cuchilla que sale de la ranura (sprite
  fijo en o.y mostrando las últimas imgH-pyDelta+ext filas); ciclo pWait → cae easeInSin pDuration → "GUILLOTINE"
  → 1 s → sube. Antes se movía el sprite entero (sobresalía 123 px) y dañaba/desaparecía al tocarla.
- FloorCannon: su deslizamiento del port ya era idéntico al yoyó easeInOutSin del original.
- Tipos de loadObjects (Windows) sin uso en los 16 niveles: WATER (pAnimSplash), meteoritos (pMeteorites,
  pAssetMeteorites), ElectricField, Acid, VRocket/HRocket, Piranha. No afectan la fidelidad del juego publicado.

## Estado 2026-10-05 (ronda 29 — repaso integral, parte 2)
- **Door**: Door::intersects con pRequiredCount × pRequiredItem → Hero::consumeItems (las llaves se GASTAN),
  DOOR_OPENED, y Door::internalUpdate hunde la reja linealmente en 1 s: texture rect y += sink, alto -= sink, bound
  se achica desde arriba (sigue siendo sólida hasta desaparecer). Antes: fundido de 0.5 s y no gastaba llaves.
- **HUD llaves** (Hud::start): el contador KEY_SMALL sólo se muestra desde el nivel 14, siempre (aunque sea 0).
- **PlatformInterp**: la imagen sale de una tabla por NIVEL en Windows loadObjects (jmp [actualLevel*4+0x421b80]):
  1 GREEN, 2 BORDEAUX, 3 SKYBLUE, 4-5 GREEN, 6 CAVE, 7 PURPLE, 8 BROWN, 9-11 CITY, 12 ICE, 13-14 MOON, 15-16 SPACE;
  el pAsset del TMX (PLATFORM_EGYPT_SMALL, inexistente) se ignora. Antes todas eran verdes. Un solo sprite (66 px)
  por plataforma: level6 (512) y level12 (1600) estiran el rect del TMX al recorrido y daban plataformas gigantes.
  Todas las plataformas tienen pWait > 0 → ciclo ida/espera/vuelta (ya portado).

## Estado 2026-10-05 (ronda 30 — repaso integral, parte 3)
- **Transiciones** (bat::App + StateTransition(0.8, 0.8)): cada cambio de estado de la App cierra 0.8 s (1→0) y abre
  0.8 s (0→1); SplashScreen usa ese valor como alpha del logo. Logos: fundido de entrada 0.8 s, a los 3.5 s (o tecla)
  fundido de salida 0.8 s → 4.3 s por logo. La entrada a InGame (pantalla de carga) abre desde negro en 0.8 s.
  El FadeTransition de InGame sólo se usa en la muerte del héroe (2 × deathWait), ya portado.
- **Selector de niveles** (LevelSelectScreen::update): →/↑ = siguiente, ←/↓ = anterior, a lo largo del camino, SIN
  vuelta y sin pasar del último desbloqueado (0x348); mantener la tecla sigue avanzando; la flecha se desliza entre
  nodos; aceptar = disparar / saltar / Enter (isSelectionAccept). Al entrar, el cursor arranca en el último nivel
  desbloqueado (0x34c = lastPlayedLevel). Antes: grilla ±1/±4 con vuelta y cursor en el nivel 1.

## Estado 2026-10-05 (ronda 31 — repaso integral, parte 4: ítems)
- **Item** (Item::Item / internalUpdate): los ítems flotan -7 px con yoyó easeInOutSin de 1.5 s (0x3fc00000); el
  desfase por posición imita Item::setTime (fila de monedas en ola; el valor exacto que pasa loadObjects no se
  pudo leer).
- **Item::intersects**: al tomar un ítem aparece un efecto en su centro: POWER (destello verde) para los normales,
  MEGA_POWER para uno especial y ninguno para otro. Las cadenas comparadas no se resolvieron (la ref a MEGA_POWER
  del exe es del registro de assets); INFERIDO: MEGA_POWER = ENERGY_DOUBLE_JUMP, ENDING sin efecto.
- Verificado: rebote al pisar = VELOCITY_JUMP[4].y × 0.6 = -510 (igual al port); deathWait 1 s.

## Estado 2026-10-05 (ronda 32 — repaso integral, parte 5: game over / final)
- InGame::loadGameOverInternal / loadEnding: música `lose` / `xa_win` + Intro(0x12 / 0x11) con espera 2 s
  (0x314 = 2.0) antes de aceptar tecla, y callback `loadMenu` → ambos vuelven al MENÚ PRINCIPAL (antes: al mapa,
  con 0.6 s). La cinta PRESS_ANY_KEY aparece a los 2 s. El código que el final genera (Utils::generateCode) se
  dibuja en y=802, fuera de la pantalla de 384 px de esta versión → no visible, no se porta.
- Muerte con vidas: Scenario::init sólo rearma la escena/cámara (no resetea objetos) → el port ya coincide.
- Down3 / Cannon: pxVel = ±1 es sólo la orientación (torretas fijas) → ya coincide.
- **Cómic** (corrección): InGame::loadIntroGeneral → General2..5 → loadMenu; cada página es una Intro que avanza con
  CUALQUIER tecla o clic tras 0.6 s (Intro::update). NO existe "Enter salta toda la historia" (era de la instalación
  modificada); quitado. El botón ⏭ móvil = pasar página.

## Estado 2026-10-05 (ronda 33 — repaso integral, parte 6: menú y topes)
- **Récord del menú** (Menu::init → setHighScore(HeroState::getHighScore)): HeroState+0x4 = SUMA de los mejores
  puntajes de cada nivel (saveGame); fuente negra, 6 dígitos con ceros, en (419, 8 del contenedor ≈ y 21) dentro del
  recuadro "RÉCORD:". Antes no se mostraba.
- **Menú día/noche** (AssetsGeneral "MENU" + bat::DateAndTime): menu.jpg si 10 ≤ hora < 19, si no menu_night.jpg.
  Antes siempre noche.
- Topes: vidas ≤ 99 (addLives), puntaje ≤ 999999 (addPoints). Energía: Hero::setState(9) recarga 10 (ya portado).

## Estado 2026-10-05 (ronda 34 — repaso integral, parte 7: barra de energía)
- **ENERGY_BAR**: Hud::render usa el frame `energía - 1` (10 frames: 1..10 de rojo a verde); el port usaba
  `energía` → mostraba una barra de más. Con energía 0 no se dibuja.
- **Pérdida de energía** (Hud::setEnergy → initEnergyLoseDo): el tramo perdido (x = nueva×4+2, ancho =
  (vieja−nueva)×4+2) se dibuja con ENERGY_BAR_LOSE (barra roja) y se achica linealmente en 1 s.
- Menú SALIR = App::postStopMsg (cierra la app) → en web vuelve a los logos (sin equivalente de cerrar pestaña).

## Estado 2026-10-05 (ronda 35 — repaso integral, parte 8: contacto por clase)
- `intersects` de cada clase: EnemyThrower y las torretas fijas (Cannon y Down3 llaman al mismo ctor 0x434e10 en
  Windows loadObjects, estilo EnemyFixedShooter) devuelven 0 → tocarlas NO hace nada (antes dañaban y desaparecían).
- EnemySmartUFO::intersects: cualquier contacto → onCollisionEnemy(4) + se quita, SIN pisotón ni puntos.
- EnemyBird (Bird/UFO/Double), Enemy, Jumper, FloorCannon, PiranhaRobot: pisotón desde arriba mata con puntos;
  si no, daño 4 y el enemigo se quita. Bomb / Ultraton / Boss / Stub / Guillotine: contacto = muerte.
- Verificado: pisar pájaro +10, pato robot +5; SmartUFO -4 energía y 0 puntos; Thrower sin efecto.
- Balas del héroe: sólo Guillotine / Rocket son isInvisibleForBullet; el resto (pinchos incluidos, aunque no reciben
  daño) frena la bala. SimpleBullet::onNeutralized deja GREEN_SHINE (equipo 0) / ORANGE_SHINE donde chocó.
  Verificado: bala vs pincho → se frena + destello, sin daño; vs pato robot → -1 vida + destello.

## Estado 2026-10-05 (ronda 36 — README final + deploy)
- La web está publicada en Cloudflare Pages (xa-portweb.vicemi.dev, `server: cloudflare`, 200) con deploy continuo
  desde `main`. README: quitado "(próximamente)", sección Deploy, estado/funciones al día con los repasos 28-35.
- Propiedades TMX revisadas: pHard/pPlatform/pLadder/pLadderEnd/pKilling/pInvisible son de TILES (ya manejadas en
  tilemap); pBulletAsset siempre BULLET_ENEMY/SIMPLE_ENEMY y XABulletFactory dibuja todo con BULLET_ENEMY → correcto.
  Meteoritos no aparecen en ningún nivel original → sacados de pendientes.

## Estado 2026-10-05 (ronda 37 — menú de día/noche en alta resolución)
- El usuario rehízo `menu.jpg` (1254x1254) y `menu_night.jpg` (1024x1024), mismo encuadre que los 512x512 originales
  (imagen en la banda 4:3 superior). Regla del original intacta: día de 10:00 a 18:59 del reloj del jugador, noche
  el resto.
- La pasada HD tapaba todo lo dibujado encima (botones, récord). Ahora `cover()` deja transparente el área del arte
  HD en el frame 512x384, `render()` dibuja el arte HD primero a resolución de pantalla y el frame encima. Sirve para
  cualquier tamaño (menús y créditos) y conserva cinta "Presiona cualquier tecla" y fundidos.
- Verificado en navegador: menú de noche (9 h) y de día (hora forzada a 14), botones y récord visibles, créditos OK,
  sin errores de consola.

## Estado 2026-10-05 (ronda 38 — logo del port en el arranque)
- Nuevo `screen_logo_vicemi.jpg` (512x512, banda 4:3 superior como los originales) como TERCER logo: Batoví →
  Calcar → Vicemi → PreLoader (xa_intro). Lista `SPLASH_LOGOS` en game.ts; cada logo con su "dong" (intro_piano),
  3.5 s y fundidos de 0.8 s; se salta con cualquier tecla/clic. Manifest regenerado. Verificado en navegador.

## Estado 2026-10-05 (ronda 39 — récord del menú en su lugar)
- Menu::Menu crea el TextSprite del récord con GameFont 0 y `Pos2::setPos(419.0, 8.0)`. El port lo dibujaba en
  (419, 21): 13 px más abajo, fuera del recuadro "RÉCORD:". Ahora (419, 8) → los dígitos quedan bajo "RÉCORD:",
  dentro del recuadro (los glifos están en la parte baja de su celda de 30 px). Verificado con récord 123456.

## Estado 2026-10-05 (ronda 40 — muerte del héroe 1:1)
- Hero::setState(9) NO reproduce animación: pone en el sprite la imagen fija `HERO_DEAD` (Xa_animaciones.png
  280,140 70x70, ancla 35,64), para la música y suena el SONIDO "HERO_DEATH". El port reproducía la anim
  `HERO_DEATH` (explosión de planilla_blasts) → inventada; quitada. Se mantiene el sentido en que murió.
- InGame::update: con Xa muerto sólo se actualizan el héroe y la transición; Hero::update llama a
  Scenario::updateAnimations → efectos/puntos siguen, enemigos, balas y plataformas quedan CONGELADOS. Antes el
  mundo seguía andando.
- Al terminar la espera: setImage("HERO"), anim JUMP, setScaleX(1) (mira a la derecha), y Scenario::init(Vector2)
  borra todos los objetos volátiles (balas, efectos, puntos) y el mensaje del HUD. Implementado.
- ENTRANCE: la caída ya viene en las anclas de HERO_IM_0..29 (y 384 → 80). El port además restaba hasta 340 px
  en render → caía desde el doble de altura. Quitado.
- Verificado con g.step: enemigos se mueven antes, congelados durante la muerte, balas borradas al reaparecer,
  1 vida por muerte, dir -1 durante / 1 después. Regresión 16 niveles (incluida una muerte por nivel): sin errores.

## Estado 2026-10-05 (ronda 41 — barrido de efectos inventados)
- Búsqueda de Math.sin/Math.random/globalAlpha en src para encontrar comportamiento sin respaldo:
  - HUD "guardando": el port lo desvanecía en 0.5 s; Hud::update sólo lo oculta cuando la anim termina → sin fundido.
  - Flecha del mapa: yoyó (modo 2) easeInOutSin de 0.8 s (0x3f4ccccd) de +(0,0) a +(0,-6); el port usaba
    sin(t·6) (~1.05 s). Deslizamiento entre nodos: easeInOutSin 0.3 s (0x3e99999a,
    notifyChangedSelectionSelection); el port usaba easeInOutQuad 0.25 s.
  - Jumper/Jumper2: Jumper::Jumper arranca con vel (pxVel, pyVel) y accel (pxAccel, pyAccel) → cae al piso, en el
    piso restartAnimation y salta (vx guardada, -200) al terminar la anim. El port esperaba un tiempo aleatorio en
    el piso al nacer → quitado.
  - Confirmados como originales: PARABLE 300 + randomBetween(0,80); 4_FALL ±25 aleatorio; sonidos alternados.
- Regresión 16 niveles: sin errores ni NaN.

## Estado 2026-10-05 (ronda 42 — textos del mapa de niveles alineados)
- bat::TextSprite: los glifos (ImageMap de GameFont) tienen ancla CERO → cada línea se dibuja con el TOPE de su celda
  de 30 px en la y de la línea. VAlignUp (default del constructor, 0xd4=3) → y = posición; VAlignCenter →
  y = pos − líneas·lineHeight/2, con lineHeight = 18 (GameFontDesc(…,12,30,30,2.5,18); vtable+0x14 = getLineHeight).
- El port restaba 2 px más (TEXT_TOP = 2) en todo texto centrado: barra de info del mapa (nivel, vacas, %, puntaje,
  título), intro de nivel (descripción, "Nivel N", título) y globo de carteles del HUD. Quitado.
- Medido por píxeles: en fuente_negra los dígitos ocupan las filas 13-23 de la celda (mayúsculas 5-23). Ahora los
  números de la barra quedan en filas 34-44 de info_map.png, misma línea base que "Nivel:" (33-45) y "Puntaje:"
  (36-46) impresos en el arte; antes 32-42.

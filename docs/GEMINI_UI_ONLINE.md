# Arte de la interfaz ONLINE para Gemini

La interfaz online usa el arte final de Gemini (ver "Estado" abajo); este documento también guarda los prompts
originales para regenerar o ampliar piezas.

**El texto NO va en las imágenes**: el juego lo escribe (nombres, "CREAR SALA", códigos...). Pedirle a Gemini piezas
**sin ninguna letra**, con la zona central vacía.

## Estado: el arte final YA está conectado

El arte generado con Gemini vive en `public/online/*.png` (37 piezas). Se corta de las 4 hojas de
`art-source/Nuevos assets/` con `python tools/slice_ui_sheets.py` (quita el verde con alfa suave, recorta, reduce con
alfa premultiplicado y guarda; cada pieza tiene su caja y su ancho de salida en la tabla `PIEZAS` del script). El fondo
`Assets_fondo_online.png` se redujo a `public/assets/images/menuElements/online_bg.jpg` (1024x768, ~100 KB).

Cómo se usa cada pieza (**nada se estira**: las piezas de tamaño variable van en 9 cortes, las fijas a su proporción):

| Dónde | Piezas | Cómo |
|---|---|---|
| Panel DOM (`src/components/online.css`, bloque "final art") | card, header, tab, tab_active, btn, btn_hover, input, code_box, slot, slot_me, slot_free | `border-image: url(..) <slice> fill / <ancho> stretch`: esquinas y bordes conservan su proporción, sólo el centro se estira |
| Panel DOM | crown, ready_on/off, ping_good/mid/bad, kick_x, toggle_on/off, spinner, avatar_frame | imágenes a proporción nativa; el avatar es la cabecita de Xa tintada recortada en círculo con el aro encima |
| HUD (`src/xa/world/hud.ts`) | friend_plate, powerup_plate, powerbar_frame, powerbar_fill(_warn), heart, host_flag, down_badge | `draw9()` de `src/xa/core/nineslice.ts`; el relleno de la barra se **recorta** a lo que queda (no se escala); parpadeo en los últimos 3 s con la variante warn |
| Mapa online (`src/xa/game.ts`) | roster_plate, host_flag, vote_chip, vote_flag, pick_banner, cursor_host, cursor_guest, level_lock | roster = una placa 9 cortes por jugador; fichas y banderas teñidas con el color del jugador; cursores en el menú espejo (invitado) |
| Fondo | online_bg.jpg | pantalla `online` del canvas (cover 512x384) + panel encima |

Si una imagen falta o no carga, el canvas dibuja lo de antes (placas y fichas dibujadas) y el panel DOM conserva su
CSS de respaldo (degradés), salvo `card`/`header`/`btn`... donde el borde queda transparente.

### Cómo reemplazar una pieza

1. Pasar la hoja nueva por el script o dejar el PNG final en `public/online/` con el MISMO nombre.
2. Si las proporciones cambiaron, ajustar los números de corte: en `online.css` (`border-image: url(..) <slice> fill / <ancho>`;
   el *slice* son píxeles de la imagen: arriba derecha abajo izquierda) o, para los canvas, el arreglo `[arriba, derecha,
   abajo, izquierda]` que se le pasa a `draw9(...)` en `hud.ts` / `game.ts`.
3. Regla del maestro: las piezas se guardan a ~2x-4x del tamaño en pantalla; el canvas las achica con calidad alta.
4. Revisar en el navegador a 320/768/1280 px y en el mapa/HUD que ninguna esquina se vea deformada.

### Notas de la primera tanda

- Las fichas de jugador (`slot*`) salieron verticales (tarjetas): sirven en 9 cortes, con bordes chicos.
- `ready_off` es una X roja y `avatar_frame` un aro: el aro rodea la cabecita recortada en círculo.
- Los rellenos de la barra son tiras segmentadas de otro largo que el marco: se escalan al hueco del marco y se recortan.
- La hoja del mapa traía `powerbar_fill_warn` pisado por los cursores (se usa el de la hoja del HUD) y la del lobby traía
  el corazón dos veces (se usa uno).

## Estilo común (pegar al principio de cada prompt)

```
Cartoon game UI piece for "XA: Contra los Cuatreros Galácticos" (2010 Flash-style comic game). Thick clean black ink
outline (3 px at 1x), bold white inner outline on big panels, glossy cartoon shading with a soft top highlight and a
slightly darker bottom, saturated colors. Palette: lime green #94D307 / #67A806 (panel bodies), tan paper #E2D5AE (plaques),
ink black #1A1818, bright yellow #FFF602 (buttons, highlights), orange-red #E8452C (danger). NO text, NO letters, NO
numbers, NO characters, NO logos. Flat solid #00FF00 background around the piece, nothing else on that green
(no shadow, no gradient, no glow on the green). Flat front view, centered, 4 px margin of green on every side.
Keep the middle area plain and calm so the piece can be stretched.
```

## Prompts originales (referencia para regenerar o ampliar)

Ojo: las columnas "Variable" son de la primera versión con ranuras CSS `--xo-art-*`, que ya no existen: ahora cada
PNG se usa por nombre de archivo (ver "Estado" arriba). Tamaños = los pedidos a Gemini; los finales salen del script.

Guardar todo en `public/online/`. Tamaños a 1x en píxeles (ancho × alto).

| Archivo | Variable | Tamaño | Dónde se ve |
|---|---|---|---|
| `card.png` | `--xo-art-card` | 720 × 560 | fondo del panel entero (`.xo-card`) |
| `header.png` | `--xo-art-header` | 560 × 84 | placa del título "SALA ONLINE" (`.xo-title`) |
| `tab.png` | `--xo-art-tab` | 220 × 52 | pestaña CREAR/UNIRSE/SALA sin elegir |
| `tab_active.png` | `--xo-art-tab-on` | 220 × 60 | pestaña elegida (un poco más alta) |
| `btn.png` | `--xo-art-btn` | 240 × 56 | todos los botones (`.xo-btn`) |
| `btn_hover.png` | `--xo-art-btn-hover` | 240 × 56 | botón con el mouse encima / foco |
| `slot.png` | `--xo-art-slot` | 330 × 72 | ficha de jugador (`.xo-slot`) |
| `slot_me.png` | `--xo-art-slot-me` | 330 × 72 | tu propia ficha |
| `slot_free.png` | `--xo-art-slot-free` | 330 × 72 | lugar libre ("esperando a un amigo") |
| `avatar.png` | `--xo-art-avatar` | 55 × 43 | marco sobre la cabecita del jugador |
| `spinner.png` | `--xo-art-spinner` | 64 × 64 | rueda de "conectando…" (gira sola) |

Prompts (anteponer el bloque de **Estilo común**):

- **card.png**: `Large rounded rectangular panel 720x560 px, corner radius 26 px. Body: lime green gradient (#94D307 at top to
  #4D8A02 at bottom) with a faint grass-like texture and a soft white highlight near the top. Thick white outline
  (5 px) with a black outline (3 px) around it, like the green option/confirmation window of the original game. Perfectly
  empty interior.`
- **header.png**: `Wide horizontal tan paper plaque 560x84 px, like a torn parchment nameplate, color #E2D5AE with a slightly
  darker bottom, black ink outline 3 px, tiny corner rivets, very slightly rotated edges. Empty center (a title is
  written there later).`
- **tab.png**: `Folder tab 220x52 px, rounded only at the top corners (12 px), square at the bottom, darker tan paper
  (#C4B384) with black outline on top, left and right, open at the bottom. Empty center.`
- **tab_active.png**: `Same folder tab but 220x60 px, brighter cream paper (#FFFBE3 to #E2D5AE) with a slightly bolder black
  outline, looks pulled forward. Empty center.`
- **btn.png**: `Chunky comic button 240x56 px, radius 12 px, yellow glossy face (#FFF9A0 top to #E8C800 bottom), thick black
  outline 3 px, a solid black drop edge 4 px under the bottom like a pressable arcade button. Empty center.`
- **btn_hover.png**: `Same button as the previous one but brighter and warmer (#FFFFC4 top to #F2D400 bottom), a soft yellow
  glow-free highlight, shifted 2 px up. Same size and shape.`
- **slot.png**: `Horizontal tan paper card 330x72 px, radius 14 px, cream (#F6EDCC) to #E2D5AE, black outline 3 px, small
  soft shadow edge at the bottom. Empty: the left 60 px stay clear (an avatar goes there).`
- **slot_me.png**: `Same card but yellow-cream (#FFFBB0 to #F6E57C) with an extra bright yellow outer outline 3 px around the black one.`
- **slot_free.png**: `Same card shape but translucent/empty look: dark green translucent fill (#143000, 30% opacity), dashed
  white outline 3 px (70% opacity). No ink outline.`
- **avatar.png**: `Round-cornered picture frame 55x43 px, only the border drawn (4 px, black ink with a thin white inner
  line), the inside completely transparent-looking solid #00FF00 so it can be cut out. Corner radius 10 px.`
- **spinner.png**: `Round loading emblem 64x64 px, a small cartoon flying saucer (UFO) seen from the front, glossy, black outline,
  the same saucer style as the red-light UFO icons of the original game map. No background.`

## Fase 2 (arte opcional, todavía NO está conectado al código)

El HUD y el mapa se dibujan en un canvas con colores del original; para usar arte ahí hay que sumar una línea en
`src/xa/world/hud.ts` (`plaque`) y `src/xa/game.ts` (`renderOnlineRoster`). Si se generan, guardarlos igual en
`public/online/`:

| Archivo | Tamaño | Uso |
|---|---|---|
| `hud_plaque.png` | 51 × 36 (ficha de amigo) y 62 × 50 (power-up) | placa de papel del HUD; hoy es un rectángulo redondeado |
| `crown.png` | 28 × 20 | corona del anfitrión (hoy es un SVG/polígono) |
| `vote_pin.png` | 10 × 14 | ficha de voto sobre un nivel del mapa (se tiñe con el color del jugador) |

Prompts: tan paper plaque with black ink outline (same as slot.png but small and plain); a golden cartoon crown with
black outline and three points; a small round map pin / speech-bubble-like tag with a pointed tail, white fill so it
can be tinted.

## Imágenes de `public/` para subir como referencia de estilo

Subirlas todas en el mismo mensaje y decir "match the art style, outline weight and colors of these original game
images":

| Imagen (ruta en el repo) | Qué enseña |
|---|---|
| `public/assets/images/menuElements/options_win.png` | **la principal**: ventana verde lima con borde blanco y negro, estilo de panel |
| `public/assets/images/menuElements/exit_confirmation.png` | la misma ventana de confirmación con los personajes |
| `public/assets/images/menuElements/buttons_tile.png` | botones/letras amarillos con borde negro y brillo |
| `public/assets/images/menuElements/info_map.png` | placa de papel (#E2D5AE) con borde de tinta |
| `public/assets/images/menuElements/hud_message_back.png` | globo/placa del HUD |
| `public/assets/images/menuElements/items_tile.png` | HUD: cabecita de Xa, barras, monedas, power-ups |
| `public/assets/images/menuElements/map.png` | tipo de dibujo (cómic, tinta gruesa, colores saturados) |
| `public/assets/images/menuElements/menu.jpg` | fondo del menú (el panel online se ve encima, atenuado) |
| `public/assets/lang/images/fuente_blanca.png` | letras cómic del juego (el texto se renderiza con CSS, solo de guía) |
| `public/assets/images/hero/Xa_animaciones.png` | el héroe (para que el spinner/avatar combine) |

## Después de generar

- Probar con `npm run build && npx astro preview --port 4343`, abrir "Online" desde el menú y revisar a 320, 768 y 1280 px.
- Si una pieza se deforma al estirarse, regenerarla con el centro más liso o acercar los adornos al borde.
- Los colores de cada héroe (verde, violeta, naranja, rosa, azul, blanco, marrón, magenta) los pone el código: la
  cabecita se tiñe sola (ver `.xo-avatar` en `online.css`), no hace falta un avatar por color.

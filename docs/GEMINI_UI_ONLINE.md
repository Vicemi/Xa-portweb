# Arte de la interfaz ONLINE para Gemini

La interfaz online ya funciona completa con CSS (panel verde lima, plaquetas de papel, botones amarillos, estilo de los
menús originales). Este documento lista **las piezas de arte final** que se pueden generar para reemplazar esas
partes sin tocar el código: cada pieza es una variable CSS `--xo-art-*` en `src/components/online.css` (bloque `:root`).
Por defecto valen `none` y se ve el CSS; al poner una imagen, se pinta **encima** del CSS (que queda de respaldo).

**El texto NO va en las imágenes**: el juego lo escribe (nombres, "CREAR SALA", códigos...). Pedirle a Gemini piezas
**sin ninguna letra**, con la zona central vacía.

## Cómo se instala una pieza

1. Generar en Gemini con el prompt de abajo (fondo **verde `#00FF00` sólido**, sin degradados ni sombras en el verde).
2. Pasarla por el recorte de croma + ajuste al tamaño exacto (skill `universal-modder:asset-pipeline`, o a mano:
   quitar el verde, recortar al borde, escalar al tamaño de la tabla) y guardarla como PNG con alfa en `public/online/`.
3. En `src/components/online.css`, en `:root`, cambiar `--xo-art-card: none;` por `--xo-art-card: url('/online/card.png');`.
   Las variables ya están declaradas con su nombre de archivo en el comentario.

Todas las piezas **se estiran al 100 % del elemento** (`background-size: 100% 100%`), y el elemento cambia de tamaño
según la pantalla (de 320 px a escritorio). Por eso: bordes y adornos pegados a los costados, **centro liso** (sin
detalles que se deformen), esquinas con el mismo radio que el original (~22 px en el panel, ~12 px en botones).
Tamaños = los de referencia a 1x; si se generan al doble (x2) mejor, hay que decirlo y escalar al guardar.

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

## Piezas (archivo → variable → tamaño → prompt)

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

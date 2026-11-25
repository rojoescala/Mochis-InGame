# Mochis: Ruta Robada

Un juego de mundo abierto en 3D con cámara en tercera persona, hecho sobre **las calles reales de Los Mochis, Sinaloa**,
tomadas de OpenStreetMap. Roba carros, haz encargos para el taller y escápate de la patrulla.

## Cómo jugar

Abre `mochis-juego.html` (todo en un solo archivo) o `index.html` en el navegador; no requiere servidor ni instalación.
También funciona en el celular con controles táctiles.

Para jugarlo desde una URL, activa **GitHub Pages** en el repositorio
(Settings → Pages → Deploy from a branch → elige la rama y la carpeta `/`).

### Controles

| Acción | Teclado | Celular |
|---|---|---|
| Caminar (W/S avanzar, A/D girar) / manejar | WASD o flechas | Joystick (izquierda) |
| Robar carro / bajarse | E | 🚗 |
| Freno de mano (a pie: correr) | Espacio | ✋ |
| Disparar (apunta solo al más cercano) | J o clic | 🔫 |
| Mapa de la ciudad (arrastra, zoom, toca para teletransportarte) | M | 🗺️ |
| Claxon | H | — |

### Qué hay en la ciudad

- **Calles reales**: bulevares, avenidas y calles con sus nombres reales (Blvd. Antonio Rosales,
  Av. Independencia, Blvd. Centenario, Calle Gabriel Leyva Solano…). El nombre aparece en pantalla
  al pasar por ellas. Las calles de un solo sentido se respetan en el tráfico.
- **Siempre sabes dónde estás**: el HUD muestra la calle actual, *entre qué calles* vas y el lugar real más cercano.
- **Lugares reales** de OpenStreetMap (~300): Plaza Fiesta, Plaza Sendero, Sagrado Corazón de Jesús,
  Hospital General, UAS, Tecnológico de Los Mochis, bancos, gasolineras, restaurantes… Los más importantes
  tienen un edificio emblemático (torre de iglesia, cruz de hospital, plaza comercial, estadio…).
- **Mapa interactivo**: arrastra para moverlo, rueda o pellizco para acercar (con nombres de calles al acercar)
  y toca cualquier punto para teletransportarte ahí.
- **Parques y canales** de OpenStreetMap (Parque Sinaloa, Ciudad Deportiva, canales de riego…).
- **Tráfico y peatones** que circulan por las calles.
- **7 tipos de vehículo**: Sedán, Vocho, Troca, Deportivo, Taxi, Camión Urbano y Patrulla.
- **Nivel de búsqueda (★ a ★★★★★)**: robar carros frente a la policía, atropellar, disparar o chocar
  patrullas sube las estrellas. Con 3 o más, la policía dispara. Si te alcanzan a pie: ¡agarrado!
- **🔧 Taller "El Chuy"**: entrega carros robados por dinero. Si llevas el modelo del *encargo*, pagan mucho más.
- **🎨 Pinta Rápido**: pinta el carro para quitarte las estrellas (cuesta dinero).
- **✚ Hospital**: ahí reapareces si mueres; a pie te cura por $50.
- **Pickups** de salud, balas y dinero repartidos por la ciudad.
- Tu dinero se guarda en el navegador.

## Archivos

- `index.html`, `style.css`, `game.js` — el juego (JavaScript + three.js para el 3D).
- `lib/three.min.js` — three.js r149 (licencia MIT).
- `mochis-juego.html` — todo junto en un archivo (se genera con `python3 tools/bundle.py`).
- `data/mochis.js` — el mapa ya procesado.
- `tools/build_map.py` — genera `data/mochis.js` a partir de OpenStreetMap.
- `tools/overpass_query.txt` — consulta de Overpass que descarga las calles de Los Mochis.

### Regenerar el mapa

```bash
pip install shapely
curl --data-urlencode data@tools/overpass_query.txt https://overpass-api.de/api/interpreter -o raw.json
curl --data-urlencode data@tools/overpass_pois.txt https://overpass-api.de/api/interpreter -o lugares.json
python3 tools/build_map.py raw.json data/mochis.js lugares.json
python3 tools/bundle.py
```

Las calles, parques y canales son datos reales; los **edificios se generan** a lo largo de las calles
(más altos en el centro), porque OpenStreetMap casi no tiene edificios trazados en Los Mochis.

## Créditos

Datos del mapa © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright), licencia ODbL.

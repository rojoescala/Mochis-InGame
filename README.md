# Mochis: Ruta Robada

Un juego de mundo abierto con vista desde arriba, hecho sobre **las calles reales de Los Mochis, Sinaloa**,
tomadas de OpenStreetMap. Roba carros, haz encargos para el taller y escápate de la patrulla.

## Cómo jugar

Abre `index.html` en el navegador (doble clic; no requiere servidor ni instalación).
También funciona en el celular con controles táctiles.

Para jugarlo desde una URL, activa **GitHub Pages** en el repositorio
(Settings → Pages → Deploy from a branch → elige la rama y la carpeta `/`).

### Controles

| Acción | Teclado | Celular |
|---|---|---|
| Caminar / manejar | WASD o flechas | Joystick (izquierda) |
| Robar carro / bajarse | E | 🚗 |
| Freno de mano (a pie: correr) | Espacio | ✋ |
| Disparar | J o clic (apunta con el mouse) | 🔫 (apunta solo) |
| Mapa de la ciudad | M | 🗺️ |
| Claxon | H | — |

### Qué hay en la ciudad

- **Calles reales**: bulevares, avenidas y calles con sus nombres reales (Blvd. Antonio Rosales,
  Av. Independencia, Blvd. Centenario, Calle Gabriel Leyva Solano…). El nombre aparece en pantalla
  al pasar por ellas. Las calles de un solo sentido se respetan en el tráfico.
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

- `index.html`, `style.css`, `game.js` — el juego (JavaScript puro con Canvas 2D, sin dependencias).
- `data/mochis.js` — el mapa ya procesado.
- `tools/build_map.py` — genera `data/mochis.js` a partir de OpenStreetMap.
- `tools/overpass_query.txt` — consulta de Overpass que descarga las calles de Los Mochis.

### Regenerar el mapa

```bash
pip install shapely
curl --data-urlencode data@tools/overpass_query.txt https://overpass-api.de/api/interpreter -o raw.json
python3 tools/build_map.py raw.json data/mochis.js
```

Las calles, parques y canales son datos reales; los **edificios se generan** a lo largo de las calles
(más altos en el centro), porque OpenStreetMap casi no tiene edificios trazados en Los Mochis.

## Créditos

Datos del mapa © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright), licencia ODbL.

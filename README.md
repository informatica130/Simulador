# LLAIMA 3D · Motor de simulación volcánica

Aplicación web de pantalla completa (estilo Google Earth) que simula erupciones del volcán Llaima
(La Araucanía, Chile) con un **motor físico que corre en la GPU** sobre el relieve real. No usa
trayectorias ni volúmenes predibujados: lahares, lava, corrientes piroclásticas, ceniza, deshielo e
incendios salen de resolver ecuaciones de conservación de masa, cantidad de movimiento y energía
en cada celda de 60 m del terreno.

> Es una herramienta de exploración y educación. **No reemplaza** los mapas oficiales de peligro de
> SERNAGEOMIN ni las instrucciones de SENAPRED.

## Cómo usar

Sirve la carpeta con cualquier servidor estático y abre `index.html`:

```bash
python3 -m http.server 8000
```

Luego abre <http://localhost:8000>. Necesita WebGL2 con render a texturas `float`, lo que tienen
Chrome, Edge, Firefox y Safari recientes con GPU dedicada o integrada moderna.

* **Navegación**: arrastrar = desplazar · botón derecho = rotar/inclinar · rueda = acercar al cursor ·
  doble clic = volar al punto · brújula = norte arriba · buscador de lugares, ríos y sensores.
* **Clic en el terreno**: sonda con todo lo que el motor sabe de ese punto (profundidad y velocidad
  del lahar, llegada, presión dinámica, lava y su temperatura, CDP, ceniza, nieve, incendio y,
  si se calculó, la probabilidad). Desde ahí se puede **agregar un sensor virtual** con hidrograma.
* **Escenarios**: 2008, 2009, 1994, 1955–57 (Pichillaima), 1751, 1640, pliniana con colapso,
  freática y personalizado. La boca eruptiva se puede poner **en cualquier punto del mapa o como
  fisura** (dos clics).
* **Parámetros**: intensidad explosiva, tasa efusiva, temperatura de la lava, mes (nieve), hora
  (sol real), viento en altura, lluvia (lahares secundarios), eficiencia de fusión, erosión.
* **Línea de tiempo**: velocidades de tiempo real a 1 h/s. Clic adelante = avanzar hasta ese
  momento; clic atrás = recalcular hasta ese momento (el motor es determinista).
* **Capas de análisis**: profundidad máxima, tiempo de llegada (isócronas cada 10 min), presión
  dinámica, espesor de lava, isópacas de ceniza, CDP y probabilidad Monte Carlo.
* `?q=2` usa la grilla de 120 m (equipos modestos); `?esc=e1751` abre un escenario.

## Datos

| Dato | Fuente |
|---|---|
| Relieve | Copernicus GLO-30 (DLR/Airbus), remuestreado a 60 m, 867 × 1087 celdas (52 × 65 km) |
| Imagen | Sentinel-2 cloudless 2023 (EOX, datos Copernicus) |
| Caminos, puentes, edificios, lugares, ríos | © colaboradores de OpenStreetMap |
| Catálogo eruptivo | Global Volcanism Program (Smithsonian) y SERNAGEOMIN, IEV aproximados |

Capas derivadas al cargar: pendiente, **glaciar** (≥1.950 m en el edificio del Llaima, donde la
imagen muestra hielo o por encima de ~2.150 m para el hielo cubierto de detritos; espesor 4–40 m
de agua equivalente), **nieve estacional** por mes (cota y equivalente en agua de la Araucanía
andina), **combustible vegetal** (bosque/pradera desde la imagen) y oclusión ambiental.

## El motor físico

Todo el estado vive en texturas `float32` de la GPU (una celda = un píxel) y se avanza con pasos de
render a textura (WebGL2, `src/solver.js`).

### Lahares (flujos de barro)

Ecuaciones de aguas someras con el **esquema inercial local** de Bates et al. (2010) y la
difusión θ de de Almeida et al. (2012), con caudales por unidad de ancho en las caras de cada celda:

```
∂q/∂t = −g·h·∂η/∂x − τ_b/ρ_m          η = z + h
∂h/∂t + ∇·q = fuentes − sumideros
```

Resistencia **cuadrática de O'Brien & Julien (1988)** con la concentración volumétrica de
sedimento Cv: fluencia τy(Cv), viscosa η(Cv) y turbulenta (Manning n(Cv)):

```
τ_b/ρ_m = 1,5·τy(Cv)/ρ_m + 3·η(Cv)·q/(ρ_m·h²) + g·n²·q|q|/h^(7/3)
```

Fricción implícita (estable con paso grande), tope de flujo saliente que garantiza profundidades
no negativas, bordes de salida libre. **Erosión y depositación** hacia la concentración de
equilibrio de Takahashi (1978), `C∞ = ρw·tanθ / ((ρs−ρw)(tanφ−tanθ))`: el lahar se carga de
sedimento en las laderas empinadas (bulking) y lo deja en las planicies (debulking); el lecho sube o
baja. Infiltración en suelo permeable, depósito de películas finas.

### Lava

Mismo esquema, con reología **Bingham** dependiente de la temperatura:

* viscosidad del fundido VFT (Giordano et al. 2008), ajustada a la andesita basáltica del Llaima;
* efecto de cristales con Einstein-Roscoe (`(1−φ/φm)^−2,5`), cristalinidad creciente al enfriarse
  (las lavas del Llaima son ricas en cristales);
* esfuerzo de fluencia `log10 τy = 13,0997 − 0,0089·T` (Dragoni 1989, usado en MAGFLOW).

Balance de energía en cada celda: advección de calor, radiación de Stefan-Boltzmann desde una
superficie con costra (más caliente si la lava se mueve), convección, conducción al suelo, calor
latente de cristalización y **pérdida de calor al fundir hielo**. Bajo el solidus (~950 °C) la lava
se **solidifica y pasa a formar parte del relieve**, de modo que los flujos siguientes la rodean.
La emisión sigue la curva de Wadge (1981). La superficie se dibuja con emisión de cuerpo negro: la
costra oscura se agrieta y deja ver el núcleo incandescente.

### Corrientes de densidad piroclástica

Flujo denso con fricción de **Voellmy-Salm** (`μ·g·h + g·u²/ξ`), sedimentación, enfriamiento
por mezcla con aire. Nacen del colapso de la columna (fracción del escenario o colapso que detecta
el propio modelo de pluma) y la nube co-piroclástica se representa con partículas.

### Deshielo, glaciar y lahares primarios

Fusión por balance de energía: contacto lava–hielo (flujo de calor ∝ T−273, mayor con la lava en
movimiento), CDP sobre nieve (energía térmica de la corriente) y piroclastos calientes y salpicaduras
alrededor de la boca. El agua derretida entra al lahar, la lava pierde exactamente el calor usado y
**la superficie del glaciar baja**: se abren canales en el hielo, como los observados en 2008.

### Columna eruptiva

Modelo integral de pluma con viento (Morton-Taylor-Turner 1956; Bursik 2001; **Woodhouse et al.
2013**): conservación de masa, cantidad de movimiento horizontal y vertical y entalpía, con
incorporación de aire radial (k=0,09) y por viento (k=0,9), atmósfera estándar y perfil de viento
con corriente en chorro. Sin viento reproduce la relación empírica de Mastin et al. (2009)
(p. ej. 1×10⁷ kg/s → 14,6 km sobre la boca, Mastin: 14,8 km); con viento la pluma se dobla y
baja, como se observa. Detecta colapso cuando la mezcla sigue siendo más densa que el aire al
agotarse el impulso.

### Tefra

Dispersión tipo **Tephra2** (Bonadonna et al. 2005): siete clases granulométricas (φ −3 a 6), masa
distribuida en la columna según Suzuki (1983), velocidad terminal por régimen de Reynolds (Bonadonna
et al. 1998) con densidad y viscosidad del aire según la altura, transporte con el perfil de viento,
difusión turbulenta (lineal para granos gruesos y ley 5/2 para los finos). El depósito es
**incremental y respeta el tiempo de caída**: la ceniza fina llega a los pueblos minutos u horas
después que el lapilli.

### Incendios

Autómata celular sobre el combustible vegetal: ignición por lava (>900 K) y CDP, propagación a las
celdas vecinas con probabilidad que aumenta con el viento y pendiente arriba, sequedad según el mes,
extinción por lahar o lluvia y agotamiento del combustible.

### Paso de tiempo

Adaptativo con condición CFL `Δt = 0,55·Δx / (√(g·h_max) + u_max)` leída desde la GPU cuatro veces
por segundo; más corto mientras hay corrientes piroclásticas.

### Partículas y efectos

Columna guiada por la solución de la pluma (eje, radio, velocidad) que se abre en la nube paraguas;
fuentes de lava y **bombas balísticas con arrastre aerodinámico** (Mastin 2001) que dejan polvo y
brasas al caer; explosiones estrombolianas por pulsos; rayos volcánicos; vapor donde la lava toca el
hielo; fumarolas; nubes de CDP; llamas y humo de incendios; rocío de barro en lahares rápidos.

## Probabilidades

* **Recurrencia** desde el catálogo: Poisson con el ritmo 1900–2009, modelo Gamma-Poisson que
  incluye el reposo desde 2009, ritmo de largo plazo desde 1640 y erupciones IEV ≥ 3.
* **Monte Carlo** (pestaña Probabilidad): N erupciones posibles con el mismo motor a 120 m.
  Árbol de eventos: estilo (estromboliana 60 %, efusiva 25 %, subpliniana 12 %, pliniana 3 %),
  boca (cumbre 70 %, Pichillaima 12 %, fisura de flanco NNE-SSO 18 %), tasas log-normales, mes al
  azar (nieve) y viento según una climatología de los oestes. Resultado: mapa y tabla de
  probabilidad de lahar > 0,5 m, lava, CDP > 0,3 m y ceniza > 10 mm.

## Limitaciones conocidas

* La grilla de 60 m no resuelve cauces de pocos metros; los tiempos de llegada en quebradas
  estrechas son aproximados.
* El espesor del glaciar es una estimación (no hay batimetría de hielo pública del Llaima).
* Los parámetros de reología están calibrados con valores de literatura, no con mediciones propias
  de cada erupción.
* El viento es uniforme en dirección (varía en magnitud con la altura).

## Estructura

```
index.html, css/app.css
src/config.js     constantes, catálogo, escenarios, sensores
src/data.js       carga y capas derivadas (glaciar, nieve, combustible, AO)
src/solver.js     motor GPU (lahar, lava, CDP, deshielo, incendios, tefra, lecturas)
src/runner.js     paso adaptativo, fuentes, series de tiempo
src/eruption.js   fuente eruptiva en el tiempo, núcleos de tefra
src/plume.js      modelo integral de pluma y Tephra2
src/terrain.js    shaders de terreno y fluidos
src/fx.js         partículas físicas
src/overlays.js   caminos, puentes, edificios, etiquetas
src/ensemble.js   análisis probabilístico
src/main.js       aplicación, cámara, interfaz
lib/              three.js r160 (MIT)
```

## Referencias

Bates, Horritt & Fewtrell (2010) J. Hydrol. · de Almeida et al. (2012) Water Resour. Res. ·
O'Brien & Julien (1988) J. Hydraul. Eng. · Takahashi (1978) J. Hydraul. Div. ·
Iverson, Schilling & Vallance (1998) GSA Bull. · Pierson (1998) · Giordano, Russell & Dingwell (2008)
EPSL · Dragoni (1989) · Del Negro et al. (2008) MAGFLOW · Wadge (1981) · Woodhouse et al. (2013) JGR ·
Mastin et al. (2009) JVGR · Bonadonna et al. (2005) Tephra2 · Suzuki (1983) · Mastin (2001) Eject! ·
Naranjo & Moreno (1991, 2005) geología del Llaima · Global Volcanism Program, Llaima (357110).

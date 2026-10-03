(() => {
    "use strict";

    /*
     * ============================================================
     * KEOLEL RADAR ENGINE
     *
     * Dependencias:
     * - Leaflet 1.9.4
     * - OpenStreetMap tiles
     * - Overpass API para radares
     * - Nominatim para geocodificación
     * - OSRM para rutas
     *
     * Expone:
     *
     * window.TrafficMap
     * ============================================================
     */

    const CONFIG = {
        map: {
            defaultCenter: [-34.9011, -56.1645],
            defaultZoom: 13,
            userZoom: 16
        },

        gps: {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 3000
        },

        radar: {
            warningDistance: 300,
            queryRadius: 50000,
            refreshInterval: 300000
        },

        simulation: {
            stepMeters: 20,
            defaultSpeed: 5
        },

        services: {
            nominatim:
                "https://nominatim.openstreetmap.org/search",

            osrm:
                "https://router.project-osrm.org/route/v1/driving",

            overpass:
                "https://overpass-api.de/api/interpreter"
        }
    };

    const state = {
        initialized: false,

        map: null,

        userMarker: null,

        accuracyCircle: null,

        destinationMarker: null,

        routeLine: null,

        radarLayer: null,

        routeRadarLayer: null,

        radars: [],

        radarCount: 0,

        locationWatchId: null,

        locationActive: false,

        lastPosition: null,

        destination: null,

        destinationLatitude: null,

        destinationLongitude: null,

        route: null,

        simulation: {
            active: false,
            latitude: null,
            longitude: null,
            heading: 0,
            speed: CONFIG.simulation.defaultSpeed,
            radar: null,
            distance: null
        },

        warningRadar: null,

        radarRefreshTimer: null,

        lastRadarQuery: null
    };

    /*
     * ============================================================
     * UTILIDADES
     * ============================================================
     */

    function byId(id) {
        return document.getElementById(id);
    }

    function safeNumber(value, fallback = 0) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : fallback;
    }

    function setText(id, value) {
        const element = byId(id);

        if (element) {
            element.textContent = String(value);
        }
    }

    function showStatus(message) {
        setText("mapStatus", message);
    }

    function formatSpeed(kmh) {
        const value = safeNumber(kmh, 0);

        return `${Math.round(value)} KM/H`;
    }

    function formatRadarCount(count) {
        return String(
            Math.max(0, Number(count) || 0)
        ).padStart(2, "0");
    }

    /*
     * ============================================================
     * DISTANCIA / GEOMETRÍA
     * ============================================================
     */

    function distanceMeters(
        latitude1,
        longitude1,
        latitude2,
        longitude2
    ) {
        const R = 6371000;

        const lat1 =
            Number(latitude1) *
            Math.PI / 180;

        const lat2 =
            Number(latitude2) *
            Math.PI / 180;

        const deltaLat =
            (Number(latitude2) -
                Number(latitude1)) *
            Math.PI / 180;

        const deltaLng =
            (Number(longitude2) -
                Number(longitude1)) *
            Math.PI / 180;

        const a =
            Math.sin(deltaLat / 2) ** 2 +
            Math.cos(lat1) *
            Math.cos(lat2) *
            Math.sin(deltaLng / 2) ** 2;

        const c =
            2 *
            Math.atan2(
                Math.sqrt(a),
                Math.sqrt(1 - a)
            );

        return R * c;
    }

    function bearingBetween(
        latitude1,
        longitude1,
        latitude2,
        longitude2
    ) {
        const lat1 =
            Number(latitude1) *
            Math.PI / 180;

        const lat2 =
            Number(latitude2) *
            Math.PI / 180;

        const deltaLng =
            (Number(longitude2) -
                Number(longitude1)) *
            Math.PI / 180;

        const y =
            Math.sin(deltaLng) *
            Math.cos(lat2);

        const x =
            Math.cos(lat1) *
            Math.sin(lat2) -
            Math.sin(lat1) *
            Math.cos(lat2) *
            Math.cos(deltaLng);

        const angle =
            Math.atan2(y, x) *
            180 /
            Math.PI;

        return (angle + 360) % 360;
    }

    function normalizeBearing(value) {
        return (
            (Number(value) % 360 + 360) %
            360
        );
    }

    function destinationPoint(
        latitude,
        longitude,
        bearing,
        distance
    ) {
        const R = 6371000;

        const lat1 =
            Number(latitude) *
            Math.PI / 180;

        const lon1 =
            Number(longitude) *
            Math.PI / 180;

        const theta =
            Number(bearing) *
            Math.PI / 180;

        const delta =
            Number(distance) / R;

        const lat2 =
            Math.asin(
                Math.sin(lat1) *
                Math.cos(delta) +
                Math.cos(lat1) *
                Math.sin(delta) *
                Math.cos(theta)
            );

        const lon2 =
            lon1 +
            Math.atan2(
                Math.sin(theta) *
                Math.sin(delta) *
                Math.cos(lat1),
                Math.cos(delta) -
                Math.sin(lat1) *
                Math.sin(lat2)
            );

        return {
            latitude:
                lat2 *
                180 /
                Math.PI,

            longitude:
                lon2 *
                180 /
                Math.PI
        };
    }

    /*
     * ============================================================
     * ICONOS
     * ============================================================
     */

    function createUserIcon() {
        return L.divIcon({
            className: "keolel-user-marker",

            html: `
                <div style="
                    width:18px;
                    height:18px;
                    border-radius:50%;
                    background:#36c8d8;
                    border:3px solid #071014;
                    box-shadow:
                        0 0 0 3px rgba(54,200,216,.25),
                        0 0 22px rgba(54,200,216,.9);
                "></div>
            `,

            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
    }

    function createRadarIcon(limit) {
        const speed =
            Number(limit);

        const label =
            Number.isFinite(speed) &&
            speed > 0
                ? speed
                : "—";

        return L.divIcon({
            className: "keolel-radar-marker",

            html: `
                <div style="
                    position:relative;
                    width:34px;
                    height:34px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    border-radius:50%;
                    background:#190708;
                    border:2px solid #ff3131;
                    color:#ff4a4a;
                    font-family:monospace;
                    font-size:9px;
                    font-weight:700;
                    box-shadow:
                        0 0 12px rgba(255,49,49,.8),
                        0 0 28px rgba(255,49,49,.35);
                ">
                    ${label}
                </div>
            `,

            iconSize: [34, 34],
            iconAnchor: [17, 17]
        });
    }

    /*
     * ============================================================
     * MAPA
     * ============================================================
     */

    function initializeMap() {
        if (!window.L) {
            showStatus(
                "LEAFLET NO DISPONIBLE"
            );

            return false;
        }

        const mapElement =
            byId("map");

        if (!mapElement) {
            return false;
        }

        state.map =
            L.map(
                mapElement,
                {
                    center:
                    CONFIG.map.defaultCenter,

                    zoom:
                    CONFIG.map.defaultZoom,

                    zoomControl: true,

                    attributionControl: true,

                    preferCanvas: true
                }
            );

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,

                attribution:
                    '&copy; OpenStreetMap contributors',

                crossOrigin: true
            }
        ).addTo(state.map);

        state.radarLayer =
            L.layerGroup()
                .addTo(state.map);

        state.routeRadarLayer =
            L.layerGroup()
                .addTo(state.map);

        state.map.on(
            "click",
            event => {
                if (!state.simulation.active) {
                    return;
                }

                state.simulation.latitude =
                    event.latlng.lat;

                state.simulation.longitude =
                    event.latlng.lng;

                updateSimulationPosition();
            }
        );

        return true;
    }

    /*
     * ============================================================
     * GPS
     * ============================================================
     */

    function requestLocation(force = false) {
        if (state.simulation.active && !force) {
            return;
        }

        if (!navigator.geolocation) {
            state.locationActive = false;

            updateGpsUI(false);

            showStatus(
                "GPS NO DISPONIBLE"
            );

            return;
        }

        showStatus(
            "OBTENIENDO UBICACIÓN..."
        );

        navigator.geolocation.getCurrentPosition(
            handlePosition,
            handlePositionError,
            CONFIG.gps
        );

        startLocationWatch();
    }

    function startLocationWatch() {
        if (
            state.locationWatchId !== null
        ) {
            return;
        }

        if (!navigator.geolocation) {
            return;
        }

        state.locationWatchId =
            navigator.geolocation.watchPosition(
                handlePosition,
                handlePositionError,
                CONFIG.gps
            );
    }

    function stopLocationWatch() {
        if (
            state.locationWatchId === null
        ) {
            return;
        }

        navigator.geolocation.clearWatch(
            state.locationWatchId
        );

        state.locationWatchId = null;
    }

    function handlePosition(position) {
        if (!position?.coords) {
            return;
        }

        const latitude =
            safeNumber(
                position.coords.latitude
            );

        const longitude =
            safeNumber(
                position.coords.longitude
            );

        const accuracy =
            safeNumber(
                position.coords.accuracy,
                0
            );

        const speed =
            safeNumber(
                position.coords.speed,
                0
            );

        let heading =
            Number(
                position.coords.heading
            );

        if (!Number.isFinite(heading)) {
            heading =
                state.lastPosition?.heading ??
                state.simulation.heading ??
                0;
        }

        state.lastPosition = {
            latitude,
            longitude,
            accuracy,
            speed,
            heading,
            timestamp: Date.now()
        };

        state.locationActive = true;

        updateGpsUI(true);

        updateUserMarker(
            latitude,
            longitude,
            speed
        );

        if (
            state.map &&
            !state.simulation.active
        ) {
            const currentZoom =
                state.map.getZoom();

            if (
                !state.userMarker ||
                currentZoom < 14
            ) {
                state.map.setView(
                    [latitude, longitude],
                    CONFIG.map.userZoom,
                    {
                        animate: true
                    }
                );
            }
        }

        checkRadars(
            latitude,
            longitude,
            heading
        );

        showStatus(
            `GPS ACTIVO · ±${Math.round(
                accuracy
            )} M`
        );

        updateSpeedUI(speed);

        if (
            state.destination
        ) {
            calculateRouteToDestination(
                state.destination.latitude,
                state.destination.longitude,
                true
            );
        }
    }

    function handlePositionError(error) {
        console.warn(
            "[Keolel Radar] GPS:",
            error
        );

        state.locationActive = false;

        updateGpsUI(false);

        let message =
            "ERROR DE GPS";

        if (error?.code === 1) {
            message =
                "PERMISO GPS DENEGADO";
        }

        if (error?.code === 2) {
            message =
                "UBICACIÓN NO DISPONIBLE";
        }

        if (error?.code === 3) {
            message =
                "TIMEOUT DE GPS";
        }

        showStatus(message);
    }

    /*
     * ============================================================
     * USER MARKER
     * ============================================================
     */

    function updateUserMarker(
        latitude,
        longitude,
        speed = 0
    ) {
        if (!state.map) {
            return;
        }

        if (!state.userMarker) {
            state.userMarker =
                L.marker(
                    [
                        latitude,
                        longitude
                    ],
                    {
                        icon:
                            createUserIcon(),

                        zIndexOffset: 1000
                    }
                )
                    .addTo(state.map)
                    .bindTooltip(
                        "TU POSICIÓN",
                        {
                            direction:
                                "top"
                        }
                    );
        } else {
            state.userMarker.setLatLng(
                [
                    latitude,
                    longitude
                ]
            );
        }

        if (!state.accuracyCircle) {
            state.accuracyCircle =
                L.circle(
                    [
                        latitude,
                        longitude
                    ],
                    {
                        radius:
                            state.lastPosition?.accuracy ||
                            10,

                        color:
                            "#36c8d8",

                        weight: 1,

                        opacity: .35,

                        fillColor:
                            "#36c8d8",

                        fillOpacity: .05,

                        interactive: false
                    }
                ).addTo(state.map);
        } else {
            state.accuracyCircle.setLatLng(
                [
                    latitude,
                    longitude
                ]
            );

            state.accuracyCircle.setRadius(
                state.lastPosition?.accuracy ||
                10
            );
        }

        updateSpeedUI(speed);
    }

    function updateSpeedUI(speedMetersPerSecond) {
        const speed =
            safeNumber(
                speedMetersPerSecond,
                0
            );

        const kmh =
            speed * 3.6;

        setText(
            "mapSpeed",
            formatSpeed(kmh)
        );
    }

    /*
     * ============================================================
     * RADARES
     * ============================================================
     */

    async function loadRadars(
        latitude,
        longitude
    ) {
        if (!Number.isFinite(latitude) ||
            !Number.isFinite(longitude)) {
            return;
        }

        const now = Date.now();

        if (
            state.lastRadarQuery &&
            now - state.lastRadarQuery <
            30000
        ) {
            return;
        }

        state.lastRadarQuery = now;

        showStatus(
            "CARGANDO RADARES..."
        );

        const radius =
            CONFIG.radar.queryRadius;

        const query = `
[out:json][timeout:25];
(
  node["highway"="speed_camera"]
    (around:${radius},${latitude},${longitude});

  way["highway"="speed_camera"]
    (around:${radius},${latitude},${longitude});

  node["enforcement"="speed"]
    (around:${radius},${latitude},${longitude});

  way["enforcement"="speed"]
    (around:${radius},${latitude},${longitude});
);
out center tags;
`;

        try {
            const response =
                await fetch(
                    CONFIG.services.overpass,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/x-www-form-urlencoded"
                        },

                        body:
                            "data=" +
                            encodeURIComponent(
                                query
                            )
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `Overpass HTTP ${response.status}`
                );
            }

            const data =
                await response.json();

            const radars =
                normalizeRadarData(
                    data?.elements || []
                );

            state.radars =
                deduplicateRadars(
                    radars
                );

            state.radarCount =
                state.radars.length;

            renderRadars();

            updateRadarCountUI();

            showStatus(
                `RADARES ACTIVOS · ${state.radarCount}`
            );

        } catch (error) {
            console.error(
                "[Keolel Radar] Overpass:",
                error
            );

            showStatus(
                "ERROR CARGANDO RADARES"
            );
        }
    }

    function normalizeRadarData(elements) {
        const result = [];

        for (const element of elements) {
            let latitude = null;
            let longitude = null;

            if (
                Number.isFinite(Number(element.lat)) &&
                Number.isFinite(Number(element.lon))
            ) {
                latitude = Number(element.lat);
                longitude = Number(element.lon);
            } else if (element.center) {
                latitude = Number(element.center.lat);
                longitude = Number(element.center.lon);
            }

            if (
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude)
            ) {
                continue;
            }

            const tags = element.tags || {};

            const limit = parseSpeedLimit(
                tags.maxspeed ||
                tags.maxspeed_forward ||
                tags.maxspeed_backward ||
                null
            );

            result.push({
                id: String(
                    element.id ??
                    `${latitude}:${longitude}`
                ),

                latitude,
                longitude,
                limit,

                direction:
                    tags.direction || null,

                name:
                    tags.name ||
                    "RADAR DE VELOCIDAD",

                source: "OpenStreetMap"
            });
        }

        return result;
    }

    function parseSpeedLimit(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return null;
        }

        const match =
            String(value).match(
                /(\d+(?:\.\d+)?)/
            );

        if (!match) {
            return null;
        }

        return Number(match[1]);
    }

    function deduplicateRadars(
        radars
    ) {
        const unique = [];

        for (
            const radar of radars
            ) {
            const exists =
                unique.some(
                    item =>
                        distanceMeters(
                            item.latitude,
                            item.longitude,
                            radar.latitude,
                            radar.longitude
                        ) < 20
                );

            if (!exists) {
                unique.push(radar);
            }
        }

        return unique;
    }

    function renderRadars() {
        if (!state.radarLayer) {
            return;
        }

        state.radarLayer.clearLayers();

        state.radars.forEach(
            radar => {
                const marker =
                    L.marker(
                        [
                            radar.latitude,
                            radar.longitude
                        ],
                        {
                            icon:
                                createRadarIcon(
                                    radar.limit
                                )
                        }
                    );

                const limitText =
                    radar.limit
                        ? `${radar.limit} KM/H`
                        : "LÍMITE NO DISPONIBLE";

                marker.bindPopup(`
                    <div style="
                        font-family:monospace;
                        color:#111;
                        min-width:180px;
                    ">
                        <strong>
                            RADAR DE VELOCIDAD
                        </strong>
                        <br>
                        LÍMITE: ${limitText}
                        <br>
                        FUENTE: OPENSTREETMAP
                    </div>
                `);

                marker.addTo(
                    state.radarLayer
                );
            }
        );
    }

    /*
     * ============================================================
     * RADAR DETECTION
     * ============================================================
     */

    function checkRadars(
        latitude,
        longitude,
        heading = 0
    ) {
        if (
            !Array.isArray(
                state.radars
            ) ||
            state.radars.length === 0
        ) {
            hideRadarWarning();

            return null;
        }

        let closest = null;

        for (
            const radar of state.radars
            ) {
            const distance =
                distanceMeters(
                    latitude,
                    longitude,
                    radar.latitude,
                    radar.longitude
                );

            if (
                !closest ||
                distance <
                closest.distance
            ) {
                closest = {
                    radar,
                    distance
                };
            }
        }

        if (
            !closest ||
            closest.distance >
            CONFIG.radar.warningDistance
        ) {
            hideRadarWarning();

            return null;
        }

        state.warningRadar =
            closest.radar;

        showRadarWarning(
            closest.radar,
            closest.distance
        );

        return closest;
    }

    function showRadarWarning(
        radar,
        distance
    ) {
        const warning =
            byId("radarWarning");

        if (!warning) {
            return;
        }

        const distanceElement =
            byId(
                "radarWarningDistance"
            );

        const limitElement =
            byId(
                "radarWarningLimit"
            );

        const rounded =
            Math.max(
                1,
                Math.round(distance)
            );

        if (distanceElement) {
            distanceElement.textContent =
                `${rounded} M`;
        }

        if (limitElement) {
            limitElement.textContent =
                radar.limit
                    ? `LÍMITE ${radar.limit} KM/H`
                    : "LÍMITE NO DISPONIBLE";
        }

        warning.classList.add(
            "active"
        );

        /*
         * Voz.
         */
        speakRadarWarning(
            radar,
            rounded
        );
    }

    let lastSpeech = 0;

    function speakRadarWarning(
        radar,
        distance
    ) {
        if (
            !("speechSynthesis" in window)
        ) {
            return;
        }

        const now = Date.now();

        if (
            now - lastSpeech <
            10000
        ) {
            return;
        }

        lastSpeech = now;

        const text =
            radar.limit
                ? `Radar a ${distance} metros. Límite ${radar.limit} kilómetros por hora.`
                : `Radar a ${distance} metros.`;

        try {
            window.speechSynthesis.cancel();

            const utterance =
                new SpeechSynthesisUtterance(
                    text
                );

            utterance.lang =
                "es-ES";

            utterance.rate =
                1;

            utterance.pitch =
                1;

            window.speechSynthesis.speak(
                utterance
            );
        } catch (error) {
            console.warn(
                "[Keolel Radar] Speech:",
                error
            );
        }
    }

    function hideRadarWarning() {
        const warning =
            byId("radarWarning");

        if (warning) {
            warning.classList.remove(
                "active"
            );
        }

        state.warningRadar = null;
    }

    /*
     * ============================================================
     * SIMULACIÓN
     * ============================================================
     */

    function startSimulation() {
        let latitude =
            state.lastPosition?.latitude;

        let longitude =
            state.lastPosition?.longitude;

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            const center =
                state.map
                    ? state.map.getCenter()
                    : {
                        lat:
                            CONFIG.map.defaultCenter[0],

                        lng:
                            CONFIG.map.defaultCenter[1]
                    };

            latitude =
                center.lat;

            longitude =
                center.lng;
        }

        state.simulation.active =
            true;

        state.simulation.latitude =
            latitude;

        state.simulation.longitude =
            longitude;

        state.simulation.heading =
            Number(
                state.lastPosition?.heading
            ) || 0;

        state.simulation.speed =
            CONFIG.simulation.defaultSpeed;

        state.simulation.radar =
            null;

        state.simulation.distance =
            null;

        updateUserMarker(
            latitude,
            longitude,
            state.simulation.speed
        );

        if (state.map) {
            state.map.setView(
                [
                    latitude,
                    longitude
                ],
                CONFIG.map.userZoom,
                {
                    animate: true
                }
            );
        }

        showStatus(
            "SIMULACIÓN ACTIVA"
        );

        updateSimulationUI();

        return true;
    }

    function stopSimulation() {
        state.simulation.active =
            false;

        state.simulation.radar =
            null;

        state.simulation.distance =
            null;

        hideRadarWarning();

        showStatus(
            state.locationActive
                ? "GPS ACTIVO"
                : "GPS OFF"
        );

        return true;
    }

    function updateSimulationPosition() {
        if (
            !state.simulation.active
        ) {
            return;
        }

        const simulation =
            state.simulation;

        updateUserMarker(
            simulation.latitude,
            simulation.longitude,
            simulation.speed
        );

        checkRadars(
            simulation.latitude,
            simulation.longitude,
            simulation.heading
        );

        updateSimulationUI();

        if (state.map) {
            state.map.panTo(
                [
                    simulation.latitude,
                    simulation.longitude
                ],
                {
                    animate: true,
                    duration: .25
                }
            );
        }
    }

    function updateSimulationUI() {
        if (
            !state.simulation.active
        ) {
            return;
        }

        const result =
            findClosestRadar(
                state.simulation.latitude,
                state.simulation.longitude
            );

        state.simulation.radar =
            result?.radar || null;

        state.simulation.distance =
            result?.distance ?? null;

        const distance =
            result?.distance;

        if (
            Number.isFinite(distance) &&
            distance <=
            CONFIG.radar.warningDistance
        ) {
            showRadarWarning(
                result.radar,
                distance
            );
        }

        updateSpeedUI(
            state.simulation.speed
        );
    }

    function findClosestRadar(
        latitude,
        longitude
    ) {
        let closest = null;

        for (
            const radar of state.radars
            ) {
            const distance =
                distanceMeters(
                    latitude,
                    longitude,
                    radar.latitude,
                    radar.longitude
                );

            if (
                !closest ||
                distance <
                closest.distance
            ) {
                closest = {
                    radar,
                    distance
                };
            }
        }

        return closest;
    }

    /*
     * ============================================================
     * RUTAS
     * ============================================================
     */

    async function calculateRouteToDestination(
        latitude,
        longitude,
        silent = false
    ) {
        if (!state.map) {
            return null;
        }

        const destination = {
            latitude:
                Number(latitude),

            longitude:
                Number(longitude),

            name:
                state.destination?.name ||
                "DESTINO"
        };

        state.destination =
            destination;

        state.destinationLatitude =
            destination.latitude;

        state.destinationLongitude =
            destination.longitude;

        const origin =
            getCurrentPositionForRoute();

        if (!origin) {
            if (!silent) {
                showStatus(
                    "ACTIVA EL GPS PARA CALCULAR LA RUTA"
                );
            }

            return null;
        }

        setText(
            "routeState",
            "CALCULATING"
        );

        if (!silent) {
            showStatus(
                "CALCULANDO RUTA..."
            );
        }

        const coordinates =
            `${origin.longitude},${origin.latitude};` +
            `${destination.longitude},${destination.latitude}`;

        const url =
            `${CONFIG.services.osrm}/${coordinates}` +
            "?overview=full" +
            "&geometries=geojson" +
            "&steps=true";

        try {
            const response =
                await fetch(url);

            if (!response.ok) {
                throw new Error(
                    `OSRM HTTP ${response.status}`
                );
            }

            const data =
                await response.json();

            if (
                data.code !== "Ok" ||
                !data.routes?.length
            ) {
                throw new Error(
                    "Ruta no encontrada"
                );
            }

            const route =
                data.routes[0];

            state.route =
                route;

            renderDestination(
                destination
            );

            renderRoute(
                route
            );

            updateRouteUI(
                route
            );

            /*
             * Mostramos solamente radares
             * razonablemente próximos a la geometría.
             */
            renderRouteRadars(
                route
            );

            setText(
                "routeState",
                "ACTIVE"
            );

            showStatus(
                "RUTA ACTIVA"
            );

            return {
                distance:
                route.distance,

                duration:
                route.duration,

                instructions:
                    extractInstructions(
                        route
                    ),

                geometry:
                route.geometry
            };

        } catch (error) {
            console.error(
                "[Keolel Radar] Route:",
                error
            );

            setText(
                "routeState",
                "ERROR"
            );

            showStatus(
                "ERROR CALCULANDO RUTA"
            );

            return null;
        }
    }

    function getCurrentPositionForRoute() {
        if (
            state.simulation.active &&
            Number.isFinite(
                state.simulation.latitude
            ) &&
            Number.isFinite(
                state.simulation.longitude
            )
        ) {
            return {
                latitude:
                state.simulation.latitude,

                longitude:
                state.simulation.longitude
            };
        }

        if (
            state.lastPosition
        ) {
            return {
                latitude:
                state.lastPosition.latitude,

                longitude:
                state.lastPosition.longitude
            };
        }

        return null;
    }

    function renderDestination(
        destination
    ) {
        if (!state.map) {
            return;
        }

        if (
            state.destinationMarker
        ) {
            state.destinationMarker.remove();
        }

        state.destinationMarker =
            L.marker(
                [
                    destination.latitude,
                    destination.longitude
                ],
                {
                    zIndexOffset: 900
                }
            )
                .addTo(state.map)
                .bindPopup(
                    `<strong>${escapeHtml(
                        destination.name
                    )}</strong>`
                );

        state.destinationMarker.openPopup();
    }

    function renderRoute(
        route
    ) {
        if (
            !state.map ||
            !route?.geometry
        ) {
            return;
        }

        if (
            state.routeLine
        ) {
            state.routeLine.remove();
        }

        state.routeLine =
            L.geoJSON(
                route.geometry,
                {
                    style: {
                        color:
                            "#36c8d8",

                        weight: 5,

                        opacity: .8,

                        lineCap:
                            "round",

                        lineJoin:
                            "round"
                    }
                }
            ).addTo(state.map);

        const bounds =
            state.routeLine.getBounds();

        if (bounds.isValid()) {
            state.map.fitBounds(
                bounds,
                {
                    padding:
                        [70, 70]
                }
            );
        }
    }

    function updateRouteUI(
        route
    ) {
        setText(
            "routeDistance",
            formatDistance(
                route.distance
            )
        );

        setText(
            "routeEta",
            formatDuration(
                route.duration
            )
        );

        const instructions =
            extractInstructions(
                route
            );

        renderInstructions(
            instructions
        );

        const panel =
            byId("routePanel");

        if (panel) {
            panel.classList.add(
                "active"
            );
        }

        const summary =
            byId("routeSummary");

        if (summary) {
            summary.textContent =
                `${formatDistance(
                    route.distance
                )} · ${formatDuration(
                    route.duration
                )}`;
        }
    }

    function extractInstructions(
        route
    ) {
        const instructions = [];

        const legs =
            route?.legs || [];

        legs.forEach(
            leg => {
                (
                    leg.steps || []
                ).forEach(
                    step => {
                        const maneuver =
                            step.maneuver ||
                            {};

                        const name =
                            step.name ||
                            "";

                        let text =
                            "";

                        if (
                            maneuver.type ===
                            "depart"
                        ) {
                            text =
                                `SALIDA · ${name}`;
                        } else if (
                            maneuver.type ===
                            "arrive"
                        ) {
                            text =
                                "LLEGADA AL DESTINO";
                        } else {
                            const modifier =
                                maneuver.modifier
                                    ? ` · ${maneuver.modifier}`
                                    : "";

                            text =
                                `${maneuver.type || "MANIOBRA"}${modifier}` +
                                `${name ? ` · ${name}` : ""}`;
                        }

                        if (text.trim()) {
                            instructions.push(
                                text
                            );
                        }
                    }
                );
            }
        );

        return instructions;
    }

    function renderInstructions(
        instructions
    ) {
        const container =
            byId(
                "routeInstructions"
            );

        if (!container) {
            return;
        }

        container.innerHTML = "";

        instructions.forEach(
            instruction => {
                const element =
                    document.createElement(
                        "div"
                    );

                element.className =
                    "route-instruction";

                element.textContent =
                    instruction;

                container.appendChild(
                    element
                );
            }
        );
    }

    function renderRouteRadars(
        route
    ) {
        if (
            !state.routeRadarLayer ||
            !route?.geometry?.coordinates
        ) {
            return;
        }

        state.routeRadarLayer.clearLayers();

        const coordinates =
            route.geometry.coordinates;

        const routeRadars =
            state.radars.filter(
                radar =>
                    isRadarNearRoute(
                        radar,
                        coordinates,
                        100
                    )
            );

        routeRadars.forEach(
            radar => {
                const marker =
                    L.marker(
                        [
                            radar.latitude,
                            radar.longitude
                        ],
                        {
                            icon:
                                createRadarIcon(
                                    radar.limit
                                )
                        }
                    );

                marker.bindPopup(
                    `<strong>RADAR EN RUTA</strong><br>` +
                    `${
                        radar.limit
                            ? `LÍMITE ${radar.limit} KM/H`
                            : "LÍMITE NO DISPONIBLE"
                    }`
                );

                marker.addTo(
                    state.routeRadarLayer
                );
            }
        );
    }

    function isRadarNearRoute(
        radar,
        coordinates,
        maxDistance
    ) {
        for (
            const coordinate of coordinates
            ) {
            if (
                !Array.isArray(
                    coordinate
                )
            ) {
                continue;
            }

            const longitude =
                Number(
                    coordinate[0]
                );

            const latitude =
                Number(
                    coordinate[1]
                );

            if (
                distanceMeters(
                    radar.latitude,
                    radar.longitude,
                    latitude,
                    longitude
                ) <= maxDistance
            ) {
                return true;
            }
        }

        return false;
    }

    function formatDistance(
        meters
    ) {
        const value =
            Number(meters);

        if (
            !Number.isFinite(value)
        ) {
            return "--";
        }

        if (value < 1000) {
            return `${Math.round(value)} M`;
        }

        return (
            (value / 1000)
                .toFixed(1)
                .replace(".0", "") +
            " KM"
        );
    }

    function formatDuration(
        seconds
    ) {
        const value =
            Number(seconds);

        if (
            !Number.isFinite(value)
        ) {
            return "--";
        }

        const minutes =
            Math.round(
                value / 60
            );

        if (minutes < 60) {
            return `${minutes} MIN`;
        }

        const hours =
            Math.floor(
                minutes / 60
            );

        const remaining =
            minutes % 60;

        if (!remaining) {
            return `${hours} H`;
        }

        return `${hours} H ${remaining} MIN`;
    }

    /*
     * ============================================================
     * UI
     * ============================================================
     */

    function updateGpsUI(active) {
        const value =
            active
                ? "ON"
                : "OFF";

        setText(
            "gpsStateHeader",
            value
        );

        setText(
            "gpsStateSidebar",
            value
        );

        setText(
            "gpsStateBottom",
            value
        );

        if (active) {
            setText(
                "systemStatus",
                "SYSTEM ONLINE"
            );

            setText(
                "systemStatusBottom",
                "ACTIVE"
            );
        }
    }

    function updateRadarCountUI() {
        const value =
            formatRadarCount(
                state.radarCount
            );

        setText(
            "radarCountHeader",
            value
        );

        setText(
            "radarCountSidebar",
            value
        );

        setText(
            "radarCountBottom",
            value
        );
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll(
                "&",
                "&amp;"
            )
            .replaceAll(
                "<",
                "&lt;"
            )
            .replaceAll(
                ">",
                "&gt;"
            )
            .replaceAll(
                '"',
                "&quot;"
            )
            .replaceAll(
                "'",
                "&#039;"
            );
    }

    /*
     * ============================================================
     * REFRESH RADARES
     * ============================================================
     */

    function startRadarRefresh() {
        if (
            state.radarRefreshTimer
        ) {
            clearInterval(
                state.radarRefreshTimer
            );
        }

        state.radarRefreshTimer =
            setInterval(
                () => {
                    const position =
                        getCurrentPositionForRoute();

                    if (!position) {
                        return;
                    }

                    loadRadars(
                        position.latitude,
                        position.longitude
                    );
                },
                CONFIG.radar.refreshInterval
            );
    }

    /*
     * ============================================================
     * INIT
     * ============================================================
     */

    function initialize() {
        if (
            state.initialized
        ) {
            return;
        }

        state.initialized =
            true;

        const mapReady =
            initializeMap();

        if (!mapReady) {
            return;
        }

        updateGpsUI(false);

        updateRadarCountUI();

        showStatus(
            "RADAR ONLINE · ESPERANDO GPS"
        );

        /*
         * Pedimos ubicación automáticamente.
         * El navegador solicitará permiso.
         */
        requestLocation();

        /*
         * Carga inicial sobre Montevideo.
         * Esto permite mostrar radares incluso
         * antes de que el usuario conceda GPS.
         */
        loadRadars(
            CONFIG.map.defaultCenter[0],
            CONFIG.map.defaultCenter[1]
        );

        startRadarRefresh();

        window.setTimeout(
            () => {
                if (state.map) {
                    state.map.invalidateSize();
                }
            },
            300
        );

        window.setTimeout(
            () => {
                if (state.map) {
                    state.map.invalidateSize();
                }
            },
            1000
        );
    }

    /*
     * ============================================================
     * API PÚBLICA
     * ============================================================
     */

    window.TrafficMap = {

        get map() {
            return state.map;
        },

        get radarCount() {
            return state.radarCount;
        },

        get radars() {
            return state.radars;
        },

        get simulation() {
            return state.simulation;
        },

        get destination() {
            return state.destination;
        },

        set destination(value) {
            state.destination =
                value;
        },

        get destinationLatitude() {
            return state.destinationLatitude;
        },

        set destinationLatitude(value) {
            state.destinationLatitude =
                Number(value);
        },

        get destinationLongitude() {
            return state.destinationLongitude;
        },

        set destinationLongitude(value) {
            state.destinationLongitude =
                Number(value);
        },

        get route() {
            return state.route;
        },

        requestLocation,

        startSimulation,

        stopSimulation,

        updateUserMarker,

        calculateRouteToDestination,

        distanceMeters,

        destinationPoint,

        checkRadars,

        updateSimulationUI,

        showStatus,

        invalidateSize() {
            if (state.map) {
                state.map.invalidateSize();
            }
        }
    };

    /*
     * ============================================================
     * ARRANQUE
     * ============================================================
     */

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once: true
            }
        );
    } else {
        initialize();
    }

})();

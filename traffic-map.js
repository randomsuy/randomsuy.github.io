(() => {
    "use strict";

    const CONFIG = {
        map: {
            center: [-34.9011, -56.1645],
            zoom: 13,
            minZoom: 10,
            maxZoom: 19,
            bounds: [
                [-35.08, -56.35],
                [-34.70, -55.90]
            ]
        },

        gps: {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 3000
        },

        radar: {
            warningDistance: 300,
            directionAngle: 55,
            queryRadius: 50000,
            refreshInterval: 300000
        },

        cameras: {
            refreshInterval: 300000,
            source:
                "https://montevideo.gub.uy/tipo/area-tematica/movilidad/gestion-de-la-movilidad/camaras-de-monitoreo-del-transito",
            proxy:
                "https://r.jina.ai/http://montevideo.gub.uy/tipo/area-tematica/movilidad/gestion-de-la-movilidad/camaras-de-monitoreo-del-transito",
            geocoder:
                "https://nominatim.openstreetmap.org/search",
            cacheKey: "trafficmap_official_cameras_v4"
        },

        simulation: {
            stepMeters: 20,
            defaultSpeed: 5
        },

        services: {
            overpass: "https://overpass-api.de/api/interpreter"
        }
    };

    const state = {
        initialized: false,
        map: null,
        userMarker: null,
        accuracyCircle: null,
        radarLayer: null,
        cameraLayer: null,
        roadLayer: null,
        radars: [],
        cameras: [],
        radarCount: 0,
        cameraCount: 0,
        locationWatchId: null,
        locationActive: false,
        lastPosition: null,
        warningRadar: null,
        warningCamera: null,
        radarRefreshTimer: null,
        cameraRefreshTimer: null,
        lastRadarQuery: 0,
        lastSpeech: 0,
        heading: 0,
        headingSource: "none",
        orientationReady: false,
        orientationPermission: false,
        cameraLoading: false,
        radarLoading: false,

        settings: {
            voice: true,
            radarAlert: true,
            cameraAlert: true
        },

        simulation: {
            active: false,
            latitude: null,
            longitude: null,
            heading: 0,
            speed: CONFIG.simulation.defaultSpeed,
            radar: null,
            distance: null
        }
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function safeNumber(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function setText(id, value) {
        const el = byId(id);
        if (el) {
            el.textContent = String(value);
        }
    }

    function showStatus(message) {
        setText("status", message);
    }

    function normalizeText(value) {
        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function distanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const a1 = Number(lat1) * Math.PI / 180;
        const a2 = Number(lat2) * Math.PI / 180;
        const dLat = (Number(lat2) - Number(lat1)) * Math.PI / 180;
        const dLon = (Number(lon2) - Number(lon1)) * Math.PI / 180;

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(a1) *
            Math.cos(a2) *
            Math.sin(dLon / 2) ** 2;

        return R * 2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );
    }

    function bearingBetween(lat1, lon1, lat2, lon2) {
        const a1 = Number(lat1) * Math.PI / 180;
        const a2 = Number(lat2) * Math.PI / 180;
        const dLon = (Number(lon2) - Number(lon1)) * Math.PI / 180;

        const y = Math.sin(dLon) * Math.cos(a2);

        const x =
            Math.cos(a1) * Math.sin(a2) -
            Math.sin(a1) * Math.cos(a2) * Math.cos(dLon);

        return (
            Math.atan2(y, x) * 180 / Math.PI + 360
        ) % 360;
    }

    function angleDifference(a, b) {
        let d = Math.abs(Number(a) - Number(b)) % 360;
        return d > 180 ? 360 - d : d;
    }

    function destinationPoint(lat, lon, bearing, distance) {
        const R = 6371000;
        const phi1 = Number(lat) * Math.PI / 180;
        const lambda1 = Number(lon) * Math.PI / 180;
        const theta = Number(bearing) * Math.PI / 180;
        const delta = Number(distance) / R;

        const phi2 = Math.asin(
            Math.sin(phi1) * Math.cos(delta) +
            Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
        );

        const lambda2 =
            lambda1 +
            Math.atan2(
                Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
                Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
            );

        return {
            latitude: phi2 * 180 / Math.PI,
            longitude: lambda2 * 180 / Math.PI
        };
    }

    function createUserIcon() {
        return L.divIcon({
            className: "traffic-user-icon",
            html: `
                <div style="
                    width:20px;
                    height:20px;
                    border-radius:50%;
                    background:#20d8ff;
                    border:3px solid #071014;
                    box-shadow:
                        0 0 0 5px rgba(32,216,255,.18),
                        0 0 22px rgba(32,216,255,.95);
                "></div>
            `,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });
    }

    function createRadarIcon(limit) {
        const speed =
            Number.isFinite(Number(limit)) && Number(limit) > 0
                ? Number(limit)
                : "—";

        return L.divIcon({
            className: "traffic-radar-icon",
            html: `
                <div style="
                    width:42px;
                    height:42px;
                    border-radius:50%;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    position:relative;
                    background:#160708;
                    border:3px solid #ff3131;
                    color:#fff;
                    font-family:Arial,sans-serif;
                    font-size:11px;
                    font-weight:900;
                    box-shadow:
                        0 0 0 4px rgba(255,49,49,.13),
                        0 0 20px rgba(255,49,49,.8);
                ">
                    ${speed}
                    <span style="
                        position:absolute;
                        bottom:-7px;
                        font-size:7px;
                        color:#ff6666;
                    ">KM/H</span>
                </div>
            `,
            iconSize: [42, 42],
            iconAnchor: [21, 21]
        });
    }

    function createCameraIcon() {
        return L.divIcon({
            className: "traffic-camera-icon",
            html: `
                <div style="
                    width:30px;
                    height:30px;
                    border-radius:9px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    background:#ff8a00;
                    border:2px solid #fff3df;
                    box-shadow:
                        0 0 0 3px rgba(255,138,0,.22),
                        0 0 16px rgba(255,138,0,.9);
                    color:#201000;
                    font-size:15px;
                    font-weight:900;
                ">●</div>
            `,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
    }

    function initializeMap() {
        const mapElement = byId("map");

        if (!window.L || !mapElement) {
            showStatus("LEAFLET NO DISPONIBLE");
            return false;
        }

        state.map = L.map(mapElement, {
            center: CONFIG.map.center,
            zoom: CONFIG.map.zoom,
            minZoom: CONFIG.map.minZoom,
            maxZoom: CONFIG.map.maxZoom,
            maxBounds: CONFIG.map.bounds,
            maxBoundsViscosity: 0.8,
            zoomControl: false,
            attributionControl: true,
            preferCanvas: true
        });

        L.control.zoom({
            position: "bottomright"
        }).addTo(state.map);

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: CONFIG.map.maxZoom,
                attribution: "&copy; OpenStreetMap contributors"
            }
        ).addTo(state.map);

        state.roadLayer = L.layerGroup().addTo(state.map);
        state.radarLayer = L.layerGroup().addTo(state.map);
        state.cameraLayer = L.layerGroup().addTo(state.map);

        state.map.on("click", event => {
            if (!state.simulation.active) {
                return;
            }

            state.simulation.latitude = event.latlng.lat;
            state.simulation.longitude = event.latlng.lng;

            updateSimulationPosition();
        });

        return true;
    }

    function requestLocation(force = false) {
        if (state.simulation.active && !force) {
            return;
        }

        if (!navigator.geolocation) {
            state.locationActive = false;
            showStatus("GPS NO DISPONIBLE");
            return;
        }

        showStatus("OBTENIENDO GPS...");

        navigator.geolocation.getCurrentPosition(
            handlePosition,
            handlePositionError,
            CONFIG.gps
        );

        startLocationWatch();
    }

    function startLocationWatch() {
        if (state.locationWatchId !== null) {
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

    function handlePosition(position) {
        if (!position || !position.coords) {
            return;
        }

        const latitude = safeNumber(position.coords.latitude);
        const longitude = safeNumber(position.coords.longitude);
        const accuracy = safeNumber(position.coords.accuracy, 0);
        const speed = safeNumber(position.coords.speed, 0);

        let heading = Number(position.coords.heading);

        if (
            !Number.isFinite(heading) ||
            heading < 0
        ) {
            heading = state.heading;
        }

        if (
            Number.isFinite(heading) &&
            speed > 0.8
        ) {
            state.heading = heading;
            state.headingSource = "gps";
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

        updateUserMarker(latitude, longitude);

        if (!state.simulation.active) {
            const zoom = state.map?.getZoom();

            if (
                state.map &&
                (!state.userMarker || zoom < 14)
            ) {
                state.map.setView(
                    [latitude, longitude],
                    16,
                    { animate: true }
                );
            }
        }

        checkNearbyAlerts(latitude, longitude);

        showStatus(
            `GPS ACTIVO · ${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
        );
    }

    function handlePositionError(error) {
        state.locationActive = false;

        if (error?.code === 1) {
            showStatus("PERMISO GPS DENEGADO");
        } else if (error?.code === 2) {
            showStatus("GPS NO DISPONIBLE");
        } else if (error?.code === 3) {
            showStatus("TIMEOUT GPS");
        } else {
            showStatus("ERROR GPS");
        }
    }

    function updateUserMarker(latitude, longitude) {
        if (!state.map) {
            return;
        }

        if (!state.userMarker) {
            state.userMarker =
                L.marker(
                    [latitude, longitude],
                    {
                        icon: createUserIcon(),
                        zIndexOffset: 5000
                    }
                )
                .addTo(state.map)
                .bindTooltip(
                    "TU POSICIÓN",
                    {
                        direction: "top",
                        offset: [0, -12]
                    }
                );
        } else {
            state.userMarker.setLatLng([
                latitude,
                longitude
            ]);
        }

        const accuracy =
            state.lastPosition?.accuracy || 15;

        if (!state.accuracyCircle) {
            state.accuracyCircle =
                L.circle(
                    [latitude, longitude],
                    {
                        radius: accuracy,
                        color: "#20d8ff",
                        weight: 1,
                        opacity: .3,
                        fillColor: "#20d8ff",
                        fillOpacity: .04,
                        interactive: false
                    }
                ).addTo(state.map);
        } else {
            state.accuracyCircle.setLatLng([
                latitude,
                longitude
            ]);

            state.accuracyCircle.setRadius(
                accuracy
            );
        }
    }

    async function loadRadars(latitude, longitude) {
        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            return;
        }

        if (state.radarLoading) {
            return;
        }

        if (
            Date.now() - state.lastRadarQuery < 30000
        ) {
            return;
        }

        state.lastRadarQuery = Date.now();
        state.radarLoading = true;

        showStatus("CARGANDO RADARES...");

        const radius = CONFIG.radar.queryRadius;

        const query = `
[out:json][timeout:40];
(
  node["highway"="speed_camera"](around:${radius},${latitude},${longitude});
  way["highway"="speed_camera"](around:${radius},${latitude},${longitude});
  node["enforcement"="maxspeed"](around:${radius},${latitude},${longitude});
  way["enforcement"="maxspeed"](around:${radius},${latitude},${longitude});
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
                                "application/x-www-form-urlencoded;charset=UTF-8"
                        },
                        body:
                            "data=" +
                            encodeURIComponent(query)
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const data = await response.json();

            const normalized =
                normalizeRadarData(
                    data?.elements || []
                );

            state.radars =
                deduplicateRadars(normalized);

            state.radarCount =
                state.radars.length;

            renderRadars();

            showStatus(
                `${state.radarCount} RADARES CARGADOS`
            );
        } catch (error) {
            console.error(error);
            showStatus("ERROR CARGANDO RADARES");
        } finally {
            state.radarLoading = false;
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

            const limit =
                parseSpeedLimit(
                    tags.maxspeed ||
                    tags.maxspeed_forward ||
                    tags.maxspeed_backward ||
                    tags["maxspeed:forward"] ||
                    tags["maxspeed:backward"]
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
                    tags.direction ||
                    tags["camera:direction"] ||
                    null,
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

        return match
            ? Number(match[1])
            : null;
    }

    function deduplicateRadars(radars) {
        const result = [];

        for (const radar of radars) {
            const duplicate =
                result.some(
                    item =>
                        distanceMeters(
                            item.latitude,
                            item.longitude,
                            radar.latitude,
                            radar.longitude
                        ) < 20
                );

            if (!duplicate) {
                result.push(radar);
            }
        }

        return result;
    }

    function renderRadars() {
        if (!state.radarLayer) {
            return;
        }

        state.radarLayer.clearLayers();

        for (const radar of state.radars) {
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

            const limit =
                radar.limit
                    ? `${radar.limit} KM/H`
                    : "LÍMITE NO DISPONIBLE";

            marker.bindPopup(`
                <div style="
                    min-width:180px;
                    font-family:Arial,sans-serif;
                ">
                    <strong>RADAR DE VELOCIDAD</strong>
                    <br>
                    Límite: ${limit}
                    <br>
                    Fuente: OpenStreetMap
                </div>
            `);

            marker.addTo(state.radarLayer);
        }
    }

    function getRadarBearing(radar) {
        const value = radar?.direction;

        if (value === null || value === undefined) {
            return null;
        }

        const numeric = Number(value);

        if (Number.isFinite(numeric)) {
            return numeric;
        }

        const text =
            normalizeText(value).toLowerCase();

        const directions = {
            n: 0,
            norte: 0,
            ne: 45,
            noreste: 45,
            e: 90,
            este: 90,
            se: 135,
            sureste: 135,
            s: 180,
            sur: 180,
            so: 225,
            suroeste: 225,
            o: 270,
            oeste: 270,
            no: 315,
            noroeste: 315
        };

        return directions[text] ?? null;
    }

    function isRadarAhead(radar, latitude, longitude) {
        const bearing =
            getRadarBearing(radar);

        const userHeading =
            state.simulation.active
                ? state.simulation.heading
                : state.heading;

        const distance =
            distanceMeters(
                latitude,
                longitude,
                radar.latitude,
                radar.longitude
            );

        if (
            distance >
            CONFIG.radar.warningDistance
        ) {
            return false;
        }

        const directionToRadar =
            bearingBetween(
                latitude,
                longitude,
                radar.latitude,
                radar.longitude
            );

        if (
            angleDifference(
                userHeading,
                directionToRadar
            ) > 75
        ) {
            return false;
        }

        if (bearing !== null) {
            if (
                angleDifference(
                    userHeading,
                    bearing
                ) >
                CONFIG.radar.directionAngle
            ) {
                return false;
            }
        }

        return true;
    }

    function findClosestRadarAhead(
        latitude,
        longitude
    ) {
        let closest = null;

        for (const radar of state.radars) {
            if (
                !isRadarAhead(
                    radar,
                    latitude,
                    longitude
                )
            ) {
                continue;
            }

            const distance =
                distanceMeters(
                    latitude,
                    longitude,
                    radar.latitude,
                    radar.longitude
                );

            if (
                !closest ||
                distance < closest.distance
            ) {
                closest = {
                    radar,
                    distance
                };
            }
        }

        return closest;
    }

    function normalizeCameraName(value) {
        let text = String(value || "");

        text =
            text
                .replace(/^\s*[*•-]\s*/, "")
                .replace(/\s+/g, " ")
                .trim();

        text =
            text
                .replace(/\s*\/\s*/g, " / ")
                .replace(/\s*\(\s*/g, " (")
                .replace(/\s*\)\s*/g, ")");

        return text;
    }

    function isCameraLocationText(text) {
        const value =
            normalizeText(text).toLowerCase();

        if (!value) {
            return false;
        }

        if (
            value.length < 8 ||
            value.length > 180
        ) {
            return false;
        }

        const hasIntersection =
            value.includes(" y ") ||
            value.includes(" / ") ||
            value.includes("tunel") ||
            value.includes("acceso") ||
            value.includes("salida");

        const blacklist = [
            "camaras de monitoreo",
            "filmaciones",
            "ultima actualizacion",
            "publicado",
            "derecho a la informacion",
            "formulario",
            "centro y cordon",
            "aguada",
            "parque rodo",
            "pocitos",
            "buceo",
            "tres cruces",
            "parque batlle",
            "accesos",
            "colon y sayago",
            "paso molino",
            "jacinto vera",
            "la blanqueada",
            "mercado modelo",
            "flor de maronas",
            "cerrito",
            "prado"
        ];

        if (
            blacklist.some(
                item => value === item
            )
        ) {
            return false;
        }

        return hasIntersection;
    }

    async function fetchOfficialCameraPage() {
        let response;

        try {
            response =
                await fetch(
                    CONFIG.cameras.source,
                    {
                        method: "GET",
                        cache: "no-store"
                    }
                );

            if (response.ok) {
                return await response.text();
            }
        } catch (_) {}

        try {
            response =
                await fetch(
                    CONFIG.cameras.proxy,
                    {
                        method: "GET",
                        cache: "no-store"
                    }
                );

            if (response.ok) {
                return await response.text();
            }
        } catch (_) {}

        throw new Error(
            "No se pudo obtener la página oficial"
        );
    }

    function parseOfficialCameraLocations(html) {
        const locations = [];

        const parser =
            new DOMParser();

        const doc =
            parser.parseFromString(
                html,
                "text/html"
            );

        const candidates = [];

        doc
            .querySelectorAll(
                "li, p"
            )
            .forEach(
                element => {
                    const text =
                        normalizeCameraName(
                            element.textContent
                        );

                    if (
                        isCameraLocationText(
                            text
                        )
                    ) {
                        candidates.push(text);
                    }
                }
            );

        const plainText =
            doc.body?.innerText || "";

        plainText
            .split(/\n+/)
            .map(
                item =>
                    normalizeCameraName(item)
            )
            .filter(
                item =>
                    isCameraLocationText(item)
            )
            .forEach(
                item =>
                    candidates.push(item)
            );

        for (const location of candidates) {
            const normalized =
                normalizeText(
                    location
                ).toLowerCase();

            if (
                locations.some(
                    item =>
                        normalizeText(
                            item
                        ).toLowerCase() ===
                        normalized
                )
            ) {
                continue;
            }

            locations.push(location);
        }

        return locations;
    }

    function loadCameraCache() {
        try {
            const raw =
                localStorage.getItem(
                    CONFIG.cameras.cacheKey
                );

            if (!raw) {
                return {};
            }

            const parsed =
                JSON.parse(raw);

            return parsed &&
                typeof parsed === "object"
                ? parsed
                : {};
        } catch (_) {
            return {};
        }
    }

    function saveCameraCache(cache) {
        try {
            localStorage.setItem(
                CONFIG.cameras.cacheKey,
                JSON.stringify(cache)
            );
        } catch (_) {}
    }

    function cameraCacheKey(location) {
        return normalizeText(location)
            .toLowerCase()
            .replace(/[^a-z0-9áéíóúüñ ]/gi, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    async function geocodeCameraLocation(location) {
        const query =
            `${location}, Montevideo, Uruguay`;

        const url =
            CONFIG.cameras.geocoder +
            "?format=jsonv2" +
            "&limit=1" +
            "&countrycodes=uy" +
            "&q=" +
            encodeURIComponent(query);

        const response =
            await fetch(
                url,
                {
                    headers: {
                        "Accept":
                            "application/json"
                    }
                }
            );

        if (!response.ok) {
            throw new Error(
                `Geocoder HTTP ${response.status}`
            );
        }

        const data =
            await response.json();

        if (
            !Array.isArray(data) ||
            !data.length
        ) {
            return null;
        }

        const latitude =
            Number(data[0].lat);

        const longitude =
            Number(data[0].lon);

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            return null;
        }

        if (
            latitude < -35.2 ||
            latitude > -34.5 ||
            longitude < -56.8 ||
            longitude > -55.5
        ) {
            return null;
        }

        return {
            latitude,
            longitude
        };
    }

    async function geocodeMissingCameras(
        locations,
        cache
    ) {
        const result = [];

        for (
            let index = 0;
            index < locations.length;
            index++
        ) {
            const location =
                locations[index];

            const key =
                cameraCacheKey(location);

            if (cache[key]) {
                result.push({
                    id: key,
                    name: location,
                    latitude:
                        cache[key].latitude,
                    longitude:
                        cache[key].longitude
                });

                continue;
            }

            showStatus(
                `UBICANDO CÁMARA ${index + 1}/${locations.length}`
            );

            try {
                const point =
                    await geocodeCameraLocation(
                        location
                    );

                if (point) {
                    cache[key] = {
                        latitude:
                            point.latitude,
                        longitude:
                            point.longitude,
                        updated:
                            Date.now()
                    };

                    result.push({
                        id: key,
                        name: location,
                        latitude:
                            point.latitude,
                        longitude:
                            point.longitude
                    });
                }
            } catch (error) {
                console.warn(
                    "Geocoder:",
                    location,
                    error
                );
            }

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        1100
                    )
            );
        }

        saveCameraCache(cache);

        return result;
    }

    async function loadOfficialCameras() {
        if (state.cameraLoading) {
            return;
        }

        state.cameraLoading = true;

        showStatus(
            "CARGANDO CÁMARAS OFICIALES..."
        );

        try {
            const html =
                await fetchOfficialCameraPage();

            const locations =
                parseOfficialCameraLocations(
                    html
                );

            if (!locations.length) {
                throw new Error(
                    "No se encontraron ubicaciones"
                );
            }

            const cache =
                loadCameraCache();

            const cameras =
                await geocodeMissingCameras(
                    locations,
                    cache
                );

            state.cameras =
                deduplicateCameras(
                    cameras
                );

            state.cameraCount =
                state.cameras.length;

            renderCameras();

            showStatus(
                `${state.cameraCount} CÁMARAS OFICIALES`
            );
        } catch (error) {
            console.error(
                "[Cameras]",
                error
            );

            showStatus(
                "ERROR CARGANDO CÁMARAS OFICIALES"
            );
        } finally {
            state.cameraLoading = false;
        }
    }

    function deduplicateCameras(cameras) {
        const result = [];

        for (const camera of cameras) {
            const duplicate =
                result.some(
                    item =>
                        distanceMeters(
                            item.latitude,
                            item.longitude,
                            camera.latitude,
                            camera.longitude
                        ) < 25
                );

            if (!duplicate) {
                result.push(camera);
            }
        }

        return result;
    }

    function renderCameras() {
        if (!state.cameraLayer) {
            return;
        }

        state.cameraLayer.clearLayers();

        for (const camera of state.cameras) {
            const marker =
                L.marker(
                    [
                        camera.latitude,
                        camera.longitude
                    ],
                    {
                        icon:
                            createCameraIcon(),
                        zIndexOffset: 2000
                    }
                );

            marker.bindPopup(`
                <div style="
                    min-width:190px;
                    font-family:Arial,sans-serif;
                ">
                    <strong>CÁMARA DE TRÁNSITO</strong>
                    <br>
                    ${escapeHtml(camera.name)}
                    <br><br>
                    <span style="color:#ff8a00;font-weight:700">
                        FUENTE: INTENDENCIA DE MONTEVIDEO
                    </span>
                </div>
            `);

            marker.addTo(
                state.cameraLayer
            );
        }
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function findClosestCamera(
        latitude,
        longitude
    ) {
        let closest = null;

        for (const camera of state.cameras) {
            const distance =
                distanceMeters(
                    latitude,
                    longitude,
                    camera.latitude,
                    camera.longitude
                );

            if (
                !closest ||
                distance < closest.distance
            ) {
                closest = {
                    camera,
                    distance
                };
            }
        }

        return closest;
    }

    function checkNearbyAlerts(
        latitude,
        longitude
    ) {
        const radar =
            findClosestRadarAhead(
                latitude,
                longitude
            );

        if (
            radar &&
            state.settings.radarAlert
        ) {
            showRadarWarning(
                radar.radar,
                radar.distance
            );
        } else {
            hideRadarWarning();
        }

        const camera =
            findClosestCamera(
                latitude,
                longitude
            );

        if (
            camera &&
            camera.distance <=
            CONFIG.radar.warningDistance &&
            state.settings.cameraAlert
        ) {
            showCameraWarning(
                camera.camera,
                camera.distance
            );
        } else {
            hideCameraWarning();
        }
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

        const distanceEl =
            byId("radarWarningDistance");

        const limitEl =
            byId("radarWarningLimit");

        const rounded =
            Math.max(
                1,
                Math.round(distance)
            );

        if (distanceEl) {
            distanceEl.textContent =
                `${rounded} M`;
        }

        if (limitEl) {
            limitEl.textContent =
                radar.limit
                    ? `LÍMITE ${radar.limit} KM/H`
                    : "RADAR";
        }

        warning.classList.add("active");

        speakAlert(
            radar.limit
                ? `Radar a ${rounded} metros. Límite ${radar.limit} kilómetros por hora.`
                : `Radar a ${rounded} metros.`
        );
    }

    function showCameraWarning(
        camera,
        distance
    ) {
        const warning =
            byId("cameraWarning");

        if (!warning) {
            return;
        }

        const distanceEl =
            byId("cameraWarningDistance");

        if (distanceEl) {
            distanceEl.textContent =
                `${Math.max(1, Math.round(distance))} M`;
        }

        warning.classList.add("active");

        speakAlert(
            `Cámara de tránsito a ${Math.max(
                1,
                Math.round(distance)
            )} metros.`
        );
    }

    function hideRadarWarning() {
        const warning =
            byId("radarWarning");

        if (warning) {
            warning.classList.remove("active");
        }

        state.warningRadar = null;
    }

    function hideCameraWarning() {
        const warning =
            byId("cameraWarning");

        if (warning) {
            warning.classList.remove("active");
        }

        state.warningCamera = null;
    }

    function speakAlert(text) {
        if (!state.settings.voice) {
            return;
        }

        if (
            !("speechSynthesis" in window)
        ) {
            return;
        }

        const now = Date.now();

        if (
            now - state.lastSpeech <
            10000
        ) {
            return;
        }

        state.lastSpeech = now;

        try {
            window.speechSynthesis.cancel();

            const utterance =
                new SpeechSynthesisUtterance(
                    text
                );

            utterance.lang = "es-UY";
            utterance.rate = 1;
            utterance.pitch = 1;

            window.speechSynthesis.speak(
                utterance
            );
        } catch (_) {}
    }

    async function requestOrientationPermission() {
        try {
            if (
                typeof DeviceOrientationEvent !==
                "undefined" &&
                typeof DeviceOrientationEvent.requestPermission ===
                "function"
            ) {
                const result =
                    await DeviceOrientationEvent
                        .requestPermission();

                state.orientationPermission =
                    result === "granted";

                if (
                    state.orientationPermission
                ) {
                    startOrientation();
                }

                return state.orientationPermission;
            }

            startOrientation();

            state.orientationPermission = true;

            return true;
        } catch (error) {
            console.warn(
                "Orientation:",
                error
            );

            return false;
        }
    }

    function startOrientation() {
        if (state.orientationReady) {
            return;
        }

        window.addEventListener(
            "deviceorientationabsolute",
            handleOrientation,
            true
        );

        window.addEventListener(
            "deviceorientation",
            handleOrientation,
            true
        );

        state.orientationReady = true;

        showStatus(
            "GIROSCOPIO ACTIVO"
        );
    }

    function handleOrientation(event) {
        if (!event) {
            return;
        }

        let heading = null;

        if (
            Number.isFinite(
                Number(event.webkitCompassHeading)
            )
        ) {
            heading =
                Number(
                    event.webkitCompassHeading
                );
        } else if (
            Number.isFinite(
                Number(event.alpha)
            )
        ) {
            heading =
                360 -
                Number(event.alpha);

            if (
                Number.isFinite(
                    Number(event.beta)
                ) &&
                Number(event.beta) < -45
            ) {
                heading =
                    (heading + 180) % 360;
            }
        }

        if (
            !Number.isFinite(heading)
        ) {
            return;
        }

        heading =
            (heading + 360) % 360;

        state.heading = heading;
        state.headingSource = "gyro";

        updateHeadingUI(heading);
    }

    function updateHeadingUI(heading) {
        const indicator =
            byId("headingIndicator");

        if (!indicator) {
            return;
        }

        indicator.style.transform =
            `rotate(${heading}deg)`;
    }

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
                state.map.getCenter();

            latitude = center.lat;
            longitude = center.lng;
        }

        state.simulation.active = true;
        state.simulation.latitude = latitude;
        state.simulation.longitude = longitude;
        state.simulation.heading =
            Number(state.heading) || 0;
        state.simulation.speed =
            CONFIG.simulation.defaultSpeed;

        updateUserMarker(
            latitude,
            longitude
        );

        state.map.setView(
            [
                latitude,
                longitude
            ],
            16,
            {
                animate: true
            }
        );

        showStatus(
            "MODO PRUEBA ACTIVO"
        );

        updateSimulationUI();
    }

    function stopSimulation() {
        state.simulation.active = false;
        hideRadarWarning();
        hideCameraWarning();

        showStatus(
            state.locationActive
                ? "GPS ACTIVO"
                : "GPS OFF"
        );
    }

    function simulationStep() {
        if (!state.simulation.active) {
            return;
        }

        const simulation =
            state.simulation;

        const next =
            destinationPoint(
                simulation.latitude,
                simulation.longitude,
                simulation.heading,
                CONFIG.simulation.stepMeters
            );

        simulation.latitude =
            next.latitude;

        simulation.longitude =
            next.longitude;

        updateSimulationPosition();
    }

    function updateSimulationPosition() {
        if (!state.simulation.active) {
            return;
        }

        updateUserMarker(
            state.simulation.latitude,
            state.simulation.longitude
        );

        checkNearbyAlerts(
            state.simulation.latitude,
            state.simulation.longitude
        );

        updateSimulationUI();

        state.map.panTo(
            [
                state.simulation.latitude,
                state.simulation.longitude
            ],
            {
                animate: true,
                duration: .2
            }
        );
    }

    function updateSimulationUI() {
        if (!state.simulation.active) {
            return;
        }

        const result =
            findClosestRadarAhead(
                state.simulation.latitude,
                state.simulation.longitude
            );

        state.simulation.radar =
            result?.radar || null;

        state.simulation.distance =
            result?.distance ?? null;
    }

    function resetSimulation() {
        if (!state.simulation.active) {
            return;
        }

        const latitude =
            state.lastPosition?.latitude ??
            state.map.getCenter().lat;

        const longitude =
            state.lastPosition?.longitude ??
            state.map.getCenter().lng;

        state.simulation.latitude =
            latitude;

        state.simulation.longitude =
            longitude;

        state.simulation.heading =
            state.heading;

        hideRadarWarning();
        hideCameraWarning();

        updateUserMarker(
            latitude,
            longitude
        );

        state.map.setView(
            [
                latitude,
                longitude
            ],
            16,
            {
                animate: true
            }
        );
    }

    function startRefreshTimers() {
        if (state.radarRefreshTimer) {
            clearInterval(
                state.radarRefreshTimer
            );
        }

        if (state.cameraRefreshTimer) {
            clearInterval(
                state.cameraRefreshTimer
            );
        }

        state.radarRefreshTimer =
            setInterval(
                () => {
                    const position =
                        state.simulation.active
                            ? {
                                latitude:
                                    state.simulation.latitude,
                                longitude:
                                    state.simulation.longitude
                            }
                            : state.lastPosition;

                    if (position) {
                        loadRadars(
                            position.latitude,
                            position.longitude
                        );
                    }
                },
                CONFIG.radar.refreshInterval
            );

        state.cameraRefreshTimer =
            setInterval(
                () => {
                    loadOfficialCameras();
                },
                CONFIG.cameras.refreshInterval
            );
    }

    function setSetting(
        name,
        value
    ) {
        if (
            !Object.prototype.hasOwnProperty.call(
                state.settings,
                name
            )
        ) {
            return;
        }

        state.settings[name] =
            Boolean(value);

        try {
            localStorage.setItem(
                `traffic_${name}`,
                state.settings[name]
                    ? "1"
                    : "0"
            );
        } catch (_) {}
    }

    function loadSettings() {
        for (
            const name of
            Object.keys(state.settings)
        ) {
            try {
                const value =
                    localStorage.getItem(
                        `traffic_${name}`
                    );

                if (
                    value === "0" ||
                    value === "1"
                ) {
                    state.settings[name] =
                        value === "1";
                }
            } catch (_) {}
        }
    }

    async function initialize() {
        if (state.initialized) {
            return;
        }

        state.initialized = true;

        loadSettings();

        if (!initializeMap()) {
            return;
        }

        showStatus(
            "INICIANDO RADAR..."
        );

        requestLocation();

        loadRadars(
            CONFIG.map.center[0],
            CONFIG.map.center[1]
        );

        loadOfficialCameras();

        startRefreshTimers();

        setTimeout(
            () => {
                state.map?.invalidateSize();
            },
            300
        );

        setTimeout(
            () => {
                state.map?.invalidateSize();
            },
            1000
        );
    }

    window.TrafficMap = {
        get map() {
            return state.map;
        },

        get radars() {
            return state.radars;
        },

        get cameras() {
            return state.cameras;
        },

        get radarCount() {
            return state.radarCount;
        },

        get cameraCount() {
            return state.cameraCount;
        },

        get simulation() {
            return state.simulation;
        },

        get settings() {
            return state.settings;
        },

        get heading() {
            return state.heading;
        },

        requestLocation,

        requestOrientationPermission,

        startOrientation,

        startSimulation,

        stopSimulation,

        simulationStep,

        resetSimulation,

        setSetting,

        loadOfficialCameras,

        loadRadars,

        invalidateSize() {
            state.map?.invalidateSize();
        }
    };

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            { once: true }
        );
    } else {
        initialize();
    }
})();

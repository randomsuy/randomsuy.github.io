(() => {
    "use strict";

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

        cameras: {
            sourceUrl: "https://montevideo.gub.uy/tipo/area-tematica/movilidad/gestion-de-la-movilidad/camaras-de-monitoreo-del-transito",
            refreshInterval: 300000,
            geocodeDelay: 1100,
            geocodeZoom: 18,
            concurrency: 1
        },

        simulation: {
            stepMeters: 20,
            defaultSpeed: 5
        },

        services: {
            overpass: "https://overpass-api.de/api/interpreter",
            nominatim: "https://nominatim.openstreetmap.org/search"
        }
    };

    const state = {
        initialized: false,
        map: null,
        userMarker: null,
        accuracyCircle: null,
        radarLayer: null,
        cameraLayer: null,
        radars: [],
        cameras: [],
        radarCount: 0,
        cameraCount: 0,
        locationWatchId: null,
        locationActive: false,
        lastPosition: null,
        warningRadar: null,
        radarRefreshTimer: null,
        cameraRefreshTimer: null,
        lastRadarQuery: null,
        lastCameraLoad: 0,
        lastSpeech: 0,

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
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function setText(id, value) {
        const element = byId(id);

        if (element) {
            element.textContent = String(value);
        }
    }

    function showStatus(message) {
        setText("status", message);
    }

    function sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    }

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
            (Number(latitude2) - Number(latitude1)) *
            Math.PI / 180;

        const deltaLng =
            (Number(longitude2) - Number(longitude1)) *
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
            (Number(longitude2) - Number(longitude1)) *
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
        const speed = Number(limit);

        const label =
            Number.isFinite(speed) && speed > 0
                ? speed
                : "—";

        return L.divIcon({
            className: "keolel-radar-marker",

            html: `
                <div style="
                    position:relative;
                    width:38px;
                    height:38px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    border-radius:50%;
                    background:#190708;
                    border:2px solid #ff3131;
                    color:#ff4a4a;
                    font-family:monospace;
                    font-size:10px;
                    font-weight:700;
                    box-shadow:
                        0 0 12px rgba(255,49,49,.8),
                        0 0 28px rgba(255,49,49,.35);
                ">
                    ${label}
                </div>
            `,

            iconSize: [38, 38],
            iconAnchor: [19, 19]
        });
    }

    function createCameraIcon() {
        return L.divIcon({
            className: "montevideo-camera-marker",

            html: `
                <div style="
                    position:relative;
                    width:34px;
                    height:34px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    border-radius:50%;
                    background:#2b1800;
                    border:3px solid #ff9800;
                    color:#ff9800;
                    box-shadow:
                        0 0 10px rgba(255,152,0,.95),
                        0 0 24px rgba(255,152,0,.65);
                ">
                    <div style="
                        position:relative;
                        width:15px;
                        height:10px;
                        border-radius:3px;
                        background:#ff9800;
                        box-shadow:0 0 8px rgba(255,152,0,.9);
                    ">
                        <div style="
                            position:absolute;
                            right:-5px;
                            top:2px;
                            width:5px;
                            height:6px;
                            border-radius:1px;
                            background:#ff9800;
                        "></div>

                        <div style="
                            position:absolute;
                            left:4px;
                            top:2px;
                            width:5px;
                            height:5px;
                            border-radius:50%;
                            background:#2b1800;
                            border:1px solid #2b1800;
                        "></div>
                    </div>
                </div>
            `,

            iconSize: [34, 34],
            iconAnchor: [17, 17]
        });
    }

    function initializeMap() {
        if (!window.L) {
            showStatus("LEAFLET NO DISPONIBLE");
            return false;
        }

        const mapElement = byId("map");

        if (!mapElement) {
            return false;
        }

        state.map =
            L.map(
                mapElement,
                {
                    center: CONFIG.map.defaultCenter,
                    zoom: CONFIG.map.defaultZoom,
                    zoomControl: true,
                    attributionControl: true,
                    preferCanvas: true
                }
            );

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,
                attribution: "&copy; OpenStreetMap contributors",
                crossOrigin: true
            }
        ).addTo(state.map);

        state.radarLayer =
            L.layerGroup().addTo(state.map);

        state.cameraLayer =
            L.layerGroup().addTo(state.map);

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

    function requestLocation(force = false) {
        if (state.simulation.active && !force) {
            return;
        }

        if (!navigator.geolocation) {
            state.locationActive = false;
            showStatus("GPS NO DISPONIBLE");
            return;
        }

        showStatus("OBTENIENDO UBICACIÓN...");

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

    function stopLocationWatch() {
        if (state.locationWatchId === null) {
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

        updateUserMarker(
            latitude,
            longitude
        );

        if (!state.simulation.active) {
            const currentZoom =
                state.map?.getZoom();

            if (
                state.map &&
                (
                    !state.userMarker ||
                    currentZoom < 14
                )
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
            `GPS ACTIVO · ${state.cameraCount} CÁMARAS · ${state.radarCount} RADARES`
        );
    }

    function handlePositionError(error) {
        console.warn(
            "[Radar] GPS:",
            error
        );

        state.locationActive = false;

        let message = "ERROR DE GPS";

        if (error?.code === 1) {
            message = "PERMISO GPS DENEGADO";
        }

        if (error?.code === 2) {
            message = "UBICACIÓN NO DISPONIBLE";
        }

        if (error?.code === 3) {
            message = "TIMEOUT DE GPS";
        }

        showStatus(message);
    }

    function updateUserMarker(
        latitude,
        longitude
    ) {
        if (!state.map) {
            return;
        }

        if (!state.userMarker) {
            state.userMarker =
                L.marker(
                    [latitude, longitude],
                    {
                        icon: createUserIcon(),
                        zIndexOffset: 1000
                    }
                )
                    .addTo(state.map)
                    .bindTooltip(
                        "TU POSICIÓN",
                        {
                            direction: "top"
                        }
                    );
        } else {
            state.userMarker.setLatLng(
                [latitude, longitude]
            );
        }

        if (!state.accuracyCircle) {
            state.accuracyCircle =
                L.circle(
                    [latitude, longitude],
                    {
                        radius:
                            state.lastPosition?.accuracy ||
                            10,

                        color: "#36c8d8",
                        weight: 1,
                        opacity: .35,
                        fillColor: "#36c8d8",
                        fillOpacity: .05,
                        interactive: false
                    }
                ).addTo(state.map);
        } else {
            state.accuracyCircle.setLatLng(
                [latitude, longitude]
            );

            state.accuracyCircle.setRadius(
                state.lastPosition?.accuracy ||
                10
            );
        }
    }

    async function loadOfficialCameras(force = false) {
        const now = Date.now();

        if (
            !force &&
            state.lastCameraLoad &&
            now - state.lastCameraLoad <
            30000
        ) {
            return;
        }

        state.lastCameraLoad = now;

        showStatus("CARGANDO CÁMARAS OFICIALES...");

        try {
            const response =
                await fetch(
                    CONFIG.cameras.sourceUrl,
                    {
                        method: "GET",
                        cache: "no-store",
                        credentials: "omit"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const html =
                await response.text();

            const locations =
                extractOfficialCameraLocations(
                    html
                );

            if (!locations.length) {
                throw new Error(
                    "No se encontraron ubicaciones"
                );
            }

            const cameras =
                await geocodeCameraLocations(
                    locations
                );

            state.cameras =
                deduplicateCameras(
                    cameras
                );

            state.cameraCount =
                state.cameras.length;

            renderOfficialCameras();

            showStatus(
                `${state.cameraCount} CÁMARAS OFICIALES`
            );
        } catch (error) {
            console.error(
                "[Cámaras]",
                error
            );

            showStatus(
                "ERROR CARGANDO CÁMARAS OFICIALES"
            );
        }
    }

    function extractOfficialCameraLocations(html) {
        const parser =
            new DOMParser();

        const document =
            parser.parseFromString(
                html,
                "text/html"
            );

        const headings =
            Array.from(
                document.querySelectorAll(
                    "h1,h2,h3,h4,h5,h6"
                )
            );

        const locations = [];

        const excluded =
            [
                "Cámaras de monitoreo del tránsito"
            ];

        for (const heading of headings) {
            const headingText =
                normalizeText(
                    heading.textContent
                );

            if (
                !headingText ||
                excluded.includes(
                    headingText
                )
            ) {
                continue;
            }

            let current =
                heading.nextElementSibling;

            let guard = 0;

            while (
                current &&
                guard < 100
                ) {
                guard++;

                if (
                    /^H[1-6]$/i.test(
                        current.tagName
                    )
                ) {
                    break;
                }

                const items =
                    Array.from(
                        current.querySelectorAll(
                            "li"
                        )
                    );

                if (
                    current.tagName === "LI"
                ) {
                    items.unshift(current);
                }

                for (const item of items) {
                    const text =
                        normalizeText(
                            item.textContent
                        );

                    if (
                        isCameraLocation(
                            text
                        )
                    ) {
                        locations.push({
                            area:
                            headingText,

                            name:
                                cleanCameraLocation(
                                    text
                                )
                        });
                    }
                }

                current =
                    current.nextElementSibling;
            }
        }

        if (!locations.length) {
            const allText =
                Array.from(
                    document.querySelectorAll(
                        "li"
                    )
                );

            for (const item of allText) {
                const text =
                    normalizeText(
                        item.textContent
                    );

                if (
                    isCameraLocation(
                        text
                    )
                ) {
                    locations.push({
                        area:
                            "Montevideo",

                        name:
                            cleanCameraLocation(
                                text
                            )
                    });
                }
            }
        }

        return uniqueLocationList(
            locations
        );
    }

    function normalizeText(value) {
        return String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function isCameraLocation(text) {
        if (!text) {
            return false;
        }

        if (text.length < 5) {
            return false;
        }

        if (
            text.length > 180
        ) {
            return false;
        }

        const lower =
            text.toLowerCase();

        const conjunction =
            lower.includes(" y ");

        const streetIndicators =
            [
                "av.",
                "avenida",
                "bulevar",
                "bvar.",
                "blvr.",
                "rambla",
                "camino",
                "ruta ",
                "calle ",
                "gral.",
                "general ",
                "túnel",
                "tunel"
            ];

        const hasStreetIndicator =
            streetIndicators.some(
                value =>
                    lower.includes(value)
            );

        return (
            conjunction &&
            hasStreetIndicator
        );
    }

    function cleanCameraLocation(text) {
        return normalizeText(
            text
                .replace(/\.$/, "")
        );
    }

    function uniqueLocationList(locations) {
        const seen =
            new Set();

        const result = [];

        for (const item of locations) {
            const key =
                item.name
                    .toLowerCase();

            if (
                seen.has(key)
            ) {
                continue;
            }

            seen.add(key);

            result.push(item);
        }

        return result;
    }

    async function geocodeCameraLocations(
        locations
    ) {
        const result = [];

        const cache =
            loadGeocodeCache();

        for (
            let index = 0;
            index < locations.length;
            index++
        ) {
            const location =
                locations[index];

            const cacheKey =
                location.name
                    .toLowerCase();

            let coordinates =
                cache[cacheKey];

            if (
                !coordinates
            ) {
                showStatus(
                    `GEOCODIFICANDO CÁMARAS ${index + 1}/${locations.length}`
                );

                coordinates =
                    await geocodeLocation(
                        location.name
                    );

                if (coordinates) {
                    cache[cacheKey] =
                        coordinates;

                    saveGeocodeCache(
                        cache
                    );
                }

                await sleep(
                    CONFIG.cameras.geocodeDelay
                );
            }

            if (
                !coordinates
            ) {
                continue;
            }

            result.push({
                id:
                    `imm-${hashString(
                        location.name
                    )}`,

                latitude:
                coordinates.latitude,

                longitude:
                coordinates.longitude,

                name:
                location.name,

                area:
                location.area,

                source:
                    "Intendencia de Montevideo",

                sourceUrl:
                CONFIG.cameras.sourceUrl
            });
        }

        return result;
    }

    async function geocodeLocation(
        location
    ) {
        const queries = [
            `${location}, Montevideo, Uruguay`,
            `${location}, Montevideo`,
            `${location}, Uruguay`
        ];

        for (const query of queries) {
            try {
                const url =
                    new URL(
                        CONFIG.services.nominatim
                    );

                url.searchParams.set(
                    "q",
                    query
                );

                url.searchParams.set(
                    "format",
                    "json"
                );

                url.searchParams.set(
                    "limit",
                    "1"
                );

                url.searchParams.set(
                    "countrycodes",
                    "uy"
                );

                url.searchParams.set(
                    "addressdetails",
                    "0"
                );

                const response =
                    await fetch(
                        url.toString(),
                        {
                            method: "GET",
                            cache: "no-store",
                            headers: {
                                "Accept":
                                    "application/json"
                            }
                        }
                    );

                if (
                    !response.ok
                ) {
                    continue;
                }

                const data =
                    await response.json();

                if (
                    !Array.isArray(data) ||
                    !data.length
                ) {
                    continue;
                }

                const latitude =
                    Number(
                        data[0].lat
                    );

                const longitude =
                    Number(
                        data[0].lon
                    );

                if (
                    !Number.isFinite(
                        latitude
                    ) ||
                    !Number.isFinite(
                        longitude
                    )
                ) {
                    continue;
                }

                return {
                    latitude,
                    longitude
                };
            } catch (error) {
                console.warn(
                    "[Geocoding]",
                    location,
                    error
                );
            }
        }

        return null;
    }

    function loadGeocodeCache() {
        try {
            const value =
                localStorage.getItem(
                    "montevideo_camera_geocode_cache"
                );

            if (!value) {
                return {};
            }

            const parsed =
                JSON.parse(value);

            return parsed &&
            typeof parsed === "object"
                ? parsed
                : {};
        } catch (error) {
            return {};
        }
    }

    function saveGeocodeCache(cache) {
        try {
            localStorage.setItem(
                "montevideo_camera_geocode_cache",
                JSON.stringify(cache)
            );
        } catch (error) {
        }
    }

    function hashString(value) {
        let hash = 0;

        const text =
            String(value);

        for (
            let index = 0;
            index < text.length;
            index++
        ) {
            hash =
                (
                    (
                        hash << 5
                    ) -
                    hash +
                    text.charCodeAt(index)
                ) |
                0;
        }

        return Math.abs(hash);
    }

    function deduplicateCameras(
        cameras
    ) {
        const unique = [];

        for (const camera of cameras) {
            const exists =
                unique.some(
                    item =>
                        distanceMeters(
                            item.latitude,
                            item.longitude,
                            camera.latitude,
                            camera.longitude
                        ) < 12
                );

            if (!exists) {
                unique.push(camera);
            }
        }

        return unique;
    }

    function renderOfficialCameras() {
        if (!state.cameraLayer) {
            return;
        }

        state.cameraLayer.clearLayers();

        state.cameras.forEach(
            camera => {
                const marker =
                    L.marker(
                        [
                            camera.latitude,
                            camera.longitude
                        ],
                        {
                            icon:
                                createCameraIcon(),

                            zIndexOffset:
                                300
                        }
                    );

                marker.bindPopup(`
                    <div style="
                        font-family:monospace;
                        color:#111;
                        min-width:210px;
                    ">
                        <strong>CÁMARA DE MONITOREO</strong>
                        <br>
                        ${escapeHtml(camera.name)}
                        <br>
                        <span style="color:#d97700">
                            INTENDENCIA DE MONTEVIDEO
                        </span>
                    </div>
                `);

                marker.addTo(
                    state.cameraLayer
                );
            }
        );
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    async function loadRadars(
        latitude,
        longitude
    ) {
        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
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

        showStatus("CARGANDO RADARES...");

        const radius =
            CONFIG.radar.queryRadius;

        const query = `
[out:json][timeout:25];
(
  node["highway"="speed_camera"](around:${radius},${latitude},${longitude});
  way["highway"="speed_camera"](around:${radius},${latitude},${longitude});
  node["enforcement"="speed"](around:${radius},${latitude},${longitude});
  way["enforcement"="speed"](around:${radius},${latitude},${longitude});
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

            state.radars =
                deduplicateRadars(
                    normalizeRadarData(
                        data?.elements || []
                    )
                );

            state.radarCount =
                state.radars.length;

            renderRadars();

            showStatus(
                `${state.cameraCount} CÁMARAS · ${state.radarCount} RADARES`
            );
        } catch (error) {
            console.error(
                "[Radar] Overpass:",
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
                Number.isFinite(
                    Number(element.lat)
                ) &&
                Number.isFinite(
                    Number(element.lon)
                )
            ) {
                latitude =
                    Number(element.lat);

                longitude =
                    Number(element.lon);
            } else if (
                element.center
            ) {
                latitude =
                    Number(
                        element.center.lat
                    );

                longitude =
                    Number(
                        element.center.lon
                    );
            }

            if (
                !Number.isFinite(
                    latitude
                ) ||
                !Number.isFinite(
                    longitude
                )
            ) {
                continue;
            }

            const tags =
                element.tags || {};

            const limit =
                parseSpeedLimit(
                    tags.maxspeed ||
                    tags.maxspeed_forward ||
                    tags.maxspeed_backward ||
                    null
                );

            result.push({
                id:
                    String(
                        element.id ??
                        `${latitude}:${longitude}`
                    ),

                latitude,
                longitude,
                limit,

                direction:
                    tags.direction ||
                    null,

                name:
                    tags.name ||
                    "RADAR DE VELOCIDAD",

                source:
                    "OpenStreetMap"
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

        return Number(
            match[1]
        );
    }

    function deduplicateRadars(
        radars
    ) {
        const unique = [];

        for (const radar of radars) {
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
                        <strong>RADAR DE VELOCIDAD</strong>
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

    function findClosestRadar(
        latitude,
        longitude
    ) {
        let closest = null;

        for (const radar of state.radars) {
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

    function checkRadars(
        latitude,
        longitude
    ) {
        const closest =
            findClosestRadar(
                latitude,
                longitude
            );

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

        speakRadarWarning(
            radar,
            rounded
        );
    }

    function speakRadarWarning(
        radar,
        distance
    ) {
        if (
            !("speechSynthesis" in window)
        ) {
            return;
        }

        const now =
            Date.now();

        if (
            now - state.lastSpeech <
            10000
        ) {
            return;
        }

        state.lastSpeech =
            now;

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

            utterance.rate = 1;
            utterance.pitch = 1;

            window.speechSynthesis.speak(
                utterance
            );
        } catch (error) {
            console.warn(
                "[Radar] Speech:",
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

        state.warningRadar =
            null;
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
            longitude
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
            "MODO PRUEBA ACTIVO"
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

    function simulationStep() {
        if (
            !state.simulation.active
        ) {
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
        if (
            !state.simulation.active
        ) {
            return;
        }

        const simulation =
            state.simulation;

        updateUserMarker(
            simulation.latitude,
            simulation.longitude
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

        if (
            result &&
            result.distance <=
            CONFIG.radar.warningDistance
        ) {
            showRadarWarning(
                result.radar,
                result.distance
            );
        }
    }

    function resetSimulation() {
        if (
            !state.simulation.active
        ) {
            return;
        }

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

            latitude =
                center.lat;

            longitude =
                center.lng;
        }

        state.simulation.latitude =
            latitude;

        state.simulation.longitude =
            longitude;

        state.simulation.heading =
            Number(
                state.lastPosition?.heading
            ) || 0;

        state.simulation.radar =
            null;

        state.simulation.distance =
            null;

        hideRadarWarning();

        updateUserMarker(
            latitude,
            longitude
        );

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

        showStatus(
            "MODO PRUEBA REINICIADO"
        );
    }

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
                        state.simulation.active
                            ? {
                                latitude:
                                state.simulation.latitude,
                                longitude:
                                state.simulation.longitude
                            }
                            : state.lastPosition;

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

    function startCameraRefresh() {
        if (
            state.cameraRefreshTimer
        ) {
            clearInterval(
                state.cameraRefreshTimer
            );
        }

        state.cameraRefreshTimer =
            setInterval(
                () => {
                    loadOfficialCameras(
                        true
                    );
                },
                CONFIG.cameras.refreshInterval
            );
    }

    function initialize() {
        if (
            state.initialized
        ) {
            return;
        }

        state.initialized =
            true;

        if (!initializeMap()) {
            return;
        }

        showStatus(
            "RADAR ONLINE · CARGANDO CÁMARAS"
        );

        requestLocation();

        loadRadars(
            CONFIG.map.defaultCenter[0],
            CONFIG.map.defaultCenter[1]
        );

        loadOfficialCameras(
            true
        );

        startRadarRefresh();

        startCameraRefresh();

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

        get radarCount() {
            return state.radarCount;
        },

        get cameraCount() {
            return state.cameraCount;
        },

        get radars() {
            return state.radars;
        },

        get cameras() {
            return state.cameras;
        },

        get simulation() {
            return state.simulation;
        },

        requestLocation,

        startSimulation,

        stopSimulation,

        simulationStep,

        resetSimulation,

        updateUserMarker,

        distanceMeters,

        destinationPoint,

        checkRadars,

        updateSimulationUI,

        loadOfficialCameras,

        showStatus,

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
            {
                once: true
            }
        );
    } else {
        initialize();
    }
})();

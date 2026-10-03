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
            refreshInterval: 300000
        },

        cameras: {
            refreshInterval: 900000,
            geocodeDelay: 250
        },

        simulation: {
            stepMeters: 20,
            defaultSpeed: 5
        },

        services: {
            ckanApi: "https://ckan.montevideo.gub.uy/api/3/action/package_show?id=ubicacion-de-sensores-de-medicion-de-conteo-vehiculos",
            officialCameraPage: "https://montevideo.gub.uy/tipo/area-tematica/movilidad/gestion-de-la-movilidad/camaras-de-monitoreo-del-transito",
            pageProxy: "https://r.jina.ai/https://montevideo.gub.uy/tipo/area-tematica/movilidad/gestion-de-la-movilidad/camaras-de-monitoreo-del-transito",
            geocoder: "https://geocode.maps.co/search",
            arcgisGeocoder: "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates"
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

        lastRadarQuery: 0,
        lastCameraQuery: 0,
        lastSpeech: 0,

        geocodeCache: {},

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

    function distanceMeters(
        latitude1,
        longitude1,
        latitude2,
        longitude2
    ) {
        const R = 6371000;

        const lat1 = Number(latitude1) * Math.PI / 180;
        const lat2 = Number(latitude2) * Math.PI / 180;

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
            className: "keolel-camera-marker",
            html: `
                <div style="
                    position:relative;
                    width:36px;
                    height:36px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    border-radius:50%;
                    background:#2a1600;
                    border:2px solid #ff9800;
                    color:#ff9800;
                    font-size:18px;
                    box-shadow:
                        0 0 12px rgba(255,152,0,.9),
                        0 0 28px rgba(255,152,0,.4);
                ">
                    <span style="
                        display:block;
                        width:16px;
                        height:11px;
                        border:2px solid #ff9800;
                        border-radius:3px;
                        position:relative;
                    ">
                        <span style="
                            position:absolute;
                            width:5px;
                            height:5px;
                            border-radius:50%;
                            background:#ff9800;
                            left:4px;
                            top:1px;
                        "></span>
                    </span>
                </div>
            `,
            iconSize: [36, 36],
            iconAnchor: [18, 18]
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

    function handlePosition(position) {
        if (!position?.coords) {
            return;
        }

        const latitude =
            safeNumber(position.coords.latitude);

        const longitude =
            safeNumber(position.coords.longitude);

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
            Number(position.coords.heading);

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
            longitude
        );

        showStatus(
            `GPS ACTIVO · ${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
        );
    }

    function handlePositionError(error) {
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

        const accuracy =
            state.lastPosition?.accuracy || 10;

        if (!state.accuracyCircle) {
            state.accuracyCircle =
                L.circle(
                    [latitude, longitude],
                    {
                        radius: accuracy,
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
                accuracy
            );
        }
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

    function normalizeRadarRows(rows) {
        const result = [];

        for (const row of rows) {
            const keys =
                Object.keys(row);

            let latitude = null;
            let longitude = null;
            let limit = null;

            for (const key of keys) {
                const lower =
                    key.toLowerCase();

                const value =
                    row[key];

                if (
                    latitude === null &&
                    (
                        lower.includes("lat") ||
                        lower === "y"
                    )
                ) {
                    const n =
                        Number(
                            String(value)
                                .replace(",", ".")
                        );

                    if (
                        Number.isFinite(n) &&
                        Math.abs(n) <= 90
                    ) {
                        latitude = n;
                    }
                }

                if (
                    longitude === null &&
                    (
                        lower.includes("lon") ||
                        lower.includes("lng") ||
                        lower === "x"
                    )
                ) {
                    const n =
                        Number(
                            String(value)
                                .replace(",", ".")
                        );

                    if (
                        Number.isFinite(n) &&
                        Math.abs(n) <= 180
                    ) {
                        longitude = n;
                    }
                }

                if (
                    limit === null &&
                    (
                        lower.includes("velocidad") ||
                        lower.includes("maxspeed") ||
                        lower.includes("limite") ||
                        lower.includes("límite")
                    )
                ) {
                    limit =
                        parseSpeedLimit(value);
                }
            }

            if (
                Number.isFinite(latitude) &&
                Number.isFinite(longitude)
            ) {
                result.push({
                    id:
                        `${latitude}:${longitude}:${result.length}`,
                    latitude,
                    longitude,
                    limit,
                    name:
                        row.nombre ||
                        row.Nombre ||
                        row.radar ||
                        row.Radar ||
                        "RADAR DE VELOCIDAD",
                    source:
                        "Intendencia de Montevideo"
                });
            }
        }

        return result;
    }

    function parseCSV(text) {
        const lines = [];
        let current = "";
        let insideQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (char === '"') {
                if (
                    insideQuotes &&
                    text[i + 1] === '"'
                ) {
                    current += '"';
                    i++;
                } else {
                    insideQuotes =
                        !insideQuotes;
                    current += char;
                }
            } else if (
                (
                    char === "\n" ||
                    char === "\r"
                ) &&
                !insideQuotes
            ) {
                if (current.trim()) {
                    lines.push(current);
                }

                current = "";

                if (
                    char === "\r" &&
                    text[i + 1] === "\n"
                ) {
                    i++;
                }
            } else {
                current += char;
            }
        }

        if (current.trim()) {
            lines.push(current);
        }

        if (!lines.length) {
            return [];
        }

        const delimiter =
            lines[0].includes(";")
                ? ";"
                : ",";

        function splitCSV(line) {
            const result = [];
            let value = "";
            let quoted = false;

            for (let i = 0; i < line.length; i++) {
                const char = line[i];

                if (char === '"') {
                    if (
                        quoted &&
                        line[i + 1] === '"'
                    ) {
                        value += '"';
                        i++;
                    } else {
                        quoted = !quoted;
                    }
                } else if (
                    char === delimiter &&
                    !quoted
                ) {
                    result.push(
                        value.trim()
                    );
                    value = "";
                } else {
                    value += char;
                }
            }

            result.push(
                value.trim()
            );

            return result;
        }

        const headers =
            splitCSV(lines[0]).map(
                header =>
                    header
                        .replace(/^\uFEFF/, "")
                        .trim()
            );

        return lines
            .slice(1)
            .map(line => {
                const values =
                    splitCSV(line);

                const row = {};

                headers.forEach(
                    (header, index) => {
                        row[header] =
                            values[index] ?? "";
                    }
                );

                return row;
            });
    }

    function deduplicateRadars(radars) {
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

    async function getLatestRadarResource() {
        const response =
            await fetch(
                CONFIG.services.ckanApi,
                {
                    cache: "no-store"
                }
            );

        if (!response.ok) {
            throw new Error(
                `CKAN HTTP ${response.status}`
            );
        }

        const json =
            await response.json();

        if (
            !json.success ||
            !json.result
        ) {
            throw new Error(
                "CKAN DATASET INVÁLIDO"
            );
        }

        const resources =
            Array.isArray(
                json.result.resources
            )
                ? json.result.resources
                : [];

        const radarResources =
            resources.filter(
                resource => {
                    const name =
                        String(
                            resource.name ||
                            resource.description ||
                            ""
                        ).toLowerCase();

                    return (
                        name.includes("radar") &&
                        (
                            String(
                                resource.format ||
                                ""
                            ).toLowerCase() === "csv" ||
                            String(
                                resource.url ||
                                ""
                            ).toLowerCase().includes(".csv")
                        )
                    );
                }
            );

        if (!radarResources.length) {
            throw new Error(
                "NO HAY RECURSO DE RADARES"
            );
        }

        radarResources.sort(
            (a, b) => {
                const da =
                    new Date(
                        a.created ||
                        a.last_modified ||
                        0
                    ).getTime();

                const db =
                    new Date(
                        b.created ||
                        b.last_modified ||
                        0
                    ).getTime();

                return db - da;
            }
        );

        return radarResources[0];
    }

    async function loadRadars() {
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
            "CARGANDO RADARES OFICIALES..."
        );

        try {
            const resource =
                await getLatestRadarResource();

            const response =
                await fetch(
                    resource.url,
                    {
                        cache: "no-store"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `CSV HTTP ${response.status}`
                );
            }

            const text =
                await response.text();

            const rows =
                parseCSV(text);

            const radars =
                normalizeRadarRows(rows);

            if (!radars.length) {
                throw new Error(
                    "CSV SIN COORDENADAS"
                );
            }

            state.radars =
                deduplicateRadars(
                    radars
                );

            state.radarCount =
                state.radars.length;

            renderRadars();

            showStatus(
                `RADARES OFICIALES · ${state.radarCount}`
            );
        } catch (error) {
            console.error(
                "RADARES:",
                error
            );

            showStatus(
                "ERROR CARGANDO RADARES OFICIALES"
            );
        }
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
                        min-width:190px;
                    ">
                        <strong>RADAR OFICIAL</strong>
                        <br>
                        LÍMITE: ${limitText}
                        <br>
                        FUENTE: INTENDENCIA DE MONTEVIDEO
                    </div>
                `);

                marker.addTo(
                    state.radarLayer
                );
            }
        );
    }

    function cleanCameraName(value) {
        return String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .replace(/^\s*[-•]\s*/, "")
            .trim();
    }

    function isCameraLocation(value) {
        const text =
            cleanCameraName(value);

        if (!text) {
            return false;
        }

        if (text.length < 8) {
            return false;
        }

        if (
            text.includes("Las filmaciones") ||
            text.includes("solicitar") ||
            text.includes("derechoalainformacion")
        ) {
            return false;
        }

        return (
            text.includes(" y ") ||
            text.includes("Túnel") ||
            text.includes("Tunel") ||
            text.includes("Ruta ") ||
            text.includes("Camino ") ||
            text.includes("Rambla") ||
            text.includes("Av.") ||
            text.includes("Bv.") ||
            text.includes("18 de Julio") ||
            text.includes("26 de Marzo")
        );
    }

    function extractCameraLocations(text) {
        const result = [];
        const seen = new Set();

        const lines =
            String(text)
                .split("\n")
                .map(cleanCameraName)
                .filter(Boolean);

        for (const line of lines) {
            let candidate = line;

            if (
                candidate.startsWith("-")
            ) {
                candidate =
                    candidate
                        .replace(
                            /^-\s*/,
                            ""
                        )
                        .trim();
            }

            if (
                candidate.startsWith("*")
            ) {
                candidate =
                    candidate
                        .replace(
                            /^\*\s*/,
                            ""
                        )
                        .trim();
            }

            if (
                !isCameraLocation(
                    candidate
                )
            ) {
                continue;
            }

            const key =
                candidate
                    .toLowerCase()
                    .replace(
                        /[.,]/g,
                        ""
                    );

            if (seen.has(key)) {
                continue;
            }

            seen.add(key);

            result.push({
                id:
                    `camera-${result.length}-${key}`,
                name: candidate,
                query:
                    `${candidate}, Montevideo, Uruguay`,
                latitude: null,
                longitude: null,
                source:
                    CONFIG.services.officialCameraPage
            });
        }

        return result;
    }

    function loadGeocodeCache() {
        try {
            const saved =
                localStorage.getItem(
                    "montevideo-camera-geocode-cache"
                );

            if (saved) {
                state.geocodeCache =
                    JSON.parse(saved) || {};
            }
        } catch {
            state.geocodeCache = {};
        }
    }

    function saveGeocodeCache() {
        try {
            localStorage.setItem(
                "montevideo-camera-geocode-cache",
                JSON.stringify(
                    state.geocodeCache
                )
            );
        } catch {}
    }

    async function geocodeCamera(camera) {
        const key =
            camera.name
                .toLowerCase()
                .trim();

        const cached =
            state.geocodeCache[key];

        if (
            cached &&
            Number.isFinite(
                Number(cached.latitude)
            ) &&
            Number.isFinite(
                Number(cached.longitude)
            )
        ) {
            return {
                ...camera,
                latitude:
                    Number(cached.latitude),
                longitude:
                    Number(cached.longitude)
            };
        }

        const url =
            CONFIG.services.arcgisGeocoder +
            "?f=json" +
            "&maxLocations=1" +
            "&outFields=*" +
            "&forStorage=false" +
            "&singleLine=" +
            encodeURIComponent(
                camera.query
            );

        try {
            const response =
                await fetch(
                    url,
                    {
                        cache: "no-store"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    "GEOCODER HTTP " +
                    response.status
                );
            }

            const data =
                await response.json();

            const candidate =
                data?.candidates?.[0];

            if (
                !candidate?.location
            ) {
                return null;
            }

            const latitude =
                Number(
                    candidate.location.y
                );

            const longitude =
                Number(
                    candidate.location.x
                );

            if (
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude)
            ) {
                return null;
            }

            state.geocodeCache[key] = {
                latitude,
                longitude
            };

            saveGeocodeCache();

            return {
                ...camera,
                latitude,
                longitude
            };
        } catch {
            return null;
        }
    }

    async function geocodeCameras(cameras) {
        const result = [];

        for (
            let index = 0;
            index < cameras.length;
            index++
        ) {
            const camera =
                cameras[index];

            showStatus(
                `UBICANDO CÁMARAS ${index + 1}/${cameras.length}`
            );

            const located =
                await geocodeCamera(
                    camera
                );

            if (located) {
                result.push(
                    located
                );
            }

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        CONFIG.cameras.geocodeDelay
                    )
            );
        }

        return result;
    }

    async function loadCameras() {
        const now = Date.now();

        if (
            state.lastCameraQuery &&
            now - state.lastCameraQuery <
            30000
        ) {
            return;
        }

        state.lastCameraQuery = now;

        showStatus(
            "CARGANDO CÁMARAS OFICIALES..."
        );

        try {
            const response =
                await fetch(
                    CONFIG.services.pageProxy +
                    "?t=" +
                    Date.now(),
                    {
                        cache: "no-store"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `CAMERAS HTTP ${response.status}`
                );
            }

            const text =
                await response.text();

            const locations =
                extractCameraLocations(
                    text
                );

            if (!locations.length) {
                throw new Error(
                    "NO SE ENCONTRARON UBICACIONES"
                );
            }

            const cameras =
                await geocodeCameras(
                    locations
                );

            if (!cameras.length) {
                throw new Error(
                    "NO SE PUDIERON GEOCODIFICAR LAS CÁMARAS"
                );
            }

            state.cameras =
                cameras;

            state.cameraCount =
                cameras.length;

            renderCameras();

            showStatus(
                `CÁMARAS OFICIALES · ${state.cameraCount}`
            );
        } catch (error) {
            console.error(
                "CAMARAS:",
                error
            );

            showStatus(
                "ERROR CARGANDO CÁMARAS OFICIALES"
            );
        }
    }

    function renderCameras() {
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
                                createCameraIcon()
                        }
                    );

                marker.bindPopup(`
                    <div style="
                        font-family:monospace;
                        color:#111;
                        min-width:220px;
                    ">
                        <strong style="color:#e67e00">
                            CÁMARA DE MONITOREO
                        </strong>
                        <br>
                        ${escapeHTML(camera.name)}
                        <br>
                        <br>
                        FUENTE: INTENDENCIA DE MONTEVIDEO
                    </div>
                `);

                marker.addTo(
                    state.cameraLayer
                );
            }
        );
    }

    function escapeHTML(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
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
            byId("radarWarningDistance");

        const limitElement =
            byId("radarWarningLimit");

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
                    : "RADAR";
        }

        warning.classList.add("active");

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

        const now = Date.now();

        if (
            now - state.lastSpeech <
            10000
        ) {
            return;
        }

        state.lastSpeech = now;

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

            utterance.lang = "es-ES";
            utterance.rate = 1;
            utterance.pitch = 1;

            window.speechSynthesis.speak(
                utterance
            );
        } catch {}
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

            latitude = center.lat;
            longitude = center.lng;
        }

        state.simulation.active = true;

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

        state.simulation.radar = null;
        state.simulation.distance = null;

        updateUserMarker(
            latitude,
            longitude
        );

        state.map?.setView(
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
            "MODO PRUEBA ACTIVO"
        );

        updateSimulationUI();

        return true;
    }

    function stopSimulation() {
        state.simulation.active = false;
        state.simulation.radar = null;
        state.simulation.distance = null;

        hideRadarWarning();

        showStatus(
            state.locationActive
                ? `GPS ACTIVO · ${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
                : "GPS OFF"
        );

        return true;
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

        const simulation =
            state.simulation;

        updateUserMarker(
            simulation.latitude,
            simulation.longitude
        );

        checkRadars(
            simulation.latitude,
            simulation.longitude
        );

        updateSimulationUI();

        state.map?.panTo(
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

    function updateSimulationUI() {
        if (!state.simulation.active) {
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
        if (!state.simulation.active) {
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

            latitude = center.lat;
            longitude = center.lng;
        }

        state.simulation.latitude =
            latitude;

        state.simulation.longitude =
            longitude;

        state.simulation.heading =
            Number(
                state.lastPosition?.heading
            ) || 0;

        state.simulation.radar = null;
        state.simulation.distance = null;

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
                    loadRadars();
                },
                CONFIG.radar.refreshInterval
            );

        state.cameraRefreshTimer =
            setInterval(
                () => {
                    loadCameras();
                },
                CONFIG.cameras.refreshInterval
            );
    }

    async function initialize() {
        if (state.initialized) {
            return;
        }

        state.initialized = true;

        if (!initializeMap()) {
            return;
        }

        loadGeocodeCache();

        showStatus(
            "CARGANDO FUENTES OFICIALES..."
        );

        requestLocation();

        await Promise.allSettled([
            loadRadars(),
            loadCameras()
        ]);

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

        setTimeout(
            () => {
                if (
                    state.radarCount ||
                    state.cameraCount
                ) {
                    showStatus(
                        `ONLINE · ${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
                    );
                }
            },
            1500
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
        loadRadars,
        loadCameras,
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

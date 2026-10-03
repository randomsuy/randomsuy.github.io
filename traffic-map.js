(() => {
    "use strict";

    const CONFIG = {
        map: {
            defaultCenter: [-34.9011, -56.1645],
            defaultZoom: 13,
            userZoom: 17,
            minZoom: 10,
            maxZoom: 19,
            bounds: [
                [-35.05, -56.45],
                [-34.65, -55.85]
            ]
        },

        gps: {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 2000
        },

        radar: {
            warningDistance: 300,
            directionAngle: 65,
            roadDistance: 90,
            queryRadius: 50000,
            refreshInterval: 300000
        },

        camera: {
            warningDistance: 300,
            directionAngle: 70,
            roadDistance: 100,
            refreshInterval: 900000,
            source: "https://montevideo.gub.uy/tipo/area-tematica/movilidad/gestion-de-la-movilidad/camaras-de-monitoreo-del-transito",
            proxy: "https://api.allorigins.win/raw?url="
        },

        deadEnd: {
            warningDistance: 180,
            directionAngle: 60,
            refreshInterval: 300000
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
        deadEndLayer: null,
        roadLayer: null,

        radars: [],
        cameras: [],
        deadEnds: [],

        radarCount: 0,
        cameraCount: 0,
        deadEndCount: 0,

        locationWatchId: null,
        locationActive: false,
        lastPosition: null,

        radarRefreshTimer: null,
        cameraRefreshTimer: null,
        deadEndRefreshTimer: null,

        lastRadarQuery: 0,
        lastDeadEndQuery: 0,

        lastSpeech: 0,

        orientation: {
            active: false,
            heading: null,
            permission: "unknown",
            listener: null
        },

        alerts: {
            voice: true,
            radar: true,
            camera: true,
            deadEnd: true
        },

        announced: {
            radar: null,
            camera: null,
            deadEnd: null
        },

        simulation: {
            active: false,
            latitude: null,
            longitude: null,
            heading: 0,
            speed: CONFIG.simulation.defaultSpeed,
            radar: null,
            camera: null,
            deadEnd: null,
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

    function normalizeHeading(value) {
        const number = Number(value);

        if (!Number.isFinite(number)) {
            return null;
        }

        return ((number % 360) + 360) % 360;
    }

    function angleDifference(a, b) {
        const x = Math.abs(
            normalizeHeading(a) -
            normalizeHeading(b)
        );

        return Math.min(x, 360 - x);
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

        return normalizeHeading(angle);
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
            className: "traffic-user-marker",
            html: `
                <div class="user-marker">
                    <div class="user-arrow"></div>
                    <div class="user-dot"></div>
                </div>
            `,
            iconSize: [46, 46],
            iconAnchor: [23, 23]
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
            className: "traffic-radar-marker",
            html: `
                <div class="radar-marker">
                    <div class="radar-ring"></div>
                    <span>${label}</span>
                </div>
            `,
            iconSize: [44, 44],
            iconAnchor: [22, 22]
        });
    }

    function createCameraIcon() {
        return L.divIcon({
            className: "traffic-camera-marker",
            html: `
                <div class="camera-marker">
                    <div class="camera-lens"></div>
                    <div class="camera-body"></div>
                </div>
            `,
            iconSize: [42, 42],
            iconAnchor: [21, 21]
        });
    }

    function createDeadEndIcon() {
        return L.divIcon({
            className: "traffic-deadend-marker",
            html: `
                <div class="deadend-marker">!</div>
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
                    minZoom:
                        CONFIG.map.minZoom,
                    maxZoom:
                        CONFIG.map.maxZoom,
                    maxBounds:
                        CONFIG.map.bounds,
                    maxBoundsViscosity:
                        0.85,
                    zoomControl:
                        true,
                    attributionControl:
                        true,
                    preferCanvas:
                        true
                }
            );

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,
                attribution:
                    "&copy; OpenStreetMap contributors",
                crossOrigin: true
            }
        ).addTo(state.map);

        state.radarLayer =
            L.layerGroup()
                .addTo(state.map);

        state.cameraLayer =
            L.layerGroup()
                .addTo(state.map);

        state.deadEndLayer =
            L.layerGroup()
                .addTo(state.map);

        state.roadLayer =
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

    function requestLocation(force = false) {
        if (
            state.simulation.active &&
            !force
        ) {
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
            normalizeHeading(
                position.coords.heading
            );

        if (heading === null) {
            heading =
                state.orientation.heading ??
                state.lastPosition?.heading ??
                0;
        }

        state.lastPosition = {
            latitude,
            longitude,
            accuracy,
            speed,
            heading,
            timestamp:
                Date.now()
        };

        state.locationActive = true;

        updateUserMarker(
            latitude,
            longitude
        );

        if (
            !state.simulation.active
        ) {
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
        }

        if (!state.simulation.active) {
            checkAllAlerts(
                latitude,
                longitude,
                heading
            );
        }

        showStatus(
            `GPS ACTIVO · ${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
        );
    }

    function handlePositionError(error) {
        state.locationActive = false;

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
                    [
                        latitude,
                        longitude
                    ],
                    {
                        icon:
                            createUserIcon(),
                        zIndexOffset:
                            1000
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
            state.userMarker
                .setLatLng([
                    latitude,
                    longitude
                ]);
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
                        weight:
                            1,
                        opacity:
                            .3,
                        fillColor:
                            "#36c8d8",
                        fillOpacity:
                            .04,
                        interactive:
                            false
                    }
                )
                    .addTo(
                        state.map
                    );
        } else {
            state.accuracyCircle
                .setLatLng([
                    latitude,
                    longitude
                ]);

            state.accuracyCircle
                .setRadius(
                    state.lastPosition?.accuracy ||
                    10
                );
        }

        updateUserHeadingVisual();
    }

    function updateUserHeadingVisual() {
        const element =
            document.querySelector(
                ".user-marker"
            );

        if (!element) {
            return;
        }

        const heading =
            state.orientation.heading ??
            state.simulation.heading ??
            state.lastPosition?.heading ??
            0;

        element.style.transform =
            `rotate(${heading}deg)`;
    }

    function getCurrentHeading() {
        return normalizeHeading(
            state.orientation.heading ??
            state.simulation.heading ??
            state.lastPosition?.heading ??
            0
        );
    }

    function isAhead(
        latitude,
        longitude,
        targetLatitude,
        targetLongitude,
        maxAngle
    ) {
        const heading =
            getCurrentHeading();

        const bearing =
            bearingBetween(
                latitude,
                longitude,
                targetLatitude,
                targetLongitude
            );

        return (
            angleDifference(
                heading,
                bearing
            ) <= maxAngle
        );
    }

    function findDirectionalObject(
        latitude,
        longitude,
        objects,
        maxDistance,
        maxAngle,
        maxRoadDistance
    ) {
        let closest = null;

        for (const object of objects) {
            const distance =
                distanceMeters(
                    latitude,
                    longitude,
                    object.latitude,
                    object.longitude
                );

            if (
                distance >
                maxDistance
            ) {
                continue;
            }

            if (
                !isAhead(
                    latitude,
                    longitude,
                    object.latitude,
                    object.longitude,
                    maxAngle
                )
            ) {
                continue;
            }

            if (
                maxRoadDistance &&
                object.roadDistance &&
                object.roadDistance >
                    maxRoadDistance
            ) {
                continue;
            }

            if (
                !closest ||
                distance <
                    closest.distance
            ) {
                closest = {
                    object,
                    distance
                };
            }
        }

        return closest;
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

        if (
            Date.now() -
            state.lastRadarQuery <
            30000
        ) {
            return;
        }

        state.lastRadarQuery =
            Date.now();

        showStatus("CARGANDO RADARES...");

        const radius =
            CONFIG.radar.queryRadius;

        const query = `
[out:json][timeout:30];
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
                        method:
                            "POST",
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
                    `HTTP ${response.status}`
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
                `RADARES · ${state.radarCount}`
            );
        } catch (error) {
            console.error(error);
            showStatus(
                "ERROR CARGANDO RADARES"
            );
        }
    }

    function normalizeRadarData(
        elements
    ) {
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
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude)
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

    function parseSpeedLimit(
        value
    ) {
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
                    <div class="map-popup">
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

    async function fetchOfficialCameraPage() {
        const direct =
            CONFIG.camera.source;

        try {
            const response =
                await fetch(
                    direct,
                    {
                        method: "GET",
                        cache: "no-store"
                    }
                );

            if (
                response.ok
            ) {
                return await response.text();
            }
        } catch (error) {
        }

        const proxy =
            CONFIG.camera.proxy +
            encodeURIComponent(
                direct
            );

        const response =
            await fetch(
                proxy,
                {
                    method: "GET",
                    cache: "no-store"
                }
            );

        if (!response.ok) {
            throw new Error(
                `CAMERA HTTP ${response.status}`
            );
        }

        return await response.text();
    }

    function cleanCameraText(
        text
    ) {
        return String(text)
            .replace(
                /\s+/g,
                " "
            )
            .replace(
                /[\u00a0\u2007\u202f]/g,
                " "
            )
            .trim();
    }

    function extractCameraLocations(
        html
    ) {
        const documentObject =
            new DOMParser()
                .parseFromString(
                    html,
                    "text/html"
                );

        const candidates =
            Array.from(
                documentObject.querySelectorAll(
                    "li"
                )
            );

        const result = [];

        const seen =
            new Set();

        for (
            const element
            of candidates
        ) {
            const text =
                cleanCameraText(
                    element.textContent
                );

            if (
                !text ||
                text.length < 8 ||
                text.length > 180
            ) {
                continue;
            }

            const normalized =
                text
                    .toLowerCase()
                    .normalize(
                        "NFD"
                    )
                    .replace(
                        /[\u0300-\u036f]/g,
                        ""
                    );

            if (
                !normalized.includes(
                    " y "
                )
            ) {
                continue;
            }

            if (
                normalized.includes(
                    "para solicitar"
                ) ||
                normalized.includes(
                    "derecho a"
                ) ||
                normalized.includes(
                    "lunes"
                ) ||
                normalized.includes(
                    "telefono"
                )
            ) {
                continue;
            }

            if (
                seen.has(
                    normalized
                )
            ) {
                continue;
            }

            seen.add(
                normalized
            );

            result.push(text);
        }

        return result;
    }

    function normalizeCameraName(
        text
    ) {
        return text
            .replace(
                /\s*\.\s*$/,
                ""
            )
            .replace(
                /\s+/g,
                " "
            )
            .trim();
    }

    async function geocodeCamera(
        text
    ) {
        const cacheKey =
            "traffic-camera:" +
            text
                .toLowerCase()
                .trim();

        try {
            const cached =
                localStorage.getItem(
                    cacheKey
                );

            if (cached) {
                const value =
                    JSON.parse(
                        cached
                    );

                if (
                    Number.isFinite(
                        value.latitude
                    ) &&
                    Number.isFinite(
                        value.longitude
                    )
                ) {
                    return value;
                }
            }
        } catch (error) {
        }

        const query =
            `${text}, Montevideo, Uruguay`;

        const url =
            CONFIG.services.nominatim +
            "?format=jsonv2" +
            "&limit=1" +
            "&countrycodes=uy" +
            "&q=" +
            encodeURIComponent(
                query
            );

        try {
            const response =
                await fetch(
                    url,
                    {
                        headers: {
                            Accept:
                                "application/json"
                        }
                    }
                );

            if (!response.ok) {
                return null;
            }

            const data =
                await response.json();

            const item =
                data?.[0];

            if (!item) {
                return null;
            }

            const result = {
                latitude:
                    Number(item.lat),
                longitude:
                    Number(item.lon)
            };

            if (
                !Number.isFinite(
                    result.latitude
                ) ||
                !Number.isFinite(
                    result.longitude
                )
            ) {
                return null;
            }

            try {
                localStorage.setItem(
                    cacheKey,
                    JSON.stringify(
                        result
                    )
                );
            } catch (error) {
            }

            return result;
        } catch (error) {
            return null;
        }
    }

    async function loadOfficialCameras() {
        showStatus(
            "CARGANDO CÁMARAS OFICIALES..."
        );

        try {
            const html =
                await fetchOfficialCameraPage();

            const locations =
                extractCameraLocations(
                    html
                );

            if (!locations.length) {
                throw new Error(
                    "NO CAMERA LOCATIONS"
                );
            }

            const cameras = [];

            for (
                let i = 0;
                i < locations.length;
                i++
            ) {
                const name =
                    normalizeCameraName(
                        locations[i]
                    );

                const cached =
                    await geocodeCamera(
                        name
                    );

                if (
                    cached &&
                    Number.isFinite(
                        cached.latitude
                    ) &&
                    Number.isFinite(
                        cached.longitude
                    )
                ) {
                    cameras.push({
                        id:
                            `imm-${i}-${name}`,
                        name,
                        latitude:
                            cached.latitude,
                        longitude:
                            cached.longitude,
                        source:
                            CONFIG.camera.source
                    });
                }

                if (
                    i % 5 === 0
                ) {
                    showStatus(
                        `CÁMARAS · ${cameras.length}/${locations.length}`
                    );
                }

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            350
                        )
                );
            }

            state.cameras =
                deduplicateCameras(
                    cameras
                );

            state.cameraCount =
                state.cameras.length;

            renderCameras();

            showStatus(
                `CÁMARAS OFICIALES · ${state.cameraCount}`
            );
        } catch (error) {
            console.error(
                "[Cameras]",
                error
            );

            showStatus(
                "ERROR CARGANDO CÁMARAS"
            );
        }
    }

    function deduplicateCameras(
        cameras
    ) {
        const unique = [];

        for (
            const camera
            of cameras
        ) {
            const exists =
                unique.some(
                    item =>
                        distanceMeters(
                            item.latitude,
                            item.longitude,
                            camera.latitude,
                            camera.longitude
                        ) < 25
                );

            if (!exists) {
                unique.push(
                    camera
                );
            }
        }

        return unique;
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
                    <div class="map-popup">
                        <strong>CÁMARA DE TRÁNSITO</strong>
                        <br>
                        ${camera.name}
                        <br>
                        <small>INTENDENCIA DE MONTEVIDEO</small>
                    </div>
                `);

                marker.addTo(
                    state.cameraLayer
                );
            }
        );
    }

    async function loadDeadEnds(
        latitude,
        longitude
    ) {
        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            return;
        }

        if (
            Date.now() -
            state.lastDeadEndQuery <
            60000
        ) {
            return;
        }

        state.lastDeadEndQuery =
            Date.now();

        const query = `
[out:json][timeout:25];
way["highway"]["noexit"="yes"](around:${CONFIG.radar.queryRadius},${latitude},${longitude});
out center tags;
`;

        try {
            const response =
                await fetch(
                    CONFIG.services.overpass,
                    {
                        method:
                            "POST",
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
                    `HTTP ${response.status}`
                );
            }

            const data =
                await response.json();

            state.deadEnds =
                normalizeDeadEnds(
                    data?.elements || []
                );

            state.deadEndCount =
                state.deadEnds.length;

            renderDeadEnds();
        } catch (error) {
            console.error(
                "[DeadEnd]",
                error
            );
        }
    }

    function normalizeDeadEnds(
        elements
    ) {
        const result = [];

        for (
            const element
            of elements
        ) {
            if (
                !element.center
            ) {
                continue;
            }

            const latitude =
                Number(
                    element.center.lat
                );

            const longitude =
                Number(
                    element.center.lon
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

            result.push({
                id:
                    String(
                        element.id
                    ),
                latitude,
                longitude,
                name:
                    element.tags?.name ||
                    "CALLE SIN SALIDA"
            });
        }

        return result;
    }

    function renderDeadEnds() {
        if (!state.deadEndLayer) {
            return;
        }

        state.deadEndLayer.clearLayers();

        state.deadEnds.forEach(
            deadEnd => {
                const marker =
                    L.marker(
                        [
                            deadEnd.latitude,
                            deadEnd.longitude
                        ],
                        {
                            icon:
                                createDeadEndIcon()
                        }
                    );

                marker.bindPopup(`
                    <div class="map-popup">
                        <strong>CALLE SIN SALIDA</strong>
                        <br>
                        ${deadEnd.name}
                    </div>
                `);

                marker.addTo(
                    state.deadEndLayer
                );
            }
        );
    }

    function findClosestRadar(
        latitude,
        longitude
    ) {
        let closest = null;

        for (
            const radar
            of state.radars
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

    function findDirectionalRadar(
        latitude,
        longitude
    ) {
        return findDirectionalObject(
            latitude,
            longitude,
            state.radars,
            CONFIG.radar.warningDistance,
            CONFIG.radar.directionAngle,
            CONFIG.radar.roadDistance
        );
    }

    function findDirectionalCamera(
        latitude,
        longitude
    ) {
        return findDirectionalObject(
            latitude,
            longitude,
            state.cameras,
            CONFIG.camera.warningDistance,
            CONFIG.camera.directionAngle,
            CONFIG.camera.roadDistance
        );
    }

    function findDirectionalDeadEnd(
        latitude,
        longitude
    ) {
        return findDirectionalObject(
            latitude,
            longitude,
            state.deadEnds,
            CONFIG.deadEnd.warningDistance,
            CONFIG.deadEnd.directionAngle,
            null
        );
    }

    function speakOnce(
        type,
        id,
        text
    ) {
        if (
            !state.alerts.voice
        ) {
            return;
        }

        if (
            state.announced[type] ===
            id
        ) {
            return;
        }

        state.announced[type] =
            id;

        if (
            !("speechSynthesis" in window)
        ) {
            return;
        }

        const now =
            Date.now();

        if (
            now -
                state.lastSpeech <
            1200
        ) {
            return;
        }

        state.lastSpeech =
            now;

        try {
            window.speechSynthesis
                .cancel();

            const utterance =
                new SpeechSynthesisUtterance(
                    text
                );

            utterance.lang =
                "es-UY";

            utterance.rate =
                1;

            utterance.pitch =
                1;

            window.speechSynthesis
                .speak(
                    utterance
                );
        } catch (error) {
            console.error(
                error
            );
        }
    }

    function checkRadar(
        latitude,
        longitude
    ) {
        if (
            !state.alerts.radar
        ) {
            return null;
        }

        const result =
            findDirectionalRadar(
                latitude,
                longitude
            );

        if (
            !result
        ) {
            state.announced.radar =
                null;
            return null;
        }

        const radar =
            result.object;

        const id =
            String(radar.id);

        const distance =
            Math.round(
                result.distance
            );

        const text =
            radar.limit
                ? `Radar a ${distance} metros. Límite ${radar.limit} kilómetros por hora.`
                : `Radar a ${distance} metros.`;

        speakOnce(
            "radar",
            id,
            text
        );

        return result;
    }

    function checkCamera(
        latitude,
        longitude
    ) {
        if (
            !state.alerts.camera
        ) {
            return null;
        }

        const result =
            findDirectionalCamera(
                latitude,
                longitude
            );

        if (
            !result
        ) {
            state.announced.camera =
                null;
            return null;
        }

        const camera =
            result.object;

        const id =
            String(camera.id);

        const distance =
            Math.round(
                result.distance
            );

        speakOnce(
            "camera",
            id,
            `Cámara de tránsito a ${distance} metros.`
        );

        return result;
    }

    function checkDeadEnd(
        latitude,
        longitude
    ) {
        if (
            !state.alerts.deadEnd
        ) {
            return null;
        }

        const result =
            findDirectionalDeadEnd(
                latitude,
                longitude
            );

        if (
            !result
        ) {
            state.announced.deadEnd =
                null;
            return null;
        }

        const deadEnd =
            result.object;

        const id =
            String(deadEnd.id);

        const distance =
            Math.round(
                result.distance
            );

        speakOnce(
            "deadEnd",
            id,
            `Atención. Calle sin salida en ${distance} metros.`
        );

        return result;
    }

    function checkAllAlerts(
        latitude,
        longitude,
        heading
    ) {
        const radar =
            checkRadar(
                latitude,
                longitude
            );

        const camera =
            checkCamera(
                latitude,
                longitude
            );

        const deadEnd =
            checkDeadEnd(
                latitude,
                longitude
            );

        updateWarningHUD(
            radar,
            camera,
            deadEnd,
            heading
        );

        return {
            radar,
            camera,
            deadEnd
        };
    }

    function updateWarningHUD(
        radar,
        camera,
        deadEnd
    ) {
        const warning =
            byId(
                "radarWarning"
            );

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

        if (
            radar &&
            state.alerts.radar
        ) {
            warning.classList
                .add("active");

            warning.dataset.type =
                "radar";

            if (distanceElement) {
                distanceElement.textContent =
                    `${Math.max(
                        1,
                        Math.round(
                            radar.distance
                        )
                    )} M`;
            }

            if (limitElement) {
                limitElement.textContent =
                    radar.object.limit
                        ? `RADAR · ${radar.object.limit} KM/H`
                        : "RADAR";
            }

            return;
        }

        if (
            camera &&
            state.alerts.camera
        ) {
            warning.classList
                .add("active");

            warning.dataset.type =
                "camera";

            if (distanceElement) {
                distanceElement.textContent =
                    `${Math.max(
                        1,
                        Math.round(
                            camera.distance
                        )
                    )} M`;
            }

            if (limitElement) {
                limitElement.textContent =
                    "CÁMARA DE TRÁNSITO";
            }

            return;
        }

        if (
            deadEnd &&
            state.alerts.deadEnd
        ) {
            warning.classList
                .add("active");

            warning.dataset.type =
                "deadend";

            if (distanceElement) {
                distanceElement.textContent =
                    `${Math.max(
                        1,
                        Math.round(
                            deadEnd.distance
                        )
                    )} M`;
            }

            if (limitElement) {
                limitElement.textContent =
                    "CALLE SIN SALIDA";
            }

            return;
        }

        warning.classList
            .remove("active");
    }

    async function enableDeviceOrientation() {
        try {
            if (
                typeof DeviceOrientationEvent !==
                "undefined" &&
                typeof DeviceOrientationEvent.requestPermission ===
                "function"
            ) {
                const permission =
                    await DeviceOrientationEvent
                        .requestPermission();

                if (
                    permission !==
                    "granted"
                ) {
                    state.orientation.permission =
                        "denied";

                    showStatus(
                        "GIROSCOPIO SIN PERMISO"
                    );

                    return false;
                }
            }

            state.orientation.permission =
                "granted";

            if (
                !state.orientation.listener
            ) {
                state.orientation.listener =
                    handleDeviceOrientation;

                window.addEventListener(
                    "deviceorientationabsolute",
                    state.orientation.listener,
                    true
                );

                window.addEventListener(
                    "deviceorientation",
                    state.orientation.listener,
                    true
                );
            }

            state.orientation.active =
                true;

            showStatus(
                "GIROSCOPIO ACTIVO"
            );

            return true;
        } catch (error) {
            console.error(
                error
            );

            state.orientation.permission =
                "error";

            showStatus(
                "ERROR DE GIROSCOPIO"
            );

            return false;
        }
    }

    function getDeviceHeading(
        event
    ) {
        if (
            typeof event.webkitCompassHeading ===
            "number"
        ) {
            return normalizeHeading(
                event.webkitCompassHeading
            );
        }

        if (
            typeof event.alpha !==
            "number"
        ) {
            return null;
        }

        return normalizeHeading(
            360 -
            event.alpha
        );
    }

    function handleDeviceOrientation(
        event
    ) {
        const heading =
            getDeviceHeading(
                event
            );

        if (
            heading === null
        ) {
            return;
        }

        state.orientation.heading =
            heading;

        state.orientation.active =
            true;

        if (
            state.simulation.active
        ) {
            state.simulation.heading =
                heading;

            updateUserHeadingVisual();

            updateSimulationUI();
        }
    }

    async function startSimulation() {
        await enableDeviceOrientation();

        let latitude =
            state.lastPosition?.latitude;

        let longitude =
            state.lastPosition?.longitude;

        if (
            !Number.isFinite(
                latitude
            ) ||
            !Number.isFinite(
                longitude
            )
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

        const heading =
            state.orientation.heading ??
            state.lastPosition?.heading ??
            0;

        state.simulation.active =
            true;

        state.simulation.latitude =
            latitude;

        state.simulation.longitude =
            longitude;

        state.simulation.heading =
            heading;

        state.simulation.speed =
            CONFIG.simulation.defaultSpeed;

        state.simulation.radar =
            null;

        state.simulation.camera =
            null;

        state.simulation.deadEnd =
            null;

        state.simulation.distance =
            null;

        state.announced.radar =
            null;

        state.announced.camera =
            null;

        state.announced.deadEnd =
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
            `MODO PRUEBA · ${Math.round(
                heading
            )}°`
        );

        updateSimulationUI();

        return true;
    }

    function stopSimulation() {
        state.simulation.active =
            false;

        state.simulation.radar =
            null;

        state.simulation.camera =
            null;

        state.simulation.deadEnd =
            null;

        state.simulation.distance =
            null;

        state.announced.radar =
            null;

        state.announced.camera =
            null;

        state.announced.deadEnd =
            null;

        const warning =
            byId(
                "radarWarning"
            );

        warning?.classList.remove(
            "active"
        );

        showStatus(
            state.locationActive
                ? "GPS ACTIVO"
                : "GPS OFF"
        );
    }

    function simulationStep() {
        if (
            !state.simulation.active
        ) {
            return;
        }

        const simulation =
            state.simulation;

        const heading =
            state.orientation.heading ??
            simulation.heading ??
            0;

        simulation.heading =
            heading;

        const next =
            destinationPoint(
                simulation.latitude,
                simulation.longitude,
                heading,
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

        const alerts =
            checkAllAlerts(
                simulation.latitude,
                simulation.longitude,
                simulation.heading
            );

        simulation.radar =
            alerts.radar?.object ||
            null;

        simulation.camera =
            alerts.camera?.object ||
            null;

        simulation.deadEnd =
            alerts.deadEnd?.object ||
            null;

        simulation.distance =
            alerts.radar?.distance ??
            alerts.camera?.distance ??
            alerts.deadEnd?.distance ??
            null;

        updateSimulationUI();

        if (state.map) {
            state.map.panTo(
                [
                    simulation.latitude,
                    simulation.longitude
                ],
                {
                    animate: true,
                    duration: .2
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

        updateUserHeadingVisual();

        const heading =
            Math.round(
                state.orientation.heading ??
                state.simulation.heading ??
                0
            );

        const status =
            byId("status");

        if (status) {
            status.textContent =
                `PRUEBA · ${heading}° · ${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`;
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
            !Number.isFinite(
                latitude
            ) ||
            !Number.isFinite(
                longitude
            )
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
            state.orientation.heading ??
            state.lastPosition?.heading ??
            0;

        state.simulation.radar =
            null;

        state.simulation.camera =
            null;

        state.simulation.deadEnd =
            null;

        state.simulation.distance =
            null;

        state.announced.radar =
            null;

        state.announced.camera =
            null;

        state.announced.deadEnd =
            null;

        byId(
            "radarWarning"
        )?.classList.remove(
            "active"
        );

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

                    loadDeadEnds(
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
                    loadOfficialCameras();
                },
                CONFIG.camera.refreshInterval
            );
    }

    function startDeadEndRefresh() {
        if (
            state.deadEndRefreshTimer
        ) {
            clearInterval(
                state.deadEndRefreshTimer
            );
        }

        state.deadEndRefreshTimer =
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

                    loadDeadEnds(
                        position.latitude,
                        position.longitude
                    );
                },
                CONFIG.deadEnd.refreshInterval
            );
    }

    function setAlert(
        type,
        enabled
    ) {
        if (
            Object.prototype.hasOwnProperty.call(
                state.alerts,
                type
            )
        ) {
            state.alerts[type] =
                Boolean(enabled);
        }

        if (
            !enabled
        ) {
            if (
                type === "radar"
            ) {
                state.announced.radar =
                    null;
            }

            if (
                type === "camera"
            ) {
                state.announced.camera =
                    null;
            }

            if (
                type === "deadEnd"
            ) {
                state.announced.deadEnd =
                    null;
            }
        }
    }

    function setVoice(
        enabled
    ) {
        state.alerts.voice =
            Boolean(enabled);

        if (
            !enabled &&
            "speechSynthesis" in window
        ) {
            window.speechSynthesis
                .cancel();
        }
    }

    async function initialize() {
        if (
            state.initialized
        ) {
            return;
        }

        state.initialized =
            true;

        if (
            !initializeMap()
        ) {
            return;
        }

        showStatus(
            "RADAR ONLINE"
        );

        requestLocation();

        loadRadars(
            CONFIG.map.defaultCenter[0],
            CONFIG.map.defaultCenter[1]
        );

        loadDeadEnds(
            CONFIG.map.defaultCenter[0],
            CONFIG.map.defaultCenter[1]
        );

        loadOfficialCameras();

        startRadarRefresh();
        startCameraRefresh();
        startDeadEndRefresh();

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

        get deadEndCount() {
            return state.deadEndCount;
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

        get orientation() {
            return state.orientation;
        },

        get alerts() {
            return state.alerts;
        },

        requestLocation,
        startSimulation,
        stopSimulation,
        simulationStep,
        resetSimulation,
        updateUserMarker,
        distanceMeters,
        destinationPoint,
        checkAllAlerts,
        enableDeviceOrientation,
        setAlert,
        setVoice,
        showStatus,

        invalidateSize() {
            state.map?.invalidateSize();
        },

        reloadCameras() {
            return loadOfficialCameras();
        },

        reloadRadars() {
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

            return loadRadars(
                position.latitude,
                position.longitude
            );
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

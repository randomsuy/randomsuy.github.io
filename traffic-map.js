(() => {
    "use strict";

    const CONFIG = {
        map: {
            center: [-34.9011, -56.1645],
            zoom: 13,
            userZoom: 17,
            minZoom: 8,
            maxZoom: 19,
            uruguayBounds: [
                [-35.15, -58.5],
                [-30.05, -53.0]
            ]
        },

        gps: {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 1500
        },

        radar: {
            warningDistance: 300,
            directionDistance: 220,
            headingTolerance: 42,
            roadDistance: 75,
            refreshInterval: 180000,
            queryRadius: 50000
        },

        cameras: {
            refreshInterval: 600000,
            geocodeDelay: 1100,
            maxConcurrent: 1
        },

        simulation: {
            stepMeters: 20,
            defaultSpeed: 5
        },

        services: {
            overpass: "https://overpass-api.de/api/interpreter",
            cameraPage: "https://montevideo.gub.uy/tipo/area-tematica/movilidad/gestion-de-la-movilidad/camaras-de-monitoreo-del-transito",
            geocoder: "https://nominatim.openstreetmap.org/search"
        },

        preferences: {
            voice: true,
            radarAlert: true,
            cameraAlert: true,
            orientation: true
        }
    };

    const state = {
        initialized: false,
        map: null,
        userMarker: null,
        accuracyCircle: null,
        radarLayer: null,
        cameraLayer: null,
        radarMarkers: [],
        cameraMarkers: [],
        radars: [],
        cameras: [],
        radarCount: 0,
        cameraCount: 0,
        locationWatchId: null,
        locationActive: false,
        lastPosition: null,
        currentHeading: null,
        compassHeading: null,
        warningRadar: null,
        warningCamera: null,
        radarRefreshTimer: null,
        cameraRefreshTimer: null,
        lastRadarQuery: 0,
        lastRoadQuery: 0,
        lastRoadData: [],
        lastSpeech: 0,
        cameraLoading: false,
        orientationListening: false,
        roadName: null,
        preferences: {
            ...CONFIG.preferences
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
        const element = byId(id);
        if (element) {
            element.textContent = String(value);
        }
    }

    function showStatus(message) {
        setText("status", message);
    }

    function normalizeText(value) {
        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\b(av|avenida|avda)\b/g, "avenida")
            .replace(/\bbv\b/g, "bulevar")
            .replace(/\bblvd\b/g, "bulevar")
            .replace(/\bdr\b/g, "doctor")
            .replace(/\bgral\b/g, "general")
            .replace(/\bgral\.\b/g, "general")
            .replace(/\bprof\b/g, "profesor")
            .replace(/[.,/()\-]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function sameRoad(a, b) {
        const x = normalizeText(a);
        const y = normalizeText(b);

        if (!x || !y) {
            return false;
        }

        if (x === y) {
            return true;
        }

        const xa = x.split(" ");
        const ya = y.split(" ");

        const common = xa.filter(word =>
            word.length >= 4 &&
            ya.includes(word)
        );

        return common.length >= 1;
    }

    function distanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;

        const p1 = Number(lat1) * Math.PI / 180;
        const p2 = Number(lat2) * Math.PI / 180;

        const dp =
            (Number(lat2) - Number(lat1)) *
            Math.PI / 180;

        const dl =
            (Number(lon2) - Number(lon1)) *
            Math.PI / 180;

        const a =
            Math.sin(dp / 2) ** 2 +
            Math.cos(p1) *
            Math.cos(p2) *
            Math.sin(dl / 2) ** 2;

        return R *
            2 *
            Math.atan2(
                Math.sqrt(a),
                Math.sqrt(1 - a)
            );
    }

    function bearingBetween(lat1, lon1, lat2, lon2) {
        const p1 = Number(lat1) * Math.PI / 180;
        const p2 = Number(lat2) * Math.PI / 180;

        const dl =
            (Number(lon2) - Number(lon1)) *
            Math.PI / 180;

        const y =
            Math.sin(dl) * Math.cos(p2);

        const x =
            Math.cos(p1) * Math.sin(p2) -
            Math.sin(p1) *
            Math.cos(p2) *
            Math.cos(dl);

        return (
            Math.atan2(y, x) *
            180 /
            Math.PI +
            360
        ) % 360;
    }

    function angleDifference(a, b) {
        let d = Math.abs(
            Number(a) - Number(b)
        ) % 360;

        if (d > 180) {
            d = 360 - d;
        }

        return d;
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
                lat2 * 180 / Math.PI,

            longitude:
                lon2 * 180 / Math.PI
        };
    }

    function createUserIcon() {
        return L.divIcon({
            className: "user-navigation-marker",
            html: `
                <div class="user-arrow">
                    <div class="user-arrow-core"></div>
                </div>
            `,
            iconSize: [42, 42],
            iconAnchor: [21, 21]
        });
    }

    function createRadarIcon(limit) {
        const value =
            Number(limit) > 0
                ? `${Number(limit)}`
                : "RADAR";

        return L.divIcon({
            className: "radar-marker",
            html: `
                <div class="radar-icon">
                    <div class="radar-ring"></div>
                    <div class="radar-value">${value}</div>
                    ${
                        Number(limit) > 0
                            ? `<div class="radar-unit">KM/H</div>`
                            : ""
                    }
                </div>
            `,
            iconSize: [54, 54],
            iconAnchor: [27, 27]
        });
    }

    function createCameraIcon() {
        return L.divIcon({
            className: "camera-marker",
            html: `
                <div class="camera-icon">
                    <div class="camera-lens"></div>
                    <div class="camera-light"></div>
                </div>
            `,
            iconSize: [42, 42],
            iconAnchor: [21, 21]
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

        state.map = L.map(mapElement, {
            center: CONFIG.map.center,
            zoom: CONFIG.map.zoom,
            minZoom: CONFIG.map.minZoom,
            maxZoom: CONFIG.map.maxZoom,
            maxBounds: CONFIG.map.uruguayBounds,
            maxBoundsViscosity: 0.85,
            zoomControl: false,
            attributionControl: true,
            preferCanvas: true
        });

        L.control.zoom({
            position: "bottomright"
        }).addTo(state.map);

        L.tileLayer(
            "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
            {
                maxZoom: 19,
                attribution:
                    "&copy; OpenStreetMap contributors &copy; CARTO"
            }
        ).addTo(state.map);

        state.radarLayer =
            L.layerGroup().addTo(state.map);

        state.cameraLayer =
            L.layerGroup().addTo(state.map);

        state.map.on("click", event => {
            if (!state.simulation.active) {
                return;
            }

            state.simulation.latitude =
                event.latlng.lat;

            state.simulation.longitude =
                event.latlng.lng;

            updateSimulationPosition();
        });

        return true;
    }

    async function requestLocation(force = false) {
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
        enableOrientation();
    }

    function startLocationWatch() {
        if (state.locationWatchId !== null) {
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
                20
            );

        const speed =
            safeNumber(
                position.coords.speed,
                0
            );

        let gpsHeading =
            Number(position.coords.heading);

        if (
            !Number.isFinite(gpsHeading) ||
            gpsHeading < 0
        ) {
            gpsHeading = null;
        }

        if (
            gpsHeading !== null &&
            speed >= 0.7
        ) {
            state.currentHeading =
                gpsHeading;
        }

        if (
            state.compassHeading !== null &&
            state.preferences.orientation
        ) {
            state.currentHeading =
                state.compassHeading;
        }

        state.lastPosition = {
            latitude,
            longitude,
            accuracy,
            speed,
            heading:
                state.currentHeading ??
                gpsHeading ??
                0,
            timestamp: Date.now()
        };

        state.locationActive = true;

        updateUserMarker(
            latitude,
            longitude
        );

        updateHeadingUI();

        if (!state.simulation.active) {
            const zoom =
                state.map?.getZoom();

            if (
                state.map &&
                (
                    !state.userMarker ||
                    zoom < 14
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

        checkCameras(
            latitude,
            longitude
        );

        showStatus(
            `${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
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

    async function enableOrientation() {
        if (state.orientationListening) {
            return;
        }

        try {
            if (
                typeof DeviceOrientationEvent !==
                "undefined" &&
                typeof DeviceOrientationEvent.requestPermission ===
                "function"
            ) {
                const permission =
                    await DeviceOrientationEvent.requestPermission();

                if (permission !== "granted") {
                    return;
                }
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

            state.orientationListening = true;
        } catch (error) {
            console.warn(
                "Orientation:",
                error
            );
        }
    }

    function handleOrientation(event) {
        if (!state.preferences.orientation) {
            return;
        }

        let heading = null;

        if (
            typeof event.webkitCompassHeading ===
            "number"
        ) {
            heading =
                event.webkitCompassHeading;
        } else if (
            typeof event.alpha ===
            "number"
        ) {
            heading =
                360 - event.alpha;
        }

        if (
            Number.isFinite(heading)
        ) {
            state.compassHeading =
                (
                    heading +
                    360
                ) % 360;

            if (
                !state.simulation.active
            ) {
                state.currentHeading =
                    state.compassHeading;
            }

            updateUserHeading();
            updateHeadingUI();
        }
    }

    function updateUserHeading() {
        if (!state.userMarker) {
            return;
        }

        const element =
            state.userMarker.getElement();

        if (!element) {
            return;
        }

        const arrow =
            element.querySelector(
                ".user-arrow"
            );

        if (arrow) {
            arrow.style.transform =
                `rotate(${state.currentHeading || 0}deg)`;
        }
    }

    function updateHeadingUI() {
        const heading =
            Number(
                state.currentHeading
            );

        if (!Number.isFinite(heading)) {
            return;
        }

        setText(
            "headingValue",
            `${Math.round(heading)}°`
        );

        const direction =
            headingToCardinal(
                heading
            );

        setText(
            "headingDirection",
            direction
        );
    }

    function headingToCardinal(heading) {
        const directions = [
            "N",
            "NE",
            "E",
            "SE",
            "S",
            "SO",
            "O",
            "NO"
        ];

        return directions[
            Math.round(
                heading / 45
            ) % 8
        ];
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
                        icon:
                            createUserIcon(),
                        zIndexOffset: 2000
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

        updateUserHeading();

        const radius =
            state.lastPosition?.accuracy ||
            10;

        if (!state.accuracyCircle) {
            state.accuracyCircle =
                L.circle(
                    [latitude, longitude],
                    {
                        radius,
                        color: "#00d9ff",
                        weight: 1,
                        opacity: .25,
                        fillColor: "#00d9ff",
                        fillOpacity: .035,
                        interactive: false
                    }
                ).addTo(state.map);
        } else {
            state.accuracyCircle.setLatLng(
                [latitude, longitude]
            );

            state.accuracyCircle.setRadius(
                radius
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

        return match
            ? Number(match[1])
            : null;
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
            now - state.lastRadarQuery <
            30000
        ) {
            return;
        }

        state.lastRadarQuery = now;

        showStatus("ACTUALIZANDO RADARES...");

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
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/x-www-form-urlencoded"
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

            const data =
                await response.json();

            const parsed =
                normalizeRadarData(
                    data?.elements || []
                );

            state.radars =
                deduplicateRadars(parsed);

            state.radarCount =
                state.radars.length;

            renderRadars();
        } catch (error) {
            console.error(
                "Radar:",
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
                    Number(element.center.lat);

                longitude =
                    Number(element.center.lon);
            }

            if (
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude)
            ) {
                continue;
            }

            const tags =
                element.tags || {};

            result.push({
                id: String(
                    element.id ??
                    `${latitude}:${longitude}`
                ),

                latitude,
                longitude,

                limit:
                    parseSpeedLimit(
                        tags.maxspeed ||
                        tags.maxspeed_forward ||
                        tags.maxspeed_backward
                    ),

                direction:
                    tags.direction ||
                    null,

                name:
                    tags.name ||
                    "RADAR DE VELOCIDAD",

                road:
                    tags.name ||
                    tags.ref ||
                    null,

                source:
                    "OpenStreetMap"
            });
        }

        return result;
    }

    function deduplicateRadars(radars) {
        const result = [];

        for (const radar of radars) {
            const duplicate =
                result.some(
                    existing =>
                        distanceMeters(
                            existing.latitude,
                            existing.longitude,
                            radar.latitude,
                            radar.longitude
                        ) < 25
                );

            if (!duplicate) {
                result.push(radar);
            }
        }

        return result;
    }

    function renderRadars() {
        state.radarLayer?.clearLayers();

        state.radarMarkers = [];

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

            marker.bindPopup(`
                <div class="popup-card">
                    <div class="popup-title">
                        RADAR DE VELOCIDAD
                    </div>
                    <div>
                        LÍMITE:
                        ${
                            radar.limit
                                ? `${radar.limit} KM/H`
                                : "NO DISPONIBLE"
                        }
                    </div>
                    <div>
                        CALLE:
                        ${
                            radar.road ||
                            "NO DISPONIBLE"
                        }
                    </div>
                    <div>
                        FUENTE:
                        OPENSTREETMAP
                    </div>
                </div>
            `);

            marker.addTo(
                state.radarLayer
            );

            state.radarMarkers.push(
                marker
            );
        }
    }

    async function getNearestRoad(
        latitude,
        longitude
    ) {
        const now = Date.now();

        if (
            now - state.lastRoadQuery <
            5000
        ) {
            return state.lastRoadData;
        }

        state.lastRoadQuery = now;

        const query = `
[out:json][timeout:12];
way["highway"]
(around:${CONFIG.radar.roadDistance},${latitude},${longitude});
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
                            encodeURIComponent(query)
                    }
                );

            if (!response.ok) {
                return [];
            }

            const data =
                await response.json();

            const roads = [];

            for (
                const way of
                data?.elements || []
            ) {
                const tags =
                    way.tags || {};

                if (!tags.name) {
                    continue;
                }

                let point = null;

                if (
                    way.center &&
                    Number.isFinite(
                        Number(
                            way.center.lat
                        )
                    )
                ) {
                    point = {
                        latitude:
                            Number(
                                way.center.lat
                            ),
                        longitude:
                            Number(
                                way.center.lon
                            )
                    };
                }

                if (!point) {
                    continue;
                }

                roads.push({
                    name:
                        tags.name,
                    point,
                    highway:
                        tags.highway
                });
            }

            roads.sort(
                (a, b) =>
                    distanceMeters(
                        latitude,
                        longitude,
                        a.point.latitude,
                        a.point.longitude
                    ) -
                    distanceMeters(
                        latitude,
                        longitude,
                        b.point.latitude,
                        b.point.longitude
                    )
            );

            state.lastRoadData =
                roads;

            state.roadName =
                roads[0]?.name ||
                null;

            return roads;
        } catch {
            return [];
        }
    }

    async function findRelevantRadar(
        latitude,
        longitude
    ) {
        const heading =
            state.currentHeading;

        if (
            !Number.isFinite(heading)
        ) {
            return null;
        }

        const roads =
            await getNearestRoad(
                latitude,
                longitude
            );

        const currentRoad =
            roads[0]?.name ||
            null;

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
                distance >
                CONFIG.radar.warningDistance
            ) {
                continue;
            }

            const bearing =
                bearingBetween(
                    latitude,
                    longitude,
                    radar.latitude,
                    radar.longitude
                );

            const headingDelta =
                angleDifference(
                    heading,
                    bearing
                );

            if (
                headingDelta >
                CONFIG.radar.headingTolerance
            ) {
                continue;
            }

            const radarRoad =
                radar.road;

            const sameStreet =
                radarRoad &&
                currentRoad &&
                sameRoad(
                    radarRoad,
                    currentRoad
                );

            if (
                !sameStreet &&
                distance >
                CONFIG.radar.directionDistance
            ) {
                continue;
            }

            if (
                !closest ||
                distance <
                closest.distance
            ) {
                closest = {
                    radar,
                    distance,
                    bearing,
                    sameStreet
                };
            }
        }

        return closest;
    }

    async function checkRadars(
        latitude,
        longitude
    ) {
        if (
            !state.preferences.radarAlert
        ) {
            hideRadarWarning();
            return null;
        }

        const result =
            await findRelevantRadar(
                latitude,
                longitude
            );

        if (!result) {
            hideRadarWarning();
            return null;
        }

        state.warningRadar =
            result.radar;

        showRadarWarning(
            result.radar,
            result.distance,
            "RADAR"
        );

        return result;
    }

    async function loadOfficialCameras() {
        if (state.cameraLoading) {
            return;
        }

        state.cameraLoading = true;

        showStatus(
            "ACTUALIZANDO CÁMARAS OFICIALES..."
        );

        try {
            const response =
                await fetch(
                    CONFIG.services.cameraPage +
                    "?_=" +
                    Date.now(),
                    {
                        cache: "no-store"
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
                extractCameraLocations(
                    html
                );

            if (!locations.length) {
                throw new Error(
                    "SIN UBICACIONES"
                );
            }

            const cameras =
                await geocodeCameraLocations(
                    locations
                );

            state.cameras =
                cameras.filter(
                    camera =>
                        Number.isFinite(
                            camera.latitude
                        ) &&
                        Number.isFinite(
                            camera.longitude
                        )
                );

            state.cameraCount =
                state.cameras.length;

            renderCameras();

            showStatus(
                `${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
            );
        } catch (error) {
            console.error(
                "Official cameras:",
                error
            );

            showStatus(
                "ERROR CARGANDO CÁMARAS OFICIALES"
            );
        } finally {
            state.cameraLoading = false;
        }
    }

    function extractCameraLocations(html) {
        const parser =
            new DOMParser();

        const document =
            parser.parseFromString(
                html,
                "text/html"
            );

        const text =
            document.body?.innerText ||
            "";

        const lines =
            text
                .split(/\r?\n/)
                .map(line =>
                    line
                        .replace(/\s+/g, " ")
                        .trim()
                )
                .filter(Boolean);

        const results = [];

        let active = false;

        for (const line of lines) {
            if (
                /^Centro y Cordón$/i.test(line)
            ) {
                active = true;
            }

            if (!active) {
                continue;
            }

            if (
                /^(Publicado|Última actualización|Las filmaciones|Para solicitar)/i.test(
                    line
                )
            ) {
                continue;
            }

            if (
                line.length < 6 ||
                line.length > 180
            ) {
                continue;
            }

            if (
                /^[A-ZÁÉÍÓÚÑ][^:]+ y [A-ZÁÉÍÓÚÑ0-9]/.test(line) ||
                /^[A-ZÁÉÍÓÚÑ][^/]+\/[^/]+/.test(line)
            ) {
                results.push(line);
            }
        }

        const unique = [];

        for (const item of results) {
            const normalized =
                normalizeText(item);

            if (
                normalized.length < 6
            ) {
                continue;
            }

            if (
                unique.some(
                    existing =>
                        normalizeText(
                            existing
                        ) === normalized
                )
            ) {
                continue;
            }

            unique.push(item);
        }

        return unique;
    }

    function cameraCacheKey(location) {
        return (
            "traffic-camera:" +
            normalizeText(location)
        );
    }

    function getCameraCache(location) {
        try {
            const value =
                localStorage.getItem(
                    cameraCacheKey(location)
                );

            if (!value) {
                return null;
            }

            const parsed =
                JSON.parse(value);

            if (
                !Number.isFinite(
                    parsed.latitude
                ) ||
                !Number.isFinite(
                    parsed.longitude
                )
            ) {
                return null;
            }

            return parsed;
        } catch {
            return null;
        }
    }

    function setCameraCache(
        location,
        value
    ) {
        try {
            localStorage.setItem(
                cameraCacheKey(location),
                JSON.stringify(value)
            );
        } catch {}
    }

    async function geocodeCameraLocations(
        locations
    ) {
        const result = [];

        for (
            const location of locations
        ) {
            const cached =
                getCameraCache(
                    location
                );

            if (cached) {
                result.push({
                    ...cached,
                    name: location
                });

                continue;
            }

            const coordinate =
                await geocodeLocation(
                    location
                );

            if (coordinate) {
                setCameraCache(
                    location,
                    coordinate
                );

                result.push({
                    ...coordinate,
                    name: location
                });
            }

            await sleep(
                CONFIG.cameras.geocodeDelay
            );
        }

        return result;
    }

    async function geocodeLocation(
        location
    ) {
        try {
            const query =
                encodeURIComponent(
                    `${location}, Montevideo, Uruguay`
                );

            const url =
                `${CONFIG.services.geocoder}?format=jsonv2&limit=1&countrycodes=uy&city=Montevideo&q=${query}`;

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

            return {
                latitude:
                    Number(item.lat),
                longitude:
                    Number(item.lon)
            };
        } catch {
            return null;
        }
    }

    function sleep(ms) {
        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
    }

    function renderCameras() {
        state.cameraLayer?.clearLayers();

        state.cameraMarkers = [];

        for (
            const camera of
            state.cameras
        ) {
            const marker =
                L.marker(
                    [
                        camera.latitude,
                        camera.longitude
                    ],
                    {
                        icon:
                            createCameraIcon(),
                        zIndexOffset: 800
                    }
                );

            marker.bindPopup(`
                <div class="popup-card camera-popup">
                    <div class="popup-title camera-title">
                        CÁMARA OFICIAL
                    </div>
                    <div>
                        ${escapeHtml(
                            camera.name
                        )}
                    </div>
                    <div>
                        FUENTE:
                        INTENDENCIA DE MONTEVIDEO
                    </div>
                </div>
            `);

            marker.addTo(
                state.cameraLayer
            );

            state.cameraMarkers.push(
                marker
            );
        }
    }

    function escapeHtml(value) {
        return String(value)
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

        for (
            const camera of
            state.cameras
        ) {
            const distance =
                distanceMeters(
                    latitude,
                    longitude,
                    camera.latitude,
                    camera.longitude
                );

            if (
                !closest ||
                distance <
                closest.distance
            ) {
                closest = {
                    camera,
                    distance
                };
            }
        }

        return closest;
    }

    function checkCameras(
        latitude,
        longitude
    ) {
        if (
            !state.preferences.cameraAlert
        ) {
            hideCameraWarning();
            return null;
        }

        const heading =
            state.currentHeading;

        if (
            !Number.isFinite(heading)
        ) {
            hideCameraWarning();
            return null;
        }

        const closest =
            findClosestCamera(
                latitude,
                longitude
            );

        if (!closest) {
            hideCameraWarning();
            return null;
        }

        const bearing =
            bearingBetween(
                latitude,
                longitude,
                closest.camera.latitude,
                closest.camera.longitude
            );

        const delta =
            angleDifference(
                heading,
                bearing
            );

        if (
            closest.distance >
            250 ||
            delta >
            45
        ) {
            hideCameraWarning();
            return null;
        }

        state.warningCamera =
            closest.camera;

        showRadarWarning(
            closest.camera,
            closest.distance,
            "CÁMARA"
        );

        return closest;
    }

    function showRadarWarning(
        item,
        distance,
        type
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
            if (type === "RADAR") {
                limitElement.textContent =
                    item.limit
                        ? `RADAR · LÍMITE ${item.limit} KM/H`
                        : "RADAR DE VELOCIDAD";
            } else {
                limitElement.textContent =
                    "CÁMARA OFICIAL";
            }
        }

        warning.classList.add(
            "active",
            type === "RADAR"
                ? "radar-mode"
                : "camera-mode"
        );

        speakWarning(
            item,
            rounded,
            type
        );
    }

    function speakWarning(
        item,
        distance,
        type
    ) {
        if (
            !state.preferences.voice ||
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

        let text;

        if (type === "RADAR") {
            text =
                item.limit
                    ? `Radar a ${distance} metros. Límite ${item.limit} kilómetros por hora.`
                    : `Radar a ${distance} metros.`;
        } else {
            text =
                `Cámara de monitoreo a ${distance} metros.`;
        }

        try {
            window.speechSynthesis.cancel();

            const utterance =
                new SpeechSynthesisUtterance(
                    text
                );

            utterance.lang = "es-UY";
            utterance.rate = .96;
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
                "active",
                "radar-mode"
            );
        }

        state.warningRadar =
            null;
    }

    function hideCameraWarning() {
        const warning =
            byId("radarWarning");

        if (warning) {
            warning.classList.remove(
                "active",
                "camera-mode"
            );
        }

        state.warningCamera =
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
                state.map.getCenter();

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
            state.currentHeading ||
            0;

        state.simulation.radar =
            null;

        state.simulation.distance =
            null;

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
        hideCameraWarning();

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
            simulation.longitude
        );

        checkCameras(
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
                duration: .2
            }
        );
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
            result?.radar ||
            null;

        state.simulation.distance =
            result?.distance ??
            null;
    }

    function findClosestRadar(
        latitude,
        longitude
    ) {
        let closest = null;

        for (
            const radar of
            state.radars
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

    function resetSimulation() {
        if (
            !state.simulation.active
        ) {
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
            state.currentHeading ||
            0;

        state.simulation.radar =
            null;

        state.simulation.distance =
            null;

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
            CONFIG.map.userZoom,
            {
                animate: true
            }
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
            setInterval(() => {
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
            }, CONFIG.radar.refreshInterval);
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
                loadOfficialCameras,
                CONFIG.cameras.refreshInterval
            );
    }

    function setPreference(
        key,
        value
    ) {
        state.preferences[key] =
            Boolean(value);

        try {
            localStorage.setItem(
                `traffic-${key}`,
                state.preferences[key]
                    ? "1"
                    : "0"
            );
        } catch {}

        updatePreferenceUI();

        if (
            key === "voice" &&
            !state.preferences.voice
        ) {
            window.speechSynthesis?.cancel();
        }

        if (
            key === "radarAlert" &&
            !state.preferences.radarAlert
        ) {
            hideRadarWarning();
        }

        if (
            key === "cameraAlert" &&
            !state.preferences.cameraAlert
        ) {
            hideCameraWarning();
        }

        if (
            key === "orientation" &&
            !state.preferences.orientation
        ) {
            state.currentHeading =
                state.lastPosition?.heading ??
                0;
        }
    }

    function loadPreferences() {
        for (
            const key of
            Object.keys(
                state.preferences
            )
        ) {
            try {
                const value =
                    localStorage.getItem(
                        `traffic-${key}`
                    );

                if (
                    value !== null
                ) {
                    state.preferences[key] =
                        value === "1";
                }
            } catch {}
        }
    }

    function updatePreferenceUI() {
        const map = {
            voice:
                "voiceToggle",
            radarAlert:
                "radarToggle",
            cameraAlert:
                "cameraToggle",
            orientation:
                "orientationToggle"
        };

        for (
            const [
                key,
                id
            ] of Object.entries(map)
        ) {
            const button =
                byId(id);

            if (!button) {
                continue;
            }

            button.classList.toggle(
                "active",
                state.preferences[key]
            );

            const dot =
                button.querySelector(
                    ".toggle-dot"
                );

            if (dot) {
                dot.textContent =
                    state.preferences[key]
                        ? "ON"
                        : "OFF";
            }
        }
    }

    function initialize() {
        if (
            state.initialized
        ) {
            return;
        }

        state.initialized =
            true;

        loadPreferences();

        if (
            !initializeMap()
        ) {
            return;
        }

        updatePreferenceUI();

        showStatus(
            "RADAR ONLINE"
        );

        requestLocation();

        loadRadars(
            CONFIG.map.center[0],
            CONFIG.map.center[1]
        );

        loadOfficialCameras();

        startRadarRefresh();
        startCameraRefresh();

        setTimeout(() => {
            state.map?.invalidateSize();
        }, 300);

        setTimeout(() => {
            state.map?.invalidateSize();
        }, 1000);
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

        get preferences() {
            return state.preferences;
        },

        requestLocation,
        startSimulation,
        stopSimulation,
        simulationStep,
        resetSimulation,
        setPreference,
        updateUserMarker,
        distanceMeters,
        destinationPoint,
        checkRadars,
        checkCameras,
        updateSimulationUI,
        loadRadars,
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

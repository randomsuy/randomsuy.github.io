(() => {
"use strict";

const CONFIG = {
    map: {
        center: [-34.9011, -56.1645],
        zoom: 13,
        minZoom: 10,
        maxZoom: 19,
        bounds: [
            [-35.12, -56.45],
            [-34.70, -55.95]
        ]
    },

    gps: {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 2000
    },

    radar: {
        radius: 50000,
        warningDistance: 350,
        refresh: 300000
    },

    camera: {
        warningDistance: 350,
        refresh: 900000,
        source: "https://montevideo.gub.uy/tipo/area-tematica/movilidad/gestion-de-la-movilidad/camaras-de-monitoreo-del-transito",
        proxy: "https://r.jina.ai/http://montevideo.gub.uy/tipo/area-tematica/movilidad/gestion-de-la-movilidad/camaras-de-monitoreo-del-transito"
    },

    deadEnd: {
        radius: 10000,
        warningDistance: 250,
        refresh: 600000
    },

    overpass: "https://overpass-api.de/api/interpreter",

    nominatim: "https://nominatim.openstreetmap.org/search",

    simulation: {
        stepMeters: 20,
        speed: 8
    },

    orientation: {
        smoothing: 0.18
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

    radars: [],
    cameras: [],
    deadEnds: [],

    radarCount: 0,
    cameraCount: 0,
    deadEndCount: 0,

    locationWatchId: null,
    locationActive: false,
    lastPosition: null,

    radarTimer: null,
    cameraTimer: null,
    deadEndTimer: null,

    orientation: {
        active: false,
        heading: 0,
        raw: null,
        listener: null,
        permissionRequested: false
    },

    alerts: {
        voice: true,
        radar: true,
        camera: true,
        deadEnd: true
    },

    alerted: {
        radar: new Map(),
        camera: new Map(),
        deadEnd: new Map()
    },

    warning: {
        type: null,
        id: null
    },

    lastSpeech: 0,

    simulation: {
        active: false,
        latitude: null,
        longitude: null,
        heading: 0,
        speed: CONFIG.simulation.speed
    },

    lastCameraLoad: 0,
    lastDeadEndLoad: 0,
    cameraGeocodeCache: {}
};

function byId(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const el = byId(id);
    if (el) {
        el.textContent = String(value);
    }
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function showStatus(text) {
    setText("status", text);
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
        Math.sin(dl) *
        Math.cos(p2);

    const x =
        Math.cos(p1) *
        Math.sin(p2) -
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
    return Math.abs(
        ((a - b + 540) % 360) - 180
    );
}

function destinationPoint(lat, lon, bearing, distance) {
    const R = 6371000;

    const p1 =
        Number(lat) *
        Math.PI / 180;

    const l1 =
        Number(lon) *
        Math.PI / 180;

    const br =
        Number(bearing) *
        Math.PI / 180;

    const d =
        Number(distance) / R;

    const p2 =
        Math.asin(
            Math.sin(p1) *
            Math.cos(d) +
            Math.cos(p1) *
            Math.sin(d) *
            Math.cos(br)
        );

    const l2 =
        l1 +
        Math.atan2(
            Math.sin(br) *
            Math.sin(d) *
            Math.cos(p1),
            Math.cos(d) -
            Math.sin(p1) *
            Math.sin(p2)
        );

    return {
        latitude:
            p2 * 180 / Math.PI,

        longitude:
            l2 * 180 / Math.PI
    };
}

function normalizeHeading(value) {
    let heading = Number(value);

    if (!Number.isFinite(heading)) {
        return state.orientation.heading;
    }

    heading %= 360;

    if (heading < 0) {
        heading += 360;
    }

    return heading;
}

function smoothHeading(current, target) {
    let delta =
        ((target - current + 540) % 360) - 180;

    return normalizeHeading(
        current +
        delta *
        CONFIG.orientation.smoothing
    );
}

function createUserIcon(heading) {
    return L.divIcon({
        className: "traffic-user-marker",
        html: `
            <div class="user-marker" style="transform:rotate(${heading}deg)">
                <div class="user-arrow"></div>
                <div class="user-dot"></div>
            </div>
        `,
        iconSize: [46, 46],
        iconAnchor: [23, 23]
    });
}

function createRadarIcon(limit) {
    const value =
        Number.isFinite(Number(limit)) &&
        Number(limit) > 0
            ? Number(limit)
            : "—";

    return L.divIcon({
        className: "traffic-radar-marker",
        html: `
            <div class="radar-marker">
                <div class="radar-ring"></div>
                <span>${value}</span>
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
                <div class="camera-body"></div>
                <div class="camera-lens"></div>
            </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });
}

function createDeadEndIcon() {
    return L.divIcon({
        className: "traffic-deadend-marker",
        html: `
            <div class="deadend-marker">⊥</div>
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

    const element = byId("map");

    if (!element) {
        return false;
    }

    state.map = L.map(element, {
        center: CONFIG.map.center,
        zoom: CONFIG.map.zoom,
        minZoom: CONFIG.map.minZoom,
        maxZoom: CONFIG.map.maxZoom,
        maxBounds: CONFIG.map.bounds,
        maxBoundsViscosity: 1,
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true
    });

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors"
        }
    ).addTo(state.map);

    state.radarLayer =
        L.layerGroup().addTo(state.map);

    state.cameraLayer =
        L.layerGroup().addTo(state.map);

    state.deadEndLayer =
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

function requestLocation(force = false) {
    if (
        state.simulation.active &&
        !force
    ) {
        return;
    }

    if (!navigator.geolocation) {
        state.locationActive = false;
        setText("gpsState", "GPS NO DISPONIBLE");
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
    requestOrientation();
}

function startLocationWatch() {
    if (
        state.locationWatchId !== null ||
        !navigator.geolocation
    ) {
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

    const gpsSpeed =
        safeNumber(
            position.coords.speed,
            0
        );

    let gpsHeading =
        Number(position.coords.heading);

    if (!Number.isFinite(gpsHeading)) {
        gpsHeading =
            state.lastPosition?.heading ??
            state.orientation.heading ??
            0;
    }

    state.lastPosition = {
        latitude,
        longitude,
        accuracy,
        speed: gpsSpeed,
        heading: normalizeHeading(gpsHeading),
        timestamp: Date.now()
    };

    state.locationActive = true;

    if (
        !state.orientation.active &&
        Number.isFinite(gpsHeading)
    ) {
        state.orientation.heading =
            normalizeHeading(gpsHeading);
    }

    updateUserMarker(
        latitude,
        longitude
    );

    if (!state.simulation.active) {
        if (
            state.map &&
            state.map.getZoom() < 14
        ) {
            state.map.setView(
                [latitude, longitude],
                16,
                { animate: true }
            );
        }
    }

    checkAlerts(
        latitude,
        longitude,
        getCurrentHeading()
    );

    setText(
        "gpsState",
        state.orientation.active
            ? "BRÚJULA ACTIVA"
            : "GPS ACTIVO"
    );

    showStatus(
        `GPS ACTIVO · ${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
    );
}

function handlePositionError(error) {
    state.locationActive = false;

    let text = "ERROR GPS";

    if (error?.code === 1) {
        text = "PERMISO GPS DENEGADO";
    }

    if (error?.code === 2) {
        text = "UBICACIÓN NO DISPONIBLE";
    }

    if (error?.code === 3) {
        text = "TIMEOUT GPS";
    }

    setText("gpsState", "GPS OFF");
    showStatus(text);
}

async function requestOrientation() {
    if (
        state.orientation.active ||
        state.orientation.permissionRequested
    ) {
        return;
    }

    state.orientation.permissionRequested = true;

    try {
        if (
            typeof DeviceOrientationEvent !==
            "undefined" &&
            typeof DeviceOrientationEvent
                .requestPermission ===
                "function"
        ) {
            const permission =
                await DeviceOrientationEvent
                    .requestPermission();

            if (permission !== "granted") {
                state.orientation.permissionRequested = false;
                return;
            }
        }

        const listener =
            event => {
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
                    !Number.isFinite(heading)
                ) {
                    return;
                }

                heading =
                    normalizeHeading(
                        heading
                    );

                state.orientation.raw =
                    heading;

                state.orientation.heading =
                    smoothHeading(
                        state.orientation.heading,
                        heading
                    );

                state.orientation.active = true;

                updateOrientationUI();
                updateUserMarkerFromCurrentPosition();
            };

        state.orientation.listener =
            listener;

        window.addEventListener(
            "deviceorientationabsolute",
            listener,
            true
        );

        window.addEventListener(
            "deviceorientation",
            listener,
            true
        );

        setText(
            "gpsState",
            "BRÚJULA ACTIVA"
        );
    } catch (error) {
        console.warn(
            "[Orientation]",
            error
        );

        state.orientation.permissionRequested = false;
    }
}

function stopOrientation() {
    if (
        !state.orientation.listener
    ) {
        return;
    }

    window.removeEventListener(
        "deviceorientationabsolute",
        state.orientation.listener,
        true
    );

    window.removeEventListener(
        "deviceorientation",
        state.orientation.listener,
        true
    );

    state.orientation.listener = null;
    state.orientation.active = false;
    state.orientation.permissionRequested = false;
}

function getCurrentHeading() {
    if (
        state.orientation.active
    ) {
        return normalizeHeading(
            state.orientation.heading
        );
    }

    if (
        state.simulation.active &&
        Number.isFinite(
            state.simulation.heading
        )
    ) {
        return normalizeHeading(
            state.simulation.heading
        );
    }

    return normalizeHeading(
        state.lastPosition?.heading || 0
    );
}

function updateOrientationUI() {
    const heading =
        getCurrentHeading();

    setText(
        "headingValue",
        `${Math.round(heading)
            .toString()
            .padStart(3, "0")}°`
    );

    const arrow =
        byId("headingArrow");

    if (arrow) {
        arrow.style.transform =
            `rotate(${heading}deg)`;
    }
}

function updateUserMarkerFromCurrentPosition() {
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

    updateUserMarker(
        position.latitude,
        position.longitude
    );
}

function updateUserMarker(
    latitude,
    longitude
) {
    if (!state.map) {
        return;
    }

    const heading =
        getCurrentHeading();

    if (!state.userMarker) {
        state.userMarker =
            L.marker(
                [latitude, longitude],
                {
                    icon:
                        createUserIcon(
                            heading
                        ),
                    zIndexOffset: 2000
                }
            ).addTo(state.map);
    } else {
        state.userMarker.setLatLng([
            latitude,
            longitude
        ]);

        state.userMarker.setIcon(
            createUserIcon(
                heading
            )
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
                    opacity: .3,
                    fillColor: "#36c8d8",
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

    const query = `
[out:json][timeout:30];
(
node["highway"="speed_camera"](around:${CONFIG.radar.radius},${latitude},${longitude});
node["enforcement"="speed"](around:${CONFIG.radar.radius},${latitude},${longitude});
way["highway"="speed_camera"](around:${CONFIG.radar.radius},${latitude},${longitude});
way["enforcement"="speed"](around:${CONFIG.radar.radius},${latitude},${longitude});
);
out center tags;
`;

    try {
        const response =
            await fetch(
                CONFIG.overpass,
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

        const result = [];

        for (
            const element of
            data.elements || []
        ) {
            let lat = null;
            let lon = null;

            if (
                Number.isFinite(
                    Number(element.lat)
                )
            ) {
                lat = Number(element.lat);
                lon = Number(element.lon);
            } else if (
                element.center
            ) {
                lat =
                    Number(
                        element.center.lat
                    );

                lon =
                    Number(
                        element.center.lon
                    );
            }

            if (
                !Number.isFinite(lat) ||
                !Number.isFinite(lon)
            ) {
                continue;
            }

            const tags =
                element.tags || {};

            const limit =
                parseSpeed(
                    tags.maxspeed ||
                    tags.maxspeed_forward ||
                    tags.maxspeed_backward
                );

            result.push({
                id:
                    `radar-${element.id}`,
                latitude: lat,
                longitude: lon,
                limit,
                direction:
                    tags.direction || null,
                name:
                    tags.name ||
                    "RADAR DE VELOCIDAD",
                source:
                    "OpenStreetMap"
            });
        }

        state.radars =
            deduplicate(
                result,
                20
            );

        state.radarCount =
            state.radars.length;

        renderRadars();

        setText(
            "status",
            `${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
        );
    } catch (error) {
        console.warn(
            "[Radars]",
            error
        );
    }
}

function parseSpeed(value) {
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

function deduplicate(
    items,
    threshold
) {
    const result = [];

    for (
        const item of items
    ) {
        const exists =
            result.some(
                existing =>
                    distanceMeters(
                        existing.latitude,
                        existing.longitude,
                        item.latitude,
                        item.longitude
                    ) < threshold
            );

        if (!exists) {
            result.push(item);
        }
    }

    return result;
}

function renderRadars() {
    state.radarLayer.clearLayers();

    for (
        const radar of state.radars
    ) {
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
            <div class="map-popup">
                <strong>RADAR DE VELOCIDAD</strong>
                <br>
                LÍMITE:
                ${
                    radar.limit
                        ? `${radar.limit} KM/H`
                        : "NO DISPONIBLE"
                }
                <br>
                FUENTE: OPENSTREETMAP
            </div>
        `);

        marker.addTo(
            state.radarLayer
        );
    }
}

function extractCameraNames(text) {
    const names = [];

    const lines =
        String(text)
            .split(/\r?\n/)
            .map(
                line =>
                    line
                        .replace(
                            /^[-*•]\s*/,
                            ""
                        )
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .trim()
            );

    let section = "";

    for (
        const line of lines
    ) {
        if (
            line.startsWith("#")
        ) {
            section =
                line
                    .replace(/^#+/, "")
                    .trim();

            continue;
        }

        if (
            !line ||
            line.length < 8
        ) {
            continue;
        }

        if (
            !line.includes(" y ") &&
            !line.includes(" e ") &&
            !line.includes(" / ")
        ) {
            continue;
        }

        if (
            /última actualización/i.test(
                line
            )
        ) {
            continue;
        }

        const clean =
            line
                .replace(
                    /^\d+\.\s*/,
                    ""
                )
                .replace(
                    /[*_`]/g,
                    ""
                )
                .trim();

        if (
            clean.length < 8 ||
            clean.length > 160
        ) {
            continue;
        }

        names.push({
            name: clean,
            zone: section
        });
    }

    return [
        ...new Map(
            names.map(
                item => [
                    item.name
                        .toLowerCase(),
                    item
                ]
            )
        ).values()
    ];
}

function normalizeCameraQuery(name) {
    let value =
        name
            .replace(
                /\s*\([^)]*\)/g,
                ""
            )
            .replace(
                /\s+\/\s+/g,
                " "
            )
            .replace(
                /\s+/g,
                " "
            )
            .trim();

    value =
        value
            .replace(
                /^Rambla portuaria/i,
                "Rambla"
            )
            .replace(
                /^Túnel /i,
                ""
            );

    return `${value}, Montevideo, Uruguay`;
}

async function geocodeCamera(item) {
    const query =
        normalizeCameraQuery(
            item.name
        );

    const cached =
        state.cameraGeocodeCache[
            query
        ];

    if (cached) {
        return cached;
    }

    try {
        const url =
            `${CONFIG.nominatim}?format=jsonv2&limit=1&countrycodes=uy&q=${encodeURIComponent(query)}`;

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

        const result =
            data?.[0];

        if (!result) {
            return null;
        }

        const location = {
            latitude:
                Number(result.lat),
            longitude:
                Number(result.lon)
        };

        if (
            !Number.isFinite(
                location.latitude
            ) ||
            !Number.isFinite(
                location.longitude
            )
        ) {
            return null;
        }

        if (
            location.latitude < -35.2 ||
            location.latitude > -34.6 ||
            location.longitude < -56.6 ||
            location.longitude > -55.7
        ) {
            return null;
        }

        state.cameraGeocodeCache[
            query
        ] = location;

        return location;
    } catch {
        return null;
    }
}

async function loadOfficialCameras() {
    const now = Date.now();

    if (
        now - state.lastCameraLoad <
        60000
    ) {
        return;
    }

    state.lastCameraLoad = now;

    showStatus(
        "CARGANDO CÁMARAS OFICIALES..."
    );

    try {
        const response =
            await fetch(
                CONFIG.camera.proxy +
                `?t=${Date.now()}`,
                {
                    cache: "no-store"
                }
            );

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const text =
            await response.text();

        const locations =
            extractCameraNames(
                text
            );

        if (!locations.length) {
            throw new Error(
                "No se encontraron ubicaciones"
            );
        }

        const cameras = [];

        const current =
            state.lastPosition ||
            {
                latitude:
                    CONFIG.map.center[0],
                longitude:
                    CONFIG.map.center[1]
            };

        const sorted =
            locations
                .slice()
                .sort(
                    (a, b) =>
                        scoreCamera(
                            a,
                            current
                        ) -
                        scoreCamera(
                            b,
                            current
                        )
                );

        for (
            const item of sorted
        ) {
            const location =
                await geocodeCamera(
                    item
                );

            if (!location) {
                continue;
            }

            cameras.push({
                id:
                    `camera-${btoa(
                        unescape(
                            encodeURIComponent(
                                item.name
                            )
                        )
                    ).replace(
                        /[^a-zA-Z0-9]/g,
                        ""
                    )}`,
                latitude:
                    location.latitude,
                longitude:
                    location.longitude,
                name:
                    item.name,
                zone:
                    item.zone,
                source:
                    CONFIG.camera.source
            });

            if (
                cameras.length >=
                160
            ) {
                break;
            }
        }

        state.cameras =
            deduplicate(
                cameras,
                30
            );

        state.cameraCount =
            state.cameras.length;

        renderCameras();

        showStatus(
            `${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
        );
    } catch (error) {
        console.warn(
            "[Cameras]",
            error
        );

        showStatus(
            "ERROR CARGANDO CÁMARAS"
        );
    }
}

function scoreCamera(
    item,
    position
) {
    const text =
        `${item.name} ${item.zone}`
            .toLowerCase();

    const central =
        [
            "centro",
            "cordón",
            "pocitos",
            "punta carretas",
            "buceo",
            "parque rodó",
            "tres cruces",
            "parque batlle",
            "malvín"
        ];

    return central.some(
        value =>
            text.includes(value)
    )
        ? 0
        : 1;
}

function renderCameras() {
    state.cameraLayer.clearLayers();

    for (
        const camera of state.cameras
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
            <div class="map-popup">
                <strong>CÁMARA DE TRÁNSITO</strong>
                <br>
                ${escapeHtml(camera.name)}
                <br>
                <small>
                    ${escapeHtml(
                        camera.zone || ""
                    )}
                </small>
                <br>
                <small>
                    FUENTE: INTENDENCIA DE MONTEVIDEO
                </small>
            </div>
        `);

        marker.addTo(
            state.cameraLayer
        );
    }
}

async function loadDeadEnds(
    latitude,
    longitude
) {
    const now = Date.now();

    if (
        now - state.lastDeadEndLoad <
        60000
    ) {
        return;
    }

    state.lastDeadEndLoad = now;

    const query = `
[out:json][timeout:30];
way["highway"]["noexit"="yes"](around:${CONFIG.deadEnd.radius},${latitude},${longitude});
out center tags;
`;

    try {
        const response =
            await fetch(
                CONFIG.overpass,
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

        const result = [];

        for (
            const element of
            data.elements || []
        ) {
            if (!element.center) {
                continue;
            }

            const lat =
                Number(
                    element.center.lat
                );

            const lon =
                Number(
                    element.center.lon
                );

            if (
                !Number.isFinite(lat) ||
                !Number.isFinite(lon)
            ) {
                continue;
            }

            const tags =
                element.tags || {};

            result.push({
                id:
                    `deadend-${element.id}`,
                latitude: lat,
                longitude: lon,
                name:
                    tags.name ||
                    "CALLE SIN SALIDA",
                highway:
                    tags.highway || null
            });
        }

        state.deadEnds =
            deduplicate(
                result,
                25
            );

        state.deadEndCount =
            state.deadEnds.length;

        renderDeadEnds();
    } catch (error) {
        console.warn(
            "[DeadEnds]",
            error
        );
    }
}

function renderDeadEnds() {
    state.deadEndLayer.clearLayers();

    for (
        const deadEnd of state.deadEnds
    ) {
        const marker =
            L.marker(
                [
                    deadEnd.latitude,
                    deadEnd.longitude
                ],
                {
                    icon:
                        createDeadEndIcon(),
                    zIndexOffset: 700
                }
            );

        marker.bindPopup(`
            <div class="map-popup">
                <strong>CALLE SIN SALIDA</strong>
                <br>
                ${escapeHtml(
                    deadEnd.name
                )}
            </div>
        `);

        marker.addTo(
            state.deadEndLayer
        );
    }
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function isAhead(
    latitude,
    longitude,
    targetLatitude,
    targetLongitude,
    heading
) {
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
        ) <= 55
    );
}

function findDirectionalTarget(
    latitude,
    longitude,
    heading,
    items,
    maxDistance
) {
    let best = null;

    for (
        const item of items
    ) {
        const distance =
            distanceMeters(
                latitude,
                longitude,
                item.latitude,
                item.longitude
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
                item.latitude,
                item.longitude,
                heading
            )
        ) {
            continue;
        }

        const bearing =
            bearingBetween(
                latitude,
                longitude,
                item.latitude,
                item.longitude
            );

        const angular =
            angleDifference(
                heading,
                bearing
            );

        const score =
            distance +
            angular * 5;

        if (
            !best ||
            score < best.score
        ) {
            best = {
                item,
                distance,
                bearing,
                score
            };
        }
    }

    return best;
}

function checkAlerts(
    latitude,
    longitude,
    heading
) {
    const radar =
        state.alerts.radar
            ? findDirectionalTarget(
                latitude,
                longitude,
                heading,
                state.radars,
                CONFIG.radar.warningDistance
            )
            : null;

    const camera =
        state.alerts.camera
            ? findDirectionalTarget(
                latitude,
                longitude,
                heading,
                state.cameras,
                CONFIG.camera.warningDistance
            )
            : null;

    const deadEnd =
        state.alerts.deadEnd
            ? findDirectionalTarget(
                latitude,
                longitude,
                heading,
                state.deadEnds,
                CONFIG.deadEnd.warningDistance
            )
            : null;

    if (radar) {
        processAlert(
            "radar",
            radar.item,
            radar.distance
        );
    } else {
        releaseAlerts(
            "radar",
            latitude,
            longitude
        );
    }

    if (camera) {
        processAlert(
            "camera",
            camera.item,
            camera.distance
        );
    } else {
        releaseAlerts(
            "camera",
            latitude,
            longitude
        );
    }

    if (deadEnd) {
        processAlert(
            "deadEnd",
            deadEnd.item,
            deadEnd.distance
        );
    } else {
        releaseAlerts(
            "deadEnd",
            latitude,
            longitude
        );
    }
}

function processAlert(
    type,
    item,
    distance
) {
    const id =
        String(item.id);

    const alerted =
        state.alerted[type];

    if (
        !alerted.has(id)
    ) {
        alerted.set(
            id,
            true
        );

        showWarning(
            type,
            item,
            distance
        );
    }
}

function releaseAlerts(
    type,
    latitude,
    longitude
) {
    const alerted =
        state.alerted[type];

    for (
        const id of alerted.keys()
    ) {
        const item =
            getAlertItem(
                type,
                id
            );

        if (!item) {
            alerted.delete(id);
            continue;
        }

        const distance =
            distanceMeters(
                latitude,
                longitude,
                item.latitude,
                item.longitude
            );

        if (
            distance >
            CONFIG.radar.warningDistance + 150
        ) {
            alerted.delete(id);
        }
    }
}

function getAlertItem(
    type,
    id
) {
    const source =
        type === "radar"
            ? state.radars
            : type === "camera"
                ? state.cameras
                : state.deadEnds;

    return source.find(
        item =>
            String(item.id) ===
            String(id)
    );
}

function showWarning(
    type,
    item,
    distance
) {
    const warning =
        byId("radarWarning");

    if (!warning) {
        return;
    }

    warning.dataset.type =
        type;

    setText(
        "radarWarningDistance",
        `${Math.max(
            1,
            Math.round(distance)
        )} M`
    );

    let text = "";

    if (type === "radar") {
        text =
            item.limit
                ? `RADAR · ${item.limit} KM/H`
                : "RADAR DE VELOCIDAD";
    }

    if (type === "camera") {
        text = "CÁMARA DE TRÁNSITO";
    }

    if (type === "deadEnd") {
        text = "CALLE SIN SALIDA";
    }

    setText(
        "radarWarningLimit",
        text
    );

    warning.classList.add(
        "active"
    );

    state.warning.type =
        type;

    state.warning.id =
        String(item.id);

    speakAlert(
        type,
        item,
        Math.round(distance)
    );

    setTimeout(
        () => {
            if (
                state.warning.id ===
                String(item.id)
            ) {
                warning.classList.remove(
                    "active"
                );
            }
        },
        5000
    );
}

function speakAlert(
    type,
    item,
    distance
) {
    if (
        !state.alerts.voice ||
        !("speechSynthesis" in window)
    ) {
        return;
    }

    const now =
        Date.now();

    if (
        now - state.lastSpeech <
        8000
    ) {
        return;
    }

    state.lastSpeech =
        now;

    let text = "";

    if (type === "radar") {
        text =
            item.limit
                ? `Atención. Radar a ${distance} metros. Límite ${item.limit} kilómetros por hora.`
                : `Atención. Radar a ${distance} metros.`;
    }

    if (type === "camera") {
        text =
            `Atención. Cámara de tránsito a ${distance} metros.`;
    }

    if (type === "deadEnd") {
        text =
            `Atención. Calle sin salida a ${distance} metros.`;
    }

    try {
        speechSynthesis.cancel();

        const utterance =
            new SpeechSynthesisUtterance(
                text
            );

        utterance.lang =
            "es-UY";

        utterance.rate =
            .96;

        utterance.pitch =
            .98;

        speechSynthesis.speak(
            utterance
        );
    } catch {}
}

function setVoice(enabled) {
    state.alerts.voice =
        Boolean(enabled);

    if (
        !state.alerts.voice &&
        "speechSynthesis" in window
    ) {
        speechSynthesis.cancel();
    }
}

function setAlert(type, enabled) {
    if (
        Object.prototype.hasOwnProperty.call(
            state.alerts,
            type
        )
    ) {
        state.alerts[type] =
            Boolean(enabled);

        state.alerted[type].clear();
    }
}

async function startSimulation() {
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
        getCurrentHeading();

    state.simulation.speed =
        CONFIG.simulation.speed;

    await requestOrientation();

    updateSimulationPosition();

    showStatus(
        "MODO PRUEBA · BRÚJULA ACTIVA"
    );
}

function stopSimulation() {
    state.simulation.active =
        false;

    state.simulation.latitude =
        null;

    state.simulation.longitude =
        null;

    state.simulation.heading =
        0;

    state.alerted.radar.clear();
    state.alerted.camera.clear();
    state.alerted.deadEnd.clear();

    hideWarning();

    updateUserMarkerFromCurrentPosition();

    if (state.lastPosition) {
        updateUserMarker(
            state.lastPosition.latitude,
            state.lastPosition.longitude
        );
    }

    setText(
        "gpsState",
        state.orientation.active
            ? "BRÚJULA ACTIVA"
            : "GPS ACTIVO"
    );

    showStatus(
        state.locationActive
            ? "GPS ACTIVO"
            : "GPS OFF"
    );

    updateOrientationUI();
}

function simulationStep() {
    if (
        !state.simulation.active
    ) {
        return;
    }

    const heading =
        getCurrentHeading();

    state.simulation.heading =
        heading;

    const next =
        destinationPoint(
            state.simulation.latitude,
            state.simulation.longitude,
            heading,
            CONFIG.simulation.stepMeters
        );

    state.simulation.latitude =
        next.latitude;

    state.simulation.longitude =
        next.longitude;

    updateSimulationPosition();
}

function updateSimulationPosition() {
    if (
        !state.simulation.active
    ) {
        return;
    }

    state.simulation.heading =
        getCurrentHeading();

    updateUserMarker(
        state.simulation.latitude,
        state.simulation.longitude
    );

    checkAlerts(
        state.simulation.latitude,
        state.simulation.longitude,
        state.simulation.heading
    );

    if (state.map) {
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

    updateOrientationUI();
}

function resetSimulation() {
    if (
        !state.simulation.active
    ) {
        return;
    }

    const position =
        state.lastPosition;

    if (position) {
        state.simulation.latitude =
            position.latitude;

        state.simulation.longitude =
            position.longitude;
    } else {
        const center =
            state.map.getCenter();

        state.simulation.latitude =
            center.lat;

        state.simulation.longitude =
            center.lng;
    }

    state.simulation.heading =
        getCurrentHeading();

    state.alerted.radar.clear();
    state.alerted.camera.clear();
    state.alerted.deadEnd.clear();

    hideWarning();

    updateSimulationPosition();
}

function hideWarning() {
    const warning =
        byId("radarWarning");

    if (warning) {
        warning.classList.remove(
            "active"
        );
    }

    state.warning.type = null;
    state.warning.id = null;
}

function startRefreshTimers() {
    if (state.radarTimer) {
        clearInterval(
            state.radarTimer
        );
    }

    if (state.cameraTimer) {
        clearInterval(
            state.cameraTimer
        );
    }

    if (state.deadEndTimer) {
        clearInterval(
            state.deadEndTimer
        );
    }

    state.radarTimer =
        setInterval(
            () => {
                const p =
                    state.simulation.active
                        ? state.simulation
                        : state.lastPosition;

                if (p) {
                    loadRadars(
                        p.latitude,
                        p.longitude
                    );
                }
            },
            CONFIG.radar.refresh
        );

    state.cameraTimer =
        setInterval(
            () => {
                loadOfficialCameras();
            },
            CONFIG.camera.refresh
        );

    state.deadEndTimer =
        setInterval(
            () => {
                const p =
                    state.simulation.active
                        ? state.simulation
                        : state.lastPosition;

                if (p) {
                    loadDeadEnds(
                        p.latitude,
                        p.longitude
                    );
                }
            },
            CONFIG.deadEnd.refresh
        );
}

async function initialize() {
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
        "INICIANDO RADAR MONTEVIDEO..."
    );

    requestLocation();

    await Promise.allSettled([
        loadRadars(
            CONFIG.map.center[0],
            CONFIG.map.center[1]
        ),
        loadOfficialCameras(),
        loadDeadEnds(
            CONFIG.map.center[0],
            CONFIG.map.center[1]
        )
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
}

window.TrafficMap = {
    get map() {
        return state.map;
    },

    get radars() {
        return state.radars;
    },

    get radarCount() {
        return state.radarCount;
    },

    get cameras() {
        return state.cameras;
    },

    get cameraCount() {
        return state.cameraCount;
    },

    get deadEnds() {
        return state.deadEnds;
    },

    get deadEndCount() {
        return state.deadEndCount;
    },

    get simulation() {
        return state.simulation;
    },

    get alerts() {
        return state.alerts;
    },

    get orientation() {
        return state.orientation;
    },

    requestLocation,
    requestOrientation,
    stopOrientation,

    startSimulation,
    stopSimulation,
    simulationStep,
    resetSimulation,

    setVoice,
    setAlert,

    updateUserMarker,
    distanceMeters,
    destinationPoint,
    checkAlerts,

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
        { once: true }
    );
} else {
    initialize();
}

})();

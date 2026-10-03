(() => {
    "use strict";

    const CONFIG = {
        map: {
            defaultCenter: [-34.9011, -56.1645],
            defaultZoom: 13,
            userZoom: 17,
            minZoom: 10,
            maxZoom: 19
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

        camera: {
            warningDistance: 300,
            directionAngle: 55,
            refreshInterval: 600000
        },

        deadEnd: {
            warningDistance: 180,
            directionAngle: 55,
            refreshInterval: 600000
        },

        simulation: {
            stepMeters: 20,
            defaultSpeed: 5
        },

        services: {
            overpass: "https://overpass-api.de/api/interpreter",
            cameraPage: "https://montevideo.gub.uy/tipo/area-tematica/movilidad/gestion-de-la-movilidad/camaras-de-monitoreo-del-transito"
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

        warningRadar: null,
        warningCamera: null,
        warningDeadEnd: null,

        radarRefreshTimer: null,
        cameraRefreshTimer: null,
        deadEndRefreshTimer: null,

        lastRadarQuery: null,
        lastCameraQuery: null,
        lastDeadEndQuery: null,

        speechEnabled: true,
        radarAlertEnabled: true,
        cameraAlertEnabled: true,
        deadEndAlertEnabled: true,

        announced: {
            radar: null,
            camera: null,
            deadEnd: null
        },

        orientation: {
            active: false,
            heading: null,
            permission: "unknown",
            listener: null
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

    function isAhead(
        latitude,
        longitude,
        targetLatitude,
        targetLongitude,
        heading,
        maxAngle = 55
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
            ) <= maxAngle
        );
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
            (
                Number(latitude2) -
                Number(latitude1)
            ) *
            Math.PI / 180;

        const deltaLng =
            (
                Number(longitude2) -
                Number(longitude1)
            ) *
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
            (
                Number(longitude2) -
                Number(longitude1)
            ) *
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
                <div style="
                    width:20px;
                    height:20px;
                    border-radius:50%;
                    background:#29d8ff;
                    border:3px solid #06151b;
                    box-shadow:
                        0 0 0 4px rgba(41,216,255,.22),
                        0 0 22px rgba(41,216,255,.95);
                "></div>
            `,

            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });
    }

    function createRadarIcon(limit) {
        const speed = Number(limit);

        const label =
            Number.isFinite(speed) && speed > 0
                ? speed
                : "RADAR";

        return L.divIcon({
            className: "traffic-radar-marker",

            html: `
                <div style="
                    width:42px;
                    height:42px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    border-radius:50%;
                    background:#240b0b;
                    border:3px solid #ff3838;
                    color:#ff6767;
                    font-family:Arial,sans-serif;
                    font-size:9px;
                    font-weight:900;
                    box-shadow:
                        0 0 10px rgba(255,56,56,.95),
                        0 0 28px rgba(255,56,56,.45);
                ">
                    ${label}
                </div>
            `,

            iconSize: [42, 42],
            iconAnchor: [21, 21]
        });
    }

    function createCameraIcon() {
        return L.divIcon({
            className: "traffic-camera-marker",

            html: `
                <div style="
                    width:38px;
                    height:38px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    border-radius:12px;
                    background:#3a2100;
                    border:3px solid #ff9d00;
                    color:#ffb52e;
                    font-size:19px;
                    box-shadow:
                        0 0 12px rgba(255,157,0,.9),
                        0 0 25px rgba(255,157,0,.4);
                ">●</div>
            `,

            iconSize: [38, 38],
            iconAnchor: [19, 19]
        });
    }

    function createDeadEndIcon() {
        return L.divIcon({
            className: "traffic-dead-end-marker",

            html: `
                <div style="
                    width:32px;
                    height:32px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    border-radius:50%;
                    background:#251d00;
                    border:3px solid #ffd000;
                    color:#ffd000;
                    font-family:Arial,sans-serif;
                    font-size:16px;
                    font-weight:900;
                    box-shadow:
                        0 0 10px rgba(255,208,0,.8);
                ">!</div>
            `,

            iconSize: [32, 32],
            iconAnchor: [16, 16]
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
                    center:
                        CONFIG.map.defaultCenter,
                    zoom:
                        CONFIG.map.defaultZoom,
                    minZoom:
                        CONFIG.map.minZoom,
                    maxZoom:
                        CONFIG.map.maxZoom,
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
                    "&copy; OpenStreetMap contributors"
            }
        ).addTo(state.map);

        state.radarLayer =
            L.layerGroup().addTo(state.map);

        state.cameraLayer =
            L.layerGroup().addTo(state.map);

        state.deadEndLayer =
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

                state.announced.radar = null;
                state.announced.camera = null;
                state.announced.deadEnd = null;

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
            Number(
                position.coords.heading
            );

        if (!Number.isFinite(heading)) {
            heading =
                state.orientation.heading ??
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

        checkAllAlerts(
            latitude,
            longitude,
            heading
        );

        showStatus(
            `GPS ACTIVO · ${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
        );
    }

    function handlePositionError(error) {
        state.locationActive = false;

        let message = "ERROR DE GPS";

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
                    [latitude, longitude],
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
            state.userMarker.setLatLng(
                [latitude, longitude]
            );
        }

        const accuracy =
            state.lastPosition?.accuracy ||
            10;

        if (!state.accuracyCircle) {
            state.accuracyCircle =
                L.circle(
                    [latitude, longitude],
                    {
                        radius: accuracy,
                        color: "#29d8ff",
                        weight: 1,
                        opacity: .35,
                        fillColor: "#29d8ff",
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

        return match
            ? Number(match[1])
            : null;
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
            } else if (element.center) {
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

            const limit =
                parseSpeedLimit(
                    tags.maxspeed ||
                    tags.maxspeed_forward ||
                    tags.maxspeed_backward
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

    async function loadRadars(
        latitude,
        longitude,
        force = false
    ) {
        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            return;
        }

        const now = Date.now();

        if (
            !force &&
            state.lastRadarQuery &&
            now - state.lastRadarQuery < 30000
        ) {
            return;
        }

        state.lastRadarQuery = now;

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
        } catch (error) {
            console.error(
                "[Radar]",
                error
            );

            showStatus(
                "ERROR CARGANDO RADARES"
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
                        font-family:Arial,sans-serif;
                        min-width:180px;
                        color:#111;
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
        longitude,
        heading
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
                distance >
                CONFIG.radar.warningDistance
            ) {
                continue;
            }

            if (
                !isAhead(
                    latitude,
                    longitude,
                    radar.latitude,
                    radar.longitude,
                    heading,
                    CONFIG.radar.directionAngle
                )
            ) {
                continue;
            }

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

    function getDeviceHeading(event) {
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
            360 - event.alpha
        );
    }

    function handleDeviceOrientation(event) {
        const heading =
            getDeviceHeading(event);

        if (heading === null) {
            return;
        }

        state.orientation.heading =
            heading;

        state.orientation.active =
            true;

        if (state.simulation.active) {
            state.simulation.heading =
                heading;

            updateOrientationUI();
            updateSimulationUI();
        }
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
                    await DeviceOrientationEvent.requestPermission();

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

            updateOrientationUI();

            return true;
        } catch (error) {
            console.error(
                "[Orientation]",
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

    function updateOrientationUI() {
        const heading =
            state.orientation.heading;

        if (heading === null) {
            return;
        }

        setText(
            "headingValue",
            `${Math.round(heading)}°`
        );
    }

    function speakOnce(
        type,
        id,
        text
    ) {
        if (!state.speechEnabled) {
            return;
        }

        if (
            state.announced[type] ===
            id
        ) {
            return;
        }

        state.announced[type] = id;

        if (
            !("speechSynthesis" in window)
        ) {
            return;
        }

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
        } catch (error) {
            console.warn(
                "[Speech]",
                error
            );
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

        warning.classList.add(
            "active"
        );

        if (
            state.radarAlertEnabled
        ) {
            speakOnce(
                "radar",
                String(radar.id),
                radar.limit
                    ? `Radar a ${rounded} metros. Límite ${radar.limit} kilómetros por hora.`
                    : `Radar a ${rounded} metros.`
            );
        }
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

        const distanceElement =
            byId("cameraWarningDistance");

        const rounded =
            Math.max(
                1,
                Math.round(distance)
            );

        if (distanceElement) {
            distanceElement.textContent =
                `${rounded} M`;
        }

        warning.classList.add(
            "active"
        );

        if (
            state.cameraAlertEnabled
        ) {
            speakOnce(
                "camera",
                String(camera.id),
                `Cámara de tránsito a ${rounded} metros.`
            );
        }
    }

    function showDeadEndWarning(
        deadEnd,
        distance
    ) {
        const warning =
            byId("deadEndWarning");

        if (!warning) {
            return;
        }

        const distanceElement =
            byId("deadEndWarningDistance");

        const rounded =
            Math.max(
                1,
                Math.round(distance)
            );

        if (distanceElement) {
            distanceElement.textContent =
                `${rounded} M`;
        }

        warning.classList.add(
            "active"
        );

        if (
            state.deadEndAlertEnabled
        ) {
            speakOnce(
                "deadEnd",
                String(deadEnd.id),
                `Atención. Calle sin salida en ${rounded} metros.`
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

    function hideCameraWarning() {
        const warning =
            byId("cameraWarning");

        if (warning) {
            warning.classList.remove(
                "active"
            );
        }

        state.warningCamera = null;
    }

    function hideDeadEndWarning() {
        const warning =
            byId("deadEndWarning");

        if (warning) {
            warning.classList.remove(
                "active"
            );
        }

        state.warningDeadEnd = null;
    }

    function findClosestCamera(
        latitude,
        longitude,
        heading
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
                distance >
                CONFIG.camera.warningDistance
            ) {
                continue;
            }

            if (
                !isAhead(
                    latitude,
                    longitude,
                    camera.latitude,
                    camera.longitude,
                    heading,
                    CONFIG.camera.directionAngle
                )
            ) {
                continue;
            }

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

    function findClosestDeadEnd(
        latitude,
        longitude,
        heading
    ) {
        let closest = null;

        for (const deadEnd of state.deadEnds) {
            const distance =
                distanceMeters(
                    latitude,
                    longitude,
                    deadEnd.latitude,
                    deadEnd.longitude
                );

            if (
                distance >
                CONFIG.deadEnd.warningDistance
            ) {
                continue;
            }

            if (
                !isAhead(
                    latitude,
                    longitude,
                    deadEnd.latitude,
                    deadEnd.longitude,
                    heading,
                    CONFIG.deadEnd.directionAngle
                )
            ) {
                continue;
            }

            if (
                !closest ||
                distance < closest.distance
            ) {
                closest = {
                    deadEnd,
                    distance
                };
            }
        }

        return closest;
    }

    function checkAllAlerts(
        latitude,
        longitude,
        heading
    ) {
        const radar =
            findClosestRadar(
                latitude,
                longitude,
                heading
            );

        if (radar) {
            state.warningRadar =
                radar.radar;

            showRadarWarning(
                radar.radar,
                radar.distance
            );
        } else {
            hideRadarWarning();

            state.announced.radar =
                null;
        }

        const camera =
            findClosestCamera(
                latitude,
                longitude,
                heading
            );

        if (camera) {
            state.warningCamera =
                camera.camera;

            showCameraWarning(
                camera.camera,
                camera.distance
            );
        } else {
            hideCameraWarning();

            state.announced.camera =
                null;
        }

        const deadEnd =
            findClosestDeadEnd(
                latitude,
                longitude,
                heading
            );

        if (deadEnd) {
            state.warningDeadEnd =
                deadEnd.deadEnd;

            showDeadEndWarning(
                deadEnd.deadEnd,
                deadEnd.distance
            );
        } else {
            hideDeadEndWarning();

            state.announced.deadEnd =
                null;
        }
    }

    function normalizeCameraData(items) {
        const result = [];

        for (
            const item of items
        ) {
            if (
                !item ||
                !Number.isFinite(
                    Number(item.latitude)
                ) ||
                !Number.isFinite(
                    Number(item.longitude)
                )
            ) {
                continue;
            }

            result.push({
                id:
                    String(
                        item.id ??
                        `${item.latitude}:${item.longitude}`
                    ),

                latitude:
                    Number(item.latitude),

                longitude:
                    Number(item.longitude),

                name:
                    item.name ||
                    "CÁMARA DE TRÁNSITO",

                source:
                    "Intendencia de Montevideo"
            });
        }

        return result;
    }

    function extractCoordinatesFromText(
        text
    ) {
        const results = [];
        const regex =
            /(-?\d{1,3}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)/g;

        let match;

        while (
            (match = regex.exec(text))
        ) {
            const latitude =
                Number(match[1]);

            const longitude =
                Number(match[2]);

            if (
                latitude >= -35.2 &&
                latitude <= -34.5 &&
                longitude >= -56.7 &&
                longitude <= -55.7
            ) {
                results.push({
                    latitude,
                    longitude
                });
            }
        }

        return results;
    }

    async function loadOfficialCameras(
        force = false
    ) {
        const now = Date.now();

        if (
            !force &&
            state.lastCameraQuery &&
            now - state.lastCameraQuery <
                60000
        ) {
            return;
        }

        state.lastCameraQuery = now;

        try {
            const response =
                await fetch(
                    CONFIG.services.cameraPage,
                    {
                        method: "GET",
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

            const coordinates =
                extractCoordinatesFromText(
                    text
                );

            if (
                coordinates.length
            ) {
                state.cameras =
                    normalizeCameraData(
                        coordinates.map(
                            (item, index) => ({
                                ...item,
                                id:
                                    `imm-${index + 1}`
                            })
                        )
                    );

                state.cameraCount =
                    state.cameras.length;

                renderCameras();
            }
        } catch (error) {
            console.warn(
                "[Cameras]",
                error
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
                        font-family:Arial,sans-serif;
                        min-width:180px;
                        color:#111;
                    ">
                        <strong>CÁMARA DE TRÁNSITO</strong>
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

    async function loadDeadEnds(
        latitude,
        longitude,
        force = false
    ) {
        const now = Date.now();

        if (
            !force &&
            state.lastDeadEndQuery &&
            now - state.lastDeadEndQuery <
                60000
        ) {
            return;
        }

        state.lastDeadEndQuery = now;

        const radius = 50000;

        const query = `
[out:json][timeout:30];
(
  node["noexit"="yes"](around:${radius},${latitude},${longitude});
  way["noexit"="yes"](around:${radius},${latitude},${longitude});
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
                    `Overpass HTTP ${response.status}`
                );
            }

            const data =
                await response.json();

            const result = [];

            for (
                const element of
                data?.elements || []
            ) {
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

                result.push({
                    id:
                        `dead-${element.type}-${element.id}`,

                    latitude,
                    longitude,

                    name:
                        element.tags?.name ||
                        "CALLE SIN SALIDA"
                });
            }

            state.deadEnds =
                deduplicateDeadEnds(
                    result
                );

            state.deadEndCount =
                state.deadEnds.length;

            renderDeadEnds();
        } catch (error) {
            console.warn(
                "[DeadEnd]",
                error
            );
        }
    }

    function deduplicateDeadEnds(
        items
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
                        ) < 30
                );

            if (!exists) {
                result.push(item);
            }
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
                    <div style="
                        font-family:Arial,sans-serif;
                        color:#111;
                    ">
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

    async function startSimulation() {
        await enableDeviceOrientation();

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
            `MODO PRUEBA · ${Math.round(heading)}°`
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

        hideRadarWarning();
        hideCameraWarning();
        hideDeadEndWarning();

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

        checkAllAlerts(
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

        const heading =
            state.orientation.heading ??
            state.simulation.heading ??
            0;

        state.simulation.heading =
            heading;

        updateOrientationUI();

        const radar =
            findClosestRadar(
                state.simulation.latitude,
                state.simulation.longitude,
                heading
            );

        const camera =
            findClosestCamera(
                state.simulation.latitude,
                state.simulation.longitude,
                heading
            );

        const deadEnd =
            findClosestDeadEnd(
                state.simulation.latitude,
                state.simulation.longitude,
                heading
            );

        state.simulation.radar =
            radar?.radar || null;

        state.simulation.camera =
            camera?.camera || null;

        state.simulation.deadEnd =
            deadEnd?.deadEnd || null;

        state.simulation.distance =
            radar?.distance ??
            camera?.distance ??
            deadEnd?.distance ??
            null;

        if (radar) {
            showRadarWarning(
                radar.radar,
                radar.distance
            );
        }

        if (camera) {
            showCameraWarning(
                camera.camera,
                camera.distance
            );
        }

        if (deadEnd) {
            showDeadEndWarning(
                deadEnd.deadEnd,
                deadEnd.distance
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

        hideRadarWarning();
        hideCameraWarning();
        hideDeadEndWarning();

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

        if (state.deadEndRefreshTimer) {
            clearInterval(
                state.deadEndRefreshTimer
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
                        position.longitude,
                        true
                    );
                },
                CONFIG.radar.refreshInterval
            );

        state.cameraRefreshTimer =
            setInterval(
                () => {
                    loadOfficialCameras(
                        true
                    );
                },
                CONFIG.camera.refreshInterval
            );

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
                        position.longitude,
                        true
                    );
                },
                CONFIG.deadEnd.refreshInterval
            );
    }

    function initialize() {
        if (state.initialized) {
            return;
        }

        state.initialized =
            true;

        if (!initializeMap()) {
            return;
        }

        showStatus(
            "RADAR ONLINE · OBTENIENDO GPS"
        );

        requestLocation();

        loadRadars(
            CONFIG.map.defaultCenter[0],
            CONFIG.map.defaultCenter[1],
            true
        );

        loadOfficialCameras(
            true
        );

        loadDeadEnds(
            CONFIG.map.defaultCenter[0],
            CONFIG.map.defaultCenter[1],
            true
        );

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

        get deadEnds() {
            return state.deadEnds;
        },

        get simulation() {
            return state.simulation;
        },

        get orientation() {
            return state.orientation;
        },

        requestLocation,
        enableDeviceOrientation,
        startSimulation,
        stopSimulation,
        simulationStep,
        resetSimulation,
        updateUserMarker,
        distanceMeters,
        destinationPoint,
        checkAllAlerts,
        updateSimulationUI,
        showStatus,

        setSpeechEnabled(value) {
            state.speechEnabled =
                Boolean(value);

            if (
                !state.speechEnabled &&
                "speechSynthesis" in window
            ) {
                window.speechSynthesis.cancel();
            }
        },

        setRadarAlertEnabled(value) {
            state.radarAlertEnabled =
                Boolean(value);
        },

        setCameraAlertEnabled(value) {
            state.cameraAlertEnabled =
                Boolean(value);
        },

        setDeadEndAlertEnabled(value) {
            state.deadEndAlertEnabled =
                Boolean(value);
        },

        reloadCameras() {
            return loadOfficialCameras(true);
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

            return loadRadars(
                position?.latitude ??
                    CONFIG.map.defaultCenter[0],

                position?.longitude ??
                    CONFIG.map.defaultCenter[1],

                true
            );
        },

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

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
            refreshInterval: 900000,
            geocodeDelay: 180,
            geocodeRadius: 100
        },

        simulation: {
            stepMeters: 20,
            defaultSpeed: 5
        },

        services: {
            overpass: "https://overpass-api.de/api/interpreter",
            nominatim: "https://nominatim.openstreetmap.org/search"
        },

        alerts: {
            voice: true,
            vibration: true,
            cooldown: 10000
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
        warningCamera: null,
        radarRefreshTimer: null,
        cameraRefreshTimer: null,
        lastRadarQuery: 0,
        lastSpeech: 0,
        lastVibration: 0,
        cameraLoading: false,
        radarLoading: false,
        geocodeCache: new Map(),
        voices: [],
        preferredVoice: null,

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

    function distanceMeters(latitude1, longitude1, latitude2, longitude2) {
        const R = 6371000;

        const lat1 = Number(latitude1) * Math.PI / 180;
        const lat2 = Number(latitude2) * Math.PI / 180;

        const deltaLat =
            (Number(latitude2) - Number(latitude1)) * Math.PI / 180;

        const deltaLng =
            (Number(longitude2) - Number(longitude1)) * Math.PI / 180;

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

    function destinationPoint(latitude, longitude, bearing, distance) {
        const R = 6371000;

        const lat1 =
            Number(latitude) * Math.PI / 180;

        const lon1 =
            Number(longitude) * Math.PI / 180;

        const theta =
            Number(bearing) * Math.PI / 180;

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
            latitude: lat2 * 180 / Math.PI,
            longitude: lon2 * 180 / Math.PI
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
            className: "keolel-camera-marker",
            html: `
                <div style="
                    width:34px;
                    height:34px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    border-radius:50%;
                    background:#241700;
                    border:2px solid #ff9800;
                    color:#ff9800;
                    font-size:17px;
                    box-shadow:
                        0 0 10px rgba(255,152,0,.85),
                        0 0 24px rgba(255,152,0,.35);
                ">●</div>
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

        state.map = L.map(
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
            safeNumber(position.coords.latitude);

        const longitude =
            safeNumber(position.coords.longitude);

        const accuracy =
            safeNumber(position.coords.accuracy, 0);

        const speed =
            safeNumber(position.coords.speed, 0);

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

        checkCameras(
            latitude,
            longitude
        );

        showStatus(
            `GPS ACTIVO · ${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
        );
    }

    function handlePositionError(error) {
        console.warn("[GPS]", error);

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

    async function loadRadars(latitude, longitude) {
        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            state.radarLoading
        ) {
            return;
        }

        const now = Date.now();

        if (
            state.lastRadarQuery &&
            now - state.lastRadarQuery < 30000
        ) {
            return;
        }

        state.lastRadarQuery = now;
        state.radarLoading = true;

        const query = `
[out:json][timeout:25];
node["highway"="speed_camera"](around:${CONFIG.radar.queryRadius},${latitude},${longitude});
out body;
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
                    `Overpass HTTP ${response.status}`
                );
            }

            const data =
                await response.json();

            const elements =
                Array.isArray(data?.elements)
                    ? data.elements
                    : [];

            state.radars =
                deduplicateRadars(
                    normalizeRadarData(elements)
                );

            state.radarCount =
                state.radars.length;

            renderRadars();

            showStatus(
                `RADARES ${state.radarCount} · CÁMARAS ${state.cameraCount}`
            );
        } catch (error) {
            console.error(
                "[Radar]",
                error
            );

            showStatus(
                `RADARES ${state.radarCount} · ERROR ACTUALIZANDO`
            );
        } finally {
            state.radarLoading = false;
        }
    }

    function normalizeRadarData(elements) {
        const result = [];

        for (const element of elements) {
            const latitude =
                Number(element.lat);

            const longitude =
                Number(element.lon);

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
                    tags.direction || null,

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
                        ) < 30
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
    }

    function findClosestRadar(latitude, longitude) {
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

    function checkRadars(latitude, longitude) {
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
            if (!state.warningRadar) {
                hideRadarWarning();
            }

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

    function findClosestCamera(latitude, longitude) {
        let closest = null;

        for (const camera of state.cameras) {
            if (
                !Number.isFinite(camera.latitude) ||
                !Number.isFinite(camera.longitude)
            ) {
                continue;
            }

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

    function checkCameras(latitude, longitude) {
        const closest =
            findClosestCamera(
                latitude,
                longitude
            );

        if (
            !closest ||
            closest.distance >
            CONFIG.radar.warningDistance
        ) {
            return null;
        }

        state.warningCamera =
            closest.camera;

        return closest;
    }

    function showRadarWarning(radar, distance) {
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
                    : "LÍMITE NO DISPONIBLE";
        }

        warning.classList.add("active");

        alertRadar(
            radar,
            rounded
        );
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

    function loadVoices() {
        if (!("speechSynthesis" in window)) {
            return;
        }

        state.voices =
            window.speechSynthesis.getVoices();

        const argentinian =
            state.voices.find(
                voice =>
                    String(voice.lang).toLowerCase() ===
                    "es-ar"
            );

        const spanishLatin =
            state.voices.find(
                voice =>
                    /^es-(mx|ar|us|419)$/i.test(
                        String(voice.lang)
                    )
            );

        const spanish =
            state.voices.find(
                voice =>
                    /^es/i.test(
                        String(voice.lang)
                    )
            );

        state.preferredVoice =
            argentinian ||
            spanishLatin ||
            spanish ||
            null;
    }

    function speak(text) {
        if (
            !CONFIG.alerts.voice ||
            !("speechSynthesis" in window)
        ) {
            return;
        }

        const now = Date.now();

        if (
            now - state.lastSpeech <
            CONFIG.alerts.cooldown
        ) {
            return;
        }

        state.lastSpeech = now;

        loadVoices();

        try {
            window.speechSynthesis.cancel();

            const utterance =
                new SpeechSynthesisUtterance(
                    text
                );

            utterance.lang =
                state.preferredVoice?.lang ||
                "es-AR";

            if (state.preferredVoice) {
                utterance.voice =
                    state.preferredVoice;
            }

            utterance.rate = .96;
            utterance.pitch = .98;
            utterance.volume = 1;

            window.speechSynthesis.speak(
                utterance
            );
        } catch (error) {
            console.warn(
                "[Voice]",
                error
            );
        }
    }

    function vibrate(pattern = [180, 80, 180]) {
        if (
            !CONFIG.alerts.vibration ||
            !("vibrate" in navigator)
        ) {
            return false;
        }

        const now = Date.now();

        if (
            now - state.lastVibration <
            CONFIG.alerts.cooldown
        ) {
            return false;
        }

        state.lastVibration = now;

        try {
            return navigator.vibrate(pattern);
        } catch (error) {
            console.warn(
                "[Vibration]",
                error
            );

            return false;
        }
    }

    function alertRadar(radar, distance) {
        const limitText =
            radar.limit
                ? `Límite ${radar.limit} kilómetros por hora.`
                : "";

        speak(
            `Atención. Radar a ${distance} metros. ${limitText}`
        );

        vibrate();
    }

    function setVoiceEnabled(enabled) {
        CONFIG.alerts.voice =
            Boolean(enabled);

        if (!CONFIG.alerts.voice) {
            if ("speechSynthesis" in window) {
                window.speechSynthesis.cancel();
            }
        }

        updateSettingsUI();
    }

    function setVibrationEnabled(enabled) {
        CONFIG.alerts.vibration =
            Boolean(enabled);

        if (!CONFIG.alerts.vibration) {
            try {
                navigator.vibrate?.(0);
            } catch (_) {}
        }

        updateSettingsUI();
    }

    function updateSettingsUI() {
        const voiceButton =
            byId("voiceButton");

        const vibrationButton =
            byId("vibrationButton");

        if (voiceButton) {
            voiceButton.classList.toggle(
                "active",
                CONFIG.alerts.voice
            );

            voiceButton.textContent =
                CONFIG.alerts.voice
                    ? "VOZ ON"
                    : "VOZ OFF";
        }

        if (vibrationButton) {
            vibrationButton.classList.toggle(
                "active",
                CONFIG.alerts.vibration
            );

            vibrationButton.textContent =
                CONFIG.alerts.vibration
                    ? "VIB ON"
                    : "VIB OFF";
        }
    }

    function normalizeCameraText(value) {
        return String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .replace(
                /^[-–—•·*]\s*/,
                ""
            )
            .trim();
    }

    function extractCameraLocations(html) {
        const parser =
            new DOMParser();

        const document =
            parser.parseFromString(
                html,
                "text/html"
            );

        const heading =
            Array.from(
                document.querySelectorAll(
                    "h1"
                )
            ).find(
                element =>
                    /cámaras de monitoreo/i.test(
                        element.textContent
                    )
            );

        if (!heading) {
            return [];
        }

        const locations = [];

        let current =
            heading.nextElementSibling;

        while (current) {
            if (
                current.matches &&
                current.matches("h2")
            ) {
                break;
            }

            if (
                current.matches &&
                current.matches("ul, ol")
            ) {
                const items =
                    Array.from(
                        current.querySelectorAll(
                            ":scope > li"
                        )
                    );

                for (const item of items) {
                    const text =
                        normalizeCameraText(
                            item.textContent
                        );

                    if (
                        text &&
                        /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(
                            text
                        )
                    ) {
                        locations.push(text);
                    }
                }
            }

            if (
                current.matches &&
                current.matches("p")
            ) {
                const text =
                    normalizeCameraText(
                        current.textContent
                    );

                if (
                    / y /.test(text) &&
                    !/Se trata de/.test(text)
                ) {
                    locations.push(text);
                }
            }

            current =
                current.nextElementSibling;
        }

        return Array.from(
            new Set(locations)
        );
    }

    async function geocodeCamera(location) {
        if (
            state.geocodeCache.has(location)
        ) {
            return state.geocodeCache.get(
                location
            );
        }

        const query =
            `${location}, Montevideo, Uruguay`;

        try {
            const url =
                new URL(
                    CONFIG.services.nominatim
                );

            url.searchParams.set(
                "format",
                "jsonv2"
            );

            url.searchParams.set(
                "q",
                query
            );

            url.searchParams.set(
                "limit",
                "1"
            );

            url.searchParams.set(
                "countrycodes",
                "uy"
            );

            const response =
                await fetch(
                    url.toString(),
                    {
                        headers: {
                            "Accept":
                                "application/json"
                        }
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `Nominatim HTTP ${response.status}`
                );
            }

            const data =
                await response.json();

            const item =
                Array.isArray(data)
                    ? data[0]
                    : null;

            if (!item) {
                state.geocodeCache.set(
                    location,
                    null
                );

                return null;
            }

            const result = {
                latitude:
                    Number(item.lat),

                longitude:
                    Number(item.lon),

                location
            };

            state.geocodeCache.set(
                location,
                result
            );

            return result;
        } catch (error) {
            console.warn(
                "[Camera geocode]",
                location,
                error
            );

            return null;
        }
    }

    async function loadOfficialCameras() {
        if (state.cameraLoading) {
            return;
        }

        state.cameraLoading = true;

        try {
            showStatus(
                `ACTUALIZANDO CÁMARAS · ${state.cameraCount} CARGADAS`
            );

            const cacheBust =
                `?_=${Date.now()}`;

            const response =
                await fetch(
                    CONFIG.cameras.sourceUrl +
                    cacheBust,
                    {
                        method: "GET",
                        cache: "no-store"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `Montevideo HTTP ${response.status}`
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
                    "NO SE ENCONTRARON LOCACIONES"
                );
            }

            const oldCameras =
                new Map(
                    state.cameras.map(
                        camera => [
                            camera.location,
                            camera
                        ]
                    )
                );

            const cameras = [];

            for (
                let index = 0;
                index < locations.length;
                index++
            ) {
                const location =
                    locations[index];

                const cached =
                    oldCameras.get(
                        location
                    );

                if (cached) {
                    cameras.push(cached);
                    continue;
                }

                const geocoded =
                    await geocodeCamera(
                        location
                    );

                if (geocoded) {
                    cameras.push({
                        id:
                            `official-${index}-${location}`,
                        latitude:
                            geocoded.latitude,
                        longitude:
                            geocoded.longitude,
                        location,
                        source:
                            "Intendencia de Montevideo"
                    });
                }

                await sleep(
                    CONFIG.cameras.geocodeDelay
                );
            }

            state.cameras =
                deduplicateCameras(
                    cameras
                );

            state.cameraCount =
                state.cameras.length;

            renderOfficialCameras();

            showStatus(
                `GPS ${state.locationActive ? "ACTIVO" : "OFF"} · ${state.radarCount} RADARES · ${state.cameraCount} CÁMARAS`
            );
        } catch (error) {
            console.error(
                "[Official cameras]",
                error
            );

            showStatus(
                `RADARES ${state.radarCount} · CÁMARAS ${state.cameraCount}`
            );
        } finally {
            state.cameraLoading = false;
        }
    }

    function sleep(milliseconds) {
        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    milliseconds
                )
        );
    }

    function deduplicateCameras(cameras) {
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
                        ) < 35
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

        for (const camera of state.cameras) {
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
                    color:#111;
                    min-width:210px;
                ">
                    <strong style="color:#d97900">
                        CÁMARA DE MONITOREO
                    </strong>
                    <br><br>
                    ${escapeHtml(camera.location)}
                    <br><br>
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

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
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

        checkCameras(
            simulation.latitude,
            simulation.longitude
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

    function startRadarRefresh() {
        if (state.radarRefreshTimer) {
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
        if (state.cameraRefreshTimer) {
            clearInterval(
                state.cameraRefreshTimer
            );
        }

        state.cameraRefreshTimer =
            setInterval(
                () => {
                    loadOfficialCameras();
                },
                CONFIG.cameras.refreshInterval
            );
    }

    function initialize() {
        if (state.initialized) {
            return;
        }

        state.initialized = true;

        if (!initializeMap()) {
            return;
        }

        loadVoices();

        if ("speechSynthesis" in window) {
            window.speechSynthesis.onvoiceschanged =
                loadVoices;
        }

        updateSettingsUI();

        showStatus(
            "RADAR ONLINE · CARGANDO DATOS"
        );

        requestLocation();

        loadRadars(
            CONFIG.map.defaultCenter[0],
            CONFIG.map.defaultCenter[1]
        );

        loadOfficialCameras();

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

        get alerts() {
            return {
                voice:
                    CONFIG.alerts.voice,
                vibration:
                    CONFIG.alerts.vibration
            };
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

        checkCameras,

        updateSimulationUI,

        showStatus,

        setVoiceEnabled,

        setVibrationEnabled,

        loadRadars,

        loadOfficialCameras,

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

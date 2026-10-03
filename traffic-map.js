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
            refreshInterval: 900000,
            officialPage: "https://montevideo.gub.uy/tipo/area-tematica/movilidad/gestion-de-la-movilidad/camaras-de-monitoreo-del-transito",
            myMapsId: "15AKVoOmHrsx38Hk3SIvgWtAaLvGMeoYv",
            kmlUrls: [
                "https://www.google.com/maps/d/kml?mid=15AKVoOmHrsx38Hk3SIvgWtAaLvGMeoYv&forcekml=1",
                "https://www.google.com/maps/d/kml?mid=15AKVoOmHrsx38Hk3SIvgWtAaLvGMeoYv&forcekml=1&hl=es"
            ],
            geocoder: "https://nominatim.openstreetmap.org/search"
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
        lastCameraQuery: 0,
        lastSpeech: 0,
        cameraGeocodeQueue: [],
        cameraGeocoding: false,
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
        const deltaLat = (Number(latitude2) - Number(latitude1)) * Math.PI / 180;
        const deltaLng = (Number(longitude2) - Number(longitude1)) * Math.PI / 180;

        const a =
            Math.sin(deltaLat / 2) ** 2 +
            Math.cos(lat1) *
            Math.cos(lat2) *
            Math.sin(deltaLng / 2) ** 2;

        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function destinationPoint(latitude, longitude, bearing, distance) {
        const R = 6371000;
        const lat1 = Number(latitude) * Math.PI / 180;
        const lon1 = Number(longitude) * Math.PI / 180;
        const theta = Number(bearing) * Math.PI / 180;
        const delta = Number(distance) / R;

        const lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(delta) +
            Math.cos(lat1) * Math.sin(delta) * Math.cos(theta)
        );

        const lon2 =
            lon1 +
            Math.atan2(
                Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
                Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2)
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
                    box-shadow:0 0 0 3px rgba(54,200,216,.25),0 0 22px rgba(54,200,216,.9);
                "></div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
    }

    function createRadarIcon(limit) {
        const speed = Number(limit);
        const label = Number.isFinite(speed) && speed > 0 ? speed : "—";

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
                    box-shadow:0 0 12px rgba(255,49,49,.8),0 0 28px rgba(255,49,49,.35);
                ">${label}</div>
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
                    width:34px;
                    height:34px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    border-radius:50%;
                    background:#ff8c00;
                    border:3px solid #fff;
                    color:#111;
                    font-size:17px;
                    box-shadow:0 0 10px rgba(255,140,0,.9),0 0 24px rgba(255,140,0,.5);
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

        state.map = L.map(mapElement, {
            center: CONFIG.map.defaultCenter,
            zoom: CONFIG.map.defaultZoom,
            zoomControl: true,
            attributionControl: true,
            preferCanvas: true
        });

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,
                attribution: "&copy; OpenStreetMap contributors",
                crossOrigin: true
            }
        ).addTo(state.map);

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

        showStatus("OBTENIENDO UBICACIÓN...");

        navigator.geolocation.getCurrentPosition(
            handlePosition,
            handlePositionError,
            CONFIG.gps
        );

        startLocationWatch();
    }

    function startLocationWatch() {
        if (state.locationWatchId !== null || !navigator.geolocation) {
            return;
        }

        state.locationWatchId = navigator.geolocation.watchPosition(
            handlePosition,
            handlePositionError,
            CONFIG.gps
        );
    }

    function handlePosition(position) {
        if (!position?.coords) {
            return;
        }

        const latitude = safeNumber(position.coords.latitude);
        const longitude = safeNumber(position.coords.longitude);
        const accuracy = safeNumber(position.coords.accuracy, 0);
        const speed = safeNumber(position.coords.speed, 0);

        let heading = Number(position.coords.heading);

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

        updateUserMarker(latitude, longitude);

        if (!state.simulation.active) {
            const currentZoom = state.map?.getZoom();

            if (
                state.map &&
                (!state.userMarker || currentZoom < 14)
            ) {
                state.map.setView(
                    [latitude, longitude],
                    CONFIG.map.userZoom,
                    { animate: true }
                );
            }
        }

        checkRadars(latitude, longitude);

        showStatus(
            `GPS ACTIVO · ${state.cameraCount} CÁMARAS · ${state.radarCount} RADARES`
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

    function updateUserMarker(latitude, longitude) {
        if (!state.map) {
            return;
        }

        if (!state.userMarker) {
            state.userMarker = L.marker(
                [latitude, longitude],
                {
                    icon: createUserIcon(),
                    zIndexOffset: 1000
                }
            )
                .addTo(state.map)
                .bindTooltip("TU POSICIÓN", {
                    direction: "top"
                });
        } else {
            state.userMarker.setLatLng([latitude, longitude]);
        }

        const radius = state.lastPosition?.accuracy || 10;

        if (!state.accuracyCircle) {
            state.accuracyCircle = L.circle(
                [latitude, longitude],
                {
                    radius,
                    color: "#36c8d8",
                    weight: 1,
                    opacity: .35,
                    fillColor: "#36c8d8",
                    fillOpacity: .05,
                    interactive: false
                }
            ).addTo(state.map);
        } else {
            state.accuracyCircle.setLatLng([latitude, longitude]);
            state.accuracyCircle.setRadius(radius);
        }
    }

    function parseSpeedLimit(value) {
        if (value === null || value === undefined) {
            return null;
        }

        const match = String(value).match(/(\d+(?:\.\d+)?)/);

        return match ? Number(match[1]) : null;
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

            result.push({
                id: String(element.id ?? `${latitude}:${longitude}`),
                latitude,
                longitude,
                limit: parseSpeedLimit(
                    tags.maxspeed ||
                    tags.maxspeed_forward ||
                    tags.maxspeed_backward ||
                    null
                ),
                direction: tags.direction || null,
                name: tags.name || "RADAR DE VELOCIDAD",
                source: "OpenStreetMap"
            });
        }

        return result;
    }

    function deduplicateRadars(radars) {
        const unique = [];

        for (const radar of radars) {
            const exists = unique.some(
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

    async function loadRadars(latitude, longitude) {
        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
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

        const radius = CONFIG.radar.queryRadius;

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
            const response = await fetch(
                CONFIG.services.overpass,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: "data=" + encodeURIComponent(query)
                }
            );

            if (!response.ok) {
                throw new Error(`Overpass HTTP ${response.status}`);
            }

            const data = await response.json();

            state.radars = deduplicateRadars(
                normalizeRadarData(data?.elements || [])
            );

            state.radarCount = state.radars.length;

            renderRadars();

            updateStatusCounts();
        } catch (error) {
            console.error(error);
            setText(
                "status",
                `CÁMARAS ${state.cameraCount} · RADARES ${state.radarCount}`
            );
        }
    }

    function renderRadars() {
        if (!state.radarLayer) {
            return;
        }

        state.radarLayer.clearLayers();

        state.radars.forEach(radar => {
            const marker = L.marker(
                [radar.latitude, radar.longitude],
                {
                    icon: createRadarIcon(radar.limit)
                }
            );

            const limitText = radar.limit
                ? `${radar.limit} KM/H`
                : "LÍMITE NO DISPONIBLE";

            marker.bindPopup(`
                <div style="font-family:monospace;color:#111;min-width:180px">
                    <strong>RADAR DE VELOCIDAD</strong><br>
                    LÍMITE: ${limitText}<br>
                    FUENTE: OPENSTREETMAP
                </div>
            `);

            marker.addTo(state.radarLayer);
        });
    }

    function extractKmlCoordinates(text) {
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, "application/xml");

        if (xml.querySelector("parsererror")) {
            return [];
        }

        const result = [];

        xml.querySelectorAll("Placemark").forEach((placemark, index) => {
            const name =
                placemark.querySelector("name")?.textContent?.trim() ||
                `CÁMARA ${index + 1}`;

            const description =
                placemark.querySelector("description")?.textContent?.trim() ||
                "";

            const coordinates =
                placemark.querySelector("coordinates")?.textContent?.trim();

            if (!coordinates) {
                return;
            }

            const points = coordinates
                .split(/\s+/)
                .map(item => item.trim())
                .filter(Boolean);

            for (const point of points) {
                const parts = point.split(",");

                const longitude = Number(parts[0]);
                const latitude = Number(parts[1]);

                if (
                    Number.isFinite(latitude) &&
                    Number.isFinite(longitude)
                ) {
                    result.push({
                        id: `official-${result.length + 1}`,
                        latitude,
                        longitude,
                        name,
                        description,
                        source: "Intendencia de Montevideo"
                    });
                }
            }
        });

        return result;
    }

    async function fetchOfficialKml() {
        for (const url of CONFIG.cameras.kmlUrls) {
            try {
                const response = await fetch(
                    url,
                    {
                        method: "GET",
                        mode: "cors",
                        cache: "no-store"
                    }
                );

                if (!response.ok) {
                    continue;
                }

                const text = await response.text();

                if (!text || text.length < 100) {
                    continue;
                }

                const cameras = extractKmlCoordinates(text);

                if (cameras.length) {
                    return cameras;
                }
            } catch (error) {
                console.warn("KML oficial no accesible:", error);
            }
        }

        return [];
    }

    function cleanLocationName(value) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .replace(/\u00a0/g, " ")
            .replace(/\.$/, "")
            .trim();
    }

    function extractOfficialLocationsFromHtml(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const main = doc.body;

        if (!main) {
            return [];
        }

        const result = [];
        const headings = [
            "Centro y Cordón",
            "Aguada",
            "Parque Rodó",
            "Pocitos y Punta Carretas",
            "Buceo y Puerto del Buceo",
            "Tres Cruces",
            "Parque Batlle",
            "Malvín y Malvín Norte",
            "Carrasco, Punta Gorda y Carrasco Norte",
            "Cerro y La Teja",
            "Manga",
            "Accesos",
            "Colón y Sayago",
            "Paso Molino y Belvedere",
            "Jacinto Vera y Figurita",
            "La Blanqueada",
            "Mercado Modelo",
            "Flor de Maroñas y Unión",
            "Cerrito",
            "Prado y Atahualpa"
        ];

        const elements = Array.from(main.querySelectorAll("h2,h3,h4,li"));
        let activeSection = "";

        for (const element of elements) {
            const text = cleanLocationName(element.textContent);

            if (!text) {
                continue;
            }

            if (headings.includes(text)) {
                activeSection = text;
                continue;
            }

            if (
                element.tagName.toLowerCase() === "li" &&
                activeSection &&
                text.includes(" y ") &&
                text.length < 150
            ) {
                result.push({
                    name: text,
                    section: activeSection
                });
            }
        }

        return result;
    }

    async function fetchOfficialLocationNames() {
        try {
            const response = await fetch(
                CONFIG.cameras.officialPage,
                {
                    method: "GET",
                    mode: "cors",
                    cache: "no-store"
                }
            );

            if (!response.ok) {
                return [];
            }

            const html = await response.text();

            return extractOfficialLocationsFromHtml(html);
        } catch (error) {
            console.warn("Página oficial no accesible:", error);
            return [];
        }
    }

    async function geocodeOfficialLocations(locations) {
        const result = [];

        for (const location of locations) {
            const query =
                `${location.name}, Montevideo, Uruguay`;

            try {
                const url =
                    `${CONFIG.cameras.geocoder}?format=jsonv2&limit=1&countrycodes=uy&q=${encodeURIComponent(query)}`;

                const response = await fetch(
                    url,
                    {
                        headers: {
                            Accept: "application/json"
                        }
                    }
                );

                if (!response.ok) {
                    await new Promise(resolve => setTimeout(resolve, 1100));
                    continue;
                }

                const data = await response.json();

                if (Array.isArray(data) && data.length) {
                    const latitude = Number(data[0].lat);
                    const longitude = Number(data[0].lon);

                    if (
                        Number.isFinite(latitude) &&
                        Number.isFinite(longitude)
                    ) {
                        result.push({
                            id: `official-${result.length + 1}`,
                            latitude,
                            longitude,
                            name: location.name,
                            section: location.section,
                            source: "Intendencia de Montevideo"
                        });
                    }
                }
            } catch (error) {
                console.warn("Error geocodificando:", location.name);
            }

            await new Promise(resolve => setTimeout(resolve, 1100));
        }

        return result;
    }

    function deduplicateCameras(cameras) {
        const unique = [];

        for (const camera of cameras) {
            const exists = unique.some(
                item =>
                    distanceMeters(
                        item.latitude,
                        item.longitude,
                        camera.latitude,
                        camera.longitude
                    ) < 25
            );

            if (!exists) {
                unique.push(camera);
            }
        }

        return unique;
    }

    function renderCameras() {
        if (!state.cameraLayer) {
            return;
        }

        state.cameraLayer.clearLayers();

        state.cameras.forEach(camera => {
            const marker = L.marker(
                [camera.latitude, camera.longitude],
                {
                    icon: createCameraIcon(),
                    zIndexOffset: 500
                }
            );

            marker.bindPopup(`
                <div style="font-family:monospace;color:#111;min-width:200px">
                    <strong style="color:#e87500">CÁMARA DE MONITOREO</strong><br>
                    ${escapeHtml(camera.name || "UBICACIÓN OFICIAL")}<br>
                    ${camera.section ? `${escapeHtml(camera.section)}<br>` : ""}
                    FUENTE: INTENDENCIA DE MONTEVIDEO
                </div>
            `);

            marker.addTo(state.cameraLayer);
        });
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    async function loadOfficialCameras() {
        const now = Date.now();

        if (
            state.lastCameraQuery &&
            now - state.lastCameraQuery < 30000
        ) {
            return;
        }

        state.lastCameraQuery = now;

        showStatus("CARGANDO CÁMARAS OFICIALES...");

        let cameras = await fetchOfficialKml();

        if (!cameras.length) {
            const locations = await fetchOfficialLocationNames();

            if (locations.length) {
                cameras = await geocodeOfficialLocations(locations);
            }
        }

        if (cameras.length) {
            state.cameras = deduplicateCameras(cameras);
            state.cameraCount = state.cameras.length;
            renderCameras();
            updateStatusCounts();
            return;
        }

        state.cameraCount = state.cameras.length;

        showStatus(
            `CÁMARAS ${state.cameraCount} · RADARES ${state.radarCount}`
        );
    }

    function updateStatusCounts() {
        showStatus(
            `CÁMARAS ${state.cameraCount} · RADARES ${state.radarCount}`
        );
    }

    function findClosestRadar(latitude, longitude) {
        let closest = null;

        for (const radar of state.radars) {
            const distance = distanceMeters(
                latitude,
                longitude,
                radar.latitude,
                radar.longitude
            );

            if (!closest || distance < closest.distance) {
                closest = {
                    radar,
                    distance
                };
            }
        }

        return closest;
    }

    function checkRadars(latitude, longitude) {
        const closest = findClosestRadar(latitude, longitude);

        if (
            !closest ||
            closest.distance > CONFIG.radar.warningDistance
        ) {
            hideRadarWarning();
            return null;
        }

        state.warningRadar = closest.radar;

        showRadarWarning(
            closest.radar,
            closest.distance
        );

        return closest;
    }

    function showRadarWarning(radar, distance) {
        const warning = byId("radarWarning");

        if (!warning) {
            return;
        }

        const distanceElement = byId("radarWarningDistance");
        const limitElement = byId("radarWarningLimit");

        const rounded = Math.max(1, Math.round(distance));

        if (distanceElement) {
            distanceElement.textContent = `${rounded} M`;
        }

        if (limitElement) {
            limitElement.textContent =
                radar.limit
                    ? `LÍMITE ${radar.limit} KM/H`
                    : "RADAR";
        }

        warning.classList.add("active");

        speakRadarWarning(radar, rounded);
    }

    function speakRadarWarning(radar, distance) {
        if (!("speechSynthesis" in window)) {
            return;
        }

        const now = Date.now();

        if (now - state.lastSpeech < 10000) {
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
                new SpeechSynthesisUtterance(text);

            utterance.lang = "es-ES";
            utterance.rate = 1;
            utterance.pitch = 1;

            window.speechSynthesis.speak(utterance);
        } catch (error) {
            console.warn(error);
        }
    }

    function hideRadarWarning() {
        const warning = byId("radarWarning");

        if (warning) {
            warning.classList.remove("active");
        }

        state.warningRadar = null;
    }

    function startSimulation() {
        let latitude = state.lastPosition?.latitude;
        let longitude = state.lastPosition?.longitude;

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            const center = state.map
                ? state.map.getCenter()
                : {
                    lat: CONFIG.map.defaultCenter[0],
                    lng: CONFIG.map.defaultCenter[1]
                };

            latitude = center.lat;
            longitude = center.lng;
        }

        state.simulation.active = true;
        state.simulation.latitude = latitude;
        state.simulation.longitude = longitude;
        state.simulation.heading =
            Number(state.lastPosition?.heading) || 0;
        state.simulation.speed = CONFIG.simulation.defaultSpeed;
        state.simulation.radar = null;
        state.simulation.distance = null;

        updateUserMarker(latitude, longitude);

        if (state.map) {
            state.map.setView(
                [latitude, longitude],
                CONFIG.map.userZoom,
                { animate: true }
            );
        }

        showStatus("MODO PRUEBA ACTIVO");
        updateSimulationUI();

        return true;
    }

    function stopSimulation() {
        state.simulation.active = false;
        state.simulation.radar = null;
        state.simulation.distance = null;

        hideRadarWarning();
        updateStatusCounts();

        return true;
    }

    function simulationStep() {
        if (!state.simulation.active) {
            return;
        }

        const simulation = state.simulation;

        const next = destinationPoint(
            simulation.latitude,
            simulation.longitude,
            simulation.heading,
            CONFIG.simulation.stepMeters
        );

        simulation.latitude = next.latitude;
        simulation.longitude = next.longitude;

        updateSimulationPosition();
    }

    function updateSimulationPosition() {
        if (!state.simulation.active) {
            return;
        }

        const simulation = state.simulation;

        updateUserMarker(
            simulation.latitude,
            simulation.longitude
        );

        checkRadars(
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

        const result = findClosestRadar(
            state.simulation.latitude,
            state.simulation.longitude
        );

        state.simulation.radar =
            result?.radar || null;

        state.simulation.distance =
            result?.distance ?? null;

        if (
            result &&
            result.distance <= CONFIG.radar.warningDistance
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

        let latitude = state.lastPosition?.latitude;
        let longitude = state.lastPosition?.longitude;

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            const center = state.map.getCenter();
            latitude = center.lat;
            longitude = center.lng;
        }

        state.simulation.latitude = latitude;
        state.simulation.longitude = longitude;
        state.simulation.heading =
            Number(state.lastPosition?.heading) || 0;
        state.simulation.radar = null;
        state.simulation.distance = null;

        hideRadarWarning();

        updateUserMarker(latitude, longitude);

        state.map.setView(
            [latitude, longitude],
            CONFIG.map.userZoom,
            { animate: true }
        );

        showStatus("MODO PRUEBA REINICIADO");
    }

    function startRadarRefresh() {
        if (state.radarRefreshTimer) {
            clearInterval(state.radarRefreshTimer);
        }

        state.radarRefreshTimer = setInterval(() => {
            const position = state.simulation.active
                ? {
                    latitude: state.simulation.latitude,
                    longitude: state.simulation.longitude
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
        if (state.cameraRefreshTimer) {
            clearInterval(state.cameraRefreshTimer);
        }

        state.cameraRefreshTimer = setInterval(
            loadOfficialCameras,
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

        showStatus("CARGANDO FUENTES OFICIALES...");

        requestLocation();

        await Promise.allSettled([
            loadOfficialCameras(),
            loadRadars(
                CONFIG.map.defaultCenter[0],
                CONFIG.map.defaultCenter[1]
            )
        ]);

        startRadarRefresh();
        startCameraRefresh();

        setTimeout(() => {
            state.map?.invalidateSize();
        }, 300);

        setTimeout(() => {
            state.map?.invalidateSize();
        }, 1000);

        updateStatusCounts();
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
        showStatus,
        loadOfficialCameras,
        loadRadars,
        invalidateSize() {
            state.map?.invalidateSize();
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            { once: true }
        );
    } else {
        initialize();
    }
})();

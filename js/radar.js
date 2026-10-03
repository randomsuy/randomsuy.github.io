class TrafficMap {
    static map = null;
    static userMarker = null;
    static accuracyCircle = null;

    static radarMarkers = [];
    static radars = [];
    static allRadars = [];

    static watchId = null;
    static lastPosition = null;
    static previousPosition = null;

    static warnedRadars = new Set();

    static initialized = false;
    static locationRequestInProgress = false;
    static radarLoadInProgress = false;

    static loadedRadarZones = [];
    static lastRadarZoneLoadPosition = null;

    static radarLoadRadius = 2000;
    static radarDisplayRadius = 800;
    static warningDistance = 300;
    static reloadDistance = 800;
    static roadMatchDistance = 35;
    static routeRadarMatchDistance = 45;

    static radarDataUrl =
        "https://ckan-data.montevideo.gub.uy/dataset/159475cc-6584-48d3-961c-b6fa71e14cba/resource/4a80508d-5dde-483e-b88b-53d9d5d05382/download/ubicacion_de_radares_setiembre_2026.csv";

    static overpassUrls = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.private.coffee/api/interpreter"
    ];

    static nominatimUrl =
        "https://nominatim.openstreetmap.org/search";

    static osrmUrl =
        "https://router.project-osrm.org/route/v1/driving";

    static route = null;
    static routeLayer = null;
    static routeDestinationMarker = null;
    static routeRadars = [];
    static routeProgress = 0;
    static routeLastPosition = null;
    static routeRequestInProgress = false;

    static testMode = {
        active: false,
        latitude: null,
        longitude: null,
        heading: 0,
        speed: 40,
        moveInterval: null,
        stepMeters: 10
    };

    static searchDebounceTimer = null;
    static warningTimeout = null;

    static async init() {
        if (this.initialized) {
            return;
        }

        this.initialized = true;

        this.createMap();
        this.createControls();
        this.createTestControls();
        this.setupVoice();

        this.setSystemStatus("SYSTEM ONLINE");
        this.setGpsState("OFF");

        this.requestLocation();
        this.loadMontevideoRadars();
    }

    static createMap() {
        if (typeof L === "undefined") {
            console.error("Leaflet no está cargado.");
            this.showStatus("Error: Leaflet no está cargado.");
            return;
        }

        const mapElement = document.getElementById("map");

        if (!mapElement) {
            console.error("No existe el elemento #map.");
            return;
        }

        this.map = L.map("map", {
            zoomControl: true,
            attributionControl: true
        }).setView(
            [-34.9011, -56.1645],
            13
        );

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,
                attribution:
                    "&copy; OpenStreetMap contributors"
            }
        ).addTo(this.map);
    }

    static createControls() {
        const mapContainer =
            document.getElementById("map");

        if (!mapContainer) {
            return;
        }

        mapContainer.style.position = "relative";

        const navigationPanel =
            document.createElement("div");

        navigationPanel.id =
            "navigationPanel";

        const searchWrapper =
            document.createElement("div");

        searchWrapper.id =
            "destinationSearchWrapper";

        const searchInput =
            document.createElement("input");

        searchInput.type = "search";
        searchInput.id = "destinationSearch";
        searchInput.placeholder =
            "Buscar destino...";
        searchInput.autocomplete = "off";

        const clearRouteButton =
            document.createElement("button");

        clearRouteButton.type = "button";
        clearRouteButton.id =
            "clearRouteButton";
        clearRouteButton.textContent =
            "✕";

        clearRouteButton.addEventListener(
            "click",
            () => {
                searchInput.value = "";
                this.clearRoute();
                this.clearSearchResults();
            }
        );

        const searchResults =
            document.createElement("div");

        searchResults.id =
            "destinationResults";

        searchInput.addEventListener(
            "input",
            () => {
                clearTimeout(
                    this.searchDebounceTimer
                );

                const query =
                    searchInput.value.trim();

                if (query.length < 3) {
                    this.clearSearchResults();
                    return;
                }

                this.searchDebounceTimer =
                    setTimeout(
                        () => {
                            this.searchDestination(
                                query
                            );
                        },
                        450
                    );
            }
        );

        searchInput.addEventListener(
            "keydown",
            event => {
                if (
                    event.key === "Enter"
                ) {
                    event.preventDefault();

                    const first =
                        searchResults.querySelector(
                            "[data-lat]"
                        );

                    if (first) {
                        first.click();
                    }
                }

                if (
                    event.key === "Escape"
                ) {
                    this.clearSearchResults();
                }
            }
        );

        searchWrapper.appendChild(
            searchInput
        );

        searchWrapper.appendChild(
            clearRouteButton
        );

        searchWrapper.appendChild(
            searchResults
        );

        const locateButton =
            document.createElement("button");

        locateButton.type = "button";
        locateButton.id = "locateButton";
        locateButton.textContent =
            "📍 MI UBICACIÓN";

        locateButton.addEventListener(
            "click",
            () => {
                if (this.testMode.active) {
                    this.disableTestMode();
                }

                this.requestLocation(true);
            }
        );

        const routeInfo =
            document.createElement("div");

        routeInfo.id =
            "routeInfo";

        routeInfo.innerHTML =
            `
            <div id="routeDestinationText">
                SIN DESTINO
            </div>
            <div id="routeDistanceText">
                —
            </div>
            <div id="routeInstructionText">
                —
            </div>
            `;

        navigationPanel.appendChild(
            searchWrapper
        );

        navigationPanel.appendChild(
            locateButton
        );

        navigationPanel.appendChild(
            routeInfo
        );

        mapContainer.appendChild(
            navigationPanel
        );
    }

    static createTestControls() {
        const mapContainer =
            document.getElementById("map");

        if (!mapContainer) {
            return;
        }

        const panel =
            document.createElement("div");

        panel.id =
            "testModePanel";

        const toggle =
            document.createElement("button");

        toggle.type = "button";
        toggle.id =
            "testModeButton";

        toggle.textContent =
            "🧪 ACTIVAR MODO PRUEBA";

        toggle.addEventListener(
            "click",
            () => {
                if (this.testMode.active) {
                    this.disableTestMode();
                } else {
                    this.enableTestMode();
                }
            }
        );

        const controls =
            document.createElement("div");

        controls.id =
            "testMovementControls";

        const forward =
            document.createElement("button");

        forward.type = "button";
        forward.textContent = "▲";

        const left =
            document.createElement("button");

        left.type = "button";
        left.textContent = "◀";

        const stop =
            document.createElement("button");

        stop.type = "button";
        stop.textContent = "●";

        const right =
            document.createElement("button");

        right.type = "button";
        right.textContent = "▶";

        const backward =
            document.createElement("button");

        backward.type = "button";
        backward.textContent = "▼";

        controls.appendChild(
            forward
        );

        controls.appendChild(
            document.createElement("br")
        );

        controls.appendChild(
            left
        );

        controls.appendChild(
            stop
        );

        controls.appendChild(
            right
        );

        controls.appendChild(
            document.createElement("br")
        );

        controls.appendChild(
            backward
        );

        const speedLabel =
            document.createElement("div");

        speedLabel.id =
            "testSpeedLabel";

        speedLabel.textContent =
            "40 KM/H";

        const faster =
            document.createElement("button");

        faster.type = "button";
        faster.textContent =
            "+ VELOCIDAD";

        const slower =
            document.createElement("button");

        slower.type = "button";
        slower.textContent =
            "- VELOCIDAD";

        const status =
            document.createElement("div");

        status.id =
            "testModeStatus";

        status.textContent =
            "Modo prueba desactivado.";

        const pressMove =
            direction => {
                if (
                    !this.testMode.active
                ) {
                    return;
                }

                if (
                    direction === "left"
                ) {
                    this.testMode.heading =
                        (
                            this.testMode.heading -
                            15 +
                            360
                        ) % 360;
                }

                if (
                    direction === "right"
                ) {
                    this.testMode.heading =
                        (
                            this.testMode.heading +
                            15
                        ) % 360;
                }

                if (
                    direction === "forward"
                ) {
                    this.moveTestPosition(
                        this.testMode.heading
                    );
                }

                if (
                    direction === "backward"
                ) {
                    this.moveTestPosition(
                        (
                            this.testMode.heading +
                            180
                        ) % 360
                    );
                }

                this.updateTestModeUI();
            };

        forward.addEventListener(
            "click",
            () => pressMove("forward")
        );

        left.addEventListener(
            "click",
            () => pressMove("left")
        );

        right.addEventListener(
            "click",
            () => pressMove("right")
        );

        backward.addEventListener(
            "click",
            () => pressMove("backward")
        );

        stop.addEventListener(
            "click",
            () => {
                this.testMode.speed = 0;
                this.updateTestModeUI();
            }
        );

        faster.addEventListener(
            "click",
            () => {
                this.testMode.speed =
                    Math.min(
                        150,
                        this.testMode.speed + 10
                    );

                this.updateTestModeUI();
            }
        );

        slower.addEventListener(
            "click",
            () => {
                this.testMode.speed =
                    Math.max(
                        0,
                        this.testMode.speed - 10
                    );

                this.updateTestModeUI();
            }
        );

        panel.appendChild(
            toggle
        );

        panel.appendChild(
            controls
        );

        panel.appendChild(
            faster
        );

        panel.appendChild(
            slower
        );

        panel.appendChild(
            speedLabel
        );

        panel.appendChild(
            status
        );

        mapContainer.appendChild(
            panel
        );

        this.testKeyHandler =
            event => {
                if (
                    !this.testMode.active
                ) {
                    return;
                }

                if (
                    event.key === "ArrowUp" ||
                    event.key.toLowerCase() === "w"
                ) {
                    event.preventDefault();
                    pressMove("forward");
                }

                if (
                    event.key === "ArrowDown" ||
                    event.key.toLowerCase() === "s"
                ) {
                    event.preventDefault();
                    pressMove("backward");
                }

                if (
                    event.key === "ArrowLeft" ||
                    event.key.toLowerCase() === "a"
                ) {
                    event.preventDefault();
                    pressMove("left");
                }

                if (
                    event.key === "ArrowRight" ||
                    event.key.toLowerCase() === "d"
                ) {
                    event.preventDefault();
                    pressMove("right");
                }
            };

        document.addEventListener(
            "keydown",
            this.testKeyHandler
        );
    }

    static setupVoice() {
        if (
            !("speechSynthesis" in window)
        ) {
            return;
        }

        window.speechSynthesis.getVoices();

        if (
            "onvoiceschanged" in
            window.speechSynthesis
        ) {
            window.speechSynthesis.onvoiceschanged =
                () => {
                    window.speechSynthesis.getVoices();
                };
        }
    }

    static requestLocation(
        center = false
    ) {
        if (!navigator.geolocation) {
            this.setGpsState("N/A");

            this.showStatus(
                "Este navegador no soporta geolocalización."
            );

            return;
        }

        if (
            location.protocol !== "https:" &&
            location.hostname !== "localhost" &&
            location.hostname !== "127.0.0.1" &&
            location.hostname !== "::1"
        ) {
            this.setGpsState("HTTPS");

            this.showStatus(
                "En móvil debes abrir esta página mediante HTTPS."
            );

            return;
        }

        if (
            this.locationRequestInProgress
        ) {
            return;
        }

        this.locationRequestInProgress =
            true;

        this.setGpsState("SEARCH");

        this.showStatus(
            "Obteniendo ubicación..."
        );

        const button =
            document.getElementById(
                "locateButton"
            );

        if (button) {
            button.disabled = true;
            button.textContent =
                "📍 BUSCANDO...";
        }

        navigator.geolocation.getCurrentPosition(
            position => {
                this.locationRequestInProgress =
                    false;

                if (button) {
                    button.disabled =
                        false;

                    button.textContent =
                        "📍 MI UBICACIÓN";
                }

                this.handlePosition(
                    position,
                    center
                );

                this.startWatching();
            },
            error => {
                this.locationRequestInProgress =
                    false;

                if (button) {
                    button.disabled =
                        false;

                    button.textContent =
                        "📍 MI UBICACIÓN";
                }

                this.handleLocationError(
                    error
                );
            },
            {
                enableHighAccuracy: true,
                maximumAge: 5000,
                timeout: 20000
            }
        );
    }

    static handleLocationError(
        error
    ) {
        console.error(
            "Error de ubicación:",
            error
        );

        this.setGpsState("ERROR");

        let message =
            "No se pudo obtener tu ubicación.";

        if (error?.code === 1) {
            message =
                "Permiso de ubicación denegado.";
        }

        if (error?.code === 2) {
            message =
                "No se pudo determinar tu ubicación.";
        }

        if (error?.code === 3) {
            message =
                "La ubicación tardó demasiado.";
        }

        this.showStatus(message);
    }

    static startWatching() {
        if (
            this.watchId !== null ||
            !navigator.geolocation
        ) {
            return;
        }

        this.watchId =
            navigator.geolocation.watchPosition(
                position => {
                    if (
                        !this.testMode.active
                    ) {
                        this.handlePosition(
                            position,
                            false
                        );
                    }
                },
                error => {
                    console.error(
                        "Error siguiendo ubicación:",
                        error
                    );

                    this.setGpsState("ERROR");
                },
                {
                    enableHighAccuracy: true,
                    maximumAge: 1000,
                    timeout: 15000
                }
            );
    }

    static handlePosition(
        position,
        center
    ) {
        if (
            !position?.coords ||
            this.testMode.active
        ) {
            return;
        }

        const latitude =
            position.coords.latitude;

        const longitude =
            position.coords.longitude;

        const accuracy =
            position.coords.accuracy || 20;

        let heading =
            position.coords.heading;

        const speed =
            position.coords.speed;

        if (
            heading === null ||
            heading === undefined ||
            Number.isNaN(heading)
        ) {
            if (this.previousPosition) {
                const movement =
                    this.distanceMeters(
                        this.previousPosition.latitude,
                        this.previousPosition.longitude,
                        latitude,
                        longitude
                    );

                if (movement >= 3) {
                    heading =
                        this.calculateBearing(
                            this.previousPosition.latitude,
                            this.previousPosition.longitude,
                            latitude,
                            longitude
                        );
                }
            }
        }

        this.previousPosition = {
            latitude,
            longitude
        };

        this.lastPosition = {
            latitude,
            longitude,
            accuracy,
            heading,
            speed
        };

        this.setGpsState("ACTIVE");

        this.updateUserMarker(
            latitude,
            longitude,
            accuracy
        );

        if (
            center &&
            this.map
        ) {
            this.map.setView(
                [
                    latitude,
                    longitude
                ],
                16
            );
        }

        this.updateRadarArea(
            latitude,
            longitude
        );

        if (this.route) {
            this.updateRouteProgress(
                latitude,
                longitude
            );
        } else {
            this.renderNearbyRadars(
                latitude,
                longitude
            );
        }

        this.checkRadars(
            latitude,
            longitude,
            heading
        );

        this.updateNavigationInfo(
            speed
        );

        this.updateRadarCount();

        this.showStatus(
            `Ubicación activa · precisión ${Math.round(
                accuracy
            )} m · ${this.allRadars.length} radares`
        );
    }

    static updateUserMarker(
        latitude,
        longitude,
        accuracy = 20
    ) {
        if (!this.map) {
            return;
        }

        const position = [
            latitude,
            longitude
        ];

        if (!this.userMarker) {
            this.userMarker =
                L.circleMarker(
                    position,
                    {
                        radius: 8,
                        color: "#fff",
                        weight: 3,
                        fillColor: "#36c8d8",
                        fillOpacity: 1
                    }
                ).addTo(this.map);

            this.userMarker.bindPopup(
                "<strong>Tu ubicación</strong>"
            );
        } else {
            this.userMarker.setLatLng(
                position
            );
        }

        if (!this.accuracyCircle) {
            this.accuracyCircle =
                L.circle(
                    position,
                    {
                        radius: accuracy,
                        color: "#36c8d8",
                        weight: 1,
                        fillColor: "#36c8d8",
                        fillOpacity: 0.08
                    }
                ).addTo(this.map);
        } else {
            this.accuracyCircle.setLatLng(
                position
            );

            this.accuracyCircle.setRadius(
                accuracy
            );
        }
    }

    static async searchDestination(
        query
    ) {
        if (!query) {
            return;
        }

        const resultsElement =
            document.getElementById(
                "destinationResults"
            );

        if (!resultsElement) {
            return;
        }

        resultsElement.innerHTML =
            `<div class="destination-loading">BUSCANDO...</div>`;

        try {
            let url =
                `${this.nominatimUrl}?format=jsonv2&addressdetails=1&limit=8&countrycodes=uy&q=${encodeURIComponent(
                    query
                )}`;

            if (this.lastPosition) {
                const lat =
                    this.lastPosition.latitude;

                const lon =
                    this.lastPosition.longitude;

                const delta = 0.15;

                url +=
                    `&viewbox=${encodeURIComponent(
                        `${lon - delta},${lat + delta},${lon + delta},${lat - delta}`
                    )}&bounded=0`;
            }

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
                throw new Error(
                    `Nominatim HTTP ${response.status}`
                );
            }

            const results =
                await response.json();

            resultsElement.innerHTML = "";

            if (!results.length) {
                resultsElement.innerHTML =
                    `<div class="destination-empty">NO SE ENCONTRARON DESTINOS</div>`;
                return;
            }

            for (
                const result of results
                ) {
                const item =
                    document.createElement("button");

                item.type = "button";
                item.className =
                    "destination-result";

                item.dataset.lat =
                    result.lat;

                item.dataset.lon =
                    result.lon;

                item.innerHTML =
                    `
                    <strong>${this.escapeHtml(
                        result.name ||
                        result.display_name
                    )}</strong>
                    <small>${this.escapeHtml(
                        result.display_name
                    )}</small>
                    `;

                item.addEventListener(
                    "click",
                    () => {
                        this.selectDestination(
                            Number(result.lat),
                            Number(result.lon),
                            result.display_name
                        );
                    }
                );

                resultsElement.appendChild(
                    item
                );
            }
        } catch (error) {
            console.error(
                "Error buscando destino:",
                error
            );

            resultsElement.innerHTML =
                `<div class="destination-empty">ERROR BUSCANDO DESTINO</div>`;
        }
    }

    static clearSearchResults() {
        const element =
            document.getElementById(
                "destinationResults"
            );

        if (element) {
            element.innerHTML = "";
        }
    }

    static async selectDestination(
        latitude,
        longitude,
        name
    ) {
        this.clearSearchResults();

        const input =
            document.getElementById(
                "destinationSearch"
            );

        if (input) {
            input.value = name || "";
        }

        if (!this.lastPosition) {
            this.showStatus(
                "Esperando ubicación actual..."
            );

            this.requestLocation(true);

            return;
        }

        await this.calculateRoute(
            this.lastPosition.latitude,
            this.lastPosition.longitude,
            latitude,
            longitude,
            name
        );
    }

    static async calculateRoute(
        startLatitude,
        startLongitude,
        destinationLatitude,
        destinationLongitude,
        destinationName
    ) {
        if (this.routeRequestInProgress) {
            return;
        }

        this.routeRequestInProgress = true;

        this.showStatus(
            "Calculando ruta por calles..."
        );

        try {
            const coordinates =
                `${startLongitude},${startLatitude};${destinationLongitude},${destinationLatitude}`;

            const url =
                `${this.osrmUrl}/${coordinates}?overview=full&geometries=geojson&steps=true&annotations=true`;

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
                !data.routes ||
                !data.routes.length
            ) {
                throw new Error(
                    "No se encontró una ruta."
                );
            }

            const route =
                data.routes[0];

            this.clearRouteLayer();

            this.route = {
                geometry:
                route.geometry,
                distance:
                route.distance,
                duration:
                route.duration,
                steps:
                    route.legs?.flatMap(
                        leg =>
                            leg.steps || []
                    ) || [],
                destination: {
                    latitude:
                    destinationLatitude,
                    longitude:
                    destinationLongitude,
                    name:
                        destinationName ||
                        "Destino"
                }
            };

            this.routeProgress = 0;
            this.routeLastPosition = null;

            this.routeLayer =
                L.geoJSON(
                    route.geometry,
                    {
                        style: {
                            color: "#22a7ff",
                            weight: 7,
                            opacity: 0.9
                        }
                    }
                ).addTo(this.map);

            this.routeDestinationMarker =
                L.marker(
                    [
                        destinationLatitude,
                        destinationLongitude
                    ],
                    {
                        title:
                            destinationName ||
                            "Destino"
                    }
                ).addTo(this.map);

            this.routeDestinationMarker.bindPopup(
                `<strong>DESTINO</strong><br>${this.escapeHtml(
                    destinationName ||
                    "Destino"
                )}`
            );

            this.map.fitBounds(
                this.routeLayer.getBounds(),
                {
                    padding: [
                        50,
                        50
                    ]
                }
            );

            this.routeRadars =
                this.findRadarsOnRoute(
                    this.route.geometry
                );

            this.renderRouteRadars();

            this.updateRouteInfo();

            this.showStatus(
                `Ruta calculada · ${this.formatDistance(
                    route.distance
                )} · ${this.formatDuration(
                    route.duration
                )}`
            );

            if (this.lastPosition) {
                this.updateRouteProgress(
                    this.lastPosition.latitude,
                    this.lastPosition.longitude
                );
            }
        } catch (error) {
            console.error(
                "Error calculando ruta:",
                error
            );

            this.showStatus(
                "No se pudo calcular una ruta por calles."
            );

            this.clearRoute();
        } finally {
            this.routeRequestInProgress =
                false;
        }
    }

    static findRadarsOnRoute(
        geometry
    ) {
        if (
            !geometry?.coordinates ||
            geometry.coordinates.length < 2
        ) {
            return [];
        }

        const result = [];

        for (
            const radar of this.allRadars
            ) {
            const match =
                this.closestPointOnRoute(
                    radar.latitude,
                    radar.longitude,
                    geometry.coordinates
                );

            if (
                match.distance <=
                this.routeRadarMatchDistance
            ) {
                result.push({
                    radar,
                    routeDistance:
                    match.routeDistance,
                    distanceFromRoute:
                    match.distance
                });
            }
        }

        result.sort(
            (
                a,
                b
            ) =>
                a.routeDistance -
                b.routeDistance
        );

        return result;
    }

    static renderRouteRadars() {
        if (!this.route) {
            return;
        }

        this.clearRadarMarkers();

        for (
            const item of this.routeRadars
            ) {
            this.createRadarMarker(
                item.radar
            );
        }
    }

    static updateRouteProgress(
        latitude,
        longitude
    ) {
        if (
            !this.route?.geometry?.coordinates
        ) {
            return;
        }

        const nearest =
            this.closestPointOnRoute(
                latitude,
                longitude,
                this.route.geometry.coordinates
            );

        this.routeProgress =
            nearest.routeDistance;

        this.routeLastPosition = {
            latitude,
            longitude
        };

        this.updateRouteInfo();

        this.checkRouteRadars(
            latitude,
            longitude
        );
    }

    static checkRouteRadars(
        latitude,
        longitude
    ) {
        if (
            !this.route ||
            !this.routeRadars.length
        ) {
            return;
        }

        for (
            const item of this.routeRadars
            ) {
            const radar =
                item.radar;

            if (
                this.warnedRadars.has(
                    radar.id
                )
            ) {
                continue;
            }

            const routeAhead =
                item.routeDistance -
                this.routeProgress;

            if (
                routeAhead < -30
            ) {
                continue;
            }

            if (
                routeAhead > this.warningDistance
            ) {
                continue;
            }

            const directDistance =
                this.distanceMeters(
                    latitude,
                    longitude,
                    radar.latitude,
                    radar.longitude
                );

            if (
                directDistance >
                this.warningDistance + 60
            ) {
                continue;
            }

            this.warnedRadars.add(
                radar.id
            );

            this.warnRadar(
                radar,
                Math.max(
                    1,
                    Math.round(
                        directDistance
                    )
                )
            );
        }

        this.cleanupWarnings(
            latitude,
            longitude
        );
    }

    static closestPointOnRoute(
        latitude,
        longitude,
        coordinates
    ) {
        let bestDistance =
            Infinity;

        let bestRouteDistance =
            0;

        let accumulated =
            0;

        let bestPoint = null;

        for (
            let i = 0;
            i <
            coordinates.length - 1;
            i++
        ) {
            const a =
                coordinates[i];

            const b =
                coordinates[i + 1];

            const segmentDistance =
                this.distanceMeters(
                    a[1],
                    a[0],
                    b[1],
                    b[0]
                );

            if (
                segmentDistance <= 0
            ) {
                continue;
            }

            const projection =
                this.projectOnSegment(
                    latitude,
                    longitude,
                    a[1],
                    a[0],
                    b[1],
                    b[0]
                );

            const distance =
                this.distanceMeters(
                    latitude,
                    longitude,
                    projection.latitude,
                    projection.longitude
                );

            const routeDistance =
                accumulated +
                segmentDistance *
                projection.t;

            if (
                distance <
                bestDistance
            ) {
                bestDistance =
                    distance;

                bestRouteDistance =
                    routeDistance;

                bestPoint =
                    projection;
            }

            accumulated +=
                segmentDistance;
        }

        return {
            distance:
            bestDistance,
            routeDistance:
            bestRouteDistance,
            point:
            bestPoint
        };
    }

    static projectOnSegment(
        pointLat,
        pointLon,
        aLat,
        aLon,
        bLat,
        bLon
    ) {
        const cosLat =
            Math.cos(
                pointLat *
                Math.PI /
                180
            );

        const metersPerDegreeLat =
            111320;

        const metersPerDegreeLon =
            111320 *
            Math.max(
                0.01,
                cosLat
            );

        const ax =
            aLon *
            metersPerDegreeLon;

        const ay =
            aLat *
            metersPerDegreeLat;

        const bx =
            bLon *
            metersPerDegreeLon;

        const by =
            bLat *
            metersPerDegreeLat;

        const px =
            pointLon *
            metersPerDegreeLon;

        const py =
            pointLat *
            metersPerDegreeLat;

        const dx =
            bx - ax;

        const dy =
            by - ay;

        const lengthSquared =
            dx * dx +
            dy * dy;

        let t = 0;

        if (
            lengthSquared > 0
        ) {
            t =
                (
                    (px - ax) * dx +
                    (py - ay) * dy
                ) /
                lengthSquared;
        }

        t =
            Math.max(
                0,
                Math.min(
                    1,
                    t
                )
            );

        return {
            latitude:
                aLat +
                (
                    bLat -
                    aLat
                ) *
                t,

            longitude:
                aLon +
                (
                    bLon -
                    aLon
                ) *
                t,

            t
        };
    }

    static updateRouteInfo() {
        const destinationElement =
            document.getElementById(
                "routeDestinationText"
            );

        const distanceElement =
            document.getElementById(
                "routeDistanceText"
            );

        const instructionElement =
            document.getElementById(
                "routeInstructionText"
            );

        if (!this.route) {
            if (destinationElement) {
                destinationElement.textContent =
                    "SIN DESTINO";
            }

            if (distanceElement) {
                distanceElement.textContent =
                    "—";
            }

            if (instructionElement) {
                instructionElement.textContent =
                    "—";
            }

            return;
        }

        if (destinationElement) {
            destinationElement.textContent =
                this.route.destination.name;
        }

        const remaining =
            Math.max(
                0,
                this.route.distance -
                this.routeProgress
            );

        if (distanceElement) {
            distanceElement.textContent =
                `${this.formatDistance(
                    remaining
                )} restantes`;
        }

        if (instructionElement) {
            const instruction =
                this.getCurrentRouteInstruction();

            instructionElement.textContent =
                instruction ||
                "Continúe por la ruta";
        }
    }

    static getCurrentRouteInstruction() {
        if (
            !this.route?.steps?.length
        ) {
            return "";
        }

        let accumulated = 0;

        for (
            const step of this.route.steps
            ) {
            const distance =
                Number(
                    step.distance || 0
                );

            if (
                this.routeProgress <=
                accumulated +
                distance +
                20
            ) {
                return (
                    step.maneuver?.instruction ||
                    this.translateManeuver(
                        step.maneuver,
                        step.name
                    )
                );
            }

            accumulated +=
                distance;
        }

        return "Ha llegado a su destino";
    }

    static translateManeuver(
        maneuver,
        streetName
    ) {
        const modifier =
            maneuver?.modifier || "";

        const name =
            streetName ||
            "la calle";

        if (
            maneuver?.type ===
            "arrive"
        ) {
            return "Ha llegado a su destino";
        }

        if (
            maneuver?.type ===
            "depart"
        ) {
            return `Continúe por ${name}`;
        }

        if (
            modifier === "left"
        ) {
            return `Doble a la izquierda hacia ${name}`;
        }

        if (
            modifier === "right"
        ) {
            return `Doble a la derecha hacia ${name}`;
        }

        if (
            modifier === "slight left"
        ) {
            return `Gire levemente a la izquierda hacia ${name}`;
        }

        if (
            modifier === "slight right"
        ) {
            return `Gire levemente a la derecha hacia ${name}`;
        }

        if (
            modifier === "sharp left"
        ) {
            return `Gire pronunciadamente a la izquierda hacia ${name}`;
        }

        if (
            modifier === "sharp right"
        ) {
            return `Gire pronunciadamente a la derecha hacia ${name}`;
        }

        return `Continúe por ${name}`;
    }

    static formatDistance(
        meters
    ) {
        if (
            meters < 1000
        ) {
            return `${Math.round(
                meters
            )} m`;
        }

        return `${(
            meters /
            1000
        ).toFixed(1)} km`;
    }

    static formatDuration(
        seconds
    ) {
        const minutes =
            Math.round(
                seconds / 60
            );

        if (
            minutes < 60
        ) {
            return `${minutes} min`;
        }

        const hours =
            Math.floor(
                minutes / 60
            );

        const remaining =
            minutes %
            60;

        return `${hours} h ${remaining} min`;
    }

    static clearRouteLayer() {
        if (
            this.routeLayer &&
            this.map
        ) {
            this.map.removeLayer(
                this.routeLayer
            );
        }

        if (
            this.routeDestinationMarker &&
            this.map
        ) {
            this.map.removeLayer(
                this.routeDestinationMarker
            );
        }

        this.routeLayer = null;
        this.routeDestinationMarker = null;
    }

    static clearRoute() {
        this.clearRouteLayer();

        this.route = null;
        this.routeRadars = [];
        this.routeProgress = 0;
        this.routeLastPosition = null;

        this.warnedRadars.clear();

        if (this.lastPosition) {
            this.renderNearbyRadars(
                this.lastPosition.latitude,
                this.lastPosition.longitude
            );
        }

        this.updateRouteInfo();

        this.showStatus(
            "Ruta eliminada."
        );
    }

    static async loadMontevideoRadars() {
        try {
            this.showStatus(
                "Cargando radares oficiales..."
            );

            const response =
                await fetch(
                    this.radarDataUrl,
                    {
                        cache: "no-store"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const csv =
                await response.text();

            const radars =
                this.parseRadarCSV(csv);

            this.allRadars =
                this.deduplicateRadars(
                    [
                        ...this.allRadars,
                        ...radars
                    ]
                );

            this.radars =
                this.allRadars;

            this.updateRadarCount();

            if (this.lastPosition) {
                if (this.route) {
                    this.routeRadars =
                        this.findRadarsOnRoute(
                            this.route.geometry
                        );

                    this.renderRouteRadars();
                } else {
                    this.renderNearbyRadars(
                        this.lastPosition.latitude,
                        this.lastPosition.longitude
                    );
                }
            }

            this.showStatus(
                `${this.allRadars.length} radares oficiales cargados`
            );

            this.setSystemStatus(
                "SYSTEM ONLINE"
            );
        } catch (error) {
            console.error(
                "Error cargando radares de Montevideo:",
                error
            );

            this.showStatus(
                "No se pudieron cargar los radares oficiales."
            );
        }
    }

    static async updateRadarArea(
        latitude,
        longitude
    ) {
        if (
            this.testMode.active ||
            this.radarLoadInProgress
        ) {
            return;
        }

        if (this.lastRadarZoneLoadPosition) {
            const moved =
                this.distanceMeters(
                    this.lastRadarZoneLoadPosition.latitude,
                    this.lastRadarZoneLoadPosition.longitude,
                    latitude,
                    longitude
                );

            if (
                moved <
                this.reloadDistance
            ) {
                return;
            }
        }

        const alreadyCovered =
            this.loadedRadarZones.some(
                zone =>
                    this.distanceMeters(
                        latitude,
                        longitude,
                        zone.latitude,
                        zone.longitude
                    ) <=
                    this.radarLoadRadius *
                    0.65
            );

        if (alreadyCovered) {
            return;
        }

        this.radarLoadInProgress =
            true;

        try {
            const radars =
                await this.loadUruguayOSMRadars(
                    latitude,
                    longitude
                );

            if (radars.length) {
                this.allRadars =
                    this.deduplicateRadars(
                        [
                            ...this.allRadars,
                            ...radars
                        ]
                    );

                this.radars =
                    this.allRadars;
            }

            this.loadedRadarZones.push({
                latitude,
                longitude
            });

            this.lastRadarZoneLoadPosition = {
                latitude,
                longitude
            };

            if (
                this.loadedRadarZones.length >
                30
            ) {
                this.loadedRadarZones =
                    this.loadedRadarZones.slice(
                        -20
                    );
            }

            if (this.route) {
                this.routeRadars =
                    this.findRadarsOnRoute(
                        this.route.geometry
                    );

                this.renderRouteRadars();
            } else {
                this.renderNearbyRadars(
                    latitude,
                    longitude
                );
            }

            this.updateRadarCount();
        } catch (error) {
            console.error(
                "Error actualizando zona de radares:",
                error
            );
        } finally {
            this.radarLoadInProgress =
                false;
        }
    }

    static async loadUruguayOSMRadars(
        latitude,
        longitude
    ) {
        const box =
            this.createBoundingBox(
                latitude,
                longitude,
                this.radarLoadRadius
            );

        const query = `
[out:json][timeout:25];

(
    node["highway"="speed_camera"](${box});
    node["enforcement"="maxspeed"](${box});
    node["traffic_calming"="camera"](${box});
    way["highway"="speed_camera"](${box});
);

out center tags;
`;

        for (
            const url of this.overpassUrls
            ) {
            try {
                const response =
                    await fetch(
                        url,
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
                    continue;
                }

                const data =
                    await response.json();

                return (
                    data.elements || []
                )
                    .map(
                        element => {
                            const elementLatitude =
                                element.lat ??
                                element.center?.lat;

                            const elementLongitude =
                                element.lon ??
                                element.center?.lon;

                            if (
                                !Number.isFinite(
                                    elementLatitude
                                ) ||
                                !Number.isFinite(
                                    elementLongitude
                                )
                            ) {
                                return null;
                            }

                            const tags =
                                element.tags || {};

                            return {
                                id:
                                    `osm-${element.type}-${element.id}`,

                                latitude:
                                elementLatitude,

                                longitude:
                                elementLongitude,

                                tags: {
                                    ...tags,
                                    source:
                                        "OpenStreetMap",
                                    official:
                                        "false",
                                    osmId:
                                        String(
                                            element.id
                                        )
                                }
                            };
                        }
                    )
                    .filter(Boolean);
            } catch (error) {
                console.error(
                    "Overpass:",
                    error
                );
            }
        }

        return [];
    }

    static createBoundingBox(
        latitude,
        longitude,
        radius
    ) {
        const latitudeDelta =
            radius / 111320;

        const longitudeDelta =
            radius /
            (
                111320 *
                Math.cos(
                    latitude *
                    Math.PI /
                    180
                )
            );

        return [
            latitude -
            latitudeDelta,
            longitude -
            longitudeDelta,
            latitude +
            latitudeDelta,
            longitude +
            longitudeDelta
        ].join(",");
    }

    static renderNearbyRadars(
        latitude,
        longitude
    ) {
        const nearby =
            this.allRadars.filter(
                radar =>
                    this.distanceMeters(
                        latitude,
                        longitude,
                        radar.latitude,
                        radar.longitude
                    ) <=
                    this.radarDisplayRadius
            );

        this.clearRadarMarkers();

        for (
            const radar of nearby
            ) {
            this.createRadarMarker(
                radar
            );
        }
    }

    static parseRadarCSV(
        csv
    ) {
        const lines =
            csv
                .replace(
                    /^\uFEFF/,
                    ""
                )
                .split(/\r?\n/)
                .filter(
                    line =>
                        line.trim()
                );

        if (
            lines.length < 2
        ) {
            return [];
        }

        const delimiter =
            this.detectDelimiter(
                lines[0]
            );

        const headers =
            this.parseCSVLine(
                lines[0],
                delimiter
            ).map(
                value =>
                    this.normalizeText(
                        value
                    )
            );

        const latitudeIndex =
            this.findColumn(
                headers,
                [
                    "latitud",
                    "latitude",
                    "lat",
                    "y"
                ]
            );

        const longitudeIndex =
            this.findColumn(
                headers,
                [
                    "longitud",
                    "longitude",
                    "lon",
                    "lng",
                    "x"
                ]
            );

        if (
            latitudeIndex === -1 ||
            longitudeIndex === -1
        ) {
            return [];
        }

        const result = [];

        for (
            let i = 1;
            i < lines.length;
            i++
        ) {
            const values =
                this.parseCSVLine(
                    lines[i],
                    delimiter
                );

            const latitude =
                this.parseCoordinate(
                    values[latitudeIndex]
                );

            const longitude =
                this.parseCoordinate(
                    values[longitudeIndex]
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

            if (
                Math.abs(latitude) > 90 ||
                Math.abs(longitude) > 180
            ) {
                continue;
            }

            const tags = {};

            headers.forEach(
                (
                    header,
                    index
                ) => {
                    if (
                        values[index] !==
                        undefined
                    ) {
                        tags[header] =
                            String(
                                values[index]
                            )
                                .trim()
                                .replace(
                                    /^"(.*)"$/,
                                    "$1"
                                );
                    }
                }
            );

            const speed =
                this.findTagValue(
                    tags,
                    [
                        "velocidad",
                        "velocidad maxima",
                        "maxspeed",
                        "limite",
                        "limite velocidad"
                    ]
                );

            const direction =
                this.findTagValue(
                    tags,
                    [
                        "direccion",
                        "dirección",
                        "sentido"
                    ]
                );

            result.push({
                id:
                    `int-mvd-${i}-${latitude}-${longitude}`,

                latitude,
                longitude,

                tags: {
                    ...tags,
                    maxspeed:
                        speed || "",
                    direction:
                        direction || "",
                    official:
                        "true",
                    source:
                        "Intendencia de Montevideo"
                }
            });
        }

        return result;
    }

    static normalizeText(
        value
    ) {
        return String(
            value ?? ""
        )
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(
                /[\u0300-\u036f]/g,
                ""
            )
            .replace(
                /["']/g,
                ""
            );
    }

    static detectDelimiter(
        line
    ) {
        const semicolon =
            (
                line.match(
                    /;/g
                ) || []
            ).length;

        const comma =
            (
                line.match(
                    /,/g
                ) || []
            ).length;

        const tab =
            (
                line.match(
                    /\t/g
                ) || []
            ).length;

        if (
            semicolon >= comma &&
            semicolon >= tab
        ) {
            return ";";
        }

        if (
            tab >= comma
        ) {
            return "\t";
        }

        return ",";
    }

    static parseCSVLine(
        line,
        delimiter
    ) {
        const values = [];

        let current = "";
        let insideQuotes = false;

        for (
            let i = 0;
            i < line.length;
            i++
        ) {
            const char =
                line[i];

            if (
                char === '"'
            ) {
                if (
                    insideQuotes &&
                    line[i + 1] === '"'
                ) {
                    current += '"';
                    i++;
                } else {
                    insideQuotes =
                        !insideQuotes;
                }

                continue;
            }

            if (
                char === delimiter &&
                !insideQuotes
            ) {
                values.push(
                    current
                );

                current = "";

                continue;
            }

            current += char;
        }

        values.push(
            current
        );

        return values;
    }

    static findColumn(
        headers,
        possibleNames
    ) {
        for (
            const name of possibleNames
            ) {
            const index =
                headers.indexOf(
                    this.normalizeText(
                        name
                    )
                );

            if (
                index !== -1
            ) {
                return index;
            }
        }

        for (
            let i = 0;
            i < headers.length;
            i++
        ) {
            for (
                const name of possibleNames
                ) {
                if (
                    headers[i].includes(
                        this.normalizeText(
                            name
                        )
                    )
                ) {
                    return i;
                }
            }
        }

        return -1;
    }

    static findTagValue(
        tags,
        possibleNames
    ) {
        for (
            const name of possibleNames
            ) {
            const normalized =
                this.normalizeText(
                    name
                );

            for (
                const key of Object.keys(
                tags
            )
                ) {
                if (
                    this.normalizeText(
                        key
                    ) === normalized
                ) {
                    const value =
                        String(
                            tags[key] ??
                            ""
                        ).trim();

                    if (value) {
                        return value;
                    }
                }
            }
        }

        return "";
    }

    static parseCoordinate(
        value
    ) {
        if (
            value === undefined ||
            value === null
        ) {
            return NaN;
        }

        let text =
            String(value)
                .trim()
                .replace(
                    /^"(.*)"$/,
                    "$1"
                );

        if (!text) {
            return NaN;
        }

        text =
            text.replace(
                /[^\d,.\-+]/g,
                ""
            );

        const commaCount =
            (
                text.match(
                    /,/g
                ) || []
            ).length;

        const dotCount =
            (
                text.match(
                    /\./g
                ) || []
            ).length;

        if (
            commaCount > 0 &&
            dotCount === 0
        ) {
            text =
                text.replace(
                    ",",
                    "."
                );
        }

        return Number(text);
    }

    static deduplicateRadars(
        radars
    ) {
        const result = [];

        for (
            const radar of radars
            ) {
            if (
                !Number.isFinite(
                    radar.latitude
                ) ||
                !Number.isFinite(
                    radar.longitude
                )
            ) {
                continue;
            }

            const duplicate =
                result.find(
                    existing =>
                        this.distanceMeters(
                            existing.latitude,
                            existing.longitude,
                            radar.latitude,
                            radar.longitude
                        ) < 20
                );

            if (!duplicate) {
                result.push(
                    radar
                );

                continue;
            }

            if (
                radar.tags?.official ===
                "true" &&
                duplicate.tags?.official !==
                "true"
            ) {
                const index =
                    result.indexOf(
                        duplicate
                    );

                result[index] =
                    radar;
            }
        }

        return result;
    }

    static createRadarMarker(
        radar
    ) {
        if (!this.map) {
            return;
        }

        const official =
            radar.tags?.official ===
            "true";

        const icon =
            L.divIcon({
                className:
                    "radar-map-icon",

                html:
                    `
                    <div style="
                        width:32px;
                        height:32px;
                        border-radius:50%;
                        background:${
                        official
                            ? "#e53935"
                            : "#ff7a00"
                    };
                        border:3px solid white;
                        display:flex;
                        align-items:center;
                        justify-content:center;
                        box-shadow:0 2px 8px rgba(0,0,0,.45);
                        font-size:16px;
                    ">📷</div>
                    `,

                iconSize: [
                    32,
                    32
                ],

                iconAnchor: [
                    16,
                    16
                ]
            });

        const marker =
            L.marker(
                [
                    radar.latitude,
                    radar.longitude
                ],
                {
                    icon
                }
            ).addTo(
                this.map
            );

        const speed =
            radar.tags?.maxspeed;

        const source =
            radar.tags?.source ||
            "OpenStreetMap";

        const direction =
            radar.tags?.direction ||
            radar.tags?.camera_direction ||
            radar.tags?.direction_deg ||
            "";

        let popup =
            "<strong>🚨 RADAR</strong>";

        popup +=
            `<br>Fuente: ${this.escapeHtml(
                source
            )}`;

        if (speed) {
            popup +=
                `<br>Velocidad: ${this.escapeHtml(
                    speed
                )}`;
        }

        if (direction) {
            popup +=
                `<br>Dirección: ${this.escapeHtml(
                    direction
                )}`;
        }

        marker.bindPopup(
            popup
        );

        this.radarMarkers.push(
            marker
        );
    }

    static escapeHtml(
        value
    ) {
        return String(
            value ?? ""
        )
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }

    static clearRadarMarkers() {
        for (
            const marker of this.radarMarkers
            ) {
            if (this.map) {
                this.map.removeLayer(
                    marker
                );
            }
        }

        this.radarMarkers = [];
    }

    static checkRadars(
        latitude,
        longitude,
        heading
    ) {
        if (
            !this.allRadars.length
        ) {
            return;
        }

        if (this.route) {
            this.checkRouteRadars(
                latitude,
                longitude
            );

            return;
        }

        for (
            const radar of this.allRadars
            ) {
            const distance =
                this.distanceMeters(
                    latitude,
                    longitude,
                    radar.latitude,
                    radar.longitude
                );

            if (
                distance >
                this.warningDistance
            ) {
                continue;
            }

            if (
                this.warnedRadars.has(
                    radar.id
                )
            ) {
                continue;
            }

            this.warnedRadars.add(
                radar.id
            );

            this.warnRadar(
                radar,
                distance
            );
        }

        this.cleanupWarnings(
            latitude,
            longitude
        );
    }

    static warnRadar(
        radar,
        distance
    ) {
        const roundedDistance =
            Math.max(
                1,
                Math.round(distance)
            );

        const speed =
            this.extractSpeed(
                radar
            );

        let message =
            `Radar reportado a ${roundedDistance} metros`;

        if (speed) {
            message +=
                `, ${speed} kilómetros por hora`;
        }

        this.showStatus(
            "⚠️ " + message
        );

        this.showRadarWarning(
            roundedDistance,
            speed
        );

        this.speak(
            message
        );

        this.flashRadar(
            radar
        );
    }

    static extractSpeed(
        radar
    ) {
        const raw =
            radar.tags?.maxspeed ||
            radar.tags?.velocidad ||
            radar.tags?.["velocidad maxima"] ||
            "";

        const match =
            String(raw).match(
                /\d+(?:[.,]\d+)?/
            );

        if (!match) {
            return "";
        }

        return String(
            Number(
                match[0].replace(
                    ",",
                    "."
                )
            )
        );
    }

    static showRadarWarning(
        distance,
        speed
    ) {
        const warning =
            document.getElementById(
                "radarWarning"
            );

        const distanceElement =
            document.getElementById(
                "radarWarningDistance"
            );

        const limitElement =
            document.getElementById(
                "radarWarningLimit"
            );

        if (!warning) {
            return;
        }

        if (distanceElement) {
            distanceElement.textContent =
                `${distance} M`;
        }

        if (limitElement) {
            limitElement.textContent =
                speed
                    ? `LÍMITE ${speed} KM/H`
                    : "MANTENGA ATENCIÓN";
        }

        warning.classList.add(
            "active"
        );

        clearTimeout(
            this.warningTimeout
        );

        this.warningTimeout =
            setTimeout(
                () => {
                    warning.classList.remove(
                        "active"
                    );
                },
                5000
            );
    }

    static speak(
        message
    ) {
        if (
            !("speechSynthesis" in window)
        ) {
            return;
        }

        const speakNow = () => {
            window.speechSynthesis.cancel();

            const utterance =
                new SpeechSynthesisUtterance(
                    message
                );

            utterance.lang =
                "es-ES";

            utterance.rate =
                1;

            utterance.pitch =
                0.9;

            utterance.volume =
                1;

            const voices =
                window.speechSynthesis
                    .getVoices();

            const spanishVoice =
                voices.find(
                    voice =>
                        voice.lang &&
                        voice.lang
                            .toLowerCase()
                            .startsWith("es")
                );

            if (spanishVoice) {
                utterance.voice =
                    spanishVoice;
            }

            window.speechSynthesis.speak(
                utterance
            );
        };

        const voices =
            window.speechSynthesis
                .getVoices();

        if (voices.length) {
            speakNow();
        } else {
            setTimeout(
                speakNow,
                150
            );
        }
    }

    static flashRadar(
        radar
    ) {
        const marker =
            this.radarMarkers.find(
                item => {
                    const position =
                        item.getLatLng();

                    return (
                        Math.abs(
                            position.lat -
                            radar.latitude
                        ) <
                        0.00001 &&
                        Math.abs(
                            position.lng -
                            radar.longitude
                        ) <
                        0.00001
                    );
                }
            );

        if (!marker) {
            return;
        }

        const element =
            marker.getElement();

        if (!element) {
            return;
        }

        element.style.filter =
            "drop-shadow(0 0 14px red)";

        setTimeout(
            () => {
                if (element) {
                    element.style.filter =
                        "";
                }
            },
            3000
        );
    }

    static cleanupWarnings(
        latitude,
        longitude
    ) {
        for (
            const id of this.warnedRadars
            ) {
            const radar =
                this.allRadars.find(
                    item =>
                        item.id === id
                );

            if (!radar) {
                this.warnedRadars.delete(
                    id
                );

                continue;
            }

            const distance =
                this.distanceMeters(
                    latitude,
                    longitude,
                    radar.latitude,
                    radar.longitude
                );

            if (
                distance > 500
            ) {
                this.warnedRadars.delete(
                    id
                );
            }
        }
    }

    static updateNavigationInfo(
        speed
    ) {
        if (
            speed === null ||
            speed === undefined ||
            Number.isNaN(speed)
        ) {
            return;
        }

        this.showSpeed(
            speed * 3.6
        );
    }

    static showSpeed(
        kmh
    ) {
        let element =
            document.getElementById(
                "mapSpeed"
            );

        if (!element) {
            element =
                document.createElement(
                    "div"
                );

            element.id =
                "mapSpeed";

            const mapContainer =
                document.getElementById(
                    "map"
                );

            if (mapContainer) {
                mapContainer.appendChild(
                    element
                );
            }
        }

        element.textContent =
            `${Math.round(
                kmh
            )} KM/H`;
    }

    static showStatus(
        message
    ) {
        const element =
            document.getElementById(
                "mapStatus"
            );

        if (element) {
            element.textContent =
                message;
        }

        console.log(
            "[TrafficMap]",
            message
        );
    }

    static setSystemStatus(
        status
    ) {
        const element =
            document.getElementById(
                "systemStatus"
            );

        if (element) {
            element.textContent =
                status;
        }
    }

    static setGpsState(
        state
    ) {
        const element =
            document.getElementById(
                "gpsState"
            );

        if (element) {
            element.textContent =
                state;
        }
    }

    static updateRadarCount() {
        const element =
            document.getElementById(
                "radarCount"
            );

        if (element) {
            element.textContent =
                String(
                    this.allRadars.length
                ).padStart(
                    2,
                    "0"
                );
        }
    }

    static enableTestMode() {
        if (!this.map) {
            return;
        }

        if (
            this.testMode.active
        ) {
            return;
        }

        if (!this.lastPosition) {
            const center =
                this.map.getCenter();

            this.testMode.latitude =
                center.lat;

            this.testMode.longitude =
                center.lng;
        } else {
            this.testMode.latitude =
                this.lastPosition.latitude;

            this.testMode.longitude =
                this.lastPosition.longitude;

            if (
                Number.isFinite(
                    this.lastPosition.heading
                )
            ) {
                this.testMode.heading =
                    this.lastPosition.heading;
            }
        }

        this.stopRealTracking();

        this.testMode.active = true;
        this.testMode.speed = 40;

        this.warnedRadars.clear();

        this.setGpsState("TEST");

        this.updateUserMarker(
            this.testMode.latitude,
            this.testMode.longitude,
            5
        );

        if (this.route) {
            this.updateRouteProgress(
                this.testMode.latitude,
                this.testMode.longitude
            );
        } else {
            this.renderNearbyRadars(
                this.testMode.latitude,
                this.testMode.longitude
            );
        }

        this.map.setView(
            [
                this.testMode.latitude,
                this.testMode.longitude
            ],
            Math.max(
                this.map.getZoom(),
                16
            )
        );

        this.updateTestModeUI();

        this.showStatus(
            "Modo prueba activado. Usa las flechas o WASD para moverte."
        );
    }

    static disableTestMode() {
        if (
            !this.testMode.active
        ) {
            this.requestLocation(true);
            return;
        }

        this.stopTestMovement();

        this.testMode.active = false;

        this.warnedRadars.clear();

        this.setGpsState("SEARCH");

        this.showStatus(
            "Modo prueba desactivado. Recuperando ubicación real..."
        );

        this.requestLocation(true);
    }

    static stopTestMovement() {
        if (
            this.testMode.moveInterval
        ) {
            clearInterval(
                this.testMode.moveInterval
            );

            this.testMode.moveInterval =
                null;
        }
    }

    static moveTestPosition(
        heading
    ) {
        if (
            !this.testMode.active ||
            !Number.isFinite(
                this.testMode.latitude
            ) ||
            !Number.isFinite(
                this.testMode.longitude
            )
        ) {
            return;
        }

        const speed =
            Math.max(
                0,
                this.testMode.speed
            );

        const distance =
            speed === 0
                ? this.testMode.stepMeters
                : Math.max(
                    2,
                    speed /
                    3.6
                );

        this.testMode.heading =
            heading;

        const next =
            this.destinationPoint(
                this.testMode.latitude,
                this.testMode.longitude,
                heading,
                distance
            );

        this.testMode.latitude =
            next.latitude;

        this.testMode.longitude =
            next.longitude;

        this.lastPosition = {
            latitude:
            this.testMode.latitude,

            longitude:
            this.testMode.longitude,

            accuracy: 5,

            heading:
            this.testMode.heading,

            speed:
                speed / 3.6
        };

        this.updateUserMarker(
            this.testMode.latitude,
            this.testMode.longitude,
            5
        );

        this.showSpeed(
            speed
        );

        this.updateRadarArea(
            this.testMode.latitude,
            this.testMode.longitude
        );

        if (this.route) {
            this.updateRouteProgress(
                this.testMode.latitude,
                this.testMode.longitude
            );
        } else {
            this.renderNearbyRadars(
                this.testMode.latitude,
                this.testMode.longitude
            );
        }

        this.checkRadars(
            this.testMode.latitude,
            this.testMode.longitude,
            this.testMode.heading
        );

        this.map.panTo(
            [
                this.testMode.latitude,
                this.testMode.longitude
            ],
            {
                animate: true,
                duration: 0.25
            }
        );

        this.updateTestModeUI();
    }

    static updateTestModeUI() {
        const button =
            document.getElementById(
                "testModeButton"
            );

        const status =
            document.getElementById(
                "testModeStatus"
            );

        const speed =
            document.getElementById(
                "testSpeedLabel"
            );

        if (button) {
            button.textContent =
                this.testMode.active
                    ? "⏹ DESACTIVAR MODO PRUEBA"
                    : "🧪 ACTIVAR MODO PRUEBA";
        }

        if (speed) {
            speed.textContent =
                `${Math.round(
                    this.testMode.speed
                )} KM/H`;
        }

        if (!status) {
            return;
        }

        if (!this.testMode.active) {
            status.textContent =
                "Modo prueba desactivado.";
            return;
        }

        status.textContent =
            `TEST · ${this.testMode.latitude.toFixed(
                6
            )}, ${this.testMode.longitude.toFixed(
                6
            )} · RUMBO ${Math.round(
                this.testMode.heading
            )}°`;
    }

    static stopRealTracking() {
        if (
            this.watchId !== null &&
            navigator.geolocation
        ) {
            navigator.geolocation.clearWatch(
                this.watchId
            );

            this.watchId =
                null;
        }
    }

    static destinationPoint(
        latitude,
        longitude,
        bearing,
        distance
    ) {
        const earthRadius =
            6371000;

        const toRadians =
            degrees =>
                degrees *
                Math.PI /
                180;

        const toDegrees =
            radians =>
                radians *
                180 /
                Math.PI;

        const angularDistance =
            distance /
            earthRadius;

        const bearingRad =
            toRadians(
                bearing
            );

        const latitudeRad =
            toRadians(
                latitude
            );

        const longitudeRad =
            toRadians(
                longitude
            );

        const newLatitude =
            Math.asin(
                Math.sin(
                    latitudeRad
                ) *
                Math.cos(
                    angularDistance
                ) +
                Math.cos(
                    latitudeRad
                ) *
                Math.sin(
                    angularDistance
                ) *
                Math.cos(
                    bearingRad
                )
            );

        const newLongitude =
            longitudeRad +
            Math.atan2(
                Math.sin(
                    bearingRad
                ) *
                Math.sin(
                    angularDistance
                ) *
                Math.cos(
                    latitudeRad
                ),
                Math.cos(
                    angularDistance
                ) -
                Math.sin(
                    latitudeRad
                ) *
                Math.sin(
                    newLatitude
                )
            );

        return {
            latitude:
                toDegrees(
                    newLatitude
                ),

            longitude:
                toDegrees(
                    newLongitude
                )
        };
    }

    static distanceMeters(
        lat1,
        lon1,
        lat2,
        lon2
    ) {
        const earthRadius =
            6371000;

        const toRadians =
            degrees =>
                degrees *
                Math.PI /
                180;

        const dLat =
            toRadians(
                lat2 -
                lat1
            );

        const dLon =
            toRadians(
                lon2 -
                lon1
            );

        const a =
            Math.sin(
                dLat / 2
            ) ** 2 +
            Math.cos(
                toRadians(
                    lat1
                )
            ) *
            Math.cos(
                toRadians(
                    lat2
                )
            ) *
            Math.sin(
                dLon / 2
            ) ** 2;

        const c =
            2 *
            Math.atan2(
                Math.sqrt(a),
                Math.sqrt(
                    1 - a
                )
            );

        return (
            earthRadius *
            c
        );
    }

    static calculateBearing(
        lat1,
        lon1,
        lat2,
        lon2
    ) {
        const toRadians =
            degrees =>
                degrees *
                Math.PI /
                180;

        const toDegrees =
            radians =>
                radians *
                180 /
                Math.PI;

        const phi1 =
            toRadians(
                lat1
            );

        const phi2 =
            toRadians(
                lat2
            );

        const deltaLambda =
            toRadians(
                lon2 -
                lon1
            );

        const y =
            Math.sin(
                deltaLambda
            ) *
            Math.cos(
                phi2
            );

        const x =
            Math.cos(
                phi1
            ) *
            Math.sin(
                phi2
            ) -
            Math.sin(
                phi1
            ) *
            Math.cos(
                phi2
            ) *
            Math.cos(
                deltaLambda
            );

        return (
            (
                toDegrees(
                    Math.atan2(
                        y,
                        x
                    )
                ) +
                360
            ) % 360
        );
    }

    static destroy() {
        this.stopTestMovement();
        this.stopRealTracking();

        if (
            this.testKeyHandler
        ) {
            document.removeEventListener(
                "keydown",
                this.testKeyHandler
            );
        }

        if (
            "speechSynthesis" in window
        ) {
            window.speechSynthesis.cancel();
        }

        this.clearRadarMarkers();
        this.clearRouteLayer();

        if (this.map) {
            this.map.remove();
            this.map = null;
        }

        this.initialized =
            false;

        this.allRadars = [];
        this.radars = [];
        this.loadedRadarZones = [];
        this.lastRadarZoneLoadPosition =
            null;
        this.lastPosition =
            null;
        this.previousPosition =
            null;

        this.route = null;
        this.routeRadars = [];
        this.routeProgress = 0;
        this.routeLastPosition =
            null;

        this.warnedRadars.clear();
    }
}

document.addEventListener(
    "DOMContentLoaded",
    () => {
        TrafficMap.init();
    }
);

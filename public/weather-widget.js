// Shared KMSO weather card: injected into the header of fuel_dispatch.html and
// fuel_farm.html. Desktop-only (see .weather-widget rules in common.css).
(function () {
    const PROXY_URL = `${window.location.protocol}//${window.location.host}`;
    const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=46.916&longitude=-114.090&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m&daily=sunrise,sunset&timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph';
    const WEATHER_POLL_INTERVAL = 10 * 60 * 1000; // 10 minutes
    const METAR_POLL_INTERVAL = 10 * 60 * 1000; // 10 minutes
    const CLOCK_UPDATE_INTERVAL = 30 * 1000; // 30 seconds
    const KMSO_ELEVATION_FT = 3206; // KMSO field elevation

    // WMO weather codes -> [icon, label]
    const WEATHER_CODES = {
        0: ['☀️', 'Clear'],
        1: ['🌤️', 'Mostly Clear'],
        2: ['⛅', 'Partly Cloudy'],
        3: ['☁️', 'Overcast'],
        45: ['🌫️', 'Fog'],
        48: ['🌫️', 'Fog'],
        51: ['🌦️', 'Light Drizzle'],
        53: ['🌦️', 'Drizzle'],
        55: ['🌦️', 'Heavy Drizzle'],
        56: ['🌧️', 'Freezing Drizzle'],
        57: ['🌧️', 'Freezing Drizzle'],
        61: ['🌧️', 'Light Rain'],
        63: ['🌧️', 'Rain'],
        65: ['🌧️', 'Heavy Rain'],
        66: ['🌧️', 'Freezing Rain'],
        67: ['🌧️', 'Freezing Rain'],
        71: ['🌨️', 'Light Snow'],
        73: ['🌨️', 'Snow'],
        75: ['❄️', 'Heavy Snow'],
        77: ['❄️', 'Snow Grains'],
        80: ['🌦️', 'Rain Showers'],
        81: ['🌧️', 'Rain Showers'],
        82: ['⛈️', 'Heavy Showers'],
        85: ['🌨️', 'Snow Showers'],
        86: ['🌨️', 'Snow Showers'],
        95: ['⛈️', 'Thunderstorm'],
        96: ['⛈️', 'Thunderstorm'],
        99: ['⛈️', 'Thunderstorm']
    };
    const WIND_COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

    const WIDGET_HTML = `
        <div class="weather-top">
            <div class="weather-icon" id="weatherIcon">🌡️</div>
            <span class="weather-temp" id="weatherTemp">--°F</span>
            <span class="flight-cat" id="flightCatBadge" style="display: none;"></span>
            <span class="weather-desc" id="weatherDesc">--</span>
        </div>
        <div class="weather-grid">
            <div><span class="wp-label">Wind</span><span class="wp-value" id="weatherWind">--</span></div>
            <div><span class="wp-label">Dew Point</span><span class="wp-value" id="wpDewPoint">--</span></div>
            <div><span class="wp-label">Humidity</span><span class="wp-value" id="wpHumidity">--</span></div>
            <div><span class="wp-label">Local</span><span class="wp-value" id="wpLocalTime">--</span></div>
            <div><span class="wp-label">Ceiling</span><span class="wp-value" id="wpCeiling">--</span></div>
            <div><span class="wp-label">Visibility</span><span class="wp-value" id="wpVisibility">--</span></div>
            <div><span class="wp-label">Altimeter</span><span class="wp-value" id="wpAltimeter">--</span></div>
            <div><span class="wp-label">UTC</span><span class="wp-value" id="wpUtcTime">--</span></div>
            <div><span class="wp-label">Pressure Alt</span><span class="wp-value" id="wpPressureAlt">--</span></div>
            <div><span class="wp-label">Density Alt</span><span class="wp-value" id="wpDensityAlt">--</span></div>
            <div><span class="wp-label">Sunrise</span><span class="wp-value" id="wpSunrise">--</span></div>
            <div><span class="wp-label">Sunset</span><span class="wp-value" id="wpSunset">--</span></div>
        </div>
        <div class="metar-raw" id="metarRaw">METAR data unavailable</div>
        <a class="weather-panel-link" href="https://metar-taf.com/KMSO" target="_blank" rel="noopener noreferrer">Full METAR/TAF on metar-taf.com &#8599;</a>
    `;

    function injectMarkup() {
        const header = document.querySelector('.header');
        if (!header) return;
        header.insertAdjacentHTML('afterbegin', '<div class="header-left"></div>');
        header.insertAdjacentHTML('beforeend', `<div class="weather-widget" id="weatherWidget">${WIDGET_HTML}</div>`);
    }

    function applyWeatherWidget(current) {
        const [icon, label] = WEATHER_CODES[current.weather_code] || ['🌡️', '--'];
        const windDir = WIND_COMPASS[Math.round(current.wind_direction_10m / 22.5) % 16];
        document.getElementById('weatherIcon').textContent = icon;
        document.getElementById('weatherTemp').textContent = `${Math.round(current.temperature_2m)}°F`;
        document.getElementById('weatherDesc').textContent = label;
        document.getElementById('weatherWind').textContent = `${Math.round(current.wind_speed_10m)} mph ${windDir}`;
        document.getElementById('wpHumidity').textContent = `${Math.round(current.relative_humidity_2m)}%`;
    }

    // Format an Open-Meteo local ISO timestamp (e.g. "2026-06-13T05:41") as "5:41 AM"
    function formatIsoTimeOfDay(isoString) {
        const [hourStr, minuteStr] = isoString.split('T')[1].split(':');
        const hour = Number(hourStr);
        const period = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 === 0 ? 12 : hour % 12;
        return `${hour12}:${minuteStr} ${period}`;
    }

    function applySunTimes(daily) {
        if (!daily || !daily.sunrise || !daily.sunset) return;
        document.getElementById('wpSunrise').textContent = formatIsoTimeOfDay(daily.sunrise[0]);
        document.getElementById('wpSunset').textContent = formatIsoTimeOfDay(daily.sunset[0]);
    }

    async function fetchOutsideTemp() {
        try {
            const response = await fetch(WEATHER_URL);
            const data = await response.json();
            applyWeatherWidget(data.current);
            applySunTimes(data.daily);
            window.dispatchEvent(new CustomEvent('weather:update', { detail: data.current }));
        } catch (error) {
            console.error('Failed to fetch outside temperature:', error);
        }
    }

    // Lowest BKN/OVC cloud layer forms the ceiling; otherwise there is none
    function ceilingFromClouds(clouds) {
        const layer = (clouds || []).find(c => c.cover === 'BKN' || c.cover === 'OVC');
        return layer ? `${layer.base.toLocaleString()} ft ${layer.cover}` : 'None';
    }

    function applyMetar(metar) {
        const badge = document.getElementById('flightCatBadge');
        if (metar && metar.fltCat) {
            badge.textContent = metar.fltCat;
            badge.className = `flight-cat ${metar.fltCat.toLowerCase()}`;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }

        if (!metar) {
            document.getElementById('metarRaw').textContent = 'METAR data unavailable';
            return;
        }

        document.getElementById('wpCeiling').textContent = ceilingFromClouds(metar.clouds);
        document.getElementById('wpVisibility').textContent = metar.visib ? `${metar.visib} SM` : '--';

        if (typeof metar.altim === 'number') {
            const altimeterInHg = metar.altim / 33.8639;
            document.getElementById('wpAltimeter').textContent = `${altimeterInHg.toFixed(2)} inHg`;

            const elevationFt = typeof metar.elev === 'number' ? metar.elev * 3.28084 : KMSO_ELEVATION_FT;
            const pressureAltFt = (29.92 - altimeterInHg) * 1000 + elevationFt;
            document.getElementById('wpPressureAlt').textContent = `${Math.round(pressureAltFt).toLocaleString()} ft`;

            if (typeof metar.temp === 'number') {
                const isaTempC = 15 - 2 * (pressureAltFt / 1000);
                const densityAltFt = pressureAltFt + 120 * (metar.temp - isaTempC);
                document.getElementById('wpDensityAlt').textContent = `${Math.round(densityAltFt).toLocaleString()} ft`;
            }
        }

        if (typeof metar.dewp === 'number') {
            document.getElementById('wpDewPoint').textContent = `${Math.round(metar.dewp * 9 / 5 + 32)}°F`;
        }

        let ageText = '';
        if (metar.obsTime) {
            const ageMin = Math.round((Date.now() / 1000 - metar.obsTime) / 60);
            ageText = ` (${ageMin} min ago)`;
        }
        document.getElementById('metarRaw').textContent = metar.rawOb ? `${metar.rawOb}${ageText}` : 'METAR data unavailable';
    }

    async function fetchMetar() {
        try {
            const response = await fetch(`${PROXY_URL}/api/metar`);
            const data = await response.json();
            if (data.success) {
                applyMetar(data.metar);
            }
        } catch (error) {
            console.error('Failed to fetch METAR:', error);
        }
    }

    function updateClock() {
        const now = new Date();
        document.getElementById('wpLocalTime').textContent =
            now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        document.getElementById('wpUtcTime').textContent =
            `${now.toUTCString().slice(17, 22)} UTC`;
    }

    document.addEventListener('DOMContentLoaded', function () {
        injectMarkup();

        fetchOutsideTemp();
        setInterval(fetchOutsideTemp, WEATHER_POLL_INTERVAL);

        fetchMetar();
        setInterval(fetchMetar, METAR_POLL_INTERVAL);

        updateClock();
        setInterval(updateClock, CLOCK_UPDATE_INTERVAL);
    });
})();

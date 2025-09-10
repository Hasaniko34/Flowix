// CHATBOT TOGGLE
const chatbotContainer = document.getElementById('chatbot-container') as HTMLDivElement;
const chatbotToggleButton = document.getElementById('chatbot-toggle-button') as HTMLButtonElement;

chatbotToggleButton.addEventListener('click', () => {
    chatbotContainer.classList.toggle('visible');
});
import * as Cesium from 'cesium';

import "cesium/Build/Cesium/Widgets/widgets.css";
import "./css/main.css";

import 'bootstrap/dist/css/bootstrap.min.css';
// import { $ } from 'jquery';
import 'jquery/dist/jquery.min.js';
import 'popper.js/dist/umd/popper.min.js';
import 'bootstrap/dist/js/bootstrap.min.js';

import * as satellite from 'satellite.js';

//INIT
Cesium.Ion.defaultAccessToken = process.env.ACCESS_TOKEN || ''; //token needed only to access Bing imagery
(Cesium.Camera as typeof Cesium.Camera & { DEFAULT_VIEW_RECTANGLE: Cesium.Rectangle }).DEFAULT_VIEW_RECTANGLE = Cesium.Rectangle.fromDegrees(-60, -40, 60, 80); //sets default view

const viewer = new Cesium.Viewer('cesiumContainer', { //create viewer
    geocoder: false, //disables search bar
    infoBox: false,
    navigationInstructionsInitiallyVisible: false, //disables instructions on start
    sceneModePicker: false, //disables scene mode picker
    shouldAnimate: true,
    selectionIndicator: false,
});

//API COLD START
fetch("https://cors-noproblem.onrender.com/");

//REMOVE BING AND MAPBOX IMAGERY
const viewModel = viewer.baseLayerPicker.viewModel;
viewModel.imageryProviderViewModels =
    viewModel.imageryProviderViewModels.filter((el: Cesium.ProviderViewModel) => {
        return (
            el.name.startsWith("ESRI") || el.name.startsWith("Open­Street­Map")
        );
    });
viewModel.selectedImagery = viewModel.imageryProviderViewModels[0]; //select default imageryProvider

const scene = viewer.scene;
const globe = viewer.scene.globe;
const clock = viewer.clock;
const entities = viewer.entities;
const frameRateMonitor = new Cesium.FrameRateMonitor({ scene: viewer.scene, quietPeriod: 0 });
viewer.homeButton.viewModel.duration = 1;
let dataLoadingInProgress = false;

//POLYLINES
const polylines = new Cesium.PolylineCollection(); //collection for displaying orbits
scene.primitives.add(polylines);

//change lighting parameters
globe.nightFadeInDistance = 40000000;
globe.nightFadeOutDistance = 10000000;

const uiElement = document.getElementById("ui");
if (uiElement) {
    uiElement.style.visibility = "visible"; //makes options visible after loading javascript
}
const satUpdateIntervalTime = 33; //update interval in ms
const orbitSteps = 44; //number of steps in predicted orbit

let satellitesData: [string, satellite.SatRec][] = []; //currently displayed satellites TLE data (name, satrec)
let displayedOrbit: [satellite.SatRec, number] | undefined = undefined; //displayed orbit data [satrec, refresh time in seconds]
let lastOrbitUpdateTime = Cesium.JulianDate.now();
let currentlySelected: Cesium.Entity | undefined = undefined;
let footprintEntity: Cesium.Entity | undefined = undefined;

// Info Panel Elements
const infoPanel = document.getElementById('info-panel') as HTMLDivElement;
const infoPanelTitle = document.getElementById('info-panel-title') as HTMLHeadingElement;
const infoPanelCoverage = document.getElementById('info-panel-coverage') as HTMLSpanElement;
const infoPanelPeriod = document.getElementById('info-panel-period') as HTMLSpanElement;
const infoPanelAltitude = document.getElementById('info-panel-altitude') as HTMLSpanElement;
const infoPanelVelocity = document.getElementById('info-panel-velocity') as HTMLSpanElement;
const infoPanelCountry = document.getElementById('info-panel-country') as HTMLSpanElement;
const infoPanelPurpose = document.getElementById('info-panel-purpose') as HTMLSpanElement;
const infoPanelApogee = document.getElementById('info-panel-apogee') as HTMLSpanElement;
const infoPanelPerigee = document.getElementById('info-panel-perigee') as HTMLSpanElement;

// SATELLITE CATALOG
interface SatCatEntry {
    apogee: string;
    perigee: string;
}
const satelliteCatalog = new Map<string, SatCatEntry>();

const loadSatelliteCatalog = async () => {
    console.log("Loading satellite catalog...");
    const proxyUrl = 'https://cors-noproblem.onrender.com/';
    const satCatUrl = 'https://celestrak.org/pub/satcat.txt';
    try {
        const response = await fetch(proxyUrl + satCatUrl);
        const text = await response.text();
        const lines = text.split(/\r?\n/);
        lines.forEach(line => {
            // Final, correct parsing based on the official satcat-format.php
            const noradId = line.substring(13, 18).trim();
            const apogee = line.substring(93, 100).trim();
            const perigee = line.substring(101, 108).trim();

            if (noradId) {
                satelliteCatalog.set(noradId, { apogee, perigee });
            }
        });
        console.log(`Satellite catalog loaded with ${satelliteCatalog.size} entries.`);
    } catch (error) {
        console.error("Could not load satellite catalog:", error);
    }
};
loadSatelliteCatalog(); // Load catalog on startup

//IMPORT DATA FROM JSON FILES
import TLEsources from './TLEsources.json'; //TLE satellites data sources
import translations from './translations.json'; //translations data

//SET UI STRINGS DEPENDING ON BROWSER LANGUAGE
const userLang = (navigator.language || (navigator as Navigator & { userLanguage?: string }).userLanguage || 'en').slice(0, 2);
if (userLang !== undefined) {
    const translation = translations.find((tr: { language: string; strings: { id: string; text: string }[] }) => { return tr.language === userLang });
    if (translation !== undefined) {
        translation.strings.forEach((str: { id: string; text: string }) => {
            const element = document.getElementById(str.id);
            if (element) {
                element.innerHTML = str.text;
            }
        });
    }
}

//ADD SOURCES BUTTONS
const btnsEntryPoint = document.getElementById('buttons-entry-point');
TLEsources.forEach((src: { [key: string]: string }) => {
    let labelLang = 'label-en';
    if (src[`label-${userLang}`] !== undefined) {
        labelLang = `label-${userLang}`;
    }
    const btnHTML = `<button class="cesium-button" type="button" name="enable-satellites">${src[labelLang]}</button>`;
    btnsEntryPoint?.insertAdjacentHTML('beforeend', btnHTML);
});

//===============================================================
//USER INTERFACE ACTIONS
//menu button
const menuButton = document.getElementById("menu-button");
if (menuButton) {
    menuButton.onclick = () => {
        const o = document.getElementById("options");
        if (o) {
            o.style.display = o.style.display === "block" ? "none" : "block";
        }
    };
}
// disable satellites button
const disableSatellitesButton = document.getElementById("tr-disable-satellites");
if (disableSatellitesButton) {
    disableSatellitesButton.onclick = () => {
        deleteSatellites();
    };
}
// any enable satellites button
document.getElementsByName("enable-satellites").forEach((el, i) => (el as HTMLElement).onclick = () => {
    deleteSatellites();
    getData(TLEsources[i].url);
});

//switch1
(document.getElementById("sw1") as HTMLInputElement).onclick = () => {
    if ((document.getElementById("sw1") as HTMLInputElement).checked) {
        globe.enableLighting = true;
    } else {
        globe.enableLighting = false;
    }
}
//switch2
const sw2 = document.getElementById("sw2") as HTMLInputElement;
sw2.onclick = () => {
    if (sw2.checked) {
        disableCamIcrf();
    } else {
        enableCamIcrf();
    }
}

//deletes all satellites
const deleteSatellites = () => {
    satellitesData = [];
    displayedOrbit = undefined;
    polylines.removeAll();
    entities.removeAll();
}

//camera lock functions
const disableCamIcrf = () => { //locks camera on the globe
    scene.postUpdate.removeEventListener(cameraIcrf);
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}
const enableCamIcrf = () => { //locks camera in space
    scene.postUpdate.addEventListener(cameraIcrf);
}
const cameraIcrf = (scene: Cesium.Scene, time: Cesium.JulianDate) => {
    if (scene.mode !== Cesium.SceneMode.SCENE3D) {
        return;
    }
    const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(time);
    if (icrfToFixed !== undefined) {
        const camera = viewer.camera;
        const offset = Cesium.Cartesian3.clone(viewer.camera.position);
        const transform = Cesium.Matrix4.fromRotationTranslation(icrfToFixed);
        camera.lookAtTransform(transform, offset);
    }
}
//lock orbit in space
const orbitIcrf = (_scene: Cesium.Scene, time: Cesium.JulianDate) => {
    if (polylines.length) {
        const mat = Cesium.Transforms.computeTemeToPseudoFixedMatrix(time);
        polylines.modelMatrix = Cesium.Matrix4.fromRotationTranslation(mat);
    }
}

const getSatelliteColor = (satName: string): Cesium.Color => {
    const upperCaseName = satName.toUpperCase();
    if (upperCaseName.includes('GPS')) return Cesium.Color.LIME; // Navigation
    if (upperCaseName.includes('NOAA') || upperCaseName.includes('METEOSAT') || upperCaseName.includes('METEOR')) return Cesium.Color.CYAN; // Weather
    if (upperCaseName.includes('STARLINK') || upperCaseName.includes('ONEWEB') || upperCaseName.includes('IRIDIUM')) return Cesium.Color.ORANGE; // Communication
    if (upperCaseName.includes('ISS') || upperCaseName.includes('TIANGONG') || upperCaseName.includes('HUBBLE')) return Cesium.Color.MAGENTA; // Science/Station
    if (upperCaseName.includes('COSMOS') || upperCaseName.includes('USA') || upperCaseName.includes('NROL')) return Cesium.Color.RED; // Military/Other
    return Cesium.Color.WHITE; // Default
};

const addSatelliteMarker = ([satName, satrec]: [string, satellite.SatRec]) => {
    const posvel = satellite.propagate(satrec, Cesium.JulianDate.toDate(clock.currentTime));
    if (typeof posvel.position === 'boolean') return;
    const gmst = satellite.gstime(Cesium.JulianDate.toDate(clock.currentTime));
    const pos = Object.values(satellite.eciToEcf(posvel.position, gmst)).map((el: number) => el *= 1000); //position km->m

    const color = getSatelliteColor(satName);

    const entity = new Cesium.Entity({
        name: satName,
        position: Cesium.Cartesian3.fromArray(pos),
    });
    entity.point = new Cesium.PointGraphics({
        pixelSize: 8,
        color: color,
    });
    entity.label = new Cesium.LabelGraphics({
        show: new Cesium.ConstantProperty(false),
        text: new Cesium.ConstantProperty(satName),
        showBackground: new Cesium.ConstantProperty(true),
        font: "16px monospace",
        horizontalOrigin: new Cesium.ConstantProperty(Cesium.HorizontalOrigin.LEFT),
        verticalOrigin: new Cesium.ConstantProperty(Cesium.VerticalOrigin.CENTER),
        pixelOffset: new Cesium.ConstantProperty(new Cesium.Cartesian2(10, 0)),
        eyeOffset: new Cesium.ConstantProperty(Cesium.Cartesian3.fromElements(0, 0, -10000)),
    });
    entities.add(entity);
}

//ORBIT CALCULATION
const calculateOrbit = (satrec: satellite.SatRec) => {
    try {
        //init
        const orbitPoints: Cesium.Cartesian3[] = []; //array for calculated points
        const period = (2 * Math.PI) / satrec.no; // orbital period in minutes
        const timeStep = period / orbitSteps; //time interval between points on orbit
        const baseTime = new Cesium.JulianDate(); //time of the first point
        Cesium.JulianDate.addMinutes(clock.currentTime, -period / 2, baseTime); //sets base time to the half period ago
        const tempTime = new Cesium.JulianDate(); //temp date for calculations

        //calculate points in ECI coordinate frame
        for (let i = 0; i <= orbitSteps; i++) {
            Cesium.JulianDate.addMinutes(baseTime, i * timeStep, tempTime);
            const posvelTemp = satellite.propagate(satrec, Cesium.JulianDate.toDate(tempTime));
            if (posvelTemp.position && typeof posvelTemp.position !== 'boolean') {
                orbitPoints.push(Cesium.Cartesian3.fromArray(Object.values(posvelTemp.position)));
            }
        }

        //convert coordinates from kilometers to meters
        orbitPoints.forEach((point) => Cesium.Cartesian3.multiplyByScalar(point, 1000, point));

        //polyline material
        const polylineMaterial = new Cesium.Material({
            fabric: {
                type: 'Color',
                uniforms: {
                    color: Cesium.Color.YELLOW
                }
            }
        });

        polylines.removeAll();
        polylines.add({
            positions: orbitPoints,
            width: 1,
            material: polylineMaterial,
            id: 'orbit'
        });

        displayedOrbit = [satrec, period * 30];
    } catch (error) {
        console.log('This satellite is deorbited.');
    }

};

const clearOrbit = () => {
    displayedOrbit = undefined;
    polylines.removeAll();
}

const drawFootprint = (satrec: satellite.SatRec) => {
    const posvel = satellite.propagate(satrec, Cesium.JulianDate.toDate(clock.currentTime));
    if (typeof posvel.position === 'boolean' || !posvel.position) return;

    const gmst = satellite.gstime(Cesium.JulianDate.toDate(clock.currentTime));
    const positionEcf = satellite.eciToEcf(posvel.position, gmst);
    if (typeof positionEcf === 'boolean') return;

    const positionCartesian = new Cesium.Cartesian3(positionEcf.x * 1000, positionEcf.y * 1000, positionEcf.z * 1000);
    
    const cartographic = Cesium.Cartographic.fromCartesian(positionCartesian);
    const subSatellitePosition = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
    const altitude = cartographic.height;

    // Calculate footprint radius more accurately using great-circle distance
    const earthRadius = 6371000; // meters
    const footprintRadius = earthRadius * Math.acos(earthRadius / (earthRadius + altitude));

    if (footprintEntity) {
        viewer.entities.remove(footprintEntity);
    }

    footprintEntity = viewer.entities.add(new Cesium.Entity({
        position: subSatellitePosition,
        ellipse: new Cesium.EllipseGraphics({
            semiMajorAxis: new Cesium.ConstantProperty(footprintRadius),
            semiMinorAxis: new Cesium.ConstantProperty(footprintRadius),
            material: Cesium.Color.GREEN.withAlpha(0.3),
            outline: true,
            outlineColor: Cesium.Color.GREEN,
            height: new Cesium.ConstantProperty(1000.0),
        }),
    }));
};

const removeFootprint = () => {
    if (footprintEntity) {
        viewer.entities.remove(footprintEntity);
        footprintEntity = undefined;
    }
};

const updateOrbit = () => {
    if (displayedOrbit !== undefined) {
        if (clock.currentTime.equalsEpsilon(lastOrbitUpdateTime, displayedOrbit[1]) === false) {
            lastOrbitUpdateTime = clock.currentTime;
            calculateOrbit(displayedOrbit[0]);
        }
    }
}

const updateSatellites = () => { //updates satellites positions
    if (satellitesData.length && viewer.clockViewModel.shouldAnimate) {
        const gmst = satellite.gstime(Cesium.JulianDate.toDate(clock.currentTime));
        satellitesData.forEach(([, satrec]: [string, satellite.SatRec], index) => { //update satellite entity position
            try {
                const posvel = satellite.propagate(satrec, Cesium.JulianDate.toDate(clock.currentTime));
                if (typeof posvel.position === 'boolean') throw new Error('Satellite position is boolean');
                const pos = Object.values(satellite.eciToEcf(posvel.position, gmst)).map((el: number) => el *= 1000); //position km->m

                const entity = entities.values[index];
                (entity.position as Cesium.PositionProperty) = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromArray(pos)); //update satellite position
                
                if (currentlySelected && currentlySelected.id === entity.id) {
                    updateLiveInfoPanelData(satrec);
                }

            } catch (error) {
                (entities.values[index].point as Cesium.PointGraphics).color = new Cesium.ConstantProperty(Cesium.Color.RED); //update point color
            }
        });
    }
};

const updateLiveInfoPanelData = (satrec: satellite.SatRec) => {
    const posvel = satellite.propagate(satrec, Cesium.JulianDate.toDate(clock.currentTime));
    if (typeof posvel.position === 'boolean' || typeof posvel.velocity === 'boolean') return;

    const period = (2 * Math.PI) / satrec.no; // orbital period in minutes
    const velocity = Math.sqrt(posvel.velocity.x ** 2 + posvel.velocity.y ** 2 + posvel.velocity.z ** 2);
    const altitude = Math.sqrt(posvel.position.x ** 2 + posvel.position.y ** 2 + posvel.position.z ** 2) - 6371; // Subtract Earth's radius

    infoPanelPeriod.innerText = period.toFixed(2);
    infoPanelAltitude.innerText = altitude.toFixed(2);
    infoPanelVelocity.innerText = velocity.toFixed(2);
}

const getCountryInfoFromName = (satName: string): { countryName: string, flag: string } => {
    const upperCaseName = satName.toUpperCase();
    if (upperCaseName.includes('USA') || upperCaseName.includes('GPS') || upperCaseName.includes('IRIDIUM') || upperCaseName.includes('STARLINK') || upperCaseName.includes('NOAA') || upperCaseName.includes('GOES') || upperCaseName.includes('NROL')) {
        return { countryName: "USA", flag: "🇺🇸" };
    }
    if (upperCaseName.includes('GLONASS') || upperCaseName.includes('COSMOS') || upperCaseName.includes('METEOR')) {
        return { countryName: "Russia", flag: "🇷🇺" };
    }
    if (upperCaseName.includes('PRC') || upperCaseName.includes('BEIDOU') || upperCaseName.includes('TIANGONG') || upperCaseName.includes('FENGYUN')) {
        return { countryName: "China", flag: "🇨🇳" };
    }
    if (upperCaseName.includes('ESA') || upperCaseName.includes('GALILEO') || upperCaseName.includes('METEOSAT') || upperCaseName.includes('SENTINEL')) {
        return { countryName: "European Space Agency", flag: "🇪🇺" };
    }
    if (upperCaseName.includes('UK') || upperCaseName.includes('ONEWEB')) {
        return { countryName: "United Kingdom", flag: "🇬🇧" };
    }
    if (upperCaseName.includes('JPN')) {
        return { countryName: "Japan", flag: "🇯🇵" };
    }
    if (upperCaseName.includes('IND')) {
        return { countryName: "India", flag: "🇮🇳" };
    }
    if (upperCaseName.includes('CA')) {
        return { countryName: "Canada", flag: "🇨🇦" };
    }
    if (upperCaseName.includes('ISS')) {
        return { countryName: "International", flag: "🌍" };
    }
    return { countryName: "Unknown", flag: "🛰️" };
}

const updateInfoPanel = (satName: string, satrec: satellite.SatRec) => {
    // Data Retrieval from Catalog
    const noradId = satrec.satnum.trim();
    const catalogData = satelliteCatalog.get(noradId);

    // Update Panel Title
    infoPanelTitle.innerText = satName;

    // Country and Flag (Inferred from Name)
    const { countryName, flag } = getCountryInfoFromName(satName);
    infoPanelCountry.innerText = `${flag} ${countryName}`;

    // Coverage Area Calculation
    const posvel = satellite.propagate(satrec, Cesium.JulianDate.toDate(clock.currentTime));
    if (typeof posvel.position !== 'boolean' && posvel.position) {
        const positionCartesian = new Cesium.Cartesian3(posvel.position.x * 1000, posvel.position.y * 1000, posvel.position.z * 1000);
        const cartographic = Cesium.Cartographic.fromCartesian(positionCartesian);
        const altitude = cartographic.height;
        const earthRadius = 6371000; // meters
        const coverageRadius = earthRadius * Math.acos(earthRadius / (earthRadius + altitude));
        const coverageArea = 2 * Math.PI * Math.pow(earthRadius / 1000, 2) * (1 - Math.cos(coverageRadius / earthRadius));
        infoPanelCoverage.innerText = coverageArea.toLocaleString(undefined, { maximumFractionDigits: 0 });
    } else {
        infoPanelCoverage.innerText = 'N/A';
    }

    // Orbit Info from Catalog
    infoPanelApogee.innerText = catalogData?.apogee || 'N/A';
    infoPanelPerigee.innerText = catalogData?.perigee || 'N/A';

    // Infer purpose from name
    const purposeTranslations: { [key: string]: string } = {
        "Navigation": "Navigasyon",
        "Weather": "Hava Durumu",
        "Communication": "İletişim",
        "Science/Station": "Bilim/İstasyon",
        "Military/Other": "Askeri/Diğer",
        "Unknown": "Bilinmiyor"
    };

    let purpose = "Unknown";
    const upperCaseName = satName.toUpperCase();
    if (upperCaseName.includes('GPS') || upperCaseName.includes('GLONASS') || upperCaseName.includes('GALILEO') || upperCaseName.includes('BEIDOU')) purpose = "Navigation";
    else if (upperCaseName.includes('NOAA') || upperCaseName.includes('METEOSAT') || upperCaseName.includes('METEOR') || upperCaseName.includes('GOES')) purpose = "Weather";
    else if (upperCaseName.includes('STARLINK') || upperCaseName.includes('ONEWEB') || upperCaseName.includes('IRIDIUM')) purpose = "Communication";
    else if (upperCaseName.includes('ISS') || upperCaseName.includes('TIANGONG') || upperCaseName.includes('HUBBLE')) purpose = "Science/Station";
    else if (upperCaseName.includes('COSMOS') || upperCaseName.includes('USA') || upperCaseName.includes('NROL')) purpose = "Military/Other";
    
    const translatedPurpose = userLang === 'tr' ? purposeTranslations[purpose] || purpose : purpose;
    infoPanelPurpose.innerText = translatedPurpose;

    // Update live data for the first time
    updateLiveInfoPanelData(satrec);

    // Show panel
    infoPanel.style.display = 'block';
};

const setLoadingData = (bool: boolean) => { //shows loading bar
    dataLoadingInProgress = bool;
    // const loadingBar = document.getElementById("progress-bar");
    // if (bool) {
    //     loadingBar.style.visibility = "visible";
    // } else {
    //     loadingBar.style.visibility = "hidden";
    // }
}

const getData = async (targetUrl: string) => { //get TLE data using CORS proxy
    if (dataLoadingInProgress === false) {
        setLoadingData(true);

        const proxyUrl = 'https://cors-noproblem.onrender.com/';
        const response = await fetch(proxyUrl + targetUrl);
        let textLines = (await response.text()).split(/\r?\n/); //split file to separate lines
        textLines = textLines.filter(e => { return e }); //delete empty lines at the eof

        if (textLines.length) {
            const tempSatellitesData: [string, satellite.SatRec][] = [];
            //read file line by line
            try {
                for (let i = 0; i < textLines.length; i += 3) {
                    //check if TLE texts length is correct
                    if (textLines[i].length === 24 && textLines[i + 1].length === 69 && textLines[i + 2].length === 69) {
                        const tempSatrec = satellite.twoline2satrec(textLines[i + 1], textLines[i + 2]);

                        //check if TLE is valid
                        if (satellite.propagate(tempSatrec, Cesium.JulianDate.toDate(clock.currentTime)).position === undefined) {
                            continue; //skips this loop iteration
                        }
                        tempSatellitesData.push([textLines[i].trim(), tempSatrec]);
                    } else {
                        throw `Error: The TLE data file can't be processed. The file may be corrupted.`
                    }
                }
            } catch (error) {
                console.log(error);
                setLoadingData(false);
            }
            tempSatellitesData.forEach(sat => addSatelliteMarker(sat)); //create point entities
            satellitesData.push(...tempSatellitesData); //add satellites to updated satellites array
        }
        setLoadingData(false);
    }
}

const updateFPScounter = () => {
    const fps = frameRateMonitor.lastFramesPerSecond;
    if (fps) {
        const fpsElement = document.getElementById('fps');
        if (fpsElement) {
            fpsElement.innerText = fps.toFixed(0).toString();
        }
    }
}

const checkCameraZoom = () => { //changes state of camera lock switch depending on camera zoom
    setTimeout(() => {
        if (scene.mode === Cesium.SceneMode.SCENE3D) {
            if (viewer.camera.getMagnitude() < 13000000) {
                disableCamIcrf();
                sw2.checked = true;
                sw2.disabled = true;
            } else {
                sw2.disabled = false;
            }
        }
    }, 10);
}

setInterval(updateSatellites, satUpdateIntervalTime); //enables satellites positions update
setInterval(updateFPScounter, 500);
scene.postUpdate.addEventListener(cameraIcrf); //enables camera lock at the start
scene.postUpdate.addEventListener(orbitIcrf); //enables orbit lock at the start
scene.postUpdate.addEventListener(updateOrbit); //enables orbit update
// viewer.camera.changed.addEventListener(checkCameraZoom);

//USER INPUT HANDLERS
// eslint-disable-next-line @typescript-eslint/no-empty-function
viewer.screenSpaceEventHandler.setInputAction(() => { }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK); //reset default doubleclick handler

const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas); //custom event handler
handler.setInputAction((input: { position: Cesium.Cartesian2 }) => { //left click input action
    const pickedObject = scene.pick(input.position);

    if (pickedObject && pickedObject.id instanceof Cesium.Entity) {
        const pickedEntity = pickedObject.id;

        if (currentlySelected && currentlySelected.id === pickedEntity.id) {
            // Second click on the same satellite: query chatbot
            const satName = pickedEntity.name;
            const query = `${satName} uydusu hakkında bilgi ver`;
            chatbotInput.value = query;
            sendMessage();

            // Make sure the chatbot is visible
            if (!chatbotContainer.classList.contains('visible')) {
                chatbotContainer.classList.add('visible');
            }

            // Deselect after querying
            if (pickedEntity.label) {
                pickedEntity.label.show = new Cesium.ConstantProperty(false);
            }
            clearOrbit();
            removeFootprint();
            currentlySelected = undefined;
        } else {
            // First click on a new satellite: select it
            // Deselect previously selected entity
            if (currentlySelected && currentlySelected.label) {
                currentlySelected.label.show = new Cesium.ConstantProperty(false);
            }
            removeFootprint(); // Remove footprint of the previously selected satellite

            // Select the new entity
            if (pickedEntity.label) {
                pickedEntity.label.show = new Cesium.ConstantProperty(true);
            }
            const satData = satellitesData.find(el => el[0] === pickedEntity.name);
            if (satData) {
                calculateOrbit(satData[1]);
                drawFootprint(satData[1]);
                updateInfoPanel(pickedEntity.name || "Unknown Satellite", satData[1]);
            }
            currentlySelected = pickedEntity;
        }
    } else {
        // Clicked on empty space: deselect everything
        if (currentlySelected && currentlySelected.label) {
            currentlySelected.label.show = new Cesium.ConstantProperty(false);
            clearOrbit();
            removeFootprint();
            currentlySelected = undefined;
            infoPanel.style.display = 'none';
        }
    }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

handler.setInputAction(() => { //mouse scroll
    checkCameraZoom();
}, Cesium.ScreenSpaceEventType.WHEEL);
// CHATBOT IMPLEMENTATION
const chatbotSendButton = document.getElementById('chatbot-send') as HTMLButtonElement;
const chatbotInput = document.getElementById('chatbot-input') as HTMLInputElement;
const chatbotMessages = document.getElementById('chatbot-messages') as HTMLDivElement;

const apiKey = process.env.OPENAI_API_KEY || '';
const apiUrl = 'https://api.openai.com/v1/chat/completions';

const addMessage = (message: string, sender: 'user' | 'bot') => {
  const messageElement = document.createElement('div');
  messageElement.classList.add(sender === 'user' ? 'user-message' : 'bot-message');
  messageElement.innerText = message;
  chatbotMessages.appendChild(messageElement);
  chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
};

const getBotResponse = async (userMessage: string) => {
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'Sen bir uydu takip uygulaması için yardımcı bir asistansın. Yanıtlarını uzayla ilgili terminoloji ve metaforlar kullanarak Türkçe ver. Cevaplarını kısa ve uzay araştırmaları, astronomi ve uydularla ilgili tut.'
          },
          {
            role: 'user',
            content: userMessage
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error('API request failed');
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Error fetching from OpenAI:', error);
    return 'İletişim sistemlerim kozmik bir parazitle karşılaştı. Lütfen daha sonra tekrar deneyin.';
  }
};

const sendMessage = async () => {
  const userMessage = chatbotInput.value.trim();
  if (userMessage === '') return;

  addMessage(userMessage, 'user');
  chatbotInput.value = '';

  const botMessage = await getBotResponse(userMessage);
  addMessage(botMessage, 'bot');
};

chatbotSendButton.addEventListener('click', sendMessage);
chatbotInput.addEventListener('keypress', (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

// Initial bot message
setTimeout(() => {
    addMessage("Selamlar, yıldız gözlemcisi! Ben senin göksel rehberinim. Bana evren hakkında her şeyi sorabilirsin.", "bot");
}, 1000);
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

const addSatelliteMarker = ([satName, satrec]: [string, satellite.SatRec]) => {
    const posvel = satellite.propagate(satrec, Cesium.JulianDate.toDate(clock.currentTime));
    if (typeof posvel.position === 'boolean') return;
    const gmst = satellite.gstime(Cesium.JulianDate.toDate(clock.currentTime));
    const pos = Object.values(satellite.eciToEcf(posvel.position, gmst)).map((el: number) => el *= 1000); //position km->m

    const entity = new Cesium.Entity({
        name: satName,
        position: Cesium.Cartesian3.fromArray(pos),
    });
    entity.point = new Cesium.PointGraphics({
        pixelSize: 8,
        color: Cesium.Color.YELLOW,
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

                (entities.values[index].position as Cesium.PositionProperty) = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromArray(pos)); //update satellite position
                (entities.values[index].point as Cesium.PointGraphics).color = new Cesium.ConstantProperty(Cesium.Color.YELLOW); //update point color
            } catch (error) {
                (entities.values[index].point as Cesium.PointGraphics).color = new Cesium.ConstantProperty(Cesium.Color.RED); //update point color
            }
        });
    }
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
    const picked = scene.pick(input.position);
    if (picked) {
        const entity = Cesium.defaultValue(picked.id, picked.primitive.id);
        if (entity instanceof Cesium.Entity) {
            const labelShow = entity.label?.show;
            if (labelShow && labelShow.getValue && labelShow.getValue() === false) {
                if (entity.label) {
                    entity.label.show = new Cesium.ConstantProperty(true);
                }
                const satData = satellitesData.find(el => el[0] === entity.name);
                if (satData) {
                    calculateOrbit(satData[1]);
                }
            } else {
                if (entity.label) {
                    entity.label.show = new Cesium.ConstantProperty(false);
                }
                clearOrbit();
            }
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

const apiKey = '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';
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
        model: 'gpt-3.5-turbo',
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
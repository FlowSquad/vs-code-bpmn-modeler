import $ from 'jquery';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import {
    BpmnPropertiesPanelModule,
    BpmnPropertiesProviderModule,
    CamundaPlatformPropertiesProviderModule,
    ElementTemplatesPropertiesProviderModule
} from "bpmn-js-properties-panel";
import {FilesContent} from "../../src/types";

// Property Extensions
import CamundaPlatformBehaviors from 'camunda-bpmn-js-behaviors/lib/camunda-platform';
import camundaModdleDescriptors from 'camunda-bpmn-moddle/resources/camunda';
import miragonProviderModule from '../lib/PropertieProvider/provider/index';
import ElementTemplateChooserModule from '@bpmn-io/element-template-chooser';
import TokenSimulationModule from 'bpmn-js-token-simulation';

// css
import './app.css';
import '../../node_modules/bpmn-js/dist/assets/bpmn-js.css';
import '../../node_modules/bpmn-js/dist/assets/diagram-js.css';
import '../../node_modules/bpmn-js-properties-panel/dist/assets/properties-panel.css';
import '../../node_modules/bpmn-js-properties-panel/dist/assets/element-templates.css';
import '../../node_modules/@bpmn-io/element-template-chooser/dist/element-template-chooser.css';
import '../../node_modules/bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css';

//default diagram - relative from dist
import EMPTY_DIAGRAM_XML from '../../resources/bpmn/empty.bpmn?raw';

// example element template
import sendMail from '../../examples/element-templates/mail-task-template.json';

// Only for developing
const ENVIROMENTS = {
    Browser: 'browser',
    VsCode: 'vscode'
};
// Browser modelling is not supported
const ENV = ENVIROMENTS.VsCode;

const container = $('#js-drop-zone');
let files;
let configs = [];
let templates = [];
window.forms = [];

// for env === browser
let textarea;

if (ENV === 'vscode') {
    // 'vscode' is set before we load this script
    const state = vscode.getState();
    if (state) {
        if (state.files !== 'undefined') {
            files = JSON.parse(state.files);
            setFilesContent(files);
        }
    }

} else if (ENV === 'browser') {
    templates = [sendMail];

    const simulator = document.createElement('div');  // simulates vscode respectively the document
    textarea = document.createElement('textarea');
    const style = document.createElement('style');

    simulator.className = 'simulator';
    textarea.className = 'editor';
    style.textContent = `
       .content {
           height: 70%;
       }
       .simulator {
           width: 100%;
           height: 30%;
       }
       .editor {
           width: 100%;
           height: 100%;
           resize: none;
       }
    `;

    simulator.appendChild(style);
    simulator.appendChild(textarea);
    document.body.appendChild(simulator);
}

const modeler = new BpmnModeler({
    container: '#js-canvas',
    keyboard: {
        bindTo: document
    },
    propertiesPanel: {
        parent: '#js-properties-panel'
    },
    additionalModules: [
        // standard properties panel
        BpmnPropertiesPanelModule,
        BpmnPropertiesProviderModule,
        // camunda properties panel
        CamundaPlatformPropertiesProviderModule,
        CamundaPlatformBehaviors,
        // element templates
        ElementTemplatesPropertiesProviderModule,
        ElementTemplateChooserModule,
        // form simplifier
        miragonProviderModule,
        // simulator
        TokenSimulationModule
    ],
    moddleExtensions: {
        camunda: camundaModdleDescriptors
    }
});
// load templates, and console.error the ones that can't be loaded
modeler.on('elementTemplates.errors', event => {
    const { errors } = event;
    showTemplateErrors(errors);
});
modeler.get('elementTemplatesLoader').setTemplates(templates);

container.removeClass('with-diagram');

async function importDiagram(xml) {

    if (!xml || xml === '""') {
        xml = EMPTY_DIAGRAM_XML;
    }

    if (ENV === 'vscode') {
        // Set state when diagram is opened
        vscode.setState({
            ...vscode.getState(),
            text: xml
        });
    }

    try {
        await modeler.importXML(xml);
        container
            .removeClass('with-error')
            .addClass('with-diagram');
    } catch (err) {
        container
            .removeClass('with-diagram')
            .addClass('with-error');

        container.find('.error pre').text(err.message);
        console.error(err);
    }
}

async function exportDiagram() {
    return (await modeler.saveXML({format: true}));
}

/**
 * @param {FilesContent[]} files
 */
function setFilesContent(files) {
    files.forEach((file) => {
        switch (file.type) {
            case 'config': {
                configs = file.content;
                break;
            }
            case 'element-template': {
                templates = file.content;
                break;
            }
            case 'form': {
                window.forms = file.content; //forms needs to be on window layer, so we can work with it in FormSimpProps
                break;
            }
        }
    });
}

// main
$(function () {
    if (ENV === 'vscode') {
        const state = vscode.getState();
        if (state) {
            importDiagram(state.text);
        }

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.type) {
                case 'bpmn-modeler.undo':
                case 'bpmn-modeler.redo':
                case 'bpmn-modeler.updateFromExtension': {
                    const xml = message.text;
                    importDiagram(xml);
                    return;
                }
                case 'FileSystemWatcher.reloadFiles': {
                    setFilesContent(message.text);
                    var loader = modeler.get('elementTemplatesLoader');
                    loader.setTemplates(templates);
                }
            }
        });

    } else if (ENV === 'browser') {
        importDiagram();
    }

    const updateExtension = debounce(async function () {

        try {
            exportDiagram()
                .then((content) => {
                    if (ENV === 'vscode') {
                        // Set state when changes occur
                        vscode.setState({
                            ...vscode.getState(),
                            text: content.xml,
                        });
                        // Send update to extension
                        vscode.postMessage({
                            type: 'bpmn-modeler.updateFromWebview', content: content.xml
                        });
                    } else if (ENV === 'browser') {
                        textarea.value = content.xml;
                    }
                });

        } catch (err) {
            console.error('Error happened saving XML: ', err);
        }
    }, 500);

    modeler.on('commandStack.changed', updateExtension);
});


//  ---------------HELPERS---------------  \\
function debounce(fn, timeout) {
    let timer;

    return function () {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(fn, timeout);
    };
}

function showTemplateErrors(errors) {
    console.error('Failed to parse element templates', errors);

    // document.querySelector('.error-panel pre').textContent = `Failed to parse element templates:
    //     ${errors.map(error => error.message).join('\n    ')}
    //     Check the developer tools for details.`;
    // document.querySelector('.error-panel').classList.toggle('hidden');
}
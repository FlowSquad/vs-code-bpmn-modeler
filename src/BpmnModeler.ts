import * as vscode from 'vscode';
import {FileSystemScanner} from "./lib/FileSystemScanner";
import {Workspace} from "./types";

type FilesContent = {
    configs: JSON[] | string[],
    elementTemplates: JSON[] | string[],
    forms: JSON[] | string[]
};

export class BpmnModeler implements vscode.CustomTextEditorProvider {

    public static readonly viewType = 'bpmn-modeler';

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new BpmnModeler(context);
        return vscode.window.registerCustomEditorProvider(BpmnModeler.viewType, provider);
    }

    public constructor(
        private readonly context: vscode.ExtensionContext
    ) {    }

    /**
     * Called when the custom editor / source file is opened
     * @param document Represents the source file
     * @param webviewPanel Panel that contains the webview
     * @param token Token to cancel asynchronous or long-running operations
     */
    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
        ): Promise<void> {

        let isUpdateFromWebview = false;
        let isBuffer = false;

        webviewPanel.webview.options = { enableScripts: true };

        const projectUri = vscode.Uri.parse(this.getProjectUri(document.uri.toString()));
        try {
            const fileSystemScanner = new FileSystemScanner(projectUri, await getWorkspace());
            const fileContent: FilesContent = {
                configs: [],
                elementTemplates: [],
                forms: []
            };
            const files = await fileSystemScanner.getAllFiles();
            files.forEach((file, index) => {
                if (file.status === 'fulfilled') {
                    switch (index) {
                        case 0: {
                            fileContent.configs = file.value;
                            break;
                        }
                        case 1: {
                            fileContent.elementTemplates = file.value;
                            break;
                        }
                        case 2: {
                            fileContent.forms = file.value;
                            break;
                        }
                    }
                } else {
                    switch (index) {
                        case 0: {
                            fileContent.configs = [];
                            break;
                        }
                        case 1: {
                            fileContent.elementTemplates = [];
                            break;
                        }
                        case 2: {
                            fileContent.forms = [];
                            break;
                        }
                    }
                }
            });
            webviewPanel.webview.html =
                this.getHtmlForWebview(webviewPanel.webview, this.context.extensionUri, document.getText(), fileContent);
        } catch (error) {
            console.log('miragon-gmbh.vs-code-bpmn-modeler -> ' + error);
            webviewPanel.webview.html =
                this.getHtmlForWebview(webviewPanel.webview, this.context.extensionUri, document.getText());
        }

        async function getWorkspace() {
            try {
                const file = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(projectUri, 'process-ide.json'));
                const workspaceFolder: Workspace = JSON.parse(Buffer.from(file).toString('utf-8')).workspace;
                return workspaceFolder;
            } catch(error) {
                throw new Error('File \"process-ide.json\" could not be found!');
            }
        }

        webviewPanel.webview.onDidReceiveMessage((event) => {
            switch (event.type) {
                case BpmnModeler.viewType + '.updateFromWebview':
                    isUpdateFromWebview = true;
                    this.updateTextDocument(document, event.content);
                    break;
            }
        });

        const updateWebview = (msgType: string) => {
            if (webviewPanel.visible) {
                webviewPanel.webview.postMessage({
                    type: msgType,
                    text: document.getText()
                })
                    .then((result) => {
                        if (result) {
                            // ...
                        }
                    }, (reason) => {
                        if (!document.isClosed) {
                            console.error('BPMN Modeler:', reason);
                        }
                    });
            }
        };

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.toString() === document.uri.toString() && event.contentChanges.length !== 0) {
                if (!webviewPanel.visible) {
                    isBuffer = true;
                    return;
                }

                switch (event.reason) {
                    case 1: {
                        updateWebview(BpmnModeler.viewType + '.undo');
                        break;
                    }
                    case 2: {
                        updateWebview(BpmnModeler.viewType + '.redo');
                        break;
                    }
                    case undefined: {
                        if (!isUpdateFromWebview) {
                            updateWebview(BpmnModeler.viewType + '.updateFromExtension');
                        }
                        isUpdateFromWebview = false;
                        break;
                    }
                }
            }
        });

        webviewPanel.onDidChangeViewState(() => {
            switch (true) {
                case webviewPanel.visible: {
                    if (isBuffer) {
                        updateWebview(BpmnModeler.viewType + '.updateFromExtension');
                        isBuffer = false;
                    }
                    break;
                }
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri, initialContent: string, files?: FilesContent) {

        const scriptApp = webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri, 'dist', 'client', 'client.mjs'
        ));

        const styleReset = webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri, 'resources', 'css', 'reset.css'
        ));

        const styleApp = webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri, 'dist', 'client', 'style.css'
        ));

        const fontBpmn = webview.asWebviewUri(vscode.Uri.joinPath(
            extensionUri, 'dist', 'client', 'assets', 'bpmn-font', 'css', 'bpmn.css'
        ));

        const nonce = this.getNonce();

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="utf-8" />

                <meta http-equiv="Content-Security-Policy" content="default-src 'none';
                    style-src ${webview.cspSource} 'unsafe-inline';
                    img-src ${webview.cspSource} data:;
                    font-src ${webview.cspSource};
                    script-src 'nonce-${nonce}';"/>

                <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
                
                <link href="${styleReset}" rel="stylesheet" type="text/css" />
                <link href="${styleApp}" rel="stylesheet" type="text/css" />
                <link href="${fontBpmn}" rel="stylesheet" type="text/css" />

                <title>Custom Texteditor Template</title>
            </head>
            <body>
              <div class="content with-diagram" id="js-drop-zone">

                <div class="message error">
                  <div class="note">
                    <p>Ooops, we could not display the BPMN 2.0 diagram.</p>

                    <div class="details">
                      <span>Import Error Details</span>
                      <pre></pre>
                    </div>
                  </div>
                </div>

                <div class="canvas" id="js-canvas"></div>
                <div class="properties-panel-parent" id="js-properties-panel"></div>
              </div>
              
              <script type="text/javascript" nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                const state = vscode.getState();
                if (!state) {
                    vscode.setState({
                      text: '${JSON.stringify(initialContent)}',
                      files: '${JSON.stringify(files)}'    // serialize files-Array
                    });
                }
              </script>
              <script type="text/javascript" src="${scriptApp}" nonce="${nonce}"></script>
            </body>
            </html>
        `;
    }

    //     -----------------------------HELPERS-----------------------------     \\
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private updateTextDocument(document: vscode.TextDocument, text: string): Thenable<boolean> {
        const edit = new vscode.WorkspaceEdit();

        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            text
        );

        return vscode.workspace.applyEdit(edit);
    }

    private getProjectUri(path: string): string {
        const filename = path.replace(/^.*[\\\/]/, '');
        return path.substring(0, path.indexOf(filename));
    }
}
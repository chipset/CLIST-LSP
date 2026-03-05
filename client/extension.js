const path = require("node:path");
const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

let client;

async function activate(context) {
  await startClient(context);

  const restart = vscode.commands.registerCommand("clistLsp.restartServer", async () => {
    if (client) {
      await client.stop();
      client = undefined;
    }
    await startClient(context);
    vscode.window.showInformationMessage("CLIST language server restarted.");
  });

  context.subscriptions.push(restart);
}

async function startClient(context) {
  const serverModule = context.asAbsolutePath(path.join("dist", "server", "server.js"));

  const serverOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc }
  };

  const clientOptions = {
    documentSelector: [
      { scheme: "file", language: "clist" },
      { scheme: "untitled", language: "clist" }
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{clist,clst,exec}")
    }
  };

  client = new LanguageClient(
    "clistLanguageServer",
    "IBM CLIST Language Server",
    serverOptions,
    clientOptions
  );

  context.subscriptions.push(client.start());
  await client.onReady();
}

async function deactivate() {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

module.exports = {
  activate,
  deactivate
};

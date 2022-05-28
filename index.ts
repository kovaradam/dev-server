import { mergeReadableStreams } from "https://deno.land/std@0.126.0/streams/merge.ts";

const fsWatcherStore = {
  _isDirty: false,
  getIsDirty() {
    const prevState = this._isDirty;
    this._isDirty = false;
    return prevState;
  },
  update() {
    this._isDirty = true;
  },
};

(async () => {
  const watcher = Deno.watchFs("./");
  for await (const event of watcher) {
    console.info(`${event.kind.toUpperCase()}: ${event.paths}`);
    fsWatcherStore.update();
  }
})();

async function handleHttp(connection: Deno.Conn) {
  const httpConnection = Deno.serveHttp(connection);
  for await (const requestEvent of httpConnection) {
    // Use the request pathname as filepath
    const url = new URL(requestEvent.request.url);
    const filepath = decodeURIComponent(url.pathname);

    if (filepath === "/poll") {
      const status = [204, 205][+fsWatcherStore.getIsDirty()];
      await requestEvent.respondWith(new Response(null, { status }));
      continue;
    }

    // Try opening the file
    let file;
    try {
      file = await readFile(`.${filepath}`);
    } catch {
      // If the file cannot be opened, return a "404 Not Found" response
      const notFoundResponse = new Response("404 Not Found", { status: 404 });
      await requestEvent.respondWith(notFoundResponse);
      return;
    }

    const response = new Response(
      createFileResponseStream(file, INJECT_SCRIPT)
    );
    await requestEvent.respondWith(response);
  }
}

const INJECT_SCRIPT = Deno.readTextFileSync("./client-script.html");

function createFileResponseStream(file: Deno.FsFile, htmlSlice: string) {
  const textEncoderStream = new TextEncoderStream();
  const textWriter = textEncoderStream.writable.getWriter();

  textWriter.ready
    .then(() => textWriter.write(htmlSlice))
    .then(() => textWriter.close());

  return mergeReadableStreams(textEncoderStream.readable, file.readable);
}

async function readFile(filepath: string): Promise<Deno.FsFile> {
  const stat = await Deno.stat(filepath);

  if (stat.isDirectory) {
    filepath += "index.html";
  }

  const file = await Deno.open(filepath, { read: true });
  return file;
}

const port = Deno.args[0] ?? 3000;

const server = Deno.listen({ port: Number(port) });
console.log(`Dev server running on port ${port}`);

for await (const conn of server) {
  handleHttp(conn).catch(console.error);
}
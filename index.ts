import { mergeReadableStreams } from 'https://deno.land/std@0.126.0/streams/merge.ts';
import { createArgumentMap, html, log } from './utils.ts';

const args = createArgumentMap();
const PORT = args['-p'] ?? 3000;
const SUBDIRECTORY = args['-d'] ?? '';

if (args['-h']) {
  log.help();
  Deno.exit(0);
}

const server = Deno.listen({ port: Number(PORT) });

(async () => {
  log.info(`Running on port ${log.Colors.bold(String(PORT))}`);
  for await (const conn of server) {
    handleHttp(conn).catch(console.error);
  }
})();

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
  const directory = `${Deno.cwd()}/${SUBDIRECTORY}`;
  const watcher = Deno.watchFs(directory);

  log.info(`Watching for file changes in ${log.Colors.bold(directory)}`);

  for await (const event of watcher) {
    log.fsEvent(event);
    fsWatcherStore.update();
  }
})();

async function handleHttp(connection: Deno.Conn) {
  const httpConnection = Deno.serveHttp(connection);
  for await (const requestEvent of httpConnection) {
    // Use the request pathname as filepath
    const url = new URL(requestEvent.request.url);
    const filepath = decodeURIComponent(url.pathname);

    if (filepath === '/poll') {
      const status = [204, 205][+fsWatcherStore.getIsDirty()];
      await requestEvent.respondWith(new Response(null, { status }));
      continue;
    }

    let file;
    try {
      file = await readFile(`.${filepath}`);
    } catch {
      const notFoundResponse = new Response('404 Not Found', { status: 404 });
      await requestEvent.respondWith(notFoundResponse);
      return;
    }

    const response = new Response(
      createFileResponseStream(file, INJECT_SCRIPT),
    );
    await requestEvent.respondWith(response);
  }
}

const INJECT_SCRIPT = html`
  <script>
    const intervalId = setInterval(async () => {
      const response = await fetch("/poll").catch((reason) => {
        clearInterval(intervalId);
        throw new Error("Dev server is unreachable");
      });

      if (response?.status === 205) {
        window.location.reload();
      }
    }, 1000);
  </script>
`;

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
    filepath += '/index.html';
  }

  const file = await Deno.open(filepath, { read: true });
  return file;
}

import { mergeReadableStreams } from 'https://deno.land/std@0.126.0/streams/merge.ts';
import { createArgumentMap, html, log } from './utils.ts';
import {
  WebSocketClient,
  WebSocketServer,
} from 'https://deno.land/x/websocket@v0.1.4/mod.ts';

const args = createArgumentMap();
const PORT = args['-p'] ?? 3000;
const [SOCKET_PORT, REFRESH_MESSAGE] = [Number(PORT) + 1, 'refresh'];
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

const webSocket = new WebSocketServer(SOCKET_PORT);

webSocket.on('connection', function (ws: WebSocketClient) {
  const unsub = store.addNotifier(() => ws.send(REFRESH_MESSAGE));
  ws.on('close', unsub);
});

const store = {
  _debounceId: null as number | null,
  _notifiers: [] as (() => void)[],
  addNotifier(newNotifier: () => void) {
    this._notifiers.push(newNotifier);
    return () => {
      this._notifiers = this._notifiers.filter((notifier) =>
        notifier !== newNotifier
      );
    };
  },
  notify() {
    if (this._debounceId) {
      clearTimeout(this._debounceId);
    }
    this._debounceId = setTimeout(() =>
      this._notifiers.forEach((notify) => notify())
    );
  },
};

(async () => {
  const directory = `${Deno.cwd()}/${SUBDIRECTORY}`;
  const watcher = Deno.watchFs(directory);

  log.info(`Watching for file changes in ${log.Colors.bold(directory)}`);

  for await (const event of watcher) {
    log.fsEvent(event);
    store.notify();
  }
})();

async function handleHttp(connection: Deno.Conn) {
  const httpConnection = Deno.serveHttp(connection);
  for await (const requestEvent of httpConnection) {
    // Use the request pathname as filepath
    const url = new URL(requestEvent.request.url);
    const filepath = decodeURIComponent(url.pathname);

    let file;
    try {
      file = await readFile(`.${filepath}`);
    } catch {
      const notFoundResponse = new Response('404 Not Found', { status: 404 });
      await requestEvent.respondWith(notFoundResponse);
      continue;
    }

    const fileResponse = new Response(
      createFileResponseStream(file, INJECT_SCRIPT),
    );
    await requestEvent.respondWith(fileResponse);
  }
}

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

const INJECT_SCRIPT = html`
  <script>
    function connectSocket(intervalId) {
      let socket
      try {
        socket = new WebSocket('ws://localhost:${SOCKET_PORT}')
        clearInterval(intervalId)
      } catch (_) {
        return
      }
      
      const onMessage = (event) => {
        if(event.data === '${REFRESH_MESSAGE}'){
          window.location.reload();
        }
      }
      socket.addEventListener('message', onMessage);

      const onClose = () => {
        socket.removeEventListener('close', onClose);
        socket.removeEventListener('message', onMessage);
        const intervalId = setInterval(() => connectSocket(intervalId), 1000);

      }
      socket.addEventListener('close', onClose)
    }

    connectSocket()
  </script>
`;

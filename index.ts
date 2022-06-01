import { mergeReadableStreams } from 'https://deno.land/std@0.126.0/streams/merge.ts';
import { createArgumentMap, html, log } from './utils.ts';
import {
  WebSocketClient,
  WebSocketServer,
} from 'https://deno.land/x/websocket@v0.1.4/mod.ts';
import { serve } from 'https://deno.land/std@0.141.0/http/server.ts';

const args = createArgumentMap();
const PORT = args['-p'] ?? 3000;
const [SOCKET_PORT, REFRESH_MESSAGE] = [Number(PORT) + 1, 'refresh'];
const DIR_TO_WATCH = args['-d'] ?? '';

if (args['-h']) {
  log.help();
  Deno.exit(0);
}

serve(handler, {
  port: Number(PORT),
  onListen({ hostname, port }) {
    console.clear();
    log.info(
      `Server is running, see ${
        log.Colors.underline(`http://${hostname}:${port}`)
      }`,
    );
  },
});

async function handler(request: Request) {
  const url = new URL(request.url);
  const filepath = decodeURIComponent(url.pathname);

  let file, filename;
  try {
    [file, filename] = await readFile(`./${DIR_TO_WATCH}${filepath}`);
  } catch {
    const notFoundResponse = new Response('404 Not Found', {
      status: 404,
    });
    return notFoundResponse;
  }

  let fileStream;
  if (filename.endsWith('.html')) {
    fileStream = createFileResponseStream(file, INJECT_SCRIPT);
  } else {
    fileStream = file.readable;
  }

  const fileResponse = new Response(fileStream);
  return fileResponse;
}

function createFileResponseStream(file: Deno.FsFile, htmlSlice: string) {
  const textEncoderStream = new TextEncoderStream();
  const textWriter = textEncoderStream.writable.getWriter();

  textWriter.ready
    .then(() => textWriter.write(htmlSlice))
    .then(() => textWriter.close());

  return mergeReadableStreams(textEncoderStream.readable, file.readable);
}

async function readFile(filepath: string): Promise<[Deno.FsFile, string]> {
  const stat = await Deno.stat(filepath);
  if (stat.isDirectory) {
    filepath += '/index.html';
  }

  const file = await Deno.open(filepath, { read: true });
  return [file, filepath];
}

const INJECT_SCRIPT = html`
  <script>
    function connectSocket(timeoutId, onOpen) {
      const socket = new WebSocket('ws://localhost:${SOCKET_PORT}')
      clearInterval(timeoutId)
      
      socket.addEventListener('open', onOpen)

      const onMessage = (event) => {
        if(event.data === '${REFRESH_MESSAGE}'){
          window.location.reload();
        }
      }

      socket.addEventListener('message', onMessage);

      const onClose = () => {
        const timeoutId = setTimeout(() => {
          connectSocket(timeoutId, () => window.location.reload())
        }, 1000);

      }
      socket.addEventListener('close', onClose)
    }

    connectSocket()
  </script>
`;

const webSocket = new WebSocketServer(SOCKET_PORT);

webSocket.on('connection', function (ws: WebSocketClient) {
  const unsub = fsUpdateStore.addNotifier(() => ws.send(REFRESH_MESSAGE));
  ws.on('close', unsub);
});

const fsUpdateStore = {
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
  const directory = `${Deno.cwd()}/${DIR_TO_WATCH}`;
  const watcher = Deno.watchFs(directory);

  log.info(`Watching for file changes in ${log.Colors.underline(directory)}`);

  for await (const event of watcher) {
    log.fsEvent(event);
    fsUpdateStore.notify();
  }
})();

import * as Colors from 'https://deno.land/std@0.141.0/fmt/colors.ts';

const flags = ['-p', '-d', '-h', '--host'] as const;
type ArgType = typeof flags[number];

export function createArgumentMap() {
  function isValidFlag(flag: string): flag is typeof flags[number] {
    return flags.includes(flag as ArgType);
  }

  const argumentMap = Object.fromEntries(
    flags.map((flag) => [flag, undefined]),
  ) as Record<typeof flags[number], string | undefined>;

  Deno.args.forEach((argument, index, array) => {
    if (argument === '-h') {
      argumentMap[argument] = 'true';
      return;
    }

    if (index === array.length - 1) {
      return;
    }

    if (isValidFlag(argument)) {
      argumentMap[argument] = array[index + 1];
    }
  });

  return argumentMap;
}

export function log(...input: Parameters<typeof console.log>) {
  console.log(input);
}

log.info = (...input: Parameters<typeof console.info>) => {
  console.info(`${Colors.gray('>')} ${input}`);
};

log.error = (...input: Parameters<typeof console.error>) => {
  console.error(`${Colors.red('!')} ${input}`);
};

log.Colors = Colors;

log.fsEvent = (event: Deno.FsEvent) => {
  let color: keyof typeof Colors;
  switch (event.kind) {
    case 'access':
      return;
    case 'create':
      color = 'green';
      break;
    case 'remove':
      color = 'red';
      break;
    default:
      color = 'yellow';
      break;
  }
  console.log(`${Colors[color](event.kind)}: ${event.paths}`);
};

log.help = () => {
  const descriptions: Record<ArgType, string> = {
    '-p': 'define port for server to listen to, default is 3000',
    '--host': 'define server hostname, defaults to 0.0.0.0',
    '-d':
      'specify directory to be watched for changes, default is current directory',
    '-h': 'show help\n',
  };

  console.log('\nUSAGE:');
  console.group();
  console.log('html-dev [OPTIONS]\n');
  console.groupEnd();

  console.log('OPTIONS:');
  console.group();
  Object.entries(descriptions).forEach(([flag, description]) =>
    console.log(`${flag}: ${description}`)
  );
  console.groupEnd();
};

// Enable syntax highlighting with bierner.lit-html extension, return input as is
export const html = (
  stringSlices: TemplateStringsArray,
  ...interpolations: unknown[]
) => {
  return stringSlices.reduce((prev, current, index) => {
    const expression = interpolations[index] ?? '';
    return `${prev}${current}${expression}`;
  }, '');
};

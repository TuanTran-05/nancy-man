import { createHash } from 'node:crypto';
import { SourceMapConsumer } from 'source-map';

type GeneratedFrame = {
  functionName: string;
  generatedFile: string;
  line: number;
  column: number;
  rendered: string;
};

function generatedFrames(stack: string): GeneratedFrame[] {
  return stack
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const match = /^\s*at\s+(?:(.*?)\s+\()?(.+):(\d+):(\d+)\)?$/.exec(line.trim());
      if (!match) return [];
      const functionName = match[1]?.trim() || 'anonymous';
      const generatedFile = match[2];
      const lineNumber = Number(match[3]);
      const columnNumber = Number(match[4]);
      if (!generatedFile || !Number.isInteger(lineNumber) || !Number.isInteger(columnNumber)) {
        return [];
      }
      return [
        {
          functionName,
          generatedFile,
          line: lineNumber,
          column: columnNumber,
          rendered: `${functionName} (${generatedFile}:${lineNumber}:${columnNumber})`
        }
      ];
    })
    .filter((frame) => !/^(chrome|moz|safari)-extension:/i.test(frame.generatedFile))
    .slice(0, 8);
}

function filename(value: string): string {
  try {
    return new URL(value).pathname.split('/').at(-1) ?? value;
  } catch {
    return value.split('/').at(-1) ?? value;
  }
}

export class SourceMapService {
  constructor(
    private readonly storage: {
      find: (input: { serviceName: string; release: string; generatedFile: string }) => Promise<{
        content: string;
        sha256: string;
      } | null>;
    }
  ) {}

  async symbolicate(input: { serviceName: string; release: string; stack?: string }): Promise<{
    status: 'symbolicated' | 'unavailable' | 'checksum_mismatch';
    stackFrames: string[];
  }> {
    if (!input.stack) return { status: 'unavailable', stackFrames: [] };
    const frames = generatedFrames(input.stack);
    if (!frames.length) return { status: 'unavailable', stackFrames: [] };
    const rendered: string[] = [];
    let status: 'symbolicated' | 'unavailable' | 'checksum_mismatch' = 'unavailable';

    for (const frame of frames) {
      const sourceMap = await this.storage.find({
        serviceName: input.serviceName,
        release: input.release,
        generatedFile: filename(frame.generatedFile)
      });
      if (!sourceMap) {
        rendered.push(frame.rendered);
        continue;
      }
      const checksum = createHash('sha256').update(sourceMap.content, 'utf8').digest('hex');
      if (checksum !== sourceMap.sha256) {
        rendered.push(frame.rendered);
        status = 'checksum_mismatch';
        continue;
      }

      const consumer = await new SourceMapConsumer(sourceMap.content);
      try {
        const original = consumer.originalPositionFor({ line: frame.line, column: frame.column });
        if (original.source && original.line !== null && original.column !== null) {
          rendered.push(
            `${original.name ?? frame.functionName} (${original.source}:${original.line}:${original.column})`
          );
          status = 'symbolicated';
        } else {
          rendered.push(frame.rendered);
        }
      } finally {
        consumer.destroy();
      }
    }

    return { status, stackFrames: rendered };
  }
}
